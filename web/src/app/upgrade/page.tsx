import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { localMode } from "@/lib/local";
import { db, dbConfigured, schema } from "@/db";
import { capsFor, formatBytes, planOf, usageFor } from "@/lib/plan";
import { findUserById } from "@/lib/users";
import { UpgradeRequest } from "@/components/upgrade-request";

export const metadata: Metadata = { title: "What you can hold" };
export const dynamic = "force-dynamic";

/**
 * The caps on this account, and the way to ask for more.
 *
 * Access is enforced in proxy.ts — /upgrade is owner-only and is refused to a
 * share cookie before the allowlist is consulted, the same treatment /account
 * and /admin get.
 *
 * ── Why two of the three numbers are missing, and stay missing ─────────────
 *
 * Only the share-link count is attributable to a person today. Items and stored
 * bytes need the tenancy boundary — a per-user collection and an R2 key
 * carrying the user id — which is phase 3 and is not built. So those rows show
 * the cap and say the usage is not measured, rather than showing 0.
 *
 * That is not modesty. `0 of 25 items` is a specific claim, it is wrong, and
 * someone would plan against it. The type in lib/plan.ts makes the distinction
 * unmissable: `number | null`, where null means "cannot be known", and this page
 * is the only place that has to render the difference.
 */
export default async function UpgradePage() {
  // Nobody is metering a folder on your own disk. Doubled with proxy.ts.
  if (localMode()) notFound();

  const session = await auth();
  const user = session?.user?.id ? await findUserById(session.user.id) : null;

  // proxy.ts already refused an anonymous visitor; this is the doubling that
  // /admin uses, so the page does not depend on one matcher being right.
  if (!user) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-lg py-xxl">
        <p className="text-body text-ink-muted">Not authorised.</p>
      </main>
    );
  }

  const caps = capsFor(user);
  const usage = await usageFor(user.id);

  let pending = false;
  if (dbConfigured()) {
    const rows = await db()
      .select({ id: schema.upgradeRequests.id })
      .from(schema.upgradeRequests)
      .where(
        and(
          eq(schema.upgradeRequests.userId, user.id),
          eq(schema.upgradeRequests.status, "pending"),
        ),
      )
      .limit(1);
    pending = rows.length > 0;
  }

  return (
    <main className="mx-auto w-full max-w-[560px] px-lg py-xxl">
      <header className="mb-xl gap-md flex items-baseline justify-between">
        <h1 className="text-caption text-ink-muted uppercase tracking-[0.14em]">
          What you can hold
        </h1>
        <Link
          href="/account"
          className="text-micro text-ink-muted hover:text-ink transition-colors"
        >
          account →
        </Link>
      </header>

      <div className="gap-md flex flex-col">
        <section className="border-hairline bg-surface-1 rounded-lg p-md border">
          <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
            Your plan
          </p>
          <p className="text-body mt-xs">{caps ? planOf(user) : "no cap"}</p>
          <p className="text-micro text-ink-muted mt-xxs">
            {caps
              ? "Free, and capped. There is nothing to buy — more room is granted by a person."
              : "Administrators are not capped."}
          </p>
        </section>

        {caps ? (
          <section className="border-hairline bg-surface-1 rounded-lg p-md border">
            <p className="text-caption text-ink-muted uppercase tracking-[0.14em]">
              Limits
            </p>
            <dl className="mt-md space-y-sm">
              <Row
                label="Items"
                cap={String(caps.items)}
                used={usage.items === null ? null : String(usage.items)}
              />
              <Row
                label="Storage"
                cap={formatBytes(caps.storageBytes)}
                used={
                  usage.storageBytes === null ? null : formatBytes(usage.storageBytes)
                }
              />
              <Row
                label="Share links"
                cap={String(caps.shareLinks)}
                used={String(usage.shareLinks)}
              />
            </dl>
            <p className="text-micro text-ink-muted mt-md">
              Nothing is enforced yet. Per-account collections do not exist —
              until they do, there is no storage of yours to measure and no cap
              to hit.
            </p>
          </section>
        ) : null}

        <UpgradeRequest pending={pending} />
      </div>

      <p className="text-micro text-ink-muted mt-xl">
        <Link href="/privacy" className="hover:text-ink underline underline-offset-4">
          Privacy
        </Link>
        {" · "}
        <Link href="/terms" className="hover:text-ink underline underline-offset-4">
          Terms
        </Link>
      </p>
    </main>
  );
}

/** `used` of null renders as "not measured yet" — never as a number. */
function Row({
  label,
  cap,
  used,
}: {
  label: string;
  cap: string;
  used: string | null;
}) {
  return (
    <div className="gap-md flex items-baseline justify-between">
      <dt className="text-body-sm">{label}</dt>
      <dd className="text-body-sm text-ink-muted text-right">
        {used === null ? (
          <>
            <span className="text-ink">{cap}</span>
            <span className="text-micro block">not measured yet</span>
          </>
        ) : (
          <span>
            <span className="text-ink">{used}</span> of {cap}
          </span>
        )}
      </dd>
    </div>
  );
}
