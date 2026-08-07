import type { Metadata } from "next";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { waitlist, type Waitlist } from "@/db/schema";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

/**
 * Waitlist review.
 *
 * Access is enforced in proxy.ts, not here — everything under /admin requires
 * a session before this component ever renders.
 *
 * "Approve" records a decision; it does not provision anything. There are no
 * accounts to create and no storage to allocate, because nobody but the owner
 * can write to this system. Marking someone approved is a note to self to go
 * and email them.
 */

async function setStatus(id: string, status: "approved" | "declined") {
  "use server";
  if (!dbConfigured()) return;
  await db()
    .update(waitlist)
    .set({ status, reviewedAt: new Date() })
    .where(eq(waitlist.id, id));
  revalidatePath("/admin");
}

export default async function AdminPage() {
  if (!dbConfigured()) {
    return (
      <Shell>
        <div className="border-hairline bg-surface-1 rounded-lg p-md">
          <p className="text-body-sm">No database configured.</p>
          <p className="text-micro text-ink-muted mt-xs">
            Set <code className="text-ink">DATABASE_URL</code> in{" "}
            <code className="text-ink">web/.env.local</code>, then run{" "}
            <code className="text-ink">pnpm db:push</code>.
          </p>
        </div>
      </Shell>
    );
  }

  let rows: Waitlist[] = [];
  let error: string | null = null;
  try {
    rows = await db().select().from(waitlist).orderBy(desc(waitlist.createdAt));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <Shell>
        <div className="border-hairline bg-surface-1 rounded-lg p-md">
          <p className="text-body-sm">Could not read the waitlist.</p>
          <p className="text-micro text-ink-muted mt-xs font-mono">{error}</p>
        </div>
      </Shell>
    );
  }

  const pending = rows.filter((r) => r.status === "pending");

  return (
    <Shell count={rows.length} pending={pending.length}>
      {rows.length === 0 ? (
        <p className="text-body text-ink-muted py-xxl">No requests yet.</p>
      ) : (
        <ul className="space-y-xs">
          {rows.map((r) => (
            <li
              key={r.id}
              className="border-hairline bg-surface-1 rounded-lg p-md gap-md flex flex-wrap items-start justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="gap-xs flex items-center">
                  <span className="text-body-sm break-all">{r.email}</span>
                  <StatusPill status={r.status} />
                </div>
                {r.note ? (
                  <p className="text-body-sm text-ink-muted mt-xs whitespace-pre-wrap">
                    {r.note}
                  </p>
                ) : null}
                <p className="text-micro text-ink-muted mt-xs tabular-nums">
                  {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>

              {r.status === "pending" ? (
                <div className="gap-xxs flex shrink-0">
                  <form action={setStatus.bind(null, r.id, "approved")}>
                    <button className="text-micro bg-primary text-on-primary rounded-pill px-sm py-[6px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.05]">
                      Approve
                    </button>
                  </form>
                  <form action={setStatus.bind(null, r.id, "declined")}>
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
    </Shell>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "text-success border-success/40"
      : status === "declined"
        ? "text-ink-muted border-hairline"
        : "text-accent border-accent/40";
  return (
    <span className={`text-micro rounded-pill border px-xs py-[2px] ${tone}`}>
      {status}
    </span>
  );
}

function Shell({
  children,
  count,
  pending,
}: {
  children: React.ReactNode;
  count?: number;
  pending?: number;
}) {
  return (
    <main className="mx-auto w-full max-w-[820px] px-lg py-xxl">
      <header className="mb-xl gap-md flex items-baseline justify-between">
        <h1 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Admin · waitlist
        </h1>
        <div className="gap-md flex items-baseline">
          {count !== undefined ? (
            <span className="text-micro text-ink-muted tabular-nums">
              {pending} pending · {count} total
            </span>
          ) : null}
          <Link
            href="/vault"
            className="text-micro text-ink-muted hover:text-ink transition-colors"
          >
            vault →
          </Link>
        </div>
      </header>
      {children}
    </main>
  );
}
