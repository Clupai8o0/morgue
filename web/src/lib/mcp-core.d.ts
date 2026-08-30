/**
 * Types for the shared MCP core at bin/mcp-core.mjs.
 *
 * As with export-bundle.d.ts, the implementation lives in bin/ because the
 * stdio CLI is plain Node ESM and cannot import TypeScript, so the single
 * definition has to be .mjs. This declaration gives the HTTP transport
 * (app/api/mcp/route.ts) types without duplicating the dispatcher.
 */
declare module "*/bin/mcp-core.mjs" {
  import type { Facet, Item, VaultIndex } from "@/lib/types";

  /** The three async methods the tool layer reads the vault through. */
  export interface McpDataSource {
    getFacets(): Promise<Facet[]>;
    getIndex(): Promise<VaultIndex | null>;
    getItem(slug: string): Promise<Item | null>;
  }

  export interface McpContext {
    dataSource: McpDataSource;
  }

  export const SERVER_INFO: { name: string; title: string; version: string };
  export const PROTOCOL_VERSIONS: string[];

  /** Dispatch one parsed JSON-RPC message; null means "no response" (notification). */
  export function dispatch(message: unknown, ctx: McpContext): Promise<unknown | null>;

  /** Parse a raw JSON-RPC string and dispatch it. `body` is null for notifications. */
  export function handleRaw(
    raw: string,
    ctx: McpContext,
  ): Promise<{ body: unknown | null }>;
}
