import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon over the HTTP driver, not a TCP pool.
 *
 * Serverless functions scale to many short-lived instances, and a TCP pool per
 * instance exhausts Postgres connections fast — the usual fix is a separate
 * pooler to babysit. Neon's HTTP driver sidesteps the problem entirely: each
 * query is a stateless request, so there is no pool to size and nothing to
 * leak when an instance is frozen mid-request.
 *
 * The tradeoff is no interactive transactions over HTTP. Fine here: the whole
 * schema is two tables and every write is a single statement.
 *
 * Resolved lazily so that importing this module never throws. A missing
 * DATABASE_URL should fail the one route that needs it with a clear message,
 * not take down the entire app at build time.
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Create a Neon project, then add the pooled " +
        "connection string to web/.env.local (see .env.example).",
    );
  }

  cached = drizzle(neon(url), { schema });
  return cached;
}

/** True when the database is configured — lets routes degrade with intent. */
export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
