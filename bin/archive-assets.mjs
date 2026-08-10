#!/usr/bin/env node
// Post-build asset prefixing for an archive's static export.
//
//   pnpm archive:assets <archive> [--dir out] [--dry-run]
//   pnpm archive:assets deadlock-studios
//
// This is the promotion archives/blunt-main/morgue-rewrite.mjs asked for in its
// own header, and it was overdue: `archives/*` is gitignored, so until now the
// only copies of this logic lived in untracked working directories. A fresh
// clone had none of it, and the four existing copies had already drifted —
// deadlock's added an esc(), an HTML-only LITERALS pass and eight ROOTS that
// blunt's does not have. That is CLAUDE.md rule 3's failure mode (two copies of
// a map drift, invisibly) applied to a build step instead of a vendor map.
//
// ─── WHY A REWRITE OVER out/ EXISTS AT ALL ──────────────────────────────────
//
// `basePath` rewrites next/link hrefs, every /_next/ chunk, and the app-metadata
// favicon. Measured on a purpose-built probe route, it does NOT rewrite
// hand-written <img src="/images/…">, next/image src (images.unoptimized is
// mandatory under output:"export", so the default loader emits the raw src), or
// raw <a href>. CLAUDE.md rule 2.
//
// Rewriting those in src/ would work for most of them and miss the ones built
// from template literals — `/images/showreel/showreel_img_${i + 1}.jpg` survives
// minification into _next/static/chunks with no complete string anywhere in the
// source (CLAUDE.md rule 11, twice confirmed). A pass over the BUILT tree is
// anchored on the path rather than on a quote, so it catches those for free and
// leaves src/ diffable against the paid delivery.
//
// ─── WHY THE CONFIG IS DERIVED, NOT WRITTEN DOWN ────────────────────────────
//
// The four hand-maintained copies each carried a literal list of asset roots.
// Checked against the archives they belong to, every one of those lists is
// exactly the set of directories in that archive's public/:
//
//   backrooms         images, models, sounds, trailer          = its 4 ROOTS
//   deadlock-studios  accordion, brief, catalog, featured-work,
//                     fonts, spiral, team, trail-images        = its 8 ROOTS
//   deadlock-studios  logo.png, logo-type.png (root files)     = its 2 asset LITERALS
//
// So the list was never a judgement call — it was a directory listing, copied
// out by hand and then at risk of going stale the moment somebody adds a folder
// to public/. Deriving it means a new asset directory cannot be forgotten, and
// it is why this scales to eight more archives without eight more edits.
//
// What is NOT derivable is a raw <a href> to a ROUTE: /brief is a page, not a
// file, so nothing in public/ implies it. Those go in morgue-assets.json.

import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveMount, VENDOR, ARCHIVE_PREFIX } from './vendor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARCHIVES = path.join(ROOT, VENDOR[ARCHIVE_PREFIX])

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const val = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1] }
const name = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--dir')

if (!name) {
  console.error('Usage: pnpm archive:assets <archive> [--dir out] [--dry-run]\n')
  const available = existsSync(ARCHIVES)
    ? (await readdir(ARCHIVES, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    : []
  console.error(available.length ? `Archives:\n  ${available.join('\n  ')}` : 'No archives yet.')
  process.exit(1)
}

const archiveDir = path.join(ARCHIVES, name)
if (!existsSync(archiveDir)) {
  console.error(`✗ No such archive: archives/${name}`)
  process.exit(1)
}

// The mount comes from bin/vendor.mjs, never from a string typed here. capture,
// build and this rewrite must agree about where an archive lives, and that
// agreement is the entire reason vendor.mjs exists.
const prefix = archiveMount(name)

const builtDir = path.join(archiveDir, val('--dir', 'out'))
if (!existsSync(builtDir)) {
  console.error(`✗ ${path.relative(ROOT, builtDir)} does not exist — run the archive's \`next build\` first.`)
  process.exit(1)
}

// ─── config ─────────────────────────────────────────────────────────────────
// Optional. Only for what a directory listing cannot imply.
const CONFIG = path.join(archiveDir, 'morgue-assets.json')
const cfg = existsSync(CONFIG) ? JSON.parse(await readFile(CONFIG, 'utf8')) : {}
const extraRoots = cfg.extraRoots ?? []
const extraLiterals = cfg.extraLiterals ?? []
const ignore = new Set(cfg.ignore ?? [])

// ─── derive from public/ ────────────────────────────────────────────────────
const publicDir = path.join(archiveDir, 'public')
const derivedRoots = []
const derivedLiterals = []
if (existsSync(publicDir)) {
  for (const e of await readdir(publicDir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue          // .DS_Store and friends
    if (e.isDirectory()) derivedRoots.push(`/${e.name}/`)
    else derivedLiterals.push(`/${e.name}`)
  }
}

const ROOTS = [...new Set([...derivedRoots, ...extraRoots])].filter((r) => !ignore.has(r)).sort()
const LITERALS = [...new Set([...derivedLiterals, ...extraLiterals])].filter((l) => !ignore.has(l))
  // Longest first, so '/brief/x.jpg' can never be half-eaten by '/brief'. ROOTS
  // carry a trailing slash and LITERALS do not, which already separates the
  // directory /brief/ from the route /brief — but only if nothing shorter runs
  // first, and sorting makes that structural rather than lucky.
  .sort((a, b) => b.length - a.length)

// .txt are RSC payloads and .js are minified chunks; both carry these strings,
// and missing either leaves the route broken after hydration rather than on
// first paint — worse, because `pnpm check` loads one route for 1.4s.
const EXT = new Set(['.html', '.js', '.txt', '.css', '.json'])
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function* walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const dry = flag('--dry-run')
console.error(`${dry ? 'DRY RUN — ' : ''}${path.relative(ROOT, builtDir)} → ${prefix}`)
console.error(`  roots    ${ROOTS.length ? ROOTS.join(' ') : '(none)'}`)
console.error(`  literals ${LITERALS.length ? LITERALS.join(' ') : '(none)'}`)
if (extraRoots.length || extraLiterals.length) console.error(`  (${extraRoots.length + extraLiterals.length} from morgue-assets.json)`)
if (!ROOTS.length && !LITERALS.length) {
  console.error('\nNothing to rewrite: public/ is empty or absent. That is a real answer for an')
  console.error('archive whose assets all live under src/ and go through the bundler.\n')
  process.exit(0)
}

let files = 0
let refs = 0
const perToken = new Map()
for await (const file of walk(builtDir)) {
  if (!EXT.has(path.extname(file))) continue
  const before = await readFile(file, 'utf8')
  let after = before

  // ROOTS are global — an asset path is an asset path in HTML and in JS alike.
  // Negative lookbehind on the prefix makes a second run a no-op, which matters
  // because `next build` does not clean out/ of files it no longer emits, so a
  // rebuild-then-rewrite would otherwise double-prefix any survivor.
  for (const root of ROOTS) {
    after = after.replaceAll(new RegExp(`(?<!${esc(prefix)})${esc(root)}`, 'g'), prefix + root)
  }

  // LITERALS ARE HTML-ONLY, AND THAT IS THE WHOLE POINT.
  //
  // A raw `<a href="/brief">` in the emitted HTML needs the prefix, because
  // basePath does not touch it. The SAME string inside a JS chunk must be left
  // alone: it feeds next/link and router.push, which apply basePath themselves.
  // Prefixing both means the client router prefixes an already-prefixed path
  // and requests /archive/<name>/archive/<name>/brief — a 404 that appears only
  // after hydration, on one route out of five, and never in the built HTML, so
  // grepping out/ for the doubled string finds nothing. Caught by `pnpm check`'s
  // click-through, which is what rule 2 put it there for.
  if (path.extname(file) === '.html') {
    for (const lit of LITERALS) {
      // Idempotent by construction, no lookbehind needed: after one pass the
      // character before the token is part of the prefix, not a quote.
      after = after.replaceAll(
        new RegExp(`(["'\`])${esc(lit)}\\1`, 'g'),
        (_m, q) => q + prefix + lit + q,
      )
    }
  }

  if (after === before) continue
  for (const t of [...ROOTS, ...LITERALS]) {
    const n = after.split(prefix + t).length - 1
    if (n) perToken.set(t, (perToken.get(t) ?? 0) + n)
  }
  for (const t of [...ROOTS, ...LITERALS]) refs += after.split(prefix + t).length - 1
  if (!dry) await writeFile(file, after)
  files++
}

// Which tokens actually matched. A derived root that never fires is not an
// error — public/ can hold a directory nothing references — but seeing the zero
// is how you notice an asset directory whose paths are built somewhere this
// pass cannot reach.
const unused = [...ROOTS, ...LITERALS].filter((t) => !perToken.has(t))
console.error(`${dry ? 'would rewrite' : 'rewrote'} ${refs} ref(s) across ${files} file(s)`)
for (const [t, n] of [...perToken].sort((a, b) => b[1] - a[1])) console.error(`    ${String(n).padStart(5)}  ${t}`)
if (unused.length) console.error(`  matched nothing: ${unused.join(' ')}`)
