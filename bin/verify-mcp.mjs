#!/usr/bin/env node
// Verifies the MCP tool layer and the stdio transport, with no database.
//
//   pnpm verify:mcp
//
// Two things are proven here. First, the shared core (bin/mcp-core.mjs) over a
// filesystem data source: the three tools return the right shapes, the facet
// filters mean what they say, and a bad slug is a tool error rather than a
// crash. Second, the stdio transport (bin/mcp.mjs) actually frames JSON-RPC on
// stdin/stdout — a round trip through a spawned process.
//
// The HTTP transport and its bearer auth are proven separately, against a real
// Postgres and a production server, in bin/verify-auth.mjs (§ mcp tokens) —
// this file deliberately needs neither.

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleRaw, dispatch } from './mcp-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = process.env.MORGUE_SITE_DIR ? path.resolve(process.env.MORGUE_SITE_DIR) : path.join(ROOT, 'site')
const DATA = path.join(SITE, 'data')

let pass = 0
let fail = 0
const ok = (n, d = '') => { pass++; console.log(`  \x1b[32mok\x1b[0m   ${n}${d ? ' — ' + d : ''}`) }
const bad = (n, d = '') => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}${d ? ' — ' + d : ''}`) }
const check = (n, cond, d = '') => (cond ? ok(n, d) : bad(n, d))
const section = (t) => console.log(`\n\x1b[2m${t}\x1b[0m`)

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i
const readJson = (rel) => readFile(path.join(DATA, rel), 'utf8').then(JSON.parse)
const dataSource = {
  async getFacets() { return readJson('facets.json').catch(() => []) },
  async getIndex() { return readJson('index.json').catch(() => null) },
  async getItem(slug) { return SLUG_RE.test(slug) ? readJson(path.join('items', `${slug}.json`)).catch(() => null) : null },
}
const ctx = { dataSource }

const rpc = (method, params, id = 1) => dispatch({ jsonrpc: '2.0', id, method, params }, ctx)
const callTool = async (name, args) => {
  const res = await rpc('tools/call', { name, arguments: args })
  return res.result
}

async function main() {
  const facets = await dataSource.getFacets()
  const built = facets.length > 0
  if (!built) {
    console.log('\n\x1b[33mnote\x1b[0m site/data is empty — run `pnpm build`. Running protocol-shape checks only.\n')
  }

  // ── 1. Protocol handshake ────────────────────────────────────────────────
  section('1 · protocol')
  {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    check('initialize returns a result', Boolean(init?.result))
    check('serverInfo names morgue', init?.result?.serverInfo?.name === 'morgue', String(init?.result?.serverInfo?.name))
    check('advertises tools capability', Boolean(init?.result?.capabilities?.tools))
    check('echoes a known protocol version', init?.result?.protocolVersion === '2025-06-18', String(init?.result?.protocolVersion))

    const initOld = await rpc('initialize', { protocolVersion: 'nonsense-9999', capabilities: {} })
    check('an unknown protocol version falls back to a supported one', typeof initOld?.result?.protocolVersion === 'string' && initOld.result.protocolVersion !== 'nonsense-9999')

    const ping = await rpc('ping', {})
    check('ping answers {}', ping?.result && Object.keys(ping.result).length === 0)

    const list = await rpc('tools/list', {})
    const names = (list?.result?.tools ?? []).map((t) => t.name).sort()
    check('tools/list has the three tools', JSON.stringify(names) === JSON.stringify(['get_component', 'list_facets', 'search_components']), names.join(', '))
    check('every tool has an inputSchema', (list?.result?.tools ?? []).every((t) => t.inputSchema?.type === 'object'))

    const unknown = await rpc('nope/method', {})
    check('an unknown method is -32601', unknown?.error?.code === -32601, String(unknown?.error?.code))

    // A notification (no id) gets no response — even one whose method is a
    // known request method like ping.
    const note = await handleRaw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), ctx)
    check('a notification produces no response', note.body === null)
    const pingNote = await handleRaw(JSON.stringify({ jsonrpc: '2.0', method: 'ping' }), ctx)
    check('a ping sent AS a notification is silent', pingNote.body === null)

    // A request carrying id:null is a request, not a notification — an unknown
    // method must answer -32601, not be dropped.
    const nullId = await dispatch({ jsonrpc: '2.0', id: null, method: 'nope' }, ctx)
    check('a request with id:null and unknown method is -32601', nullId?.error?.code === -32601)

    // An empty batch is a single Invalid Request, not silence.
    const emptyBatch = await handleRaw('[]', ctx)
    check('an empty batch is a single -32600', emptyBatch.body?.error?.code === -32600 && emptyBatch.body?.id === null)

    // A prototype property name must not slip past the unknown-tool guard.
    const proto = await rpc('tools/call', { name: 'constructor', arguments: {} })
    check('tools/call "constructor" is a clean unknown-tool error', proto?.error?.code === -32602, String(proto?.error?.code))

    // A parse error keeps a null id, per JSON-RPC.
    const garbled = await handleRaw('{not json', ctx)
    check('a parse error is -32700 with null id', garbled.body?.error?.code === -32700 && garbled.body?.id === null)
  }

  // ── 2. list_facets ───────────────────────────────────────────────────────
  section('2 · list_facets')
  {
    const res = await callTool('list_facets', {})
    const data = res?.structuredContent
    check('returns structuredContent', Boolean(data))
    check('has the filter keys', JSON.stringify(data?.filterKeys) === JSON.stringify(['effect', 'technique', 'trigger', 'surface', 'weight', 'kind', 'license']))
    check('facets vocabulary is present', data?.facets && typeof data.facets === 'object' && Array.isArray(data.facets.effect))
    check('text content mirrors the JSON', res?.content?.[0]?.type === 'text' && res.content[0].text.includes('filterKeys'))
  }

  if (!built) { done(); return }

  // Pick real fixtures out of the corpus so nothing is hardcoded.
  const anySlug = facets[0].slug
  const byKind = (k) => facets.find((f) => f.kind === k)
  const staticItem = byKind('static') ?? facets[0]

  // ── 3. search_components ─────────────────────────────────────────────────
  section('3 · search_components')
  {
    // Free text: search for a word from a real title.
    const word = String(staticItem.title).split(/\s+/).find((w) => w.length > 3) ?? staticItem.title
    const res = await callTool('search_components', { query: word })
    const data = res?.structuredContent
    check('a title word finds at least one component', (data?.results?.length ?? 0) >= 1, `${data?.returned} for "${word}"`)
    const r0 = data?.results?.[0]
    check('a result carries slug + title + classification', Boolean(r0?.slug && r0?.title && r0?.classification))
    check('classification carries the licence', r0?.classification && 'license' in r0.classification)

    // Facet filter: kind is AND-ed, so every hit must be that kind.
    const kind = staticItem.kind
    const filtered = (await callTool('search_components', { filters: { kind: [kind] }, limit: 50 }))?.structuredContent
    const allKind = (filtered?.results ?? []).every((r) => r.classification.kind === kind)
    check(`filtering kind=${kind} returns only that kind`, filtered?.results?.length >= 1 && allKind, `${filtered?.returned} hits`)

    // Two categories AND together, never widen. Compare against each alone.
    const trig = staticItem.trigger
    const bothCats = (await callTool('search_components', { filters: { kind: [kind], trigger: [trig] }, limit: 50 }))?.structuredContent
    const kindOnly = (await callTool('search_components', { filters: { kind: [kind] }, limit: 50 }))?.structuredContent
    check('AND across categories never widens the result', (bothCats?.total ?? 0) <= (kindOnly?.total ?? 0))
    check('every AND hit satisfies both categories', (bothCats?.results ?? []).every((r) => r.classification.kind === kind && r.classification.trigger === trig))

    // Licence filter (facets.json now carries licence).
    const someLicense = facets.find((f) => f.license)?.license
    if (someLicense) {
      const lic = (await callTool('search_components', { filters: { license: [someLicense] }, limit: 50 }))?.structuredContent
      check(`filtering license=${someLicense} returns only that licence`, lic?.results?.length >= 1 && lic.results.every((r) => r.classification.license === someLicense), `${lic?.returned} hits`)
    } else {
      check('licence is present on facet rows (needs a rebuild)', false, 'facets.json has no license field — run `pnpm build`')
    }

    // limit is honoured.
    const limited = (await callTool('search_components', { limit: 3 }))?.structuredContent
    check('limit caps the result count', (limited?.results?.length ?? 0) <= 3, `${limited?.returned}`)
  }

  // ── 4. get_component ─────────────────────────────────────────────────────
  section('4 · get_component')
  {
    const res = await callTool('get_component', { slug: anySlug })
    const text = res?.content?.[0]?.text ?? ''
    check('returns a markdown bundle', text.startsWith('# '), `${text.length} chars`)
    check('the bundle states provenance', text.includes('## Provenance'))
    check('the bundle states the licence', /Licence/i.test(text))
    check('get_component is not flagged as an error', res?.isError !== true)

    const missing = await callTool('get_component', { slug: 'definitely-not-a-real-slug-xyz' })
    check('an unknown slug is a tool error, not a crash', missing?.isError === true)

    const bogus = await callTool('get_component', { slug: '../etc/passwd' })
    check('a path-traversal slug is rejected', bogus?.isError === true)
  }

  await stdioRoundTrip()
  done()
}

// ── 5. stdio transport round trip ──────────────────────────────────────────
async function stdioRoundTrip() {
  section('5 · stdio transport')
  const child = spawn('node', [path.join(ROOT, 'bin', 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, MORGUE_SITE_DIR: SITE },
  })

  const responses = []
  let buf = ''
  const gotTwo = new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) { try { responses.push(JSON.parse(line)) } catch { /* ignore */ } }
        if (responses.length >= 2) resolve()
      }
    })
  })

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_facets', arguments: {} } }) + '\n')

  const timeout = new Promise((resolve) => setTimeout(resolve, 8000))
  await Promise.race([gotTwo, timeout])
  child.stdin.end()
  child.kill()

  check('stdio returns exactly the two request responses (notification is silent)', responses.length === 2, `${responses.length} lines`)
  check('stdio initialize response is well formed', responses.find((r) => r.id === 1)?.result?.serverInfo?.name === 'morgue')
  check('stdio tools/call response is well formed', Boolean(responses.find((r) => r.id === 2)?.result?.content))
}

function done() {
  console.log(`\n${pass}/${pass + fail} passed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
