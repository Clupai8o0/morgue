"use client";

import { useState } from "react";

const input =
  "border-hairline bg-surface-1 focus:border-ink text-body rounded-lg px-md border py-[10px] transition-colors duration-[var(--duration-fast)] outline-none";
const primary =
  "bg-primary text-on-primary rounded-pill text-button px-lg py-[10px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50";

/**
 * Asking for a bigger cap.
 *
 * There is no payment step, so this is a message rather than a transaction, and
 * the copy should not pretend otherwise. `alreadyPending` renders exactly the
 * same terminal state as a fresh request: someone who forgot they already asked
 * should be told they are in the queue, not made to wonder whether it worked.
 */
export function UpgradeRequest({ pending }: { pending: boolean }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "asked">(
    pending ? "asked" : "idle",
  );
  const [problem, setProblem] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setProblem("");
    const res = await fetch("/api/account/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: note.trim() || null }),
    });
    if (!res.ok) {
      setProblem((await res.json().catch(() => ({}))).error ?? "Could not send that.");
      setState("idle");
      return;
    }
    setState("asked");
  }

  if (state === "asked") {
    return (
      <div className="border-hairline bg-surface-1 rounded-lg p-md border">
        <p className="text-body-sm">Asked. You&rsquo;ll hear back by email.</p>
        <p className="text-micro text-ink-muted mt-xs">
          A person reads these, so it is not instant. Asking again while one is
          open does nothing — you are already in the queue.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-hairline bg-surface-1 rounded-lg p-md gap-xs flex flex-col border">
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
        Need more room
      </p>
      <p className="text-micro text-ink-muted">
        There is nothing to buy. Say what you need and the owner raises your cap
        by hand.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="What are you storing? (optional)"
        aria-label="What you need, optional"
        className={`${input} mt-xs resize-y`}
      />
      <button type="submit" disabled={state === "sending"} className={primary}>
        {state === "sending" ? "Asking…" : "Request upgrade"}
      </button>
      {problem ? (
        <p role="alert" className="text-caption text-grad-coral">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
