/**
 * The morgue mark, as inline SVG.
 *
 * It is the same glyph as the app icons (icon-512.png, og.png) — a filed tag
 * dropped into an inbox tray, the "drawer of clippings" the name is about —
 * redrawn in `currentColor` so it inherits the ink token instead of shipping a
 * theme-locked raster. The hole in the tag is a real evenodd cut, so the canvas
 * shows through it rather than being painted over.
 */
export function Logo({
  className,
  title = "morgue",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label={title}
      className={className}
      fill="currentColor"
    >
      {/* tag + hole (evenodd punches the hole clean through) */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 5 L24 5 L28 9 L28 23 L12 23 L12 9 Z M22.2 10.5 A2.2 2.2 0 1 1 17.8 10.5 A2.2 2.2 0 1 1 22.2 10.5 Z"
      />
      {/* inbox tray with a central notch the tag sits in */}
      <path d="M8 22 H16 L18 25 H22 L24 22 H32 A3 3 0 0 1 35 25 V33 A3 3 0 0 1 32 36 H8 A3 3 0 0 1 5 33 V25 A3 3 0 0 1 8 22 Z" />
    </svg>
  );
}
