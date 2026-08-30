import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

/**
 * The database.
 *
 * ── What changed, and why the old comment is gone ───────────────────────────
 *
 * This file used to open by saying the vault is NOT in Postgres — items are
 * built from items/ on disk into static JSON, browsing never touches a
 * database. That was correct for exactly one user, who owns the filesystem and
 * can run `pnpm build`. It stops being true the moment a second person has a
 * vault, because they cannot. See docs/MULTI-TENANT.md § 5.
 *
 * As of the multi-tenant pivot the split is:
 *
 *   - IDENTITY lives here. Who exists, what they may do, whether they are
 *     still allowed in. That is transactional state and always was.
 *   - The OWNER'S COLLECTION still comes from items/ through the capture
 *     pipeline. The folder contract in CLAUDE.md is unchanged.
 *   - Everyone ELSE'S collection will live here too (`vaultItems`, phase 3).
 *     It does not exist yet and this file does not pretend it does.
 *
 * ── Tables that need no explanation on sight ────────────────────────────────
 *
 * `sessions` is defined and migrated but NEVER READ, because the session
 * strategy is JWT (see src/auth.ts). It exists because @auth/drizzle-adapter
 * builds its own default `session` table when one is not supplied, and that
 * default declares `userId` as `text` referencing our `uuid` — a type mismatch
 * that would surface only if something ever touched it. Supplying a correct
 * table is cheaper than relying on nobody switching strategies.
 *
 * `shareLinks` is the one table the app runs WITHOUT. Share tokens are signed
 * and carry their own expiry (see lib/share.ts), so issuing and validating a
 * link needs no database at all. This table adds only what a signature cannot
 * express: an inventory of what is outstanding, and the ability to kill one
 * link before it expires. When DATABASE_URL is absent, links still work and
 * the admin page says plainly that they cannot be listed or individually
 * revoked.
 *
 * Identity has no such fallback and must not grow one. With no database there
 * are no users, and with no users nobody signs in — that is rule 9 (fail
 * closed) expressed as a schema rather than as an env var.
 */

/* ─── Identity ──────────────────────────────────────────────────────────── */

/**
 * The five TS property names Auth.js reaches for — `id`, `name`, `email`,
 * `emailVerified`, `image` — are fixed by @auth/drizzle-adapter, which does
 * `.values(user)` with objects it builds itself. The DB column names are ours,
 * hence snake_case throughout. Renaming a *property* here breaks OAuth
 * sign-in at runtime and nowhere else; renaming a *column* is just a
 * migration.
 *
 * Emails are stored lowercased. Normalisation happens in each provider's
 * `profile()` callback rather than here, because the adapter looks a user up
 * by email BEFORE any callback of ours runs — see the note in src/auth.ts.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email").notNull().unique(),

    // Auth.js semantics: a timestamp, not a boolean. Null means unverified.
    // OAuth sign-ins set it (the provider did the verifying); a credentials
    // sign-up leaves it null until the emailed link is opened, and auth.ts
    // refuses to issue a session while it is null.
    emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
    image: text("image"),

    // Null for OAuth-only accounts. Its presence is what makes the credentials
    // provider willing to consider this user at all.
    passwordHash: text("password_hash"),

    // user | admin. Text rather than a pg enum for the same reason
    // waitlist.status is: a third role should be a code change.
    role: text("role").notNull().default("user"),
    // active | suspended.
    status: text("status").notNull().default("active"),

    /**
     * free | extended. What this account is allowed to hold — see lib/plan.ts,
     * where the numbers live.
     *
     * A column rather than an env var, deliberately: rule 9 says not to keep a
     * second answer to "may this person" beside the table, and a cap raised for
     * one person is per-person state by definition. The CAPS themselves are
     * constants in code, because they are policy rather than data and a
     * deployment should not be able to quietly widen them.
     *
     * There is no billing. The only way this changes is an admin granting an
     * upgrade request — see `upgradeRequests` below.
     */
    plan: text("plan").notNull().default("free"),

    /**
     * Bumped on password change and on suspension. The JWT carries the value
     * it was minted with, and auth.ts compares the two — so revocation costs
     * one integer instead of a session table on the read path. It is not
     * instant: see SESSION_RECHECK_SECONDS in src/auth.ts for the honest lag.
     */
    sessionVersion: integer("session_version").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    // Belt and braces over storing lowercase. The plain unique constraint on
    // the column is exact-match, so it would happily accept
    // "Person@Example.com" alongside "person@example.com" — two accounts, one
    // human, and an account-linking policy that can no longer tell. This
    // functional index is the one that actually forbids it.
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    index("users_created_idx").on(t.createdAt),
  ],
);

/**
 * OAuth links. Property names here are dictated by Auth.js down to the
 * snake_case ones (`refresh_token`, `expires_at`, …) — those are the provider
 * response fields verbatim, and the adapter spreads the response object
 * straight in. They look inconsistent because they are not ours to name.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_idx").on(t.userId),
  ],
);

/** Defined, migrated, never read. See the file header. */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

/**
 * Single-use tokens. Auth.js owns this table for its Email provider, and we
 * borrow it for the two flows credentials sign-in needs, distinguished by a
 * prefix on `identifier`:
 *
 *   verify:<email>   email verification after sign-up
 *   reset:<email>    password reset
 *
 * A prefix rather than a `purpose` column so the adapter's own use of the
 * table (bare email as identifier) keeps working untouched, and so a
 * verification token can never be redeemed as a reset token: the lookup is by
 * the whole identifier, not by the email.
 *
 * The token column stores a SHA-256 of what was emailed, never the value
 * itself — a database dump must not hand over the ability to take over an
 * account. Consumption is a DELETE, which is what makes it single-use.
 */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.identifier, t.token] }),
    // The composite primary key indexes (identifier, token), which cannot
    // serve a lookup by token alone — and a lookup by token alone is the only
    // one a redemption can do, because the link in the email deliberately does
    // not carry the address it belongs to.
    index("verification_tokens_token_idx").on(t.token),
  ],
);

/**
 * Failed sign-in attempts, for lockout. One row per failure, pruned on write.
 *
 * Postgres rather than an in-memory counter because serverless instances do
 * not share memory: a limiter that lives in a module-scope Map protects one
 * lambda from one attacker and nothing else. Both dimensions are recorded
 * because they stop different attacks — per-email stops credential stuffing
 * against one account, per-IP stops one host spraying many accounts — and a
 * limiter with only the first is trivially defeated by rotating the target.
 *
 * `ipHash` is hashed with IP_HASH_SALT, the same primitive the waitlist
 * limiter already uses: enough to recognise a repeat caller, not enough to be
 * personal data with a retention obligation.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    ipHash: text("ip_hash"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auth_attempts_email_idx").on(t.email, t.at),
    index("auth_attempts_ip_idx").on(t.ipHash, t.at),
  ],
);

/**
 * Somebody asking for a bigger cap.
 *
 * There is no payment page — the billing decision was free-with-hard-caps, and
 * the upgrade path is that a human reads this and raises the number
 * (docs/DECISIONS.md § "Free with hard caps, and the waitlist stays").
 *
 * It is a TABLE rather than a fire-and-forget email for three reasons, all of
 * which the waitlist already learned: an email cannot dedupe, so a signed-in
 * user leaning on the button mails the owner forty times; there would be no
 * review surface, so a request is only ever as durable as an inbox; and
 * `notifyUpgradeRequest` swallows its failures by design, so with
 * RESEND_API_KEY unset a green tick would be a lie. The row is committed first
 * and the mail is best-effort after, which makes "nobody was emailed" a state
 * the admin page can show rather than a silence.
 *
 * `userId` is a REAL foreign key with a cascade, unlike `shareLinks.createdBy`
 * — this table has no reason to outlive its user, so the cascade is the whole
 * of its cleanup and `deleteAccount()` needs no statement for it. Share links
 * are the opposite case and the contrast is deliberate: see the delete order in
 * lib/users.ts.
 */
export const upgradeRequests = pgTable(
  "upgrade_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note"),
    // pending | granted | declined. Text, as everywhere else here.
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("upgrade_requests_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Per-user API tokens for the MCP server.
 *
 * These authenticate a coding agent to ONE account over the hosted MCP
 * transport (app/api/mcp) — the same "who may be here" decision src/auth.ts
 * makes for a browser session, reached without a browser. A token is minted in
 * /account, shown once, and carried as `Authorization: Bearer <token>`.
 *
 * ── Why a table and not a signed token ──────────────────────────────────────
 *
 * The same reasoning as lib/auth-tokens.ts over lib/share.ts: an agent's
 * standing key to the whole vault must be REVOCABLE the instant it leaks, and
 * single-use / revocation is a fact about the world you cannot sign into a
 * bearer string. So the token is opaque random bytes, we store only its
 * SHA-256 — a database dump is not replayable, exactly as `cli_tokens` and
 * `share_links` — and revoking sets `revokedAt`, which the auth path reads on
 * every call.
 *
 * ── Why userId, unlike cli_tokens ───────────────────────────────────────────
 *
 * `cli_tokens` is a deployment-wide key for `publish:r2` and belongs to no
 * person. This one IS a person: it inherits their role, plan and suspension,
 * re-checked live against the `users` row on every request (admissionProblem in
 * lib/users.ts). The FK cascades, so a deleted account takes its tokens with it
 * — the same contract `upgrade_requests` has and `share_links` deliberately
 * does not.
 */
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The user's own label — "cursor on my laptop". The point of a list is
    // answering "what did I hand a key to" six weeks later.
    name: text("name").notNull(),
    // sha256 of the token. The plaintext is shown once at creation and never
    // stored, so a database dump does not hand over vault access.
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("mcp_tokens_user_idx").on(t.userId, t.createdAt)],
);

/* ─── Everything that was already here ──────────────────────────────────── */

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Waitlist = typeof waitlist.$inferSelect;
export type CliToken = typeof cliTokens.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type UpgradeRequest = typeof upgradeRequests.$inferSelect;
export type McpToken = typeof mcpTokens.$inferSelect;
