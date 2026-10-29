// ===== Atmosphere: animated aurora canvas, film grain and the glowing orb (all driven by REAL app state) =====
(function () {
  const reduced = () => document.documentElement.dataset.motion === "off";
  const cv = document.createElement("canvas");
  cv.className = "aurora"; cv.setAttribute("aria-hidden", "true");
  const grain = document.createElement("div");
  grain.className = "grain"; grain.setAttribute("aria-hidden", "true");
  document.body.prepend(grain); document.body.prepend(cv);
  const ctx = cv.getContext("2d");

  const blobs = [
    { v: "--violet", x: .18, y: .28, r: .62, sp: .11, ph: 0 },
    { v: "--cyan", x: .82, y: .22, r: .5, sp: .085, ph: 2.1 },
    { v: "--amber", x: .62, y: .95, r: .42, sp: .07, ph: 4.2 },
    { v: "--magenta", x: .08, y: .9, r: .42, sp: .09, ph: 1.3 },
  ];
  let W = 0, H = 0, scale = .5, speed = 1, speedTarget = 1, boost = 1, boostTarget = 1, t = 0, last = 0, raf = 0, slow = 0, frames = 0, light = false, alpha = .5;

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    light = document.documentElement.dataset.theme === "light";
    alpha = parseFloat(cs.getPropertyValue("--aur-a")) || .5;
    blobs.forEach((b) => {
      const hex = cs.getPropertyValue(b.v).trim().replace("#", "");
      b.rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0).join(",");
    });
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = cv.width = Math.max(2, Math.round(innerWidth * scale * Math.min(dpr, 1)));
    H = cv.height = Math.max(2, Math.round(innerHeight * scale * Math.min(dpr, 1)));
    draw();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    const a = alpha * boost * (light ? .55 : 1);
    blobs.forEach((b) => {
      const x = (b.x + Math.sin(t * b.sp + b.ph) * .2) * W, y = (b.y + Math.cos(t * b.sp * .8 + b.ph) * .16) * H, r = b.r * Math.max(W, H) * (1 + Math.sin(t * .2 + b.ph) * .06);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${b.rgb},${(a * .5).toFixed(3)})`); g.addColorStop(.5, `rgba(${b.rgb},${(a * .16).toFixed(3)})`); g.addColorStop(1, `rgba(${b.rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - last) / 1000 || .016); last = now;
    speed += (speedTarget - speed) * Math.min(1, dt * 2.4); boost += (boostTarget - boost) * Math.min(1, dt * 2.4);
    t += dt * speed; draw();
    // Performance guard: if frames are consistently slow, lower the resolution once, then freeze the animation.
    if (dt > .034) slow++; if (++frames % 120 === 0) { if (slow > 70) { if (scale > .3) { scale = .3; resize(); } else { stop(); } } slow = 0; }
  }
  function start() { if (!raf && !reduced() && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  readTheme(); resize(); start();
  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  addEventListener("themechange", () => { readTheme(); draw(); });
  addEventListener("motionchange", () => (reduced() ? (stop(), draw()) : start()));

  // ---- Orb ----
  const STATES = { idle: [1, 1], working: [3.4, 1.4], done: [1.3, 1.25], error: [.5, .7] };
  function makeOrb(size) {
    const el = h("div", { class: "orb" + (size ? " " + size : ""), "data-state": "idle", "aria-hidden": "true" },
      h("span", { class: "orb-halo" }), h("span", { class: "orb-ring two" }), h("span", { class: "orb-ring" }),
      h("span", { class: "orb-mascot" }, h("img", { src: "logo.png", alt: "", draggable: "false" })));
    return el;
  }
  function setState(state) {
    document.querySelectorAll(".orb").forEach((o) => { o.dataset.state = state; });
    const [s, b] = STATES[state] || STATES.idle; speedTarget = s; boostTarget = b;
    if (state === "done") setTimeout(() => { if (speedTarget === 1.3) { speedTarget = 1; boostTarget = 1; } }, 1400);
    if (reduced()) draw();
  }
  // Gentle pointer parallax for the orb (skipped with reduced motion).
  let pend = false;
  addEventListener("pointermove", (e) => {
    if (pend || reduced()) return; pend = true;
    requestAnimationFrame(() => {
      pend = false; const x = (e.clientX / innerWidth - .5) * 18, y = (e.clientY / innerHeight - .5) * 14;
      document.querySelectorAll(".orb").forEach((o) => { o.style.setProperty("--px", x + "px"); o.style.setProperty("--py", y + "px"); });
    });
  }, { passive: true });

  const bits = h("div", { class: "float-bits", "aria-hidden": "true" });
  ["--cyan", "--violet", "--amber", "--magenta"].forEach((c, k) => { for (let n = 0; n < 4; n++) { const i = document.createElement("i"); const r = (a, b) => a + Math.random() * (b - a);
    i.style.cssText = `--c:var(${c});--s:${r(6, 18).toFixed(0)}px;--x:${r(2, 96).toFixed(0)}%;--d:${r(16, 32).toFixed(0)}s;--dl:${(-r(0, 30)).toFixed(0)}s;--dx:${r(-60, 60).toFixed(0)}px`; bits.append(i); } });
  document.body.prepend(bits);
  window.Aurora = { setState };
  window.makeOrb = makeOrb;
})();
