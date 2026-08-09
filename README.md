![An exploded view of the morgue vault — a browser window holding a searchable grid of captured
UI animations, with a preview card lifted off the surface, a capture log reading "motion: OK",
a 24-frame contact sheet and an agent-ready export bundle floating around
it.](./assets/banner.svg)

# morgue

A private reference collection of UI components and web animations.

A *morgue file* is what art departments have always called the drawer of clippings kept for
reference — the things you look at again when you're trying to work out how something was
done. This is that, for motion on the web.

> **Where things stand:** [docs/STATUS.md](./docs/STATUS.md) — what's built, what's blocked,
> what's untested. **Why it's built this way:** [docs/DECISIONS.md](./docs/DECISIONS.md).
> **What was measured:** [docs/FINDINGS.md](./docs/FINDINGS.md).

You hand it a component. It captures a deterministic video preview, files it under a
controlled vocabulary, and writes down how the effect actually works. Later you search for
"the one where the panels pin and scroll sideways" and get the clip, the code, and the note.

**The collection is not in this repo.** `items/` is gitignored — see [What's tracked](#whats-tracked).

---

## Run your own

morgue runs locally with **no accounts, no database and no cloud services**.
Nothing leaves the machine.

```bash
git clone https://github.com/Clupai8o0/morgue.git
cd morgue
pnpm install
pnpm morgue
```

That builds what needs building, starts a server and opens a browser. If you
would rather not think about prerequisites:

```bash
curl -fsSL https://raw.githubusercontent.com/Clupai8o0/morgue/main/install.sh | sh   # macOS, Linux
irm https://raw.githubusercontent.com/Clupai8o0/morgue/main/install.ps1 | iex        # Windows
```

Either way, `pnpm doctor` will tell you what this machine is missing and give
you the one command that fixes each thing — **all of them at once**, rather than
one per attempt.

Two tiers, and you probably only need the first:

| | Needs | Cost |
|---|---|---|
| **Browse** — search, filter, notes, export | Node 22+, pnpm | ~600 MB of `node_modules` |
| **Capture** — record new previews | ffmpeg with libx264, Playwright's Chrome | ~400 MB more |

A fresh clone has an **empty** collection, because the collection cannot be
distributed. First run shows the eleven examples in `fixtures/`, which were
written from scratch for this repo and are MIT-licensed. Put your own work in
`items/<slug>/` and it takes over.

[SETUP.md](./SETUP.md) is the full walkthrough — and it is written so you can
hand it to an agent instead of reading it:

> *Set up morgue on this machine following SETUP.md, then run `pnpm morgue`.*

Want the hosted, multi-user version instead? That is `pnpm web:dev` and
[docs/MULTI-TENANT.md](./docs/MULTI-TENANT.md). The two share one codebase and
one flag; local mode is refused on any deployment that has accounts, which
[web/src/lib/local.ts](./web/src/lib/local.ts) explains at length.

---

## Why it is built this way

Every serious component gallery converges on the same rule: **the browse grid never runs code.**
21st.dev serves 400 lazy `<img>` for 1152 components with zero iframes; Aceternity's index is
486 static WebP with zero canvas; Codrops links out to a standalone page rather than embedding.

That isn't taste, it's a hard ceiling. Measured in Chrome on this machine:

- Creating 40 WebGL contexts leaves **exactly 16 alive**. The rest are force-lost.
- Removing a canvas from the DOM does **not** free its context — still 16 alive after detaching all of them.
- The cap is per *renderer thread*, so same-origin iframes share one budget rather than each getting their own.

So a grid of live Three.js scenes doesn't degrade gracefully, it silently blanks whichever
preview you're looking at. Hence three tiers:

| Tier | What it shows | Cost |
|---|---|---|
| **Grid** | poster image, video on hover | ~30–90 KB per item |
| **Detail** | the real thing, one live iframe | one item at a time |
| **Scroll-driven** | video only — open the standalone page for the real thing | zero embed |

That last row is not a preference. A ScrollTrigger item in a short embedded iframe is
**measurably broken**: its scroller is the iframe's own viewport, so scrolling the parent
3000px leaves the track transform at exactly `0`. Verified, not assumed.

## Deterministic capture

Previews are not screen recordings. The harness fakes the page clock before any script runs,
then steps it one frame at a time:

```js
performance.now = () => now
Date.now        = () => epoch + now
requestAnimationFrame = (cb) => queue.set(id++, cb)   // drains only when we step it
```

GSAP, a raw rAF loop, `THREE.Clock`, Lenis and motion all read from those, so every one of
them advances in lockstep with the frame counter. CSS/WAAPI animations live on the compositor
instead and get an explicit seek — except those on a `ScrollTimeline`/`ViewTimeline`, which are
driven by scroll position and must be left alone.

Result: **1113/1113 frames byte-identical across two runs of all eight fixtures.** Captures are
diffable, so a preview that rots is detectable.

## Verified across the stacks worth collecting

| Stack | Status |
|---|---|
| Plain HTML + CSS `@keyframes` | ✅ |
| CSS scroll-driven (`scroll()` / `view()`) | ✅ |
| GSAP core — hover / pointer | ✅ |
| GSAP ScrollTrigger — pin + scrub | ✅ |
| GSAP + Lenis smooth scroll | ✅ |
| React 19 + motion | ✅ |
| Three.js / WebGL | ✅ real GPU headless (`ANGLE Metal`) |
| Next.js `output: 'export'` | ✅ captures post-hydration |

Each of these is a fixture in `fixtures/`, and `pnpm test` runs the whole corpus end to end.

---

## Usage

```bash
pnpm install

pnpm doctor             # what this machine is missing, and the fix for each
pnpm morgue             # build if needed, serve, open a browser — no accounts

pnpm capture            # capture every item in items/
pnpm capture <slug>     # just one
pnpm build              # generate site/ — static grid, no framework
pnpm check              # confirm every item page actually runs in the built site
pnpm serve              # http://localhost:8910 (binds 0.0.0.0 for phone/iPad)

pnpm test               # build + capture + site + check, against fixtures/
```

### The web app

`web/` is a Next.js 16 app — the public landing page plus the private vault.
Run its scripts **from the repo root**, not from inside `web/`:

```bash
pnpm web:dev            # http://localhost:3210 — matches verify:web and the OAuth callback
pnpm web:build
pnpm verify:web         # drives real Chrome via Playwright — see below
pnpm verify:local       # local mode works, and is inert where accounts exist
pnpm db:push            # apply the Drizzle schema to Neon
pnpm publish:r2         # upload out/ + site/data to R2  (--dry-run to preview)
```

`pnpm morgue` runs the same app with `MORGUE_LOCAL=1`, which turns off
everything that exists because the hosted product has more than one user: no
sign-in, no database, no R2, and `/admin`, `/account`, `/signin`, `/api/share`
and friends return 404 rather than a gate. The flag is **ignored** wherever
`AUTH_SECRET`, `DATABASE_URL`, an OAuth id or `VERCEL` is set — otherwise it
would be an authentication bypass one environment variable wide. `pnpm
verify:local` boots a configured server with the flag set and proves the vault
stays shut.

> Running `pnpm build` *inside* `web/` fails with `ERR_PNPM_IGNORED_BUILDS`.
> pnpm re-evaluates build approval without the workspace root's `allowBuilds`,
> and drizzle-kit bundles esbuild. The root scripts above avoid it.

**`pnpm verify:web` exists because a green build proves nothing.** It launches
real Chrome (`channel: 'chrome'`, so H.264 is present) and asserts the things
that actually break: that rAF runs, that the entrance observer fires, that
hover video reaches `readyState 4` with `currentTime` advancing, that Lenis
intercepts wheel input, and that the magnetic hover displaces. Two days were
once lost to a "broken" video that was really a backgrounded tab — this is the
check that would have caught it in seconds.

### Two surfaces, one boundary

| | Public | Private | Local |
|---|---|---|---|
| Route | `/`, `/styleguide` | `/vault`, `/admin`, `/api/media` | `/vault` only — the rest 404 |
| Auth | none | a row in `users`; GitHub, Google or password | none, and nobody to authenticate |
| Media | `morgue-public` bucket | `morgue-private`, signed URLs only | the `site/` directory on disk |

Access used to be a comma-separated allowlist of GitHub logins in an
environment variable. It is now a row in `users` with `status = 'active'`,
created at the CLI with `pnpm user add` — but the property that mattered
survives the change: with no database there are no accounts, so a deployment
with a missing configuration lets nobody in rather than everybody.

The private R2 bucket has **no public access**. Gating the app is worthless if
the mp4 behind it is fetchable by anyone holding a CDN link — and CDN links
leak into logs, analytics and history. Public versus private is a property of
*which bucket a file lives in*, so a routing mistake cannot expose the
collection.

**Production reads the vault from R2, never from the deploy.** `items/` is
gitignored, so Vercel builds from a tree that has never contained the
collection and could not generate the data if it wanted to. `capture → build →
publish` is the only path anything reaches production — which means a deploy
has nothing to leak.

### Adding an item

Create a folder under `items/<slug>/` with `index.html`, `meta.json`, `capture.json` and
`notes.md`, then run `pnpm capture <slug> && pnpm build`. The contract is in
[CLAUDE.md](./CLAUDE.md) — an agent can ingest by writing files, no API needed.

`capture.json` drives the recording. There is no universal recipe, which is the point:

```jsonc
{
  "trigger": "scroll",              // load | scroll | pointer
  "viewport": { "width": 1280, "height": 800 },
  "durationMs": 5000,
  "fps": 30,
  "scroll": { "from": 0, "to": "max", "ease": "inOut" },
  "posterAt": 0.55,                 // stepped through, never jumped to
  "settleMs": 600
}
```

If automation fights you, drop your own `poster.png` / `preview.mp4` into the item folder.
Eight seconds with Cmd-Shift-5 beats forty minutes of arguing with a headless browser.

---

## What's tracked

**Tracked:** the tool, and `fixtures/` — eleven items written from scratch for this repo, which
double as the test suite. They are **MIT** under [LICENSE](./LICENSE); three of them are the
showcase tiles on the public landing page, which is what that grant exists to make true. The
scope section there is narrow on purpose and covers nothing below.

**Not tracked:** `items/`, `out/`, `site/`.

Two reasons, both deliberate:

1. **Licensing.** The collection is third-party source — paid templates, ripped components,
   code licensed for personal reference but not redistribution. Committing it would republish
   someone else's work under this repo's name.
2. **Size.** Eight fixtures alone produced 46 MB of capture output when that was measured. A
   real collection of a few hundred items, with textures, `.glb` models and video, runs to
   gigabytes — `archives/` reached 274 MB across four templates.

The tool is the shareable part. The morgue is yours alone.

> `meta.json` carries a `license` field per item. Anything marked `paid` should never be lifted
> into client work without checking the original EULA — record it at ingest, while you still
> remember where it came from.
