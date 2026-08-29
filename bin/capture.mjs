#!/usr/bin/env node
// Deterministic preview capture for vault items.
//
// The trick: we never "record in real time". We detach GSAP's root timeline and the
// WAAPI clock from rAF, then step both forward by exactly 1/fps per frame and take a
// screenshot. Frames are therefore identical no matter how slow the machine is, and a
// scroll-driven animation can be driven by writing scrollTop per frame instead of
// hoping a smooth-scroll lands where we want.

import { chromium } from 'playwright'
import sharp from 'sharp'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR, resolveVendor, archiveMount, archiveEntry } from './vendor.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// `items/` is the private collection and is gitignored. `fixtures/` is our own test corpus
// and is committed. Same pipeline, different corpus.
const SRC = process.env.MORGUE_SRC || 'items'
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

// A Next static export emits `about.html`, but `<Link href="/about">` navigates to the
// extension-less URL. Without this, every internal link inside an archive 404s — which is
// the whole failure mode `pnpm check`'s click-through step was added to catch.
async function readAny(file) {
  const candidates = path.extname(file)
    ? [file]
    : [file, file + '.html', path.join(file, 'index.html')]
  for (const c of candidates) {
    try { return { body: await readFile(c), file: c } } catch {}
  }
  return null
}

function serve(itemDir, slug, meta = {}) {
  // An archive-backed item has no runnable code of its own: index.html, src/ and the
  // built export all live in archives/<name>/, shared with every other item cut from the
  // same template. resolveVendor() maps the mount, so the only thing serve() has to know
  // is that the URL space is now bigger than itemDir.
  const mount = meta.archive ? archiveMount(meta.archive.name) : null
  const server = createServer(async (req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0])
    // Cheap insurance. A router that re-prefixes an already-basePath'd href (Next +
    // next-transition-router in `auto` mode does exactly this) requests
    // /archive/<name>/archive/<name>/work. It is bounded at one extra copy, because the
    // rendered href is always singly prefixed — so collapsing is safe, not a papering-over.
    if (mount) while (url.startsWith(mount + mount)) url = url.slice(mount.length)
    // A Next.js static export is built with `assetPrefix: '/item/<slug>'` so its absolute
    // /_next/ URLs resolve in the built site, where items live under /item/<slug>/. Here the
    // item is served at root, so strip that prefix and one build satisfies both surfaces.
    if (url.startsWith(`/item/${slug}/`)) url = url.slice(`/item/${slug}`.length)
    if (url === '/') url = '/index.html'
    const hit = await readAny(resolveVendor(url, ROOT, path) ?? path.join(itemDir, url))
    if (!hit) return void res.writeHead(404).end('not found')
    res.writeHead(200, { 'content-type': MIME[path.extname(hit.file)] ?? 'application/octet-stream' })
    res.end(hit.body)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

function pointerAt(pathPoints, t) {
  let a = pathPoints[0]
  let b = pathPoints[pathPoints.length - 1]
  for (let i = 0; i < pathPoints.length - 1; i++) {
    if (t >= pathPoints[i].at && t <= pathPoints[i + 1].at) { a = pathPoints[i]; b = pathPoints[i + 1]; break }
  }
  const span = b.at - a.at || 1
  const k = easeInOut(Math.min(1, Math.max(0, (t - a.at) / span)))
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
}


const FAKE_CLOCK = () => {
  let now = 0
  let nextId = 1
  const queue = new Map()
  const realNow = performance.now.bind(performance)
  const epoch = Date.now()

  performance.now = () => now
  Date.now = () => epoch + now
  window.requestAnimationFrame = (cb) => { const id = nextId++; queue.set(id, cb); return id }
  window.cancelAnimationFrame = (id) => queue.delete(id)

  window.__vaultClock = {
    // One flush == one frame: run everything queued, letting each re-register for the next.
    step(ms) {
      now = ms
      const cbs = [...queue.values()]
      queue.clear()
      for (const cb of cbs) { try { cb(now) } catch (e) { console.error(e) } }
    },
    pending: () => queue.size,
    realNow,
  }
}

// Runs inside the page, after load. WAAPI/CSS animations live on the compositor and are
// NOT driven by rAF, so they still need an explicit seek.
const DETACH_CLOCKS = () => {
  // GSAP's lag smoothing would skip our synthetic frames as if the machine had stalled.
  if (window.gsap) window.gsap.ticker.lagSmoothing(0)

  // `Animation.currentTime` is the animation's OWN local time, not wall clock. For anything
  // running since frame 0 the two are the same number, which is why assigning the absolute
  // capture time worked for years and why this was never noticed.
  //
  // Anything BORN MID-CAPTURE is a different story. A CSS transition triggered by a click,
  // a preloader fade, a ::view-transition — each starts at local time 0 at the moment it
  // appears. Handing it the absolute clock pushes it straight past its own end. Measured on
  // a 700ms fade born at t=3.4s: as an absolute seek it reports currentTime null and
  // opacity 0 on the very first frame it exists — finished and garbage collected — so a
  // fade is recorded as a jump cut. Birth-relative it runs 1 → 0.95 → 0.71 → 0.52 → 0.14.
  //
  // Anchoring on first sighting means anything alive at frame 0 gets birth 0 and is
  // bit-for-bit unchanged, so this is not a behaviour change for the existing corpus's
  // load-triggered items.
  const birth = new WeakMap()

  window.__seek = (tSec) => {
    window.__vaultClock.step(tSec * 1000)
    for (const a of document.getAnimations()) {
      // Only time-driven animations get seeked. Anything on a ScrollTimeline or ViewTimeline
      // (CSS `animation-timeline: scroll()/view()`) is driven by scroll position, which we
      // already control deterministically — pausing those freezes the effect while the page
      // keeps scrolling, which looks like a working capture and is not one.
      if (a.timeline !== document.timeline) continue
      if (!birth.has(a)) birth.set(a, tSec * 1000)
      try { a.pause(); a.currentTime = Math.max(0, tSec * 1000 - birth.get(a)) } catch {}
    }
    if (window.ScrollTrigger) window.ScrollTrigger.update()
  }
}

async function drivePage(page, cfg, t, tSec, scrollMax, state = {}) {
  // The only way to reach a click-triggered effect. `pointerPath` moves the mouse and never
  // presses, so a page transition — the effect that only exists between two routes — was
  // simply uncapturable. Fires once, at cfg.click.at (0..1 of the timeline).
  //
  // Valid for SAME-DOCUMENT navigation only. A full page load destroys window.__seek along
  // with the document, and the next evaluate() throws rather than quietly capturing frame 0.
  // That is the intended failure: loud beats plausible.
  if (cfg.click && !state.clicked && t >= (cfg.click.at ?? 0.1)) {
    state.clicked = true
    if (cfg.click.real) {
      // A REAL press at the element's centre. `element.click()` synthesises an
      // event with clientX/clientY = 0, which is fine for a toggle and wrong for
      // anything that reads the coordinates: one slider branches on
      // `e.clientX > innerWidth / 2` and so always read "previous"; another
      // spawns media at the cursor and put it at left:-350px. Opt-in, because
      // the plain form is what every existing item is tuned against.
      const box = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }, cfg.click.selector)
      if (box) { await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.up() }
    } else {
      await page.evaluate((sel) => document.querySelector(sel)?.click(), cfg.click.selector)
    }
  }

  // ── wheel ──────────────────────────────────────────────────────────────────
  // A whole family of sliders listens for `wheel` and nothing else, and sets
  // `html, body { overflow: hidden }` so scrollMax is 0 — meaning `trigger:
  // "scroll"` moves nothing and `pointer` never presses. Eleven items in the
  // CodeGrid corpus were uncapturable for exactly this reason, and every one
  // recorded a still frame while `motion: OK` passed on some unrelated idle
  // animation. `window.scrollTo` cannot substitute: a virtual-scroll library
  // reads deltas off the event, not off scrollY.
  if (cfg.wheel) {
    const total = cfg.wheel.deltaY ?? 3000
    const steps = cfg.wheel.steps ?? 60
    const per = total / steps
    const due = Math.floor(t * steps)
    state.wheeled = state.wheeled ?? 0
    while (state.wheeled < due) { await page.mouse.wheel(cfg.wheel.deltaX ?? 0, per); state.wheeled++ }
  }

  // ── drag ───────────────────────────────────────────────────────────────────
  // press at the first waypoint, move along the path, release at the last.
  // GSAP Draggable, a canvas draw tool and a fluid sim reading `mouseIsPressed`
  // all start on pointerdown and none of them could be recorded at all.
  if (cfg.drag?.path?.length) {
    const { x, y } = pointerAt(cfg.drag.path, t)
    if (!state.dragging) { await page.mouse.move(x, y); await page.mouse.down(); state.dragging = true }
    else await page.mouse.move(x, y)
    if (t >= (cfg.drag.releaseAt ?? 1) && !state.released) { await page.mouse.up(); state.released = true }
  }
  if (cfg.trigger === 'scroll') {
    const to = cfg.scroll?.to === 'max' ? scrollMax : (cfg.scroll?.to ?? scrollMax)
    const from = cfg.scroll?.from ?? 0
    const k = cfg.scroll?.ease === 'inOut' ? easeInOut(t) : t
    // Scroll and clock-step MUST happen in one evaluate. Split across two round-trips, a
    // scroll event can land in the gap; ScrollTrigger's scrub then smooths from a
    // one-frame-different starting value and the two runs diverge for ~70 frames before
    // reconverging. That was 75/150 frames differing between runs.
    await page.evaluate(({ y, s }) => { window.scrollTo(0, y); window.__seek(s) },
      { y: from + (to - from) * k, s: tSec })
    return
  }
  if (cfg.trigger === 'pointer' && cfg.pointerPath) {
    const { x, y } = pointerAt(cfg.pointerPath, t)
    await page.mouse.move(x, y)  // a real move, so CSS :hover applies; costs one round-trip
  }
  // `scrollTo` is a FIXED offset, and it composes with every trigger — which
  // `trigger: "scroll"` does not, because that one owns the scroll position for
  // the whole timeline. An effect living in section two that also needs the
  // pointer inside it had no expressible capture at all: scroll never moves the
  // mouse, pointer never scrolls. Re-applied every frame rather than once,
  // because a page that re-lays out after its fonts land will otherwise drift
  // back to the top halfway through the take.
  const fixedY = cfg.scrollTo == null
    ? null
    : (typeof cfg.scrollTo === 'string' && cfg.scrollTo.endsWith('%')
        ? (parseFloat(cfg.scrollTo) / 100) * scrollMax
        : cfg.scrollTo)
  await page.evaluate(({ s, y }) => { if (y != null) window.scrollTo(0, y); window.__seek(s) },
    { s: tSec, y: fixedY })
}

async function capture(slug, { scale = 1, only = null } = {}) {
  const itemDir = path.join(ROOT, SRC, slug)
  const cfg = JSON.parse(await readFile(path.join(itemDir, 'capture.json'), 'utf8'))
  // meta.json is read for its optional `archive` block only. Tolerate its absence: an item
  // mid-ingest should still be capturable before it is classified.
  const meta = await readFile(path.join(itemDir, 'meta.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  const outDir = path.join(ROOT, 'out', slug)
  const frameDir = path.join(outDir, 'frames')
  if (only !== 'poster') await rm(frameDir, { recursive: true, force: true })
  await mkdir(frameDir, { recursive: true })

  const server = await serve(itemDir, slug, meta)
  const port = server.address().port
  const browser = await chromium.launch({
    args: [
      '--enable-unsafe-swiftshader',      // allow software GL rather than failing outright
      '--use-angle=metal',                // real GPU path on Apple Silicon
      '--enable-gpu-rasterization',
      '--force-device-scale-factor=' + scale,
    ],
  })
  const ctx = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: scale,
    reducedMotion: 'no-preference', // else a well-behaved item renders its static fallback
  })
  await ctx.addInitScript(FAKE_CLOCK)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // An archive-backed item is captured at its own route inside the shared template, so four
  // items over one archive are four different pages of one build.
  // ── The page may throw, and the process must still exit ────────────────────
  //
  // page.evaluate rethrows whatever the PAGE threw. One delivery had a temporal
  // dead zone in a ScrollTrigger onUpdate; the throw unwound straight past
  // browser.close() and server.close(), leaving Chromium alive and an HTTP
  // listener bound, so node never exited. It did not fail — it HUNG, after
  // writing exactly one frame, with no error line. A sharded run looked like it
  // was still working for as long as anyone was willing to wait.
  //
  // finally, so a broken item costs one red line instead of the whole batch.
  let frames = 0
  let t0 = Date.now()
  try {
    const entry = meta.archive ? archiveEntry(meta.archive) : '/'
    await page.goto(`http://127.0.0.1:${port}${entry}`, { waitUntil: 'load' })
    // Two traps here, both caused by our own fake clock:
    //  1. Playwright's waitForFunction polls on requestAnimationFrame by default — which we
    //     replaced with a queue that only drains when we step it. The predicate would never
    //     run, so every item burned the full timeout. Poll on a timer instead.
    //  2. Framework code (Next/React) commonly signals readiness from inside a rAF callback,
    //     which for the same reason never fires. So pump the clock while we wait.
    //  3. THE OPTIONS OBJECT GOES THIRD. Playwright's signature is
    //     `waitForFunction(pageFunction, arg, options)`. Passed second it becomes `arg`, and
    //     both fixes above silently revert to the defaults they were written to replace —
    //     30s instead of 8s, and polling:'raf', which the fake clock never drains, so the
    //     predicate is evaluated exactly ONCE and never again. Measured: as-written 30006ms
    //     for 1 evaluation; corrected 8003ms for 157. Items that set __ready synchronously
    //     pass on that single poll, which is how this hid — but an item gating on
    //     `document.fonts.ready` or `img.decode()` waited the full 30s, twice per capture,
    //     and printed nothing.
    const readyAt = Date.now()
    const ready = await page
      .waitForFunction(() => { window.__vaultClock.step(0); return window.__ready === true },
        null, { timeout: 8000, polling: 50 })
      .then(() => true, () => false)
    const readyMs = Date.now() - readyAt
    // Never fatal — a `reference` item legitimately has nothing to signal. But never silent
    // again either: the old `.catch(() => {})` is why 30s stalls went unnoticed for months.
    if (!ready) {
      process.stdout.write(
        `  \x1b[33m! window.__ready never set (waited ${readyMs}ms) — recording whatever state the page reached\x1b[0m\n`,
      )
    }
    await page.waitForTimeout(cfg.settleMs ?? 300)
    await page.evaluate(DETACH_CLOCKS)
    // Some libraries finish layout inside a rAF; give them a few before frame 0.
    await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__vaultClock.step(0) })

    const fps = cfg.fps ?? 30
    // Assigns the outer binding, so the caller still learns the frame count when
    // the run completes — and sees 0 rather than a stale number when it does not.
    frames = Math.round((cfg.durationMs / 1000) * fps)
    const scrollMax = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    t0 = Date.now()
    // Carries "have we clicked yet" across frames. Per capture, so the poster pass replays the
    // click at the same point in the timeline the video did.
    const driveState = {}

    if (only === 'poster') {
      // Step THROUGH to the poster time rather than jumping. Scrub smoothing, elastic eases and
      // inertia all depend on the frames before them; a single jump lands somewhere plausible
      // but wrong, and it's wrong in a way that looks fine until you compare it to the video.
      const target = cfg.posterAt ?? 0.5
      const upto = Math.max(1, Math.round(frames * target))
      for (let i = 0; i <= upto; i++) await drivePage(page, cfg, i / (frames - 1), i / fps, scrollMax, driveState)
      await page.screenshot({ path: path.join(outDir, 'poster.png') })
    } else {
      for (let i = 0; i < frames; i++) {
        const t = frames === 1 ? 0 : i / (frames - 1)
        await drivePage(page, cfg, t, i / fps, scrollMax, driveState)
        await page.screenshot({ path: path.join(frameDir, String(i).padStart(5, '0') + '.png') })
      }
    }

  } finally {
    await browser.close().catch(() => {})
    server.close()
  }
  return { frames, ms: Date.now() - t0, errors, cfg, outDir, frameDir }
}

const run = (cmd, args) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-1500)))))
  })

/**
 * Fail on the encoder before spending minutes rendering frames for it.
 *
 * Fedora ships `ffmpeg-free`, which is built without libx264 — so `ffmpeg
 * -version` succeeds, capture runs to completion, and the whole thing dies at
 * the encode step with "Unknown encoder 'libx264'" buried under twenty lines of
 * library versions. The encoder is NOT swapped automatically: which one to use
 * was a measured decision (FINDINGS.md § "Encoder selection") and quietly
 * producing a different file than the one that was measured is worse than
 * stopping.
 */
function assertEncoder() {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' })
  if (r.error) {
    throw new Error('ffmpeg is not installed, or is not on PATH.')
  }
  if (!/\slibx264\s/.test(r.stdout ?? '')) {
    throw new Error(
      'This ffmpeg has no libx264 encoder, so nothing can be encoded.\n' +
        '  Fedora\'s default `ffmpeg-free` is built without it. Install the full build:\n' +
        '    sudo dnf install ffmpeg --allowerasing        (RPM Fusion)\n' +
        '  macOS: brew install ffmpeg.\n' +
        '  The encoder is not swapped automatically on purpose — which one to use\n' +
        '  was a measured decision, see FINDINGS.md § "Encoder selection".',
    )
  }
}

async function encode(slug, cfg, outDir, frameDir, { boomerang = false } = {}) {
  const fps = cfg.fps ?? 30
  const W = 600
  const glob = path.join(frameDir, '%05d.png')

  // Boomerang gives a seamless loop for animations that don't return to their start state.
  const vf = boomerang
    ? `scale=${W}:-2:flags=lanczos,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0`
    : `scale=${W}:-2:flags=lanczos`

  // Benchmarked on this machine against a wireframe WebGL scene (the worst case for
  // compression). x264 crf28/medium won outright: 494KB vs 1065KB for crf23/veryslow, at a
  // difference invisible at 600px. VP9 came out BIGGER and 18x slower (1808KB, 1.8s), and
  // h264_videotoolbox — the hardware encoder — was the worst of all at 1972KB, because
  // hardware encoders optimise for throughput, not bitrate. So: one file, software x264.
  const mp4 = path.join(outDir, 'preview.mp4')
  await run('ffmpeg', ['-y', '-framerate', String(fps), '-i', glob,
    '-vf', vf,
    '-c:v', 'libx264', '-profile:v', 'high', '-crf', '28', '-preset', 'medium',
    '-pix_fmt', 'yuv420p',            // without this Safari refuses the file
    '-movflags', '+faststart',        // moov atom first => decode starts on hover, not after
    '-g', '15', '-keyint_min', '15',  // tight keyframes so currentTime=0 replay is instant
    '-an', mp4])

  // Homebrew's ffmpeg is built without libwebp; sharp handles stills (and is faster).
  const posterPng = path.join(outDir, 'poster.png')
  const posterWebp = path.join(outDir, 'poster.webp')
  const posterAvif = path.join(outDir, 'poster.avif')
  if (existsSync(posterPng)) {
    const src = sharp(posterPng).resize({ width: W, withoutEnlargement: true })
    await src.clone().webp({ quality: 82 }).toFile(posterWebp)
    await src.clone().avif({ quality: 55 }).toFile(posterAvif)
  }
  return { mp4, posterWebp, posterAvif }
}

const kb = async (f) => (existsSync(f) ? Math.round((await stat(f)).size / 1024) : null)

// A capture that produced identical frames is a dead capture: the item 404'd, needed a
// key we don't have, or its trigger never fired. Catch it here rather than in the grid.
async function motionCheck(frameDir) {
  const files = (await readdir(frameDir)).filter((f) => f.endsWith('.png')).sort()
  if (files.length < 3) return { moved: false, distinct: files.length }
  const probes = [0, Math.floor(files.length / 3), Math.floor((2 * files.length) / 3), files.length - 1]
  const hashes = new Set()
  for (const i of probes) {
    const buf = await readFile(path.join(frameDir, files[i]))
    hashes.add(createHash('sha1').update(buf).digest('hex'))
  }
  return { moved: hashes.size > 1, distinct: hashes.size, probed: probes.length }
}

// A capture that is still moving as fast at its LAST frame as it was in the middle never
// finished — the clock ran out mid-animation. This is `motion: OK`'s blind spot: a preview
// that films only the opening of an eight-second scripted intro is unambiguously moving, so
// the distinct-probe check passes while the video is truncated. It sank 5 of 12 previews in
// one batch with nothing flagged. Measure the tail motion against the middle motion; a
// settled ending has tail << mid, a cut-off (or an endless loop) does not. A warning, not a
// failure — a genuine loop trips it too, and only the eye (rule 5) tells those apart.
async function tailCheck(frameDir) {
  const files = (await readdir(frameDir)).filter((f) => f.endsWith('.png')).sort()
  if (files.length < 10) return { checked: false }
  // Downscaled greyscale mean-absolute-difference, so a one-pixel jitter does not read as
  // motion the way an exact hash would — the whole reason motionCheck's approach is wrong here.
  const diff = async (a, b) => {
    const [ra, rb] = await Promise.all([
      sharp(path.join(frameDir, a)).resize(160, 100, { fit: 'fill' }).greyscale().raw().toBuffer(),
      sharp(path.join(frameDir, b)).resize(160, 100, { fit: 'fill' }).greyscale().raw().toBuffer(),
    ])
    let s = 0
    for (let i = 0; i < ra.length; i++) s += Math.abs(ra[i] - rb[i])
    return s / ra.length
  }
  const n = files.length
  const tail = await diff(files[n - 1], files[Math.max(0, n - 1 - Math.round(n * 0.05))])
  const mid = await diff(files[Math.round(n * 0.5)], files[Math.round(n * 0.45)])
  return { checked: true, tail: +tail.toFixed(2), mid: +mid.toFixed(2), truncated: mid > 1 && tail > mid * 0.6 }
}

// A 24-tile sheet across the whole capture, written next to the mp4.
//
// Rule 5 mandates looking at the result, and FINDINGS credits contact sheets with catching
// the only two bugs of that class ever found — a frozen scroll-timeline and a static page
// moving under a moving scroll position, neither visible in `motion: OK`. Until now the
// pipeline emitted no sheet and every ingest hand-rolled this same ffmpeg incantation.
// Producing it here is also what makes pruning the frames safe: the artefact you are
// supposed to look at outlives the 40MB of PNG it came from.
async function contactSheet(frameDir, outDir, frames) {
  const every = Math.max(1, Math.ceil(frames / 24))
  const out = path.join(outDir, 'contact.jpg')
  try {
    await run('ffmpeg', ['-y', '-i', path.join(frameDir, '%05d.png'),
      '-vf', `select='not(mod(n\\,${every}))',scale=240:-2,tile=6x4`,
      '-frames:v', '1', '-q:v', '4', out])
    return out
  } catch { return null }
}

// Frames are INTERMEDIATE. 24 frame directories were holding 862MB of the 892MB in out/ —
// 97% — because they were only ever removed at the head of the *next* run of that slug, so
// a captured-once item kept them forever. Everything downstream (encode, motionCheck, the
// contact sheet) has already run by the time we drop them, and `pnpm capture <slug>`
// regenerates them in seconds. --keep-frames when you want to re-encode without recapturing.
const KEEP_FRAMES = process.argv.includes('--keep-frames')
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'))

// Before any frames are rendered. Discovering the encoder is missing after a
// four-minute capture is a bad way to spend four minutes.
assertEncoder()

// Directories only. A bare readdir also returns `items/.gitkeep`, which every
// checkout has, so `pnpm capture` with no arguments has crashed on a clean tree
// since the first commit — build.mjs, check.mjs and optimise.mjs all filter and
// this was the one that did not.
const all = (await readdir(path.join(ROOT, SRC), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

const failures = []
const crashed = []
for (const slug of slugs.length ? slugs : all) {
  process.stdout.write(`\n▸ ${slug}\n`)
  // ── One item may not take the batch down with it ──────────────────────────
  //
  // page.evaluate rethrows whatever the PAGE threw, so a delivery whose own
  // script has a bug — `Cannot access 'scrollVelocity' before initialization`,
  // thrown from a ScrollTrigger onUpdate during the seek — became an uncaught
  // exception here and killed the process. Captured at 12 items that cost
  // nothing; captured at 310 across six shards it silently dropped 36 queued
  // slugs, and the only evidence was a short log.
  //
  // A broken item is DATA, not an error condition: this corpus is third-party
  // source and some of it does not run. Record it, say so at the end, move on.
  try {
  const r = await capture(slug)
  process.stdout.write(`  frames: ${r.frames} in ${r.ms}ms (${Math.round(r.ms / r.frames)}ms/frame)\n`)
  await capture(slug, { scale: 2, only: 'poster' })
  // Boomerang defaults on for scroll items — a scroll capture ends wherever the page
  // stopped, and cutting straight back to the top is a visible snap in a looping grid tile.
  // But it DOUBLES the frame count, and it is wrong whenever the animation already returns
  // to its start state: starfield-animation is a 16KB source whose preview was the largest
  // in the collection at 3.0MB, a third of it a mirrored tail nobody needed. Opt out with
  // `"boomerang": false` in capture.json; opt in on a non-scroll item with `true`.
  const boom = r.cfg.boomerang ?? (r.cfg.trigger === 'scroll')
  const enc = await encode(slug, r.cfg, r.outDir, r.frameDir, { boomerang: boom })
  process.stdout.write(
    `  mp4: ${await kb(enc.mp4)}KB  poster.webp: ${await kb(enc.posterWebp)}KB  poster.avif: ${await kb(enc.posterAvif)}KB` +
    (boom ? '  [boomerang loop]' : '') + '\n'
  )
  const health = await motionCheck(r.frameDir)
  process.stdout.write(`  motion: ${health.moved ? 'OK' : 'DEAD — frames identical'} (${health.distinct}/${health.probed} distinct probes)\n`)
  const tail = await tailCheck(r.frameDir)
  if (tail.truncated) process.stdout.write(`  \x1b[33m⚠ still moving at the final frame (tail ${tail.tail} vs mid ${tail.mid}) — the capture may be cut short, or this is a continuous loop; watch the video (rule 5)\x1b[0m\n`)
  if (r.errors.length) process.stdout.write(`  \x1b[31m⚠ page errors: ${[...new Set(r.errors)].slice(0, 3).join(' | ')}\x1b[0m\n`)
  if (!health.moved || r.errors.length) failures.push(slug)
  const sheet = await contactSheet(r.frameDir, r.outDir, r.frames)
  if (sheet) process.stdout.write(`  contact: ${await kb(sheet)}KB — look at this before calling it done (rule 5)\n`)

  await writeFile(path.join(r.outDir, 'capture.log.json'),
    JSON.stringify({ slug, frames: r.frames, ms: r.ms, errors: [...new Set(r.errors)], health, tail }, null, 2))

  if (!KEEP_FRAMES) await rm(r.frameDir, { recursive: true, force: true })
  } catch (e) {
    const why = String(e?.message ?? e).split('\n')[0].slice(0, 160)
    process.stdout.write(`  \x1b[31m✗ capture threw — skipped: ${why}\x1b[0m\n`)
    crashed.push([slug, why])
    failures.push(slug)
  }
}
if (crashed.length) {
  process.stdout.write(`\n\x1b[31m${crashed.length} item(s) threw and produced nothing:\x1b[0m\n`)
  for (const [slug, why] of crashed) process.stdout.write(`  ${slug.padEnd(40)} ${why}\n`)
}
if (failures.length) {
  process.stdout.write(`\n\x1b[31mFAILED: ${failures.join(', ')}\x1b[0m\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`\n\x1b[32mall items captured clean\x1b[0m\n`)
}
