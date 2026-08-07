# morgue — folder contract

This file is the ingestion API. There is no server and no MCP tool: an agent adds an item by
**writing files**, then running two commands. Read this before adding anything.

## Adding an item

Create `items/<slug>/` containing:

```
items/<slug>/
  index.html      # entry point — must run standalone, served from the folder root
  meta.json       # classification (schema below)
  capture.json    # how to record the preview (schema below)
  notes.md        # how the effect works, in words
  src/**          # any additional source, verbatim
```

Then:

```bash
pnpm capture <slug>     # records preview.mp4 + poster.webp into out/<slug>/
pnpm build              # regenerates site/
pnpm check              # verifies the item page runs in the BUILT site
```

`pnpm check` is not optional. Capture serves the item at the folder root; the built site serves
it from `/item/<slug>/`. Those resolve asset paths differently, so **a clean capture does not
prove the item page works.** This has produced two real bugs already; the check catches them.

## meta.json

Use the controlled vocabulary. Free-text tags rot into `scroll`, `scrolling`, `scroll-anim`
within a month, and then search stops working.

```jsonc
{
  "title": "Pinned horizontal scroll",
  "kind": "static",              // reference | static | project | unextracted
  "effect": ["pinned-horizontal"],
  "technique": ["gsap-scrolltrigger"],
  "trigger": "scroll",           // load | hover | click | scroll | drag | idle
  "surface": "page",             // button | card | nav | hero | cursor | list | image | text | page
  "weight": "heavy",             // light | medium | heavy
  "source": "codegrid",
  "sourceUrl": "https://…",      // product page — answers "what may I do with this"
  "sourceArchive": "~/Downloads/…",  // the delivery it was ingested from, if any
  "license": "paid",             // own | mit | paid | unknown
  "addedAt": "2026-08-05",
  "usedIn": []                   // projects you actually shipped it in
}
```

**effect** — marquee, pinned-horizontal, sticky-stack, image-trail, magnetic, text-scramble,
mask-reveal, page-transition, parallax, hover-tilt, cursor-distortion, preloader, morph,
flip-layout, infinite-list, stagger

**technique** — gsap-core, gsap-scrolltrigger, css-only, scroll-timeline, webgl-shader,
threejs, canvas2d, view-transitions, motion/framer, react, nextjs, lenis

### The `export` block

Optional, but it is what makes an item usable somewhere else. `pnpm export
<slug>` and the vault's "Copy for agent" button assemble a markdown bundle from
it — provenance, licence, dependencies, notes, source, and what to throw away.

```jsonc
"export": {
  "files": ["index.html"],          // what to inline; default ["index.html"]
  "deps": { "gsap": "^3.13" },      // REAL packages, not morgue's vendored copies
  "scaffold": ["body", ".stage"],   // demo furniture — the bundle says "do not copy"
  "notes": "Use quickTo, not gsap.to — …"   // the mistake someone will make
}
```

**`scaffold` is the field that matters.** A demo page centres itself in a
`100vh` grid, hides `overflow` on `body`, loads GSAP from `/vendor/`, and sets
`window.__ready`. Pasted verbatim into another project, an agent faithfully
reproduces all of it and the result looks plausible while being wrong. Listing
the selectors that are furniture is the difference between a bundle that works
and one that wastes an hour.

Record `source` and `sourceUrl` honestly — provenance travels into every export,
which is the point. Six months later, "where did this come from and what am I
allowed to do with it" must be answerable from the paste alone.

If there is no product URL, leave `sourceUrl` null and set `sourceArchive`
instead. Do not put the local path in `sourceUrl` to make the field look filled
in: they answer different questions, and a paid template routinely arrives as a
dated bundle with no URL anywhere inside it — both READMEs in the July 2026
CodeGrid drop are untouched `create-next-app` boilerplate. `sourceArchive` is a
weaker claim than `sourceUrl` on purpose, and a weak true claim beats a
confident wrong one.

**kind** decides how much work ingestion is:
- `reference` — video + notes + URL, no code. Fastest to add and often the most useful. Do not
  skip these just because there is no source.
- `static` — HTML/CSS/JS that runs as-is. No build.
- `project` — needs a build step (React, Next). Only these get a build.
- `unextracted` — the interesting section is buried in a large template. Store the archive,
  record the path, capture a video, write the notes. **Extract later, on demand.** Never block
  ingest on producing a runnable isolate, or you will stop adding things.

## capture.json

```jsonc
{
  "trigger": "scroll",                        // load | scroll | pointer
  "viewport": { "width": 1280, "height": 800 },
  "durationMs": 5000,
  "fps": 30,
  "scroll": { "from": 0, "to": "max", "ease": "inOut" },   // trigger: scroll
  "pointerPath": [                                          // trigger: pointer
    { "at": 0.0, "x": 60,  "y": 600 },
    { "at": 0.5, "x": 450, "y": 320 },
    { "at": 1.0, "x": 860, "y": 60  }
  ],
  "posterAt": 0.55,
  "settleMs": 600
}
```

Set `window.__ready = true` in the item once it is ready to record. The harness pumps the
faked clock while polling for it, so signalling from inside a `requestAnimationFrame` or a
React `useEffect` works.

## Rules that exist because something broke

1. **Never freeze scroll-timeline animations.** The seek skips anything whose `timeline !==
   document.timeline`. CSS `animation-timeline: scroll()/view()` is driven by scroll position;
   pausing it freezes the effect while the page keeps moving — the capture looks fine and is
   not. Caught only by looking at contact sheets.

2. **Next.js exports need `assetPrefix`.** Set `assetPrefix: '/item/<slug>'`, `output: 'export'`
   and `images.unoptimized: true`. Without it every `_next` chunk 404s in the built site while
   capture passes. The capture server strips that prefix so one build serves both.

3. **New vendored libraries go in `bin/vendor.mjs`.** Capture and the site both read that map.
   Adding a copy to one and not the other is how the Three.js item 404'd only on its detail page.

4. **Scroll-driven items get no in-page embed.** ScrollTrigger's scroller is the iframe's own
   viewport; in a short frame it shows frame 0 forever. Video in the grid, open-in-new-tab for
   the real thing.

5. **`motion: OK` does not mean correct.** It proves pixels changed, not that the effect ran.
   Look at `out/<slug>/preview.mp4` before considering an item done.

11. **Image optimisation never renames a file.** `pnpm optimise` re-encodes under the same name
    and the same extension; `--format` requires `--allow-rename` and then refuses every file it
    cannot prove safe. `blunt-preloader/src/components/HeroSpotlight/HeroSpotlight.js:23` builds
    its paths with a template literal — `` `…/showreel_img_${i + 1}.jpg` `` — and the same
    computed form survives minification into `_next/static/chunks/`, so for those ten files
    there is no string to rewrite anywhere in the tree. A rename 404s after hydration, which
    `pnpm check` cannot see: it loads one route for 1.4s. Optimise on the way into `site/`,
    never before `pnpm capture` (the poster is encoded at dpr 2 and `preview.mp4` is the
    archival record), and never into `items/` without `--in-place --yes --backup <dir>` — that
    is paid source with no backup. Numbered 11 to avoid colliding with the web rules below;
    it is an ingest rule, not a web one.

## Rules for web/

6. **This is `src/proxy.ts`, not `middleware.ts`.** Next 16 renamed the
   convention. It must sit beside `app/` — with a `src/` directory that means
   `src/proxy.ts`; at `web/proxy.ts` it is silently ignored and the auth gate
   does not run. Verify with `pnpm web:build`: the output must list
   `ƒ Proxy (Middleware)`. The `edge` runtime is unsupported there.

7. **Run web scripts from the repo root.** `pnpm web:dev`, `pnpm web:build`.
   Running them inside `web/` fails on `ERR_PNPM_IGNORED_BUILDS`.

8. **The grid never runs code, and cards animate transform/opacity only.** No
   `box-shadow`, `filter` or `backdrop-blur` transitions on a card — up to
   twelve videos may be decoding and anything forcing paint competes with them.
   The LRU in `lib/player-pool.ts` is ported verbatim from `bin/grid.html`;
   do not "modernise" it into React state.

9. **An empty `AUTH_ALLOWED_LOGINS` denies everyone.** Deliberate. A missing
   variable in production must lock the door, not open it. Likewise an
   unconfigured production deploy returns 503 rather than serving the vault.

10. **`pnpm verify:web` after touching web/.** A green `next build` says
    nothing about whether the page runs — the same lesson as rule 5.

## Never commit the collection

`items/`, `out/` and `site/` are gitignored, deliberately — third-party licensed source and
gigabytes of media. Do not add exceptions, do not `git add -f` them, and do not move collected
code into `fixtures/`. `fixtures/` is only for items written from scratch for this repo.
