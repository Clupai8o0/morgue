import type { Metadata } from "next";
import { authConfigured } from "@/auth";
import { MorgueLanding } from "@/components/landing/morgue-landing";
import "./landing.css";

/**
 * Public landing page.
 *
 * The agent-first product page: morgue is a private UI-component vault that
 * MCP-compatible coding agents (Claude Code, Cursor, Codex) pull from over MCP.
 * The design and all of its motion live in @/components/landing; this file is
 * the server shell that owns SEO metadata and the build-time `canSignIn` flag.
 *
 * Public honesty rule: every live surface here is either app chrome or an own /
 * MIT component authored for this page. No paid third-party capture appears, and
 * the walkthrough video slot stays empty until a real own/MIT recording exists.
 */

// Prerendered at build. `canSignIn` is read from env at build time, exactly as
// the sign-in page renders only the providers that exist: a deployment with no
// auth wired up shows no sign-in door rather than a dead end.
export const dynamic = "force-static";

export const metadata: Metadata = {
  // Absolute so the layout's "%s · morgue" template does not append to it.
  title: { absolute: "morgue: a component vault for MCP coding agents" },
  description:
    "Store a UI component once and any MCP coding agent — Claude Code, Cursor, Codex — pulls it back as a paste-ready bundle with its licence, dependencies, and gotchas.",
  openGraph: {
    title: "morgue: a component vault for MCP coding agents",
    description:
      "Store a UI component once and any MCP coding agent pulls it back over MCP as a paste-ready bundle — licence, dependencies, and gotchas included.",
    images: ["/og.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "morgue: a component vault for MCP coding agents",
    description:
      "Store a UI component once and any MCP coding agent pulls it back over MCP as a paste-ready bundle.",
    images: ["/og.png"],
  },
};

export default function Home() {
  return <MorgueLanding canSignIn={authConfigured()} />;
}
