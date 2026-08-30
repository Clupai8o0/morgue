import { getFacets, getIndex, getItem } from "@/lib/vault-data";
import { authenticateMcpToken, bearerFrom, type McpAuth } from "@/lib/mcp-tokens";
// The shared dispatcher and tool layer. It lives in bin/ because the stdio CLI
// (bin/mcp.mjs) shares it and cannot import TypeScript — the same arrangement
// buildBundle uses. See mcp-core.d.ts for the types.
import { handleRaw } from "../../../../../bin/mcp-core.mjs";

/**
 * The hosted MCP transport.
 *
 * A coding agent authenticated as a signed-up user calls this endpoint to
 * search the vault and pull components as paste-ready bundles. It speaks the
 * Streamable-HTTP flavour of MCP in its simplest form: the client POSTs a
 * JSON-RPC message and gets a single JSON response (no SSE — we never push
 * server-initiated messages, so a GET stream would carry nothing).
 *
 * ── Auth is a bearer token, not a session ───────────────────────────────────
 *
 * This route is NOT in proxy.ts's PROTECTED list, because the session gate
 * redirects to /signin — useless to an agent with no browser. Instead it
 * enforces its own credential: `Authorization: Bearer <token>`, minted in
 * /account and verified here against the users row on EVERY call
 * (authenticateMcpToken re-checks suspension, exactly as auth.ts re-checks a
 * cookie). A missing or bad token, or a suspended account, is 401.
 *
 * In local mode this route does not exist — proxy.ts 404s it (lib/local.ts),
 * because there are no accounts to authenticate; `pnpm mcp` serves the same
 * tools over stdio there.
 */

export const dynamic = "force-dynamic";
// node:crypto and the pg driver both need Node — never the edge runtime.
export const runtime = "nodejs";

// The HTTP transport reads the vault through lib/vault-data (local disk in
// development, R2 in production). Its three functions ARE the shape the core's
// data source wants, so this is a straight pass-through.
const dataSource = { getFacets, getIndex, getItem };

/** 401 with the header the MCP auth spec expects, and a JSON-RPC error body. */
function unauthorised(reason: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: reason },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="morgue"',
      },
    },
  );
}

function reasonText(auth: Extract<McpAuth, { ok: false }>): string {
  switch (auth.reason) {
    case "no-token":
      return "Missing bearer token. Create one at /account and send it as `Authorization: Bearer <token>`.";
    case "suspended":
      return "This account is suspended.";
    case "no-account":
      return "This account no longer exists.";
    default:
      // bad-token, and the auth-specific refusals that cannot arise for a token
      // (unverified-email, no-password) collapse to the same opaque answer — a
      // caller must not be able to tell a wrong token from a real one.
      return "Invalid or revoked token.";
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateMcpToken(bearerFrom(req.headers.get("authorization")));
  if (!auth.ok) return unauthorised(reasonText(auth));

  const raw = await req.text();
  if (!raw.trim()) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Empty request body." } },
      { status: 400 },
    );
  }

  const { body } = await handleRaw(raw, { dataSource });

  // A notification (or a batch of only notifications) has no response — the
  // spec wants 202 Accepted with no body.
  if (body == null) return new Response(null, { status: 202 });

  return Response.json(body);
}

/**
 * We do not open a server→client SSE stream (there is nothing to push), so the
 * optional GET side of Streamable HTTP is Method Not Allowed rather than a
 * dangling connection.
 */
export function GET(): Response {
  return new Response("Method Not Allowed — POST JSON-RPC to this endpoint.", {
    status: 405,
    headers: { allow: "POST" },
  });
}
