import type { ShareScope } from "@/lib/share";

/**
 * Tells a shared viewer what they are looking at and what they cannot do.
 *
 * Not decoration. Someone arriving through a link has no sign-in, no nav they
 * recognise and no way to tell whether the three items they can see are the
 * whole collection or a slice of it — and an item-scoped link genuinely is a
 * slice, with every route out of it locked. Saying so is the difference
 * between a deliberate boundary and a site that looks broken.
 */
export function SharedBanner({ scope }: { scope: ShareScope }) {
  return (
    <div className="border-hairline-soft bg-surface-1 px-lg border-b py-[10px]">
      <div className="mx-auto gap-sm text-micro flex max-w-[1100px] flex-wrap items-baseline justify-between">
        <span className="text-ink-muted">
          <span className="text-ink uppercase tracking-[0.12em]">
            shared view
          </span>
          {" · "}
          {scope.kind === "vault"
            ? "read-only access to the whole vault"
            : "read-only access to this one item"}
        </span>
        <span className="text-ink-muted">
          {scope.kind === "item"
            ? "other items are not part of this link"
            : "browsing and export bundles only"}
        </span>
      </div>
    </div>
  );
}
