import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db, dbConfigured } from "@/db";
import { shareLinks, type ShareLink as Row } from "@/db/schema";
import { SESSION_MAX_SECONDS, shareConfigured } from "@/lib/share";

/**
 * The outstanding-links inventory on /admin.
 *
 * Renders in three distinct states, and keeping them distinct is the point:
 *
 *   AUTH_SECRET unset — sharing does not work at all. Say that first, because
 *     everything else here is moot.
 *   DATABASE_URL unset — links work and are invisible. This is the state that
 *     misleads, so it gets the longest explanation: "no links listed" and "no
 *     links issued" look identical and are not the same fact.
 *   Both set — the actual table, with revoke.
 */

async function revoke(jti: string) {
  "use server";
  if (!dbConfigured()) return;
  await db()
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(eq(shareLinks.jti, jti));
  revalidatePath("/admin");
}

export async function ShareAdmin() {
  if (!shareConfigured()) {
    return (
      <Section>
        <p className="text-body-sm">Sharing is off.</p>
        <p className="text-micro text-ink-muted mt-xs">
          <code className="text-ink">AUTH_SECRET</code> is not set, so share
          links cannot be signed. Generate one with{" "}
          <code className="text-ink">openssl rand -base64 32</code> and put it
          in <code className="text-ink">web/.env.local</code>. No external
          service is involved — this is the only thing sharing needs.
        </p>
      </Section>
    );
  }

  if (!dbConfigured()) {
    return (
      <Section>
        <p className="text-body-sm">
          Links work, but they are not recorded.
        </p>
        <p className="text-micro text-ink-muted mt-xs">
          <code className="text-ink">DATABASE_URL</code> is not set. Share links
          are signed and carry their own expiry, so issuing and redeeming them
          works fine — but nothing writes down which ones exist, so this page
          cannot list them and no single link can be revoked early.
        </p>
        <p className="text-micro text-ink-muted mt-xs">
          Until then the only kill switch is rotating{" "}
          <code className="text-ink">AUTH_SECRET</code>, which invalidates{" "}
          <span className="text-ink">every</span> outstanding link at once and
          signs everyone out.
        </p>
      </Section>
    );
  }

  let rows: Row[] = [];
  let error: string | null = null;
  try {
    rows = await db()
      .select()
      .from(shareLinks)
      .orderBy(desc(shareLinks.createdAt))
      .limit(100);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <Section>
        <p className="text-body-sm">Could not read share links.</p>
        <p className="text-micro text-ink-muted mt-xs font-mono">{error}</p>
      </Section>
    );
  }

  const now = Date.now();
  const live = rows.filter(
    (r) => !r.revokedAt && new Date(r.expiresAt).getTime() > now,
  );

  return (
    <Section count={`${live.length} live · ${rows.length} total`}>
      {rows.length === 0 ? (
        <p className="text-body-sm text-ink-muted">No links issued yet.</p>
      ) : (
        <ul className="space-y-xs">
          {rows.map((r) => {
            const expired = new Date(r.expiresAt).getTime() <= now;
            const dead = Boolean(r.revokedAt) || expired;
            return (
              <li
                key={r.id}
                className={`border-hairline-soft bg-surface-1 rounded-lg p-sm gap-md flex flex-wrap items-start justify-between ${dead ? "opacity-55" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="gap-xs flex flex-wrap items-center">
                    <span className="text-body-sm">
                      {r.scope === "vault" ? "whole vault" : r.slug}
                    </span>
                    <span className="text-micro border-hairline-soft rounded-pill px-xs text-ink-muted border py-[2px]">
                      {r.revokedAt ? "revoked" : expired ? "expired" : "live"}
                    </span>
                    {r.label ? (
                      <span className="text-micro text-ink-muted">
                        · {r.label}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-micro text-ink-muted mt-xxs tabular-nums">
                    {r.revokedAt
                      ? `revoked ${new Date(r.revokedAt).toLocaleString()}`
                      : `expires ${new Date(r.expiresAt).toLocaleString()}`}
                    {r.lastUsedAt
                      ? ` · last opened ${new Date(r.lastUsedAt).toLocaleString()}`
                      : " · never opened"}
                  </p>
                </div>

                {!dead ? (
                  <form action={revoke.bind(null, r.jti)} className="shrink-0">
                    <button className="text-micro border-hairline text-ink-muted hover:text-ink rounded-pill px-sm border py-[6px] transition-colors duration-[var(--duration-fast)]">
                      Revoke
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-micro text-ink-muted mt-sm border-hairline-soft pt-sm border-t">
        Revoking takes effect within{" "}
        {Math.round(SESSION_MAX_SECONDS / 60)} minutes, not instantly. Redeeming
        a link mints a short cookie and revocation is checked at redemption, so
        an open session finishes its hour. The alternative was a database query
        on every page load and every media byte.
      </p>
    </Section>
  );
}

function Section({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: string;
}) {
  return (
    <section className="mb-xl">
      <header className="mb-sm gap-md flex items-baseline justify-between">
        <h2 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          Share links
        </h2>
        {count ? (
          <span className="text-micro text-ink-muted tabular-nums">{count}</span>
        ) : null}
      </header>
      <div className="border-hairline-soft bg-surface-1 rounded-lg p-md border">
        {children}
      </div>
    </section>
  );
}
