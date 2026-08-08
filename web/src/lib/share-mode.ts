import { headers } from "next/headers";
import { SHARE_HEADER, type ShareScope } from "@/lib/share";

/**
 * Server-only. Reads the scope proxy.ts stamped onto the request.
 *
 * This is a RENDERING signal, never an authorisation one. Access was already
 * decided in proxy.ts before this request reached a page; what this answers is
 * "should the page show owner controls and a read-only banner". Never gate
 * anything sensitive on it — a page that leaks when this returns null is a page
 * with a bug in the proxy, and the fix belongs there.
 */
export async function shareMode(): Promise<ShareScope | null> {
  const raw = (await headers()).get(SHARE_HEADER);
  if (!raw) return null;
  if (raw === "vault") return { kind: "vault" };
  if (raw.startsWith("item:")) return { kind: "item", slug: raw.slice(5) };
  return null;
}
