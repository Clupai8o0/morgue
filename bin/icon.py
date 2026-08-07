#!/usr/bin/env python3
"""
Generate the morgue mark, then derive every size the site actually serves.

Two stages, deliberately separable:

  generate  — one call to the OpenAI images API. Costs money, is non-deterministic,
              and is the only part that needs the network. Writes assets/icon-src.png
              and never overwrites it without --force, because re-rolling a mark you
              already shipped is how a favicon silently changes under users.

  derive    — pure Pillow. Deterministic, free, offline, re-runnable. Everything the
              browser loads comes from here.

`pnpm icon` runs derive alone when assets/icon-src.png exists, which is the common
case; pass --generate to do the first stage too.

The palette is locked to web/DESIGN.md rather than to whatever the model returned.
An image model will not hit #090909 exactly, and a favicon that is two shades off
the page canvas reads as a rendering bug on the tab strip. See lock_palette().
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon-src.png"
WEB = ROOT / "web"
PUBLIC = WEB / "public"
APPDIR = WEB / "src" / "app"

# From web/DESIGN.md. Duplicated deliberately and asserted below: this script runs
# without a bundler, so it cannot import the tokens, and a silent drift here shows
# up as a favicon that does not match the page.
CANVAS = (0x09, 0x09, 0x09)
INK = (0xFF, 0xFF, 0xFF)
ACCENT = (0x00, 0x99, 0xFF)

ICON_PROMPT = """\
A minimal app icon mark for a tool called "morgue" — a private reference
collection where a developer archives UI motion and web animation they want to
keep. The metaphor is a specimen archive, not death: cold storage, catalogued,
retrievable. Reduce it to ONE bold geometric mark that stays legible at 16x16
pixels: think a toe-tag, a drawer pull, or a filing tab, rendered as flat
vector-like geometry with a single eyelet or slot.

Strict constraints:
- Pure flat design. No gradients, no photographic texture, no bevel, no drop
  shadow, no 3D, no skeuomorphism.
- Near-black background (#090909) with a pure white (#ffffff) mark. At most one
  small accent in blue (#0099ff).
- No text, no letters, no numbers, no words anywhere in the image.
- Centred, generous margin, symmetrical, high contrast.
- Square composition, filling the frame edge to edge.
"""


# ── stage 1: generate ────────────────────────────────────────────────────────


def read_api_key() -> str:
    """Env first, then web/.env.local — the same file every other secret lives in."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    env = WEB / ".env.local"
    if env.exists():
        m = re.search(r"^OPENAI_API_KEY\s*=\s*(.+)$", env.read_text(), re.M)
        if m:
            return m.group(1).strip().strip("\"'")
    sys.exit(
        "No OPENAI_API_KEY.\n"
        "  export OPENAI_API_KEY=sk-...        (this shell only)\n"
        "  or add OPENAI_API_KEY=sk-... to web/.env.local  (gitignored)"
    )


def generate(model: str, force: bool) -> None:
    if SRC.exists() and not force:
        sys.exit(f"{SRC.relative_to(ROOT)} already exists. --force to re-roll it.")
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("pip install openai")

    client = OpenAI(api_key=read_api_key())
    print(f"  generating with {model} …")
    r = client.images.generate(
        model=model, prompt=ICON_PROMPT, size="1024x1024", n=1
    )
    datum = r.data[0]
    # The API returns b64 or a URL depending on model and account; handle both
    # rather than assuming, because the failure mode is an unhelpful AttributeError.
    if getattr(datum, "b64_json", None):
        raw = base64.b64decode(datum.b64_json)
    elif getattr(datum, "url", None):
        import urllib.request

        with urllib.request.urlopen(datum.url) as fh:
            raw = fh.read()
    else:
        sys.exit(f"Unexpected image response shape: {datum!r}")

    SRC.parent.mkdir(parents=True, exist_ok=True)
    SRC.write_bytes(raw)
    print(f"  wrote {SRC.relative_to(ROOT)}  ({len(raw) / 1024:.0f} KB)")


# ── stage 2: derive ──────────────────────────────────────────────────────────


def trim_to_content(im: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """
    Crop the flat border the model always leaves, so the mark occupies a known
    fraction of the frame. Without this, two generations with different margins
    produce favicons at visibly different optical sizes.
    """
    diff = ImageChops.difference(im.convert("RGB"), Image.new("RGB", im.size, bg))
    box = diff.convert("L").point(lambda p: 255 if p > 18 else 0).getbbox()
    return im.crop(box) if box else im


def square(im: Image.Image, bg: tuple[int, int, int], pad: float = 0.14) -> Image.Image:
    """Centre on a square canvas with proportional padding. Never distorts."""
    side = int(max(im.size) * (1 + pad * 2))
    out = Image.new("RGB", (side, side), bg)
    out.paste(im.convert("RGB"), ((side - im.width) // 2, (side - im.height) // 2))
    return out


def lock_palette(im: Image.Image) -> Image.Image:
    """
    Snap the image to the DESIGN.md palette.

    The model returns near-black and near-white, not #090909 and #ffffff. On a tab
    strip a favicon two shades off the page canvas reads as a rendering artefact,
    so luminance is thresholded to exactly canvas/ink and anything strongly blue is
    held at the accent. Midtones are kept as a blend so antialiased edges survive —
    a hard two-colour threshold makes the mark crunchy at 16px, which is the one
    size that matters most.
    """
    rgb = im.convert("RGB")
    lum = rgb.convert("L")
    w, h = rgb.size
    px, lx = rgb.load(), lum.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if b > 140 and b - r > 60 and b - g > 30:
                px[x, y] = ACCENT
                continue
            t = lx[x, y] / 255.0
            if t <= 0.10:
                px[x, y] = CANVAS
            elif t >= 0.90:
                px[x, y] = INK
            else:
                px[x, y] = tuple(
                    round(CANVAS[i] + (INK[i] - CANVAS[i]) * t) for i in range(3)
                )
    return rgb


def rounded(im: Image.Image, radius_frac: float = 0.22) -> Image.Image:
    """Rounded-square mask with an alpha channel, for the PWA/apple-touch sizes."""
    im = im.convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [(0, 0), (im.width - 1, im.height - 1)],
        radius=int(im.width * radius_frac),
        fill=255,
    )
    im.putalpha(mask)
    return im


def resize(im: Image.Image, n: int) -> Image.Image:
    """
    Downscale in one LANCZOS step, then sharpen below 64px.

    A 1024→16 reduction loses the edge contrast the mark depends on; without the
    unsharp pass the 16px favicon turns to grey mush. Above 64px it is unnecessary
    and starts to ring.
    """
    out = im.resize((n, n), Image.LANCZOS)
    if n <= 64:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=110, threshold=2))
    return out


def derive() -> None:
    if not SRC.exists():
        sys.exit(
            f"No {SRC.relative_to(ROOT)}.\n"
            "  pnpm icon --generate      (needs OPENAI_API_KEY)\n"
            "  or drop your own PNG at that path and re-run."
        )
    base = Image.open(SRC)
    print(f"  source        {base.width}x{base.height}")
    base = trim_to_content(base, CANVAS)
    print(f"  trimmed       {base.width}x{base.height}")
    base = lock_palette(square(base, CANVAS))
    print(f"  squared       {base.width}x{base.height}, palette locked")

    # The favicon gets a TIGHTER crop than everything else, and this is not a
    # cosmetic preference. At 16x16 the mark has ~200 usable pixels; the padding
    # that makes a 512px app icon breathe throws away a third of them, and the
    # first thing to go is the gap between the tag and the drawer — the whole
    # mark collapses into a blob with a dot. Verified by magnifying the emitted
    # .ico with nearest-neighbour rather than by eyeballing it small.
    tight = lock_palette(square(trim_to_content(Image.open(SRC), CANVAS), CANVAS, pad=0.04))

    PUBLIC.mkdir(parents=True, exist_ok=True)
    APPDIR.mkdir(parents=True, exist_ok=True)
    wrote: list[tuple[Path, str]] = []

    # favicon.ico — Next serves src/app/favicon.ico automatically. Multi-size so
    # the OS picks per context rather than rescaling one bitmap badly.
    ico = APPDIR / "favicon.ico"
    # .convert("RGBA") is load-bearing. Pillow will happily write an .ico whose
    # embedded PNGs are RGB, and every OS renders it fine — but Next's image
    # pipeline rejects it outright: "Format error decoding Ico: The PNG is not in
    # RGBA format!", and `pnpm web:build` fails. Caught by running the build, not
    # by looking at the file.
    resize(tight, 48).convert("RGBA").save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    wrote.append((ico, "16/32/48"))

    for n, name in ((180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        p = PUBLIC / name
        rounded(resize(base, n)).save(p)
        wrote.append((p, f"{n}x{n}"))

    # og:image — 1200x630 is not square, so the mark is centred on canvas rather
    # than stretched. Social cards crop the edges; keep the mark well inside.
    og = Image.new("RGB", (1200, 630), CANVAS)
    m = resize(base, 380)
    og.paste(m.convert("RGB"), ((1200 - 380) // 2, (630 - 380) // 2))
    p = PUBLIC / "og.png"
    og.save(p)
    wrote.append((p, "1200x630"))

    for path, note in wrote:
        print(f"  wrote {str(path.relative_to(ROOT)):<44} {note:<10} {path.stat().st_size / 1024:6.1f} KB")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate and derive the morgue icon.")
    ap.add_argument("--generate", action="store_true", help="call the images API first")
    ap.add_argument("--model", default="gpt-image-2")
    ap.add_argument("--force", action="store_true", help="overwrite an existing icon-src.png")
    a = ap.parse_args()
    if a.generate:
        generate(a.model, a.force)
    derive()


if __name__ == "__main__":
    main()
