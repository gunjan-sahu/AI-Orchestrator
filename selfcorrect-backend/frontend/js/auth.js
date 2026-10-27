// ===== Login & Register pages =====
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function setFieldError(form, name, message) {
  const input = form.elements[name];
  const err = form.querySelector(`[data-error-for="${name}"]`);
  if (!input || !err) return;
  err.textContent = message || "";
  input.setAttribute("aria-invalid", message ? "true" : "false");
  input.closest(".field")?.classList.toggle("has-error", Boolean(message));
}
function clearErrors(form) {
  form.querySelectorAll("[data-error-for]").forEach((el) => setFieldError(form, el.dataset.errorFor, ""));
  const banner = form.querySelector(".form-banner");
  if (banner) { banner.hidden = true; banner.textContent = ""; }
}
function showBanner(form, message) {
  const banner = form.querySelector(".form-banner");
  if (banner) { banner.textContent = message; banner.hidden = false; }
}

// Client-side rules that mirror the backend expectations.
const validators = {
  email: (v) => (!v ? "Email is required." : !EMAIL_RE.test(v) ? "Enter a valid email address." : ""),
  full_name: (v) => (!v ? "Full name is required." : v.length < 2 ? "Name must be at least 2 characters." : v.length > 100 ? "Name must be 100 characters or fewer." : ""),
  password: (v, mode) => {
    if (!v) return "Password is required.";
    if (mode === "register") {
      if (v.length < 8) return "Password must be at least 8 characters.";
      if (v.length > 128) return "Password must be 128 characters or fewer.";
      if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return "Use at least one letter and one number.";
    }
    return "";
  },
  confirm: (v, mode, form) => (v !== form.elements.password.value ? "Passwords do not match." : ""),
};

function validate(form, mode) {
  let firstBad = null;
  [...form.querySelectorAll("[data-error-for]")].forEach((el) => {
    const name = el.dataset.errorFor;
    const input = form.elements[name];
    const value = name === "password" || name === "confirm" ? input.value : input.value.trim();
    const msg = validators[name] ? validators[name](value, mode, form) : "";
    setFieldError(form, name, msg);
    if (msg && !firstBad) firstBad = input;
  });
  if (firstBad) firstBad.focus();
  return !firstBad;
}

function wirePasswordToggles(root) {
  root.querySelectorAll(".pw-toggle").forEach((btn) => {
    const input = document.getElementById(btn.dataset.target);
    const sync = () => {
      const shown = input.type === "text";
      btn.replaceChildren(icon(shown ? "eyeOff" : "eye", 18));
      btn.setAttribute("aria-label", shown ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", String(shown));
    };
    btn.addEventListener("click", () => { input.type = input.type === "password" ? "text" : "password"; sync(); input.focus(); });
    sync();
  });
}

// Save token, then load the user (from the response or /auth/me), then enter the app.
async function completeSignIn(data, fallbackEmail) {
  const token = extractToken(data);
  if (!token) throw new ApiError("The server did not return an access token.");
  Auth.setToken(token);
  let user = data.user || null;
  if (!user) {
    try { user = await Api.me(); } catch { user = { email: fallbackEmail }; }
  }
  Auth.setUser(user && user.user ? user.user : user);
  location.replace("index.html");
}

function initAuthForm(mode) {
  const form = document.getElementById("auth-form");
  const submit = form.querySelector("button[type=submit]");
  wirePasswordToggles(form);

  // Re-validate a field as soon as the user fixes it.
  form.addEventListener("input", (e) => {
    const name = e.target.name;
    const errEl = form.querySelector(`[data-error-for="${name}"]`);
    if (errEl && errEl.textContent) {
      const v = name === "password" || name === "confirm" ? e.target.value : e.target.value.trim();
      setFieldError(form, name, validators[name](v, mode, form));
    }
  });

  let pending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pending) return;
    clearErrors(form);
    if (!validate(form, mode)) return;

    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    pending = true;
    setBusy(submit, true, mode === "login" ? "Signing in..." : "Creating account...");
    try {
      if (mode === "register") {
        const full_name = form.elements.full_name.value.trim();
        const reg = await Api.register({ email, full_name, password });
        // Some backends return a token on register; otherwise log in automatically.
        const data = extractToken(reg) ? reg : await Api.login({ email, password });
        toast("Account created. Welcome aboard!", "success");
        await completeSignIn(data, email);
      } else {
        const data = await Api.login({ email, password });
        await completeSignIn(data, email);
      }
    } catch (err) {
      const fieldNames = Object.keys(err.fields || {});
      fieldNames.forEach((f) => setFieldError(form, f, err.fields[f]));
      if (!fieldNames.length) showBanner(form, err.message);
      toastError(err);
      pending = false;
      setBusy(submit, false);
    }
  });
}

window.Pages.login = () => initAuthForm("login");
window.Pages.register = () => initAuthForm("register");
