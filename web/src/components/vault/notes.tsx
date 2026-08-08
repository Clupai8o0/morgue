import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * Renders notes.md.
 *
 * These are the most valuable text in the collection — the sequence tables, the
 * "why this is not extracted" arguments, the coupling hazards with file:line —
 * and until now they were printed with `whitespace-pre-wrap`, which shows the
 * pipe characters of a markdown table and calls it a day. Several notes are
 * more than half table.
 *
 * SERVER-RENDERED. react-markdown produces React elements rather than an HTML
 * string, so there is no `dangerouslySetInnerHTML` here and no client bundle
 * cost. Raw HTML in the source is ignored rather than rendered — no rehype-raw
 * — which is the right default even though every byte of this is ours.
 *
 * WHY A COMPONENT MAP AND NOT @tailwindcss/typography: `prose` ships its own
 * colour, size and spacing scale, which would sit next to the DESIGN.md tokens
 * disagreeing with them. Everything below is expressed in the same tokens as
 * the rest of the app, so a change to the type scale reaches the notes too.
 */

const components: Components = {
  // h1 is rare — the note's own title, which the page already shows as the
  // item title. Rendered a step down from the page h1 so it never competes.
  h1: ({ children }) => (
    <h2 className="text-display-md font-display mt-xl mb-sm first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="text-body-lg font-display mt-xl mb-sm border-hairline-soft pt-md first:mt-0 border-t first:border-t-0 first:pt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-body-sm mt-lg mb-xs font-display">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="text-caption text-ink-muted mt-md mb-xxs uppercase tracking-[0.12em]">
      {children}
    </h5>
  ),

  p: ({ children }) => (
    <p className="text-body mb-sm max-w-[74ch] leading-[1.55]">{children}</p>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      className="text-accent underline decoration-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] underline-offset-2 hover:decoration-[currentColor]"
      // Notes link out to source sites and product pages.
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  ),

  ul: ({ children }) => (
    <ul className="mb-sm ml-md space-y-xxs max-w-[74ch] list-disc">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-sm ml-md space-y-xxs max-w-[74ch] list-decimal">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-body pl-xxs leading-[1.55]">{children}</li>
  ),

  strong: ({ children }) => (
    <strong className="text-ink font-semibold">{children}</strong>
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-hairline pl-md my-md text-ink-muted border-l-2">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="border-hairline-soft my-lg border-t" />,

  // Inline code and fenced blocks arrive as the same element; the fence is
  // distinguished by react-markdown wrapping it in <pre>. Styling the inline
  // case here and resetting it in `pre` keeps one rule for each.
  code: ({ children, className }) => {
    const fenced = /language-/.test(className ?? "");
    if (fenced) return <code className="font-mono">{children}</code>;
    return (
      <code className="bg-surface-2 text-ink rounded-xs px-[5px] py-[1px] font-mono text-[0.9em]">
        {children}
      </code>
    );
  },

  pre: ({ children }) => (
    <pre className="bg-surface-1 border-hairline-soft rounded-md p-sm mb-sm max-w-full overflow-x-auto border text-[0.8125rem] leading-[1.5]">
      {children}
    </pre>
  ),

  // Tables carry the real content in several notes — the preloader timeline,
  // the coupling reports, every measurement. They are also the one thing that
  // can be wider than the column, so each gets its own scroll container rather
  // than pushing the page sideways.
  table: ({ children }) => (
    <div className="mb-md border-hairline-soft rounded-md max-w-full overflow-x-auto border">
      <table className="w-full border-collapse text-left text-[0.8125rem]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-surface-1 text-ink-muted">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="px-sm border-hairline-soft border-b py-[7px] font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-sm border-hairline-soft border-b py-[7px] align-top last:border-b-0">
      {children}
    </td>
  ),
  tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,

  img: ({ src, alt }) =>
    typeof src === "string" ? (
      // eslint-disable-next-line @next/next/no-img-element -- notes may point
      // anywhere, including outside any configured image domain.
      <img src={src} alt={alt ?? ""} className="rounded-md my-md max-w-full" />
    ) : null,
};

export function Notes({ markdown }: { markdown: string }) {
  const md = markdown.trim();
  if (!md) {
    return (
      <p className="text-body text-ink-muted">
        No notes yet — the field exists and this item has not filled it in.
      </p>
    );
  }
  return (
    <div className="[&>*:first-child]:mt-0">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </Markdown>
    </div>
  );
}
