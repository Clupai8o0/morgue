# Status

Last updated: 2026-08-08.

Rationale for the architecture is in [DECISIONS.md](./DECISIONS.md).
Measurements are in [FINDINGS.md](./FINDINGS.md).
The session snapshot this was reconciled against is [HANDOFF.md](./HANDOFF.md).

---

## The collection

Six items off three commercial templates — LiveSpot360, BLUNT and the gooey text demo —
all CodeGrid, all `license: paid`. Two were ingested 2026-08-06, the four `blunt-main`
cards derived 2026-08-07 once shared archives existed. Nothing here is committed —
`items/`, `out/`, `site/` and `archives/` are gitignored by design, so **these exist only
on this disk.** Working copies of anything destructive this session are in
`~/morgue-backups/2026-08-08/`.

| slug | kind | archive | on disk | preview |
|---|---|---|---|---|
| `gooey-text-reveal` | `project` | — | 3.7 MB | 1096 KB |
| `livespot360-reveal` | `static` | — | **3.1 MB** | 180 KB |
| `blunt-template` | `unextracted` | template:`blunt-main` | **20 KB** | 240 KB |
| `blunt-page-transitions` | `project` | extract:`blunt-main` | **20 KB** | 52 KB |
| `blunt-physics-footer` | `unextracted` | extract:`blunt-main` | **20 KB** | 852 KB |
| `blunt-smudge-reveal` | `project` | extract:`blunt-main` | **16 KB** | 104 KB |

The four-figure difference is the point of `archives/`. The four BLUNT cards share one
43 MB copy of the template; under the old one-directory-per-item model they would have
cost 4 × 23 MB. An archive-backed item is meta/capture/notes and nothing else.

`livespot360-reveal` is 3.1 MB rather than 35 MB because `pnpm optimise` was finally run
against `items/` on 2026-08-08 — see below.

| Directory | Size | Was 2026-08-07 |
|---|---|---|
| `items/` | **6.9 MB** | 62 MB |
| `archives/` | 43 MB (1 archive, `blunt-main`) | 46 MB |
| `out/` | 409 MB (includes PNG frame dirs) | 429 MB |
| `site/` | 64 MB | 129 MB |

Prune `node_modules` and `.next` out of an archive after building it — a staging build
leaves 435 MB behind, which inverts the entire storage argument. Only
`archives/<name>/out` is servable.

`sourceUrl` is null on every item: the Next READMEs are untouched `create-next-app`
boilerplate, so the product URL is not recoverable from the archive. `sourceArchive` records
the local delivery instead. Fill `sourceUrl` in if the CodeGrid receipts turn up.

### Two things changed the collection on 2026-08-08

**`blunt-preloader` was retired.** It was the standalone 23 MB ingest of the same BLUNT
template that `archives/blunt-main` now holds, built with `assetPrefix` where the archive
uses `basePath` — so its entire inherited nav 404'd in the built site and it was the one
red in `pnpm check`. `blunt-template` covers the same effect, at the same route, off the
same source, with notes that are a strict superset of the retired item's. Removing it cost
the collection nothing and took `pnpm check` to green. A full copy is in
`~/morgue-backups/2026-08-08/blunt-preloader/`, and the original delivery is still at
`~/Downloads/CGMWTJULY2026/blunt-main`.

This is now written into CLAUDE.md rule 2, which used to say `assetPrefix` unconditionally
and now says which prefix to pick and why.

**`pnpm optimise` ran with `--write` for the first time.** `livespot360-reveal`, four-flag
destructive path, filenames and formats kept: 34.97 MB → 2.94 MB across ten JPEGs,
**−91.6%**. Originals in `~/morgue-backups/2026-08-08/optimise-orig-livespot360/`. The dry
run predicted the output byte-for-byte. Full measurements in [FINDINGS.md](./FINDINGS.md).

Live trap worth knowing: `out/livespot360-reveal/preview.mp4` was encoded from the original
bytes and is unchanged, which is rule 11 working — but **re-capture that item now and the new
preview comes from optimised source.** The old preview is not reproducible from disk.

Full ingest measurements — capture cost, asset waste, export bundle sizes — are in
[FINDINGS.md](./FINDINGS.md).

## What the first real ingest settled

The contract survived contact with code nobody here wrote. Two bugs on the way,
both now fixed and both recorded in FINDINGS: `check.mjs` counting
`items/.gitkeep` as an item, and a template-literal image path that captured
clean and 404'd only in the built site — the exact failure `pnpm check` exists
to catch.

The size inversion held up and got worse under measurement. The 35MB template
was the *easiest* to ingest and was the *most expensive* to store; the 3.7MB one
produces the largest preview in the collection.

| Claim | Measured 2026-08-07 | Since |
|---|---|---|
| Capture cost, paid template vs fixture | 10.4s vs 2.76s mean — **3.8×** | stands |
| Source-to-preview weight ratio | 195× (`livespot360`), 97× (`blunt`), 3.4× (`gooey`) | `livespot360` now **17×** |
| `livespot360-reveal` hero JPEG | 6,521,845 B, displayed in a 275×150 box | 757 KB after optimise |
| `blunt-preloader` images | 60 files / 20.8 MB → **21 unique / 5.9 MB** | item retired; same waste in `archives/blunt-main` |

The inversion was the argument for an optimiser, and the optimiser has now been
run — but only by hand, on one item. Nothing on the ingest path applies it, so
the next 35 MB template arrives at full weight.

Five things the ingest taught — fonts as a correctness problem, `<Link>` prefetch
breaking multi-route exports, `assetPrefix` not covering hand-written `img src`,
`capture.mjs` not faking `setTimeout`, and determinism being impossible for some
templates — are written up in FINDINGS. The third of those has since been
promoted: CLAUDE.md rule 2 now covers `assetPrefix` vs `basePath` and points at
the post-build rewrite for hand-written strings. The other four are still
FINDINGS-only; promote them if they recur.

## Built and verified

The capture pipeline came first, then `web/` — a Next.js 16 app serving a public
landing page and a private vault — then the first real ingest.

| | Verified by |
|---|---|
| Design tokens from `DESIGN.md`, dark-only | `/styleguide` renders every token |
| General Sans + Inter, self-hosted | no 404s, correct weights |
| Paginated vault data out of `build.mjs` | `facets.json` 1.7 KB / 6 items |
| Grid: search, filter chips, scroll pagination | `pnpm verify:web` |
| Video LRU ported verbatim from `grid.html` | see caveat below |
| Lenis + GSAP + reveal + magnetic | `pnpm verify:web` 10/10 |
| Landing page: pipeline story, waitlist form | 4581px, all sections reveal |
| Neon + Drizzle schema, waitlist API | validation paths only — see blocked |
| Auth.js + GitHub OAuth + `src/proxy.ts` | gate tested with dummy credentials |
| R2 two-bucket storage + signed URLs | `publish.mjs --dry-run`, 57 files / 2.7MB |
| Agent export bundles + `Copy for agent` | clipboard verified; paid `static` item 16,427 chars |
| Ingest of third-party paid templates | 6 items, `pnpm check` green 2026-08-08 |
| Shared archives — one template, many cards | 4 cards off `blunt-main` at ~20 KB each |
| Relations visible in the vault | template↔extract, verified in Chrome by screenshot |
| `pnpm survey` / `pnpm extract` | 11 ranked candidates + coupling report |
| `pnpm optimise --write` against `items/` | `livespot360-reveal` −91.6%, backed up first |
| `web:dev` and `verify:web` agree on a port | both :3210; was :3000 vs :3210 |

Commands, all green on 2026-08-08:

```
pnpm test        11/11 fixtures
pnpm build       6 items → site/
pnpm check       all item pages run          ← was 6/7, now clean
pnpm web:build   compiles, lists ƒ Proxy (Middleware)
pnpm verify:web  10/10 against web:dev on :3210
```

**`pnpm test` rebuilds `site/` from `fixtures/` and does not clean up.** Run
`pnpm build` after it or the vault serves 11 fixture records instead of the real
6. That is the same "`build.mjs` never deletes" gap listed below, met from the
other direction.

Caveat on the R2 dry-run figure above: **a large share of it is orphaned fixture media.**
`build.mjs` never deletes from `site/`, which is now the most consequential gap in the
pipeline — see below.

## Blocked on credentials

Nothing here is a code problem. All variables are in `web/.env.local`
(template: `web/.env.example`).

- **Neon** — `DATABASE_URL` (pooled). Migration already generated and verified:
  `web/drizzle/0000_glossy_rhino.sql`, 2 tables, 2 indexes. Then `pnpm db:push`.
- **`IP_HASH_SALT`** — `openssl rand -hex 32`.
- **GitHub OAuth app** — `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, plus
  `AUTH_SECRET` (`openssl rand -base64 32`).
- **Cloudflare R2** — account id, access key, secret. Create `morgue-private`
  with **no public access** and `morgue-public`.
- **Resend** *(optional)* — without it signups still save; notification is
  skipped with a log line rather than failing.

Once these land, the untested paths are: real insert, duplicate-email handling,
the rate limiter, a live R2 upload, and a genuine signed-URL fetch.

Consequence worth stating plainly: **a production `next start` cannot serve
`/vault` at all.** The proxy returns 503, failing closed, which is the intended
behaviour (rule 9). `pnpm verify:web` only passes against `pnpm web:dev`, which
fails open by design. Nothing outside the local dev path has ever run.

## Not verified

- **The video LRU has never been exercised.** Cap is 12; the built index has 6
  items. It is ported verbatim and deliberately un-refactored, but eviction
  needs >12 items before it does anything. Retiring an item moved this further
  away, not closer.
- **Vercel project and DNS** are not configured — `morgue.clupai.com`, plus
  `api.morgue.clupai.com` as a second domain on the same project rewritten to
  `/api/*`.
- **Extraction proper — still the biggest unknown, but a smaller one now.**
  *Ingesting* a commercial template is done and measured; *isolating* one
  section out of a large one so it runs standalone is not. `blunt-template` is
  `kind: unextracted` for exactly that reason: the whole site is stored and
  captured rather than reduced, 63 files under `src/`. The number that matters —
  hours to isolate one effect — has never been taken, and the archive model makes
  deferring cheap enough that nothing forces the question.
- **`kind: reference` has never been used.** The cheapest path in the contract
  is the only one never walked.

## Known gaps worth fixing before the collection grows

Ordered by how much they cost now, not how interesting they are.

- **`build.mjs` never deletes from `site/` — now the worst gap in the pipeline.**
  `items/` has 6 slugs; `site/item/` and `site/media/` have 17 each and
  `site/data/items/` has 18. `publish.mjs` walks `site/` rather than the index,
  so a real upload ships every orphan and nothing will ever remove them from the
  bucket. Two things sharpened this on 2026-08-08:

  1. **Retiring an item does not remove it from `site/`.** After
     `items/blunt-preloader` was deleted, `site/item/blunt-preloader/` and
     `site/media/blunt-preloader/` were still there and still publishable. A
     `publish:r2` run would have uploaded the media of a **retired paid
     template**. Removed by hand; nothing in the pipeline would have done it and
     nothing warns.
  2. **`pnpm test` is how the orphans keep arriving.** It builds `fixtures/`
     into the same `site/` and does not clean up, so every test run leaves 11
     fixture slugs behind.

  Fix is small — prune `site/item`, `site/media` and `site/data/items` to the
  index at the end of `build.mjs` — but it means `pnpm test` and `pnpm build`
  stop coexisting in one `site/`, which is a real design choice, not a one-liner.

- **Asset waste — measured, and now half-addressed.** The 2026-08-07 figure was
  62 MB across three items with 21.6 MB recoverable by content-dedup alone.
  `items/` is now **6.9 MB**: one item optimised (−32 MB) and one retired
  (−23 MB). But **nothing on the ingest path (`capture` → `build` → `check`)
  touches an image**, so this was hand-work that the next 35 MB template will
  need again from scratch.

  | Item | Files | Bytes | Unique | Waste | State |
  |---|---|---|---|---|---|
  | `livespot360-reveal` images | 10 | 36.7 MB | 8 / 30.0 MB | 6.7 MB (18%) | optimised to 2.94 MB |
  | `blunt-preloader` images | 60 | 20.8 MB | 21 / 5.9 MB | 14.9 MB (72%) | item retired |
  | `archives/blunt-main/public` | 60 | 20.8 MB | 21 / 5.9 MB | 14.9 MB (72%) | **untouched** |

  The last row is the one that still costs: retiring `blunt-preloader` removed a
  *copy* of that waste, not the waste. The archive still ships the same bitmap
  under many names — five filenames pointing at one byte-identical 564,691 B
  file, seven more at one 527,921 B file — and four items depend on it. It has
  not been optimised because the archive is a buildable Next project and a
  post-build asset rewrite already walks its `out/`; the interaction between the
  two has not been worked out.
- **`export.deps` is hand-written.** Correct for self-authored items; for
  ingested templates it should be read from their `package.json`, or every
  ingest is manual archaeology. Related: `deps()` in `bin/export-bundle.mjs`
  still falls back to `_None — vanilla CSS/JS._` when `export.deps` is absent,
  which is true for a fixture and a confident lie for a Next.js item.
- ~~**The three showcase items don't exist.**~~ **Closed.** `web/src/app/page.tsx`
  reads them out of `fixtures/*/meta.json` via `@/lib/showcase`, count included.
  The three MIT fixtures are real. Still true that **everything in the vault
  proper is someone else's paid work** — the showcase is the only thing on the
  public side that is ours.
- ~~**FINDINGS numbers are duplicated** into `web/src/app/page.tsx`.~~ **Closed.**
  `@/lib/findings` parses `docs/FINDINGS.md` at build time and every extractor
  *throws* if its number moved, so a rewritten table fails `pnpm web:build` by
  name instead of rendering a stale constant. Worth knowing when editing
  FINDINGS: the `Encoder selection` and `Browser ceilings` tables and the
  `Determinism` and `Per-item cost` sections are load-bearing for the deploy.
- **The two ad-hoc export-bundle Playwright suites are gone** — they lived in
  session scratch. 15/15 and 9/9 when last run, ~60 lines each, not currently
  reproducible.
- **`pnpm optimise` is not on the ingest path.** It exists, it works, and it has
  now been proven against real paid source — but it runs only when someone
  remembers. The next heavy template arrives at full weight.

## Traps already paid for

Recorded because each one cost real time and none is obvious.

- **`pnpm build` inside `web/`** fails with `ERR_PNPM_IGNORED_BUILDS`. Run web
  scripts from the repo root (`pnpm web:dev`, `pnpm web:build`).
- **`src/proxy.ts`, not `web/proxy.ts`.** Next 16 requires it beside `app/`.
  In the wrong place it is silently ignored and the auth gate never runs.
- **Auth.js asserts its config before any callback of yours.** An
  `authConfigured()` check inside the `auth()` wrapper is too late — it throws
  `MissingSecret` on every protected request. The guard has to sit outside.
- **A placeholder `DATABASE_URL` is worse than an empty one.** Any non-empty
  string reads as "configured", so you get a 500 from an unreachable host
  instead of an honest 503.
- **The extension-driven browser tab is backgrounded** (`visibilityState:
  "hidden"`, 0 rAF frames/s), which suspends rAF, IntersectionObserver delivery
  *and* media loading. Two separate "bugs" turned out to be this. `pnpm
  verify:web` uses Playwright with `channel: 'chrome'` and is the reliable path.
- **macOS blocks `~/Downloads` without warning.** Mid-ingest every read started
  returning `Operation not permitted` — `cat`, `cp`, `ls` alike — and it
  survived disabling the tool sandbox, so it is OS-level TCC. Grant Downloads
  access under **System Settings → Privacy & Security → Files and Folders**; it
  takes effect without a restart. Note `ls -d <dir>` only stats the path and
  reports success while the directory is still unreadable — test with
  `ls <dir>/` or a real file read.
- **The Next staging directory is gone.** `gooey-text-reveal` was built in
  session scratch under `/private/tmp/…`, which does not survive.
  `items/<slug>/` holds the built export *plus* the patched source, so it runs
  and captures fine — but changing the mount prefix, bumping a dependency or
  re-exporting means rebuilding from `~/Downloads`. Every ingest edit is marked
  `MORGUE INGEST` in `items/<slug>/src/`; diff against that rather than redoing
  them from memory. `archives/blunt-main` is the exception — it is a buildable
  project on disk, which is a second argument for the archive model.
- **`pnpm test` overwrites `site/` with fixtures and leaves them there.** Always
  `pnpm build` afterwards. Forgetting it means the vault serves 11 fixture
  records and every real item is gone from the index — a green test suite that
  breaks the site it just tested.
- **Deleting an item does not unpublish it.** `site/item/<slug>/` and
  `site/media/<slug>/` survive the deletion and `publish.mjs` walks `site/`, not
  the index. Retiring paid source therefore leaves it staged for upload. Remove
  both by hand until `build.mjs` prunes.
