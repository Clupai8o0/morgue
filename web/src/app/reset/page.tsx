import type { Metadata } from "next";
import Link from "next/link";
import { RequestResetForm } from "@/components/account-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ResetRequestPage() {
  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-lg py-section">
      <Link
        href="/signin"
        className="text-micro text-ink-muted hover:text-ink mb-xl transition-colors duration-[var(--duration-fast)]"
      >
        ← sign in
      </Link>

      <h1 className="text-display-md font-display">Reset your password.</h1>
      <p className="text-body text-ink-muted mt-md">
        This is also how you set one for the first time — an account created for
        you by an admin has no password until you choose it here.
      </p>

      <RequestResetForm />
    </main>
  );
}
