import { count, eq } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { shareLinks } from "@/db/schema";
import type { User } from "@/db/schema";

/**
 * What an account is allowed to hold.
 *
 * The billing decision is in docs/DECISIONS.md § "Free with hard caps, and the
 * waitlist stays": nobody pays, everybody is capped, and the waitlist keeps
 * deciding who gets an account at all. The two bound different things — the
 * waitlist bounds WHO, the cap bounds HOW MUCH — and an invited user is not
 * thereby a careful one, because R2 is billed by what is stored and served.
 *
 * The upgrade path is a person: `/upgrade` records a request and emails the
 * owner, who raises `users.plan`. There is no payment page and no webhook.
 *
 * ── The numbers are constants, the tier is a column ────────────────────────
 *
 * CAPS lives in code because it is policy, and a deployment should not be able
 * to widen policy by setting a variable — the same argument rule 9 makes about
 * not keeping an env allowlist beside the users table. `users.plan` is a column
 * because "this particular person may hold more" is per-person state.
 *
 * ── What is actually measurable, and what this file refuses to invent ──────
 *
 * Two of the three caps cannot be measured yet, and this module returns null
 * for them rather than 0.
 *
 * There is no tenancy. No `ownerId` exists anywhere in the schema, there is no
 * per-user item storage, and `lib/r2.ts` exports no list or size call — it can
 * sign a URL and read an object, and that is all. The vault is still one global
 * static index built from the owner's filesystem. Attributing a stored byte to
 * a person needs the tenancy boundary, which is phase 3 of docs/MULTI-TENANT.md
 * and is not built.
 *
 * The distinction matters at the pixel. `0 of 25 items` is a specific,
 * confident, wrong claim, and someone will believe it and plan against it.
 * `not measured yet` is true. So "unknown" is modelled in the TYPE — `number |
 * null` — rather than left to each call site to remember, because the call site
 * that forgets is the one rendering the fabricated number.
 *
 * ── When enforcement lands, it fails CLOSED ────────────────────────────────
 *
 * Nothing here enforces anything today; there is no per-user write path to
 * enforce against. When there is, a cap check that cannot reach the database
 * must REFUSE. Do not copy the shape of lib/auth-limit.ts, which deliberately
 * fails open — that is argued from "the thing behind this check is still a
 * password", and there is nothing behind a quota check but the bill.
 */

export type PlanId = "free" | "extended";

export interface Caps {
  /** Items an account may hold. */
  items: number;
  /** Bytes stored across media and source. */
  storageBytes: number;
  /** Live share links an account may have outstanding. */
  shareLinks: number;
}

const GB = 1024 * 1024 * 1024;

export const CAPS: Record<PlanId, Caps> = {
  // Deliberately tight. The reasoning recorded with the decision: a cap most
  // people meet is a cap that tells you who is actually using this and what
  // for, before anyone has cost you anything. The price is answering mail,
  // which is a price paid in attention rather than in money and is reversible
  // — widening a number here is a one-line change, un-widening it is not.
  free: { items: 25, storageBytes: 1 * GB, shareLinks: 10 },
  // What an upgrade grants. Not a paid tier; a bigger free one.
  extended: { items: 250, storageBytes: 10 * GB, shareLinks: 100 },
};

export function planOf(user: Pick<User, "plan">): PlanId {
  return user.plan === "extended" ? "extended" : "free";
}

/**
 * The caps this user is held to, or null when they are held to none.
 *
 * Admins are exempt outright. That is a deliberate choice and it has a cost
 * worth stating: the enforcement path is then never exercised by the person
 * most able to notice it misbehaving, so the first report of a broken cap
 * arrives from a user. MULTI-TENANT §4.3 argues the other way — no
 * special-cased namespace for the owner — and it is right about STORAGE KEYS,
 * where a global namespace is how the paid collection leaks. This is not a
 * storage key; it is a number, and the owner's own collection predates the
 * concept of a plan.
 */
export function capsFor(user: Pick<User, "plan" | "role">): Caps | null {
  if (user.role === "admin") return null;
  return CAPS[planOf(user)];
}

export interface Usage {
  /** null means "cannot be measured yet" — never 0. See the header. */
  items: number | null;
  /** null means "cannot be measured yet" — never 0. See the header. */
  storageBytes: number | null;
  shareLinks: number;
}

/**
 * What this user is currently holding.
 *
 * Only `shareLinks` is real: `share_links.createdBy` holds the user id, so it
 * is the one thing already attributable to a person. The other two are null
 * until phase 3, and the null is the point.
 */
export async function usageFor(userId: string): Promise<Usage> {
  const unknown: Usage = { items: null, storageBytes: null, shareLinks: 0 };
  if (!dbConfigured()) return unknown;

  try {
    const rows = await db()
      .select({ n: count() })
      .from(shareLinks)
      .where(eq(shareLinks.createdBy, userId));
    return { ...unknown, shareLinks: rows[0]?.n ?? 0 };
  } catch (err) {
    // A display, not a gate. Failing to count links must not blank the page
    // the user came to read; the count renders as 0 with the cap beside it.
    // This is the one place the fail-open reasoning DOES apply, because
    // nothing is being permitted here.
    console.error("[plan] share link count failed", err);
    return unknown;
  }
}

/** Human-readable bytes for the cap lines on /upgrade. */
export function formatBytes(n: number): string {
  if (n >= GB) return `${Number((n / GB).toFixed(1))} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${Math.round(n / 1024)} KB`;
}
