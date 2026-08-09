#!/usr/bin/env node
// Fixtures are committed as SOURCE; their build output is gitignored. This regenerates it.
//
// Two of the eleven need a build step, and they are in the corpus precisely because they are
// the two that broke the pipeline: React/motion needs bundling, and the Next.js static export
// hardcodes absolute /_next/ URLs that 404 unless assetPrefix matches where it is served.

import { spawn } from 'node:child_process'
import * as esbuild from 'esbuild'
import { cp, rm, readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIX = path.join(ROOT, 'fixtures')

// ─── 0. Every fixture must be ours to give away ────────────────────────────
//
// This check turns a tidiness rule into a licensing one, and it is worth being
// clear about why it is now load-bearing.
//
// CLAUDE.md has always said fixtures/ is "only for items written from scratch
// for this repo". Until 2026-08-09 the cost of breaking that was untidiness.
// Since then two things changed: the root LICENSE grants MIT over fixtures/
// and nothing else, and docs/LOCAL-MODE.md §7 makes this directory the example
// set a public checkout SHIPS and a first run renders. So a third-party item
// landing here is no longer clutter — it is redistribution of somebody else's
// paid work, under a file that says we may.
//
// It runs first, in the script `pnpm test` starts with, so the answer arrives
// before anything is built rather than after everything is.
{
  const bad = []
  for (const e of await readdir(FIX, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const metaPath = path.join(FIX, e.name, 'meta.json')
    if (!existsSync(metaPath)) {
      bad.push(`${e.name}: no meta.json`)
      continue
    }
    const { license } = JSON.parse(await readFile(metaPath, 'utf8'))
    // `own` and `mit` both mean "authored here". The other three values in the
    // vocabulary — paid, unknown, and anything unrecognised — mean it is not
    // ours to relicense.
    if (license !== 'own' && license !== 'mit') bad.push(`${e.name}: license "${license}"`)
  }
  if (bad.length) {
    console.error(
      `\nfixtures/ may hold ONLY code written from scratch for this repo.\n` +
        `The root LICENSE grants MIT over this directory, and local mode ships it\n` +
        `as the example set, so anything else here is redistributed under a licence\n` +
        `we do not hold:\n\n` +
        bad.map((b) => `  · ${b}`).join('\n') +
        `\n\nMove it to items/ (gitignored) — see CLAUDE.md, "Never commit the collection".\n`,
    )
    process.exit(1)
  }
}

// pnpm's nested store means `npx` can resolve the wrong binary; go straight to .bin.
const BIN = (name) => path.join(ROOT, 'node_modules/.bin', name)

const run = (cmd, args, cwd = ROOT) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false })
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))))
  })

// 1. react-motion — esbuild. Use the JS API, not the CLI: under pnpm the .bin/esbuild shim
// resolves to the raw platform binary and Node tries to parse it as JavaScript.
console.log('▸ react-motion (esbuild)')
await esbuild.build({
  entryPoints: [path.join(FIX, 'react-motion/src/app.jsx')],
  outfile: path.join(FIX, 'react-motion/bundle.js'),
  bundle: true, format: 'iife', jsx: 'automatic', minify: true, logLevel: 'error',
})

// 2. nextjs-static — `next build <dir>` reuses the root node_modules, so the fixture needs
//    no install of its own. The export lands in <dir>/out; we flatten it up one level so the
//    item's index.html sits where every other item's does.
console.log('▸ nextjs-static (next build --output export)')
const NEXT_DIR = path.join(FIX, 'nextjs-static')
await run(BIN('next'), ['build', 'fixtures/nextjs-static'])
const OUT = path.join(NEXT_DIR, 'out')
if (existsSync(OUT)) {
  for (const entry of await readdir(OUT)) {
    await cp(path.join(OUT, entry), path.join(NEXT_DIR, entry), { recursive: true, force: true })
  }
  await rm(OUT, { recursive: true, force: true })
  await rm(path.join(NEXT_DIR, '.next'), { recursive: true, force: true })
}

console.log('\nfixtures built')
