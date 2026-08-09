#!/usr/bin/env node
// Account administration from the command line.
//
//   pnpm user list
//   pnpm user add <email> [--admin] [--name "Ada"] [--password] [--verified]
//   pnpm user password <email>
//   pnpm user role <email> user|admin
//   pnpm user suspend <email>
//   pnpm user activate <email>
//   pnpm user rm <email>
//
// WHY THIS EXISTS. Until the multi-tenant pivot, authorisation was
// AUTH_ALLOWED_LOGINS — a comma-separated env var, empty meaning nobody
// (CLAUDE.md rule 9). Its replacement is a row in `users`, and something has to
// write the first one. The alternatives were both worse:
//
//   - "the first person to sign in becomes admin" is a race anyone on the
//     internet can enter, and the window is the deploy.
//   - a bootstrap env var is the allowlist again, wearing a different name.
//
// So the first account is made by whoever holds the database URL, which is the
// same person who holds the deploy. Nothing is granted by clicking.
//
// It talks to Postgres with plain SQL through `pg` rather than through drizzle,
// because a CLI that shares the app's ORM setup also shares its module graph —
// and that graph imports next-auth, which does not load outside Next.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Node 20.6+ reads a dotenv file natively; nothing has loaded web/.env.local
// for a script that runs outside Next.
try {
  process.loadEnvFile(path.join(ROOT, 'web', '.env.local'))
} catch {
  // Absent on a fresh clone and in CI; the real environment may still have it.
}

// pg 8 prints a multi-paragraph deprecation notice about `sslmode=require`
// semantics on every connection to a Neon URL. It is aimed at whoever upgrades
// to pg 9, not at whoever is adding a user, and it buries the actual output.
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (!/sslmode|MODULE_TYPELESS_PACKAGE_JSON/.test(`${w.name} ${w.message}`)) console.warn(w.stack)
})

const DIM = (s) => `\x1b[2m${s}\x1b[0m`
const RED = (s) => `\x1b[31m${s}\x1b[0m`
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`

function die(msg) {
  console.error(`${RED('error')} ${msg}`)
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) {
  die(
    'DATABASE_URL is not set.\n' +
      '  Put a connection string in web/.env.local, or export it for this command.\n' +
      '  Any Postgres works — see web/src/db/index.ts.',
  )
}

// Only the app needs the two-driver split; here a normal client is always right.
const client = new pg.Client({
  connectionString: url,
  ssl: /\bsslmode=require\b/.test(url) ? { rejectUnauthorized: true } : undefined,
})

const argv = process.argv.slice(2)
const cmd = argv[0]
const positional = argv.slice(1).filter((a) => !a.startsWith('--'))
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : null
}

const normalise = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Piped stdin is drained ONCE and handed out a line at a time.
 *
 * The obvious version — a fresh readline interface per prompt — reads the
 * first line and then finds the stream already consumed, so the second prompt
 * silently returns an empty string and every password "does not match" or
 * "is too short". Two prompts, one stream: the queue has to outlive the call.
 */
let queued = null
async function piped() {
  if (!queued) {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    queued = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
  }
  return queued.shift() ?? ''
}

/**
 * Reads one line without echoing it.
 *
 * Raw mode rather than readline: readline echoes, and the usual trick for
 * suppressing that is to monkey-patch its output stream, which behaves
 * differently depending on how the process was started. Reading bytes directly
 * is longer but has one behaviour.
 *
 * Piped input takes the plain path — there is no terminal to hide anything
 * from, and it is what makes this command scriptable and testable.
 */
function askSecret(prompt) {
  const { stdin, stdout } = process

  if (!stdin.isTTY) return piped()

  return new Promise((resolve) => {
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    let buf = ''
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData)
          stdin.setRawMode(false)
          stdin.pause()
          stdout.write('\n')
          return resolve(buf)
        }
        // Ctrl-C does not raise SIGINT in raw mode. Without this the terminal
        // is left raw with no way out of the prompt.
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function readPassword() {
  const first = await askSecret('  password: ')
  const again = await askSecret('  again:    ')
  if (first !== again) die('those did not match.')
  const { passwordProblem, hashPassword } = await import(
    path.join(ROOT, 'web/src/lib/password.ts')
  )
  const problem = passwordProblem(first)
  if (problem) die(problem)
  return hashPassword(first)
}

async function main() {
  await client.connect()

  switch (cmd) {
    case 'list': {
      const { rows } = await client.query(
        `select email, role, status, session_version,
                password_hash is not null as has_password,
                email_verified is not null as verified,
                created_at, last_seen_at
           from users order by created_at`,
      )
      if (!rows.length) {
        console.log(
          '\n  no accounts.\n\n' +
            DIM('  Nobody can sign in until there is one — that is rule 9 working.\n') +
            DIM('  pnpm user add you@example.com --admin --verified\n'),
        )
        break
      }
      console.log('')
      for (const r of rows) {
        const bits = [
          r.role === 'admin' ? 'admin' : 'user',
          r.status === 'active' ? GREEN('active') : RED(r.status),
          r.has_password ? 'password' : DIM('no password'),
          r.verified ? 'verified' : RED('unverified'),
        ]
        console.log(`  ${r.email.padEnd(34)} ${bits.join(DIM(' · '))}`)
        console.log(
          DIM(
            `    created ${new Date(r.created_at).toISOString().slice(0, 10)}` +
              (r.last_seen_at
                ? ` · last seen ${new Date(r.last_seen_at).toISOString().slice(0, 10)}`
                : ' · never signed in') +
              ` · session v${r.session_version}`,
          ),
        )
      }
      console.log('')
      break
    }

    case 'add': {
      const email = normalise(positional[0])
      if (!email || !email.includes('@')) die('usage: pnpm user add <email> [--admin] [--name "Ada"] [--password] [--verified]')

      const hash = flag('password') ? await readPassword() : null
      const { rows } = await client.query(
        `insert into users (email, name, role, password_hash, email_verified)
         values ($1, $2, $3, $4, $5)
         on conflict (email) do nothing
         returning id`,
        [
          email,
          value('name'),
          flag('admin') ? 'admin' : 'user',
          hash,
          // An address the operator typed is not one the operator has proved
          // control of, so verification is opt-in rather than implied. Without
          // it the account can still sign in with GitHub or Google — those
          // verify for us — but not with a password.
          flag('verified') ? new Date() : null,
        ],
      )
      if (!rows.length) die(`${email} already has an account.`)

      console.log(`\n  ${GREEN('created')} ${email}${flag('admin') ? ' (admin)' : ''}`)
      if (!hash) {
        console.log(
          DIM('\n  No password set. They can sign in with GitHub or Google, or set one\n') +
            DIM('  themselves at /reset — which is also what verifies the address.\n'),
        )
      } else if (!flag('verified')) {
        console.log(
          DIM('\n  Password set but the address is unverified, so password sign-in is\n') +
            DIM('  refused until it is. Pass --verified, or let them use /reset.\n'),
        )
      } else {
        console.log('')
      }
      break
    }

    case 'password': {
      const email = normalise(positional[0])
      if (!email) die('usage: pnpm user password <email>')
      const hash = await readPassword()
      // Bumping session_version is the point as much as the new hash: changing
      // a password must end every session that was opened with the old one.
      const { rowCount } = await client.query(
        `update users
            set password_hash = $2,
                email_verified = coalesce(email_verified, now()),
                session_version = session_version + 1
          where lower(email) = $1`,
        [email, hash],
      )
      if (!rowCount) die(`no account for ${email}`)
      console.log(`\n  ${GREEN('password set')} for ${email}`)
      console.log(DIM('  Every existing session for this account is now invalid.\n'))
      break
    }

    case 'role': {
      const email = normalise(positional[0])
      const role = normalise(positional[1])
      if (!email || !['user', 'admin'].includes(role)) {
        die('usage: pnpm user role <email> user|admin')
      }
      const { rowCount } = await client.query(
        `update users set role = $2 where lower(email) = $1`,
        [email, role],
      )
      if (!rowCount) die(`no account for ${email}`)
      console.log(`\n  ${GREEN('ok')} ${email} is now ${role}\n`)
      break
    }

    case 'suspend':
    case 'activate': {
      const email = normalise(positional[0])
      if (!email) die(`usage: pnpm user ${cmd} <email>`)
      const status = cmd === 'suspend' ? 'suspended' : 'active'
      const { rowCount } = await client.query(
        `update users
            set status = $2,
                session_version = session_version + ($3::int)
          where lower(email) = $1`,
        // Suspending bumps the version so live sessions die; reactivating does
        // not need to, and bumping would log the person out at the moment they
        // are being let back in.
        [email, status, cmd === 'suspend' ? 1 : 0],
      )
      if (!rowCount) die(`no account for ${email}`)
      console.log(`\n  ${GREEN('ok')} ${email} is ${status}`)
      if (cmd === 'suspend') {
        console.log(
          DIM('  Live sessions end within SESSION_RECHECK_SECONDS (60s) — see web/src/auth.ts.\n'),
        )
      } else {
        console.log('')
      }
      break
    }

    case 'rm': {
      const email = normalise(positional[0])
      if (!email) die('usage: pnpm user rm <email> --yes')
      if (!flag('yes')) {
        die(
          `this deletes the account, every OAuth link it has, its waitlist row\n` +
            `  and its lockout history, and revokes every share link it issued.\n` +
            `  Re-run with --yes if that is what you want.`,
        )
      }
      // Deliberately the same six steps, in the same order, as deleteAccount()
      // in web/src/lib/users.ts. This used to be a bare `delete from users`,
      // which cascades accounts and sessions and NOTHING ELSE — so the CLI was
      // the path that quietly left a departing user's share links live, their
      // address in the lockout table, and a redeemable `reset:` token pointing
      // at an address anyone could then register.
      //
      // Two rows are not FKs and will not cascade however tempting it looks:
      // share_links.created_by is bare text, and the waitlist row is keyed by
      // address. upgrade_requests does cascade, so it is absent here on purpose.
      const { rows: found } = await client.query(
        `select id, role from users where lower(email) = $1`,
        [email],
      )
      const victim = found[0]
      if (!victim) die(`no account for ${email}`)

      if (victim.role === 'admin') {
        const { rows: others } = await client.query(
          `select count(*)::int as n from users
            where role = 'admin' and status = 'active' and id <> $1`,
          [victim.id],
        )
        if (others[0].n === 0) {
          die(
            `${email} is the only active admin.\n` +
              `  Deleting it leaves an /admin nobody can open — it 404s for non-admins.\n` +
              `  Make someone else an admin first: pnpm user role <email> admin`,
          )
        }
      }

      // REVOKED, never deleted. A share token is valid because it is signed,
      // and app/s/[token] lets an unknown jti through by design — so removing
      // these rows would re-enable every link this user ever revoked.
      const { rowCount: revoked } = await client.query(
        `update share_links set revoked_at = now()
          where created_by = $1 and revoked_at is null`,
        [victim.id],
      )
      await client.query(`delete from verification_tokens where identifier = any($1)`, [
        [`verify:${email}`, `reset:${email}`],
      ])
      await client.query(`delete from auth_attempts where email = $1`, [email])
      await client.query(`delete from waitlist where lower(email) = $1`, [email])
      // Last: the email is the key for everything above it.
      await client.query(`delete from users where id = $1`, [victim.id])

      console.log(`\n  ${GREEN('deleted')} ${email}`)
      console.log(
        DIM(
          `  ${revoked} share link(s) revoked, tokens and lockout rows cleared, waitlist row removed.\n`,
        ),
      )
      break
    }

    default:
      console.log(
        [
          '',
          '  pnpm user list',
          '  pnpm user add <email> [--admin] [--name "Ada"] [--password] [--verified]',
          '  pnpm user password <email>',
          '  pnpm user role <email> user|admin',
          '  pnpm user suspend <email>',
          '  pnpm user activate <email>',
          '  pnpm user rm <email> --yes',
          '',
        ].join('\n'),
      )
      process.exitCode = cmd ? 1 : 0
  }
}

try {
  await main()
} catch (err) {
  if (String(err?.message ?? '').includes('relation "users" does not exist')) {
    die('the users table does not exist yet. Run `pnpm db:push` first.')
  }
  die(err?.message ?? String(err))
} finally {
  await client.end().catch(() => {})
}

