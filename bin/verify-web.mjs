// Verifies the things the extension-driven browser cannot: the automated tab
// there is backgrounded (visibilityState "hidden", 0 rAF frames/s), which
// suspends rAF, IntersectionObserver delivery and media loading.
//
// Playwright pages report "visible" and run the full rendering lifecycle.
// channel: 'chrome' uses the installed Google Chrome rather than Playwright's
// bundled Chromium, which matters because bundled Chromium ships without the
// proprietary H.264 decoder our previews are encoded with.
//
// WHY THIS NOW BRINGS ITS OWN SERVER AND ITS OWN DATABASE.
//
// It used to run against `pnpm web:dev` on :3210. That worked only because
// web/.env.local had no auth credentials in it: `authConfigured()` was false,
// proxy.ts fails open in development, and /vault rendered for anyone. The day
// those variables were filled in, the dev server started gating /vault
// correctly and this harness landed on /signin and reported that the grid had
// no cards — the product working, the test wrong.
//
// So it now signs in for real: a throwaway Postgres, one seeded account, a
// production `next start`, and a credentials sign-in whose cookie is handed to
// Playwright. Two things improve as a side effect. It exercises the PRODUCTION
// build, which is what a visitor gets, and it no longer depends on whatever
// happens to be in .env.local.
//
//   pnpm verify:web                 self-contained
//   BASE=http://… pnpm verify:web   against a server you already have, with
//                                   whatever session that server needs

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  freshSecret,
  quietenNodeWarnings,
  signInWithPassword,
  startPostgres,
  startServer,
} from './lib/test-stack.mjs'

quietenNodeWarnings()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 3216)
const PGPORT = Number(process.env.PGPORT ?? 55436)
const EXTERNAL = process.env.BASE

/**
 * Which built tree to serve the vault from.
 *
 * Every assertion below needs CARDS — a reveal that fires, an observer that
 * assigns a video src, a hover that reaches readyState 4. With no built site
 * the grid is empty, and the harness reports four failures and then times out
 * hovering a card that does not exist. That is not the product being broken;
 * it is the corpus being absent, and the two must not look alike.
 *
 * items/ is gitignored, so "absent" is the normal state of every machine but
 * the one that ingested the collection. Fall back to the committed examples
 * and say which was used, exactly as bin/verify-share.mjs does — a gate that
 * can only pass on one laptop is a gate people learn to ignore the red from.
 */
function siteDir() {
  for (const [dir, label] of [['site', 'collection'], ['site-fixtures', 'examples']]) {
    if (existsSync(path.join(ROOT, dir, 'data', 'facets.json'))) {
      return { dir: path.join(ROOT, dir), label }
    }
  }
  return null
}

const SITE = siteDir()
if (!SITE && !EXTERNAL) {
  console.error(
    '\nNothing built to look at. Every assertion here needs cards in the grid.\n\n' +
      '  pnpm build              (a real collection)\n' +
      '  pnpm test               (the committed examples)\n',
  )
  process.exit(1)
}

const results = []
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * An assertion that could not be attempted, with the reason.
 *
 * Distinct from a failure and — importantly — LOUD. Three of the checks below
 * need a recorded preview, and a corpus with no captures cannot supply one:
 * items/ is gitignored, so a fresh clone has nothing, and the most common
 * missing prerequisite is an ffmpeg that can encode h.264. Reporting those as
 * FAIL says the video pipeline is broken when the truth is that no video
 * exists, and a gate that cries wolf is one people learn to skim.
 *
 * Never silently: skipped checks are counted separately and named again in the
 * summary, so "10/10 passed" can never quietly mean "7 ran".
 */
const skipped = []
const skip = (name, why) => {
  skipped.push({ name, why })
  console.log(`  skip  ${name} — ${why}`)
}

let pgStack = null
let server = null
let BASE = EXTERNAL
let sessionCookie = null

if (!EXTERNAL) {
  console.log('starting a throwaway Postgres and a production server …')
  pgStack = await startPostgres({ port: PGPORT })
  const secret = freshSecret()
  server = await startServer({
    port: PORT,
    env: {
      DATABASE_URL: pgStack.url,
      AUTH_SECRET: secret,
      AUTH_TRUST_HOST: 'true',
      AUTH_URL: `http://127.0.0.1:${PORT}`,
      AUTH_SESSION_RECHECK_SECONDS: '0',
      // No OAuth apps: credentials alone is enough to get a session, and
      // leaving them out keeps this run from depending on anything external.
      AUTH_GITHUB_ID: '', AUTH_GITHUB_SECRET: '',
      AUTH_GOOGLE_ID: '', AUTH_GOOGLE_SECRET: '',
      RESEND_API_KEY: '',
      MORGUE_DATA_SOURCE: 'local',
      MORGUE_SITE_DIR: SITE.dir,
      NODE_ENV: 'production',
    },
  })
  BASE = server.base
  console.log(`  corpus: ${SITE.label} — ${path.relative(ROOT, SITE.dir)}/`)

  const { hashPassword } = await import('../web/src/lib/password.ts')
  const PW = 'verify web harness password'
  await pgStack.sql.query(
    `insert into users (email, name, role, status, password_hash, email_verified)
     values ($1,'Verify','admin','active',$2,now())`,
    ['verify-web@example.com', await hashPassword(PW)],
  )

  const signedIn = await signInWithPassword(BASE, 'verify-web@example.com', PW)
  if (!signedIn.session) {
    console.error('could not sign in to the harness server; aborting')
    server.stop(); pgStack.stop(); process.exit(1)
  }
  sessionCookie = signedIn.session
}

const cleanup = () => { server?.stop(); pgStack?.stop() }
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  console.log('launched: Google Chrome (channel=chrome, H.264 available)\n')
} catch {
  browser = await chromium.launch()
  console.log('launched: bundled Chromium — H.264 may be unavailable\n')
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

// The vault is gated. Replay the cookie the HTTP sign-in just earned rather
// than driving the sign-in form: this harness is about whether the grid runs,
// and the form has its own suite in bin/verify-auth.mjs.
if (sessionCookie) {
  await ctx.addCookies(
    sessionCookie.split('; ').map((pair) => {
      const i = pair.indexOf('=')
      return {
        name: pair.slice(0, i),
        value: pair.slice(i + 1),
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }
    }),
  )
}

const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(`${BASE}/vault`, { waitUntil: 'load' })

// ── 1. Is the rendering lifecycle actually running? ────────────────────────
const life = await page.evaluate(async () => {
  let frames = 0
  const loop = () => { frames++; requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
  await new Promise((r) => setTimeout(r, 1000))
  return { frames, visibility: document.visibilityState }
})
ok('page is visible', life.visibility === 'visible', life.visibility)
// A backgrounded page suspends rAF and reads 0 frames/s (see header); a live
// one under a headless next start with 12 grid videos decoding samples well
// below 60fps. The bar distinguishes running from suspended, not smooth from
// janky — 10 is an order of magnitude above the 0 that a hidden tab yields.
ok('rAF running', life.frames > 10, `${life.frames} frames/s`)

// ── 2. Reveal entrance (shared IntersectionObserver) ───────────────────────
//
// This asserted `revealed === total`, and it passed for as long as the corpus
// was eleven fixtures — a grid that fits in one viewport. Reveal fires on first
// intersection and then unobserves itself (components/motion/reveal.tsx), so at
// 94 items with a 24-card page the correct result is that the cards below the
// fold have NOT revealed yet. The assertion read the observer working as the
// observer broken, and it went red the moment the collection got real.
//
// Same lesson as the sign-in rewrite at the top of this file: a test that only
// passes while something is small is not testing what it claims. So assert the
// behaviour instead — something reveals on load, and scrolling reveals more.
// That holds for a corpus of 11 and a corpus of 900.
await page.waitForTimeout(1500)
const readReveal = () =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll('.reveal')]
    return {
      total: els.length,
      revealed: els.filter((e) => e.hasAttribute('data-in')).length,
      opacities: els.slice(0, 3).map((e) => getComputedStyle(e).opacity),
    }
  })

const reveal = await readReveal()
ok('reveal fired on load',
  reveal.total > 0 && reveal.revealed > 0 && reveal.opacities.every((o) => o === '1'),
  `${reveal.revealed}/${reveal.total}, opacity ${reveal.opacities.join(',')}`)

if (reveal.revealed >= reveal.total) {
  // Nothing below the fold means there is nothing for the observer to prove.
  // Skipped rather than passed: a silent pass here would be the old bug back.
  skip('reveal follows the scroll', `the whole grid fits the viewport (${reveal.total} cards)`)
} else {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2))
  await page.waitForTimeout(1200)
  const after = await readReveal()
  ok('reveal follows the scroll', after.revealed > reveal.revealed,
    `${reveal.revealed} → ${after.revealed} of ${after.total}`)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(600)
}

// ── 3. Video src assigned by the observer ──────────────────────────────────
// Read off the built payload rather than the DOM: `hasVideo` is what
// bin/build.mjs recorded at build time, so this distinguishes "no <video>
// element was rendered" (a bug) from "no item in this corpus has a preview"
// (an uncaptured collection, and the normal state of a fresh clone).
const captured = existsSync(path.join(SITE?.dir ?? '', 'data', 'facets.json'))
  ? JSON.parse(readFileSync(path.join(SITE.dir, 'data', 'facets.json'), 'utf8'))
      .filter((f) => f.hasVideo).length
  : 0

const srcs = await page.evaluate(() => {
  const v = [...document.querySelectorAll('video')]
  return { total: v.length, withSrc: v.filter((x) => x.getAttribute('src')).length }
})

const NOTHING_CAPTURED =
  'no item in this corpus has a preview — run `pnpm capture` (needs ffmpeg with libx264)'

// The cap the grid is designed around, read out of the source rather than
// written down twice — rule 8 says the LRU is ported verbatim from
// bin/grid.html, and a second copy of the number here would drift from it.
const MAX_PLAYERS = Number(
  /MAX_PLAYERS\s*=\s*(\d+)/.exec(
    readFileSync(path.join(ROOT, 'web', 'src', 'lib', 'player-pool.ts'), 'utf8'),
  )?.[1] ?? 12,
)

if (!captured) {
  skip('observer assigned video src', NOTHING_CAPTURED)
} else if (srcs.total <= MAX_PLAYERS) {
  // Small corpus: every card can hold a player, so every one should have a src.
  ok('observer assigned video src', srcs.withSrc === srcs.total && srcs.total > 0,
    `${srcs.withSrc}/${srcs.total}`)
} else {
  // Large corpus: `withSrc === total` is the WRONG assertion and used to fail
  // here at 12/24. Twelve is not a shortfall, it is MAX_PLAYERS — the LRU
  // holding the line rule 8 exists to hold. Asserting "all" would demand the
  // grid decode 24 videos at once, which is the bug the pool prevents.
  ok('observer assigned video src, capped by the pool',
    srcs.withSrc > 0 && srcs.withSrc <= MAX_PLAYERS,
    `${srcs.withSrc}/${srcs.total} loaded, cap ${MAX_PLAYERS}`)
}

// ── 4. THE question: does hover actually play a video? ─────────────────────
const card = page.locator('a[href^="/vault/"]').first()
await card.hover()
await page.waitForTimeout(captured ? 2500 : 300)

if (!captured) {
  skip('hover plays video', NOTHING_CAPTURED)
  skip('video painted (opacity swap)', NOTHING_CAPTURED)
} else {
  const play = await page.evaluate(() => {
    const v = [...document.querySelectorAll('video')].find((x) => !x.paused)
    if (!v) return { playing: false }
    return {
      playing: true,
      readyState: v.readyState,
      currentTime: +v.currentTime.toFixed(2),
      videoSize: `${v.videoWidth}x${v.videoHeight}`,
      painted: v.hasAttribute('data-painted'),
      buffered: v.buffered.length ? +v.buffered.end(0).toFixed(2) : 0,
      error: v.error ? v.error.code : null,
    }
  })
  ok('hover plays video', play.playing && play.readyState >= 2 && play.currentTime > 0,
    JSON.stringify(play))
  ok('video painted (opacity swap)', play.painted === true, `data-painted=${play.painted}`)
}

// ── 5. Lenis + GSAP ticker ─────────────────────────────────────────────────
// Tested on /styleguide, not /vault: with only the fixture corpus the vault is
// shorter than the viewport, so there is nothing to scroll and the assertion
// would fail on an empty collection rather than on a real defect.
await page.goto(`${BASE}/styleguide`, { waitUntil: 'load' })
await page.waitForTimeout(400)

const motion = await page.evaluate(async () => {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight
  const before = window.scrollY
  // A wheel event, not scrollBy — Lenis intercepts wheel input, which is the
  // path a real user takes. Programmatic scrollBy bypasses it entirely.
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 1200))
  return {
    scrollable,
    lenisClass: document.documentElement.classList.contains('lenis'),
    smoothClass: document.documentElement.classList.contains('lenis-smooth'),
    scrolled: Math.round(window.scrollY - before),
  }
})
ok('lenis mounted', motion.lenisClass, `smooth=${motion.smoothClass}`)
ok('lenis handles wheel input', motion.scrollable > 0 && motion.scrolled > 0,
  `${motion.scrolled}px of ${motion.scrollable}px scrollable`)

// ── 6. Magnetic (home page) ────────────────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'load' })
await page.waitForTimeout(600)
const pill = page.locator('a[href="#access"]').first()
const box = await pill.boundingBox()
const wrapper = await page.evaluateHandle((el) => el.parentElement, await pill.elementHandle())
const before = await wrapper.evaluate((el) => getComputedStyle(el).transform)
await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4)
await page.waitForTimeout(500)
const after = await wrapper.evaluate((el) => getComputedStyle(el).transform)
ok('magnetic displaces on hover', before !== after, `${before} → ${after}`)

// A poster that 404s is EXPECTED on an uncaptured corpus — the card renders a
// "not captured" placeholder for exactly this case (CLAUDE.md rule 15). Those
// are filtered only when the payload says nothing was captured, so a real 404
// on a collection that HAS media still fails here.
const realErrors = captured
  ? errors
  : errors.filter((e) => !/status of 404/.test(e))
ok('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || 'clean')
if (!captured && errors.length !== realErrors.length) {
  console.log(`        ${errors.length - realErrors.length} media 404(s) ignored — nothing captured in this corpus`)
}

await browser.close()
cleanup()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (skipped.length) {
  // Named again, deliberately. A run that reports "7/7 passed" and quietly did
  // not attempt three checks is the same lie as a gate that counts failures
  // and exits 0.
  console.log(`${skipped.length} not run:`)
  for (const s of skipped) console.log(`  · ${s.name} — ${s.why}`)
}
process.exit(failed.length ? 1 : 0)
