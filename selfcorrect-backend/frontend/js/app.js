// ===== App shell: theme, auth guards, header, and page bootstrapping =====

// --- Theme (persisted light/dark) ---
const Theme = {
  KEY: "scmap_theme",
  current() { return document.documentElement.dataset.theme || "dark"; },
  set(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(this.KEY, theme);
    document.querySelectorAll(".theme-toggle").forEach(updateThemeButton);
  },
  toggle() { this.set(this.current() === "dark" ? "light" : "dark"); },
};
function updateThemeButton(btn) {
  const dark = Theme.current() === "dark";
  btn.replaceChildren(icon(dark ? "sun" : "moon", 18));
  btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  btn.setAttribute("title", dark ? "Light theme" : "Dark theme");
}
function themeButton() {
  const btn = h("button", { type: "button", class: "icon-btn theme-toggle" });
  updateThemeButton(btn);
  btn.addEventListener("click", () => Theme.toggle());
  return btn;
}

// --- Header (signed-in app pages and public pages) ---
function renderHeader(page) {
  const host = document.getElementById("site-header");
  if (!host) return;
  const authed = Auth.isAuthed();
  const user = Auth.getUser() || {};
  const links = authed
    ? [
        { href: "index.html", label: "Orchestrator", icon: "layers", id: "orchestrator" },
        { href: "history.html", label: "History", icon: "history", id: "history" },
        { href: "evaluation.html", label: "Evaluation", icon: "chart", id: "evaluation" },
        { href: "about.html", label: "How it works", icon: "spark", id: "about" },
      ]
    : [{ href: "about.html", label: "How it works", icon: "spark", id: "about" }];
  const name = user.full_name || user.email || "Account";
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");

  let actions;
  if (authed) {
    const logout = h("button", { type: "button", class: "icon-btn", "aria-label": "Sign out", title: "Sign out" }, icon("logout", 18));
    logout.addEventListener("click", signOut);
    actions = [
      themeButton(),
      h("a", { href: "profile.html", class: "user-chip" + (page === "profile" ? " active" : ""), title: user.email || "Your profile", "aria-label": "Open your profile" },
        h("span", { class: "avatar", text: initials || "U" }), h("span", { class: "user-name", text: name })),
      logout,
    ];
  } else {
    actions = [
      themeButton(),
      h("a", { href: "login.html", class: "btn btn-ghost btn-sm" }, h("span", { class: "btn-label", text: "Sign in" })),
      h("a", { href: "register.html", class: "btn btn-primary btn-sm" }, h("span", { class: "btn-label", text: "Get started" })),
    ];
  }

  host.replaceChildren(
    h("div", { class: "header-inner" },
      h("a", { href: authed ? "index.html" : "about.html", class: "brand", "aria-label": "Self-Correcting Pipeline home" },
        h("span", { class: "brand-mark" }, icon("logo", 20)),
        h("span", { class: "brand-text" }, h("strong", { text: "Recursive" }), h("span", { text: "Multi-Agent Pipeline" }))),
      h("nav", { class: "main-nav", "aria-label": "Primary" },
        links.map((l) => h("a", { href: l.href, class: "nav-link" + (l.id === page ? " active" : ""), "aria-current": l.id === page ? "page" : null },
          icon(l.icon, 16), h("span", { text: l.label })))),
      h("div", { class: "header-actions" }, actions)));
}

// --- Page registry: each page script registers an init function here ---
window.Pages = window.Pages || {};

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;
  const isAuthPage = page === "login" || page === "register";
  const isPublic = page === "about" || page === "notfound"; // viewable without signing in

  // Auth redirects: signed-in users skip login/register, guests can't see app pages.
  if (isAuthPage && Auth.isAuthed()) { location.replace("index.html"); return; }
  if (!isAuthPage && !isPublic && !Auth.isAuthed()) { location.replace("login.html"); return; }

  hydrateIcons();
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    updateThemeButton(btn);
    btn.addEventListener("click", () => Theme.toggle());
  });
  if (!isAuthPage) renderHeader(page);
  initMotion();

  const flash = sessionStorage.getItem("scmap_flash");
  if (flash) { sessionStorage.removeItem("scmap_flash"); toast(flash, "warning"); }

  if (window.Pages[page]) window.Pages[page]();
  reveal();

  // Quietly refresh the stored user profile (also validates the token).
  if (!isAuthPage && Auth.isAuthed()) {
    try { const me = await Api.me(); if (me) { Auth.setUser(me.user || me); renderHeader(page); } }
    catch (err) { if (err.status !== 401 && err.status !== 0) console.warn("Profile refresh failed:", err.message); }
  }
});
