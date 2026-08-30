"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Smooth scroll, wired exactly as fixtures/lenis-scroll does it.
 *
 * This is the canonical CodeGrid/Awwwards arrangement and it is not
 * interchangeable with the obvious alternative (Lenis running its own rAF
 * loop). Driving Lenis from gsap.ticker means one loop owns the frame:
 * ScrollTrigger updates on Lenis's scroll event, and everything advances in
 * lockstep. Two independent loops produce a half-frame of drift that reads as
 * jitter on pinned sections.
 *
 * It also keeps the site consistent with the capture harness — the fake page
 * clock overrides requestAnimationFrame, so anything ticked by GSAP becomes
 * deterministic for free. A site component that self-schedules would not.
 *
 * lagSmoothing(0) disables GSAP's frame-drop compensation, which otherwise
 * fabricates a large delta after a stall and makes scrub jump.
 */
export function SmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    // A gallery of animation is exactly where this matters most, not least.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Docs are long-form reading pages: smooth-scroll inertia reads as scroll
    // jacking there, so they get native scrolling. Everywhere else keeps Lenis —
    // the landing and vault animations ride the shared gsap.ticker loop below.
    if (pathname === "/docs" || pathname?.startsWith("/docs/")) return;

    const lenis = new Lenis({ duration: 1.1 });

    lenis.on("scroll", ScrollTrigger.update);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [pathname]);

  return null;
}
