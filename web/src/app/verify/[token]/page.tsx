import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmEmailForm } from "@/components/account-form";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyTokenPage({ params }: PageProps<"/verify/[token]">) {
  const { token } = await params;

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-lg py-section">
      <Link
        href="/signin"
        className="text-micro text-ink-muted hover:text-ink mb-xl transition-colors duration-[var(--duration-fast)]"
      >
        ← sign in
      </Link>

      <h1 className="text-display-md font-display">Confirm your email.</h1>
      <p className="text-body text-ink-muted mt-md">
        One click and the address is verified. You can then sign in with your
        password.
      </p>

      <ConfirmEmailForm token={token} />
    </main>
  );
}
