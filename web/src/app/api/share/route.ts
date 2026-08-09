import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, authConfigured } from "@/auth";
import { db, dbConfigured, schema } from "@/db";
import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  isSlug,
  mintShareToken,
  shareConfigured,
  tokenHash,
  type ShareScope,
} from "@/lib/share";

/**
 * Issue, list and revoke share links. OWNER ONLY.
 *
 * proxy.ts refuses /api/share to any share cookie before this file runs, and
 * the session check below is the second lock rather than the only one — a
 * route that mints credentials should not depend on a matcher pattern being
 * right.
 *
 * Issuing needs AUTH_SECRET and nothing else. Listing and revoking need
 * DATABASE_URL, and say so with a 501 rather than pretending there is nothing
 * to show: "no links" and "cannot see links" are different answers and
 * conflating them is how someone concludes they have not shared anything.
 */

const CreateBody = z.object({
  scope: z.enum(["vault", "item"]),
  slug: z.string().optional(),
  /** Hours. Clamped again in mintShareToken; validated here for a clear 400. */
  ttlHours: z.number().int().positive().max(MAX_TTL_SECONDS / 3600).optional(),
  label: z.string().trim().max(120).optional(),
});

async function owner() {
  if (!authConfigured()) {
    // Development with no OAuth app configured. proxy.ts already fails open
    // here (and closed in production), so this mirrors it rather than
    // inventing a second policy. The sentinel is not a uuid on purpose: it
    // must be recognisable in the links inventory as "issued by a machine with
    // no auth configured", not mistaken for a real account.
    return process.env.NODE_ENV === "production" ? null : { id: "dev-unauthenticated" };
  }
  const session = await auth();
  const id = session?.user?.id;
  return id ? { id } : null;
}

export async function POST(req: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  if (!shareConfigured()) {
    return NextResponse.json(
      {
        error:
          "AUTH_SECRET is not set, so share links cannot be signed. " +
          "Generate one with `openssl rand -base64 32`.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const { scope: kind, slug, ttlHours, label } = parsed.data;
  if (kind === "item" && (!slug || !isSlug(slug))) {
    return NextResponse.json(
      { error: "An item link needs a valid slug." },
      { status: 400 },
    );
  }

  const scope: ShareScope = kind === "vault" ? { kind: "vault" } : { kind: "item", slug: slug! };
  const ttl = ttlHours ? ttlHours * 3600 : DEFAULT_TTL_SECONDS;
  const { token, payload } = mintShareToken(scope, ttl);

  // Recorded when possible, issued regardless. The link is already valid the
  // moment it is signed; the row only buys the ability to list and revoke it.
  let recorded = false;
  if (dbConfigured()) {
    try {
      await db().insert(schema.shareLinks).values({
        jti: payload.jti,
        tokenHash: tokenHash(token),
        scope: kind,
        slug: kind === "item" ? slug! : null,
        label: label || null,
        // The users.id uuid, not a display name. Phase 3 turns this into a
        // real foreign key when share links gain an owner dimension; recording
        // the id now means that migration is a type change, not a lookup
        // against names that may no longer be unique.
        createdBy: who.id,
        expiresAt: new Date(payload.exp * 1000),
      });
      recorded = true;
    } catch (err) {
      console.error("[share] could not record link", err);
    }
  }

  return NextResponse.json({
    token,
    url: `/s/${token}`,
    jti: payload.jti,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    scope: kind,
    slug: kind === "item" ? slug : null,
    // The client surfaces this. A link that cannot be revoked should say so at
    // the moment it is created, not when someone goes looking for the button.
    revocable: recorded,
  });
}

export async function GET() {
  const who = await owner();
  if (!who) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  if (!dbConfigured()) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL is not set, so issued links are not recorded and " +
          "cannot be listed or individually revoked. Links already work; " +
          "rotating AUTH_SECRET invalidates all of them at once.",
        links: null,
      },
      { status: 501 },
    );
  }

  const { desc } = await import("drizzle-orm");
  const links = await db()
    .select()
    .from(schema.shareLinks)
    .orderBy(desc(schema.shareLinks.createdAt))
    .limit(200);

  return NextResponse.json({ links });
}

export async function DELETE(req: Request) {
  const who = await owner();
  if (!who) return NextResponse.json({ error: "Not authorised" }, { status: 401 });

  if (!dbConfigured()) {
    return NextResponse.json(
      {
        error:
          "DATABASE_URL is not set, so there is no record to revoke. Rotate " +
          "AUTH_SECRET to invalidate every outstanding link at once.",
      },
      { status: 501 },
    );
  }

  const jti = new URL(req.url).searchParams.get("jti");
  if (!jti) return NextResponse.json({ error: "jti is required" }, { status: 400 });

  const { eq } = await import("drizzle-orm");
  const updated = await db()
    .update(schema.shareLinks)
    .set({ revokedAt: new Date() })
    .where(eq(schema.shareLinks.jti, jti))
    .returning({ jti: schema.shareLinks.jti });

  if (!updated.length) {
    return NextResponse.json({ error: "No such link" }, { status: 404 });
  }

  // Honest about the lag rather than implying the link died this instant.
  return NextResponse.json({
    revoked: updated[0].jti,
    effectiveWithin: "1 hour",
    note:
      "Existing sessions keep working until their cookie expires — see " +
      "SESSION_MAX_SECONDS in lib/share.ts.",
  });
}
