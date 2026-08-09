# Handoff — 2026-08-09

Written to resume later. Supersedes the 2026-08-08 handoff entirely.

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

Branch **`multi-tenant-identity`**, 4 commits ahead of `main`. Working tree
clean. **Nothing is pushed** — `main` itself is 6 commits ahead of `origin/main`
and has been since before this session.

| | |
|---|---|
| items | 12 · `items/` 10 MB · all `license: paid`, all CodeGrid |
| archives | 4 · `archives/` **274 MB** — `backrooms` alone is 170 |
| fixtures | 11 · every one `license: "own"` |
| `out/` 40 MB · `site/` 212 MB | both regenerable |
| production | Neon (8 tables), R2 (220 objects / 22.3 MB), 1 account |

## Verified green on this machine, 2026-08-09

```
pnpm test          11/11 fixtures
pnpm build         12 items → site/  (pruned 33 orphaned paths, 5.1MB)
pnpm check         all 12 item pages run, 33 internal links followed
pnpm web:build     compiles, lists ƒ Proxy (Middleware)
pnpm verify:web    10/10   ← now brings its own Postgres and server
pnpm verify:share  26/26
pnpm verify:auth   84/84   ← new this session
```

Plus, against the **live domain**: the gate holds on `/vault`, `/admin` and
`/account`; a share link redeems and renders all 12 items out of R2; the same
cookie is refused `/admin`; `/api/media` issues a signed URL.

`pnpm --filter web lint` reports **3 pre-existing errors** in
`share-admin.tsx` and `vault-grid.tsx` (React-compiler rules, last touched in
`96fb604`). Untouched this session and left alone deliberately.

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

## Next moves, in the order I would do them

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
