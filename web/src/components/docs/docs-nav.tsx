"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The docs section nav. A client component only because it reads usePathname to
 * mark the current page — the pages themselves stay force-static.
 *
 * One list rendered two ways: a sticky vertical rail on lg+, and a horizontally
 * scrolling row of the same items below the header on narrow screens. No
 * duplicated markup, so the two can never drift.
 */

export const DOCS_SECTIONS = [
  { href: "/docs", label: "Quickstart" },
  { href: "/docs/adding", label: "Adding components" },
  { href: "/docs/retrieving", label: "Retrieving components" },
  { href: "/docs/reference", label: "Reference" },
] as const;

export function DocsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Documentation sections"
      className="gap-xs lg:sticky lg:top-[76px] flex overflow-x-auto pb-xs lg:flex-col lg:overflow-visible lg:pb-0"
    >
      <div className="text-micro text-ink-muted mb-xs hidden uppercase tracking-[0.14em] lg:block">
        Documentation
      </div>
      {DOCS_SECTIONS.map((s) => {
        const active = pathname === s.href;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={[
              "text-body-sm whitespace-nowrap rounded-md px-sm py-[8px] transition-colors duration-[var(--duration-fast)]",
              "lg:rounded-none lg:border-l lg:pl-md lg:pr-sm",
              active
                ? "text-ink bg-surface-1 lg:bg-transparent lg:border-l-accent"
                : "text-ink-muted hover:text-ink lg:border-l-hairline-soft",
            ].join(" ")}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Prev / next footer within the docs, driven by DOCS_SECTIONS order. */
export function PageNav({ current }: { current: string }) {
  const i = DOCS_SECTIONS.findIndex((s) => s.href === current);
  const prev = i > 0 ? DOCS_SECTIONS[i - 1] : null;
  const next =
    i >= 0 && i < DOCS_SECTIONS.length - 1 ? DOCS_SECTIONS[i + 1] : null;

  return (
    <div className="border-hairline-soft mt-xxl gap-md flex flex-wrap justify-between border-t pt-xl">
      {prev ? (
        <Link
          href={prev.href}
          className="group text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
        >
          <div className="text-micro uppercase tracking-[0.14em]">Previous</div>
          <div className="text-body-sm mt-xxs flex items-center gap-xs">
            <span className="transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-expo)] group-hover:-translate-x-1">
              ←
            </span>
            {prev.label}
          </div>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group text-ink-muted hover:text-ink text-right transition-colors duration-[var(--duration-fast)]"
        >
          <div className="text-micro uppercase tracking-[0.14em]">Next</div>
          <div className="text-body-sm mt-xxs flex items-center justify-end gap-xs">
            {next.label}
            <span className="transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-expo)] group-hover:translate-x-1">
              →
            </span>
          </div>
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
