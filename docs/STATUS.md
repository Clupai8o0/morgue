# Status

Last updated: 2026-08-07.

Rationale for the architecture is in [DECISIONS.md](./DECISIONS.md).
Measurements are in [FINDINGS.md](./FINDINGS.md).
The session snapshot this was reconciled against is [HANDOFF.md](./HANDOFF.md).

---

## The collection

Three items, all third-party paid templates, ingested 2026-08-06. Nothing is committed —
`items/`, `out/` and `site/` are gitignored by design, so **these exist only on this disk and
there is no backup.**

| slug | kind | licence | on disk | preview |
|---|---|---|---|---|
| `livespot360-reveal` | `static` | paid (CodeGrid) | 35 MB | 180 KB, 228 frames |
| `gooey-text-reveal` | `project` | paid (CodeGrid) | 3.7 MB | 1092 KB, 240 frames |
| `blunt-preloader` | `unextracted` | paid (CodeGrid) | 23 MB | 236 KB, 255 frames |

| Directory | Size |
|---|---|
| `items/` | 62 MB |
| `out/` | 299 MB (includes PNG frame dirs) |
| `site/` | 86 MB |

`sourceUrl` is null on all three: both Next READMEs are untouched `create-next-app`
boilerplate, so the product URL is not recoverable from the archive. `sourceArchive` records
the local delivery instead. Fill `sourceUrl` in if the CodeGrid receipts turn up.

Full ingest measurements — capture cost, asset waste, export bundle sizes — are in
[FINDINGS.md](./FINDINGS.md).

## What the first real ingest settled

The contract survived contact with code nobody here wrote. Two bugs on the way,
both now fixed and both recorded in FINDINGS: `check.mjs` counting
`items/.gitkeep` as an item, and a template-literal image path that captured
clean and 404'd only in the built site — the exact failure `pnpm check` exists
to catch.

The size inversion held up and got worse under measurement. The 35MB template
was the *easiest* to ingest and is the *most expensive* to store; the 3.7MB one
produces the largest preview in the collection.

| Claim | Measured |
|---|---|
| Capture cost, paid template vs fixture | 10.4s vs 2.76s mean — **3.8×** |
| Source-to-preview weight ratio | 195× (`livespot360`), 97× (`blunt`), 3.4× (`gooey`) |
| `livespot360-reveal` hero JPEG | 6,521,845 B, displayed in a 275×150 box |
| `blunt-preloader` images | 60 files / 20.8 MB → **21 unique / 5.9 MB** |

Five things it taught that are not yet rules in CLAUDE.md — fonts as a
correctness problem, `<Link>` prefetch breaking multi-route exports,
`assetPrefix` not covering hand-written `img src`, `capture.mjs` not faking
`setTimeout`, and determinism being impossible for some templates — are written
up in FINDINGS. Promote them into CLAUDE.md if they recur.

## Built and verified

The capture pipeline came first, then `web/` — a Next.js 16 app serving a public
landing page and a private vault — then the first real ingest.

| | Verified by |
|---|---|
| Design tokens from `DESIGN.md`, dark-only | `/styleguide` renders every token |
| General Sans + Inter, self-hosted | no 404s, correct weights |
| Paginated vault data out of `build.mjs` | `facets.json` 751 B / 3 items |
| Grid: search, filter chips, scroll pagination | `pnpm verify:web` |
| Video LRU ported verbatim from `grid.html` | see caveat below |
| Lenis + GSAP + reveal + magnetic | `pnpm verify:web` 10/10 |
| Landing page: pipeline story, waitlist form | 4581px, all sections reveal |
| Neon + Drizzle schema, waitlist API | validation paths only — see blocked |
| Auth.js + GitHub OAuth + `src/proxy.ts` | gate tested with dummy credentials |
| R2 two-bucket storage + signed URLs | `publish.mjs --dry-run`, 57 files / 2.7MB |
| Agent export bundles + `Copy for agent` | clipboard verified; paid `static` item 16,427 chars |
| Ingest of third-party paid templates | 3 items, `pnpm check` green 2026-08-07 |

Commands: `pnpm test` (capture pipeline, 8/8 fixtures), `pnpm check` (3/3 items),
`pnpm verify:web` (10/10), `pnpm web:build` — must list `ƒ Proxy (Middleware)`.

Caveat on the dry-run figure: **43% of those 2.7MB is orphaned fixture media.** `build.mjs`
never deletes from `site/`, so `site/media/` still holds 8 slugs that are no longer in
`facets.json`. See FINDINGS.

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

- **The video LRU has never been exercised.** Cap is 12; the built index has 3
  items. It is ported verbatim and deliberately un-refactored, but eviction
  needs >12 items before it does anything.
- **Vercel project and DNS** are not configured — `morgue.clupai.com`, plus
  `api.morgue.clupai.com` as a second domain on the same project rewritten to
  `/api/*`.
- **Extraction proper — still the biggest unknown, but a smaller one now.**
  *Ingesting* a commercial template is done and measured; *isolating* one
  section out of a large one so it runs standalone is not. `blunt-preloader` is
  `kind: unextracted` for exactly that reason: the whole site was stored and
  captured rather than reduced — 63 files under `src/`, 251 in the item. The
  number that matters — hours to isolate one effect — has never been taken.
- **`kind: reference` has never been used.** The cheapest path in the contract
  is the only one never walked.

## Known gaps worth fixing before the collection grows

Ordered by how much they cost now, not how interesting they are.

- **Asset waste — now measured, not theoretical, and still on disk.** Three
  items are 62 MB. Content-hashing recovers 21.6 MB (35%) before a single pixel
  is re-encoded, because the templates ship the same bitmap under many names.
  Nothing on the ingest path (`capture` → `build` → `check`) touches an image.
  Linear to 300 items: **~6.2 GB**. A `pnpm optimise` tool now exists but
  defaults to a dry run; the figures below are the state of `items/` as measured
  on 2026-08-07 and are unchanged by it.

  | Item | Files | Bytes | Unique | Waste |
  |---|---|---|---|---|
  | `blunt-preloader` images | 60 | 20.8 MB | 21 files / 5.9 MB | 14.9 MB (72%) |
  | `livespot360-reveal` images | 10 | 36.7 MB | 8 files / 30.0 MB | 6.7 MB (18%) |

  The single worst file is a 6,521,845 B hero JPEG stacked with nine others
  inside a `275px × 150px` box, captured at 600×376. Five `blunt` filenames
  point at one byte-identical 564,691 B file; seven more at one 527,921 B file.

- **`build.mjs` never deletes from `site/`.** `items/` has 3 slugs, `site/item/`
  and `site/media/` have 11. `publish.mjs` walks `site/` rather than the index,
  so a real upload ships 32 orphaned media files / 1.20 MB — 43% of the payload
  — and nothing will ever remove them from the bucket.
- **`export.deps` is hand-written.** Correct for self-authored items; for
  ingested templates it should be read from their `package.json`, or every
  ingest is manual archaeology. Related: `deps()` in `bin/export-bundle.mjs`
  still falls back to `_None — vanilla CSS/JS._` when `export.deps` is absent,
  which is true for a fixture and a confident lie for a Next.js item.
- **The three showcase items don't exist.** `web/src/app/page.tsx:238` renders
  dashed-border placeholders reading "showcase 1/2/3". They need authoring from
  scratch so they are MIT and showable — **everything** in the vault is now
  someone else's paid work, which makes this more pressing than before, not less.
- **FINDINGS numbers are duplicated** into `web/src/app/page.tsx`
  (`494 KB`, `40 → 16`, `Still 16`, `1113/1113`). If a measurement changes, the
  site quietly starts lying. Should be generated from one source.
- **The two ad-hoc export-bundle Playwright suites are gone** — they lived in
  session scratch. 15/15 and 9/9 when last run, ~60 lines each, not currently
  reproducible.

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
- **The Next staging directories are gone.** Both Next items were built in
  session scratch under `/private/tmp/…`, which does not survive.
  `items/<slug>/` holds the built export *plus* the patched source, so they run
  and capture fine — but changing `assetPrefix`, bumping a dependency or
  re-exporting means rebuilding from `~/Downloads`. Every ingest edit is marked
  `MORGUE INGEST` in `items/<slug>/src/`; diff against that rather than redoing
  them from memory. HANDOFF.md has the exact steps.
