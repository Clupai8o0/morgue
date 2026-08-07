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
import { spawn } from 'node:child_process'
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
  window.__seek = (tSec) => {
    window.__vaultClock.step(tSec * 1000)
    for (const a of document.getAnimations()) {
      // Only time-driven animations get seeked. Anything on a ScrollTimeline or ViewTimeline
      // (CSS `animation-timeline: scroll()/view()`) is driven by scroll position, which we
      // already control deterministically — pausing those freezes the effect while the page
      // keeps scrolling, which looks like a working capture and is not one.
      if (a.timeline !== document.timeline) continue
      try { a.pause(); a.currentTime = tSec * 1000 } catch {}
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
    await page.evaluate((sel) => document.querySelector(sel)?.click(), cfg.click.selector)
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
  await page.evaluate((s) => window.__seek(s), tSec)
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
  const entry = meta.archive ? archiveEntry(meta.archive) : '/'
  await page.goto(`http://127.0.0.1:${port}${entry}`, { waitUntil: 'load' })
  // Two traps here, both caused by our own fake clock:
  //  1. Playwright's waitForFunction polls on requestAnimationFrame by default — which we
  //     replaced with a queue that only drains when we step it. The predicate would never
  //     run, so every item burned the full timeout. Poll on a timer instead.
  //  2. Framework code (Next/React) commonly signals readiness from inside a rAF callback,
  //     which for the same reason never fires. So pump the clock while we wait.
  await page
    .waitForFunction(() => { window.__vaultClock.step(0); return window.__ready === true },
      { timeout: 8000, polling: 50 })
    .catch(() => {})
  await page.waitForTimeout(cfg.settleMs ?? 300)
  await page.evaluate(DETACH_CLOCKS)
  // Some libraries finish layout inside a rAF; give them a few before frame 0.
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__vaultClock.step(0) })

  const fps = cfg.fps ?? 30
  const frames = Math.round((cfg.durationMs / 1000) * fps)
  const scrollMax = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  const t0 = Date.now()
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

  await browser.close()
  server.close()
  return { frames, ms: Date.now() - t0, errors, cfg, outDir, frameDir }
}

const run = (cmd, args) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(-1500)))))
  })

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

const slugs = process.argv.slice(2)
const failures = []
for (const slug of slugs.length ? slugs : await readdir(path.join(ROOT, SRC))) {
  process.stdout.write(`\n▸ ${slug}\n`)
  const r = await capture(slug)
  process.stdout.write(`  frames: ${r.frames} in ${r.ms}ms (${Math.round(r.ms / r.frames)}ms/frame)\n`)
  await capture(slug, { scale: 2, only: 'poster' })
  const boom = r.cfg.trigger === 'scroll'
  const enc = await encode(slug, r.cfg, r.outDir, r.frameDir, { boomerang: boom })
  process.stdout.write(
    `  mp4: ${await kb(enc.mp4)}KB  poster.webp: ${await kb(enc.posterWebp)}KB  poster.avif: ${await kb(enc.posterAvif)}KB` +
    (boom ? '  [boomerang loop]' : '') + '\n'
  )
  const health = await motionCheck(r.frameDir)
  process.stdout.write(`  motion: ${health.moved ? 'OK' : 'DEAD — frames identical'} (${health.distinct}/${health.probed} distinct probes)\n`)
  if (r.errors.length) process.stdout.write(`  \x1b[31m⚠ page errors: ${[...new Set(r.errors)].slice(0, 3).join(' | ')}\x1b[0m\n`)
  if (!health.moved || r.errors.length) failures.push(slug)
  await writeFile(path.join(r.outDir, 'capture.log.json'),
    JSON.stringify({ slug, frames: r.frames, ms: r.ms, errors: [...new Set(r.errors)], health }, null, 2))
}
if (failures.length) {
  process.stdout.write(`\n\x1b[31mFAILED: ${failures.join(', ')}\x1b[0m\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`\n\x1b[32mall items captured clean\x1b[0m\n`)
}
