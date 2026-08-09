import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * One schema, two drivers, chosen by the connection string.
 *
 * ── Neon over HTTP, in production ───────────────────────────────────────────
 *
 * Serverless functions scale to many short-lived instances, and a TCP pool per
 * instance exhausts Postgres connections fast — the usual fix is a separate
 * pooler to babysit. Neon's HTTP driver sidesteps the problem entirely: each
 * query is a stateless request, so there is no pool to size and nothing to
 * leak when an instance is frozen mid-request. The tradeoff is no interactive
 * transactions over HTTP, which is fine: every write here is one statement.
 *
 * ── node-postgres, everywhere else ──────────────────────────────────────────
 *
 * The HTTP driver can ONLY talk to Neon. It speaks Neon's own endpoint
 * protocol, not the Postgres wire protocol, so with neon-http as the only
 * driver there is no way to point this app at a Postgres you can start
 * yourself. That is not a theoretical loss:
 *
 *   - `pnpm verify:auth` boots a throwaway cluster with initdb and runs the
 *     real production server against it. Auth is the one subsystem where a
 *     mocked database proves nothing, because every interesting failure is a
 *     query returning the wrong row.
 *   - STATUS.md has said "nothing outside the local dev path has ever run"
 *     since this app existed, and DATABASE_URL has never been set. A driver
 *     that needs a provisioned vendor account keeps it that way.
 *
 * So: a host under `.neon.tech` gets the HTTP driver, anything else gets a
 * normal pooled connection. Production is unchanged — Neon URLs still take the
 * Neon path. Set MORGUE_DB_DRIVER to `neon` or `pg` to override, which exists
 * for Neon-compatible proxies that do not carry the vendor's hostname.
 *
 * ── Resolved lazily ─────────────────────────────────────────────────────────
 *
 * Importing this module must never throw. A missing DATABASE_URL should fail
 * the one route that needs it with a clear message, not take down the app at
 * build time — and since the multi-tenant pivot it would take down every
 * request, because src/auth.ts imports this to decide whether anyone exists.
 */

/**
 * The two drizzle instances differ only in their query-result HKT; every
 * builder method this app calls is identical. Naming the node-postgres form as
 * the app-wide type and casting the Neon one to it keeps call sites free of
 * union gymnastics. The one thing that is genuinely NOT interchangeable is
 * `db().transaction()` with an interactive callback, which neon-http cannot
 * do — so do not add one. Single statements only, as the header says.
 */
export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

let cached: Db | null = null;
let cachedFor: string | null = null;

function driverFor(url: string): "neon" | "pg" {
  const override = process.env.MORGUE_DB_DRIVER;
  if (override === "neon" || override === "pg") return override;
  try {
    return new URL(url).hostname.endsWith(".neon.tech") ? "neon" : "pg";
  } catch {
    // An unparseable URL is the driver's problem to report, not ours. Guess
    // the vendor path so the error message mentions Neon, which is what the
    // .env.example tells people to paste.
    return "neon";
  }
}

export function db(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Create a Neon project, then add the pooled " +
        "connection string to web/.env.local (see .env.example). Any other " +
        "Postgres works too — see src/db/index.ts.",
    );
  }

  // Keyed on the URL so a test harness that swaps databases mid-process gets a
  // fresh handle instead of the previous one silently.
  if (cached && cachedFor === url) return cached;

  cached =
    driverFor(url) === "neon"
      ? (drizzleNeon(neon(url), { schema }) as unknown as Db)
      : drizzlePg(new Pool({ connectionString: url, max: 5 }), { schema });
  cachedFor = url;
  return cached;
}

/** True when the database is configured — lets routes degrade with intent. */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
