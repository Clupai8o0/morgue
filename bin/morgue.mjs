#!/usr/bin/env node
// One word that leaves you looking at your morgue.
//
//   pnpm morgue              browse items/, or the examples if it is empty
//   pnpm morgue --examples   always the shipped example set
//   pnpm morgue --port 4000
//   pnpm morgue --no-open    do not launch a browser
//   pnpm morgue --rebuild    force the site and the web build to be redone
//
// WHAT THIS IS FOR. Everything morgue does is already a pnpm script, and a
// person who knows the repo does not need this file. It exists for the other
// case: a designer who has just run the installer, has never used a terminal
// for anything but `cd`, and needs the gap between "installed" and "looking at
// it" to be one command with no decisions in it.
//
// So every step here is one somebody would otherwise have to know to take, in
// the order they would have to take it, and each one says what it is doing and
// what it costs. Nothing is silent, because a two-minute silence is
// indistinguishable from a hang.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never writes a secret, never edits
// .env.local, and never sets MORGUE_LOCAL on anything but the child process it
// starts. Local mode is refused whenever the environment looks hosted (see
// web/src/lib/local.ts) and this script has no power to override that — it can
// only detect the conflict early and explain it, which is what `preflight()`
// below does instead of trying to win the argument.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const PORT = Number(value('port', 3210))
const OPEN = !flag('no-open')
const REBUILD = flag('rebuild')
const FORCE_EXAMPLES = flag('examples')

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' }

const say = (msg) => console.log(msg)
const step = (n, total, msg) => console.log(`\n${C.b}[${n}/${total}]${C.x} ${msg}`)
const die = (msg) => {
  console.error(`\n${C.r}${msg}${C.x}\n`)
  process.exit(1)
}

/** Inherits stdio so a long step shows its own progress rather than hanging silently. */
function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (r.error) die(`could not run ${cmd}: ${r.error.message}`)
  return r.status === 0
}

const dirs = (p) =>
  existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()) : []

/* ─── preflight ──────────────────────────────────────────────────────────── */

/**
 * Two things have to be true before anything is built, and both are cheap to
 * check and expensive to discover late.
 *
 * 1. The machine can run the app at all. Delegated to `pnpm doctor`, which owns
 *    that question and is the only place the fix commands are written down.
 *    `--quiet` prints nothing on success, so the happy path stays quiet.
 *
 * 2. Local mode will actually engage. This is the one worth explaining: with a
 *    real AUTH_SECRET in web/.env.local — the state of the machine this product
 *    is developed on — lib/local.ts refuses local mode, correctly, and the
 *    person gets a sign-in page from a command called `morgue`. Detected here
 *    rather than after a 60-second build, and NOT worked around: the fix is to
 *    move the file, not to teach the gate a new exception.
 */
function preflight() {
  step(1, 5, 'checking this machine')
  if (!run('node', ['bin/doctor.mjs', '--quiet'])) {
    die('Fix the above, then run `pnpm morgue` again.')
  }
  say(`  ${C.g}ok${C.x} everything needed to browse is here`)

  const SIGNALS = ['AUTH_SECRET', 'DATABASE_URL', 'AUTH_GITHUB_ID', 'AUTH_GOOGLE_ID', 'VERCEL']

  // Next loads web/.env.local itself, so a variable set there reaches the
  // server without ever appearing in this process's environment. Parsed
  // minimally — KEY=value, quotes stripped, comments ignored — because the
  // only question is whether a value is non-empty.
  const envFile = path.join(ROOT, 'web', '.env.local')
  const fromFile = new Set()
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
      if (!m) continue
      const val = m[2].trim().replace(/^["']|["']$/g, '')
      if (val && SIGNALS.includes(m[1])) fromFile.add(m[1])
    }
  }
  const fromEnv = SIGNALS.filter((k) => process.env[k])

  if (fromFile.size || fromEnv.length) {
    const where = fromFile.size ? 'web/.env.local' : 'your shell environment'
    const names = [...new Set([...fromFile, ...fromEnv])].join(', ')
    die(
      `This machine is configured as a HOSTED morgue, so local mode will not engage.\n\n` +
        `  ${names} is set in ${where}.\n\n` +
        `Local mode is refused whenever anything says "this deployment has accounts" —\n` +
        `otherwise one environment variable would disable the sign-in gate on a real\n` +
        `deployment. See web/src/lib/local.ts.\n\n` +
        `If you want the hosted app, run:   pnpm web:dev\n` +
        `If you want a local morgue here, move ${where === 'web/.env.local' ? 'that file' : 'those variables'} aside first.`,
    )
  }
}

/* ─── which collection ───────────────────────────────────────────────────── */

/**
 * A fresh clone has an empty items/ — the collection is gitignored because it
 * is third-party paid source, so a public checkout ships with nothing in it.
 * That is by design and it is also a terrible first run, so the shipped
 * example set stands in until there is something real.
 *
 * fixtures/ builds to site-fixtures/, never site/, so choosing examples cannot
 * overwrite a real vault. MORGUE_SITE_DIR points the app at whichever won.
 */
function chooseCorpus() {
  const real = dirs(path.join(ROOT, 'items')).length
  if (FORCE_EXAMPLES || real === 0) {
    const n = dirs(path.join(ROOT, 'fixtures')).length
    if (!real && !FORCE_EXAMPLES) {
      say(`  ${C.d}items/ is empty — showing the ${n} examples that ship with morgue${C.x}`)
    }
    return { src: 'fixtures', site: path.join(ROOT, 'site-fixtures'), count: n, examples: true }
  }
  return { src: 'items', site: path.join(ROOT, 'site'), count: real, examples: false }
}

/* ─── the collection ─────────────────────────────────────────────────────── */

function canCapture() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  return !r.error && /\slibx264\s/.test(r.stdout ?? '')
}

function buildCollection(corpus) {
  const built = existsSync(path.join(corpus.site, 'data', 'facets.json'))
  if (built && !REBUILD) {
    step(2, 5, `collection ${C.d}(already built — --rebuild to redo)${C.x}`)
    return
  }

  step(2, 5, `preparing ${corpus.count} item(s)`)

  // The two examples that need a compile step: react-motion (esbuild) and
  // nextjs-static (a real Next export). Skipped for a real collection, whose
  // items are already runnable by the folder contract.
  if (corpus.examples) {
    say(`  ${C.d}compiling the two examples that need a build step …${C.x}`)
    if (!run('node', ['bin/fixtures-build.mjs'])) die('the examples failed to build')
  }

  if (canCapture()) {
    // ~4.5s an item, measured — docs/FINDINGS.md. Quoted so a 50-second wait
    // is an expectation rather than a suspected hang.
    say(`  ${C.d}recording previews — about ${Math.ceil(corpus.count * 4.5)}s …${C.x}`)
    if (!run('node', ['bin/capture.mjs'], { MORGUE_SRC: corpus.src })) {
      say(`  ${C.y}!${C.x} capture failed — building anyway; cards will read “not captured”`)
    }
  } else {
    // Not fatal, and said in one sentence. A morgue with no previews is still
    // a searchable, exportable, annotated collection — and the alternative,
    // refusing to start, would make ffmpeg a hard dependency of *reading*.
    say(
      `  ${C.y}!${C.x} no usable ffmpeg — skipping preview recording.\n` +
        `    The vault still works; cards will read “not captured”.\n` +
        `    ${C.d}Run \`pnpm doctor --capture\` for the one command that fixes it.${C.x}`,
    )
  }

  if (!run('node', ['bin/build.mjs'], { MORGUE_SRC: corpus.src })) die('the build failed')
}

/* ─── the app ────────────────────────────────────────────────────────────── */

function buildWeb() {
  const built = existsSync(path.join(ROOT, 'web', '.next', 'BUILD_ID'))
  if (built && !REBUILD) {
    step(3, 5, `app ${C.d}(already built — --rebuild to redo)${C.x}`)
    return
  }
  step(3, 5, `building the app ${C.d}(one time, about a minute)${C.x}`)
  if (!run('pnpm', ['--filter', 'web', 'build'])) die('the app failed to build')
}

function start(corpus) {
  step(4, 5, 'starting')

  const env = {
    MORGUE_LOCAL: '1',
    MORGUE_DATA_SOURCE: 'local',
    MORGUE_SITE_DIR: corpus.site,
    // `next start` sets this itself, but naming it makes the point that local
    // mode does NOT key on NODE_ENV. It cannot: this is a production build, and
    // a flag that switched itself off in production would switch itself off
    // here. The asymmetry that matters is "does anything look hosted", which is
    // preflight()'s job and lib/local.ts's rule.
    NODE_ENV: 'production',
  }

  const child = spawn(
    'pnpm',
    ['--filter', 'web', 'exec', 'next', 'start', '--port', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  )

  let log = ''
  const tap = (d) => {
    log += d
    // Next's own banner is noise here — this script already said what it is
    // doing. Warnings are not: the "[proxy] MORGUE_LOCAL=1 was IGNORED" line is
    // the single most useful thing this server can print.
    const s = String(d)
    if (/\[proxy\]|error|Error|EADDRINUSE/.test(s)) process.stderr.write(s)
  }
  child.stdout.on('data', tap)
  child.stderr.on('data', tap)

  const stop = () => {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.on('SIGINT', () => {
    stop()
    console.log('\nstopped.')
    process.exit(0)
  })
  process.on('exit', stop)

  return { child, logs: () => log }
}

async function waitUntilUp(url, server) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      die(`the server stopped before it was ready:\n\n${server.logs().slice(-1500)}`)
    }
    try {
      const r = await fetch(url, { redirect: 'manual' })
      if (r.status < 500) return r
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  die(`the server did not start on port ${PORT}:\n\n${server.logs().slice(-1500)}`)
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]]
  spawnSync(cmd[0], cmd[1], { stdio: 'ignore' })
}

/* ─── run ────────────────────────────────────────────────────────────────── */

console.log(`\n${C.b}morgue${C.x} ${C.d}— a local one, no accounts, nothing leaves this machine${C.x}`)

preflight()
const corpus = chooseCorpus()
buildCollection(corpus)
buildWeb()
const server = start(corpus)

const url = `http://localhost:${PORT}`
const probe = await waitUntilUp(`${url}/vault`, server)

step(5, 5, 'ready')

// The proof, not an assumption. A 200 here means proxy.ts took the local
// branch; anything else means it did not, and the difference is invisible from
// the outside until you look. preflight() checks the causes it can see — this
// checks the result.
if (probe.status === 200) {
  say(`  ${C.g}ok${C.x} the vault opens with no sign-in`)
} else {
  say(
    `  ${C.y}!${C.x} /vault answered ${probe.status}, so local mode did not engage.\n` +
      `    ${C.d}Look for a "[proxy] MORGUE_LOCAL=1 was IGNORED" line above.${C.x}`,
  )
}

console.log(
  `\n  ${C.b}${url}${C.x}\n` +
    `  ${C.d}${corpus.examples ? 'showing the shipped examples · put your own in items/<slug>/' : `${corpus.count} item(s) from items/`}${C.x}\n` +
    `  ${C.d}ctrl-c to stop${C.x}\n`,
)

if (OPEN) openBrowser(url)

// Hold the process open; the child owns the terminal from here.
await new Promise(() => {})
