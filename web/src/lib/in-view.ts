/**
 * One shared IntersectionObserver for every card.
 *
 * At 500 items a per-card observer means 500 observers, each with its own
 * callback and internal bookkeeping, all reporting into the same compositor
 * frame. One observer with 500 targets is the same information for a fraction
 * of the cost.
 *
 * rootMargin 300px is deliberate: it assigns video src while the card is
 * still below the fold, so the first hover isn't dead for 300ms while the
 * browser opens a connection. preload="metadata" keeps that to a few KB per
 * tile rather than the whole clip.
 */

type Handler = (inView: boolean) => void;

const handlers = new WeakMap<Element, Handler>();
let io: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) handlers.get(e.target)?.(e.isIntersecting);
    },
    { rootMargin: "300px" },
  );
  return io;
}

/** Observe an element; returns the cleanup function. */
export function observe(el: Element, fn: Handler): () => void {
  handlers.set(el, fn);
  observer().observe(el);
  return () => {
    observer().unobserve(el);
    handlers.delete(el);
  };
}
