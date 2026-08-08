import type { Metadata } from "next";
import { VaultGrid } from "@/components/vault/vault-grid";
import { ShareLink } from "@/components/vault/share-link";
import { SharedBanner } from "@/components/vault/shared-banner";
import { getFacets, getIndex } from "@/lib/vault-data";
import { shareMode } from "@/lib/share-mode";

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

  return (
    <>
      {shared ? <SharedBanner scope={shared} /> : null}
      <main className="mx-auto w-full max-w-[1400px] px-lg py-xxl">
      <header className="mb-xl flex flex-wrap items-baseline justify-between gap-md">
        <h1 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Vault
        </h1>
        <div className="gap-sm flex items-center">
          {index ? (
            <span className="text-micro text-ink-muted tabular-nums">
              built {new Date(index.builtAt).toLocaleDateString()}
            </span>
          ) : null}
          {/* A shared viewer cannot mint links. /api/share refuses them anyway
              — this only avoids offering a button that would 401. */}
          {!shared ? <ShareLink scope="vault" /> : null}
        </div>
      </header>

      {facets.length === 0 ? (
        <div className="py-section max-w-[54ch]">
          <p className="text-display-md font-display">The vault is empty.</p>
          <p className="text-body text-ink-muted mt-md">
            Nothing has been captured yet. Add a folder under{" "}
            <code className="text-ink">items/&lt;slug&gt;/</code> and run{" "}
            <code className="text-ink">pnpm capture &amp;&amp; pnpm build</code>.
            The folder contract is in <code className="text-ink">CLAUDE.md</code>.
          </p>
        </div>
      ) : (
        <VaultGrid facets={facets} index={index} />
      )}
      </main>
    </>
  );
}
