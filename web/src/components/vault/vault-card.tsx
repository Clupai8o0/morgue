"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { claim, forget } from "@/lib/player-pool";
import { observe } from "@/lib/in-view";
import { tagsOf, type Facet } from "@/lib/types";

/**
 * One grid tile: poster always, video on hover, never live code.
 *
 * The browse grid CANNOT run the components it displays. Measured in Chrome:
 * creating 40 WebGL contexts leaves exactly 16 alive, and detaching the canvas
 * does not free them. The cap is per renderer thread, so same-origin iframes
 * share one budget rather than each getting their own. A grid of live scenes
 * doesn't degrade — it silently blanks whichever preview you're looking at.
 *
 * Animation here is transform and opacity ONLY. No box-shadow, no filter, no
 * backdrop-blur on hover: up to twelve videos may be decoding at once and
 * anything that forces paint on the compositor competes directly with them.
 */
export function VaultCard({ facet }: { facet: Facet }) {
  const rootRef = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const poster = `/api/media/${facet.slug}/poster.webp`;
  const video = facet.hasVideo ? `/api/media/${facet.slug}/preview.mp4` : null;

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
      // Drop it from the LRU without unloading — React is removing the element
      // anyway, and releasing here would fight the pool's own eviction order.
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

  const tags = tagsOf(facet);

  return (
    <Link
      ref={rootRef}
      href={`/vault/${facet.slug}`}
      // mouseenter, NOT pointerenter: pointerenter fires on touch, so every
      // tile would start loading video during a tap-scroll on an iPad.
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="group bg-surface-1 rounded-lg p-sm border-hairline-soft hover:border-hairline block border transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out-expo)] hover:-translate-y-[3px]"
    >
      <div className="bg-canvas rounded-md relative aspect-[16/10] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- media is
            streamed through our own route, so next/image's optimiser has
            nothing to add and would only add a second hop. */}
        <img
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
        {video ? (
          <video
            ref={videoRef}
            data-src={video}
            muted
            loop
            playsInline
            preload="metadata"
            onPlaying={(e) => e.currentTarget.setAttribute("data-painted", "")}
            className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-[var(--duration-fast)] data-painted:opacity-100"
          />
        ) : null}

        <span className="text-micro bg-canvas/70 px-xxs absolute top-2 right-2 rounded-xs py-[3px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
          {facet.weight}
        </span>
      </div>

      <div className="mt-sm gap-sm flex items-baseline justify-between">
        <span className="text-body-sm truncate">{facet.title}</span>
        <span className="text-micro text-ink-muted shrink-0 text-right">
          {tags.slice(0, 2).join(" · ")}
        </span>
      </div>
    </Link>
  );
}
