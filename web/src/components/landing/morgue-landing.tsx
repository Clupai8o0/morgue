"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { initLanding } from "./landing-effects";

/**
 * The public landing page, ported from the approved design mockup.
 *
 * All motion lives in ./landing-effects (verbatim canvas/DOM code) and is
 * attached on mount, then fully torn down on unmount. The markup is otherwise
 * static; the two access-request forms POST to the real /api/waitlist. Styles
 * come from ../../app/landing.css, scoped under `.mland`.
 *
 * The walkthrough video slot is intentionally empty — it stays that way until a
 * real own/MIT recording exists, since the public page may never show a paid
 * third-party capture.
 */

// Rendered into the coloured MCP-response panel verbatim (leading spaces and
// newlines are load-bearing under white-space: pre), so it goes in as raw HTML.
// The Copy button reads this element's innerText.
const BUNDLE_HTML = `<span class="h"># Pinned horizontal scroll</span>

<span class="c">> Licence: MIT. Free to adapt. Provenance below.</span>

<span class="h">## Classification</span>
kind        <span class="k">static</span>
effect      <span class="k">pinned-horizontal</span>
technique   <span class="k">gsap-scrolltrigger</span>
trigger     <span class="k">scroll</span>   surface <span class="k">page</span>   weight <span class="k">heavy</span>

<span class="h">## Dependencies</span> <span class="c">(real packages, not morgue's vendored copies)</span>
  "gsap": "^3.13"

<span class="h">## How it works</span>
A pinned section whose height sets the scroll distance; the inner
track translates by (trackWidth minus viewportWidth) as you scroll.

<span class="h">## Files</span>
  index.html   <span class="c"># self-contained, runs standalone</span>

<span class="h">## Adapting this</span>
<span class="g">keep</span>   the height to translate mapping; it is the effect.
<span class="g">keep</span>   gsap ScrollTrigger pin and scrub.
<span class="c">drop</span>   .intro / .outro: demo scaffolding, not the component.
<span class="c">drop</span>   window.__ready: capture signal only.

<span class="h">## Watch out</span>
Recalculate travel on resize, or the track desyncs from the pin.`;

function BrandMark() {
  // The actual app icon (same raster as the favicon / icon-512.png), not a
  // redrawn glyph — a black rounded tile with the filed-tag mark.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brand-mark" src="/icon-192.png" alt="" aria-hidden="true" width={20} height={20} />;
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path
        d="M4 8h8M8.5 4.5 12 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MorgueLanding({ canSignIn }: { canSignIn: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;
    const dispose = initLanding(rootRef.current);
    return dispose;
  }, []);

  return (
    <div className="mland" ref={rootRef}>
      <nav id="nav">
        <a className="brand" href="#top">
          <BrandMark />
          morgue
        </a>
        <div className="nav-right">
          <a className="nav-link hide-sm" href="#features">
            Features
          </a>
          <a className="nav-link hide-sm" href="#bundle">
            For agents
          </a>
          <Link className="nav-link hide-sm" href="/docs">
            Docs
          </Link>
          {canSignIn ? (
            <Link className="nav-link hide-sm" href="/signin">
              Sign in
            </Link>
          ) : null}
          <a className="pill" data-mag href="#access">
            Request access
            <ArrowRight />
          </a>
        </div>
      </nav>

      {/* ── 1 · HERO + VIDEO ─────────────────────────────────────────────── */}
      <header className="hero" id="top">
        <canvas className="hero-bg" aria-hidden="true" />
        <div className="hero-bg-scrim" aria-hidden="true" />
        <div className="wrap">
          <div className="hero-content">
            <h1 className="display">
              <span className="l1 he">Build it once.</span>
              <span className="l2 he">Every agent reuses it.</span>
            </h1>
            <p className="hero-sub he">
              A private UI-component vault for <b>MCP-compatible coding agents</b>. Store a
              component once, and Claude Code, Cursor, or Codex pulls it back over MCP as a
              paste-ready bundle.
            </p>
            <p className="hero-point he">
              Your agent gets the licence, the dependencies, and the gotchas that break it. No
              repo to clone, no build to wire up.
            </p>
            <div className="hero-cta he">
              <form className="hero-form" id="heroSignup">
                <input
                  className="hero-email"
                  type="email"
                  required
                  placeholder="you@studio.com"
                  aria-label="Work email"
                />
                <button className="pill" type="submit">
                  Request access
                  <ArrowRight />
                </button>
              </form>
              <a className="pill ghost" href="#bundle">
                See it work
              </a>
            </div>
            <p className="hero-form-note he">morgue is in private beta. Be one of the first to use it.</p>
            <p className="hero-form-err" id="heroSignupErr" hidden />
            <div className="hero-form-done" id="heroSignupDone" hidden>
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8.5 6.5 12 13 4.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              You are on the early-access list. We will be in touch within two working days.
            </div>
          </div>

          {/* Video peeks below the fold, full on scroll. Slot stays empty until a
              real own/MIT recording exists. */}
          <div className="film he-film" id="film">
            <span className="film-badge">walkthrough</span>
            <div className="film-inner">
              <button className="film-play" data-mag aria-label="Play walkthrough">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M8 5v14l11-7z" fill="currentColor" />
                </svg>
              </button>
              <span className="film-note">walkthrough recording coming soon</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── 2 · MCP PROOF (prompt → call → bundle → result) ──────────────── */}
      <section id="bundle">
        <div className="wrap">
          <div className="sec-head reveal">
            <h2>
              Your agent pulls it over MCP. <span className="muted">Bundle and all.</span>
            </h2>
            <p>
              You ask in plain words. Your agent calls morgue, gets a self-contained bundle with
              its licence and dependencies, and pastes it into your project.
            </p>
          </div>

          <div className="seq reveal">
            <div className="seq-step">
              <span className="seq-label">you ask your agent</span>
              <div className="seq-prompt">
                <span className="caret">{"›"}</span>Add a pinned horizontal scroll section to
                the case study page.
              </div>
            </div>
            <span className="seq-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12h13M12 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="seq-step">
              <span className="seq-label">it calls morgue over MCP</span>
              <div className="seq-call">
                morgue.get(<span className="arg">&quot;pinned-horizontal&quot;</span>)
              </div>
            </div>
          </div>

          <div className="flow-down reveal" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4v13M6 11l6 6 6-6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="agent reveal">
            <div className="agent-col">
              <span className="seq-label">morgue returns the bundle</span>
              <div className="bundle-wrap">
                <div className="bundle-head">
                  <span>MCP response</span>
                  <span className="fn">pinned-horizontal.md</span>
                </div>
                <pre className="bundle" dangerouslySetInnerHTML={{ __html: BUNDLE_HTML }} />
              </div>
            </div>

            <span className="seq-arrow agent-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 12h13M12 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>

            <div className="agent-col">
              <span className="seq-label">you paste it, it runs</span>
              <div className="agent-live">
                <div className="al-stage">
                  <div className="mag-stage">
                    <div className="mag">grab</div>
                  </div>
                </div>
                <div className="al-foot">
                  <span className="m">pinned-horizontal · runs on your page</span>
                  <button className="copy-btn" data-mag id="copyBtn">
                    <svg viewBox="0 0 16 16" fill="none">
                      <rect x="4" y="4" width="9" height="9" rx="1.5" stroke="#000" strokeWidth="1.4" />
                      <path
                        d="M11 4V2.5A1.5 1.5 0 0 0 9.5 1h-6A1.5 1.5 0 0 0 2 2.5v6A1.5 1.5 0 0 0 3.5 10H4"
                        stroke="#000"
                        strokeWidth="1.4"
                      />
                    </svg>
                    Copy for agent
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3 · FEATURE BENTO ────────────────────────────────────────────── */}
      <section id="features">
        <div className="wrap">
          <div className="sec-head reveal">
            <h2>
              What the tool does <span className="muted">with what it holds.</span>
            </h2>
            <p>Store components, classify them so search works, and hand your agent a copy it can run.</p>
          </div>

          <div className="bento">
            <a className="card lead reveal" href="#bundle">
              <div className="b-bg">
                <div className="clip">
                  <div className="bpa-root">
                    <div className="bpa-term">
                      <div className="bpa-bar">
                        <span className="bpa-dot" />
                        <span className="bpa-dot" />
                        <span className="bpa-dot" />
                        <span className="bpa-barname">morgue</span>
                      </div>
                      <div className="bpa-body">
                        <div className="bpa-line">
                          <span className="bpa-prompt">$</span>
                          <span className="bpa-cmd" />
                          <span className="bpa-caret" />
                        </div>
                        <div className="bpa-out">
                          <span className="bpa-ar">{"▸"}</span> recording preview.mp4
                        </div>
                        <div className="bpa-out">
                          <span className="bpa-ar">{"▸"}</span> poster.webp {"·"} contact.jpg
                        </div>
                        <div className="bpa-out">
                          <span className="bpa-ar">{"▸"}</span> classified{" "}
                          <span className="bpa-em">pinned-horizontal</span>
                        </div>
                        <div className="bpa-tile">
                          <span className="bpa-thumb" />
                          <span className="bpa-meta">
                            <span className="bpa-tt">hero-parallax</span>
                            <span className="bpa-tag">captured</span>
                          </span>
                          <span className="bpa-check" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="b-scrim" />
              <div className="b-body">
                <span className="b-icon">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="b-name">Add your own components</div>
                <p className="b-desc">
                  Drop a component into the vault with the CLI. The CLI records it, classifies it, and
                  readies it to reuse.
                </p>
              </div>
              <span className="b-cta">
                Learn more <ArrowRight />
              </span>
            </a>

            <a className="card c2 reveal" href="#effects">
              <div className="b-bg">
                <div className="clip">
                  <div className="bps-root" data-active="effect">
                    <div className="bps-chips">
                      <span className="bps-chip" data-cat="effect">effect</span>
                      <span className="bps-chip" data-cat="technique">technique</span>
                      <span className="bps-chip" data-cat="trigger">trigger</span>
                    </div>
                    <div className="bps-grid">
                      <div className="bps-tile" data-cat="effect"><span className="bps-mark" /><span className="bps-name">marquee</span><span className="bps-facet">effect</span></div>
                      <div className="bps-tile" data-cat="technique"><span className="bps-mark" /><span className="bps-name">gsap</span><span className="bps-facet">technique</span></div>
                      <div className="bps-tile" data-cat="trigger"><span className="bps-mark" /><span className="bps-name">scroll</span><span className="bps-facet">trigger</span></div>
                      <div className="bps-tile" data-cat="trigger"><span className="bps-mark" /><span className="bps-name">hover</span><span className="bps-facet">trigger</span></div>
                      <div className="bps-tile" data-cat="effect"><span className="bps-mark" /><span className="bps-name">parallax</span><span className="bps-facet">effect</span></div>
                      <div className="bps-tile" data-cat="technique"><span className="bps-mark" /><span className="bps-name">webgl</span><span className="bps-facet">technique</span></div>
                      <div className="bps-tile" data-cat="technique"><span className="bps-mark" /><span className="bps-name">lenis</span><span className="bps-facet">technique</span></div>
                      <div className="bps-tile" data-cat="effect"><span className="bps-mark" /><span className="bps-name">mask</span><span className="bps-facet">effect</span></div>
                      <div className="bps-tile" data-cat="trigger"><span className="bps-mark" /><span className="bps-name">drag</span><span className="bps-facet">trigger</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="b-scrim" />
              <div className="b-body">
                <span className="b-icon">
                  <svg viewBox="0 0 24 24" fill="none">
                    <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="1.6" />
                    <path
                      d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                </span>
                <div className="b-name">Stored and searchable</div>
                <p className="b-desc">morgue tags every item by effect, technique, and trigger, so search finds it.</p>
              </div>
              <span className="b-cta">
                Learn more <ArrowRight />
              </span>
            </a>

            <a className="card c3 reveal" href="#bundle">
              <div className="b-bg">
                <div className="clip">
                  <div className="bpm-root">
                    <div className="bpm-card">
                      <div className="bpm-req">
                        <span className="bpm-arrow">{"→"}</span>
                        <span className="bpm-call">
                          <span className="bpm-req-text" />
                          <span className="bpm-caret" />
                        </span>
                      </div>
                      <div className="bpm-res">
                        <div className="bpm-line bpm-status">
                          <span className="bpm-dot" />200 {"·"} bundle
                        </div>
                        <div className="bpm-line"><span className="bpm-k">licence</span><span className="bpm-v">mit</span></div>
                        <div className="bpm-line"><span className="bpm-k">deps</span><span className="bpm-v">gsap ^3.13</span></div>
                        <div className="bpm-line"><span className="bpm-k">files</span><span className="bpm-v">index.html</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="b-scrim" />
              <div className="b-body">
                <span className="b-icon">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M9 7H6a4 4 0 0 0 0 8h3M15 17h3a4 4 0 0 0 0-8h-3M8 12h8"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div className="b-name">Pull over MCP</div>
                <p className="b-desc">Your agent calls the morgue MCP with its account and gets the component, ready to paste.</p>
              </div>
              <span className="b-cta">
                Learn more <ArrowRight />
              </span>
            </a>

            <a className="card reveal" href="#effects">
              <div className="b-bg">
                <div className="clip">
                  <div className="bpq-root">
                    <div className="bpq-field">
                      <svg className="bpq-mag" viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                        <line x1="10.6" y1="10.6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                      <span className="bpq-qwrap">
                        <span className="bpq-qtext" />
                        <span className="bpq-caret" />
                      </span>
                    </div>
                    <div className="bpq-results">
                      <div className="bpq-row" data-match="1" data-rel="0.96" data-above="0" data-mi="0">
                        <span className="bpq-name">Magnetic pull button</span>
                        <span className="bpq-track"><span className="bpq-fill" /></span>
                        <span className="bpq-pct">0%</span>
                      </div>
                      <div className="bpq-row" data-match="0">
                        <span className="bpq-name">Pinned horizontal scroll</span>
                        <span className="bpq-track"><span className="bpq-fill" /></span>
                        <span className="bpq-pct">0%</span>
                      </div>
                      <div className="bpq-row" data-match="1" data-rel="0.88" data-above="1" data-mi="1">
                        <span className="bpq-name">Hover magnet CTA</span>
                        <span className="bpq-track"><span className="bpq-fill" /></span>
                        <span className="bpq-pct">0%</span>
                      </div>
                      <div className="bpq-row" data-match="0">
                        <span className="bpq-name">Text scramble reveal</span>
                        <span className="bpq-track"><span className="bpq-fill" /></span>
                        <span className="bpq-pct">0%</span>
                      </div>
                      <div className="bpq-row" data-match="1" data-rel="0.71" data-above="2" data-mi="2">
                        <span className="bpq-name">Cursor attract link</span>
                        <span className="bpq-track"><span className="bpq-fill" /></span>
                        <span className="bpq-pct">0%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="b-scrim" />
              <div className="b-body">
                <span className="b-icon">
                  <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
                    <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="b-name">Search by meaning</div>
                <p className="b-desc">Describe the effect you want. The vault filters to the components that match.</p>
              </div>
              <span className="b-cta">
                Learn more <ArrowRight />
              </span>
            </a>

            <a className="card reveal" href="#bundle">
              <div className="b-bg">
                <div className="clip">
                  <div className="bpr-root">
                    <div className="bpr-window">
                      <div className="bpr-bar">
                        <span className="bpr-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="bpr-tag">no build · no deps</span>
                      </div>
                      <div className="bpr-stage">
                        <div className="bpr-grid" />
                        <div className="bpr-ghost" />
                        <div className="bpr-dot">
                          <span className="bpr-core" />
                          <span className="bpr-ring" />
                        </div>
                      </div>
                      <div className="bpr-foot">
                        <span className="bpr-run" />
                        standalone.js
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="b-scrim" />
              <div className="b-body">
                <span className="b-icon">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 3 20 7v10l-8 4-8-4V7l8-4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="m4 7 8 4 8-4M12 11v10" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="b-name">Runs standalone</div>
                <p className="b-desc">Each bundle is self-contained. No vendored copies, no build to untangle.</p>
              </div>
              <span className="b-cta">
                Learn more <ArrowRight />
              </span>
            </a>

            <a className="card reveal" href="#access">
              <div className="b-bg">
                <div className="clip">
                  <div className="bpl-root">
                    <div className="bpl-row" data-lic="own">
                      <div className="bpl-thumb" />
                      <div className="bpl-meta"><span className="bpl-l1" /><span className="bpl-l2" /></div>
                      <div className="bpl-badge"><span className="bpl-dot" /><span className="bpl-txt">OWN</span></div>
                    </div>
                    <div className="bpl-row" data-lic="mit">
                      <div className="bpl-thumb" />
                      <div className="bpl-meta"><span className="bpl-l1" /><span className="bpl-l2" /></div>
                      <div className="bpl-badge"><span className="bpl-dot" /><span className="bpl-txt">MIT</span></div>
                    </div>
                    <div className="bpl-row" data-lic="paid">
                      <div className="bpl-thumb" />
                      <div className="bpl-meta"><span className="bpl-l1" /><span className="bpl-l2" /></div>
                      <div className="bpl-badge"><span className="bpl-dot" /><span className="bpl-txt">PAID</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="b-scrim" />
              <div className="b-body">
                <span className="b-icon">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 3 5 6v5c0 4.4 2.9 8 7 9 4.1-1 7-4.6 7-9V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="b-name">Licence on every item</div>
                <p className="b-desc">morgue records own, MIT, or paid up front, so you know what you can ship.</p>
              </div>
              <span className="b-cta">
                Learn more <ArrowRight />
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* ── 4 · LIVE EFFECTS (auto-morphing loop) ────────────────────────── */}
      <section id="effects">
        <div className="wrap">
          <div className="sec-head reveal">
            <h2>
              The effects are real. <span className="muted">Every one runs live.</span>
            </h2>
            <p>
              This loop cross-fades through morgue&apos;s own components, own or MIT, naming each one
              as it runs on this page.
            </p>
          </div>
        </div>
        <div className="am-root">
          <canvas className="am-canvas" aria-hidden="true" />
          <div className="am-vignette" aria-hidden="true" />
          <div className="am-ui">
            <div className="am-uiw">
              <div className="am-cap">
                <span className="am-cap-eyebrow">morgue component {"·"} live</span>
                <span className="am-cap-name">Liquid metaballs</span>
                <code className="am-cap-chip">own · MIT</code>
              </div>
              <div className="am-dots" role="tablist" aria-label="Morphing effect timeline">
                <button className="am-dot" type="button" role="tab" aria-current="true" aria-label="Liquid metaballs">
                  <span className="am-dot-fill" />
                </button>
                <button className="am-dot" type="button" role="tab" aria-current="false" aria-label="Curl flow">
                  <span className="am-dot-fill" />
                </button>
                <button className="am-dot" type="button" role="tab" aria-current="false" aria-label="Torus knot">
                  <span className="am-dot-fill" />
                </button>
                <button className="am-dot" type="button" role="tab" aria-current="false" aria-label="Flow contours">
                  <span className="am-dot-fill" />
                </button>
                <button className="am-dot" type="button" role="tab" aria-current="false" aria-label="Type field">
                  <span className="am-dot-fill" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5 · SIGN-UP CTA ──────────────────────────────────────────────── */}
      <section className="cta" id="access">
        <div className="wrap">
          <h2>
            <span className="muted">Stop rebuilding</span>
            <br />
            the same component.
          </h2>
          <p className="cta-note">
            morgue is in private beta right now. Add your email to be one of the first to use it
            before the full launch. It is free during the beta.
          </p>
          <form className="signup" id="signup">
            <input type="email" required placeholder="you@studio.com" aria-label="Email address" />
            <button className="pill" type="submit">
              Request access
              <ArrowRight />
            </button>
          </form>
          <p className="signup-err" id="signupErr" hidden />
          <div className="signup-done" id="signupDone" hidden>
            <svg viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8.5 6.5 12 13 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            You are on the early-access list. We will be in touch within two working days.
          </div>
          <p className="cta-fine">
            Your components stay private to you. Every item carries its licence, so you know what you
            can ship.
          </p>
          <p className="cta-by">
            Maintained by{" "}
            <a href="https://github.com/Clupai8o0" target="_blank" rel="noopener noreferrer">
              @Clupai8o0
            </a>{" "}
            on GitHub.
          </p>
        </div>
      </section>

      {/* ── 6 · FOOTER ───────────────────────────────────────────────────── */}
      <footer id="docs">
        <div className="wrap">
          <div className="foot-top">
            <div className="foot-brand">
              <a className="brand" href="#top">
                <BrandMark />
                morgue
              </a>
              <p>
                A private component vault for MCP-compatible coding agents. Store a component once,
                pull it back over MCP anywhere.
              </p>
            </div>
            <div className="foot-cols">
              <div>
                <h3>Product</h3>
                <a href="#features">Features</a>
                <a href="#bundle">For agents</a>
                <a href="#effects">Live effects</a>
              </div>
              <div>
                <h3>Docs</h3>
                <Link href="/docs">Quickstart</Link>
                <Link href="/docs">CLI &amp; ingest</Link>
                <Link href="/docs">MCP tools</Link>
              </div>
              <div>
                <h3>Access</h3>
                <a href="#access">Request access</a>
              </div>
            </div>
          </div>
          <div className="foot-base">
            <span>© 2026 morgue</span>
            <span>Public content is own or MIT. Paid captures stay in the vault.</span>
            <span>Built from its own components.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
