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
  "sourceUrl": "https://…",
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

## Never commit the collection

`items/`, `out/` and `site/` are gitignored, deliberately — third-party licensed source and
gigabytes of media. Do not add exceptions, do not `git add -f` them, and do not move collected
code into `fixtures/`. `fixtures/` is only for items written from scratch for this repo.
