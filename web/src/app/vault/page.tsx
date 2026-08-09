import type { Metadata } from "next";
import Link from "next/link";
import { VaultGrid } from "@/components/vault/vault-grid";
import { ShareLink } from "@/components/vault/share-link";
import { SharedBanner } from "@/components/vault/shared-banner";
import { getFacets, getIndex } from "@/lib/vault-data";
import { shareMode } from "@/lib/share-mode";
import { localMode } from "@/lib/local";

export const metadata: Metadata = { title: "Vault" };

/**
 * Reads at request time rather than build time — deliberately. The collection
 * lives in R2, not in the deploy, so there is nothing to prerender against.
 * This is also the route that goes behind auth.
 */
export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const [facets, index, shared] = await Promise.all([
    getFacets(),
    getIndex(),
    shareMode(),
  ]);
  const local = localMode();

  return (
    <>
      {shared ? <SharedBanner scope={shared} /> : null}
      {/* Pins itself top-right; rendered here rather than in the header so the
          header's layout does not imply it belongs to the header. A shared
          viewer cannot mint links — /api/share refuses them anyway, so this
          only avoids offering a button that would 401.

          Hidden in local mode for the stronger reason that /api/share is 404
          there and share tokens need an AUTH_SECRET to sign with. The button
          would not be merely useless, it would be broken. */}
      {!shared && !local ? (
        <ShareLink scope="vault" maxWidth="max-w-[1400px]">
          {/* In the pinned row, NOT in the header below. /account had no link
              from anywhere and was reachable only by typing the URL; adding one
              at the header's right edge put it directly underneath this button
              — a 61×10px overlap, the link unclickable — which is the same
              collision the build date had before it was moved. The corner has
              one owner and this is how you join it. Styled to match the Share
              pill because both are pinned over scrolling content and need the
              same backdrop to stay legible. */}
          <Link
            href="/account"
            className="border-hairline-soft hover:border-hairline bg-canvas/70 text-ink-muted hover:text-ink rounded-pill px-sm text-micro border py-[7px] backdrop-blur-[6px] transition-[color,border-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.04] active:scale-[0.97]"
          >
            account
          </Link>
        </ShareLink>
      ) : null}
      <main className="mx-auto w-full max-w-[1400px] px-lg py-xxl">
      {/* NOTHING GOES AT THE RIGHT OF THIS ROW. The pinned Share cluster lands
          exactly there, and it has already collided with two things put here:
          the build date, and then `account →`. Both looked fine in the source
          and were overlapped in the browser, because the cluster is `fixed` and
          this row cannot see it. Anything that belongs in that corner is passed
          to <ShareLink> as a child instead. */}
      <header className="mb-xl gap-sm flex flex-wrap items-baseline">
        <h1 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Vault
        </h1>
        {index ? (
          <span className="text-micro text-ink-muted tabular-nums">
            · built {new Date(index.builtAt).toLocaleDateString()}
          </span>
        ) : null}
        {/* Left-aligned, deliberately: in local mode there is no Share cluster
            to join, so this is the one label that can sit inline — and it must
            not use `ml-auto`, or it reintroduces the collision the moment
            somebody makes the cluster render in local mode too. */}
        {local ? (
          <span className="text-micro text-ink-muted">· local</span>
        ) : null}
      </header>

      {facets.length === 0 ? (
        <div className="py-section max-w-[54ch]">
          <p className="text-display-md font-display">The vault is empty.</p>
          {/* Two different people read this. On a hosted deployment it is the
              owner, who knows the folder contract. Locally it is someone who
              installed this ten minutes ago and needs the one command that
              puts something in front of them — not a pointer to CLAUDE.md. */}
          {local ? (
            <>
              <p className="text-body text-ink-muted mt-md">
                Nothing has been captured yet. The quickest way to see the tool
                work is the example set that ships with it:
              </p>
              <pre className="border-hairline bg-surface-1 rounded-lg p-md text-caption mt-md overflow-x-auto">
                <code>pnpm morgue --examples</code>
              </pre>
              <p className="text-body text-ink-muted mt-md">
                To file something of your own, make a folder at{" "}
                <code className="text-ink">items/&lt;slug&gt;/</code> and run{" "}
                <code className="text-ink">pnpm capture &amp;&amp; pnpm build</code>
                . <code className="text-ink">SETUP.md</code> walks through it;{" "}
                <code className="text-ink">pnpm doctor</code> says whether this
                machine can capture at all.
              </p>
            </>
          ) : (
            <p className="text-body text-ink-muted mt-md">
              Nothing has been captured yet. Add a folder under{" "}
              <code className="text-ink">items/&lt;slug&gt;/</code> and run{" "}
              <code className="text-ink">pnpm capture &amp;&amp; pnpm build</code>
              . The folder contract is in{" "}
              <code className="text-ink">CLAUDE.md</code>.
            </p>
          )}
        </div>
      ) : (
        <VaultGrid facets={facets} index={index} />
      )}
      </main>
    </>
  );
}
