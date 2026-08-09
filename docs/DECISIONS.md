# Decisions

Why the architecture is what it is. Records the reasoning, not just the result —
several of these look arbitrary without it, and the version that looks arbitrary
is the one that gets "simplified" back into a bug six months later.

Measurements live in [FINDINGS.md](./FINDINGS.md). Current state lives in
[STATUS.md](./STATUS.md).

---

## The collection is never in the deploy

`items/` is gitignored, so Vercel builds from a tree that has never contained
the collection and **cannot** generate the vault data at build time. Production
reads everything from R2 instead; `capture → build → publish` is the only path
by which anything reaches production.

This was discovered rather than designed — it fell out of the licensing
constraint while extending `build.mjs`. It turns out to be the stronger
property: **a deploy has nothing to leak, because it never holds the
collection.** It also makes `bin/publish.mjs` load-bearing infrastructure
rather than a convenience.

## Two R2 buckets, not one with rules

`morgue-public` (showcase media) and `morgue-private` (the collection, no
public access at all).

Gating the app is worthless if the underlying mp4 is fetchable by anyone
holding a CDN link — and CDN links leak into logs, analytics and browser
history. Making public-versus-private a property of **which bucket a file lives
in** means a routing mistake cannot expose the collection. One bucket plus
access rules puts that guarantee in code, where it can be misconfigured.

## Signed URLs, minted per page

The private bucket serves nothing publicly, so every media read is a one-hour
signed URL. Signing 500 to open the vault would be absurd; the grid loads 24 at
a time, so it signs 24.

Pagination and the security model independently wanted the same thing. That is
usually a sign the boundary is in the right place.

## Pagination is a rendering concern, not a fetching one

`facets.json` is ~200 bytes an item — about 25KB gzipped at 500 items — so the
whole corpus arrives in **one** request and filtering is instant with no
waterfall. What gets paged is how many cards exist in the DOM and how many
videos are allowed to decode.

Three budgets blow independently, so there are three separate mechanisms:

| Budget | Mechanism |
|---|---|
| Payload | one small `facets.json` fetch |
| Video players | LRU in `lib/player-pool.ts`, hard cap 12 |
| DOM nodes | `visible` count growing a page at a time |

Media URLs are deliberately **absent** from `facets.json`: they derive from the
slug, and in production each is a short-lived signed URL, so baking them in
would be both redundant and wrong.

## `api.morgue.clupai.com` is a second domain on the same Vercel project

Not a separate service. It is rewritten to `/api/*` on the same deployment.

The web app calls relative `/api` — same origin, zero CORS. The subdomain
exists for the **CLI**, which is the only external client. One codebase, one
deploy, shared Zod schemas between `bin/` and the API, and clean public URLs.

A separate Cloudflare Worker API was the alternative and was rejected: it
splits the codebase, adds CORS, needs its own auth, and **can never run
Playwright or ffmpeg** — which forecloses server-side capture permanently.
Vercel Functions can (5GB packages), so this keeps that door open.

## Postgres holds identity, and not the vault

Browsing never touches a database.

> **Amended 2026-08-09.** This section used to be titled "Postgres holds two
> tables" and named them: `waitlist` and `cli_tokens`. There are **eight** —
> the multi-tenant pivot added `users`, `accounts`, `sessions`,
> `verificationTokens` and `authAttempts`, and share links added
> `share_links` before that. The principle survived the count, so only the
> count was wrong, which is exactly the kind of stale number that reads as
> current. The live split is documented at the top of `web/src/db/schema.ts`,
> which is the copy to trust: identity is transactional state and lives here;
> the owner's collection still comes from `items/` through the capture
> pipeline. Phase 3 of [MULTI-TENANT.md](./MULTI-TENANT.md) will put *other
> people's* items in Postgres — the owner's stay on the filesystem contract.

Items build from `items/` on disk into static JSON. Putting the collection in
Postgres would create a second source of truth that drifts from the folder
contract, and would defeat the point of the capture pipeline being a filesystem
API.

Neon over the **HTTP** driver rather than a TCP pool: serverless scales to many
short-lived instances, and a pool per instance exhausts connections. The
trade-off is no interactive transactions, which is fine when every write is a
single statement.

## Waitlist, not signup

Nobody but the owner ever gets an account, storage, or write access. That is
the entire security model — there is no privilege to escalate to.

This was a genuine fork. Multi-tenancy would have meant quotas, billing, ToS, a
DMCA contact and moderation, and would have made hosting other people's
possibly-infringing uploads a personal liability. Letting approved users browse
*this* collection is worse still: redistributing paid components to
non-licensees, which is precisely what the repo was structured to avoid.

> [!IMPORTANT]
> **Reversed on 2026-08-09** — deliberately, and only the first half. morgue is
> becoming multi-tenant: many accounts, each with a private vault. See
> [MULTI-TENANT.md](./MULTI-TENANT.md). The quotas/ToS/DMCA burden named above
> is accepted as the price.
>
> The second half is **not** reversed and cannot be. This collection stays
> owner-only; vaults are private by default with no discovery surface, and the
> tenancy boundary lives in the storage key and a `NOT NULL` owner column
> rather than in query logic. The paragraph above is why.

## Free with hard caps, and the waitlist stays

Decided 2026-08-09, settling decision 4 of [MULTI-TENANT.md](./MULTI-TENANT.md).

No billing. Every account is free and bounded by a **hard cap** on item count
and stored bytes, and the **waitlist remains the gate** on who gets an account
at all. Both, not either.

The reasoning is that the two mechanisms answer different questions and the
failure modes they prevent are different. The waitlist controls *who* — it is
the thing standing between this deployment and arbitrary strangers uploading
arbitrary code, which is the liability the reversed decision above accepted in
principle and would rather meet slowly. The cap controls *how much* — R2 is
billed by what is stored and served, so without a ceiling the bill is a
function of other people's behaviour, and an invited user is not thereby a
trustworthy one.

Billing was rejected rather than deferred-by-accident: taking money means
invoicing, refunds, tax, and a support obligation that arrives immediately and
does not pause. None of that is the point of this project. A cap plus a
**"request upgrade"** button that emails the owner buys the same outcome for
users who genuinely need more, and the answer is a human being rather than a
payment page. If that mail volume ever becomes annoying, that is evidence for
billing — and it is evidence obtained without having built it first.

The cost, stated: raising a cap is manual, so it is slow, and it does not scale
past the point where the owner reads the mail. That is a deliberate ceiling on
growth and not an oversight.

## The fixtures are MIT, and the grant is scoped on purpose

Decided 2026-08-09. `LICENSE` at the repo root.

The landing page has always told visitors the showcase pieces are "authored
from scratch and MIT-licensed, so they can be shown". That was not true: all
eleven fixtures carried `"license": "own"` and no `LICENSE` file existed
anywhere in the repository. The claim was public, live, and unsupported — a
licence grant asserted to strangers with nothing behind it.

Two ways to close a gap like that: retract the claim, or make it true. Made it
true, because it costs nothing real — `fixtures/` is the only code here written
from scratch for this repository, it exists to be shown, and its whole purpose
on that page is to be the thing that *can* be shown.

The scope section in `LICENSE` is the load-bearing part and is deliberately
narrow. It grants MIT over `fixtures/` and states in the same breath that it
covers nothing in `items/` or `archives/` — bought CodeGrid source, which is
not ours to relicense and whose redistribution is the failure this entire
repository is arranged around. `bin/` and `web/` are excluded too and stay all
rights reserved, because open-sourcing the tool is a separate question that is
still open in [LOCAL-MODE.md](./LOCAL-MODE.md), and a root `LICENSE` file with
no scope statement would have quietly answered it.

A blanket MIT file at the root of a repository that also contains paid
third-party source would have been a worse bug than the one it fixed.

## Auth fails closed in production, open in development

An unconfigured production deploy returns 503 rather than serving the vault.
Development allows through with a warning so a fresh clone runs with no
secrets.

The asymmetry is the point: a missing environment variable in production should
lock the door, never open it.

> **Amended 2026-08-09.** This used to lead with "an empty
> `AUTH_ALLOWED_LOGINS` denies everyone". That variable is gone; accounts are
> rows in `users` and the first is created with `pnpm user add`. The rule now
> holds structurally rather than by a value being empty — no database means no
> accounts means no sign-in — which is strictly harder to get wrong than
> remembering to leave a string blank.

## Local mode is one flag on one codebase, and it is refused, not trusted
*2026-08-09*

morgue runs two ways: a hosted multi-tenant vault, and a single-user tool on a
designer's laptop with no accounts at all. That could have been a second
package. It is `MORGUE_LOCAL=1` on the same build.

**Why not a fork.** A second copy of `web/` diverges within a month and every
bug gets fixed twice. But the argument that actually settled it only became
visible once the gate existed: **the safety of local mode is a property of the
shared gate.** `pnpm verify:share` runs its entire 33-assertion suite with
`MORGUE_LOCAL=1` set, so every one of those assertions is simultaneously a
proof that the flag is inert on a deployment with accounts. A separate
distribution could not have that property — there would be no shared gate to
prove anything about.

**Why the flag is refusable.** A boolean that opens a door is an authentication
bypass one environment variable wide. If setting `MORGUE_LOCAL` on the hosted
deployment disabled the gate, then a leaked dashboard session or a PR touching
`vercel.json` owns the vault. So local mode is not "the operator asked for it".
It is "the operator asked for it **and** nothing about this deployment looks
hosted" — `VERCEL`, `AUTH_SECRET`, `DATABASE_URL`, `AUTH_GITHUB_ID` or
`AUTH_GOOGLE_ID`, any one of which refuses it.

That test is deliberately a *disjunction*, where `authConfigured()` is a
conjunction, and `lib/local.ts` imports nothing so that no refactor of
`auth.ts` can widen it by accident. The duplication is the feature. Broader is
the safe direction: a false positive means local mode quietly does not engage,
a false negative means an open vault.

**What it is NOT keyed on: `NODE_ENV`.** The original brief said to ignore the
flag in production. That is wrong and would have broken the feature — `pnpm
morgue` runs a *production build*, because that is the only mode where
`proxy.ts` behaves the way it does in the deployment being protected. A flag
that switched itself off in production would switch itself off in the only
configuration it ships in.

**Rejected: deleting `proxy.ts` for local mode.** Tempting and unsafe. Rule 6
exists because that gate was once silently not running at all, and a "local"
edit that removes it invites a merge that removes it everywhere. Local mode
takes a different branch; it does not remove the branch.

**Rejected: hiding the cloud dependencies behind dynamic imports.** The brief
assumed the hosted product carried bloat a local user should not pay for.
Measured: `@aws-sdk`, `drizzle-orm`, `next-auth`, `@neondatabase` and `resend`
together are 34 MB of a 614 MB `node_modules` — 5.5% — and appear in **zero**
of the 19 JavaScript files served to a browser. Playwright's Chrome is 387 MB.
The surgery would have bought a fragile import graph for nothing measurable, so
the effort went into the installer and the empty-collection experience instead.
See FINDINGS.md.

## The grid never runs the code it displays

Measured, not assumed: 40 WebGL contexts created leaves exactly 16 alive, and
detaching the canvas frees nothing. The cap is per *renderer thread*, so
same-origin iframes share one budget. A grid of live scenes doesn't degrade —
it silently blanks whichever preview you are looking at.

Consequence for the card component: **transform and opacity only.** No
`box-shadow`, `filter` or `backdrop-blur` transitions — up to twelve videos may
be decoding and anything forcing paint competes with them directly.

## Export bundles carry provenance and licence

An export that separates source from its origin is exactly how a paid CodeGrid
component ends up in client work. So every bundle leads with licence and
provenance, and `paid` items get a loud banner.

The harder half is that a demo page is mostly harness — it centres itself in a
`100vh` grid, hides `overflow` on `body`, loads GSAP from `/vendor/`, and sets
`window.__ready`. Pasted verbatim, an agent reproduces all of it faithfully and
the result looks plausible while being wrong. Hence `export.scaffold`: the
selectors that are furniture, named so the bundle can say "do not copy".

## Design tokens deviate from DESIGN.md in two places

Both marked in `globals.css`.

1. **Display sizes are fluid.** The spec gives desktop-only pixels (110px);
   rendered literally that is unusable on a phone.
2. **Tracking is `em`, not `px`.** The spec pairs `-5.5px` with `110px`. Keep
   it in px and a headline clamping to 56px still carries -5.5px of tracking,
   which jams the letters together. `-5.5/110 = -0.05em` holds the ratio at
   every size.

Plus one addition: **a motion scale**, because DESIGN.md ships five keys —
colors, typography, rounded, spacing, components — and no motion at all.

## GT Walsheim → General Sans

The spec's display face is Grilli Type and commercially licensed. General Sans
(Fontshare, free for commercial use) is the closest geometric-humanist
substitute and survives the -0.05em tracking. Self-hosted so there is no
third-party request in the critical path.

Consistent with the rest of the project: not shipping something on a public
domain without the right to.
