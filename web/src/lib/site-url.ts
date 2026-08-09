/**
 * The origin to put in a link we email someone.
 *
 * ── Why not just use the request's Host header ──────────────────────────────
 *
 * Because it is attacker-controlled, and the classic exploit is exactly the
 * flow this exists for. Send `POST /api/account/reset` with
 * `Host: attacker.example` and a victim's address; the server dutifully emails
 * the victim a genuine, valid reset token pointing at the attacker's domain.
 * The victim clicks a link they were expecting, and the token is handed over.
 * It is called reset-password poisoning and it is a Host-header bug, not a
 * token bug — no amount of care in auth-tokens.ts prevents it.
 *
 * So the origin comes from configuration. The request is consulted only in
 * development, where there is no configuration and no attacker.
 */

export function siteOrigin(req?: Request): string {
  const configured =
    process.env.AUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null);

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      console.error(`[site-url] ignoring unparseable origin: ${configured}`);
    }
  }

  const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  if (isProd) {
    // Deliberately fatal rather than falling back to the header. A deployment
    // that cannot say what it is called must not send links at all — the
    // caller turns this into "could not send", which is the honest outcome.
    throw new Error(
      "AUTH_URL is not set, so emailed links have no trustworthy origin. " +
        "Set it to the public URL of this deployment (see .env.example).",
    );
  }

  if (req) {
    try {
      return new URL(req.url).origin;
    } catch {
      /* fall through */
    }
  }
  return "http://localhost:3210";
}

export function absoluteUrl(path: string, req?: Request): string {
  return new URL(path, siteOrigin(req)).toString();
}
