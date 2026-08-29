#!/usr/bin/env node
// Uploads the built vault to R2.
//
// THIS IS LOAD-BEARING INFRASTRUCTURE, not a convenience. items/ is gitignored,
// so Vercel deploys from a tree that has never contained the collection and
// cannot generate any of it at build time. capture → build → publish is the
// ONLY path by which anything reaches production.
//
// The upside of that constraint: a deploy has nothing to leak, because it
// never holds the collection in the first place.
//
//   pnpm publish:r2              upload media + data to the private bucket
//   pnpm publish:r2 --dry-run    list what would be uploaded, touch nothing
//   pnpm publish:r2 --public     target the public bucket. Media only, and only
//                                for showcase items under an own/mit licence —
//                                see the licence gate below, which fails closed.

import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The web app owns the env file; the CLI reads the same one so credentials
// live in exactly one place.
for (const envFile of ['web/.env.local', '.env.local']) {
  try {
    process.loadEnvFile(path.join(ROOT, envFile))
    break
  } catch {}
}

const DRY = process.argv.includes('--dry-run')
const PUBLIC = process.argv.includes('--public')

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
const BUCKET = PUBLIC
  ? (process.env.R2_BUCKET_PUBLIC ?? 'morgue-public')
  : (process.env.R2_BUCKET_PRIVATE ?? 'morgue-private')

if (!DRY && !(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)) {
  console.error(
    'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and\n' +
      'R2_SECRET_ACCESS_KEY in web/.env.local — see web/.env.example.\n' +
      'Run with --dry-run to see what would be uploaded.',
  )
  process.exit(1)
}

const s3 = DRY
  ? null
  : new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })

const TYPES = {
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
}

/** Every file under dir, as paths relative to it. */
async function walk(dir, base = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    // A dot-entry under out/ is never a slug and never content. out/.optimise-cache
    // holds the encoder's content-addressed blobs (207MB once a build has run
    // the recompress pass over archives/, and it grows with the tree); .DS_Store
    // arrives with any template unzipped on a Mac. Both were being walked and then
    // reported as "a slug not in the index", which is noise that reads like a
    // finding — and the only thing standing between the cache and the bucket was
    // that its directory name happens not to match an item.
    if (entry.name.startsWith('.')) continue
    // frames/ is the raw PNG sequence — hundreds of megabytes per item, and
    // reproducible by re-running capture. It has no business in object storage.
    if (entry.isDirectory()) {
      if (entry.name === 'frames') continue
      out.push(...(await walk(full, base)))
    } else {
      out.push(path.relative(base, full))
    }
  }
  return out
}

/**
 * Skip files already present with identical bytes. Re-uploading an unchanged
 * 700KB WebGL preview on every publish is the difference between a 2-second
 * sync and a 5-minute one once the collection is real.
 */
async function unchanged(key, body) {
  if (!s3) return false
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    const local = `"${createHash('md5').update(body).digest('hex')}"`
    return head.ETag === local
  } catch {
    return false
  }
}

async function upload(localPath, key) {
  const body = await readFile(localPath)
  const type = TYPES[path.extname(localPath).toLowerCase()] ?? 'application/octet-stream'
  const size = (await stat(localPath)).size

  if (DRY) return { key, size, skipped: false }
  if (await unchanged(key, body)) return { key, size, skipped: true }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
      // Media is content-addressed by slug and effectively immutable; the JSON
      // payload changes on every build and must not be cached stale.
      CacheControl: key.startsWith('data/') ? 'no-cache' : 'public, max-age=31536000',
    }),
  )
  return { key, size, skipped: false }
}

// ─── What may be uploaded: the index decides, in both modes ────────────────
//
// This script walks out/ and site/data. It does NOT walk site/, which matters
// because build.mjs's prune only tidies site/ — so pruning never had any effect
// on what this script uploads, despite a comment there claiming it did. out/ is
// never pruned (preview.mp4 is the archival record under rule 11, and out/ is
// shared with `pnpm test`'s fixture captures), so out/ accumulates every slug
// ever captured, including retired ones. Uploading straight from it is how the
// media of a RETIRED PAID TEMPLATE stays staged for a bucket forever.
//
// The index is therefore the authority in both modes: a slug absent from
// site/items.json is not part of the collection and does not go up.
//
// --public then narrows it further. That flag used to switch the bucket and
// change nothing else, which put it one keystroke from redistributing bought
// source. A public bucket has no signed URLs and nothing in front of it, so
// anything landing there is world-readable the moment it arrives and cannot be
// recalled from whatever already fetched it. The public allowlist mirrors the
// tripwire in build.mjs: showcase-flagged AND own/mit-licensed, media only.
//
// Both paths fail closed — no index, no upload — for the same reason rule 9
// makes an unconfigured deploy 503 rather than serve the vault.
//
// Neither filter can remove what is already in the bucket. Nothing in this
// pipeline deletes remote objects; that is still open and is not fixed here.
let index
try {
  index = JSON.parse(await readFile(path.join(ROOT, 'site', 'items.json'), 'utf8'))
} catch {
  console.error(
    'Refusing to publish: site/items.json is missing, so there is no index to\n' +
      'check what belongs in the collection. Run `pnpm build` first.',
  )
  process.exit(1)
}

const current = new Set(index.map((it) => it.slug))
// A public item must also be CLASSIFIED. An unclassified card (blank surface/effect) is a
// half-finished record, and the public landing page is the last place one should leak — the
// build-time nag exists to catch these, and this is the gate that makes ignoring it cost
// something. Private publishing is unaffected.
const classified = (it) => it.surface != null && Array.isArray(it.effect) && it.effect.length > 0
const allowed = PUBLIC
  ? new Set(
      index
        .filter((it) => it.showcase === true && (it.license === 'own' || it.license === 'mit') && classified(it))
        .map((it) => it.slug),
    )
  : current

if (PUBLIC) {
  const refused = index.filter((it) => !allowed.has(it.slug))
  console.log(`--public: ${allowed.size} of ${index.length} item(s) may be published publicly`)
  // Name them. "Refusing 12 items" invites the assumption that the list is
  // obvious; it is not, and a slug missing from the public bucket for a licence
  // reason should be readable here rather than inferred from a 404 later.
  for (const it of refused) {
    const why = it.showcase !== true
      ? 'not showcase'
      : !(it.license === 'own' || it.license === 'mit')
        ? `license "${it.license}"`
        : !classified(it)
          ? 'unclassified (blank surface/effect)'
          : 'refused'
    console.log(`  refused  ${it.slug.padEnd(24)} ${why}`)
  }
  if (allowed.size === 0) {
    console.error('\nNothing is publishable to the public bucket. Nothing was uploaded.')
    process.exit(1)
  }
  console.log()
}

/** out/ paths arrive as "<slug>/preview.mp4", so the first segment is the slug. */
const slugOf = (rel) => rel.split(path.sep)[0]

const jobs = []
const excluded = []
const withheld = []
const stale = []

// 1. Capture media: out/<slug>/* → media/<slug>/*
for (const rel of await walk(path.join(ROOT, 'out'))) {
  // poster.png is the intermediate sharp encodes from; the app only ever
  // serves .webp and .avif. At ~36KB each it is 18MB of dead weight across a
  // 500-item collection, and it is regenerated by any re-capture.
  if (path.basename(rel) === 'poster.png') {
    excluded.push(rel)
    continue
  }
  if (!allowed.has(slugOf(rel))) {
    // Two different reasons, worth separating in the report: a slug missing
    // from the index is stale capture output for something no longer in the
    // collection, which is the retired-paid-media case. A slug that is in the
    // index but not in `allowed` was refused by the licence gate above.
    ;(current.has(slugOf(rel)) ? withheld : stale).push(rel)
    continue
  }
  jobs.push([path.join(ROOT, 'out', rel), `media/${rel}`])
}

// 2. The data payload the app reads: site/data/* → data/*
//
// Skipped entirely under --public, and not merely filtered. facets.json is the
// index of the WHOLE private collection — every paid title, effect and tag —
// and items/<slug>.json carries the inlined source. Neither has any business
// in a world-readable bucket, and the public landing page does not read them:
// its showcase media is committed to web/public/showcase/ by build.mjs and
// served by Vercel, which is why nothing here is needed to make that page work.
if (PUBLIC) {
  console.log('  (data payload withheld from the public bucket — facets.json indexes the private collection and items/*.json inline source)\n')
} else {
  for (const rel of await walk(path.join(ROOT, 'site', 'data'))) {
    jobs.push([path.join(ROOT, 'site', 'data', rel), `data/${rel}`])
  }
}

if (jobs.length === 0) {
  console.error('Nothing to publish. Run `pnpm capture && pnpm build` first.')
  process.exit(1)
}

console.log(`${DRY ? '[dry run] ' : ''}${jobs.length} files → ${BUCKET}`)
// Say what was dropped. A silent exclusion reads as "everything is up there"
// when it isn't, and that is exactly the kind of thing nobody notices until
// they are looking for a file that was never uploaded.
if (excluded.length) {
  console.log(`  (excluding ${excluded.length} poster.png intermediates — .webp/.avif are what get served)`)
}
if (withheld.length) {
  console.log(`  (withholding ${withheld.length} media file(s) belonging to items the licence gate refused)`)
}
if (stale.length) {
  const slugs = [...new Set(stale.map(slugOf))]
  console.log(
    `  (skipping ${stale.length} file(s) under out/ for ${slugs.length} slug(s) not in the index: ${slugs.join(', ')})\n` +
      '   These are retired or never-built items. out/ keeps them deliberately — it is the\n' +
      '   archival record — but they are not part of the collection and do not go up.',
  )
}
console.log()

let bytes = 0
let sent = 0
let skipped = 0
for (const [local, key] of jobs) {
  const r = await upload(local, key)
  bytes += r.size
  if (r.skipped) skipped++
  else sent++
  const mark = r.skipped ? ' skip' : DRY ? '  would' : '    up'
  console.log(`${mark}  ${key}  ${(r.size / 1024).toFixed(0)}KB`)
}

console.log(
  `\n${DRY ? 'would upload' : 'uploaded'} ${sent}` +
    `${skipped ? `, skipped ${skipped} unchanged` : ''}` +
    ` · ${(bytes / 1024 / 1024).toFixed(1)}MB total`,
)
if (DRY) console.log('\nDry run — nothing was written.')
