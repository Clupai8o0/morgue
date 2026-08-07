/**
 * Mirrors what bin/build.mjs emits into site/data/. Kept hand-written rather
 * than generated: the shape is the contract between the capture pipeline and
 * this app, and it should hurt slightly to change.
 */

export type Kind = "reference" | "static" | "project" | "unextracted";
export type Trigger = "load" | "hover" | "click" | "scroll" | "drag" | "idle";
export type Weight = "light" | "medium" | "heavy";
export type License = "own" | "mit" | "paid" | "unknown";

/** One row of facets.json — enough to filter, search and lay out a card. */
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

/** A full record from data/items/<slug>.json, including notes. */
export interface Item extends Facet {
  source: string;
  sourceUrl: string | null;
  license: License;
  addedAt: string;
  usedIn: string[];
  notes: string;
  poster: string;
  video: string | null;
  href: string;
}

/**
 * The tag vocabulary flattened for search and filter chips. Order matters
 * only in that it is stable — the grid slices the first three for the card.
 */
export function tagsOf(f: Facet): string[] {
  return [...f.effect, ...f.technique, f.trigger, f.surface].filter(Boolean);
}
