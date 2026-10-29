// ===== App shell: slim expandable sidebar + minimal top bar (no duplicated navigation) =====
const PAGE_TITLES = { orchestrator: "New task", history: "History", evaluation: "Insights", profile: "Profile", about: "Welcome", notfound: "Not found" };

function themeButton() {
  const btn = h("button", { type: "button", class: "icon-btn theme-toggle" });
  updateThemeButton(btn);
  btn.addEventListener("click", () => Theme.toggle());
  return btn;
}

function motionButton() {
  const btn = h("button", { type: "button", class: "icon-btn motion-toggle" });
  const sync = () => { const on = document.documentElement.dataset.motion !== "off"; btn.setAttribute("aria-pressed", String(on)); btn.setAttribute("aria-label", on ? "Turn animations off" : "Turn animations on"); btn.title = on ? "Animations on" : "Animations off"; btn.replaceChildren(icon(on ? "spark" : "play", 18)); };
  sync();
  btn.addEventListener("click", () => { const off = document.documentElement.dataset.motion !== "off"; document.documentElement.dataset.motion = off ? "off" : "on"; try { localStorage.setItem("synora_motion", off ? "off" : "on"); } catch {} sync(); window.dispatchEvent(new Event("motionchange")); });
  return btn;
}

function renderShell(page) {
  const authed = Auth.isAuthed();
  const app = document.getElementById("app");
  const top = document.getElementById("topbar-host");
  if (!authed) {                                     // public pages for signed-out visitors
    app.classList.add("public");
    top.replaceChildren(h("div", { class: "public-top" },
      h("a", { href: "about.html", class: "public-brand", "aria-label": "SYNORA home" }, h("span", { class: "brand-mark" }), h("span", { class: "brand-name", style: "opacity:1", text: "SYNORA" })),
      h("div", { class: "top-actions" }, motionButton(), themeButton(),
        h("a", { href: "login.html", class: "btn btn-ghost btn-sm" }, h("span", { class: "btn-label", text: "Sign in" })),
        h("a", { href: "register.html", class: "btn btn-primary btn-sm" }, h("span", { class: "btn-label", text: "Get started" })))));
    return;
  }

  const user = Auth.getUser() || {};
  const name = user.full_name || user.email || "Account";
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("") || "U";
  const items = [
    { href: "index.html", label: "New task", icon: "plus", id: "orchestrator" },
    { href: "history.html", label: "History", icon: "history", id: "history" },
    { href: "evaluation.html", label: "Insights", icon: "chart", id: "evaluation" },
    { href: "about.html", label: "How it works", icon: "help", id: "about" },
  ];
  const pin = h("button", { type: "button", class: "nav-item pin-btn", "aria-label": "Keep sidebar open", "aria-pressed": "false" }, icon("pin", 20), h("span", { class: "nav-label", text: "Keep open" }));
  const setPin = (on) => { document.body.classList.toggle("pinned", on); pin.setAttribute("aria-pressed", String(on)); try { localStorage.setItem("scmap_pin", on ? "1" : "0"); } catch {} };
  pin.addEventListener("click", () => setPin(!document.body.classList.contains("pinned")));
  let pinned = false; try { pinned = localStorage.getItem("scmap_pin") === "1"; } catch {}
  setPin(pinned && innerWidth > 820);

  const out = h("button", { type: "button", class: "nav-item signout", "aria-label": "Sign out" }, icon("logout", 20), h("span", { class: "nav-label", text: "Sign out" }));
  out.addEventListener("click", async () => {
    if (await confirmDialog({ title: "Sign out?", message: "You will need to sign in again to run tasks.", confirmLabel: "Sign out" })) signOut();
  });

  const side = h("nav", { class: "sidebar glass", "aria-label": "Primary" },
    h("a", { href: "index.html", class: "side-brand", "aria-label": "SYNORA" }, h("span", { class: "brand-mark" }), h("span", { class: "brand-name", text: "SYNORA" })),
    items.map((it) => h("a", { href: it.href, class: "nav-item", "aria-current": it.id === page ? "page" : null, title: it.label }, icon(it.icon, 20), h("span", { class: "nav-label", text: it.label }))),
    h("span", { class: "side-spacer" }), pin,
    h("a", { href: "profile.html", class: "nav-item side-user", "aria-current": page === "profile" ? "page" : null, title: user.email || "Profile" },
      h("span", { class: "avatar", text: initials }), h("span", { class: "nav-label", text: name })),
    out);
  document.body.insertBefore(side, app);

  top.replaceChildren(h("div", { class: "topbar" },
    h("div", { class: "crumb" }, h("span", { text: "SYNORA" }), h("span", { "aria-hidden": "true", text: "/" }), h("strong", { text: PAGE_TITLES[page] || "" })),
    h("div", { class: "top-actions" }, motionButton(), themeButton(),
      page === "orchestrator" ? null : h("a", { href: "index.html", class: "btn btn-primary btn-sm" }, icon("plus", 15), h("span", { class: "btn-label", text: "New task" })))));
}
window.renderShell = renderShell;
window.themeButton = themeButton;
