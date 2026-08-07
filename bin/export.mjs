#!/usr/bin/env node
// Prints one item as an agent-ready markdown bundle.
//
//   pnpm export <slug>              → stdout
//   pnpm export <slug> --copy       → clipboard (macOS pbcopy)
//
// Reads the built record from site/data/items/<slug>.json, so the same bytes
// the web app's "Copy for agent" button produces come out here. Run
// `pnpm build` first if the item is new.

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBundle } from './export-bundle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'site', 'data', 'items')

const args = process.argv.slice(2)
const copy = args.includes('--copy')
const slug = args.find((a) => !a.startsWith('--'))

if (!slug) {
  const available = existsSync(DATA)
    ? (await readdir(DATA)).map((f) => f.replace(/\.json$/, ''))
    : []
  console.error('Usage: pnpm export <slug> [--copy]\n')
  console.error(available.length ? `Available:\n  ${available.join('\n  ')}` : 'Nothing built yet — run `pnpm build`.')
  process.exit(1)
}

const file = path.join(DATA, `${slug}.json`)
if (!existsSync(file)) {
  console.error(`No built record for "${slug}". Run \`pnpm build\` first.`)
  process.exit(1)
}

const bundle = buildBundle(JSON.parse(await readFile(file, 'utf8')))

if (copy) {
  const pb = spawn('pbcopy')
  pb.stdin.end(bundle)
  pb.on('close', () => console.error(`copied ${bundle.length} chars to clipboard`))
} else {
  process.stdout.write(bundle + '\n')
}
