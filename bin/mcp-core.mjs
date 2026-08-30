// The morgue MCP server, minus its transport.
//
// One definition of the three tools — search_components, get_component,
// list_facets — and one hand-rolled JSON-RPC 2.0 dispatcher over the small
// slice of the Model Context Protocol they need (initialize, tools/list,
// tools/call, ping). Two transports feed it: bin/mcp.mjs over stdio, reading
// site/data off disk, and web/src/app/api/mcp/route.ts over HTTP, reading R2
// through lib/vault-data.ts and authenticating a per-user bearer token first.
//
// ── Why hand-rolled and not the MCP SDK ─────────────────────────────────────
//
// The SDK's HTTP transport is built around Node's req/res; a Next 16 App Router
// route speaks Web Request/Response, so bridging it is friction with no payoff.
// The protocol surface these tools need is four methods and one content shape,
// and this repo already hand-rolls the things it wants to keep in step across a
// CLI and the web app (see export-bundle.mjs, imported below). So the tool
// layer lives here, dependency-free, and each transport is a thin wrapper that
// hands this dispatcher a parsed message and a data source.
//
// ── The data source is injected ─────────────────────────────────────────────
//
// Everything here is pure over a `dataSource` of three async methods —
// getFacets(), getIndex(), getItem(slug) — which is exactly lib/vault-data.ts's
// shape. The stdio transport supplies a filesystem-backed one; the HTTP
// transport supplies vault-data itself. buildBundle stays the single source of
// the export format, so a component pulled through the MCP is byte-identical to
// `pnpm export` and the web "Copy for agent" button.

import { buildBundle } from './export-bundle.mjs'

export const SERVER_INFO = { name: 'morgue', title: 'morgue — component vault', version: '1.0.0' }

// Protocol revisions this server understands. On initialize we echo the
// client's if we recognise it, else offer our preferred one. Ordered
// newest-first; PREFERRED is [0].
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const PREFERRED_PROTOCOL = PROTOCOL_VERSIONS[0]

const INSTRUCTIONS =
  'morgue is a private vault of web UI/motion components. search_components finds ' +
  'them by free text and facet filters; get_component returns a paste-ready markdown ' +
  'bundle (provenance, licence, dependencies, notes, source, and what to strip before ' +
  'using it); list_facets returns the controlled vocabulary you may filter on. Always ' +
  'read the licence line in a bundle before shipping a component — some are paid.'

// ─── The filterable facets, and the free-text fields ────────────────────────

/** Facet categories a caller may filter on. AND across these, OR within each. */
export const FILTER_KEYS = ['effect', 'technique', 'trigger', 'surface', 'weight', 'kind', 'license']

/** The display tags of a facet row — mirrors tagsOf() in web/src/lib/types.ts. */
function tagsOf(f) {
  return [...(f.effect ?? []), ...(f.technique ?? []), f.trigger, f.surface].filter(Boolean)
}

/**
 * The lowercased haystack a free-text query matches against. It is the grid's
 * haystack (title + tags + archive) PLUS the slug — an agent reasonably
 * searches by slug and the grid's omission of it is a UI nicety, not a contract.
 */
function haystackOf(f) {
  return `${f.title} ${tagsOf(f).join(' ')} ${f.archive ?? ''} ${f.slug}`.toLowerCase()
}

// ─── search_components ──────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

/** '' | undefined → []; a bare string → [string]; an array → itself (strings only). */
function asList(v) {
  if (v == null) return []
  const arr = Array.isArray(v) ? v : [v]
  return arr.filter((x) => typeof x === 'string' && x.length)
}

function normaliseFilters(filters) {
  const out = {}
  for (const key of FILTER_KEYS) out[key] = asList(filters?.[key]).map((s) => s.toLowerCase())
  return out
}

/** Does this facet row satisfy every active category? (AND across, OR within.) */
function facetMatches(f, filters) {
  for (const key of FILTER_KEYS) {
    const wanted = filters[key]
    if (!wanted.length) continue
    if (key === 'license') continue // resolved lazily — the facet row may lack it
    const have = key === 'effect' || key === 'technique' ? (f[key] ?? []) : [f[key]]
    const haveLower = have.filter(Boolean).map((s) => String(s).toLowerCase())
    if (!wanted.some((w) => haveLower.includes(w))) return false
  }
  return true
}

/**
 * A free-text score, or -1 for "does not match". Every whitespace-separated
 * token in the query must appear somewhere in the haystack (AND of tokens);
 * a token in the TITLE is worth more, so an item named for the thing you asked
 * for outranks one that merely mentions it in a tag. An empty query matches
 * everything at score 0, so pure facet filtering still returns results.
 */
function freeTextScore(f, query) {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const haystack = haystackOf(f)
  const title = String(f.title ?? '').toLowerCase()
  let score = 0
  for (const token of q.split(/\s+/)) {
    if (!haystack.includes(token)) return -1
    score += title.includes(token) ? 3 : 1
  }
  return score
}

function classificationOf(f, license) {
  return {
    effect: f.effect ?? [],
    technique: f.technique ?? [],
    trigger: f.trigger,
    surface: f.surface,
    weight: f.weight,
    kind: f.kind,
    license: license ?? f.license ?? null,
    ...(f.archive ? { archive: f.archive } : {}),
  }
}

/** First non-empty paragraph of the notes, minus a leading markdown heading. */
function notesExcerpt(notes, max = 280) {
  if (!notes) return null
  // Anchored to the START of the string (no /m flag), so only a leading
  // "# Title" line is dropped — NOT a `#e11` hex colour or `#id` selector that
  // happens to open a line deeper in the prose.
  const body = String(notes)
    .replace(/^\s+/, '')
    .replace(/^#[^\n]*\r?\n?/, '')
    .trim()
  if (!body) return null
  const para = body.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim()
  return para.length > max ? para.slice(0, max - 1).trimEnd() + '…' : para
}

export async function searchComponents(dataSource, args = {}) {
  const query = typeof args.query === 'string' ? args.query : ''
  const filters = normaliseFilters(args.filters)
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(args.limit) || DEFAULT_LIMIT))
  const wantLicense = filters.license.length > 0

  const facets = await dataSource.getFacets()

  // Rank using facet data alone — no record reads on the hot path. Licence is
  // read off the facet row (which now carries it); the ONLY case that needs a
  // record here is a licence-filtered search against an older R2 payload whose
  // rows predate licence-in-facets, and that read happens inline and rarely.
  const ranked = []
  for (const f of facets) {
    if (!facetMatches(f, filters)) continue
    const score = freeTextScore(f, query)
    if (score < 0) continue

    let license = f.license ?? null
    if (wantLicense) {
      if (license == null) {
        const rec = await dataSource.getItem(f.slug).catch(() => null)
        license = rec?.license ?? null
      }
      if (!filters.license.includes(String(license ?? '').toLowerCase())) continue
    }
    ranked.push({ f, score, license })
  }
  ranked.sort((a, b) => b.score - a.score || String(a.f.title).localeCompare(String(b.f.title)))

  // Read records only for the slice we are returning, and IN PARALLEL — for the
  // notes excerpt, and to fill licence when the facet row lacked one. This is
  // the one place record IO happens on a normal search, bounded by `limit`.
  const top = ranked.slice(0, limit)
  const records = await Promise.all(top.map(({ f }) => dataSource.getItem(f.slug).catch(() => null)))

  const results = top.map(({ f, license }, i) => {
    const record = records[i]
    const lic = license ?? f.license ?? record?.license ?? null
    return {
      slug: f.slug,
      title: f.title,
      classification: classificationOf(f, lic),
      notes: notesExcerpt(record?.notes),
    }
  })

  return { total: ranked.length, returned: results.length, results }
}

// ─── get_component ──────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i

export async function getComponent(dataSource, args = {}) {
  const slug = typeof args.slug === 'string' ? args.slug.trim() : ''
  if (!SLUG_RE.test(slug)) {
    const err = new Error(`"${slug || '(empty)'}" is not a valid slug.`)
    err.toolError = true
    throw err
  }
  const item = await dataSource.getItem(slug)
  if (!item) {
    const err = new Error(
      `No component "${slug}" in the vault. Use search_components to find the right slug.`,
    )
    err.toolError = true
    throw err
  }
  return buildBundle(item)
}

// ─── list_facets ────────────────────────────────────────────────────────────

/**
 * The controlled vocabulary a caller may filter on. Read from index.json's
 * vocab when present — that reflects what is actually in this corpus — and
 * derived from the facet rows otherwise (an older payload has no licence
 * vocab). weight and license are always folded in because they are filterable
 * whether or not the index happens to list them.
 */
export async function listFacets(dataSource) {
  const index = await dataSource.getIndex().catch(() => null)
  const facets = await dataSource.getFacets().catch(() => [])

  const derive = (pick) =>
    [...new Set(facets.flatMap((f) => [].concat(pick(f) ?? [])))].filter(Boolean).sort()

  const vocab = index?.vocab ?? {}
  const facetsOut = {
    effect: vocab.effect ?? derive((f) => f.effect),
    technique: vocab.technique ?? derive((f) => f.technique),
    trigger: vocab.trigger ?? derive((f) => f.trigger),
    surface: vocab.surface ?? derive((f) => f.surface),
    weight: vocab.weight ?? derive((f) => f.weight),
    kind: vocab.kind ?? derive((f) => f.kind),
    license: vocab.license ?? derive((f) => f.license),
  }

  return {
    count: index?.count ?? facets.length,
    filterKeys: FILTER_KEYS,
    facets: facetsOut,
    note:
      'Pass any of these under `filters` to search_components — e.g. ' +
      '{ "effect": ["marquee"], "technique": ["gsap-scrolltrigger"] }. Values within ' +
      'one category are OR-ed; categories are AND-ed.',
  }
}

// ─── Tool registry ──────────────────────────────────────────────────────────

const arrayOrString = (description) => ({
  description,
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
})

export const TOOLS = [
  {
    name: 'search_components',
    title: 'Search components',
    description:
      'Search the morgue vault by free text and/or facet filters. Free text matches the ' +
      "component's title, tags, slug and archive. Returns slug, title, classification and a " +
      'notes excerpt for each hit — pass a slug to get_component for the full bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query. Optional; omit to browse by filters alone.' },
        filters: {
          type: 'object',
          description: 'Facet filters. Values within a category are OR-ed; categories are AND-ed. See list_facets for the vocabulary.',
          properties: {
            effect: arrayOrString('e.g. marquee, pinned-horizontal, image-trail, magnetic'),
            technique: arrayOrString('e.g. gsap-scrolltrigger, css-only, webgl-shader, threejs'),
            trigger: arrayOrString('load | hover | click | scroll | drag | idle'),
            surface: arrayOrString('button | card | nav | hero | cursor | list | image | text | page'),
            weight: arrayOrString('light | medium | heavy'),
            kind: arrayOrString('reference | static | project | unextracted'),
            license: arrayOrString('own | mit | paid | unknown'),
          },
        },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Max results (default ${DEFAULT_LIMIT}).` },
      },
    },
  },
  {
    name: 'get_component',
    title: 'Get component bundle',
    description:
      'Return one component as a paste-ready markdown bundle: provenance, licence, ' +
      'dependencies, notes, inlined source, and what to strip (demo scaffolding, vendor ' +
      'paths, the capture readiness signal). This is the exact bundle `pnpm export` produces.',
    inputSchema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'The component slug, e.g. from search_components.' } },
      required: ['slug'],
    },
  },
  {
    name: 'list_facets',
    title: 'List facet vocabulary',
    description:
      'Return the controlled vocabulary you may filter search_components on: the effects, ' +
      'techniques, triggers, surfaces, weights, kinds and licences actually present in the vault.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const TOOL_HANDLERS = {
  search_components: (ds, args) => searchComponents(ds, args),
  get_component: (ds, args) => getComponent(ds, args),
  list_facets: (ds) => listFacets(ds),
}

/** A tools/call result: text content plus, for the JSON tools, structuredContent. */
function toolResult(name, value) {
  if (name === 'get_component') {
    return { content: [{ type: 'text', text: String(value) }] }
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

// ─── JSON-RPC dispatch ──────────────────────────────────────────────────────

const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
})
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })

// Standard JSON-RPC / MCP error codes.
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

/**
 * Handle ONE parsed JSON-RPC message. Returns a response object, or null when
 * there is nothing to send (a notification — a message with no `id`). Never
 * throws: a handler failure becomes either a JSON-RPC error (protocol faults)
 * or a tools/call result with isError:true (tool faults), which is how MCP
 * wants a tool's own failure surfaced to the model rather than to the transport.
 *
 * `ctx` is `{ dataSource }`.
 */
export async function dispatch(message, ctx) {
  if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0') {
    return rpcError(message?.id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 message.')
  }

  // A Notification is a Request with NO `id` member — the presence of the key,
  // not its value (JSON-RPC 2.0 §4.1). The server MUST NOT reply to one, whatever
  // its method — so this is decided up front rather than per-case, and a request
  // carrying `id: null` (present, discouraged) is correctly a request, not a
  // notification. We have no notification side effects to run.
  if (!('id' in message)) return null

  const { id, method, params } = message

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion
        const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PREFERRED_PROTOCOL
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        })
      }

      case 'ping':
        return rpcResult(id, {})

      case 'tools/list':
        return rpcResult(id, { tools: TOOLS })

      case 'tools/call': {
        const name = params?.name
        // Object.hasOwn, not `TOOL_HANDLERS[name]` truthiness: a plain object
        // inherits Object.prototype, so names like "constructor" or "toString"
        // would otherwise resolve to inherited functions and slip past this
        // guard into a bogus call instead of a clean "unknown tool".
        const handler = Object.hasOwn(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name] : null
        if (!handler) {
          return rpcError(id, INVALID_PARAMS, `Unknown tool: ${name}`)
        }
        try {
          const value = await handler(ctx.dataSource, params?.arguments ?? {})
          return rpcResult(id, toolResult(name, value))
        } catch (err) {
          // A tool's own failure is DATA for the model, not a transport error:
          // return it as an isError result so the agent can read and recover.
          return rpcResult(id, {
            content: [{ type: 'text', text: String(err?.message ?? err) }],
            isError: true,
          })
        }
      }

      default:
        // Notifications already returned above, so anything here is a request
        // with an unknown method.
        return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${method}`)
    }
  } catch (err) {
    return rpcError(id, INTERNAL_ERROR, String(err?.message ?? err))
  }
}

/**
 * Parse a raw JSON string and dispatch it. Returns { status, body } where body
 * is the response object or null. A parse failure is a JSON-RPC parse error
 * with a null id, as the spec requires. Batches (a JSON array) are handled
 * element-wise, though the 2025-06-18 spec no longer requires supporting them.
 */
export async function handleRaw(raw, ctx) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return { body: rpcError(null, PARSE_ERROR, 'Parse error') }
  }
  if (Array.isArray(message)) {
    // An empty array is not a valid batch — JSON-RPC 2.0 §6 wants a single
    // Invalid Request, not silence.
    if (message.length === 0) return { body: rpcError(null, INVALID_REQUEST, 'Invalid Request') }
    const out = []
    for (const m of message) {
      const res = await dispatch(m, ctx)
      if (res) out.push(res)
    }
    // A batch of only notifications produces no responses — send nothing.
    return { body: out.length ? out : null }
  }
  return { body: await dispatch(message, ctx) }
}
