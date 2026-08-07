"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Magnetic hover, lifted from fixtures/magnetic-cursor.
 *
 * gsap.quickTo rather than gsap.to: quickTo builds one reusable tween and
 * mutates its target value, so a pointermove firing at 120Hz costs a property
 * write instead of allocating a tween per event. On a filter bar with twenty
 * chips that is the difference between smooth and gritty.
 *
 * elastic.out(1, 0.4) is the fixture's curve — it overshoots and settles,
 * which is what makes the element feel physically attached to the cursor
 * rather than merely following it.
 */
export function Magnetic({
  children,
  strength = 0.4,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Magnetism is meaningless without a cursor, and on touch `pointermove`
    // during a scroll would drag the element around under the finger.
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const xTo = gsap.quickTo(el, "x", {
      duration: 0.8,
      ease: "elastic.out(1, 0.4)",
    });
    const yTo = gsap.quickTo(el, "y", {
      duration: 0.8,
      ease: "elastic.out(1, 0.4)",
    });

    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => {
      xTo(0);
      yTo(0);
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(el);
    };
  }, [strength]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
