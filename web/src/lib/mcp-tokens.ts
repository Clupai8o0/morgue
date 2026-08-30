import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { mcpTokens, type McpToken, type User } from "@/db/schema";
import { admissionProblem, findUserById, type Refusal } from "@/lib/users";

/**
 * Per-user API tokens for the MCP server (app/api/mcp).
 *
 * A coding agent authenticates to ONE account by carrying one of these as
 * `Authorization: Bearer <token>`. This module mints them, lists and revokes
 * them for the account page, and — the load-bearing function — resolves a raw
 * bearer string back to the live `users` row on every MCP call.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 *
 * A SHA-256 of the emitted value, never the value, exactly as lib/auth-tokens.ts
 * and the `cli_tokens` / `share_links` tables already do: a database dump must
 * not be replayable into vault access. The hash is a bare SHA-256 rather than a
 * slow KDF because the input is 32 bytes of CSPRNG output — there is no
 * dictionary to run against it, and the scrypt argument for a *password* (people
 * pick "hunter2") does not apply to a random token.
 *
 * ── Why a table rather than a signed token ──────────────────────────────────
 *
 * The same split lib/auth-tokens.ts makes against lib/share.ts: a standing key
 * to the whole vault must be REVOCABLE the instant it leaks, and revocation is a
 * fact about the world you cannot sign into a bearer string. So the value is
 * opaque and every call reads the row to see whether it is still good — and,
 * crucially, whether the PERSON behind it is (admissionProblem re-checks
 * suspension live, the same decision auth.ts's jwt recheck makes for a cookie).
 */

/**
 * A recognisable, greppable prefix. A leaked `morgue_mcp_…` string is
 * identifiable on sight in a log or a paste, which is what secret-scanners key
 * on. The prefix is part of the value and part of what is hashed.
 */
export const MCP_TOKEN_PREFIX = "morgue_mcp_";

/**
 * How many live tokens one account may hold. A cap, not a security boundary —
 * it stops an unbounded list accreting and gives the account page a number to
 * show. Revoked tokens do not count.
 */
export const MAX_TOKENS_PER_USER = 20;

const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** The metadata safe to hand a client — never the hash, never the plaintext. */
export interface McpTokenView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function view(row: McpToken): McpTokenView {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

/** How many live (un-revoked) tokens this account holds. */
export async function countMcpTokens(userId: string): Promise<number> {
  if (!dbConfigured()) return 0;
  const rows = await db()
    .select({ n: count() })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)));
  return rows[0]?.n ?? 0;
}

/** This account's live tokens, newest first. Metadata only. */
export async function listMcpTokens(userId: string): Promise<McpTokenView[]> {
  if (!dbConfigured()) return [];
  const rows = await db()
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .orderBy(desc(mcpTokens.createdAt));
  return rows.map(view);
}

export type MintResult =
  | { ok: true; token: string; view: McpTokenView }
  | { ok: false; reason: "too-many" };

/**
 * Issues a token and returns the plaintext ONCE. The caller must show it and
 * then forget it; only the hash is kept, so it can never be shown again.
 */
export async function mintMcpToken(
  userId: string,
  name: string,
): Promise<MintResult> {
  if ((await countMcpTokens(userId)) >= MAX_TOKENS_PER_USER) {
    return { ok: false, reason: "too-many" };
  }

  const token = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const rows = await db()
    .insert(mcpTokens)
    .values({ userId, name, tokenHash: digest(token) })
    .returning();

  return { ok: true, token, view: view(rows[0]) };
}

/**
 * Revokes one token. Scoped to `userId` so one account can never revoke
 * another's — the same "derive the owner from the session, never the request"
 * rule the /api/account routes follow. Returns false when nothing matched,
 * which includes "belongs to someone else" and "already revoked".
 */
export async function revokeMcpToken(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!dbConfigured()) return false;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db()
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpTokens.id, id),
        eq(mcpTokens.userId, userId),
        isNull(mcpTokens.revokedAt),
      ),
    )
    .returning({ id: mcpTokens.id });
  return rows.length > 0;
}

export type McpAuth =
  | { ok: true; user: User; tokenId: string }
  | { ok: false; reason: "no-token" | "bad-token" | Refusal };

/**
 * Resolves a raw bearer string to the account behind it, or says why not.
 *
 * TWO gates, and both matter. First the token must exist and be un-revoked —
 * that is the credential. Then the PERSON must be admissible right now
 * (admissionProblem): a suspended user's token is refused even though the token
 * itself is perfectly valid, because authentication and authorisation are
 * different questions and suspension answers the second one. This is the bearer
 * equivalent of auth.ts re-reading the users row on its jwt recheck, and it is
 * why revocation of a WHOLE ACCOUNT (suspend) does not require hunting down its
 * tokens.
 *
 * The lookup is by token hash, which is unique, so this reads exactly one row.
 * `lastUsedAt` is touched best-effort and never gates the result.
 */
export async function authenticateMcpToken(raw: string | null): Promise<McpAuth> {
  if (!dbConfigured() || !raw) return { ok: false, reason: "no-token" };
  if (!raw.startsWith(MCP_TOKEN_PREFIX)) return { ok: false, reason: "bad-token" };

  const rows = await db()
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.tokenHash, digest(raw)), isNull(mcpTokens.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, reason: "bad-token" };

  const user = await findUserById(row.userId);
  const problem = admissionProblem(user);
  if (problem) return { ok: false, reason: problem };

  // Stamp last-used, and AWAIT it. Fire-and-forget would be dropped on a
  // serverless runtime (the documented production driver is Neon HTTP on Vercel)
  // that freezes the instance the moment the response flushes, leaving the one
  // token-misuse signal permanently null. It is a display nicety and never a
  // gate, so a failure is swallowed — but it lands deterministically when it can.
  try {
    await db()
      .update(mcpTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpTokens.id, row.id));
  } catch {
    /* best effort — never fail an otherwise-good auth over a display stamp */
  }

  return { ok: true, user: user!, tokenId: row.id };
}

/**
 * Extracts the bearer value from an Authorization header. Case-insensitive
 * scheme. No early-out on the token body is needed for timing: the real
 * comparison is a hashed DB lookup by unique index, not a string `===`.
 */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
