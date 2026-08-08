import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

/**
 * Read-only share links.
 *
 * ── Why the token is stateless ──────────────────────────────────────────────
 *
 * The obvious build is a `share_links` row per link and a database lookup on
 * every request. It was rejected as the PRIMARY mechanism for two reasons:
 *
 *   1. DATABASE_URL is not set and has never been set. A sharing feature that
 *      cannot issue a single link until Neon is provisioned is a feature that
 *      does not exist. AUTH_SECRET is one `openssl rand -base64 32` and no
 *      vendor, so a signed token works the moment someone spends ten seconds.
 *   2. A lookup per request puts Postgres in the path of every page load and
 *      every media byte, which is exactly what src/db/schema.ts says the vault
 *      deliberately avoids.
 *
 * So expiry is CRYPTOGRAPHIC — baked into the signed payload, unforgeable, and
 * enforced with no I/O. The database, when it exists, adds what signatures
 * cannot: listing what is outstanding, and revoking one link early.
 *
 * ── What that costs, stated plainly ─────────────────────────────────────────
 *
 * A signed token cannot be un-issued. Revocation is therefore checked when a
 * link is REDEEMED, not on every request, and the session cookie it mints is
 * capped at SESSION_MAX_SECONDS. So a revoked link stops working within an
 * hour rather than instantly. The alternative was a database round trip in
 * proxy.ts on every request, and an hour is the honest price of not having
 * one. Rotating AUTH_SECRET invalidates every outstanding link immediately and
 * is the break-glass option.
 *
 * ── Key separation ──────────────────────────────────────────────────────────
 *
 * The signing key is DERIVED from AUTH_SECRET rather than being it. Auth.js
 * uses AUTH_SECRET for session JWTs; a share token and a session token must
 * never be interchangeable, and deriving through a labelled HMAC costs one
 * hash and removes the question entirely.
 */

const DERIVE_LABEL = "morgue.share.v1";
const VERSION = "v1";

/** Ceiling on a share link's lifetime. A year is not a share, it is a leak. */
export const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long the cookie minted at redemption lasts. This is the revocation lag:
 * past it the browser must return to /s/<token>, which re-checks the database.
 */
export const SESSION_MAX_SECONDS = 60 * 60;

export const SHARE_COOKIE = "morgue_share";
/** Set by proxy.ts on an allowed shared request so pages can adapt. */
export const SHARE_HEADER = "x-morgue-share";

export type ShareScope =
  | { kind: "vault" }
  | { kind: "item"; slug: string };

export interface SharePayload {
  scope: ShareScope;
  /** Unix seconds. */
  exp: number;
  /** Unix seconds. */
  iat: number;
  /** Random per-link id — what the database keys revocation on. */
  jti: string;
}

export type VerifyResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; reason: "unconfigured" | "malformed" | "bad-signature" | "expired" };

/** True when share links can be signed at all. */
export function shareConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET);
}

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — share links cannot be signed.");
  return createHmac("sha256", secret).update(DERIVE_LABEL).digest();
}

const b64url = (b: Buffer): string => b.toString("base64url");
const unb64url = (s: string): Buffer => Buffer.from(s, "base64url");

function sign(body: string): string {
  return b64url(createHmac("sha256", key()).update(body).digest());
}

/** sha256 of the whole token — what the database stores, never the token. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintShareToken(
  scope: ShareScope,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): { token: string; payload: SharePayload } {
  const ttl = Math.min(Math.max(Math.floor(ttlSeconds), 60), MAX_TTL_SECONDS);
  const iat = Math.floor(Date.now() / 1000);
  const payload: SharePayload = {
    scope,
    iat,
    exp: iat + ttl,
    jti: b64url(randomBytes(9)),
  };

  // Compact on purpose: the token ends up in a URL someone pastes into a chat.
  const compact = {
    v: 1,
    s: payload.scope.kind === "vault" ? "v" : "i",
    ...(payload.scope.kind === "item" ? { g: payload.scope.slug } : {}),
    e: payload.exp,
    i: payload.iat,
    j: payload.jti,
  };

  const body = b64url(Buffer.from(JSON.stringify(compact)));
  return { token: `${VERSION}.${body}.${sign(body)}`, payload };
}

export function verifyShareToken(token: string): VerifyResult {
  if (!shareConfigured()) return { ok: false, reason: "unconfigured" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }
  const [, body, sig] = parts;

  // Constant time. The comparison length is attacker-controlled through the
  // URL, so lengths are checked before timingSafeEqual, which throws on a
  // mismatch rather than returning false.
  let expected: Buffer;
  try {
    expected = unb64url(sign(body));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  let given: Buffer;
  try {
    given = unb64url(sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  let compact: Record<string, unknown>;
  try {
    compact = JSON.parse(unb64url(body).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const exp = Number(compact.e);
  const iat = Number(compact.i);
  const jti = String(compact.j ?? "");
  if (!Number.isFinite(exp) || !Number.isFinite(iat) || !jti) {
    return { ok: false, reason: "malformed" };
  }

  let scope: ShareScope;
  if (compact.s === "v") {
    scope = { kind: "vault" };
  } else if (compact.s === "i" && typeof compact.g === "string" && isSlug(compact.g)) {
    scope = { kind: "item", slug: compact.g };
  } else {
    return { ok: false, reason: "malformed" };
  }

  // Signature verified BEFORE expiry so a tampered exp cannot be reported as a
  // merely-expired link, which would leak that the rest of the token was
  // otherwise acceptable.
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, reason: "expired" };

  return { ok: true, payload: { scope, exp, iat, jti } };
}

export function isSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,80}$/i.test(s);
}

/**
 * Which paths a scope may reach. An ALLOWLIST, not a denylist — the failure
 * mode of forgetting to deny something is handing a shared viewer a route they
 * should not have, and new routes appear more often than this list is reread.
 *
 * Note what is absent and stays absent: /admin, and /api/share. A shared viewer
 * can read the vault; it can never mint another link or see who else holds one.
 */
export function shareAllows(scope: ShareScope, pathname: string): boolean {
  if (scope.kind === "vault") {
    return (
      pathname === "/vault" ||
      pathname.startsWith("/vault/") ||
      pathname.startsWith("/api/media/")
    );
  }
  const slug = scope.slug;
  return (
    pathname === `/vault/${slug}` ||
    pathname.startsWith(`/api/media/${slug}/`)
  );
}
