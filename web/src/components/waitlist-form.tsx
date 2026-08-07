"use client";

import { useState } from "react";

type State = "idle" | "sending" | "done" | "error";

/**
 * Request-access form. Deliberately a waitlist and nothing more: there are no
 * accounts, no uploads and no storage for anyone but the owner. Submitting
 * records an email and notifies the owner — that is the entire feature.
 *
 * Posts to /api/waitlist, which lands with the database task.
 */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setState("done");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="border-hairline bg-surface-1 rounded-xl p-lg border">
        <p className="text-display-md font-display">You&apos;re on the list.</p>
        <p className="text-body text-ink-muted mt-xs">
          No account has been created and nothing is stored beyond your email.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="gap-sm flex flex-col">
      <div className="gap-xs flex flex-col sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.com"
          aria-label="Email address"
          className="border-hairline bg-surface-1 focus:border-ink text-body rounded-pill px-md min-w-0 flex-1 border py-[12px] transition-colors duration-[var(--duration-fast)] outline-none"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="bg-primary text-on-primary rounded-pill text-button px-lg py-[12px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.03] active:scale-[0.98] disabled:opacity-50"
        >
          {state === "sending" ? "Sending…" : "Request access"}
        </button>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What would you use it for? (optional)"
        aria-label="Note"
        className="border-hairline bg-surface-1 focus:border-ink text-body-sm rounded-lg px-md border py-[10px] transition-colors duration-[var(--duration-fast)] outline-none"
      />

      {state === "error" ? (
        <p className="text-caption text-grad-coral">{message}</p>
      ) : (
        <p className="text-micro text-ink-muted">
          The collection itself stays private — this is access to the tool, not
          to someone else&apos;s licensed components.
        </p>
      )}
    </form>
  );
}
