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
  title: "Retrieving components",
  description:
    "Pull a component out of the morgue as a paste-ready markdown bundle: the browser 'Copy for agent' button, pnpm export, and the MCP tools (search_components, get_component, list_facets) with example calls and a sample bundle.",
  openGraph: {
    title: "Retrieving components · morgue docs",
    description:
      "Copy for agent, pnpm export, and the three MCP tools — with example calls and a sample bundle.",
    images: ["/og.png"],
  },
};

export default function RetrievingDocs() {
  return (
    <>
      <PageHeader
        eyebrow="Retrieving components"
        title="Copy, export, or MCP."
        lead={
          <>
            Every route out produces the same thing: a markdown bundle with the
            component&apos;s provenance, licence, dependencies, notes, source,
            and — the part that matters — what to strip before using it.
          </>
        }
      />

      <Section eyebrow="The bundle" title="One format, three ways to get it.">
        <P>
          <C>pnpm export</C>, the &ldquo;Copy for agent&rdquo; button and the MCP{" "}
          <C>get_component</C> tool all call the same builder, so a component
          pulled any of the three ways is byte-identical. A bundle carries:
        </P>
        <UL>
          <LI>
            <strong className="text-ink">Licence</strong> — first, in bold, so it
            cannot be missed. Read it before you ship.
          </LI>
          <LI>
            <strong className="text-ink">Provenance</strong> — where it came
            from, which delivery, and where it lives in the vault.
          </LI>
          <LI>
            <strong className="text-ink">Classification</strong> and{" "}
            <strong className="text-ink">Dependencies</strong> — the vocabulary
            tags, and the real packages to install (never morgue&apos;s vendored
            copies).
          </LI>
          <LI>
            <strong className="text-ink">How it works</strong> and{" "}
            <strong className="text-ink">Source</strong> — the notes, and the
            inlined files.
          </LI>
          <LI>
            <strong className="text-ink">Adapting this</strong> — the demo
            scaffolding to delete, the vendor paths to replace, and the{" "}
            <C>window.__ready</C> signal to remove. This is what stops an agent
            from faithfully reproducing the demo harness.
          </LI>
        </UL>
      </Section>

      <Section eyebrow="From the browser" title="Copy for agent.">
        <P>
          On any item&apos;s detail page in the vault, the{" "}
          <strong className="text-ink">Copy for agent</strong> button puts the
          bundle straight on your clipboard — it is assembled on the server and
          shipped with the page, so the copy is instant rather than a round trip.
          There is a <C>download .md</C> link beside it, and the byte count, for
          when you want the file rather than the paste.
        </P>
      </Section>

      <Section eyebrow="From the CLI" title="pnpm export.">
        <P>
          Prints the bundle to stdout, or straight to the clipboard. It reads the{" "}
          <em>built</em> record, so run <C>pnpm build</C> first if the item is
          new.
        </P>
        <Cmd
          lines={[
            "pnpm export pinned-horizontal          # → stdout",
            "pnpm export pinned-horizontal --copy   # → clipboard",
          ]}
        />
      </Section>

      <Section eyebrow="Over MCP" title="Three tools for an agent.">
        <P>
          The morgue speaks the Model Context Protocol. An agent gets{" "}
          <C>search_components</C> (find by free text and facet filters),{" "}
          <C>get_component</C> (pull the bundle) and <C>list_facets</C> (read the
          vocabulary it may filter on).
        </P>

        <H3>Authenticating</H3>
        <UL>
          <LI>
            <strong className="text-ink">Hosted</strong> — POST JSON-RPC to{" "}
            <C>/api/mcp</C> with a bearer token minted at <C>/account</C>. The
            token is verified against your account on every call (it re-checks
            suspension), and shown to you exactly once when created — only its
            hash is stored. Send it as <C>Authorization: Bearer &lt;token&gt;</C>.
          </LI>
          <LI>
            <strong className="text-ink">Local</strong> — <C>pnpm mcp</C> serves
            the same three tools over stdio with no token, for the person who
            owns the filesystem. Requires a built site (<C>pnpm build</C>).
          </LI>
        </UL>

        <H3>Searching</H3>
        <P>
          Filters are ANDed across categories and ORed within one. Free text
          matches title, tags, slug and archive. A search returns a compact hit
          list; pass a <C>slug</C> to <C>get_component</C> for the full bundle.
        </P>
        <CodeBlock label="search_components → structuredContent">{`{
  "total": 1,
  "returned": 1,
  "results": [
    {
      "slug": "pinned-horizontal",
      "title": "Pinned horizontal scroll",
      "classification": {
        "effect": ["pinned-horizontal"],
        "technique": ["gsap-scrolltrigger"],
        "trigger": "scroll",
        "surface": "page",
        "weight": "heavy",
        "kind": "static",
        "license": "mit"
      },
      "notes": "A pinned section whose inner track is width: max-content and translated on x by -(track.scrollWidth - innerWidth), scrubbed against page scroll."
    }
  ]
}`}</CodeBlock>

        <H3>Pulling and browsing the vocabulary</H3>
        <CodeBlock label="get_component / list_facets — JSON-RPC">{`// Pull one component as the paste-ready bundle:
{ "method": "tools/call",
  "params": { "name": "get_component",
              "arguments": { "slug": "pinned-horizontal" } } }

// Read the controlled vocabulary you may filter on:
{ "method": "tools/call",
  "params": { "name": "list_facets", "arguments": {} } }`}</CodeBlock>
        <P>
          <C>get_component</C> returns the bundle below as text.{" "}
          <C>list_facets</C> returns the effects, techniques, triggers, surfaces,
          weights, kinds and licences actually present in the vault — the same
          lists on the <A href="/docs/reference">Reference</A> page.
        </P>
      </Section>

      <Section eyebrow="A sample bundle" title="What get_component returns.">
        <P>
          For <C>pinned-horizontal</C> — an MIT fixture written for this repo, so
          it can be shown. Two things are abridged for length: the{" "}
          <C>Source</C> block (a real bundle inlines every file) and the tail of{" "}
          <C>How it works</C> (the real bundle prints the whole <C>notes.md</C>).
          Everything else is verbatim.
        </P>
        <CodeBlock label="pinned-horizontal.md">{`# Pinned horizontal scroll

> **Licence — MIT.** MIT. Attribution appreciated, not required.

## Provenance

- **Origin:** demo
- **In morgue as:** \`pinned-horizontal\`  (\`items/pinned-horizontal/\`)
- **Collected:** 2026-08-05

## Classification

- **Effect:** pinned-horizontal
- **Technique:** gsap-scrolltrigger
- **Trigger:** scroll · **Surface:** page · **Weight:** heavy

## Dependencies

- \`gsap\` ^3.13

## How it works

A pinned section whose inner track is \`width: max-content\` and translated on
\`x\` by \`-(track.scrollWidth - innerWidth)\`, scrubbed against page scroll.

The non-obvious part is \`containerAnimation\`: the per-panel reveal triggers
can't use normal scroll positions, because the panels move horizontally inside
an animation rather than through the viewport. Passing \`containerAnimation:
scrollTween\` tells ScrollTrigger to measure against the tween's progress
instead, which is what makes \`start: 'left 80%'\` mean anything.

… (two more paragraphs — resize handling, and the iframe-preview caveat — elided)

## Source

**\`index.html\`**

\`\`\`html
<!-- … the standalone demo page, inlined verbatim … -->
\`\`\`

## Adapting this

- **Demo scaffolding — do not copy:** \`body\`, \`.intro\`, \`.outro\`. These
  centre and size the standalone demo page; positioning is the parent's job in
  your project.
- **Vendor scripts:** any \`<script src="/vendor/…">\` or \`/three/\`, \`/lenis/\`
  path is morgue's local copy. Replace with a real import from the dependencies
  above.
- **\`window.__ready = true\`** is a signal to the capture harness. Delete it.
- The pinned section's height sets the scroll distance; the track translates by
  (trackWidth - viewportWidth). Recalculate on resize or it desyncs.`}</CodeBlock>

        <Callout tone="warn" title="The licence line is not decoration">
          A vault holds paid third-party source alongside own/MIT work. A paid
          bundle says <C>PAID LICENCE. Purchased for personal reference.</C> in
          bold — do not ship it into client work without checking the original
          EULA.
        </Callout>
      </Section>

      <PageNav current="/docs/retrieving" />
    </>
  );
}
