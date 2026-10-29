// ===== App bootstrap: theme, auth guards, shell, page init =====
const Theme = {
  KEY: "scmap_theme",
  current() { return document.documentElement.dataset.theme || "dark"; },
  set(theme) {
    const apply = () => {
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem(this.KEY, theme); } catch {}
      document.querySelectorAll(".theme-toggle").forEach(updateThemeButton);
      window.dispatchEvent(new Event("themechange"));
    };
    // Smooth cross-fade where the browser supports it.
    if (document.startViewTransition && !reduceMotion()) document.startViewTransition(apply); else apply();
  },
  toggle() { this.set(this.current() === "dark" ? "light" : "dark"); },
};
function updateThemeButton(btn) {
  const dark = Theme.current() === "dark";
  btn.replaceChildren(icon(dark ? "sun" : "moon", 18));
  btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  btn.setAttribute("title", dark ? "Light theme" : "Dark theme");
}

window.Pages = window.Pages || {};
const PUBLIC_PAGES = ["about", "notfound"];

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;
  const isAuthPage = page === "login" || page === "register";
  if (isAuthPage && Auth.isAuthed()) { location.replace("index.html"); return; }
  if (!isAuthPage && !PUBLIC_PAGES.includes(page) && !Auth.isAuthed()) { location.replace("login.html"); return; }

  document.querySelectorAll("[data-orb]").forEach((el) => el.append(makeOrb(el.dataset.orb)));
  hydrateIcons();
  document.querySelectorAll(".theme-toggle").forEach((btn) => { updateThemeButton(btn); btn.addEventListener("click", () => Theme.toggle()); });
  if (!isAuthPage) renderShell(page);
  initMotion();
  initTilt();

  const flash = sessionStorage.getItem("scmap_flash");
  if (flash) { sessionStorage.removeItem("scmap_flash"); toast(flash, "warning"); }

  if (window.Pages[page]) window.Pages[page]();
  reveal();

  if (!isAuthPage && Auth.isAuthed()) {            // quietly validate the token and refresh the profile
    try { const me = await Api.me(); if (me) { Auth.setUser(me.user || me); } }
    catch (err) { if (err.status !== 401 && err.status !== 0) console.warn("Profile refresh failed:", err.message); }
  }
});

// Subtle 3D tilt on cards that opt in with class "tilt".
function initTilt() {
  if (reduceMotion()) return;
  document.querySelectorAll(".tilt").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--ry", (((e.clientX - r.left) / r.width - .5) * 6).toFixed(2) + "deg");
      el.style.setProperty("--rx", ((.5 - (e.clientY - r.top) / r.height) * 5).toFixed(2) + "deg");
    });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); });
  });
}


// ===== Extra life: cursor spotlight on cards + mascot hop on click =====
(function () {
  let raf = 0;
  addEventListener("pointermove", (e) => {
    if (raf || document.documentElement.dataset.motion === "off") return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = e.target.closest && e.target.closest(".card, .answer, .report, .composer, .agent, .stat-tile, .kpi");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (e.clientX - r.left) + "px"); el.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  }, { passive: true });
  document.addEventListener("click", (e) => {
    const m = e.target.closest && e.target.closest(".orb-mascot");
    if (!m) return;
    m.classList.remove("hop"); void m.offsetWidth; m.classList.add("hop");
  });
})();
