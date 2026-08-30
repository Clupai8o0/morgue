import type { Metadata } from "next";
import Link from "next/link";
import { Magnetic } from "@/components/motion/magnetic";
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
  LinkCard,
} from "@/components/docs/docs-ui";
import { PageNav } from "@/components/docs/docs-nav";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "How the morgue works: a private reference vault of web UI and motion components. Add a component, and an agent captures a deterministic preview, files it under a controlled vocabulary, and writes down how it works — then pulls it back out later, paste-ready.",
  openGraph: {
    title: "morgue docs",
    description:
      "How to add components to the morgue and pull them back out — the folder contract, the CLI, and the MCP.",
    images: ["/og.png"],
  },
};

export default function DocsHome() {
  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="How the morgue works."
        lead={
          <>
            A drawer of clippings for motion on the web. Hand it a component; it
            captures a deterministic video preview, files it under a controlled
            vocabulary, and writes down how the effect actually works. Later you
            search for it in words and get the clip, the code, and the note.
          </>
        }
      />

      <Section eyebrow="The shape of it" title="One folder in, a paste-ready bundle out.">
        <P>
          Everything an agent does with the morgue is one of two motions. You{" "}
          <strong className="text-ink">add</strong> a component — by writing a
          few files and running three commands — and later you{" "}
          <strong className="text-ink">retrieve</strong> one, as a markdown
          bundle that carries its provenance, licence, dependencies, notes and
          source. There is no upload button and no admin form: the collection is
          files on disk and the tools that act on them.
        </P>
        <P>
          The public landing tells the other half of the story — the capture
          harness, the WebGL context ceiling, and why a browse grid can never
          run the code it shows. If you want the engineering, start there:{" "}
          <A href="/">the landing</A>.
        </P>

        <div className="mt-xl gap-md grid sm:grid-cols-2">
          <LinkCard href="/docs/adding" eyebrow="Write files, run three commands" title="Adding components">
            The folder contract, the capture/build/check loop, and the{" "}
            <C>meta.json</C> vocabulary that keeps search working.
          </LinkCard>
          <LinkCard href="/docs/retrieving" eyebrow="Copy, export, or MCP" title="Retrieving components">
            The &ldquo;Copy for agent&rdquo; button, <C>pnpm export</C>, and the
            three MCP tools an agent calls to search and pull.
          </LinkCard>
        </div>
      </Section>

      <Section eyebrow="Access" title="Invite-based, read by a human.">
        <P>
          The morgue itself is private — it holds third-party source licensed for
          personal reference, not redistribution. There is no public profile, no
          directory, and no discovery: another account cannot browse to a vault,
          search it, or find out it exists.
        </P>
        <UL>
          <LI>
            <strong className="text-ink">Request access</strong> from the
            waitlist on the landing page. Requests are read by one person.
          </LI>
          <LI>
            <strong className="text-ink">A maintainer approves it</strong>, and
            your account is created.
          </LI>
          <LI>
            <strong className="text-ink">Sign in</strong>, and your vault is
            yours — private by default, shareable only through read-only links
            you issue yourself.
          </LI>
        </UL>
        <div className="mt-xl">
          <Magnetic>
            <Link
              href="/#access"
              className="bg-primary text-on-primary rounded-pill text-button px-lg inline-block py-[12px]"
            >
              Request access
            </Link>
          </Magnetic>
        </div>
      </Section>

      <Section eyebrow="First pull" title="Get a component into your project.">
        <P>
          Two paths, depending on whether your agent speaks{" "}
          <A href="https://modelcontextprotocol.io" external>
            MCP
          </A>{" "}
          or you are working in the browser.
        </P>

        <H3>Over MCP (hosted)</H3>
        <P>
          Mint a bearer token at <C>/account</C>, point your agent&apos;s MCP
          client at the endpoint, and it gets three tools:{" "}
          <C>search_components</C>, <C>get_component</C> and <C>list_facets</C>.
          Every call is authenticated against your account, so it sees your
          vault and no one else&apos;s.
        </P>
        <CodeBlock label="search_components — JSON-RPC over HTTP">{`POST https://morgue.clupai.com/api/mcp
Authorization: Bearer <your-token>

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_components",
    "arguments": {
      "query": "panels pin and scroll sideways",
      "filters": { "effect": ["pinned-horizontal"] },
      "limit": 5
    }
  }
}`}</CodeBlock>
        <P>
          Take a <C>slug</C> from the results and call <C>get_component</C> for
          the full bundle — the same one <C>pnpm export</C> and the browser
          button produce. Full detail on <A href="/docs/retrieving">Retrieving components</A>.
        </P>

        <H3>Over MCP (local)</H3>
        <P>
          Running your own single-user morgue? The same three tools are served
          over stdio with no token — point a local MCP client at:
        </P>
        <Cmd lines={["pnpm mcp"]} />

        <H3>From the browser</H3>
        <P>
          Open any item in the vault and press{" "}
          <strong className="text-ink">Copy for agent</strong>. The bundle is
          assembled and on your clipboard — paste it into your agent and it has
          everything, including which lines are demo scaffolding to throw away.
        </P>

        <Callout tone="warn" title="Read the licence line first">
          Every bundle opens with its licence. Some components are paid
          third-party source, purchased for personal reference — the bundle says
          so in bold, and shipping one into client work without checking the
          original EULA is on you.
        </Callout>
      </Section>

      <PageNav current="/docs" />
    </>
  );
}
