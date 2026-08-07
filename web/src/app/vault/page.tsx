import type { Metadata } from "next";
import { VaultGrid } from "@/components/vault/vault-grid";
import { getFacets, getIndex } from "@/lib/vault-data";

export const metadata: Metadata = { title: "Vault" };

/**
 * Reads at request time rather than build time — deliberately. The collection
 * lives in R2, not in the deploy, so there is nothing to prerender against.
 * This is also the route that goes behind auth.
 */
export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const [facets, index] = await Promise.all([getFacets(), getIndex()]);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-lg py-xxl">
      <header className="mb-xl flex items-baseline justify-between gap-md">
        <h1 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Vault
        </h1>
        {index ? (
          <span className="text-micro text-ink-muted tabular-nums">
            built {new Date(index.builtAt).toLocaleDateString()}
          </span>
        ) : null}
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
  );
}
