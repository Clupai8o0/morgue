A pinned section whose inner track is `width: max-content` and translated on `x` by
`-(track.scrollWidth - innerWidth)`, scrubbed against page scroll.

The non-obvious part is `containerAnimation`: the per-panel reveal triggers can't use normal
scroll positions, because the panels move horizontally inside an animation rather than through
the viewport. Passing `containerAnimation: scrollTween` tells ScrollTrigger to measure against
the tween's progress instead, which is what makes `start: 'left 80%'` mean anything.

`end: () => '+=' + (track.scrollWidth - innerWidth)` plus `invalidateOnRefresh: true` is what
keeps it correct on resize — without it the scroll distance is baked at init and the last panel
either never arrives or arrives early.

Watch out for: this cannot be previewed in a short embedded iframe. ScrollTrigger's scroller is
the iframe's own viewport, so a 460px-tall frame shows frame 0 forever.
