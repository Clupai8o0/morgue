# Multi-tenant morgue — implementation brief

Status: **phases 1 and 2 are built and verified. 3–7 are still design.**
Written 2026-08-09 to be picked up cold; phase status updated the same day.

> [!NOTE]
> **Decisions taken since this was written** (§13):
> 1. **Ingest: option C**, reference-first. Unchanged from the recommendation.
> 2. **Private by default.** No public profiles and no discovery surface.
>    Sharing is the existing expiring-link mechanism, extended so a user can
>    share components *they made themselves*. That keeps the redistribution
>    problem closed: nothing is visible to anyone without a link its owner
>    issued.
> 3. Consequently **the existing paid collection stays owner-only**, as §2
>    requires.
>
> Decisions 4 (free or paid) and 5 (GitHub OAuth previews) are still open and
> are not blocking phase 3.

Read [CLAUDE.md](../CLAUDE.md) first — the folder contract and rules 1–12 still
apply and this document does not supersede them. [STATUS.md](./STATUS.md) is
where the system stands today; [DECISIONS.md](./DECISIONS.md) is what was
decided and why, including the decision this brief reverses.

---

## 1. What is being asked for

Turn morgue from a single-owner private vault into a product: **many people,
each with an account and their own private vault of components, able to share
them easily.**

Concretely:

- Sign in with **Google**, **GitHub**, or **email + password**
- **Waitlist** gating who may create an account
- An **admin dashboard** to review the waitlist and manage users
- Each user's vault is private to them; sharing is opt-in and explicit

## 2. The decision this reverses, and the part of it that still binds

`DECISIONS.md` § "Waitlist, not signup" rejected exactly this:

> Multi-tenancy would have meant quotas, billing, ToS, a DMCA contact and
> moderation, and would have made hosting other people's possibly-infringing
> uploads a personal liability. Letting approved users browse *this* collection
> is worse still: redistributing paid components to non-licensees, which is
> precisely what the repo was structured to avoid.

You are choosing to take on the first half. That is a legitimate product call
and this brief assumes it. **The second half is not a choice and does not go
away:**

> [!IMPORTANT]
> **The 12 items currently in the vault are third-party paid CodeGrid
> templates.** Every one is `license: "paid"`, `source: "codegrid"`. Making
> them visible to any other account is redistributing commercial source to
> non-licensees. This is not a feature flag or a nice-to-have permission check.
> It is the single hard constraint on the whole design, and it is why §4
> puts the tenancy boundary in the *storage key*, not in a `WHERE` clause.

Two obligations that arrive with user uploads and did not exist before:

- **Terms and an acceptable-use policy.** Users will upload code they do not
  own. Some of it will be paid templates, exactly like yours.
- **A DMCA contact and a takedown path.** Once you host other people's uploads
  you need a way to receive and action a complaint. The admin dashboard is the
  natural home for it — see §9.

Neither is code, both are launch blockers, and neither is in scope for the
engineering phases below. They are listed so nobody discovers them at deploy.

## 3. What already exists, honestly

| Piece | State | Multi-tenant readiness |
|---|---|---|
| Auth.js + GitHub | built, never run with real credentials | allowlist in an env var; **no user table, no adapter, JWT sessions** |
| Waitlist table + API + admin review | built, validation paths only | rows exist; nothing converts one into an account |
| Share links (`lib/share.ts`) | built, **`verify:share` 24/24 in production mode** | scoped to `vault`/`item`; has no owner dimension |
| Admin page | waitlist review + share-link inventory | no user management |
| Vault data | static JSON built by `bin/build.mjs`, read from disk or R2 | **one global index, no owner column anywhere** |
| Media | R2 private bucket, one-hour signed URLs via `/api/media` | flat keys, no per-user namespace |
| Ingest | `items/<slug>/` on disk → `pnpm capture` → `pnpm build` → `pnpm publish:r2` | **CLI only, on one machine. There is no upload path at all.** |

`web/src/lib/r2.ts` exports `getObjectText` and `signMediaUrl` and nothing that
writes. The only writer is `bin/publish.mjs`, run by hand from this laptop.

## 4. The tenancy boundary

Put it in the **object key and the row**, never only in query logic.

```
r2://morgue-private/
  u/<userId>/data/facets.json          per-user index
  u/<userId>/data/items/<slug>.json    per-user records
  u/<userId>/media/<slug>/…            per-user media
```

Rules that follow, and they are not negotiable:

1. **`/api/media` derives `<userId>` from the session, never from the URL.**
   Today the route takes `params.path` and joins it to a root. Multi-tenant, the
   user segment must be *prepended server-side* from the session or the share
   token — never read from the request. Anything else is an IDOR one path
   traversal away from another tenant's paid source.
2. **Every query filters on `ownerId`, and it is a `NOT NULL` foreign key.**
3. **The owner's existing collection moves to `u/<ownerId>/`** like everyone
   else's. No special-cased global namespace — a global namespace is how the
   paid collection leaks.
4. `shareAllows()` (CLAUDE.md rule 12) gains an owner dimension: a share token
   already names a scope; it must now also name the vault it belongs to, and the
   check is `token.owner === resource.owner`, not just path prefix.

## 5. The data model

Auth.js needs a database adapter the moment you add Credentials or want account
linking across providers. That means the standard four tables plus ours.

```
users          id, email (unique, citext), emailVerified, name, image,
               passwordHash (nullable — OAuth-only users have none),
               role ('user' | 'admin'), status ('active' | 'suspended'),
               createdAt
accounts       Auth.js OAuth links (provider, providerAccountId, userId)
sessions       Auth.js — see §6 on why this appears
verificationTokens  Auth.js — email verification + password reset

vaultItems     id, ownerId → users.id, slug, title, meta (jsonb), notes,
               kind, license, source, sourceUrl, visibility,
               createdAt, updatedAt
               UNIQUE (ownerId, slug)     ← slug is unique PER USER, not globally
shareLinks     + ownerId → users.id      (existing table, one column added)
waitlist       + invitedAt, invitedBy, claimedByUserId   (existing table)
```

`vaultItems.meta` as `jsonb` rather than columns-per-field: the controlled
vocabulary lives in CLAUDE.md and `bin/survey.mjs` and will keep changing, and a
migration per vocabulary term is how it ossifies.

> [!WARNING]
> **This puts the vault in Postgres, reversing `db/schema.ts`'s stated design**
> ("The vault is NOT in Postgres… browsing never touches a database"). That was
> right for one user with a filesystem contract and static JSON. It is not
> workable for N users who cannot run `pnpm build`. Update the comment in
> `schema.ts` when this lands — leaving it there would make the file lie.
>
> The `items/` folder contract does **not** disappear. It stays as the owner's
> local ingest path and as the fixture pipeline. §7 is about what everyone else
> gets.

## 6. Auth — three providers

```
GitHub    OAuth. Already wired; drop AUTH_ALLOWED_LOGINS for a users row.
Google    OAuth. Same shape, new client credentials.
Credentials  email + password.
```

Things that will bite, in the order they will bite:

**Credentials forces decisions the other two do not.** You become custodian of
passwords. Required, not optional: a slow hash (`argon2id`, or `bcrypt` cost ≥
12), email verification before first sign-in, a reset flow with single-use
expiring tokens, and rate limiting on both sign-in and reset. `IP_HASH_SALT`
already exists for the waitlist limiter and the same primitive applies.

> **As built:** `scrypt` from Node core, at OWASP's N=2^16 / r=8 / p=2, not
> argon2id. Every argon2 binding for Node is a native module, and on Vercel
> that means prebuilt binaries for the right libc, a `serverExternalPackages`
> entry, and a dependency that can break the build on a Node upgrade. scrypt is
> OWASP's named fallback, needs nothing installed, and the stored form is
> `scrypt$N$r$p$salt$hash` — parameters in the record, so cost can be raised
> without invalidating existing passwords and an `argon2id$` branch can be
> added later with both coexisting. The first configuration OWASP lists
> (N=2^17, p=1) was rejected on memory: 128 MiB per concurrent hash, on the one
> endpoint where an attacker picks the concurrency.
>
> Everything else in this paragraph shipped as written. See `lib/password.ts`,
> `lib/auth-tokens.ts` and `lib/auth-limit.ts`.

**Auth.js v5 + Credentials + adapter is a known sharp edge.** The Credentials
provider does not persist a session through a database adapter — it is
JWT-only. Mixing it with OAuth providers on a database session strategy is the
single most common way this goes wrong. Decide the strategy up front:

- *JWT sessions everywhere* — keeps Credentials simple, keeps Postgres off the
  read path, but revoking a session means rotating a secret or adding a version
  column checked in the `jwt` callback.
- *Database sessions for OAuth, JWT for Credentials* — do not. Two session
  strategies in one app is a bug generator.

Recommendation: **JWT sessions with a `sessionVersion` integer on `users`**,
bumped on password change or admin suspension and compared in the `jwt`
callback. It preserves the current architecture, gives real revocation, and
costs one integer.

**Account linking.** The same human will sign up with Google and later click
GitHub. Auth.js will not link automatically unless you allow it, and
auto-linking on unverified email is an account-takeover vector. Policy: link
only when the incoming provider reports `email_verified` **and** an existing
user owns that email; otherwise show "this email already has an account, sign in
with X". Write this down in `auth.ts` — it is the kind of thing that gets
"simplified" later.

**`AUTH_ALLOWED_LOGINS` goes away.** It is currently the entire authorisation
model (CLAUDE.md rule 9: empty denies everyone). Its replacement is
`users.status` plus the waitlist gate in §8. Rule 9's *principle* — a missing
variable in production locks the door — must survive the change: if the database
is unreachable, sign-in fails closed.

## 7. The ingest problem — the actual hard part

**There is no upload path. This is the largest single piece of work and it is
not auth.**

Today a component becomes an item by: writing `items/<slug>/` on disk, running
`pnpm capture` (Playwright renders it frame by frame against a faked clock,
ffmpeg encodes), `pnpm build`, `pnpm check`. That is a local CLI with a real
browser and a real encoder. A second user has none of it.

Three options, and this needs your decision before Phase 3:

| Option | What the user does | Cost |
|---|---|---|
| **A. Upload-and-capture** | Drops a zip/folder; the server runs the real pipeline | Playwright + ffmpeg server-side. Vercel Functions now allow 5 GB packages and 300 s, so it fits — but running arbitrary uploaded HTML/JS in your renderer is **remote code execution as a feature** and needs a sandbox (Vercel Sandbox, or a separate worker). Highest fidelity, highest risk, most work. |
| **B. Upload-the-artifacts** | Uploads their own `preview.mp4` + poster + notes | No browser, no encoder, no sandbox. Loses the whole determinism story — the thing that makes this collection unusual. Ship in days. |
| **C. Reference-first** | URL + notes + a poster we screenshot | `kind: "reference"` already exists in the contract and *has never been used*. Cheapest real path, no arbitrary code execution, and the contract says reference items are "often the most useful". |

**Recommendation: C for launch, A behind a flag later, never B alone.** C uses a
kind the contract already defines, needs no sandbox, and gets multi-user working
end to end. A is the differentiated product and should be built once the tenancy
boundary has been load-bearing for a while.

Whichever is chosen, **quotas arrive with it**: items per user, bytes per user,
captures per day. `DECISIONS.md` named quotas as a cost of multi-tenancy and it
was right.

## 8. Waitlist → invite → account

The table exists and holds `pending | approved | declined`. What is missing is
the bridge from an approved row to a real account.

```
1. Public /waitlist form            → waitlist row, status pending      (exists)
2. Admin approves in /admin         → status approved                   (exists)
3. Admin sends an invite            → single-use token, emailed         (NEW)
4. Recipient opens /invite/<token>  → chooses a provider or sets a
                                       password → users row created,
                                       waitlist.claimedByUserId set     (NEW)
```

The invite token should reuse `lib/share.ts`'s primitive — HMAC over
`AUTH_SECRET`, expiry in the payload, `jti` recorded for revocation. It is
already written, already tested, and a second token implementation is a second
thing to get wrong. Sign it with a *different* derivation label
(`morgue.invite.v1`) so an invite can never be replayed as a share.

**Sign-up must be invite-only at the auth layer, not just the UI.** The
`signIn` callback checks for a claimed invite or an existing active user and
returns false otherwise. A Google button that anyone can click is a public
sign-up form no matter what the landing page says.

## 9. Admin dashboard

Extends `/admin`, which already has waitlist review and the share-link
inventory. Add:

- **Users**: list, search, role, status, last seen; suspend (sets
  `status` and bumps `sessionVersion`, killing live sessions).
- **Invites**: outstanding, claimed, expired; revoke.
- **Storage per user**: item count and bytes, against quota.
- **Takedown**: given a report, find the item, disable it, notify the owner.
  This is the DMCA path from §2 and it is why the dashboard is a launch
  requirement rather than a convenience.

Authorisation is `users.role === 'admin'`, checked in `proxy.ts` *and* in the
route — the share-link work already established that pattern (rule 12: `/admin`
is refused before the allowlist is even consulted) and it should not be
weakened.

## 10. Migrating the existing collection

1. Create the owner's `users` row; `role: 'admin'`.
2. Backfill `vaultItems` from `site/data/items/*.json` with `ownerId` = owner.
3. Re-key R2 from `media/<slug>/…` to `u/<ownerId>/media/<slug>/…`.
4. Teach `bin/publish.mjs` the user prefix. It currently walks `site/` and
   uploads flat.
5. **Verify with a second, non-admin account that the owner's 12 paid items are
   invisible** — index, media, search, and share redemption. This is the §2
   constraint and it needs a test, not a click-through.

## 11. Invariants that must not regress

These are already paid for. Breaking one re-introduces a bug that has a name.

- **Rule 9** — fail closed in production, open in development.
- **Rule 12** — share access is an allowlist; `/admin` and `/api/share` refused
  before it is consulted. Now also owner-scoped (§4).
- **Rule 6** — it is `src/proxy.ts`; `pnpm web:build` must list
  `ƒ Proxy (Middleware)`.
- **Rule 8** — the grid animates transform/opacity only; the video LRU is
  ported verbatim. The cap is 12 and the index will finally exceed it, so
  **eviction runs for the first time** — it has never been exercised.
- **Rules 1–5, 11** — the capture pipeline and image handling are unchanged by
  this work if option C is taken.
- `pnpm verify:share` must stay green, and gains owner-isolation cases.

## 12. Phases

Each ends at a verification gate. Do not start the next until the gate is green.

| # | Phase | Gate |
|---|---|---|
| 1 ✅ | Users/accounts/sessions schema + adapter; `AUTH_ALLOWED_LOGINS` deleted; `pnpm user` CLI creates the first account | `pnpm verify:web` 10/10, `pnpm verify:share` 24/24, `pnpm web:build` lists `ƒ Proxy (Middleware)` |
| 2 ✅ | Google provider + Credentials, verification, reset, rate limiting; account-linking policy in `lib/link-policy.ts` | **`pnpm verify:auth` 66/66** against a throwaway `initdb` cluster and a production `next start` |
| 3 | Tenancy boundary: `ownerId` everywhere, R2 re-key, `/api/media` derives user from session | **second-account isolation test** — the §2 constraint, automated |
| 4 | Ingest for option C (+ quotas) | a second account creates a `reference` item end to end |
| 5 | Invites: token, `/invite/<token>`, invite-only `signIn` callback | invite is single-use, expires, and cannot be replayed as a share token |
| 6 | Admin dashboard: users, invites, storage, takedown | suspend kills a live session within one request |
| 7 | ToS, AUP, DMCA contact, privacy note | — |

## 13. Decisions needed from you before Phase 3

1. ~~**Ingest: A, B or C?**~~ **Decided: C**, reference-first (§7).
2. ~~**Does anyone ever see anyone else's vault?**~~ **Decided: no.** Private
   by default; no profiles, no discovery. Sharing stays the expiring-link
   mechanism, extended so a user can share components they made themselves.
3. ~~**Is the existing paid collection owner-only forever?**~~ **Decided:
   yes**, which follows from 2.
4. **Free, or paid?** Quotas and billing are the difference between a hobby
   deployment and a service with a support burden. **Still open.** Not
   blocking phase 3, but quotas arrive with phase 4 and want an answer by then.
5. **GitHub OAuth previews.** An OAuth App has one callback URL and Vercel
   previews get a fresh URL each deploy, so previews cannot sign in without
   `AUTH_REDIRECT_PROXY_URL`. Worth settling while touching auth anyway.
