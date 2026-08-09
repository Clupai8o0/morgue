import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, dbConfigured, schema } from "@/db";
import { signInMethods } from "@/lib/link-policy";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "@/lib/password";
import {
  bumpSessionVersion,
  findUserById,
  setDisplayName,
  unlinkProvider,
} from "@/lib/users";

/**
 * The signed-in user's own account. Never anybody else's.
 *
 * Every handler derives the user id from the SESSION and there is no path that
 * takes one from the request — the same rule /api/media will follow in phase 3
 * (MULTI-TENANT.md §4.1). An endpoint that accepts "which user" as a parameter
 * is one missing check away from editing a stranger's credentials.
 *
 * proxy.ts also refuses this route to any share cookie before it runs, the
 * same doubling /api/share uses.
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

  const methods = await signInMethods(user.id);
  return Response.json({
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    plan: user.plan,
    emailVerified: user.emailVerified !== null,
    providers: methods.providers,
    hasPassword: methods.hasPassword,
    // The client greys out the last remaining control rather than letting
    // someone discover the guard by being locked out.
    canRemoveOne: methods.total > 1,
  });
}

const Unlink = z.object({ provider: z.enum(["github", "google"]) });

export async function DELETE(req: Request) {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  const parsed = await req
    .json()
    .then((raw) => Unlink.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "Which provider?" }, { status: 400 });
  }

  const result = await unlinkProvider(user.id, parsed.data.provider);
  if (!result.ok) {
    return Response.json(
      {
        error:
          result.reason === "last-method"
            ? "That is the only way you can sign in. Set a password or connect another provider first."
            : "That provider is not connected.",
      },
      { status: 409 },
    );
  }
  return Response.json({ ok: true });
}

const Profile = z.object({ name: z.string().trim().min(1).max(100).nullable() });

/**
 * The display name, and nothing else.
 *
 * No session bump: a display name is not an authentication factor and nothing
 * resolves an account by it. Contrast PATCH below, which changes a credential
 * and therefore ends every session.
 */
export async function PUT(req: Request) {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  const parsed = await req
    .json()
    .then((raw) => Profile.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "Enter a name, or clear it." }, { status: 400 });
  }

  await setDisplayName(user.id, parsed.data.name);
  return Response.json({ ok: true });
}

const ChangePassword = z.object({
  current: z.string().max(400).optional(),
  password: z.string().min(1).max(400),
});

/**
 * Set or change the password, while signed in.
 *
 * An account with no password (created by an admin, or by an OAuth sign-in)
 * can set one here without proving anything beyond the session — they are
 * already authenticated, and requiring a "current password" that does not
 * exist is a dead end. Changing an EXISTING password does require it, because
 * a borrowed unlocked laptop should not be enough to take an account over.
 */
export async function PATCH(req: Request) {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  const parsed = await req
    .json()
    .then((raw) => ChangePassword.safeParse(raw))
    .catch(() => null);
  if (!parsed?.success) {
    return Response.json({ error: "Enter a new password." }, { status: 400 });
  }

  if (user.passwordHash) {
    const current = parsed.data.current ?? "";
    if (!current || !(await verifyPassword(current, user.passwordHash))) {
      return Response.json({ error: "That current password is wrong." }, { status: 403 });
    }
  }

  const problem = passwordProblem(parsed.data.password, user.email);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  await db()
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      // Setting a password while signed in does not prove the mailbox, so it
      // must not mark the address verified. Password sign-in stays refused
      // until /reset or /verify confirms it — otherwise an admin-created
      // account could give itself a password and skip verification entirely.
      emailVerified: user.emailVerified,
    })
    .where(eq(schema.users.id, user.id));

  // Ends every session including this one. That is the correct behaviour for
  // "someone may have my old password" and it is the reason the response says
  // so plainly rather than leaving the user wondering why they were logged out.
  await bumpSessionVersion(user.id);

  return Response.json({
    ok: true,
    signedOut: true,
    emailVerified: user.emailVerified !== null,
  });
}
