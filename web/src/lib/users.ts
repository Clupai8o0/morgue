import { and, eq, sql } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { accounts, users, type User } from "@/db/schema";

/**
 * Identity queries. Everything that answers "who is this and may they be
 * here", in one place, so the answer cannot drift between auth.ts, the API
 * routes and the CLI.
 *
 * Every function here fails CLOSED: with no DATABASE_URL there are no users,
 * and with no users nobody signs in. That is CLAUDE.md rule 9 — a missing
 * variable in production locks the door — moved out of an env allowlist and
 * into the database, which is the whole point of phase 1.
 */

/**
 * The canonical form of an email address, and the ONLY form ever written.
 *
 * Applied in each provider's `profile()` callback rather than at the query
 * layer, because @auth/drizzle-adapter looks a user up by email before any
 * callback of ours runs — by the time we could normalise it, the adapter has
 * already decided there is no such user and moved on to creating a second one.
 *
 * Case folding only. No dot-stripping, no plus-address collapsing: those are
 * Gmail conventions, not email semantics, and treating a+b@ as a@ on a
 * provider that does not agree merges two different people.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<User | null> {
  if (!dbConfigured()) return null;
  const rows = await db()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normaliseEmail(email)}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  if (!dbConfigured()) return null;
  // A malformed id would make Postgres raise on the uuid cast rather than
  // return nothing, which turns "stale cookie" into a 500.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db().select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The users row an OAuth account is already linked to, if any. */
export async function findLinkedUser(
  provider: string,
  providerAccountId: string,
): Promise<User | null> {
  if (!dbConfigured()) return null;
  const rows = await db()
    .select({ user: users })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(
      and(
        eq(accounts.provider, provider),
        eq(accounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

/** Which OAuth providers this account can sign in with, e.g. ["github"]. */
export async function listLinkedProviders(userId: string): Promise<string[]> {
  if (!dbConfigured()) return [];
  const rows = await db()
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  // Distinct in code rather than SQL: the set is one or two rows, and a
  // provider appearing twice would be a bug worth seeing rather than folding
  // away in a query.
  return [...new Set(rows.map((r) => r.provider))].sort();
}

/**
 * Removes one OAuth link. Returns false — changing nothing — when it would
 * leave the account with no way back in.
 *
 * The guard is the whole point. Disconnecting the only provider on an account
 * with no password is a self-inflicted lockout with no recovery path except
 * the CLI, and it is the obvious thing to click when tidying up.
 */
export async function unlinkProvider(
  userId: string,
  provider: string,
): Promise<{ ok: true } | { ok: false; reason: "last-method" | "not-linked" }> {
  const [user, providers] = await Promise.all([
    findUserById(userId),
    listLinkedProviders(userId),
  ]);
  if (!providers.includes(provider)) return { ok: false, reason: "not-linked" };

  const remaining = providers.length - 1 + (user?.passwordHash ? 1 : 0);
  if (remaining < 1) return { ok: false, reason: "last-method" };

  await db()
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)));
  return { ok: true };
}

export type Refusal =
  | "no-account"
  | "suspended"
  | "unverified-email"
  | "no-password";

/**
 * May this user hold a session right now?
 *
 * Deliberately separate from "did they prove who they are". Authentication
 * succeeding and authorisation succeeding are different questions, and a
 * suspended user with the right password must fail the second one.
 */
export function admissionProblem(user: User | null): Refusal | null {
  if (!user) return "no-account";
  if (user.status !== "active") return "suspended";
  return null;
}

/**
 * Invalidates every JWT this user is currently carrying, within
 * SESSION_RECHECK_SECONDS. Called on password change and on suspension.
 */
export async function bumpSessionVersion(userId: string): Promise<number> {
  const rows = await db()
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ v: users.sessionVersion });
  return rows[0]?.v ?? 0;
}

/**
 * Best-effort. A failure here must never break a request that was otherwise
 * fine — "last seen" is a nicety for the admin dashboard, not a control.
 */
export async function touchLastSeen(userId: string): Promise<void> {
  try {
    await db().update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  } catch {
    /* ignore */
  }
}
