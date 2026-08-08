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
 * who asked for access, which CLI tokens are live, and which share links have
 * been handed out.
 *
 * `shareLinks` is the one table the app runs WITHOUT. Share tokens are signed
 * and carry their own expiry (see lib/share.ts), so issuing and validating a
 * link needs no database at all. This table adds only what a signature cannot
 * express: an inventory of what is outstanding, and the ability to kill one
 * link before it expires. When DATABASE_URL is absent, links still work and
 * the admin page says plainly that they cannot be listed or individually
 * revoked.
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

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The `jti` from the signed payload. This is what revocation keys on, and
    // it is the only handle that survives into a token we never stored.
    jti: text("jti").notNull().unique(),

    // sha256 of the whole token, for the same reason cli_tokens hashes: the
    // plaintext is shown once at creation. A dump of this table cannot be
    // replayed as a working link.
    tokenHash: text("token_hash").notNull(),

    // vault | item. Text rather than a pg enum so a third scope is a code
    // change, not a migration — same call as waitlist.status.
    scope: text("scope").notNull(),
    // Set only when scope = 'item'.
    slug: text("slug"),

    // Who it was for, in the sharer's own words. The whole point of an
    // inventory is being able to answer "who has a live link" six weeks later.
    label: text("label"),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Mirrors the signed `exp`. Duplicated out of the token deliberately: the
    // token is not stored, so without this column the inventory could not show
    // when a link dies.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    // Redemption only, not per request — see SESSION_MAX_SECONDS in
    // lib/share.ts for why this undercounts views.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    index("share_links_created_idx").on(t.createdAt),
    index("share_links_expires_idx").on(t.expiresAt),
  ],
);

export type Waitlist = typeof waitlist.$inferSelect;
export type CliToken = typeof cliTokens.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
