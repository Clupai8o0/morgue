# Handoff — 2026-08-08

Written to resume later. Supersedes the 2026-08-07 handoff entirely.

Read [CLAUDE.md](../CLAUDE.md) first — it is the folder contract and it is
authoritative. This file is a snapshot; that one is the rules.

[STATUS.md](./STATUS.md) and [FINDINGS.md](./FINDINGS.md) were reconciled this
session and are accurate as of this date.

---

## State in one screen

Branch **`vault-and-showcase`**, **merged into `main`** this session — the first
merge in the repo's life. Working tree clean, both branches pushed to
`Clupai8o0/morgue` (private).

| | |
|---|---|
| items | 6 · `items/` **6.9 MB** (was 62 MB) |
| archives | 1 (`blunt-main`) · `archives/` 43 MB |
| fixtures | 11 (8 original + 3 MIT showcase) |
| `out/` 409 MB · `site/` 64 MB | both regenerable |

| slug | kind | archive | on disk |
|---|---|---|---|
| `gooey-text-reveal` | project | — | 3.7 MB |
| `livespot360-reveal` | static | — | **3.1 MB** (was 35 MB) |
| `blunt-template` | unextracted | template:blunt-main | 20 KB |
| `blunt-page-transitions` | project | extract:blunt-main | 20 KB |
| `blunt-physics-footer` | unextracted | extract:blunt-main | 20 KB |
| `blunt-smudge-reveal` | project | extract:blunt-main | 16 KB |

## Verified green on this machine

```
pnpm test        11/11 fixtures
pnpm build       6 items → site/
pnpm check       all item pages run     ← was 6/7; the suite is now clean
pnpm web:build   compiles, lists ƒ Proxy (Middleware)
pnpm verify:web  10/10 against web:dev on :3210
```

**`pnpm check` has no reds for the first time.** Every previous handoff carried
one.

---

## What changed this session

Five things, all of them items that had been sitting open in the last handoff.

### 1. `blunt-preloader` retired — the failing check is gone

It was the standalone 23 MB ingest of the same BLUNT template that
`archives/blunt-main` holds, built with `assetPrefix` where the archive uses
`basePath`. `assetPrefix` rewrites `/_next/` only, so the item's inherited nav
resolved against the vault root: `/about` 404'd and `/` served the vault grid at
200. That was the last red in `pnpm check`.

Retiring beat migrating because `blunt-template` already **is** the replacement —
same template, same source, same route (`/archive/blunt-main/`), same entry file
(`src/components/Preloader/Preloader.js`), same load-triggered capture of the
preloader, and notes that are a strict superset of the retired item's. Migrating
would have produced two cards showing the same video.

Removed from `items/`, `out/`, `site/item/`, `site/media/`, plus a stale
`archives/blunt-preloader/candidates.json` left by an old survey run. Backed up
first to `~/morgue-backups/2026-08-08/blunt-preloader/` (251 files, verified by
count); the original delivery is still at `~/Downloads/CGMWTJULY2026/blunt-main`.

### 2. CLAUDE.md rule 2 now covers `basePath`

It used to say `assetPrefix` unconditionally, which is what produced the bug
above. It now names both, says which to pick (`assetPrefix` for single-route
items, `basePath` for anything that navigates), states that neither rewrites
hand-written `<img src>` / raw `<a href>` / `next/image` src under
`output: 'export'`, and points at the post-build pass for those.

Rule 11 and the comment headers in `bin/optimise.mjs`, `bin/survey.mjs`,
`bin/check.mjs` and `bin/export-bundle.mjs` all cited
`items/blunt-preloader/...` paths that no longer exist. Repointed at
`archives/blunt-main`, which holds the identical code — the "seven routes" and
"32 JS / 30 CSS" claims were re-verified against the archive, not assumed.

### 3. First `pnpm optimise --write` against real paid source

`livespot360-reveal`, through the four-flag destructive path
(`--write --in-place --yes --backup`). **34.97 MB → 2.94 MB, −91.6%**, filenames
and formats kept per rule 11. The dry run predicted the output byte-for-byte,
because the estimator encodes rather than models.

Originals in `~/morgue-backups/2026-08-08/optimise-orig-livespot360/`. A full
copy of the pre-optimise item is in the same directory.

Images were spot-checked after the pass, not just `pnpm check`-ed — grain
preserved, no blocking, edges clean at q82/2560w.

**Trap this creates:** `out/livespot360-reveal/preview.mp4` still carries its
2026-08-06 timestamp and was encoded from the original bytes, which is rule 11
working as intended. But re-capture that item now and the new preview comes from
optimised source. The current preview is not reproducible from disk.

### 4. `web:dev` binds :3210

`web/package.json` said `next dev`, which is :3000, while `bin/verify-web.mjs`
defaults to :3210 and the OAuth callback is registered on :3210. Now
`next dev --port 3210`. Nothing bound 3210 by default before this.

### 5. Docs reconciled, including two gaps that were already closed

STATUS still listed "the three showcase items don't exist" and "FINDINGS numbers
are duplicated into `page.tsx`". Both had been fixed in earlier commits and never
struck off. The showcase tiles read from `fixtures/*/meta.json` via
`@/lib/showcase`, and `@/lib/findings` parses `docs/FINDINGS.md` at build time.

---

## THE THING TO KNOW BEFORE EDITING FINDINGS

`web/src/lib/findings.ts` parses `docs/FINDINGS.md` at build time and **every
extractor throws if its number moved.** A renamed table or rewritten sentence
fails `pnpm web:build` by name rather than rendering a stale constant — the same
fail-closed reasoning as rule 9.

Load-bearing for the deploy: the `## Encoder selection` and `## Browser ceilings`
tables, and the `## Determinism` and `## Per-item cost` sections. This session's
FINDINGS edits were all additive or in other sections, and `pnpm web:build` was
re-run afterwards to prove it.

---

## Open decisions

- **`build.mjs` never deletes from `site/` — now the worst gap in the pipeline.**
  `items/` has 6 slugs; `site/item/` and `site/media/` have 17 each,
  `site/data/items/` has 18. Two things sharpened it this session:
  retiring an item left `site/item/blunt-preloader/` and
  `site/media/blunt-preloader/` staged for upload (removed by hand — a
  `publish:r2` run would have shipped the media of a **retired paid template** to
  a bucket nothing will clean), and `pnpm test` builds `fixtures/` into the same
  `site/` on every run and never cleans up. The fix is a prune-to-index pass at
  the end of `build.mjs`, but it means `pnpm test` and `pnpm build` stop sharing
  one `site/` — a design choice, not a one-liner.
- **`archives/blunt-main/public` is 60 image files, 21 unique, 20 MB.** Measured,
  not estimated. Retiring `blunt-preloader` removed a *copy* of that waste, not
  the waste; four items depend on this archive. Not optimised yet because the
  archive is a buildable Next project whose `out/` is already walked by
  `morgue-rewrite.mjs`, and the interaction between the two is unworked.
- **`blunt-physics-footer` has `"effect": []`.** Unchanged from last session.
  None of the 16 controlled effect terms describes a matter.js gravity word-pile,
  and its meta argues a blank beats a mislabel. Adding `physics-pile` would make
  it findable, but the term must land in **both** CLAUDE.md and `bin/survey.mjs`
  or the two copies drift.
- **`morgue-rewrite.mjs` should become `bin/archive-assets.mjs`** before a second
  archive is staged, or the next template gets a second copy of it. Same
  reasoning `bin/vendor.mjs` exists for.
- **`OPENAI_API_KEY` rotation was explicitly deferred** by the user on
  2026-08-08. It was pasted in plaintext into a session transcript and lives in
  `web/.env.local` (gitignored, verified). Still worth doing eventually.

---

## Blocked on credentials — unchanged

Empty in `web/.env.local`: `DATABASE_URL`, `IP_HASH_SALT`, `RESEND_API_KEY`,
`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET`. R2's three are not in the
file at all. Non-empty: `NOTIFY_TO`, `NOTIFY_FROM`, `MORGUE_DATA_SOURCE`,
`AUTH_ALLOWED_LOGINS`, `OPENAI_API_KEY`.

Consequence: **nothing outside the local dev path has ever run.** A production
`next start` returns 503 on `/vault` — correctly, failing closed (rule 9).
`pnpm verify:web` passes only against `web:dev`, which fails open by design.

Vercel project and DNS (`morgue.clupai.com`, plus `api.morgue.clupai.com`
rewritten to `/api/*`) are still unconfigured.

---

## Next moves, in the order I would do them

1. **Prune `site/` to the index in `build.mjs`.** It is the only gap with a
   correctness edge — it can publish retired paid source — and everything else
   on this list gets safer once it lands.
2. **Optimise `archives/blunt-main/public`.** 20 MB, 39 of 60 files redundant,
   four items depending on it. Back up first; it is paid source.
3. **Land credentials.** Neon, `IP_HASH_SALT`, the GitHub OAuth app (callback on
   :3210, which now matches `web:dev`), R2. Until then no production path has
   ever executed.
4. **Extract more from `blunt-main`** now that it is cheap — survey ranked
   `footer` 0.58, `transition-provider` 0.50, `smudge-revealer` 0.35 and eight
   more. Each is ~20 KB.
5. **Ingest a second template as an archive from the start**, to prove the path
   works without a migration behind it.
6. **`kind: reference` has never been used.** The cheapest and often most useful
   ingest — video + notes + URL, no code — and there is still not one example.

---

## Traps paid for this session

- **`pnpm test` overwrites `site/` with fixtures and leaves them there.** It runs
  `MORGUE_SRC=fixtures` through build, so afterwards the vault serves 11 fixture
  records and every real item is gone from the index. Always `pnpm build` after
  `pnpm test`. A green suite that breaks the site it just tested is a bad shape.

- **Deleting an item does not unpublish it.** See the `build.mjs` decision above.
  Nothing warns.

- **`ls -d <dir>` still lies about `~/Downloads`.** Re-confirmed while checking
  the original delivery survived: `ls -d` only stats the path and reports success
  while the directory is unreadable under TCC. Test with a real file read.

- **The optimiser's dry run is not an estimate.** It encodes each file to measure
  it, so `--write` produces exactly the bytes the report predicted. Useful: the
  dry run is a safe rehearsal, not a guess, and disagreement between the two
  would mean something is wrong.

- **Historical measurements should be superseded, not edited.** FINDINGS now
  states this at the top. Rewriting the 2026-08-07 tables to match today would
  have destroyed the only evidence that the size inversion was ever real — which
  is the argument that produced the optimiser.
