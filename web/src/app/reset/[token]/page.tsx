import type { Metadata } from "next";
import Link from "next/link";
import { SetPasswordForm } from "@/components/account-form";

export const metadata: Metadata = { title: "Choose a password" };

/**
 * The token is rendered into a client component and never looked up here.
 *
 * Validating it on this page would mean either checking it without consuming
 * it — two round trips and a race — or consuming it to draw a form the user
 * has not filled in yet, which spends the link on a page view. So the page is
 * dumb, and the single PUT is the only thing that touches the token.
 */
export default async function ResetTokenPage({ params }: PageProps<"/reset/[token]">) {
  const { token } = await params;

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-lg py-section">
      <Link
        href="/signin"
        className="text-micro text-ink-muted hover:text-ink mb-xl transition-colors duration-[var(--duration-fast)]"
      >
        ← sign in
      </Link>

      <h1 className="text-display-md font-display">Choose a password.</h1>
      <p className="text-body text-ink-muted mt-md">
        Setting it signs out every other session on the account.
      </p>

      <SetPasswordForm token={token} />
    </main>
  );
}
