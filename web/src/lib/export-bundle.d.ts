/**
 * Types for the shared formatter at bin/export-bundle.mjs.
 *
 * The implementation lives in bin/ rather than here on purpose: the CLI is
 * plain Node ESM and cannot import TypeScript, so the single definition has to
 * be .mjs. This declaration gives the web app types without duplicating the
 * logic — two copies of "what an export looks like" would drift within a month.
 */
declare module "*/bin/export-bundle.mjs" {
  import type { Item } from "@/lib/types";
  export function buildBundle(item: Item): string;
}
