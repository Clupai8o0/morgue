#!/usr/bin/env node
// Proves the read-only share gate, end to end, against a real Next server.
//
//   pnpm verify:share                  spawns its own server and tears it down
//   BASE=http://… pnpm verify:share    run against a server you already have
//
// WHY THIS SPAWNS ITS OWN SERVER. Every secret in web/.env.local is an empty
// string, so the checked-in configuration cannot sign a share link OR reach
// the authenticated branch of proxy.ts — `authConfigured()` is false and the
// proxy fails open in development. This injects an AUTH_SECRET and DUMMY
// GitHub credentials so the gate runs its real code path. The dummy
// credentials never make an OAuth round trip; `authConfigured()` only checks
// that they are present.
//
// DATABASE_URL is left EMPTY, and that is now what makes this run unable to
// sign in. Before the multi-tenant pivot the same job was done by setting
// AUTH_ALLOWED_LOGINS to a login nobody held; that variable no longer exists,
// and its replacement is a row in `users` — with no database there are no
// rows, so the owner gate is shut for structural reasons rather than by a
// deliberately-wrong value. Sharing needs only AUTH_SECRET, so it still works.
// Auth against a real database is bin/verify-auth.mjs's job.
//
// WHY `next start` AND NOT `next dev`. proxy.ts is deliberately ASYMMETRIC —
// development fails open, production fails closed — so a gate verified only in
// dev is a gate verified in the mode where it does not really run. (Next 16
// also refuses a second dev server for the same directory, so this could not
// run beside one you already have open.) STATUS.md has said "nothing outside
// the local dev path has ever run" since this app existed. This is the first
// thing that does.
//
// WHY TOKENS ARE MINTED IN-PROCESS rather than through POST /api/share:
// minting requires an owner session, and an owner session requires a real
// GitHub OAuth round trip that no automated run can perform. So the script
// imports web/src/lib/share.ts directly — Node 24 strips the types — and
// signs with the same AUTH_SECRET the server is given. The HTTP layer then
// verifies those tokens for real.
//
// NOT COVERED, and deliberately not faked:
//   - the authenticated side of /api/share. Asserted only as "refuses anyone
//     without a session", which is the half that can be checked.
//   - revocation and the links inventory. Both need DATABASE_URL.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 3219)
const EXTERNAL = process.env.BASE
const BASE = EXTERNAL ?? `http://127.0.0.1:${PORT}`
const SECRET = process.env.AUTH_SECRET || randomBytes(32).toString('base64')

// Set before the module is imported so its lazy key derivation sees it.
process.env.AUTH_SECRET = SECRET
const share = await import(path.join(ROOT, 'web/src/lib/share.ts'))

let pass = 0
let fail = 0
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32mok\x1b[0m   ${n}${d ? ' — ' + d : ''}`) }
const bad = (n, d = '') => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}${d ? ' — ' + d : ''}`) }
const is = (n, actual, expected) =>
  actual === expected ? ok(n, String(actual)) : bad(n, `got ${actual}, expected ${expected}`)

// ─── server ──────────────────────────────────────────────────────────────────

const run = (cmd, args, env) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(out.slice(-2000)))))
  })

let child = null
async function boot() {
  if (EXTERNAL) return

  const env = {
    ...process.env,
    AUTH_SECRET: SECRET,
    AUTH_GITHUB_ID: 'verify-share-dummy',
    AUTH_GITHUB_SECRET: 'verify-share-dummy',
    DATABASE_URL: '',
  }

  if (!existsSync(path.join(ROOT, 'web', '.next', 'BUILD_ID'))) {
    console.log('  building web/ first (no production build found) …')
    await run('pnpm', ['--filter', 'web', 'build'], env)
  }

  child = spawn('pnpm', ['--filter', 'web', 'exec', 'next', 'start', '--port', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env,
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/signin`, { redirect: 'manual' })
      if (r.status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`server did not start on ${PORT}\n${log.slice(-2000)}`)
}

const stop = () => { if (child && !child.killed) child.kill('SIGTERM') }
process.on('exit', stop)
process.on('SIGINT', () => { stop(); process.exit(130) })

// ─── helpers ─────────────────────────────────────────────────────────────────

const get = (p, cookie) =>
  fetch(`${BASE}${p}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })

function cookieFrom(res) {
  const hit = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('morgue_share='))
  return hit ? hit.split(';')[0] : null
}

/** Refused = a 4xx/5xx, or a redirect at the sign-in wall. */
const refused = (res) =>
  res.status >= 400 ||
  ((res.status === 302 || res.status === 307) &&
    String(res.headers.get('location') ?? '').includes('/signin'))

const opened = (res) => !refused(res)

async function redeem(token) {
  const r = await get(`/s/${encodeURIComponent(token)}`)
  // Location is absolute and Next resolves it against the request's own Host,
  // which is `localhost` even when BASE dials 127.0.0.1. Compare pathnames.
  const raw = String(r.headers.get('location') ?? '')
  let to = raw
  try { to = new URL(raw, BASE).pathname } catch {}
  return { res: r, cookie: cookieFrom(r), to }
}

// ─── run ─────────────────────────────────────────────────────────────────────

await boot()
console.log(`\nverifying share links against ${BASE} (production build, auth configured)\n`)

// 1. Baseline — the wall is up.
{
  const r = await get('/vault')
  refused(r) ? ok('vault is closed without a session', String(r.status)) : bad('vault is closed without a session', String(r.status))
  const a = await get('/admin')
  refused(a) ? ok('admin is closed without a session', String(a.status)) : bad('admin is closed without a session', String(a.status))
}

// 2. /api/share is owner-only from every angle.
{
  const post = await fetch(`${BASE}/api/share`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'vault' }),
  })
  refused(post) ? ok('minting is refused without a session', String(post.status)) : bad('minting is refused without a session', String(post.status))

  const list = await get('/api/share')
  refused(list) ? ok('listing is refused without a session', String(list.status)) : bad('listing is refused without a session', String(list.status))
}

// 3. A vault-scoped link.
{
  const { token } = share.mintShareToken({ kind: 'vault' }, 3600)
  const { res, cookie, to } = await redeem(token)
  is('vault link redeems', res.status, 302)
  is('vault link lands on /vault', to, '/vault')
  cookie ? ok('redeem sets a cookie') : bad('redeem sets a cookie')

  if (cookie) {
    const grid = await get('/vault', cookie)
    opened(grid) ? ok('opens /vault', String(grid.status)) : bad('opens /vault', String(grid.status))

    const html = await get('/vault', cookie).then((r) => r.text()).catch(() => '')
    const hasBanner = /shared view/i.test(html)
    hasBanner ? ok('renders the shared-view banner') : bad('renders the shared-view banner', 'text not found')

    const item = await get('/vault/blunt-template', cookie)
    opened(item) ? ok('opens any item page', String(item.status)) : bad('opens any item page', String(item.status))

    const media = await get('/api/media/blunt-template/poster.webp', cookie)
    opened(media) ? ok('opens media', String(media.status)) : bad('opens media', String(media.status))

    // The two that must never open.
    const admin = await get('/admin', cookie)
    refused(admin) ? ok('is REFUSED /admin', String(admin.status)) : bad('is REFUSED /admin', String(admin.status))

    const mint = await fetch(`${BASE}/api/share`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ scope: 'vault' }),
    })
    refused(mint) ? ok('cannot mint another link', String(mint.status)) : bad('cannot mint another link', String(mint.status))
  }
}

// 4. An item-scoped link is genuinely boxed in.
{
  const { token } = share.mintShareToken({ kind: 'item', slug: 'blunt-template' }, 3600)
  const { cookie, to } = await redeem(token)
  is('item link lands on its item', to, '/vault/blunt-template')

  const mine = await get('/vault/blunt-template', cookie)
  opened(mine) ? ok('opens its own item', String(mine.status)) : bad('opens its own item', String(mine.status))

  const other = await get('/vault/gooey-text-reveal', cookie)
  refused(other) ? ok('is REFUSED another item', String(other.status)) : bad('is REFUSED another item', String(other.status))

  const grid = await get('/vault', cookie)
  refused(grid) ? ok('is REFUSED the vault index', String(grid.status)) : bad('is REFUSED the vault index', String(grid.status))

  const otherMedia = await get('/api/media/gooey-text-reveal/poster.webp', cookie)
  refused(otherMedia) ? ok('is REFUSED another item’s media', String(otherMedia.status)) : bad('is REFUSED another item’s media', String(otherMedia.status))

  const ownMedia = await get('/api/media/blunt-template/poster.webp', cookie)
  opened(ownMedia) ? ok('opens its own media', String(ownMedia.status)) : bad('opens its own media', String(ownMedia.status))
}

// 5. Forgery and expiry.
{
  const { token } = share.mintShareToken({ kind: 'vault' }, 3600)
  const [v, body] = token.split('.')

  const forged = await get(`/s/${encodeURIComponent(`${v}.${body}.${'A'.repeat(43)}`)}`)
  is('a forged signature is refused', forged.status, 403)

  // Payload tampering: flip the scope to vault on an item token and re-encode
  // WITHOUT resigning. This is the attack the signature exists to stop.
  const item = share.mintShareToken({ kind: 'item', slug: 'blunt-template' }, 3600)
  const parts = item.token.split('.')
  const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  decoded.s = 'v'
  delete decoded.g
  const swapped = `${parts[0]}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${parts[2]}`
  const escalated = await get(`/s/${encodeURIComponent(swapped)}`)
  is('a scope-escalated payload is refused', escalated.status, 403)

  is('a malformed token is refused', (await get('/s/not-a-token')).status, 403)

  // An already-expired token, signed correctly. mintShareToken clamps its TTL
  // to a 60s floor, so this is built by hand through the same signing key.
  const expired = share.mintShareToken({ kind: 'vault' }, 60)
  const ep = expired.token.split('.')
  const epl = JSON.parse(Buffer.from(ep[1], 'base64url').toString())
  epl.e = Math.floor(Date.now() / 1000) - 10
  // Re-sign so this tests EXPIRY, not the signature check that precedes it.
  const reBody = Buffer.from(JSON.stringify(epl)).toString('base64url')
  const { createHmac } = await import('node:crypto')
  const key = createHmac('sha256', SECRET).update('morgue.share.v1').digest()
  const reSig = createHmac('sha256', key).update(reBody).digest('base64url')
  const expiredRes = await get(`/s/${encodeURIComponent(`${ep[0]}.${reBody}.${reSig}`)}`)
  is('a correctly signed but expired token is refused', expiredRes.status, 403)
}

// 6. A stale share cookie must never lock an owner out.
{
  const { token } = share.mintShareToken({ kind: 'item', slug: 'blunt-template' }, 3600)
  const { cookie } = await redeem(token)
  // Carrying an item cookie to a path it does not cover falls through to the
  // owner gate rather than hard-refusing — the visitor may be a signed-in
  // owner. Observable here as the sign-in redirect, not a 403.
  const r = await get('/vault', cookie)
  const loc = String(r.headers.get('location') ?? '')
  loc.includes('/signin')
    ? ok('an out-of-scope cookie falls through to the owner gate', `${r.status} → /signin`)
    : bad('an out-of-scope cookie falls through to the owner gate', `${r.status} ${loc}`)
}

console.log(`\n${pass}/${pass + fail} passed`)
stop()
process.exit(fail ? 1 : 0)
