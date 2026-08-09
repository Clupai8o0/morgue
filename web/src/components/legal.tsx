import Link from "next/link";

/**
 * Shared shell for /privacy and /terms.
 *
 * Not `@tailwindcss/typography`: that ships a second type and colour scale
 * alongside the one in DESIGN.md, and two scales on one site is how a design
 * system stops being one. Same call as components/vault/notes.tsx.
 */

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-lg py-xxl">
      <Link
        href="/"
        className="text-micro text-ink-muted hover:text-ink mb-xl inline-block transition-colors duration-[var(--duration-fast)]"
      >
        ← morgue
      </Link>

      <h1 className="text-display-md font-display">{title}</h1>
      <p className="text-micro text-ink-muted mt-xs">Last updated {updated}</p>

      <div className="mt-xl">{children}</div>

      <p className="text-micro text-ink-muted mt-xxl">
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

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-caption text-ink-muted uppercase tracking-[0.14em] mt-xl mb-sm">
      {children}
    </h2>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-body-sm mt-sm leading-relaxed">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-sm space-y-xs">{children}</ul>;
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-body-sm pl-md relative leading-relaxed before:absolute before:left-0 before:content-['—'] before:text-ink-muted">
      {children}
    </li>
  );
}

/** For the bit a reader should not skip. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-hairline bg-surface-1 rounded-lg p-md mt-lg border">
      <p className="text-micro text-ink-muted leading-relaxed">{children}</p>
    </div>
  );
}
