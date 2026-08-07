// Verifies the things the extension-driven browser cannot: the automated tab
// there is backgrounded (visibilityState "hidden", 0 rAF frames/s), which
// suspends rAF, IntersectionObserver delivery and media loading.
//
// Playwright pages report "visible" and run the full rendering lifecycle.
// channel: 'chrome' uses the installed Google Chrome rather than Playwright's
// bundled Chromium, which matters because bundled Chromium ships without the
// proprietary H.264 decoder our previews are encoded with.

import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:3210'
const results = []
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  console.log('launched: Google Chrome (channel=chrome, H.264 available)\n')
} catch {
  browser = await chromium.launch()
  console.log('launched: bundled Chromium — H.264 may be unavailable\n')
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
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

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
