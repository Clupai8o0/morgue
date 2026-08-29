#!/usr/bin/env node
// pnpm classify <slug> — fill the two tags ingest.mjs leaves blank on purpose.
//
// `surface` is always left null and `effect` is often left empty, because a wrong tag gets
// trusted while a blank gets filled in (CLAUDE.md). "Filled in" used to mean hand-editing JSON
// against a vocabulary you had to remember; this is the numbered menu instead. It reads the
// SAME lists survey.mjs enforces and runs assertVocab before it saves, so it can only ever
// write the controlled vocabulary — never the free-text rot the vocabulary exists to prevent.

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { stdin, stdout } from 'node:process'
import { EFFECT, SURFACE, assertVocab } from './survey.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ITEMS = path.resolve(ROOT, process.env.MORGUE_ITEMS || 'items')
const slug = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!slug) { console.error('Usage: pnpm classify <slug>'); process.exit(1) }

const metaPath = path.join(ITEMS, slug, 'meta.json')
if (!existsSync(metaPath)) { console.error(`\n✗ no items/${slug}/meta.json — is the slug right?\n`); process.exit(1) }
const meta = JSON.parse(await readFile(metaPath, 'utf8'))

// Pull lines from one async iterator rather than sequential rl.question() calls: the promises
// API drops buffered lines when answers are piped in (`printf '4\n1,5\n' | pnpm classify`),
// which is exactly how this gets scripted and tested. The iterator buffers correctly.
const rl = readline.createInterface({ input: stdin })
const lines = rl[Symbol.asyncIterator]()
const ask = async (prompt) => { stdout.write(prompt); const { value, done } = await lines.next(); return done ? '' : String(value) }
const bail = (m) => { console.error(`  ✗ ${m}`); rl.close(); process.exit(1) }
const menu = (label, list) => {
  console.log(`\n${label}`)
  list.forEach((v, i) => console.log(`  ${String(i + 1).padStart(2)}  ${v}`))
}

// surface — exactly one, "where the effect lives".
let surface = meta.surface
menu(`surface  (one — where the effect lives)   [current: ${meta.surface ?? '—'}]`, SURFACE)
{
  const a = (await ask('  pick one number (Enter keeps current): ')).trim()
  if (a) {
    const i = Number(a) - 1
    if (!Number.isInteger(i) || i < 0 || i >= SURFACE.length) bail('not a valid choice')
    surface = SURFACE[i]
  }
}

// effect — one or more, "what it does".
let effect = Array.isArray(meta.effect) ? meta.effect : []
menu(`effect  (one or more — what it does)   [current: ${effect.join(', ') || '—'}]`, EFFECT)
{
  const a = (await ask('  pick numbers, comma-separated (Enter keeps current): ')).trim()
  if (a) {
    const idx = a.split(',').map((s) => Number(s.trim()) - 1)
    if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= EFFECT.length)) bail('not all valid choices')
    effect = [...new Set(idx.map((i) => EFFECT[i]))]
  }
}
rl.close()

// Spread preserves the existing key order; effect/surface already exist, so they keep their
// place and just take the new values.
const next = { ...meta, effect, surface }
assertVocab(next, `classify ${slug}`) // never write anything outside the vocabulary
await writeFile(metaPath, JSON.stringify(next, null, 2) + '\n')

console.log(`\n✓ items/${slug}/meta.json  ·  surface: ${surface ?? '—'}  ·  effect: ${effect.join(', ') || '—'}`)
if (surface == null || effect.length === 0) console.log('  (still incomplete — run it again to finish)')
console.log('  notes.md still needs the real "How it works" if it is a stub.')
