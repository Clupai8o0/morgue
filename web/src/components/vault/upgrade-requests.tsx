import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, dbConfigured } from "@/db";
import { upgradeRequests, users } from "@/db/schema";
import { CAPS, formatBytes } from "@/lib/plan";

/**
 * People asking for a bigger cap, on /admin.
 *
 * Three states, and the middle one is the one that misleads — exactly the shape
 * ShareAdmin uses, for the same reason:
 *
 *   DATABASE_URL unset — there is nothing to show and nothing was recorded.
 *   RESEND_API_KEY unset — requests ARE recorded and nobody was emailed. This
 *     looks identical to "nobody has asked", so it gets said out loud.
 *   Both set — the list, with grant and decline.
 */

/**
 * Raising somebody's cap is a privilege change, so the role is checked HERE as
 * well as in proxy.ts. A server action is a POST endpoint with an id, and a
 * privilege change that depends on one matcher pattern being right is a
 * privilege change with a single point of failure — the same doubling
 * /api/share already uses.
 */
async function decide(id: string, plan: "extended" | null) {
  "use server";
  if (!dbConfigured()) return;
  if ((await auth())?.user?.role !== "admin") return;

  const rows = await db()
    .select({ userId: upgradeRequests.userId })
    .from(upgradeRequests)
    .where(eq(upgradeRequests.id, id))
    .limit(1);
  const target = rows[0]?.userId;
  if (!target) return;

  // Two statements, no transaction — the neon-http driver has none. Order
  // matters: grant the plan FIRST, so a failure between them leaves somebody
  // with the room they asked for and a request still marked pending, rather
  // than a closed request and the old cap.
  if (plan) {
    await db().update(users).set({ plan }).where(eq(users.id, target));
  }
  await db()
    .update(upgradeRequests)
    .set({ status: plan ? "granted" : "declined", reviewedAt: new Date() })
    .where(eq(upgradeRequests.id, id));

  revalidatePath("/admin");
}

export async function UpgradeRequests() {
  if (!dbConfigured()) {
    return (
      <Section>
        <p className="text-body-sm">Upgrade requests are unavailable.</p>
        <p className="text-micro text-ink-muted mt-xs">
          <code className="text-ink">DATABASE_URL</code> is not set, so nothing
          is being recorded and nobody can ask.
        </p>
      </Section>
    );
  }

  const rows = await db()
    .select({
      id: upgradeRequests.id,
      note: upgradeRequests.note,
      status: upgradeRequests.status,
      createdAt: upgradeRequests.createdAt,
      email: users.email,
      plan: users.plan,
    })
    .from(upgradeRequests)
    .innerJoin(users, eq(users.id, upgradeRequests.userId))
    .orderBy(desc(upgradeRequests.createdAt))
    .limit(100);

  const mailOff = !process.env.RESEND_API_KEY || !process.env.NOTIFY_TO;

  return (
    <Section>
      {mailOff ? (
        <p className="text-micro text-ink-muted mb-sm">
          <code className="text-ink">RESEND_API_KEY</code> or{" "}
          <code className="text-ink">NOTIFY_TO</code> is unset, so any request
          below was <strong className="text-ink">recorded but never emailed</strong>
          . An empty inbox is not evidence that nobody asked — this list is.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Nobody has asked for more room.</p>
      ) : (
        <ul className="space-y-xs">
          {rows.map((r) => (
            <li
              key={r.id}
              className="border-hairline bg-surface-1 rounded-lg p-sm gap-md flex items-start justify-between border"
            >
              <div className="min-w-0">
                <p className="text-body-sm break-all">{r.email}</p>
                {r.note ? (
                  <p className="text-micro text-ink-muted mt-xxs">{r.note}</p>
                ) : null}
                <p className="text-micro text-ink-muted mt-xs tabular-nums">
                  {r.plan} plan · {r.status} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>

              {r.status === "pending" ? (
                <div className="gap-xxs flex shrink-0">
                  <form action={decide.bind(null, r.id, "extended")}>
                    <button className="text-micro bg-primary text-on-primary rounded-pill px-sm py-[6px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.05]">
                      Grant
                    </button>
                  </form>
                  <form action={decide.bind(null, r.id, null)}>
                    <button className="text-micro border-hairline text-ink-muted hover:text-ink rounded-pill px-sm border py-[6px] transition-colors duration-[var(--duration-fast)]">
                      Decline
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-micro text-ink-muted mt-sm">
        Granting moves the account to the extended plan: {CAPS.extended.items}{" "}
        items, {formatBytes(CAPS.extended.storageBytes)},{" "}
        {CAPS.extended.shareLinks} share links.
      </p>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-sm gap-md flex items-baseline justify-between">
        <h2 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Upgrade requests
        </h2>
      </header>
      {children}
    </section>
  );
}
