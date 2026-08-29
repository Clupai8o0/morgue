#!/usr/bin/env node
// Turns a self-contained component delivery into items/<slug>/.
//
//   pnpm ingest <dir> --slug <slug> [--source-archive <path>] [--dry-run]
//   pnpm ingest <dir> --slug <slug> --title "Menu stagger reveal"
//
// ── How this differs from `pnpm extract` ────────────────────────────────────
//
// extract.mjs carves ONE candidate out of a large template that survey.mjs has
// already mapped: the hard part there is deciding which files belong to the
// effect and what it is coupled to. This is the other shape — a delivery that
// IS one component, one folder, one index.html — where nothing needs carving
// and the hard part is that it was written to run under a bundler, or off a
// CDN, or served from the folder root, and the vault serves none of those.
//
// So this does the deterministic part and only the deterministic part:
//
//   · strips delivery junk (__MACOSX, .DS_Store, node_modules, .next, .git)
//   · relativises root-absolute references to the item's OWN files
//   · rewrites CDN <script> tags and bare ESM imports onto the vendored copies
//   · injects the capture readiness signal
//   · writes capture.json with a trigger inferred from the code
//   · writes meta.json with the provenance it can prove and the tags it can
//     derive — and LEAVES THE REST EMPTY
//
// That last one is the point. `effect` and `surface` are what make the vault
// searchable, they cannot be read off an AST, and a plausible guess is worse
// than a blank: a blank gets filled in, a wrong tag gets trusted. Every item
// this cannot fully classify is listed at the end of the run, and
// `--report <file>` writes that list as JSON for whatever fills it in.
//
// It refuses to overwrite items/<slug>/. There is no --force, for the same
// reason extract.mjs has none.

import { readFile, writeFile, mkdir, readdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertVocab, EFFECT } from './survey.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ITEMS = path.resolve(ROOT, process.env.MORGUE_ITEMS || 'items')

// ─── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const VALUE = new Set(['slug', 'title', 'source-archive', 'report', 'license', 'source', 'added-at'])
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { positional.push(a); continue }
  const eq = a.indexOf('=')
  const name = eq === -1 ? a.slice(2) : a.slice(2, eq)
  if (eq !== -1) flags[name] = a.slice(eq + 1)
  else if (VALUE.has(name)) flags[name] = argv[++i]
  else flags[name] = true
}
const DRY = flags['dry-run'] === true
const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1) }

const SRC_DIR = positional[0]
if (!SRC_DIR) die('Usage: pnpm ingest <dir> --slug <slug> [--source-archive <path>] [--dry-run]')
if (!flags.slug) die('--slug is required. It is the item folder name and the URL, so it is not guessed for you.')
const SLUG = String(flags.slug)
if (!/^[a-z0-9][a-z0-9-]*$/.test(SLUG)) die(`--slug "${SLUG}" must be lowercase kebab-case.`)

// ─── the delivery ────────────────────────────────────────────────────────────

const JUNK_DIR = new Set(['__MACOSX', 'node_modules', '.next', '.git', '.vscode', '.idea', '.cache'])
const JUNK_FILE = new Set(['.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.gitignore'])
const TEXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md'])

async function walk(dir, base = dir, depth = 0) {
  if (depth > 8) return []
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (JUNK_DIR.has(e.name)) continue
      out.push(...(await walk(path.join(dir, e.name), base, depth + 1)))
    } else if (e.isFile() && !JUNK_FILE.has(e.name) && !e.name.startsWith('._')) {
      out.push(path.relative(base, path.join(dir, e.name)).split(path.sep).join('/'))
    }
  }
  return out
}

/**
 * A zip normally unpacks to one directory holding the component. Descend
 * through single-child wrappers until index.html is in view, so the item does
 * not end up with a pointless "cg-whatever-effect/" level inside it.
 */
async function componentRoot(dir) {
  for (let i = 0; i < 4; i++) {
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => !JUNK_DIR.has(e.name) && !JUNK_FILE.has(e.name) && !e.name.startsWith('._'))
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'index.html')) return dir
    const dirs = entries.filter((e) => e.isDirectory())
    if (dirs.length !== 1) return dir
    dir = path.join(dir, dirs[0].name)
  }
  return dir
}

const src = await componentRoot(path.resolve(SRC_DIR))
if (!existsSync(src)) die(`No such directory: ${SRC_DIR}`)
const files = await walk(src)
const entry = files.find((f) => f.toLowerCase() === 'index.html')
if (!entry) {
  die(
    `No index.html at the root of ${path.relative(ROOT, src)}.\n` +
      `  This ingests self-contained static deliveries. A Next or Vite project is an\n` +
      `  archive — see rule 2 in CLAUDE.md and the archives/ pattern.`,
  )
}

const dest = path.join(ITEMS, SLUG)
if (existsSync(dest)) die(`items/${SLUG}/ already exists. This never overwrites; pick another --slug or delete it yourself.`)

const fileSet = new Set(files)
const notes = []              // what was rewritten, for notes.md
const unresolved = []         // what a human/agent still has to decide

// ─── dependency rewriting ────────────────────────────────────────────────────
//
// The vendored copies are the ONLY libraries the vault serves; bin/vendor.mjs
// is the map and /vendor/, /three/ and /lenis/ are the only root-absolute
// prefixes an item may use. Everything below turns a CDN URL or a bare
// specifier into one of those, and reports anything it does not recognise
// rather than leaving a silent network dependency in a page that must run
// offline.

/** gsap plugin file names, as they exist in node_modules/gsap/dist. */
const GSAP_PLUGINS = [
  'ScrollTrigger', 'ScrollToPlugin', 'ScrollSmoother', 'SplitText', 'Draggable',
  'Flip', 'CustomEase', 'CustomBounce', 'CustomWiggle', 'MotionPathPlugin',
  'Observer', 'TextPlugin', 'EaselPlugin', 'PixiPlugin', 'InertiaPlugin',
  'DrawSVGPlugin', 'MorphSVGPlugin', 'ScrambleTextPlugin', 'GSDevTools',
  'MotionPathHelper', 'CSSRulePlugin', 'EasePack', 'Physics2DPlugin',
  'PhysicsPropsPlugin',
]

const CDN_HOST = /(cdnjs\.cloudflare\.com|unpkg\.(com|co)|cdn\.jsdelivr\.net|esm\.sh|skypack\.dev|assets\.codepen\.io)/i

/** A CDN URL → the vendored path that replaces it, or null if we do not host it. */
function vendorFor(url) {
  const u = url.toLowerCase()
  if (/\/gsap[@/-]?[\d.]*\/?(dist\/)?gsap(\.min)?\.js/.test(u) || /\/gsap[@/][\d.]+$/.test(u)) {
    return '/vendor/gsap.min.js'
  }
  for (const p of GSAP_PLUGINS) {
    if (new RegExp(`/${p}(\\.min)?\\.js`, 'i').test(url)) return `/vendor/${p}.min.js`
  }
  if (/lenis.*\.css/.test(u)) return '/lenis/lenis.css'
  if (/(^|\/)lenis/.test(u)) return '/lenis/lenis.min.js'
  // ORDER MATTERS. A CDN addon URL is
  // ".../libs/three.js/r128/loaders/GLTFLoader.js" — it contains "three.js", so
  // the core test below matches it too. Rewriting both tags to the same file
  // gave one item two identical <script src="/three/three.module.js"> and no
  // loader at all; the page then threw "Cannot use import statement outside a
  // module" on line 1 and "THREE is not defined", while `motion: OK` still
  // passed because the page scrolled. Addons are checked first, and they can
  // only be reached through an importmap, so they are reported rather than
  // rewritten into a classic tag that cannot work.
  if (/(examples\/jsm|\/(loaders|controls|postprocessing|geometries|utils|shaders|objects|environments)\/)/i.test(u) && /three/i.test(u)) {
    return null
  }
  if (/three(\.module)?(\.min)?\.js/.test(u) || /\/three[@/]/.test(u)) return '/three/three.module.js'
  // Everything below was added because this corpus loads it from a CDN and an
  // item has to run with no network. All are in bin/vendor.mjs.
  if (/anime(js)?[@/.-]/.test(u)) return '/anime/anime.min.js'
  if (/matter[.-]?js/.test(u)) return '/matter/matter.min.js'
  if (/split-type/.test(u)) return '/split-type/index.min.js'
  if (/locomotive-scroll.*\.css/.test(u)) return '/locomotive/locomotive-scroll.min.css'
  if (/locomotive-scroll/.test(u)) return '/locomotive/locomotive-scroll.min.js'
  if (/lottie[._-]/.test(u)) return '/lottie/lottie.min.js'
  if (/\/p5[@/.]/.test(u)) return '/p5/p5.min.js'
  return null
}

/** Bare ESM specifier → how to satisfy it without a bundler. */
function specifierFor(spec) {
  if (spec === 'gsap') return { kind: 'global', script: '/vendor/gsap.min.js', global: 'gsap' }
  const m = /^gsap\/(?:dist\/)?(\w+)$/.exec(spec)
  if (m && GSAP_PLUGINS.includes(m[1])) return { kind: 'global', script: `/vendor/${m[1]}.min.js`, global: m[1] }
  // NOT /vendor/all.js. Measured against gsap 3.15.0: the `all` bundle's
  // SplitText returns two chars with empty textContent where the standalone
  // plugin returns ten — one empty div per word — so a chars-split headline
  // renders as nothing. It fails the same way loaded alone or after
  // gsap.min.js. Core plus the named plugins is the only safe shape, and it is
  // what every working item in the collection already uses.
  if (spec === 'gsap/all') return { kind: 'global', script: '/vendor/gsap.min.js', global: 'gsap' }
  // three and lenis both ship real ESM, so an importmap is enough and the
  // source keeps its import statement untouched.
  if (spec === 'three') return { kind: 'importmap', to: '/three/three.module.js' }
  if (spec === 'lenis') return { kind: 'importmap', to: '/lenis/lenis.mjs' }
  // "three/addons/controls/OrbitControls.js" — a trailing-slash importmap entry
  // maps the whole subtree, so one entry covers every addon an item imports.
  if (spec.startsWith('three/addons/')) return { kind: 'importmap', prefix: 'three/addons/', to: '/three-addons/' }
  if (spec.startsWith('three/examples/jsm/')) return { kind: 'importmap', prefix: 'three/examples/jsm/', to: '/three-addons/' }
  if (spec === 'split-type') return { kind: 'importmap', to: '/split-type/index.min.js' }
  if (spec === 'lottie-web') return { kind: 'importmap', to: '/lottie/lottie.min.js' }
  if (spec === 'matter-js') return { kind: 'global', script: '/matter/matter.min.js', global: 'Matter' }
  if (spec === 'animejs' || spec === 'animejs/lib/anime.es.js') return { kind: 'global', script: '/anime/anime.min.js', global: 'anime' }
  return null
}

// ─── rewriting a text file ───────────────────────────────────────────────────

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Root-absolute references to the item's OWN files.
 *
 * Newer deliveries are Vite projects served from the folder root, so they say
 * href="/styles.css" and src="/public/img1.jpg". Under the vault an item lives
 * at /item/<slug>/, so a leading slash resolves against the VAULT root and
 * 404s — and it does so identically in capture, which serves the item at the
 * folder root, so capture stays green and only the built site breaks. That is
 * the failure mode `pnpm check` exists for (CLAUDE.md, top).
 *
 * A path is only relativised when the file it names actually exists in the
 * delivery. Anything else is left alone and reported: guessing here is how you
 * turn a dead link into a wrong link, which is harder to notice.
 */
function relativise(text, rel) {
  const depth = rel.split('/').length - 1
  const up = depth ? '../'.repeat(depth) : ''
  let n = 0
  const out = text.replace(/(["'(])\/(?!\/)([A-Za-z0-9_][^"')\s]*)/g, (m, open, p) => {
    if (/^(vendor|three|lenis|archive)\//.test(p)) return m       // ours to serve
    const clean = p.split(/[?#]/)[0]
    if (!fileSet.has(clean) && !fileSet.has(`public/${clean}`)) return m
    n++
    return `${open}${up}${fileSet.has(clean) ? clean : `public/${clean}`}`
  })
  if (n) notes.push(`${n} root-absolute path(s) in ${rel} made relative`)
  return out
}

/** <a href="/work"> with nothing behind it — three of these in this corpus, and
 *  each one fails `pnpm check`, which clicks internal links and flags any that
 *  escape the item's own base. Neutralised, not deleted: the markup is part of
 *  the design and the anchor still has to be there to be styled. */
function deadLinks(html) {
  let n = 0
  const out = html.replace(/(<a\b[^>]*?\bhref=)(["'])\/(?!\/)([^"']*)\2/gi, (m, pre, q, p) => {
    const clean = p.split(/[?#]/)[0]
    if (!clean || fileSet.has(clean) || /^(vendor|three|lenis|archive)\//.test(clean)) return m
    n++
    return `${pre}${q}#${q} data-morgue-href=${q}/${p}${q}`
  })
  if (n) notes.push(`${n} dead root-absolute <a href> neutralised to "#" (original kept in data-morgue-href)`)
  return out
}

const needScripts = []        // vendored classic scripts to inject, in order
const importmap = {}          // bare specifier -> vendored ESM url
const unknownRemote = []

/** CDN <script src> / <link href> → vendored. */
function rewriteCdn(html) {
  return html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=)(["'])(https?:\/\/[^"']+)\2/gi, (m, pre, q, url) => {
    if (!CDN_HOST.test(url)) {
      // Fonts and icon sets from a CDN are a real network dependency in a page
      // that has to render identically offline, but substituting one is a look
      // decision, not a mechanical one.
      unknownRemote.push(url)
      return m
    }
    const to = vendorFor(url)
    if (!to) { unknownRemote.push(url); return m }
    notes.push(`${url} → ${to}`)
    return `${pre}${q}${to}${q}`
  })
}

/** Bare ESM imports in a module script. */
function rewriteImports(js, rel) {
  let out = js
  const specRe = /^[ \t]*import\s+(?:([\w*\s{},$]+?)\s+from\s+)?["']([^"'./][^"']*)["'];?[ \t]*\r?\n/gm
  const drop = []
  for (const m of [...js.matchAll(specRe)]) {
    const [full, clause, spec] = m
    const how = specifierFor(spec)
    if (!how) { unresolved.push(`${rel}: bare import "${spec}" — no vendored copy, decide by hand`); continue }
    if (how.kind === 'importmap') {
      // A prefix entry has to map the bare specifier too, or `import "three"`
      // alongside `import "three/addons/…"` resolves only one of them.
      if (how.prefix) { importmap[how.prefix] = how.to; importmap.three ??= '/three/three.module.js' }
      else importmap[spec] = how.to
      continue
    }
    // Global: the UMD build already defines the name the clause binds, so the
    // statement can simply go. gsap ships no ESM in dist/, which is why this
    // is a script tag and not another importmap entry.
    if (!needScripts.includes(how.script)) needScripts.push(how.script)
    drop.push(full)
  }
  for (const d of drop) out = out.replace(d, '')
  if (drop.length) notes.push(`${drop.length} bare gsap import(s) in ${rel} replaced by the vendored UMD global`)
  return out
}

// ─── trigger inference ───────────────────────────────────────────────────────

/**
 * How long the thing actually takes, in ms.
 *
 * A flat 3000ms default was wrong far more often than it was right. These
 * deliveries open with long scripted intros — a counter to 100, a curtain, a
 * headline — and eight, ten, fourteen seconds is normal. A three-second window
 * recorded the first fifth and stopped, and `motion: OK` passed every time,
 * because a preloader counting from 000 to 081 is unambiguously moving. In one
 * batch of twelve, five previews were truncated this way and none was flagged.
 *
 * So read the timeline instead: the largest `delay:` plus the `duration:` next
 * to it, and any explicit setTimeout, are a lower bound on the run time. Bound
 * the answer to [3s, 15s] — beyond that the source is looping, not sequencing,
 * and a longer capture is just a bigger file.
 */
function inferDuration(code, fallback) {
  let latest = 0
  for (const m of code.matchAll(/\bdelay\s*:\s*([\d.]+)/g)) latest = Math.max(latest, parseFloat(m[1]))
  let longest = 0
  for (const m of code.matchAll(/\bduration\s*:\s*([\d.]+)/g)) longest = Math.max(longest, parseFloat(m[1]))
  let timer = 0
  for (const m of code.matchAll(/setTimeout\([^,]{0,400}?,\s*(\d{3,5})\s*\)/g)) timer = Math.max(timer, parseInt(m[1], 10))
  const seconds = (latest + longest) * 1000
  const est = Math.max(seconds, timer)
  if (!est) return fallback
  // A little tail so the last tween finishes inside the frame, then round up.
  return Math.min(15000, Math.max(3000, Math.ceil((est * 1.15) / 500) * 500))
}

function inferTrigger(code, css = '') {
  if (/ScrollTrigger|scrollTrigger|animation-timeline|scroll-timeline|new Lenis|addEventListener\(\s*["']scroll/.test(code)) return 'scroll'
  if (/Draggable|addEventListener\(\s*["'](dragstart|pointerdown)/.test(code)) return 'drag'
  if (/addEventListener\(\s*["'](mousemove|pointermove)/.test(code)) return 'pointer'
  if (/addEventListener\(\s*["'](mouseenter|mouseover)/.test(code)) return 'hover'
  if (/addEventListener\(\s*["'](click|pointerdown)/.test(code)) return 'click'
  // A CSS-only hover effect has no listener to find, and captured as `load` it
  // records a page that never moves — five of the first ten pilot items died
  // exactly here. A :hover rule that animates something IS the effect.
  if (/:hover\b/.test(css) && /(transition|animation|transform)/.test(css)) return 'hover'
  return 'load'
}

/**
 * What the harness should click, for an effect that only exists after a click.
 *
 * Without this a menu, a modal or a toggle captures its closed state for three
 * seconds and the preview shows nothing happening — `motion: OK` would even
 * pass, because the page is never completely still. Rule 5 in miniature.
 *
 * Only two shapes are read, and both are unambiguous: a querySelector result
 * held in a variable that later takes a click listener, and the same call
 * chained straight onto addEventListener. Anything cleverer (delegation, a
 * loop over a NodeList) is left for a human — a wrong selector clicks nothing
 * and looks exactly like a broken effect.
 */
function inferClickSelector(js) {
  const decls = new Map()
  for (const m of js.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*document\.querySelector\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    decls.set(m[1], m[2])
  }
  for (const m of js.matchAll(/\b(\w+)\s*\.addEventListener\(\s*["'`]click/g)) {
    if (decls.has(m[1])) return decls.get(m[1])
  }
  const direct = /document\.querySelector\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\.addEventListener\(\s*["'`]click/.exec(js)
  return direct ? direct[1] : null
}

function inferTechnique(code, html) {
  const t = new Set()
  const all = code + html
  if (/\bgsap\b/.test(all)) t.add('gsap-core')
  if (/ScrollTrigger/.test(all)) t.add('gsap-scrolltrigger')
  if (/\bLenis\b|lenis/.test(all)) t.add('lenis')
  if (/THREE|three\.module|WebGLRenderer/.test(all)) t.add('threejs')
  if (/ShaderMaterial|fragmentShader|createShader|gl_FragColor/.test(all)) t.add('webgl-shader')
  if (/getContext\(\s*["']2d/.test(all)) t.add('canvas2d')
  if (/startViewTransition/.test(all)) t.add('view-transitions')
  if (/animation-timeline\s*:/.test(all)) t.add('scroll-timeline')
  if (!t.size) t.add('css-only')
  return [...t].sort()
}

/**
 * `effect` off the tutorial title, and ONLY where the word is unambiguous.
 *
 * This is the one derived tag that is a guess rather than a reading, so it is
 * deliberately narrow: a term has to be in the controlled vocabulary already,
 * and it has to appear as a whole word. Everything it does not match comes out
 * empty and gets listed for a read. An unclassified item is findable by title
 * and text search; a wrongly classified one is findable under a filter that
 * lies, which is the failure the controlled vocabulary exists to prevent.
 */
const EFFECT_WORDS = {
  marquee: 'marquee', 'infinite-scroll': 'marquee',
  'horizontal-scroll': 'pinned-horizontal', pinned: 'pinned-horizontal', pinning: 'pinned-horizontal',
  sticky: 'sticky-stack', 'stacking-cards': 'sticky-stack', 'card-stack': 'sticky-stack',
  'image-trail': 'image-trail', trail: 'image-trail',
  magnetic: 'magnetic',
  scramble: 'text-scramble', shuffle: 'text-scramble', decode: 'text-scramble', typewriter: 'text-scramble',
  mask: 'mask-reveal', 'clip-path': 'mask-reveal', clip: 'mask-reveal', reveal: 'mask-reveal',
  'page-transition': 'page-transition', 'page-transitions': 'page-transition',
  parallax: 'parallax',
  tilt: 'hover-tilt', '3d-hover': 'hover-tilt',
  cursor: 'cursor-distortion', distortion: 'cursor-distortion',
  preloader: 'preloader', loader: 'preloader', loading: 'preloader',
  morph: 'morph', morphing: 'morph', gooey: 'morph', liquid: 'morph', metaball: 'morph',
  flip: 'flip-layout',
  carousel: 'infinite-list', slider: 'infinite-list', 'infinite-list': 'infinite-list',
  stagger: 'stagger',
}

function inferEffect(...sources) {
  const words = sources.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const joined = ' ' + words.join(' ') + ' '
  const hits = new Set()
  for (const [term, tag] of Object.entries(EFFECT_WORDS)) {
    const phrase = ' ' + term.split('-').join(' ') + ' '
    if (joined.includes(phrase)) hits.add(tag)
  }
  return [...hits].filter((e) => EFFECT.includes(e)).sort()
}

// ─── build the item ──────────────────────────────────────────────────────────

const rewritten = new Map()
let combinedJs = ''
let combinedHtml = ''
let combinedCss = ''

for (const rel of files) {
  const ext = path.extname(rel).toLowerCase()
  if (!TEXT.has(ext)) continue
  let text = await readFile(path.join(src, rel), 'utf8')
  if (ext === '.js' || ext === '.mjs') { text = rewriteImports(text, rel); combinedJs += text }
  if (ext === '.html' || ext === '.htm') { text = rewriteCdn(text); text = deadLinks(text); combinedHtml += text }
  if (ext === '.css') combinedCss += text
  text = relativise(text, rel)
  rewritten.set(rel, text)
}

// The readiness signal, and the vendored scripts the import rewrite created.
{
  let html = rewritten.get(entry)

  const inject = []
  if (Object.keys(importmap).length) {
    inject.push(`    <script type="importmap">\n${JSON.stringify({ imports: importmap }, null, 6).replace(/^/gm, '    ')}\n    </script>`)
  }
  for (const s of needScripts) inject.push(`    <script src="${s}"></script>`)

  if (inject.length) {
    // Before the item's own script, and before </head> so an importmap precedes
    // every module — the spec requires that, and a late importmap is ignored
    // silently rather than erroring.
    html = html.includes('</head>')
      ? html.replace('</head>', `${inject.join('\n')}\n  </head>`)
      : inject.join('\n') + '\n' + html
  }

  // type="module" even when the item's script is classic. Module scripts are
  // deferred and execute in order after everything classic in the body, so this
  // is the one placement that runs last in both cases. A classic inline script
  // here would run BEFORE a module script and signal ready to an empty page.
  const ready = `
    <script type="module">
      // morgue: capture readiness. Two frames after fonts settle — the harness
      // pumps its faked clock while polling, so rAF here is safe, and gating on
      // document.fonts stops a text effect being measured mid-swap.
      const ready = () =>
        requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true }));
      if (document.fonts?.ready) document.fonts.ready.then(ready);
      else ready();
    </script>
  `
  html = html.includes('</body>') ? html.replace('</body>', `${ready}</body>`) : html + ready
  rewritten.set(entry, html)
}

const script = combinedJs + combinedHtml
const trigger = inferTrigger(script, combinedCss)
const technique = inferTechnique(combinedJs, combinedHtml + combinedCss)

const titleFromHtml = /<title>([^<]*)<\/title>/i.exec(combinedHtml)?.[1]?.replace(/\s*\|\s*Codegrid\s*$/i, '').trim()
const title = flags.title ?? (titleFromHtml || SLUG.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()))
const effect = inferEffect(SLUG, title, flags['source-archive'] ? path.basename(String(flags['source-archive'])) : '')

if (!effect.length) unresolved.push(`effect: nothing in the title or slug maps to the vocabulary — classify by watching the capture`)
unresolved.push(`surface: not derivable from source — pick one of button|card|nav|hero|cursor|list|image|text|page`)
for (const u of [...new Set(unknownRemote)]) unresolved.push(`remote asset left in place: ${u}`)

const clickSelector = trigger === 'click' ? inferClickSelector(script) : null
if (trigger === 'click' && !clickSelector) {
  unresolved.push(
    'trigger is click but no selector could be read — the capture will record the resting state. ' +
      'Add capture.json "click": { "selector": "…", "at": 0.2 }',
  )
}

const capture = {
  // `click` is not a capture trigger; the harness loads the page and fires one
  // click at `at`. Same shape negfilms-lens-slide-transition uses.
  trigger: trigger === 'hover' || trigger === 'pointer' ? 'pointer' : trigger === 'scroll' ? 'scroll' : 'load',
  viewport: { width: 1280, height: 800 },
  durationMs: trigger === 'scroll'
    ? 5000
    : inferDuration(script, clickSelector ? 4000 : 3000),
  fps: 30,
  ...(trigger === 'scroll' ? { scroll: { from: 0, to: 'max', ease: 'inOut' } } : {}),
  ...(clickSelector ? { click: { selector: clickSelector, at: 0.2 } } : {}),
  ...(trigger === 'hover' || trigger === 'pointer'
    ? { pointerPath: [
        // A sweep across the vertical middle, not a corner-to-corner diagonal.
        // The diagonal spends most of its length in the margins of a centred
        // layout and misses the thing being hovered; this crosses the content
        // band, which is where a hover target almost always is. Still a guess —
        // check the contact sheet (rule 5).
        { at: 0.0, x: 80, y: 420 },
        { at: 0.35, x: 470, y: 380 },
        { at: 0.7, x: 860, y: 440 },
        { at: 1.0, x: 1200, y: 400 },
      ] }
    : {}),
  posterAt: 0.55,
  settleMs: 600,
  // Doubles the frame count, so on by default only where a capture ends
  // somewhere other than where it started (CLAUDE.md, capture.json). A click
  // capture ends with the thing open, so it earns one too.
  boomerang: trigger === 'scroll' || Boolean(clickSelector),
}

const meta = {
  title,
  kind: 'static',
  effect,
  technique,
  trigger: trigger === 'pointer' ? 'hover' : trigger,
  surface: null,
  weight: combinedJs.length > 12000 || technique.includes('threejs') ? 'heavy' : combinedJs.length > 4000 ? 'medium' : 'light',
  source: flags.source ?? 'codegrid',
  sourceUrl: null,
  sourceArchive: flags['source-archive'] ?? null,
  license: flags.license ?? 'paid',
  addedAt: flags['added-at'] ?? new Date().toISOString().slice(0, 10),
  usedIn: [],
  export: {
    files: [entry],
    deps: technique.includes('gsap-core') ? { gsap: '^3.15.0' } : {},
    scaffold: [],
    notes: '',
  },
}

// surface is nullable in the schema sense but assertVocab checks it when set;
// validate everything we DID derive before writing anything at all.
assertVocab(meta, `ingest ${SLUG}`)

if (DRY) {
  console.log(JSON.stringify({ slug: SLUG, meta, capture, files: files.length, notes, unresolved }, null, 2))
  process.exit(0)
}

// Content fingerprint, against the whole collection. The batch guards against two deliveries
// deriving the same SLUG — but the same component re-downloaded under a different folder name
// derives a DIFFERENT slug, clears that guard, and lands as a second card, the exact duplicate
// the guard exists to stop, walking straight around it. The rewritten index.html is the cheap,
// decisive signature: two ingests of one component produce it byte-for-byte, two genuinely
// different components effectively never collide. Refuse an exact match; --allow-dup is the
// escape hatch for the rare false positive.
if (entry && !flags['allow-dup']) {
  const mine = createHash('sha256')
    .update(rewritten.has(entry) ? rewritten.get(entry) : await readFile(path.join(src, entry)))
    .digest('hex')
  const siblings = existsSync(ITEMS)
    ? (await readdir(ITEMS, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== SLUG)
    : []
  for (const d of siblings) {
    const idx = path.join(ITEMS, d.name, 'index.html')
    if (!existsSync(idx)) continue
    if (createHash('sha256').update(await readFile(idx)).digest('hex') === mine) {
      die(
        `"${d.name}" already has this exact page — identical rewritten index.html. This is almost ` +
          `certainly the same component ingested twice under different slugs. Pass --allow-dup if it ` +
          `is genuinely a different item.`,
      )
    }
  }
}

for (const rel of files) {
  const to = path.join(dest, rel)
  await mkdir(path.dirname(to), { recursive: true })
  if (rewritten.has(rel)) await writeFile(to, rewritten.get(rel))
  else await copyFile(path.join(src, rel), to)
}

await writeFile(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
await writeFile(path.join(dest, 'capture.json'), JSON.stringify(capture, null, 2) + '\n')

// notes.md is a STUB, and says so. The tool knows exactly what it changed and
// writes that truthfully; it does not know how the effect works, and inventing
// a paragraph that sounds like it does is worse than an empty heading.
await writeFile(
  path.join(dest, 'notes.md'),
  `# ${title}\n\n` +
    `<!-- STUB — the "How it works" section below is unwritten. Everything under\n` +
    `     "Changes made for the vault" was recorded by bin/ingest.mjs and is accurate. -->\n\n` +
    `## How it works\n\nTODO — read the source and describe the effect.\n\n` +
    `## Changes made for the vault\n\n` +
    (notes.length ? notes.map((n) => `- ${n}`).join('\n') : '- None. The delivery ran as-is.') +
    `\n\n## Capture\n\n` +
    `\`trigger: "${capture.trigger}"\`, inferred from the source. ` +
    `${capture.durationMs}ms at ${capture.fps}fps, boomerang ${capture.boomerang}.\n`,
)

console.log(`items/${SLUG}/  ${files.length} file(s), ${notes.length} rewrite(s)`)
for (const n of notes) console.log(`    ${n}`)
if (unresolved.length) {
  console.log(`  needs a read:`)
  for (const u of unresolved) console.log(`    · ${u}`)
}

if (flags.report) {
  const line = JSON.stringify({ slug: SLUG, src: path.relative(ROOT, src), notes, unresolved, meta, capture })
  await writeFile(path.resolve(ROOT, flags.report), line + '\n', { flag: 'a' })
}
