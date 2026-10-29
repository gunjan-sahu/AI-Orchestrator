// ===== Rich text: safe markdown + KaTeX math + highlighted code. Never uses innerHTML on API text. =====
(function () {
  const SAFE_URL = /^(https?:|mailto:)/i;

  // ---- Math (KaTeX is vendored locally; falls back to plain text if it failed to load) ----
  function math(tex, display) {
    const el = h(display ? "div" : "span", { class: display ? "math-block" : "math-inline" });
    try {
      if (window.katex) window.katex.render(tex, el, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
      else el.textContent = tex;
    } catch { el.textContent = tex; }
    return el;
  }

  // ---- Inline: `code`, \(math\), $math$, **bold**, *italic*, [link](url) ----
  const INLINE = /(`+)([^`]+?)\1|\\\((.+?)\\\)|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)|\*\*(?!\s)(.+?)(?<!\s)\*\*|__(?!\s)(.+?)(?<!\s)__|\*(?![\s*])(.+?)(?<![\s*])\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  function inline(text, parent) {
    const re = new RegExp(INLINE.source, "g");
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[2] !== undefined) parent.append(h("code", { class: "inline-code", text: m[2] }));
      else if (m[3] !== undefined) parent.append(math(m[3], false));
      else if (m[4] !== undefined) parent.append(math(m[4], false));
      else if (m[5] !== undefined || m[6] !== undefined) { const s = h("strong"); inline(m[5] ?? m[6], s); parent.append(s); }
      else if (m[7] !== undefined) { const s = h("em"); inline(m[7], s); parent.append(s); }
      else if (m[8] !== undefined) {
        if (SAFE_URL.test(m[9])) { const a = h("a", { href: m[9], target: "_blank", rel: "noopener noreferrer" }); inline(m[8], a); parent.append(a); }
        else parent.append(m[0]);
      }
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // ---- Code highlighting (small tokenizer; escapes everything via text nodes) ----
  const KW = {
    py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False self print",
    js: "const let var function return if else for while do break continue new class extends import export from default async await try catch finally throw typeof instanceof in of null undefined true false this switch case yield interface type",
    sql: "select from where group by order having join left right inner outer on insert into values update set delete create table drop alter as and or not null limit distinct union count sum avg",
    sh: "if then else elif fi for do done while case esac function echo cd ls export in",
    c: "int float double char void long short bool boolean string return if else for while do break continue struct class public private protected static final new include using namespace const true false null nil fn let mut func package import def end",
  };
  const ALIAS = { python: "py", py: "py", javascript: "js", js: "js", ts: "js", typescript: "js", jsx: "js", tsx: "js", json: "js", sql: "sql", bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "sh", ps1: "sh", java: "c", c: "c", cpp: "c", "c++": "c", csharp: "c", cs: "c", go: "c", rust: "c", php: "c", kotlin: "c", swift: "c", ruby: "c" };
  function highlight(code, langKey) {
    const frag = document.createDocumentFragment();
    const words = new Set(KW[langKey].split(" "));
    const comment = langKey === "py" || langKey === "sh" ? "#.*" : langKey === "sql" ? "--.*" : "\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/";
    const re = new RegExp(`(${comment})|("""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'${langKey === "js" ? "|`[\\s\\S]*?`" : ""})|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b[A-Za-z_]\\w*\\b)`, "g");
    let last = 0, m;
    const span = (cls, txt) => frag.append(h("span", { class: cls, text: txt }));
    while ((m = re.exec(code))) {
      if (m.index > last) frag.append(code.slice(last, m.index));
      if (m[1]) span("tk-c", m[1]);
      else if (m[2]) span("tk-s", m[2]);
      else if (m[3]) span("tk-n", m[3]);
      else if (words.has(langKey === "sql" ? m[4].toLowerCase() : m[4])) span("tk-k", m[4]);
      else if (code[re.lastIndex] === "(") span("tk-f", m[4]);
      else frag.append(m[4]);
      last = re.lastIndex;
    }
    if (last < code.length) frag.append(code.slice(last));
    return frag;
  }
  function codeBlock(code, lang) {
    const key = ALIAS[(lang || "").toLowerCase()];
    const codeEl = h("code");
    if (key && code.length < 20000) codeEl.append(highlight(code, key)); else codeEl.textContent = code;
    return h("div", { class: "code-block" },
      h("div", { class: "code-head" }, h("span", { class: "code-lang", text: lang || "text" }), copyButton(code, "Copy")),
      h("pre", {}, codeEl));
  }

  // ---- Blocks ----
  const FENCE = /^\s*```\s*([\w+#.-]*)/;
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  function renderRich(text) {
    const root = h("div", { class: "rich" });
    if (isNil(text)) { root.append(h("p", { class: "muted", text: DASH })); return root; }
    if (typeof text !== "string") { root.append(codeBlock(JSON.stringify(text, null, 2), "json")); return root; }
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    let i = 0, para = [];
    const flush = () => { if (para.length) { const p = h("p", { style: "white-space:pre-line" }); inline(para.join("\n"), p); root.append(p); para = []; } };

    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = FENCE.exec(line))) {                       // fenced code
        flush(); const body = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
        i++; root.append(codeBlock(body.join("\n").replace(/\n+$/, ""), m[1])); continue;
      }
      if (/^\s*\$\$/.test(line) || /^\s*\\\[/.test(line)) { // display math
        flush(); const open = /^\s*\$\$/.test(line) ? "$$" : "\\[", close = open === "$$" ? "$$" : "\\]";
        let buf = line.trim().slice(open.length);
        if (buf.includes(close)) { root.append(math(buf.slice(0, buf.indexOf(close)), true)); i++; continue; }
        const parts = [buf]; i++;
        while (i < lines.length && !lines[i].includes(close)) parts.push(lines[i++]);
        if (i < lines.length) parts.push(lines[i].slice(0, lines[i].indexOf(close)));
        i++; root.append(math(parts.join("\n"), true)); continue;
      }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flush(); const hd = h("h" + m[1].length); inline(m[2], hd); root.append(hd); i++; continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line) && !para.length) { root.append(h("hr")); i++; continue; }
      if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && !TABLE_SEP.test(line)) { // table
        flush(); const head = cells(line); i += 2; const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        const mk = (tag, arr) => h("tr", {}, arr.map((c) => { const el = h(tag); inline(c, el); return el; }));
        root.append(h("table", {}, h("thead", {}, mk("th", head)), h("tbody", {}, rows.map((r) => mk("td", r))))); continue;
      }
      if (/^\s*>\s?/.test(line)) { flush(); const q = []; while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, "")); const bq = h("blockquote"); inline(q.join("\n"), bq); root.append(bq); continue; }
      if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) { // lists (nesting is flattened)
        flush(); const ordered = /^\s*\d+[.)]\s+/.test(line); const list = h(ordered ? "ol" : "ul");
        while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[i])) {
          const li = h("li"); inline(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/, ""), li); list.append(li); i++;
        }
        root.append(list); continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line); i++;
    }
    flush();
    return root;
  }

  // Inline-only rendering (used for short strings such as plan steps and issues).
  function renderInline(text, tag = "span") { const el = h(tag); inline(String(text ?? ""), el); return el; }

  window.renderRichText = renderRich;
  window.renderInline = renderInline;
  window.codeBlock = codeBlock;
})();
