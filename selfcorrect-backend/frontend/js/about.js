// ===== How-it-works page: an animated illustration of the four agents (not real data) =====
window.Pages.about = () => {
  const pipe = createPipeline(document.getElementById("pipeline"));
  const steps = [
    [{ planner: "running" }, "Planner: breaking the task into steps..."],
    [{ planner: "done", executor: "running" }, "Executor: writing the first draft..."],
    [{ planner: "done", executor: "done", critic: "running" }, "Critic: auditing the draft for errors..."],
    [{ planner: "done", executor: "done", critic: "warn", fixer: "running" }, "Critic found an issue. Fixer: repairing the answer..."],
    [{ planner: "done", executor: "done", critic: "running", fixer: "done" }, "Critic: re-checking the corrected answer..."],
    [{ planner: "done", executor: "done", critic: "done", fixer: "done" }, "Verified. The corrected answer is returned."],
  ];
  let i = 0, timer = null;
  const play = () => {
    clearInterval(timer); i = 0;
    const next = () => { const [s, msg] = steps[i]; pipe.show(s, msg); i = (i + 1) % steps.length; };
    next();
    timer = setInterval(next, reduceMotion() ? 2500 : 1600);
  };
  document.getElementById("demo-replay").addEventListener("click", play);
  play();

  const cta = document.getElementById("about-cta");
  cta.replaceChildren(Auth.isAuthed()
    ? h("a", { class: "btn btn-primary btn-lg", href: "index.html" }, icon("play", 16), h("span", { class: "btn-label", text: "Open Orchestrator" }))
    : [h("a", { class: "btn btn-primary btn-lg", href: "register.html" }, h("span", { class: "btn-label", text: "Create account" }), icon("chevR", 16)),
       h("a", { class: "btn btn-ghost btn-lg", href: "login.html" }, h("span", { class: "btn-label", text: "Sign in" }))]);
};
