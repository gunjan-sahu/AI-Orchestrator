// ===== Shared task rendering: normalizes API task objects and draws results + pipeline =====

const isBaseline = (mode) => /base/i.test(mode || "");

// Read fields defensively so small naming differences in the API don't break the UI.
function normalizeTask(t) {
  if (!t) return null;
  const rawRounds = t.steps ?? t.critic_rounds ?? t.rounds ?? t.critiques ?? t.revisions ?? [];
  const rounds = (Array.isArray(rawRounds) ? rawRounds : []).map((r, i) => ({
    round: r.number ?? r.round ?? r.iteration ?? r.round_number ?? i + 1,
    verdict: r.verdict ?? r.status ?? r.decision ?? null,
    passed: typeof r.verdict === "string" && /^(pass|fail)$/i.test(r.verdict) ? /^pass$/i.test(r.verdict) : (r.passed ?? r.is_correct ?? r.approved ?? null),
    issues: r.issues ?? r.problems ?? r.errors ?? [],
    feedback: r.feedback ?? r.critique ?? r.reasoning ?? r.comments ?? null,
    fixed: r.fixed_output ?? r.revised_output ?? r.fixer_output ?? r.fix ?? (r.verdict === "fail" && rawRounds[i + 1] ? rawRounds[i + 1].output : null),
    score: r.score ?? r.confidence ?? null,
  }));
  return {
    id: t.id ?? t.task_id,
    prompt: t.prompt,
    mode: t.mode,
    status: t.status ?? null,
    provider: t.provider ?? null,
    issuesFound: t.issues_found ?? null,
    issuesFixed: t.issues_fixed ?? null,
    plan: t.plan ?? t.planner_output ?? null,
    initial: t.initial_output ?? t.executor_output ?? t.draft ?? t.initial_answer ?? null,
    rounds,
    final: t.final_answer ?? t.final_output ?? t.answer ?? t.output ?? t.result ?? null,
    verified: t.verified ?? t.is_verified ?? t.verification_passed ?? t.passed ?? null,
    iterationsUsed: t.iterations_used ?? t.num_iterations ?? t.iteration_count ?? (rawRounds && Array.isArray(rawRounds) ? rounds.length : null),
    maxIterations: t.max_iterations ?? null,
    latencyMs: t.latency_ms ?? t.duration_ms ?? t.elapsed_ms ?? (t.latency_seconds != null ? t.latency_seconds * 1000 : t.duration_seconds != null ? t.duration_seconds * 1000 : null),
    tokens: t.total_tokens ?? t.tokens_used ?? t.tokens ?? null,
    created: t.created_at ?? t.createdAt ?? null,
    error: t.error ?? t.error_message ?? null,
  };
}

function verdictTone(round) {
  if (round.passed === true) return "good";
  if (round.passed === false) return "warn";
  const v = String(round.verdict || "");
  if (/pass|approve|accept|correct|^ok|valid|good|verified/i.test(v) && !/not|fail|incorrect|invalid/i.test(v)) return "good";
  if (!v) return "neutral";
  return "warn";
}
function verificationBadge(verified) {
  if (verified === true) return h("span", { class: "badge badge-good" }, icon("shield", 14), "Verified");
  if (verified === false) return h("span", { class: "badge badge-warn" }, icon("alert", 14), "Not verified");
  return h("span", { class: "badge badge-neutral" }, "Unverified");
}
function modeBadge(mode) {
  return h("span", { class: "badge " + (isBaseline(mode) ? "badge-cobalt" : "badge-violet") }, modeLabel(mode));
}

// Plans may be text, a list of steps, or an object.
function renderPlan(plan) {
  if (Array.isArray(plan)) {
    return h("ol", { class: "plan-list" }, plan.map((step, i) => {
      const text = typeof step === "string" ? step : step.description ?? step.step ?? step.title ?? JSON.stringify(step);
      return h("li", {}, h("span", { class: "step-num", text: String(i + 1).padStart(2, "0") }), h("span", { class: "step-text", text }));
    }));
  }
  if (plan && typeof plan === "object" && Array.isArray(plan.steps)) return renderPlan(plan.steps);
  return renderRichText(plan);
}
function renderIssues(issues) {
  if (isNil(issues) || (Array.isArray(issues) && !issues.length)) return h("p", { class: "muted small", text: "No issues reported." });
  const list = Array.isArray(issues) ? issues : [issues];
  return h("ul", { class: "issue-list" }, list.map((it) =>
    h("li", {}, icon("alert", 14), h("span", { text: typeof it === "string" ? it : it.description ?? it.message ?? it.issue ?? JSON.stringify(it) }))));
}

function panel(title, iconName, body, { actions, tone, cls } = {}) {
  return h("section", { class: `panel reveal ${tone ? "panel-" + tone : ""} ${cls || ""}` },
    h("header", { class: "panel-head" },
      h("div", { class: "panel-title" }, h("span", { class: "panel-icon" }, icon(iconName, 16)), h("h3", { text: title })),
      actions ? h("div", { class: "panel-actions" }, actions) : null),
    h("div", { class: "panel-body" }, body));
}
function statTile(label, value, iconName) {
  return h("div", { class: "stat-tile" },
    h("span", { class: "stat-label" }, iconName ? icon(iconName, 14) : null, label),
    h("span", { class: "stat-value", text: value }));
}
const textOf = (v) => (typeof v === "string" ? v : isNil(v) ? "" : JSON.stringify(v, null, 2));

// Full task result (used on Orchestrator and in History detail).
function renderTaskResult(raw) {
  const t = normalizeTask(raw);
  const frag = document.createDocumentFragment();
  const baseline = isBaseline(t.mode);

  frag.appendChild(h("div", { class: "stats-row reveal" },
    statTile("Mode", modeLabel(t.mode), "layers"),
    statTile("Provider", t.provider ? humanize(t.provider) : DASH, "info"),
    statTile("Iterations", baseline ? DASH : isNil(t.iterationsUsed) ? DASH : `${t.iterationsUsed}${t.maxIterations ? " / " + t.maxIterations : ""}`, "refresh"),
    statTile("Latency", isNil(t.latencyMs) ? DASH : t.latencyMs >= 1000 ? (t.latencyMs / 1000).toFixed(2) + " s" : Math.round(t.latencyMs) + " ms", "clock"),
    statTile("Issues fixed", isNil(t.issuesFound) ? DASH : `${t.issuesFixed ?? 0} / ${t.issuesFound}`, "fix")));

  if (t.error) frag.appendChild(panel("Error", "alert", h("p", { text: textOf(t.error) }), { tone: "danger" }));

  frag.appendChild(panel("Final answer", "shield", renderRichText(t.final), {
    actions: [verificationBadge(t.verified), copyButton(() => textOf(t.final))], cls: "panel-final",
  }));

  if (!baseline && !isNil(t.plan)) {
    frag.appendChild(panel("Planner", "plan", renderPlan(t.plan), { actions: copyButton(() => textOf(t.plan)) }));
  }
  if (!isNil(t.initial)) {
    frag.appendChild(panel(baseline ? "Executor output" : "Initial output (Executor)", "exec", renderRichText(t.initial), { actions: copyButton(() => textOf(t.initial)) }));
  }

  if (!baseline) {
    const body = t.rounds.length
      ? h("ol", { class: "timeline" }, t.rounds.map((r) => {
          const tone = verdictTone(r);
          return h("li", { class: `tl-item tl-${tone}` },
            h("span", { class: "tl-dot", "aria-hidden": "true" }),
            h("div", { class: "tl-card" },
              h("div", { class: "tl-head" },
                h("strong", { text: `Round ${r.round}` }),
                h("span", { class: `badge badge-${tone === "good" ? "good" : tone === "warn" ? "warn" : "neutral"}`, text: r.verdict ? humanize(r.verdict) : r.passed === true ? "Pass" : r.passed === false ? "Needs fix" : "No verdict" }),
                !isNil(r.score) ? h("span", { class: "muted small", text: `Score ${formatValue(r.score)}` }) : null),
              h("div", { class: "tl-section" }, h("span", { class: "eyebrow", text: "Critic issues" }), renderIssues(r.issues)),
              !isNil(r.feedback) ? h("div", { class: "tl-section" }, h("span", { class: "eyebrow", text: "Critic feedback" }), renderRichText(r.feedback)) : null,
              !isNil(r.fixed) ? h("div", { class: "tl-section" },
                h("div", { class: "tl-sub" }, h("span", { class: "eyebrow", text: "Fixer revision" }), copyButton(() => textOf(r.fixed))),
                renderRichText(r.fixed)) : null));
        }))
      : h("p", { class: "muted", text: "No critic rounds were recorded for this task." });
    frag.appendChild(panel("Critic & Fixer rounds", "critic", body));
  }
  return frag;
}

// ---- Animated four-agent pipeline ----
const AGENTS = [
  { id: "planner", name: "Planner", role: "Decomposes the task", icon: "plan" },
  { id: "executor", name: "Executor", role: "Drafts the answer", icon: "exec" },
  { id: "critic", name: "Critic", role: "Audits for errors", icon: "critic" },
  { id: "fixer", name: "Fixer", role: "Repairs the output", icon: "fix" },
];
const STATE_TEXT = { idle: "Standby", running: "Working", done: "Complete", warn: "Issues found", skipped: "Skipped", error: "Failed" };

function createPipeline(host) {
  const nodes = {}; const links = [];
  const track = h("ol", { class: "pipeline", "aria-label": "Agent pipeline status" });
  AGENTS.forEach((a, i) => {
    const status = h("span", { class: "agent-status", text: STATE_TEXT.idle });
    const node = h("li", { class: "agent", dataset: { state: "idle" } },
      h("div", { class: "agent-orb" }, h("span", { class: "agent-ring" }), icon(a.icon, 22)),
      h("div", { class: "agent-meta" }, h("span", { class: "agent-index", text: `0${i + 1}` }), h("strong", { text: a.name }), h("span", { class: "agent-role", text: a.role }), status));
    nodes[a.id] = { node, status };
    track.appendChild(node);
    if (i < AGENTS.length - 1) {
      const link = h("li", { class: "agent-link", "aria-hidden": "true", dataset: { state: "idle" } },
        h("span", { class: "link-line" }), h("span", { class: "particle p1" }), h("span", { class: "particle p2" }), h("span", { class: "particle p3" }));
      links.push(link); track.appendChild(link);
    }
  });
  const loop = h("div", { class: "pipeline-loop", "aria-hidden": "true" }, h("span", { text: "Critic \u21C4 Fixer self-correction loop" }));
  const caption = h("p", { class: "pipeline-caption", role: "status", "aria-live": "polite", text: "Submit a prompt to start the pipeline." });
  host.replaceChildren(track, loop, caption);

  function set(states, message) {
    AGENTS.forEach((a, i) => {
      const s = states[a.id] || "idle";
      nodes[a.id].node.dataset.state = s;
      nodes[a.id].status.textContent = STATE_TEXT[s];
      if (links[i]) {
        const next = states[AGENTS[i + 1].id] || "idle";
        links[i].dataset.state = s === "skipped" || next === "skipped" ? "skipped" : s === "running" ? "running" : s === "done" || s === "warn" ? "done" : "idle";
      }
    });
    loop.dataset.state = states.critic === "running" ? "running" : states.fixer === "done" ? "done" : states.critic === "skipped" ? "skipped" : "idle";
    if (message) caption.textContent = message;
  }
  return {
    show: set,
    reset() { set({}, "Submit a prompt to start the pipeline."); },
    // The backend returns only when finished, so we show an honest "in progress" state, not fake step progress.
    running(mode) {
      if (isBaseline(mode)) set({ planner: "skipped", executor: "running", critic: "skipped", fixer: "skipped" }, "Baseline run in progress on the server. Waiting for the Executor...");
      else set({ planner: "running", executor: "running", critic: "running", fixer: "running" }, "Pipeline running on the server. Results appear when all agents finish.");
    },
    error(mode) {
      const b = isBaseline(mode);
      set({ planner: b ? "skipped" : "error", executor: "error", critic: b ? "skipped" : "error", fixer: b ? "skipped" : "error" }, "The run did not complete.");
    },
    fromTask(raw) {
      const t = normalizeTask(raw);
      if (isBaseline(t.mode)) {
        set({ planner: "skipped", executor: isNil(t.initial) && isNil(t.final) ? "error" : "done", critic: "skipped", fixer: "skipped" }, "Baseline: a single Executor pass, no self-correction.");
        return;
      }
      const anyIssues = t.rounds.some((r) => verdictTone(r) === "warn");
      const anyFix = t.rounds.some((r) => !isNil(r.fixed));
      set({
        planner: isNil(t.plan) ? "idle" : "done",
        executor: isNil(t.initial) && isNil(t.final) ? "error" : "done",
        critic: t.rounds.length ? (anyIssues && !anyFix ? "warn" : "done") : "idle",
        fixer: anyFix ? "done" : "skipped",
      }, `Completed ${t.rounds.length} critic round${t.rounds.length === 1 ? "" : "s"}${anyFix ? " with Fixer revisions" : ""}. ${t.verified === true ? "Final answer verified." : t.verified === false ? "Final answer not verified." : ""}`);
    },
  };
}

Object.assign(window, { normalizeTask, renderTaskResult, createPipeline, modeBadge, verificationBadge, isBaseline, panel, statTile });
