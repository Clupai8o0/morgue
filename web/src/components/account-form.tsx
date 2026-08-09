"use client";

import Link from "next/link";
import { useState } from "react";

type State = "idle" | "sending" | "done" | "error";

const input =
  "border-hairline bg-surface-1 focus:border-ink text-body rounded-pill px-md border py-[12px] transition-colors duration-[var(--duration-fast)] outline-none";
const button =
  "bg-primary text-on-primary rounded-pill text-button px-lg w-full py-[12px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50";

/**
 * The three small account forms: ask for a reset link, set a new password,
 * confirm an email address.
 *
 * One client component rather than three because they are the same shape — one
 * POST, one success message, one error line — and three copies of that would
 * drift. The server pages around them stay server components, so the token in
 * the URL is never handled anywhere but here and the API route.
 */

export function RequestResetForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(body.message ?? "Check your inbox.");
      setState("done");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="border-hairline bg-surface-1 rounded-lg p-md mt-xl border">
        <p className="text-body-sm">{message}</p>
        <p className="text-micro text-ink-muted mt-xs">
          The link works once and expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-xl gap-xs flex flex-col">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        placeholder="you@domain.com"
        aria-label="Email address"
        className={input}
      />
      <button type="submit" disabled={state === "sending"} className={button}>
        {state === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {state === "error" ? (
        <p role="alert" className="text-caption text-grad-coral">
          {message}
        </p>
      ) : null}
      <Link
        href="/signin"
        className="text-micro text-ink-muted hover:text-ink mt-xs self-center transition-colors"
      >
        ← back to sign in
      </Link>
    </form>
  );
}

export function SetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    // Checked here as well as on the server: mismatched confirmation is the
    // one error worth catching before the request, because submitting it
    // SPENDS the single-use token and sends the user back to their inbox.
    if (password !== confirm) {
      setState("error");
      setMessage("Those two passwords don't match.");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/account/reset", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState("done");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="border-hairline bg-surface-1 rounded-lg p-md mt-xl border">
        <p className="text-body-sm">Password set.</p>
        <p className="text-micro text-ink-muted mt-xs">
          Every other session has been signed out.
        </p>
        <Link
          href="/signin"
          className="text-micro text-accent mt-sm inline-block underline underline-offset-4"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-xl gap-xs flex flex-col">
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        placeholder="New password"
        aria-label="New password"
        className={input}
      />
      <input
        type="password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        placeholder="Confirm password"
        aria-label="Confirm password"
        className={input}
      />
      <button type="submit" disabled={state === "sending"} className={button}>
        {state === "sending" ? "Saving…" : "Set password"}
      </button>
      {state === "error" ? (
        <p role="alert" className="text-caption text-grad-coral">
          {message}
        </p>
      ) : (
        <p className="text-micro text-ink-muted">At least 10 characters.</p>
      )}
    </form>
  );
}

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function confirm() {
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/account/verify", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setState("done");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="border-hairline bg-surface-1 rounded-lg p-md mt-xl border">
        <p className="text-body-sm">Address confirmed.</p>
        <Link
          href="/signin"
          className="text-micro text-accent mt-sm inline-block underline underline-offset-4"
        >
          Sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-xl gap-xs flex flex-col">
      {/* A button rather than confirming on page load. Mail clients and link
          scanners fetch URLs they are sent, and a GET that mutates state means
          the scanner spends the token before the person clicks it. */}
      <button onClick={confirm} disabled={state === "sending"} className={button}>
        {state === "sending" ? "Confirming…" : "Confirm this address"}
      </button>
      {state === "error" ? (
        <p role="alert" className="text-caption text-grad-coral">
          {message}
        </p>
      ) : null}
    </div>
  );
}
