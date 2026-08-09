import { auth } from "@/auth";
import { dbConfigured } from "@/db";
import { bumpSessionVersion, findUserById } from "@/lib/users";

/**
 * Sign out everywhere.
 *
 * There is no session table to clear — the strategy is JWT and `sessions` is
 * defined but never read (db/schema.ts). Revocation is one integer:
 * `users.sessionVersion` is bumped, every outstanding token carries the old
 * value, and auth.ts rejects on the mismatch at its next recheck.
 *
 * Two consequences the UI must state rather than hide:
 *
 *   - It ends THIS session too. There is no exempt-the-caller path, and adding
 *     one would mean the revocation could be dodged by whoever triggered it.
 *   - It is not instant. Up to AUTH_SESSION_RECHECK_SECONDS (default 60) in
 *     production, because the whole point of the design is that the common path
 *     does not query the database.
 *
 * The user id comes from the session and nowhere else — see the note at the top
 * of api/account/me/route.ts.
 */

async function me() {
  if (!dbConfigured()) return null;
  const session = await auth();
  const id = session?.user?.id;
  return id ? await findUserById(id) : null;
}

export async function DELETE() {
  const user = await me();
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });

  // bumpSessionVersion is the one function in lib/users.ts with no
  // dbConfigured() guard — it calls db() directly, which throws when
  // DATABASE_URL is unset. Safe here only because me() already returned null in
  // that case.
  await bumpSessionVersion(user.id);

  return Response.json({ ok: true, signedOut: true });
}
