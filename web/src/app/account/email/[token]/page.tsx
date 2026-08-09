import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmEmailChangeForm } from "@/components/account-form";

export const metadata: Metadata = { title: "Confirm your new email" };

/**
 * Completing an email change.
 *
 * This sits under /account deliberately, so proxy.ts already requires a session
 * and already refuses a share cookie. Confirming therefore needs BOTH the
 * session and the new mailbox, which is what makes the token safe to mail: on
 * its own it moves nothing.
 *
 * The cost is that opening the link in a browser you are not signed into asks
 * you to sign in first. That is the intended trade — the alternative is a
 * public completion route, which would have to carry the whole check itself.
 */
export default async function ConfirmEmailChangePage({
  params,
}: PageProps<"/account/email/[token]">) {
  const { token } = await params;

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-lg py-section">
      <Link
        href="/account"
        className="text-micro text-ink-muted hover:text-ink mb-xl transition-colors duration-[var(--duration-fast)]"
      >
        ← account
      </Link>

      <h1 className="text-display-md font-display">Confirm your new email.</h1>
      <p className="text-body text-ink-muted mt-md">
        You are reading this at the address you asked to move to, which is the
        proof this needs. Nothing has changed yet.
      </p>

      <ConfirmEmailChangeForm token={token} />
    </main>
  );
}
