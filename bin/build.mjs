#!/usr/bin/env node
// Generates items.json + the static grid. No framework, no dev server, no build step
// for the shell itself — it is one HTML file that reads one JSON file.

import { readFile, writeFile, readdir, cp, mkdir, stat, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR, ARCHIVE_PREFIX, archiveEntry } from './vendor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.MORGUE_SRC || 'items'

// The output tree follows the source tree. These used to be one directory, and
// SITE being fixed while SRC was not is what made `pnpm test` destructive: it
// built fixtures/ into the same site/, so the vault's index became 11 fixture
// records, and once the prune below existed the same run deleted all 12 real
// slugs. A green suite that breaks the site it just tested is a bad shape, and
// no amount of "remember to run pnpm build afterwards" fixes it — so they are
// separate trees and the prune can be unconditional. bin/check.mjs derives the
// same path from the same variable; serve, export and publish are only ever
// interested in the real one.
const SITE = path.join(ROOT, SRC === 'items' ? 'site' : 'site-fixtures')

const slugs = (await readdir(path.join(ROOT, SRC), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

// Kept in step with LADDER in bin/renditions.mjs by hand. Two names in two
// files is the same shape as the controlled vocabulary living in both CLAUDE.md
// and bin/survey.mjs — cheap to check, and importing across the bin/ scripts
// for a two-element list would be worse.
const RUNGS = ['xs', 'sm']

// Finder droppings and editor state are not part of an item, and `site/` is what
// bin/publish.mjs walks — so anything copied in here is bound for the R2 bucket and
// nothing will ever remove it. Seven .DS_Store files were sitting inside
// archives/deadlock-studios/out/ within a day of it being staged; a template unzipped on a
// Mac arrives with them. Filtered at the copy rather than cleaned afterwards, because a
// cleanup step is one somebody forgets to run.
const JUNK = new Set(['.DS_Store', 'Thumbs.db', '.Spotlight-V100', '.Trashes', '__MACOSX'])
const publishable = (src) => !JUNK.has(path.basename(src))

/** Recursive byte count, for reporting what a prune actually reclaimed. */
async function sizeOf(p) {
  const s = await stat(p).catch(() => null)
  if (!s) return 0
  if (!s.isDirectory()) return s.size
  let n = 0
  for (const e of await readdir(p)) n += await sizeOf(path.join(p, e))
  return n
}

const items = []
for (const slug of slugs) {
  const dir = path.join(ROOT, SRC, slug)
  const outDir = path.join(ROOT, 'out', slug)
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
  const notes = existsSync(path.join(dir, 'notes.md')) ? await readFile(path.join(dir, 'notes.md'), 'utf8') : ''

  // Publish media + the runnable item side by side.
  //
  // The media copy is CONDITIONAL, and that is not defensive coding. `pnpm
  // capture` writes out/<slug>/, so an item that has never been captured has
  // no such directory and `cp` throws ENOENT — which took the whole build down
  // with a stack trace naming a path, not a cause. That is the ordinary state
  // of a fresh clone (items/ is gitignored, so a public checkout starts empty)
  // and of any machine without a usable ffmpeg, which is precisely the
  // audience docs/LOCAL-MODE.md is written for. An uncaptured item is a real
  // item — a title, tags, notes, source — and it belongs in the index; the
  // card renders "not captured" instead of a preview and everything else about
  // it works.
  if (existsSync(outDir)) {
    await cp(outDir, path.join(SITE, 'media', slug), { recursive: true, force: true, filter: (s) => !s.includes('/frames') && publishable(s) })
  }
  await cp(dir, path.join(SITE, 'item', slug), { recursive: true, force: true, filter: publishable })

  // Source text for the agent export bundle. Only the files meta.json actually
  // declares — an `unextracted` item may sit on 2,000 files and 35MB of JPEG,
  // and inlining that would bloat every record for no benefit.
  const exportFiles = {}
  if (meta.kind === 'static' || meta.kind === 'project') {
    // An archive-backed extract owns no code. items/<slug>/ holds meta.json,
    // capture.json and notes.md and nothing else; the source lives in the shared
    // archive, which is the whole point of not storing 23MB per effect. Resolve
    // against that root, and honour `export.entry` — what an extract declares —
    // as well as `export.files`.
    //
    // Getting this wrong is not a cosmetic bug: the bundle still renders, still
    // looks like a successful export, and simply contains no source. Which is
    // exactly what shipped until it was caught by reading a real bundle.
    const srcRoot = meta.archive?.name
      ? path.join(ROOT, 'archives', meta.archive.name)
      : dir
    const declared =
      meta.export?.files ?? (meta.export?.entry ? [meta.export.entry] : ['index.html'])
    for (const rel of declared) {
      const p = path.join(srcRoot, rel)
      // Loudly. A declared file that silently isn't there produces a bundle
      // with no source at all — which still looks like a successful export
      // until someone pastes it and gets nothing. Caught exactly this way.
      if (!existsSync(p)) {
        console.warn(`  ! ${slug}: export file "${rel}" not found — omitted`)
        continue
      }
      // A minified bundle is useless to an agent and enormous. Skip loudly.
      if ((await stat(p)).size > 120_000) {
        console.warn(`  ! ${slug}: ${rel} too large to inline (>120KB) — omitted from export`)
        continue
      }
      exportFiles[rel] = await readFile(p, 'utf8')
    }
  }

  // Which rungs of the preview ladder `pnpm renditions` actually produced. The
  // app must never GUESS this: facets.json is R2-resident and versions
  // independently of the deployed site, so a card that assumes preview-sm.mp4
  // exists will silently 404 against a payload built before the ladder did —
  // and a hover that quietly does nothing is the hardest kind of bug to see.
  // Recorded, not derived.
  const videoRungs = existsSync(path.join(outDir, 'preview.mp4'))
    ? RUNGS.filter((r) => existsSync(path.join(outDir, `preview-${r}.mp4`)))
    : []

  items.push({
    slug, ...meta, notes, exportFiles,
    poster: `media/${slug}/poster.webp`,
    video: existsSync(path.join(outDir, 'preview.mp4')) ? `media/${slug}/preview.mp4` : null,
    videoRungs,
    href: `item/${slug}/index.html`,
  })
}

// ─── Relations ─────────────────────────────────────────────────────────────
// DERIVED, never authored. meta.json states one local fact and nothing else —
// "I am the template for archive X" or "I am an extract from archive X". The
// graph between items falls out of grouping by archive name, so no meta.json
// ever contains another item's slug and a rename or a deletion cannot leave a
// dangling pointer behind: the next build simply stops emitting one.
//
// Three shapes are legal and all three are produced here without a special
// case, because they are just what the grouping happens to contain:
//   · an archive with no role:"template" item  → every extract has parent null
//   · a template nobody has extracted from yet → children []
//   · an item with no archive block at all     → archive null, role null
const ARCHIVES = path.join(ROOT, 'archives')
const ROLES = new Set(['template', 'extract'])

// slug -> the validated archive block. An item is in this map only if its
// meta.json declares an archive we are prepared to believe.
const member = new Map()
for (const it of items) {
  const block = it.archive
  if (!block) continue

  const name = typeof block.name === 'string' ? block.name.trim() : ''
  if (!name) {
    console.warn(`  ! ${it.slug}: archive block has no "name" — no relations derived`)
    continue
  }

  // Loudly, for the same reason the export-file check above is loud: an item
  // pointing at an archive directory that is not there is an item with no
  // code. Nothing else in the build fails, the card renders, the badge reads
  // "part of <name>" — and there is nothing behind it.
  if (!existsSync(path.join(ARCHIVES, name))) {
    console.warn(`  ! ${it.slug}: archive "${name}" not found under archives/ — the item has no code behind it`)
  }

  const role = ROLES.has(block.role) ? block.role : null
  if (!role) {
    console.warn(`  ! ${it.slug}: archive.role ${JSON.stringify(block.role ?? null)} is neither "template" nor "extract" — member of "${name}" with no parent and no children`)
  }
  member.set(it.slug, { name, role, route: block.route ?? null })
}

// Group. Sorted so the build output is byte-stable across filesystems: readdir
// order is not guaranteed, and a facets.json that reshuffles every build makes
// every diff and every cache key noise.
const byArchive = new Map()
for (const [slug, { name, role }] of member) {
  let g = byArchive.get(name)
  if (!g) byArchive.set(name, (g = { templates: [], extracts: [] }))
  if (role === 'template') g.templates.push(slug)
  else if (role === 'extract') g.extracts.push(slug)
}
for (const [name, g] of byArchive) {
  g.templates.sort()
  g.extracts.sort()
  if (g.templates.length > 1) {
    // Not fatal, but it makes "the template" a lie. Pick deterministically and
    // say which one won, so the card labels stay derived from real pointers
    // rather than from an assumption of uniqueness.
    console.warn(`  ! archive "${name}": ${g.templates.length} items claim role "template" (${g.templates.join(', ')}) — using ${g.templates[0]} as the parent`)
  }
}

const NO_RELATIONS = { archive: null, role: null, parent: null, children: [], siblings: [] }
for (const it of items) {
  const m = member.get(it.slug)
  if (!m) {
    it.relations = { ...NO_RELATIONS }
    continue
  }
  const g = byArchive.get(m.name)
  it.relations = {
    archive: m.name,
    role: m.role,
    // Non-null only on an extract, so "has a parent" and "is an extract" are
    // the same question everywhere downstream.
    parent: m.role === 'extract' ? (g.templates[0] ?? null) : null,
    children: m.role === 'template' ? [...g.extracts] : [],
    siblings: m.role === 'extract' ? g.extracts.filter((s) => s !== it.slug) : [],
  }

  // An archive-backed item has no items/<slug>/index.html to link to — its page
  // is a route inside the shared template. Same condition capture.mjs uses
  // (`meta.archive ? archiveEntry(...) : '/'`) and the same function, which is
  // what bin/vendor.mjs means by "capture's goto, build's href and check's
  // navigation cannot drift apart". Relative, like every other href here, so
  // the static grid resolves it against site/.
  it.href = archiveEntry({ name: m.name, route: m.route }).replace(/^\//, '')
}

// What a card is allowed to claim about its family, counted off this record's
// OWN pointers rather than off the size of the group. That distinction is the
// whole reason the label stays truthful when an archive has two templates.
const relatedCount = (r) =>
  r.role === 'template' ? r.children.length : r.role === 'extract' ? r.siblings.length + (r.parent ? 1 : 0) : 0

for (const [prefix, dir] of Object.entries(VENDOR)) {
  const from = path.join(ROOT, dir)
  const to = path.join(SITE, prefix.replaceAll('/', ''))

  // `/archive/` cannot ride the plain copy, and the reason is worth spelling
  // out because the plain copy *looks* like it works.
  //
  // resolveVendor() maps /archive/<name>/work → archives/<name>/out/work. So
  // the built site has to publish archives/<name>/out AS site/archive/<name>.
  // `cp(archives → site/archive)` gets that wrong twice over:
  //   1. every URL gains an /out/ segment, so every archive-backed item 404s
  //      on its own page while capture stays green — rule 3's failure exactly;
  //   2. it copies the WHOLE delivery — src/, node_modules/, the paid template
  //      itself — into site/, and publish.mjs uploads site/ wholesale. The
  //      `out` splice exists precisely so src/ is never served; a blind copy
  //      re-introduces it one layer down, as a redistribution.
  //
  // Only archives an item actually names are published. An unreferenced
  // directory under archives/ is someone's working copy, not vault content.
  if (prefix === ARCHIVE_PREFIX) {
    for (const name of [...byArchive.keys()].sort()) {
      const built = path.join(from, name, 'out')
      if (!existsSync(built)) {
        console.warn(`  ! archive "${name}": no out/ — ${prefix}${name}/ will 404 in the built site. Build the archive's static export first.`)
        continue
      }
      await cp(built, path.join(to, name), { recursive: true, force: true, filter: publishable })
    }
    continue
  }

  // A vendored library directory missing means node_modules is not installed.
  // Warn rather than throw, so one absent dependency does not turn every build
  // into a stack trace with no mention of which entry caused it.
  if (!existsSync(from)) {
    console.warn(`  ! vendor "${prefix}" → ${dir}/ does not exist — nothing copied to site/${prefix.replaceAll('/', '')}/`)
    continue
  }
  await cp(from, to, { recursive: true, force: true })
}
await writeFile(path.join(SITE, 'items.json'), JSON.stringify(items, null, 2))
await writeFile(path.join(SITE, 'index.html'), await readFile(path.join(ROOT, 'bin', 'grid.html'), 'utf8'))

// ─── Data payload for the web app ──────────────────────────────────────────
// site/index.html above is the zero-dependency grid and stays as it is — it
// works offline and needs no build. What follows is for web/, and is uploaded
// to R2 rather than committed: items/ is gitignored, so Vercel never sees the
// collection and cannot generate any of this at deploy time. The vault is
// entirely R2-resident; the Vercel build contains no vault data at all.

const DATA = path.join(SITE, 'data')
await mkdir(path.join(DATA, 'items'), { recursive: true })

// facets.json carries the minimum needed to filter, search and lay out every
// card, and nothing else. Media URLs are deliberately absent: they derive from
// the slug, and in production every one is a short-lived signed R2 URL minted
// per visible page — baking them in would be both redundant and wrong.
//
// ~130 bytes an item, so ~65KB at 500 items and well under 20KB over the wire.
// Loading it once buys instant client-side filtering with no fetch waterfall,
// which turns pagination into a *rendering* concern — how many cards are in
// the DOM and how many videos are decoding — rather than a fetching one.
const facets = items.map((it) => ({
  slug: it.slug,
  title: it.title,
  effect: it.effect,
  technique: it.technique,
  trigger: it.trigger,
  surface: it.surface,
  weight: it.weight,
  kind: it.kind,
  hasVideo: Boolean(it.video),
  // ~20 bytes a row against the ~130-byte budget, and it buys the grid the
  // right to ask for a 360px file instead of a 600px one. Omitted when empty
  // for the same reason the archive fields are.
  ...(it.videoRungs.length ? { rungs: it.videoRungs } : {}),
  // Three fields so a card can label and filter its family without fetching a
  // single record. Read off `relations`, never off meta.archive, so the facet
  // row and the record are incapable of disagreeing.
  //
  // Omitted entirely when the item has no archive, which is most of them: the
  // budget above is ~130 bytes an item and `"archive":null,"role":null,
  // "relatedCount":0` is another 42 on every row that would never use them.
  // Consumers must already treat all three as optional — facets.json is
  // R2-resident and versions independently of the deployed app, so "field
  // absent" is a permanent state, not a migration.
  ...(it.relations.archive
    ? { archive: it.relations.archive, role: it.relations.role, relatedCount: relatedCount(it.relations) }
    : {}),
}))
await writeFile(path.join(DATA, 'facets.json'), JSON.stringify(facets))

// The controlled vocabulary, derived from what is actually present rather than
// hardcoded — filter chips for tags nothing uses are just noise.
const vocab = (key) =>
  [...new Set(facets.flatMap((f) => [].concat(f[key] ?? [])))].filter(Boolean).sort()

await writeFile(
  path.join(DATA, 'index.json'),
  JSON.stringify({
    count: items.length,
    pageSize: 24,
    builtAt: new Date().toISOString(),
    vocab: {
      effect: vocab('effect'),
      technique: vocab('technique'),
      trigger: vocab('trigger'),
      surface: vocab('surface'),
      weight: vocab('weight'),
      kind: vocab('kind'),
    },
  }),
)

// Full records, one file per item, fetched only when a detail view opens.
// notes.md is the bulk of a record and nobody needs 500 of them to browse.
for (const it of items) {
  await writeFile(path.join(DATA, 'items', `${it.slug}.json`), JSON.stringify(it))
}

// ─── Prune site/ to the index ───────────────────────────────────────────────
//
// build.mjs used to copy and never delete, which was the worst gap in the
// pipeline for two reasons that are not about disk.
//
// 1. RETIRING AN ITEM DID NOT UNPUBLISH IT. When blunt-preloader was retired
//    its media sat here until it was removed by hand — paid third-party source
//    staged for a bucket.
// 2. `pnpm test` built fixtures/ into this same site/, so every test run left
//    11 fixture slugs behind. items/ had 12 slugs against 23 in site/item.
//
// Both are closed, but be precise about what this block does and does not do,
// because the original comment here was wrong in a way that made the first
// problem look solved when it was not:
//
//   * It claimed bin/publish.mjs walks site/. It does not — it walks out/ for
//     media and site/data for the payload. Pruning site/media therefore never
//     stopped a retired item's media from uploading. What stops it is the index
//     filter in publish.mjs, which is where that fix actually lives. out/ is
//     deliberately NOT pruned here: preview.mp4 is the archival record (rule
//     11) and out/ is shared with fixtures, so a prune keyed on this build's
//     slugs would let `pnpm test` delete every real preview.
//   * It claimed site/archive/<name> is cleaned by the archive loop above. It
//     is not: that loop only cp's, and cp merges rather than removes. An
//     archive that no item references any longer stays in site/ until it is
//     deleted by hand. Nothing publishes it, so this is disk rather than
//     exposure — but it is not cleaned, and saying it was is how a reader
//     stops looking.
//
// Neither this prune nor the publish filter can remove an object already in
// R2. Nothing deletes remote objects; that remains open.
//
// Only slugs are pruned, and only in the three directories build.mjs owns.
// vendor/, three/ and lenis/ are written by the VENDOR map and left alone.
{
  const keep = new Set(items.map((i) => i.slug))
  let pruned = 0
  let bytes = 0
  for (const dir of ['item', 'media', 'data/items']) {
    const base = path.join(SITE, dir)
    if (!existsSync(base)) continue
    for (const e of await readdir(base, { withFileTypes: true })) {
      const slug = e.isDirectory() ? e.name : e.name.replace(/\.json$/, '')
      if (keep.has(slug)) continue
      const target = path.join(base, e.name)
      bytes += await sizeOf(target)
      await rm(target, { recursive: true, force: true })
      pruned++
    }
  }
  if (pruned) {
    console.log(`  pruned ${pruned} orphaned path(s) from site/ (${(bytes / 1048576).toFixed(1)}MB) — not in the index`)
  }
}

// Name the tree that was actually written. Hardcoding "site/" here reported a
// fixtures build as though it had replaced the vault, which is precisely the
// confusion the two separate trees exist to remove.
console.log(`built ${items.length} items → ${path.relative(ROOT, SITE)}/`)
console.log(`  data: facets.json (${(JSON.stringify(facets).length / 1024).toFixed(1)}KB) + ${items.length} records`)

// ─── Showcase media for the PUBLIC landing page ────────────────────────────
// The one place this build writes into tracked files, and it needs the reason
// spelled out.
//
// Everything above lands in site/, which is gitignored — Vercel never sees a
// byte of it, and the vault gets its media from R2 through an auth-gated
// route. Neither is available to the public landing page: /api/media is listed
// in proxy.ts PROTECTED, so a poster fetched that way would 302 to /signin for
// an anonymous visitor.
//
// So the handful of previews the landing page is allowed to show have to be
// committed. They are copied here, from out/, for any item that opts in with
// `"showcase": true` in its meta.json — which today means three of the eleven
// fixtures, and nothing licensed. All eleven are MIT under the root LICENSE,
// whose scope section is deliberately narrow: it covers fixtures/ and nothing
// in items/ or archives/, because that is bought source and relicensing it
// would be the redistribution this whole file is arranged to prevent.
// web/src/lib/showcase.ts
// reads the same meta field for titles and checks this directory for media, so
// a missing capture degrades to a titled placeholder instead of a 404.
//
// Copy only, never delete: unpublishing is a git operation, not a side effect
// of a build that happened to run against a different MORGUE_SRC.
const showcase = items.filter((it) => it.showcase === true)
if (showcase.length) {
  const dest = path.join(ROOT, 'web', 'public', 'showcase')
  let copied = 0
  for (const it of showcase) {
    if (it.license !== 'own' && it.license !== 'mit') {
      // A tripwire, not a formality. This directory is committed and served
      // publicly; a paid item reaching it is redistribution.
      console.warn(`  ! ${it.slug}: showcase:true but license "${it.license}" — refusing to publish`)
      continue
    }
    await mkdir(path.join(dest, it.slug), { recursive: true })
    for (const file of ['poster.webp', 'poster.avif', 'preview.mp4']) {
      const from = path.join(ROOT, 'out', it.slug, file)
      if (!existsSync(from)) continue
      await cp(from, path.join(dest, it.slug, file), { force: true })
      copied++
    }
    if (!existsSync(path.join(ROOT, 'out', it.slug, 'poster.webp'))) {
      console.warn(`  ! ${it.slug}: showcase:true but no capture in out/ — the landing page will render a placeholder. Run \`MORGUE_SRC=${SRC} pnpm capture ${it.slug}\`.`)
    }
  }
  console.log(`  showcase: ${copied} file(s) → web/public/showcase/ (commit these — Vercel cannot see out/)`)
}
