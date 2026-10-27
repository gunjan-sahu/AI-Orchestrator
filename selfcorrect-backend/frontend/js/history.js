// ===== History page: list, filter, paginate, inspect and delete tasks =====
window.Pages.history = () => {
  const list = document.getElementById("task-list");
  const detail = document.getElementById("task-detail");
  const pageInfo = document.getElementById("page-info");
  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  const refreshBtn = document.getElementById("refresh-btn");
  const limitSel = document.getElementById("page-size");
  const state = { limit: Number(limitSel.value), offset: 0, mode: "", total: null, items: [], selected: null, loading: false };

  function parseList(data) {
    if (Array.isArray(data)) return { items: data, total: null };
    const items = data.items ?? data.tasks ?? data.results ?? data.data ?? [];
    return { items: Array.isArray(items) ? items : [], total: data.total ?? data.count ?? null };
  }
  const newestFirst = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0);

  async function load() {
    if (state.loading) return;
    state.loading = true;
    refreshBtn.disabled = true;
    list.setAttribute("aria-busy", "true");
    list.replaceChildren(...Array.from({ length: 4 }, () => h("li", { class: "task-row skeleton-row" }, skeleton(2))));
    try {
      const data = await Api.listTasks({ limit: state.limit, offset: state.offset, mode: state.mode || undefined });
      const { items, total } = parseList(data || []);
      state.items = items.slice().sort(newestFirst);
      state.total = total;
      renderList();
    } catch (err) {
      list.replaceChildren(h("li", {}, emptyState("alert", "Could not load history", err.message,
        h("button", { class: "btn btn-ghost", type: "button", onclick: load }, icon("refresh", 16), h("span", { class: "btn-label", text: "Try again" })))));
      toastError(err);
    } finally {
      state.loading = false;
      refreshBtn.disabled = false;
      list.removeAttribute("aria-busy");
      updatePager();
    }
  }

  function renderList() {
    if (!state.items.length) {
      list.replaceChildren(h("li", {}, emptyState("history", state.offset ? "No more tasks" : "No tasks yet",
        state.mode ? "No tasks match this mode filter." : "Run your first prompt in the Orchestrator.",
        state.offset ? null : h("a", { class: "btn btn-primary", href: "index.html" }, icon("play", 16), h("span", { class: "btn-label", text: "Open Orchestrator" })))));
      return;
    }
    list.replaceChildren(...state.items.map((raw) => {
      const t = normalizeTask(raw);
      const open = h("button", { type: "button", class: "task-open", "aria-pressed": String(state.selected === t.id) },
        h("span", { class: "task-prompt", text: t.prompt || "(no prompt)" }),
        h("span", { class: "task-meta" }, modeBadge(t.mode), verificationBadge(t.verified), h("time", { datetime: t.created || "", text: formatDate(t.created) })));
      open.addEventListener("click", () => openDetail(t.id));
      const del = h("button", { type: "button", class: "icon-btn icon-btn-danger", "aria-label": "Delete task" }, icon("trash", 16));
      del.addEventListener("click", () => remove(t.id, del));
      return h("li", { class: "task-row reveal" + (state.selected === t.id ? " selected" : "") }, open, del);
    }));
    reveal(list);
  }

  function updatePager() {
    const page = Math.floor(state.offset / state.limit) + 1;
    const pages = state.total != null ? Math.max(1, Math.ceil(state.total / state.limit)) : null;
    pageInfo.textContent = pages ? `Page ${page} of ${pages} \u00B7 ${state.total} tasks` : `Page ${page}`;
    prevBtn.disabled = state.offset === 0 || state.loading;
    nextBtn.disabled = state.loading || (state.total != null ? state.offset + state.limit >= state.total : state.items.length < state.limit);
  }

  async function openDetail(id) {
    state.selected = id;
    renderList();
    detail.hidden = false;
    detail.replaceChildren(h("div", { class: "panel" }, skeleton(3), skeleton(5)));
    if (window.innerWidth < 1024) detail.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const task = await Api.getTask(id);
      const t = normalizeTask(task);
      const close = h("button", { type: "button", class: "icon-btn", "aria-label": "Close details" }, icon("x", 16));
      close.addEventListener("click", () => { state.selected = null; detail.hidden = true; renderList(); });
      const del = h("button", { type: "button", class: "btn btn-danger btn-sm" }, icon("trash", 14), h("span", { class: "btn-label", text: "Delete" }));
      del.addEventListener("click", () => remove(id, del));
      const pipeHost = h("div", { class: "pipeline-host compact" });
      detail.replaceChildren(
        h("div", { class: "detail-head" },
          h("div", {}, h("span", { class: "eyebrow", text: `Task ${t.id ?? ""}` }), h("h2", { class: "detail-title", text: "Task details" }),
            h("p", { class: "muted small", text: formatDate(t.created) })),
          h("div", { class: "detail-actions" }, del, close)),
        panel("Prompt", "send", renderRichText(t.prompt), { actions: copyButton(() => t.prompt || "") }),
        pipeHost, renderTaskResult(task));
      createPipeline(pipeHost).fromTask(task);
      reveal(detail);
      detail.querySelector(".detail-title").focus?.();
    } catch (err) {
      detail.replaceChildren(emptyState("alert", "Could not load this task", err.message));
      toastError(err);
    }
  }

  async function remove(id, btn) {
    const ok = await confirmDialog({ title: "Delete this task?", message: "This permanently removes the task and all its agent outputs. This cannot be undone.", confirmLabel: "Delete task", danger: true });
    if (!ok) return;
    btn.disabled = true;
    try {
      await Api.deleteTask(id);
      toast("Task deleted.", "success");
      if (state.selected === id) { state.selected = null; detail.hidden = true; }
      if (state.items.length === 1 && state.offset > 0) state.offset = Math.max(0, state.offset - state.limit);
      await load();
    } catch (err) {
      btn.disabled = false;
      toastError(err);
    }
  }

  document.querySelectorAll("[data-filter]").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    state.mode = btn.dataset.filter; state.offset = 0; load();
  }));
  limitSel.addEventListener("change", () => { state.limit = Number(limitSel.value); state.offset = 0; load(); });
  prevBtn.addEventListener("click", () => { state.offset = Math.max(0, state.offset - state.limit); load(); });
  nextBtn.addEventListener("click", () => { state.offset += state.limit; load(); });
  refreshBtn.addEventListener("click", load);

  load();
};
