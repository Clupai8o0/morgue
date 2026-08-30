import type { Metadata } from "next";
import {
  PageHeader,
  Section,
  H3,
  P,
  UL,
  LI,
  C,
  A,
  CodeBlock,
  Cmd,
  Callout,
} from "@/components/docs/docs-ui";
import { PageNav } from "@/components/docs/docs-nav";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Adding components",
  description:
    "The morgue folder contract: write items/<slug>/ with index.html, meta.json, capture.json and notes.md, then run pnpm capture, build and check. Includes the meta.json fields, the controlled vocabulary, and capture.json basics.",
  openGraph: {
    title: "Adding components · morgue docs",
    description:
      "The folder contract, the capture/build/check loop, and the meta.json vocabulary.",
    images: ["/og.png"],
  },
};

export default function AddingDocs() {
  return (
    <>
      <PageHeader
        eyebrow="Adding components"
        title="Write files. Run three commands."
        lead={
          <>
            There is no server and no upload endpoint. An agent adds an item by
            writing a folder of files, then running the capture, build and check
            commands. This is the whole contract.
          </>
        }
      />

      <Section eyebrow="The folder contract" title="One directory, four files.">
        <P>
          Create <C>items/&lt;slug&gt;/</C>. The slug is lowercase-kebab and is
          never guessed — you choose it.
        </P>
        <CodeBlock label="items/<slug>/">{`items/<slug>/
  index.html      # entry point — must run standalone, served from the folder root
  meta.json       # classification (kind, effect, technique, licence, …)
  capture.json    # how to record the preview
  notes.md        # how the effect works, in words
  src/**          # any additional source, verbatim`}</CodeBlock>
        <P>
          <C>index.html</C> has to run on its own, from the folder root, with no
          network — no CDN fonts, no bundler. If the effect needs a library,
          point it at morgue&apos;s vendored copy under a path like{" "}
          <C>/vendor/gsap.min.js</C>. Set <C>window.__ready = true</C> once the
          page is ready to record; the capture harness polls for it.
        </P>
      </Section>

      <Section eyebrow="Capture, build, check" title="The three commands.">
        <P>
          Run them from the repo root, in order. Or run{" "}
          <C>pnpm item &lt;slug&gt;</C>, which chains all three and stops at the
          first failure.
        </P>
        <CodeBlock label="the capture loop">{`pnpm capture <slug>     # records preview.mp4 + poster.webp into out/<slug>/
pnpm build              # regenerates the built site under site/
pnpm check <slug>       # verifies the item page runs in the BUILT site`}</CodeBlock>

        <Callout tone="warn" title="pnpm check is not optional">
          Capture serves the item at the folder root; the built site serves it
          from <C>/item/&lt;slug&gt;/</C>. Those resolve asset paths
          differently, so a clean capture does not prove the item page works.
          The check catches the gap — it has found two real bugs — and exits
          non-zero when a page is broken.
        </Callout>

        <Callout title="Then look at the preview">
          <C>motion: OK</C> only proves pixels changed, not that the effect ran.
          Open <C>out/&lt;slug&gt;/preview.mp4</C> — and the{" "}
          <C>contact.jpg</C> contact sheet — before you call an item done.
        </Callout>
      </Section>

      <Section eyebrow="meta.json" title="Classification, in a controlled vocabulary.">
        <P>
          The tags are a fixed vocabulary, not free text — free-text tags rot
          into <C>scroll</C>, <C>scrolling</C>, <C>scroll-anim</C> within a
          month, and then search stops working. Every value comes from the lists
          on the <A href="/docs/reference">Reference</A> page.
        </P>
        <CodeBlock label="items/pinned-horizontal/meta.json">{`{
  "title": "Pinned horizontal scroll",
  "kind": "static",
  "effect": ["pinned-horizontal"],
  "technique": ["gsap-scrolltrigger"],
  "trigger": "scroll",
  "surface": "page",
  "weight": "heavy",
  "source": "demo",
  "sourceUrl": null,
  "license": "mit",
  "addedAt": "2026-08-05",
  "usedIn": [],
  "export": {
    "files": ["index.html"],
    "deps": { "gsap": "^3.13" },
    "scaffold": ["body", ".intro", ".outro"],
    "notes": "The pinned section's height sets the scroll distance; the track translates by (trackWidth - viewportWidth). Recalculate on resize or it desyncs."
  }
}`}</CodeBlock>
        <P>The fields that carry the weight:</P>
        <UL>
          <LI>
            <C>kind</C> — <C>reference</C>, <C>static</C>, <C>project</C> or{" "}
            <C>unextracted</C>. It decides how much work ingestion is (see the
            effort ladder below).
          </LI>
          <LI>
            <C>effect</C> and <C>surface</C> — what the thing does and where it
            lives. These make the vault searchable and cannot be read off the
            source, so classify by watching the capture, never by guessing. A
            blank gets filled in later; a wrong tag gets trusted.
          </LI>
          <LI>
            <C>license</C> — <C>own</C>, <C>mit</C>, <C>paid</C> or{" "}
            <C>unknown</C>. It travels into every export, so record it honestly.
          </LI>
          <LI>
            <C>source</C> / <C>sourceUrl</C> — provenance. <C>sourceUrl</C> is
            the product page (&ldquo;what may I do with this&rdquo;). If there is
            no URL, leave it <C>null</C> and set <C>sourceArchive</C> instead —
            do not put a local path in <C>sourceUrl</C> to look filled in.
          </LI>
        </UL>

        <H3>The export block</H3>
        <P>
          Optional, but it is what makes an item usable somewhere else.{" "}
          <C>pnpm export</C> and the &ldquo;Copy for agent&rdquo; button
          assemble a bundle from it.
        </P>
        <Callout tone="warn" title="scaffold is the field that matters">
          A demo page centres itself in a <C>100vh</C> grid, hides{" "}
          <C>overflow</C> on <C>body</C>, and loads libraries from{" "}
          <C>/vendor/</C>. Pasted verbatim into another project, an agent
          faithfully reproduces all of it and the result looks plausible while
          being wrong. Listing the selectors that are furniture —{" "}
          <C>[&quot;body&quot;, &quot;.intro&quot;, &quot;.outro&quot;]</C>{" "}
          above — is the difference between a bundle that works and one that
          wastes an hour.
        </Callout>
      </Section>

      <Section eyebrow="capture.json" title="How to record the preview.">
        <P>
          Previews are not screen recordings — the harness fakes the page clock
          and steps it one frame at a time, so two runs are byte-identical.{" "}
          <C>capture.json</C> tells it how to drive the page.
        </P>
        <CodeBlock label="items/pinned-horizontal/capture.json">{`{
  "trigger": "scroll",
  "viewport": { "width": 1280, "height": 800 },
  "deviceScaleFactor": 2,
  "durationMs": 5000,
  "fps": 30,
  "scroll": { "from": 0, "to": "max", "ease": "inOut" },
  "posterAt": 0.55,
  "settleMs": 600
}`}</CodeBlock>
        <UL>
          <LI>
            <C>trigger</C> picks <em>one</em> driver — <C>load</C>,{" "}
            <C>scroll</C> or <C>pointer</C>. Match it to the effect, or you
            record a still frame.
          </LI>
          <LI>
            Four more drivers <strong className="text-ink">stack on top</strong>{" "}
            of any trigger for the hard cases: <C>wheel</C> (virtual-scroll
            sliders), <C>drag</C> (Draggable, OrbitControls, canvas tools),{" "}
            <C>click</C> with <C>real: true</C> (anything reading the cursor
            coordinates), and <C>scrollTo</C> (a fixed offset).
          </LI>
          <LI>
            <C>boomerang</C> doubles the frame count — turn it off when the
            animation already returns to its start.
          </LI>
        </UL>
        <P>
          The full <C>capture.json</C> schema, with every driver&apos;s options,
          lives in the repo&apos;s <C>CLAUDE.md</C> folder contract.
        </P>
      </Section>

      <Section eyebrow="kind" title="How much work is it?">
        <P>Pick the cheapest honest option. A reference is often the most useful.</P>
        <UL>
          <LI>
            <C>reference</C> — video + notes + URL, no code. Fastest to add.
          </LI>
          <LI>
            <C>static</C> — HTML/CSS/JS that runs as-is. No build.
          </LI>
          <LI>
            <C>project</C> — needs a build step (React, Next). Only these get one.
          </LI>
          <LI>
            <C>unextracted</C> — the effect is buried in a large template. Store
            the archive, record the path, capture a video, write the notes, and{" "}
            <strong className="text-ink">extract later, on demand</strong>. Never
            block intake on producing a runnable isolate.
          </LI>
        </UL>
      </Section>

      <Section eyebrow="Or let the skill do it" title="pnpm ingest, for a delivery that is already one component.">
        <P>
          When a delivery is one folder with an <C>index.html</C> that just needs
          to be un-bundlered, the <C>morgue-intake</C> skill and{" "}
          <C>pnpm ingest</C> do the deterministic part for you: strip delivery
          junk, relativise root-absolute paths, rewrite CDN and bare-ESM imports
          onto the vendored copies, inject the readiness signal, and size{" "}
          <C>capture.json</C> to the source&apos;s own timeline.
        </P>
        <Cmd lines={["pnpm ingest <dir> --slug <slug> --source-archive <path>"]} />
        <P>
          It leaves <C>effect</C> and <C>surface</C> blank rather than guessing,
          and lists what it could not classify. Fill those with{" "}
          <C>pnpm classify &lt;slug&gt;</C> — a picker that only ever writes the
          controlled vocabulary — then finish with <C>pnpm item &lt;slug&gt;</C>.
        </P>
      </Section>

      <PageNav current="/docs/adding" />
    </>
  );
}
