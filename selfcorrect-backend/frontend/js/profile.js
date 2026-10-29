// ===== Profile page: account details, personal stats snapshot, recent tasks =====
window.Pages.profile = () => {
  const account = document.getElementById("account");
  const snapshot = document.getElementById("snapshot");
  const recent = document.getElementById("recent");
  let email = (Auth.getUser() || {}).email || "";

  document.getElementById("signout-btn").addEventListener("click", async () => {
    if (await confirmDialog({ title: "Sign out?", message: "You will need to sign in again to run tasks.", confirmLabel: "Sign out" })) signOut();
  });
  document.getElementById("copy-email").addEventListener("click", (e) => email && copyText(email, e.currentTarget));

  function renderAccount(u) {
    email = u.email || email;
    const name = u.full_name || email || "Account";
    const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
    account.replaceChildren(h("div", { class: "profile-head" },
      h("span", { class: "avatar avatar-lg", text: initials || "U" }),
      h("div", {}, h("h2", { id: "acct-title", text: name }), h("p", { class: "muted", text: email }),
        h("p", { class: "muted small", text: `Member since ${formatDate(u.created_at)}` }))));
  }
  renderAccount(Auth.getUser() || {});
  account.appendChild(h("div", { class: "skeleton", style: "width:40%;height:10px;margin-top:8px" }));

  Api.me().then((me) => { Auth.setUser(me); renderAccount(me); }).catch((e) => { if (e.status !== 401) toastError(e); });

  snapshot.replaceChildren(skeleton(3));
  Api.stats().then((data) => {
    const m = data.by_mode || {};
    const sc = m.self_correcting || {}, base = m.baseline || {};
    snapshot.replaceChildren(
      h("div", { class: "stats-row" },
        statTile("Total tasks", formatValue(data.total_tasks), "layers"),
        statTile("Pass rate \u00B7 Verified", formatValue(sc.verified_rate_pct, "verified_rate_pct"), "shield"),
        statTile("Pass rate \u00B7 Quick", formatValue(base.verified_rate_pct, "verified_rate_pct"), "exec"),
        statTile("Issues fixed", formatValue(sc.issues_fixed), "fix"),
        statTile("Correction rate", formatValue(sc.correction_rate_pct, "correction_rate_pct"), "refresh")));
    reveal(snapshot);
  }).catch((e) => { snapshot.replaceChildren(emptyState("alert", "Could not load results", e.message)); toastError(e); });

  recent.replaceChildren(...Array.from({ length: 3 }, () => h("li", { class: "task-row skeleton-row" }, skeleton(2))));
  Api.listTasks({ limit: 5 }).then((data) => {
    const items = data.items || [];
    if (!items.length) {
      recent.replaceChildren(h("li", {}, emptyState("history", "No tasks yet", "Start your first task and it will appear here.",
        h("a", { class: "btn btn-primary", href: "index.html" }, icon("play", 16), h("span", { class: "btn-label", text: "New task" })))));
      return;
    }
    recent.replaceChildren(...items.map((raw) => {
      const t = normalizeTask(raw);
      return h("li", { class: "task-row reveal" },
        h("a", { class: "task-open", href: "history.html" },
          h("span", { class: "task-prompt", text: t.prompt || "(no prompt)" }),
          h("span", { class: "task-meta" }, modeBadge(t.mode), verificationBadge(t.verified, t.mode), h("time", { text: formatDate(t.created) }))));
    }));
    reveal(recent);
  }).catch((e) => { recent.replaceChildren(h("li", {}, emptyState("alert", "Could not load tasks", e.message))); toastError(e); });
};
