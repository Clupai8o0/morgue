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

import { chromium } from 'playwright'
import {
  freshSecret,
  quietenNodeWarnings,
  signInWithPassword,
  startPostgres,
  startServer,
} from './lib/test-stack.mjs'

quietenNodeWarnings()

const PORT = Number(process.env.PORT ?? 3216)
const PGPORT = Number(process.env.PGPORT ?? 55436)
const EXTERNAL = process.env.BASE

const results = []
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
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
      NODE_ENV: 'production',
    },
  })
  BASE = server.base

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
ok('rAF running', life.frames > 30, `${life.frames} frames/s`)

// ── 2. Reveal entrance (shared IntersectionObserver) ───────────────────────
await page.waitForTimeout(1500)
const reveal = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.reveal')]
  return {
    total: els.length,
    revealed: els.filter((e) => e.hasAttribute('data-in')).length,
    opacities: els.slice(0, 3).map((e) => getComputedStyle(e).opacity),
  }
})
ok('reveal fired', reveal.revealed === reveal.total && reveal.total > 0,
  `${reveal.revealed}/${reveal.total}, opacity ${reveal.opacities.join(',')}`)

// ── 3. Video src assigned by the observer ──────────────────────────────────
const srcs = await page.evaluate(() => {
  const v = [...document.querySelectorAll('video')]
  return { total: v.length, withSrc: v.filter((x) => x.getAttribute('src')).length }
})
ok('observer assigned video src', srcs.withSrc === srcs.total && srcs.total > 0,
  `${srcs.withSrc}/${srcs.total}`)

// ── 4. THE question: does hover actually play a video? ─────────────────────
const card = page.locator('a[href^="/vault/"]').first()
await card.hover()
await page.waitForTimeout(2500)

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

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean')

await browser.close()
cleanup()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
