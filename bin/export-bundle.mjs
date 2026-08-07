// Formats one item as a markdown bundle an agent can act on directly.
//
// Shared by the CLI (bin/export.mjs) and the web detail page, so there is one
// definition of "what an export looks like" rather than two that drift.
//
// The design problem this solves is NOT copying — it is that a fixture's
// index.html is mostly harness. Demo pages centre themselves in a 100vh grid,
// hide overflow on body, load vendor scripts from morgue's own paths, and set
// window.__ready for the capture clock. Pasted verbatim, an agent wires all of
// that into your project and the result looks plausible while being wrong.
//
// So the bundle separates the component from the scaffolding, and states
// provenance and licence at the top where they cannot be missed.

import { VENDOR } from './vendor.mjs'

const LICENCE_LINE = {
  own: 'Written for morgue. Safe to use anywhere.',
  mit: 'MIT. Attribution appreciated, not required.',
  paid: '⚠️  PAID LICENCE. Purchased for personal reference. Do NOT ship this in client work without checking the original EULA.',
  unknown: '⚠️  LICENCE UNKNOWN. Treat as all-rights-reserved until you have established otherwise.',
}

/** Where this came from. Travels with the code, deliberately. */
function provenance(item) {
  const lines = [`- **Origin:** ${item.source ?? 'unknown'}`]
  if (item.sourceUrl) lines.push(`- **Source URL:** ${item.sourceUrl}`)
  // Deliberately separate from sourceUrl. sourceUrl is the product page — the
  // thing that answers "what am I allowed to do with this". sourceArchive is
  // the local delivery it was ingested from, which answers "which download was
  // this, and is it the same one as that other item". Paid templates routinely
  // arrive as a dated bundle with no URL anywhere inside them, so without this
  // the only honest answer six months later is "codegrid, somehow".
  if (item.sourceArchive) lines.push(`- **Ingested from:** \`${item.sourceArchive}\``)
  lines.push(`- **In morgue as:** \`${item.slug}\`  (\`items/${item.slug}/\`)`)
  if (item.addedAt) lines.push(`- **Collected:** ${item.addedAt}`)
  if (item.usedIn?.length) lines.push(`- **Already shipped in:** ${item.usedIn.join(', ')}`)
  return lines.join('\n')
}

// ─── Dependencies ──────────────────────────────────────────────────────────
// This section used to print "_None — vanilla CSS/JS._" whenever export.deps
// was absent. True for a hand-written fixture; a confident lie for a Next.js
// item, and the reader has no way to tell which one they are holding. An agent
// installs nothing, pastes the code, and it fails on the first bare import.
//
// So: never assert "none" without evidence, and when there is no curated
// answer, say that rather than inventing one. Evidence comes only from the
// built record — exportFiles, technique, kind — never from the filesystem.
// buildBundle also runs inside the web detail page, where items/ does not
// exist (the vault is R2-resident and Vercel never sees the collection), so an
// fs read would make the web bundle and the CLI bundle disagree about the same
// item. Two answers to "what does this need" is the failure this whole module
// exists to prevent.

/**
 * '/three/' → 'three'. Derived from the vendor map rather than restated, so a
 * library added there (rule 3) becomes detectable here too. A vendored path is
 * how a demo references a library — the package name never appears in it.
 */
const VENDOR_PACKAGE = Object.fromEntries(
  Object.entries(VENDOR).map(([prefix, dir]) => [
    prefix,
    dir.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1] ?? prefix.replaceAll('/', ''),
  ]),
)

/**
 * technique is a controlled vocabulary (see CLAUDE.md), so this is a lookup and
 * not a guess. It is the only signal left for an item whose source is not
 * inlined — an `unextracted` template sitting on 2,000 files still knows it is
 * Next.js. Tags with no package behind them (css-only, scroll-timeline,
 * webgl-shader, canvas2d, view-transitions) are deliberately absent.
 */
const TECHNIQUE_PACKAGE = {
  'gsap-core': 'gsap',
  'gsap-scrolltrigger': 'gsap',
  threejs: 'three',
  lenis: 'lenis',
  'motion/framer': 'motion',
  react: 'react',
  nextjs: 'next',
}

const CODE_EXT = new Set(['html', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte'])
const ASSET_SPECIFIER =
  /\.(css|s[ac]ss|less|html|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|json|txt|mp4|webm)$/i
const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]([^'"\n]+)['"]/g

/** Bare specifier → package name. `gsap/SplitText` → `gsap`, `@gsap/react` → itself. */
function packageOf(specifier) {
  if (!specifier || /^[./]/.test(specifier)) return null // relative or absolute path
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null // node:, http:, data:
  if (ASSET_SPECIFIER.test(specifier)) return null
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  return /^(?:@[a-z0-9-~][\w.~-]*\/)?[a-z0-9-~][\w.~-]*$/.test(name) ? name : null
}

/** Libraries the inlined source demonstrably reaches for → why we think so. */
function librariesInSource(item) {
  const found = new Map()
  for (const [file, body] of Object.entries(item.exportFiles ?? {})) {
    if (typeof body !== 'string') continue
    // Raw text, not a script-src regex: the same prefix shows up in an
    // importmap target (`{"three": "/three/three.module.js"}`) and in a bare
    // module import (`import Lenis from '/lenis/lenis.mjs'`), both of which are
    // real usage and neither of which is a <script src>.
    for (const [prefix, pkg] of Object.entries(VENDOR_PACKAGE)) {
      if (body.includes(prefix) && !found.has(pkg)) found.set(pkg, `\`${prefix}\` in ${file}`)
    }
    if (!CODE_EXT.has(file.split('.').pop()?.toLowerCase())) continue
    for (const [, spec] of body.matchAll(SPECIFIER)) {
      const pkg = packageOf(spec)
      if (pkg && !found.has(pkg)) found.set(pkg, `imported in ${file}`)
    }
  }
  return found
}

// Deliberately not "read the item's package.json and list that". A template's
// package.json describes the whole template, not the effect: blunt-preloader's
// lists `three`, which nothing under its src/ imports. Reading it naively would
// swap one confident lie for another — this time one that costs an install and
// a bundle. The curated export.deps is the corrective for exactly that, so when
// it exists it wins outright; when it does not, we say so and point at the
// source, where the imports are the ground truth.
const PACKAGE_JSON_CAVEAT =
  'If the item ships a `package.json`, treat it as a lead and not an answer — a template lists ' +
  'what the whole template needs, not what this effect needs, and routinely names packages ' +
  'nothing in its source imports. The imports are the ground truth.'

function deps(item) {
  const recorded = Object.entries(item.export?.deps ?? {})
  const used = librariesInSource(item)

  if (recorded.length) {
    const lines = recorded.map(([name, range]) => `- \`${name}\` ${range}`)
    // Curated wins — but if the source reaches for something the curation
    // missed, an install built from this list alone fails, so say it.
    const unlisted = [...used.keys()].filter((pkg) => !recorded.some(([name]) => name === pkg))
    if (unlisted.length) {
      lines.push(
        '',
        `⚠️ Also referenced by the source below but absent from \`export.deps\`: ` +
          `${unlisted.map((p) => `\`${p}\``).join(', ')}. Version unknown — check before installing.`,
      )
    }
    return lines.join('\n')
  }

  // A reference item is a recording and a description. "No dependencies" is not
  // a fact about it; there is nothing to have dependencies.
  if (item.kind === 'reference') return '_Not applicable — reference only, no code._'

  const inferred = new Map(used)
  for (const t of item.technique ?? []) {
    const pkg = TECHNIQUE_PACKAGE[t]
    if (pkg && !inferred.has(pkg)) inferred.set(pkg, `technique \`${t}\``)
  }

  const sawSource = Object.keys(item.exportFiles ?? {}).length > 0

  if (inferred.size) {
    return [
      `⚠️ **Not recorded.** \`export.deps\` is empty in \`items/${item.slug}/meta.json\`, so the ` +
        `list below is inferred from this item, not curated. Versions are unknown. Verify before installing.`,
      '',
      ...[...inferred].map(([pkg, why]) => `- \`${pkg}\` — version unknown _(${why})_`),
      '',
      PACKAGE_JSON_CAVEAT,
    ].join('\n')
  }

  // The only case that may claim nothing: source was inlined, and nothing in it
  // imports a package or touches a vendored path. A `project` needs a build, so
  // it has a package.json by definition and never qualifies; an `unextracted`
  // item inlines no source at all, so there is nothing to have checked.
  if (sawSource && item.kind === 'static') {
    return (
      '_None. No bare import and no vendored script path appears in the source below — ' +
      'vanilla CSS/JS._'
    )
  }

  return (
    `⚠️ **Not recorded, and not checkable from this bundle.** \`export.deps\` is empty in ` +
    `\`items/${item.slug}/meta.json\` and no source is inlined here, so this is not a claim that ` +
    `there are none. Read \`items/${item.slug}/\` before wiring this up. ${PACKAGE_JSON_CAVEAT}`
  )
}

function fence(filename, body) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const lang =
    { html: 'html', css: 'css', js: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', json: 'json' }[ext] ?? ''
  return `**\`${filename}\`**\n\n\`\`\`${lang}\n${body.trimEnd()}\n\`\`\``
}

export function buildBundle(item) {
  const licence = LICENCE_LINE[item.license] ?? LICENCE_LINE.unknown
  const out = []

  out.push(`# ${item.title}`)
  out.push('')
  out.push(`> **Licence — ${String(item.license ?? 'unknown').toUpperCase()}.** ${licence}`)
  out.push('')
  out.push('## Provenance')
  out.push('')
  out.push(provenance(item))
  out.push('')
  out.push('## Classification')
  out.push('')
  out.push(
    [
      `- **Effect:** ${(item.effect ?? []).join(', ') || '—'}`,
      `- **Technique:** ${(item.technique ?? []).join(', ') || '—'}`,
      `- **Trigger:** ${item.trigger} · **Surface:** ${item.surface} · **Weight:** ${item.weight}`,
    ].join('\n'),
  )
  out.push('')
  out.push('## Dependencies')
  out.push('')
  out.push(deps(item))
  out.push('')

  if (item.notes?.trim()) {
    out.push('## How it works')
    out.push('')
    out.push(item.notes.trim())
    out.push('')
  }

  // A reference item is a video and a description — there is no code to give,
  // and pretending otherwise wastes the agent's time.
  if (item.kind === 'reference') {
    out.push('## Source')
    out.push('')
    out.push(
      '_No source. This item was collected as a reference recording only — ' +
        'rebuild from the description above, or visit the source URL._',
    )
    return out.join('\n')
  }

  if (item.kind === 'unextracted') {
    out.push('## Source')
    out.push('')
    out.push(
      `_Not extracted. The effect lives inside a larger template at ` +
        `\`items/${item.slug}/\`${item.export?.entry ? `, entry \`${item.export.entry}\`` : ''}. ` +
        `Pull the section out before using it — it will have dependencies on the ` +
        `surrounding page._`,
    )
    return out.join('\n')
  }

  const files = item.exportFiles ?? {}
  const names = Object.keys(files)
  out.push('## Source')
  out.push('')
  if (names.length) {
    for (const name of names) out.push(fence(name, files[name]), '')
  } else {
    // Say so rather than emitting a confident-looking bundle with nothing in
    // it. An empty Source section on a static/project item means meta.json's
    // export.files points at paths that do not exist.
    out.push(
      `⚠️ **No source was inlined.** \`export.files\` in \`items/${item.slug}/meta.json\` ` +
        `does not match any file on disk. Fix the paths and re-run \`pnpm build\`.`,
    )
    out.push('')
  }

  // The part that stops an agent from faithfully reproducing the demo harness.
  const scaffold = item.export?.scaffold ?? []
  const hints = item.export?.notes
  out.push('## Adapting this')
  out.push('')
  const adapt = []
  if (scaffold.length) {
    adapt.push(
      `- **Demo scaffolding — do not copy:** ${scaffold.map((s) => `\`${s}\``).join(', ')}. ` +
        `These centre and size the standalone demo page; positioning is the parent's job in your project.`,
    )
  }
  adapt.push(
    '- **Vendor scripts:** any `<script src="/vendor/…">` or `/three/`, `/lenis/` path is ' +
      "morgue's local copy. Replace with a real import from the dependencies above.",
  )
  adapt.push(
    '- **`window.__ready = true`** is a signal to the capture harness. Delete it.',
  )
  if (hints) adapt.push(`- ${hints}`)
  out.push(adapt.join('\n'))

  return out.join('\n')
}
