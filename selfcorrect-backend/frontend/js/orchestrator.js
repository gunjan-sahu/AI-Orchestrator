// ===== Orchestrator: compose a prompt, run the pipeline, show the answer first =====
window.Pages.orchestrator = () => {
  const form = document.getElementById("task-form");
  const prompt = document.getElementById("prompt");
  const counter = document.getElementById("char-count");
  const promptError = document.getElementById("prompt-error");
  const iterToggle = document.getElementById("iter-toggle");
  const iterInput = document.getElementById("max-iterations");
  const iterValue = document.getElementById("iter-value");
  const submit = document.getElementById("run-btn");
  const results = document.getElementById("results");
  const statusText = document.getElementById("status-text");
  const elapsed = document.getElementById("elapsed");
  const stage = document.getElementById("stage");
  const IDLE_TEXT = "Think. Verify. Refine.";
  const MIN = 5, MAX = 4000;

  const greet = document.getElementById("greeting");
  const user = Auth.getUser();
  const hour = new Date().getHours();
  const part = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  if (user && user.full_name) greet.textContent = `${part}, ${user.full_name.split(" ")[0]}.`;

  const agents = agentsRow();
  document.getElementById("agents-host").append(agents.el);
  const LABEL = { planner: "Planner is planning", executor: "Executor is writing", critic: "Critic is reviewing", fixer: "Fixer is correcting" };
  const mode = () => form.elements.mode.value;
  function setPromptError(msg) {
    promptError.textContent = msg;
    prompt.setAttribute("aria-invalid", msg ? "true" : "false");
    prompt.closest(".field").classList.toggle("has-error", Boolean(msg));
  }
  function updateCount() {
    counter.textContent = `${prompt.value.length.toLocaleString()} / ${MAX.toLocaleString()}`;
    counter.classList.toggle("over", prompt.value.length > MAX);
    if (promptError.textContent && prompt.value.trim().length >= MIN && prompt.value.length <= MAX) setPromptError("");
  }
  function syncMode() {
    const quick = isBaseline(mode());
    agents.setQuick(quick);
    iterToggle.disabled = quick;
    iterInput.disabled = quick || !iterToggle.checked;
    document.getElementById("iter-wrap").style.opacity = quick ? ".5" : "1";
  }

  prompt.addEventListener("input", updateCount);
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); form.requestSubmit(); }
  });
  form.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", syncMode));
  iterToggle.addEventListener("change", () => { iterInput.disabled = !iterToggle.checked; });
  iterInput.addEventListener("input", () => { iterValue.textContent = iterInput.value; });
  document.querySelectorAll("[data-example]").forEach((btn) => btn.addEventListener("click", () => { prompt.value = btn.dataset.example; updateCount(); prompt.focus(); }));

  let running = false, timer = null;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (running) return;
    const text = prompt.value.trim();
    if (text.length < MIN) { setPromptError(`Please write at least ${MIN} characters.`); prompt.focus(); return; }
    if (prompt.value.length > MAX) { setPromptError(`Keep it under ${MAX.toLocaleString()} characters.`); prompt.focus(); return; }
    setPromptError("");

    const payload = { prompt: text, mode: mode() };
    if (!isBaseline(payload.mode) && iterToggle.checked) payload.max_iterations = Number(iterInput.value);

    running = true;
    setBusy(submit, true, "Working…");
    Aurora.setState("working");
    stage.classList.add("compact");
    // Honest status: every agent state below comes from a REAL event streamed by the backend as that agent starts/finishes.
    agents.reset();
    statusText.textContent = "Starting…";
    elapsed.hidden = false;
    const start = performance.now();
    const tick = () => { elapsed.textContent = `${((performance.now() - start) / 1000).toFixed(1)} s`; };
    tick(); timer = setInterval(tick, 100);
    results.replaceChildren(h("div", { class: "answer glass" }, skeleton(4)));
    results.hidden = false;

    try {
      const task = await Api.streamTask(payload, (e) => {
        agents.apply(e);
        if (e.state === "start") statusText.textContent = (LABEL[e.agent] || "Working") + (e.round > 1 ? ` · round ${e.round}` : "") + "…";
      });
      agents.settle(task);
      Aurora.setState("done");
      statusText.textContent = `Done in ${((performance.now() - start) / 1000).toFixed(1)} s`;
      results.replaceChildren(renderTaskResult(task));
      reveal(results);
      results.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    } catch (err) {
      Aurora.setState("error");
      statusText.textContent = "That did not work";
      if (err.fields && err.fields.prompt) setPromptError(err.fields.prompt);
      results.replaceChildren(emptyState("alert", "The run did not complete", err.message));
      toastError(err);
    } finally {
      clearInterval(timer);
      elapsed.hidden = true;
      running = false;
      setBusy(submit, false);
      setTimeout(() => { if (!running) { Aurora.setState("idle"); statusText.textContent = IDLE_TEXT; } }, 4000);
    }
  });

  // Typing placeholder: cycles example questions while the box is empty and not focused.
  const IDEAS = ["What is 17 × 23 − 144 ÷ 12?", "Write a Python function to find the second largest number…", "Explain TCP vs UDP with examples…", "A shop gives 20% off 850, then adds 18% GST…"];
  let ideaN = 0, charN = 0, typing = true, hold = 0;
  setInterval(() => {
    if (document.documentElement.dataset.motion === "off" || prompt.value || document.activeElement === prompt || running) { prompt.placeholder = "Ask anything: maths, code, explanations, analysis…"; return; }
    const text = IDEAS[ideaN];
    if (hold > 0) { hold--; return; }
    if (typing) { charN++; if (charN >= text.length) { typing = false; hold = 22; } } else { charN -= 2; if (charN <= 0) { charN = 0; typing = true; ideaN = (ideaN + 1) % IDEAS.length; hold = 4; } }
    prompt.placeholder = text.slice(0, Math.max(0, charN)) + (charN % 2 ? "▍" : "");
  }, 70);

  updateCount();
  syncMode();
};
