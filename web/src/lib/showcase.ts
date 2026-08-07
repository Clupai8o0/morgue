/**
 * The three pieces the public landing page is allowed to show.
 *
 * ── What "committed manifest" means here ───────────────────────────────────
 *
 * Everything in the vault is someone else's paid component, so the only items
 * that may appear on a public page are the ones written from scratch for this
 * repo. Those live in `fixtures/`, whose SOURCE is committed (`.gitignore`
 * excludes only their build artefacts — `bundle.js`, `_next/`). An item opts
 * in with `"showcase": true` in its `meta.json`; nothing here has a hardcoded
 * list of slugs, so adding a fourth piece is a one-line meta change.
 *
 * `items/` and `site/` are gitignored (`.gitignore:11,16`) and Vercel never
 * sees them, which is why this reads `fixtures/` and not `site/data/`.
 *
 * ── Media, and why it degrades instead of 404ing ───────────────────────────
 *
 * Titles are committed. Media is not: `out/` is gitignored, so a poster and an
 * mp4 only reach Vercel by being copied into `web/public/showcase/<slug>/` and
 * committed. `bin/build.mjs` does that copy for any item with
 * `showcase: true`, but only after `pnpm capture` has produced the frames.
 *
 * Until that has run, `poster` and `video` come back `null` and the card
 * renders a titled placeholder with no `<img>` and no `<video>` in the DOM. It
 * is deliberately not a hardcoded path that resolves to a 404: a broken image
 * on the landing page looks like a broken site, and — worse — nothing tells
 * you which of the two it is.
 *
 * `/api/media/*` is NOT an option for these. `proxy.ts:21` gates it behind
 * auth, so on the public page every request would 302 to /signin.
 *
 * Server-only by construction: it imports `node:fs`. Pass the result down to
 * client components as plain props.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const FIXTURES_DIR =
  process.env.MORGUE_FIXTURES_DIR ??
  path.resolve(process.cwd(), "..", "fixtures");

/** Where bin/build.mjs drops committed showcase media. */
const PUBLIC_SHOWCASE = path.resolve(process.cwd(), "public", "showcase");

const REPO_URL = "https://github.com/Clupai8o0/morgue";

export interface ShowcaseItem {
  slug: string;
  title: string;
  /** `light | medium | heavy`, shown as the corner badge like a vault card. */
  weight: string;
  /** effect + technique, already trimmed for the card's one-line caption. */
  tags: string[];
  /** Public path, or null when capture has not run yet. */
  poster: string | null;
  /** Public path, or null when capture has not run yet. */
  video: string | null;
  /** Source on GitHub. These are MIT/own-licensed, so the code can be shown. */
  href: string;
}

interface ShowcaseMeta {
  title?: string;
  showcase?: boolean;
  weight?: string;
  effect?: string[];
  technique?: string[];
}

let cached: ShowcaseItem[] | null = null;

export function showcaseItems(): ShowcaseItem[] {
  if (cached) return cached;

  let slugs: string[];
  try {
    // turbopackIgnore on every read in this module: the paths are dynamic, so
    // Turbopack would trace the whole repo into the serverless output. Nothing
    // here is needed at runtime — `page.tsx` is `force-static`, so these run
    // during `next build` and only the rendered HTML ships. (The media itself
    // is served from web/public, which is unaffected by tracing.)
    slugs = readdirSync(/* turbopackIgnore: true */ FIXTURES_DIR, {
      withFileTypes: true,
    })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    // Not fatal, and deliberately so. The landing page has to render on a
    // machine that has only checked out web/; the section degrades to nothing
    // rather than taking the build down. Contrast findings.ts, which throws —
    // there the failure would be a wrong NUMBER, here it is a missing card.
    cached = [];
    return cached;
  }

  const items: ShowcaseItem[] = [];
  for (const slug of slugs) {
    const metaPath = path.join(FIXTURES_DIR, slug, "meta.json");
    if (!existsSync(/* turbopackIgnore: true */ metaPath)) continue;

    let meta: ShowcaseMeta;
    try {
      meta = JSON.parse(
        readFileSync(/* turbopackIgnore: true */ metaPath, "utf8"),
      ) as ShowcaseMeta;
    } catch {
      continue;
    }
    if (meta.showcase !== true) continue;

    const posterFile = path.join(PUBLIC_SHOWCASE, slug, "poster.webp");
    const videoFile = path.join(PUBLIC_SHOWCASE, slug, "preview.mp4");

    items.push({
      slug,
      title: meta.title ?? slug,
      weight: meta.weight ?? "",
      tags: [...(meta.effect ?? []), ...(meta.technique ?? [])].slice(0, 2),
      poster: existsSync(/* turbopackIgnore: true */ posterFile)
        ? `/showcase/${slug}/poster.webp`
        : null,
      // A video with no poster would pop in from nothing, so it is only
      // offered alongside one.
      video:
        existsSync(/* turbopackIgnore: true */ videoFile) &&
        existsSync(/* turbopackIgnore: true */ posterFile)
          ? `/showcase/${slug}/preview.mp4`
          : null,
      href: `${REPO_URL}/tree/main/fixtures/${slug}`,
    });
  }

  cached = items;
  return cached;
}
