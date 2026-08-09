import { and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, dbConfigured, schema } from "@/db";
import { checkAuthLimit, recordAuthFailure } from "@/lib/auth-limit";
import { consumeAuthToken, mintAuthToken } from "@/lib/auth-tokens";
import { hashClientIp } from "@/lib/client-ip";
import { sendEmailVerification } from "@/lib/notify";
import { absoluteUrl } from "@/lib/site-url";
import { findUserByEmail, normaliseEmail } from "@/lib/users";

/**
 * Email verification — request (POST) and completion (PUT).
 *
 * Only credentials accounts ever need this. An OAuth sign-in arrives with the
 * address already verified by a provider we checked (see providerVerifiedEmail
 * in src/auth.ts), and Auth.js stamps `emailVerified` itself.
 *
 * Same non-committal response as the reset endpoint, for the same reason.
 */

const RequestBody = z.object({ email: z.string().email().max(254) });
const CompleteBody = z.object({ token: z.string().min(10).max(200) });

const SAME_ANSWER = {
  ok: true,
  message: "If that address needs confirming, a link is on its way.",
};

export async function POST(req: Request) {
  const parsed = await req
    .json()
    .then((raw) => RequestBody.safeParse(raw))
    .catch(() => null);

  if (!parsed?.success) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!dbConfigured()) {
    return Response.json({ error: "Accounts are not configured yet." }, { status: 503 });
  }

  const email = normaliseEmail(parsed.data.email);
  const ipHash = hashClientIp(req);

  const limit = await checkAuthLimit(email, ipHash);
  if (limit.limited) return Response.json(SAME_ANSWER);
  await recordAuthFailure(email, ipHash);

  try {
    const user = await findUserByEmail(email);
    // Already verified means there is nothing to send, and re-sending would
    // let anyone mail a confirmed user a stream of confirmation links.
    if (user && user.status === "active" && user.emailVerified === null) {
      const token = await mintAuthToken("verify", email);
      await sendEmailVerification(email, absoluteUrl(`/verify/${token}`, req));
    }
  } catch (err) {
    console.error("[verify] request failed", err);
  }

  return Response.json(SAME_ANSWER);
}

export async function PUT(req: Request) {
  const parsed = await req
    .json()
    .then((raw) => CompleteBody.safeParse(raw))
    .catch(() => null);

  if (!parsed?.success) {
    return Response.json({ error: "That link is not valid." }, { status: 400 });
  }
  if (!dbConfigured()) {
    return Response.json({ error: "Accounts are not configured yet." }, { status: 503 });
  }

  const email = await consumeAuthToken("verify", parsed.data.token);
  if (!email) {
    return Response.json(
      { error: "That link has expired or has already been used." },
      { status: 400 },
    );
  }

  // `and(...)`, not `&&`. Drizzle conditions are objects, so `a && b` is just
  // `b` — which here would have been "every user whose email is unverified",
  // silently verifying the whole table on one click.
  //
  // The isNull guard: if the address was verified in the meantime by an OAuth
  // sign-in, that timestamp is the true one and a stale link should not
  // overwrite it with today's date.
  await db()
    .update(schema.users)
    .set({ emailVerified: new Date() })
    .where(
      and(
        sql`lower(${schema.users.email}) = ${email}`,
        isNull(schema.users.emailVerified),
      ),
    );

  return Response.json({ ok: true });
}
