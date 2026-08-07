/**
 * An LRU over <video> elements.
 *
 * PORTED VERBATIM from bin/grid.html. Do not "clean this up" into React state.
 *
 * Chrome caps media elements per frame (kMaxWebMediaPlayers, reported at 75)
 * and — this is the part that surprises people — pausing a video does NOT
 * release its player. Neither does removing it from the DOM. Without an
 * eviction path that actually unloads the element, sweeping the mouse across
 * a few dozen tiles exhausts the pool and every later tile silently refuses
 * to load. No error, no event: it just never paints.
 *
 * The only reliable release is removing the src attribute and calling load().
 *
 * Measured on the vanilla grid: 45 cards hovered in sequence, concurrent
 * loaded players peaked at 12, zero failures. The cap is never approached,
 * which is why the 75 ceiling remains untested here — it is unreachable.
 *
 * The constraint is per renderer thread, not per component, so this is a
 * module singleton rather than per-instance state. Two grids on one page
 * share one budget because the browser does.
 */

const MAX_PLAYERS = 12;

const loaded: HTMLVideoElement[] = [];

/** Fully unload a player so the browser reclaims it. */
export function release(v: HTMLVideoElement): void {
  v.pause();
  v.removeAttribute("src");
  v.load();
  v.removeAttribute("data-painted");
}

/** Mark a player as most-recently-used, evicting past the cap. */
export function claim(v: HTMLVideoElement): void {
  const i = loaded.indexOf(v);
  if (i > -1) loaded.splice(i, 1);
  loaded.push(v);
  while (loaded.length > MAX_PLAYERS) {
    const evicted = loaded.shift();
    if (evicted) release(evicted);
  }
}

/** Drop a player from the pool without touching the element (unmount path). */
export function forget(v: HTMLVideoElement): void {
  const i = loaded.indexOf(v);
  if (i > -1) loaded.splice(i, 1);
}

/**
 * Release everything. Called when the result set changes — after a filter or
 * search, most of the loaded players are for cards that no longer exist.
 */
export function releaseAll(): void {
  loaded.splice(0).forEach(release);
}

/** Exposed for the diagnostics readout; not used by the grid itself. */
export function poolSize(): number {
  return loaded.length;
}

export { MAX_PLAYERS };
