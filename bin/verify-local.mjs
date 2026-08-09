#!/usr/bin/env node
// Proves local mode, end to end, against real production servers.
//
//   pnpm verify:local
//
// Local mode is a supported configuration, so it gets a gate like everything
// else (CLAUDE.md rules 10, 12, 13). There are two halves and the second one
// is the one that matters.
//
// ── Half one: it works ──────────────────────────────────────────────────────
// With MORGUE_LOCAL=1 and no other configuration at all, /vault opens with no
// session, / goes to /vault, and every hosted-only route is 404 — genuinely
// absent, not merely gated. A designer running their own morgue should not be
// able to find an admin console, and a 403 would tell them one is there.
//
// ── Half two: it cannot be used as a bypass ─────────────────────────────────
// The same flag, on a server that IS configured for accounts, must do nothing
// whatsoever. That is the assertion this file exists for. A boolean that opens
// a door is an authentication bypass one environment variable wide, and the
// only way to know it is inert is to set it on a configured deployment and
// watch the vault stay shut.
//
// So this boots TWO production servers: one local, one hosted-with-the-flag.
// `next start` and not `next dev`, because proxy.ts fails open in development
// and a gate verified only in dev is verified in the mode where it does not
// run — the same reason bin/verify-share.mjs spawns its own server.
//
// NOT COVERED, and deliberately not faked: "nothing imports the S3, Neon or
// Resend clients". That is a claim about a bundle, not about behaviour, and an
// HTTP probe cannot see it. What IS checked is the observable consequence —
// every local route answers without a 500, which is what an eagerly
// constructed cloud client on an unconfigured machine would produce. The
// bundle measurements live in docs/FINDINGS.md, measured rather than asserted.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, quietenNodeWarnings } from './lib/test-stack.mjs'

quietenNodeWarnings()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_PORT = Number(process.env.PORT ?? 3221)
const HOSTED_PORT = LOCAL_PORT + 1

let pass = 0
let fail = 0
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32mok\x1b[0m   ${n}${d ? ' — ' + d : ''}`) }
const bad = (n, d = '') => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}${d ? ' — ' + d : ''}`) }
const is = (n, actual, expected) =>
  actual === expected ? ok(n, String(actual)) : bad(n, `got ${actual}, expected ${expected}`)

const get = (base, p) => fetch(`${base}${p}`, { redirect: 'manual' })

/**
 * Every variable lib/local.ts treats as "this deployment has accounts",
 * blanked. Empty rather than deleted: Next loads web/.env.local itself and
 * dotenv does not overwrite a key already present in process.env, so an empty
 * string is what actually neutralises a populated developer machine. Deleting
 * the key would let the file put it back.
 */
const NO_HOSTED_CONFIG = {
  AUTH_SECRET: '',
  DATABASE_URL: '',
  AUTH_GITHUB_ID: '',
  AUTH_GITHUB_SECRET: '',
  AUTH_GOOGLE_ID: '',
  AUTH_GOOGLE_SECRET: '',
  VERCEL: '',
  R2_ACCOUNT_ID: '',
  R2_ACCESS_KEY_ID: '',
  R2_SECRET_ACCESS_KEY: '',
  RESEND_API_KEY: '',
}

/** Routes that must not exist in local mode. Written out, not imported. */
const HOSTED_ONLY = [
  '/admin',
  '/account',
  '/upgrade',
  '/signin',
  '/reset',
  '/api/share',
  '/api/waitlist',
  '/api/account/me',
  '/api/account/delete',
  '/api/account/email',
  '/api/account/export',
  '/api/account/sessions',
  '/api/account/upgrade',
  // Public on a hosted deployment — a locked-out person needs them — and still
  // absent here, because there is no account to recover.
  '/api/account/reset',
  '/api/account/verify',
  // Share redemption. Signing needs an AUTH_SECRET there is none of.
  '/s/anything',
]

const servers = []
const stopAll = () => servers.forEach((s) => s.stop())
process.on('exit', stopAll)
process.on('SIGINT', () => { stopAll(); process.exit(130) })

/* ─── half one: local mode works ─────────────────────────────────────────── */

console.log('\nverifying local mode (production build, no configuration at all)\n')

const local = await startServer({
  port: LOCAL_PORT,
  env: {
    ...NO_HOSTED_CONFIG,
    MORGUE_LOCAL: '1',
    MORGUE_DATA_SOURCE: 'local',
    // The examples, so /vault has something to render and /api/media has
    // something to serve. Built by `pnpm test`; absent is not a failure of
    // local mode, so the media assertion below is skipped rather than failed.
    MORGUE_SITE_DIR: path.join(ROOT, 'site-fixtures'),
  },
})
servers.push(local)

{
  const vault = await get(local.base, '/vault')
  is('vault opens with no session', vault.status, 200)

  const html = await get(local.base, '/vault').then((r) => r.text()).catch(() => '')

  // The vault renders one of two things — a grid or the empty state — and
  // either proves the page ran. What must NOT be there is the sign-in wall.
  const wall = /sign in/i.test(html)
  wall
    ? bad('vault renders without a sign-in prompt')
    : ok('vault renders without a sign-in prompt')

  // Confirms the *local* empty state is the one rendered, not the hosted one.
  // Only meaningful when the collection is empty, which is the fresh-clone
  // case this whole mode is for.
  if (/vault is empty/i.test(html)) {
    const guides = /pnpm morgue/.test(html)
    guides
      ? ok('the empty state tells a local user what to run')
      : bad('the empty state tells a local user what to run', 'no `pnpm morgue` in the copy')
  }

  const root = await get(local.base, '/')
  const to = String(root.headers.get('location') ?? '')
  root.status >= 300 && root.status < 400 && to.endsWith('/vault')
    ? ok('/ redirects to the vault', `${root.status} → ${to}`)
    : bad('/ redirects to the vault', `${root.status} ${to || '(no location)'}`)
}

console.log('')
for (const p of HOSTED_ONLY) {
  const r = await get(local.base, p)
  // 404 exactly. A 302 would mean it is gated rather than absent, and a 500
  // would mean a cloud client was constructed on a machine with no credentials
  // — the failure this mode is supposed to make impossible.
  is(`${p} is absent`, r.status, 404)
}

{
  console.log('')
  // Media has to work or the grid is posters-shaped holes. Tolerant of a
  // missing capture: this asserts the ROUTE is reachable, which is the part
  // local mode is responsible for.
  const media = await get(local.base, '/api/media/pinned-horizontal/poster.webp')
  media.status === 200 || media.status === 404
    ? ok('media is served without a session', String(media.status))
    : bad('media is served without a session', String(media.status))

  const styleguide = await get(local.base, '/styleguide')
  is('ordinary pages still render', styleguide.status, 200)
}

/* ─── half two: the flag is inert on a configured deployment ─────────────── */

console.log('\nverifying the flag is IGNORED where accounts exist\n')

const hosted = await startServer({
  port: HOSTED_PORT,
  env: {
    ...NO_HOSTED_CONFIG,
    // Configured for accounts, and asking for local mode at the same time.
    // The dummy credentials never make an OAuth round trip; authConfigured()
    // only checks that they are present.
    AUTH_SECRET: 'verify-local-not-a-real-secret-000000000000',
    AUTH_GITHUB_ID: 'verify-local-dummy',
    AUTH_GITHUB_SECRET: 'verify-local-dummy',
    MORGUE_LOCAL: '1',
  },
})
servers.push(hosted)

{
  const vault = await get(hosted.base, '/vault')
  const to = String(vault.headers.get('location') ?? '')
  vault.status >= 300 && vault.status < 400 && to.includes('/signin')
    ? ok('vault is STILL closed with MORGUE_LOCAL=1', `${vault.status} → /signin`)
    : bad('vault is STILL closed with MORGUE_LOCAL=1', `${vault.status} ${to}`)

  const admin = await get(hosted.base, '/admin')
  admin.status >= 400 || (admin.status >= 300 && String(admin.headers.get('location') ?? '').includes('/signin'))
    ? ok('admin is STILL closed with MORGUE_LOCAL=1', String(admin.status))
    : bad('admin is STILL closed with MORGUE_LOCAL=1', String(admin.status))

  // /signin must exist here. If the flag had partially engaged it would be
  // 404 — which would lock out the very person the gate just redirected.
  is('/signin still exists', (await get(hosted.base, '/signin')).status, 200)

  const share = await fetch(`${hosted.base}/api/share`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'vault' }),
  })
  share.status >= 300
    ? ok('minting is STILL refused with MORGUE_LOCAL=1', String(share.status))
    : bad('minting is STILL refused with MORGUE_LOCAL=1', String(share.status))

  // The refusal must be audible. Someone who sets the flag and still meets a
  // sign-in page will otherwise conclude the flag is broken, and the next
  // thing they do is delete the gate.
  const warned = /MORGUE_LOCAL=1 was IGNORED/.test(hosted.logs())
  warned
    ? ok('the server says out loud that it ignored the flag')
    : bad('the server says out loud that it ignored the flag', 'no warning in the log')
}

console.log(`\n${pass}/${pass + fail} passed`)
stopAll()
process.exit(fail ? 1 : 0)
