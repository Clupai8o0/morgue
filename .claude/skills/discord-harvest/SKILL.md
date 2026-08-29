---
name: discord-harvest
description: "Bulk-collect source archives posted as attachments in a Discord channel (CodegridPRO source-code, website-templates, or any channel that drops a CODE.zip per post) and land them named, verified and inventoried. Use when asked to harvest, collect, scrape or download components/templates/zips out of Discord, to inventory what a Discord channel contains, or to get a paid Discord drop into morgue's items/."
---

# Harvesting a Discord attachment channel

Turns a channel where every post is `title + CODE.zip` into a directory of
uniquely-named, integrity-checked archives plus a manifest you can ingest from.

Two halves. The browser half needs Chrome and produces one TSV of
`name<TAB>url`; the shell half needs nothing and does the transfer. Keeping them
separate is what makes the slow part resumable.

## Before starting

Ask for two decisions, because they change the size of the job by gigabytes:

- **Scope** — everything, or a subset. A channel like `#source-code` is ~430
  posts / 4.1 GB, and roughly 7% of posts are `NEXT.JS VERSION:` duplicates of a
  post you are already taking.
- **Destination** — default `~/Downloads/<channel>-components/`. Never inside the
  repo: this is paid third-party source, and `items/`, `archives/` and
  `fixtures/` all have rules about it (see "Landing it in morgue").

The user drives Chrome to the channel. Confirm the tab before touching anything.

## Procedure

1. **Focus the window** — `reference/browser-recipe.md` step 0. Do this first;
   the clipboard export at the end fails silently against a background tab.

2. **Count with search.** Search `has:file in:<channel>`. The header gives an
   exact count ("430 Results"). *This number is the contract* — every later stage
   is checked against it. Do not scroll the channel to enumerate.

3. **Harvest metadata** across the search pages (recipe step 2) — id, timestamp,
   title, filename, size. Message snowflakes decode to timestamps locally.

4. **Build the name map.** Every attachment is called `CODE.zip`, so filenames
   must come from titles: `0001-link-hover-animation-project-page.zip`,
   zero-padded, oldest first. Without this the whole harvest is one collision.

5. **Harvest URLs** (recipe step 3) and check the four counters it prints.

6. **Export via clipboard** (recipe step 4) → `~/Downloads/<slug>-urls.tsv`.

7. **Write `inventory.json`** next to the archives: `{items:[{n, date, title,
   size, sizeMB, slug}]}`. `verify-harvest.py` needs it for the size and
   coverage checks, and it is what you ingest from afterwards.

8. **Download.**
   ```bash
   .claude/skills/discord-harvest/scripts/fetch-attachments.sh \
     ~/Downloads/<slug>-urls.tsv ~/Downloads/<slug>-components 4
   ```
   Run it in the background and poll; 4 GB takes a while. Safe to re-run — a
   file that already passes `unzip -t` is skipped, so this is how you retry
   failures.

9. **Verify.**
   ```bash
   .claude/skills/discord-harvest/scripts/verify-harvest.py \
     ~/Downloads/<slug>-components ~/Downloads/<slug>-components/inventory.json
   ```
   Exits non-zero on any corrupt, missing or size-mismatched archive, and writes
   `MANIFEST.csv`. Report its numbers, not your own recollection of the run.

## Traps that cost real time

1. **Never enumerate by scrolling.** Assigning `scroller.scrollTop` fires scroll
   events but does *not* trigger Discord's lazy loader — it will sit at the top
   of a 30-message window forever looking like the channel ends there. Only
   trusted CDP wheel input scrolls, and that returns a screenshot per call. Search
   pagination has neither problem: `button.click()` on the dock works fine.

2. **`/channels/<guild>/<channel>/0` reaches the true channel start** and shows
   "This is the start of…", which is the only reliable way to confirm you have
   the oldest post. It will not paginate *forward* from there, so use it to check
   the boundary, not to collect.

3. **The first CDN anchor in a post is the preview image, not the archive.**
   Selecting it downloads a `.jpeg` that is plausibly sized and completely wrong.
   Require `\.(zip|rar|7z)$` on the URL *pathname*.

4. **In-page `fetch()` of an attachment fails CORS**, and Chrome blocks the
   second and subsequent automatic downloads, so blob-saving 400 files in a loop
   cannot work either. One blob download succeeds and the rest vanish with no
   error. This is why the URLs go out to `curl` instead.

5. **Signed CDN URLs expire in roughly 24 h.** A TSV from yesterday is dead —
   re-run the browser half. Delete it once the download verifies.

6. **`Runtime.evaluate` is killed at 45 s.** Any loop longer than that must be
   started without `await` and polled from later calls, or it dies mid-walk and
   you cannot tell how far it got.

7. **Compare sizes against Discord's original display string**, not a float
   rounded to MB. Rounding `3.17 KB` to `0.00` MB manufactures dozens of phantom
   mismatches. `verify-harvest.py` already does this correctly.

8. **Do not `xargs -I{}` the pairs.** With `-I` the replacement lands inside a
   quoted string, nothing dispatches, and the run "succeeds" in under a second
   having downloaded nothing. Use `tr '\t' '\n' | xargs -P N -n 2`.

9. **Never route signed URLs through the transcript.** The harness blocks query
   strings on purpose. Clipboard → file is the supported path; do not base64 or
   otherwise disguise them to get around the filter.

## Landing it in morgue

The harvest directory is *not* an ingest. Per `CLAUDE.md`:

- **`meta.json` provenance** — a Discord drop has no product page, so
  `sourceUrl: null` and `sourceArchive: "~/Downloads/<slug>-components/NNNN-….zip"`.
  Putting the local path in `sourceUrl` to fill the field is exactly what that
  rule forbids: they answer different questions. `source: "codegrid"`,
  `license: "paid"`.
- **`kind`** — `MANIFEST.csv` classifies each archive from its contents.
  `project` (has `package.json` + `app/`/`pages/`) needs a build and pulls in
  **rule 2**: `output: 'export'`, `images.unoptimized`, and `basePath` rather
  than `assetPrefix` for anything with working internal navigation. `static` runs
  as-is. When a post is a whole template rather than one effect, `unextracted` is
  the honest answer — record the archive, capture, write notes, extract later.
- **Never copy any of it into `fixtures/`.** The root `LICENSE` grants MIT over
  `fixtures/`, so moving paid source there relicenses someone else's work.
- **Optimise on the way into `site/`, never into `items/`** without
  `--in-place --yes --backup <dir>`.
- Finish each item with `pnpm capture <slug>` → `pnpm build` → `pnpm check`.
  `pnpm check` is not optional; a clean capture does not prove the item page works.

Expect the post count to overstate the component count: `NEXT.JS VERSION:`
companions duplicate a vanilla post, and some posts are patches to an earlier one
(`BUGFIX: REMOVING FLICKER FROM THE SUBHEADER`, 3.75 KB) rather than components.
Say the real number out loud when reporting.
