Vertex-shader displacement on a subdivided plane. The whole effect is three lines: sample a
`sin(x) * cos(y)` field offset by time, push `position.z` along it, pass the field value to the
fragment shader as a varying so colour tracks height.

Geometry subdivision is what sells it — `PlaneGeometry(3.4, 2.2, 60, 40)`. Below roughly 40
segments the wave visibly facets.

Watch out for: this uses its own `THREE.Clock()`, i.e. `performance.now()`. Any capture harness
that only seeks GSAP timelines will record a frozen frame. It needs a faked page clock.

Teardown, if this is ever mounted in a React tree: `renderer.dispose()` alone does NOT release
the WebGL context. You need `renderer.forceContextLoss()`, and Chrome only allows 16 live
contexts per renderer thread before it starts silently killing the oldest.
