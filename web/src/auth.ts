import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, dbConfigured, schema } from "@/db";
import { hashClientIp } from "@/lib/client-ip";
import {
  checkAuthLimit,
  clearAuthLimit,
  recordAuthFailure,
} from "@/lib/auth-limit";
import { dummyHash, needsRehash, verifyPassword, hashPassword } from "@/lib/password";
import { decideOAuthSignIn, providerVerifiedEmail } from "@/lib/link-policy";
import {
  admissionProblem,
  findUserByEmail,
  findUserById,
  normaliseEmail,
} from "@/lib/users";

/**
 * Authentication for a multi-tenant morgue.
 *
 * ── What replaced AUTH_ALLOWED_LOGINS ───────────────────────────────────────
 *
 * Until phase 1 the entire authorisation model was a comma-separated list of
 * GitHub logins in an environment variable, and an empty list denied everyone
 * (CLAUDE.md rule 9). That variable is gone. Its replacement is a row in
 * `users` with `status = 'active'`, and the rule survives the change intact:
 * with no database there are no users, with no users nobody signs in. The door
 * still locks itself when the configuration is missing — it just locks on
 * something that can also express roles, suspension and a second tenant.
 *
 * The first account is created at the CLI with `pnpm user add`, deliberately.
 * A bootstrap that promotes "the first person to click sign in" to admin is a
 * race anybody on the internet can enter.
 *
 * ── Sessions are JWTs, and revocation is a version number ───────────────────
 *
 * Database sessions would put a query on every authenticated request, which is
 * what this app has avoided everywhere else. Credentials sign-in also cannot
 * use them: @auth/core's credentials branch never calls the adapter's
 * createSession, so a database strategy silently produces no session at all.
 * Two strategies in one app is worse than either.
 *
 * So: JWT everywhere, plus `users.sessionVersion`. The token carries the value
 * it was minted with; the jwt callback re-reads the row on a throttle and
 * returns null — which clears the cookie — when they disagree. Bumping the
 * column logs that user out everywhere. The cost is stated below and is not
 * hidden: revocation takes effect within SESSION_RECHECK_SECONDS, not
 * instantly. Same trade, and the same honesty about it, as the share-link
 * revocation lag in lib/share.ts.
 *
 * ── Account linking ─────────────────────────────────────────────────────────
 *
 * See LINKING POLICY on the signIn callback. Short version: the same human
 * will sign up with Google and later click GitHub, and joining those two on a
 * matching email is an account takeover whenever the second provider did not
 * verify the address. The policy is enforced here rather than left to
 * `allowDangerousEmailAccountLinking`, which cannot tell the difference.
 */

/**
 * How long a JWT may go unchecked against the database.
 *
 * This is the revocation lag, stated as a number instead of left to be
 * inferred. A minute means a suspended user keeps their access for up to a
 * minute. Zero means a query on every authenticated request — correct for a
 * deployment that wants instant revocation and is willing to pay the
 * database-session cost this strategy exists to avoid.
 *
 * Configurable because the right answer genuinely differs by deployment, and
 * because `pnpm verify:auth` sets it to 0 to test revocation without sleeping
 * through the default.
 */
const SESSION_RECHECK_SECONDS = (() => {
  const raw = Number(process.env.AUTH_SESSION_RECHECK_SECONDS);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 3600) : 60;
})();

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/* ─── Which providers are actually usable ───────────────────────────────── */

export function githubConfigured(): boolean {
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
}
export function googleConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}
/** Email + password needs somewhere to keep the password. */
export function credentialsConfigured(): boolean {
  return dbConfigured();
}

/**
 * True when SOMEBODY could sign in. proxy.ts uses this to decide between
 * failing open in development and returning 503 in production, so it has to
 * mean "this deployment has a working front door", not "GitHub is set up".
 */
export function authConfigured(): boolean {
  if (!process.env.AUTH_SECRET) return false;
  return githubConfigured() || googleConfigured() || credentialsConfigured();
}

/** For the sign-in page, so it renders the buttons that will actually work. */
export function configuredProviders(): Array<"github" | "google" | "credentials"> {
  const out: Array<"github" | "google" | "credentials"> = [];
  if (githubConfigured()) out.push("github");
  if (googleConfigured()) out.push("google");
  if (credentialsConfigured()) out.push("credentials");
  return out;
}

/* ─── Providers ─────────────────────────────────────────────────────────── */

/**
 * `allowDangerousEmailAccountLinking` is ON for both OAuth providers, and that
 * needs justifying rather than hiding.
 *
 * With it off, @auth/core throws OAuthAccountNotLinked whenever an OAuth
 * profile's email matches an existing user that has no link to that provider.
 * That is EVERY first sign-in here, because accounts are created by invite and
 * by `pnpm user add` — the row always exists before the OAuth link does. The
 * flag off does not make the system safer, it makes it unusable.
 *
 * What the flag is genuinely dangerous for is linking on an email the provider
 * never verified. That check is missing from the flag and present in our
 * signIn callback, one step earlier, where it can also say why it refused.
 * Turning the flag off again without moving that check does not restore
 * safety — it just breaks sign-in.
 */
function providers(): Provider[] {
  const list: Provider[] = [];

  if (githubConfigured()) {
    list.push(
      GitHub({
        allowDangerousEmailAccountLinking: true,
        profile(p) {
          return {
            id: String(p.id),
            name: p.name ?? p.login,
            // Lowercased HERE because the adapter looks users up by email
            // before any callback of ours runs. See normaliseEmail().
            email: p.email ? normaliseEmail(String(p.email)) : null,
            image: p.avatar_url,
          };
        },
      }),
    );
  }

  if (googleConfigured()) {
    list.push(
      Google({
        allowDangerousEmailAccountLinking: true,
        // Google refuses to re-prompt for consent by default, which means a
        // returning user never re-grants and we never see a refresh token.
        // Harmless today (nothing calls Google's API on the user's behalf) and
        // left alone rather than papered over with prompt=consent, which makes
        // every sign-in an extra click for a token nothing reads.
        profile(p) {
          return {
            id: p.sub,
            name: p.name,
            email: p.email ? normaliseEmail(p.email) : null,
            image: p.picture,
          };
        },
      }),
    );
  }

  if (credentialsConfigured()) {
    list.push(
      Credentials({
        id: "credentials",
        name: "Email and password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },

        /**
         * Returns a user or null. NEVER throws with detail and never varies
         * its response by failure mode: "no such account", "wrong password"
         * and "not verified yet" all look identical from outside, because the
         * difference between them is exactly what an attacker enumerating
         * addresses wants to learn.
         *
         * The timing is levelled too. Without the dummy hash, a missing
         * account returns in microseconds and a wrong password in ~100ms,
         * which is a working enumeration oracle no matter how carefully the
         * response body is worded.
         */
        async authorize(raw, request) {
          const email =
            typeof raw?.email === "string" ? normaliseEmail(raw.email) : "";
          const password = typeof raw?.password === "string" ? raw.password : "";
          const ipHash = hashClientIp(request);

          if (!email || !password) return null;

          const limit = await checkAuthLimit(email, ipHash);
          if (limit.limited) return null;

          const user = await findUserByEmail(email);

          // Always spend the hash. `??` on the stored value is what makes a
          // nonexistent account cost the same as a real one.
          const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));

          const admissible =
            ok &&
            user !== null &&
            user.passwordHash !== null &&
            // An OAuth provider sets this for us. A credentials sign-up does
            // not, so an unverified address cannot be used to hold a session
            // — which is what stops someone claiming an address they do not
            // own and then linking a real OAuth account to it later.
            user.emailVerified !== null &&
            admissionProblem(user) === null;

          if (!admissible) {
            await recordAuthFailure(email, ipHash);
            return null;
          }

          await clearAuthLimit(email, ipHash);

          // Cost goes up over the years; upgrade quietly on the one occasion
          // the plaintext is in hand and already proven correct.
          if (needsRehash(user!.passwordHash!)) {
            try {
              const fresh = await hashPassword(password);
              const { eq } = await import("drizzle-orm");
              await db()
                .update(schema.users)
                .set({ passwordHash: fresh })
                .where(eq(schema.users.id, user!.id));
            } catch (err) {
              console.error("[auth] rehash failed", err);
            }
          }

          return {
            id: user!.id,
            email: user!.email,
            name: user!.name,
            image: user!.image,
          };
        },
      }),
    );
  }

  return list;
}

/* ─── Config ────────────────────────────────────────────────────────────── */

/**
 * Built once at module scope. The adapter is omitted entirely when there is no
 * DATABASE_URL: DrizzleAdapter needs a live handle, and db() throws without
 * one. Constructing it unconditionally would turn a missing variable into an
 * exception thrown while importing this file — which proxy.ts imports, which
 * means every request on the deployment, not just the ones touching auth.
 */
function adapter() {
  if (!dbConfigured()) return undefined;
  try {
    return DrizzleAdapter(db(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    });
  } catch (err) {
    // A malformed DATABASE_URL throws inside the Neon driver while it parses
    // the string — at module scope, in a file proxy.ts imports, which means
    // every request on the deployment 500s including the public landing page.
    // Degrading to "no adapter" turns that into "nobody can sign in", which is
    // the same fail-closed answer rule 9 wants and leaves the rest of the site
    // standing.
    console.error(
      "[auth] DATABASE_URL is set but unusable — sign-in is disabled. " +
        "Check the connection string; see web/.env.example.",
      err,
    );
    return undefined;
  }
}

const config: NextAuthConfig = {
  adapter: adapter(),

  providers: providers(),

  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },

  // Both point at our page so a refusal lands somewhere that can explain
  // itself. Auth.js's default error page renders an error code and nothing a
  // person can act on.
  pages: { signIn: "/signin", error: "/signin" },

  callbacks: {
    /**
     * The authorisation decision. The rules are in lib/link-policy.ts, which
     * exists so they can be tested without an OAuth round trip; this is the
     * wiring.
     *
     * WHERE IN THE FLOW THIS SITS matters and is easy to get wrong. It runs
     * BEFORE the adapter creates or links anything — verified against
     * @auth/core's handleAuthorized, which handle-login.js calls ahead of
     * handleLoginOrRegister. So refusing here means no row is written, which
     * is what makes it the right place for an invite-only gate rather than a
     * cleanup afterwards.
     */
    async signIn({ user, account, profile }) {
      if (!account) return false;

      // Credentials: authorize() already checked the password, the
      // verification stamp, the account status and the rate limit. There is
      // nothing left for a policy to add.
      if (account.provider === "credentials") return true;

      const email = normaliseEmail(String(user?.email ?? profile?.email ?? ""));

      const decision = await decideOAuthSignIn({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email,
        currentUserId: await signedInUserId(),
        isEmailVerifiedByProvider: () =>
          providerVerifiedEmail(
            account.provider,
            typeof account.access_token === "string" ? account.access_token : null,
            profile,
            email,
          ),
      });

      return decision.allow ? true : decision.redirect;
    },

    /**
     * The token is the session. Everything a request needs to authorise
     * itself lives here so that the common path touches no database at all —
     * and `sv` is what keeps that from meaning "a session can never be
     * revoked".
     */
    async jwt({ token, user, trigger }) {
      const now = Math.floor(Date.now() / 1000);

      // Sign-in. `user.id` is the users row for OAuth (the adapter has run by
      // now) and for credentials (authorize returned it).
      if (user?.id) {
        const row = await findUserById(String(user.id));
        if (!row) return null;
        token.uid = row.id;
        token.role = row.role;
        token.sv = row.sessionVersion;
        token.cka = now;
        return token;
      }

      if (!token.uid) return token;

      const stale = now - Number(token.cka ?? 0) >= SESSION_RECHECK_SECONDS;
      if (!stale && trigger !== "update") return token;

      // Re-validate. A user that has been deleted, suspended, or had their
      // sessionVersion bumped loses the cookie on the next request past the
      // throttle.
      let row;
      try {
        row = await findUserById(String(token.uid));
      } catch (err) {
        // Unlike the rate limiter, this fails CLOSED-ish: keep the existing
        // session rather than logging everyone out on one database blip, but
        // do NOT advance `cka`, so the check is retried on the very next
        // request instead of being skipped for another minute.
        console.error("[auth] session recheck failed, keeping session", err);
        return token;
      }

      if (!row || row.status !== "active" || row.sessionVersion !== token.sv) {
        return null;
      }

      token.role = row.role;
      token.cka = now;
      return token;
    },

    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.uid ?? "");
        session.user.role = (token.role as "user" | "admin") ?? "user";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

/**
 * Who is signed in RIGHT NOW, read during the OAuth callback.
 *
 * This is what makes "one human, three sign-in buttons, one account" work.
 * @auth/core already links a provider to the session user when one exists —
 * handle-login.js takes the `if (user)` branch and calls linkAccount — but our
 * signIn callback runs first, and without this it would refuse a provider
 * whose email does not match any account and the link would never happen.
 *
 * The signIn callback is not given the session, so it has to be fetched. That
 * is a second Auth.js invocation inside the first, which is safe because it
 * runs the `session` action rather than the `signIn` one: the jwt callback
 * fires, the signIn callback does not, so there is no recursion. Any failure
 * means "treat this as a fresh sign-in", which is the conservative answer —
 * the worst case is a link that has to be made from /account instead.
 */
async function signedInUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id || null;
  } catch {
    return null;
  }
}
