#!/usr/bin/env node
// pnpm item <slug> — the whole add loop in one command: capture → build → check <slug>.
//
// capture already takes a slug and check now does too (bin/check.mjs), so the last mile of
// "I added an item — is it live and unbroken?" is one command instead of three remembered in
// the right order. Stops at the first failing stage (a broken capture should not be built and
// vouched for), and ends by pointing at the video you are still on the hook to watch — motion:
// OK only proves pixels moved, not that the effect ran (CLAUDE.md rule 5).

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!slugs.length) {
  console.error('Usage: pnpm item <slug> [<slug>…]   — capture, build, then check just those items')
  process.exit(1)
}

const step = (name, args) => {
  process.stdout.write(`\n\x1b[1m▸ ${name}\x1b[0m ${args.join(' ')}\n`)
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', `${name}.mjs`), ...args], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) {
    console.error(`\n\x1b[31m✗ ${name} failed (${r.status != null ? 'exit ' + r.status : 'signal ' + r.signal}) — stopping before the next stage.\x1b[0m`)
    process.exit(r.status ?? 1)
  }
}

// capture takes the slugs; build regenerates the whole site (cheap); check verifies only these.
step('capture', slugs)
step('build', [])
step('check', slugs)

console.log(`\n\x1b[32m✓ ${slugs.length} item(s) captured, built and verified.\x1b[0m`)
for (const slug of slugs) {
  console.log(`  ${slug}`)
  const mp4 = path.join('out', slug, 'preview.mp4')
  const sheet = path.join('out', slug, 'contact.jpg')
  if (existsSync(path.join(ROOT, mp4))) console.log(`      watch:  ${mp4}`)
  if (existsSync(path.join(ROOT, sheet))) console.log(`      sheet:  ${sheet}`)
}
console.log(`\n  Now LOOK at the preview before calling it done — motion: OK only proves pixels moved (CLAUDE.md rule 5).`)
