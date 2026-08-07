"use client";

import { useEffect, useRef } from "react";
import { claim, forget } from "@/lib/player-pool";
import { observe } from "@/lib/in-view";
import type { ShowcaseItem } from "@/lib/showcase";

/**
 * A landing-page tile for one of the pieces written for this repo.
 *
 * Same rules as the vault grid, for the same reasons (CLAUDE.md rule 8):
 * poster always, video on hover, NEVER live code, and animation restricted to
 * transform and opacity. No box-shadow, filter or backdrop-blur transition —
 * anything that forces paint competes with video decode. The corner badge does
 * carry a static `backdrop-blur`, exactly as `vault-card.tsx` does; it is not
 * animated, so it costs one composited layer and nothing per frame.
 *
 * It shares the module-singleton player LRU with the vault grid rather than
 * keeping its own. The Chrome media-element cap is per renderer thread, so a
 * second pool would be a second budget the browser does not actually give us.
 *
 * PLACEMENT NOTE: this belongs in `web/src/components/showcase/` next to the
 * other cards. It sits in lib/ only because of the file-ownership split this
 * change was made under. Moving it is one path and one import.
 */
export function ShowcaseCard({ item }: { item: ShowcaseItem }) {
  const rootRef = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    const v = videoRef.current;
    if (!el || !v) return;

    const stop = observe(el, (inView) => {
      if (inView && !v.getAttribute("src") && v.dataset.src) {
        v.src = v.dataset.src;
        claim(v);
      }
    });

    return () => {
      stop();
      forget(v);
    };
  }, []);

  const onEnter = () => {
    const v = videoRef.current;
    if (!v || !v.dataset.src) return;
    if (!v.getAttribute("src")) v.src = v.dataset.src;
    claim(v);
    v.currentTime = 0;
    void v.play().catch(() => {});
  };

  const onLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.removeAttribute("data-painted");
  };

  return (
    <a
      ref={rootRef}
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      // mouseenter, NOT pointerenter: pointerenter fires on touch, so the tile
      // would start pulling video during a tap-scroll on a phone.
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="group bg-surface-1 rounded-lg p-sm border-hairline-soft hover:border-hairline block border transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out-expo)] hover:-translate-y-[3px]"
    >
      <div className="bg-canvas rounded-md relative aspect-[16/10] overflow-hidden">
        {item.poster ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a
                committed, already-sized 600px webp. next/image's optimiser has
                nothing to add and would only add a hop. */}
            <img
              src={item.poster}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
            {item.video ? (
              <video
                ref={videoRef}
                data-src={item.video}
                muted
                loop
                playsInline
                preload="metadata"
                onPlaying={(e) =>
                  e.currentTarget.setAttribute("data-painted", "")
                }
                className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-[var(--duration-fast)] data-painted:opacity-100"
              />
            ) : null}
          </>
        ) : (
          // No capture yet. Render the tile empty rather than pointing an
          // <img> at a path that is not there — a 404 on the landing page
          // reads as a broken site and hides which of the two it is.
          <div className="text-micro text-ink-muted absolute inset-0 flex items-center justify-center uppercase tracking-[0.12em]">
            {item.tags[0] ?? item.slug}
          </div>
        )}

        {item.weight ? (
          <span className="text-micro bg-canvas/70 px-xxs absolute top-2 right-2 rounded-xs py-[3px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
            {item.weight}
          </span>
        ) : null}
      </div>

      <div className="mt-sm gap-sm flex items-baseline justify-between">
        <span className="text-body-sm truncate">{item.title}</span>
        <span className="text-micro text-ink-muted shrink-0 text-right">
          {item.tags.join(" · ")}
        </span>
      </div>
    </a>
  );
}
