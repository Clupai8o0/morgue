import { and, count, eq, gt, lt, or } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { authAttempts } from "@/db/schema";
import { normaliseEmail } from "@/lib/users";

/**
 * Sign-in lockout.
 *
 * ── Why this is in Postgres and not a Map ───────────────────────────────────
 *
 * The obvious implementation is a module-scope Map of counters. It does not
 * work here and it is worth saying why, because it looks like it works in
 * development: serverless instances do not share memory. A Map protects one
 * instance from one attacker, and an attacker making requests fast enough to
 * matter is being served by many instances at once. The counter that has to be
 * shared has to be somewhere shared.
 *
 * ── Why two dimensions ──────────────────────────────────────────────────────
 *
 * Per-email stops credential stuffing against one account. Per-IP stops one
 * host spraying many accounts. A limiter with only the first is defeated by
 * rotating the target address; one with only the second is defeated by a
 * botnet. Neither is redundant.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * There is no account lock that an attacker can trigger on someone else's
 * address and leave stuck. The email window is short and rolling, so a stuffing
 * run slows to uselessness while the real owner is inconvenienced for minutes,
 * not until an admin intervenes. Locking an account out permanently on failed
 * passwords is a denial-of-service handed to anyone who knows an email address.
 */

const WINDOW_MS = 15 * 60 * 1000;
/** Per email address, per window. */
const MAX_PER_EMAIL = 8;
/** Per client IP, per window. Higher: an office shares one address. */
const MAX_PER_IP = 25;
/** Rows older than this are useless; pruned opportunistically on write. */
const RETAIN_MS = 24 * 60 * 60 * 1000;

export interface LimitVerdict {
  /** True when the attempt must be refused before a password is even checked. */
  limited: boolean;
  /** Seconds to advertise in Retry-After. Coarse on purpose. */
  retryAfter: number;
}

const OK: LimitVerdict = { limited: false, retryAfter: 0 };

export async function checkAuthLimit(
  email: string | null,
  ipHash: string | null,
): Promise<LimitVerdict> {
  if (!dbConfigured()) return OK;
  const since = new Date(Date.now() - WINDOW_MS);
  const key = email ? normaliseEmail(email) : null;

  try {
    const conn = db();

    if (key) {
      const [row] = await conn
        .select({ n: count() })
        .from(authAttempts)
        .where(and(eq(authAttempts.email, key), gt(authAttempts.at, since)));
      if (Number(row?.n ?? 0) >= MAX_PER_EMAIL) {
        return { limited: true, retryAfter: WINDOW_MS / 1000 };
      }
    }

    if (ipHash) {
      const [row] = await conn
        .select({ n: count() })
        .from(authAttempts)
        .where(and(eq(authAttempts.ipHash, ipHash), gt(authAttempts.at, since)));
      if (Number(row?.n ?? 0) >= MAX_PER_IP) {
        return { limited: true, retryAfter: WINDOW_MS / 1000 };
      }
    }
  } catch (err) {
    // A limiter that fails OPEN is the right call here and the opposite of
    // rule 9, so it needs a reason: failing closed would mean a database
    // hiccup locks every account in the system out simultaneously. The thing
    // behind this check is still a password.
    console.error("[auth-limit] check failed, allowing", err);
    return OK;
  }

  return OK;
}

/** Record a FAILED attempt. Successes are not recorded — see clearAuthLimit. */
export async function recordAuthFailure(
  email: string | null,
  ipHash: string | null,
): Promise<void> {
  if (!dbConfigured()) return;
  try {
    const conn = db();
    await conn.insert(authAttempts).values({
      email: email ? normaliseEmail(email) : null,
      ipHash,
    });
    // Opportunistic prune. No cron to depend on, and the table is only ever
    // read over a 15-minute window, so anything older is pure storage.
    await conn
      .delete(authAttempts)
      .where(lt(authAttempts.at, new Date(Date.now() - RETAIN_MS)));
  } catch (err) {
    console.error("[auth-limit] record failed", err);
  }
}

/**
 * Called after a SUCCESSFUL sign-in: forgets that address's and that host's
 * recent failures. Without it, someone who mistypes their password seven times
 * and then gets it right is still one attempt away from a lockout they have
 * already disproved.
 */
export async function clearAuthLimit(
  email: string | null,
  ipHash: string | null,
): Promise<void> {
  if (!dbConfigured()) return;
  if (!email && !ipHash) return;
  try {
    const key = email ? normaliseEmail(email) : null;
    const clauses = [
      key ? eq(authAttempts.email, key) : null,
      ipHash ? eq(authAttempts.ipHash, ipHash) : null,
    ].filter(Boolean);
    await db()
      .delete(authAttempts)
      .where(clauses.length === 1 ? clauses[0]! : or(...(clauses as never[])));
  } catch (err) {
    console.error("[auth-limit] clear failed", err);
  }
}
