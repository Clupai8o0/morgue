import type { Metadata } from "next";
import Link from "next/link";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, authConfigured, configuredProviders, signIn } from "@/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * The front door.
 *
 * Renders only the providers that are actually configured, rather than a fixed
 * set of buttons. A Google button on a deployment with no Google credentials
 * is a dead end that looks like a bug in Google.
 *
 * `?error=` arrives from two places: Auth.js's own failures (pages.error points
 * here) and our signIn callback, which returns a redirect string so it can say
 * WHY it refused. Both are mapped below; anything unrecognised falls back to a
 * generic line rather than rendering a raw enum at the user.
 */

const ERRORS: Record<string, string> = {
  // Ours, from the signIn callback in src/auth.ts.
  NoAccount:
    "There is no morgue account for that address. Access is by invitation — join the waitlist and you'll hear back.",
  Suspended: "That account has been suspended. Get in touch if you think that's wrong.",
  UnverifiedEmail:
    "That provider has not verified this email address, so it can't be linked to an existing account. Verify it with the provider and try again.",
  NoEmail: "That provider didn't share an email address, so there's nothing to match on.",
  // Auth.js's.
  CredentialsSignin: "That email and password don't match an account.",
  OAuthAccountNotLinked:
    "An account already exists for that email using a different sign-in method.",
  AccessDenied: "That account isn't allowed in.",
  Configuration: "Sign-in is misconfigured on this deployment. The logs will say more.",
  Verification: "That link has expired or has already been used.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { from, error } = await searchParams;
  const target = typeof from === "string" && from.startsWith("/") ? from : "/vault";

  // Guard before calling auth(): Auth.js asserts its own config on invocation
  // and throws MissingSecret, so an unconfigured local run would error here
  // instead of rendering the explanation below.
  const configured = authConfigured();
  if (configured) {
    const session = await auth();
    if (session) redirect(target);
  }

  const available = configuredProviders();
  const message = typeof error === "string" ? (ERRORS[error] ?? ERRORS.AccessDenied) : null;

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-lg py-section">
      <Link
        href="/"
        className="text-micro text-ink-muted hover:text-ink mb-xl transition-colors duration-[var(--duration-fast)]"
      >
        ← morgue
      </Link>

      <h1 className="text-display-md font-display">Sign in.</h1>
      <p className="text-body text-ink-muted mt-md">
        Vaults are private to their owner. Accounts are created by invitation —
        if you don&apos;t have one,{" "}
        <Link href="/" className="text-accent underline underline-offset-4">
          join the waitlist
        </Link>
        .
      </p>

      {message ? (
        <div
          role="alert"
          className="border-hairline bg-surface-1 rounded-lg p-md mt-lg border"
        >
          <p className="text-body-sm text-grad-coral">{message}</p>
        </div>
      ) : null}

      {!configured ? (
        <div className="border-hairline bg-surface-1 rounded-lg p-md mt-xl border">
          <p className="text-body-sm">Sign-in isn&apos;t configured yet.</p>
          <p className="text-micro text-ink-muted mt-xs">
            Set <code className="text-ink">AUTH_SECRET</code> and at least one of{" "}
            <code className="text-ink">AUTH_GITHUB_ID</code>/
            <code className="text-ink">AUTH_GITHUB_SECRET</code>,{" "}
            <code className="text-ink">AUTH_GOOGLE_ID</code>/
            <code className="text-ink">AUTH_GOOGLE_SECRET</code>, or{" "}
            <code className="text-ink">DATABASE_URL</code> for email and password.
            Then create the first account with{" "}
            <code className="text-ink">pnpm user add</code>.
          </p>
        </div>
      ) : (
        <div className="mt-xl gap-sm flex flex-col">
          {available.includes("github") ? (
            <OAuthButton provider="github" label="Continue with GitHub" target={target} />
          ) : null}
          {available.includes("google") ? (
            <OAuthButton provider="google" label="Continue with Google" target={target} />
          ) : null}

          {available.includes("credentials") ? (
            <>
              {available.length > 1 ? (
                <div className="gap-sm my-xs flex items-center">
                  <span className="bg-hairline h-px flex-1" />
                  <span className="text-micro text-ink-muted">or</span>
                  <span className="bg-hairline h-px flex-1" />
                </div>
              ) : null}

              <form
                action={async (formData: FormData) => {
                  "use server";
                  const email = String(formData.get("email") ?? "");
                  const password = String(formData.get("password") ?? "");
                  try {
                    await signIn("credentials", { email, password, redirectTo: target });
                  } catch (err) {
                    // signIn signals success by throwing NEXT_REDIRECT, so the
                    // AuthError check has to come first and anything else has
                    // to be rethrown untouched.
                    if (err instanceof AuthError) {
                      redirect(
                        `/signin?error=${encodeURIComponent(err.type)}&from=${encodeURIComponent(target)}`,
                      );
                    }
                    throw err;
                  }
                }}
                className="gap-xs flex flex-col"
              >
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="you@domain.com"
                  aria-label="Email address"
                  className="border-hairline bg-surface-1 focus:border-ink text-body rounded-pill px-md border py-[12px] transition-colors duration-[var(--duration-fast)] outline-none"
                />
                <input
                  type="password"
                  name="password"
                  required
                  autoComplete="current-password"
                  placeholder="Password"
                  aria-label="Password"
                  className="border-hairline bg-surface-1 focus:border-ink text-body rounded-pill px-md border py-[12px] transition-colors duration-[var(--duration-fast)] outline-none"
                />
                <button
                  type="submit"
                  className="bg-primary text-on-primary rounded-pill text-button px-lg w-full py-[12px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.02] active:scale-[0.98]"
                >
                  Sign in
                </button>
              </form>

              <Link
                href="/reset"
                className="text-micro text-ink-muted hover:text-ink self-center transition-colors duration-[var(--duration-fast)]"
              >
                Forgot your password?
              </Link>
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}

function OAuthButton({
  provider,
  label,
  target,
}: {
  provider: "github" | "google";
  label: string;
  target: string;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(provider, { redirectTo: target });
      }}
    >
      <button
        type="submit"
        className="bg-primary text-on-primary rounded-pill text-button px-lg w-full py-[12px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.02] active:scale-[0.98]"
      >
        {label}
      </button>
    </form>
  );
}
