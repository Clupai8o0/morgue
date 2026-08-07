import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * The entire database. Two tables, and that is deliberate.
 *
 * The vault is NOT in Postgres. Items are built from items/ on disk into
 * static JSON and served from R2 — browsing never touches a database. Putting
 * the collection here would mean a second source of truth that drifts from
 * the folder contract, and would defeat the point of the capture pipeline
 * being a filesystem API.
 *
 * So Postgres holds only the things that genuinely need transactional state:
 * who asked for access, and which CLI tokens are live.
 */

export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    note: text("note"),

    // pending | approved | declined. Kept as text rather than a pg enum so
    // adding a state later is a code change, not a migration.
    status: text("status").notNull().default("pending"),

    // Hashed, never raw. Rate limiting needs to recognise a repeat submitter;
    // it does not need to know where they live, and storing raw IPs turns a
    // one-line waitlist into personal data with retention obligations.
    ipHash: text("ip_hash"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("waitlist_created_idx").on(t.createdAt),
    index("waitlist_ip_idx").on(t.ipHash),
  ],
);

export const cliTokens = pgTable("cli_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),

  // sha256 of the token. The plaintext is shown once at creation and never
  // stored, so a database dump does not hand over write access to R2.
  tokenHash: text("token_hash").notNull().unique(),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type Waitlist = typeof waitlist.$inferSelect;
export type CliToken = typeof cliTokens.$inferSelect;
