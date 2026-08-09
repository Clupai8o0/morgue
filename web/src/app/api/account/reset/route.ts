import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, dbConfigured, schema } from "@/db";
import { checkAuthLimit, recordAuthFailure } from "@/lib/auth-limit";
import { consumeAuthToken, mintAuthToken, pruneExpiredTokens } from "@/lib/auth-tokens";
import { hashClientIp } from "@/lib/client-ip";
import { sendPasswordReset } from "@/lib/notify";
import { absoluteUrl } from "@/lib/site-url";
import { hashPassword, passwordProblem } from "@/lib/password";
import { bumpSessionVersion, findUserByEmail, normaliseEmail } from "@/lib/users";

/**
 * Password reset — request (POST) and completion (PUT).
 *
 * This is also how a password is set for the FIRST time. An account created by
 * `pnpm user add` or by claiming an invite has `passwordHash` null; "forgot
 * password" against it does the right thing without a separate set-password
 * flow, because both are the same operation: prove you hold the mailbox, then
 * choose a secret.
 *
 * ── The response is the same whatever happened ──────────────────────────────
 *
 * No account, an account with no password, a send failure — all 200 with the
 * same body. Any variation is an oracle for "does this address have a morgue
 * account", which for a private collection is worth something on its own. The
 * cost is that a genuine delivery failure is invisible to the user, so
 * lib/notify.ts logs it loudly; that is a deliberate trade and not an
 * oversight.
 */

const RequestBody = z.object({ email: z.string().email().max(254) });
const CompleteBody = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1).max(400),
});

const SAME_ANSWER = {
  ok: true,
  message: "If that address has an account, a reset link is on its way.",
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

  // Rate limited on the same counters as sign-in. Reset requests are a free
  // way to send mail from someone else's domain to an address of your
  // choosing, so an unlimited endpoint here is an open relay with extra steps.
  const limit = await checkAuthLimit(email, ipHash);
  if (limit.limited) {
    return Response.json(SAME_ANSWER, {
      status: 200,
      headers: { "retry-after": String(limit.retryAfter) },
    });
  }
  await recordAuthFailure(email, ipHash);

  try {
    const user = await findUserByEmail(email);
    if (user && user.status === "active") {
      const token = await mintAuthToken("reset", email);
      await sendPasswordReset(email, absoluteUrl(`/reset/${token}`, req));
    }
    void pruneExpiredTokens();
  } catch (err) {
    // Logged, not surfaced. See the header.
    console.error("[reset] request failed", err);
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

  const { token, password } = parsed.data;

  // Password rules BEFORE the token is spent. Consuming it and then rejecting
  // "too short" would burn a single-use link on a typo and force the user back
  // through their inbox.
  const problem = passwordProblem(password);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const email = await consumeAuthToken("reset", token);
  if (!email) {
    return Response.json(
      { error: "That link has expired or has already been used." },
      { status: 400 },
    );
  }

  const emailProblem = passwordProblem(password, email);
  if (emailProblem) return Response.json({ error: emailProblem }, { status: 400 });

  const user = await findUserByEmail(email);
  if (!user || user.status !== "active") {
    return Response.json({ error: "That link is no longer valid." }, { status: 400 });
  }

  await db()
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(password),
      // Holding the mailbox is exactly what verification means, and they just
      // proved it. An account created by `pnpm user add` becomes usable here.
      emailVerified: user.emailVerified ?? new Date(),
    })
    .where(eq(schema.users.id, user.id));

  // Every session this user had, everywhere, dies within
  // SESSION_RECHECK_SECONDS. A password reset is the one moment where "log me
  // out of the device I lost" is the entire point of the exercise.
  await bumpSessionVersion(user.id);

  return Response.json({ ok: true });
}
