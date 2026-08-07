"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VaultCard } from "./vault-card";
import { Reveal } from "@/components/motion/reveal";
import { releaseAll } from "@/lib/player-pool";
import {
  archiveKey,
  archiveNameOf,
  keysOf,
  tagsOf,
  type Facet,
  type VaultIndex,
} from "@/lib/types";

/**
 * The browse grid.
 *
 * Pagination here is a RENDERING concern, not a fetching one. facets.json is
 * ~200 bytes an item — about 25KB gzipped at 500 items — so the whole corpus
 * arrives in one request and filtering is instant with no waterfall. What we
 * page is how many cards exist in the DOM and how many videos are allowed to
 * decode, which are the budgets that actually blow.
 *
 * Three separate budgets, three separate mechanisms:
 *   payload  — one small facets fetch, done above this component
 *   players  — the LRU in lib/player-pool, hard-capped at 12
 *   DOM      — this component, `visible` growing by a page at a time
 */

const CHIP_GROUPS = ["effect", "technique", "trigger", "surface"] as const;

/** Archive names are directory names. Anything else in ?archive= is ignored. */
const ARCHIVE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function VaultGrid({
  facets,
  index,
  initialArchive,
}: {
  facets: Facet[];
  index: VaultIndex | null;
  /**
   * Seeds the archive filter from `/vault?archive=<name>` — the link the
   * detail page's Relations section points at. When the server route forwards
   * the search param this is authoritative; when it does not, the effect below
   * reads it on the client instead.
   */
  initialArchive?: string | null;
}) {
  const pageSize = index?.pageSize ?? 24;

  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Set<string>>(
    () => new Set(initialArchive ? [archiveKey(initialArchive)] : []),
  );
  const [visible, setVisible] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Deep-link fallback, on mount only. Deliberately NOT in the useState
  // initialiser: that also runs on the server, where there is no location, so
  // seeding there would make the two render passes disagree — a hydration
  // mismatch. Deliberately not synced back to the URL either; that would be a
  // second filtering system with its own history semantics.
  const seeded = useRef(initialArchive !== undefined);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const name = new URLSearchParams(window.location.search).get("archive");
    if (name && ARCHIVE_NAME.test(name)) setActive(new Set([archiveKey(name)]));
  }, []);

  // Precompute each item's searchable haystack once rather than on every
  // keystroke — at 500 items and ~15 tags each that is the difference between
  // typing feeling instant and feeling laggy.
  //
  // `keys` is what the filter matches — display tags plus the namespaced
  // `archive:<name>` token, so an archive joins the EXISTING OR predicate
  // rather than getting a second filtering system. The archive name is in the
  // haystack too, so typing "blunt" finds the family with no chip at all.
  const rows = useMemo(
    () =>
      facets.map((f) => ({
        facet: f,
        keys: keysOf(f),
        haystack: `${f.title} ${tagsOf(f).join(" ")} ${f.archive ?? ""}`
          .toLowerCase(),
      })),
    [facets],
  );

  const shown = useMemo(() => {
    const q = query.toLowerCase().trim();
    return rows
      .filter((r) => {
        if (active.size && !r.keys.some((t) => active.has(t))) return false;
        return !q || r.haystack.includes(q);
      })
      .map((r) => r.facet);
  }, [rows, query, active]);

  // A changed result set means most loaded players belong to cards that no
  // longer exist. Release them rather than waiting for eviction to catch up.
  useEffect(() => {
    releaseAll();
    setVisible(pageSize);
  }, [query, active, pageSize]);

  // Scroll pagination. The sentinel sits below the last card; when it comes
  // into view we grant another page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => (v >= shown.length ? v : v + pageSize));
        }
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length, pageSize]);

  const toggle = (tag: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const chips = useMemo(() => {
    if (!index) return [];
    return CHIP_GROUPS.flatMap((g) => index.vocab[g] ?? []);
  }, [index]);

  // Derived from `facets`, NOT from `shown`. This is the single most important
  // line in the file for relations: an active filter must never remove its own
  // escape hatch, which is what makes "an extract whose parent is filtered out"
  // a recoverable state instead of a dead end. Derived here rather than from
  // index.vocab because the count comes free and vocab cannot carry it.
  const archives = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of facets) {
      if (f.archive) counts.set(f.archive, (counts.get(f.archive) ?? 0) + 1);
    }
    return [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [facets]);

  // With exactly one archive selected and nothing else, the count line can
  // name the family — so "am I seeing all of it" is answerable without
  // counting cards.
  const soleArchive =
    active.size === 1 ? archiveNameOf([...active][0]) : null;

  const page = shown.slice(0, visible);

  return (
    <div>
      <div className="mb-xl">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="images trailing the cursor, sticky stacked cards…"
          aria-label="Search the vault"
          className="border-hairline focus:border-ink text-display-md font-display placeholder:text-ink-muted/60 py-sm w-full border-0 border-b bg-transparent transition-colors duration-[var(--duration-base)] outline-none"
        />
        <div className="mt-sm text-micro text-ink-muted tabular-nums">
          {shown.length === facets.length
            ? `${facets.length} items`
            : `${shown.length} of ${facets.length}`}
          {active.size > 0
            ? soleArchive
              ? ` · ${soleArchive} family`
              : ` · ${active.size} filters`
            : ""}
        </div>
      </div>

      {/* Archives sit above the vocab chips and use the same button, the same
          `active` set and the same toggle — visibly one chip vocabulary, not
          two. They inherit its OR semantics: archive + tag WIDENS. */}
      {archives.length > 0 ? (
        <div
          className="mb-sm gap-xxs flex flex-wrap items-center"
          role="group"
          aria-label="Archives"
        >
          <span className="text-micro text-ink-muted pr-xxs uppercase tracking-[0.12em]">
            archives
          </span>
          {archives.map(({ name, count }) => {
            const key = archiveKey(name);
            const on = active.has(key);
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                aria-pressed={on}
                className={`text-micro rounded-pill border px-sm py-[5px] transition-all duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.04] ${
                  on
                    ? "bg-ink text-on-primary border-ink"
                    : "border-hairline text-ink-muted hover:text-ink hover:border-ink-muted"
                }`}
              >
                {name}{" "}
                <span className="tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className="mb-xxl gap-xxs flex flex-wrap">
          {chips.map((tag) => {
            const on = active.has(tag);
            return (
              <button
                key={tag}
                onClick={() => toggle(tag)}
                aria-pressed={on}
                className={`text-micro rounded-pill border px-sm py-[5px] transition-all duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.04] ${
                  on
                    ? "bg-ink text-on-primary border-ink"
                    : "border-hairline text-ink-muted hover:text-ink hover:border-ink-muted"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      ) : null}

      {page.length > 0 ? (
        <div className="gap-md grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
          {page.map((f, i) => (
            // Stagger index resets per page, so each newly appended page
            // cascades from its own first card rather than inheriting a
            // half-second delay from everything above it.
            <Reveal key={f.slug} index={i % pageSize}>
              <VaultCard facet={f} />
            </Reveal>
          ))}
        </div>
      ) : (
        <p className="text-body text-ink-muted py-xxl">Nothing matches.</p>
      )}

      <div ref={sentinelRef} aria-hidden className="h-px" />

      {visible < shown.length ? (
        <p className="text-micro text-ink-muted py-xl text-center tabular-nums">
          {shown.length - visible} more
        </p>
      ) : null}
    </div>
  );
}
