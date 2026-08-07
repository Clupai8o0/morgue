#!/usr/bin/env node
// Generates items.json + the static grid. No framework, no dev server, no build step
// for the shell itself — it is one HTML file that reads one JSON file.

import { readFile, writeFile, readdir, cp, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR } from './vendor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.join(ROOT, 'site')
const SRC = process.env.MORGUE_SRC || 'items'

const slugs = (await readdir(path.join(ROOT, SRC), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

const items = []
for (const slug of slugs) {
  const dir = path.join(ROOT, SRC, slug)
  const outDir = path.join(ROOT, 'out', slug)
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))
  const notes = existsSync(path.join(dir, 'notes.md')) ? await readFile(path.join(dir, 'notes.md'), 'utf8') : ''

  // Publish media + the runnable item side by side.
  await cp(outDir, path.join(SITE, 'media', slug), { recursive: true, force: true, filter: (s) => !s.includes('/frames') })
  await cp(dir, path.join(SITE, 'item', slug), { recursive: true, force: true })

  // Source text for the agent export bundle. Only the files meta.json actually
  // declares — an `unextracted` item may sit on 2,000 files and 35MB of JPEG,
  // and inlining that would bloat every record for no benefit.
  const exportFiles = {}
  if (meta.kind === 'static' || meta.kind === 'project') {
    for (const rel of meta.export?.files ?? ['index.html']) {
      const p = path.join(dir, rel)
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

  items.push({
    slug, ...meta, notes, exportFiles,
    poster: `media/${slug}/poster.webp`,
    video: existsSync(path.join(outDir, 'preview.mp4')) ? `media/${slug}/preview.mp4` : null,
    href: `item/${slug}/index.html`,
  })
}

for (const [prefix, dir] of Object.entries(VENDOR)) {
  await cp(path.join(ROOT, dir), path.join(SITE, prefix.replaceAll('/', '')), { recursive: true, force: true })
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

console.log(`built ${items.length} items → site/`)
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
// `"showcase": true` in its meta.json — which today means the three MIT
// fixtures written for that page, and nothing licensed. web/src/lib/showcase.ts
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
