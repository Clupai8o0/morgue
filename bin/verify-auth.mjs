#!/usr/bin/env node
// Proves the authentication system against a REAL Postgres and a REAL
// production Next server.
//
//   pnpm verify:auth
//
// WHY A THROWAWAY CLUSTER. Every interesting auth failure is a query returning
// the wrong row: a suspended user who still gets in, a lockout that counts the
// wrong thing, a reset token that works twice. None of that is observable
// against a mock, and DATABASE_URL has never been set on this machine — so a
// harness that needed a provisioned Neon project would be a harness that never
// runs. `initdb` puts a cluster in a temp directory in about a second, and it
// is deleted on exit.
//
// This is why src/db/index.ts chooses its driver by hostname: the Neon HTTP
// driver speaks Neon's endpoint protocol, not the Postgres wire protocol, and
// cannot talk to a cluster you started yourself. Production URLs still take
// the Neon path.
//
// WHY `next start` AND NOT `next dev`. proxy.ts is deliberately asymmetric —
// development fails open, production fails closed — so a gate verified only in
// dev is verified in the mode where it does not really run. Same reasoning as
// bin/verify-share.mjs.
//
// AUTH_SESSION_RECHECK_SECONDS is set to 0 so revocation is observable without
// sleeping through the 60s default. That is a real configuration value, not a
// test hook: see the comment on it in web/src/auth.ts.
//
// WHAT IS NOT COVERED, and deliberately not faked:
//   - a real OAuth round trip to GitHub or Google. Nothing automated can
//     perform one. Instead the POLICY those round trips feed is exercised
//     directly against this database (section 7), which is why it lives in
//     lib/link-policy.ts rather than inline in the signIn callback, and the
//     providers' registration is asserted over HTTP.
//   - providerVerifiedEmail's GitHub branch beyond "refuses without a token".
//     It calls api.github.com; a test that stubs the network would only prove
//     the stub.
//   - email delivery. RESEND_API_KEY is unset, so lib/notify.ts logs the link
//     instead — which this harness reads out of the server's stdout, making
//     the reset and verification flows genuinely end to end.

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
import { quietenNodeWarnings } from './lib/test-stack.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Teach plain Node how web/ resolves its own imports.
 *
 * Node 24 strips the types out of a .ts file on import, which is how this
 * script can exercise the app's own modules rather than a copy of them. What
 * it does NOT do is read web/tsconfig.json, and that file turns on two things
 * Node has no opinion about:
 *
 *   - the `@/*` path alias, so `@/db` is a bare specifier Node looks for in
 *     node_modules;
 *   - `moduleResolution: "bundler"`, which allows extensionless relative
 *     imports — `./schema` rather than `./schema.ts`.
 *
 * Both have to be handled or the import fails one level deep, which excludes
 * exactly the modules worth testing: the leaves with no internal imports are
 * the ones that need a harness least.
 */
const SRC = path.join(ROOT, 'web/src')

function resolveTsPath(base) {
  return (
    [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((c) => existsSync(c)) ?? null
  )
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      const hit = resolveTsPath(path.join(SRC, specifier.slice(2)))
      if (hit) return next(pathToFileURL(hit).href, context)
    }

    // Extensionless relative import from inside web/src.
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const parent = context.parentURL ?? ''
      if (parent.startsWith(pathToFileURL(SRC).href) && !path.extname(specifier)) {
        const hit = resolveTsPath(path.resolve(path.dirname(fileURLToPath(parent)), specifier))
        if (hit) return next(pathToFileURL(hit).href, context)
      }
    }

    return next(specifier, context)
  },
})

// Shared with bin/verify-web.mjs — see the note there on why the code, not
// just the message, has to be matched.
quietenNodeWarnings()
const PORT = Number(process.env.PORT ?? 3218)
const PGPORT = Number(process.env.PGPORT ?? 55432)
const BASE = `http://127.0.0.1:${PORT}`
const SECRET = randomBytes(32).toString('base64')

let pass = 0
let fail = 0
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32mok\x1b[0m   ${n}${d ? ' — ' + d : ''}`) }
const bad = (n, d = '') => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}${d ? ' — ' + d : ''}`) }
const check = (n, cond, d = '') => (cond ? ok(n, d) : bad(n, d))
const is = (n, actual, expected) =>
  actual === expected ? ok(n, String(actual)) : bad(n, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
const section = (t) => console.log(`\n\x1b[2m${t}\x1b[0m`)

/* ─── throwaway Postgres ──────────────────────────────────────────────────── */

const PGDIR = mkdtempSync(path.join(tmpdir(), 'morgue-verify-pg-'))
const PGDATA = path.join(PGDIR, 'data')
// The role is in the URL on purpose. Without it `pg` falls back to the OS
// user, and a cluster made by initdb -U postgres has no such role — the
// failure is `role "<you>" does not exist` at connect, from three places at
// once (this script, the Next server, and psql).
const DB_URL = `postgres://postgres@127.0.0.1:${PGPORT}/morgue_verify`

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout ?? ''}${r.stderr ?? ''}`)
  }
  return r.stdout
}

let pgUp = false
function startPostgres() {
  if (spawnSync('initdb', ['--version']).status !== 0) {
    throw new Error('initdb not found — install Postgres (brew install postgresql@16).')
  }
  // --auth=trust is safe here and only here: the cluster listens on loopback,
  // on a nonstandard port, for the lifetime of this script, and is deleted
  // afterwards. It holds nothing but rows this file created.
  sh('initdb', ['-D', PGDATA, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '-N'])
  sh('pg_ctl', [
    '-D', PGDATA,
    '-o', `-p ${PGPORT} -h 127.0.0.1 -k ${PGDIR} -c fsync=off -c full_page_writes=off`,
    '-l', path.join(PGDIR, 'pg.log'),
    '-w', '-t', '30',
    'start',
  ])
  pgUp = true
  sh('createdb', ['-h', '127.0.0.1', '-p', String(PGPORT), '-U', 'postgres', 'morgue_verify'])
}

function stopPostgres() {
  if (pgUp) {
    spawnSync('pg_ctl', ['-D', PGDATA, '-m', 'immediate', '-w', '-t', '10', 'stop'], { stdio: 'ignore' })
    pgUp = false
  }
  rmSync(PGDIR, { recursive: true, force: true })
}

/** Applies every drizzle migration in order, the way drizzle-kit migrate would. */
async function migrate(sql) {
  const dir = path.join(ROOT, 'web', 'drizzle')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    const body = readFileSync(path.join(dir, f), 'utf8')
    for (const stmt of body.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim()
      if (trimmed) await sql.query(trimmed)
    }
  }
  return files.length
}

/* ─── the server ──────────────────────────────────────────────────────────── */

const ENV = {
  ...process.env,
  DATABASE_URL: DB_URL,
  AUTH_SECRET: SECRET,
  // Auth.js refuses a Host it has not been told to trust, and this dials an IP
  // on a nonstandard port. On Vercel this is implied.
  AUTH_TRUST_HOST: 'true',
  AUTH_URL: BASE,
  AUTH_SESSION_RECHECK_SECONDS: '0',
  AUTH_GITHUB_ID: 'verify-auth-dummy',
  AUTH_GITHUB_SECRET: 'verify-auth-dummy',
  AUTH_GOOGLE_ID: 'verify-auth-dummy',
  AUTH_GOOGLE_SECRET: 'verify-auth-dummy',
  IP_HASH_SALT: 'verify-auth',
  RESEND_API_KEY: '',
  MORGUE_DATA_SOURCE: 'local',
  NODE_ENV: 'production',
}

let child = null
let serverLog = ''

function run(cmd, args, env) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (c) => (c === 0 ? res(out) : rej(new Error(out.slice(-3000)))))
  })
}

async function startServer() {
  if (!existsSync(path.join(ROOT, 'web', '.next', 'BUILD_ID'))) {
    console.log('  building web/ first (no production build found) …')
    await run('pnpm', ['--filter', 'web', 'build'], ENV)
  }
  child = spawn('pnpm', ['--filter', 'web', 'exec', 'next', 'start', '--port', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: ENV,
  })
  child.stdout.on('data', (d) => (serverLog += d))
  child.stderr.on('data', (d) => (serverLog += d))

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/signin`, { redirect: 'manual' })
      if (r.status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`server did not start on ${PORT}\n${serverLog.slice(-3000)}`)
}

function cleanup() {
  if (child && !child.killed) child.kill('SIGTERM')
  stopPostgres()
}
process.on('exit', cleanup)
process.on('SIGINT', () => { cleanup(); process.exit(130) })

/* ─── HTTP helpers ────────────────────────────────────────────────────────── */

const get = (p, cookie) =>
  fetch(`${BASE}${p}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })

const json = (p, method, body, cookie) =>
  fetch(`${BASE}${p}`, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })

const jar = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])
const merge = (...cookies) => cookies.flat().filter(Boolean).join('; ')

/**
 * A full credentials sign-in over HTTP: fetch the CSRF token, post the form to
 * the callback endpoint, and return whatever session cookie comes back.
 * Deliberately the real endpoint rather than calling authorize() directly —
 * the CSRF check and the cookie plumbing are part of what is being verified.
 */
async function signInWithPassword(email, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const cookies = jar(csrfRes)

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: merge(cookies),
    },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${BASE}/vault` }),
  })

  const all = merge(cookies, jar(res))
  const session = /authjs\.session-token=[^;]+/.test(all) ? all : null
  const location = String(res.headers.get('location') ?? '')
  return { res, cookies: all, session, location }
}

/** True when this cookie jar actually gets into the vault. */
async function isSignedIn(cookies) {
  if (!cookies) return false
  const r = await get('/vault', cookies)
  return !(r.status >= 400 || String(r.headers.get('location') ?? '').includes('/signin'))
}

/** Pulls the most recent emailed link out of the server's stdout. */
function lastLinkFrom(pattern) {
  const matches = serverLog.match(new RegExp(`${BASE}${pattern}[A-Za-z0-9_-]+`, 'g'))
  return matches?.[matches.length - 1] ?? null
}

/* ─── run ─────────────────────────────────────────────────────────────────── */

console.log('\nstarting a throwaway Postgres …')
startPostgres()

const sql = new pg.Client({ connectionString: DB_URL })
await sql.connect()
const applied = await migrate(sql)
console.log(`  applied ${applied} migration file(s)`)

console.log('starting the production server …')
await startServer()
console.log(`\nverifying auth against ${BASE} (production build, real Postgres)\n`)

// Hash passwords with the app's own module so the stored format is the real
// one and not a shape this file invented.
process.env.AUTH_SECRET = SECRET
const { hashPassword } = await import(path.join(ROOT, 'web/src/lib/password.ts'))

const PW = 'correct horse battery staple'
const seed = async (email, opts = {}) => {
  const { rows } = await sql.query(
    `insert into users (email, name, role, status, password_hash, email_verified)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [
      email,
      opts.name ?? null,
      opts.role ?? 'user',
      opts.status ?? 'active',
      opts.password === null ? null : await hashPassword(opts.password ?? PW),
      opts.verified === false ? null : new Date(),
    ],
  )
  return rows[0].id
}

const ADA = 'ada@example.com'
const UNVERIFIED = 'unverified@example.com'
const SUSPENDED = 'suspended@example.com'
const NOPASS = 'nopass@example.com'
const ADMIN = 'admin@example.com'

const adaId = await seed(ADA, { name: 'Ada' })
await seed(UNVERIFIED, { verified: false })
await seed(SUSPENDED, { status: 'suspended' })
await seed(NOPASS, { password: null })
await seed(ADMIN, { role: 'admin' })

// ── 1. The wall, and the providers behind it ────────────────────────────────
section('1 · configuration')
{
  const r = await get('/vault')
  check('vault is closed without a session', r.status >= 400 || String(r.headers.get('location')).includes('/signin'), String(r.status))

  const providers = await fetch(`${BASE}/api/auth/providers`).then((x) => x.json())
  check('github provider is registered', Boolean(providers.github), Object.keys(providers).join(','))
  check('google provider is registered', Boolean(providers.google))
  check('credentials provider is registered', Boolean(providers.credentials))
}

// ── 2. Credentials sign-in ──────────────────────────────────────────────────
section('2 · credentials sign-in')
{
  const good = await signInWithPassword(ADA, PW)
  check('a correct password issues a session', Boolean(good.session))
  check('and that session opens the vault', await isSignedIn(good.session))

  const s = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: good.session ?? '' } }).then((r) => r.json())
  is('the session carries the users.id', s?.user?.id, adaId)
  is('the session carries the role', s?.user?.role, 'user')

  const wrong = await signInWithPassword(ADA, 'not the password')
  check('a wrong password does not', !wrong.session || !(await isSignedIn(wrong.session)))

  const nobody = await signInWithPassword('ghost@example.com', PW)
  check('an account that does not exist does not', !nobody.session || !(await isSignedIn(nobody.session)))

  const unver = await signInWithPassword(UNVERIFIED, PW)
  check('an UNVERIFIED address is refused despite the right password', !unver.session || !(await isSignedIn(unver.session)))

  const susp = await signInWithPassword(SUSPENDED, PW)
  check('a SUSPENDED account is refused despite the right password', !susp.session || !(await isSignedIn(susp.session)))

  const nopass = await signInWithPassword(NOPASS, PW)
  check('an account with no password set is refused', !nopass.session || !(await isSignedIn(nopass.session)))
}

// ── 3. Roles ────────────────────────────────────────────────────────────────
section('3 · roles')
{
  const user = await signInWithPassword(ADA, PW)
  const asUser = await get('/admin', user.session)
  check('a plain user cannot reach /admin', asUser.status === 404, String(asUser.status))

  const admin = await signInWithPassword(ADMIN, PW)
  const asAdmin = await get('/admin', admin.session)
  check('an admin can', asAdmin.status < 400, String(asAdmin.status))

  const s = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: admin.session ?? '' } }).then((r) => r.json())
  is('the admin session says so', s?.user?.role, 'admin')
}

// ── 4. Lockout ──────────────────────────────────────────────────────────────
section('4 · lockout')
{
  const TARGET = 'target@example.com'
  await seed(TARGET)
  await sql.query('delete from auth_attempts')

  for (let i = 0; i < 8; i++) await signInWithPassword(TARGET, `wrong-${i}`)

  const afterLimit = await signInWithPassword(TARGET, PW)
  check(
    'the CORRECT password is refused once the email is locked out',
    !afterLimit.session || !(await isSignedIn(afterLimit.session)),
  )

  // The email limiter must not have taken the whole IP down with it: 8
  // failures is well under the per-IP cap, so a different address still works.
  const other = await signInWithPassword(ADA, PW)
  check('a different account from the same host still signs in', await isSignedIn(other.session))

  // A success forgets that address's failures, so a run of typos followed by
  // the right password does not leave someone one attempt from a lockout.
  await sql.query('delete from auth_attempts')
  const CLEARS = 'clears@example.com'
  await seed(CLEARS)
  for (let i = 0; i < 3; i++) await signInWithPassword(CLEARS, 'nope')
  const before = await sql.query('select count(*)::int as n from auth_attempts where email = $1', [CLEARS])
  const good = await signInWithPassword(CLEARS, PW)
  const after = await sql.query('select count(*)::int as n from auth_attempts where email = $1', [CLEARS])
  check('failures are recorded', before.rows[0].n === 3, `${before.rows[0].n}`)
  check('a success clears them', Boolean(good.session) && after.rows[0].n === 0, `${after.rows[0].n}`)

  await sql.query('delete from auth_attempts')
}

// ── 5. Revocation ───────────────────────────────────────────────────────────
section('5 · revocation')
{
  const REVOKE = 'revoke@example.com'
  const id = await seed(REVOKE)
  const s = await signInWithPassword(REVOKE, PW)
  check('signed in', await isSignedIn(s.session))

  await sql.query('update users set session_version = session_version + 1 where id = $1', [id])
  check('bumping sessionVersion kills the live session', !(await isSignedIn(s.session)))

  const s2 = await signInWithPassword(REVOKE, PW)
  check('and a fresh sign-in still works afterwards', await isSignedIn(s2.session))

  await sql.query(`update users set status = 'suspended' where id = $1`, [id])
  check('suspending kills the live session', !(await isSignedIn(s2.session)))

  await sql.query(`update users set status = 'active' where id = $1`, [id])
  const s3 = await signInWithPassword(REVOKE, PW)
  check('reactivating lets them back in', await isSignedIn(s3.session))

  await sql.query('delete from users where id = $1', [id])
  check('deleting the row kills the session', !(await isSignedIn(s3.session)))
}

// ── 6. Reset and verification, end to end through the emailed link ──────────
section('6 · reset and verification')
{
  const RESET = 'reset@example.com'
  const rid = await seed(RESET)
  const live = await signInWithPassword(RESET, PW)
  check('signed in before the reset', await isSignedIn(live.session))

  const unknown = await json('/api/account/reset', 'POST', { email: 'nobody@example.com' })
  const known = await json('/api/account/reset', 'POST', { email: RESET })
  is('an unknown address gets 200', unknown.status, 200)
  is('a known address gets 200', known.status, 200)
  const a = await unknown.json()
  const b = await known.json()
  check('with byte-identical bodies (no account enumeration)', JSON.stringify(a) === JSON.stringify(b))

  await new Promise((r) => setTimeout(r, 300))
  const link = lastLinkFrom('/reset/')
  check('the reset link reached the mail path', Boolean(link), link ? 'captured' : 'not found in server log')

  const token = link ? link.split('/reset/')[1] : ''
  const short = await json('/api/account/reset', 'PUT', { token, password: 'short' })
  is('a too-short password is refused', short.status, 400)

  const stillThere = await sql.query(
    `select count(*)::int as n from verification_tokens where identifier = $1`,
    [`reset:${RESET}`],
  )
  check('and does NOT spend the token', stillThere.rows[0].n === 1, `${stillThere.rows[0].n} row(s)`)

  const NEWPW = 'a completely different password'
  const done = await json('/api/account/reset', 'PUT', { token, password: NEWPW })
  is('a valid reset succeeds', done.status, 200)

  const again = await json('/api/account/reset', 'PUT', { token, password: NEWPW })
  is('the same token cannot be used twice', again.status, 400)

  check('the OLD session is dead', !(await isSignedIn(live.session)))
  check('the OLD password no longer works', !(await isSignedIn((await signInWithPassword(RESET, PW)).session)))
  check('the NEW password does', await isSignedIn((await signInWithPassword(RESET, NEWPW)).session))

  // An expired token, correctly formed. Inserted directly because only its
  // hash is ever stored, so the raw value has to originate here.
  const raw = randomBytes(32).toString('base64url')
  await sql.query(
    `insert into verification_tokens (identifier, token, expires) values ($1, $2, $3)`,
    [`reset:${RESET}`, createHash('sha256').update(raw).digest('hex'), new Date(Date.now() - 1000)],
  )
  const expired = await json('/api/account/reset', 'PUT', { token: raw, password: NEWPW })
  is('an expired token is refused', expired.status, 400)

  // Verification: the unverified seed cannot sign in until the link is opened.
  const beforeVerify = await signInWithPassword(UNVERIFIED, PW)
  check('the unverified account still cannot sign in', !(await isSignedIn(beforeVerify.session)))

  // A second unverified account that must be untouched. This is the assertion
  // that catches `eq(a) && isNull(b)` — JavaScript's `&&` on two drizzle
  // conditions evaluates to the second one, so the UPDATE would silently
  // become "every unverified user". Without a bystander in the table, a
  // whole-table update and a correct one look identical.
  const DECOY = 'decoy@example.com'
  await seed(DECOY, { verified: false })

  await json('/api/account/verify', 'POST', { email: UNVERIFIED })
  await new Promise((r) => setTimeout(r, 300))
  const vlink = lastLinkFrom('/verify/')
  check('the verification link reached the mail path', Boolean(vlink))

  const vres = await json('/api/account/verify', 'PUT', { token: vlink ? vlink.split('/verify/')[1] : '' })
  is('confirming succeeds', vres.status, 200)

  const target = await sql.query(`select email_verified from users where email = $1`, [UNVERIFIED])
  const decoy = await sql.query(`select email_verified from users where email = $1`, [DECOY])
  check('the right row was verified', target.rows[0].email_verified !== null)
  check(
    'and ONLY that row — a bystander stays unverified',
    decoy.rows[0].email_verified === null,
  )
  check('and now it signs in', await isSignedIn((await signInWithPassword(UNVERIFIED, PW)).session))

  await sql.query('delete from users where id = $1', [rid])
}

// ── 7. The OAuth linking policy ─────────────────────────────────────────────
section('7 · account linking (policy, against this database)')
{
  process.env.DATABASE_URL = DB_URL
  const policy = await import(path.join(ROOT, 'web/src/lib/link-policy.ts'))
  const yes = async () => true
  const no = async () => false
  const decide = (o) => policy.decideOAuthSignIn({ provider: 'github', providerAccountId: 'gh-1', isEmailVerifiedByProvider: yes, ...o })
  const why = (d) => (d.allow ? 'allow' : d.redirect.split('error=')[1])

  is('no email at all is refused', why(await decide({ email: '' })), 'NoEmail')
  is('an address with no account is refused', why(await decide({ email: 'stranger@example.com' })), 'NoAccount')

  is(
    'an existing account with a VERIFIED provider email links',
    why(await decide({ email: ADA, isEmailVerifiedByProvider: yes })),
    'allow',
  )
  is(
    'an existing account with an UNVERIFIED provider email is refused',
    why(await decide({ email: ADA, isEmailVerifiedByProvider: no })),
    'UnverifiedEmail',
  )
  is(
    'a suspended account is refused even with a verified email',
    why(await decide({ email: SUSPENDED, isEmailVerifiedByProvider: yes })),
    'Suspended',
  )
  is(
    'case is folded before matching',
    why(await decide({ email: ADA.toUpperCase().toLowerCase() })),
    'allow',
  )

  // Already linked: the provider proved this identity when the link was made,
  // so no verification call is needed and none is made.
  await sql.query(
    `insert into accounts (user_id, type, provider, provider_account_id) values ($1,'oauth','github','gh-linked')`,
    [adaId],
  )
  let called = false
  const linked = await policy.decideOAuthSignIn({
    provider: 'github',
    providerAccountId: 'gh-linked',
    email: ADA,
    isEmailVerifiedByProvider: async () => { called = true; return false },
  })
  is('an already-linked account is allowed straight through', why(linked), 'allow')
  check('without re-asking the provider', !called)

  // Same link, suspended owner.
  await sql.query(`update users set status = 'suspended' where id = $1`, [adaId])
  is(
    'unless the owner is suspended',
    why(await policy.decideOAuthSignIn({ provider: 'github', providerAccountId: 'gh-linked', email: ADA, isEmailVerifiedByProvider: no })),
    'Suspended',
  )
  await sql.query(`update users set status = 'active' where id = $1`, [adaId])

  // Linking a SECOND provider while signed in — the flow that makes one human
  // with a work GitHub and a personal Google end up with one account.
  {
    let asked = false
    const connect = (o) =>
      policy.decideOAuthSignIn({
        provider: 'google',
        providerAccountId: 'goog-new',
        email: 'a-completely-different@example.com',
        isEmailVerifiedByProvider: async () => { asked = true; return false },
        ...o,
      })

    is(
      'signed out, an unknown address is refused',
      why(await connect({})),
      'NoAccount',
    )
    is(
      'signed in, the SAME address links to the current account',
      why(await connect({ currentUserId: adaId })),
      'allow',
    )
    check('and the provider is not asked to verify it', !asked)

    // The account is spoken for by someone else: refuse rather than steal it.
    const other = await seed('other@example.com')
    await sql.query(
      `insert into accounts (user_id, type, provider, provider_account_id) values ($1,'oauth','google','goog-taken')`,
      [other],
    )
    is(
      'a provider account linked to someone else cannot be taken over',
      why(await connect({ currentUserId: adaId, providerAccountId: 'goog-taken' })),
      'AlreadyLinked',
    )
    is(
      'and its real owner still signs in with it',
      why(await policy.decideOAuthSignIn({
        provider: 'google', providerAccountId: 'goog-taken',
        email: 'other@example.com', isEmailVerifiedByProvider: no,
      })),
      'allow',
    )

    await sql.query(`update users set status = 'suspended' where id = $1`, [adaId])
    is(
      'a suspended account cannot connect a provider either',
      why(await connect({ currentUserId: adaId })),
      'Suspended',
    )
    await sql.query(`update users set status = 'active' where id = $1`, [adaId])
    await sql.query('delete from accounts where provider_account_id = $1', ['goog-new'])
  }

  is(
    'google reports verification through email_verified',
    await policy.providerVerifiedEmail('google', null, { email_verified: true }, ADA),
    true,
  )
  is(
    'and an unverified google profile is not trusted',
    await policy.providerVerifiedEmail('google', null, { email_verified: false }, ADA),
    false,
  )
  is(
    'github without an access token cannot be trusted',
    await policy.providerVerifiedEmail('github', null, {}, ADA),
    false,
  )
  is(
    'an unknown provider is refused rather than assumed',
    await policy.providerVerifiedEmail('gitlab', 'token', {}, ADA),
    false,
  )
}

// ── 8. Password hashing ─────────────────────────────────────────────────────
section('8 · password hashing')
{
  const pw = await import(path.join(ROOT, 'web/src/lib/password.ts'))
  const h = await pw.hashPassword(PW)
  check('the stored form names its algorithm and cost', /^scrypt\$65536\$8\$2\$/.test(h), h.slice(0, 24) + '…')
  is('the right password verifies', await pw.verifyPassword(PW, h), true)
  is('a wrong one does not', await pw.verifyPassword(PW + 'x', h), false)
  is('two hashes of the same password differ (salted)', (await pw.hashPassword(PW)) === h, false)
  is('a garbage record does not throw', await pw.verifyPassword(PW, 'not-a-hash'), false)
  is('a current hash needs no rehash', pw.needsRehash(h), false)
  is('a weaker one does', pw.needsRehash('scrypt$16384$8$1$c2FsdA$aGFzaA'), true)

  const { rows } = await sql.query('select password_hash from users where email = $1', [ADMIN])
  check('nothing plaintext reaches the database', !rows[0].password_hash.includes(PW))
}

// ── 9. Nobody can unlink their way out of their own vault ───────────────────
section('9 · disconnecting a sign-in method')
{
  const users = await import(path.join(ROOT, 'web/src/lib/users.ts'))
  const policyMod = await import(path.join(ROOT, 'web/src/lib/link-policy.ts'))
  const link = (id, provider, pid) =>
    sql.query(
      `insert into accounts (user_id, type, provider, provider_account_id) values ($1,'oauth',$2,$3)`,
      [id, provider, pid],
    )

  // Only a GitHub link and no password: removing it strands the account.
  const only = await seed('only-oauth@example.com', { password: null })
  await link(only, 'github', 'gh-only')
  let r = await users.unlinkProvider(only, 'github')
  is('the LAST sign-in method cannot be removed', r.ok === false && r.reason, 'last-method')
  is('and it is still there', (await users.listLinkedProviders(only)).join(), 'github')

  // Two providers: one may go, the second may not.
  const two = await seed('two-oauth@example.com', { password: null })
  await link(two, 'github', 'gh-two')
  await link(two, 'google', 'goog-two')
  is('with two connected, one can be removed', (await users.unlinkProvider(two, 'github')).ok, true)
  r = await users.unlinkProvider(two, 'google')
  is('but not the one that is left', r.ok === false && r.reason, 'last-method')

  // A password counts as a method, so the only provider may go.
  const withPw = await seed('oauth-plus-password@example.com')
  await link(withPw, 'github', 'gh-pw')
  is(
    'a password counts, so the only provider can be disconnected',
    (await users.unlinkProvider(withPw, 'github')).ok,
    true,
  )
  is('leaving the password behind', (await policyMod.signInMethods(withPw)).total, 1)

  r = await users.unlinkProvider(withPw, 'google')
  is('disconnecting something never connected is refused', r.ok === false && r.reason, 'not-linked')
}

// ── 10. The account API is the signed-in user's own, and nobody else's ──────
section('10 · account API')
{
  const anon = await get('/api/account/me')
  check('is closed without a session', anon.status >= 400 || String(anon.headers.get('location')).includes('/signin'), String(anon.status))

  const s = await signInWithPassword(ADMIN, PW)
  const mine = await fetch(`${BASE}/api/account/me`, { headers: { cookie: s.session ?? '' } })
  is('opens with one', mine.status, 200)
  const body = await mine.json()
  is('and returns the caller, not a requested id', body.email, ADMIN)
  check('reporting what they can sign in with', Array.isArray(body.providers) && body.hasPassword === true)

  const page = await get('/account', s.session)
  check('the account page opens for a signed-in user', page.status < 400, String(page.status))
}

console.log(`\n${pass}/${pass + fail} passed\n`)
cleanup()
process.exit(fail ? 1 : 0)
