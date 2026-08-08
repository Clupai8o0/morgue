"use client";

import Link from "next/link";
import { PreviewMedia } from "@/components/vault/preview-media";
import { relationLabel, tagsOf, type Facet } from "@/lib/types";

/**
 * One grid tile: poster always, video on hover, never live code.
 *
 * The browse grid CANNOT run the components it displays. Measured in Chrome:
 * creating 40 WebGL contexts leaves exactly 16 alive, and detaching the canvas
 * does not free them. The cap is per renderer thread, so same-origin iframes
 * share one budget rather than each getting their own. A grid of live scenes
 * doesn't degrade — it silently blanks whichever preview you're looking at.
 *
 * Media behaviour — hover, the player LRU, the loading state — lives in
 * PreviewMedia, which the relations strip shares. This file is layout.
 *
 * Animation here is transform and opacity ONLY. No box-shadow, no filter, no
 * backdrop-blur on hover: up to twelve videos may be decoding at once and
 * anything that forces paint on the compositor competes directly with them.
 */
export function VaultCard({ facet }: { facet: Facet }) {
  const tags = tagsOf(facet);
  const rel = relationLabel(facet);

  return (
    <Link
      href={`/vault/${facet.slug}`}
      className="group bg-surface-1 rounded-lg p-sm border-hairline-soft hover:border-hairline block border transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out-expo)] hover:-translate-y-[3px]"
    >
      {/* A tile paints ~340px wide in a 1100px three-column grid, so `sm`
          (360w) is the rung it can actually show. Asking for the 600px file
          here was downloading roughly three times the pixels. */}
      <PreviewMedia item={facet} want="sm">
        {/* Family, not filter chrome: a LABEL, never a control. The card root
            is the <Link>, so a <button> or second <a> here would be nested
            interactive content — the archive chip in vault-grid.tsx is the
            control, and it is always present. Identical treatment to the
            weight badge on purpose: the difference is carried by position and
            wording, not by a second colour. Static backdrop-blur, no
            transition — rule 8, same as the badge it mirrors. */}
        {rel ? (
          <span className="text-micro bg-canvas/70 px-xxs absolute top-2 left-2 max-w-[62%] truncate rounded-xs py-[3px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
            {rel}
          </span>
        ) : null}

        <span className="text-micro bg-canvas/70 px-xxs absolute top-2 right-2 rounded-xs py-[3px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
          {facet.weight}
        </span>
      </PreviewMedia>

      <div className="mt-sm gap-sm flex items-baseline justify-between">
        <span className="text-body-sm truncate">{facet.title}</span>
        <span className="text-micro text-ink-muted shrink-0 text-right">
          {tags.slice(0, 2).join(" · ")}
        </span>
      </div>
    </Link>
  );
}
