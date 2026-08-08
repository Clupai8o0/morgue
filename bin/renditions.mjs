#!/usr/bin/env node
// Derives a size ladder from each item's preview.mp4.
//
//   pnpm renditions                  every item in out/
//   pnpm renditions <slug> [<slug>]  just these
//   pnpm renditions --force          re-encode even when up to date
//   pnpm renditions --json           machine-readable, writes nothing else
//
// WHY A LADDER AT ALL. `pnpm capture` emits one 600px mp4 per item. That is the
// right size for the detail page, where exactly one plays at a time, and the
// wrong size everywhere else: the grid paints tiles about 340px wide and the
// relations strip paints them around 180px, so both were downloading roughly
// 3x and 9x the pixels they can show. gooey-text-reveal is 1,096KB — on a grid
// of twelve that is the difference between a preview that starts on hover and
// one that starts after it.
//
// WHY IT DERIVES FROM preview.mp4 AND NOT FROM frames/:
//
//   - preview.mp4 is the artefact that is always there. `out/<slug>/frames/`
//     is transient and already excluded from site/ by bin/build.mjs; a ladder
//     that can only be rebuilt when frames survive is a ladder that silently
//     stops being rebuildable.
//   - Boomerang comes for free. capture.mjs applies it in the filter graph, so
//     it is baked into the mp4. Re-deriving from frames would mean
//     reimplementing that decision here and keeping the two in step.
//   - The generational loss is invisible at these scales. Every rung is a
//     downscale of at least 1.7x, and the resampler discards more detail than
//     the second x264 pass does.
//
// The archival record is untouched: this only ever WRITES preview-<rung>.mp4
// and never reads or replaces preview.mp4. Same reasoning as rule 11 — the
// thing you keep forever is encoded once, from the best source available at
// the time, and derived artefacts are regenerable.

import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.resolve(ROOT, process.env.MORGUE_OUT || 'out')

// ─── the ladder ──────────────────────────────────────────────────────────────
// Each rung names a surface that actually renders at that size. A rung with no
// consumer is dead weight that still costs encode time and disk, so if one of
// these stops being used, delete it rather than leaving it "just in case".
//
// crf climbs as the picture shrinks: artefacts that would be obvious at 600px
// are sub-pixel at 200px, and the smaller rungs are the ones whose whole
// purpose is to arrive fast.
export const LADDER = [
  { rung: 'xs', width: 200, crf: 32, use: 'relations strip — several at once, ~180px' },
  { rung: 'sm', width: 360, crf: 30, use: 'vault grid tiles — up to twelve at once, ~340px' },
]

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const JSON_OUT = args.includes('--json')
const slugs = args.filter((a) => !a.startsWith('--'))

const run = (cmd, a) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, a, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-1500)))))
  })

const size = async (f) => (existsSync(f) ? (await stat(f)).size : null)
const kb = (b) => (b == null ? '—' : `${Math.round(b / 1024)}KB`)

/**
 * Up to date means: the rung exists AND is newer than the source. mtime rather
 * than a hash because the source is a video we did not write in this process
 * and hashing every mp4 on every run costs more than the occasional redundant
 * encode. `--force` is the escape hatch when that guess is wrong.
 */
async function stale(src, dest) {
  if (FORCE || !existsSync(dest)) return true
  const [a, b] = await Promise.all([stat(src), stat(dest)])
  return b.mtimeMs < a.mtimeMs
}

async function ladderFor(slug) {
  const dir = path.join(OUT, slug)
  const src = path.join(dir, 'preview.mp4')
  if (!existsSync(src)) return { slug, skipped: 'no preview.mp4' }

  const srcBytes = await size(src)
  const rungs = []

  for (const { rung, width, crf } of LADDER) {
    const dest = path.join(dir, `preview-${rung}.mp4`)

    if (!(await stale(src, dest))) {
      rungs.push({ rung, width, bytes: await size(dest), encoded: false })
      continue
    }

    // -2 keeps height even, which yuv420p requires. Lanczos matches the
    // downscale capture.mjs uses so the ladder looks like one family.
    await run('ffmpeg', [
      '-y', '-i', src,
      '-vf', `scale=${width}:-2:flags=lanczos`,
      '-c:v', 'libx264', '-profile:v', 'high', '-crf', String(crf), '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',       // moov first — decode starts on hover, not after
      '-g', '15', '-keyint_min', '15', // currentTime = 0 replay stays instant
      '-an', dest,
    ])

    rungs.push({ rung, width, bytes: await size(dest), encoded: true })
  }

  return { slug, srcBytes, rungs }
}

// ─── main ────────────────────────────────────────────────────────────────────

const all = existsSync(OUT)
  ? (await readdir(OUT, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
  : []

const targets = slugs.length ? slugs : all
if (!targets.length) {
  console.error(`No items in ${path.relative(ROOT, OUT)}/ — run \`pnpm capture <slug>\` first.`)
  process.exit(1)
}

const unknown = targets.filter((s) => !all.includes(s))
if (unknown.length) {
  console.error(`Not captured: ${unknown.join(', ')}\nAvailable: ${all.join(', ')}`)
  process.exit(1)
}

const results = []
for (const slug of targets) results.push(await ladderFor(slug))

if (JSON_OUT) {
  console.log(JSON.stringify({ ladder: LADDER, results }, null, 2))
  process.exit(0)
}

let srcTotal = 0
const rungTotals = new Map(LADDER.map((l) => [l.rung, 0]))
let encoded = 0

const header = ['item', 'full', ...LADDER.map((l) => `${l.rung} (${l.width}w)`)]
console.log(`\n  ${header[0].padEnd(24)}${header.slice(1).map((h) => h.padStart(14)).join('')}`)
console.log(`  ${'─'.repeat(24 + 14 * LADDER.length)}`)

for (const r of results) {
  if (r.skipped) {
    console.log(`  ${r.slug.padEnd(24)}${('— ' + r.skipped).padStart(14)}`)
    continue
  }
  srcTotal += r.srcBytes ?? 0
  const cells = r.rungs.map((x) => {
    rungTotals.set(x.rung, (rungTotals.get(x.rung) ?? 0) + (x.bytes ?? 0))
    if (x.encoded) encoded++
    return `${kb(x.bytes)}${x.encoded ? '' : ' ='}`.padStart(14)
  })
  console.log(`  ${r.slug.padEnd(24)}${kb(r.srcBytes).padStart(14)}${cells.join('')}`)
}

console.log(`  ${'─'.repeat(24 + 14 * LADDER.length)}`)
console.log(
  `  ${'total'.padEnd(24)}${kb(srcTotal).padStart(14)}` +
    LADDER.map((l) => kb(rungTotals.get(l.rung)).padStart(14)).join(''),
)

for (const l of LADDER) {
  const t = rungTotals.get(l.rung) ?? 0
  const pct = srcTotal ? Math.round((1 - t / srcTotal) * 100) : 0
  console.log(`  ${l.rung}: −${pct}% vs full · ${l.use}`)
}
console.log(
  `\n${encoded} rendition(s) encoded, ${results.length * LADDER.length - encoded} already current` +
    ` (marked =). Run \`pnpm build\` to copy them into site/.\n`,
)
