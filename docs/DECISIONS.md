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

## Postgres holds two tables and never the vault

`waitlist` and `cli_tokens`. Browsing never touches a database.

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

## Auth fails closed in production, open in development

An empty `AUTH_ALLOWED_LOGINS` denies everyone. An unconfigured production
deploy returns 503 rather than serving the vault. Development allows through
with a warning so a fresh clone runs with no secrets.

The asymmetry is the point: a missing environment variable in production should
lock the door, never open it.

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
