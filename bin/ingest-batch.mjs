#!/usr/bin/env node
// Runs bin/ingest.mjs over a staged set of deliveries.
//
//   node bin/ingest-batch.mjs <staging-dir> --manifest <file.json> [--only 0001,0002]
//   node bin/ingest-batch.mjs <staging-dir> --manifest <file.json> --limit 12 --dry-run
//
// The manifest is the triage output: one record per delivery with { id, kind,
// dir, zip }. Only `static` records are ingested — a Next or Vite delivery is
// an archive and goes through a different pipeline entirely (CLAUDE.md rule 2).
//
// Slugs are derived here rather than in ingest.mjs, and collisions are a hard
// stop rather than a suffix. Two deliveries that want the same slug are almost
// always the same component twice, and silently landing them as `foo` and
// `foo-2` is how a vault gets duplicate cards nobody notices.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ITEMS = path.resolve(ROOT, process.env.MORGUE_ITEMS || 'items')

const argv = process.argv.slice(2)
const VALUE = new Set(['manifest', 'only', 'limit', 'report', 'source-archive-dir', 'prefix', 'slug-overrides'])
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { positional.push(a); continue }
  const eq = a.indexOf('=')
  const n = eq === -1 ? a.slice(2) : a.slice(2, eq)
  if (eq !== -1) flags[n] = a.slice(eq + 1)
  else if (VALUE.has(n)) flags[n] = argv[++i]
  else flags[n] = true
}

const STAGE = positional[0]
if (!STAGE || !flags.manifest) {
  console.error('Usage: node bin/ingest-batch.mjs <staging-dir> --manifest <file.json> [--limit N] [--only ids] [--dry-run]')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(path.resolve(ROOT, flags.manifest), 'utf8'))
const PREFIX = flags.prefix ?? 'cg'

/**
 * id -> slug, or id -> null to skip the delivery entirely.
 *
 * The derivation below is good enough for ~98% of a corpus and then hits two
 * things it cannot know: two tutorials that named their folder the same thing,
 * and a re-upload that supersedes an earlier one. Both are judgement, so they
 * are written down in a file next to the manifest rather than encoded as a
 * cleverer regex or papered over with a `-2` suffix.
 */
const OVERRIDES = flags['slug-overrides']
  ? JSON.parse(await readFile(path.resolve(ROOT, flags['slug-overrides']), 'utf8'))
  : {}
const ARCHIVE_DIR = flags['source-archive-dir'] ?? '~/Downloads/codegrid-components'

/**
 * The delivery's own directory name is the best slug source available: it is
 * what the author called the component ("cg-sidebar-slide-out-menu"), whereas
 * the zip name is the YouTube title ("this-gsap-menu-doesn-t-just-open-it").
 * Strip the author's own prefixes so ours is not doubled.
 */
function slugFor(rec) {
  if (Object.prototype.hasOwnProperty.call(OVERRIDES, rec.id)) return OVERRIDES[rec.id]
  let s = rec.dir
    .toLowerCase()
    .replace(/^(cg|codegrid)[-_ ]+/, '')
    .replace(/[-_ ]+(nextjs|next-js|next|js|vanilla|final|starter|demo|updated)$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // A dir named after nothing in particular ("dist", "project", "01") tells you
  // less than the tutorial title does. Fall back rather than mint `cg-01`.
  if (!s || s.length < 4 || /^\d+$/.test(s)) {
    s = String(rec.zip || rec.id).replace(/^\d+-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  }
  s = s.split('-').slice(0, 6).join('-')
  return `${PREFIX}-${s}`.replace(/-+/g, '-').slice(0, 60).replace(/-+$/, '')
}

let records = manifest
  .filter((r) => r.kind === 'static' || r.kind === 'static-nested')
  .filter((r) => slugFor(r) !== null)
if (flags.only) {
  const want = new Set(String(flags.only).split(',').map((s) => s.trim()))
  records = records.filter((r) => want.has(r.id))
}
if (flags.limit) records = records.slice(0, Number(flags.limit))

// Collisions are resolved BEFORE anything is written, so a run either has a
// clean slug set or stops with the list.
const bySlug = new Map()
for (const r of records) {
  const s = slugFor(r)
  if (!bySlug.has(s)) bySlug.set(s, [])
  bySlug.get(s).push(r)
}
const clashes = [...bySlug.entries()].filter(([, v]) => v.length > 1)
if (clashes.length) {
  console.error(`\n✗ ${clashes.length} slug collision(s) — resolve these before ingesting:\n`)
  for (const [s, rs] of clashes) console.error(`  ${s}\n${rs.map((r) => `      ${r.id}  ${r.dir}`).join('\n')}`)
  process.exit(1)
}

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'bin', 'ingest.mjs'), ...args], { cwd: ROOT })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
  })

// Roll every child's "needs a read" list into one place. ingest.mjs already appends a JSON
// line per item under --report; across a 100-item batch those lists are otherwise buried in
// 100 separate stdout blocks and effectively lost. Point every child at one file, wipe it
// first so a re-run does not accumulate, then read it back once at the end.
const TODO = path.resolve(ROOT, '.ingest/last-batch-todo.jsonl')
await mkdir(path.dirname(TODO), { recursive: true })
await rm(TODO, { force: true })

const report = []
let ok = 0
let failed = 0
for (const r of records) {
  const slug = slugFor(r)
  if (existsSync(path.join(ITEMS, slug))) { console.log(`  skip ${slug} — already present`); continue }
  const args = [
    path.join(STAGE, r.id),
    '--slug', slug,
    '--source-archive', `${ARCHIVE_DIR}/${r.zip}.zip`,
    '--report', TODO,
    ...(flags['dry-run'] ? ['--dry-run'] : []),
  ]
  const { code, out } = await run(args)
  if (code !== 0) { failed++; console.log(`  FAIL ${r.id} → ${slug}\n${out.split('\n').map((l) => '      ' + l).join('\n')}`) }
  else { ok++; process.stdout.write(out) }
  report.push({ id: r.id, slug, kind: r.kind, dir: r.dir, zip: r.zip, code, out: out.trim() })
}

console.log(`\n${ok} ingested, ${failed} failed, ${records.length} considered`)

// The combined follow-up list — the whole point of pointing every child at TODO above.
if (existsSync(TODO)) {
  const pending = (await readFile(TODO, 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => l.unresolved && l.unresolved.length)
  if (pending.length) {
    console.log(`\n⚠ ${pending.length} item(s) still need a human pass before they are really "added":`)
    for (const l of pending) {
      console.log(`  ${l.slug}`)
      for (const u of l.unresolved) console.log(`      · ${u}`)
    }
    console.log(`\n  fill the tags in with: pnpm classify <slug>   ·   full list: ${path.relative(ROOT, TODO)}`)
  }
}

if (flags.report) {
  await mkdir(path.dirname(path.resolve(ROOT, flags.report)), { recursive: true })
  await writeFile(path.resolve(ROOT, flags.report), JSON.stringify(report, null, 1))
  console.log(`report → ${flags.report}`)
}
