import { z } from "zod";
import { auth } from "@/auth";
import { dbConfigured } from "@/db";
import { checkAuthLimit, recordAuthFailure } from "@/lib/auth-limit";
import { consumeAuthToken, mintAuthToken } from "@/lib/auth-tokens";
import { hashClientIp } from "@/lib/client-ip";
import { sendEmailChange } from "@/lib/notify";
import { absoluteUrl } from "@/lib/site-url";
import {
  applyEmailChange,
  findUserByEmail,
  findUserById,
  normaliseEmail,
} from "@/lib/users";

/**
 * Moving an account to a different address. Request (POST), complete (PUT).
 *
 * ── Nothing is written until the new mailbox answers ───────────────────────
 *
 * The users row is untouched by POST. That is not politeness, it is the whole
 * security property: an address on a users row is an identity claim, because
 * link-policy.ts will attach an unlinked OAuth sign-in to whatever row holds
 * that address once a provider has verified it. Parking an address you do not
 * control therefore means the real owner's Google sign-in lands INSIDE YOUR
 * VAULT. Writing it unverified-but-present is the bug; writing it only on
 * redemption is the fix.
 *
 * It also means a typo cannot lock anybody out. The old address keeps working,
 * verified, until the new one is proven — so the failure mode of getting it
 * wrong is "no email arrived", not "I can no longer sign in".
 *
 * ── The request is deliberately non-committal ──────────────────────────────
 *
 * A signed-in user asking about an address is a lookup over the whole users
 * table, which is the same oracle the reset endpoint refuses to be. So a free
 * address and a taken one produce byte-identical responses and only one of them
 * sends mail. The 409 on completion is fine by contrast — by then the caller
 * has proved they read mail at that address, and they could learn the same
 * thing by trying to sign in with it.
 *
 * The user id comes from the session. The token also carries one, and the two
 * are COMPARED — the token's is never trusted on its own.
 */

const Ask = z.object({ email: z.string().email().max(254) });
const Complete = z.object({ token: z.string().min(10).max(200) });

const SAME_ANSWER = {
  ok: true,
  message: "If that address can be used, a confirmation link is on its way.",
};

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
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const target = normaliseEmail(parsed.data.email);
  if (target === normaliseEmail(user.email)) {
    return Response.json({ error: "That is already your address." }, { status: 400 });
  }

  // Sends mail to an address of the caller's choosing, so unlimited it is an
  // open relay with extra steps — the same reasoning as the reset endpoint.
  // Counted against the TARGET, not the caller's own address: recording against
  // their own would spend their sign-in budget and lock them out of the account
  // they are currently using.
  const ipHash = hashClientIp(req);
  const limit = await checkAuthLimit(target, ipHash);
  if (limit.limited) {
    return Response.json(SAME_ANSWER, {
      status: 200,
      headers: { "retry-after": String(limit.retryAfter) },
    });
  }
  await recordAuthFailure(target, ipHash);

  try {
    const taken = await findUserByEmail(target);
    if (!taken) {
      // The composite is the identifier — see lib/auth-tokens.ts on why the
      // user id has to travel with it.
      const token = await mintAuthToken("emailchange", `${user.id}:${target}`);
      await sendEmailChange(target, absoluteUrl(`/account/email/${token}`, req));
    }
  } catch (err) {
    // Logged, not surfaced: siteOrigin() throws in production without AUTH_URL,
    // and that must be a line in the log rather than a 500 that also tells the
    // caller whether the address existed.
    console.error("[email-change] request failed", err);
  }

  return Response.json(SAME_ANSWER);
}

export async function PUT(req: Request) {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  const parsed = await req
    .json()
    .then((raw) => Complete.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "That link is not valid." }, { status: 400 });
  }

  const claim = await consumeAuthToken("emailchange", parsed.data.token);
  if (!claim) {
    return Response.json(
      { error: "That link has expired or has already been used." },
      { status: 400 },
    );
  }

  // Split on the FIRST colon: a uuid contains none, an address cannot contain
  // an unquoted one.
  const cut = claim.indexOf(":");
  const uid = cut === -1 ? "" : claim.slice(0, cut);
  const next = cut === -1 ? "" : claim.slice(cut + 1);
  if (!uid || !next) {
    return Response.json({ error: "That link is not valid." }, { status: 400 });
  }

  // The token names an account; the session names an account. They must agree.
  // Without this a link mailed to one person could be redeemed while signed in
  // as another, moving somebody else's address onto your row.
  if (uid !== user.id) {
    return Response.json(
      { error: "That link belongs to a different account." },
      { status: 403 },
    );
  }

  const moved = await applyEmailChange(user.id, user.email, next);
  if (!moved) {
    // Taken between the request and now. Honest, because the caller has proved
    // they hold the mailbox.
    return Response.json({ error: "That address is already in use." }, { status: 409 });
  }

  return Response.json({ ok: true, signedOut: true, email: next });
}
