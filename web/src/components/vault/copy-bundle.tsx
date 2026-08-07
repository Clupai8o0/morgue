"use client";

import { useState } from "react";

/**
 * Copies the agent-ready markdown bundle.
 *
 * The bundle is assembled on the server and passed down whole rather than
 * fetched on click — it is a few KB, and a copy button that has to await a
 * network round trip before the clipboard fills loses the paste in whatever
 * the user tabbed to in the meantime.
 */
export function CopyBundle({ bundle, slug }: { bundle: string; slug: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(bundle);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  }

  return (
    <div className="gap-xs flex flex-wrap items-center">
      <button
        onClick={copy}
        className="bg-primary text-on-primary rounded-pill text-button px-md py-[10px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.03] active:scale-[0.98]"
      >
        {state === "copied"
          ? "Copied — paste into your agent"
          : state === "failed"
            ? "Copy failed"
            : "Copy for agent"}
      </button>
      <a
        href={`data:text/markdown;charset=utf-8,${encodeURIComponent(bundle)}`}
        download={`${slug}.md`}
        className="text-micro text-ink-muted hover:text-ink px-sm transition-colors duration-[var(--duration-fast)]"
      >
        download .md
      </a>
      <span className="text-micro text-ink-muted tabular-nums">
        {(bundle.length / 1024).toFixed(1)}KB
      </span>
    </div>
  );
}
