"use client";

import { useState } from "react";

/**
 * Mint a read-only share link and hand back the URL.
 *
 * Two decisions worth keeping:
 *
 * The link is shown ONCE and never fetched again. The server does not store
 * the token — only its hash — so there is no endpoint that could re-display it
 * later even if one were wanted. The copy affordance is therefore right here,
 * and the panel says so.
 *
 * `revocable` comes back from the server and is surfaced immediately. Without
 * DATABASE_URL a link is perfectly valid and completely un-listable, and
 * finding that out weeks later while trying to cut someone off is the failure
 * this sentence exists to prevent.
 */

const TTLS = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

interface Minted {
  url: string;
  expiresAt: string;
  revocable: boolean;
}

export function ShareLink({
  scope,
  slug,
  className = "",
}: {
  scope: "vault" | "item";
  slug?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(24 * 7);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, slug, ttlHours: hours, label: label || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the link.");
      } else {
        setMinted({
          url: new URL(data.url, location.origin).toString(),
          expiresAt: data.expiresAt,
          revocable: Boolean(data.revocable),
        });
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  async function copy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setError("Clipboard refused — select the link and copy it by hand.");
    }
  }

  function reset() {
    setOpen(false);
    setMinted(null);
    setError(null);
    setLabel("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`text-micro text-ink-muted hover:text-ink border-hairline-soft hover:border-hairline rounded-pill px-sm shrink-0 border py-[4px] transition-colors duration-[var(--duration-fast)] ${className}`}
      >
        share read-only
      </button>
    );
  }

  return (
    <div className="bg-surface-1 border-hairline-soft rounded-lg p-md mt-xs w-full max-w-[520px] border">
      <div className="mb-sm flex items-baseline justify-between">
        <h3 className="text-caption uppercase tracking-[0.14em]">
          {scope === "vault" ? "Share the whole vault" : "Share this item"}
        </h3>
        <button
          onClick={reset}
          className="text-micro text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
        >
          close
        </button>
      </div>

      {!minted ? (
        <>
          <p className="text-body-sm text-ink-muted mb-sm">
            Read-only. The holder can browse
            {scope === "vault" ? " every item" : " this one item"} and copy its
            export bundle. They cannot reach the admin page or create links of
            their own.
          </p>

          <label className="text-micro text-ink-muted mb-xxs block uppercase tracking-[0.12em]">
            expires after
          </label>
          <div className="gap-xxs mb-sm flex flex-wrap">
            {TTLS.map((t) => (
              <button
                key={t.hours}
                onClick={() => setHours(t.hours)}
                className={`text-micro rounded-pill px-sm border py-[5px] transition-colors duration-[var(--duration-fast)] ${
                  hours === t.hours
                    ? "bg-primary text-on-primary border-primary"
                    : "border-hairline-soft text-ink-muted hover:text-ink hover:border-hairline"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="text-micro text-ink-muted mb-xxs block uppercase tracking-[0.12em]">
            who is it for <span className="normal-case">(optional, for your records)</span>
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            placeholder="e.g. studio pitch, Alex"
            className="bg-canvas border-hairline-soft rounded-md px-sm text-body-sm mb-sm focus:border-hairline w-full border py-[8px] outline-none"
          />

          <button
            onClick={create}
            disabled={busy}
            className="bg-primary text-on-primary rounded-pill text-button px-md py-[9px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.03] active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "creating…" : "create link"}
          </button>
        </>
      ) : (
        <>
          <p className="text-body-sm mb-xs">
            Copy it now — it is shown once and never stored in a form we can
            show you again.
          </p>
          <div className="gap-xs mb-sm flex items-center">
            <code className="bg-canvas border-hairline-soft rounded-md px-sm text-micro min-w-0 flex-1 truncate border py-[8px]">
              {minted.url}
            </code>
            <button
              onClick={copy}
              className="bg-primary text-on-primary rounded-pill text-button px-md shrink-0 py-[8px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.03] active:scale-[0.98]"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
          <p className="text-micro text-ink-muted">
            Expires {new Date(minted.expiresAt).toLocaleString()}.
          </p>
          {!minted.revocable ? (
            <p className="text-micro text-ink-muted mt-xxs border-hairline-soft pt-xs border-t">
              <span className="text-ink">Not revocable.</span> DATABASE_URL is
              unset, so this link was not recorded and cannot be listed or
              cancelled early. It dies on its own at the time above; rotating
              AUTH_SECRET kills every outstanding link at once.
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p className="text-micro mt-sm text-[color:var(--color-grad-coral)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
