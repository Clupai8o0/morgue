/**
 * Mirrors what bin/build.mjs emits into site/data/. Kept hand-written rather
 * than generated: the shape is the contract between the capture pipeline and
 * this app, and it should hurt slightly to change.
 */

export type Kind = "reference" | "static" | "project" | "unextracted";
export type Trigger = "load" | "hover" | "click" | "scroll" | "drag" | "idle";
export type Weight = "light" | "medium" | "heavy";
export type License = "own" | "mit" | "paid" | "unknown";

/** `archive.role` in meta.json: the whole delivery, or a piece cut out of it. */
export type ArchiveRole = "template" | "extract";

/**
 * A rung of the preview ladder produced by `pnpm renditions`, smallest first.
 * Order matters — `previewSrc` walks this array — so it mirrors `LADDER` in
 * bin/renditions.mjs and must be widened at the same time as that list.
 */
export type Rung = "xs" | "sm";
export const RUNGS: Rung[] = ["xs", "sm"];

/**
 * meta.json's optional `archive` block, verbatim as an author writes it.
 * `entry` and `route` are extract-only and live ONLY in the per-item record —
 * facets.json cannot carry them, which is why the detail page reads records.
 */
export interface ArchiveRef {
  name: string;
  role: ArchiveRole;
  entry?: string | null;
  route?: string | null;
}

/**
 * Derived onto every record by bin/build.mjs from the `archive.name` grouping.
 * Never hand-written, and every field may be absent on an older payload.
 *
 * An archive with no `role: "template"` item is legal — `parent` is then null
 * on every extract and the UI must say so rather than link nowhere.
 */
export interface Relations {
  archive: string | null;
  role: ArchiveRole | null;
  /** slug of the role:"template" item; null on a template, or if none exists */
  parent: string | null;
  /** template only; [] otherwise */
  children: string[];
  /** extract only — other extracts of the same archive; [] otherwise */
  siblings: string[];
}

/**
 * One row of facets.json — enough to filter, search and lay out a card.
 *
 * EVERY relation field is optional and stays optional. The app and the R2
 * payload version independently (bin/publish.mjs writes R2 from this machine;
 * Vercel deploys from git), so code shipped ahead of a rebuild WILL see rows
 * without them. The missing case is permanent, not transitional.
 */
export interface Facet {
  slug: string;
  title: string;
  effect: string[];
  technique: string[];
  trigger: Trigger;
  surface: string;
  weight: Weight;
  kind: Kind;
  hasVideo: boolean;
  /**
   * Rungs of the preview ladder that exist for this item, smallest first —
   * see `LADDER` in bin/renditions.mjs. ABSENT is a permanent state, not a
   * migration: facets.json lives in R2 and versions independently of this app,
   * so a payload built before the ladder existed will simply not have it and
   * every consumer must fall back to the full-size preview.
   */
  rungs?: Rung[];

  /** `archive.name`, flattened to a string for the facet row. */
  archive?: string | null;
  role?: ArchiveRole | null;
  /**
   * How many items this row's own relations point at:
   * template → children.length; extract → siblings.length + (parent ? 1 : 0).
   * Derived from the pointers, not from the family size, so the label stays
   * truthful even if an archive somehow has two templates.
   */
  relatedCount?: number;
}

/** index.json — counts plus the vocabulary actually present in the corpus. */
export interface VaultIndex {
  count: number;
  pageSize: number;
  builtAt: string;
  vocab: {
    effect: string[];
    technique: string[];
    trigger: string[];
    surface: string[];
    weight: string[];
    kind: string[];
  };
}

/**
 * A full record from data/items/<slug>.json, including notes.
 *
 * `archive` is OMITTED from Facet and redeclared, because the two payloads
 * genuinely disagree: the facet row carries the flattened name as a string,
 * the record carries meta.json's block as an object (bin/build.mjs spreads
 * `...meta`). Widening one into the other would make both lie.
 *
 * `role` and `relatedCount` are inherited but are facet-row conveniences and
 * are NOT written into records — read `relations` here, never those.
 *
 * `hasVideo` and `rungs` are OMITTED for a stronger reason: bin/build.mjs has
 * never written them into a record. They are computed in the facets map, and a
 * record carries `video` and `videoRungs` instead. Inheriting them declared two
 * fields that are always `undefined` at runtime — a type that promises more
 * than the payload delivers. Use `previewRef()` to hand a record to anything
 * that wants the facet shape.
 */
export interface Item
  extends Omit<Facet, "archive" | "hasVideo" | "rungs"> {
  source: string;
  sourceUrl: string | null;
  /** the delivery this was ingested from, when there is no product URL */
  sourceArchive?: string | null;
  license: License;
  addedAt: string;
  usedIn: string[];
  notes: string;
  poster: string;
  video: string | null;
  /** Same list as `Facet.rungs`; records always carry it, even when empty. */
  videoRungs?: Rung[];
  href: string;

  archive?: ArchiveRef | null;
  relations?: Relations;
}

/**
 * The tag vocabulary flattened for search and filter chips. Order matters
 * only in that it is stable — the grid slices the first three for the card.
 *
 * Takes the four fields it reads rather than a whole Facet so it also accepts
 * an Item, whose `archive` is a different shape.
 */
export function tagsOf(
  f: Pick<Facet, "effect" | "technique" | "trigger" | "surface">,
): string[] {
  return [...f.effect, ...f.technique, f.trigger, f.surface].filter(Boolean);
}

/**
 * The filter token for an archive. Namespaced so it can live in the SAME
 * `active: Set<string>` as the vocab chips — one filtering system, one OR
 * predicate — without ever colliding with a real tag.
 */
export const ARCHIVE_PREFIX = "archive:";
export const archiveKey = (name: string) => `${ARCHIVE_PREFIX}${name}`;
export const archiveNameOf = (key: string) =>
  key.startsWith(ARCHIVE_PREFIX) ? key.slice(ARCHIVE_PREFIX.length) : null;

/**
 * What the grid MATCHES against — display tags plus the archive token. Kept
 * separate from `tagsOf` so the internal token never leaks onto a card.
 */
export function keysOf(f: Facet): string[] {
  const tags = tagsOf(f);
  return f.archive ? [...tags, archiveKey(f.archive)] : tags;
}

/**
 * The one sentence a card is allowed to say about its family.
 *
 * Written to read as a sentence fragment because the badge sits inside the
 * card's <Link>, so its text joins the link's accessible name.
 *
 * MIRRORED in bin/grid.html as `relOf()` — that file has no build step and
 * cannot import TypeScript, the same trade-off already taken for the player
 * LRU. Two different badge texts for one item means these have drifted.
 */
export function relationLabel(
  f: Pick<Facet, "archive" | "role" | "relatedCount">,
): string | null {
  if (!f.archive || !f.role) return null;
  if (f.role === "template") {
    const n = f.relatedCount ?? 0;
    // Never "0 extracts" — a template nothing has been cut out of yet is a
    // to-do, not a count.
    return n === 0 ? "template" : `${n} extract${n === 1 ? "" : "s"}`;
  }
  return `part of ${f.archive}`;
}

/**
 * The minimum a surface needs to render a preview. A `Facet` satisfies it
 * structurally; a record needs `previewRef()` because it stores the same two
 * facts under different names.
 */
export interface PreviewRef {
  slug: string;
  hasVideo: boolean;
  rungs?: Rung[];
}

/** Adapts a full record to the facet-shaped preview contract. */
export function previewRef(item: Item): PreviewRef {
  return {
    slug: item.slug,
    hasVideo: Boolean(item.video),
    rungs: item.videoRungs,
  };
}

/**
 * Picks the preview file a surface should request.
 *
 * `want` is the LARGEST rung the surface is willing to use; the best available
 * rung at or below it wins, and if the payload advertises none, the full-size
 * preview is used. Never construct `preview-<rung>.mp4` by hand anywhere else —
 * an item captured before `pnpm renditions` existed has no rungs at all, and
 * guessing produces a 404 that presents as a hover which quietly does nothing.
 *
 * Returns null when the item has no video, which is a legal state:
 * `kind: "reference"` items are a poster and notes.
 */
export function previewSrc(
  f: PreviewRef,
  want: Rung | "full" = "full",
): string | null {
  if (!f.hasVideo) return null;
  const base = `/api/media/${f.slug}`;
  if (want === "full") return `${base}/preview.mp4`;

  const have = f.rungs ?? [];
  // RUNGS is smallest-first, so scanning down from `want` finds the largest
  // rung that is no bigger than the surface asked for.
  const ceiling = RUNGS.indexOf(want);
  for (let i = ceiling; i >= 0; i--) {
    if (have.includes(RUNGS[i])) return `${base}/preview-${RUNGS[i]}.mp4`;
  }
  return `${base}/preview.mp4`;
}
