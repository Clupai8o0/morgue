import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Facet, Item, VaultIndex } from "./types";

/**
 * Server-only. Reads the payload bin/build.mjs emits.
 *
 * THE IMPORTANT CONSTRAINT: items/ is gitignored, so Vercel — which deploys
 * from git — never sees the collection and cannot generate any of this at
 * build time. The vault is entirely R2-resident in production. A deploy has
 * nothing to leak because it never holds the collection.
 *
 * That makes `bin/publish.mjs` load-bearing infrastructure rather than a
 * convenience: capture → publish → R2 is the only path data reaches prod.
 *
 * Locally we read straight off disk from the sibling site/ directory, which
 * keeps `pnpm capture && pnpm dev` a tight loop with no upload in the middle.
 */

const LOCAL_DIR =
  process.env.MORGUE_SITE_DIR ?? path.resolve(process.cwd(), "..", "site");

const useLocal = process.env.MORGUE_DATA_SOURCE !== "r2";

async function readLocal<T>(rel: string): Promise<T> {
  return JSON.parse(await readFile(path.join(LOCAL_DIR, "data", rel), "utf8")) as T;
}

async function readR2<T>(rel: string): Promise<T> {
  const { getObjectText } = await import("./r2");
  try {
    return JSON.parse(await getObjectText(`data/${rel}`)) as T;
  } catch (err) {
    // Normalise R2's NoSuchKey to the same shape the filesystem reader
    // produces, so callers have one "missing" case rather than two.
    if (
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name: string }).name === "NoSuchKey"
    ) {
      throw Object.assign(new Error(`missing data/${rel}`), { code: "ENOENT" });
    }
    throw err;
  }
}

const read = useLocal ? readLocal : readR2;

/** Every item's filterable surface. Loaded once, cached for the request. */
export async function getFacets(): Promise<Facet[]> {
  try {
    return await read<Facet[]>("facets.json");
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Counts and the vocabulary actually present — drives the filter chips. */
export async function getIndex(): Promise<VaultIndex | null> {
  try {
    return await read<VaultIndex>("index.json");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/** One full record, including notes. Fetched only when a detail view opens. */
export async function getItem(slug: string): Promise<Item | null> {
  // Defend the path join even though slugs come from our own build — this
  // function is one refactor away from taking a URL segment directly.
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
  try {
    return await read<Item>(`items/${slug}.json`);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
