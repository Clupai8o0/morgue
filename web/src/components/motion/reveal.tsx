"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { observe } from "@/lib/in-view";

/**
 * Fades and lifts its children in once, on first intersection.
 *
 * Uses the same shared IntersectionObserver as the card video loader — one
 * observer for the whole page rather than one per element — and unobserves
 * itself the moment it fires. An entrance that keeps observing is just a
 * permanent cost for a one-time effect.
 */
export function Reveal({
  children,
  index = 0,
  className,
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Show it immediately rather than leaving it at opacity 0 forever.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.setAttribute("data-in", "");
      return;
    }

    let stop = () => {};
    stop = observe(el, (inView) => {
      if (!inView) return;
      el.setAttribute("data-in", "");
      stop();
    });
    return () => stop();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal${className ? ` ${className}` : ""}`}
      style={{ "--reveal-i": index } as CSSProperties}
    >
      {children}
    </div>
  );
}
