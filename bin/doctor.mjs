#!/usr/bin/env node
// Says whether this machine can run morgue, and names EVERY missing piece at
// once.
//
// WHY "AT ONCE" IS THE WHOLE DESIGN. The failure mode this replaces is a
// sequence: run the thing, hit a wall, install one package, run it again, hit
// the next wall. Four rounds of that and a designer has concluded the tool
// does not work. Every check below therefore runs regardless of what failed
// before it, and the report is one list with one command per line.
//
// The second design rule is that a check must be able to say NO. `which
// ffmpeg` succeeding proves a binary is on PATH and nothing else — Fedora's
// default `ffmpeg-free` is a real ffmpeg with no libx264, so it passes every
// presence test and then fails at the encode. So this asks ffmpeg what it can
// actually encode, asks Playwright where its browser is and looks, and imports
// sharp rather than checking that a directory exists.
//
//   pnpm doctor            report, exit 1 if anything REQUIRED is missing
//   pnpm doctor --capture  also require the capture pipeline
//
// Browsing and capturing are separated because they cost very different
// amounts. Reading a morgue needs Node and an install. Recording one needs
// ffmpeg and a ~150MB Chrome, which is most of the install burden and is not
// worth imposing on someone who only wants to look.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WANT_CAPTURE = process.argv.includes('--capture')
const QUIET = process.argv.includes('--quiet')

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' }

/* ─── platform-specific advice ───────────────────────────────────────────── */

/**
 * Which package manager to name in a fix line.
 *
 * Detected rather than assumed from `process.platform`: "dnf install" on a
 * Debian box is a wrong instruction, and a wrong instruction is worse than a
 * vague one because the person runs it and gets a second error to debug.
 */
function pkgManager() {
  if (process.platform === 'darwin') return has('brew') ? 'brew' : 'brew-missing'
  if (process.platform === 'win32') return has('winget') ? 'winget' : 'winget-missing'
  for (const m of ['dnf', 'apt-get', 'pacman', 'zypper', 'apk']) if (has(m)) return m
  return 'unknown'
}

function has(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0
}

const PM = pkgManager()

/** The one command that installs <what> on this machine, or null if we cannot say. */
function installCmd(what) {
  const table = {
    ffmpeg: {
      brew: 'brew install ffmpeg',
      winget: 'winget install Gyan.FFmpeg',
      // --allowerasing because ffmpeg-free is already installed and owns the
      // same binary name; without it dnf reports a conflict and stops.
      dnf: 'sudo dnf install ffmpeg --allowerasing   # needs RPM Fusion',
      'apt-get': 'sudo apt-get install -y ffmpeg',
      pacman: 'sudo pacman -S ffmpeg',
      zypper: 'sudo zypper install ffmpeg',
      apk: 'sudo apk add ffmpeg',
    },
    node: {
      brew: 'brew install node',
      winget: 'winget install OpenJS.NodeJS.LTS',
      dnf: 'sudo dnf install nodejs',
      'apt-get': 'sudo apt-get install -y nodejs',
      pacman: 'sudo pacman -S nodejs',
      zypper: 'sudo zypper install nodejs',
      apk: 'sudo apk add nodejs',
    },
  }
  const hit = table[what]?.[PM]
  if (hit) return hit
  if (PM === 'brew-missing') {
    return `install Homebrew first — https://brew.sh — then: brew install ${what}`
  }
  if (PM === 'winget-missing') {
    return `download ${what} from its own site (winget is not available here)`
  }
  return `install ${what} with your system package manager`
}

/* ─── the report ─────────────────────────────────────────────────────────── */

const checks = []
/**
 * @param tier 'browse' | 'capture' | 'info'
 *   browse  — required always. A failure exits 1.
 *   capture — required only under --capture. Otherwise reported and forgiven,
 *             because a browse-only morgue is a supported configuration and
 *             not a degraded one.
 *   info    — never fails. State, not a prerequisite.
 */
const check = (tier, name, fn) => checks.push({ tier, name, fn })

check('browse', 'Node', () => {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) {
    return {
      ok: false,
      detail: `v${process.versions.node} — too old`,
      // 22 is the floor and 24 is what the repo is developed on. Said as one
      // number, because "22 or newer, ideally 24" is a decision nobody asked
      // to make.
      fix: `morgue needs Node 22 or newer (24 recommended). ${installCmd('node')}`,
    }
  }
  // The bin/ scripts import web/src/*.ts directly and rely on Node stripping
  // the types. That landed in 22.6 behind a flag and is on by default in 22.18
  // and every 24. Below that, `pnpm verify:auth` and `pnpm verify:share` throw
  // on the import rather than on anything they were written to test.
  const [maj, min] = process.versions.node.split('.').map(Number)
  const strips = maj >= 23 || (maj === 22 && min >= 18)
  return {
    ok: true,
    detail: `v${process.versions.node}`,
    warn: strips
      ? null
      : 'below 22.18 — `pnpm verify:auth` and `pnpm verify:share` cannot import the app’s .ts modules',
  }
})

check('browse', 'pnpm', () => {
  const r = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
  if (r.status !== 0) {
    return {
      ok: false,
      detail: 'not found',
      // corepack ships with Node, so this needs nothing new downloaded and
      // works identically on all three platforms — which is why it is the
      // advice rather than a per-manager table.
      fix: 'corepack enable pnpm        (corepack ships with Node)',
    }
  }
  return { ok: true, detail: `v${r.stdout.trim()}` }
})

check('browse', 'dependencies', () => {
  const rootMods = existsSync(path.join(ROOT, 'node_modules'))
  const webMods = existsSync(path.join(ROOT, 'web', 'node_modules'))
  if (!rootMods || !webMods) {
    return {
      ok: false,
      detail: !rootMods ? 'node_modules missing' : 'web/node_modules missing',
      fix: 'pnpm install',
    }
  }
  return { ok: true, detail: 'installed' }
})

check('capture', 'ffmpeg', () => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  if (r.error) {
    return { ok: false, detail: 'not found', fix: installCmd('ffmpeg') }
  }
  // Presence is not capability. This is the check that exists because a
  // distribution ships a patent-free build under the same binary name.
  if (!/\slibx264\s/.test(r.stdout ?? '')) {
    return {
      ok: false,
      detail: 'installed, but built without libx264',
      fix:
        `${installCmd('ffmpeg')}\n` +
        `        (this ffmpeg cannot encode h.264 — Fedora’s default \`ffmpeg-free\`\n` +
        `         is the usual cause. The encoder is not swapped automatically:\n` +
        `         which one to use was measured, see docs/FINDINGS.md.)`,
    }
  }
  const v = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' })
  const ver = /ffmpeg version (\S+)/.exec(v.stdout ?? '')?.[1] ?? 'unknown'
  return { ok: true, detail: `${ver}, libx264 present` }
})

check('capture', 'Chrome (Playwright)', () => {
  let chromium
  try {
    ;({ chromium } = require_playwright())
  } catch {
    return { ok: false, detail: 'playwright not installed', fix: 'pnpm install' }
  }
  let exe = null
  try {
    exe = chromium.executablePath()
  } catch {
    // Playwright throws here when no browser has been downloaded for this
    // version, which is the ordinary state of a fresh clone.
    return { ok: false, detail: 'not downloaded', fix: 'pnpm exec playwright install chromium' }
  }
  if (!exe || !existsSync(exe)) {
    return {
      ok: false,
      detail: 'recorded but not on disk',
      fix: 'pnpm exec playwright install chromium',
    }
  }
  return { ok: true, detail: `~${(dirSizeMB(path.dirname(exe)) | 0)}MB on disk` }
})

check('capture', 'sharp', () => {
  // Imported, not looked for: sharp carries a native binary per platform, and
  // the interesting failure is a directory that exists holding a build for
  // somebody else's architecture.
  try {
    require_sharp()
    return { ok: true, detail: 'loads' }
  } catch (err) {
    return {
      ok: false,
      detail: 'present but will not load',
      fix: `pnpm rebuild sharp        (${String(err).split('\n')[0].slice(0, 90)})`,
    }
  }
})

check('info', 'collection', () => {
  const items = existsSync(path.join(ROOT, 'items'))
    ? readdirSync(path.join(ROOT, 'items'), { withFileTypes: true }).filter((d) => d.isDirectory())
    : []
  const fixtures = existsSync(path.join(ROOT, 'fixtures'))
    ? readdirSync(path.join(ROOT, 'fixtures'), { withFileTypes: true }).filter((d) => d.isDirectory())
    : []
  return {
    ok: true,
    detail:
      items.length > 0
        ? `${items.length} item(s) in items/`
        : `items/ is empty — ${fixtures.length} example(s) available (\`pnpm morgue --examples\`)`,
  }
})

check('info', 'built site', () => {
  const built = existsSync(path.join(ROOT, 'site', 'data', 'facets.json'))
  const builtFixtures = existsSync(path.join(ROOT, 'site-fixtures', 'data', 'facets.json'))
  if (built) return { ok: true, detail: 'site/ is built' }
  if (builtFixtures) return { ok: true, detail: 'site-fixtures/ is built (examples)' }
  return { ok: true, detail: 'nothing built yet — `pnpm build`' }
})

/* ─── loading the optional dependencies ──────────────────────────────────── */
//
// `require`, not `await import`, and that is the reason these checks are
// synchronous functions. A top-level `await import('sharp')` on a machine where
// sharp's native binary is missing throws during module evaluation — before a
// single check has run — so the report this script exists to produce never
// prints. Wrapping each load in the check that needs it turns "sharp is broken"
// into one line of a report instead of the report's cause of death.

const req = createRequire(import.meta.url)
const require_playwright = () => req('playwright')
const require_sharp = () => req('sharp')

function dirSizeMB(dir) {
  let n = 0
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          n += statSync(p).size
        } catch {}
      }
    }
  }
  walk(dir)
  return n / 1048576
}

/* ─── run ────────────────────────────────────────────────────────────────── */

const results = checks.map((c) => {
  let r
  try {
    r = c.fn()
  } catch (err) {
    // A check that throws is a failed check, never a crashed report.
    r = { ok: false, detail: 'check failed', fix: String(err).split('\n')[0] }
  }
  return { ...c, ...r }
})

const fatal = results.filter(
  (r) => !r.ok && (r.tier === 'browse' || (r.tier === 'capture' && WANT_CAPTURE)),
)
const soft = results.filter((r) => !r.ok && !fatal.includes(r))

if (!QUIET || fatal.length) {
  console.log(`\n${C.b}morgue doctor${C.x}  ${C.d}${os.platform()} ${os.arch()} · ${PM}${C.x}\n`)

  for (const group of ['browse', 'capture', 'info']) {
    const rows = results.filter((r) => r.tier === group)
    if (!rows.length) continue
    const label = { browse: 'to browse', capture: 'to capture', info: 'state' }[group]
    console.log(`  ${C.d}${label}${C.x}`)
    for (const r of rows) {
      const mark = r.ok
        ? `${C.g}ok  ${C.x}`
        : fatal.includes(r)
          ? `${C.r}MISS${C.x}`
          : `${C.y}miss${C.x}`
      console.log(`    ${mark} ${r.name.padEnd(20)} ${C.d}${r.detail ?? ''}${C.x}`)
      if (r.warn) console.log(`         ${C.y}!${C.x} ${r.warn}`)
    }
    console.log('')
  }
}

if (fatal.length) {
  console.log(`${C.r}${C.b}${fatal.length} thing(s) to install:${C.x}\n`)
  for (const r of fatal) console.log(`  ${C.b}${r.name}${C.x}\n        ${r.fix}\n`)
  console.log(`Then run ${C.b}pnpm doctor${WANT_CAPTURE ? ' --capture' : ''}${C.x} again.\n`)
  process.exit(1)
}

if (soft.length && !QUIET) {
  // Not an error, and phrased so it does not read as one. Someone who wants to
  // browse an existing morgue is finished, and telling them they have failed
  // is how a working install gets abandoned.
  console.log(
    `${C.y}Capture is unavailable${C.x} — ${soft.map((r) => r.name).join(', ')}.\n` +
      `You can browse and export; recording new previews needs the above.\n` +
      `Fix with:\n`,
  )
  for (const r of soft) console.log(`  ${C.b}${r.name}${C.x}\n        ${r.fix}\n`)
  console.log(`${C.d}Then: pnpm doctor --capture${C.x}\n`)
} else if (!QUIET) {
  console.log(`${C.g}Everything morgue needs is here.${C.x}  Run ${C.b}pnpm morgue${C.x}\n`)
}
