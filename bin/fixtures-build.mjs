#!/usr/bin/env node
// Fixtures are committed as SOURCE; their build output is gitignored. This regenerates it.
//
// Two of the eleven need a build step, and they are in the corpus precisely because they are
// the two that broke the pipeline: React/motion needs bundling, and the Next.js static export
// hardcodes absolute /_next/ URLs that 404 unless assetPrefix matches where it is served.

import { spawn } from 'node:child_process'
import * as esbuild from 'esbuild'
import { cp, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIX = path.join(ROOT, 'fixtures')

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
