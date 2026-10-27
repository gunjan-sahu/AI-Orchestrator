// ===== Orchestrator page: compose a prompt and run the pipeline =====
window.Pages.orchestrator = () => {
  const form = document.getElementById("task-form");
  const prompt = document.getElementById("prompt");
  const counter = document.getElementById("char-count");
  const promptError = document.getElementById("prompt-error");
  const iterWrap = document.getElementById("iter-wrap");
  const iterToggle = document.getElementById("iter-toggle");
  const iterInput = document.getElementById("max-iterations");
  const iterValue = document.getElementById("iter-value");
  const submit = document.getElementById("run-btn");
  const results = document.getElementById("results");
  const elapsed = document.getElementById("elapsed");
  const pipeline = createPipeline(document.getElementById("pipeline"));
  const MIN = 5, MAX = 4000;

  const greet = document.getElementById("greeting");
  const user = Auth.getUser();
  if (greet && user && user.full_name) greet.textContent = `Good to see you, ${user.full_name.split(" ")[0]}.`;

  const mode = () => form.elements.mode.value;

  function updateCount() {
    const len = prompt.value.trim().length;
    counter.textContent = `${prompt.value.length.toLocaleString()} / ${MAX.toLocaleString()}`;
    counter.classList.toggle("over", prompt.value.length > MAX);
    if (promptError.textContent && len >= MIN && prompt.value.length <= MAX) setPromptError("");
  }
  function setPromptError(msg) {
    promptError.textContent = msg;
    prompt.setAttribute("aria-invalid", msg ? "true" : "false");
    prompt.closest(".field").classList.toggle("has-error", Boolean(msg));
  }
  function syncMode() {
    const baseline = isBaseline(mode());
    iterWrap.classList.toggle("disabled", baseline);
    iterToggle.disabled = baseline;
    iterInput.disabled = baseline || !iterToggle.checked;
    document.getElementById("mode-hint").textContent = baseline
      ? "Baseline runs a single Executor pass with no planning or critique."
      : "Planner, Executor, Critic and Fixer collaborate and self-correct.";
    if (!running) pipeline.reset();
  }

  prompt.addEventListener("input", updateCount);
  // Ctrl/Cmd + Enter submits (ignored during IME composition).
  prompt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); form.requestSubmit(); }
  });
  form.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", syncMode));
  iterToggle.addEventListener("change", () => { iterInput.disabled = !iterToggle.checked; });
  iterInput.addEventListener("input", () => { iterValue.textContent = iterInput.value; });
  document.querySelectorAll("[data-example]").forEach((btn) => btn.addEventListener("click", () => {
    prompt.value = btn.dataset.example; updateCount(); prompt.focus();
  }));

  let running = false; let timer = null;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (running) return;
    const text = prompt.value.trim();
    if (text.length < MIN) { setPromptError(`Prompt must be at least ${MIN} characters.`); prompt.focus(); return; }
    if (prompt.value.length > MAX) { setPromptError(`Prompt must be ${MAX} characters or fewer.`); prompt.focus(); return; }
    setPromptError("");

    const payload = { prompt: text, mode: mode() };
    if (!isBaseline(payload.mode) && iterToggle.checked) payload.max_iterations = Number(iterInput.value);

    running = true;
    setBusy(submit, true, "Running pipeline...");
    form.classList.add("is-running");
    pipeline.running(payload.mode);
    results.replaceChildren(h("div", { class: "panel results-loading" }, skeleton(2), skeleton(4)));
    results.hidden = false;

    // Real elapsed time since the request was sent (not simulated progress).
    const start = performance.now();
    elapsed.hidden = false;
    const tick = () => { elapsed.textContent = `Elapsed ${((performance.now() - start) / 1000).toFixed(1)} s`; };
    tick(); timer = setInterval(tick, 100);

    try {
      const task = await Api.createTask(payload);
      pipeline.fromTask(task);
      results.replaceChildren(renderTaskResult(task));
      reveal(results);
      toast("Pipeline finished.", "success");
      results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } catch (err) {
      pipeline.error(payload.mode);
      if (err.fields && err.fields.prompt) setPromptError(err.fields.prompt);
      results.replaceChildren(emptyState("alert", "The run did not complete", err.message));
      toastError(err);
    } finally {
      clearInterval(timer);
      running = false;
      setBusy(submit, false);
      form.classList.remove("is-running");
    }
  });

  updateCount();
  syncMode();
};
