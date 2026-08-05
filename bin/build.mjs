#!/usr/bin/env node
// Generates items.json + the static grid. No framework, no dev server, no build step
// for the shell itself — it is one HTML file that reads one JSON file.

import { readFile, writeFile, readdir, cp } from 'node:fs/promises'
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

  items.push({
    slug, ...meta, notes,
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
console.log(`built ${items.length} items → site/`)
