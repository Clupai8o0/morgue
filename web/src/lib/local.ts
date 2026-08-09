/**
 * Local mode — one morgue, on one machine, with no accounts.
 *
 * `MORGUE_LOCAL=1` turns the hosted product into the tool: no sign-in, no
 * database, no cloud storage, `/` goes straight to the vault, and every route
 * that exists to manage other people's accounts returns 404 rather than a
 * gate. docs/LOCAL-MODE.md is the brief; this file is the switch.
 *
 * ── Why a flag and not a fork ───────────────────────────────────────────────
 *
 * A second copy of web/ diverges within a month and every bug gets fixed
 * twice. So there is one app, one build, and one variable.
 *
 * ── Why the flag can be ignored, and why that is the important part ─────────
 *
 * A boolean that opens a door is an authentication bypass one environment
 * variable wide. If setting MORGUE_LOCAL on a hosted deployment disabled the
 * gate, then anyone who can write an env var — a leaked dashboard session, a
 * malicious PR touching vercel.json, a copy-pasted `.env` — owns the vault.
 *
 * So local mode is not "the operator asked for it". It is "the operator asked
 * for it AND nothing about this deployment looks hosted". `hostedSignal()` is
 * the second half, and it is deliberately BROADER than `authConfigured()`:
 *
 *   - authConfigured() is a conjunction — a secret AND a provider. It answers
 *     "can somebody sign in".
 *   - this is a disjunction — a secret OR a provider OR a database OR a
 *     platform marker. It answers "does anything here suggest other people".
 *
 * Broader is the safe direction. A false positive means local mode quietly
 * does not engage and you get the ordinary development behaviour; a false
 * negative would mean an open vault. And because it reads only `process.env`
 * and imports nothing, no refactor of auth.ts can widen it by accident — which
 * is exactly the failure mode a security predicate assembled from three other
 * modules is prone to.
 *
 * The duplication with auth.ts is therefore intentional and is the point. Do
 * not "DRY" this into a call to authConfigured().
 */

/**
 * Environment variables that mean "this is a deployment with users on it".
 * Any one of them, set to any non-empty value, refuses local mode.
 *
 * `VERCEL` is set by the platform on every deploy and cannot be unset from the
 * project's own configuration, so it is the one signal an attacker editing env
 * vars cannot remove.
 */
const HOSTED_SIGNALS = [
  "VERCEL",
  "AUTH_SECRET",
  "DATABASE_URL",
  "AUTH_GITHUB_ID",
  "AUTH_GOOGLE_ID",
] as const;

/** The first hosted signal present, or null. Named so refusals can say why. */
export function hostedSignal(): string | null {
  for (const key of HOSTED_SIGNALS) {
    if (process.env[key]) return key;
  }
  return null;
}

/** True when this process is a single-user local morgue. */
export function localMode(): boolean {
  return process.env.MORGUE_LOCAL === "1" && hostedSignal() === null;
}

/**
 * Asked for but refused — the state that must never be silent.
 *
 * Someone who set MORGUE_LOCAL and still lands on a sign-in page has to be
 * told which variable outranked it, or the only available conclusion is "the
 * flag doesn't work".
 */
export function localModeRefused(): string | null {
  if (process.env.MORGUE_LOCAL !== "1") return null;
  return hostedSignal();
}

/**
 * Routes that exist only because the hosted product has more than one user.
 *
 * 404, not 403 and not a redirect: in local mode these are not gated, they are
 * genuinely absent. A designer running their own morgue should not be able to
 * find an admin console at all, and a 403 would tell them one is there.
 *
 * `/api/auth` is deliberately NOT here. proxy.ts's matcher excludes it so that
 * signing in remains possible, which means this list cannot reach it anyway —
 * listing it would imply a protection that is not being applied. With no
 * AUTH_SECRET those endpoints cannot mint anything regardless.
 */
const HOSTED_ONLY = [
  "/admin",
  "/account",
  "/upgrade",
  "/signin",
  "/reset",
  "/verify",
  "/s",
  "/api/share",
  "/api/account",
  "/api/waitlist",
];

export function hostedOnly(pathname: string): boolean {
  return HOSTED_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
