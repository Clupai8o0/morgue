import type { Metadata } from "next";
import {
  PageHeader,
  Section,
  P,
  C,
  A,
  VocabTable,
  Callout,
} from "@/components/docs/docs-ui";
import { PageNav } from "@/components/docs/docs-nav";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Reference",
  description:
    "The morgue controlled vocabulary: the fixed values for effect, technique, trigger, surface, weight, kind and licence that every item is classified under and every MCP search filters on.",
  openGraph: {
    title: "Reference · morgue docs",
    description:
      "The controlled vocabulary — effect, technique, trigger, surface, weight, kind, licence.",
    images: ["/og.png"],
  },
};

/* Meanings are written to match how each value is actually used across the
   collection — the source lists are in the repo's CLAUDE.md and bin/survey.mjs. */

const EFFECT: [string, string][] = [
  ["marquee", "A continuous ticker of text or logos, usually horizontal."],
  ["pinned-horizontal", "A section pins while its inner track scrolls sideways with the page."],
  ["sticky-stack", "Cards stack and swap as each sticks, then releases, on scroll."],
  ["image-trail", "Images spawn along the cursor's path and fade out behind it."],
  ["magnetic", "An element eases toward the pointer and springs back on leave."],
  ["text-scramble", "Characters cycle through random glyphs before resolving to the word."],
  ["mask-reveal", "Content is revealed through an animated clip or mask."],
  ["page-transition", "An animated handoff between routes rather than a hard cut."],
  ["parallax", "Layers move at different rates against scroll for depth."],
  ["hover-tilt", "A card tilts in 3D toward the pointer."],
  ["cursor-distortion", "A shader or warp effect that follows the cursor."],
  ["preloader", "An intro loading sequence that plays before the page settles."],
  ["morph", "One shape or path smoothly becomes another."],
  ["flip-layout", "Elements animate between two layouts (the FLIP technique)."],
  ["infinite-list", "A list that loops or keeps loading as you scroll."],
  ["stagger", "A group animates in with a per-item delay."],
];

const TECHNIQUE: [string, string][] = [
  ["gsap-core", "GSAP core tweens and timelines."],
  ["gsap-scrolltrigger", "GSAP driven by scroll position."],
  ["css-only", "No JavaScript — pure CSS and HTML."],
  ["scroll-timeline", "CSS animation-timeline: scroll() / view()."],
  ["webgl-shader", "A hand-written GLSL shader."],
  ["threejs", "A Three.js scene."],
  ["canvas2d", "The 2D canvas API."],
  ["view-transitions", "The browser View Transitions API."],
  ["motion/framer", "Motion (formerly Framer Motion)."],
  ["react", "Requires React."],
  ["nextjs", "A Next.js app — these get a build step."],
  ["lenis", "Lenis smooth scroll."],
];

const TRIGGER: [string, string][] = [
  ["load", "Starts on page load."],
  ["hover", "Starts on pointer hover."],
  ["click", "Starts on click or tap."],
  ["scroll", "Driven by scroll position."],
  ["drag", "Starts on press-and-drag."],
  ["idle", "Runs on its own, with no input."],
];

const SURFACE: [string, string][] = [
  ["button", "A single control."],
  ["card", "A tile or panel in a grid."],
  ["nav", "Navigation — a menu or header."],
  ["hero", "The top-of-page banner."],
  ["cursor", "Follows or replaces the pointer."],
  ["list", "A repeating collection."],
  ["image", "An image or media element."],
  ["text", "Type — a headline or paragraph."],
  ["page", "The whole page or a full section."],
];

const WEIGHT: [string, string][] = [
  ["light", "Cheap — CSS or a tiny script. Safe anywhere."],
  ["medium", "Some JS or a library. Fine on a page or two."],
  ["heavy", "WebGL, Three.js, or a big scroll rig. Budget for it."],
];

const KIND: [string, string][] = [
  ["reference", "Video + notes + URL, no code. Fastest to add."],
  ["static", "HTML/CSS/JS that runs as-is. No build."],
  ["project", "Needs a build step (React, Next). Only these get one."],
  ["unextracted", "The effect is buried in a large template; extract later, on demand."],
];

const LICENSE: [string, string][] = [
  ["own", "Written for morgue. Safe to use anywhere."],
  ["mit", "MIT. Attribution appreciated, not required."],
  ["paid", "Purchased for personal reference. Check the original EULA before shipping."],
  ["unknown", "Treat as all-rights-reserved until you establish otherwise."],
];

export default function ReferenceDocs() {
  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="The controlled vocabulary."
        lead={
          <>
            Every item is classified under these fixed values, and every MCP
            search filters on them. Free text is never a tag — it rots into{" "}
            <C>scroll</C>, <C>scrolling</C>, <C>scroll-anim</C> within a month,
            and then search stops finding anything.
          </>
        }
      />

      <Section eyebrow="effect" title="What the thing does.">
        <P>
          One or more per item. Chosen by watching the capture, not by guessing.
        </P>
        <VocabTable head="effect" rows={EFFECT} />
      </Section>

      <Section eyebrow="technique" title="How it is built.">
        <P>
          One or more. This is what tells an export which real package to
          install — tags with no package behind them (<C>css-only</C>,{" "}
          <C>scroll-timeline</C>, <C>webgl-shader</C>, <C>canvas2d</C>,{" "}
          <C>view-transitions</C>) are deliberate.
        </P>
        <VocabTable head="technique" rows={TECHNIQUE} />
      </Section>

      <Section eyebrow="trigger" title="What starts it.">
        <P>Exactly one, and it also picks the capture driver.</P>
        <VocabTable head="trigger" rows={TRIGGER} />
      </Section>

      <Section eyebrow="surface" title="Where it lives.">
        <P>Exactly one.</P>
        <VocabTable head="surface" rows={SURFACE} />
      </Section>

      <Section eyebrow="weight" title="What it costs to run.">
        <VocabTable head="weight" rows={WEIGHT} />
      </Section>

      <Section eyebrow="kind" title="How much work it is to add.">
        <P>
          Exactly one. It decides the whole ingestion path — see{" "}
          <A href="/docs/adding">Adding components</A>.
        </P>
        <VocabTable head="kind" rows={KIND} />
      </Section>

      <Section eyebrow="licence" title="What you may do with it.">
        <P>
          Exactly one. It leads every export bundle, in bold, because provenance
          travels with the code.
        </P>
        <VocabTable head="license" rows={LICENSE} />

        <Callout title="Filtering on these over MCP">
          Pass any of <C>effect</C>, <C>technique</C>, <C>trigger</C>,{" "}
          <C>surface</C>, <C>weight</C>, <C>kind</C> and <C>license</C> to{" "}
          <C>search_components</C>. Values within one category are ORed;
          categories are ANDed. See <A href="/docs/retrieving">Retrieving components</A>.
        </Callout>
      </Section>

      <PageNav current="/docs/reference" />
    </>
  );
}
