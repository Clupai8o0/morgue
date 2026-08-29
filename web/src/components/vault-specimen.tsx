import type { ShowcaseItem } from "@/lib/showcase";

/**
 * The hero's centrepiece: the vault, exploded — the same story the README
 * banner tells (assets/banner.svg), rebuilt from the site's own tokens instead
 * of a theme-locked SVG. A browser frame holding the grid, one specimen lifted
 * off the surface, and the two artefacts every capture emits: the `motion: OK`
 * log line and the agent-ready export bundle.
 *
 * It uses the committed showcase posters — the only media allowed on a public
 * page (own/MIT) — and falls back to the tier gradients where a capture has not
 * run, so it never points an <img> at a missing file. Static by design: it is
 * an illustration of the product, not a live grid competing for the media-
 * element budget CLAUDE.md rule 8 is about.
 */
export function VaultSpecimen({ items }: { items: ShowcaseItem[] }) {
  const posters = items.map((i) => i.poster).filter((p): p is string => Boolean(p));
  const gradients = ["spotlight-violet", "spotlight-magenta", "spotlight-orange"];
  const lifted = items.find((i) => i.poster) ?? items[0];

  // Six grid slots: real posters first, tier gradients behind them.
  const tiles = Array.from({ length: 6 }, (_, i) =>
    i < posters.length ? { poster: posters[i] } : { grad: gradients[i % gradients.length] },
  );

  return (
    <div className="relative select-none" aria-hidden="true">
      {/* browser frame */}
      <div className="border-hairline bg-surface-1 rounded-xl overflow-hidden border">
        <div className="border-hairline-soft gap-xs px-sm flex h-8 items-center border-b">
          <span className="bg-hairline size-2 rounded-full" />
          <span className="bg-hairline size-2 rounded-full" />
          <span className="bg-hairline size-2 rounded-full" />
          <span className="bg-canvas text-micro text-ink-muted ml-xs rounded-pill px-sm flex-1 truncate py-[3px]">
            morgue / vault
          </span>
        </div>
        <div className="bg-canvas p-3 grid grid-cols-3 gap-2">
          {tiles.map((t, i) =>
            t.poster ? (
              // eslint-disable-next-line @next/next/no-img-element -- committed, pre-sized webp
              <img
                key={i}
                src={t.poster}
                alt=""
                loading="lazy"
                decoding="async"
                className="border-hairline-soft aspect-[16/10] w-full rounded-md border object-cover"
              />
            ) : (
              <div key={i} className={`${t.grad} aspect-[16/10] w-full rounded-md`} />
            ),
          )}
        </div>
      </div>

      {/* motion: OK — the capture log line */}
      <div className="border-hairline bg-canvas gap-xs px-sm absolute -top-3 right-4 flex items-center rounded-pill border py-[5px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <span className="bg-success size-2 rounded-full" />
        <span className="text-micro text-ink tracking-[0.04em]">motion: OK</span>
      </div>

      {/* the lifted specimen */}
      {lifted ? (
        <div className="border-hairline bg-surface-1 rounded-lg p-2 absolute -bottom-5 -right-3 w-[44%] rotate-[-3deg] border shadow-[0_18px_44px_rgba(0,0,0,0.55)]">
          <div className="bg-canvas rounded-md relative aspect-[16/10] overflow-hidden">
            {lifted.poster ? (
              // eslint-disable-next-line @next/next/no-img-element -- committed, pre-sized webp
              <img src={lifted.poster} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="spotlight-coral absolute inset-0" />
            )}
            <span className="text-micro bg-canvas/70 px-xxs absolute top-1 right-1 rounded-xs py-[2px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
              {lifted.weight}
            </span>
          </div>
          <div className="mt-2 gap-1 flex items-baseline justify-between">
            <span className="text-micro text-ink truncate">{lifted.title}</span>
          </div>
        </div>
      ) : null}

      {/* the export bundle — what an agent pastes */}
      <div className="border-hairline bg-canvas gap-xs px-sm absolute -bottom-3 left-3 flex items-center rounded-pill border py-[5px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
        <span className="text-accent text-micro leading-none">⧉</span>
        <span className="text-micro text-ink-muted">Copy for agent</span>
      </div>
    </div>
  );
}
