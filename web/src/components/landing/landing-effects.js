/*
 * Landing-page motion, ported verbatim from the approved design mockup
 * (scratchpad/morgue-showreel.html). Deliberately plain JS, not TypeScript: it
 * is a large body of numeric canvas code (five effect scenes, six bento
 * previews, an aurora hero background) whose correctness lives in the maths, and
 * annotating every inner loop would add transcription risk for no runtime gain.
 * tsconfig has allowJs with checkJs off, so it ships as-is.
 *
 * The mockup ran this as a page-level IIFE. Here it is one exported
 * `initLanding(root)` that a `'use client'` component calls from useEffect and
 * whose return value tears everything down — every observer, rAF, timer and
 * listener — so React (including StrictMode's double-mount) leaves nothing
 * running. Everything is scoped to the passed-in `.mland` root; ids are unique
 * within it.
 *
 * The two access-request forms POST to the real /api/waitlist rather than the
 * mockup's fake success state.
 */

export function initLanding(root) {
  if (!root) return () => {};

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const cleanups = [];

  /* ── nav ──────────────────────────────────────────────────────────────── */
  (function initNav() {
    const nav = $("#nav");
    if (!nav) return;
    const onScroll = () => nav.toggleAttribute("data-scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener("scroll", onScroll));
  })();

  /* ── reveal ───────────────────────────────────────────────────────────── */
  (function initReveal() {
    const io = new IntersectionObserver(
      (es) => {
        const hits = es
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        hits.forEach((e, i) => {
          e.target.style.transitionDelay = Math.min(i, 6) * 70 + "ms";
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        });
      },
      { threshold: 0.12 },
    );
    $$(".reveal").forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());
  })();

  /* ── magnetic buttons + tiles ─────────────────────────────────────────── */
  (function initMagnetic() {
    if (REDUCED) return;
    $$("[data-mag]").forEach((el) => {
      const move = (e) => {
        const r = el.getBoundingClientRect();
        el.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * 0.4}px, ${(e.clientY - (r.top + r.height / 2)) * 0.4}px)`;
      };
      const leave = () => {
        el.style.transform = "";
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      cleanups.push(() => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      });
    });
    $$(".mag").forEach((t) => {
      const stage = t.parentElement;
      if (!stage) return;
      const move = (e) => {
        const r = stage.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2),
          dy = e.clientY - (r.top + r.height * 0.44);
        const pull = clamp(1 - Math.hypot(dx, dy) / (r.width * 0.55), 0, 1);
        t.style.transform = `translate(calc(-50% + ${dx * 0.42 * pull}px), calc(-50% + ${dy * 0.42 * pull}px)) scale(${1 + pull * 0.14})`;
      };
      const leave = () => {
        t.style.transform = "";
      };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerleave", leave);
      cleanups.push(() => {
        stage.removeEventListener("pointermove", move);
        stage.removeEventListener("pointerleave", leave);
      });
    });
  })();

  /* ── HERO BACKGROUND — slow flowing aurora in the spotlight palette ─────── */
  const HEROBG = function (canvas) {
    var raf = 0;
    var running = false;
    var t0 = 0;
    var lastDraw = -1e9;

    var ctx = canvas.getContext("2d");
    var off = document.createElement("canvas");
    var octx = off.getContext("2d");

    var BASE = "#090909"; // == --canvas
    var reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}

    var BLOBS = [
      { c: "#6a4cf5", ax: 0.86, ay: 0.15, dx: 0.10, dy: 0.08, wx: 0.070, wy: 0.052, px: 0.0, py: 1.3, r0: 0.66, rA: 0.07, wr: 0.045, pr: 0.4, a: 0.72 },
      { c: "#8b6cff", ax: 0.60, ay: 0.04, dx: 0.13, dy: 0.06, wx: 0.088, wy: 0.061, px: 2.1, py: 0.5, r0: 0.54, rA: 0.06, wr: 0.058, pr: 1.7, a: 0.58 },
      { c: "#d44df0", ax: 0.98, ay: 0.48, dx: 0.09, dy: 0.14, wx: 0.058, wy: 0.079, px: 1.1, py: 2.6, r0: 0.62, rA: 0.08, wr: 0.050, pr: 0.9, a: 0.70 },
      { c: "#ff5577", ax: 0.73, ay: 0.72, dx: 0.13, dy: 0.10, wx: 0.050, wy: 0.074, px: 3.0, py: 1.9, r0: 0.54, rA: 0.07, wr: 0.052, pr: 2.3, a: 0.64 },
      { c: "#ff7a3d", ax: 0.91, ay: 0.94, dx: 0.10, dy: 0.09, wx: 0.075, wy: 0.055, px: 0.7, py: 3.4, r0: 0.56, rA: 0.06, wr: 0.048, pr: 1.2, a: 0.62 },
      { c: "#6a4cf5", ax: 0.46, ay: 0.40, dx: 0.16, dy: 0.13, wx: 0.045, wy: 0.066, px: 4.2, py: 2.2, r0: 0.36, rA: 0.09, wr: 0.060, pr: 0.2, a: 0.36 }
    ];

    var lowW = 1, lowH = 1, lowDiag = 1;

    function hexRGB(h) {
      var n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    for (var i = 0; i < BLOBS.length; i++) { BLOBS[i].rgb = hexRGB(BLOBS[i].c); }

    function bclamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function resize() {
      var boxW = canvas.clientWidth;
      var boxH = canvas.clientHeight;
      if (!boxW || !boxH) { return; }

      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var w = Math.max(1, Math.round(boxW * dpr));
      var h = Math.max(1, Math.round(boxH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      lowH = bclamp(Math.round(boxH * 0.22), 90, 240);
      lowW = Math.max(1, Math.round(lowH * (boxW / boxH)));
      lowDiag = Math.hypot(lowW, lowH);
      if (off.width !== lowW || off.height !== lowH) {
        off.width = lowW;
        off.height = lowH;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (!running) { render(reduce ? 6.0 : 0); }
    }

    function render(tSec) {
      octx.globalCompositeOperation = "source-over";
      octx.fillStyle = BASE;
      octx.fillRect(0, 0, lowW, lowH);

      octx.globalCompositeOperation = "lighter";
      for (var i = 0; i < BLOBS.length; i++) {
        var b = BLOBS[i];
        var x = (b.ax + b.dx * Math.sin(tSec * b.wx + b.px)) * lowW;
        var y = (b.ay + b.dy * Math.cos(tSec * b.wy + b.py)) * lowH;
        var R = (b.r0 + b.rA * Math.sin(tSec * b.wr + b.pr)) * lowDiag;
        if (R < 1) { R = 1; }

        var r = b.rgb;
        var g = octx.createRadialGradient(x, y, 0, x, y, R);
        g.addColorStop(0.0, "rgba(" + r[0] + "," + r[1] + "," + r[2] + "," + b.a + ")");
        g.addColorStop(0.45, "rgba(" + r[0] + "," + r[1] + "," + r[2] + "," + (b.a * 0.35).toFixed(3) + ")");
        g.addColorStop(1.0, "rgba(" + r[0] + "," + r[1] + "," + r[2] + ",0)");
        octx.fillStyle = g;
        octx.fillRect(0, 0, lowW, lowH);
      }
      octx.globalCompositeOperation = "source-over";

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, lowW, lowH, 0, 0, canvas.width, canvas.height);
    }

    function frame(now) {
      if (!running) { return; }
      if (now - lastDraw >= 24) {
        lastDraw = now;
        render((now - t0) / 1000);
      }
      raf = requestAnimationFrame(frame);
    }

    var ro = null;

    function start() {
      resize();

      if (!ro && "ResizeObserver" in window) {
        ro = new ResizeObserver(resize);
        ro.observe(canvas);
      }

      if (reduce) {
        render(6.0);
        return;
      }
      if (running) { return; }
      running = true;
      t0 = performance.now();
      lastDraw = -1e9;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (ro) { ro.disconnect(); ro = null; }
    }

    return { start: start, stop: stop };
  };

  (function initHeroBg() {
    var heroEl = root.querySelector("header.hero");
    var heroCanvas = heroEl && heroEl.querySelector(".hero-bg");
    if (!heroEl || !heroCanvas) { return; }
    var hb = HEROBG(heroCanvas);
    hb.start();
    var hio = null;
    if ("IntersectionObserver" in window) {
      hio = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { hb.start(); } else { hb.stop(); } });
      }, { threshold: 0 });
      hio.observe(heroEl);
    }
    cleanups.push(function () {
      try { hb.stop(); } catch (e) {}
      if (hio) { try { hio.disconnect(); } catch (e) {} }
    });
  })();

  /* ── hero entrance: staggered reveal on load ──────────────────────────── */
  (function initHeroEnter() {
    var order = [".hero-content .l1", ".hero-content .l2", ".hero-sub", ".hero-point", ".hero-cta", ".hero-form-note", "#film"];
    var els = order.map(function (s) { return root.querySelector(s); }).filter(Boolean);
    if (REDUCED) { els.forEach(function (el) { el.classList.add("he-in"); }); return; }
    var timers = [];
    els.forEach(function (el, i) {
      timers.push(setTimeout(function () { el.classList.add("he-in"); }, 120 + i * 90));
    });
    cleanups.push(function () { timers.forEach(clearTimeout); });
  })();

  /* ── auto-morphing effect scenes (data-driven factories) ──────────────── */
  var SCENES = {};

  SCENES["metaballs"] = function () {
    var W = 0, H = 0;
    var step = 5, fieldW = 0, fieldH = 0;
    var fieldCanvas = null, fieldCtx = null, imgData = null, data = null;
    var blobs = [];

    var VR = 106, VG = 76, VB = 245;
    var MR = 212, MG = 77, MB = 240;

    function mulberry32(seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function smooth(e0, e1, x) {
      var t = (x - e0) / (e1 - e0);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      return t * t * (3 - 2 * t);
    }

    function build() {
      var minD = Math.min(W, H);
      step = Math.max(4, Math.round(minD / 160));
      fieldW = Math.max(2, Math.ceil(W / step));
      fieldH = Math.max(2, Math.ceil(H / step));
      while (fieldW * fieldH > 72000) {
        step += 1;
        fieldW = Math.max(2, Math.ceil(W / step));
        fieldH = Math.max(2, Math.ceil(H / step));
      }
      fieldCanvas = (typeof document !== "undefined") ? document.createElement("canvas") : null;
      if (fieldCanvas) {
        fieldCanvas.width = fieldW;
        fieldCanvas.height = fieldH;
        fieldCtx = fieldCanvas.getContext("2d");
        imgData = fieldCtx.createImageData(fieldW, fieldH);
        data = imgData.data;
      }

      var rng = mulberry32(0x9e3779b1);
      var n = 8;
      blobs = [];
      for (var k = 0; k < n; k++) {
        var anchor = (k === 0);
        blobs.push({
          Ax: (anchor ? 0.05 : 0.13 + 0.15 * rng()) * W,
          Bx: (anchor ? 0.03 : 0.04 + 0.08 * rng()) * W,
          Ay: (anchor ? 0.05 : 0.12 + 0.14 * rng()) * H,
          By: (anchor ? 0.03 : 0.04 + 0.08 * rng()) * H,
          sx: (anchor ? 0.03 : 0.05 + 0.15 * rng()) * (rng() < 0.5 ? -1 : 1),
          sx2: (anchor ? 0.02 : 0.03 + 0.11 * rng()) * (rng() < 0.5 ? -1 : 1),
          sy: (anchor ? 0.03 : 0.05 + 0.15 * rng()) * (rng() < 0.5 ? -1 : 1),
          sy2: (anchor ? 0.02 : 0.03 + 0.11 * rng()) * (rng() < 0.5 ? -1 : 1),
          px: rng() * 6.283, px2: rng() * 6.283,
          py: rng() * 6.283, py2: rng() * 6.283,
          R: (anchor ? 0.20 : 0.10 + 0.07 * rng()) * minD,
          rw: 0.10 + 0.30 * rng(), rp: rng() * 6.283, ramp: 0.12 + 0.20 * rng()
        });
      }
    }

    return {
      name: "Liquid metaballs",
      resize: function (w, h) { W = w; H = h; build(); },
      frame: function (ctx, t, dt, a) {
        if (a <= 0 || !fieldCanvas) return;

        var cx = W * 0.5, cy = H * 0.5;
        var invStep = 1 / step;
        var nb = blobs.length;

        var bx = new Float32Array(nb), by = new Float32Array(nb), brf2 = new Float32Array(nb);
        for (var k = 0; k < nb; k++) {
          var b = blobs[k];
          var x = cx + b.Ax * Math.sin(t * b.sx + b.px) + b.Bx * Math.sin(t * b.sx2 + b.px2);
          var y = cy + b.Ay * Math.cos(t * b.sy + b.py) + b.By * Math.sin(t * b.sy2 + b.py2);
          var R = b.R * (1 + b.ramp * Math.sin(t * b.rw + b.rp));
          bx[k] = x * invStep;
          by[k] = y * invStep;
          var rf = R * invStep;
          brf2[k] = rf * rf;
        }

        var lx = (cx + 0.30 * W * Math.sin(t * 0.19)) * invStep;
        var ly = (cy + 0.30 * H * Math.cos(t * 0.13)) * invStep;
        var specK = 0.010;

        var fw = fieldW, fh = fieldH, d = data;
        var i = 0;
        for (var fy = 0; fy < fh; fy++) {
          var lightY = 1 - (fy / fh) * 0.40;
          for (var fx = 0; fx < fw; fx++) {
            var f = 0;
            for (var m = 0; m < nb; m++) {
              var dx = fx - bx[m], dy = fy - by[m];
              f += brf2[m] / (dx * dx + dy * dy + 0.6);
            }

            var body = smooth(0.85, 1.15, f);
            if (body <= 0.003) { d[i + 3] = 0; i += 4; continue; }

            var core = smooth(1.10, 2.60, f);
            var base = (0.10 + 0.85 * core) * lightY;
            var R = base, G = base, B = base * 1.02 + 0.02;

            var rim = body * (1 - core);
            rim = rim * rim;
            var sh = 0.60 + 0.40 * Math.sin(fx * 0.15 + fy * 0.12 + t * 0.8);
            var hb = (sh - 0.2) * 1.25;
            var HR = VR + (MR - VR) * hb;
            var HG = VG + (MG - VG) * hb;
            var HB = VB + (MB - VB) * hb;
            var rg = rim * (0.0052 + 0.0016 * sh);
            R += HR * rg; G += HG * rg; B += HB * rg;

            var ldx = fx - lx, ldy = fy - ly;
            var spec = (1 / (1 + (ldx * ldx + ldy * ldy) * specK)) * rim * 0.9;
            R += spec; G += spec * 0.85; B += spec * 0.66;

            if (R > 1) R = 1; if (G > 1) G = 1; if (B > 1) B = 1;
            d[i] = R * 255; d[i + 1] = G * 255; d[i + 2] = B * 255; d[i + 3] = body * 255;
            i += 4;
          }
        }
        fieldCtx.putImageData(imgData, 0, 0);

        ctx.save();
        ctx.globalAlpha = a;
        ctx.imageSmoothingEnabled = true;

        ctx.globalCompositeOperation = "lighter";
        var gx = cx + 0.12 * W * Math.sin(t * 0.11);
        var gy = cy + 0.12 * H * Math.cos(t * 0.09);
        var gr = Math.max(W, H) * 0.72;
        var grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        grd.addColorStop(0, "rgba(139,108,255,0.13)");
        grd.addColorStop(0.5, "rgba(212,77,240,0.05)");
        grd.addColorStop(1, "rgba(255,122,61,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);

        ctx.globalCompositeOperation = "source-over";
        ctx.shadowColor = "rgba(168,84,240,0.6)";
        ctx.shadowBlur = Math.min(W, H) * 0.05;
        ctx.drawImage(fieldCanvas, 0, 0, fieldW, fieldH, 0, 0, W, H);
        ctx.shadowBlur = 0;
        ctx.shadowColor = "rgba(0,0,0,0)";
        ctx.drawImage(fieldCanvas, 0, 0, fieldW, fieldH, 0, 0, W, H);

        ctx.restore();
      }
    };
  };

  SCENES["curlflow"] = function () {
    let W = 0, H = 0;
    let ps = [];
    let n = 0;

    function rnd() { return Math.random(); }

    function spawn(p, init) {
      p.x = rnd() * W;
      p.y = rnd() * H;
      p.z = 0.12 + rnd() * 0.88;
      p.life = init ? rnd() * 6 : 0;
      p.max = 3.5 + rnd() * 5.5;
      return p;
    }

    function build() {
      n = Math.max(600, Math.min(1600, Math.floor((W * H) / 950)));
      ps = new Array(n);
      for (let i = 0; i < n; i++) {
        ps[i] = spawn({}, true);
      }
    }

    function pot(x, y, t) {
      const s = 0.0026;
      const X = x * s, Y = y * s;
      return Math.sin(X * 1.0 + t * 0.15 + Math.cos(Y * 0.7)) * 1.1
        + Math.sin(Y * 1.3 - t * 0.12 + Math.cos(X * 0.9)) * 0.9
        + Math.sin((X + Y) * 0.8 + t * 0.10) * 0.7
        + Math.sin((X - Y) * 1.6 - t * 0.18) * 0.4;
    }

    return {
      name: "Curl flow",
      resize: function (w, h) { W = w; H = h; build(); },
      frame: function (ctx, t, dt, a) {
        if (a <= 0 || W <= 0) { return; }
        const step = dt > 0.05 ? 0.05 : dt;
        const e = 1.5;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a;
        ctx.lineCap = "round";

        for (let i = 0; i < n; i++) {
          const p = ps[i];
          p.life += step;
          if (p.life >= p.max) { spawn(p, false); }

          let gx = (pot(p.x, p.y + e, t) - pot(p.x, p.y - e, t)) * 400;
          let gy = -(pot(p.x + e, p.y, t) - pot(p.x - e, p.y, t)) * 400;
          let m = Math.hypot(gx, gy);
          if (m < 1e-4) { m = 1e-4; }
          const dx = gx / m, dy = gy / m;
          const mn = m > 6 ? 1 : m / 6;

          const speed = (30 + 90 * p.z) * (0.5 + 0.9 * mn);
          p.x += dx * speed * step;
          p.y += dy * speed * step;

          if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) {
            spawn(p, false);
            continue;
          }

          let fade = 1;
          if (p.life < 0.5) { fade = p.life / 0.5; }
          else if (p.life > p.max - 0.8) { fade = (p.max - p.life) / 0.8; }
          if (fade < 0) { fade = 0; }

          const L = (3 + 10 * p.z) * (0.5 + 1.3 * mn);
          const bx = p.x - dx * L, by = p.y - dy * L;
          const base = (0.10 + 0.5 * p.z) * fade;
          const sp = mn * mn;

          const hf = p.z * (0.55 + 0.8 * sp) + 0.12 * sp;
          let hr, hg, hb;
          if (hf < 0.5) { const u = hf * 2; hr = 139 + 73 * u; hg = 108 - 31 * u; hb = 255 - 15 * u; }
          else { const u = (hf - 0.5) * 2 > 1 ? 1 : (hf - 0.5) * 2; hr = 212 + 43 * u; hg = 77 + 13 * u; hb = 240 - 120 * u; }

          ctx.strokeStyle = "rgba(" + (hr | 0) + "," + (hg | 0) + "," + (hb | 0) + "," + (base * 0.5) + ")";
          ctx.lineWidth = (0.8 + 2.4 * p.z) * (1 + sp);
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();

          const cr = (hr * 0.3 + 255 * 0.7) | 0;
          const cg = (hg * 0.3 + 240 * 0.7) | 0;
          const cb = (hb * 0.3 + 250 * 0.7) | 0;
          ctx.strokeStyle = "rgba(" + cr + "," + cg + "," + cb + "," + (base * 0.95) + ")";
          ctx.lineWidth = 0.4 + 1.1 * p.z;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }

        ctx.restore();
      }
    };
  };

  SCENES["knot"] = function () {
    var W = 0, H = 0;

    var SSEG = 200;
    var K = 5;
    var P = 3, Q = 5;
    var TUBER = 0.42;
    var RINGSTEP = 5;
    var N = SSEG * K;

    var bx = new Float32Array(N), by = new Float32Array(N), bz = new Float32Array(N);
    var px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N), pp = new Float32Array(N);
    var order = new Array(N);
    for (var oi = 0; oi < N; oi++) { order[oi] = oi; }

    function build() {
      var ccx = new Float64Array(SSEG), ccy = new Float64Array(SSEG), ccz = new Float64Array(SSEG);
      for (var s = 0; s < SSEG; s++) {
        var th = s / SSEG * Math.PI * 2;
        var rr = 2 + Math.cos(Q * th);
        ccx[s] = rr * Math.cos(P * th);
        ccy[s] = rr * Math.sin(P * th);
        ccz[s] = Math.sin(Q * th);
      }
      var maxR = 1e-6;
      for (var i = 0; i < SSEG; i++) {
        var a = (i + 1) % SSEG, b = (i - 1 + SSEG) % SSEG;
        var tx = ccx[a] - ccx[b], ty = ccy[a] - ccy[b], tz = ccz[a] - ccz[b];
        var tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        var nx = ty, ny = -tx, nz = 0;
        var nl = Math.hypot(nx, ny, nz);
        if (nl < 1e-4) { nx = -tz; ny = 0; nz = tx; nl = Math.hypot(nx, ny, nz) || 1; }
        nx /= nl; ny /= nl; nz /= nl;
        var bx3 = ty * nz - tz * ny, by3 = tz * nx - tx * nz, bz3 = tx * ny - ty * nx;
        var bl = Math.hypot(bx3, by3, bz3) || 1; bx3 /= bl; by3 /= bl; bz3 /= bl;
        for (var k = 0; k < K; k++) {
          var ang = k / K * Math.PI * 2;
          var ca = Math.cos(ang), sa = Math.sin(ang);
          var vx = ccx[i] + TUBER * (ca * nx + sa * bx3);
          var vy = ccy[i] + TUBER * (ca * ny + sa * by3);
          var vz = ccz[i] + TUBER * (ca * nz + sa * bz3);
          var idx = i * K + k;
          bx[idx] = vx; by[idx] = vy; bz[idx] = vz;
          var r = Math.hypot(vx, vy, vz);
          if (r > maxR) { maxR = r; }
        }
      }
      var inv = 1 / maxR;
      for (var m = 0; m < N; m++) { bx[m] *= inv; by[m] *= inv; bz[m] *= inv; }
    }
    build();

    return {
      name: "Torus knot",
      resize: function (w, h) { W = w; H = h; },
      frame: function (ctx, t, dt, a) {
        if (a <= 0 || W === 0) { return; }
        var cx = W / 2, cy = H / 2;
        var S = Math.min(W, H) * 0.36 * (1 + 0.02 * Math.sin(t * 0.6));
        var ay = t * 0.35;
        var ax = t * 0.22 + 0.5 * Math.sin(t * 0.1);
        var cY = Math.cos(ay), sY = Math.sin(ay), cX = Math.cos(ax), sX = Math.sin(ax);

        for (var i = 0; i < N; i++) {
          var x = bx[i], y = by[i], z = bz[i];
          var x1 = x * cY + z * sY, z1 = -x * sY + z * cY, y1 = y;
          var y2 = y1 * cX - z1 * sX, z2 = y1 * sX + z1 * cX, x2 = x1;
          var persp = 2.2 / (2.2 - z2);
          px[i] = cx + x2 * S * persp;
          py[i] = cy + y2 * S * persp;
          pz[i] = z2;
          pp[i] = persp;
        }

        ctx.save();

        var rad = Math.min(W, H) * 0.46;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, "rgba(150,130,255," + (0.12 * a) + ")");
        g.addColorStop(0.4, "rgba(212,77,240," + (0.05 * a) + ")");
        g.addColorStop(1, "rgba(255,122,61,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(210,210,214," + (0.06 * a) + ")";
        for (var k = 0; k < K; k++) {
          ctx.beginPath();
          for (var s = 0; s < SSEG; s++) {
            var id = s * K + k;
            if (s === 0) { ctx.moveTo(px[id], py[id]); }
            else { ctx.lineTo(px[id], py[id]); }
          }
          ctx.closePath();
          ctx.stroke();
        }

        ctx.strokeStyle = "rgba(188,188,194," + (0.04 * a) + ")";
        ctx.beginPath();
        for (var rs = 0; rs < SSEG; rs += RINGSTEP) {
          for (var rk = 0; rk < K; rk++) {
            var rid = rs * K + rk;
            if (rk === 0) { ctx.moveTo(px[rid], py[rid]); }
            else { ctx.lineTo(px[rid], py[rid]); }
          }
          var closeId = rs * K;
          ctx.lineTo(px[closeId], py[closeId]);
        }
        ctx.stroke();

        order.sort(function (iA, iB) { return pz[iA] - pz[iB]; });
        ctx.globalCompositeOperation = "lighter";
        var pMin = 0.688, pRange = 1.142;
        for (var q = 0; q < N; q++) {
          var pi = order[q];
          var d = (pp[pi] - pMin) / pRange;
          if (d < 0) { d = 0; } else if (d > 1) { d = 1; }
          var bb = 0.12 + 0.88 * Math.pow(d, 1.4);
          var size = 0.8 + 2.2 * d;
          var xx = px[pi], yy = py[pi];
          var hr, hg, hb;
          if (d < 0.5) { var u = d * 2; hr = 130 + 82 * u; hg = 110 - 33 * u; hb = 250 - 10 * u; }
          else { var u2 = (d - 0.5) * 2; hr = 212 + 43 * u2; hg = 77 + 20 * u2; hb = 240 - 120 * u2; }
          ctx.globalAlpha = a * bb * 0.46;
          ctx.fillStyle = "rgb(" + (hr | 0) + "," + (hg | 0) + "," + (hb | 0) + ")";
          ctx.beginPath();
          ctx.arc(xx, yy, size * 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = a * bb * 0.95;
          var cl = 0.45 + 0.5 * d;
          ctx.fillStyle = "rgb(" + ((hr + (255 - hr) * cl) | 0) + "," + ((hg + (255 - hg) * cl) | 0) + "," + ((hb + (255 - hb) * cl) | 0) + ")";
          ctx.beginPath();
          ctx.arc(xx, yy, size, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    };
  };

  SCENES["contours"] = function () {
    let W = 0, H = 0;
    let cols = 0, rows = 0, cw = 0, ch = 0;
    let vals = null;

    const LEVELS = 22;
    const CREST = 4;
    const minL = -2.1, maxL = 2.1;

    const CASES = [
      [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
      [2, 3], [2, 0], [0, 1, 2, 3], [2, 1], [1, 3], [1, 0], [0, 3], []
    ];

    let _px = 0, _py = 0;
    function ep(edge, x, y, va, vb, vc, vd, L) {
      let tt;
      if (edge === 0) { tt = (L - va) / (vb - va); _px = x + tt * cw; _py = y; }
      else if (edge === 1) { tt = (L - vb) / (vc - vb); _px = x + cw; _py = y + tt * ch; }
      else if (edge === 2) { tt = (L - vc) / (vd - vc); _px = x + cw - tt * cw; _py = y + ch; }
      else { tt = (L - vd) / (va - vd); _px = x; _py = y + ch - tt * ch; }
    }

    function field(x, y, t) {
      const s = 0.0095;
      const X = (x + t * 4) * s;
      const Y = (y + t * 10) * s;
      const wx = Math.sin(X * 1.7 - t * 0.30) + Math.cos(Y * 1.3 + t * 0.24);
      const wy = Math.cos(X * 1.1 + t * 0.21) + Math.sin(Y * 1.9 - t * 0.17);
      return Math.sin(X * 1.6 + wx * 1.2 + t * 0.20)
        + 0.7 * Math.sin(Y * 1.4 + wy * 1.1 - t * 0.15)
        + 0.5 * Math.sin((X + Y) * 1.05 + (wx - wy) * 0.8 + t * 0.12)
        + 0.35 * Math.sin((X - Y) * 2.0 - (wx + wy) * 0.6);
    }

    function tint(u) {
      var r, g, b;
      if (u < 0.34) { var k = u / 0.34; r = 106 + 106 * k; g = 76 + 1 * k; b = 245 - 5 * k; }
      else if (u < 0.67) { var k2 = (u - 0.34) / 0.33; r = 212 + 43 * k2; g = 77 + 8 * k2; b = 240 - 121 * k2; }
      else { var k3 = (u - 0.67) / 0.33; r = 255; g = 85 + 37 * k3; b = 119 - 58 * k3; }
      return (r | 0) + "," + (g | 0) + "," + (b | 0);
    }

    return {
      name: "Flow contours",
      resize: function (w, h) {
        W = w; H = h;
        const step = 15;
        cols = Math.max(8, Math.round(W / step));
        rows = Math.max(6, Math.round(H / step));
        cw = W / cols;
        ch = H / rows;
        vals = new Float32Array((cols + 1) * (rows + 1));
      },
      frame: function (ctx, t, dt, a) {
        if (a <= 0 || !vals || W <= 0 || H <= 0) return;

        const roww = cols + 1;
        for (let j = 0; j <= rows; j++) {
          const y = j * ch;
          const base = j * roww;
          for (let i = 0; i <= cols; i++) {
            vals[base + i] = field(i * cw, y, t);
          }
        }

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.72);
        g.addColorStop(0, "rgba(255,122,61," + (0.06 * a) + ")");
        g.addColorStop(0.4, "rgba(212,77,240," + (0.035 * a) + ")");
        g.addColorStop(0.7, "rgba(106,76,245," + (0.02 * a) + ")");
        g.addColorStop(1, "rgba(106,76,245,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = "source-over";

        const span = (maxL - minL) / LEVELS;

        for (let li = 0; li < LEVELS; li++) {
          const L = minL + (li + 0.5) * span;
          const depthT = li / (LEVELS - 1);
          const crest = li >= LEVELS - CREST;

          const path = new Path2D();
          for (let j = 0; j < rows; j++) {
            const y = j * ch;
            const r1 = j * roww;
            const r2 = (j + 1) * roww;
            for (let i = 0; i < cols; i++) {
              const va = vals[r1 + i], vb = vals[r1 + i + 1];
              const vc = vals[r2 + i + 1], vd = vals[r2 + i];
              let c = 0;
              if (va > L) c |= 1;
              if (vb > L) c |= 2;
              if (vc > L) c |= 4;
              if (vd > L) c |= 8;
              if (c === 0 || c === 15) continue;
              const x = i * cw;
              const segs = CASES[c];
              for (let s = 0; s < segs.length; s += 2) {
                ep(segs[s], x, y, va, vb, vc, vd, L);
                const x1 = _px, y1 = _py;
                ep(segs[s + 1], x, y, va, vb, vc, vd, L);
                path.moveTo(x1, y1);
                path.lineTo(_px, _py);
              }
            }
          }

          const col = tint(depthT);
          if (crest) {
            const cr = (li - (LEVELS - CREST)) / (CREST - 1 || 1);
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = "rgb(" + col + ")";
            ctx.lineWidth = 2.6 + 2.4 * cr;
            ctx.globalAlpha = a * (0.16 + 0.14 * cr);
            ctx.stroke(path);
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = "rgb(255," + ((170 + 40 * cr) | 0) + "," + ((150 + 40 * cr) | 0) + ")";
            ctx.lineWidth = 1.0 + 0.4 * cr;
            ctx.globalAlpha = a * (0.85 + 0.15 * cr);
            ctx.stroke(path);
          } else {
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = "rgb(" + col + ")";
            ctx.lineWidth = 0.55 + 0.7 * depthT;
            ctx.globalAlpha = a * (0.14 + 0.40 * depthT);
            ctx.stroke(path);
            ctx.globalCompositeOperation = "source-over";
          }
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    };
  };

  SCENES["typefield"] = function () {
    var W = 0, H = 0;
    var pts = [];
    var box = { cx: 0, cy: 0, r: 1 };
    var off = null, octx = null;
    var CYCLE = 10.0;
    var HUE = [106, 76, 245];
    var MAXP = 2400;
    var TAU = Math.PI * 2;

    function smooth(a, b, x) {
      x = (x - a) / (b - a);
      if (x < 0) { x = 0; }
      if (x > 1) { x = 1; }
      return x * x * (3 - 2 * x);
    }

    function build() {
      pts = [];
      if (W <= 0 || H <= 0) { return; }

      if (!off) {
        off = document.createElement("canvas");
        octx = off.getContext("2d");
      }
      off.width = W;
      off.height = H;

      var word = "reuse";
      var g = octx;
      g.clearRect(0, 0, W, H);
      g.fillStyle = "#fff";
      g.textAlign = "center";
      g.textBaseline = "middle";
      var size = Math.min(H * 0.5, W * 0.34);
      g.font = '800 ' + size + 'px "Helvetica Neue", Arial, sans-serif';
      var wMeasured = g.measureText(word).width;
      var maxW = W * 0.82;
      if (wMeasured > 0 && wMeasured > maxW) {
        size = size * (maxW / wMeasured);
        g.font = '800 ' + size + 'px "Helvetica Neue", Arial, sans-serif';
      }
      g.fillText(word, W / 2, H / 2);

      var img;
      try {
        img = g.getImageData(0, 0, W, H).data;
      } catch (e) {
        return;
      }

      var step = 4;
      var raw = [];
      var minX = W, minY = H, maxX = 0, maxY = 0;
      for (var y = 0; y < H; y += step) {
        for (var x = 0; x < W; x += step) {
          var alpha = img[(y * W + x) * 4 + 3];
          if (alpha > 130) {
            raw.push(x, y);
            if (x < minX) { minX = x; }
            if (x > maxX) { maxX = x; }
            if (y < minY) { minY = y; }
            if (y > maxY) { maxY = y; }
          }
        }
      }

      var total = raw.length / 2;
      if (total === 0) { return; }

      box.cx = (minX + maxX) / 2;
      box.cy = (minY + maxY) / 2;
      box.r = Math.max(1, Math.hypot(maxX - minX, maxY - minY) / 2);

      var keep = Math.min(MAXP, total);
      var stride = total / keep;
      var maxR = Math.hypot(W, H) * 0.62;
      for (var i = 0; i < keep; i++) {
        var idx = Math.floor(i * stride) * 2;
        var tx = raw[idx];
        var ty = raw[idx + 1];
        var z = Math.random();
        var ang = Math.random() * TAU;
        var rr = maxR * (0.22 + Math.pow(Math.random(), 0.7) * 0.95);
        var hu = (tx - box.cx) / (box.r * 2) + 0.5;
        if (hu < 0) { hu = 0; } else if (hu > 1) { hu = 1; }
        var hr2, hg2, hb2;
        if (hu < 0.5) { var uu = hu * 2; hr2 = 139 + 73 * uu; hg2 = 108 - 31 * uu; hb2 = 255 - 15 * uu; }
        else { var uu2 = (hu - 0.5) * 2; hr2 = 212 + 43 * uu2; hg2 = 77 + 8 * uu2; hb2 = 240 - 121 * uu2; }
        pts.push({
          tx: tx, ty: ty,
          ox: Math.cos(ang) * rr,
          oy: Math.sin(ang) * rr,
          z: z,
          r: 0.55 + z * 1.5,
          delay: Math.random(),
          ph: Math.random() * TAU,
          spin: 0.045 * (0.5 + z),
          cr: hr2 | 0, cg: hg2 | 0, cb: hb2 | 0
        });
      }
    }

    return {
      name: "Type field",
      resize: function (w, h) {
        W = w; H = h;
        build();
      },
      frame: function (ctx, t, dt, a) {
        if (a <= 0 || pts.length === 0) { return; }

        var tt = t % CYCLE;
        var asmG = smooth(0.6, 3.6, tt);
        var scatG = smooth(6.0, 8.2, tt);
        var formed = asmG * (1 - scatG);
        var cx = W / 2, cy = H / 2;
        var maxDim = Math.max(W, 1);

        ctx.save();

        if (formed > 0.01) {
          ctx.globalCompositeOperation = "lighter";
          var gr = box.r * 1.5;
          var grad = ctx.createRadialGradient(box.cx, box.cy, 0, box.cx, box.cy, gr);
          grad.addColorStop(0, "rgba(212,77,240," + (0.17 * formed * a) + ")");
          grad.addColorStop(0.5, "rgba(255,85,119," + (0.06 * formed * a) + ")");
          grad.addColorStop(1, "rgba(255,122,61,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(box.cx - gr, box.cy - gr, gr * 2, gr * 2);

          var wr = box.r * 0.95;
          var wg = ctx.createRadialGradient(box.cx, box.cy, 0, box.cx, box.cy, wr);
          wg.addColorStop(0, "rgba(255,255,255," + (0.06 * formed * a) + ")");
          wg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = wg;
          ctx.fillRect(box.cx - wr, box.cy - wr, wr * 2, wr * 2);
        }

        var n = pts.length;
        var i, p, asm, e, A, sx, sy, px, py, ca, sa;

        ctx.globalCompositeOperation = "lighter";
        for (i = 0; i < n; i++) {
          p = pts[i];
          var aIn = smooth(0.6 + p.delay * 1.2, 2.2 + p.delay * 1.2, tt);
          var aOut = smooth(6.0 + p.delay * 1.1, 7.4 + p.delay * 1.1, tt);
          asm = aIn * (1 - aOut);
          if (asm <= 0.14) { continue; }
          e = asm;
          A = t * p.spin;
          ca = Math.cos(A); sa = Math.sin(A);
          sx = cx + p.ox * ca - p.oy * sa;
          sy = cy + p.ox * sa + p.oy * ca;
          px = sx + (p.tx - sx) * e;
          py = sy + (p.ty - sy) * e;
          var ga = 0.085 * e * (0.4 + p.z) * a;
          ctx.fillStyle = "rgba(" + p.cr + "," + p.cg + "," + p.cb + "," + ga + ")";
          ctx.beginPath();
          ctx.arc(px, py, p.r * 2.6, 0, TAU);
          ctx.fill();
        }

        ctx.globalCompositeOperation = "source-over";
        for (i = 0; i < n; i++) {
          p = pts[i];
          var bIn = smooth(0.6 + p.delay * 1.2, 2.2 + p.delay * 1.2, tt);
          var bOut = smooth(6.0 + p.delay * 1.1, 7.4 + p.delay * 1.1, tt);
          asm = bIn * (1 - bOut);
          e = asm;
          A = t * p.spin;
          ca = Math.cos(A); sa = Math.sin(A);
          sx = cx + p.ox * ca - p.oy * sa;
          sy = cy + p.ox * sa + p.oy * ca;
          px = sx + (p.tx - sx) * e;
          py = sy + (p.ty - sy) * e;
          px += Math.sin(t * 1.3 + p.ph) * 0.6 * e;
          py += Math.cos(t * 1.1 + p.ph * 1.3) * 0.6 * e;

          var baseA = 0.45 + p.z * 0.55;
          var mult = 0.26 + 0.74 * e;
          var sheen = 0.72 + 0.28 * Math.sin((p.tx / maxDim) * 8 - t * 1.7);
          var sheenMult = (1 - e) + e * sheen;
          var alpha = a * baseA * mult * sheenMult;
          if (alpha <= 0.004) { continue; }
          if (alpha > 1) { alpha = 1; }

          ctx.fillStyle = "rgba(" + ((p.cr * 0.18 + 255 * 0.82) | 0) + "," + ((p.cg * 0.18 + 245 * 0.82) | 0) + "," + ((p.cb * 0.18 + 250 * 0.82) | 0) + "," + alpha + ")";
          ctx.beginPath();
          ctx.arc(px, py, p.r, 0, TAU);
          ctx.fill();
        }

        ctx.restore();
      }
    };
  };

  /* ── live effects: auto-morphing loop, IntersectionObserver-gated ─────── */
  (function initEffects() {
    const section = root.querySelector("#effects");
    if (!section) { return; }
    if (!section.querySelector(".am-root")) { return; }

    let raf = 0; const on = [];
    let ctx, canvas, secRoot, w = 0, h = 0, dpr = 1, ro = null;
    let cur = 0, next = -1, phase = "hold", holdT = 0, transT = 0, elapsed = 0, last = 0, lastCap = -1, reduced = false;
    let capName, capChip, dots = [];
    const HOLD = 4.6, TRANS = 1.4;
    const SCENE_ORDER = ["metaballs", "curlflow", "knot", "contours", "typefield"];
    let sceneInstances = [];
    let N = SCENE_ORDER.length;
    let bg = "#090909";
    function cssVar(n) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); } catch (e) { return ""; } }
    function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

    function resize() {
      if (!secRoot || !canvas) return;
      const r = secRoot.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < sceneInstances.length; i++) { if (sceneInstances[i] && sceneInstances[i].resize) { sceneInstances[i].resize(w, h); } }
    }
    function renderScene(idx, t, dt, a) { if (a <= 0.001) return; const s = sceneInstances[idx]; if (s && s.frame) { s.frame(ctx, t, dt, a); } }
    function updateChrome() {
      const act = (phase === "trans" && (transT / TRANS) > 0.5) ? next : cur;
      if (act !== lastCap) { lastCap = act; if (capName && sceneInstances[act]) capName.textContent = sceneInstances[act].name; dots.forEach(function (d, i) { d.el.setAttribute("aria-current", i === act ? "true" : "false"); }); }
      dots.forEach(function (d, i) { let f = 0; if (i === act) { f = phase === "hold" ? Math.min(1, holdT / HOLD) : 1; } if (d.fill) d.fill.style.transform = "scaleX(" + f + ")"; });
    }
    function frame(ts) {
      if (!last) last = ts; let dt = (ts - last) / 1000; last = ts; if (dt > 0.05) dt = 0.05; elapsed += dt;
      if (phase === "hold") { holdT += dt; if (holdT >= HOLD) { next = (cur + 1) % N; phase = "trans"; transT = 0; } }
      else { transT += dt; if (transT >= TRANS) { cur = next; next = -1; phase = "hold"; holdT = 0; } }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      if (phase === "trans") { const p = ease(transT / TRANS); renderScene(cur, elapsed, dt, 1 - p); renderScene(next, elapsed, dt, p); }
      else renderScene(cur, elapsed, dt, 1);
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      updateChrome();
      raf = requestAnimationFrame(frame);
    }
    function paintStatic() { if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); renderScene(cur, 0, 0, 1); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; updateChrome(); }
    function jump(i) { if (reduced) { cur = i; lastCap = -1; paintStatic(); return; } if (i === cur && phase === "hold") return; if (phase === "hold") { next = i; phase = "trans"; transT = 0; } else { next = i; } }
    function start(container) {
      if (raf) return;
      secRoot = (container && container.querySelector && container.querySelector(".am-root")) || container;
      if (!secRoot) return;
      canvas = secRoot.querySelector(".am-canvas"); if (!canvas) return;
      ctx = canvas.getContext("2d"); if (!ctx) return;
      sceneInstances = SCENE_ORDER.map(function (k) { return SCENES[k] ? SCENES[k]() : null; }).filter(Boolean);
      N = sceneInstances.length || 1;
      bg = cssVar("--canvas") || "#090909";
      capName = secRoot.querySelector(".am-cap-name"); capChip = secRoot.querySelector(".am-cap-chip");
      dots = [];
      secRoot.querySelectorAll(".am-dot").forEach(function (el, i) { const fill = el.querySelector(".am-dot-fill"); const fn = function () { jump(i); }; el.addEventListener("click", fn); on.push({ t: "click", fn: fn, el: el }); dots.push({ el: el, fill: fill }); });
      reduced = false; try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
      cur = 0; next = -1; phase = "hold"; holdT = 0; transT = 0; elapsed = 0; last = 0; lastCap = -1;
      resize();
      const rfn = function () { resize(); if (reduced) paintStatic(); }; window.addEventListener("resize", rfn); on.push({ t: "resize", fn: rfn });
      try { ro = new ResizeObserver(function () { resize(); if (reduced) paintStatic(); }); ro.observe(secRoot); } catch (e) { ro = null; }
      if (reduced) { paintStatic(); return; }
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      cancelAnimationFrame(raf); raf = 0;
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      on.forEach(function (l) { (l.el || window).removeEventListener(l.t, l.fn); }); on.length = 0;
      dots = [];
    }

    const io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { start(section); } else { stop(); } });
    }, { threshold: 0.05 });
    io.observe(section);
    cleanups.push(function () { try { stop(); } catch (e) {} try { io.disconnect(); } catch (e) {} });
  })();

  /* ── hero video: subtle scroll reveal ─────────────────────────────────── */
  (function initFilm() {
    const film = root.querySelector("#film");
    if (film && !REDUCED) {
      const onFilm = () => {
        const r = film.getBoundingClientRect();
        const p = clamp(1 - (r.top - window.innerHeight * 0.42) / (window.innerHeight * 0.5), 0, 1);
        film.style.transform = `scale(${0.955 + 0.045 * p}) translateY(${(1 - p) * 20}px)`;
      };
      onFilm();
      window.addEventListener("scroll", onFilm, { passive: true });
      window.addEventListener("resize", onFilm);
      cleanups.push(() => {
        window.removeEventListener("scroll", onFilm);
        window.removeEventListener("resize", onFilm);
      });
    }
  })();

  /* ── copy button flash ────────────────────────────────────────────────── */
  (function initCopy() {
    const copyBtn = root.querySelector("#copyBtn");
    if (!copyBtn) return;
    const original = copyBtn.innerHTML;
    const done = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.5 12 13 4.5" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Copied bundle`;
    const fallbackCopy = (text) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      } catch (err) {}
    };
    const onClick = (e) => {
      e.preventDefault();
      const pre = root.querySelector(".bundle");
      const text = pre ? (pre.innerText || pre.textContent || "") : "";
      const flash = () => { copyBtn.innerHTML = done; setTimeout(() => { copyBtn.innerHTML = original; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(flash).catch(() => { fallbackCopy(text); flash(); });
      } else {
        fallbackCopy(text); flash();
      }
    };
    copyBtn.addEventListener("click", onClick);
    cleanups.push(() => copyBtn.removeEventListener("click", onClick));
  })();

  /* ── hero play button: scroll to the MCP proof ────────────────────────── */
  (function initPlay() {
    const filmPlay = root.querySelector(".film-play");
    if (!filmPlay) return;
    const onClick = (e) => {
      e.preventDefault();
      const target = root.querySelector("#bundle");
      if (target) target.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
    };
    filmPlay.addEventListener("click", onClick);
    cleanups.push(() => filmPlay.removeEventListener("click", onClick));
  })();

  /* ── access-request forms → real /api/waitlist ────────────────────────── */
  (function initForms() {
    const wire = (formSel, doneSel, noteSel, errSel) => {
      const f = root.querySelector(formSel);
      if (!f) return;
      const d = doneSel ? root.querySelector(doneSel) : null;
      const n = noteSel ? root.querySelector(noteSel) : null;
      const err = errSel ? root.querySelector(errSel) : null;
      const onSubmit = async (e) => {
        e.preventDefault();
        const input = f.querySelector('input[type="email"]');
        const email = input ? input.value.trim() : "";
        if (!email) return;
        const btn = f.querySelector('button[type="submit"]');
        if (err) err.hidden = true;
        if (btn) btn.disabled = true;
        try {
          const res = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            throw new Error(j.error || "HTTP " + res.status);
          }
          f.hidden = true;
          if (n) n.hidden = true;
          if (d) d.hidden = false;
        } catch (ex) {
          if (btn) btn.disabled = false;
          if (err) {
            err.textContent = ex && ex.message ? ex.message : "Something went wrong. Try again.";
            err.hidden = false;
          }
        }
      };
      f.addEventListener("submit", onSubmit);
      cleanups.push(() => f.removeEventListener("submit", onSubmit));
    };
    wire("#heroSignup", "#heroSignupDone", ".hero-form-note", "#heroSignupErr");
    wire("#signup", "#signupDone", null, "#signupErr");
  })();

  /* ── bento clip previews: factories + section controller ──────────────── */
  var BENTO = {};

  BENTO["addcli"] = function (bRoot) {
    var raf = 0;
    var cmdEl = bRoot.querySelector(".bpa-cmd");
    var tileEl = bRoot.querySelector(".bpa-tile");
    var outs = bRoot.querySelectorAll(".bpa-out");
    var CMD = "pnpm capture hero-parallax";
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    var CYCLE = 6400, TYPE = 1300, STEP = 380, OUT = 520;
    var start0 = 0;

    function render(t) {
      var n = t < TYPE ? Math.round((t / TYPE) * CMD.length) : CMD.length;
      if (n > CMD.length) { n = CMD.length; }
      var txt = CMD.slice(0, n);
      if (cmdEl.textContent !== txt) { cmdEl.textContent = txt; }
      var base = TYPE + 240;
      for (var i = 0; i < outs.length; i++) {
        var show = t > base + i * STEP && t < CYCLE - OUT;
        outs[i].classList.toggle("bpa-show", show);
      }
      var open = t > base + outs.length * STEP + 160 && t < CYCLE - OUT;
      var done = t > base + outs.length * STEP + 520 && t < CYCLE - OUT;
      tileEl.classList.toggle("bpa-open", open);
      tileEl.classList.toggle("bpa-done", done);
    }

    function frame(now) {
      if (!start0) { start0 = now; }
      render((now - start0) % CYCLE);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (reduce) {
        cmdEl.textContent = CMD;
        for (var i = 0; i < outs.length; i++) { outs[i].classList.add("bpa-show"); }
        tileEl.classList.add("bpa-open", "bpa-done");
        return;
      }
      if (raf) { return; }
      bRoot.classList.add("bpa-running");
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      bRoot.classList.remove("bpa-running");
      start0 = 0;
    }

    return { start: start, stop: stop };
  };

  BENTO["stored"] = function (bRoot) {
    var cats = ["effect", "technique", "trigger"];
    var rootEl = bRoot.querySelector(".bps-root");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var raf = 0, last = 0, acc = 0, idx = 0, running = false;
    function apply() {
      if (rootEl) { rootEl.setAttribute("data-active", cats[idx]); }
    }
    function frame(t) {
      if (!running) { return; }
      if (!last) { last = t; }
      acc += t - last;
      last = t;
      if (acc >= 1900) {
        acc = 0;
        idx = (idx + 1) % cats.length;
        apply();
      }
      raf = requestAnimationFrame(frame);
    }
    apply();
    function start() {
      if (running) { return; }
      running = true;
      if (reduce) { idx = 0; apply(); return; }
      last = 0;
      acc = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); }
      raf = 0;
      last = 0;
    }
    return { start: start, stop: stop };
  };

  BENTO["mcp"] = function (bRoot) {
    var raf = 0, startT = 0, running = false;
    var FULL = 'get_component("pinned-horizontal")';
    var P = 7000;
    var txtStart = 300, txtEnd = 1650, hideReq = P - 600, fadeOut = P - 650;
    var showAt = [1950, 2300, 2650, 3000];
    var reqText = bRoot.querySelector(".bpm-req-text");
    var lines = Array.prototype.slice.call(bRoot.querySelectorAll(".bpm-line"));
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function render(phase) {
      var n;
      if (phase < txtStart) { n = 0; }
      else if (phase >= txtEnd) { n = FULL.length; }
      else { n = Math.floor(((phase - txtStart) / (txtEnd - txtStart)) * FULL.length); }
      reqText.textContent = FULL.slice(0, n);
      bRoot.classList.toggle("bpm-req-on", phase >= txtStart && phase < hideReq);
      for (var i = 0; i < lines.length; i++) {
        lines[i].classList.toggle("is-in", phase >= showAt[i] && phase < fadeOut);
      }
    }

    function frame(now) {
      if (!running) { return; }
      if (!startT) { startT = now; }
      render((now - startT) % P);
      raf = requestAnimationFrame(frame);
    }

    function showStatic() {
      reqText.textContent = FULL;
      bRoot.classList.add("bpm-req-on");
      for (var i = 0; i < lines.length; i++) { lines[i].classList.add("is-in"); }
    }

    function start() {
      if (reduce) { showStatic(); return; }
      if (running) { return; }
      running = true;
      startT = 0;
      bRoot.classList.add("bpm-running");
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      bRoot.classList.remove("bpm-running");
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    return { start: start, stop: stop };
  };

  BENTO["search"] = function (bRoot) {
    var raf = 0, running = false, last = 0, elapsed = 0, step = 0;
    var LOOP = 7000;
    var QUERY = "magnetic hover button";
    var LEN = QUERY.length;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var qtext = bRoot.querySelector(".bpq-qtext");
    var results = bRoot.querySelector(".bpq-results");
    var rows = Array.prototype.slice.call(bRoot.querySelectorAll(".bpq-row"));

    rows.forEach(function (r) {
      var match = r.getAttribute("data-match") === "1";
      r._m = {
        match: match,
        rel: parseFloat(r.getAttribute("data-rel") || "0"),
        above: parseInt(r.getAttribute("data-above") || "0", 10),
        mi: parseInt(r.getAttribute("data-mi") || "0", 10)
      };
      r._name = r.querySelector(".bpq-name");
      r._fill = r.querySelector(".bpq-fill");
      r._pct = r.querySelector(".bpq-pct");
    });

    function clamp(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
    function easeOut(x) { return 1 - Math.pow(1 - x, 3); }
    function easeIO(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

    function measure() {
      rows.forEach(function (r) { r.style.transform = ""; });
      if (rows.length > 1) {
        step = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
      }
      if (!step || step < 1) { step = 30; }
    }

    function render(p) {
      var co = p < 400 ? p / 400 : (p > 6300 ? Math.max(0, 1 - (p - 6300) / 700) : 1);
      results.style.opacity = co;
      qtext.style.opacity = co;

      var chars = p < 400 ? 0 : (p < 2200 ? Math.floor(easeOut(clamp((p - 400) / 1800)) * LEN) : LEN);
      qtext.textContent = QUERY.slice(0, chars);

      var f = p < 2600 ? 0 : (p < 3500 ? easeIO(clamp((p - 2600) / 900)) : 1);

      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], m = r._m;
        if (m.match) {
          var start = 3500 + m.mi * 180;
          var fill = p < start ? 0 : easeOut(clamp((p - start) / 900));
          r.style.transform = "translateY(" + (-m.above * step * f) + "px)";
          r.style.opacity = 1;
          r._name.style.opacity = 0.68 + 0.32 * fill;
          r._name.style.color = fill > 0.02 ? "var(--ink)" : "var(--muted)";
          r._fill.style.width = (m.rel * fill * 100) + "%";
          r._pct.style.opacity = fill;
          r._pct.textContent = Math.round(m.rel * fill * 100) + "%";
        } else {
          r.style.transform = "translateX(" + (-10 * f) + "px) scale(" + (1 - 0.1 * f) + ")";
          r.style.opacity = 1 - f;
          r._fill.style.width = "0%";
          r._pct.style.opacity = 0;
        }
      }
    }

    function frame(t) {
      if (!running) { return; }
      if (!last) { last = t; }
      elapsed += t - last;
      last = t;
      render(elapsed % LOOP);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) { return; }
      running = true;
      measure();
      if (reduce) {
        render(5200);
        return;
      }
      bRoot.classList.add("bpq-run");
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      bRoot.classList.remove("bpq-run");
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    return { start: start, stop: stop };
  };

  BENTO["standalone"] = function (bRoot) {
    var raf = 0, running = false;
    var dot = bRoot.querySelector(".bpr-dot");
    var ghost = bRoot.querySelector(".bpr-ghost");
    var stage = bRoot.querySelector(".bpr-stage");
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    var hw = 44, hh = 34;
    function measure() {
      if (!stage) return;
      var w = stage.clientWidth, h = stage.clientHeight;
      if (w) { hw = w * 0.32; hh = h * 0.30; }
    }

    var dx = 0, dy = 0, gx = 0, gy = 0, t = 0;

    function render() {
      if (dot) dot.style.transform = "translate(" + dx.toFixed(2) + "px," + dy.toFixed(2) + "px)";
      if (ghost) ghost.style.transform = "translate(" + gx.toFixed(2) + "px," + gy.toFixed(2) + "px)";
    }

    function frame() {
      if (!running) return;
      t += 0.016;
      var tx = Math.sin(t * 0.62) * hw + Math.sin(t * 0.23) * hw * 0.28;
      var ty = Math.cos(t * 0.47) * hh + Math.sin(t * 0.31) * hh * 0.24;
      dx += (tx - dx) * 0.055;
      dy += (ty - dy) * 0.055;
      gx += (dx - gx) * 0.09;
      gy += (dy - gy) * 0.09;
      render();
      raf = requestAnimationFrame(frame);
    }

    function start() {
      bRoot.classList.add("bpr-live");
      measure();
      if (reduce) { dx = dy = gx = gy = 0; render(); return; }
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    return { start: start, stop: stop };
  };

  BENTO["licence"] = function (bRoot) {
    var raf = 0, running = false, last = 0, idx = 0, timer = 0, phase = "stamp";
    var rows = bRoot.querySelectorAll(".bpl-row");
    var reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

    function clear() { for (var i = 0; i < rows.length; i++) { rows[i].classList.remove("bpl-stamped"); } }
    function fill() { for (var i = 0; i < rows.length; i++) { rows[i].classList.add("bpl-stamped"); } }

    function frame(now) {
      if (!running) { return; }
      if (!last) { last = now; }
      var dt = now - last; last = now;
      timer += dt;
      if (phase === "stamp") {
        if (timer >= 780) {
          timer = 0;
          if (idx < rows.length) { rows[idx].classList.add("bpl-stamped"); idx++; }
          if (idx >= rows.length) { phase = "hold"; }
        }
      } else if (phase === "hold") {
        if (timer >= 1700) { phase = "out"; timer = 0; clear(); }
      } else if (phase === "out") {
        if (timer >= 700) { phase = "stamp"; timer = 0; idx = 0; }
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (reduce) { fill(); return; }
      if (running) { return; }
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }
    return { start: start, stop: stop };
  };

  (function initBento() {
    const section = root.querySelector("#features");
    if (!section) { return; }
    const MAP = [
      { name: "Add your own components", key: "addcli" },
      { name: "Stored and searchable", key: "stored", wrap: true },
      { name: "Pull over MCP", key: "mcp" },
      { name: "Search by meaning", key: "search" },
      { name: "Runs standalone", key: "standalone" },
      { name: "Licence on every item", key: "licence" }
    ];
    const cards = $$(".card", section);
    const instances = [];
    let built = false;

    function build() {
      if (built) { return; }
      built = true;
      MAP.forEach(function (m) {
        const factory = BENTO[m.key];
        if (!factory) { return; }
        const card = cards.find(function (c) {
          const nm = c.querySelector(".b-name");
          return nm && nm.textContent.trim() === m.name;
        });
        if (!card) { return; }
        const clip = card.querySelector(".clip");
        if (!clip) { return; }
        const arg = m.wrap ? clip : (clip.firstElementChild || clip);
        let inst = null;
        try { inst = factory(arg); } catch (e) { inst = null; }
        if (inst) { instances.push(inst); }
      });
    }
    function startAll() { instances.forEach(function (i) { if (i && i.start) { try { i.start(); } catch (e) {} } }); }
    function stopAll() { instances.forEach(function (i) { if (i && i.stop) { try { i.stop(); } catch (e) {} } }); }

    const io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { build(); startAll(); }
        else { stopAll(); }
      });
    }, { threshold: 0.05 });
    io.observe(section);
    cleanups.push(function () { try { stopAll(); } catch (e) {} try { io.disconnect(); } catch (e) {} });
  })();

  return () => {
    cleanups.forEach((fn) => { try { fn(); } catch (e) {} });
    cleanups.length = 0;
  };
}
