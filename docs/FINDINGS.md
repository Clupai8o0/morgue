# Findings

Measurements taken on this machine (macOS, Apple M5 Pro, Chrome via Playwright 1.62.1,
ffmpeg 8.1.1). Everything here is either reproduced locally or explicitly marked unverified.

Last updated: 2026-08-07. Figures printed by `du -sh` are MiB as shown; byte-exact figures
are decimal bytes.

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

Every preview is 600×376. Poster figures are `poster.webp`.

| Item | Poster | Video | Total |
|---|---|---|---|
| Magnetic button (light, hover) | 2 KB | 28 KB | 30 KB |
| Pinned horizontal scroll | 2 KB | 88 KB | 90 KB |
| WebGL displacement plane | 44 KB | 708 KB | 753 KB |
| LiveSpot360 reveal (paid, heavy) | 15 KB | 180 KB | 195 KB |
| BLUNT preloader (paid, heavy) | 11 KB | 236 KB | 247 KB |
| Gooey text reveal (paid, medium) | 16 KB | 1092 KB | 1108 KB |

WebGL items are ~8× a normal item because wireframe and shader detail defeat compression. If
heavy scenes become common, give `weight: heavy` items 3s clips at 480px rather than 4s at
600px, before the collection reaches gigabytes rather than after.

**A `trigger: "scroll"` item costs roughly double a `load` item of the same length.**
`capture.mjs` boomerangs scroll captures — forward then reverse — so the gooey item's 240
captured frames become 480 played frames over 16.0s. It is now the largest preview in the
collection at 1092 KB, above the WebGL fixture, despite being the *lightest* item on disk.

Full 8-item fixture capture: **35.8s wall (4.5s per item)**.

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

That result holds for `fixtures/` only. It does not generalise to third-party code — see
"Determinism has a ceiling" under *Five things the ingest taught*, below.

## Bugs the health checks caught

Both were invisible to a normal run and would have been found only by clicking:

- **Three.js 404'd on its detail page.** `build.mjs` copied GSAP to `site/vendor` but not Three.
  Capture passed because capture resolves vendor paths through *different code than the site
  does*. Fixed with a shared `bin/vendor.mjs` map.
- **Next.js `assetPrefix` breaks the other surface.** Without it, `_next` chunks 404 in the
  built site; with it, they 404 during capture. The capture server now strips the prefix so one
  build serves both.

Two more surfaced on the first real ingest (2026-08-06):

- **A template-literal image path proved the `assetPrefix` rule live.** `HeroSpotlight.js:23`
  builds `` `/images/showreel/…` ``; a bulk rewrite that only matched double-quoted strings
  missed it. It **captured perfectly clean** — the capture server resolves `/images/…` against
  the item folder — and 404'd only in the built site. Precisely the failure `pnpm check`
  exists to catch.
- **`bin/check.mjs` counted `items/.gitkeep` as an item.** `readdir` with no directory filter,
  where `build.mjs` has always filtered. Invisible while `items/` was empty; the first real
  ingest produced a phantom `FAIL 404 /item/.gitkeep/index.html`. Fixed, +7 lines.

The general lesson, worth repeating: **a clean capture never proves the item page works.**

Separately, the `motion:` probe only asserts that pixels changed. It passed on a completely
broken CSS scroll-driven capture where the progress bar was frozen at `scaleX(0.725)` while the
page scrolled on — a static page still moves under a moving scroll position. Only a contact
sheet caught it. Visual spot-checks remain necessary.

## Ingest of commercial templates — measured

Three CodeGrid templates were ingested on 2026-08-06, one per non-`reference` kind. This was
the first test of the folder contract against code nobody here wrote; every fixture had been
purpose-written for this repo. Contact sheets were eyeballed for all three (rule 5), and
`pnpm check` was re-run green on 2026-08-07.

| slug | kind | licence | `sourceUrl` | on disk | preview | frames | capture |
|---|---|---|---|---|---|---|---|
| `livespot360-reveal` | `static` | paid | null | 35 MB | 180 KB | 228 | 10.1s |
| `gooey-text-reveal` | `project` | paid | null | 3.7 MB | 1092 KB | 240 | 15.5s |
| `blunt-preloader` | `unextracted` | paid | null | 23 MB | 236 KB | 255 | 5.5s |
| **total** | | | | **62 MB** | **1508 KB** | **723** | **31.1s** |

`sourceUrl` is null on all three deliberately: both Next READMEs are untouched
`create-next-app` boilerplate, so the product URL is not recoverable from the archives.
`sourceArchive` records the local delivery instead — a weaker but true claim.

### Third-party code costs ~4× a fixture to capture

Frame-loop time, the `ms` field of `out/<slug>/capture.log.json`. Distinct from the 35.8s
figure above, which is full wall clock including encode.

| Corpus | Items | Total | Mean | Range |
|---|---|---|---|---|
| `fixtures/` (purpose-written) | 8 | 22.1s | 2.76s | 1.9s – 3.6s |
| CodeGrid templates (paid) | 3 | 31.1s | 10.4s | 5.5s – 15.5s |

Ratio of means: **3.8×**. Sample of three; treat as an order of magnitude, not a constant.

### Source weight is the real cost, and it is mostly waste

The preview is never the expensive artefact. Source is, by two orders of magnitude.

| Item | Source on disk | Preview | Ratio |
|---|---|---|---|
| `livespot360-reveal` | 35 MB | 180 KB | 195× |
| `blunt-preloader` | 23 MB | 236 KB | 97× |
| `gooey-text-reveal` | 3.7 MB | 1092 KB | 3.4× |

Almost all of it is duplicated bitmaps, hashed by content:

| Item | Image files | Bytes | Unique files | Unique bytes | Duplicate waste |
|---|---|---|---|---|---|
| `livespot360-reveal` | 10 | 36.7 MB | 8 | 30.0 MB | 6.7 MB (18%) |
| `blunt-preloader` | 60 | 20.8 MB | 21 | 5.9 MB | 14.9 MB (72%) |

Worst individual offenders:

| File | Bytes | Note |
|---|---|---|
| `livespot360-reveal/assets/img1.jpg` | 6,521,845 | the hero |
| `blunt-preloader` image under 5 filenames | 564,691 each | byte-identical |
| `blunt-preloader` image under 7 filenames | 527,921 each | byte-identical |

All ten LiveSpot360 JPEGs — 36.7 MB — are stacked absolutely inside one `.hero-header-img`
box declared `275px × 150px` (`styles.css:101`). The frame only expands to
`window.innerWidth` in the final beat of the animation (`script.js:103`). The capture that
carries them is 600×376.

Linear extrapolation, no optimisation anywhere on the ingest path:

| Metric | Now (3 items) | At 300 items |
|---|---|---|
| `items/` on disk | 62 MB | ~6.2 GB |
| Recoverable by content-dedup alone | 21.6 MB (35%) | ~2.2 GB |

Nothing on the ingest path (`capture` → `build` → `check`) resizes or re-encodes. These are
the bytes on disk as measured on 2026-08-07; a `pnpm optimise` tool now exists but defaults to
a dry run, so none of the above has been reclaimed yet.

### `site/` and the publish payload accumulate orphans

`build.mjs` copies into `site/` and never deletes. `items/` holds 3 slugs; `site/item/` and
`site/media/` hold 11 — the 8 extra are fixture output left over from an earlier build with
`MORGUE_SRC=fixtures`. `publish.mjs` walks `site/`, not the index, so it would upload them.

| `pnpm publish:r2 --dry-run` | Files | Bytes |
|---|---|---|
| Total | 57 | 2.7 MB |
| Media for the 3 slugs in `facets.json` | 12 | 1.62 MB |
| Media for slugs not in `facets.json` | 32 | 1.20 MB (43%) |

`data/items/` carries 11 records for the same reason, 8 of them orphaned. Not yet fixed.
Harmless locally; on a real bucket it is 43% waste plus stale objects nothing will delete.

### Export bundles

`pnpm export <slug>`, character count of stdout:

| Item | Kind | `export.files` | Deps declared | Bundle |
|---|---|---|---|---|
| `livespot360-reveal` | `static` | 3 inlined | 1 | 16,427 chars |
| `gooey-text-reveal` | `project` | 4 inlined | 5 | 10,708 chars |
| `blunt-preloader` | `unextracted` | none — points at the entry | 8 | 6,890 chars |

The bigger bundle is the *simpler* item: a `static` item inlines whole files, an `unextracted`
one refuses to and cites the archive instead. Bundle size tracks inlining policy, not
complexity.

Two ad-hoc Playwright suites verified bundle *content* on 2026-08-06 — paid `static` 15/15
(PAID banner, 3 fenced source blocks), `unextracted` 9/9 (no source inlined, points at the
entry, real deps, carries the `isInitialLoad` warning). **Those scripts were in session scratch
and are gone.** The assertions are not currently reproducible.

### Five things the ingest taught that CLAUDE.md does not say

- **Fonts are a correctness problem, not a cosmetic one.** All three templates loaded a display
  face from `fonts.cdnfonts.com`. Two of them measure layout before animating: LiveSpot360
  derives a `duration: 3` slide from `getBoundingClientRect().left` at `script.js:42`, and
  both Next items split text by line and char. The measured width depends on the font, so
  against fallback metrics the capture is *wrong and does not error*.
  Every font is now vendored into the item (26 files across the three) and each item gates on
  `document.fonts.ready` before measuring. Zero live `cdnfonts` loads remain; the three
  surviving matches in the tree are comments recording the removal.
- **Next.js `<Link>` prefetch breaks multi-route exports.** Next prefetches sibling routes;
  neither the capture server nor `check.mjs` does directory-index resolution, so `/about` 404s
  and fails the capture. Fixed with `prefetch={false}` — 9 occurrences across 4 files in
  `blunt-preloader`. Any future multi-route ingest hits this.
- **`assetPrefix` does not cover hand-written `<img src="/…">`.** It only rewrites
  Next-managed assets. `blunt-preloader/src` contains **54** hand-written `/images/…` strings
  (55 absolute `/item/<slug>/` paths in total). Rewriting them *prefixed-absolute*
  (`/item/<slug>/images/…`) rather than relative is better: the capture server strips
  `/item/<slug>`, so one string is correct on both surfaces **and** from every route, not just
  the home one.
- **`capture.mjs` fakes rAF, `performance.now` and `Date.now` — but not `setTimeout`**
  (`bin/capture.mjs:65–70`). Anything sequenced on a timer runs in real wall-clock time
  interleaved with screenshot round-trips, so its frame position drifts with machine load.
- **Determinism has a ceiling: some templates can never be frame-deterministic.**
  `blunt-preloader/src` has 12 `Math.random` / `from: "random"` call sites driving shuffles and
  staggers. `motionCheck` passes; frame-diffing two runs never will. That is the template's
  design, not a pipeline fault. The 1113/1113 result above is a property of `fixtures/`, not of
  the capture harness.

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

## Still untested

- **Extraction proper.** *Ingesting* a commercial template is now measured; *isolating* one
  section out of a large one so it runs standalone is not. `blunt-preloader` is
  `kind: unextracted` for exactly that reason — the whole site was stored and captured rather
  than reduced: 63 files under `src/`, 251 in the item. The number that matters, hours to
  isolate one effect, has never been taken.
- **`kind: reference`.** No item of that kind exists. The cheapest path in the contract is the
  only one never walked.
- **The video LRU.** Cap is 12; the built index has 3 items. Eviction still does nothing.
- **Everything past local dev** — real database insert, duplicate-email handling, the rate
  limiter, a live R2 upload, a genuine signed-URL fetch. See STATUS.
