`gsap.quickTo` is the whole trick. It creates a reusable tween bound to one property, so a
`pointermove` handler firing 120×/sec doesn't allocate a new tween per event — you just call
`xTo(value)` and GSAP retargets the existing one.

Offset is `(pointer - centre) * 0.5`; the 0.5 is the magnet strength. `elastic.out(1, 0.4)` on
the return is what makes it feel springy rather than mechanical.

The fill is a separate absolutely-positioned circle scaled 0→1 from centre, with the label on
`mix-blend-mode: difference` so it flips to dark automatically as the fill passes under it —
no colour-swap animation needed.

Watch out for: `pointermove` on the element only fires once the cursor is already inside, so the
magnet has no pull from outside. Real implementations listen on a padded wrapper.
