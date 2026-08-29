---
name: morgue-intake
description: "Turn a thing — a downloaded component folder, a paid template zip, a CodePen/snippet, or a reference video+URL — into a finished morgue item: files under items/<slug>/, captured, built, checked, and (optionally) published. Use when asked to add/ingest/upload something to morgue, to get a component or effect into the vault, to turn a delivery into an item, or to process a downloaded animation into the collection. Harness-agnostic: the steps are plain pnpm commands, so Claude Code, Codex, opencode or any agent can run it."
---

# Adding a thing to morgue

Morgue has no upload button and no server. "Uploading" means **writing files under
`items/<slug>/` and running a few commands** on this machine. This skill is the procedure
for taking an arbitrary thing and coming out the other side with a finished, verified item.

The authority on the file formats is the repo's `CLAUDE.md` (the folder contract). This skill
is the *workflow* over it — read `CLAUDE.md` when you need a schema; follow this for the order
of operations and the judgement calls.

Any agent can run this: every step is a `pnpm` command. There is nothing Claude-specific here.

## Step 0 — what kind of thing is it?

Pick the row, then jump to that section. This choice decides how much work it is.

| What you have | kind | Path |
|---|---|---|
| One self-contained folder with an `index.html` at its root (or a zip of one) | `static` | **A. Ingest a delivery** |
| A big template/repo where the effect is buried in many files (React/Next/Vite) | `project`/`unextracted` | **B. Carve it out** |
| Just a video + a URL, no runnable source you can ship | `reference` | **C. Reference** |
| A loose snippet, a CodePen, a gist — code but no project | `static` | **D. Assemble by hand** |

When unsure, prefer the cheapest honest option. A `reference` (video + notes + URL, no code) is
the fastest to add and often the most useful — never skip one just because there's no source.

---

## A. Ingest a self-contained delivery  (the common case)

```bash
pnpm ingest <dir> --slug <slug> --source-archive <path-to-original.zip>
#   --title "…"   override the title        --dry-run   preview, write nothing
#   --license own|mit|paid|unknown          --source <name>   (default: codegrid)
#   --allow-dup   only if the dedup guard is a false positive
```

`--slug` is **required** and must be lowercase-kebab; it is never guessed. Run with `--dry-run`
first to see the generated `meta.json`/`capture.json` and the "needs a read" list without writing.

What `pnpm ingest` does for you (deterministic only): strips delivery junk, relativises
root-absolute paths, rewrites CDN `<script>`/`<link>` tags and bare ESM imports onto morgue's
vendored copies, neutralises dead `<a href>`s, injects the `window.__ready` capture signal, sizes
`capture.json` to the source's own timeline, and infers `trigger`/`technique`/`weight`/`title`.

What it deliberately **leaves for you** (a wrong tag is trusted; a blank gets filled in):
- `surface` — always left null.
- `effect` — left empty unless the title/slug contained an unambiguous vocabulary word.
- `notes.md` — a stub; the "How it works" section is a `TODO`.
- Any unresolved remote asset (a font/icon CDN it doesn't vendor) — listed as "needs a read".

It **refuses to overwrite** an existing `items/<slug>/`, and **refuses a duplicate** whose
rewritten `index.html` matches an item already in the collection (that's the same component
under a new name — the thing that quietly produces two cards). Override with `--allow-dup` only
if you're sure it's genuinely different.

Bulk (a whole staging dir at once): `node bin/ingest-batch.mjs <dir> --manifest <file.json>
[--slug-overrides <file.json>]`. It derives slugs, hard-stops on collisions, runs `ingest` per
delivery, and at the end prints **one combined list** of everything still needing classification
(also written to `.ingest/last-batch-todo.jsonl`). There is no `pnpm` alias — run it with `node`.

Now go to **Finish every item**.

---

## B. Carve an effect out of a large template

The effect is buried in a bundler project. Do not try to ingest the whole thing.

```bash
pnpm survey <dir>          # map the template: candidates, mounts, deps
pnpm extract <archive> <candidate-id> --slug <slug>
```

`survey` finds the interesting sections; `extract` lifts one out. Framework items (`project`
kind) get a build step and a mount prefix — read `CLAUDE.md` **rule 2** before you build
(`assetPrefix` for a single route, `basePath` for anything that navigates; picking wrong is a bug
that hides until a click). If carving is expensive, land it as `unextracted` (store the archive,
record the path, capture a video, write notes) and **extract later, on demand** — never block
intake on producing a runnable isolate.

Then go to **Finish every item**.

---

## C. Reference  (video + notes + URL, no code)

The fastest item to add, and there is nothing to run. Create `items/<slug>/`:

- `meta.json` — `"kind": "reference"`, set `effect`, `surface`, `technique` by hand, and a real
  `sourceUrl`. No `index.html`, no `src/`.
- `notes.md` — how the effect works, in words.
- `capture.json` — only if you have a local video to record; otherwise the card is video-less.

Fill `effect`/`surface` with `pnpm classify <slug>` (below), then build + check as normal.

---

## D. Assemble a loose snippet by hand

Make `items/<slug>/index.html` a page that **runs standalone from the folder root**. Put any
extra source under `src/`. Then write `meta.json` and `capture.json` by hand (copy the schemas
from `CLAUDE.md`), and set `window.__ready = true` once the page is ready to record. If it pulls
a library, vendor it: point the tag at `/vendor/…` and add the mapping to `bin/vendor.mjs` if it
isn't there (`CLAUDE.md` rule 3). Then **Finish every item**.

---

## Finish every item  (all four paths converge here)

1. **Fill the blanks.** `surface` and `effect` are what make the vault searchable and cannot be
   read off the source. Use the picker — it only ever writes the controlled vocabulary:
   ```bash
   pnpm classify <slug>      # numbered menus for surface (one) and effect (one or more)
   ```
2. **Write `notes.md`.** Replace the `TODO — read the source and describe the effect` stub with a
   real "How it works". If it's still a stub, the item isn't done — the build will nag you.
3. **Capture, build, check — in one command:**
   ```bash
   pnpm item <slug>          # = pnpm capture <slug> → pnpm build → pnpm check <slug>
   ```
   It stops at the first failing stage and prints the path to the preview when it passes.
   (You can still run the three separately; `pnpm check <slug>` verifies just this item now.)
4. **LOOK at the preview.** Open `out/<slug>/preview.mp4` and `out/<slug>/contact.jpg`.
   `motion: OK` only proves pixels moved, not that the effect ran correctly (`CLAUDE.md` rule 5).
   Watch for the `⚠ still moving at the final frame` warning — the capture may be cut short.
5. **Publish (optional).** `pnpm publish:r2` pushes media + data to the private bucket the hosted
   vault reads. `pnpm publish:r2 --public` publishes media **only** for `showcase: true` +
   `own`/`mit` items, and now refuses any that are still unclassified. `--dry-run` first.

## Judgement rules that save a re-do

- **Controlled vocabulary only.** `effect`/`technique`/`surface`/`trigger` come from the fixed
  lists in `bin/survey.mjs` (and `CLAUDE.md`). Free-text tags rot the search. Don't invent one;
  extend both lists deliberately if a term is genuinely missing.
- **Don't guess `effect`/`surface`.** A blank gets filled in later; a plausible-but-wrong tag
  gets trusted and never revisited. Classify by *watching the capture*, not by guessing.
- **Match the capture trigger to the effect.** `trigger` picks one driver (load/scroll/pointer);
  `wheel`, `drag`, `click.real`, `scrollTo` stack on top for sliders, draggables, canvas tools
  and second-section effects. A wrong trigger records a still frame (`CLAUDE.md`, `capture.json`).
- **Turn `boomerang` off** when the animation already returns to its start — it doubles the file.
- **Fully local.** Every item must run with no network. `pnpm check` now **fails** an item that
  phones home (a stray CDN font/icon) — resolve it to a vendored copy or inline it.
- **kind decides effort.** `reference` < `static` < `project`; `unextracted` defers the hard part.
  Don't over-invest — a captured reference beats an un-added extraction.
