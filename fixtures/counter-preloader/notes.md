A counter with no JavaScript. `@property --n { syntax: "<integer>"; inherits: true }` registers a
custom property with a type, which is the whole trick: an unregistered custom property is a
string and animates discretely, a registered `<integer>` interpolates. `counter-reset: n var(--n)`
turns the animated number into a real CSS counter and `.num::after { content: counter(n) }` prints
it. `inherits: true` is doing work — `--n` is animated once on `.loader` and read twice below it,
by the digits and by the rule beside them, which sets its width with
`transform: scaleX(calc(var(--n) / 100))`. One animation, two readers, and the bar can never
disagree with the number.

The count is `linear`, and the stalls come from the keyframe stops rather than an easing curve:
0 → 24 → 29 → 55 → 61 → 84 → 89 → 100 across evenly spaced percentages. Uneven distances over
even time is what makes it read as a network, and it is far easier to tune than an ease. `.num`
is monospace with `font-variant-numeric: tabular-nums` and `min-width: 3ch`, so 0 → 100 grows to
the right from a fixed left edge without shoving the rule around as the digit count changes.

Everything is one 4s `infinite` loop that ends exactly where it starts, because morgue only
boomerangs scroll-triggered captures — a `load` item that finishes somewhere else jump-cuts on
replay. So the sheet counts, lifts away, holds on the revealed page, and drops back. The
staggered lift is four columns sharing one `@keyframes lift` with `animation-delay` of 0, .07,
.14 and .21s. That is only seamless because the keyframes hold their rest state from 92% to
100%: an element delayed by 0.21s is at 94.75% of its own cycle when the master loop wraps, and
that has to still be rest or the last frame will not match the first. Any stagger you add has to
fit inside that window.

Watch out for: animating an *inherited* registered property re-resolves every declaration in the
subtree that mentions it, on every frame. Here that is a handful of nodes, so it is free. Put
the same animation on `:root` in a real page and you have signed up for a full-document style
recalculation 60 times a second, which will not show up as a dropped frame in the preloader — it
shows up as the content underneath being janky for the first two seconds after the reveal.
