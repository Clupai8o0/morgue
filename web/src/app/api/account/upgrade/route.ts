import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, dbConfigured, schema } from "@/db";
import { checkAuthLimit } from "@/lib/auth-limit";
import { hashClientIp } from "@/lib/client-ip";
import { notifyUpgradeRequest } from "@/lib/notify";
import { planOf } from "@/lib/plan";
import { findUserById } from "@/lib/users";

/**
 * Asking for a bigger cap.
 *
 * There is no payment page — the decision was free-with-hard-caps, and the
 * upgrade path is that a person reads the request and raises `users.plan`.
 *
 * The row is committed BEFORE the notification, and the notification is
 * best-effort. That order is deliberate: notifyUpgradeRequest swallows its
 * failures (it must, or a mail outage would fail a request that already
 * succeeded), so if the mail were the only record then an unset RESEND_API_KEY
 * would turn "asked" into a green tick with nothing behind it. With the row
 * committed, the admin page can show the request and say plainly that nobody
 * was emailed.
 *
 * Deduped on the USER, not the address or the IP. The waitlist dedupes on a
 * unique email because it has no session to work with; here there is one, and
 * a signed-in person leaning on the button should mail the owner once.
 */

const Ask = z.object({ note: z.string().trim().max(1000).nullable().optional() });

async function me() {
  if (!dbConfigured()) return null;
  const session = await auth();
  const id = session?.user?.id;
  return id ? await findUserById(id) : null;
}

export async function POST(req: Request) {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  const parsed = await req
    .json()
    .then((raw) => Ask.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "That note is too long." }, { status: 400 });
  }

  // IP dimension only — see the note in the delete route on why the caller's
  // own address must not be charged for this.
  const limit = await checkAuthLimit(null, hashClientIp(req));
  if (limit.limited) {
    return Response.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const conn = db();
  const pending = await conn
    .select({ id: schema.upgradeRequests.id })
    .from(schema.upgradeRequests)
    .where(
      and(
        eq(schema.upgradeRequests.userId, user.id),
        eq(schema.upgradeRequests.status, "pending"),
      ),
    )
    .limit(1);

  if (pending.length) {
    return Response.json({ ok: true, alreadyPending: true });
  }

  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;
  await conn.insert(schema.upgradeRequests).values({ userId: user.id, note });

  void notifyUpgradeRequest({ email: user.email, plan: planOf(user), note });

  return Response.json({ ok: true, alreadyPending: false });
}
