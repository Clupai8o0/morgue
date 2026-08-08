import { NextResponse } from "next/server";
import {
  SESSION_MAX_SECONDS,
  SHARE_COOKIE,
  verifyShareToken,
} from "@/lib/share";
import { dbConfigured } from "@/db";

/**
 * Redeem a share link.
 *
 * The token travels in the PATH rather than a query string so it does not end
 * up in a `Referer` header when the redeemed page loads a third-party
 * resource, and so it is not silently trimmed by chat clients that treat
 * `?a=b` as tracking. It is swapped immediately for an httpOnly cookie and
 * never appears in a URL again.
 *
 * This route is deliberately NOT in proxy.ts's PROTECTED list — it is the door,
 * and gating the door behind the lock it opens would be a loop.
 *
 * REVOCATION IS CHECKED HERE, and only here. See lib/share.ts: the cookie is
 * capped at an hour, so a revoked link stops working within an hour rather
 * than on the next request, and the alternative was a Postgres round trip in
 * proxy.ts on every page load and every media byte.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = verifyShareToken(decodeURIComponent(token));

  if (!result.ok) return deny(result.reason);

  if (dbConfigured()) {
    try {
      const { db, schema } = await import("@/db");
      const { eq } = await import("drizzle-orm");
      const rows = await db()
        .select({ revokedAt: schema.shareLinks.revokedAt })
        .from(schema.shareLinks)
        .where(eq(schema.shareLinks.jti, result.payload.jti))
        .limit(1);

      // An unknown jti is ALLOWED through. Links minted while the database was
      // unconfigured have no row, and treating "no row" as revoked would break
      // every link issued before Neon landed. The row is an optional revocation
      // record, not the authority on whether the token is valid — the signature
      // is that, and it already passed.
      if (rows[0]?.revokedAt) return deny("revoked");

      await db()
        .update(schema.shareLinks)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.shareLinks.jti, result.payload.jti));
    } catch (err) {
      // A database that is configured but unreachable must not silently become
      // "revocation is off". Fail closed: this is the one check standing
      // between a revoked link and the vault.
      console.error("[share] revocation check failed", err);
      return deny("unavailable");
    }
  }

  const { scope, exp } = result.payload;
  const destination = scope.kind === "vault" ? "/vault" : `/vault/${scope.slug}`;

  const res = NextResponse.redirect(new URL(destination, _req.url), 302);
  res.cookies.set({
    name: SHARE_COOKIE,
    value: decodeURIComponent(token),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Never outlive the token itself, and never exceed the revocation window.
    maxAge: Math.min(
      SESSION_MAX_SECONDS,
      Math.max(60, exp - Math.floor(Date.now() / 1000)),
    ),
  });
  return res;
}

/**
 * One page for every failure, with the reason named. Distinguishing "expired"
 * from "revoked" is safe — the holder already had the link — and it is the
 * difference between "ask for a new one" and "you were cut off on purpose".
 */
function deny(reason: string) {
  const copy: Record<string, string> = {
    expired: "This share link has expired.",
    revoked: "This share link was revoked.",
    "bad-signature": "This share link is not valid.",
    malformed: "This share link is not valid.",
    unconfigured:
      "Sharing is not configured on this deployment (AUTH_SECRET is unset).",
    unavailable: "Share links cannot be checked right now. Try again shortly.",
  };
  const status = reason === "unavailable" ? 503 : reason === "unconfigured" ? 503 : 403;

  return new NextResponse(
    `<!doctype html><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>morgue — link unavailable</title>` +
      `<style>
         :root{color-scheme:dark}
         body{background:#090909;color:#fff;font:15px/1.4 ui-sans-serif,system-ui,sans-serif;
              display:grid;place-items:center;min-height:100dvh;margin:0;padding:24px}
         div{max-width:38ch;text-align:center}
         p{color:#999;margin:.6em 0 0}
       </style>` +
      `<div><strong>${copy[reason] ?? "This share link is not valid."}</strong>` +
      `<p>Ask whoever sent it for a new one.</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
