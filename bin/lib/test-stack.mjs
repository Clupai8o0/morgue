// A disposable morgue: a Postgres cluster, a production Next server pointed at
// it, and a way to get a signed-in cookie out of the pair.
//
// WHY THIS IS SHARED. Two harnesses need it for different reasons and neither
// should own it:
//
//   - bin/verify-auth.mjs needs a real database, because every interesting auth
//     bug is a query returning the wrong row.
//   - bin/verify-web.mjs needs a SESSION. It used to run against `pnpm web:dev`
//     with no credentials configured, where proxy.ts fails open and /vault
//     renders for anyone. The moment web/.env.local was fully populated that
//     stopped being true — the dev server started gating /vault correctly, and
//     the harness landed on /signin and reported that the grid had no cards.
//     That was the product working and the test being wrong.
//
// Running against `next start` rather than `next dev` also sidesteps Next 16's
// refusal to run a second dev server for the same directory, so these can be
// used while a dev server is open — which is exactly when someone runs them.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

/**
 * Teach plain Node how web/ resolves its own imports, so a harness can call the
 * app's real modules instead of a reimplementation of them.
 *
 * Node 24 strips types on import but reads no tsconfig, so neither the `@/*`
 * alias nor `moduleResolution: "bundler"`'s extensionless relative imports
 * resolve. Both have to be handled or the import fails one level deep — which
 * excludes exactly the modules worth testing, since the leaves with no internal
 * imports are the ones that need a harness least.
 */
export function registerWebResolver() {
  const SRC = path.join(ROOT, 'web/src')
  const resolveTsPath = (base) =>
    [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((c) => existsSync(c)) ??
    null

  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@/')) {
        const hit = resolveTsPath(path.join(SRC, specifier.slice(2)))
        if (hit) return next(pathToFileURL(hit).href, context)
      }
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const parent = context.parentURL ?? ''
        if (parent.startsWith(pathToFileURL(SRC).href) && !path.extname(specifier)) {
          const hit = resolveTsPath(
            path.resolve(path.dirname(fileURLToPath(parent)), specifier),
          )
          if (hit) return next(pathToFileURL(hit).href, context)
        }
      }
      return next(specifier, context)
    },
  })
}

/**
 * Deprecation noise that buries the actual output of a verification run: pg 8's
 * `sslmode` notice, and Node's complaint about importing .ts from a package.json
 * with no "type".
 *
 * Matched on the CODE as well as the message. The typeless-package warning
 * carries `code: 'MODULE_TYPELESS_PACKAGE_JSON'` but a `name` of just
 * "Warning", so a filter that only reads name and message misses it and prints
 * a ten-frame stack above the first assertion.
 */
export function quietenNodeWarnings() {
  const NOISE = /sslmode|MODULE_TYPELESS_PACKAGE_JSON|Module type of file:/
  process.removeAllListeners('warning')
  process.on('warning', (w) => {
    if (!NOISE.test(`${w.name} ${w.code ?? ''} ${w.message}`)) console.warn(w.stack)
  })
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout ?? ''}${r.stderr ?? ''}`)
  }
  return r.stdout
}

/**
 * Starts a Postgres cluster in a temp directory and applies every drizzle
 * migration to it. Returns a connected client and its URL.
 *
 * `--auth=trust` is safe here and only here: loopback, a nonstandard port, the
 * lifetime of one script, deleted afterwards, holding nothing but rows the
 * caller created.
 *
 * The role is in the URL because `pg` otherwise falls back to the OS user, and
 * a cluster made by `initdb -U postgres` has no such role.
 */
export async function startPostgres({ port = 55432 } = {}) {
  if (spawnSync('initdb', ['--version']).status !== 0) {
    throw new Error('initdb not found — install Postgres (brew install postgresql@16).')
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'morgue-verify-pg-'))
  const data = path.join(dir, 'data')
  const url = `postgres://postgres@127.0.0.1:${port}/morgue_verify`

  sh('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '-N'])
  sh('pg_ctl', [
    '-D', data,
    '-o', `-p ${port} -h 127.0.0.1 -k ${dir} -c fsync=off -c full_page_writes=off`,
    '-l', path.join(dir, 'pg.log'),
    '-w', '-t', '30',
    'start',
  ])

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '10', 'stop'], {
      stdio: 'ignore',
    })
    rmSync(dir, { recursive: true, force: true })
  }

  try {
    sh('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'morgue_verify'])
    const sql = new pg.Client({ connectionString: url })
    await sql.connect()

    const migrations = path.join(ROOT, 'web', 'drizzle')
    const files = readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()
    for (const f of files) {
      for (const stmt of readFileSync(path.join(migrations, f), 'utf8').split(
        '--> statement-breakpoint',
      )) {
        if (stmt.trim()) await sql.query(stmt.trim())
      }
    }

    return { url, sql, applied: files.length, stop }
  } catch (err) {
    stop()
    throw err
  }
}

/**
 * Starts `next start` against the given environment. Builds first if there is
 * no production build to serve.
 *
 * Returns the collected stdout+stderr as a live getter, because the reset and
 * verification flows are checked by reading the link out of the server's own
 * log — with RESEND_API_KEY unset, lib/notify.ts logs it instead of sending,
 * which is what makes those tests end to end rather than mocked.
 */
export async function startServer({ port, env }) {
  const full = { ...process.env, ...env }

  if (!existsSync(path.join(ROOT, 'web', '.next', 'BUILD_ID'))) {
    console.log('  building web/ first (no production build found) …')
    await new Promise((res, rej) => {
      const p = spawn('pnpm', ['--filter', 'web', 'build'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: full,
      })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      p.on('close', (c) => (c === 0 ? res() : rej(new Error(out.slice(-3000)))))
    })
  }

  const child = spawn(
    'pnpm',
    ['--filter', 'web', 'exec', 'next', 'start', '--port', String(port)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: full },
  )

  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/signin`, { redirect: 'manual' })
      if (r.status < 500) {
        return {
          base,
          child,
          logs: () => log,
          stop: () => { if (!child.killed) child.kill('SIGTERM') },
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  child.kill('SIGTERM')
  throw new Error(`server did not start on ${port}\n${log.slice(-3000)}`)
}

/** A random secret, so no two runs share a signing key. */
export const freshSecret = () => randomBytes(32).toString('base64')

/**
 * A full credentials sign-in over HTTP: fetch the CSRF token, post the form to
 * the callback endpoint, return the cookie jar.
 *
 * Deliberately the real endpoint rather than calling authorize() directly — the
 * CSRF check and the cookie plumbing are part of what is being verified.
 */
export async function signInWithPassword(base, email, password) {
  const csrfRes = await fetch(`${base}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const jar = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])
  const cookies = jar(csrfRes)

  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies.join('; '),
    },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/vault` }),
  })

  const all = [...cookies, ...jar(res)].filter(Boolean).join('; ')
  return {
    res,
    cookies: all,
    session: /authjs\.session-token=[^;]+/.test(all) ? all : null,
    location: String(res.headers.get('location') ?? ''),
  }
}
