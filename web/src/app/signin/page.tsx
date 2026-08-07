import type { Metadata } from "next";
import Link from "next/link";
import { signIn, auth, authConfigured } from "@/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: PageProps<"/signin">) {
  const { from } = await searchParams;
  const target = typeof from === "string" && from.startsWith("/") ? from : "/vault";

  // Guard before calling auth(): Auth.js asserts its own config on invocation
  // and throws MissingSecret, so an unconfigured local run would error here
  // instead of rendering the explanation below.
  const configured = authConfigured();
  if (configured) {
    const session = await auth();
    if (session) redirect(target);
  }

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-lg py-section">
      <Link
        href="/"
        className="text-micro text-ink-muted hover:text-ink mb-xl transition-colors duration-[var(--duration-fast)]"
      >
        ← morgue
      </Link>

      <h1 className="text-display-md font-display">The vault is private.</h1>
      <p className="text-body text-ink-muted mt-md">
        It holds third-party source licensed for personal reference, not
        redistribution — so access is limited to one account rather than granted
        on request. If you were looking for the tool, it&apos;s{" "}
        <Link href="/" className="text-accent underline underline-offset-4">
          on the landing page
        </Link>
        .
      </p>

      {configured ? (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: target });
          }}
          className="mt-xl"
        >
          <button
            type="submit"
            className="bg-primary text-on-primary rounded-pill text-button px-lg w-full py-[12px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.02] active:scale-[0.98]"
          >
            Continue with GitHub
          </button>
        </form>
      ) : (
        <div className="border-hairline bg-surface-1 rounded-lg p-md mt-xl">
          <p className="text-body-sm">Sign-in isn&apos;t configured yet.</p>
          <p className="text-micro text-ink-muted mt-xs">
            Set <code className="text-ink">AUTH_GITHUB_ID</code>,{" "}
            <code className="text-ink">AUTH_GITHUB_SECRET</code>,{" "}
            <code className="text-ink">AUTH_SECRET</code> and{" "}
            <code className="text-ink">AUTH_ALLOWED_LOGINS</code> in{" "}
            <code className="text-ink">web/.env.local</code>.
          </p>
        </div>
      )}
    </main>
  );
}
