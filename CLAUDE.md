# morgue — folder contract

This file is the ingestion API. There is no server and no MCP tool: an agent adds an item by
**writing files**, then running two commands. Read this before adding anything.

## Adding an item

Create `items/<slug>/` containing:

```
items/<slug>/
  index.html      # entry point — must run standalone, served from the folder root
  meta.json       # classification (schema below)
  capture.json    # how to record the preview (schema below)
  notes.md        # how the effect works, in words
  src/**          # any additional source, verbatim
```

Then:

```bash
pnpm capture <slug>     # records preview.mp4 + poster.webp into out/<slug>/
pnpm build              # regenerates site/
pnpm check              # verifies the item page runs in the BUILT site
```

`pnpm check` is not optional. Capture serves the item at the folder root; the built site serves
it from `/item/<slug>/`. Those resolve asset paths differently, so **a clean capture does not
prove the item page works.** This has produced two real bugs already; the check catches them.

It exits non-zero when a page is broken, and that was added on 2026-08-09 — for its whole life
before then it counted the failures, printed the number and exited 0, so `pnpm check` could not
fail and `pnpm test` (an `&&` chain ending in `fixtures:check`) was green with every item page
broken. If you are reading a green run from an older transcript, it means nothing. A *missing*
build fails too; an *empty* one does not, because a red that no action can clear is how a gate
stops being read.

`pnpm test` builds `fixtures/` into **`site-fixtures/`**, not `site/`. The two shared one
directory until 2026-08-09, which meant a test run replaced the vault's index with 11 fixture
records and — once `build.mjs` learned to prune — deleted every real slug out of `site/`. Both
`build.mjs` and `check.mjs` derive the tree from `MORGUE_SRC`; keep them in step.

## meta.json

Use the controlled vocabulary. Free-text tags rot into `scroll`, `scrolling`, `scroll-anim`
within a month, and then search stops working.

```jsonc
{
  "title": "Pinned horizontal scroll",
  "kind": "static",              // reference | static | project | unextracted
  "effect": ["pinned-horizontal"],
  "technique": ["gsap-scrolltrigger"],
  "trigger": "scroll",           // load | hover | click | scroll | drag | idle
  "surface": "page",             // button | card | nav | hero | cursor | list | image | text | page
  "weight": "heavy",             // light | medium | heavy
  "source": "codegrid",
  "sourceUrl": "https://…",      // product page — answers "what may I do with this"
  "sourceArchive": "~/Downloads/…",  // the delivery it was ingested from, if any
  "license": "paid",             // own | mit | paid | unknown
  "addedAt": "2026-08-05",
  "usedIn": []                   // projects you actually shipped it in
}
```

**effect** — marquee, pinned-horizontal, sticky-stack, image-trail, magnetic, text-scramble,
mask-reveal, page-transition, parallax, hover-tilt, cursor-distortion, preloader, morph,
flip-layout, infinite-list, stagger

**technique** — gsap-core, gsap-scrolltrigger, css-only, scroll-timeline, webgl-shader,
threejs, canvas2d, view-transitions, motion/framer, react, nextjs, lenis

### The `export` block

Optional, but it is what makes an item usable somewhere else. `pnpm export
<slug>` and the vault's "Copy for agent" button assemble a markdown bundle from
it — provenance, licence, dependencies, notes, source, and what to throw away.

```jsonc
"export": {
  "files": ["index.html"],          // what to inline; default ["index.html"]
  "deps": { "gsap": "^3.13" },      // REAL packages, not morgue's vendored copies
  "scaffold": ["body", ".stage"],   // demo furniture — the bundle says "do not copy"
  "notes": "Use quickTo, not gsap.to — …"   // the mistake someone will make
}
```

**`scaffold` is the field that matters.** A demo page centres itself in a
`100vh` grid, hides `overflow` on `body`, loads GSAP from `/vendor/`, and sets
`window.__ready`. Pasted verbatim into another project, an agent faithfully
reproduces all of it and the result looks plausible while being wrong. Listing
the selectors that are furniture is the difference between a bundle that works
and one that wastes an hour.

Record `source` and `sourceUrl` honestly — provenance travels into every export,
which is the point. Six months later, "where did this come from and what am I
allowed to do with it" must be answerable from the paste alone.

If there is no product URL, leave `sourceUrl` null and set `sourceArchive`
instead. Do not put the local path in `sourceUrl` to make the field look filled
in: they answer different questions, and a paid template routinely arrives as a
dated bundle with no URL anywhere inside it — both READMEs in the July 2026
CodeGrid drop are untouched `create-next-app` boilerplate. `sourceArchive` is a
weaker claim than `sourceUrl` on purpose, and a weak true claim beats a
confident wrong one.

**kind** decides how much work ingestion is:
- `reference` — video + notes + URL, no code. Fastest to add and often the most useful. Do not
  skip these just because there is no source.
- `static` — HTML/CSS/JS that runs as-is. No build.
- `project` — needs a build step (React, Next). Only these get a build.
- `unextracted` — the interesting section is buried in a large template. Store the archive,
  record the path, capture a video, write the notes. **Extract later, on demand.** Never block
  ingest on producing a runnable isolate, or you will stop adding things.

## capture.json

```jsonc
{
  "trigger": "scroll",                        // load | scroll | pointer
  "viewport": { "width": 1280, "height": 800 },
  "durationMs": 5000,
  "fps": 30,
  "scroll": { "from": 0, "to": "max", "ease": "inOut" },   // trigger: scroll
  "pointerPath": [                                          // trigger: pointer
    { "at": 0.0, "x": 60,  "y": 600 },
    { "at": 0.5, "x": 450, "y": 320 },
    { "at": 1.0, "x": 860, "y": 60  }
  ],
  "posterAt": 0.55,
  "settleMs": 600,
  "boomerang": false          // default: true for trigger:scroll, false otherwise
}
```

**`boomerang` doubles the frame count**, so set it `false` whenever the animation
already returns to its start state. It defaults on for `scroll` because a scroll capture
ends wherever the page stopped and cutting back to the top is a visible snap in a looping
grid tile — but it made `starfield-animation`, a 16 KB source, the largest preview in the
collection at 3.0 MB. Turning it off took that to 1.1 MB with no visible change.

### What a capture writes

```
out/<slug>/
  preview.mp4       the archival record
  poster.webp/avif  the grid card
  contact.jpg       24 tiles across the whole capture — LOOK AT THIS (rule 5)
  capture.log.json  frames, ms, page errors, motion probes
```

`frames/` is intermediate and is **deleted after encoding**. It used to survive until the
next run of that slug, which meant 24 frame directories held 862 MB of the 892 MB in
`out/` — 97%. `contact.jpg` exists so pruning them costs you nothing: the artefact rule 5
asks you to look at outlives the PNGs it came from. Pass `--keep-frames` when you want to
re-encode without recapturing.

Set `window.__ready = true` in the item once it is ready to record. The harness pumps the
faked clock while polling for it, so signalling from inside a `requestAnimationFrame` or a
React `useEffect` works.

## Rules that exist because something broke

1. **Never freeze scroll-timeline animations.** The seek skips anything whose `timeline !==
   document.timeline`. CSS `animation-timeline: scroll()/view()` is driven by scroll position;
   pausing it freezes the effect while the page keeps moving — the capture looks fine and is
   not. Caught only by looking at contact sheets.

2. **Next.js exports need a mount prefix — `assetPrefix` for one route, `basePath` for many.**
   Always set `output: 'export'` and `images.unoptimized: true`. Without a prefix every
   `_next` chunk 404s in the built site while capture passes. The capture server strips the
   prefix so one build serves both.

   Which prefix depends on whether the item navigates:

   - **`assetPrefix: '/item/<slug>'`** — single-route items. It rewrites `/_next/` and
     nothing else.
   - **`basePath: '/archive/<name>'`** — anything with working internal navigation, i.e.
     every archive. It additionally rewrites every `next/link` href and the app-metadata
     favicon.

   Picking `assetPrefix` for a multi-route item is a real bug that hides well: the entry
   page loads, and only a *click* reveals that `<Link href="/about">` resolves against the
   vault root and 404s, while `href="/"` serves the vault grid at 200. `bin/check.mjs`
   clicks up to six links per item precisely because a `goto` alone cannot see it. It cost
   `blunt-preloader` its place in the collection — retired 2026-08-08, superseded by
   `blunt-template` off `archives/blunt-main`, which is the same template built with
   `basePath`.

   **Neither prefix touches hand-written strings.** Measured on a purpose-built probe route:
   `basePath` leaves raw `<img src>` and raw `<a href>` alone, and under `output: 'export'`
   it does not rewrite `next/image` src either. Use a post-build pass over `out/` — see
   `archives/blunt-main/morgue-rewrite.mjs`, which is anchored on the path rather than on a
   quote and so also catches the template-literal case in rule 11 that no source rewrite can
   reach.

3. **New vendored libraries go in `bin/vendor.mjs`.** Capture and the site both read that map.
   Adding a copy to one and not the other is how the Three.js item 404'd only on its detail page.

4. **Scroll-driven items get no in-page embed.** ScrollTrigger's scroller is the iframe's own
   viewport; in a short frame it shows frame 0 forever. Video in the grid, open-in-new-tab for
   the real thing.

5. **`motion: OK` does not mean correct.** It proves pixels changed, not that the effect ran.
   Look at `out/<slug>/preview.mp4` before considering an item done.

11. **Image optimisation never renames a file.** `pnpm optimise` re-encodes under the same name
    and the same extension; `--format` requires `--allow-rename` and then refuses every file it
    cannot prove safe. `archives/blunt-main/src/components/HeroSpotlight/HeroSpotlight.js:23`
    builds its paths with a template literal — `` `…/showreel_img_${i + 1}.jpg` `` — and the
    same computed form survives minification into `_next/static/chunks/`, so for those ten
    files there is no string to rewrite anywhere in the tree. A rename 404s after hydration,
    which `pnpm check` cannot see: it loads one route for 1.4s. Optimise on the way into
    `site/`, never before `pnpm capture` (the poster is encoded at dpr 2 and `preview.mp4` is
    the archival record), and never into `items/` without `--in-place --yes --backup <dir>` —
    that is paid source with no backup. Run against `items/` on 2026-08-08 for the first time:
    `livespot360-reveal` went 34.97 MB → 2.94 MB (−91.6%) with filenames and format kept, and
    the originals are in `~/morgue-backups/2026-08-08/`. Numbered 11 to avoid colliding with
    the web rules below; it is an ingest rule, not a web one.

    **"On the way into `site/`" is no longer something you remember to do.** `pnpm build`
    recompresses every raster it copies, on every build, and `bin/image-encode.mjs` is the
    one encoder both it and `pnpm optimise` use. As a step you had to invoke it happened
    exactly twice in the collection's life, and `archives/` — 602 files, 205 MB, most of
    the built tree — had never been touched at all.

    It is unconditional because it cannot do any of the damage the rest of this rule is
    about: **same filename, same format, same pixel dimensions, PNG lossless**. Each of
    those is one failure mode designed out rather than guarded against — a rename 404s a
    computed path, a resize breaks anything whose geometry is load-bearing (a sprite sheet,
    an atlas), a format change breaks the MIME, and `palette: true` quantises a gradient or
    a normal map to 256 colours. A file that would grow is left exactly as it was; an
    animated WebP is refused, because flattening it to frame 1 makes the file smaller and
    the animation disappear. Resizing and palette quantisation stay where they were: opt-in,
    per-item, backed up, in `pnpm optimise`. `--no-optimise` exists for bisecting a
    rendering bug, not for routine use.

    `site/` is regenerable, which is what makes in-place free there. A build still never
    writes to `items/`.

    Run against `items/` a second time on 2026-08-10, across the whole 94-item collection:
    143 files, 109.03 MB → 33.89 MB (−68.9 %), every one verified to decode at its expected
    dimensions with its format kept. Originals in `~/morgue-backups/2026-08-10/`.

## Rules for web/

6. **This is `src/proxy.ts`, not `middleware.ts`.** Next 16 renamed the
   convention. It must sit beside `app/` — with a `src/` directory that means
   `src/proxy.ts`; at `web/proxy.ts` it is silently ignored and the auth gate
   does not run. Verify with `pnpm web:build`: the output must list
   `ƒ Proxy (Middleware)`. The `edge` runtime is unsupported there.

7. **Run web scripts from the repo root.** `pnpm web:dev`, `pnpm web:build`.
   Running them inside `web/` fails on `ERR_PNPM_IGNORED_BUILDS`.

8. **The grid never runs code, and cards animate transform/opacity only.** No
   `box-shadow`, `filter` or `backdrop-blur` transitions on a card — up to
   twelve videos may be decoding and anything forcing paint competes with them.
   The LRU in `lib/player-pool.ts` is ported verbatim from `bin/grid.html`;
   do not "modernise" it into React state.

9. **A missing configuration must lock the door, not open it.** An
   unconfigured production deploy returns 503 rather than serving the vault;
   development fails open so a fresh clone runs with no secrets.

    This used to read "an empty `AUTH_ALLOWED_LOGINS` denies everyone". That
    variable is **gone** as of the multi-tenant pivot — accounts are rows in
    `users` and the first one is made with `pnpm user add`, so with no
    `DATABASE_URL` there are no accounts and nobody signs in. The principle is
    unchanged and now holds structurally rather than by a value being empty.
    Do not reintroduce an env-var allowlist beside the table; two answers to
    "may this person in" is one too many.

10. **`pnpm verify:web` after touching web/.** A green `next build` says
    nothing about whether the page runs — the same lesson as rule 5.

    It **brings its own Postgres and its own production server** and signs in,
    rather than running against `pnpm web:dev`. It used to do the latter, and
    that only worked because `web/.env.local` had no auth credentials in it:
    `authConfigured()` was false, `proxy.ts` fails open in development, and
    `/vault` rendered for anyone. The day those variables were filled in, the
    dev server started gating `/vault` correctly and the harness reported that
    the grid had no cards — the product working and the test wrong. A test
    whose pass depends on a secret being absent is not testing what it claims.
    `BASE=…` still points it at a server you already have.

13. **`pnpm verify:auth` after touching anything under identity.** That is
    `auth.ts`, `proxy.ts`, `lib/users.ts`, `lib/link-policy.ts`,
    `lib/password.ts`, `lib/auth-limit.ts`, `lib/auth-tokens.ts`,
    `lib/plan.ts`, `db/schema.ts`, or `app/api/account/*`.

    **A new route under `/api/account/` is PUBLIC until it is named in
    `proxy.ts`, in both `PROTECTED` and `ownerOnly`.** That is the wrong default
    and it is kept deliberately, because the alternative — protect the prefix,
    list the exceptions — fails the other way, locking out the person who
    cannot sign in and is trying to reach `reset` or `verify`. Both lists are
    short; `bin/verify-share.mjs` asserts every private path is refused a share
    cookie, so add a line there whenever you add one here.

    It starts a **throwaway Postgres cluster with `initdb`** and a production
    `next start` against it, then signs in over real HTTP. Set
    `MORGUE_TEST_DATABASE_URL` to skip `initdb` and use a database you already
    have — a container is enough, and it must be one the suite may take over.
    That is not
    ceremony: every interesting auth bug is a query returning the wrong row —
    a suspended user who still gets in, a lockout counting the wrong column, a
    reset token that works twice — and none of it is visible against a mock.
    It has already caught one: an `eq(a) && isNull(b)` where drizzle needed
    `and(a, b)`, which made "verify this address" mean "verify every
    unverified address in the table". The test that caught it seeds a
    *bystander* row, because a whole-table update and a correct one look
    identical when the table holds one row.

    This is why `src/db/index.ts` chooses a driver by hostname. The Neon HTTP
    driver cannot speak to a cluster you started yourself, so with it as the
    only driver this harness could not exist. Neon URLs still take the Neon
    path in production.

12. **Share access is an allowlist, and `pnpm verify:share` proves it.** A read-only
    share cookie may reach only what `shareAllows()` in `web/src/lib/share.ts`
    names — today `/vault*` and `/api/media/*` for a vault link, and exactly one
    item plus its own media for an item link. Never convert it to a denylist:
    forgetting to deny a new route hands a visitor something they should not
    have, and routes appear faster than that list gets reread. `/admin` and
    `/api/share` are additionally refused in `proxy.ts` before the allowlist is
    consulted, so widening the allowlist alone cannot expose them.

    Share tokens are signed with a key derived from `AUTH_SECRET` and carry
    their own expiry, so they work with no database. That means **a link cannot
    be un-issued** — revocation is checked when a link is *redeemed*, and the
    cookie it mints is capped at `SESSION_MAX_SECONDS`, so revoking takes up to
    an hour. Rotating `AUTH_SECRET` kills every outstanding link at once.

    `pnpm verify:share` spawns its own **production** server with an injected
    secret and dummy OAuth credentials, because `proxy.ts` fails open in
    development and a gate verified only in dev is verified in the mode where
    it does not run. Run it after touching `proxy.ts`, `lib/share.ts`, or
    anything under `app/s/` or `app/api/share/`.

14. **`MORGUE_LOCAL=1` is a different product, not a permission — and it must stay
    refusable.** Local mode (`web/src/lib/local.ts`) turns the hosted app into the
    single-user tool: no accounts, `/` → `/vault`, and `/admin`, `/account`,
    `/upgrade`, `/signin`, `/reset`, `/verify`, `/s/*`, `/api/share`,
    `/api/account/*` and `/api/waitlist` return **404 rather than a gate**.
    Absent, not forbidden — a 403 tells a visitor an admin console is there.

    The flag is honoured only when `hostedSignal()` finds nothing: no `VERCEL`,
    `AUTH_SECRET`, `DATABASE_URL`, `AUTH_GITHUB_ID` or `AUTH_GOOGLE_ID`. That
    test is a **disjunction** and is deliberately broader than
    `authConfigured()`, which is a conjunction; it also imports nothing, so no
    refactor of `auth.ts` can widen it by accident. **Do not "DRY" the two
    together** — the duplication is the feature, and a false positive costs
    nothing while a false negative is an open vault.

    Do **not** key it on `NODE_ENV`. `pnpm morgue` runs a *production* build,
    because that is the only mode where `proxy.ts` behaves as it does in the
    deployment being protected. The original brief said to disable the flag in
    production and that would have broken the feature outright.

    `pnpm verify:local` after touching `lib/local.ts`, `proxy.ts`, the
    installers or `bin/morgue.mjs`. It boots two production servers: one with
    no configuration, one configured for accounts *with the flag set*, and
    asserts the second one's vault stays shut and says out loud that it ignored
    the flag. `pnpm verify:share` also runs its whole suite with
    `MORGUE_LOCAL=1`, so all 33 of its assertions double as proof the flag is
    inert — if you ever remove that line, the bypass check disappears without a
    single assertion changing.

15. **An uncaptured item is a normal item.** `items/` is gitignored and ffmpeg
    is the most common thing missing, so "a collection with no media" is the
    default state of a fresh clone, not an error. `bin/build.mjs` skips the
    media copy when `out/<slug>/` is absent — it used to `cp` unconditionally
    and took the whole build down with an ENOENT — and the grid card renders
    "not captured" instead of a broken image. Keep both. Anything that assumes
    a poster exists will be wrong on every machine that has not captured yet,
    which on a public repo is most of them.

## Never commit the collection

`items/`, `out/` and `site/` are gitignored, deliberately — third-party licensed source and
gigabytes of media. Do not add exceptions, do not `git add -f` them, and do not move collected
code into `fixtures/`. `fixtures/` is only for items written from scratch for this repo.

**That rule now has a licence behind it.** As of 2026-08-09 the root `LICENSE` grants MIT over
`fixtures/` — because the public landing page says so, and it was not true until then. The scope
section of that file explicitly covers nothing in `items/` or `archives/`. So moving collected
code into `fixtures/` is no longer just untidy: it relicenses somebody else's paid work under
our name, in a file that says we may.

**`pnpm publish:r2 --public` is an allowlist**, and keep it one. It publishes media only, for
items that are `showcase: true` **and** `own`/`mit`, and it refuses to run without
`site/items.json` to check against. It never sends the data payload, because `facets.json`
indexes the whole private collection and `site/data/items/*.json` inline the source. Before this
existed the flag switched bucket and changed nothing else.

`publish.mjs` filters every job through the index in both modes. `out/` is deliberately never
pruned — `preview.mp4` is the archival record (rule 11) and `out/` is shared with fixture
captures — so it accumulates retired slugs, and the index is what keeps them out of the bucket.
Nothing deletes remote objects; that is still open.
