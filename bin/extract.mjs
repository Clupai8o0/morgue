#!/usr/bin/env node
// Materialises ONE surveyed candidate into items/<slug>/.
//
//   pnpm extract <archive> <candidate-id> [--slug <slug>] [--dry-run]
//                [--accept-blockers] [--license <l>] [--source <s>] [--source-url <u>]
//
// This is the only command in the pair that writes items/, and running it IS
// the acceptance — there is no second approval step to forget. It refuses
// rather than overwrites, always:
//
//   · the id must exist in candidates.json — a slug cannot be conjured out of
//     nothing, which is what stops an agent inventing items at scale
//   · items/<slug>/ must not exist. There is deliberately no --force. That
//     directory holds paid third-party source with no backup.
//   · a candidate already marked `extracted` is refused
//   · any coupling finding of severity `blocker` stops it unless you pass
//     --accept-blockers and thereby say you read the reason
//   · every effect/technique/trigger/surface/weight/kind tag must be in the
//     controlled vocabulary, whether it came from the static pass or a model
//
// What it produces is a SCAFFOLD, not a guarantee. It does not run capture,
// build or check; it prints them in order. The value is the coupling report
// telling you what to look at, not a green build.

import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertVocab, resolveArchive, ARCHIVES } from './survey.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// MORGUE_ITEMS mirrors MORGUE_SRC in the rest of bin/: it exists so this can be
// exercised against a scratch directory without going anywhere near the real
// collection.
// resolve, not join — an absolute MORGUE_ITEMS must escape the repo.
const ITEMS = path.resolve(ROOT, process.env.MORGUE_ITEMS || 'items')

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i < 0 ? null : argv[i + 1] }
const FLAGS_WITH_VALUES = ['--slug', '--license', '--source', '--source-url']
const positional = argv.filter((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUES.includes(argv[i - 1]))
const [archiveArg, candidateId] = positional

const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1) }

if (!archiveArg || !candidateId) {
  console.error('Usage: pnpm extract <archive> <candidate-id> [--slug <slug>] [--dry-run] [--accept-blockers]\n')
  console.error('Run `pnpm survey <archive>` first — extract can only materialise a candidate that survey proposed.')
  process.exit(1)
}

const candidatesFile = path.join(ARCHIVES, archiveArg, 'candidates.json')
if (!existsSync(candidatesFile)) die(`No survey for "${archiveArg}". Run: pnpm survey ${archiveArg}`)
const report = JSON.parse(await readFile(candidatesFile, 'utf8'))

const candidate = report.candidates.find((c) => c.id === candidateId)
if (!candidate) {
  die(`"${candidateId}" is not a candidate in ${path.relative(ROOT, candidatesFile)}.\n  Available: ${report.candidates.map((c) => c.id).join(', ')}`)
}
if (candidate.status === 'extracted') {
  die(`"${candidateId}" was already extracted as items/${candidate.extractedAs}/ on ${candidate.extractedAt}.\n  Re-extracting would need a different --slug, and probably means the first one was wrong.`)
}

// ─── merge the static suggestion with the model overlay ─────────────────────
// `suggest` is deterministic and immutable to a model. `enrich` is additive and
// may only ever contain the judgement calls: a title that has seen the video,
// prose, export notes, scaffold selectors. Merged, then validated — the
// validation is what makes accepting model output safe.
const s = candidate.suggest
const e = candidate.enrich ?? {}
const merged = {
  title: e.title ?? s.title,
  kind: e.kind ?? s.kind,
  effect: e.effect ?? s.effect,
  technique: e.technique ?? s.technique,
  trigger: e.trigger ?? s.trigger,
  surface: e.surface ?? s.surface,
  weight: e.weight ?? s.weight,
}
try {
  assertVocab(merged, `${archiveArg}/${candidateId} (${candidate.enrich ? 'suggest + enrich' : 'suggest'})`)
} catch (err) {
  die(err.message)
}
if (s.titleIsFilename && !e.title) {
  console.error(`  note: title "${merged.title}" is a file name. Watch the capture and rewrite it — that is the field a human searches by.`)
}

const slug = val('--slug') ?? e.slug ?? s.slug
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) die(`"${slug}" is not a usable slug (lowercase, digits and hyphens).`)

const dest = path.join(ITEMS, slug)
if (existsSync(dest)) {
  die(`items/${slug}/ already exists.\n  There is no --force. That directory may hold paid source with no backup; pick another --slug or delete it yourself, deliberately.`)
}

// ─── gates ──────────────────────────────────────────────────────────────────
const blockers = [
  ...candidate.blockers,
  ...candidate.coupling.filter((c) => c.severity === 'blocker').map((c) => ({ code: c.code, why: `${c.file}${c.line ? ':' + c.line : ''} — ${c.what}: ${c.why}` })),
]
if (blockers.length && !flag('--accept-blockers')) {
  console.error(`\n✗ ${blockers.length} blocker(s) on "${candidateId}":\n`)
  for (const b of blockers) console.error(`  ${b.code}\n    ${b.why}\n`)
  console.error('Read those, then re-run with --accept-blockers if you still want the scaffold.')
  console.error('A capture-trigger blocker in particular means the harness CANNOT record this effect —')
  console.error('you will get a still frame and `motion: OK`, which is CLAUDE.md rule 5 exactly.\n')
  process.exit(1)
}

// The archive can be edited after a survey, and then every line number in the
// coupling report is quietly wrong. Warn, never refuse: a stale line number is
// a nuisance, a refusal in the middle of a workflow is worse.
const resolvedArchive = resolveArchive(report.archiveDir ?? archiveArg)
if (!resolvedArchive) die(`The archive itself is missing: ${report.archiveDir ?? archiveArg}`)
const archiveRoot = resolvedArchive.dir

// ─── read the closure ───────────────────────────────────────────────────────
const files = new Map()
for (const rel of candidate.closure.files) {
  const abs = path.join(archiveRoot, rel)
  if (!existsSync(abs)) die(`closure file missing from the archive: ${rel}\n  The survey is stale. Re-run: pnpm survey ${archiveArg}`)
  files.set(rel, await readFile(abs, 'utf8'))
}

const archivePkg = existsSync(path.join(archiveRoot, 'package.json'))
  ? JSON.parse(await readFile(path.join(archiveRoot, 'package.json'), 'utf8'))
  : { dependencies: {} }

// Real packages at the archive's real versions, and only the ones the closure
// actually imports. CLAUDE.md is explicit that export.deps are real packages,
// not morgue's vendored copies — and blunt declares `three` while importing it
// nowhere, so "what package.json says" is not an answer.
const externals = new Set()
for (const src of files.values()) {
  for (const m of src.matchAll(/\bfrom\s*['"]([^.'"][^'"]*)['"]/g)) {
    externals.add(m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0])
  }
  for (const m of src.matchAll(/^\s*import\s*['"]([^.'"][^'"]*)['"]/gm)) {
    externals.add(m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0])
  }
}
const deps = {}
for (const p of [...externals].sort()) {
  if (archivePkg.dependencies?.[p]) deps[p] = archivePkg.dependencies[p]
  else if (archivePkg.devDependencies?.[p]) deps[p] = archivePkg.devDependencies[p]
}
const isProject = merged.kind === 'project'
if (isProject) for (const p of ['next', 'react', 'react-dom']) {
  if (archivePkg.dependencies?.[p]) deps[p] = archivePkg.dependencies[p]
}

// ─── what the coupling report demands of the scaffold ───────────────────────
const finding = (code) => candidate.coupling.filter((c) => c.code === code)
const neededVars = [...new Set(finding('css-var-foreign').flatMap((c) => c.vars ?? []))]
const neededClasses = [...new Set(finding('css-class-global').flatMap((c) => c.classes ?? []))]
const providers = finding('provider-required').map((c) => c.what.match(/^(\w+)\(/)?.[1]).filter(Boolean)
const templateAssets = finding('asset-template-literal')

// ─── globals.css: exactly what the closure reads, and nothing else ──────────
// This is where the coupling report pays for itself. Copying the archive's
// whole globals.css would drag in 11 custom properties, every heading rule and
// the section layout — furniture that makes the isolate look right for reasons
// that have nothing to do with the effect.
const globalCssSources = ['src/app/globals.css', 'app/globals.css', 'src/styles/globals.css']
  .map((p) => path.join(archiveRoot, p)).filter(existsSync)
const archiveGlobals = globalCssSources.length ? await readFile(globalCssSources[0], 'utf8') : ''

function ruleFor(css, selectorRe) {
  const out = []
  for (const raw of css.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/g)) {
    // A preceding comment gets swept into the selector text by the regex above.
    // Strip it: an unlucky match otherwise drags a 12-line rationale block into
    // the isolate's stylesheet.
    const m = { index: raw.index, 0: raw[0], 2: raw[2].replace(/\/\*[\s\S]*?\*\//g, '').trim() }
    if (!m[2] || !selectorRe.test(m[2])) continue
    const open = m.index + m[0].length - 1
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (!depth) { out.push(`${m[2].trim()} ${css.slice(open, i + 1)}`); break } }
    }
  }
  return out
}
function atRules(css, name) {
  const out = []
  for (const m of css.matchAll(new RegExp(`@${name}\\b[^{]*\\{`, 'g'))) {
    const open = m.index + m[0].length - 1
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') { depth--; if (!depth) { out.push(css.slice(m.index, i + 1)); break } }
    }
  }
  return out
}

const varDecls = []
for (const v of neededVars) {
  const m = archiveGlobals.match(new RegExp(`^\\s*(${v}\\s*:[^;]+;)`, 'm'))
  if (m) varDecls.push('  ' + m[1].trim())
  else varDecls.push(`  /* TODO ${v}: not found in the archive's globals.css — provided at runtime? */`)
}

const globalsCssRaw = [
  `/* Synthesised by \`pnpm extract ${archiveArg} ${candidateId}\`.`,
  ` *`,
  ` * Only what the closure provably reads. Everything else in the archive's`,
  ` * globals.css was left behind on purpose: an isolate that looks right`,
  ` * because it inherited 200 lines of template furniture teaches you nothing`,
  ` * about the effect, and the furniture travels into every paste.`,
  ` */`,
  '',
  ...atRules(archiveGlobals, 'font-face').map((r) => r + '\n'),
  neededVars.length ? `:root {\n${varDecls.join('\n')}\n}\n` : '',
  '/* Reset — SCAFFOLD. Listed in meta.json export.scaffold: do not copy this',
  '   into a host project that already has one. Kept because a component that',
  '   only looks right under a global reset is the single most common silent',
  '   breakage, and leaving it out hides that dependency instead of naming it. */',
  ...ruleFor(archiveGlobals, /^\*$/).map((r) => r + '\n'),
  neededClasses.length
    ? `/* Global utility classes the closure's JSX names as string literals.\n   SCAFFOLD — layout, not effect. */\n${neededClasses.flatMap((c) => ruleFor(archiveGlobals, new RegExp(`(^|[\\s,])\\.${c}([\\s,.:]|$)`))).join('\n')}\n`
    : '',
].filter(Boolean).join('\n')

// ─── layout / providers / page ──────────────────────────────────────────────
const anchorRel = candidate.suggest.entry ?? candidate.anchor
const anchorSrc = files.get(anchorRel) ?? ''
const anchorName = anchorSrc.match(/export\s+default\s+function\s+([\w$]+)/)?.[1]
  ?? path.basename(anchorRel).replace(/\.\w+$/, '')
// A provider component rendered bare shows nothing at all. Detect it and put a
// visible placeholder inside, with a TODO — better than a blank capture that
// reports motion: OK because the page faded in.
const anchorTakesChildren = /export\s+default\s+function\s+[\w$]*\s*\(\s*\{[^}]*\bchildren\b/.test(anchorSrc)

const PROVIDER_WRAPPERS = {
  useLenis: { import: `import { ReactLenis } from "lenis/react"`, open: '<ReactLenis root>', close: '</ReactLenis>' },
  useTransitionState: { import: `import { TransitionRouter } from "next-transition-router"`, open: '<TransitionRouter auto>', close: '</TransitionRouter>' },
  useTransitionRouter: { import: `import { TransitionRouter } from "next-transition-router"`, open: '<TransitionRouter auto>', close: '</TransitionRouter>' },
}
const wrappers = [...new Set(providers)].map((h) => PROVIDER_WRAPPERS[h]).filter(Boolean)

const providersFile = wrappers.length ? [
  '"use client";',
  '',
  '// Synthesised from the survey\'s `provider-required` findings, and containing',
  '// nothing that was not demanded by one. A hook whose provider is missing',
  '// returns null and the effect silently does not run — that is the failure',
  '// this file exists to prevent.',
  ...wrappers.map((w) => w.import + ';'),
  '',
  'export default function Providers({ children }) {',
  '  return (',
  `    ${wrappers.map((w) => w.open).join('')}`,
  '      {children}',
  `    ${wrappers.map((w) => w.close).reverse().join('')}`,
  '  );',
  '}',
  '',
].join('\n') : null

const layoutFile = [
  'import "./globals.css";',
  providersFile ? 'import Providers from "./providers";' : '',
  '',
  `export const metadata = { title: ${JSON.stringify(merged.title)} };`,
  '',
  'export default function RootLayout({ children }) {',
  '  return (',
  '    <html lang="en">',
  providersFile ? '      <body><Providers>{children}</Providers></body>' : '      <body>{children}</body>',
  '    </html>',
  '  );',
  '}',
  '',
].filter((l) => l !== '').join('\n')

const importAnchor = `import ${anchorName} from "@/${anchorRel.replace(/^src\//, '').replace(/\.(js|jsx|ts|tsx)$/, '')}";`
const pageFile = [
  '"use client";',
  '',
  'import { useEffect } from "react";',
  importAnchor,
  '',
  'export default function Page() {',
  '  // MORGUE capture signal. bin/capture.mjs replaces requestAnimationFrame with',
  '  // a stepped fake clock and polls for this flag before recording frame 0.',
  '  // Gated on document.fonts.ready because text split against fallback metrics',
  '  // records wrong for the whole capture without erroring.',
  '  useEffect(() => {',
  '    let cancelled = false;',
  '    document.fonts.ready.then(() => {',
  '      if (!cancelled) window.__ready = true;',
  '    });',
  '    return () => {',
  '      cancelled = true;',
  '    };',
  '  }, []);',
  '',
  '  return (',
  anchorTakesChildren
    ? `    <${anchorName}>\n      {/* TODO ${anchorName} takes children — it is a provider, and renders nothing on its own.\n          Put whatever the effect is supposed to act on here. */}\n      <main style={{ minHeight: "200vh" }} />\n    </${anchorName}>`
    : `    <${anchorName} />`,
  '  );',
  '}',
  '',
].join('\n')

// ─── assets ─────────────────────────────────────────────────────────────────
// Static string paths only. Template-literal paths are counted and named, never
// resolved — CLAUDE.md rule 11: `…/showreel_img_${i + 1}.jpg` has no string to
// find, so any claim that the asset copy is complete would be false.
//
// The synthesised globals.css is scanned alongside the closure, because the
// @font-face it carries is an asset reference like any other and a missing font
// records at completely different metrics without erroring.
const ASSET_RE = /["'(](\/[^"'`)\s]+\.(?:jpe?g|png|webp|avif|gif|svg|mp4|webm|woff2?|glb|gltf|hdr))["')]/g
const assetPaths = new Set()
for (const src of [...files.values(), globalsCssRaw]) {
  for (const m of src.matchAll(ASSET_RE)) assetPaths.add(m[1])
}

// Source already ingested once carries /item/<oldslug>/… absolute paths.
// Retargeting that prefix is the one path edit that is mechanically safe, and
// without it every asset in the isolate 404s under its new slug.
const oldPrefix = [...assetPaths].map((p) => p.match(/^\/item\/([\w-]+)\//)?.[1]).find(Boolean)
function rewrite(src) {
  return oldPrefix ? src.replaceAll(`/item/${oldPrefix}/`, `/item/${slug}/`) : src
}
const globalsCss = rewrite(globalsCssRaw)

const assetPlan = []
const assetsMissing = []
for (const p of assetPaths) {
  const bare = p.replace(/^\/item\/[\w-]+\//, '/')
  const from = [archiveRoot, path.join(archiveRoot, 'public')]
    .map((base) => path.join(base, bare)).find(existsSync)
  if (from) assetPlan.push({ from, to: path.join(dest, bare.slice(1)), url: p })
  else assetsMissing.push(p)
}

// ─── meta.json ──────────────────────────────────────────────────────────────
const staticExportNotes = [
  ...candidate.coupling.filter((c) => c.severity === 'blocker' || c.severity === 'high')
    .map((c) => `${c.code}: ${c.what ?? ''} — ${c.why}`),
].join(' ')

const meta = {
  title: merged.title,
  kind: merged.kind,
  effect: merged.effect,
  technique: merged.technique,
  trigger: merged.trigger,
  surface: merged.surface,
  weight: merged.weight,
  // Provenance is never invented. CLAUDE.md is explicit that these fields
  // travel into every export and must be answerable from the paste alone, so
  // an unknown stays "unknown" and gets printed as a TODO instead of being
  // filled with something plausible.
  source: val('--source') ?? 'unknown',
  sourceUrl: val('--source-url') ?? null,
  sourceArchive: path.relative(ROOT, archiveRoot),
  license: val('--license') ?? 'unknown',
  addedAt: new Date().toISOString().slice(0, 10),
  usedIn: [],
  archive: {
    name: report.archive,
    role: 'extract',
    entry: anchorRel,
    route: candidate.route ?? null,
  },
  export: {
    // Mirrors archive.entry deliberately. bin/export-bundle.mjs already reads
    // export.entry; two fields with nearly the same meaning on one record will
    // disagree the moment one is edited alone, so extract writes both from the
    // same value and the relations work should pick one as canonical.
    entry: anchorRel,
    files: [anchorRel],
    deps,
    scaffold: [
      ...(candidate.enrich?.scaffold ?? []),
      ...(neededClasses.length ? neededClasses.map((c) => `.${c}`) : []),
      ...(ruleFor(archiveGlobals, /^\*$/).length ? ['*'] : []),
      'src/app/layout.js',
      'src/app/page.js',
    ],
    notes: candidate.enrich?.exportNotes ?? staticExportNotes,
  },
}
if (candidate.suggest.unmapped) {
  // No effect tag exists for e.g. a physics simulation. Refusing to invent one
  // is the whole point of a controlled vocabulary; extending it is a human's
  // call, so the fact is recorded where a human will see it.
  meta.export.notes = `${meta.export.notes} UNMAPPED (no vocabulary tag exists): ${candidate.suggest.unmapped.join('; ')}.`.trim()
}

// ─── plan ───────────────────────────────────────────────────────────────────
const writes = []
writes.push(['meta.json', JSON.stringify(meta, null, 2) + '\n'])
if (candidate.capture) writes.push(['capture.json', JSON.stringify(candidate.capture, null, 2) + '\n'])
writes.push(['notes.md', (candidate.enrich?.notes ?? candidate.notesSeed) + '\n'])
for (const [rel, src] of files) writes.push([rel, rewrite(src)])

if (isProject) {
  writes.push(['package.json', JSON.stringify({
    name: slug, private: true, version: '0.1.0',
    scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
    dependencies: deps,
  }, null, 2) + '\n'])
  writes.push(['next.config.mjs', [
    '// CLAUDE.md rule 2. Without assetPrefix every _next chunk 404s in the built',
    '// site while `pnpm capture` passes — the capture server strips the prefix, so',
    '// one build serves both and only `pnpm check` sees the difference.',
    'const nextConfig = {',
    "  output: 'export',",
    `  assetPrefix: '/item/${slug}',`,
    '  images: { unoptimized: true },',
    '};',
    '',
    'export default nextConfig;',
    '',
  ].join('\n')])
  // Without this the copied closure's `@/…` imports do not resolve and nothing
  // builds. It is not optional dressing.
  writes.push(['jsconfig.json', JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }, null, 2) + '\n'])
  writes.push(['src/app/globals.css', globalsCss])
  writes.push(['src/app/layout.js', layoutFile])
  if (providersFile) writes.push(['src/app/providers.js', providersFile])
  writes.push(['src/app/page.js', pageFile])
} else {
  writes.push(['index.html', [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${merged.title}</title>`,
    '<link rel="stylesheet" href="./globals.css">',
    '<!-- TODO static extraction is a stub: mount the anchor and set window.__ready. -->',
    `<script type="module" src="./${path.basename(anchorRel)}"></script>`,
    '',
  ].join('\n')])
  writes.push(['globals.css', globalsCss])
}

// ─── execute ────────────────────────────────────────────────────────────────
const dry = flag('--dry-run')
console.error(`\n${dry ? 'DRY RUN — would write' : 'writing'} items/${slug}/  (${writes.length} files + ${assetPlan.length} asset(s))\n`)
for (const [rel, body] of writes) console.error(`  ${rel.padEnd(52)} ${String(body.length).padStart(7)} B`)
for (const a of assetPlan) console.error(`  ${path.relative(dest, a.to).padEnd(52)} (asset)`)

if (dry) {
  console.error('\n--- meta.json ---')
  console.error(JSON.stringify(meta, null, 2))
  if (candidate.capture) {
    console.error('\n--- capture.json ---')
    console.error(JSON.stringify(candidate.capture, null, 2))
  }
} else {
  for (const [rel, body] of writes) {
    const abs = path.join(dest, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, body)
  }
  for (const a of assetPlan) {
    await mkdir(path.dirname(a.to), { recursive: true })
    await cp(a.from, a.to)
  }
  // The accept ledger. Without it a re-survey re-proposes work already done,
  // which at scale is how items/ fills with near-duplicates.
  candidate.status = 'extracted'
  candidate.extractedAs = slug
  candidate.extractedAt = new Date().toISOString()
  await writeFile(candidatesFile, JSON.stringify(report, null, 2) + '\n')
}

// ─── what to check, in order ────────────────────────────────────────────────
console.error('')
if (assetsMissing.length) {
  console.error(`! ${assetsMissing.length} referenced asset(s) not found in the archive and NOT copied:`)
  for (const a of assetsMissing) console.error(`    ${a}`)
  console.error('')
}
if (templateAssets.length) {
  console.error(`! ASSET COPY IS INCOMPLETE: ${templateAssets.length} template-literal path(s) in the closure —`)
  for (const t of templateAssets) console.error(`    ${t.file}:${t.line}`)
  console.error('  There is no string to find, so those files were not copied and cannot be.')
  console.error('  Copy the directory by hand. CLAUDE.md rule 11: a rename or a miss here 404s')
  console.error('  after hydration, which `pnpm check` cannot see — it loads one route for 1.4s.\n')
}
if (meta.license === 'unknown' || meta.source === 'unknown') {
  console.error('! PROVENANCE INCOMPLETE — fill these in meta.json before this item leaves the machine:')
  if (meta.source === 'unknown') console.error('    source      (who made it)')
  if (!meta.sourceUrl) console.error('    sourceUrl   (product page — or leave null and keep sourceArchive, a weak true claim)')
  if (meta.license === 'unknown') console.error('    license     (own | mit | paid | unknown)')
  console.error('  Provenance travels into every export. Six months from now "what am I allowed')
  console.error('  to do with this" must be answerable from the paste alone.\n')
}
console.error('This is a scaffold, not a working item. It will probably not build first try.')
console.error('The coupling report in notes.md is the list of things to check.\n')
console.error('Then, in order:')
console.error(`  cd items/${slug} && pnpm install && pnpm build   # only for kind: project`)
console.error(`  pnpm capture ${slug}`)
console.error('  pnpm build')
console.error(`  pnpm check`)
console.error('')
console.error('CLAUDE.md rule 5, verbatim:')
console.error('  **`motion: OK` does not mean correct.** It proves pixels changed, not that the')
console.error('  effect ran. Look at `out/<slug>/preview.mp4` before considering an item done.')
console.error('')
