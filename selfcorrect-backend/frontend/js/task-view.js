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
    trace: t.trace ?? null,
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
function verificationBadge(verified, mode) {
  const quick = isBaseline(mode);
  if (verified === true) return h("span", { class: "badge badge-good" }, icon("shield", 14), quick ? "Passed checks" : "Verified");
  if (verified === false) return h("span", { class: "badge badge-warn" }, icon("alert", 14), quick ? "Failed a check" : "Not fully verified");
  return h("span", { class: "badge badge-neutral" }, "Unchecked");
}
function modeBadge(mode) {
  return h("span", { class: "badge " + (isBaseline(mode) ? "badge-cobalt" : "badge-violet") }, modeLabel(mode));
}
function renderPlan(plan) {
  if (Array.isArray(plan)) {
    return h("ol", { class: "plan-list" }, plan.map((step, i) => {
      const text = typeof step === "string" ? step : step.description ?? step.step ?? step.title ?? JSON.stringify(step);
      return h("li", {}, h("span", { class: "step-num", text: String(i + 1).padStart(2, "0") }), h("span", { class: "step-text" }, renderInline(text)));
    }));
  }
  if (plan && typeof plan === "object" && Array.isArray(plan.steps)) return renderPlan(plan.steps);
  return renderRichText(plan);
}
function renderIssues(issues) {
  if (isNil(issues) || (Array.isArray(issues) && !issues.length)) return h("p", { class: "muted small", text: "No issues found." });
  const list = Array.isArray(issues) ? issues : [issues];
  return h("ul", { class: "issue-list" }, list.map((it) =>
    h("li", {}, icon("alert", 14), renderInline(typeof it === "string" ? it : it.description ?? it.message ?? it.issue ?? JSON.stringify(it)))));
}
function panel(title, iconName, body, { actions, tone, cls } = {}) {
  return h("section", { class: `panel reveal ${tone ? "panel-" + tone : ""} ${cls || ""}` },
    h("header", { class: "panel-head" },
      h("div", { class: "panel-title" }, h("span", { class: "panel-icon" }, icon(iconName, 16)), h("h3", { text: title })),
      actions ? h("div", { class: "panel-actions" }, actions) : null),
    h("div", { class: "panel-body" }, body));
}
function statTile(label, value, iconName) {
  return h("div", { class: "stat-tile" }, h("span", { class: "stat-label" }, iconName ? icon(iconName, 14) : null, label), h("span", { class: "stat-value", text: value }));
}
const textOf = (v) => (typeof v === "string" ? v : isNil(v) ? "" : JSON.stringify(v, null, 2));
const seconds = (ms) => (isNil(ms) ? DASH : ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms");

// One-line outcome summary built only from REAL fields returned by the API.
function trustChip(t) {
  if (isBaseline(t.mode)) {
    return t.verified === true ? h("span", { class: "trust quick" }, icon("check", 15), "Quick answer · passed automatic checks")
      : h("span", { class: "trust warn" }, icon("alert", 15), "Quick answer · not reviewed, may contain errors");
  }
  const fixed = t.issuesFixed || 0;
  if (t.verified === true && fixed > 0) return h("span", { class: "trust fixed" }, icon("spark", 15), `Verified · ${fixed} issue${fixed === 1 ? "" : "s"} corrected`);
  if (t.verified === true) return h("span", { class: "trust ok" }, icon("shield", 15), "Verified · no issues found");
  const left = Math.max(0, (t.issuesFound || 0) - fixed);
  return h("span", { class: "trust warn" }, icon("alert", 15), `Could not fully verify${left ? ` · ${left} issue${left === 1 ? "" : "s"} remaining` : ""}`);
}

// Collapsible section (accessible disclosure button, animated height).
function accordion(title, subtitle, content, open = false) {
  const body = h("div", { class: "report-body" + (open ? " open" : ""), id: "rep-" + Math.random().toString(36).slice(2, 8) }, h("div", { class: "report-inner" }, h("div", { class: "report-pad" }, content)));
  const btn = h("button", { type: "button", class: "report-toggle", "aria-expanded": String(open), "aria-controls": body.id },
    h("span", { class: "t" }, icon("shield", 18), h("span", {}, title, h("br"), h("span", { class: "s", text: subtitle }))), h("span", { class: "chev" }, icon("chevD", 18)));
  btn.addEventListener("click", () => {
    const now = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(now)); body.classList.toggle("open", now);
    if (now) reveal(body);
  });
  return h("section", { class: "report glass reveal" }, btn, body);
}

// Result = the answer first; everything about HOW it was produced lives in the collapsed Verification report.
function renderLegacyResult(t) {
  const baseline = isBaseline(t.mode);
  const frag = document.createDocumentFragment();

  if (t.error) frag.appendChild(panel("Error", "alert", h("p", { text: textOf(t.error) }), { tone: "danger" }));
  frag.appendChild(h("section", { class: "answer glass reveal" },
    h("div", { class: "answer-head" }, trustChip(t), copyButton(() => textOf(t.final), "Copy answer")),
    renderRichText(t.final)));

  const c = [];
  c.push(h("div", { class: "stats-row" },
    statTile("Mode", modeLabel(t.mode), "layers"),
    statTile("Review rounds", baseline ? DASH : isNil(t.iterationsUsed) ? DASH : `${t.iterationsUsed}${t.maxIterations ? " / " + t.maxIterations : ""}`, "refresh"),
    statTile("Issues fixed", isNil(t.issuesFound) ? DASH : `${t.issuesFixed ?? 0} / ${t.issuesFound}`, "fix"),
    statTile("Time", seconds(t.latencyMs), "clock")));
  if (!baseline && !isNil(t.plan) && (!Array.isArray(t.plan) || t.plan.length)) {
    c.push(h("div", { class: "sub-block" }, h("h4", { text: "Planner" }), renderPlan(t.plan)));
  }
  if (!isNil(t.initial) && (!baseline)) {
    c.push(h("div", { class: "sub-block" }, h("h4", {}, h("span", { text: "First draft (Executor)" }), copyButton(() => textOf(t.initial))), renderRichText(t.initial)));
  }
  if (!baseline) {
    c.push(h("div", { class: "sub-block" }, h("h4", { text: "Critic & Fixer" }),
      t.rounds.length ? h("ol", { class: "timeline" }, t.rounds.map((r) => {
        const tone = verdictTone(r);
        return h("li", { class: `tl-item tl-${tone}` }, h("span", { class: "tl-dot", "aria-hidden": "true" }),
          h("div", { class: "tl-card" },
            h("div", { class: "tl-head" }, h("strong", { text: `Round ${r.round}` }),
              h("span", { class: `badge badge-${tone === "good" ? "good" : tone === "warn" ? "warn" : "neutral"}`, text: r.passed === true ? "Passed" : r.passed === false ? "Needed a fix" : "No verdict" })),
            renderIssues(r.issues),
            !isNil(r.fixed) ? h("div", {}, h("div", { class: "tl-sub" }, h("span", { class: "eyebrow", text: "Fixer revision" }), copyButton(() => textOf(r.fixed))), renderRichText(r.fixed)) : null));
      })) : h("p", { class: "muted", text: "No review rounds were recorded." })));
  } else {
    c.push(h("p", { class: "muted small", text: "Quick mode returns the first answer directly, with no planning or review. Switch to Verified mode to have it checked and corrected." }));
  }
  // Technical details stay available here for debugging; they are intentionally not shown in the main UI.
  c.push(h("div", { class: "sub-block" }, h("h4", { text: "Technical details" }),
    h("dl", { class: "tech" },
      [["Task ID", t.id], ["Provider", t.provider], ["Mode (API)", t.mode], ["Created", formatDate(t.created)]].map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: isNil(v) ? DASH : String(v) }))))));

  const summary = baseline ? "No review performed in Quick mode"
    : `${t.iterationsUsed ?? t.rounds.length} review round${(t.iterationsUsed ?? t.rounds.length) === 1 ? "" : "s"} · ${t.issuesFound ?? 0} issue${t.issuesFound === 1 ? "" : "s"} found · ${seconds(t.latencyMs)}`;
  frag.appendChild(accordion("Verification report", summary, c, true));
  return frag;
}


// ---------------------------------------------------------------------------------------------
// Two different result formats. Quick = the answer and one footer line. Verified = answer + confidence +
// the agents' actual discussion, objection ledger, corrections and unresolved risks (all from trace data).
// ---------------------------------------------------------------------------------------------
const AGENT_NAME = { planner: "Planner", executor: "Executor", critic: "Critic", fixer: "Fixer" };
const AGENT_ICON = { planner: "plan", executor: "exec", critic: "critic", fixer: "fix" };
const SEV_TONE = { blocking: "warn", major: "warn", minor: "neutral" };
const STATUS_TEXT = { open: "Open", resolved: "Resolved", disputed: "Disputed", contested: "Contested", withdrawn: "Withdrawn" };
const STATUS_TONE = { resolved: "good", withdrawn: "good", open: "warn", disputed: "warn", contested: "warn" };
const RISK_LABEL = { open_objection: "Unresolved objection", contested: "Contested", minor: "Minor issue", critic_risk: "Critic could not verify", executor_uncertainty: "Executor was unsure", assumption: "Planner assumption" };

const bullets = (items) => (items && items.length ? h("ul", { class: "mini-list" }, items.map((x) => h("li", {}, renderInline(x)))) : null);
const labelled = (label, node) => (node ? h("div", { class: "kv" }, h("span", { class: "eyebrow", text: label }), node) : null);

function renderQuickResult(t) {
  const tr = t.trace || {};
  const frag = document.createDocumentFragment();
  if (t.error) frag.appendChild(panel("Error", "alert", h("p", { text: textOf(t.error) }), { tone: "danger" }));
  frag.appendChild(h("section", { class: "answer glass reveal quick-answer" },
    renderRichText(t.final),
    h("div", { class: "quick-foot" },
      h("span", { class: "trust quick" }, icon("exec", 14), "Quick · one call · not reviewed"),
      h("span", { class: "muted small", text: `${seconds(t.latencyMs)}${tr.model ? " · " + tr.model : ""}` }),
      t.verified === false ? h("span", { class: "badge badge-warn" }, icon("alert", 14), "Failed an automatic check") : null,
      copyButton(() => textOf(t.final), "Copy answer"))));
  return frag;
}

function confidenceChip(report) {
  const level = report.confidence || "low";
  const tone = level === "high" ? "ok" : level === "medium" ? "fixed" : "warn";
  return h("span", { class: `trust ${tone}`, title: report.confidence_reason || "" },
    icon(level === "high" ? "shield" : "alert", 15), `${level[0].toUpperCase() + level.slice(1)} confidence`);
}

function messageBody(m) {
  const d = m.data || {};
  if (m.agent === "planner") return [labelled("Approach", d.approach ? renderInline(d.approach) : null), labelled("Acceptance checks", bullets(d.checks)), labelled("Risks flagged", bullets(d.risks)), labelled("Assumptions", bullets(d.assumptions))];
  if (m.agent === "executor") return [labelled("Claims it relies on", bullets(d.claims)), labelled("Unsure about", bullets(d.uncertain)), labelled("Departed from plan", bullets(d.deviations))];
  if (m.agent === "critic") return [labelled("Actually verified", bullets(d.verified)), labelled("Rulings on earlier objections", bullets((d.rulings || []).map((r) => `${r.id}: ${r.ruling}${r.reason ? " - " + r.reason : ""}`))), labelled("Could not verify", bullets(d.risks)), d.parsed === false ? h("p", { class: "muted small", text: "The Critic's reply could not be parsed; only deterministic checks applied." }) : null];
  if (m.agent === "fixer") {
    const diff = d.diff || {};
    return [labelled("Responses", bullets((d.responses || []).map((r) => `${r.id} ${r.action.toUpperCase()}${r.reason ? ": " + r.reason : ""}${r.change ? " (changed: " + r.change + ")" : ""}`))),
      diff.samples && diff.samples.length ? labelled("Actual change", h("pre", { class: "diff", text: diff.samples.join("\n") })) : null];
  }
  return [];
}

function renderPipelineResult(t) {
  const tr = t.trace, report = tr.report || {}, stats = report.stats || {};
  const frag = document.createDocumentFragment();
  if (t.error) frag.appendChild(panel("Error", "alert", h("p", { text: textOf(t.error) }), { tone: "danger" }));
  frag.appendChild(h("section", { class: "answer glass reveal" },
    h("div", { class: "answer-head" }, confidenceChip(report), copyButton(() => textOf(t.final), "Copy answer")),
    renderRichText(t.final),
    report.confidence_reason ? h("p", { class: "muted small", text: report.confidence_reason }) : null));

  const c = [];
  c.push(h("div", { class: "stats-row" },
    statTile("Review rounds", String(stats.rounds ?? DASH), "refresh"),
    statTile("Objections resolved", `${stats.resolved ?? 0} / ${stats.found ?? 0}`, "fix"),
    statTile("Model calls", String(stats.llm_calls ?? DASH), "layers"),
    statTile("Time", seconds(t.latencyMs), "clock")));

  if ((report.unresolved_risks || []).length) {
    c.push(h("div", { class: "sub-block risks" }, h("h4", { text: "Unresolved risks" }),
      h("ul", { class: "issue-list" }, report.unresolved_risks.map((r) => h("li", {}, icon("alert", 14), h("span", {}, h("strong", { text: RISK_LABEL[r.kind] || r.kind }), ": ", renderInline(r.text)))))));
  }

  c.push(h("div", { class: "sub-block" }, h("h4", { text: "What each agent contributed" }),
    h("ol", { class: "timeline" }, (tr.messages || []).map((m) => h("li", { class: "tl-item tl-good" }, h("span", { class: "tl-dot", "aria-hidden": "true" }),
      h("div", { class: "tl-card" },
        h("div", { class: "tl-head" }, icon(AGENT_ICON[m.agent] || "spark", 15), h("strong", { text: AGENT_NAME[m.agent] || m.agent }),
          m.round ? h("span", { class: "badge badge-neutral", text: `Round ${m.round}` }) : null, h("span", { class: "muted small", text: seconds(m.ms) })),
        h("p", { class: "small", text: m.summary }), ...messageBody(m)))))));

  const objs = tr.objections || [];
  c.push(h("div", { class: "sub-block" }, h("h4", { text: "Objection ledger" }),
    objs.length ? h("ul", { class: "ledger" }, objs.map((o) => h("li", { class: "ledger-row" },
      h("div", { class: "tl-head" }, h("strong", { text: o.id }), h("span", { class: `badge badge-${SEV_TONE[o.severity] || "neutral"}`, text: o.severity }),
        h("span", { class: "badge badge-neutral", text: o.source === "verifier" ? "Deterministic check" : o.executed ? "Critic · executed check" : "Critic" }),
        h("span", { class: `badge badge-${STATUS_TONE[o.status] || "neutral"}`, text: STATUS_TEXT[o.status] || o.status })),
      h("p", { class: "small" }, renderInline(o.problem)),
      labelled("Evidence", renderInline(o.evidence)),
      o.fixer_action ? labelled(`Fixer (${o.fixer_action})`, renderInline(o.fixer_reason || o.change || "-")) : null,
      o.resolution ? labelled("Outcome", renderInline(o.resolution)) : null)))
      : h("p", { class: "muted small", text: "Nobody raised an objection against this answer." })));

  c.push(h("div", { class: "sub-block" }, h("h4", { text: "Technical details" }),
    h("dl", { class: "tech" }, [["Task ID", t.id], ["Provider", t.provider], ["Mode (API)", t.mode], ["Stopped because", report.decision], ["Created", formatDate(t.created)]]
      .map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: isNil(v) ? DASH : String(v) }))))));

  frag.appendChild(accordion("Review report", `${stats.rounds ?? 0} round${stats.rounds === 1 ? "" : "s"} · ${stats.found ?? 0} serious objection${stats.found === 1 ? "" : "s"} · ${(report.unresolved_risks || []).length} open risk${(report.unresolved_risks || []).length === 1 ? "" : "s"}`, c, true));
  return frag;
}

function renderTaskResult(raw) {
  const t = normalizeTask(raw);
  if (isBaseline(t.mode)) return renderQuickResult(t);
  if (t.trace && t.trace.format === "pipeline") return renderPipelineResult(t);
  return renderLegacyResult(t); // Verified tasks saved before traces existed
}

Object.assign(window, { normalizeTask, renderTaskResult, modeBadge, verificationBadge, isBaseline, panel, statTile, trustChip });


// ===== Agent cards: Planner -> Executor -> Critic -> Fixer. States come from REAL pipeline events. =====
const AGENTS = [
  { id: "planner", name: "Planner", role: "Breaks the task into steps", icon: "plan" },
  { id: "executor", name: "Executor", role: "Writes the first answer", icon: "exec" },
  { id: "critic", name: "Critic", role: "Hunts for mistakes", icon: "critic" },
  { id: "fixer", name: "Fixer", role: "Corrects what is wrong", icon: "fix" },
];
const AGENT_STATE_TEXT = { idle: "Standby", active: "Working", done: "Done", skipped: "Not needed" };
function agentsRow({ quick = false, demo = false } = {}) {
  const refs = {};
  const ol = h("ol", { class: "agents" + (quick ? " single" : "") + (demo ? " demo-loop" : ""), "aria-label": "Agents" },
    AGENTS.map((a, n) => {
      const text = h("span", { text: demo ? "" : AGENT_STATE_TEXT.idle });
      const li = h("li", { class: "agent", "data-agent": a.id, "data-state": "idle", style: `--n:${n}` },
        h("div", { class: "agent-head" }, h("span", { class: "agent-ico" }, icon(a.icon, 16)), h("span", { class: "agent-name", text: a.name })),
        h("div", { class: "agent-role", text: a.role }),
        demo ? null : h("div", { class: "agent-state" }, h("i"), text));
      refs[a.id] = { li, text };
      return li;
    }));
  const set = (id, state, label) => {
    const r = refs[id]; if (!r) return;
    r.li.dataset.state = state; r.text.textContent = label || AGENT_STATE_TEXT[state];
    const total = ol.classList.contains("single") ? 1 : AGENTS.length;
    const finished = ol.classList.contains("single") ? (refs.executor.li.dataset.state === "done" ? 1 : 0) : AGENTS.filter((x) => ["done", "skipped"].includes(refs[x.id].li.dataset.state)).length;
    ol.style.setProperty("--prog", Math.round((finished / total) * 100) + "%");
    ol.classList.toggle("running", AGENTS.some((x) => refs[x.id].li.dataset.state === "active"));
    if (state === "active") { r.li.classList.remove("pop"); void r.li.offsetWidth; r.li.classList.add("pop"); }
  };
  const reset = () => { AGENTS.forEach((a) => set(a.id, "idle")); ol.style.setProperty("--prog", "0%"); };
  // Feed one real event from the streaming API.
  const apply = (e) => {
    const rnd = e.round > 1 ? ` · round ${e.round}` : "";
    if (e.state === "start") return set(e.agent, "active", (e.agent === "critic" ? "Reviewing" : e.agent === "fixer" ? "Fixing" : e.agent === "planner" ? "Planning" : "Writing") + rnd);
    if (e.agent === "critic") return set("critic", "done", e.issues ? `Found ${e.issues} issue${e.issues === 1 ? "" : "s"}${rnd}` : `No issues${rnd}`);
    if (e.agent === "fixer") return set("fixer", "done", "Corrected" + rnd);
    if (e.agent === "planner") return set("planner", "done", `${e.steps} step${e.steps === 1 ? "" : "s"}`);
    return set(e.agent, "done");
  };
  // Settle the row from a finished task (used after the run and for saved tasks).
  const settle = (t) => {
    if (isBaseline(t.mode)) { set("executor", "done"); return; }
    set("planner", "done", `${(t.plan || []).length} steps`); set("executor", "done");
    const rounds = (t.steps || []).length, found = t.issues_found || 0;
    set("critic", "done", found ? `Found ${found} issue${found === 1 ? "" : "s"}` : `No issues${rounds > 1 ? "" : ""}`);
    if (found) set("fixer", "done", t.issues_fixed >= found ? "Corrected" : "Partly corrected"); else set("fixer", "skipped");
  };
  return { el: ol, set, reset, apply, settle, setQuick: (q) => ol.classList.toggle("single", q) };
}
window.agentsRow = agentsRow;
