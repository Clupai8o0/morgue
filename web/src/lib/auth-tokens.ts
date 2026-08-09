import { createHash, randomBytes } from "node:crypto";
import { and, eq, like, lt } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { verificationTokens } from "@/db/schema";
import { normaliseEmail } from "@/lib/users";

/**
 * Single-use, expiring tokens for the two flows that prove control of a
 * mailbox: verifying a new address, and resetting a password.
 *
 * ── Why not lib/share.ts's signed tokens ────────────────────────────────────
 *
 * Share links are stateless by design — a signature and an expiry, no database
 * — and that is right for a link whose worst case is someone reading a page
 * they were shown anyway. It is wrong here. A password reset link must be
 * SINGLE USE, and single use is a fact about the world, not a fact you can
 * sign into a token. A signed reset link works as many times as it is clicked
 * until it expires, so an old one sitting in a mailbox is a standing key to
 * the account. Redemption here is a DELETE, and that is the whole mechanism.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 *
 * A SHA-256 of the emailed value, never the value. The reasoning is the same
 * as cli_tokens and share_links: a database dump must not be replayable. The
 * hash is a bare SHA-256 rather than a slow KDF because the input is 32 bytes
 * of CSPRNG output — there is no dictionary to run against it, and the
 * argument for scrypt on a *password* (people pick "hunter2") does not apply.
 *
 * ── Why the purpose is a prefix on `identifier` ─────────────────────────────
 *
 * `verify:<email>` and `reset:<email>`. Auth.js owns this table for its Email
 * provider and uses a bare address as the identifier, so a prefix leaves that
 * untouched. It also makes it structurally impossible to redeem a verification
 * token as a reset token: the redemption names the purpose it wants and the
 * lookup includes it.
 *
 * ── The third purpose carries two values ────────────────────────────────────
 *
 * `emailchange:<userId>:<newEmail>`.
 *
 * A token minted against an address alone cannot say WHICH ACCOUNT asked for
 * it, because `consumeAuthToken` returns everything after the prefix and that
 * is all there is. For verification and reset that is fine — the address IS the
 * account. For an email change it is not: the address in the token is one the
 * account does not have yet, so without the user id there is nothing to move.
 *
 * Both halves are split on the FIRST colon. A uuid contains none and an email
 * address cannot contain an unquoted one, so the split is unambiguous.
 *
 * Putting the id in the identifier also scopes `mintAuthToken`'s
 * same-identifier delete per user: two people asking for the same address do
 * not invalidate each other's link, and the second one to complete loses to the
 * unique index instead.
 */

export type TokenPurpose = "verify" | "reset" | "emailchange";

export const VERIFY_TTL_SECONDS = 24 * 60 * 60;
/** Short on purpose: a reset link is a live key to the account. */
export const RESET_TTL_SECONDS = 60 * 60;
/** Same reasoning as reset — it moves where the account can be reached. */
export const EMAIL_CHANGE_TTL_SECONDS = 60 * 60;

const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");

/**
 * Issues a token and returns the value to email. Any outstanding token of the
 * same purpose for the same address is invalidated first, so a second "forgot
 * password" click does not leave the first link live — otherwise every request
 * widens the window instead of restarting it.
 */
export async function mintAuthToken(
  purpose: TokenPurpose,
  email: string,
  ttlSeconds = purpose === "verify" ? VERIFY_TTL_SECONDS : RESET_TTL_SECONDS,
): Promise<string> {
  const identifier = `${purpose}:${normaliseEmail(email)}`;
  const raw = randomBytes(32).toString("base64url");
  const conn = db();

  await conn.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier));
  await conn.insert(verificationTokens).values({
    identifier,
    token: digest(raw),
    expires: new Date(Date.now() + ttlSeconds * 1000),
  });

  return raw;
}

/**
 * Redeems a token, returning the address it was issued to, or null.
 *
 * The DELETE is the redemption: it either removes exactly one row — in which
 * case this caller holds the only claim on it — or removes none, in which case
 * the token was already spent, never existed, or was for another purpose.
 * Doing it as one statement rather than select-then-delete is what makes two
 * simultaneous clicks resolve to one winner without a transaction, which the
 * Neon HTTP driver could not give us anyway.
 *
 * Expiry is checked AFTER the delete, on the returned row, so an expired
 * token is also consumed rather than left to be retried.
 */
export async function consumeAuthToken(
  purpose: TokenPurpose,
  raw: string,
): Promise<string | null> {
  if (!dbConfigured() || !raw) return null;

  const rows = await db()
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.token, digest(raw)),
        like(verificationTokens.identifier, `${purpose}:%`),
      ),
    )
    .returning({
      identifier: verificationTokens.identifier,
      expires: verificationTokens.expires,
    });

  const row = rows[0];
  if (!row) return null;
  if (row.expires.getTime() <= Date.now()) return null;

  return row.identifier.slice(purpose.length + 1);
}

/** Opportunistic housekeeping. Expired rows are unusable, just not gone. */
export async function pruneExpiredTokens(): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await db().delete(verificationTokens).where(lt(verificationTokens.expires, new Date()));
  } catch {
    /* housekeeping only */
  }
}
