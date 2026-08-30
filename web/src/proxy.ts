import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth, authConfigured } from "@/auth";
import {
  SHARE_COOKIE,
  SHARE_HEADER,
  shareAllows,
  verifyShareToken,
} from "@/lib/share";
import { hostedOnly, localMode, localModeRefused } from "@/lib/local";

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
 *
 * TWO WAYS IN, and they are not equivalent. A signed-in session (against a
 * row in `users` — see src/auth.ts) reaches everything its role allows. A
 * share cookie reaches a read-only subset decided by `shareAllows`, which is
 * an allowlist — /admin and /api/share are not on it and must never be. The
 * share path is checked FIRST only when there is no session, so a signed-in
 * user never has their own access narrowed by a share cookie they happen to be
 * carrying.
 *
 * ...AND A THIRD THAT IS NOT A WAY IN AT ALL. Local mode (@/lib/local) is a
 * different deployment, not a different permission: one person, one machine,
 * no accounts, so there is nobody to authenticate and the hosted routes do not
 * exist. It is checked before everything else because it decides which product
 * this process is, and it can only engage when nothing in the environment
 * suggests a hosted one. See lib/local.ts for why that check is a disjunction
 * and why it is deliberately not shared with authConfigured().
 */

const PROTECTED = [
  "/vault",
  "/admin",
  "/account",
  "/upgrade",
  "/api/media",
  "/api/vault",
  "/api/share",
  // NOT all of /api/account. `reset` and `verify` under it are deliberately
  // public — a locked-out person has no session to authenticate with, and
  // gating the way back in on being signed in is a loop.
  //
  // So the private siblings are listed one by one, and the cost of that is
  // real: A NEW ROUTE UNDER /api/account IS PUBLIC UNTIL IT APPEARS HERE. That
  // is the wrong default and it is kept only because the alternative — protect
  // the prefix, list the exceptions — fails in the other direction, where
  // forgetting an entry locks out the person who cannot sign in. Between a
  // route that is accidentally open and a recovery path that is accidentally
  // shut, neither is acceptable, so both lists are short and both are checked
  // by bin/verify-share.mjs, which asserts every one of these is refused to a
  // share cookie. Add to that suite whenever you add a line here.
  "/api/account/me",
  "/api/account/delete",
  "/api/account/email",
  "/api/account/export",
  "/api/account/sessions",
  "/api/account/upgrade",
  "/api/account/mcp-tokens",
];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
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
  if (!req.auth) {
    const url = new URL("/signin", req.nextUrl.origin);
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Being signed in is not being an admin. Checked here AND in the route, the
  // same doubling /api/share already uses: a page that manages other people's
  // accounts should not depend on one matcher pattern being right. 404 rather
  // than 403 so an ordinary user cannot confirm the route exists.
  if (isAdminPath(req.nextUrl.pathname) && req.auth.user?.role !== "admin") {
    return new NextResponse("Not found", { status: 404 });
  }
});

/**
 * A valid share cookie for a path its scope allows.
 *
 * Returns the response to send, or null to mean "this is not a shared
 * request — carry on with the owner gate". An INVALID or out-of-scope cookie
 * also returns null rather than rejecting: the visitor may still be a signed-in
 * owner, and a stale cookie must never lock the owner out of their own vault.
 */
function shareGate(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(SHARE_COOKIE)?.value;
  if (!token) return null;

  const result = verifyShareToken(token);
  if (!result.ok) return null;
  if (!shareAllows(result.payload.scope, req.nextUrl.pathname)) return null;

  // Pass the scope down so pages can render the read-only banner and hide
  // owner-only controls. Set on the REQUEST, not the response: a response
  // header would be visible to the browser and is not readable by a Server
  // Component, which is the thing that needs it.
  const headers = new Headers(req.headers);
  headers.set(
    SHARE_HEADER,
    result.payload.scope.kind === "vault"
      ? "vault"
      : `item:${result.payload.scope.slug}`,
  );
  return NextResponse.next({ request: { headers } });
}

/**
 * Said once per process, not once per request — a line on every asset fetch is
 * a line nobody reads. Module scope rather than a lazy flag because both
 * branches are pure environment reads and neither can change while running.
 */
{
  const refusedBy = localModeRefused();
  if (localMode()) {
    console.log(
      "[proxy] local mode: no accounts, no sign-in, everything open. " +
        "The hosted routes (/admin, /account, /signin, /api/share …) return 404.",
    );
  } else if (refusedBy) {
    // Loud, because the alternative reading of a sign-in page here is "the
    // flag is broken", and someone acting on that reading starts deleting the
    // gate. Name the variable so the next step is obvious.
    console.warn(
      `[proxy] MORGUE_LOCAL=1 was IGNORED: ${refusedBy} is set, which means ` +
        `this deployment has accounts. Local mode never disables the gate on ` +
        `a hosted deployment — see web/src/lib/local.ts.`,
    );
  }
}

export default function proxy(req: NextRequest, ctx: NextFetchEvent) {
  // Local mode first: it decides which product this is, and every check below
  // is about a hosted one.
  if (localMode()) {
    if (hostedOnly(req.nextUrl.pathname)) {
      return new NextResponse("Not found", { status: 404 });
    }
    // The landing page is marketing for a product this deployment is not
    // running. Redirect rather than render, and do it here rather than with a
    // `redirect()` in the page: page.tsx is `force-static`, so that decision
    // would be baked at build time and a build made without the flag would
    // keep serving the waitlist form to someone running locally.
    if (req.nextUrl.pathname === "/") {
      return NextResponse.redirect(new URL("/vault", req.nextUrl.origin));
    }
    return;
  }

  if (!isProtected(req.nextUrl.pathname)) return;

  // Never reachable with a share cookie, at any stage, configured or not.
  // Listed again here rather than relying on shareAllows alone: this is the
  // one check that must survive somebody widening that allowlist.
  const ownerOnly =
    isAdminPath(req.nextUrl.pathname) ||
    req.nextUrl.pathname.startsWith("/api/share") ||
    // Somebody holding a read-only link must never reach the controls that
    // change how the vault's owner signs in — or, now, the ones that rename
    // them, move their address, sign them out, export their identity or delete
    // the account outright.
    req.nextUrl.pathname === "/account" ||
    req.nextUrl.pathname.startsWith("/account/") ||
    req.nextUrl.pathname === "/upgrade" ||
    req.nextUrl.pathname.startsWith("/api/account/me") ||
    req.nextUrl.pathname.startsWith("/api/account/delete") ||
    req.nextUrl.pathname.startsWith("/api/account/email") ||
    req.nextUrl.pathname.startsWith("/api/account/export") ||
    req.nextUrl.pathname.startsWith("/api/account/sessions") ||
    req.nextUrl.pathname.startsWith("/api/account/upgrade") ||
    // Minting a bearer key to the whole vault is the last thing a read-only
    // share cookie should reach.
    req.nextUrl.pathname.startsWith("/api/account/mcp-tokens");

  if (!ownerOnly) {
    const shared = shareGate(req);
    if (shared) return shared;
  }

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
        `development only. Set AUTH_SECRET plus one provider: ` +
        `AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET, or DATABASE_URL for ` +
        `email and password. Then create an account with \`pnpm user add\`.`,
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
