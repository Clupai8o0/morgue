#!/usr/bin/env node
// Image optimiser for ingested items. Reports by default; writes nothing at all
// without --write.
//
//   pnpm optimise                       report every item — DRY RUN, writes nothing
//   pnpm optimise <slug>                report one item
//   pnpm optimise <slug> --refs         reference + computed-path scan only
//   pnpm optimise --dedup               byte-identical inventory
//   pnpm optimise <slug> --write        optimised tree → out/optimised/<slug>/
//   pnpm optimise <slug> --write --in-place --yes --backup <dir>
//
// The dry-run default is not politeness. items/ is paid third-party source that
// exists on one disk with no backup, and 92.7% of its bytes are the JPEGs this
// script rewrites. A bad pass is unrecoverable, so the destructive path costs
// four explicit flags and the safe path costs none.
//
// ORDER: capture → optimise → build → check. `pnpm capture` must see the
// ORIGINAL bytes — the poster is encoded at deviceScaleFactor 2 and
// out/<slug>/preview.mp4 is the archival visual record of the item. Optimise
// before capture and you degrade the one artefact you keep forever.
//
// WHY THE DEFAULT KEEPS THE FILENAME AND THE FORMAT:
// archives/blunt-main/src/components/HeroSpotlight/HeroSpotlight.js:23 builds
// its paths with a template literal —
//   `/images/showreel/showreel_img_${i + 1}.jpg`
// — and the same computed form survives minification into
// _next/static/chunks/*.js. For those ten files the string "showreel_img_1.jpg"
// does not exist anywhere in the tree, so no substitution can repair a rename;
// it 404s at runtime after hydration, which `pnpm check` (one route, 1.4s)
// cannot see. --format + --allow-rename exist, print that scan first, and
// refuse every file they cannot prove safe. Keeping the name still captures the
// headline win: livespot360-reveal is over-QUALITY (1.48 bpp at 4:4:4), not
// over-format, and recompression alone takes it from 34.97MB to ~0.35MB.

import sharp from 'sharp'
import { readFile, writeFile, readdir, mkdir, stat, link, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// The encoder, the format table, the width ladder and the cache key all live in
// one file now, because bin/build.mjs re-encodes on the way into site/ on every
// build and a second copy of this would drift (rule 3).
import { RASTER, EXT_FOR, BUCKETS, bucket, md5, walk, createEncoder } from './image-encode.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Absolute MORGUE_SRC is honoured so this can be pointed at a throwaway copy
// for testing without ever aiming it at the real collection.
const SRC = path.resolve(ROOT, process.env.MORGUE_SRC || 'items')

// ─── args ────────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['max-width', 'quality', 'format', 'out', 'backup', 'budget', 'cache-dir'])
const positional = []
const flags = {}
{
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { positional.push(a); continue }
    const eq = a.indexOf('=')
    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq))
    if (eq !== -1) flags[name] = a.slice(eq + 1)
    else if (VALUE_FLAGS.has(name)) flags[name] = argv[++i]
    else flags[name] = true
  }
}

const WRITE = flags.write === true
const IN_PLACE = flags['in-place'] === true
const JSON_OUT = flags.json === true
const MAX_WIDTH = Number(flags['max-width'] ?? 2560)
const QUALITY = Number(flags.quality ?? 82)
const FORMAT = String(flags.format ?? 'keep')
const ALLOW_RENAME = flags['allow-rename'] === true
const OUT_DIR = path.resolve(ROOT, flags.out ?? path.join('out', 'optimised'))
const CACHE_DIR = path.resolve(ROOT, flags['cache-dir'] ?? path.join('out', '.optimise-cache'))
const USE_CACHE = flags['no-cache'] !== true
const BUDGET_MB = flags.budget == null ? null : Number(flags.budget)

// Text we know how to rewrite safely. Anything not in here is searched as raw
// BYTES for references instead — a reference we can find but not edit has to
// veto the rename, and silently missing it is exactly the 404 this guards.
const REWRITABLE = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.txt', '.md', '.svg', '.webmanifest', '.xml'])

const bytes = (n) =>
  n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1048576).toFixed(2)}MB`
const delta = (from, to) => (from === 0 ? '  0.0%' : `${(((to - from) / from) * 100).toFixed(1)}%`)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ─── tree ────────────────────────────────────────────────────────────────────

function allSlugs() {
  return readdir(SRC, { withFileTypes: true }).then((e) =>
    // Directories only — items/ also holds .gitkeep, and readdir hands it back
    // like any other entry. Same filter build.mjs and check.mjs use.
    e.filter((d) => d.isDirectory()).map((d) => d.name).sort(),
  )
}

// ─── planning ────────────────────────────────────────────────────────────────

/**
 * Per-file overrides, hand-written or produced by a probe run. Read-only: this
 * script never writes into items/, so a plan is something you author and keep.
 * `pin` is how you protect the one image that actually goes fullscreen — in
 * livespot360-reveal nine of ten images never exceed 275x150 CSS px but img10
 * expands to the full viewport, and shrinking it with the others is the one
 * change a viewer would notice.
 */
async function loadPlan(dir) {
  const p = path.join(dir, 'optimise.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch (e) {
    console.warn(`  ! optimise.json is not valid JSON — ignored (${e.message})`)
    return null
  }
}

function planFor(rel, meta, plan) {
  const over = plan?.files?.[rel] ?? {}
  if (over.skip) return null
  const pinned = plan?.pin?.includes(rel)
  const quality = Number(over.quality ?? plan?.defaults?.quality ?? QUALITY)
  // A pinned file only ever gets the global cap. Probe data is a floor, not a
  // ceiling — the probe visits one route at one viewport, and blunt-main
  // has seven routes, so "never seen large" is not "never large".
  const capRaw = pinned ? MAX_WIDTH : Number(over.maxWidth ?? plan?.defaults?.maxWidth ?? MAX_WIDTH)
  const cap = bucket(capRaw)
  const format = FORMAT === 'keep' ? meta.format : FORMAT
  return {
    width: meta.width > cap ? cap : null, // null = leave at native size
    quality,
    format,
    ext: EXT_FOR[format] ?? path.extname(rel),
  }
}

// ─── encoding ────────────────────────────────────────────────────────────────

// One run, 74 raster files, 33 unique encodes — hence the memo inside. The
// cache is written only on a real run: a dry run promises to write nothing, and
// "nothing except a cache" is not nothing.
const { encode } = createEncoder({
  cacheDir: USE_CACHE ? CACHE_DIR : null,
  persist: WRITE,
})

// ─── reference scanning ──────────────────────────────────────────────────────

// A `${…}` (or a `+` concatenation) sitting inside what resolves to an image
// path. These are the paths that exist only at runtime, and they are the whole
// reason renaming is opt-in.
const COMPUTED_TEMPLATE = /\$\{[^}\n]{0,120}\}[A-Za-z0-9._/-]{0,40}?\.(jpe?g|png|webp|avif|gif)\b/gi
const COMPUTED_CONCAT = /\+\s*["'][^"'\n]{0,24}\.(jpe?g|png|webp|avif|gif)["']/gi

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length
}

/** The literal text between the opening quote/backtick and the `${`. */
function staticPrefix(text, at) {
  let i = at
  while (i > 0 && !'`"\'\n'.includes(text[i - 1])) i--
  return text.slice(i, at)
}

/** Turn `/item/<slug>/images/showreel/showreel_img_` into `images/showreel/showreel_img_`. */
function guardFrom(prefix, slug) {
  let s = prefix.replace(/^https?:\/\/[^/]+/, '')
  s = s.replace(new RegExp(`^/?item/${esc(slug)}/`), '')
  s = s.replace(/^[./]+/, '')
  // Too little static text to attribute to any directory — guard everything
  // rather than guess. A wrong guess here is a runtime 404 in the built site.
  if (!s.includes('/') && s.length < 4) return ''
  return s
}

async function scanComputed(dir, files, slug) {
  const hits = []
  for (const rel of files) {
    if (!REWRITABLE.has(path.extname(rel).toLowerCase())) continue
    const text = await readFile(path.join(dir, rel), 'utf8').catch(() => null)
    if (text == null) continue
    for (const m of text.matchAll(COMPUTED_TEMPLATE)) {
      const prefix = staticPrefix(text, m.index)
      hits.push({ rel, line: lineAt(text, m.index), snippet: (prefix + m[0]).slice(-72), guard: guardFrom(prefix, slug) })
    }
    for (const m of text.matchAll(COMPUTED_CONCAT)) {
      // Concatenation gives us no reliable static prefix — the literal that
      // holds the directory may be several tokens back, or a variable. Guard
      // the whole item and let a human read the line.
      hits.push({ rel, line: lineAt(text, m.index), snippet: m[0].slice(0, 72), guard: '' })
    }
  }
  return hits
}

/**
 * Decide which renames are safe, and rewrite every reference to the ones that
 * are. Returns { renames, refused, rewritten }.
 *
 * Two reference forms are handled: the item-relative path (`assets/img1.jpg`,
 * which is a substring of `/item/<slug>/assets/img1.jpg` and of `./assets/…`)
 * and the bare basename, which CSS `url(img1.jpg)` uses. The bare form is only
 * usable when the basename is unique in the item — otherwise the reference is
 * genuinely ambiguous and the rename is refused rather than guessed.
 */
async function planRenames(dir, files, slug, candidates, computed) {
  const buffers = new Map()
  const read = async (rel) => {
    if (!buffers.has(rel)) buffers.set(rel, await readFile(path.join(dir, rel)))
    return buffers.get(rel)
  }

  // basename → every file in the tree that has it. A repeated basename is only
  // a problem for references that use the bare form; a reference that spells
  // out a path is unambiguous no matter how many files share the last segment,
  // and in a Next tree basenames repeat constantly (blunt-main has seven
  // byte-identical JPEGs under seven different directories).
  const byBase = new Map()
  for (const rel of files) {
    const b = path.basename(rel)
    if (!byBase.has(b)) byBase.set(b, [])
    byBase.get(b).push(rel)
  }

  const renames = new Map()
  const refused = []
  for (const [rel, newRel] of candidates) {
    const base = path.basename(rel)
    const guarded = computed.find((h) => h.guard === '' || rel.startsWith(h.guard))
    if (guarded) {
      refused.push([rel, `computed path at ${guarded.rel}:${guarded.line} — no string to rewrite`])
      continue
    }
    let bad = null
    for (const f of files) {
      if (f === rel) continue
      const buf = await read(f)
      if (REWRITABLE.has(path.extname(f).toLowerCase())) {
        const text = buf.toString('utf8')
        if (!text.includes(base)) continue
        // Strip every path form of that basename first. What is left is a bare
        // reference — `url(img1.jpg)` — and if two files share the basename
        // there is no way to know which one it means. Refuse rather than guess.
        const siblings = byBase.get(base)
        if (siblings.length > 1 && siblings.reduce((t, s) => t.replaceAll(s, ''), text).includes(base)) {
          bad = `bare "${base}" in ${f} is ambiguous (${siblings.length} files share it)`
          break
        }
      } else if (buf.includes(base)) {
        bad = `referenced from non-rewritable ${f}`
        break
      }
    }
    if (bad) refused.push([rel, bad])
    else renames.set(rel, newRel)
  }

  // Apply. Longest key first so `a/b/img1.jpg` is consumed before bare `img1.jpg`.
  const rewritten = new Map()
  if (renames.size) {
    const subs = []
    for (const [rel, newRel] of renames) {
      subs.push([new RegExp(`(?<![A-Za-z0-9._~-])${esc(rel)}(?![A-Za-z0-9._-])`, 'g'), newRel])
      const base = path.basename(rel)
      if (byBase.get(base).length === 1) {
        subs.push([new RegExp(`(?<![A-Za-z0-9._~-])${esc(base)}(?![A-Za-z0-9._-])`, 'g'), path.basename(newRel)])
      }
    }
    for (const f of files) {
      if (!REWRITABLE.has(path.extname(f).toLowerCase())) continue
      const before = (await read(f)).toString('utf8')
      let after = before
      for (const [re, to] of subs) after = after.replace(re, to)
      if (after !== before) rewritten.set(f, after)
    }
  }
  return { renames, refused, rewritten }
}

// ─── analysis ────────────────────────────────────────────────────────────────

async function analyse(slug) {
  const dir = path.join(SRC, slug)
  const files = await walk(dir)
  const plan = await loadPlan(dir)
  const rows = []

  for (const rel of files) {
    if (!RASTER.has(path.extname(rel).toLowerCase())) continue
    const buf = await readFile(path.join(dir, rel))
    let meta
    try {
      meta = await sharp(buf, { failOn: 'none' }).metadata()
    } catch (e) {
      console.warn(`  ! ${rel}: unreadable as an image — left alone (${e.message})`)
      continue
    }
    // An animated WebP/GIF would be silently flattened to frame 1: the file
    // gets smaller and the animation disappears. Refuse, loudly.
    if ((meta.pages ?? 1) > 1) {
      rows.push({ rel, meta, size: buf.length, out: buf.length, action: 'skip', note: 'animated' })
      continue
    }
    const p = planFor(rel, meta, plan)
    if (!p) {
      rows.push({ rel, meta, size: buf.length, out: buf.length, action: 'skip', note: 'plan: skip' })
      continue
    }
    if (p.format === 'jpeg' && meta.hasAlpha) {
      rows.push({ rel, meta, size: buf.length, out: buf.length, action: 'skip', note: 'has alpha, jpeg would flatten it' })
      continue
    }
    const enc = await encode(buf, p)
    // Never emit a file larger than the input. Measured: 7 of 33 unique images
    // GREW under a plain q82/2560 pass — blunt-main is already at 0.026
    // bpp, so re-encoding it buys nothing and costs bytes.
    if (enc.length >= buf.length) {
      rows.push({ rel, meta, size: buf.length, out: buf.length, action: 'keep', note: 'would grow', hash: md5(buf), bytes: buf })
      continue
    }
    const newRel = p.ext === path.extname(rel).toLowerCase() ? rel : rel.slice(0, -path.extname(rel).length) + p.ext
    rows.push({
      rel, meta, plan: p, size: buf.length, out: enc.length,
      action: newRel === rel ? 'encode' : 'rename', newRel,
      hash: md5(enc), bytes: enc,
    })
  }
  return { slug, dir, files, rows, plan }
}

// ─── output ──────────────────────────────────────────────────────────────────

function report(a) {
  const { slug, rows } = a
  const inSum = rows.reduce((n, r) => n + r.size, 0)
  const outSum = rows.reduce((n, r) => n + r.out, 0)
  if (!rows.length) {
    console.log(`${slug} — no raster images`)
    return { inSum, outSum, dupe: 0 }
  }

  // Identical OUTPUT bytes are reclaimable by hardlink at write time; no
  // reference changes, no risk. 41 of 74 raster files in the collection are
  // byte-identical copies of another.
  const seen = new Set()
  let dupe = 0
  for (const r of rows) {
    if (!r.hash) continue
    if (seen.has(r.hash)) dupe += r.out
    else seen.add(r.hash)
  }

  console.log(`\n${slug} — ${rows.length} raster file(s), ${bytes(inSum)}`)
  const w = Math.max(...rows.map((r) => r.rel.length), 4)
  console.log(`  ${'file'.padEnd(w)}  ${'stored'.padStart(11)}  ${'plan'.padEnd(14)}  ${'out'.padStart(9)}  ${'change'.padStart(7)}`)
  for (const r of rows.sort((x, y) => y.size - x.size)) {
    const dims = `${r.meta.width}x${r.meta.height}`
    const what =
      r.action === 'skip' || r.action === 'keep'
        ? r.note
        : `${r.plan.width ? `${r.plan.width}w` : 'native'} q${r.plan.quality}${r.action === 'rename' ? ' →' + r.plan.ext : ''}`
    const change = r.action === 'skip' || r.action === 'keep' ? '     —' : delta(r.size, r.out)
    console.log(
      `  ${r.rel.padEnd(w)}  ${dims.padStart(11)}  ${what.padEnd(14)}  ${bytes(r.out).padStart(9)}  ${change.padStart(7)}`,
    )
  }
  console.log(`  ${'─'.repeat(w + 48)}`)
  console.log(`  ${`${rows.length} files`.padEnd(w)}  ${bytes(inSum).padStart(11)}  ${''.padEnd(14)}  ${bytes(outSum).padStart(9)}  ${delta(inSum, outSum).padStart(7)}`)
  if (dupe) console.log(`  + ${bytes(dupe)} of the output is byte-identical copies — hardlinked on write`)
  return { inSum, outSum, dupe }
}

async function dedupReport(slugs) {
  const groups = new Map()
  for (const slug of slugs) {
    for (const rel of await walk(path.join(SRC, slug))) {
      const buf = await readFile(path.join(SRC, slug, rel))
      const h = md5(buf)
      if (!groups.has(h)) groups.set(h, { size: buf.length, files: [] })
      groups.get(h).files.push(`${slug}/${rel}`)
    }
  }
  let waste = 0
  const dups = [...groups.values()].filter((g) => g.files.length > 1).sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1))
  for (const g of dups) {
    waste += g.size * (g.files.length - 1)
    console.log(`  x${g.files.length} @ ${bytes(g.size)}  ${g.files.join('\n' + ' '.repeat(20))}`)
  }
  console.log(`\n${dups.length} duplicate group(s), ${bytes(waste)} reclaimable`)
}

// ─── writing ─────────────────────────────────────────────────────────────────

async function writeTree(a, renamePlan) {
  const dest = path.join(OUT_DIR, a.slug)
  const byHash = new Map()
  let linked = 0
  for (const rel of a.files) {
    const row = a.rows.find((r) => r.rel === rel)
    const rewritten = renamePlan?.rewritten.get(rel)
    const outRel = (row && renamePlan?.renames.get(rel)) ?? rel
    const to = path.join(dest, outRel)
    await mkdir(path.dirname(to), { recursive: true })

    if (row && row.bytes) {
      // Identical output bytes are hardlinked to each other — never to items/.
      // A hardlink out of the source would mean any later edit to the optimised
      // copy silently rewrites the paid original.
      const first = byHash.get(row.hash)
      if (first) {
        await link(first, to).catch(() => writeFile(to, row.bytes))
        linked++
      } else {
        await writeFile(to, row.bytes)
        byHash.set(row.hash, to)
      }
    } else if (rewritten != null) {
      await writeFile(to, rewritten)
    } else {
      await copyFile(path.join(a.dir, rel), to)
    }
  }
  console.log(`  wrote ${a.files.length} files → ${path.relative(ROOT, dest)}/${linked ? ` (${linked} hardlinked)` : ''}`)
}

async function writeInPlace(a) {
  // In-place NEVER renames, never deletes, never touches a non-image. A rename
  // here would unlink paid source and edit files that the next `next build`
  // regenerates anyway; the shrink is the whole value and it needs none of that.
  if (!flags.yes || !flags.backup) {
    console.error('--in-place needs --yes and --backup <dir>. It overwrites paid source that has no backup.')
    process.exit(1)
  }
  const meta = JSON.parse(await readFile(path.join(a.dir, 'meta.json'), 'utf8').catch(() => '{}'))
  const declared = new Set(meta.export?.files ?? [])
  const backup = path.resolve(ROOT, flags.backup, a.slug)
  let n = 0
  for (const r of a.rows) {
    if (!r.bytes || r.action !== 'encode') continue
    // _next/ is regenerable build output and declared export files are what the
    // agent bundle inlines. Neither is ours to overwrite.
    if (r.rel.startsWith('_next/') || declared.has(r.rel)) {
      console.log(`  refuse ${r.rel} — ${r.rel.startsWith('_next/') ? 'build output' : 'declared in export.files'}`)
      continue
    }
    const src = path.join(a.dir, r.rel)
    const bak = path.join(backup, r.rel)
    await mkdir(path.dirname(bak), { recursive: true })
    await copyFile(src, bak)
    // Verify the backup before touching the original. This is the one place in
    // the repo where getting it wrong destroys something unrecoverable.
    const check = await readFile(bak)
    if (check.length !== r.size) {
      console.error(`  ABORT ${r.rel}: backup is ${check.length}B, original ${r.size}B`)
      process.exit(1)
    }
    await writeFile(src, r.bytes)
    n++
  }
  console.log(`  rewrote ${n} image(s) in place · originals in ${path.relative(ROOT, backup)}/`)
}

// ─── main ────────────────────────────────────────────────────────────────────

if (!existsSync(SRC)) {
  console.error(`No source directory at ${SRC}`)
  process.exit(1)
}
const slugs = positional.length ? positional : await allSlugs()
for (const s of slugs) {
  if (existsSync(path.join(SRC, s))) continue
  console.error(`No item "${s}" in ${path.relative(ROOT, SRC)}/`)
  process.exit(1)
}

if (flags.dedup) {
  await dedupReport(slugs)
  process.exit(0)
}

if (FORMAT !== 'keep' && !ALLOW_RENAME) {
  console.error(`--format ${FORMAT} changes file extensions. Re-run with --allow-rename and read the scan it prints first.`)
  process.exit(1)
}

let totalIn = 0
let totalOut = 0
const json = []

for (const slug of slugs) {
  const dir = path.join(SRC, slug)

  if (flags.refs) {
    const files = await walk(dir)
    const hits = await scanComputed(dir, files, slug)
    console.log(`\n${slug} — ${files.length} files, ${hits.length} computed image path(s)`)
    for (const h of hits) console.log(`  ${h.rel}:${h.line}  ${h.snippet}${h.guard ? `\n      guards ${h.guard}*` : '\n      guards the whole item (concatenated path)'}`)
    continue
  }

  const a = await analyse(slug)
  const sums = report(a)
  totalIn += sums.inSum
  totalOut += sums.outSum
  json.push({ slug, in: sums.inSum, out: sums.outSum, files: a.rows.map((r) => ({ file: r.rel, action: r.action, in: r.size, out: r.out, note: r.note ?? null })) })

  let renamePlan = null
  const candidates = a.rows.filter((r) => r.action === 'rename').map((r) => [r.rel, r.newRel])
  if (candidates.length) {
    const computed = await scanComputed(dir, a.files, slug)
    if (computed.length) {
      console.log(`\n  computed image paths in ${slug} — these cannot be rewritten by substitution:`)
      for (const h of computed) console.log(`    ${h.rel}:${h.line}  ${h.snippet}`)
    }
    renamePlan = await planRenames(dir, a.files, slug, candidates, computed)
    for (const [rel, why] of renamePlan.refused) {
      console.log(`  SKIP rename ${rel} — ${why}`)
      const row = a.rows.find((r) => r.rel === rel)
      // The bytes are still good; only the extension change is unsafe. Fall back
      // to the same encode under the original name rather than losing the win.
      const p = { ...row.plan, format: row.meta.format, ext: path.extname(rel) }
      row.bytes = await encode(await readFile(path.join(dir, rel)), p)
      row.out = row.bytes.length
      row.hash = md5(row.bytes)
      row.action = 'encode'
      renamePlan.renames.delete(rel)
    }
  }

  if (WRITE) {
    if (IN_PLACE) await writeInPlace(a)
    else await writeTree(a, renamePlan)
  }
}

if (flags.refs) process.exit(0)

if (JSON_OUT) console.log(JSON.stringify(json, null, 2))
console.log(
  `\n${slugs.length} item(s): ${bytes(totalIn)} → ${bytes(totalOut)} (${delta(totalIn, totalOut)})`,
)
if (!WRITE) console.log('Dry run — nothing was written. Pass --write to produce out/optimised/.')

if (BUDGET_MB != null && totalOut > BUDGET_MB * 1048576) {
  console.error(`\nOVER BUDGET: ${bytes(totalOut)} of images, budget ${BUDGET_MB}MB`)
  process.exit(1)
}
