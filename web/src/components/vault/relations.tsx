import Link from "next/link";
import { getItem } from "@/lib/vault-data";
import { PreviewMedia } from "@/components/vault/preview-media";
import { previewRef, type Item } from "@/lib/types";

/**
 * The Relations surface on the detail page — the only place a family is
 * actually enumerated.
 *
 * SERVER ONLY. No "use client": this reads records off disk (or R2) through
 * `getItem`. It is the detail route's own module, imported by
 * `app/vault/[slug]/page.tsx` and nothing else.
 *
 * WHY IT READS RECORDS AT ALL: `entry` (where the effect lives inside a
 * 2,000-file template) and `route` (which page shows it) are in meta.json's
 * `archive` block, so they reach the per-item record and never facets.json.
 * Without them a relation is decoration; with them it is a lookup.
 *
 * COST: one read per family member, issued in parallel. Locally that is N tiny
 * readFile calls; against R2 it is N GETs. Families are 2-6, so this is
 * bounded — and it is exactly why relations are NOT resolved for the grid,
 * where it would be N reads per card. If /vault/[slug] ever gets slow, this is
 * the first suspect.
 *
 * The thumbnails are the one client-side thing on this surface. <PreviewMedia>
 * is a client component nested inside these server-rendered links; it binds
 * hover to `closest("a")`, so the card keeps whole-card hover without this
 * module needing "use client" and dragging the record reads into the bundle.
 * They ask for the `xs` rung — these paint around 180px, a ninth of the pixels
 * the 600px preview carries.
 */

export interface Family {
  parent: Item | null;
  children: Item[];
  siblings: Item[];
}

export async function getFamily(item: Item): Promise<Family> {
  const r = item.relations;
  if (!r?.archive) return { parent: null, children: [], siblings: [] };

  const wanted = [
    ...new Set([
      ...(r.parent ? [r.parent] : []),
      ...(r.children ?? []),
      ...(r.siblings ?? []),
    ]),
  ];

  const found = new Map<string, Item>();
  await Promise.all(
    wanted.map(async (slug) => {
      const it = await getItem(slug); // already slug-validated in there
      if (it) found.set(slug, it);
    }),
  );

  const pick = (slugs: string[]) =>
    slugs
      .map((s) => found.get(s))
      .filter((x): x is Item => Boolean(x))
      .sort((a, b) => a.title.localeCompare(b.title));

  return {
    // A dangling slug degrades to null / omitted rather than throwing. Build
    // derives relations from a grouping, and a deleted item is a real state.
    parent: r.parent ? (found.get(r.parent) ?? null) : null,
    children: pick(r.children ?? []),
    siblings: pick(r.siblings ?? []),
  };
}

/** The breadcrumb that sits beside `← vault`. Same treatment, no new accent. */
export function ArchiveCrumb({ archive }: { archive: string }) {
  return (
    <Link
      href={`/vault?archive=${encodeURIComponent(archive)}`}
      className="text-micro text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
    >
      · {archive}
    </Link>
  );
}

/**
 * This item's own position inside the archive — appended to the aside rather
 * than made a Row, because a Row's `justify-between` would squash a
 * 48-character path against a four-character label.
 */
export function ArchiveEntry({ item }: { item: Item }) {
  if (!item.archive?.entry) return null;
  return (
    <div className="border-hairline-soft pt-sm border-t">
      <div className="text-micro text-ink-muted uppercase tracking-[0.12em]">
        entry
      </div>
      <code className="text-ink text-micro mt-[2px] block break-all">
        {item.archive.entry}
      </code>
      {item.archive.route ? (
        <div className="text-micro text-ink-muted mt-xxs">
          captured at <code className="text-ink">{item.archive.route}</code>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Full width, below the two-column block: entry paths are long and the 260px
 * aside would ellipsis every one of them.
 *
 * Renders nothing at all when the item has no archive — relations are opt-in
 * per item and most of the collection will never have one.
 */
export function RelationsSection({
  item,
  family,
}: {
  item: Item;
  family: Family;
}) {
  const rel = item.relations;
  if (!rel?.archive) return null;

  const isTemplate = rel.role === "template";
  const list = isTemplate ? family.children : family.siblings;

  return (
    <section className="mt-xxl border-hairline-soft pt-xl border-t">
      <header className="mb-md gap-sm flex flex-wrap items-baseline justify-between">
        <h2 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          {isTemplate ? "Extracted from this" : "Part of"}
        </h2>
        <Link
          href={`/vault?archive=${encodeURIComponent(rel.archive)}`}
          className="text-micro text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
        >
          show the {rel.archive} family →
        </Link>
      </header>

      {/* An extract's parent: first, and full width — it is the thing every
          other row is relative to. */}
      {!isTemplate && family.parent ? (
        <Link
          href={`/vault/${family.parent.slug}`}
          className="bg-surface-1 rounded-lg p-sm mb-md border-hairline-soft hover:border-hairline gap-sm flex border transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out-expo)] hover:-translate-y-[2px]"
        >
          <PreviewMedia
            item={previewRef(family.parent)}
            want="xs"
            className="w-[160px] shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="gap-sm flex items-baseline justify-between">
              <span className="text-body-sm truncate">
                {family.parent.title}
              </span>
              <span className="text-micro text-ink-muted shrink-0">
                the whole template
              </span>
            </div>
            <div className="text-micro text-ink-muted mt-xxs">
              {family.parent.kind} · {family.parent.license} ·{" "}
              {family.parent.source}
            </div>
          </div>
        </Link>
      ) : null}

      {/* Legal state 1: an archive with no role:"template" item. */}
      {!isTemplate && !family.parent ? (
        <NoTemplate item={item} archive={rel.archive} />
      ) : null}

      {/* Legal state 2: a template nothing has been cut out of yet. */}
      {isTemplate && list.length === 0 ? (
        <NothingExtracted archive={rel.archive} />
      ) : null}

      {list.length > 0 ? (
        <>
          {!isTemplate ? (
            <h3 className="text-micro text-ink-muted mb-xs uppercase tracking-[0.12em]">
              also extracted from {rel.archive}
            </h3>
          ) : null}
          <ul className="gap-xs grid sm:grid-cols-2">
            {list.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/vault/${c.slug}`}
                  className="bg-surface-1 rounded-lg p-sm border-hairline-soft hover:border-hairline gap-sm flex h-full border transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out-expo)] hover:-translate-y-[2px]"
                >
                  <PreviewMedia
                    item={previewRef(c)}
                    want="xs"
                    className="w-[140px] shrink-0 self-start"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="gap-sm flex items-baseline justify-between">
                      <span className="text-body-sm truncate">{c.title}</span>
                      <span className="text-micro text-ink-muted shrink-0">
                        {c.trigger}
                      </span>
                    </div>
                    {/* The two facts that make an extract findable again: where
                        it lives in the archive, and which route shows it. */}
                    <code className="text-ink-muted text-micro mt-xxs block truncate">
                      {c.archive?.entry ?? "entry not recorded"}
                    </code>
                    {c.archive?.route ? (
                      <div className="text-micro text-ink-muted mt-[2px]">
                        route{" "}
                        <span className="text-ink">{c.archive.route}</span>
                      </div>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * Extracts exist, the template item does not. Never render a dead "back to the
 * template" link here — a weaker true statement beats a confident wrong one,
 * which is the same reason sourceArchive is a weaker claim than sourceUrl.
 */
function NoTemplate({ item, archive }: { item: Item; archive: string }) {
  return (
    <p className="text-body-sm text-ink-muted border-hairline-soft rounded-lg p-sm border">
      No template item for <code className="text-ink">{archive}</code> — the
      archive exists, but nothing here captures the whole thing.{" "}
      {item.sourceArchive ? (
        <>
          It was delivered as{" "}
          <code className="text-ink">{item.sourceArchive}</code>.
        </>
      ) : null}
    </p>
  );
}

/** A to-do list, not an error — and the payoff for kind:"unextracted". */
function NothingExtracted({ archive }: { archive: string }) {
  return (
    <p className="text-body-sm text-ink-muted border-hairline-soft rounded-lg p-sm border">
      Nothing extracted from <code className="text-ink">{archive}</code> yet.
      Add an item whose meta.json carries the same{" "}
      <code className="text-ink">archive.name</code> with{" "}
      <code className="text-ink">role: &quot;extract&quot;</code> and it appears
      here — that is the whole registration step.
    </p>
  );
}
