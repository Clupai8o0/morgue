"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mint a read-only share link and hand back the URL.
 *
 * ── Why it is pinned top-right rather than sitting in the header ────────────
 *
 * Sharing applies to the whole page, not to a spot in it. Inline, the control
 * had to be placed twice and it landed in two different spots — beside "built
 * <date>" on the index, and under Copy for agent on a detail page — so it read
 * as a different control on each. Pinned, there is one place it ever is, and
 * it survives scrolling down a 4,000px notes page and deciding to share.
 *
 * `position: fixed` is safe here specifically because Lenis runs in native
 * scroll mode: no wrapper/content transform, so no transformed ancestor to
 * anchor against. If anyone ever switches Lenis to transform mode this button
 * silently starts scrolling with the page.
 *
 * ── Two decisions worth keeping ─────────────────────────────────────────────
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

/** iOS-style share glyph: an arrow leaving a tray. Reads at 16px, unlike a
 *  three-node graph, whose connecting lines close up at this size. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 10V2.6" />
      <path d="M5.4 5.2 8 2.6l2.6 2.6" />
      <path d="M3.6 8.8v3.6a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V8.8" />
    </svg>
  );
}

export function ShareLink({
  scope,
  slug,
  maxWidth = "max-w-[1100px]",
  children,
}: {
  scope: "vault" | "item";
  slug?: string;
  /**
   * The page's own container width. The button is fixed so it survives
   * scrolling, but it must line up with the right edge of the CONTENT column
   * rather than the viewport — on a wide monitor a viewport-pinned control
   * floats in dead space with no relationship to the page. Passing the width
   * in keeps it honest per page: the index is 1400 and a detail page is 1100.
   */
  maxWidth?: string;
  /**
   * Controls to sit beside the Share button, inside the same pinned row.
   *
   * THIS SLOT EXISTS BECAUSE THE CORNER CAN ONLY HAVE ONE OWNER, and that has
   * now been learned twice. The build date used to sit at the right of the
   * vault header and was overlapped by this button; it was moved. Then
   * `account →` was added to the same header with `ml-auto` and landed in the
   * identical spot — measured at a 61×10px collision, with the link rendered
   * underneath the button and unclickable.
   *
   * A comment saying "do not put anything in this corner" did not prevent the
   * second one, so the fix is structural: anything that belongs up here comes
   * through this slot and gets laid out by the same flex row, where it cannot
   * overlap. A page that wants a control in the corner can no longer position
   * one itself, because it does not know where this button is.
   */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(24 * 7);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // Escape closes, and a click anywhere else closes. Both only while open, so
  // the listeners are not sitting on every vault page doing nothing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") reset();
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) reset();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    // Fixed so it survives scrolling, but laid out through a copy of the
    // page's own container so it lands on the right edge of the CONTENT
    // column, not the viewport. pointer-events-none on the full-width track
    // is what stops an invisible bar across the top of the page swallowing
    // clicks on everything beneath it.
    <div className="pointer-events-none fixed inset-x-0 top-lg z-40 isolate">
      <div className={`mx-auto w-full px-lg gap-xs flex items-center justify-end ${maxWidth}`}>
        {children ? (
          // pointer-events restored per child, matching the button: the track
          // above is deliberately transparent to clicks so it does not swallow
          // the whole top of the page.
          <div className="pointer-events-auto flex items-center">{children}</div>
        ) : null}
        <div ref={rootRef} className="pointer-events-auto relative">
          <button
            onClick={() => (open ? reset() : setOpen(true))}
            aria-label={
              scope === "vault" ? "Share the whole vault" : "Share this item"
            }
            aria-expanded={open}
            className="border-hairline-soft hover:border-hairline bg-canvas/70 text-ink-muted hover:text-ink rounded-pill gap-xxs px-sm flex items-center border py-[7px] backdrop-blur-[6px] transition-[color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.04] active:scale-[0.97]"
          >
            <ShareIcon />
            <span className="text-micro">Share</span>
          </button>

          {open ? <Panel /> : null}
        </div>
      </div>
    </div>
  );

  function Panel() {
  return (
    // Anchored to the button rather than in flow: in flow it would stretch the
    // flex row and drag the button off the right edge as it opened.
    <div className="bg-surface-1 border-hairline-soft rounded-lg p-md mt-xs absolute right-0 top-full w-[min(520px,calc(100vw-2*var(--spacing-lg)))] border">
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
}
