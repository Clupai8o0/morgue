"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Connected sign-in methods, and the password.
 *
 * The whole point of this panel is that one person with a GitHub account, a
 * Google account and a password ends up with ONE morgue account. Connecting is
 * a normal sign-in — the server notices there is already a session and links
 * rather than matching on email, which is what lets a work GitHub address and
 * a personal Google address land on the same vault.
 */

interface Me {
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  providers: string[];
  hasPassword: boolean;
  canRemoveOne: boolean;
}

const PROVIDERS = [
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
] as const;

const card = "border-hairline bg-surface-1 rounded-lg p-md border";
const input =
  "border-hairline bg-surface-1 focus:border-ink text-body rounded-pill px-md border py-[10px] transition-colors duration-[var(--duration-fast)] outline-none";
const primary =
  "bg-primary text-on-primary rounded-pill text-button px-lg py-[10px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50";
const ghost =
  "text-micro border-hairline text-ink-muted hover:text-ink rounded-pill px-sm border py-[6px] transition-colors duration-[var(--duration-fast)] disabled:opacity-40";

export function AccountPanel({ available }: { available: string[] }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/account/me");
    if (res.ok) setMe(await res.json());
    else setError("Could not load your account.");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-caption text-grad-coral">{error}</p>;
  if (!me) return <p className="text-body-sm text-ink-muted">Loading…</p>;

  return (
    <div className="gap-md mt-xl flex flex-col">
      <section className={card}>
        <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">Account</p>
        <p className="text-body mt-xs break-all">{me.email}</p>
        <p className="text-micro text-ink-muted mt-xxs">
          {me.role === "admin" ? "admin · " : ""}
          {me.emailVerified ? "email confirmed" : "email not confirmed yet"}
        </p>
      </section>

      <SignInMethods me={me} available={available} reload={load} />
      <PasswordSection me={me} />
    </div>
  );
}

function SignInMethods({
  me,
  available,
  reload,
}: {
  me: Me;
  available: string[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");

  async function disconnect(provider: string) {
    setBusy(provider);
    setProblem("");
    const res = await fetch("/api/account/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    if (!res.ok) setProblem((await res.json().catch(() => ({}))).error ?? "Could not disconnect.");
    else await reload();
    setBusy("");
  }

  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
        Ways to sign in
      </p>
      <p className="text-micro text-ink-muted mt-xs">
        Connect as many as you like — they all open this same vault. Nothing
        here creates a second account.
      </p>

      <ul className="mt-md space-y-xs">
        {PROVIDERS.filter((p) => available.includes(p.id)).map((p) => {
          const connected = me.providers.includes(p.id);
          return (
            <li key={p.id} className="gap-sm flex items-center justify-between">
              <span className="text-body-sm">
                {p.label}
                {connected ? (
                  <span className="text-micro text-success ml-xs">connected</span>
                ) : null}
              </span>

              {connected ? (
                <button
                  onClick={() => disconnect(p.id)}
                  disabled={busy === p.id || !me.canRemoveOne}
                  title={
                    me.canRemoveOne
                      ? undefined
                      : "This is the only way you can sign in."
                  }
                  className={ghost}
                >
                  {busy === p.id ? "…" : "Disconnect"}
                </button>
              ) : (
                // A plain sign-in link. The server sees an existing session and
                // links instead of matching on email, so the addresses do not
                // have to agree.
                <a
                  href={`/api/auth/signin/${p.id}?callbackUrl=${encodeURIComponent("/account")}`}
                  className={ghost}
                >
                  Connect
                </a>
              )}
            </li>
          );
        })}

        <li className="gap-sm flex items-center justify-between">
          <span className="text-body-sm">
            Email and password
            {me.hasPassword ? (
              <span className="text-micro text-success ml-xs">set</span>
            ) : (
              <span className="text-micro text-ink-muted ml-xs">not set</span>
            )}
          </span>
        </li>
      </ul>

      {problem ? (
        <p role="alert" className="text-caption text-grad-coral mt-sm">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

function PasswordSection({ me }: { me: Me }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [problem, setProblem] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "saving") return;
    if (next !== confirm) {
      setProblem("Those two passwords don't match.");
      return;
    }
    setState("saving");
    setProblem("");
    const res = await fetch("/api/account/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: current || undefined, password: next }),
    });
    if (!res.ok) {
      setProblem((await res.json().catch(() => ({}))).error ?? "Could not save.");
      setState("idle");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <section className={card}>
        <p className="text-body-sm">Password saved.</p>
        <p className="text-micro text-ink-muted mt-xs">
          Every session was signed out, including this one — that is what makes
          a password change useful after losing a device.
          {me.emailVerified
            ? ""
            : " Your email is still unconfirmed, so password sign-in stays refused until you open the link at /reset."}
        </p>
        <a href="/signin" className="text-micro text-accent mt-sm inline-block underline underline-offset-4">
          Sign in again →
        </a>
      </section>
    );
  }

  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
        {me.hasPassword ? "Change your password" : "Set a password"}
      </p>

      <form onSubmit={submit} className="gap-xs mt-md flex flex-col">
        {me.hasPassword ? (
          <input
            type="password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            placeholder="Current password"
            aria-label="Current password"
            className={input}
          />
        ) : null}
        <input
          type="password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
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
          placeholder="Confirm new password"
          aria-label="Confirm new password"
          className={input}
        />
        <button type="submit" disabled={state === "saving"} className={primary}>
          {state === "saving" ? "Saving…" : me.hasPassword ? "Change password" : "Set password"}
        </button>
        {problem ? (
          <p role="alert" className="text-caption text-grad-coral">
            {problem}
          </p>
        ) : (
          <p className="text-micro text-ink-muted">
            At least 10 characters. Saving signs you out everywhere.
          </p>
        )}
      </form>
    </section>
  );
}
