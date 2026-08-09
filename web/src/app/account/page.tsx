import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { configuredProviders } from "@/auth";
import { AccountPanel } from "@/components/account-panel";
import { localMode } from "@/lib/local";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

/**
 * Access is enforced in proxy.ts — /account is owner-only and is refused to a
 * share cookie before the allowlist is even consulted, the same treatment
 * /admin gets. This component never renders for a shared viewer.
 */
export default function AccountPage() {
  // There is no account to manage in local mode — no row, no password, no
  // address to verify. Doubled with proxy.ts, like /admin.
  if (localMode()) notFound();

  return (
    <main className="mx-auto w-full max-w-[560px] px-lg py-xxl">
      <header className="mb-xl gap-md flex items-baseline justify-between">
        <h1 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Account
        </h1>
        <Link
          href="/vault"
          className="text-micro text-ink-muted hover:text-ink transition-colors"
        >
          vault →
        </Link>
      </header>

      <AccountPanel available={configuredProviders()} />

      <p className="text-micro text-ink-muted mt-xl">
        <Link href="/privacy" className="hover:text-ink underline underline-offset-4">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="hover:text-ink underline underline-offset-4">
          Terms
        </Link>
      </p>
    </main>
  );
}
