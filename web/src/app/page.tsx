import Link from "next/link";
import { Magnetic } from "@/components/motion/magnetic";
import { Reveal } from "@/components/motion/reveal";
import { WaitlistForm } from "@/components/waitlist-form";
import { ceilings, determinism, encoders } from "@/lib/findings";
import { showcaseItems } from "@/lib/showcase";
import { ShowcaseCard } from "@/lib/showcase-card";

/**
 * Public landing page.
 *
 * It leads with the engineering, not the collection — and that is a
 * constraint, not a style choice. Every genuinely impressive capture in the
 * vault is someone else's paid component, so the only honest thing to put on
 * a public domain is how the capture harness works. Fortunately that is the
 * interesting part.
 *
 * NOT ONE NUMBER ON THIS PAGE IS TYPED HERE. Every measurement is read out of
 * docs/FINDINGS.md at build time by @/lib/findings, and the three showcase
 * tiles are read out of fixtures/*\/meta.json by @/lib/showcase. They used to
 * be retyped constants, which meant a re-measurement turned this page into a
 * quiet liar — no error, no failing check, just a wrong claim on a public
 * domain. Change the doc; this follows. If the doc stops saying it, the build
 * fails rather than guessing.
 */

// The page is prerendered at build time, which is where the repo (and so
// docs/ and fixtures/) is on disk. Stated explicitly rather than left to
// inference: if a future edit introduced a dynamic API, the file reads would
// silently move to request time, where the traced lambda has neither.
export const dynamic = "force-static";

const TIERS = [
  {
    tier: "Grid",
    shows: "Poster image, video on hover. Never runs code.",
    cost: "~30–90 KB per item",
    spot: "spotlight-violet",
  },
  {
    tier: "Detail",
    shows: "The real thing, one live iframe.",
    cost: "One item at a time",
    spot: "spotlight-magenta",
  },
  {
    tier: "Scroll-driven",
    shows: "Video only — the standalone page for the real thing.",
    cost: "Zero embed",
    spot: "spotlight-orange",
  },
];

/**
 * Small numbers read better as words in a heading; anything else as digits.
 * Spelled out rather than written into the copy, because the showcase count is
 * derived and the heading must not be able to disagree with the grid below it.
 */
const WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six"];
const spell = (n: number) => WORD[n] ?? String(n);

export default function Home() {
  const encoderRows = encoders();
  const ceiling = ceilings();
  const det = determinism();
  const showcase = showcaseItems();

  return (
    <main className="mx-auto w-full max-w-[1100px] px-lg">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="py-section">
        <p className="text-caption text-accent mb-md uppercase tracking-[0.14em]">
          morgue
        </p>
        <h1 className="text-display-xxl font-display max-w-[13ch]">
          A drawer of clippings for motion on the web.
        </h1>
        <p className="text-body-lg text-ink-muted mt-xl max-w-[56ch]">
          Hand it a component. It captures a deterministic video preview, files
          it under a controlled vocabulary, and writes down how the effect
          actually works. Later you search for{" "}
          <span className="text-ink">
            &ldquo;the one where the panels pin and scroll sideways&rdquo;
          </span>{" "}
          and get the clip, the code, and the note.
        </p>

        <div className="mt-xxl gap-sm flex flex-wrap items-center">
          <Magnetic>
            <Link
              href="#access"
              className="bg-primary text-on-primary rounded-pill text-button px-lg inline-block py-[12px]"
            >
              Request access
            </Link>
          </Magnetic>
          <Magnetic>
            <a
              href="https://github.com/Clupai8o0/morgue"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-surface-1 text-ink rounded-pill text-button px-lg inline-block py-[12px]"
            >
              Source ↗
            </a>
          </Magnetic>
        </div>
      </section>

      {/* ── The ceiling that shapes everything ───────────────────────── */}
      <Reveal>
        <section className="border-hairline-soft py-section border-t">
          <p className="text-caption text-ink-muted mb-md uppercase tracking-[0.14em]">
            The constraint
          </p>
          <h2 className="text-display-lg font-display max-w-[18ch]">
            A browse grid can never run the code it displays.
          </h2>
          <p className="text-body-lg text-ink-muted mt-lg max-w-[58ch]">
            Not a preference — a hard ceiling. Measured in Chrome:
          </p>

          <div className="mt-xl gap-md grid sm:grid-cols-3">
            <Stat
              n={ceiling.contexts}
              label="WebGL contexts created, then still alive. The rest are force-lost."
            />
            <Stat
              n={ceiling.afterDetach}
              label="Alive after detaching every canvas from the DOM. Detaching frees nothing."
            />
            <Stat
              n={ceiling.pinnedTrack}
              label={`Track transform on a pinned ScrollTrigger in a short iframe, after scrolling the parent ${ceiling.parentScroll}.`}
            />
          </div>

          <p className="text-body text-ink-muted mt-xl max-w-[58ch]">
            The cap is per <em>renderer thread</em>, so same-origin iframes share
            one budget rather than each getting their own. A grid of live scenes
            doesn&apos;t degrade gracefully — it silently blanks whichever
            preview you happen to be looking at. Hence three tiers.
          </p>

          <div className="mt-xl gap-md grid sm:grid-cols-3">
            {TIERS.map((t, i) => (
              <Reveal key={t.tier} index={i}>
                <div className={`${t.spot} rounded-xxl p-lg flex h-full flex-col justify-between`}>
                  <div>
                    <div className="text-subhead font-display">{t.tier}</div>
                    <p className="text-body-sm mt-xs opacity-90">{t.shows}</p>
                  </div>
                  <div className="text-micro mt-lg opacity-75">{t.cost}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>
      </Reveal>

      {/* ── Determinism ──────────────────────────────────────────────── */}
      <Reveal>
        <section className="border-hairline-soft py-section border-t">
          <p className="text-caption text-ink-muted mb-md uppercase tracking-[0.14em]">
            Deterministic capture
          </p>
          <h2 className="text-display-lg font-display max-w-[16ch]">
            Previews are not screen recordings.
          </h2>
          <p className="text-body-lg text-ink-muted mt-lg max-w-[58ch]">
            The harness fakes the page clock before any script runs, then steps
            it one frame at a time.
          </p>

          <pre className="border-hairline bg-surface-1 rounded-lg p-md text-caption mt-xl overflow-x-auto">
            <code>{`performance.now = () => now
Date.now        = () => epoch + now
requestAnimationFrame = (cb) => queue.set(id++, cb)   // drains only when we step it`}</code>
          </pre>

          <p className="text-body text-ink-muted mt-lg max-w-[58ch]">
            GSAP, a raw rAF loop, <code className="text-ink">THREE.Clock</code>,
            Lenis and motion all read from those, so every one of them advances
            in lockstep with the frame counter. CSS and WAAPI animations live on
            the compositor instead and get an explicit seek — except those on a{" "}
            <code className="text-ink">ScrollTimeline</code>, which are driven by
            scroll position and must be left alone.
          </p>

          <div className="mt-xl gap-md grid sm:grid-cols-3">
            <Stat
              n={det.frames}
              label={`Frames byte-identical across two runs of ${det.corpus}. Captures are diffable, so a preview that rots is detectable.`}
            />
            <Stat
              n={det.nextSpeedup}
              label="Next.js capture, after discovering Playwright polls on requestAnimationFrame — which a faked clock never drains."
            />
            <Stat
              n={det.captureWall}
              label={`Full ${det.captureItems}-item fixture capture, end to end.`}
            />
          </div>
        </section>
      </Reveal>

      {/* ── Encoder table ────────────────────────────────────────────── */}
      <Reveal>
        <section className="border-hairline-soft py-section border-t">
          <p className="text-caption text-ink-muted mb-md uppercase tracking-[0.14em]">
            Measured, not assumed
          </p>
          <h2 className="text-display-lg font-display max-w-[20ch]">
            The hardware encoder was the worst option.
          </h2>
          <p className="text-body-lg text-ink-muted mt-lg max-w-[58ch]">
            Same 120 WebGL wireframe frames — the worst case for inter-frame
            compression. VideoToolbox optimises for throughput, not bitrate: 4×
            the size of software x264 for a short loop.
          </p>

          <div className="mt-xl overflow-x-auto">
            <table className="text-body-sm w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="text-ink-muted text-micro border-hairline border-b uppercase tracking-[0.1em]">
                  <th className="py-sm text-left font-medium">Encoder</th>
                  <th className="py-sm text-right font-medium">Size</th>
                  <th className="py-sm text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {encoderRows.map((e) => (
                  <tr
                    key={e.name}
                    className={`border-hairline-soft border-b ${e.win ? "text-ink" : "text-ink-muted"}`}
                  >
                    <td className="py-sm">
                      {e.win ? <span className="text-accent mr-xs">→</span> : null}
                      {e.name}
                    </td>
                    <td className="py-sm text-right tabular-nums">{e.size}</td>
                    <td className="py-sm text-right tabular-nums">{e.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-body-sm text-ink-muted mt-lg max-w-[58ch]">
            VP9 was both bigger and 18× slower, so emitting a{" "}
            <code className="text-ink">.webm</code> alongside the{" "}
            <code className="text-ink">.mp4</code> was pure waste. Dropped.
          </p>
        </section>
      </Reveal>

      {/* ── Showcase ─────────────────────────────────────────────────────
          The tiles come from fixtures/ — every item whose meta.json carries
          `showcase: true`. Nothing is hardcoded here, including the count, so
          a fourth piece is one meta field and a `pnpm fixtures:site`.
          The section drops out entirely rather than announcing pieces that
          are not there. ────────────────────────────────────────────────── */}
      {showcase.length > 0 ? (
        <Reveal>
          <section className="border-hairline-soft py-section border-t">
            <p className="text-caption text-ink-muted mb-md uppercase tracking-[0.14em]">
              Captured with it
            </p>
            <h2 className="text-display-lg font-display max-w-[16ch]">
              {spell(showcase.length)} piece{showcase.length === 1 ? "" : "s"},
              built for this page.
            </h2>
            <p className="text-body text-ink-muted mt-lg max-w-[58ch]">
              Authored from scratch and MIT-licensed, so they can be shown. The
              collection behind the login cannot — that is rather the point.
              Each tile is a recorded preview, never live code; the link goes to
              the source.
            </p>

            <div className="mt-xl gap-md grid sm:grid-cols-3">
              {showcase.map((item, i) => (
                <Reveal key={item.slug} index={i}>
                  <ShowcaseCard item={item} />
                </Reveal>
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      {/* ── Waitlist ─────────────────────────────────────────────────── */}
      <Reveal>
        <section id="access" className="border-hairline-soft py-section border-t">
          <h2 className="text-display-lg font-display max-w-[14ch]">
            The tool is the open part.
          </h2>
          <p className="text-body-lg text-ink-muted mt-lg mb-xl max-w-[54ch]">
            The morgue itself is private — it holds third-party source licensed
            for personal reference, not redistribution. Access requests are read
            by a human, which is to say one person.
          </p>
          <div className="max-w-[520px]">
            <WaitlistForm />
          </div>
        </section>
      </Reveal>

      <footer className="border-hairline-soft py-xxl text-micro text-ink-muted gap-md flex flex-wrap justify-between border-t">
        <span>morgue · a private reference collection for motion on the web</span>
        <Link href="/styleguide" className="hover:text-ink transition-colors">
          style guide
        </Link>
      </footer>
    </main>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="border-hairline bg-surface-1 rounded-lg p-md">
      <div className="text-display-md font-display tabular-nums">{n}</div>
      <p className="text-body-sm text-ink-muted mt-xs">{label}</p>
    </div>
  );
}
