import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/auth";

/**
 * Route gate.
 *
 * NOTE FOR FUTURE EDITORS: this file is `src/proxy.ts`, not `middleware.ts`.
 * Next.js 16 renamed the convention, and it must sit beside `app/` — with a
 * src directory that means `src/proxy.ts`. At `web/proxy.ts` it is silently
 * ignored and this gate never runs, which is the worst possible failure mode
 * for auth. Confirm with `pnpm web:build`: the output must list
 * `ƒ Proxy (Middleware)`. The `edge` runtime is unsupported here; proxy is
 * always nodejs and that is not configurable.
 *
 * Media is gated here, but media URLs are SIGNED in the media route — "may
 * this person see the page" and "here is a one-hour URL for this object" are
 * separate decisions.
 */

const PROTECTED = ["/vault", "/admin", "/api/media", "/api/vault"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const IS_PROD =
  process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

/**
 * The authenticated path. Built at module scope (cheap — it only constructs a
 * wrapper) but deliberately NOT invoked unless credentials exist.
 *
 * Auth.js validates its own config the moment the handler runs, before any
 * callback of ours. So checking `authConfigured()` *inside* the wrapper is too
 * late: it throws MissingSecret first and logs an error on every protected
 * request. The guard has to sit outside the wrapper, which is why this is
 * structured as a plain function delegating to `gate` rather than exporting
 * `auth(...)` directly.
 */
const gate = auth(function gated(req) {
  if (req.auth) return;
  const url = new URL("/signin", req.nextUrl.origin);
  url.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(url);
});

export default function proxy(req: NextRequest, ctx: NextFetchEvent) {
  if (!isProtected(req.nextUrl.pathname)) return;

  if (!authConfigured()) {
    // Asymmetric on purpose. Production must fail closed: shipping with a
    // missing env var should lock the door, never open it. Development fails
    // open so a fresh clone runs with no secrets at all.
    if (IS_PROD) {
      return new NextResponse(
        "Authentication is not configured on this deployment.",
        { status: 503 },
      );
    }
    console.warn(
      `[proxy] auth not configured — allowing ${req.nextUrl.pathname} in ` +
        `development only. Set AUTH_GITHUB_ID / AUTH_GITHUB_SECRET / AUTH_SECRET.`,
    );
    return;
  }

  return (
    gate as unknown as (
      r: NextRequest,
      c: NextFetchEvent,
    ) => ReturnType<typeof gate>
  )(req, ctx);
}

export const config = {
  // Skip Next internals and the auth endpoints themselves — gating /api/auth
  // would make signing in impossible.
  matcher: ["/((?!_next/static|_next/image|api/auth|favicon.ico).*)"],
};
