import { z } from "zod";
import { auth } from "@/auth";
import { dbConfigured } from "@/db";
import { checkAuthLimit, recordAuthFailure } from "@/lib/auth-limit";
import { hashClientIp } from "@/lib/client-ip";
import { deleteAccount, findUserById, normaliseEmail } from "@/lib/users";

/**
 * Deleting your own account. Never anybody else's — the id comes from the
 * session and this route takes no user parameter at all.
 *
 * POST rather than DELETE because DELETE on /api/account/me is already
 * provider-unlink, and two destructive verbs one path apart is how the wrong
 * one gets called.
 *
 * The confirmation is the guard, not the rate limiter. Typing your own address
 * is a deliberate speed bump against a mis-click and against a borrowed
 * unlocked laptop; the limiter (which fails open, by design, in auth-limit.ts)
 * only stops someone grinding at it. Failures are counted against the IP
 * dimension alone: recording against the user's own address would spend their
 * sign-in budget and lock them out of the account they are trying to keep.
 *
 * What deletion actually does, and in what order, is deleteAccount() in
 * lib/users.ts. The ordering matters and the reasoning is there.
 */

const Confirm = z.object({ confirm: z.string().max(254) });

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
    .then((raw) => Confirm.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json(
      { error: "Type your email address to confirm." },
      { status: 400 },
    );
  }

  const ipHash = hashClientIp(req);
  const limit = await checkAuthLimit(null, ipHash);
  if (limit.limited) {
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  if (normaliseEmail(parsed.data.confirm) !== normaliseEmail(user.email)) {
    await recordAuthFailure(null, ipHash);
    return Response.json(
      { error: "That is not the address on this account." },
      { status: 403 },
    );
  }

  const result = await deleteAccount(user.id);
  if (!result.ok) {
    if (result.reason === "last-admin") {
      return Response.json(
        {
          error:
            "You are the only administrator. Make someone else an admin first.",
        },
        { status: 409 },
      );
    }
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  return Response.json({ ok: true, deleted: true });
}
