import { createHash } from "node:crypto";

/**
 * A stable, non-identifying handle for the caller, for rate limiting.
 *
 * Salted so the stored hashes cannot be walked back to raw addresses — the
 * whole IPv4 space is only four billion guesses, so an unsalted sha256 of an
 * IP is a reversible encoding, not a hash. Hashing at all is what keeps a
 * one-line rate limiter from becoming personal data with a retention policy.
 *
 * Returns null when no address is present, and callers must treat that as
 * "cannot rate limit by IP" rather than as a key. Bucketing every
 * unattributable request under one null key would let a single attacker with a
 * stripped header lock out everybody at once.
 */
export function hashClientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT ?? "morgue";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}
