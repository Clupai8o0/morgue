// The raster encoder, in one place.
//
// bin/optimise.mjs is the deliberate, destructive tool you point at items/ —
// it plans renames, scans for computed paths, and overwrites paid source with
// four explicit flags. bin/build.mjs needs none of that; it needs the same
// encoder, unconditionally, on a tree it is allowed to rewrite. Two copies of
// "how do we re-encode a JPEG" is precisely the shape rule 3 exists about: the
// Three.js item 404'd only on its detail page because the vendor map lived in
// two files and one of them was updated. So the encoder lives here and both
// scripts import it.
//
// ── The cache key is a compatibility surface ────────────────────────────────
//
// `${md5}-w${width}-q${quality}-${format}` is exactly the key bin/optimise.mjs
// has always written into out/.optimise-cache/. Keeping it byte-identical is
// why an existing cache still hits after this refactor. `lossless` appends a
// suffix rather than changing the shape, so the two modes cannot collide and
// the old entries stay valid.
//
// ── Two modes, and the difference is the whole point ────────────────────────
//
// RECOMPRESS-ONLY (the build pass) changes bytes and nothing else: same
// dimensions, same filename, same format, PNG stays lossless. That is what
// makes it safe to run unconditionally on every build. A resize can break a
// sprite sheet or a texture atlas whose geometry is load-bearing, a rename
// 404s a computed path (rule 11), and a format change breaks the MIME. None of
// those can happen here, so there is nothing to review before it runs.
//
// RESIZE + PALETTE (bin/optimise.mjs) can do all of that and is therefore
// opt-in, per-item, and backed up.

import sharp from 'sharp'
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])
export const EXT_FOR = { jpeg: '.jpg', png: '.png', webp: '.webp', avif: '.avif' }

// Snapping target widths to a ladder keeps output sizes from becoming a long
// tail of one-offs, which is what makes the content-hash encode cache hit.
export const BUCKETS = [320, 480, 640, 768, 1024, 1280, 1600, 1920, 2560, 3200]
export const bucket = (w) => BUCKETS.find((b) => b >= w) ?? w

export const md5 = (b) => createHash('md5').update(b).digest('hex')

/**
 * A memoised, disk-cached encoder.
 *
 * `persist` gates the disk write for the same reason bin/optimise.mjs's dry run
 * does: a run that promises to write nothing must not write a cache either.
 */
export function createEncoder({ cacheDir, persist = false } = {}) {
  const memo = new Map()
  let hits = 0
  let misses = 0

  const cachePath = (key) => (cacheDir ? path.join(cacheDir, `${key}.bin`) : null)

  async function encode(buf, plan) {
    const key =
      `${md5(buf)}-w${plan.width ?? 0}-q${plan.quality}-${plan.format}` +
      (plan.lossless ? '-ll' : '')
    if (memo.has(key)) { hits++; return memo.get(key) }

    const cached = cachePath(key)
    if (cached && existsSync(cached)) {
      const hit = await readFile(cached)
      memo.set(key, hit)
      hits++
      return hit
    }
    misses++

    // .rotate() with no argument bakes EXIF orientation into the pixels.
    // Re-encoding drops the EXIF tag, so without this an orientation-tagged
    // photo comes out rotated — visibly wrong, and invisible to a byte count.
    let img = sharp(buf, { failOn: 'none' }).rotate()
    if (plan.width) img = img.resize({ width: plan.width, withoutEnlargement: true })
    if (plan.format === 'jpeg') {
      img = img.jpeg({ quality: plan.quality, chromaSubsampling: '4:2:0', mozjpeg: true })
    } else if (plan.format === 'png') {
      // palette:true quantises to 256 colours. That is a real win on flat UI
      // art and a real loss on a gradient, a normal map or anything sampled as
      // data — so it is only ever reached by the opt-in path. `lossless` is the
      // build pass, where the pixels must come out identical.
      img = plan.lossless
        ? img.png({ compressionLevel: 9, effort: 10, palette: false })
        : img.png({ compressionLevel: 9, effort: 10, palette: true, quality: plan.quality })
    } else if (plan.format === 'webp') {
      img = img.webp({ quality: plan.quality, effort: 5 })
    } else if (plan.format === 'avif') {
      img = img.avif({ quality: Math.min(plan.quality, 60), effort: 4 })
    }
    const out = await img.toBuffer()

    memo.set(key, out)
    if (cached && persist) {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(cached, out)
    }
    return out
  }

  return { encode, stats: () => ({ hits, misses }) }
}

/** Every file under dir, as posix paths relative to it. */
export async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...(await walk(full, base)))
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return out
}

/**
 * Recompress every raster file under `dir`, in place, keeping the name, the
 * format and the pixel dimensions.
 *
 * Safe to run unconditionally because every way this could break a page has
 * been designed out rather than guarded against — see the header. The only
 * remaining refusals are the two where re-encoding would lose information no
 * byte count would notice:
 *
 *   · animated WebP/GIF would be flattened to frame 1. The file gets smaller
 *     and the animation silently disappears.
 *   · a file that would GROW is left exactly as it was. Measured across this
 *     collection, 7 of 33 unique images grew under a plain pass — an already
 *     well-compressed export has nothing left to give and re-encoding it only
 *     costs bytes and a generation of quality.
 *
 * `formats` defaults to JPEG and PNG. WebP and AVIF are deliberately absent:
 * they are already the output of an optimiser, so a lossy round-trip through
 * this can only lose, and the never-grow rule would throw the result away
 * anyway after paying for the decode.
 */
export async function recompressTree(dir, {
  encode,
  quality = 82,
  formats = new Set(['.jpg', '.jpeg', '.png']),
  skip = () => false,
} = {}) {
  const r = { files: 0, changed: 0, before: 0, after: 0, grew: 0, animated: 0, unreadable: 0 }
  if (!existsSync(dir)) return r

  for (const rel of await walk(dir)) {
    if (!formats.has(path.extname(rel).toLowerCase())) continue
    if (skip(rel)) continue
    const file = path.join(dir, rel)
    const buf = await readFile(file)
    r.files++
    r.before += buf.length

    let meta
    try {
      meta = await sharp(buf, { failOn: 'none' }).metadata()
    } catch {
      r.unreadable++
      r.after += buf.length
      continue
    }
    if ((meta.pages ?? 1) > 1) {
      r.animated++
      r.after += buf.length
      continue
    }

    const out = await encode(buf, {
      width: null,          // never resize
      quality,
      format: meta.format,  // never change format
      lossless: meta.format === 'png',
    })
    if (out.length >= buf.length) {
      r.grew++
      r.after += buf.length
      continue
    }
    await writeFile(file, out)
    r.changed++
    r.after += out.length
  }
  return r
}
