// ===== UI helpers: safe DOM building, icons, toasts, formatting =====

// Build elements safely. Text is always set via textContent (never innerHTML).
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val === false || val === null || val === undefined) continue;
    if (key === "class") el.className = val;
    else if (key === "text") el.textContent = val;
    else if (key === "icon") el.appendChild(icon(val));
    else if (key.startsWith("on") && typeof val === "function") el.addEventListener(key.slice(2), val);
    else if (key === "dataset") Object.assign(el.dataset, val);
    else el.setAttribute(key, val === true ? "" : val);
  }
  children.flat(Infinity).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return el;
}

// Our own static SVG icons (trusted strings we wrote, never API data).
const ICONS = {
  logo: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m12 22V12"/><path d="m3 7 9 5 9-5"/>',
  plan: '<path d="M9 4h10v16H5V8z"/><path d="M9 4v4H5"/><path d="M9 13h6M9 17h4"/>',
  exec: '<path d="m13 2-9 12h7l-1 8 9-12h-7z"/>',
  critic: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/><path d="M8.5 11h5"/>',
  fix: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17V11M13 17V7M18 17v-4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  play: '<path d="M6 4v16l14-8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.7.4-1.1.9-1.1 1.7M12 17h.01"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
};
function icon(name, size = 18) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = ICONS[name] || ""; // static, trusted markup only
  return svg;
}
// Replace any <i data-icon="name"></i> placeholder in static HTML with the real icon.
function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.replaceWith(icon(el.dataset.icon, Number(el.dataset.size) || 18));
  });
}

// ---- Toasts ----
function toast(message, type = "info", timeout = 4500) {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = h("div", { id: "toast-region", class: "toast-region", "aria-live": "polite", "aria-atomic": "false" });
    document.body.appendChild(region);
  }
  const iconName = { success: "check", error: "alert", warning: "alert", info: "info" }[type] || "info";
  const close = h("button", { class: "toast-close", type: "button", "aria-label": "Dismiss notification" }, icon("x", 14));
  const t = h("div", { class: `toast toast-${type}`, role: type === "error" ? "alert" : "status" },
    h("span", { class: "toast-icon" }, icon(iconName, 16)),
    h("span", { class: "toast-msg", text: message }), close);
  const remove = () => { t.classList.add("leaving"); setTimeout(() => t.remove(), 260); };
  close.addEventListener("click", remove);
  region.appendChild(t);
  if (timeout) setTimeout(remove, timeout);
}
const toastError = (err) => toast((err && err.message) || "Something went wrong.", "error", 6500);

// ---- Formatting ----
const DASH = "\u2014";
function isNil(v) { return v === null || v === undefined || v === ""; }
function humanize(key) {
  return String(key).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bMs\b/, "(ms)").replace(/\bAvg\b/, "Avg.").replace(/\bId\b/, "ID");
}
function isRateKey(key) { return /accuracy|rate|ratio|percent|pct|success|precision|recall|score/i.test(key); }
function formatValue(value, key = "") {
  if (isNil(value)) return DASH;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return DASH;
    if (isRateKey(key) && !/pct|percent/i.test(key) && value >= 0 && value <= 1) return (value * 100).toFixed(1) + "%";
    if (/pct|percent/i.test(key)) return value.toFixed(1) + "%";
    if (/_ms$|latency|duration|time/i.test(key) && /ms/i.test(key)) return Math.round(value).toLocaleString() + " ms";
    if (/seconds|_s$/i.test(key)) return value.toFixed(2) + " s";
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function formatDate(value) {
  if (!value) return DASH;
  const d = new Date(value);
  if (isNaN(d)) return String(value);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function modeLabel(mode) {
  if (!mode) return DASH;
  return /base/i.test(mode) ? "Quick" : /self|correct/i.test(mode) ? "Verified" : humanize(mode);
}

// ---- Copy to clipboard ----
async function copyText(text, btn) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const ta = h("textarea", { class: "sr-only", "aria-hidden": "true" });
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    if (btn) {
      btn.classList.add("copied");
      const label = btn.querySelector(".btn-label");
      const prev = label ? label.textContent : "";
      if (label) label.textContent = "Copied";
      setTimeout(() => { btn.classList.remove("copied"); if (label) label.textContent = prev; }, 1600);
    }
    toast("Copied to clipboard", "success", 1800);
  } catch {
    toast("Could not copy to clipboard.", "error");
  }
}
function copyButton(getText, label = "Copy") {
  const btn = h("button", { type: "button", class: "btn btn-ghost btn-xs copy-btn", "aria-label": label }, icon("copy", 14), h("span", { class: "btn-label", text: label }));
  btn.addEventListener("click", () => copyText(typeof getText === "function" ? getText() : getText, btn));
  return btn;
}

// ---- Loading skeletons & empty states ----
function skeleton(lines = 3) {
  return h("div", { class: "skeleton-group", "aria-hidden": "true" },
    Array.from({ length: lines }, (_, i) => h("div", { class: "skeleton", style: `width:${92 - i * 14}%` })));
}
function emptyState(iconName, title, text, action) {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-icon" }, icon(iconName, 26)),
    h("h3", { text: title }), text ? h("p", { text }) : null, action || null);
}
function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  const label = btn.querySelector(".btn-label");
  if (busy) {
    btn.dataset.prevLabel = label ? label.textContent : "";
    btn.disabled = true; btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true");
    if (label && busyLabel) label.textContent = busyLabel;
  } else {
    btn.disabled = false; btn.classList.remove("is-loading"); btn.removeAttribute("aria-busy");
    if (label && btn.dataset.prevLabel !== undefined) label.textContent = btn.dataset.prevLabel;
  }
}

// ---- Confirm dialog (accessible, keyboard friendly) ----
function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const cancel = h("button", { type: "button", class: "btn btn-ghost" }, h("span", { class: "btn-label", text: "Cancel" }));
    const ok = h("button", { type: "button", class: `btn ${danger ? "btn-danger" : "btn-primary"}` }, h("span", { class: "btn-label", text: confirmLabel }));
    const dlg = h("dialog", { class: "dialog", "aria-labelledby": "dlg-title" },
      h("h2", { id: "dlg-title", text: title }), h("p", { class: "muted", text: message }),
      h("div", { class: "dialog-actions" }, cancel, ok));
    document.body.appendChild(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => done(true));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    dlg.showModal();
    cancel.focus();
  });
}

// ---- Staggered reveal animation ----
function reveal(root = document) {
  const items = root.querySelectorAll(".reveal:not(.in)");
  if (!("IntersectionObserver" in window)) { items.forEach((el) => el.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); animateNumbers(e.target); io.unobserve(e.target); } });
  }, { threshold: 0.08 });
  items.forEach((el, i) => { el.style.setProperty("--d", `${Math.min(i, 8) * 60}ms`); io.observe(el); });
}

// Page registry: each page script adds its init function here; app.js runs it.
window.Pages = window.Pages || {};

Object.assign(window, { h, icon, hydrateIcons, toast, toastError, DASH, isNil, humanize, isRateKey, formatValue, formatDate, modeLabel, copyText, copyButton, skeleton, emptyState, setBusy, confirmDialog, reveal });


// ===== Motion + session helpers =====
const reduceMotion = () => document.documentElement.dataset.motion === "off";

function signOut() {
  Auth.clear();
  document.body.classList.add("page-leave");
  setTimeout(() => location.replace("login.html"), reduceMotion() ? 0 : 200);
}

// Count numbers up from 0 (only plain leading numbers like "12", "45.0%", "3 / 3"; dashes are left alone).
function animateNumbers(root) {
  if (reduceMotion()) return;
  const targets = [...root.querySelectorAll(".stat-value, .kpi-value")];
  if (root.matches && root.matches(".stat-value, .kpi-value")) targets.push(root);
  targets.forEach((el) => {
    const m = /^(-?[\d,]*\.?\d+)(.*)$/.exec(el.textContent.trim());
    if (!m || el.dataset.counted) return;
    el.dataset.counted = "1";
    const end = parseFloat(m[1].replace(/,/g, ""));
    const decimals = (m[1].split(".")[1] || "").length;
    const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const start = performance.now(), dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(end * eased) + m[2];
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// Button ripple + smooth page transitions between the app's own pages.
function initMotion() {
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest && e.target.closest(".btn:not(:disabled)");
    if (!btn || reduceMotion()) return;
    const r = btn.getBoundingClientRect();
    const dot = h("span", { class: "ripple", "aria-hidden": "true", style: `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px` });
    btn.appendChild(dot);
    setTimeout(() => dot.remove(), 650);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target || reduceMotion()) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/\.html$/.test(url.pathname) || url.pathname === location.pathname) return;
    e.preventDefault();
    document.body.classList.add("page-leave");
    setTimeout(() => { location.href = a.href; }, 180);
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted) document.body.classList.remove("page-leave"); });
}

Object.assign(window, { reduceMotion, signOut, animateNumbers, initMotion });
