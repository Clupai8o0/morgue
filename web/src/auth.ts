import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Auth for a single-user application.
 *
 * There is no user table, no registration, and no roles. The vault belongs to
 * one person; everyone else is on a waitlist that grants nothing. So identity
 * reduces to a single question — is this GitHub login on the allowlist — and
 * the answer lives in an environment variable rather than a database.
 *
 * JWT sessions, not database sessions: with no user records to join against, a
 * session table would be pure overhead, and it keeps Postgres out of the
 * request path for every authenticated page load.
 */

const ALLOWED = (process.env.AUTH_ALLOWED_LOGINS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],

  // Default is /api/auth/signin, which renders Auth.js's own page. Ours
  // explains what the vault is and why you probably can't get in.
  pages: { signIn: "/signin" },

  callbacks: {
    /**
     * The allowlist gate. Returning false here stops the sign-in entirely —
     * no session is issued, so nothing downstream has to re-check.
     *
     * An EMPTY allowlist denies everyone. That is the deliberate choice: a
     * missing env var in production should lock the door, not open it.
     */
    signIn({ profile }) {
      const login = String(profile?.login ?? "").toLowerCase();
      if (!login || ALLOWED.length === 0) return false;
      return ALLOWED.includes(login);
    },

    jwt({ token, profile }) {
      if (profile?.login) token.login = String(profile.login);
      return token;
    },

    session({ session, token }) {
      if (token.login) {
        (session.user as { login?: string }).login = String(token.login);
      }
      return session;
    },
  },
});

/** True when GitHub OAuth is configured; lets pages explain rather than 500. */
export function authConfigured(): boolean {
  return Boolean(
    process.env.AUTH_GITHUB_ID &&
      process.env.AUTH_GITHUB_SECRET &&
      process.env.AUTH_SECRET,
  );
}
