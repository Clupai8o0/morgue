# Handoff — 2026-08-09

Written to resume later. Supersedes the 2026-08-08 handoff entirely.

> [!NOTE]
> **Amended later the same day, on a second machine (Fedora).** `main` was
> fast-forwarded to `multi-tenant-identity`, self-service account management and
> the free-tier caps were built, and three gates that could not fail were fixed.
> See [What changed in the second session](#what-changed-in-the-second-session).

Read [CLAUDE.md](../CLAUDE.md) first — it is the folder contract and it is
authoritative. This file is a snapshot; that one is the rules.

> [!IMPORTANT]
> **morgue is live at https://morgue.clupai.com.** Phases 1 and 2 of the
> multi-tenant pivot are built, verified and deployed. **Phase 3 — the tenancy
> boundary — is next, and it is the one with a licensing obligation behind it
> rather than a preference.** The brief is
> [MULTI-TENANT.md](./MULTI-TENANT.md); read §2 and §13a before touching
> `auth.ts`, `proxy.ts`, `db/schema.ts`, `lib/vault-data.ts` or `api/media`.
>
> A second, opposite brief exists: [LOCAL-MODE.md](./LOCAL-MODE.md), on
> open-sourcing morgue so a designer can run it locally with no accounts and no
> cloud services. Design only, nothing built, written to be handed to another
> agent.

[STATUS.md](./STATUS.md) was reconciled against the tree on this date and every
number in it was re-measured rather than carried forward.

---

## State in one screen

Branch **`main`**, which was fast-forwarded to `multi-tenant-identity` on the
Fedora machine — that merge is **local and unpushed**; `origin/main` is still at
`0bad44f`. See [Moving to another device](#moving-to-another-device) for what git
does *not* carry.

| | |
|---|---|
| items | 12 · `items/` 10 MB · all `license: paid`, all CodeGrid |
| archives | 4 · `archives/` **274 MB** — `backrooms` alone is 170 |
| fixtures | 11 · every one `license: "mit"` under the root `LICENSE` |
| `out/` 40 MB · `site/` 212 MB | both regenerable |
| production | Neon (8 tables), R2 (220 objects / 22.3 MB), 1 account |

## Verified green on this machine, 2026-08-09

```
pnpm test          11/11 fixtures
pnpm build         12 items → site/  (pruned 33 orphaned paths, 5.1MB)
pnpm check         all 12 item pages run, 33 internal links followed
pnpm web:build     compiles, lists ƒ Proxy (Middleware)
pnpm verify:web    10/10   ← now brings its own Postgres and server
pnpm verify:share  26/26   ← now 33 assertions; see the second session
pnpm verify:auth   84/84   ← now 128 assertions; see the second session
```

Plus, against the **live domain**: the gate holds on `/vault`, `/admin` and
`/account`; a share link redeems and renders all 12 items out of R2; the same
cookie is refused `/admin`; `/api/media` issues a signed URL.

`pnpm --filter web lint` reports **3 pre-existing errors** in
`share-admin.tsx` and `vault-grid.tsx` (React-compiler rules, last touched in
`96fb604`). Untouched this session and left alone deliberately.

---

## Moving to another device

Git carries the tool. It carries **none of the morgue** — `items/`, `archives/`,
`out/` and `site/` are gitignored on purpose (see the header of `.gitignore`),
and secrets are gitignored too. A fresh clone is a working repo with an empty
collection. Plan for three separate transfers, not one.

### 1. The code — done

```bash
git clone https://github.com/Clupai8o0/morgue.git
cd morgue && pnpm install
```

`docs/` is tracked, so this file, STATUS, FINDINGS, DECISIONS, MULTI-TENANT and
LOCAL-MODE all arrive with the clone. Nothing about them is local-only.

### 2. The environment — via Vercel, with four exceptions

`.vercel/` is gitignored, so the clone is not linked to the project. Link it,
then pull:

```bash
vercel link          # clupai8o0s-projects / morgue
vercel env pull --environment=production web/.env.local
```

**`--environment=production` is not optional.** Every one of the 17 variables on
the project is scoped Production-only, and a bare `vercel env pull` defaults to
Development — it succeeds and writes a file with nothing useful in it, which
reads as "the pull worked" right up until the app 503s.

> [!WARNING]
> **This no longer gets you working secrets, and it fails in the same shape.**
> Attempted on the Fedora machine with Vercel CLI 58.9.0: the pull succeeds,
> writes all 38 names, and every value that matters — `DATABASE_URL`,
> `AUTH_SECRET`, `IP_HASH_SALT`, both R2 keys, both OAuth secrets,
> `RESEND_API_KEY`, even `AUTH_URL` and `MORGUE_DATA_SOURCE` — comes back as the
> literal string `[SENSITIVE]`. Every variable on the project is marked
> sensitive, and Vercel treats sensitive values as write-only: they cannot be
> read back by the CLI, by design.
>
> **Delete the file if this happens to you.** `DATABASE_URL=[SENSITIVE]` is
> non-empty, so it reads as *configured* and produces a 500 from an unresolvable
> host instead of an honest 503 — the trap STATUS.md already records as "a
> placeholder DATABASE_URL is worse than an empty one", arrived at from a new
> direction.
>
> So a second machine cannot get the environment from Vercel. Copy
> `web/.env.local` across by hand under the rules in the warning below, or read
> the values out of the Neon and Cloudflare dashboards. **In particular
> `pnpm db:migrate` cannot be run from a machine that has not done this** — and
> a deploy that lands before its migration takes the site down, because
> `select()` on `users` names every column in `schema.ts`.

Then fix what the pull gets wrong for local work. Production values are correct
for production and wrong for a dev machine:

| Variable | Production | What a dev machine wants |
|---|---|---|
| `AUTH_URL` | `https://morgue.clupai.com` | `http://localhost:3210` — OAuth callbacks and emailed reset links are built from this |
| `MORGUE_DATA_SOURCE` | `r2` | `local`, to read the sibling `site/` off disk instead of the bucket — note that is the *built* site, not `items/`, so it needs a `pnpm build` first (`vault-data.ts:20`) |
| `DATABASE_URL` | Neon, `ep-billowing-night-a7cr14g9-pooler` | the same Neon branch unless you make another — **a pulled prod env points `pnpm web:dev` at the live database and live buckets** |

And two variables exist only on this machine, deliberately — STATUS.md
§ "In production" records why: nothing under `web/` reads either, and an unused
credential on a third system is only blast radius.

- **`OPENAI_API_KEY`** — used by `bin/icon.py` alone (`pnpm icon --generate`).
- **`R2_TOKEN`** — not read by any code in the tree.

Neither is in Vercel, so neither arrives with the pull. Copy them by hand if you
want them, or leave them out; the app runs without both.

> [!WARNING]
> If you copy `web/.env.local` directly instead of pulling — over AirDrop, 1Password,
> `age`, anything encrypted — that is fine, but it must not travel through a chat,
> an email or a paste bin. `AUTH_SECRET` is in that file, and share links are
> signed with a key derived from it: whoever holds it can mint a link to the
> vault without an account. It is already on the rotate list at the end of
> STATUS.md for exactly this reason.

### 3. The collection — by hand, or not at all

274 MB of `archives/` and 10 MB of `items/`, none of it in git and none of it
reproducible by a build:

- **Copy `items/` and `archives/`** across directly (rsync, external disk).
  `out/` and `site/` need not travel — `pnpm capture` then `pnpm build`
  regenerate both, though a full re-capture of 12 items is not quick. Copying
  `out/` too saves the capture and leaves only `pnpm build` to run.
- **Or skip them.** With `MORGUE_DATA_SOURCE=r2` the web app reads the 220
  published objects out of the bucket and the vault works completely without a
  local collection. What you lose is the ingest side: `pnpm capture`,
  `pnpm build`, `pnpm check` and `pnpm export` all need `items/` on disk.

Note the coupling between the two bullets: **`MORGUE_DATA_SOURCE=local` reads
`site/`, which only exists after a `pnpm build`, which needs `items/`.** Copy
nothing and set `local`, and the vault renders empty rather than erroring —
which looks like a broken app instead of an absent collection. Either bring the
collection or stay on `r2`; there is no useful middle setting.

`pnpm test` runs against `fixtures/`, which **is** tracked, so the fixture suite
is green on a fresh clone with no collection at all.

### 4. What the machine itself needs

Beyond `pnpm install`: **Node 24** (24.15.0 here), **pnpm 11** (11.13.1),
**ffmpeg** on `PATH` for `pnpm capture`, and **Postgres client binaries** —
`initdb` and `pg_ctl` — for `pnpm verify:auth`, which builds a throwaway cluster
rather than mocking one (`brew install postgresql@16`). Playwright browsers come
down with `pnpm install`. Without ffmpeg, capture fails at the encode step after
doing all the work; without `initdb`, `verify:auth` says so by name and exits.

### 5. First thing to run on the new machine

```bash
pnpm test          # 11/11 fixtures, needs no collection and no secrets
pnpm web:build     # must list ƒ Proxy (Middleware) — rule 6
pnpm verify:auth   # 84/84, brings its own Postgres
```

If `pnpm web:build` fails inside `lib/findings.ts`, nothing is wrong with the
machine — see the FINDINGS section below.

---

## What changed this session

### 1. Identity moved into Postgres — `AUTH_ALLOWED_LOGINS` is gone

Accounts are rows in `users`. The first is made with **`pnpm user add <email>
--admin`**. Rule 9 survives structurally: no database means no accounts means
no sign-in, which is harder to get wrong than remembering to leave a string
blank.

Three providers: GitHub, Google, email+password. Only the configured ones are
registered, so the sign-in page never shows a button that cannot work.

Sessions stay JWT. Database sessions would put a query on every request, and
`@auth/core`'s credentials branch never calls `createSession`, so a database
strategy silently issues no session at all. Revocation is `users.sessionVersion`
compared in the `jwt` callback on a throttle — `AUTH_SESSION_RECHECK_SECONDS`,
default 60. **That number is the revocation lag and it is deliberate.**

### 2. One human, three sign-in methods, one account

Same-email linking already worked. What did not was connecting a provider under
a *different* address. `@auth/core` links to the session user when there is one;
our `signIn` callback was refusing first, so the link never happened. It now
reads the current session.

Linking while signed in deliberately does **not** require a provider-verified
email — the direction is reversed from the takeover case, so a mistake only
hurts the person making it. A provider already linked elsewhere is refused.

New `/account`: connected providers, connect, disconnect, set/change password.
**Disconnecting refuses to remove the last way in.**

### 3. `pnpm verify:auth` — and it caught a real bug immediately

Boots a throwaway `initdb` cluster and a production `next start` against it.
On its first run it caught `eq(email) && isNull(verified)` in the verify route:
JavaScript's `&&` on two drizzle conditions evaluates to the second one, so
"verify this address" meant **"verify every unverified address in the table"**.

The test that catches it seeds a *bystander* row. With one row a whole-table
update and a correct one look identical — which is why the first version of the
test passed.

### 4. Deployed

See STATUS.md § "In production" for the full configuration. The one thing worth
repeating here: **`rootDirectory: web` is not optional.** Two separate things in
the web build reach outside `web/` — `app/vault/[slug]/page.tsx` imports
`bin/export-bundle.mjs`, and `lib/findings.ts` resolves `../docs/FINDINGS.md` at
build time. The first deploy failed on the first of those, and moving that one
file would not have fixed the second.

### 5. Privacy and terms

Written from what the code does, with the claims traceable to the files that
implement them. Both carry a visible box saying they need a lawyer and the
operator's details.

---

## THE THING TO KNOW BEFORE EDITING FINDINGS

`web/src/lib/findings.ts` parses `docs/FINDINGS.md` at build time and **every
extractor throws if its number moved.** A renamed table or rewritten sentence
fails `pnpm web:build` by name rather than rendering a stale constant — the same
fail-closed reasoning as rule 9. It is also, now, one of the two reasons the
Vercel project must be rooted at the repo rather than at `web/`.

Load-bearing: the `## Encoder selection` and `## Browser ceilings` tables, and
the `## Determinism` and `## Per-item cost` sections.

---

## What changed in the second session

Same day, different machine — a fresh Fedora clone with **no collection on
disk**, which is the ordinary state of a second device (see *Moving to another
device*). Everything below was therefore verified against `fixtures/` and a
containerised Postgres rather than the real vault.

**`main` was fast-forwarded to `multi-tenant-identity`, locally.** `origin/main`
is still at `0bad44f` — **the merge and everything since is unpushed.**

**Three gates that could not fail.**

1. `bin/check.mjs` counted broken pages and exited 0 regardless, so `pnpm check`
   and therefore `pnpm test` could not go red. Now sets `process.exitCode`.
   Proven both ways on this machine: 2 deliberately broken fixture pages → exit
   1; after `pnpm fixtures:build`, 11/11 → exit 0.
2. `pnpm publish:r2 --public` switched bucket and changed nothing else — one
   flag from publishing paid source, including `site/data/items/*.json`, which
   inline it. Now an `own`/`mit` + showcase allowlist, media only, failing closed.
3. `pnpm test` **deleted the real collection from `site/`**. `SITE` was fixed
   while `MORGUE_SRC` was not, so `fixtures:site` ran the prune with the 11
   fixture slugs as `keep`. Fixtures now build into `site-fixtures/`.

**`publish.mjs` now filters every job through `site/items.json`.** The comment
justifying the 2026-08-08 prune claimed `publish.mjs` walks `site/`; it walks
`out/` and `site/data`, so the retired-paid-media hazard was never actually
closed. `out/` is deliberately not pruned — `preview.mp4` is the archival record
and `out/` is shared with fixture captures.

**The MIT claim on the landing page was made true**, narrowly: root `LICENSE`
covering `fixtures/` only, explicitly not `items/`, `archives/`, `bin/` or
`web/`.

**Self-service account management and free-tier caps.** Migration `0003`
(`users.plan`, `upgrade_requests`); `/account` gains rename, address change,
sign out everywhere, export and delete; `/upgrade` publishes the caps and
records requests. `pnpm user rm` was rewired onto the same delete ordering —
it was a bare `delete from users`, which left share links live.

**`verify:auth` 84 → 128, and it can now run without Postgres installed.** Both
it and `bin/lib/test-stack.mjs` honour `MORGUE_TEST_DATABASE_URL`, so a throwaway
container works:

```
podman run -d --rm --name morgue-verify-pg \
  -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=morgue_verify \
  -p 55432:5432 docker.io/library/postgres:16-alpine
MORGUE_TEST_DATABASE_URL='postgres://postgres:verify@127.0.0.1:55432/morgue_verify' \
  pnpm verify:auth
```

**What was NOT verified here, and why.** `pnpm verify:share` asserts against real
slugs (`blunt-template`, `gooey-text-reveal`) that this clone does not have, so
its 7 new refusal assertions are **written but unrun**. `pnpm capture` cannot run
at all: Fedora's `ffmpeg-free` has no libx264 and `bin/capture.mjs` hardcodes
`-c:v libx264`; `--use-angle=metal` is an Apple backend besides. Run both on the
Mac.

## Next moves, in the order I would do them

0. **Push, and run `pnpm verify:share` on the Mac.** `main` is ahead of
   `origin/main` by everything above, and 7 new share-refusal assertions have
   never executed. Both are one command each on a machine with the collection.
1. **Register the production OAuth callbacks.**
   `https://morgue.clupai.com/api/auth/callback/github` and `.../google`. Until
   these exist neither button works, and no real OAuth round trip has ever
   completed — `verify:auth` proves the policy those round trips feed, but
   nothing has actually bounced off github.com.
2. **Rotate the secrets listed at the end of STATUS.md § "In production".**
   Several were printed into a session transcript on 2026-08-09. Rotating
   `AUTH_SECRET` costs nothing while there is one account and no live share
   links, and will never be cheaper.
3. **Phase 3: the tenancy boundary.** Decisions A, B and C are settled and
   recorded in MULTI-TENANT.md §13a. Note §10: R2 was empty until this session
   and the database had no tables, so there is **no live keyspace to migrate** —
   steps 3 and 4 are just how the publish path gets written.
4. **Fill the legal placeholders** — `[operator legal name]`,
   `[postal address]`, `[jurisdiction]`, copyright agent. A DMCA contact that
   reaches nobody is worse than none.
5. **`archives/` is 274 MB and `backrooms` is 170 of it.** Untouched. The
   archive model's storage argument is now carried almost entirely by this one
   directory being unoptimised.
6. **Re-capture the four items affected by the WAAPI seek fix** —
   `blunt-page-transitions`, `blunt-smudge-reveal`, `clip-mask-transition`,
   `backrooms`. Their current previews record transitions as jump cuts. Still
   open from the previous session.

---

## Traps paid for this session

- **A test can pass because a secret is absent.** `verify:web` ran against
  `pnpm web:dev` and only worked because `.env.local` had no auth credentials:
  the proxy failed open and `/vault` rendered for anyone. The day those
  variables were filled in it landed on `/signin` and reported an empty grid.
  If a harness goes *red* as configuration gets *more* complete, suspect the
  harness before the code.

- **`&&` is not `and()`.** Drizzle conditions are objects, so `a && b` is `b`.
  The compiler is happy, the query is silently wrong, and a single-row table
  cannot tell you.

- **`ERR_PNPM_IGNORED_BUILDS` fires from the repo root too.** CLAUDE.md rule 7
  said running web scripts inside `web/` fails this way. It also fails from the
  root, because `pnpm --filter web <script>` runs with `cwd=web` and pnpm's
  verify-deps check then reads `allowBuilds` from `web/pnpm-workspace.yaml` —
  where `esbuild` had been left as the literal placeholder string. Fixed there.

- **A shell's working directory persists between commands.** A `cd web` in one
  step left every later relative path resolving inside `web/`, which reads as
  "the file is missing" rather than "you are in the wrong place".

- **Masking secrets in a preview is easy to get wrong.** A `sed` that only
  matched single-quoted values printed seven credentials in plaintext. If output
  might contain secrets, suppress it rather than filtering it.

- **`pnpm test` still rebuilds `site/` from `fixtures/` and does not clean up.**
  Always `pnpm build` after. Unchanged, and it bit again this session.
