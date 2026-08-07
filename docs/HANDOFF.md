# Handoff — 2026-08-07

Written to resume later. Supersedes the 2026-08-06 handoff entirely.

Read [CLAUDE.md](../CLAUDE.md) first — it is the folder contract and it is
authoritative. This file is a snapshot; that one is the rules.

[STATUS.md](./STATUS.md) and [FINDINGS.md](./FINDINGS.md) were reconciled this
session and are accurate as of this date.

---

## State in one screen

Branch **`vault-and-showcase`**, 7 commits ahead of `main`, pushed to
`Clupai8o0/morgue` (private). `main` still holds only the initial commit —
**nothing has been merged.** Working tree clean.

```
f636f8d  Add shared archives, agent survey/extract, and a visible relation model
90c6297  Add the morgue mark and a reproducible icon pipeline
a20800b  Import lenis.css — the vault detail page could not be scrolled
9502c38  Add web/ — public landing page and auth-gated vault
226a564  Reconcile STATUS and FINDINGS against the first real ingest
3d694ca  Add three MIT showcase fixtures and publish their media
6b49c9a  Add agent export bundles, R2 publishing, and the image optimiser
```

| | |
|---|---|
| items | 7 · `items/` 62 MB |
| archives | 1 (`blunt-main`) · `archives/` 46 MB |
| fixtures | 11 (8 original + 3 MIT showcase) |
| `out/` 429 MB · `site/` 129 MB | both regenerable |

| slug | kind | archive | on disk |
|---|---|---|---|
| `livespot360-reveal` | static | — | 35 MB |
| `blunt-preloader` | unextracted | — | 23 MB |
| `gooey-text-reveal` | project | — | 3.7 MB |
| `blunt-template` | unextracted | template:blunt-main | **20 KB** |
| `blunt-page-transitions` | project | extract:blunt-main | **20 KB** |
| `blunt-physics-footer` | unextracted | extract:blunt-main | **20 KB** |
| `blunt-smudge-reveal` | project | extract:blunt-main | **16 KB** |

## Verified green on this machine

```
pnpm test        11/11 fixtures — capture, build, all pages run
pnpm build       7 items → site/
pnpm check       6/7               ← ONE REAL FAILURE, see below
pnpm web:build   compiles, lists ƒ Proxy (Middleware)
pnpm verify:web  10/10
pnpm export      all 7, archive-backed ones now inline source
pnpm survey      blunt-main → 11 ranked candidates + coupling report
```

Contact sheets were eyeballed for every new capture — `motion: OK` was not
treated as proof (rule 5).

Commands now: `capture build check serve test verify:web web:dev web:build
web:start db:push db:studio publish:r2 export optimise survey extract icon`.

---

## What changed this session

### Shared archives — one template, many cards

`archives/<name>/` holds an ingested template once; each derived item is a few
KB of JSON pointing into it. Four cards now come off `blunt-main` at ~20 KB
each; the old model would have been four 23 MB copies.

The mechanism is **one line** — `'/archive/': 'archives'` in `bin/vendor.mjs`.
Both surfaces already consumed that map, so capture and the built site worked
with no further change. Only `archives/<name>/out` is servable; the rest of the
directory is the buildable project.

`meta.json` gained an optional `archive` block; `build.mjs` derives
`relations` (role, parent, children, siblings) from grouping on `archive.name`.
Relations are never hand-written.

### Relations are visible

Template pages list their extracts with entry file and capture route; extract
pages link back to the parent and across to siblings; grid cards badge
`3 EXTRACTS` / `PART OF BLUNT-MAIN`; `?archive=<name>` filters to the family.
Verified in real Chrome by reading screenshots back, not from status codes.

### survey / extract

`pnpm survey <archive>` writes `archives/<name>/candidates.json` and creates
nothing. `pnpm extract <archive> <slug>` materialises one. The split is
deliberate: CLAUDE.md's stated fear is the controlled vocabulary rotting, and
an agent writing items unattended is how that happens.

The coupling detector is the valuable part. It independently rediscovered rule
11's template-literal asset path, and flags `provider-required` (10 of 11
candidates), `css-var-foreign`, `mutable-export` and `capture-trigger-unsupported`
with file:line.

### Icon

`bin/icon.py`, two stages. `--generate` calls gpt-image-2 and refuses to
overwrite `assets/icon-src.png` without `--force`. Everything else is Pillow —
offline, deterministic, re-runnable. The mark is a toe-tag rising out of a
drawer. Palette is snapped to DESIGN.md rather than trusted from the model.

### Three MIT showcase fixtures

`counter-preloader`, `cursor-ribbon-trail`, `text-scramble-headline`. Written
from scratch so `license: own` and the public landing page stops fronting
someone else's paid work. Media committed to `web/public/showcase/`, gated in
`build.mjs` so a paid item reaching that directory is refused.

---

## THE ONE FAILING CHECK

`pnpm check` is 6/7. **`blunt-preloader` fails** — its internal nav (`/`,
`/about`, `/work`, `/expertise`, `/careers`, `/contact`) 404s in the built
site.

This is **pre-existing, not damage.** It became visible only because the
click-through step was added to `check.mjs` this session — the check previously
did one `goto` per item and never clicked, which is exactly why it went
unnoticed. The item's own preloader page, which is what the item is *for*,
works fine.

Cause: `items/blunt-preloader/next.config.mjs` sets `assetPrefix`, which
rewrites `/_next/` only. `archives/blunt-main/next.config.mjs` sets `basePath`,
which also rewrites every `<Link href>` — which is why the four archive-backed
items navigate cleanly.

**Two ways out, both needing a human decision:**

1. Migrate `blunt-preloader` to `archives/` with a `basePath` rebuild, the way
   `blunt-main` was done. Note `blunt-preloader` and `blunt-template` would
   then be near-duplicates — the real question is whether the old item should
   simply be retired now that `blunt-template` exists.
2. Teach `check.mjs` that a single-route `unextracted` item's inherited foreign
   nav is out of scope.

If (1), **CLAUDE.md rule 2 still says `assetPrefix`** and needs the `basePath`
distinction that `archives/blunt-main/next.config.mjs` already spells out.

---

## Open decisions

- **Merge `vault-and-showcase` into `main`.** 7 commits, nothing merged yet.
- **`blunt-physics-footer` has `"effect": []`.** None of the 16 controlled
  effect terms describes a matter.js gravity word-pile, and its meta argues a
  blank beats a mislabel — which is right, since the vocabulary exists so search
  keeps working. Adding `physics-pile` would make it findable, but the term must
  land in **both** CLAUDE.md and `bin/survey.mjs`, or the two copies drift.
- **`web/package.json` dev script binds :3000**, while `bin/verify-web.mjs`
  defaults to :3210 and the OAuth callback in `.env.local` is registered on
  :3210. Nothing binds 3210 by default. One-line fix
  (`"dev": "next dev --port 3210"`), but it must match the GitHub OAuth app.
- **Rotate `OPENAI_API_KEY`.** It was pasted in plaintext into a session
  transcript. It lives in `web/.env.local` (gitignored, verified).

---

## Blocked on credentials — unchanged

Every secret in `web/.env.local` is still an empty string: `DATABASE_URL`,
`IP_HASH_SALT`, `RESEND_API_KEY`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
`AUTH_SECRET`. R2's three are not in the file at all. `OPENAI_API_KEY` is the
only real value.

Consequence: **nothing outside the local dev path has ever run.** A production
`next start` returns 503 on `/vault` — correctly, failing closed.
`pnpm verify:web` passes only against `web:dev`, which fails open by design.

Vercel project and DNS (`morgue.clupai.com`, plus `api.morgue.clupai.com`
rewritten to `/api/*`) are still unconfigured.

---

## Next moves, in the order I would do them

1. **Resolve the `blunt-preloader` check failure** — decide retire vs migrate.
   It is the only red in the suite and it will nag every run until settled.
2. **Merge to `main`.**
3. **Run `pnpm optimise --write`** on `livespot360-reveal`. Dry run says
   34.97 MB → 2.94 MB (−91.6%). It has never been run with `--write` against
   `items/`; it requires `--in-place --yes --backup <dir>` and that is a
   one-way door on paid source with no backup. Do the backup first.
4. **Extract more from `blunt-main`** now that it is cheap — survey ranked
   `footer` 0.58, `transition-provider` 0.50, `smudge-revealer` 0.35 and eight
   more. Each is ~20 KB.
5. **Ingest a second template as an archive from the start**, to prove the path
   works without a migration behind it.
6. **`kind: reference` has never been used.** The cheapest and often most useful
   ingest — video + notes + URL, no code — and there is not one example.

---

## Traps paid for this session

- **`lenis.css` is not optional.** Without
  `html.lenis, html.lenis body { height: auto }`, an `<html>` carrying `h-full`
  pins the documentElement border box to the viewport. Lenis recomputes its
  scroll limit from a ResizeObserver on that box, so it never fires. A hard load
  works; a **client-side navigation** from a short page to a tall one keeps the
  old limit, and a limit of 0 means Lenis `preventDefault`s every wheel event.
  `/vault` fits one viewport — so clicking any card gave a page that could not
  be scrolled. `bin/vendor.mjs` already vendored the file for the static grid;
  the React app was the one surface missing it.

- **`basePath` does NOT remove hand-prefixing.** Measured on a purpose-built
  probe route: it rewrites `next/link` href, all `/_next/` assets and the
  metadata favicon — but leaves hand-written `<img src>` alone, and under
  `output: 'export'` (which forces `images.unoptimized`) it does not rewrite
  `next/image` src or raw `<a href>` either. The migration used a **post-build
  rewrite over `out/`** instead: 275 refs across 14 files, which also catches
  the template-literal path no source rewrite can reach.

- **`next-transition-router@0.2.11` `auto` mode is incompatible with
  `basePath`.** Its click delegate reads the already-prefixed rendered `href`
  and hands it to `router.push`, which prefixes again — `/base/base/work`, 404
  on the RSC payload, body collapsed to 67 bytes. Fix is two edits: import
  `Link` from the package instead of `next/link`, and drop `auto`. The
  package's own `Link` passes the raw `href` prop and is immune.

- **Pillow writes RGB `.ico` files that every OS renders and Next rejects.**
  `Format error decoding Ico: The PNG is not in RGBA format!` and `web:build`
  fails. Caught by running the build, not by looking at the file.

- **A staging build leaves `node_modules` inside the archive.** 435 MB, which
  inverts the entire storage argument for archives. Only `archives/<name>/out`
  is servable — prune `node_modules` and `.next` after building. Reinstallable
  from the committed lockfile.

- **`VENDOR` is no longer purely a library map.** Deriving package names from it
  turned the `/archive/` mount into a package called `archive`. Derive only from
  entries resolving into `node_modules/`.

- **`pnpm check` runs at 1000×700**, below blunt's own `DESKTOP_MIN = 1200` and
  at its `MOBILE_BREAKPOINT <= 1000` boundary — so check exercises a different
  code path than capture does. Not yet addressed.

- **`items/blunt-preloader` also 404s `/favicon.ico`**, same class as the nav
  bug, never noticed because headless Chromium does not fetch a tab icon.
