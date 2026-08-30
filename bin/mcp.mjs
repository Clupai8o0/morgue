#!/usr/bin/env node
// The morgue MCP server over stdio.
//
//   pnpm mcp
//
// A single-user, no-auth transport for the person who owns the filesystem: it
// reads the built vault straight out of site/data/ and speaks newline-delimited
// JSON-RPC on stdin/stdout, which is what a local MCP client (Claude Desktop,
// an editor's MCP config) connects to. The hosted, account-authenticated
// transport is web/src/app/api/mcp/route.ts; both share bin/mcp-core.mjs, so
// the three tools behave identically.
//
// Point a client at it with, e.g.:
//   { "command": "pnpm", "args": ["mcp"], "cwd": "<repo>" }
//
// Requires a built site — run `pnpm build` first. Everything logs to stderr;
// stdout carries protocol only.

import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleRaw, SERVER_INFO } from './mcp-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = process.env.MORGUE_SITE_DIR
  ? path.resolve(process.env.MORGUE_SITE_DIR)
  : path.join(ROOT, 'site')
const DATA = path.join(SITE, 'data')

const log = (...a) => process.stderr.write(a.join(' ') + '\n')

// ── Filesystem data source ──────────────────────────────────────────────────
// The same three-method shape lib/vault-data.ts exposes to the HTTP transport.
// facets.json and index.json are read once and cached; records are read on
// demand (get_component, and search's notes excerpts).

let facetsCache = null
// `undefined` = not yet read; `null` = read and absent. A `null` sentinel would
// be indistinguishable from "missing", so a missing index.json would be re-read
// from disk on every list_facets call.
let indexCache

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(DATA, rel), 'utf8'))
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i

const dataSource = {
  async getFacets() {
    if (!facetsCache) facetsCache = await readJson('facets.json').catch(() => [])
    return facetsCache
  },
  async getIndex() {
    if (indexCache === undefined) indexCache = await readJson('index.json').catch(() => null)
    return indexCache
  },
  async getItem(slug) {
    if (!SLUG_RE.test(slug)) return null
    return readJson(path.join('items', `${slug}.json`)).catch(() => null)
  },
}

// ── stdio JSON-RPC loop ─────────────────────────────────────────────────────
// One message per line, no embedded newlines — the stdio transport framing.

async function main() {
  // A friendly, non-fatal warning to stderr if the vault has not been built.
  try {
    const facets = await dataSource.getFacets()
    if (!facets.length) {
      log(
        '[mcp] site/data/facets.json is empty or missing. Run `pnpm build` (and ' +
          'capture some items) — the server will start but return nothing.',
      )
    } else {
      log(`[mcp] ${SERVER_INFO.name} ready — ${facets.length} components from ${DATA}`)
    }
  } catch (err) {
    log(`[mcp] could not read the vault at ${DATA}: ${err?.message ?? err}`)
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of rl) {
    const raw = line.trim()
    if (!raw) continue
    let out
    try {
      out = await handleRaw(raw, { dataSource })
    } catch (err) {
      log(`[mcp] dispatch failed: ${err?.stack ?? err}`)
      continue
    }
    if (out.body) process.stdout.write(JSON.stringify(out.body) + '\n')
  }
}

main().catch((err) => {
  log(`[mcp] fatal: ${err?.stack ?? err}`)
  process.exit(1)
})
