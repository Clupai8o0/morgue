import Link from "next/link";
import { authConfigured } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { DocsNav } from "@/components/docs/docs-nav";

/**
 * Shared shell for /docs and its sub-sections.
 *
 * PUBLIC. The docs describe how to add and pull components, and none of that is
 * secret — the path is absent from proxy.ts's PROTECTED list, so the route gate
 * lets it straight through, and absent from lib/local.ts's HOSTED_ONLY, so a
 * single-user MORGUE_LOCAL deployment renders it too (rather than 404ing it the
 * way it does /account and /signin). Do not add /docs to either list.
 *
 * force-static, like /privacy and the landing: the content is baked at build,
 * and authConfigured() is read then — a deployment with no auth wired up shows
 * no sign-in door rather than a dead end, exactly as the landing does.
 */
export const dynamic = "force-static";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  const canSignIn = authConfigured();

  return (
    <>
      <SiteHeader canSignIn={canSignIn} />
      <div className="mx-auto w-full max-w-[1100px] px-lg">
        <div className="gap-xl lg:grid lg:grid-cols-[220px_1fr]">
          <aside className="border-hairline-soft bg-canvas/80 sticky top-[60px] z-30 border-b py-md backdrop-blur-[10px] lg:static lg:border-0 lg:bg-transparent lg:py-section lg:backdrop-blur-none">
            <DocsNav />
          </aside>

          <main className="min-w-0 pb-section">{children}</main>
        </div>

        <footer className="border-hairline-soft py-xxl text-micro text-ink-muted gap-md flex flex-wrap justify-between border-t">
          <span>morgue · a private reference collection for motion on the web</span>
          <span className="gap-md flex flex-wrap">
            <Link href="/docs" className="hover:text-ink transition-colors">
              docs
            </Link>
            <Link href="/privacy" className="hover:text-ink transition-colors">
              privacy
            </Link>
            <Link href="/terms" className="hover:text-ink transition-colors">
              terms
            </Link>
            <Link href="/styleguide" className="hover:text-ink transition-colors">
              style guide
            </Link>
          </span>
        </footer>
      </div>
    </>
  );
}
