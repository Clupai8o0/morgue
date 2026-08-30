# The morgue MCP server

Retrieve components from the vault straight into a coding agent. The MCP server
exposes three tools — search, fetch-as-bundle, and the filter vocabulary — over
two transports that share one implementation (`bin/mcp-core.mjs`):

| Transport | Who it is for | Auth | Where |
|-----------|---------------|------|-------|
| **HTTP** | A signed-up user's agent, anywhere | per-user bearer token | `POST /api/mcp` on the hosted app |
| **stdio** | The person who owns the machine | none needed | `pnpm mcp`, reads `site/data/` |

Adding components is unchanged — that stays the CLI/skill flow in the root
`CLAUDE.md`. This is the other half: getting them back out.

## The tools

- **`search_components(query?, filters?, limit?)`** — free text (matches title,
  tags, slug, archive) and/or facet filters. Returns `slug`, `title`,
  classification, and a notes excerpt per hit. Filters: `effect`, `technique`,
  `trigger`, `surface`, `weight`, `kind`, `license`. Values within one category
  are OR-ed; categories are AND-ed. (This differs on purpose from the vault
  grid, whose chips widen — an API filter that narrows is more useful.)
- **`get_component(slug)`** — the paste-ready markdown bundle: provenance,
  licence, dependencies, notes, inlined source, and what to strip before using
  it. Byte-identical to `pnpm export <slug>` and the web "Copy for agent" button.
- **`list_facets()`** — the controlled vocabulary actually present in the vault,
  so an agent can discover what it may filter on.

**Always read the licence line in a bundle.** Most of the collection is paid
reference — safe to learn from, not always safe to ship.

## Hosted: get a token, point your agent at it

Access is invite-based: sign up, a maintainer approves the account
(`status = active`), then you can mint tokens. A suspended account's tokens stop
working on the next call.

1. Sign in and open **/account → MCP access**.
2. Name a token (e.g. "cursor on my laptop") and **Create**. It is shown once —
   copy it now. Only a hash is stored, so it can never be shown again.
3. Point your agent at the endpoint with the token as a bearer header.

**Claude Code:**

```bash
claude mcp add --transport http morgue https://YOUR-HOST/api/mcp \
  --header "Authorization: Bearer morgue_mcp_…"
```

**Generic MCP client config** (`.mcp.json` / editor settings):

```jsonc
{
  "mcpServers": {
    "morgue": {
      "type": "http",
      "url": "https://YOUR-HOST/api/mcp",
      "headers": { "Authorization": "Bearer morgue_mcp_…" }
    }
  }
}
```

Revoke a token any time from the same page; it dies immediately. Losing the
whole account (suspension, deletion) takes its tokens with it — no cleanup
needed.

## Local: the single-user machine

If you own the filesystem you don't need a token or the hosted app at all — serve
the built vault over stdio:

```bash
pnpm build      # once, so site/data/ exists
pnpm mcp        # speaks JSON-RPC on stdin/stdout
```

```jsonc
{
  "mcpServers": {
    "morgue": { "command": "pnpm", "args": ["mcp"], "cwd": "/path/to/morgue" }
  }
}
```

In hosted (local-mode) deployments `/api/mcp` returns 404 — there are no
accounts to authenticate, and stdio is the answer for one machine.

## How it fits together

```
                 ┌───────────────────────┐
  stdio  ───────▶│                       │──▶ site/data/  (filesystem)
  (pnpm mcp)     │   bin/mcp-core.mjs    │
                 │  3 tools · JSON-RPC   │
  HTTP   ───────▶│                       │──▶ lib/vault-data (disk / R2)
  (/api/mcp)     └───────────────────────┘
     ▲                    both call buildBundle() — one bundle format
     │
  Authorization: Bearer <token>  →  lib/mcp-tokens.authenticateMcpToken
                                    (token hash + live users-row check)
```

- `bin/mcp-core.mjs` — the tools and a small JSON-RPC dispatcher, dependency-free.
- `bin/mcp.mjs` — the stdio transport.
- `web/src/app/api/mcp/route.ts` — the HTTP transport + bearer auth.
- `web/src/lib/mcp-tokens.ts` + `mcp_tokens` table — mint / list / revoke / verify.
- `web/src/app/api/account/mcp-tokens/route.ts` — the account CRUD.

## Tests

- `pnpm verify:mcp` — the core + stdio transport, no database.
- `pnpm verify:auth` (§ mcp tokens) — bearer auth end-to-end against a real
  Postgres and a production server: active tokens work, suspended/garbage/revoked
  are refused, and revocation is scoped to the owner.
