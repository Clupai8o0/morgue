"use client";

import { useEffect, useRef, useState } from "react";
import { claim, forget } from "@/lib/player-pool";
import { observe } from "@/lib/in-view";
import { previewSrc, type PreviewRef, type Rung } from "@/lib/types";

/**
 * Poster always, video on hover, never live code — the one component that
 * knows how a preview behaves. The grid tile and the relations strip both use
 * it so they cannot drift apart.
 *
 * WHY HOVER IS BOUND TO `closest("a")` AND NOT TO THIS ELEMENT: the relations
 * strip is server-rendered (relations.tsx reads records off disk and has no
 * "use client"), so its cards cannot carry React handlers. Binding natively to
 * the enclosing link gives whole-card hover on both surfaces without dragging
 * the relations tree into the client bundle. Falls back to this element when
 * there is no link, so it still works standalone.
 *
 * Animation is transform and opacity ONLY (rule 8). Up to twelve videos may be
 * decoding at once and anything that forces paint competes with them — which
 * is also why the loading indicator below is a transform-driven ring and not a
 * pulsing shadow.
 */

type Status = "idle" | "loading" | "playing" | "failed";

/**
 * Why the poster has an error handler at all.
 *
 * An item with no capture yet has no poster.webp, so /api/media 404s and the
 * browser paints its own broken-image glyph. On a hosted vault that is one odd
 * tile. On a first local run — a fresh clone, an empty collection, or a
 * machine with no ffmpeg — it is EVERY tile, and the first thing the tool ever
 * shows you is a grid of broken images, which reads as "this is broken" rather
 * than "nothing has been captured yet".
 *
 * Handled here rather than by adding a `hasPoster` field to facets.json,
 * because the payload is R2-resident and versions independently of the app: a
 * flag baked at build time cannot know that a later prune removed the file,
 * and it would say nothing about a 502 from the signing path. "It did not
 * load" is a runtime fact and this is where runtime is.
 */

export function PreviewMedia({
  item,
  want = "sm",
  eager = true,
  className = "",
  children,
}: {
  item: PreviewRef;
  /** Largest ladder rung this surface will use. See previewSrc. */
  want?: Rung | "full";
  /** Assign src as soon as the tile scrolls into view, rather than on hover. */
  eager?: boolean;
  className?: string;
  /** Overlay chrome — badges, labels. Rendered above the media. */
  children?: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [posterOk, setPosterOk] = useState(true);

  const poster = `/api/media/${item.slug}/poster.webp`;
  const video = previewSrc(item, want);

  useEffect(() => {
    const box = boxRef.current;
    const v = videoRef.current;
    if (!box || !v) return;

    // The hover target is the whole card when there is one.
    const target: HTMLElement = box.closest("a") ?? box;

    const attach = () => {
      if (!v.getAttribute("src") && v.dataset.src) {
        v.src = v.dataset.src;
        claim(v);
      }
    };

    const onEnter = () => {
      if (!v.dataset.src) return;
      attach();
      claim(v);
      // A play() that has to buffer first is exactly the case the indicator
      // exists for, so the status flips before the request, not after.
      if (v.readyState < 3) setStatus("loading");
      v.currentTime = 0;
      void v.play().catch(() => {
        // Autoplay rejection is not a load failure and must not paint an
        // error — a muted inline video is normally allowed, but a background
        // tab or a reduced-power mode can still refuse.
        setStatus((s) => (s === "loading" ? "idle" : s));
      });
    };

    const onLeave = () => {
      v.pause();
      v.removeAttribute("data-painted");
      setStatus((s) => (s === "failed" ? s : "idle"));
    };

    // mouseenter, NOT pointerenter: pointerenter fires on touch, so every tile
    // would start loading video during a tap-scroll on an iPad.
    target.addEventListener("mouseenter", onEnter);
    target.addEventListener("mouseleave", onLeave);

    const stopObserving = eager ? observe(box, (inView) => inView && attach()) : null;

    return () => {
      target.removeEventListener("mouseenter", onEnter);
      target.removeEventListener("mouseleave", onLeave);
      stopObserving?.();
      // Drop it from the LRU without unloading — React is removing the element
      // anyway, and releasing here would fight the pool's own eviction order.
      forget(v);
    };
  }, [eager]);

  return (
    <div
      ref={boxRef}
      className={`bg-canvas rounded-md relative aspect-[16/10] overflow-hidden ${className}`}
    >
      {posterOk ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- media is
              streamed through our own route, so next/image's optimiser has
              nothing to add and would only add a second hop. */}
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPosterOk(false)}
            className="absolute inset-0 size-full object-cover"
          />
        </>
      ) : (
        <NoCapture />
      )}

      {video ? (
        <video
          ref={videoRef}
          data-src={video}
          muted
          loop
          playsInline
          preload="metadata"
          onWaiting={() => setStatus("loading")}
          onPlaying={(e) => {
            e.currentTarget.setAttribute("data-painted", "");
            setStatus("playing");
          }}
          onError={() => setStatus("failed")}
          className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-[var(--duration-fast)] data-painted:opacity-100"
        />
      ) : null}

      {status === "loading" ? <Loading /> : null}
      {status === "failed" ? <Failed /> : null}

      {children}
    </div>
  );
}

/**
 * Deliberately carries a word as well as a ring. The global reduced-motion rule
 * clamps every animation to 0.01ms, which freezes a spinner mid-turn — so a
 * spinner alone would read as a rendering glitch to exactly the people who
 * opted out of motion. The label is the actual signal; the ring is decoration
 * for everyone else.
 */
function Loading() {
  return (
    <span className="text-micro bg-canvas/70 gap-xxs px-xxs absolute bottom-2 left-2 flex items-center rounded-xs py-[3px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
      <span
        aria-hidden
        className="border-ink-muted border-t-ink size-[9px] animate-[morgue-spin_700ms_linear_infinite] rounded-pill border-[1.5px]"
      />
      loading
    </span>
  );
}

/**
 * Stands in for a poster that is not there. Deliberately flat and quiet: the
 * card still carries a title, a kind and its tags, so an uncaptured item is
 * still a usable record of something you filed — it just has no picture yet.
 * A red error state would overstate it.
 */
function NoCapture() {
  return (
    <span className="bg-surface-1 text-micro text-ink-muted absolute inset-0 flex items-center justify-center uppercase tracking-[0.12em]">
      not captured
    </span>
  );
}

/**
 * A preview that will not load is worth saying out loud. The poster stays
 * underneath, so the card is still useful — this only explains why hovering
 * stopped doing anything, which is otherwise indistinguishable from an item
 * that simply has no video.
 */
function Failed() {
  return (
    <span className="text-micro bg-canvas/70 px-xxs absolute bottom-2 left-2 rounded-xs py-[3px] uppercase tracking-[0.12em] backdrop-blur-[6px]">
      preview unavailable
    </span>
  );
}
