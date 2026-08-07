import { createHash } from "node:crypto";
import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db, dbConfigured } from "@/db";
import { waitlist } from "@/db/schema";
import { notifyNewSignup } from "@/lib/notify";

/**
 * Public access-request endpoint.
 *
 * This is a waitlist, not a signup: it creates no account, grants nothing, and
 * gives nobody storage. That is the entire security model — there is no
 * privilege to escalate to, because the only writer to this system is the
 * owner at the CLI.
 */

const Body = z.object({
  email: z.string().email().max(254),
  // Bounded because it is free text from the open internet that ends up in an
  // email I will read.
  note: z.string().max(500).optional().or(z.literal("")),
});

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;

function hashIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  if (!ip) return null;
  // Salted so the table can't be brute-forced back to raw addresses — the
  // whole IPv4 space is only 4 billion hashes otherwise.
  const salt = process.env.IP_HASH_SALT ?? "morgue";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export async function POST(req: Request) {
  // Validate BEFORE checking configuration. A malformed request is a 400
  // whether or not the database happens to be reachable, and answering 503 to
  // bad input tells the caller the wrong thing to fix.
  const parsed = await req
    .json()
    .then((raw) => Body.safeParse(raw))
    .catch(() => null);

  if (!parsed?.success) {
    // Name the field that actually failed. "Enter a valid email address" in
    // response to a too-long note sends the user to fix the wrong input.
    const field = parsed?.error.issues[0]?.path[0];
    return Response.json(
      {
        error:
          field === "note"
            ? "That note is too long — 500 characters max."
            : "Enter a valid email address.",
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  if (!dbConfigured()) {
    return Response.json(
      { error: "Waitlist is not configured yet." },
      { status: 503 },
    );
  }

  const email = body.email.trim().toLowerCase();
  const note = body.note?.trim() || null;
  const ipHash = hashIp(req);

  try {
    const conn = db();

    if (ipHash) {
      const since = new Date(Date.now() - WINDOW_MS);
      const [{ n }] = await conn
        .select({ n: count() })
        .from(waitlist)
        .where(and(eq(waitlist.ipHash, ipHash), gt(waitlist.createdAt, since)));

      if (Number(n) >= MAX_PER_WINDOW) {
        return Response.json(
          { error: "Too many requests. Try again later." },
          { status: 429 },
        );
      }
    }

    const inserted = await conn
      .insert(waitlist)
      .values({ email, note, ipHash })
      .onConflictDoNothing({ target: waitlist.email })
      .returning({ id: waitlist.id });

    // Only notify on a genuinely new row. Re-submitting the same address
    // should not let anyone spam the owner's inbox.
    if (inserted.length > 0) {
      await notifyNewSignup({ email, note });
    }

    // Identical response either way: whether an address is already on the list
    // is not something a stranger should be able to probe for.
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[waitlist]", err);
    return Response.json({ error: "Could not save that. Try again." }, { status: 500 });
  }
}
