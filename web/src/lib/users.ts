import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import {
  accounts,
  authAttempts,
  shareLinks,
  users,
  verificationTokens,
  waitlist,
  type User,
} from "@/db/schema";

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

/** How many other active admins exist. Guards the last one against deletion. */
export async function countOtherActiveAdmins(exceptUserId: string): Promise<number> {
  if (!dbConfigured()) return 0;
  const rows = await db()
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.status, "active"),
        ne(users.id, exceptUserId),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** A display name is not an authentication factor, so no session bump. */
export async function setDisplayName(userId: string, name: string | null): Promise<void> {
  if (!dbConfigured()) return;
  await db().update(users).set({ name }).where(eq(users.id, userId));
}

/**
 * Moves an account to an address whose mailbox has just been proven.
 *
 * Called only after redeeming an `emailchange:` token, which is what makes
 * stamping `emailVerified` honest — holding the mailbox IS the verification,
 * the same reasoning the password reset endpoint uses.
 *
 * The old address's outstanding tokens are destroyed. `mintAuthToken` only
 * clears the identifier it is minting, so a live `reset:<old>` would otherwise
 * survive the move and still resolve BY ADDRESS — handing whoever registers
 * the freed address a working reset link into an account that is no longer
 * theirs.
 *
 * Returns false when the address was taken between the check and the write.
 * The unique index on lower(email) is the real guard, not the check: there are
 * no transactions on the neon-http driver, so a check-then-write is a race and
 * only the constraint closes it.
 */
export async function applyEmailChange(
  userId: string,
  oldEmail: string,
  newEmail: string,
): Promise<boolean> {
  const next = normaliseEmail(newEmail);
  const conn = db();

  try {
    await conn
      .update(users)
      .set({ email: next, emailVerified: new Date() })
      .where(eq(users.id, userId));
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }

  await conn
    .delete(verificationTokens)
    .where(
      inArray(verificationTokens.identifier, [
        `verify:${normaliseEmail(oldEmail)}`,
        `reset:${normaliseEmail(oldEmail)}`,
        `verify:${next}`,
        `reset:${next}`,
      ]),
    );

  // The address is an authentication factor — the credentials provider resolves
  // by it. Changing it ends every session, this one included, exactly as a
  // password change does.
  await bumpSessionVersion(userId);
  return true;
}

/** Postgres 23505. Drizzle surfaces the driver error, so check both shapes. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (code === "23505") return true;
  const cause = (err as { cause?: { code?: string } })?.cause;
  return cause?.code === "23505";
}

/**
 * Erases an account, in an order chosen so that a failure part-way leaves a
 * WORKING account rather than a half-deleted one.
 *
 * There are no interactive transactions on the neon-http driver, so this is a
 * sequence of single statements and one of them can be the last one that runs.
 * That constraint decides the order rather than taste:
 *
 *   The users row goes LAST. Delete it first and the email — which steps 3, 4
 *   and 5 all key on — is gone, so every orphan it leaves behind becomes
 *   unfindable forever. Failing at step 3 instead leaves an account that still
 *   signs in and can simply be retried.
 *
 * Only `accounts` and `sessions` cascade (schema.ts). `upgrade_requests`
 * cascades too and needs no statement here — it has a real foreign key, which
 * is the deliberate contrast with `share_links`, whose `createdBy` is bare
 * text.
 *
 * SHARE LINKS ARE REVOKED, NEVER DELETED, and this is the subtle one. A share
 * token is valid because it is SIGNED; the table is an inventory, and
 * app/s/[token] lets an unknown jti through by design. So deleting a departing
 * user's rows does not disable their links — it re-enables every link they
 * ever revoked.
 */
export async function deleteAccount(
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "not-found" | "last-admin" }> {
  if (!dbConfigured()) return { ok: false, reason: "not-found" };

  const user = await findUserById(userId);
  if (!user) return { ok: false, reason: "not-found" };

  // 1. Before touching anything: refuse to strand the deployment. /admin 404s
  //    for non-admins, so the last admin deleting themselves leaves a dashboard
  //    nobody alive can open. Mirrors unlinkProvider's last-method refusal.
  if (user.role === "admin" && (await countOtherActiveAdmins(userId)) === 0) {
    return { ok: false, reason: "last-admin" };
  }

  const email = normaliseEmail(user.email);
  const conn = db();

  // 2. Revoke, do not delete. See the header.
  await conn
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.createdBy, userId), isNull(shareLinks.revokedAt)));

  // 3. A live `reset:<email>` outlives the account and resolves by address, so
  //    if that address is ever registered again it sets the NEXT owner's
  //    password.
  await conn
    .delete(verificationTokens)
    .where(inArray(verificationTokens.identifier, [`verify:${email}`, `reset:${email}`]));

  // 4. Otherwise the raw address sits in the lockout table until somebody else
  //    happens to fail a sign-in and triggers the prune.
  await conn.delete(authAttempts).where(eq(authAttempts.email, email));

  // 5. The waitlist row is theirs too — email, note and a hashed IP. /privacy
  //    promises deletion, and a row holding their address contradicts it. The
  //    cost is that their approval does not survive: coming back means being
  //    approved again.
  await conn.delete(waitlist).where(sql`lower(${waitlist.email}) = ${email}`);

  // 6. Last. Cascades accounts, sessions and upgrade_requests. The live session
  //    dies at the next jwt recheck, because findUserById then returns null.
  await conn.delete(users).where(eq(users.id, userId));

  return { ok: true };
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
