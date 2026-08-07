/**
 * The landing page's measured numbers, read from `docs/FINDINGS.md` at build
 * time. One source, no copies.
 *
 * ── Why this file parses markdown instead of importing a generated JSON ─────
 *
 * The landing page quotes six measurements. Until now they were retyped into
 * `app/page.tsx`, which means a re-measurement silently turns the public site
 * into a liar — nothing errors, nothing fails, the page just says something
 * that is no longer true. So the numbers have to come from one place.
 *
 * There were three candidates, and the deployment decided it:
 *
 *   site/data/*.json emitted by bin/build.mjs — REJECTED. `.gitignore:16`
 *     ignores `site/`, exactly as `:11` ignores `items/`. Vercel clones the
 *     repo; it never sees either. A file there is invisible at deploy time.
 *
 *   A committed JSON generated from FINDINGS.md — REJECTED. It is still two
 *     artefacts, and the generated one goes stale the first time somebody
 *     edits the doc and forgets the regen step. That is the same failure this
 *     module exists to remove, moved one file to the left.
 *
 *   docs/FINDINGS.md, parsed here — CHOSEN. It is committed, so Vercel has it.
 *     `app/vault/[slug]/page.tsx` already imports `../../../../../bin/
 *     export-bundle.mjs`, so the build demonstrably reaches outside `web/`
 *     into the repo root. There is no second artefact and no sync step: the
 *     doc IS the source, and the page is a view of it.
 *
 * ── Failure mode ───────────────────────────────────────────────────────────
 *
 * Every extractor below throws if its number is not where it expects. A
 * renamed table or a rewritten sentence therefore FAILS `pnpm web:build`
 * with the name of the number that went missing — it does not render a blank,
 * a zero, or a stale constant. Same reasoning as CLAUDE.md rule 9: a missing
 * input in production must stop the deploy, not quietly serve a wrong page.
 *
 * The page is prerendered (`○ /`), so this read happens once during
 * `next build`, in the build container where the repo is checked out. Nothing
 * reads the filesystem at request time.
 *
 * Server-only by construction: it imports `node:fs`, so a client component
 * that pulls it in fails to compile rather than shipping the doc to a browser.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** Repo-root-relative. `next build` and `next dev` both run with cwd = web/. */
const FINDINGS_PATH =
  process.env.MORGUE_FINDINGS_PATH ??
  path.resolve(process.cwd(), "..", "docs", "FINDINGS.md");

// ─── markdown scraping ──────────────────────────────────────────────────────

interface Table {
  /** Nearest preceding heading, `#` markers stripped. */
  heading: string;
  header: string[];
  /** Body rows, cells still carrying their markdown emphasis. */
  rows: string[][];
}

interface Doc {
  tables: Table[];
  /** Section body text keyed by heading, headings excluded. */
  sections: Map<string, string>;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparator = (line: string): boolean =>
  /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes("-");

/** Strip bold, italic and code emphasis so a cell yields a bare value. */
const plain = (s: string): string =>
  s
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();

function parse(md: string): Doc {
  const lines = md.split("\n");
  const tables: Table[] = [];
  const sections = new Map<string, string>();

  let heading = "";
  let buffer: string[] = [];

  const flush = () => {
    if (heading) {
      sections.set(heading, (sections.get(heading) ?? "") + buffer.join("\n"));
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[2].trim();
      continue;
    }

    // A table is a header row, a separator row, then body rows.
    if (line.trim().startsWith("|") && isSeparator(lines[i + 1] ?? "")) {
      const header = cells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(cells(lines[j]));
        j++;
      }
      tables.push({ heading, header, rows });
      i = j - 1;
      continue;
    }

    buffer.push(line);
  }
  flush();

  return { tables, sections };
}

let cached: Doc | null = null;

function doc(): Doc {
  if (cached) return cached;
  let md: string;
  try {
    // turbopackIgnore: the path is dynamic, so Turbopack would otherwise trace
    // the entire repository into the serverless output "just in case". It is
    // never needed at runtime — `page.tsx` is `force-static`, so this read
    // happens during `next build` and only the rendered HTML ships.
    md = readFileSync(/* turbopackIgnore: true */ FINDINGS_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `findings: cannot read ${FINDINGS_PATH}. The landing page renders its ` +
        `numbers from docs/FINDINGS.md, so that file must be present in the ` +
        `build. If this is a Vercel deploy, the project's root directory is ` +
        `web/ and "Include files outside the root directory" must stay on — ` +
        `bin/export-bundle.mjs is imported the same way. (${String(err)})`,
    );
  }
  cached = parse(md);
  return cached;
}

// ─── assertions ─────────────────────────────────────────────────────────────

function fail(what: string, where: string): never {
  throw new Error(
    `findings: could not read ${what} from ${FINDINGS_PATH} (${where}). ` +
      `The landing page quotes this number and will not invent one. Either ` +
      `restore the text in docs/FINDINGS.md or update the extractor in ` +
      `web/src/lib/findings.ts.`,
  );
}

function tableUnder(headingPattern: RegExp, what: string): Table {
  const t = doc().tables.find((x) => headingPattern.test(x.heading));
  if (!t) fail(what, `no table under a heading matching ${headingPattern}`);
  return t;
}

function sectionUnder(headingPattern: RegExp, what: string): string {
  for (const [heading, body] of doc().sections) {
    if (headingPattern.test(heading)) return body;
  }
  return fail(what, `no section heading matching ${headingPattern}`);
}

function capture(text: string, re: RegExp, what: string, where: string) {
  const m = re.exec(text);
  if (!m) fail(what, `${where}: no match for ${re}`);
  return m;
}

// ─── the numbers the landing page quotes ────────────────────────────────────

export interface EncoderRow {
  name: string;
  size: string;
  time: string;
  /** The settled choice. Bolded in the doc, which is how it is detected. */
  win: boolean;
}

/** `## Encoder selection` — the whole comparison table, winner flagged. */
export function encoders(): EncoderRow[] {
  const t = tableUnder(/^Encoder selection$/, "the encoder comparison");
  const rows = t.rows
    .filter((r) => r.length >= 3 && plain(r[0]))
    .map((r) => ({
      name: plain(r[0]),
      size: plain(r[1]),
      time: plain(r[2]),
      // The doc bolds the row it settled on. That is the only marker, and it
      // beats hardcoding "row 0" — a re-measurement may reorder the table.
      win: r[0].trim().startsWith("**"),
    }));

  if (rows.length < 2) fail("the encoder comparison", "fewer than two rows");
  if (!rows.some((r) => r.win)) {
    fail(
      "the winning encoder",
      "no row in the Encoder selection table is bolded",
    );
  }
  return rows;
}

export interface Ceilings {
  /** e.g. `40 → 16` — WebGL contexts created, then still alive. */
  contexts: string;
  /** e.g. `Still 16` — alive after detaching every canvas. */
  afterDetach: string;
  /** e.g. `0` — track transform on a pinned ScrollTrigger in a short iframe. */
  pinnedTrack: string;
  /** e.g. `3000px` — how far the parent was scrolled for that result. */
  parentScroll: string;
}

/** `## Browser ceilings` — the three-stat row under "The constraint". */
export function ceilings(): Ceilings {
  const t = tableUnder(/^Browser ceilings$/, "the browser ceiling table");
  const row = (pattern: RegExp, what: string): string => {
    const r = t.rows.find((x) => pattern.test(plain(x[0])));
    if (!r || r.length < 2) fail(what, `no row matching ${pattern}`);
    return plain(r[1]);
  };

  const created = row(/WebGL contexts created/i, "the WebGL context ceiling");
  const c = capture(
    created,
    /(\d+)\s*created\s*→\s*(\d+)\s*alive/i,
    "the WebGL context ceiling",
    "WebGL contexts row",
  );

  const detached = row(/detaching every canvas/i, "the post-detach count");
  const d = capture(
    detached,
    /still\s+(\d+)/i,
    "the post-detach count",
    "detached-canvas row",
  );

  const pinnedLabel = t.rows.find((x) => /ScrollTrigger in a/i.test(plain(x[0])));
  if (!pinnedLabel || pinnedLabel.length < 2) {
    fail("the pinned ScrollTrigger result", "no ScrollTrigger row");
  }
  const p = capture(
    plain(pinnedLabel[1]),
    /stayed at\s+(-?[\d.]+)/i,
    "the pinned ScrollTrigger result",
    "ScrollTrigger row",
  );
  const s = capture(
    plain(pinnedLabel[0]),
    /parent scrolled\s+([\d.]+\s*px)/i,
    "the parent scroll distance",
    "ScrollTrigger row label",
  );

  return {
    contexts: `${c[1]} → ${c[2]}`,
    afterDetach: `Still ${d[1]}`,
    pinnedTrack: p[1],
    parentScroll: s[1].replace(/\s+/g, ""),
  };
}

export interface Determinism {
  /** e.g. `1113/1113`. */
  frames: string;
  /** What that was measured over, e.g. `all eight fixtures`. */
  corpus: string;
  /** e.g. `64s → 4.2s`. */
  nextSpeedup: string;
  /** e.g. `35.8s`. */
  captureWall: string;
  /** e.g. `8` — how many items that wall-clock figure covers. */
  captureItems: string;
}

/**
 * `## Determinism` and `## Per-item cost` — the second three-stat row.
 *
 * `corpus` is pulled out alongside the frame count on purpose. "1113/1113" and
 * "all eight fixtures" are one claim, and the fixture corpus is growing; if
 * they were single-sourced separately the page could end up quoting a frame
 * count from one measurement and a scope from another.
 */
export function determinism(): Determinism {
  const det = sectionUnder(/^Determinism$/, "the determinism result");
  const frames = capture(
    det,
    /\*\*([\d,]+\/[\d,]+)\s+frames byte-identical\*\*\s+across two runs of\s+([^.]+)\./i,
    "the determinism result",
    "Determinism section",
  );
  const speedup = capture(
    det,
    /pumping the clock:\s*\*\*([^*]+)\*\*/i,
    "the Next.js capture speed-up",
    "Determinism section",
  );

  const cost = sectionUnder(/^Per-item cost$/, "the full capture wall clock");
  const wall = capture(
    cost,
    /Full\s+(\d+)-item fixture capture:\s*\*\*([\d.]+s)\s+wall/i,
    "the full capture wall clock",
    "Per-item cost section",
  );

  return {
    frames: frames[1],
    corpus: frames[2].trim(),
    nextSpeedup: speedup[1].trim(),
    captureWall: wall[2],
    captureItems: wall[1],
  };
}
