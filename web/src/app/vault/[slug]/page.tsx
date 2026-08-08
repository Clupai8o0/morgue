import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem } from "@/lib/vault-data";
import { tagsOf } from "@/lib/types";
import { CopyBundle } from "@/components/vault/copy-bundle";
import { CopyNotes } from "@/components/vault/copy-notes";
import { Notes } from "@/components/vault/notes";
import { ShareLink } from "@/components/vault/share-link";
import { SharedBanner } from "@/components/vault/shared-banner";
import { shareMode } from "@/lib/share-mode";
import {
  ArchiveCrumb,
  ArchiveEntry,
  RelationsSection,
  getFamily,
} from "@/components/vault/relations";
// One formatter, shared with `pnpm export`. It lives in bin/ because the CLI
// is plain Node ESM and cannot import TypeScript.
import { buildBundle } from "../../../../../bin/export-bundle.mjs";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/vault/[slug]">) {
  const { slug } = await params;
  const item = await getItem(slug);
  return { title: item?.title ?? "Not found" };
}

/**
 * Detail view. One item at a time — this is the only surface allowed to run
 * the real thing, because the WebGL context ceiling (16 per renderer thread)
 * makes a grid of live previews impossible.
 *
 * Scroll-driven items get no embed at all: ScrollTrigger's scroller is the
 * iframe's own viewport, so scrolling the parent 3000px leaves the track
 * transform at exactly 0. Verified, not assumed. Those link out instead.
 */
export default async function ItemPage({ params }: PageProps<"/vault/[slug]">) {
  const { slug } = await params;
  const item = await getItem(slug);
  if (!item) notFound();

  const scrollDriven = item.trigger === "scroll";
  const shared = await shareMode();

  // An item-scoped share can reach exactly this page. Every route out of it —
  // the vault index, the archive filter, sibling extracts — is refused by
  // proxy.ts, so offering those links would be offering a dead end. A
  // vault-scoped share keeps all of them, because all of them work.
  const boxedIn = shared?.kind === "item";

  // One extra read per family member, on this route only. See relations.tsx.
  const family = await getFamily(item);

  return (
    <>
      {shared ? <SharedBanner scope={shared} /> : null}
      {/* Pins itself top-right, same place on every vault surface. Sharing the
          export bundle is the point of an item link, so the bundle above stays
          available to a shared viewer — only minting further links is withheld. */}
      {!shared ? <ShareLink scope="item" slug={item.slug} /> : null}
      <main className="mx-auto w-full max-w-[1100px] px-lg py-xxl">
      {!boxedIn ? (
        <div className="gap-sm flex flex-wrap items-baseline">
          <Link
            href="/vault"
            className="text-micro text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
          >
            ← vault
          </Link>
          {item.relations?.archive ? (
            <ArchiveCrumb archive={item.relations.archive} />
          ) : null}
        </div>
      ) : null}

      <header className="mt-lg mb-xl">
        <h1 className="text-display-lg font-display">{item.title}</h1>
        <div className="mt-md gap-xxs flex flex-wrap">
          {tagsOf(item).map((t) => (
            <span
              key={t}
              className="text-micro border-hairline text-ink-muted rounded-pill px-sm border py-[5px]"
            >
              {t}
            </span>
          ))}
        </div>

        <div className="mt-lg">
          <CopyBundle bundle={buildBundle(item)} slug={item.slug} />
          <p className="text-micro text-ink-muted mt-xs max-w-[62ch]">
            Provenance, licence, dependencies, notes, source, and what to strip
            — one paste an agent can act on. Origin travels with the code, so
            this is still answerable in six months.
          </p>
        </div>
      </header>

      <div className="bg-surface-1 rounded-xl p-sm border-hairline-soft border">
        {item.video ? (
          <video
            src={`/api/media/${item.slug}/preview.mp4`}
            poster={`/api/media/${item.slug}/poster.webp`}
            controls
            loop
            muted
            playsInline
            className="rounded-lg w-full"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/media/${item.slug}/poster.webp`}
            alt=""
            className="rounded-lg w-full"
          />
        )}
      </div>

      <div className="mt-xl gap-xl grid md:grid-cols-[1fr_260px]">
        <section className="min-w-0">
          <div className="mb-sm gap-sm flex items-center justify-between">
            <h2 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
              Notes
            </h2>
            {item.notes.trim() ? <CopyNotes markdown={item.notes} /> : null}
          </div>
          <Notes markdown={item.notes} />

          {scrollDriven ? (
            <p className="text-body-sm text-ink-muted mt-lg border-hairline-soft pt-lg border-t">
              Scroll-driven. There is no embed here on purpose — inside a short
              iframe its scroller is the iframe&apos;s own viewport, so it would
              show frame 0 forever. Open the standalone page for the real thing.
            </p>
          ) : null}
        </section>

        <aside className="text-body-sm space-y-sm">
          <Row label="kind" value={item.kind} />
          <Row label="weight" value={item.weight} />
          <Row label="license" value={item.license} />
          <Row label="source" value={item.source} />
          <Row label="added" value={item.addedAt} />
          {item.license === "paid" ? (
            <p className="text-micro text-ink-muted border-hairline-soft pt-sm border-t">
              Paid license. Check the original EULA before lifting this into
              client work.
            </p>
          ) : null}
          <ArchiveEntry item={item} />
        </aside>
      </div>

      {!boxedIn ? <RelationsSection item={item} family={family} /> : null}
      </main>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="gap-sm flex justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
