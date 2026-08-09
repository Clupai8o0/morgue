import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbConfigured, schema } from "@/db";
import { signInMethods } from "@/lib/link-policy";
import { findUserById, normaliseEmail } from "@/lib/users";

/**
 * Everything this deployment holds about you, as a file.
 *
 * ── What is deliberately NOT in here ───────────────────────────────────────
 *
 * Your collection. There is no per-user vault: items still belong to the
 * owner's single collection built from the filesystem, and no row anywhere
 * attributes one to an account (MULTI-TENANT.md §5, phase 3). Exporting the
 * vault would therefore mean exporting the OWNER'S vault — which is bought
 * third-party source, and handing it out is the one thing this repository is
 * arranged to prevent. `collection: null` says so explicitly rather than
 * omitting the key, so nobody reads the absence as an oversight.
 *
 * Secrets, of ours and of other people's. `passwordHash` (a dump of exports
 * must not be crackable), the OAuth `access_token` / `refresh_token` /
 * `id_token` (those are the PROVIDER'S credentials, not the user's data, and
 * they are live), `share_links.tokenHash` (a share table dump must not be
 * replayable as a working link), and `auth_attempts.ipHash`.
 *
 * The user id comes from the session and nowhere else.
 */

async function me() {
  if (!dbConfigured()) return null;
  const session = await auth();
  const id = session?.user?.id;
  return id ? await findUserById(id) : null;
}

export async function GET() {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  const conn = db();
  const email = normaliseEmail(user.email);

  const [methods, links, waitlistRows, upgrades, oauth] = await Promise.all([
    signInMethods(user.id),
    conn
      .select({
        jti: schema.shareLinks.jti,
        scope: schema.shareLinks.scope,
        slug: schema.shareLinks.slug,
        label: schema.shareLinks.label,
        createdAt: schema.shareLinks.createdAt,
        expiresAt: schema.shareLinks.expiresAt,
        revokedAt: schema.shareLinks.revokedAt,
        lastUsedAt: schema.shareLinks.lastUsedAt,
      })
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.createdBy, user.id)),
    conn
      .select({
        email: schema.waitlist.email,
        note: schema.waitlist.note,
        status: schema.waitlist.status,
        createdAt: schema.waitlist.createdAt,
        reviewedAt: schema.waitlist.reviewedAt,
      })
      .from(schema.waitlist)
      .where(sql`lower(${schema.waitlist.email}) = ${email}`)
      .limit(1),
    conn
      .select({
        note: schema.upgradeRequests.note,
        status: schema.upgradeRequests.status,
        createdAt: schema.upgradeRequests.createdAt,
        reviewedAt: schema.upgradeRequests.reviewedAt,
      })
      .from(schema.upgradeRequests)
      .where(eq(schema.upgradeRequests.userId, user.id)),
    // Which providers are linked and under which id at that provider. The
    // tokens on these rows are not ours to hand over and are omitted above.
    conn
      .select({
        provider: schema.accounts.provider,
        providerAccountId: schema.accounts.providerAccountId,
        type: schema.accounts.type,
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, user.id)),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 1,
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      status: user.status,
      plan: user.plan,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      // Always null today: touchLastSeen() has no caller anywhere. Exported as
      // the column rather than presented as a fact.
      lastSeenAt: user.lastSeenAt,
    },
    signInMethods: { providers: methods.providers, hasPassword: methods.hasPassword },
    oauthLinks: oauth,
    shareLinks: links,
    upgradeRequests: upgrades,
    waitlist: waitlistRows[0] ?? null,
    collection: null,
    note:
      "Your collection is not included. Items still belong to the owner's single " +
      "vault and have no per-account record yet, so there is nothing here that is " +
      "yours to export.",
  };

  return Response.json(payload, {
    headers: {
      "content-disposition": 'attachment; filename="morgue-account.json"',
      // A file of somebody's identity has no business in a shared cache.
      "cache-control": "no-store",
    },
  });
}
