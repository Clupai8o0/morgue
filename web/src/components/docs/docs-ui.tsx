import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";

/**
 * Prose + structural primitives for /docs.
 *
 * Server-safe (no hooks), so they compose into the force-static docs pages. The
 * same call as components/legal.tsx: NOT @tailwindcss/typography, because that
 * ships a second type and colour scale alongside the one in globals.css, and two
 * scales on one site is how a design system stops being one. Everything here is
 * one of the DESIGN.md tokens.
 *
 * The interactive nav lives in docs-nav.tsx (it needs usePathname); the motion
 * wrappers (Reveal, Magnetic) come from components/motion.
 */

/* ── Structure ─────────────────────────────────────────────────────────────*/

/** The small tracked label above a heading. accent for a page eyebrow, muted for a section. */
export function Eyebrow({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "accent" | "muted";
}) {
  return (
    <p
      className={`text-caption mb-md uppercase tracking-[0.14em] ${tone === "accent" ? "text-accent" : "text-ink-muted"}`}
    >
      {children}
    </p>
  );
}

/** A docs page header: eyebrow + display heading + a lead paragraph. */
export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
}) {
  return (
    <header className="pt-section pb-xl">
      <Eyebrow tone="accent">{eyebrow}</Eyebrow>
      <h1 className="text-display-lg font-display max-w-[18ch]">{title}</h1>
      {lead ? (
        <p className="text-body-lg text-ink-muted mt-lg max-w-[60ch]">{lead}</p>
      ) : null}
    </header>
  );
}

/** A titled content block, faded up on first view. The default rhythm unit. */
export function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Reveal>
      <section
        id={id}
        className="border-hairline-soft py-xxl scroll-mt-[80px] border-t"
      >
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        {title ? (
          <h2 className="text-display-md font-display max-w-[24ch]">{title}</h2>
        ) : null}
        <div className={title || eyebrow ? "mt-lg" : ""}>{children}</div>
      </section>
    </Reveal>
  );
}

/** A sub-heading inside a section. */
export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-headline font-display mt-xl mb-sm first:mt-0">
      {children}
    </h3>
  );
}

/* ── Prose ─────────────────────────────────────────────────────────────────*/

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-body text-ink-muted mt-md max-w-[64ch] leading-relaxed">
      {children}
    </p>
  );
}

/** For the sentence that opens a section and should read louder than the body. */
export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-body-lg text-ink-muted mt-md max-w-[60ch] leading-relaxed">
      {children}
    </p>
  );
}

export function UL({ children }: { children: React.ReactNode }) {
  // role="list" restored: Tailwind's preflight sets list-style:none (LI draws
  // its own em-dash), which strips the list role in WebKit/VoiceOver.
  return (
    <ul role="list" className="mt-md space-y-sm max-w-[64ch]">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: React.ReactNode }) {
  return (
    <li
      role="listitem"
      className="text-body text-ink-muted pl-md relative leading-relaxed before:absolute before:left-0 before:text-ink-muted before:content-['—']"
    >
      {children}
    </li>
  );
}

/** Inline code — the one place body copy is allowed to go ink-bright. */
export function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-ink bg-surface-1 rounded-xs px-[5px] py-[1px] text-[0.9em] tabular-nums">
      {children}
    </code>
  );
}

/** A named link, styled as the system's one decorative accent use. */
export function A({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls =
    "text-accent underline underline-offset-4 hover:text-ink transition-colors duration-[var(--duration-fast)]";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/* ── Code ──────────────────────────────────────────────────────────────────*/

/**
 * A fenced code block with an optional filename/lang label bar. Same surface as
 * the landing's <pre> — border-hairline bg-surface-1 — plus the label chrome.
 * Always scrolls inside its own box rather than widening the page.
 */
export function CodeBlock({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-hairline bg-surface-1 rounded-lg mt-lg overflow-hidden border">
      {label ? (
        <div className="border-hairline-soft text-micro text-ink-muted px-md py-xs border-b tabular-nums">
          {label}
        </div>
      ) : null}
      {/* tabIndex makes the horizontally-scrolling box reachable by keyboard —
          a <pre> does not wrap, so a clipped line is otherwise unreadable
          without a mouse (WCAG 2.1.1). role="group" + label, not "region", so
          many code blocks do not each become a landmark. */}
      <pre
        tabIndex={0}
        role="group"
        aria-label={label ?? "Code sample"}
        className="text-caption p-md overflow-x-auto leading-relaxed"
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}

/**
 * A shell command block. Each line is prefixed with a non-selectable `$` so the
 * prompt does not travel into the clipboard when the command is copied.
 */
export function Cmd({ lines }: { lines: string[] }) {
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label="Shell commands"
      className="border-hairline bg-surface-1 rounded-lg mt-lg overflow-x-auto border"
    >
      <pre className="text-caption p-md leading-relaxed">
        <code>
          {lines.map((line, i) => (
            <span key={i} className="block">
              <span className="text-ink-muted select-none">$ </span>
              <span className="text-ink">{line}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/* ── Callout ───────────────────────────────────────────────────────────────*/

/** The bit a reader should not skip. `warn` earns the accent rail. */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-surface-1 rounded-lg p-md mt-lg border ${tone === "warn" ? "border-hairline border-l-2 border-l-accent" : "border-hairline"}`}
    >
      {title ? (
        <div className="text-body-sm text-ink mb-xs font-medium">{title}</div>
      ) : null}
      <div className="text-body-sm text-ink-muted leading-relaxed [&_a]:text-accent">
        {children}
      </div>
    </div>
  );
}

/* ── Cards ─────────────────────────────────────────────────────────────────*/

/** A card that links somewhere — used for the quickstart section index. */
export function LinkCard({
  href,
  eyebrow,
  title,
  children,
}: {
  href: string;
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group border-hairline bg-surface-1 rounded-xxl p-lg hover:bg-surface-2 flex h-full flex-col border transition-colors duration-[var(--duration-fast)]"
    >
      {eyebrow ? (
        <div className="text-micro text-ink-muted mb-sm uppercase tracking-[0.14em]">
          {eyebrow}
        </div>
      ) : null}
      <div className="text-subhead font-display flex items-center gap-xs">
        {title}
        <span className="text-ink-muted transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-expo)] group-hover:translate-x-1">
          →
        </span>
      </div>
      <p className="text-body-sm text-ink-muted mt-xs leading-relaxed">
        {children}
      </p>
    </Link>
  );
}

/* ── Vocabulary tables ─────────────────────────────────────────────────────*/

/** value → meaning, the shape every reference table takes. */
export function VocabTable({
  head = "Value",
  rows,
}: {
  head?: string;
  rows: [string, React.ReactNode][];
}) {
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${head} values`}
      className="mt-lg overflow-x-auto"
    >
      <table className="text-body-sm w-full min-w-[440px] border-collapse">
        <thead>
          <tr className="text-ink-muted text-micro border-hairline border-b uppercase tracking-[0.1em]">
            <th className="py-sm pr-md text-left font-medium">{head}</th>
            <th className="py-sm text-left font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([value, meaning]) => (
            <tr key={value} className="border-hairline-soft border-b align-top">
              <td className="py-sm pr-md">
                <code className="text-ink whitespace-nowrap">{value}</code>
              </td>
              <td className="py-sm text-ink-muted leading-relaxed">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A row of vocabulary values as pills — for the short enum lists. */
export function TagRow({ values }: { values: string[] }) {
  return (
    <div className="gap-xs mt-md flex flex-wrap">
      {values.map((v) => (
        <code
          key={v}
          className="border-hairline bg-surface-1 text-ink rounded-pill px-sm py-[4px] text-caption"
        >
          {v}
        </code>
      ))}
    </div>
  );
}
