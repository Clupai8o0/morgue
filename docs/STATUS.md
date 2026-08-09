# Status

Last updated: 2026-08-09.

Rationale for the architecture is in [DECISIONS.md](./DECISIONS.md).
The major change in flight — multi-tenant accounts — is specified in
[MULTI-TENANT.md](./MULTI-TENANT.md). **Phases 1 and 2 (identity) are built,
verified and DEPLOYED; phases 3–7 are not started.** So the *auth* described
below is the new one; everything about the *collection* still describes the
single-owner system, because the tenancy boundary is phase 3.
Open-sourcing it for local use is specified in
[LOCAL-MODE.md](./LOCAL-MODE.md) — design only, nothing built.
Measurements are in [FINDINGS.md](./FINDINGS.md).
The session snapshot this was reconciled against is [HANDOFF.md](./HANDOFF.md).

---

## The collection

**Twelve items off seven commercial templates**, all CodeGrid, all
`license: paid`, all `source: codegrid` — checked, not assumed. Two were
ingested 2026-08-06, four `blunt-main` cards derived 2026-08-07 once shared
archives existed, and six more arrived 2026-08-08 with the parallel-agent
stress test. Nothing here is committed — `items/`, `out/`, `site/` and
`archives/` are gitignored by design, so **these exist only on this disk and in
R2.** Backups of anything destructive are in `~/morgue-backups/`.

| slug | kind | archive | on disk | preview |
|---|---|---|---|---|
| `and2es-3d-slider` | `static` | — | 1.0 MB | 155 KB |
| `backrooms` | `unextracted` | `template:backrooms` | 20 KB | 87 KB |
| `blunt-page-transitions` | `project` | `extract:blunt-main` | 20 KB | 50 KB |
| `blunt-physics-footer` | `unextracted` | `extract:blunt-main` | 20 KB | 852 KB |
| `blunt-smudge-reveal` | `project` | `extract:blunt-main` | 16 KB | 103 KB |
| `blunt-template` | `unextracted` | `template:blunt-main` | 20 KB | 237 KB |
| `clip-mask-transition` | `project` | `template:clip-mask` | 20 KB | 115 KB |
| `deadlock-studios` | `unextracted` | `template:deadlock-studios` | 20 KB | 430 KB |
| `glitchandgrit-slider` | `static` | — | 2.8 MB | 355 KB |
| `gooey-text-reveal` | `project` | — | 3.3 MB | 1092 KB |
| `livespot360-reveal` | `static` | — | 3.1 MB | 180 KB |
| `starfield-animation` | `static` | — | 96 KB | 1169 KB |

**The 20 KB rows are the point of `archives/`.** Eight of the twelve are
archive-backed and cost meta/capture/notes and nothing else; the four BLUNT
cards share one copy of a template that would otherwise have been stored four
times. The four standalone `static`/`project` items are the ones carrying their
own source, and they are most of `items/`.

| Directory | Size | Was 2026-08-07 |
|---|---|---|
| `items/` | **10 MB** | 62 MB |
| `archives/` | 274 MB — `backrooms` 170, `blunt-main` 43, `clip-mask` 35, `deadlock-studios` 25 | 46 MB (1) |
| `out/` | **40 MB** (frames are pruned after encoding) | 429 MB |
| `site/` | 212 MB | 129 MB |

`archives/` is now the largest thing on disk by a wide margin, and `backrooms`
alone is 170 MB of it. That is the cost side of the archive model and it has
not been paid down — see the gaps below.

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
| Paginated vault data out of `build.mjs` | `facets.json` 3.6 KB / 12 items |
| Grid: search, filter chips, scroll pagination | `pnpm verify:web` |
| Video LRU ported verbatim from `grid.html` | see caveat below |
| Lenis + GSAP + reveal + magnetic | `pnpm verify:web` 10/10 |
| Landing page: pipeline story, waitlist form | 4581px, all sections reveal |
| Neon + Drizzle schema, waitlist API | validation paths only — see blocked |
| Auth.js + GitHub OAuth + `src/proxy.ts` | gate tested with dummy credentials |
| R2 two-bucket storage + signed URLs | **published for real 2026-08-09: 220 objects, 22.3 MB** |
| Agent export bundles + `Copy for agent` | clipboard verified; paid `static` item 16,427 chars |
| Ingest of third-party paid templates | 12 items, `pnpm check` green 2026-08-09 |
| Shared archives — one template, many cards | 4 cards off `blunt-main` at ~20 KB each |
| Relations visible in the vault | template↔extract, verified in Chrome by screenshot |
| `pnpm survey` / `pnpm extract` | 11 ranked candidates + coupling report |
| `pnpm optimise --write` against `items/` | `livespot360-reveal` −91.6%, backed up first |
| `web:dev` and `verify:web` agree on a port | both :3210; was :3000 vs :3210 |
| Notes render as markdown, tables and all | 1 table / 7 rows / 3 code blocks on `blunt-template` |
| Preview ladder — xs 200w, sm 360w | xs −85%, sm −61%; grid pulls 360×226 |
| Extract previews in the relations strip | 3 thumbnails, all requesting `preview-xs.mp4` |
| Preview loading state | held the response 4s in Playwright; appears, then clears on paint |
| **Read-only share links** | **`pnpm verify:share` 33/33 against a production build** |
| **Accounts in Postgres; GitHub + Google + email/password** | **`pnpm verify:auth` 128/128 against a throwaway Postgres** |
| **Self-service account management** | same suite — rename, move address, sign out everywhere, export, delete |
| **Free-tier caps and `/upgrade`** | same suite — page gated, request deduped, owner emailed once |
| **Lockout, session revocation, password reset, email verification** | same suite — reset and verification run end to end through the emailed link |
| **One account, three sign-in methods** | same suite — connecting a provider under a *different* address links rather than forking the account |
| **The last sign-in method cannot be disconnected** | same suite — a password counts as one |
| **Privacy and terms pages** | live; the takedown section states the consequence of admins being unable to read a vault |
| **Deployed: `https://morgue.clupai.com`** | **verified against the live domain — see “In production” below** |

Commands, all green on 2026-08-09 and all re-run that day:

```
pnpm test          11/11 fixtures
pnpm build         12 items → site/   (pruned 33 orphaned paths, 5.1MB)
pnpm check         all 12 item pages run, 33 internal links followed
pnpm web:build     compiles, lists ƒ Proxy (Middleware)
pnpm verify:web    10/10 — now self-contained, see below
pnpm verify:share  33/33 against its own production server
pnpm verify:auth   128/128 against its own production server AND its own Postgres
```

**`pnpm verify:web` was passing for the wrong reason and no longer is.** It ran
against `pnpm web:dev`, which worked only because `web/.env.local` had no auth
credentials in it: `authConfigured()` was false, `proxy.ts` fails open in
development, and `/vault` rendered for anyone. The day those variables were
filled in, the dev server started gating `/vault` correctly and the harness
reported that the grid had no cards — the product working and the test wrong.
It now brings its own Postgres and its own production server and signs in,
which also means it exercises the build a visitor actually gets. A test whose
pass depends on a secret being absent is not testing what it claims.

**`pnpm verify:share` was the first thing here that ever ran outside the
local dev path, and `pnpm verify:auth` went further — it starts a real
Postgres with `initdb` as well as a production server.** It spawns `next start` with an injected `AUTH_SECRET` and
dummy OAuth credentials, because `proxy.ts` fails open in development and a
gate verified only there is verified in the mode where it does not run. It
proves the wall is up without a session, that a share cookie opens the vault
and is refused `/admin` and `/api/share`, that an item link cannot reach any
other item or its media, and that forged, scope-escalated, malformed and
expired tokens are all rejected.

**`pnpm test` no longer touches `site/` at all.** It builds `fixtures/` into
`site-fixtures/` and checks that tree. The two used to share one directory,
which meant a test run replaced the vault's index with 11 fixture records — and,
once `build.mjs` learned to prune, *deleted all 12 real slugs* as a side effect
of running the tests. `bin/check.mjs` derives the same path from the same
`MORGUE_SRC`, so `pnpm test` checks what it just built.

Caveat on the R2 dry-run figure above: **a large share of it is orphaned fixture media.**
`build.mjs` never deletes from `site/`, which is now the most consequential gap in the
pipeline — see below.

## Sharing — what it needs, and what it does without

Read-only share links are the one feature deliberately built to work before the
credentials land.

| | Needs | Without it |
|---|---|---|
| Issue a link, redeem it, enforce scope, expire it | **`AUTH_SECRET` only** — `openssl rand -base64 32`, no vendor | nothing works; `/api/share` 503s and `/admin` says so |
| List outstanding links, revoke one early | `DATABASE_URL` | links still work and are invisible; `/admin` says so in as many words |

The token is signed and carries its own expiry, so validation is a hash rather
than a query — Postgres stays out of the path of every page load and every
media byte, which is the same reason the vault itself is not in Postgres.

The cost, stated where it cannot be missed: **a signed token cannot be
un-issued.** Revocation is checked at redemption and the cookie it mints lasts
an hour, so revoking takes effect within an hour, not instantly. Rotating
`AUTH_SECRET` is the break-glass and kills everything at once.

## Three gates that could not fail, and one licence that was not true — 2026-08-09

- **`pnpm check` could never fail.** It counted broken pages into `bad`, printed
  the number, and exited 0. Since `pnpm test` is an `&&` chain ending in
  `fixtures:check`, the whole suite was green with every item page broken — and
  this is the gate CLAUDE.md calls not optional, and the only thing that catches
  the `assetPrefix`/`basePath` bug that cost `blunt-preloader` its place. It now
  sets `process.exitCode = 1`. A *missing* build also fails ("run `pnpm build`
  first" is an instruction that clears the red); an *empty* one does not, because
  a permanent red nobody can clear is how a gate gets ignored.

- **`pnpm publish:r2 --public` switched the bucket and nothing else.** The job
  list was identical, so it was one flag from uploading every paid item's media
  and `site/data/items/*.json`, which inline the export source verbatim. There is
  now a licence gate: showcase-flagged **and** `own`/`mit` only, media only, no
  data payload, and it fails closed with no index. Never run in anger, in either
  form.

- **`pnpm test` deleted the collection.** Covered under the `build.mjs` gap
  below.

- **The landing page claimed a licence that did not exist.** `page.tsx` told
  visitors the showcase pieces were "authored from scratch and MIT-licensed",
  while all eleven fixtures said `"license": "own"` and the repo had no `LICENSE`
  file. Made true rather than retracted: `LICENSE` now grants MIT over
  `fixtures/` and the eleven `meta.json` say `mit`. **The scope section is the
  load-bearing part** — it grants nothing over `items/` or `archives/` (bought
  source, not ours to relicense) and nothing over `bin/` or `web/`, which stay
  all rights reserved pending [LOCAL-MODE.md](./LOCAL-MODE.md). A blanket MIT at
  the root of a repository that also holds paid third-party source would have
  been a worse bug than the one it fixed.

## Accounts can now manage themselves — 2026-08-09

`/account` used to be provider link/unlink plus a password. It now also does
rename, move-your-address, sign out everywhere, export, and delete — and there
is a `/upgrade` page carrying the caps. Migration `0003` adds `users.plan` and
`upgrade_requests`. All of it is covered by `pnpm verify:auth`, which went
84 → **128** assertions.

Four things worth knowing, because each is a decision rather than an
implementation detail:

- **Deleting an account REVOKES its share links; it never deletes the rows.** A
  share token is valid because it is *signed*, and `app/s/[token]` lets an
  unknown `jti` through by design — so removing a departing user's rows would
  have re-enabled every link they ever revoked. The same six-step ordering now
  backs `pnpm user rm`, which until today was a bare `delete from users` and was
  therefore the path that quietly left those links live.
- **An email change writes nothing until the new mailbox answers.** An address
  on a `users` row is an identity claim — `link-policy.ts` attaches a verified
  OAuth sign-in to whichever row holds it — so parking an unverified address
  means the real owner's Google sign-in lands inside your vault. A typo
  therefore costs an email, not an account.
- **The last active admin cannot delete themselves** (409). `/admin` 404s for
  non-admins, so allowing it strands the deployment.
- **Caps are published; usage mostly cannot be measured.** See below.

**`/upgrade` shows the caps and refuses to invent the usage.** Free is 25 items,
1 GB, 10 share links; admins are exempt. Only the share-link count is
attributable to a person today — items and bytes need `vaultItems.ownerId` and
an R2 list call that `lib/r2.ts` does not have, both of which are phase 3. So
`usageFor()` returns `number | null` where null means *cannot be known*, and the
page renders "not measured yet" rather than `0 of 25`. Nothing is enforced yet
because there is no per-user write path to enforce against;
[MULTI-TENANT.md](./MULTI-TENANT.md) §5.1 carries the detail and the
fail-closed requirement for when it lands.

Requesting an upgrade writes a row and *then* mails the owner, in that order,
because `notifyUpgradeRequest` swallows its failures — with `RESEND_API_KEY`
unset the request is still recorded and `/admin` says in as many words that
nobody was emailed. An empty inbox is not evidence that nobody asked.

## In production

**Live at https://morgue.clupai.com since 2026-08-09.** The section this
replaces was called "Blocked on credentials" and said "nothing outside the
local dev path has ever run". Both are now wrong.

| | |
|---|---|
| Vercel project | `morgue`, `rootDirectory: web`, Node 24, deployed from the repo root |
| Domain | `morgue.clupai.com` — `clupai.com` is already on Vercel nameservers, so no DNS work was needed |
| Database | Neon, `ap-southeast-2`. Migrations applied with `pnpm db:migrate`; 8 tables |
| Storage | R2 `morgue-private`, 220 objects / 22.3 MB. `morgue-public` is still empty |
| Accounts | one: `clupaio4@gmail.com`, admin, no password yet |
| Env | 17 variables on Production |

**`rootDirectory: web` is not optional and the first deploy failed without it.**
Two separate things in the web build reach outside `web/`:
`app/vault/[slug]/page.tsx` imports `bin/export-bundle.mjs`, and
`lib/findings.ts` resolves `../docs/FINDINGS.md` at build time. Moving one file
would not have fixed the other. The whole tree is uploaded and Vercel builds
from `web/`.

Two variables differ deliberately from `web/.env.local`:

- **`MORGUE_DATA_SOURCE=r2`** — `items/` is gitignored, so Vercel deploys from a
  tree that has never contained the collection. `capture → build → publish:r2`
  is the only path by which anything reaches production.
- **`AUTH_URL=https://morgue.clupai.com`** — emailed reset links must not be
  built from the request's `Host` header, which is attacker-controlled. See
  `lib/site-url.ts`.

Two were deliberately **not** shipped: `OPENAI_API_KEY` and `R2_TOKEN`. Nothing
under `web/` reads either, and an unused credential on a third system is only
blast radius.

### What was verified against the live domain

Not assumed — checked with curl against `morgue.clupai.com`:

- `/`, `/privacy`, `/terms`, `/signin` serve 200; the sign-in page offers
  GitHub, Google and password.
- `/vault`, `/admin`, `/account` all redirect to `/signin` — the gate runs, so
  the environment is being read.
- A 60-second share link minted with the production `AUTH_SECRET` redeems,
  opens `/vault`, and renders **all 12 items out of R2**; the same cookie is
  refused `/admin` and `/account`; `/api/media/...` issues a signed URL.
- A malformed token is 403.

### Still to do before anyone else uses it

- **Register the production OAuth callbacks.** Neither button works until they
  exist: `https://morgue.clupai.com/api/auth/callback/github` and
  `.../callback/google`. This is the one remaining blocker on signing in.
- **The legal pages carry placeholders** — `[operator legal name]`,
  `[postal address]`, `[jurisdiction]`, and the copyright-agent address. Both
  pages say in a visible box that they need a lawyer. A DMCA contact that
  reaches nobody is worse than none.
- **Preview deployments have no environment variables**, so they return 503 and
  are gated by Vercel deployment protection. That is correct fail-closed
  behaviour, not a misconfiguration — but it means previews cannot be used to
  test anything behind the wall.
- **Rotate the secrets that were printed into a session transcript on
  2026-08-09**: `AUTH_SECRET`, `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_SECRET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN`, `RESEND_API_KEY`.
  Rotating `AUTH_SECRET` invalidates every share link and signs everyone out,
  which costs nothing while there is one account and no live links — so it is
  cheaper now than it will ever be again. `OPENAI_API_KEY` was already in this
  category and its rotation was deliberately deferred by the owner.

## Not verified

- **The video LRU has still never evicted anything, and it is now one item
  away.** Cap is 12; the index holds exactly 12. Eviction needs a *thirteenth*,
  so the next ingest is the first that will exercise code ported verbatim from
  `bin/grid.html` and deliberately never refactored. Watch it when it happens.
- **No real OAuth round trip has ever completed.** `verify:auth` proves the
  policy those round trips feed, against a real database, but nothing has
  actually bounced off github.com or accounts.google.com — the production
  callbacks are not registered yet. Until one does, "sign in with GitHub" is
  verified in every part except the part that talks to GitHub.
- **`api.morgue.clupai.com`** was planned as a second domain rewritten to
  `/api/*` and is not configured. Nothing needs it yet.
- **Extraction proper — still the biggest unknown, but a smaller one now.**
  *Ingesting* a commercial template is done and measured; *isolating* one
  section out of a large one so it runs standalone is not. `blunt-template` is
  `kind: unextracted` for exactly that reason: the whole site is stored and
  captured rather than reduced, 63 files under `src/`. The number that matters —
  hours to isolate one effect — has never been taken, and the archive model makes
  deferring cheap enough that nothing forces the question.
- **`kind: reference` has never been used.** The cheapest path in the contract
  is the only one never walked — and MULTI-TENANT.md §7 now depends on it, since
  reference-first is the chosen ingest for everyone who is not the owner.
- **Nothing has been tested with two accounts.** There is one row in `users`.
  The tenancy boundary is phase 3 and its gate is precisely this.

## Known gaps worth fixing before the collection grows

Ordered by how much they cost now, not how interesting they are.

- ~~**`build.mjs` never deletes from `site/`.**~~ **Closed 2026-08-08** in
  `b087a26`. `build.mjs` now prunes `site/item`, `site/media` and
  `site/data/items` to the index at the end of every run — today's build
  reported *"pruned 33 orphaned path(s) (5.1MB)"*, which is `pnpm test` having
  left its 11 fixture slugs behind, exactly as predicted.

  **The reasoning recorded with that fix was wrong, and the correctness edge it
  claimed to close was still open until 2026-08-09.** The comment said
  `publish.mjs` walks `site/`. It does not — it walks `out/` for media and
  `site/data` for the payload, so pruning `site/media` never had any bearing on
  what gets uploaded. `out/` is deliberately never pruned (`preview.mp4` is the
  archival record under rule 11, and `out/` is shared with fixture captures), so
  it accumulates every slug ever captured, retired ones included.

  Closed properly now: **`publish.mjs` filters every job through
  `site/items.json`**, in both modes, and refuses to run at all without it. A
  slug absent from the index is stale capture output and does not go up; the run
  names each one rather than skipping quietly.

  Still open, and not fixed here: **nothing deletes remote objects.** Neither
  the prune nor the index filter can recall what is already in the bucket.

  ~~**`pnpm test` still leaves fixtures in `site/`.**~~ **Closed 2026-08-09.**
  `SITE` now derives from `MORGUE_SRC`, so fixtures build into `site-fixtures/`
  and the two trees never meet.

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
  The showcase fixtures are real — though they are `license: "own"`, not MIT as
  this file claimed until 2026-08-09; all 11 fixtures are, checked. Still true
  that **everything in the vault proper is someone else's paid work** — the
  showcase is the only thing on the
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
