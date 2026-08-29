import Link from "next/link";
import { Logo } from "@/components/logo";

/**
 * Landing-page header: the mark + wordmark on the left, and the two doors on the
 * right — the public source, and sign-in for the people who already have an
 * account.
 *
 * `canSignIn` is threaded down from the page rather than read here, because the
 * page is `force-static` and computes `authConfigured()` at build: a deployment
 * with no auth wired up shows no sign-in door rather than a dead end, exactly as
 * the sign-in page itself renders only the providers that exist.
 */
export function SiteHeader({ canSignIn }: { canSignIn: boolean }) {
  return (
    <header className="border-hairline-soft bg-canvas/80 sticky top-0 z-50 border-b backdrop-blur-[10px]">
      <div className="mx-auto max-w-[1100px] px-lg flex h-[60px] items-center justify-between">
        <Link
          href="/"
          className="gap-xs text-ink hover:text-ink flex items-center"
          aria-label="morgue — home"
        >
          <Logo className="h-6 w-6" />
          <span className="text-headline font-display leading-none tracking-[-0.02em]">
            morgue
          </span>
        </Link>

        <nav className="gap-md flex items-center">
          <a
            href="https://github.com/Clupai8o0/morgue"
            target="_blank"
            rel="noopener noreferrer"
            className="text-body-sm text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
          >
            Source ↗
          </a>
          {canSignIn ? (
            <Link
              href="/signin"
              className="text-button border-hairline text-ink hover:bg-surface-1 rounded-pill px-md inline-block border py-[8px] transition-colors duration-[var(--duration-fast)]"
            >
              Sign in
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
