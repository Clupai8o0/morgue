import { dbConfigured } from "@/db";
import { admissionProblem, findLinkedUser, findUserByEmail } from "@/lib/users";

/**
 * Who is allowed through an OAuth sign-in, and what happens when the same
 * human arrives via a second provider.
 *
 * ── Why this is a module and not ten lines inside the signIn callback ───────
 *
 * Because it is the whole authorisation decision, and the only way to exercise
 * it end to end is a real round trip to GitHub or Google, which no automated
 * run can perform. Left inline it would be the one part of auth that is
 * verified by clicking. As a function taking an injected "did the provider
 * verify this address" it is exhaustively testable against a real database —
 * see `pnpm verify:auth`.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * The dangerous case is the fifth one. Someone signs up with Google as
 * ada@example.com. Later, an attacker creates a GitHub account, sets its email
 * to ada@example.com without verifying it, and clicks "Continue with GitHub".
 * If we link on a matching address alone, they are now inside Ada's vault.
 * Auth.js's `allowDangerousEmailAccountLinking` does exactly that — the flag is
 * all or nothing and cannot see the verification status — which is why the
 * check lives here, one step earlier, where it can also say why it refused.
 */

export type SignInDecision = { allow: true } | { allow: false; redirect: string };

const ALLOW: SignInDecision = { allow: true };
const refuse = (error: string): SignInDecision => ({
  allow: false,
  redirect: `/signin?error=${error}`,
});

export interface OAuthSignInInput {
  provider: string;
  providerAccountId: string;
  /** Already lowercased by the provider's profile() callback. */
  email: string;
  /**
   * Injected rather than called inline so the policy can be tested without a
   * network, and so the expensive check happens ONLY in the branch that needs
   * it — a returning user whose account is already linked never pays for it.
   */
  isEmailVerifiedByProvider: () => Promise<boolean>;
}

export async function decideOAuthSignIn(
  input: OAuthSignInInput,
): Promise<SignInDecision> {
  // 1. No database means no users, and no users means nobody signs in.
  //    CLAUDE.md rule 9, expressed where it now lives.
  if (!dbConfigured()) return refuse("Configuration");

  // 2. A provider that shares no address gives us nothing to match on.
  if (!input.email) return refuse("NoEmail");

  // 3. Already linked. The provider proved this identity when the link was
  //    made; only admission is still in question.
  const linked = await findLinkedUser(input.provider, input.providerAccountId);
  if (linked) return admissionDecision(linked);

  // 4. Not linked, and nobody owns this address. There is no self-service
  //    sign-up: an account exists because an admin made it or an invite was
  //    claimed.
  const existing = await findUserByEmail(input.email);
  if (!existing) return refuse("NoAccount");

  // 5. Not linked, but the address is spoken for. This is the takeover-shaped
  //    case — link only on a provider-verified address.
  if (!(await input.isEmailVerifiedByProvider())) return refuse("UnverifiedEmail");

  return admissionDecision(existing);
}

function admissionDecision(user: Parameters<typeof admissionProblem>[0]): SignInDecision {
  const problem = admissionProblem(user);
  if (!problem) return ALLOW;
  return refuse(problem === "suspended" ? "Suspended" : "NoAccount");
}

/**
 * Did the provider itself verify that this address belongs to this person?
 *
 * Google answers directly: OIDC `email_verified`.
 *
 * GitHub does not, and its Auth.js provider is worth reading before trusting.
 * When the profile has no public email it fetches /user/emails and takes
 * `emails.find(e => e.primary) ?? emails[0]` — note the fallback. GitHub does
 * require a primary address to be verified, so the first half is safe; the
 * `?? emails[0]` is not, and it is reached exactly when the account is new
 * enough to have no primary set. That is the account an attacker creates. So
 * we ask GitHub ourselves and read the `verified` flag rather than inferring
 * it.
 *
 * Any failure is a refusal. An unreachable provider API is not evidence that
 * an address is owned. An unknown provider is a refusal too, so that adding
 * one fails loudly instead of quietly skipping this check.
 */
export async function providerVerifiedEmail(
  provider: string,
  accessToken: string | null,
  profile: unknown,
  email: string,
): Promise<boolean> {
  if (provider === "google") {
    return (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
  }

  if (provider === "github") {
    if (!accessToken) return false;
    try {
      const res = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "morgue",
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) return false;
      const rows: Array<{ email?: string; verified?: boolean }> = await res.json();
      return rows.some(
        (r) => r.verified === true && String(r.email ?? "").trim().toLowerCase() === email,
      );
    } catch {
      return false;
    }
  }

  return false;
}
