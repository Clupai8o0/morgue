Two independent parts: a sprung head that chases the pointer, and a ribbon built from where that
head has been. The head is a damped spring — `v += ((target - p) * K - v * C) * STEP` — with
`K = 520` and `C = 2 * sqrt(K) * 0.42`. Writing the damping as `2 * sqrt(K) * zeta` means the
feel is one readable number: `zeta` of 1 is critically damped and dead, 0.42 gives about 23%
overshoot, which is what makes the ribbon buckle past a corner and swing back instead of just
turning. The pointer itself is drawn as a small hollow ring with a dashed leash to the head, so
the lag reads as deliberate rather than as latency.

The ribbon is age-based, not length-based. Every physics step appends `x, y, t` to a flat ring
buffer, and the ribbon is whatever is younger than `LIFE` (0.55s) — 66 samples. A fixed-length
ribbon looks identical while moving and then hangs there fully extended when you stop; an
age-based one retracts into the cursor in half a second, which is the behaviour anyone expects.
Half-width is `WID * (1 - a)^1.15 * (0.42 + 0.58 * min(1, a * 7))`, thin at the very head,
widest around 14% back, tapering to nothing at the tail — a lance rather than a sausage.

Drawing it is the fiddly part. Canvas2d has no per-vertex alpha, so the fade along the ribbon
has to come from somewhere: a single gradient-filled polygon only tracks a ribbon that happens
to be straight, and one quad per sample pair drawn `source-over` leaves a dark antialiasing seam
at every shared edge. `globalCompositeOperation = 'lighter'` fixes both — seams brighten
imperceptibly instead of darkening, and where the ribbon crosses itself the overlap blooms for
free. Three passes at 3.4×, 1× and 0.32× width give halo, body and core.

Watch out for: integrating the spring with the raw `requestAnimationFrame` delta. It looks right
on the machine you built it on and then the ribbon is a different length on a 120Hz display, and
different again under morgue's 30fps capture. Accumulate the delta and consume it in fixed
`1/120s` steps, with a guard on the loop so a backgrounded tab returning with a 4-second delta
does not run 480 iterations. `LIFE` is then measured in simulation time, not frames, and the
ribbon is the same object at every refresh rate.
