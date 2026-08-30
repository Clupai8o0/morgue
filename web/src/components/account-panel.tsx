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
  plan: string;
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
          {me.role === "admin" ? "" : ` · ${me.plan} plan`}
        </p>
        {me.role === "admin" ? null : (
          <a
            href="/upgrade"
            className="text-micro text-accent mt-sm inline-block underline underline-offset-4"
          >
            What you can hold →
          </a>
        )}
      </section>

      <ProfileSection me={me} reload={load} />
      <SignInMethods me={me} available={available} reload={load} />
      <PasswordSection me={me} />
      <McpTokensSection />
      <SessionsSection />
      <ExportSection />
      <DeleteSection me={me} />
    </div>
  );
}

/**
 * Display name, and moving the account to a different address.
 *
 * The two sit together because they are the same idea — what this account is
 * called and where it can be reached — but they behave completely differently.
 * The name saves immediately; the address does nothing at all until a link sent
 * to the NEW mailbox is opened. The copy has to make that difference obvious,
 * because a form that appears to have done nothing is where people click twice.
 */
function ProfileSection({ me, reload }: { me: Me; reload: () => Promise<void> }) {
  const [name, setName] = useState(me.name ?? "");
  const [nameState, setNameState] = useState<"idle" | "saving" | "saved">("idle");
  const [nameProblem, setNameProblem] = useState("");

  const [email, setEmail] = useState("");
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent">("idle");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailProblem, setEmailProblem] = useState("");

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (nameState === "saving") return;
    setNameState("saving");
    setNameProblem("");
    const res = await fetch("/api/account/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || null }),
    });
    if (!res.ok) {
      setNameProblem((await res.json().catch(() => ({}))).error ?? "Could not save.");
      setNameState("idle");
      return;
    }
    await reload();
    setNameState("saved");
  }

  async function requestEmail(e: React.FormEvent) {
    e.preventDefault();
    if (emailState === "sending") return;
    setEmailState("sending");
    setEmailProblem("");
    const res = await fetch("/api/account/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEmailProblem(body.error ?? "Could not send that.");
      setEmailState("idle");
      return;
    }
    setEmailMessage(body.message ?? "Check that inbox.");
    setEmailState("sent");
  }

  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
        Name and address
      </p>

      <form onSubmit={saveName} className="gap-xs mt-md flex flex-col">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameState("idle");
          }}
          maxLength={100}
          placeholder="Display name"
          aria-label="Display name"
          className={input}
        />
        <button type="submit" disabled={nameState === "saving"} className={ghost}>
          {nameState === "saving" ? "Saving…" : nameState === "saved" ? "Saved" : "Save name"}
        </button>
        {nameProblem ? (
          <p role="alert" className="text-caption text-grad-coral">
            {nameProblem}
          </p>
        ) : null}
      </form>

      <div className="border-hairline-soft mt-md pt-md border-t">
        {emailState === "sent" ? (
          <>
            <p className="text-body-sm">{emailMessage}</p>
            <p className="text-micro text-ink-muted mt-xs">
              Your address is still <span className="break-all">{me.email}</span>{" "}
              and stays that way until the link is opened. Nothing has changed
              yet, so a typo here costs you an email and not your account.
            </p>
          </>
        ) : (
          <form onSubmit={requestEmail} className="gap-xs flex flex-col">
            <p className="text-micro text-ink-muted">
              Moving to a different address sends a link there to confirm it.
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="new@domain.com"
              aria-label="New email address"
              className={input}
            />
            <button type="submit" disabled={emailState === "sending"} className={ghost}>
              {emailState === "sending" ? "Sending…" : "Send confirmation"}
            </button>
            {emailProblem ? (
              <p role="alert" className="text-caption text-grad-coral">
                {emailProblem}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </section>
  );
}

/**
 * Ending every session, and ending this one.
 *
 * Both controls live here because "sign out" and "sign out everywhere" are
 * neighbouring ideas and shipping only the second one reads as a missing
 * feature. The ordinary one is a plain link to the Auth.js endpoint, which the
 * proxy matcher excludes, so it needs nothing of ours.
 */
function SessionsSection() {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [problem, setProblem] = useState("");

  async function endAll() {
    if (state === "working") return;
    setState("working");
    setProblem("");
    const res = await fetch("/api/account/sessions", { method: "DELETE" });
    if (!res.ok) {
      setProblem((await res.json().catch(() => ({}))).error ?? "Could not do that.");
      setState("idle");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <section className={card}>
        <p className="text-body-sm">Every session is ending.</p>
        <p className="text-micro text-ink-muted mt-xs">
          Including this one — there is no way to keep the session that asked,
          which is what makes it worth doing after losing a device. It can take
          up to a minute to take effect everywhere.
        </p>
        <a
          href="/signin"
          className="text-micro text-accent mt-sm inline-block underline underline-offset-4"
        >
          Sign in again →
        </a>
      </section>
    );
  }

  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">Sessions</p>
      <p className="text-micro text-ink-muted mt-xs">
        Signing out everywhere ends this session too, and takes up to a minute
        to reach the others.
      </p>
      <div className="gap-xs mt-md flex flex-wrap">
        {/* An endpoint, not a page, and it must be a real navigation: next/link
            would client-route it and prefetch it, and a prefetched sign-out is
            a sign-out nobody asked for. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/auth/signout" className={ghost}>
          Sign out
        </a>
        <button onClick={endAll} disabled={state === "working"} className={ghost}>
          {state === "working" ? "…" : "Sign out everywhere"}
        </button>
      </div>
      {problem ? (
        <p role="alert" className="text-caption text-grad-coral mt-sm">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Per-user API tokens for the MCP server.
 *
 * The one place in this app that shows a secret. A minted token is returned
 * once by the API and then only its hash is stored, so this section reveals it
 * inline with a copy control and never claims to be able to show it again — the
 * same "copy it now" contract the share-link minting UI uses. Listing and
 * revoking follow the ordinary account-panel shape (fetch to the API route,
 * reload the list), not share-admin's server actions.
 */
interface TokenView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function McpTokensSection() {
  const [tokens, setTokens] = useState<TokenView[] | null>(null);
  const [max, setMax] = useState(20);
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "creating">("idle");
  const [problem, setProblem] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/account/mcp-tokens");
    if (res.ok) {
      const body = await res.json();
      setTokens(body.tokens ?? []);
      setMax(body.max ?? 20);
    } else {
      setProblem("Could not load your tokens.");
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const endpoint =
    typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (state === "creating" || !name.trim()) return;
    setState("creating");
    setProblem("");
    setMinted(null);
    setCopied(false);
    const res = await fetch("/api/account/mcp-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setProblem(body.error ?? "Could not create a token.");
      setState("idle");
      return;
    }
    setMinted(body.token);
    setName("");
    setState("idle");
    await load();
  }

  async function copy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setProblem("Clipboard refused — select the token and copy it by hand.");
    }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(id);
    setProblem("");
    const res = await fetch("/api/account/mcp-tokens", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      setProblem((await res.json().catch(() => ({}))).error ?? "Could not revoke that.");
    } else {
      await load();
    }
    setBusy("");
  }

  const count = tokens?.length ?? 0;

  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">MCP access</p>
      <p className="text-micro text-ink-muted mt-xs">
        A token lets a coding agent search the vault and pull components through
        the MCP server. Point your agent at{" "}
        <code className="text-ink break-all">{endpoint}</code> and send the token
        as <code className="text-ink">Authorization: Bearer …</code>.
      </p>

      {minted ? (
        <div className="border-hairline-soft bg-canvas rounded-md p-sm mt-md border">
          <p className="text-body-sm mb-xs">
            Copy it now — it is shown once and never stored anywhere we can show
            you again.
          </p>
          <div className="gap-xs flex items-center">
            <code className="bg-surface-1 border-hairline-soft rounded-md px-sm text-micro min-w-0 flex-1 truncate border py-[8px]">
              {minted}
            </code>
            <button onClick={copy} className={`${primary} shrink-0 px-md py-[8px]`}>
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={create} className="gap-xs mt-md flex flex-col">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Name this token — e.g. cursor on my laptop"
          aria-label="Token name"
          className={input}
        />
        <button
          type="submit"
          disabled={state === "creating" || !name.trim() || count >= max}
          className={ghost}
        >
          {state === "creating" ? "Creating…" : "Create token"}
        </button>
      </form>

      {tokens && tokens.length > 0 ? (
        <ul className="border-hairline-soft mt-md space-y-xs pt-md border-t">
          {tokens.map((t) => (
            <li key={t.id} className="gap-sm flex items-center justify-between">
              <span className="min-w-0">
                <span className="text-body-sm block truncate">{t.name}</span>
                <span className="text-micro text-ink-muted">
                  {t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
                  {" · added "}
                  {new Date(t.createdAt).toLocaleDateString()}
                </span>
              </span>
              <button
                onClick={() => revoke(t.id)}
                disabled={busy === t.id}
                className={`${ghost} shrink-0`}
              >
                {busy === t.id ? "…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-micro text-ink-muted mt-sm">
          {tokens === null ? "Loading…" : "No tokens yet."}
        </p>
      )}

      {count >= max ? (
        <p className="text-micro text-ink-muted mt-sm">
          You have the maximum of {max}. Revoke one to create another.
        </p>
      ) : null}

      {problem ? (
        <p role="alert" className="text-caption text-grad-coral mt-sm">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/** A plain download. No fetch, no state — the route sets the filename. */
function ExportSection() {
  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
        Your data
      </p>
      <p className="text-micro text-ink-muted mt-xs">
        Your account, how you sign in, your share links and anything you have
        asked us for — as JSON. It does not include the collection: items belong
        to the owner&rsquo;s vault and none of them is yours to take.
      </p>
      <a href="/api/account/export" download className={`${ghost} mt-md inline-block`}>
        Download
      </a>
    </section>
  );
}

/**
 * Deleting the account.
 *
 * Last, and gated on typing the address. There is no danger colour in the token
 * set — coral is the error colour and accent is for links — so this is
 * distinguished by position, by the confirmation it demands, and by saying
 * plainly what survives.
 */
function DeleteSection({ me }: { me: Me }) {
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "deleting" | "gone">("idle");
  const [problem, setProblem] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "deleting") return;
    setState("deleting");
    setProblem("");
    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    if (!res.ok) {
      setProblem((await res.json().catch(() => ({}))).error ?? "Could not delete.");
      setState("idle");
      return;
    }
    setState("gone");
  }

  if (state === "gone") {
    return (
      <section className={card}>
        <p className="text-body-sm">Your account is gone.</p>
        <p className="text-micro text-ink-muted mt-xs">
          Everything we held about you has been removed, and any share links you
          issued have been revoked. If you were on the waitlist, that record went
          too, so coming back means asking again.
        </p>
        {/* A full navigation on purpose: the account behind this session no
            longer exists, so a client transition would carry dead state into
            the next page. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="text-micro text-accent mt-sm inline-block underline underline-offset-4"
        >
          ← morgue
        </a>
      </section>
    );
  }

  return (
    <section className={card}>
      <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
        Delete this account
      </p>
      <p className="text-micro text-ink-muted mt-xs">
        Permanent, and immediate. Your share links stop working, and your
        waitlist record goes with it. Type{" "}
        <span className="text-ink break-all">{me.email}</span> to confirm.
      </p>

      <form onSubmit={submit} className="gap-xs mt-md flex flex-col">
        <input
          type="email"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          placeholder="Type your email address"
          aria-label="Type your email address to confirm deletion"
          className={input}
        />
        <button
          type="submit"
          disabled={state === "deleting" || confirm.length === 0}
          className={ghost}
        >
          {state === "deleting" ? "Deleting…" : "Delete my account"}
        </button>
        {problem ? (
          <p role="alert" className="text-caption text-grad-coral">
            {problem}
          </p>
        ) : null}
      </form>
    </section>
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
