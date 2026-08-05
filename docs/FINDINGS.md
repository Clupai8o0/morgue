# Findings

Measurements taken on this machine (macOS, Apple M5 Pro, Chrome via Playwright 1.62.1,
ffmpeg 8.1.1). Everything here is either reproduced locally or explicitly marked unverified.

## Browser ceilings

| Measurement | Result |
|---|---|
| WebGL contexts created / surviving | 40 created → **16 alive** |
| Alive after detaching every canvas from the DOM | **still 16** — detaching does not free a context |
| Scope of the cap | per *renderer thread*, so same-origin iframes share one budget |
| ScrollTrigger in a 460px iframe, parent scrolled 3000px | track transform stayed at **`0`** |

The WebGL cap is why the grid can never run live previews, and the ScrollTrigger result is why
scroll-driven items get no in-page embed at all.

Unverified but likely relevant: Chrome's `kMaxWebMediaPlayers` is reported to be 75 per frame,
and pausing a `<video>` does not release its player. The grid's LRU pins concurrent loaded
players at 12 (measured: 45 cards hovered, peak 12, zero errors), so the cap is never
approached — untested because unreachable.

## Encoder selection

Same 120 WebGL wireframe frames — the worst case for inter-frame compression:

| Encoder | Size | Time |
|---|---|---|
| **h264 crf28 medium** | **494 KB** | **0.1s** |
| av1 svt crf38 | 756 KB | 0.4s |
| h264 crf23 veryslow | 1065 KB | 0.7s |
| vp9 crf34 | 1808 KB | 1.8s |
| h264_videotoolbox (hardware) | 1972 KB | 0.2s |

Two counterintuitive results drove the final settings:

- **The hardware encoder is the worst option.** VideoToolbox optimises for throughput, not
  bitrate — 4× the size of software x264 for a short loop.
- **VP9 was both bigger and 18× slower** than h264 here, so emitting a `.webm` alongside the
  `.mp4` was pure waste. Dropped.

Settled on one file: `libx264 -crf 28 -preset medium -pix_fmt yuv420p -movflags +faststart
-g 15`. `yuv420p` because Safari refuses anything else; `+faststart` so hover playback starts
decoding immediately; tight keyframes so `currentTime = 0` replay is instant.

Stills go through sharp, not ffmpeg — Homebrew's ffmpeg is built without `libwebp`.

## Per-item cost

| Item | Poster | Video | Total |
|---|---|---|---|
| Magnetic button (light, hover) | 2 KB | 28 KB | 30 KB |
| Pinned horizontal scroll | 2 KB | 88 KB | 90 KB |
| WebGL displacement plane | 44 KB | 708 KB | 753 KB |

WebGL items are ~8× a normal item because wireframe and shader detail defeat compression. If
heavy scenes become common, give `weight: heavy` items 3s clips at 480px rather than 4s at
600px, before the collection reaches gigabytes rather than after.

Full 8-item capture: **35.8s wall (4.5s per item)**.

## Determinism

**1113/1113 frames byte-identical** across two runs of all eight fixtures. Three separate races
had to be fixed to get there:

1. **Split round-trips.** Setting `scrollTo` and stepping the clock in two `page.evaluate`
   calls let a scroll event land in the gap. ScrollTrigger's scrub then smoothed from a
   one-frame-different value and diverged for ~70 frames before reconverging — 75/150 frames
   differing. Both must happen in one evaluate.
2. **Fake rAF vs Playwright's own polling.** `waitForFunction` polls on `requestAnimationFrame`
   by default, which the fake clock only drains when stepped, so the predicate never ran and
   every item burned the full timeout twice. Next.js was worst at **64s for one item** because
   it signals readiness from inside a rAF. Polling on a timer and pumping the clock: **64s → 4.2s**.
3. **Poster jumping.** Seeking straight to the poster timestamp lands somewhere plausible but
   wrong for anything with scrub smoothing, elastic easing or inertia. It now steps through.

## Bugs the health checks caught

Both were invisible to a normal run and would have been found only by clicking:

- **Three.js 404'd on its detail page.** `build.mjs` copied GSAP to `site/vendor` but not Three.
  Capture passed because capture resolves vendor paths through *different code than the site
  does*. Fixed with a shared `bin/vendor.mjs` map.
- **Next.js `assetPrefix` breaks the other surface.** Without it, `_next` chunks 404 in the
  built site; with it, they 404 during capture. The capture server now strips the prefix so one
  build serves both.

The general lesson, worth repeating: **a clean capture never proves the item page works.**

Separately, the `motion:` probe only asserts that pixels changed. It passed on a completely
broken CSS scroll-driven capture where the progress bar was frozen at `scaleX(0.725)` while the
page scrolled on — a static page still moves under a moving scroll position. Only a contact
sheet caught it. Visual spot-checks remain necessary.

## Not verified here

Carried from research, reproduced only in part. Treat as leads, not facts:

- Tailwind v3 → v4 silent visual drift (`shadow-sm` shifting a step, default border colour
  becoming `currentColor`). Strongest argument for per-item compiled CSS behind an iframe.
- `shadcn add` corrupting bytes above `0x7F` (no textures, `.glb`, `.woff2`, `.mp4`), rewriting
  `target` based on detected project layout, and prompting for overwrite despite `--yes`.
- How 21st.dev, Aceternity, Codrops and Mobbin behave today — measured by research agents
  against live sites, not re-checked here.
- Next.js `output: 'export'` rejecting Server Actions, middleware, rewrites, and dynamic routes
  without `generateStaticParams`. Only the happy path is proven.

## Untested entirely

**Extraction** — pulling one section out of a large commercial template so it runs standalone.
Every fixture here is purpose-written and clean. This is the real ingestion cost and nothing in
this repo says anything about it yet. It is why `kind: unextracted` exists.
