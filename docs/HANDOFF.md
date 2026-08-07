# Handoff — 2026-08-06

Written to resume work later. Current state, what is verified, what is not, and
the exact next moves.

Read [CLAUDE.md](../CLAUDE.md) first — it is the folder contract and it is
authoritative. This file is a snapshot; that one is the rules.

> **[STATUS.md](./STATUS.md) is stale as of this session.** It still lists
> "extraction from a real commercial template" as the biggest unknown in the
> project, and describes three CodeGrid templates as sitting unprocessed in
> `~/Downloads`. All three are now ingested and verified. Reconcile STATUS.md
> and FINDINGS.md before trusting either.

---

## What changed this session

The collection went from **0 items to 3**, all of them third-party paid
templates. This was the first real test of the ingest path — every fixture in
`fixtures/` was purpose-written for this repo, so nothing before now proved the
contract survived contact with code somebody else wrote.

It did, with two bugs found on the way (both below).

### The collection

| slug | kind | source | on disk | preview |
|---|---|---|---|---|
| `livespot360-reveal` | `static` | CodeGrid, paid | 35MB | 180KB mp4, 228 frames |
| `gooey-text-reveal` | `project` | CodeGrid, paid | 3.7MB | 1.09MB mp4, 240 frames, boomerang |
| `blunt-preloader` | `unextracted` | CodeGrid, paid | 23MB | 236KB mp4, 255 frames |

`items/` 62MB · `out/` 299MB (includes PNG frame dirs) · `site/` 97MB.

### Verified green, on this machine, at the end of the session

```
pnpm test          8/8 fixtures capture clean, build, all fixture pages run
pnpm build         built 3 items → site/
pnpm check         all item pages run          ← the one that matters
pnpm verify:web    10/10
pnpm web:build     compiles, lists ƒ Proxy (Middleware)
pnpm publish:r2 --dry-run    57 files / 2.7MB
```

Plus two ad-hoc Playwright suites for the export bundle (scripts were in session
scratch and are **gone** — rewrite if wanted, they are ~60 lines each):

- paid `static` item → 15/15 (16,421-char bundle, PAID banner, 3 fenced source blocks)
- `unextracted` item → 9/9 (no source inlined, points at the entry, real deps,
  carries the `isInitialLoad` warning)

Contact sheets were eyeballed for all three captures — **`motion: OK` was not
treated as proof** (rule 5). All three effects render correctly end to end.

---

## Uncommitted work

Nothing is committed. `items/`, `out/` and `site/` are gitignored by design, so
the collection is not at risk of being published — but it also means **the three
items exist only on this disk.** There is no backup.

Tracked files changed *by this session*:

| File | Change |
|---|---|
| `bin/check.mjs` | +7 lines — filter `readdir` to directories (bug fix, below) |
| `CLAUDE.md` | +11 lines — document `sourceArchive`, and the rule not to fake `sourceUrl` |
| `bin/export-bundle.mjs` | `provenance()` emits `Ingested from:` *(file was already untracked)* |

Everything else in `git status` predates this session.

---

## Two real bugs found

**1. `bin/check.mjs` counted `items/.gitkeep` as an item.** `readdir` with no
directory filter, where `build.mjs` has always filtered. Invisible while
`items/` was empty; the first real ingest produced a phantom
`FAIL 404 /item/.gitkeep/index.html`. Fixed.

**2. A template-literal image path proved rule 2 live.**
`HeroSpotlight.js:23` builds `` `/images/showreel/…` ``; a bulk rewrite that
only matched double-quoted strings missed it. It **captured perfectly clean** —
the capture server resolves `/images/…` against the item folder — and 404'd only
in the built site. This is exactly the failure `pnpm check` exists to catch, and
it caught it. Do not skip that step.

---

## Things learned that are not yet in CLAUDE.md

Consider promoting these into the rules list if they recur.

- **Fonts are a correctness problem, not a cosmetic one.** All three templates
  loaded a display face from `fonts.cdnfonts.com`. Two of them measure layout
  before animating — LiveSpot360 derives its whole 3s slide from
  `getBoundingClientRect().left` of a heading, and both Next items split text by
  line/char. Against fallback metrics the capture is *wrong and does not error*.
  Every font is now vendored into the item, and each item gates on
  `document.fonts.ready` before measuring.
- **Next.js `<Link>` prefetch breaks multi-route exports.** Next prefetches
  sibling routes; neither the capture server nor `check.mjs` does directory-index
  resolution, so `/about` 404s and fails the capture. Fixed with
  `prefetch={false}`. Any future multi-route ingest hits this.
- **`assetPrefix` does not touch hand-written `<img src="/…">`.** It only covers
  Next-managed assets. Blunt had 53 such strings. Rewriting them to
  *prefixed-absolute* (`/item/<slug>/images/…`) rather than relative is better:
  the capture server strips `/item/<slug>`, so the same string is correct on both
  surfaces **and** from every route, not just the home one.
- **`capture.mjs` fakes rAF, `performance.now` and `Date.now` — but not
  `setTimeout`.** Anything sequenced on a timer runs in real wall-clock time
  interleaved with screenshot round-trips, so its frame drifts with machine load.
- **Some templates can never be frame-deterministic.** Blunt uses `Math.random`
  shuffles and `from: "random"` staggers. `motionCheck` passes; frame-diffing two
  runs never will. That is the template's design, not a pipeline fault.

---

## Blocked on credentials (unchanged)

Every variable in `web/.env.local` is still empty: `DATABASE_URL`,
`IP_HASH_SALT`, `RESEND_API_KEY`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
`AUTH_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

Consequence worth knowing: **a production `next start` cannot serve `/vault` at
all** — the proxy correctly returns 503, failing closed. `pnpm verify:web` only
passes against `pnpm web:dev`, which fails open by design. Nothing outside the
local dev path has ever run.

---

## Next moves, in the order I would do them

1. **Reconcile `docs/STATUS.md` and `docs/FINDINGS.md`.** STATUS is actively
   wrong now (see the banner at the top). FINDINGS has a section headed
   "Untested entirely — extraction"; that is no longer true and the real numbers
   from this session should replace it.
2. **Asset optimisation.** This is now the pressing gap, not a theoretical one.
   Three items = 62MB. LiveSpot360 is 35MB of JPEG for a 180KB preview, with a
   6.5MB hero that is never displayed larger than 275×150 until the last second.
   Blunt's 20.8MB of images contains only 21 unique files — five are
   byte-identical at 564KB under different names. `sharp` is already a
   dependency. At this rate 300 items is ~6GB on R2.
3. **Fill in `sourceUrl` on all three** if you still have the CodeGrid receipts.
   Both template READMEs are untouched `create-next-app` boilerplate, so the
   product URL is genuinely not recoverable from the archives —
   `sourceArchive` now records the local delivery instead, which is a weaker but
   true claim.
4. **The three showcase items still do not exist.** `web/src/app/page.tsx:238`
   renders dashed-border placeholders reading "showcase 1/2/3". They need
   authoring from scratch so they are MIT and showable — everything in the vault
   is now someone else's paid work, which makes this more pressing than before,
   not less.
5. **FINDINGS numbers are duplicated into the landing page** at
   `page.tsx:20,105,106,163` (`494 KB`, `40 → 16`, `Still 16`, `1113/1113`).
   Generate them from one source or they will quietly start lying.
6. `deps()` in `bin/export-bundle.mjs` still falls back to
   `_None — vanilla CSS/JS._` when `export.deps` is absent. True for a fixture,
   a confident lie for a Next.js item. Left alone deliberately — your call.
7. Vercel project + DNS (`morgue.clupai.com`, `api.morgue.clupai.com` as a second
   domain rewritten to `/api/*`). Still unconfigured.

---

## If you need to rebuild the two Next items

**The staging directory is gone.** Both Next templates were built in
session-scratch under `/private/tmp/…/scratchpad/build/`, which does not
survive. `items/<slug>/` holds the *built export plus the patched source*, so
the items run and capture fine as they are — but to change `assetPrefix`, bump a
dependency, or re-export, redo this:

```bash
# 1. stage out of ~/Downloads (see the macOS note below)
cp -R ~/Downloads/codegrid-gooey-text-reveal /tmp/gooey
cd /tmp/gooey && rm -rf node_modules .next out

# 2. re-apply the ingest edits — they are all marked "MORGUE INGEST" in the
#    copy already living in items/gooey-text-reveal/src/, so diff against that
#    rather than redoing them from memory
diff -ru /tmp/gooey/src ~/Documents/projects/morgue/items/gooey-text-reveal/src

# 3. install + export
pnpm install --ignore-workspace && ./node_modules/.bin/next build

# 4. flatten out/ into the item root, re-copy src/, then
cd ~/Documents/projects/morgue && pnpm capture <slug> && pnpm build && pnpm check
```

Same shape for `blunt` from `~/Downloads/CGMWTJULY2026/blunt-main`. Note blunt
must be built with `assetPrefix: "/item/blunt-preloader"` **and** its 53+1
image strings prefixed — `next build` will not warn you about the latter.

### macOS will block `~/Downloads` without warning

Mid-session, every read of `~/Downloads` started returning `Operation not
permitted` — `Read`, `cat`, `cp`, and `ls`, and it survived disabling the tool
sandbox, so it is OS-level TCC rather than anything in the harness. `stat` on the
path kept working, which makes it look like the folder is fine.

Grant Downloads access to the terminal app under **System Settings → Privacy &
Security → Files and Folders**. It took effect without restarting. Also note
`ls -d <dir>` only stats the path and will report success while the directory is
still unreadable — test with an actual `ls <dir>/` or a file read.

---

## Commands

```bash
pnpm capture <slug>     # record preview.mp4 + poster into out/<slug>/
pnpm build              # regenerate site/ from items/
pnpm check              # verify item pages run in the BUILT site — not optional
pnpm test               # the fixture corpus, end to end
pnpm verify:web         # needs `pnpm web:dev` running on :3210 first
pnpm export <slug>      # print the agent bundle for one item
pnpm publish:r2 --dry-run
```

Run every `web:` script from the repo root, never from inside `web/` — it fails
on `ERR_PNPM_IGNORED_BUILDS`.
