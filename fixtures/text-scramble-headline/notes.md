A resolve sweep, not a per-character timer. One `gsap.timeline({ repeat: -1 })` drives a single
number, `sweep.p`, from 0 to 1 and back; every character decides for itself whether it is still
noise by comparing `p` against its own position in the line. Nothing is scheduled, so the whole
piece can be seeked to any frame — which is the only reason a deterministic capture of it exists.

The line-position term is `local = clamp01((p * (1 + BAND) - u) / BAND)`, where `u` is the
character's index normalised to 0–1 and `BAND` is 0.34. `BAND` is the width of the wavefront: at
0.34 roughly a third of the line is mid-resolve at any moment, which reads as a sweep. Below
about 0.12 the characters lock in a hard vertical edge and it stops looking like typing; above
0.6 the whole line resolves at once and the stagger disappears. The `(1 + BAND)` multiplier
overshoots `p` past the end of the line so the last character actually reaches `local === 1`
rather than stalling at 0.66.

A character does not flip cleanly at a threshold. It shows its true glyph with probability
`local` and noise otherwise, re-rolled 16 times a second — so it flickers between the right
answer and a wrong one, more often right as the wave passes. That flicker is what sells it, and
it costs one comparison. The roll is `hash(index, step)`, a deterministic integer hash rather
than `Math.random()`: same frame, same glyph, every run. `HZ` (16) and the ghost row's `GHZ`
(12) both divide the 3.5s cycle into a whole number of steps, so the churn is periodic and the
video loops without a seam even though only scroll-triggered captures get a boomerang.

Watch out for: the headline has to be monospace. Swapping `W` for `I` in a proportional face
changes that character's advance width, every character after it shifts, and the line jitters
horizontally for the entire animation — it looks like a rendering bug and it is invisible in a
still. Either use a mono stack, as here, or measure each final character once at load and pin
its span to that width. And measure after `document.fonts.ready` if a webfont is involved,
because measuring against the fallback face bakes in the wrong widths without erroring.
