import { z } from "zod";
import { auth } from "@/auth";
import { dbConfigured } from "@/db";
import { findUserById } from "@/lib/users";
import {
  MAX_TOKENS_PER_USER,
  listMcpTokens,
  mintMcpToken,
  revokeMcpToken,
} from "@/lib/mcp-tokens";

/**
 * The signed-in user's own MCP tokens. Never anybody else's.
 *
 * Like every /api/account route, the user id comes from the SESSION and never
 * from the request — see the note at the top of api/account/me/route.ts. A
 * token minted here is the credential the MCP server (api/mcp) verifies; this
 * route only creates, lists and revokes them.
 *
 * proxy.ts protects this path (PROTECTED) and refuses it to any share cookie
 * (ownerOnly) — a read-only visitor must never be able to mint a key to the
 * whole vault. bin/verify-share.mjs asserts that refusal.
 */

async function me() {
  if (!dbConfigured()) return null;
  const session = await auth();
  const id = session?.user?.id;
  return id ? await findUserById(id) : null;
}

const unauthorised = () =>
  Response.json({ error: "Not authorised" }, { status: 401 });

export async function GET() {
  const user = await me();
  if (!user) return unauthorised();

  return Response.json({
    tokens: await listMcpTokens(user.id),
    max: MAX_TOKENS_PER_USER,
  });
}

const Create = z.object({ name: z.string().trim().min(1).max(80) });

export async function POST(req: Request) {
  const user = await me();
  if (!user) return unauthorised();

  const parsed = await req
    .json()
    .then((raw) => Create.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "Give the token a name." }, { status: 400 });
  }

  const result = await mintMcpToken(user.id, parsed.data.name);
  if (!result.ok) {
    return Response.json(
      {
        error: `You already have ${MAX_TOKENS_PER_USER} tokens. Revoke one before creating another.`,
      },
      { status: 409 },
    );
  }

  // The plaintext is returned exactly once. The client must show it and forget
  // it; only the hash is stored, so it can never be shown again.
  return Response.json({ token: result.token, created: result.view });
}

const Revoke = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request) {
  const user = await me();
  if (!user) return unauthorised();

  const parsed = await req
    .json()
    .then((raw) => Revoke.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "Which token?" }, { status: 400 });
  }

  const revoked = await revokeMcpToken(user.id, parsed.data.id);
  if (!revoked) {
    return Response.json({ error: "That token is already gone." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
