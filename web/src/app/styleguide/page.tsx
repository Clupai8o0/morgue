import type { Metadata } from "next";

export const metadata: Metadata = { title: "Style guide" };

/**
 * Living specimen of the token layer in globals.css.
 *
 * Kept in the repo rather than thrown away after setup: when a card starts
 * looking wrong six months from now, the question is always "did the token
 * change or did the component?" — and this page answers it in one look.
 *
 * Deliberately zero JS. Every interaction here is CSS.
 */

const TYPE = [
  { cls: "text-display-xxl font-display", name: "display-xxl", spec: "110px · -0.05em · 0.85" },
  { cls: "text-display-xl font-display", name: "display-xl", spec: "85px · -0.05em · 0.95" },
  { cls: "text-display-lg font-display", name: "display-lg", spec: "62px · -0.05em · 1.0" },
  { cls: "text-display-md font-display", name: "display-md", spec: "32px · -0.031em · 1.13" },
  { cls: "text-headline", name: "headline", spec: "22px · 700 · -0.036em" },
  { cls: "text-subhead", name: "subhead", spec: "24px · 400" },
  { cls: "text-body-lg", name: "body-lg", spec: "18px" },
  { cls: "text-body", name: "body", spec: "15px · default" },
  { cls: "text-body-sm", name: "body-sm", spec: "14px · 500" },
  { cls: "text-caption", name: "caption", spec: "13px · 500" },
  { cls: "text-micro", name: "micro", spec: "12px" },
];

const SURFACES = [
  { token: "canvas", hex: "#090909", cls: "bg-canvas" },
  { token: "surface-1", hex: "#141414", cls: "bg-surface-1" },
  { token: "surface-2", hex: "#1c1c1c", cls: "bg-surface-2" },
  { token: "hairline", hex: "#262626", cls: "bg-hairline" },
  { token: "hairline-soft", hex: "#1a1a1a", cls: "bg-hairline-soft" },
];

const INKS = [
  { token: "ink", hex: "#ffffff", cls: "bg-ink" },
  { token: "ink-muted", hex: "#999999", cls: "bg-ink-muted" },
  { token: "accent", hex: "#0099ff", cls: "bg-accent" },
  { token: "success", hex: "#22c55e", cls: "bg-success" },
];

const SPOTLIGHTS = [
  { name: "violet", cls: "spotlight-violet" },
  { name: "magenta", cls: "spotlight-magenta" },
  { name: "orange", cls: "spotlight-orange" },
  { name: "coral", cls: "spotlight-coral" },
];

const RADII = [
  { token: "xs", px: 4 },
  { token: "sm", px: 6 },
  { token: "md", px: 10 },
  { token: "lg", px: 15 },
  { token: "xl", px: 20 },
  { token: "xxl", px: 30 },
  { token: "pill", px: 100 },
];

const SPACING = [
  { token: "hair", px: 1 },
  { token: "xxs", px: 4 },
  { token: "xs", px: 8 },
  { token: "sm", px: 12 },
  { token: "md", px: 15 },
  { token: "lg", px: 20 },
  { token: "xl", px: 30 },
  { token: "xxl", px: 40 },
  { token: "section", px: 96 },
];

const EASINGS = [
  { token: "out-expo", curve: "0.16, 1, 0.3, 1", use: "reveals, the default" },
  { token: "out-quart", curve: "0.25, 1, 0.5, 1", use: "small state changes" },
  { token: "in-out-quart", curve: "0.76, 0, 0.24, 1", use: "page transitions" },
  { token: "spring", curve: "0.34, 1.56, 0.64, 1", use: "pointer-reactive, overshoots" },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-hairline-soft border-t py-xxl">
      <header className="mb-lg">
        <h2 className="text-caption text-ink-muted font-body uppercase tracking-[0.14em]">
          {title}
        </h2>
        {note ? (
          <p className="text-body-sm text-ink-muted mt-xxs max-w-[62ch]">{note}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-lg pb-section">
      <header className="py-section">
        <p className="text-caption text-accent mb-md uppercase tracking-[0.14em]">
          morgue · design system
        </p>
        <h1 className="text-display-xl font-display max-w-[14ch]">
          Tokens, not vibes.
        </h1>
        <p className="text-body-lg text-ink-muted mt-lg max-w-[58ch]">
          Generated from <code className="text-ink">DESIGN.md</code>. Two things
          were changed on the way in, both marked in{" "}
          <code className="text-ink">globals.css</code>: display sizes are fluid,
          and tracking is expressed in <code className="text-ink">em</code> so it
          survives that. The motion scale is an addition — the design system
          ships none.
        </p>
      </header>

      <Section
        title="Typography"
        note="General Sans for display (standing in for GT Walsheim), Inter for body with the character variants DESIGN.md specifies. Resize the window — display sizes are clamped, body sizes are not."
      >
        <div className="space-y-xl">
          {TYPE.map((t) => (
            <div key={t.name} className="grid gap-xs md:grid-cols-[160px_1fr] md:items-baseline">
              <div className="text-micro text-ink-muted font-body">
                <div className="text-ink">{t.name}</div>
                <div className="mt-[2px] tabular-nums">{t.spec}</div>
              </div>
              <p className={`${t.cls} min-w-0`}>Grid, capture, recall</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Surfaces"
        note="Monochrome by design. Every card in the grid is one of these; colour arrives only through the spotlight panels and the single accent."
      >
        <div className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-5">
          {SURFACES.map((c) => (
            <div key={c.token} className="border-hairline overflow-hidden rounded-lg border">
              <div className={`${c.cls} h-20`} />
              <div className="p-sm">
                <div className="text-caption">{c.token}</div>
                <div className="text-micro text-ink-muted tabular-nums">{c.hex}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-md grid grid-cols-2 gap-md sm:grid-cols-4">
          {INKS.map((c) => (
            <div key={c.token} className="border-hairline overflow-hidden rounded-lg border">
              <div className={`${c.cls} h-20`} />
              <div className="p-sm">
                <div className="text-caption">{c.token}</div>
                <div className="text-micro text-ink-muted tabular-nums">{c.hex}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Spotlight panels"
        note="DESIGN.md is specific that these are cards inside the grid, not section backgrounds — each one a small living poster. They break up a wall of dark preview cards and cost nothing to render. Hover to see the atmosphere shift."
      >
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
          {SPOTLIGHTS.map((s) => (
            <div
              key={s.name}
              className={`${s.cls} group rounded-xxl p-xl relative aspect-[4/5] overflow-hidden transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out-expo)] hover:scale-[1.02]`}
            >
              <div className="absolute inset-0 opacity-0 transition-opacity duration-[var(--duration-slow)] ease-[var(--ease-out-expo)] group-hover:opacity-100 [background:radial-gradient(80%_60%_at_50%_110%,rgba(255,255,255,0.35),transparent_70%)]" />
              <div className="relative flex h-full flex-col justify-end">
                <div className="text-subhead font-display">{s.name}</div>
                <div className="text-micro opacity-70">spotlight-{s.name}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius" note="15–20px is the card default; 30px is reserved for spotlight panels; 100px makes the pill.">
        <div className="flex flex-wrap gap-md">
          {RADII.map((r) => (
            <div key={r.token} className="text-center">
              <div
                className="bg-surface-2 border-hairline size-24 border"
                style={{ borderRadius: `var(--radius-${r.token})` }}
              />
              <div className="text-caption mt-xs">{r.token}</div>
              <div className="text-micro text-ink-muted tabular-nums">{r.px}px</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Spacing">
        <div className="space-y-xs">
          {SPACING.map((s) => (
            <div key={s.token} className="flex items-center gap-md">
              <div className="text-micro text-ink-muted w-20 tabular-nums">
                {s.token}
              </div>
              <div className="bg-accent h-3 rounded-xs" style={{ width: `${s.px}px` }} />
              <div className="text-micro text-ink-muted tabular-nums">{s.px}px</div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Motion"
        note="Not in DESIGN.md — added here so every component eases the same way. Hover any row to run its curve. out-expo is the default: fast departure, long settle."
      >
        <div className="space-y-sm">
          {EASINGS.map((e) => (
            <div
              key={e.token}
              className="group border-hairline bg-surface-1 rounded-lg border p-md"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-xs">
                <div className="text-body-sm">ease-{e.token}</div>
                <div className="text-micro text-ink-muted">{e.use}</div>
              </div>
              <div className="bg-canvas rounded-pill mt-sm h-2 overflow-hidden">
                <div
                  className="bg-accent h-full w-8 rounded-pill transition-transform duration-[var(--duration-reveal)] group-hover:translate-x-[calc(100%*10)]"
                  style={{ transitionTimingFunction: `cubic-bezier(${e.curve})` }}
                />
              </div>
              <div className="text-micro text-ink-muted mt-xs tabular-nums">
                cubic-bezier({e.curve})
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Buttons"
        note="From the components block in DESIGN.md. White pill on dark is the primary CTA everywhere in this system."
      >
        <div className="flex flex-wrap items-center gap-sm">
          <button className="bg-primary text-on-primary rounded-pill text-button px-md py-[10px] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)] hover:scale-[1.04] active:scale-[0.98]">
            Open the vault
          </button>
          <button className="bg-surface-1 text-ink rounded-pill text-button px-md py-[10px] transition-colors duration-[var(--duration-fast)] hover:bg-surface-2">
            Secondary
          </button>
          <button className="bg-surface-2 text-ink rounded-xxl text-button px-[14px] py-xs transition-colors duration-[var(--duration-fast)] hover:bg-hairline">
            Translucent
          </button>
          <button
            aria-label="Icon"
            className="bg-surface-1 text-ink flex size-10 items-center justify-center rounded-full transition-colors duration-[var(--duration-fast)] hover:bg-surface-2"
          >
            ↗
          </button>
        </div>

        <div className="mt-lg">
          <a href="#" className="text-accent text-body underline underline-offset-4">
            A hyperlink — the only decorative use of accent-blue the system allows
          </a>
        </div>
      </Section>
    </main>
  );
}
