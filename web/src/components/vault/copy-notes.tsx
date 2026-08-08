"use client";

import { useState } from "react";

/**
 * Copies notes.md as markdown — the SOURCE, not the rendered text.
 *
 * That is the whole point of the button. The page renders the notes so a human
 * can read them; this hands over the thing that survives being pasted into an
 * editor, an issue, or another agent's context with its tables and fences
 * intact. Selecting the rendered version by hand gives you a table flattened
 * into whitespace.
 *
 * Distinct from `Copy for agent`, which assembles a whole export bundle —
 * provenance, licence, deps, scaffold warnings and source. This is just the
 * prose, for when that is all you wanted.
 */
export function CopyNotes({ markdown }: { markdown: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  }

  return (
    <button
      onClick={copy}
      className="text-micro text-ink-muted hover:text-ink border-hairline-soft hover:border-hairline rounded-pill px-sm shrink-0 border py-[4px] transition-colors duration-[var(--duration-fast)]"
    >
      {state === "copied"
        ? "copied"
        : state === "failed"
          ? "copy failed"
          : "copy markdown"}
    </button>
  );
}
