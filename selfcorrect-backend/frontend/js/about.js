// ===== Landing / How it works: call-to-action depends on whether you are signed in =====
window.Pages.about = () => {
  const box = document.getElementById("live-demo");
  if (box) {
    const SCRIPT = [["you", "you", "What is 2 + 3 × 4?"], ["planner", "Planner", "3 steps: find the expression, evaluate in the right order, report the answer"], ["executor", "Executor", "Working left to right: 2 + 3 × 4 = 20. Answer: 20"],
      ["critic", "Critic", "Mistake: multiplication comes before addition. The answer should be 14, not 20."], ["fixer", "Fixer", "Applied the order of operations: 3 × 4 = 12, then 2 + 12 = 14. Answer: 14"], ["ok", "Critic", "Re-checked: passed. Verified answer: 14"]];
    let run = 0;
    const play = async () => {
      const my = ++run; box.replaceChildren();
      for (const [c, tag, text] of SCRIPT) {
        if (my !== run || !box.isConnected) return;
        const body = h("span", { class: "caret" });
        box.append(h("div", { class: "ln", "data-c": c }, h("span", { class: "tag", text: tag }), body));
        if (document.documentElement.dataset.motion === "off") { body.textContent = text; body.classList.remove("caret"); continue; }
        for (let i = 1; i <= text.length; i++) { if (my !== run) return; body.textContent = text.slice(0, i); await new Promise((r) => setTimeout(r, 16)); }
        body.classList.remove("caret"); await new Promise((r) => setTimeout(r, 650));
      }
      await new Promise((r) => setTimeout(r, 4500)); if (my === run) play();
    };
    play();
  }
  const demo = document.getElementById("flow-demo"); if (demo) demo.append(agentsRow({ demo: true }).el);
  const cta = document.getElementById("about-cta");
  cta.replaceChildren(...(Auth.isAuthed()
    ? [h("a", { class: "btn btn-primary btn-lg", href: "index.html" }, icon("plus", 16), h("span", { class: "btn-label", text: "Start a task" }))]
    : [h("a", { class: "btn btn-primary btn-lg", href: "register.html" }, h("span", { class: "btn-label", text: "Get started" }), icon("chevR", 16)),
       h("a", { class: "btn btn-ghost btn-lg", href: "login.html" }, h("span", { class: "btn-label", text: "Sign in" }))]));
};
