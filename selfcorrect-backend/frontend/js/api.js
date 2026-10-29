// ===== API layer: the single place that talks to the backend =====
// Served by the backend at /app/ -> same-origin "/api". Opened from elsewhere (e.g. a separate static server) -> backend on port 8000.
const API_BASE = location.pathname.startsWith("/app/") ? "/api" : "http://127.0.0.1:8000/api";

// Timeouts (milliseconds). Tasks and benchmarks can be slow, so they get long limits.
const TIMEOUTS = { default: 30000, task: 300000, benchmark: 1800000 };

// --- Session storage helpers (JWT + user live in localStorage) ---
const Auth = {
  TOKEN_KEY: "scmap_token",
  USER_KEY: "scmap_user",
  getToken() { return localStorage.getItem(this.TOKEN_KEY); },
  getUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY) || "null"); }
    catch { return null; }
  },
  setToken(token) { localStorage.setItem(this.TOKEN_KEY, token); },
  setUser(user) { localStorage.setItem(this.USER_KEY, JSON.stringify(user || null)); },
  clear() { localStorage.removeItem(this.TOKEN_KEY); localStorage.removeItem(this.USER_KEY); },
  isAuthed() { return Boolean(this.getToken()); },
};

// A structured error so pages can show friendly messages and per-field errors.
class ApiError extends Error {
  constructor(message, { status = 0, fields = {}, data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
    this.data = data;
  }
}

// Turn FastAPI-style error bodies ({detail: "..."} or {detail: [{loc, msg}]}) into a message + field map.
function parseErrorBody(data, status) {
  // This backend always answers {"error": {"code", "message", "details": [{"field", "message"}]}}.
  const err = data && typeof data === "object" ? data.error : null;
  if (err && typeof err === "object") {
    const fields = {};
    (err.details || []).forEach((d) => { if (d && d.field) fields[String(d.field).split(".").pop()] = d.message; });
    const first = (err.details || [])[0];
    return { message: err.message === "Request validation failed." && first ? first.message : (err.message || "Request failed."), fields };
  }
  const fields = {};
  let message = "";
  const detail = data && (data.detail ?? data.message ?? data.error);
  if (Array.isArray(detail)) {
    detail.forEach((d) => {
      const loc = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
      const msg = String(d.msg || "Invalid value").replace(/^Value error, /i, "");
      if (loc && typeof loc === "string" && loc !== "body") fields[loc] = msg;
    });
    message = detail.map((d) => d.msg).filter(Boolean)[0] || "Please check the highlighted fields.";
  } else if (typeof detail === "string") {
    message = detail;
  }
  if (!message) {
    const defaults = { 400: "The request was invalid.", 401: "Your session has expired. Please sign in again.", 403: "You do not have permission to do that.", 404: "That item could not be found.", 409: "That already exists.", 422: "Please check the highlighted fields.", 429: "Too many requests. Please slow down." };
    message = defaults[status] || (status >= 500 ? "The server ran into a problem. Please try again." : `Request failed (${status}).`);
  }
  return { message, fields };
}

// The one reusable fetch helper used by every endpoint below.
async function request(path, { method = "GET", body, auth = true, timeout = TIMEOUTS.default, query } = {}) {
  let url = API_BASE + path;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") params.set(k, v); });
    const qs = params.toString();
    if (qs) url += "?" + qs;
  }

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = Auth.getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new ApiError(`The request timed out after ${Math.round(timeout / 1000)} seconds.`, { status: 0 });
    throw new ApiError("Cannot reach the server. Make sure the backend is running on port 8000.", { status: 0 });
  }
  clearTimeout(timer);

  // 204 No Content: nothing to parse.
  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const { message, fields } = parseErrorBody(typeof data === "object" ? data : { detail: data }, res.status);
    // An expired/invalid token on a protected call: wipe the session and go to login.
    if (res.status === 401 && auth && token) {
      Auth.clear();
      const onAuthPage = /login\.html|register\.html/.test(location.pathname);
      if (!onAuthPage) {
        sessionStorage.setItem("scmap_flash", "Your session has expired. Please sign in again.");
        location.replace("login.html");
      }
    }
    throw new ApiError(message, { status: res.status, fields, data });
  }
  return data;
}

// Run a task and receive REAL agent progress events as they happen (newline-delimited JSON stream).
async function streamTask(payload, onEvent) {
  const token = Auth.getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.task);
  let res;
  try {
    res = await fetch(API_BASE + "/tasks/stream", { method: "POST", signal: controller.signal, body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new ApiError("The request timed out.", { status: 0 });
    throw new ApiError("Cannot reach the server. Make sure the backend is running on port 8000.", { status: 0 });
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    if (res.ok) return request("/tasks", { method: "POST", body: payload, timeout: TIMEOUTS.task });   // no streaming support: plain call
    let data = null; try { data = await res.json(); } catch {}
    if (res.status === 401 && token) { Auth.clear(); sessionStorage.setItem("scmap_flash", "Your session has expired. Please sign in again."); location.replace("login.html"); }
    const { message, fields } = parseErrorBody(data || {}, res.status);
    throw new ApiError(message, { status: res.status, fields, data });
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", task = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "event") { try { onEvent && onEvent(msg); } catch {} }
        else if (msg.type === "result") task = msg.task;
        else if (msg.type === "error") throw new ApiError(msg.message || "The run did not complete.", { status: 502 });
      }
    }
  } finally { clearTimeout(timer); }
  if (!task) throw new ApiError("The run ended without a result. Please try again.", { status: 0 });
  return task;
}

// --- Endpoint wrappers (only the documented endpoints) ---
const Api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload, auth: false }),
  me: () => request("/auth/me"),

  streamTask,
  createTask: (payload) => request("/tasks", { method: "POST", body: payload, timeout: TIMEOUTS.task }),
  listTasks: ({ limit, offset, mode } = {}) => request("/tasks", { query: { limit, offset, mode } }),
  getTask: (id) => request(`/tasks/${encodeURIComponent(id)}`),
  deleteTask: (id) => request(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),

  stats: () => request("/evaluation/stats"),
  benchmark: () => request("/evaluation/benchmark", { method: "POST", timeout: TIMEOUTS.benchmark }),
};

// Read the token from any common login response shape.
function extractToken(data) {
  return data && (data.access_token || data.token || data.jwt || (data.data && data.data.access_token)) || null;
}

window.API_BASE = API_BASE;
window.Auth = Auth;
window.Api = Api;
window.ApiError = ApiError;
window.extractToken = extractToken;
