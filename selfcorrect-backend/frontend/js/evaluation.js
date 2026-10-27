// ===== Evaluation page: personal stats, real benchmarks, and an accuracy chart =====
window.Pages.evaluation = () => {
  const statsHost = document.getElementById("stats");
  const chartHost = document.getElementById("stats-chart");
  const benchBtn = document.getElementById("bench-btn");
  const benchHost = document.getElementById("bench-results");
  const benchStatus = document.getElementById("bench-status");
  const refreshBtn = document.getElementById("stats-refresh");

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  // Turn any stats shape into { groupName: { metric: value } } with Baseline/Self-correcting first.
  function toGroups(data) {
    if (!data) return {};
    if (Array.isArray(data)) {
      const g = {};
      data.forEach((row, i) => { const { mode, ...rest } = row; g[mode || `Group ${i + 1}`] = rest; });
      return g;
    }
    const src = isObj(data.modes) ? data.modes : isObj(data.by_mode) ? data.by_mode : data;
    const groups = {}; const overall = {};
    Object.entries(src).forEach(([k, v]) => { if (isObj(v)) groups[k] = v; else overall[k] = v; });
    if (Object.keys(overall).length && src === data) groups.overall = overall;
    return groups;
  }
  const orderKeys = (keys) => keys.sort((a, b) => rank(a) - rank(b));
  const rank = (k) => (/base/i.test(k) ? 0 : /self|correct/i.test(k) ? 1 : 2);
  const groupLabel = (k) => (/^overall$/i.test(k) ? "Overall" : modeLabel(k));

  function comparisonTable(groups) {
    const names = orderKeys(Object.keys(groups));
    const metrics = [...new Set(names.flatMap((n) => Object.keys(groups[n]).filter((m) => !isObj(groups[n][m]) && !Array.isArray(groups[n][m]))))];
    if (!metrics.length) return emptyState("chart", "No statistics yet", "Run a few tasks in both modes to compare them.");
    return h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
      h("caption", { class: "sr-only", text: "Statistics by mode" }),
      h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Metric" }), names.map((n) => h("th", { scope: "col", text: groupLabel(n) })))),
      h("tbody", {}, metrics.map((m) => h("tr", {},
        h("th", { scope: "row", text: humanize(m) }),
        names.map((n) => h("td", { class: "num", text: formatValue(groups[n][m], m) })))))));
  }

  // Normalize a rate to 0..100 based on how the API expressed it.
  const toPercent = (v, key) => (typeof v !== "number" || !Number.isFinite(v) ? null : /pct|percent/i.test(key) || v > 1 ? v : v * 100);

  // Accurate SVG grouped bar chart for every accuracy-like metric.
  function accuracyChart(groups) {
    const names = orderKeys(Object.keys(groups).filter((n) => !/^overall$/i.test(n)));
    const metrics = [...new Set(names.flatMap((n) => Object.keys(groups[n]).filter((m) => isRateKey(m) && typeof groups[n][m] === "number")))];
    if (!names.length || !metrics.length) return emptyState("chart", "No accuracy data to chart", "Accuracy metrics will appear once the backend reports them.");
    const W = 640, H = 300, padL = 44, padB = 54, padT = 16, padR = 12;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const groupW = innerW / metrics.length;
    const barW = Math.min(46, (groupW - 24) / names.length);
    const NS = "http://www.w3.org/2000/svg";
    const s = (tag, attrs, text) => { const el = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); if (text != null) el.textContent = text; return el; };
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img", "aria-label": "Accuracy comparison by mode" });
    const defs = s("defs", {});
    [["g0", "var(--cobalt)", "var(--cyan)"], ["g1", "var(--violet)", "var(--magenta)"], ["g2", "var(--cyan)", "var(--cobalt)"]].forEach(([id, a, b]) => {
      const lg = s("linearGradient", { id, x1: "0", y1: "1", x2: "0", y2: "0" });
      lg.append(s("stop", { offset: "0%", "stop-color": a }), s("stop", { offset: "100%", "stop-color": b }));
      defs.appendChild(lg);
    });
    svg.appendChild(defs);
    [0, 25, 50, 75, 100].forEach((p) => {
      const y = padT + innerH - (p / 100) * innerH;
      svg.append(s("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "grid-line" }), s("text", { x: padL - 8, y: y + 4, class: "axis-label", "text-anchor": "end" }, `${p}%`));
    });
    metrics.forEach((m, mi) => {
      const gx = padL + mi * groupW + (groupW - barW * names.length - 8 * (names.length - 1)) / 2;
      names.forEach((n, ni) => {
        const pct = toPercent(groups[n][m], m);
        const x = gx + ni * (barW + 8);
        if (pct == null) { svg.appendChild(s("text", { x: x + barW / 2, y: padT + innerH - 6, class: "bar-value", "text-anchor": "middle" }, DASH)); return; }
        const clamped = Math.max(0, Math.min(100, pct));
        const bh = (clamped / 100) * innerH;
        const rect = s("rect", { x, y: padT + innerH - bh, width: barW, height: bh, rx: 6, fill: `url(#g${Math.min(ni, 2)})`, class: "bar" });
        rect.appendChild(s("title", {}, `${groupLabel(n)} \u2013 ${humanize(m)}: ${pct.toFixed(1)}%`));
        svg.append(rect, s("text", { x: x + barW / 2, y: padT + innerH - bh - 6, class: "bar-value", "text-anchor": "middle" }, `${pct.toFixed(1)}%`));
      });
      svg.appendChild(s("text", { x: padL + mi * groupW + groupW / 2, y: H - padB + 22, class: "axis-label", "text-anchor": "middle" }, humanize(m)));
    });
    const legend = h("div", { class: "chart-legend" }, names.map((n, i) => h("span", { class: "legend-item" }, h("span", { class: `swatch swatch-${Math.min(i, 2)}` }), groupLabel(n))));
    return h("div", { class: "chart" }, svg, legend);
  }

  function headlineTiles(groups) {
    const names = orderKeys(Object.keys(groups).filter((n) => !/^overall$/i.test(n)));
    const tiles = [];
    names.forEach((n) => {
      const g = groups[n];
      const accKey = Object.keys(g).find((k) => /accuracy/i.test(k)) || Object.keys(g).find((k) => isRateKey(k) && typeof g[k] === "number");
      const countKey = Object.keys(g).find((k) => /total|count|tasks|runs/i.test(k) && typeof g[k] === "number");
      tiles.push(h("div", { class: `kpi kpi-${rank(n) === 0 ? "cobalt" : "violet"} reveal` },
        h("span", { class: "kpi-label", text: groupLabel(n) }),
        h("span", { class: "kpi-value", text: accKey ? formatValue(g[accKey], accKey) : DASH }),
        h("span", { class: "kpi-sub", text: `${accKey ? humanize(accKey) : "Accuracy"}${countKey ? " \u00B7 " + formatValue(g[countKey]) + " " + humanize(countKey).toLowerCase() : ""}` })));
    });
    return tiles.length ? h("div", { class: "kpi-row" }, tiles) : null;
  }

  async function loadStats() {
    refreshBtn.disabled = true;
    statsHost.replaceChildren(h("div", { class: "panel" }, skeleton(4)));
    chartHost.replaceChildren(h("div", { class: "skeleton chart-skeleton" }));
    try {
      const data = await Api.stats();
      const groups = toGroups(data);
      statsHost.replaceChildren(...[headlineTiles(groups), comparisonTable(groups)].filter(Boolean));
      chartHost.replaceChildren(accuracyChart(groups));
      reveal(statsHost);
    } catch (err) {
      statsHost.replaceChildren(emptyState("alert", "Could not load statistics", err.message));
      chartHost.replaceChildren();
      toastError(err);
    } finally { refreshBtn.disabled = false; }
  }

  // One benchmark cell: the answer, a Correct/Incorrect badge, and the run cost.
  function modeCell(r) {
    if (!r) return DASH;
    return h("div", { class: "bench-cell" },
      h("span", { class: `badge ${r.correct ? "badge-good" : "badge-warn"}` }, icon(r.correct ? "check" : "x", 12), r.correct ? "Correct" : "Incorrect"),
      h("span", { class: "muted small", text: `answer ${isNil(r.answer) ? DASH : r.answer} · ${r.iterations} round${r.iterations === 1 ? "" : "s"} · ${Math.round(r.latency_ms)} ms` }));
  }

  // Matches POST /evaluation/benchmark: {provider, summary:{...}, results:[{task, expected, baseline, self_correcting}]}
  function renderBenchmark(data) {
    const nodes = [];
    const s = (data && data.summary) || {};
    const results = (data && data.results) || [];
    const acc = s.accuracy_pct || {}, lat = s.avg_latency_ms || {};
    nodes.push(h("div", { class: "stats-row reveal" },
      statTile("Tasks", formatValue(s.tasks), "layers"),
      statTile("Errors before", formatValue(s.errors_before_correction), "alert"),
      statTile("Errors after", formatValue(s.errors_after_correction), "shield"),
      statTile("Correction rate", formatValue(s.correction_rate_pct, "correction_rate_pct"), "refresh"),
      statTile("Latency overhead", isNil(s.latency_overhead_ms) ? DASH : `${Math.round(s.latency_overhead_ms)} ms`, "clock")));
    const groups = {
      baseline: { accuracy_pct: acc.baseline, avg_latency_ms: lat.baseline },
      self_correcting: { accuracy_pct: acc.self_correcting, avg_latency_ms: lat.self_correcting },
    };
    nodes.push(panel("Benchmark comparison", "chart", comparisonTable(groups)));
    nodes.push(panel("Benchmark accuracy", "chart", accuracyChart(groups)));
    if (results.length) {
      nodes.push(panel(`Correctness results (${results.length})`, "check", h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
        h("thead", {}, h("tr", {}, ["Task", "Expected", "Baseline", "Self-correcting"].map((c) => h("th", { scope: "col", text: c })))),
        h("tbody", {}, results.map((r) => h("tr", {},
          h("td", { text: r.task }), h("td", { class: "num", text: formatValue(r.expected) }),
          h("td", {}, modeCell(r.baseline)), h("td", {}, modeCell(r.self_correcting)))))))));
    } else {
      nodes.push(emptyState("info", "Benchmark returned no data", "The server completed the benchmark but reported no results."));
    }
    return nodes;
  }

  let benchRunning = false;
  benchBtn.addEventListener("click", async () => {
    if (benchRunning) return;
    const ok = await confirmDialog({ title: "Run the benchmark?", message: "This sends real benchmark questions through both modes and may take several minutes. Keep this tab open until it completes.", confirmLabel: "Start benchmark" });
    if (!ok) return;
    benchRunning = true;
    setBusy(benchBtn, true, "Benchmark running...");
    const start = performance.now();
    benchStatus.hidden = false;
    const label = benchStatus.querySelector(".bench-elapsed");
    const tick = () => { const s = Math.floor((performance.now() - start) / 1000); label.textContent = `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s elapsed`; };
    tick(); const timer = setInterval(tick, 1000);
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    benchHost.replaceChildren();
    try {
      const data = await Api.benchmark();
      benchHost.replaceChildren(...renderBenchmark(data));
      reveal(benchHost);
      toast("Benchmark complete.", "success");
      loadStats();
    } catch (err) {
      benchHost.replaceChildren(emptyState("alert", "Benchmark failed", err.message));
      toastError(err);
    } finally {
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
      benchStatus.hidden = true;
      benchRunning = false;
      setBusy(benchBtn, false);
    }
  });
  refreshBtn.addEventListener("click", loadStats);

  loadStats();
};
