#!/usr/bin/env node
// Surveys a template archive and PROPOSES extractable candidates.
//
//   pnpm survey <archive>            → archives/<archive>/candidates.json
//   pnpm survey archives/blunt-main  (any path works; output still goes to archives/)
//
// Flags: --json (stdout, write nothing) · --all (no cap) · --only <id> · --quiet
//
// This command NEVER writes items/. It proposes; `pnpm extract` materialises.
// Splitting it that way is the whole point: an agent that can write items/
// unattended will eventually fill it with plausible garbage, and the review
// file between the two commands is the place a human says no.
//
// ─── Why there is no parser dependency ──────────────────────────────────────
// The obvious implementation is acorn + acorn-jsx. Neither is importable from
// this repo (they exist in the pnpm store only transitively) and adding
// devDependencies is out of scope here, so the analysis runs on a lexical
// scrubber instead: `scrub()` blanks comments, string bodies, template bodies
// and regex bodies while preserving every byte offset, which makes ordinary
// regexes over the result structurally reliable. It cannot do scope analysis,
// so every conclusion below is stated as evidence with a file:line you can go
// and read, never as a fact you are asked to trust.
//
// ─── Why detectors are closure-scoped, never file-scoped ────────────────────
// Measured over archives/blunt-main/src (32 JS, 30 CSS): gsap.registerPlugin
// fires in 17 files, useLenis in 13, and 25 of 30 stylesheets read a custom
// property they do not define. Reported per file that is noise which tags
// everything — the exact rot CLAUDE.md's controlled-vocabulary section exists
// to prevent. Reported over ONE candidate's transitive closure the identical
// detectors produce a short checklist. So: pick anchors first, compute a
// closure, and only then run detectors. Template-wide idioms are said once, in
// `archiveFacts`.

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// resolve, not join: an absolute MORGUE_ARCHIVES must escape the repo, and
// path.join silently concatenates it onto ROOT instead. Cost me one stray
// directory inside the repo before I noticed.
export const ARCHIVES = path.resolve(ROOT, process.env.MORGUE_ARCHIVES || 'archives')

// ───────────────────────────────────────────────────────────────────────────
// Controlled vocabulary
//
// CLAUDE.md states this list in prose. This is the machine-checkable copy, and
// it lives here for the same reason bin/vendor.mjs exists: two copies of a map
// drift, and the drift is invisible until something 404s. bin/extract.mjs
// imports assertVocab and refuses to write an item that fails it, so a model
// that invents "scroll-anim" gets a non-zero exit rather than a tag nobody
// notices for a month.
// ───────────────────────────────────────────────────────────────────────────

export const EFFECT = [
  'marquee', 'pinned-horizontal', 'sticky-stack', 'image-trail', 'magnetic',
  'text-scramble', 'mask-reveal', 'page-transition', 'parallax', 'hover-tilt',
  'cursor-distortion', 'preloader', 'morph', 'flip-layout', 'infinite-list', 'stagger',
]
export const TECHNIQUE = [
  'gsap-core', 'gsap-scrolltrigger', 'css-only', 'scroll-timeline', 'webgl-shader',
  'threejs', 'canvas2d', 'view-transitions', 'motion/framer', 'react', 'nextjs', 'lenis',
]
export const TRIGGER = ['load', 'hover', 'click', 'scroll', 'drag', 'idle']
export const SURFACE = ['button', 'card', 'nav', 'hero', 'cursor', 'list', 'image', 'text', 'page']
export const WEIGHT = ['light', 'medium', 'heavy']
export const KIND = ['reference', 'static', 'project', 'unextracted']

// Levenshtein, so the error message names the tag you probably meant. A
// rejection that does not say "did you mean gsap-scrolltrigger" gets worked
// around by inventing another tag.
function nearest(word, list) {
  let best = null, bestD = Infinity
  for (const c of list) {
    const d = editDistance(word, c)
    if (d < bestD) { bestD = d; best = c }
  }
  return bestD <= Math.max(3, Math.ceil(word.length / 2)) ? best : null
}
function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

export function assertVocab(meta, where = 'meta.json') {
  const bad = []
  const many = (key, list) => {
    for (const v of meta[key] ?? []) {
      if (!list.includes(v)) bad.push([key, v, nearest(v, list)])
    }
  }
  const one = (key, list) => {
    if (meta[key] != null && !list.includes(meta[key])) bad.push([key, meta[key], nearest(meta[key], list)])
  }
  many('effect', EFFECT)
  many('technique', TECHNIQUE)
  one('trigger', TRIGGER)
  one('surface', SURFACE)
  one('weight', WEIGHT)
  one('kind', KIND)
  if (bad.length) {
    const lines = bad.map(([k, v, n]) => `  ${k}: "${v}" is not in the vocabulary${n ? ` — did you mean "${n}"?` : ''}`)
    throw new Error(`${where}: ${bad.length} tag(s) outside the controlled vocabulary\n${lines.join('\n')}\n\nThe legal values are in CLAUDE.md and in bin/survey.mjs. Extend BOTH or use an existing tag.`)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Lexical scrubber
//
// Returns a string the same length as the input with comments, string bodies,
// template bodies and regex bodies replaced by spaces (newlines preserved, so
// offsets and line numbers are identical to the original). Delimiters are kept,
// which is what lets `stringAt()` read the real contents back out of the
// original source when a detector actually wants them (className tokens,
// ease names, url(#id)).
//
// The one genuinely hard case is `/`: regex literal or division. Getting it
// wrong blanks a stretch of real code, which costs a missed finding, never a
// crash — and a regex that does not close on its own line is treated as
// division, which bounds the damage to one line.
// ───────────────────────────────────────────────────────────────────────────

const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>'])
const REGEX_KEYWORDS = /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)\s*$/

export function scrub(src) {
  const out = Array.from(src)
  const n = src.length
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ' }
  const modes = [{ kind: 'code' }]
  let last = ''
  let i = 0

  while (i < n) {
    const m = modes[modes.length - 1]
    const c = src[i]

    if (m.kind === 'template') {
      if (c === '\\') { blank(i, i + 2); i += 2; continue }
      if (c === '`') { modes.pop(); last = '`'; i++; continue }
      if (c === '$' && src[i + 1] === '{') { modes.push({ kind: 'expr', depth: 0 }); last = '{'; i += 2; continue }
      if (c !== '\n') out[i] = ' '
      i++
      continue
    }

    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i)
      blank(i, e < 0 ? n : e)
      i = e < 0 ? n : e
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? n : e + 2
      blank(i, end)
      i = end
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c || src[j] === '\n') break
        j++
      }
      blank(i + 1, j)
      i = src[j] === c ? j + 1 : j
      last = c
      continue
    }
    if (c === '`') { modes.push({ kind: 'template' }); i++; continue }
    if (c === '/' && isRegexStart(src, i, last)) {
      const end = scanRegex(src, i)
      if (end > 0) { blank(i + 1, end); i = end + 1; last = '/'; continue }
      // did not close on its line — it was division after all
    }
    if (m.kind === 'expr') {
      if (c === '{') m.depth++
      else if (c === '}') {
        if (m.depth === 0) { modes.pop(); i++; continue }
        m.depth--
      }
    }
    if (!/\s/.test(c)) last = c
    i++
  }
  return out.join('')
}

function isRegexStart(src, i, last) {
  if (src[i + 1] === '>') return false      // JSX self-close `/>`
  if (src[i + 1] === '/' || src[i + 1] === '*') return false
  if (last === '<') return false            // JSX closing tag `</div>`
  if (REGEX_PRECEDERS.has(last)) return true
  return REGEX_KEYWORDS.test(src.slice(Math.max(0, i - 14), i))
}

function scanRegex(src, i) {
  let j = i + 1
  let inClass = false
  while (j < src.length) {
    const c = src[j]
    if (c === '\n') return -1
    if (c === '\\') { j += 2; continue }
    if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) return j
    j++
  }
  return -1
}

// Reads the real text of the string literal whose opening delimiter sits at
// `q` in the scrubbed code. Works because scrub() keeps delimiters, so the next
// occurrence of that delimiter in the scrubbed text IS the closing one.
function stringAt(src, code, q) {
  const quote = code[q]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  const end = code.indexOf(quote, q + 1)
  if (end < 0) return null
  return { value: src.slice(q + 1, end), end }
}

// ───────────────────────────────────────────────────────────────────────────
// Module-scope mask
//
// True at every offset that is NOT inside a function, arrow or class body.
// `if (…) { CustomEase.create("hop", …) }` at the top of Preloader.js is still
// module scope: it runs on import, and that is the thing worth reporting.
// ───────────────────────────────────────────────────────────────────────────

function moduleScopeMask(code) {
  const mask = new Uint8Array(code.length)
  const stack = []       // one entry per open brace: true if it opens a function body
  let inFn = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') {
      const fn = opensFunctionBody(code, i)
      stack.push(fn)
      if (fn) inFn++
      mask[i] = inFn ? 0 : 1
      continue
    }
    if (code[i] === '}') {
      const fn = stack.pop()
      if (fn) inFn--
      mask[i] = inFn ? 0 : 1
      continue
    }
    mask[i] = inFn ? 0 : 1
  }
  return mask
}

function opensFunctionBody(code, brace) {
  const before = code.slice(Math.max(0, brace - 200), brace).replace(/\s+$/, '')
  if (/=>$/.test(before)) return true
  if (/\bclass\b[^{]*$/.test(before)) return true
  if (!before.endsWith(')')) return false
  // Find the matching '(' and look at what precedes it: control-flow keywords
  // open a block, anything else (function decl, method, arrow params) a body.
  let depth = 0
  let k = brace - 1
  while (k >= 0) {
    if (code[k] === ')') depth++
    else if (code[k] === '(') { depth--; if (depth === 0) break }
    k--
  }
  if (k < 0) return false
  const head = code.slice(Math.max(0, k - 40), k).replace(/\s+$/, '')
  return !/\b(if|for|while|switch|catch|with)$/.test(head)
}

// ───────────────────────────────────────────────────────────────────────────
// Inventory
// ───────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.next', '_next', '.git', 'out', 'dist', 'build', 'coverage', '.turbo'])
const JS_EXT = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])

async function walk(dir, base = dir, acc = []) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(abs, base, acc)
    } else if (e.isFile()) {
      acc.push(path.relative(base, abs))
    }
  }
  return acc
}

function lineIndex(src) {
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0, hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1
    }
    return lo + 1
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Module graph
// ───────────────────────────────────────────────────────────────────────────

const PROBE = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '/index.js', '/index.jsx', '/index.ts', '/index.tsx']

function makeResolver(projectRoot, alias) {
  return function resolve(fromRel, spec) {
    let baseRel = null
    if (spec.startsWith('.')) {
      baseRel = path.join(path.dirname(fromRel), spec)
    } else {
      for (const [pattern, targets] of Object.entries(alias)) {
        const prefix = pattern.replace(/\*$/, '')
        if (!spec.startsWith(prefix)) continue
        const rest = spec.slice(prefix.length)
        for (const t of targets) {
          const cand = path.normalize(path.join(t.replace(/\*$/, '').replace(/^\.\//, ''), rest))
          for (const ext of PROBE) {
            if (existsSync(path.join(projectRoot, cand + ext))) return path.normalize(cand + ext)
          }
        }
      }
      return null   // bare package specifier — this is how the dep index is built
    }
    for (const ext of PROBE) {
      const p = path.join(projectRoot, baseRel + ext)
      if (existsSync(p)) return path.normalize(path.relative(projectRoot, p))
    }
    return null
  }
}

// Bounded and punctuation-fenced on purpose: `[^;()]` cannot run away into the
// body of a function, and the 300-char cap keeps a multi-line named import
// working without turning into a whole-file scan.
const IMPORT_RE = /(?:^|[\n;}])\s*(?:import|export)\s[^;()]{0,300}?\bfrom\s*(['"])/g
const BARE_IMPORT_RE = /(?:^|[\n;}])\s*import\s*(['"])/g
const DYNAMIC_RE = /\bimport\s*\(/g

function analyseJs(rel, src, resolve) {
  const code = scrub(src)
  const lineOf = lineIndex(src)
  const mask = moduleScopeMask(code)
  const imports = []

  const push = (q, stmtStart) => {
    const s = stringAt(src, code, q)
    if (!s) return
    const spec = s.value
    const head = src.slice(stmtStart, q)
    const names = []
    const named = head.match(/\{([^}]*)\}/)
    if (named) {
      for (const part of named[1].split(',')) {
        const t = part.trim()
        if (!t) continue
        const m = t.match(/^([\w$*]+)(?:\s+as\s+([\w$]+))?$/)
        if (m) names.push({ imported: m[1], local: m[2] || m[1] })
      }
    }
    const def = head.match(/import\s+([\w$]+)\s*(?:,|from)/)
    if (def) names.push({ imported: 'default', local: def[1] })
    const ns = head.match(/\*\s+as\s+([\w$]+)/)
    if (ns) names.push({ imported: '*', local: ns[1] })
    imports.push({ spec, resolved: resolve(rel, spec), names, line: lineOf(q), moduleScope: true })
  }

  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(code))) push(m.index + m[0].length - 1, m.index)
  }

  // Exported bindings. Only what the detectors need: the declaration kind and
  // where it is, so `export let` can be told from `export const`.
  const exports = new Map()
  for (const m of code.matchAll(/\bexport\s+(let|var|const|function|class|default)\s*([\w$]*)/g)) {
    const kind = m[1]
    const name = kind === 'default' ? 'default' : m[2]
    if (!name) continue
    exports.set(name, { kind, line: lineOf(m.index), offset: m.index })
  }
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim()
      if (!t) continue
      const [local, , exported] = t.split(/\s+/)
      const name = exported || local
      const decl = code.match(new RegExp(`\\b(let|var|const)\\s+${escapeRe(local)}\\b`))
      exports.set(name, { kind: decl ? decl[1] : 'reexport', line: lineOf(m.index), offset: m.index })
    }
  }

  DYNAMIC_RE.lastIndex = 0
  let dynamic = 0
  let dm
  while ((dm = DYNAMIC_RE.exec(code))) {
    const after = code.slice(dm.index + dm[0].length).trimStart()
    if (!/^['"]/.test(after)) dynamic++
  }

  return { rel, src, code, lineOf, mask, imports, exports, dynamic, jsx: /<[A-Z][\w.]*[\s/>]/.test(code) }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// ───────────────────────────────────────────────────────────────────────────
// CSS
// ───────────────────────────────────────────────────────────────────────────

function analyseCss(rel, src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const lineOf = lineIndex(src)
  const defines = new Map()      // --x → line
  const reads = new Map()        // --x → line (first)
  const classes = new Map()      // .foo → count
  const ids = new Map()          // id="foo" targets of url(#foo)
  const urlIds = new Map()

  for (const m of code.matchAll(/(--[\w-]+)\s*:/g)) if (!defines.has(m[1])) defines.set(m[1], lineOf(m.index))
  for (const m of code.matchAll(/var\(\s*(--[\w-]+)/g)) if (!reads.has(m[1])) reads.set(m[1], lineOf(m.index))
  // Class names come from SELECTOR text only. Scanning the whole file for `.x`
  // harvests file extensions out of url() — the first run invented global
  // classes called "woff" and "png".
  for (const sel of code.matchAll(/(^|\})([^{}]*)\{/g)) {
    for (const m of sel[2].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.set(m[1], (classes.get(m[1]) ?? 0) + 1)
  }
  for (const m of code.matchAll(/url\(\s*#([\w-]+)\s*\)/g)) if (!urlIds.has(m[1])) urlIds.set(m[1], lineOf(m.index))
  for (const m of code.matchAll(/#([\w-]+)\s*\{/g)) ids.set(m[1], lineOf(m.index))

  return {
    rel, src, code, lineOf, defines, reads, classes, ids, urlIds,
    keyframes: (code.match(/@keyframes\b/g) ?? []).length,
    property: (code.match(/@property\b/g) ?? []).length,
    scrollTimeline: /animation-timeline\s*:|view-timeline\b|scroll-timeline\b/.test(code),
    viewTransition: /view-transition-name\s*:/.test(code),
    isModule: /\.module\.css$/.test(rel),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Survey
// ───────────────────────────────────────────────────────────────────────────

// Packages that are real but tell you nothing about *what an effect is*. A
// single import site of react-icons is not a candidate; a single import site of
// matter-js is a self-contained physics effect. Precision over recall.
const ANCHOR_DEP_DENY = new Set([
  'react', 'react-dom', 'next', 'prop-types', 'clsx', 'classnames', 'react-icons',
  'sharp', 'zod', 'tailwindcss', 'postcss', 'autoprefixer', 'eslint',
])

// Deps whose presence is a 1:1 proxy for a vocabulary tag. Anything vaguer than
// 1:1 is left to the model pass — a static guess at mask-reveal vs morph vs
// stagger is exactly how a vocabulary rots.
const DEP_EFFECT = { 'next-transition-router': 'page-transition' }
const DEP_TECHNIQUE = {
  gsap: 'gsap-core', '@gsap/react': 'gsap-core', lenis: 'lenis', next: 'nextjs',
  react: 'react', 'react-dom': 'react', three: 'threejs', motion: 'motion/framer',
  'framer-motion': 'motion/framer', 'next-transition-router': 'nextjs',
}
const DEP_UNMAPPED = { 'matter-js': 'matter-js physics simulation' }

// Component-name → effect. Fires on a directory name, which is the cheapest
// honest signal a template gives you, and scores below dep-single-site.
const NAME_EFFECT = [
  [/preload/i, 'preloader'], [/transition/i, 'page-transition'], [/marquee/i, 'marquee'],
  [/cursor/i, 'cursor-distortion'], [/parallax/i, 'parallax'], [/reveal/i, 'mask-reveal'],
  [/scramble/i, 'text-scramble'], [/magnet/i, 'magnetic'], [/trail/i, 'image-trail'],
  [/tilt/i, 'hover-tilt'], [/sticky|stack/i, 'sticky-stack'], [/horizontal|pinned/i, 'pinned-horizontal'],
  [/morph/i, 'morph'], [/\bflip/i, 'flip-layout'], [/infinite/i, 'infinite-list'], [/stagger/i, 'stagger'],
]

// Hook → what must be mounted above it. A closure that imports the hook and
// not the provider renders, does nothing, and throws nothing.
const PROVIDERS = {
  useLenis: '<ReactLenis root> from lenis/react',
  useTransitionState: '<TransitionRouter> from next-transition-router',
  useTransitionRouter: '<TransitionRouter> from next-transition-router',
}

const SINGLETON_RECEIVERS = new Set(['gsap', 'ScrollTrigger', 'CustomEase', 'SplitText', 'Flip', 'Draggable', 'Observer', 'ScrollSmoother', 'lenis', 'Lenis', 'ScrollToPlugin'])
// Reads are excluded (`CustomEase.get` was in this list for one run and
// produced a finding that said a lookup "mutates shared library state").
const SINGLETON_METHODS = new Set(['registerPlugin', 'registerEase', 'registerEffect', 'defaults', 'config', 'create', 'refresh', 'update', 'killAll', 'sort', 'clearScrollMemory', 'normalizeScroll', 'matchMedia', 'stop', 'start', 'resize', 'batch'])

// The share of an archive's JS files that must perform a singleton call before
// it stops being a finding and becomes house style. Measured on blunt:
// registerPlugin 17/32 and ScrollTrigger.update 12/32 are wiring repeated
// verbatim across the template and belong in archiveFacts; ScrollTrigger.refresh
// 7/32, SplitText.create 5/32, CustomEase.create 2/32 and lenis.stop 1/32 are
// things a specific component chose to do, which is what you want to be told.
const IDIOM_SHARE = 1 / 3

const BUILTIN_EASES = /^(none|linear|power[0-4]|back|elastic|bounce|circ|expo|sine|steps|rough|slow|expoScale)\b/

const MEDIA_EXT = /\.(jpe?g|png|webp|avif|gif|svg|mp4|webm|mov|glb|gltf|hdr|json)\b/i

export async function survey(opts = {}) {
  const dir = opts.dir
  const name = opts.name ?? path.basename(dir)
  const log = opts.quiet ? () => {} : (...a) => console.error(...a)

  // ── inventory ────────────────────────────────────────────────────────────
  const projectRoot = dir
  const pkg = existsSync(path.join(dir, 'package.json'))
    ? JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
    : {}
  const tsconfigPath = ['jsconfig.json', 'tsconfig.json'].map((f) => path.join(dir, f)).find(existsSync)
  const tsconfig = tsconfigPath ? JSON.parse(stripJsonComments(await readFile(tsconfigPath, 'utf8'))) : {}
  const alias = tsconfig.compilerOptions?.paths ?? {}

  // Scan src/ when it exists: a Next export ships a built copy of itself
  // beside the source and analysing minified _next chunks is worse than
  // useless. Everything outside src/ is still visible to the resolver.
  const scanBase = existsSync(path.join(dir, 'src')) ? 'src' : '.'
  const files = (await walk(path.join(dir, scanBase))).map((f) => path.normalize(path.join(scanBase === '.' ? '' : scanBase, f)))
  const jsFiles = files.filter((f) => JS_EXT.has(path.extname(f)))
  const cssFiles = files.filter((f) => path.extname(f) === '.css')
  log(`  inventory: ${files.length} files · ${jsFiles.length} js · ${cssFiles.length} css`)

  const resolve = makeResolver(projectRoot, alias)
  const js = new Map()
  const parseErrors = []
  for (const rel of jsFiles) {
    try {
      js.set(rel, analyseJs(rel, await readFile(path.join(projectRoot, rel), 'utf8'), resolve))
    } catch (e) { parseErrors.push({ rel, error: String(e.message) }) }
  }
  const css = new Map()
  for (const rel of cssFiles) css.set(rel, analyseCss(rel, await readFile(path.join(projectRoot, rel), 'utf8')))

  const routes = jsFiles.filter((f) => /(^|\/)app\/.*page\.(js|jsx|ts|tsx)$/.test(f) || /(^|\/)pages\/.*\.(js|jsx)$/.test(f))
  const components = new Set(jsFiles.filter((f) => f.includes('/components/')).map((f) => f.split('/components/')[1].split('/')[0]))

  const framework = {
    kind: existsSync(path.join(dir, 'src', 'app')) || existsSync(path.join(dir, 'app')) ? 'next-app-router'
      : pkg.dependencies?.next ? 'next-pages'
        : pkg.dependencies?.react ? 'react' : 'static',
    next: pkg.dependencies?.next ?? null,
    react: pkg.dependencies?.react ?? null,
    typescript: existsSync(path.join(dir, 'tsconfig.json')),
    alias: Object.fromEntries(Object.entries(alias).map(([k, v]) => [k, v[0]])),
  }

  // ── dep evidence ─────────────────────────────────────────────────────────
  // Built from real import sites, not from package.json. blunt declares `three`
  // and imports it zero times; a naive deps→technique map tags the whole
  // archive `threejs`, which is a lie that then travels into every export.
  const declared = { ...pkg.dependencies, ...pkg.devDependencies }
  const sites = new Map()
  for (const f of js.values()) {
    for (const imp of f.imports) {
      if (imp.resolved) continue
      const p = imp.spec.startsWith('@') ? imp.spec.split('/').slice(0, 2).join('/') : imp.spec.split('/')[0]
      if (!sites.has(p)) sites.set(p, [])
      sites.get(p).push({ file: f.rel, line: imp.line, spec: imp.spec })
    }
  }
  const deps = {}
  for (const [p, version] of Object.entries(declared)) {
    const s = sites.get(p) ?? []
    deps[p] = { version, sites: s.length }
    if (s.length === 1) deps[p].at = `${s[0].file}:${s[0].line}`
    if (s.length === 0) deps[p].note = 'declared, never imported — dead weight'
  }
  for (const [p, s] of sites) if (!deps[p]) deps[p] = { version: null, sites: s.length, note: 'imported but not declared' }
  log(`  deps: ${Object.keys(deps).length} declared · ${[...sites.keys()].length} with import sites`)

  // ── archive-wide indices ─────────────────────────────────────────────────
  const readers = new Map()      // "file::name" → [{file, local, line}]
  for (const f of js.values()) {
    for (const imp of f.imports) {
      if (!imp.resolved) continue
      for (const nm of imp.names) {
        const key = `${imp.resolved}::${nm.imported}`
        if (!readers.has(key)) readers.set(key, [])
        readers.get(key).push({ file: f.rel, local: nm.local, line: imp.line })
      }
    }
  }

  // Custom-property definitions have FOUR sites, and an index that knows only
  // about CSS reports next/font variables and JS-written properties as
  // undefined. Three of those false positives showed up on the first run.
  const cssVarDefs = new Map()   // --x → [{file, line, how}]
  const addDef = (v, file, line, how) => {
    if (!cssVarDefs.has(v)) cssVarDefs.set(v, [])
    cssVarDefs.get(v).push({ file, line, how })
  }
  for (const c of css.values()) for (const [v, line] of c.defines) addDef(v, c.rel, line, 'css')
  for (const f of js.values()) {
    for (const m of f.code.matchAll(/setProperty\(\s*(['"])/g)) {
      const s = stringAt(f.src, f.code, m.index + m[0].length - 1)
      if (s?.value.startsWith('--')) addDef(s.value, f.rel, f.lineOf(m.index), 'js:setProperty')
    }
    // Inline-style object key: `style={{ "--callout-rotation": `${r}deg` }}`.
    // A CSS-only definition index reports these as undefined; two of blunt's
    // three false positives on the first run were exactly this shape.
    for (let i = 0; i < f.code.length; i++) {
      const c = f.code[i]
      if (c !== '"' && c !== "'") continue
      const s = stringAt(f.src, f.code, i)
      if (!s) continue
      if (s.value.startsWith('--') && /^\s*:/.test(f.code.slice(s.end + 1, s.end + 4))) {
        addDef(s.value, f.rel, f.lineOf(i), 'js:inline-style')
      }
      i = s.end
    }
    // next/font injects its `variable:` at runtime — never a missing definition
    for (const m of f.code.matchAll(/variable\s*:\s*(['"])/g)) {
      const s = stringAt(f.src, f.code, m.index + m[0].length - 1)
      if (s?.value.startsWith('--')) addDef(s.value, f.rel, f.lineOf(m.index), 'next/font')
    }
  }

  const globalClasses = new Map()   // class → file (non-module stylesheets only)
  for (const c of css.values()) {
    if (c.isModule) continue
    for (const [cls] of c.classes) if (!globalClasses.has(cls)) globalClasses.set(cls, c.rel)
  }

  const svgIds = new Map()          // id → {file, line}
  for (const f of js.values()) {
    for (const m of f.code.matchAll(/\bid\s*=\s*(['"])/g)) {
      const s = stringAt(f.src, f.code, m.index + m[0].length - 1)
      if (s) svgIds.set(s.value, { file: f.rel, line: f.lineOf(m.index) })
    }
  }
  for (const c of css.values()) for (const [id, line] of c.ids) if (!svgIds.has(id)) svgIds.set(id, { file: c.rel, line })

  const easeCreators = new Map()    // "hop" → [{file, line}]
  for (const f of js.values()) {
    for (const m of f.code.matchAll(/CustomEase\.create\(\s*(['"])/g)) {
      const s = stringAt(f.src, f.code, m.index + m[0].length - 1)
      if (!s) continue
      if (!easeCreators.has(s.value)) easeCreators.set(s.value, [])
      easeCreators.get(s.value).push({ file: f.rel, line: f.lineOf(m.index) })
    }
  }

  const dataAttrs = new Map()       // data-x → [files] (JSX attribute sites)
  for (const f of js.values()) {
    for (const m of f.code.matchAll(/\b(data-[\w-]+)\s*=/g)) {
      if (!dataAttrs.has(m[1])) dataAttrs.set(m[1], new Set())
      dataAttrs.get(m[1]).add(f.rel)
    }
  }

  // Frequency of every singleton call across the archive, by file. This is the
  // gate that turns registerPlugin (17/32 files) into an archiveFact and keeps
  // lenis.stop (1/32) as a finding.
  const singletonFreq = new Map()
  for (const f of js.values()) {
    for (const call of singletonCalls(f)) {
      if (!singletonFreq.has(call.name)) singletonFreq.set(call.name, new Set())
      singletonFreq.get(call.name).add(f.rel)
    }
  }

  const mountedIn = new Map()       // component file → [{file, line}]
  for (const [key, rs] of readers) {
    const target = key.split('::')[0]
    if (!mountedIn.has(target)) mountedIn.set(target, [])
    for (const r of rs) mountedIn.get(target).push(r)
  }

  // ── archive facts ────────────────────────────────────────────────────────
  const archiveFacts = []
  for (const [call, fileSet] of [...singletonFreq].sort((a, b) => b[1].size - a[1].size)) {
    if (fileSet.size / Math.max(1, js.size) >= IDIOM_SHARE) {
      archiveFacts.push(`${call} at ${fileSet.size} of ${js.size} JS files — template-wide idiom, not a per-candidate finding`)
    }
  }
  if (globalClasses.size) {
    const top = [...globalClasses.keys()].slice(0, 12)
    archiveFacts.push(`${globalClasses.size} global utility class(es) in non-module CSS: ${top.join(', ')}${globalClasses.size > 12 ? ' …' : ''}`)
  }
  {
    const byFile = new Map()
    for (const [v, defs] of cssVarDefs) {
      const d = defs.find((x) => x.how === 'css')
      if (!d) continue
      if (!byFile.has(d.file)) byFile.set(d.file, [])
      byFile.get(d.file).push(v)
    }
    for (const [file, vars] of [...byFile].sort((a, b) => b[1].length - a[1].length).slice(0, 2)) {
      const readers = [...css.values()].filter((c) => vars.some((v) => c.reads.has(v))).length
      if (vars.length >= 3) archiveFacts.push(`${vars.length} custom properties defined in ${file}, read by ${readers} stylesheet(s)`)
    }
  }
  const deadDeps = Object.entries(deps).filter(([, d]) => d.sites === 0 && d.version)
  if (deadDeps.length) archiveFacts.push(`declared but never imported: ${deadDeps.map(([p]) => p).join(', ')}`)

  // ── anchors ──────────────────────────────────────────────────────────────
  const anchors = new Map()   // file → {reasons:[], weight}
  const addAnchor = (file, reason, weight, extra = {}) => {
    if (!js.has(file)) return
    if (!anchors.has(file)) anchors.set(file, { reasons: [], weight: 0, evidence: [] })
    const a = anchors.get(file)
    a.reasons.push(reason)
    a.weight = Math.max(a.weight, weight)
    a.evidence.push({ code: reason.split(':')[0], ...extra })
  }

  // 1. dep-single-site — the highest-precision anchor available, and it lands
  //    on the file you actually wanted.
  for (const [p, d] of Object.entries(deps)) {
    if (d.sites !== 1 || ANCHOR_DEP_DENY.has(p)) continue
    const site = sites.get(p)[0]
    addAnchor(site.file, `dep-single-site:${p}`, 1.0, { package: p, line: site.line })
  }

  // 2. dir-name
  for (const rel of jsFiles) {
    const m = rel.match(/\/components\/([^/]+)\/\1\.(js|jsx|ts|tsx)$/)
    if (!m) continue
    const hit = NAME_EFFECT.find(([re]) => re.test(m[1]))
    if (hit) addAnchor(rel, `dir-name:${hit[1]}`, 0.7, { component: m[1], effect: hit[1] })
  }

  // 3. scroll-choreography — a real scroll effect, as opposed to the dozen
  //    files that merely call ScrollTrigger.update() from a Lenis callback.
  for (const f of js.values()) {
    if (!/ScrollTrigger\.create\s*\(|scrollTrigger\s*:/.test(f.code)) continue
    if (!/\b(pin|scrub)\s*:/.test(f.code)) continue
    addAnchor(f.rel, 'scroll-choreography', 0.6, {})
  }

  // 4. singleton-owner — creates a named global AND consumes it. Self-contained
  //    by construction, which is what makes it extractable.
  for (const f of js.values()) {
    const created = [...f.code.matchAll(/CustomEase\.create\(\s*(['"])/g)]
      .map((m) => stringAt(f.src, f.code, m.index + m[0].length - 1)?.value).filter(Boolean)
    if (!created.length) continue
    const used = easeUses(f).map((u) => u.name)
    if (created.some((c) => used.includes(c))) addAnchor(f.rel, 'singleton-owner', 0.5, { eases: [...new Set(created)] })
  }

  // 5. css-only — worthless in a JS-animation archive (blunt has exactly one
  //    incidental @keyframes), primary in a CSS one. Gate on archive class.
  const hasJsAnimLib = ['gsap', 'motion', 'framer-motion', 'three', 'lenis'].some((p) => (deps[p]?.sites ?? 0) > 0)
  if (!hasJsAnimLib) {
    for (const c of css.values()) {
      if (c.scrollTimeline || c.viewTransition || c.property > 0 || c.keyframes > 0) {
        addAnchor(c.rel, 'css-only', 0.8, {})
      }
    }
  }

  // 6. route-exclusive — a score bonus, and where archive.route comes from.
  const routeOf = new Map()
  for (const rel of anchors.keys()) {
    const rs = (mountedIn.get(rel) ?? []).map((r) => r.file)
    const routeParents = [...new Set(rs.filter((r) => routes.includes(r)))]
    if (routeParents.length === 1) {
      addAnchor(rel, 'route-exclusive', 0.3, { route: routePath(routeParents[0]) })
      routeOf.set(rel, routePath(routeParents[0]))
    } else if (rs.some((r) => /layout\.(js|jsx|tsx)$/.test(r) || /ClientLayout/.test(r))) {
      routeOf.set(rel, '/')
    } else if (routeParents.length > 1) {
      routeOf.set(rel, routePath(routeParents[0]))
    }
  }
  log(`  anchors: ${anchors.size}`)

  // ── per-candidate closure + coupling ─────────────────────────────────────
  const candidates = []
  for (const [rel, a] of anchors) {
    const cl = closure(rel, js, css, projectRoot)
    const coupling = []
    const blockers = []

    coupling.push(...detectMutableExport(cl, js, readers))
    coupling.push(...detectProviderRequired(cl, js))
    coupling.push(...detectGlobalSingleton(cl, js, singletonFreq, js.size))
    coupling.push(...detectCssVarForeign(cl, js, css, cssVarDefs))
    coupling.push(...detectCssClassGlobal(cl, js, globalClasses))
    coupling.push(...detectSvgIdForeign(cl, js, css, svgIds))
    coupling.push(...detectNamedEaseForeign(cl, js, easeCreators))
    coupling.push(...detectModuleScopeEffect(cl, js))
    coupling.push(...detectAttrContract(cl, js, dataAttrs))
    coupling.push(...detectAssetTemplateLiteral(cl, js))

    const cap = seedCapture(cl, js)
    if (cap.blocker) blockers.push(cap.blocker)
    if (!cl.complete) {
      blockers.push({
        code: 'closure-incomplete',
        why: `${cl.dynamic} dynamic import(s) with a non-literal specifier — the file list below is a lower bound, and the missing files cannot be named statically`,
      })
    }

    const suggest = suggestMeta(rel, a, cl, deps, name, routeOf.get(rel) ?? null, framework, cap)
    candidates.push({
      id: candidateId(rel),
      status: 'proposed',
      confidence: score(a.weight, cl, coupling),
      anchor: rel,
      anchorReasons: a.reasons,
      closure: { files: cl.files, count: cl.files.length, bytes: cl.bytes, complete: cl.complete },
      route: routeOf.get(rel) ?? null,
      mountedIn: (mountedIn.get(rel) ?? []).map((r) => `${r.file}:${r.line}`).slice(0, 4),
      suggest,
      enrich: null,
      evidence: a.evidence,
      coupling: coupling.sort((x, y) => sev(y.severity) - sev(x.severity)),
      blockers,
      capture: cap.capture,
      notesSeed: notesSeed(rel, cl, coupling, blockers, suggest),
    })
  }
  candidates.sort((x, y) => y.confidence - x.confidence)

  const cap = opts.all ? candidates.length : 12
  candidates.forEach((c, i) => { c.status = i < cap ? 'proposed' : 'deferred' })

  const fingerprint = await fingerprintOf(projectRoot, files)

  return {
    schemaVersion: 1,
    archive: name,
    archiveDir: path.relative(ROOT, projectRoot),
    surveyedAt: new Date().toISOString(),
    surveyVersion: 'static/1',
    enrichedBy: null,
    fingerprint,
    framework,
    counts: { js: js.size, css: css.size, files: files.length, components: components.size, routes: routes.length },
    deps,
    parseErrors,
    archiveFacts,
    candidates,
  }
}

function sev(s) { return s === 'blocker' ? 3 : s === 'high' ? 2 : 1 }

function routePath(rel) {
  const m = rel.match(/app\/(.*)page\.(js|jsx|ts|tsx)$/)
  if (!m) return '/'
  const p = m[1].replace(/\/$/, '')
  return p ? `/${p}` : '/'
}

function candidateId(rel) {
  const base = path.basename(rel).replace(/\.(js|jsx|ts|tsx|css)$/, '').replace(/\.module$/, '')
  return base.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '')
}

// Weights are a judgement call, not a calibration. They are tuned so a clean
// one-file candidate lands near 0.9 and a blocked multi-file one near 0.3.
// The RANKING is the product; the absolute number is not measured against
// anything and should not be read as one.
const SEV_COST = { blocker: 0.6, high: 0.2, note: 0.02 }
function score(weight, cl, coupling) {
  const severity = coupling.reduce((s, c) => s + (SEV_COST[c.severity] ?? 0), 0)
  const extractability = 1 / (1 + 0.06 * cl.files.length + severity)
  return Math.round(weight * extractability * 100) / 100
}

// ───────────────────────────────────────────────────────────────────────────
// Closure
// ───────────────────────────────────────────────────────────────────────────

function closure(anchor, js, css, projectRoot) {
  const seen = new Set()
  const queue = [anchor]
  let dynamic = 0
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel) || !rel) continue
    seen.add(rel)
    const f = js.get(rel)
    if (!f) continue
    dynamic += f.dynamic
    for (const imp of f.imports) if (imp.resolved && !seen.has(imp.resolved)) queue.push(imp.resolved)
    // A component's sibling CSS module is part of it by convention even when
    // the import is `styles from "./X.module.css"` and resolves to a file the
    // JS resolver would otherwise skip.
    const sibling = rel.replace(/\.(js|jsx|ts|tsx)$/, '.module.css')
    if (css.has(sibling)) seen.add(sibling)
  }
  const files = [...seen].sort()
  let bytes = 0
  for (const f of files) bytes += (js.get(f)?.src.length ?? css.get(f)?.src.length ?? 0)
  const externals = new Map()
  for (const f of files) {
    for (const imp of js.get(f)?.imports ?? []) {
      if (imp.resolved) continue
      const p = imp.spec.startsWith('@') ? imp.spec.split('/').slice(0, 2).join('/') : imp.spec.split('/')[0]
      if (!externals.has(p)) externals.set(p, [])
      externals.get(p).push(imp.spec)
    }
  }
  return { files, set: seen, bytes, externals, dynamic, complete: dynamic === 0 }
}

// ───────────────────────────────────────────────────────────────────────────
// Detectors — every one of them closure-scoped
// ───────────────────────────────────────────────────────────────────────────

// THE detector. An exported binding declared `let`/`var`, assigned somewhere in
// its own module, and imported by at least one file OUTSIDE the closure is a
// timing/state contract that survives extraction as silence: the extracted
// component works, the thing that read it now reads a frozen initial value,
// and nothing throws. Blunt's isInitialLoad is the case this was built for —
// 1 hit in 32 JS files. All three conditions are required; dropping any one of
// them costs precision immediately (`export const` is 30+ hits, unassigned
// `let` is meaningless, un-imported is nobody's problem).
function detectMutableExport(cl, js, readers) {
  const out = []
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const [nameExp, info] of f.exports) {
      if (info.kind !== 'let' && info.kind !== 'var') continue
      const assigns = assignmentsTo(f, nameExp, info.offset)
      if (!assigns.length) continue
      const rs = readers.get(`${rel}::${nameExp}`) ?? []
      if (!rs.length) continue
      const outside = rs.filter((r) => !cl.set.has(r.file))
      const inside = rs.filter((r) => cl.set.has(r.file))
      const detail = (list) => list.map((r) => {
        const rf = js.get(r.file)
        const lines = rf ? readsOf(rf, r.local, r.line) : []
        return `${r.file}${lines.length ? ` at line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}` : ''}`
      })
      if (outside.length) {
        out.push({
          severity: 'blocker',
          code: 'mutable-export',
          file: rel,
          line: info.line,
          what: `export ${info.kind} ${nameExp}`,
          why: `mutable module binding, assigned at ${assigns.map((a) => ':' + a).join(', ')}, and read by ${outside.length} file(s) OUTSIDE this closure: ${detail(outside).join('; ')}. Extract this and those readers keep the initial value forever — silently. Nothing throws.`,
          fix: `Decide who owns ${nameExp}. Either pull the readers into the closure, or replace the binding with an explicit prop/context in the extracted item and say so in export.notes.`,
        })
      } else if (inside.length) {
        out.push({
          severity: 'note',
          code: 'mutable-export-internal',
          file: rel,
          line: info.line,
          what: `export ${info.kind} ${nameExp}`,
          why: `mutable module binding assigned at ${assigns.map((a) => ':' + a).join(', ')}; every reader is inside the closure (${detail(inside).join('; ')}), so it travels intact.`,
          fix: 'No action. Recorded because module-level mutable state survives a hot reload and surprises people.',
        })
      }
    }
  }
  return out
}

function assignmentsTo(f, name, declOffset) {
  const lines = []
  const re = new RegExp(`\\b${escapeRe(name)}\\s*(?:=[^=]|\\+\\+|--|[+\\-*/%|&^]=)`, 'g')
  for (const m of f.code.matchAll(re)) {
    if (Math.abs(m.index - declOffset) < name.length + 20 && m.index >= declOffset) continue  // the declaration itself
    lines.push(f.lineOf(m.index))
  }
  return [...new Set(lines)]
}

function readsOf(f, local, importLine) {
  const lines = []
  for (const m of f.code.matchAll(new RegExp(`\\b${escapeRe(local)}\\b`, 'g'))) {
    const line = f.lineOf(m.index)
    if (line === importLine) continue
    lines.push(line)
  }
  return [...new Set(lines)]
}

// A hook whose provider is mounted somewhere else. useLenis in 13 of 32 files
// archive-wide is noise; useLenis in THIS closure with no <ReactLenis> in it is
// a one-line fix you would otherwise find by staring at a dead animation.
// One finding per hook, not per call site. Three files in a closure calling
// useLenis is one fact about the closure and three lines of the same advice.
function detectProviderRequired(cl, js) {
  const out = []
  for (const [hook, provider] of Object.entries(PROVIDERS)) {
    const providerName = provider.match(/<(\w+)/)[1]
    const sites = []
    for (const rel of cl.files) {
      const f = js.get(rel)
      if (!f) continue
      for (const m of f.code.matchAll(new RegExp(`\\b${hook}\\s*\\(`, 'g'))) sites.push(`${rel}:${f.lineOf(m.index)}`)
    }
    if (!sites.length) continue
    if (cl.files.some((r) => new RegExp(`<${providerName}\\b`).test(js.get(r)?.code ?? ''))) continue
    out.push({
      severity: 'high',
      code: 'provider-required',
      file: sites[0].split(':')[0],
      line: Number(sites[0].split(':')[1]),
      sites,
      what: `${hook}() at ${sites.length} site(s) with no ${providerName} in the closure`,
      why: `${sites.join(', ')} — ${hook} returns null/undefined without ${provider} mounted above it. The component renders, the effect does not run, and nothing errors.`,
      fix: `Mount ${provider} in the extracted layout.`,
    })
  }
  return out
}

function singletonCalls(f) {
  const out = []
  for (const m of f.code.matchAll(/\b([A-Za-z_$][\w$]*)\.([\w$]+)\s*\(/g)) {
    if (!SINGLETON_RECEIVERS.has(m[1]) || !SINGLETON_METHODS.has(m[2])) continue
    out.push({ name: `${m[1]}.${m[2]}`, offset: m.index, moduleScope: Boolean(f.mask[m.index]) })
  }
  return out
}

function detectGlobalSingleton(cl, js, freq, jsCount) {
  const byCall = new Map()
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const call of singletonCalls(f)) {
      // House style at or above IDIOM_SHARE of the archive: archiveFacts says
      // it once. Repeating it on every candidate is the file-level noise this
      // whole design exists to avoid.
      if ((freq.get(call.name)?.size ?? 0) / Math.max(1, jsCount) >= IDIOM_SHARE) continue
      if (!byCall.has(call.name)) byCall.set(call.name, [])
      byCall.get(call.name).push(`${rel}:${f.lineOf(call.offset)}`)
    }
  }
  const out = []
  for (const [name, sites] of byCall) {
    out.push({
      severity: 'note',
      code: 'global-singleton',
      file: sites[0].split(':')[0],
      line: Number(sites[0].split(':')[1]),
      sites,
      what: `${name}()`,
      why: `mutates shared library state at ${sites.join(', ')} (${freq.get(name).size} of ${jsCount} files in the archive do this). Outside the template it may act on elements this item does not own, or on none at all.`,
      fix: `Check whether ${name} still has anything to act on once the rest of the template is gone.`,
    })
  }
  return out
}

function detectCssVarForeign(cl, js, css, defs) {
  const out = []
  const wanted = new Map()
  for (const rel of cl.files) {
    const c = css.get(rel)
    if (!c) continue
    for (const [v, line] of c.reads) if (!wanted.has(v)) wanted.set(v, { file: rel, line })
  }
  // JS is a fourth read site, not just a fourth write site. Preloader.js keeps
  // its exit-overlay colours in a JS array of "var(--base-900)" strings; a
  // CSS-only reader index misses every one of them.
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.src.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!wanted.has(m[1])) wanted.set(m[1], { file: rel, line: f.lineOf(m.index) })
    }
  }
  const insideDef = new Set()
  for (const rel of cl.files) {
    const c = css.get(rel)
    if (c) for (const v of c.defines.keys()) insideDef.add(v)
  }
  const byOwner = new Map()
  for (const [v, at] of wanted) {
    if (insideDef.has(v)) continue
    const d = defs.get(v) ?? []
    if (d.some((x) => x.how === 'next/font')) continue      // injected at runtime, never missing
    if (d.some((x) => cl.set.has(x.file))) continue         // written by JS inside the closure
    const owner = d.length ? d[0].file : '(nowhere in the archive)'
    if (!byOwner.has(owner)) byOwner.set(owner, [])
    byOwner.get(owner).push({ v, at })
  }
  for (const [owner, entries] of byOwner) {
    const vars = entries.map((x) => x.v).sort()
    const sites = entries.slice(0, 3).map((x) => `${x.v} at ${x.at.file}:${x.at.line}`)
    out.push({
      severity: owner === '(nowhere in the archive)' ? 'note' : 'high',
      code: 'css-var-foreign',
      file: owner,
      vars,
      readAt: sites,
      what: `${vars.length} custom propert${vars.length === 1 ? 'y' : 'ies'} read but not defined in the closure`,
      why: `${vars.join(', ')} — defined in ${owner}, read at ${sites.join(', ')}${entries.length > 3 ? ' …' : ''}. A missing custom property is not an error; the declaration is simply dropped and the element paints with whatever it inherited.`,
      fix: owner === '(nowhere in the archive)'
        ? 'Verify these are provided at runtime (next/font, a theme script) before assuming they are dead.'
        : `Copy these ${vars.length} declaration(s) from ${owner} into the extracted globals.css.`,
    })
  }
  return out
}

function detectCssClassGlobal(cl, js, globalClasses) {
  const out = []
  const hits = new Map()
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const tok of classNameTokens(f)) {
      const owner = globalClasses.get(tok.name)
      if (!owner) continue
      if (cl.set.has(owner)) continue
      if (!hits.has(tok.name)) hits.set(tok.name, { owner, sites: [] })
      hits.get(tok.name).sites.push(`${rel}:${tok.line}`)
    }
  }
  // Grouped by the stylesheet that owns them, because the fix is one copy of
  // one file's rules, not N separate decisions.
  const byOwner = new Map()
  for (const [cls, h] of hits) {
    if (!byOwner.has(h.owner)) byOwner.set(h.owner, [])
    byOwner.get(h.owner).push({ cls, sites: h.sites })
  }
  for (const [owner, list] of byOwner) {
    const total = list.reduce((s, x) => s + x.sites.length, 0)
    out.push({
      severity: 'high',
      code: 'css-class-global',
      file: owner,
      classes: list.map((x) => x.cls).sort(),
      what: `${list.length} global utility class(es) used in JSX: ${list.map((x) => x.cls).sort().join(', ')}`,
      why: `${total} usage(s) across the closure, all defined in ${owner}, which is outside it. These are string-literal classNames, not CSS-module reads, so nothing breaks — the layout is just silently different.`,
      fix: `Copy those rules from ${owner} into the extracted globals.css, and list them in export.scaffold if they are demo furniture rather than part of the effect.`,
    })
  }
  return out
}

// String-literal className fragments only. `styles.x` member reads are the
// component's own CSS module and are never global.
function classNameTokens(f) {
  const out = []
  for (const m of f.code.matchAll(/className\s*=\s*/g)) {
    let i = m.index + m[0].length
    let depth = 0
    const limit = Math.min(f.code.length, i + 400)
    do {
      const c = f.code[i]
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) { i++; break } }
      else if (c === '"' || c === "'" || c === '`') {
        const s = stringAt(f.src, f.code, i)
        if (s) {
          for (const tok of s.value.split(/\s+/)) {
            if (tok && !tok.includes('$') && !tok.includes('{') && /^[-\w]+$/.test(tok)) out.push({ name: tok, line: f.lineOf(i) })
          }
          i = s.end
        }
        if (depth === 0) { i++; break }
      }
      i++
    } while (i < limit)
  }
  return out
}

// gooey-text-reveal's AnimatedCopy.css reads `filter: url(#blur-matrix)` with
// the <filter> defined in GooeyFilter.jsx. Extract the CSS alone and the effect
// degrades to a plain blur. Blunt's SmudgeRevealer builds its ids with a
// template literal AND defines them in the same file, so it is self-contained
// and must not be reported — the same-file check is what removes that false
// positive.
function detectSvgIdForeign(cl, js, css, svgIds) {
  const out = []
  const seen = new Set()
  const report = (rel, id, line) => {
    const def = svgIds.get(id)
    if (def && cl.set.has(def.file)) return
    if (seen.has(id)) return
    seen.add(id)
    out.push({
      severity: def ? 'high' : 'note',
      code: 'svg-id-foreign',
      file: rel,
      line,
      what: `url(#${id})`,
      why: def
        ? `#${id} is defined in ${def.file}:${def.line}, outside the closure. Without that element the filter/mask/clip resolves to nothing and the effect degrades to whatever the plain property does.`
        : `#${id} is not defined anywhere the survey can see. It may be built dynamically, or it may be missing.`,
      fix: def ? `Copy the element defining #${id} from ${def.file} into the extracted item.` : 'Confirm by hand.',
    })
  }
  for (const rel of cl.files) {
    const c = css.get(rel)
    if (c) for (const [id, line] of c.urlIds) report(rel, id, line)
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.src.matchAll(/url\(#([\w-]+)\)/g)) {
      // A template-literal id (`url(#${maskId})`) is dynamic and unresolvable —
      // skipping it is the difference between 1 finding and a wall of noise.
      report(rel, m[1], f.lineOf(m.index))
    }
  }
  return out
}

function easeUses(f) {
  const out = []
  for (const m of f.code.matchAll(/\bease\s*:\s*(['"])/g)) {
    const s = stringAt(f.src, f.code, m.index + m[0].length - 1)
    if (s && !BUILTIN_EASES.test(s.value)) out.push({ name: s.value, offset: m.index })
  }
  return out
}

// A named ease is registered by string and carries no import edge, so a closure
// can compile and animate with GSAP's default ease instead — no error, wrong
// motion. In blunt both users register their own, so this correctly finds
// nothing; that it stays silent here is the point.
function detectNamedEaseForeign(cl, js, easeCreators) {
  const out = []
  const createdInClosure = new Set()
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.code.matchAll(/CustomEase\.create\(\s*(['"])/g)) {
      const s = stringAt(f.src, f.code, m.index + m[0].length - 1)
      if (s) createdInClosure.add(s.value)
    }
  }
  const seen = new Set()
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const use of easeUses(f)) {
      if (createdInClosure.has(use.name) || seen.has(use.name)) continue
      const creators = easeCreators.get(use.name)
      seen.add(use.name)
      out.push({
        severity: creators ? 'high' : 'note',
        code: 'named-ease-foreign',
        file: rel,
        line: f.lineOf(use.offset),
        what: `ease: "${use.name}"`,
        why: creators
          ? `registered by CustomEase.create at ${creators.map((c) => `${c.file}:${c.line}`).join(', ')}, which is outside the closure. GSAP falls back to its default ease with no warning.`
          : `not a built-in ease and no CustomEase.create for it anywhere in the archive. GSAP falls back silently.`,
        fix: creators ? `Copy the CustomEase.create("${use.name}", …) call into the extracted item.` : 'Confirm by hand.',
      })
    }
  }
  return out
}

function detectModuleScopeEffect(cl, js) {
  const out = []
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.code.matchAll(/(^|[\n;{}])[ \t]*([A-Za-z_$][\w$.]*)\s*\(/g)) {
      const at = m.index + m[0].indexOf(m[2])
      if (!f.mask[at]) continue
      const callee = m[2]
      if (/^(import|require|if|for|while|switch|return|typeof|function|catch)$/.test(callee)) continue
      if (callee === 'gsap.registerPlugin') continue   // universal, and archiveFacts already says so
      out.push({
        severity: 'note',
        code: 'module-scope-effect',
        file: rel,
        line: f.lineOf(at),
        what: `${callee}() runs on import`,
        why: 'a side effect at module scope executes once per process the moment anything imports this file — before React mounts anything.',
        fix: 'Usually fine. Check it is idempotent if the extracted item imports the file more than once.',
      })
    }
  }
  return out
}

// Deliberately capped at `note` and always phrased "possible": the shape is
// real (a utility that queries [data-animate-type] across the whole tree) but
// the same detector fires on any unrelated data attribute.
function detectAttrContract(cl, js, dataAttrs) {
  const out = []
  const seen = new Set()
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.code.matchAll(/\[\s*(data-[\w-]+)/g)) {
      const attr = m[1]
      const users = [...(dataAttrs.get(attr) ?? [])].filter((u) => !cl.set.has(u))
      if (!users.length || seen.has(attr)) continue
      seen.add(attr)
      out.push({
        severity: 'note',
        code: 'attr-contract',
        file: rel,
        line: f.lineOf(m.index),
        what: `selector [${attr}]`,
        why: `possible DOM contract: ${users.length} file(s) outside the closure set ${attr} (${users.slice(0, 3).join(', ')}). If this code queries the document it will find nothing once extracted.`,
        fix: 'Check whether the extracted markup still carries the attribute.',
      })
    }
  }
  return out
}

// CLAUDE.md rule 11's case, generalised. Named and counted, never resolved.
function detectAssetTemplateLiteral(cl, js) {
  const out = []
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.src.matchAll(/`[^`]*\$\{[^`]*`/g)) {
      if (!MEDIA_EXT.test(m[0])) continue
      out.push({
        severity: 'high',
        code: 'asset-template-literal',
        file: rel,
        line: f.lineOf(m.index),
        what: `asset path built with a template literal`,
        why: `${m[0].replace(/\s+/g, ' ').slice(0, 90)} — there is no string to find, so any automated asset copy or path rewrite for this file is incomplete by construction (CLAUDE.md rule 11).`,
        fix: 'Copy the referenced directory by hand and verify after hydration, not just in the built HTML.',
      })
    }
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// capture.json seeding
// ───────────────────────────────────────────────────────────────────────────

function seedCapture(cl, js) {
  const code = cl.files.map((f) => js.get(f)?.code ?? '').join('\n')
  const base = { viewport: { width: 1280, height: 800 }, fps: 30, posterAt: 0.55, settleMs: 600 }

  // A route-change animation has no driver. bin/capture.mjs:106 handles scroll
  // and :118 handles pointer; `load` means no driver at all. Emitting a
  // capture.json here would produce a still frame that passes `motion: OK` by
  // accident — rule 5, in advance.
  if (/TransitionRouter|useTransitionState|next-transition-router/.test(code)) {
    return {
      capture: null,
      blocker: {
        code: 'capture-trigger-unsupported',
        why: 'the animation runs on a next-transition-router route change. bin/capture.mjs drives scroll (:106) and pointer (:118) only; a navigate-between-two-routes driver does not exist. Do not guess a capture.json — it will record a still frame and report motion: OK.',
      },
    }
  }
  if (/\b(pin|scrub)\s*:/.test(code)) {
    return { capture: { trigger: 'scroll', ...base, durationMs: 5000, scroll: { from: 0, to: 'max', ease: 'inOut' }, _derived: 'scrolltrigger-pin-or-scrub' } }
  }
  if (/mousemove|pointermove|mouseenter|onMouseMove/.test(code)) {
    return {
      capture: {
        trigger: 'pointer', ...base, durationMs: 4000,
        pointerPath: [
          { at: 0.0, x: 60, y: 600 },
          { at: 0.5, x: 450, y: 320 },
          { at: 1.0, x: 860, y: 60 },
        ],
        _derived: 'pointer-listener',
      },
    }
  }
  const span = timelineSpan(cl, js)
  return {
    capture: {
      trigger: 'load', ...base,
      durationMs: span ? Math.min(20000, Math.round(span * 1250)) : 5000,
      _derived: span ? `timeline-span ${span.toFixed(2)}s x1.25 margin — a starting point, not a measurement` : 'default',
    },
  }
}

// Sums literal `duration:` values and adds the largest literal `delay:`.
// It is wrong in both directions — it cannot see a stagger's total, it
// double-counts tweens that overlap via the position parameter, and it counts
// durations from branches that never run. That is why it is emitted with
// `_derived` naming its own method: a number you are told to check beats a
// number that looks measured. Blunt's hand-tuned Preloader capture is 8500ms;
// this produces the right order of magnitude and nothing more.
function timelineSpan(cl, js) {
  let total = 0
  let maxDelay = 0
  let found = false
  for (const rel of cl.files) {
    const f = js.get(rel)
    if (!f) continue
    for (const m of f.code.matchAll(/\bduration\s*:\s*([\d.]+)/g)) { total += parseFloat(m[1]); found = true }
    for (const m of f.code.matchAll(/\bdelay\s*:\s*([\d.]+)/g)) { maxDelay = Math.max(maxDelay, parseFloat(m[1])); found = true }
  }
  return found ? Math.min(total + maxDelay, 20) : null
}

// ───────────────────────────────────────────────────────────────────────────
// Static suggestion — deterministic, never model-written
// ───────────────────────────────────────────────────────────────────────────

function suggestMeta(anchor, a, cl, deps, archiveName, route, framework, cap) {
  const component = path.basename(anchor).replace(/\.\w+$/, '')
  const prefix = archiveName.replace(/-(main|master|template)$/, '')
  const effect = new Set()
  const unmapped = []

  for (const r of a.reasons) {
    if (r.startsWith('dir-name:')) effect.add(r.slice('dir-name:'.length))
    if (r.startsWith('dep-single-site:')) {
      const p = r.slice('dep-single-site:'.length)
      if (DEP_EFFECT[p]) effect.add(DEP_EFFECT[p])
      if (DEP_UNMAPPED[p]) unmapped.push(DEP_UNMAPPED[p])
    }
  }

  const technique = new Set()
  for (const [p, specs] of cl.externals) {
    if (DEP_TECHNIQUE[p]) technique.add(DEP_TECHNIQUE[p])
    if (p === 'gsap' && specs.some((s) => s.includes('ScrollTrigger'))) technique.add('gsap-scrolltrigger')
  }
  if (framework.kind.startsWith('next')) technique.add('nextjs')
  if (cl.files.some((f) => f.endsWith('.jsx') || f.endsWith('.js'))) technique.add('react')

  const surface = /cursor/i.test(component) ? 'cursor'
    : /menu|nav|header/i.test(component) ? 'nav'
      : /hero/i.test(component) ? 'hero'
        : /card/i.test(component) ? 'card'
          : /list/i.test(component) ? 'list'
            : 'page'

  const weight = cl.bytes > 25_000 || technique.has('threejs') ? 'heavy' : cl.bytes > 8_000 ? 'medium' : 'light'

  // `blunt-preloader` + candidate `preloader` must not become
  // `blunt-preloader-preloader`. Deduped by token, not by substring, so
  // `blunt-preloader` + `transition-provider` still reads correctly.
  const tokens = [...prefix.split('-'), ...candidateId(anchor).split('-')]
  const slug = tokens.filter((t, i) => t && tokens.indexOf(t) === i).join('-')

  const suggest = {
    slug,
    title: component,                    // a file name, labelled honestly as one
    titleIsFilename: true,
    kind: framework.kind === 'static' ? 'static' : 'project',
    effect: [...effect].filter((e) => EFFECT.includes(e)),
    technique: [...technique].filter((t) => TECHNIQUE.includes(t)),
    trigger: cap.capture?.trigger === 'pointer' ? 'hover' : cap.capture?.trigger ?? 'click',
    surface,
    weight,
    entry: anchor,
    route,
  }
  if (unmapped.length) suggest.unmapped = unmapped
  return suggest
}

function notesSeed(anchor, cl, coupling, blockers, suggest) {
  const L = []
  L.push(`# ${suggest.title}`, '')
  L.push('## How it works — TO WRITE', '')
  L.push('_This section is the reason the item exists and no static pass can write it. Watch `out/<slug>/preview.mp4`, then say what the effect does and why the technique produces it._', '')
  L.push('## Extracted from', '')
  L.push(`- anchor: \`${anchor}\``)
  L.push(`- closure: ${cl.files.length} file(s), ${(cl.bytes / 1024).toFixed(1)}KB${cl.complete ? '' : ' — INCOMPLETE, see blockers'}`)
  for (const f of cl.files) L.push(`  - \`${f}\``)
  L.push('')
  if (blockers.length) {
    L.push('## Blockers', '')
    for (const b of blockers) L.push(`- **${b.code}** — ${b.why}`)
    L.push('')
  }
  if (coupling.length) {
    L.push('## Coupling found by `pnpm survey`', '')
    L.push('_Machine-generated from the archive. Every line has a file:line you can go and read._', '')
    for (const c of coupling) {
      L.push(`- **${c.severity}** \`${c.code}\`${c.file ? ` — \`${c.file}${c.line ? ':' + c.line : ''}\`` : ''}`)
      if (c.what) L.push(`  - ${c.what}`)
      L.push(`  - ${c.why}`)
      if (c.fix) L.push(`  - fix: ${c.fix}`)
    }
    L.push('')
  }
  L.push('## What this survey cannot see', '')
  L.push('- Cascade and reset dependence. A component that only looks right because a global `* { margin: 0; box-sizing: border-box }` exists is undetectable, and it is the most common silent breakage.')
  L.push('- Timing coupling with no shared binding. A hardcoded `delay: 6.5` matching a preloader is invisible; the detector above only works because the author named the variable.')
  L.push('- Stacking contexts, `position: fixed` overlays, portals, `z-index` arithmetic. An overlay that rendered above everything in the template can render behind everything in the host.')
  L.push('- Whether the effect is any good. Candidates are ranked by extractability, which is a bias toward the trivial.')
  L.push('')
  return L.join('\n')
}

// ───────────────────────────────────────────────────────────────────────────
// Persistence
// ───────────────────────────────────────────────────────────────────────────

async function fingerprintOf(root, files) {
  let bytes = 0
  let newest = 0
  for (const f of files) {
    try {
      const s = await stat(path.join(root, f))
      bytes += s.size
      newest = Math.max(newest, s.mtimeMs)
    } catch { /* raced with something; the fingerprint is advisory */ }
  }
  return { files: files.length, bytes, newestMtime: new Date(newest).toISOString() }
}

function stripJsonComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// Re-survey MERGES. `extracted` and `rejected` are decisions a human made, and
// the ledger is the only thing stopping an agent re-proposing work that is
// already done — at scale, that is how items/ fills with duplicates.
export function merge(previous, next) {
  if (!previous?.candidates) return next
  const old = new Map(previous.candidates.map((c) => [c.id, c]))
  let kept = 0
  for (const c of next.candidates) {
    const p = old.get(c.id)
    if (!p) continue
    if (p.status === 'extracted' || p.status === 'rejected') {
      c.status = p.status
      if (p.extractedAs) c.extractedAs = p.extractedAs
      if (p.extractedAt) c.extractedAt = p.extractedAt
      if (p.rejectedWhy) c.rejectedWhy = p.rejectedWhy
      kept++
    }
    if (p.enrich) c.enrich = p.enrich
  }
  next.enrichedBy = previous.enrichedBy ?? null
  next.mergedFrom = { surveyedAt: previous.surveyedAt, decisionsKept: kept }
  return next
}

// candidates.json quotes paid third-party source — file paths, identifier
// names, line numbers — so it must never be stageable. The repo .gitignore is
// the right place for that rule and owns it; this only checks that the rule is
// actually in force, and drops a self-ignoring file if it is not.
//
// Deliberately conditional. An unconditional write puts `*` inside whatever
// directory MORGUE_ARCHIVES points at, which during testing silently ignored a
// tracked fixtures/ tree, and which shadows the root's `!archives/.gitkeep`.
async function ensureIgnored(outFile) {
  const dir = path.dirname(path.dirname(outFile))
  try {
    execFileSync('git', ['check-ignore', '-q', outFile], { cwd: ROOT, stdio: 'ignore' })
    return   // already covered by a .gitignore somewhere up the tree
  } catch { /* not ignored, or not a git repo — fall through */ }
  const f = path.join(dir, '.gitignore')
  if (existsSync(f)) return
  await mkdir(dir, { recursive: true })
  await writeFile(f, [
    '# Everything here quotes paid third-party source — paths, identifiers, line',
    '# numbers — and is worthless without the archive it describes. Same reasoning',
    '# as items/ and out/ in the repo root .gitignore. Do not add exceptions.',
    '*',
    '',
  ].join('\n'))
  console.error(`  ! ${path.relative(ROOT, outFile)} was not gitignored — wrote ${path.relative(ROOT, f)} to make sure paid source cannot be staged.`)
}

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────

export function resolveArchive(arg) {
  // A bare name means archives/<name>. A path that exists is used as-is, which
  // is how you survey an already-ingested item's source without copying it.
  const asPath = path.resolve(ROOT, arg)
  if (existsSync(asPath) && (arg.includes('/') || arg.startsWith('.'))) {
    return { dir: asPath, name: path.basename(asPath) }
  }
  const inArchives = path.join(ARCHIVES, arg)
  if (existsSync(inArchives)) return { dir: inArchives, name: arg }
  if (existsSync(asPath)) return { dir: asPath, name: path.basename(asPath) }
  return null
}

function table(report) {
  const rows = report.candidates.filter((c) => c.status !== 'deferred')
  const w = (s, n) => String(s).padEnd(n).slice(0, n)
  const lines = []
  lines.push(`${w('id', 26)} ${w('conf', 5)} ${w('files', 5)} ${w('B', 1)} ${w('H', 1)} ${w('n', 2)} anchor`)
  lines.push('-'.repeat(78))
  for (const c of rows) {
    const b = c.blockers.length + c.coupling.filter((x) => x.severity === 'blocker').length
    const h = c.coupling.filter((x) => x.severity === 'high').length
    const n = c.coupling.filter((x) => x.severity === 'note').length
    lines.push(`${w(c.id, 26)} ${w(c.confidence.toFixed(2), 5)} ${w(c.closure.count, 5)} ${w(b || '·', 1)} ${w(h || '·', 1)} ${w(n || '·', 2)} ${c.anchor}`)
  }
  const deferred = report.candidates.length - rows.length
  if (deferred) lines.push(`… and ${deferred} deferred (run with --all to see them)`)
  return lines.join('\n')
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (f) => argv.includes(f)
  const val = (f) => { const i = argv.indexOf(f); return i < 0 ? null : argv[i + 1] }
  const target = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--only')

  if (!target) {
    console.error('Usage: pnpm survey <archive|path> [--json] [--all] [--only <id>] [--quiet]\n')
    const available = existsSync(ARCHIVES)
      ? (await readdir(ARCHIVES, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
      : []
    console.error(available.length
      ? `Archives:\n  ${available.join('\n  ')}`
      : `No archives yet. ${path.relative(ROOT, ARCHIVES)}/ does not exist — unpack a template into it, or pass a path (e.g. \`pnpm survey path/to/template\`).`)
    process.exit(1)
  }

  const resolved = resolveArchive(target)
  if (!resolved) {
    console.error(`No such archive or path: ${target}`)
    process.exit(1)
  }

  console.error(`surveying ${path.relative(ROOT, resolved.dir)}`)
  const report = await survey({ ...resolved, all: flag('--all'), quiet: flag('--quiet') })

  const only = val('--only')
  if (only) report.candidates = report.candidates.filter((c) => c.id === only)

  if (flag('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    // Output ALWAYS lands in archives/, never beside the source. Surveying
    // items/<slug> must not write into items/ — that directory is paid source
    // under an explicit no-write rule, and a survey is not an ingest.
    const outDir = path.join(ARCHIVES, resolved.name)
    const outFile = path.join(outDir, 'candidates.json')
    await ensureIgnored(outFile)
    await mkdir(outDir, { recursive: true })
    const previous = existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) : null
    await writeFile(outFile, JSON.stringify(merge(previous, report), null, 2) + '\n')

    console.error('')
    console.error(table(report))
    console.error('')
    if (report.archiveFacts.length) {
      console.error('archive facts (said once, deliberately not repeated per candidate):')
      for (const f of report.archiveFacts) console.error(`  · ${f}`)
      console.error('')
    }
    if (report.parseErrors.length) {
      console.error(`${report.parseErrors.length} file(s) failed to analyse: ${report.parseErrors.map((e) => e.rel).join(', ')}`)
      console.error('')
    }
    console.error(`→ ${path.relative(ROOT, outFile)}`)
    const first = report.candidates.find((c) => c.status === 'proposed')
    if (first) console.error(`next: pnpm extract ${resolved.name} ${first.id}`)
  }
}
