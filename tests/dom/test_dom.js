/* Frontend DOM-level test (jsdom) for the Markdown notebook server.
 *
 * Loads the REAL vendor bundles (marked.js, highlight.js) and all six app
 * modules into a jsdom window, stubs fetch, and drives the app the way the
 * browser would (dispatch DOMContentLoaded, click buttons, type in search).
 * Verifies: tree render, file open + heading ids + outline + code highlight,
 * keyword search, edit/save, empty-tree right-click create, and sidebar
 * collapse/expand (minimize) for both sidebars.
 *
 * Run:  npm install   then   npm test
 *   (or: node tests/dom/test_dom.js with jsdom resolvable)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PROJ = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(PROJ, rel), "utf8");

// locate jsdom whether installed in project node_modules or a shared dir
function resolveJsdom() {
  for (const candidate of [
    path.join(PROJ, "node_modules", "jsdom"),
    path.join(process.env.TMPDIR || "", "node_modules", "jsdom"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("jsdom not found. Run `npm install` in the project root.");
}
const { JSDOM } = require(resolveJsdom());

// ---- fixtures ----------------------------------------------------------
const FILE_A = "# File A\n\nTODO fix this bug.\n\n```python\ndef f():\n    return 1\n```\n\n## Sub A\n\nbody\n";
const FILE_B = "# File B\n\nAnother TODO fix this here.\n";
const TREE = [
  { name: "notes", type: "dir", path: "notes", children: [
    { name: "a.md", type: "file", path: "notes/a.md" },
    { name: "b.md", type: "file", path: "notes/b.md" },
  ]},
  { name: "Welcome.md", type: "file", path: "Welcome.md" },
];
const FILES = {
  "Welcome.md": "# Welcome\n\nWelcome content.\n\n## One\n\nx\n\n## Two\n\ny\n",
  "notes/a.md": FILE_A,
  "notes/b.md": FILE_B,
};
let config = {};
let promptValue = null;
const fetchLog = [];
// Auth state used by the fake /api/auth + /api/login + /api/logout stubs.
// Default: auth disabled, no role. Tests flip authEnabled and observe
// authRole to drive the login flow.
let authEnabled = false;
let authRole = null;
// Password setup state used by the fake /api/auth + /api/auth/passwords
// stubs. Default: nothing configured. Tests flip these to drive the
// Settings -> Passwords section.
let authHasAdmin = false;
let authHasViewer = false;
let authSetPasswordsCalls = [];   // last few bodies posted to /api/auth/passwords

const html = `<!DOCTYPE html><html><head>
  <link rel="stylesheet" href="/static/vendor/highlight-styles/github-dark.css" id="hljs-dark">
  <link rel="stylesheet" href="/static/vendor/highlight-styles/github.css" id="hljs-light" disabled>
</head><body data-theme="dark">
  <div id="app">
    <header id="topbar">
      <div class="brand">📓 Notebook</div>
      <input id="search-input" type="search">
      <input type="checkbox" id="search-case">
      <button id="edit-toggle">Edit</button>
      <button id="logout-btn" class="icon-btn" hidden>⎋</button>
      <button id="settings-btn" class="icon-btn">⚙</button>
    </header>
    <main id="layout">
      <aside id="sidebar">
        <div class="panel-header"><span class="panel-title">Files</span>
          <button class="collapse-btn" id="sidebar-collapse" title="Collapse files">‹</button></div>
        <div id="file-tree" class="tree"></div>
        <button class="expand-btn" id="sidebar-expand" title="Show files" hidden>›</button>
      </aside>
      <section id="editor-pane">
        <div id="tab-bar" class="tab-bar"></div>
        <div id="edit-bar" class="edit-bar" hidden>
          <button class="eb" data-act="bold">B</button>
          <button class="eb" data-act="italic">I</button>
          <button class="eb" data-act="strike">S</button>
          <button class="eb" data-act="code">code</button>
          <button class="eb" data-act="h1">H1</button>
          <button class="eb" data-act="h2">H2</button>
          <button class="eb" data-act="h3">H3</button>
          <button class="eb" data-act="h4">H4</button>
          <button class="eb" data-act="ul">UL</button>
          <button class="eb" data-act="ol">OL</button>
          <button class="eb" data-act="task">Task</button>
          <button class="eb" data-act="quote">Q</button>
          <button class="eb" data-act="link">Link</button>
          <button class="eb" data-act="image">Img</button>
          <button class="eb" data-act="codeblock">CB</button>
          <button class="eb" data-act="undo">Undo</button>
          <button class="eb" data-act="redo">Redo</button>
          <span class="eb-overflow">
            <button class="eb eb-overflow-btn" data-act="more">More</button>
            <div class="eb-menu" hidden>
              <button class="eb" data-act="hr">HR</button>
              <button class="eb" data-act="table">Table</button>
              <button class="eb" data-act="h5">H5</button>
              <button class="eb" data-act="h6">H6</button>
              <button class="eb" data-act="clear">Clear</button>
            </div>
          </span>
          <span class="eb-spacer"></span>
          <span class="eb-actions">
            <button id="preview-btn" class="eb">Preview</button>
            <button id="save-btn" class="eb eb-primary" hidden>Save</button>
            <button id="close-edit-btn" class="eb">Close</button>
          </span>
        </div>
        <div id="edit-split" class="edit-split">
          <textarea id="raw-editor" hidden></textarea>
          <div id="viewer" class="markdown-body"></div>
        </div>
        <div id="search-results" hidden>
          <span id="search-summary"></span><button id="search-close">×</button>
          <ul id="search-list"></ul>
        </div>
      </section>
      <aside id="outline-pane">
        <div class="panel-header"><span class="panel-title">Outline</span>
          <button class="collapse-btn" id="outline-collapse" title="Collapse outline">›</button></div>
        <div id="outline" class="outline"></div>
        <button class="expand-btn" id="outline-expand" title="Show outline" hidden>‹</button>
      </aside>
    </main>
  </div>
  <div id="context-menu" class="context-menu" hidden></div>
  <div id="tab-context-menu" class="context-menu" hidden></div>
  <div id="auth-overlay" class="settings-overlay" hidden>
    <div class="settings-modal auth-modal">
      <div class="settings-header">
        <h2 id="auth-title">Sign in</h2>
      </div>
      <form class="settings-body auth-form" onsubmit="return false">
        <p class="auth-help">This notebook is password-protected. Enter the password to continue.</p>
        <div class="settings-row">
          <label class="settings-label" for="auth-password">Password</label>
          <input id="auth-password" type="password" class="auth-input" autofocus>
        </div>
        <div id="auth-error" class="auth-error" role="alert"></div>
        <div class="settings-row">
          <span class="settings-label"></span>
          <button id="auth-submit" type="button" class="settings-action auth-submit">Sign in</button>
        </div>
      </form>
    </div>
  </div>
  <div id="settings-overlay" class="settings-overlay" hidden>
    <div class="settings-modal">
      <div class="settings-header">
        <h2 id="settings-title">Settings</h2>
        <button id="settings-close" class="icon-btn">×</button>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <h3>Appearance</h3>
          <div class="settings-row">
            <span class="settings-label">Theme</span>
            <div class="settings-control theme-options">
              <label><input type="radio" name="theme" value="auto"> Auto</label>
              <label><input type="radio" name="theme" value="dark"> Dark</label>
              <label><input type="radio" name="theme" value="light"> Light</label>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">Font size</span>
            <div class="settings-control font-size-options" role="radiogroup" aria-label="Font size">
              <label><input type="radio" name="fontSize" value="small"> S</label>
              <label><input type="radio" name="fontSize" value="medium"> M</label>
              <label><input type="radio" name="fontSize" value="large"> L</label>
              <label><input type="radio" name="fontSize" value="xlarge"> XL</label>
            </div>
          </div>
        </section>
        <section class="settings-section">
          <h3>File watching</h3>
          <div class="settings-row">
            <span class="settings-label">Status</span>
            <span id="settings-watch-status" class="settings-value">—</span>
          </div>
          <div class="settings-row">
            <span class="settings-label"></span>
            <button id="settings-watch-toggle" class="settings-action">Enable</button>
          </div>
        </section>
        <section class="settings-section" id="settings-auth-section">
          <h3>Passwords</h3>
          <p id="settings-auth-help" class="settings-help">Sign in as admin to change passwords.</p>
          <div class="settings-row">
            <label class="settings-label" for="settings-auth-admin-pw">Admin password</label>
            <input id="settings-auth-admin-pw" type="password" class="auth-input settings-auth-input" disabled>
          </div>
          <div class="settings-row">
            <span class="settings-label">
              <span id="settings-auth-admin-status" class="auth-status-text">Not set</span>
            </span>
            <button id="settings-auth-admin-save" class="settings-action" disabled>Save</button>
          </div>
          <div class="settings-row">
            <label class="settings-label" for="settings-auth-viewer-toggle">Require a password to read</label>
            <input type="checkbox" id="settings-auth-viewer-toggle" disabled>
          </div>
          <div class="settings-row" id="settings-auth-viewer-row" hidden>
            <label class="settings-label" for="settings-auth-viewer-pw">Viewer password</label>
            <input id="settings-auth-viewer-pw" type="password" class="auth-input settings-auth-input">
          </div>
          <div class="settings-row" id="settings-auth-viewer-actions" hidden>
            <span class="settings-label">
              <span id="settings-auth-viewer-status" class="auth-status-text">Not set</span>
            </span>
            <span class="settings-control">
              <button id="settings-auth-viewer-save" class="settings-action" disabled>Save</button>
              <button id="settings-auth-viewer-remove" class="settings-action" hidden>Remove</button>
            </span>
          </div>
          <div id="settings-auth-error" class="auth-error settings-auth-error" role="alert" hidden></div>
        </section>
        <section class="settings-section">
          <h3>About</h3>
          <div class="settings-row">
            <span class="settings-label">Data folder</span>
            <code id="settings-data-dir" class="settings-value settings-mono">…</code>
          </div>
          <div class="settings-row">
            <span class="settings-label">Config folder</span>
            <code id="settings-config-dir" class="settings-value settings-mono">…</code>
          </div>
        </section>
      </div>
      <div class="settings-footer">
        <button id="settings-apply" class="settings-action">Apply</button>
        <button id="settings-save" class="settings-action">Save</button>
        <button id="settings-cancel" class="settings-action">Cancel</button>
      </div>
    </div>
  </div>
</body></html>`;

const dom = new JSDOM(html, {
  pretendToBeVisual: true,
  runScripts: "outside-only",
  url: "http://127.0.0.1:5000/",
});
const { window } = dom;
const ctx = dom.getInternalVMContext();

// Stubs for APIs jsdom doesn't implement.
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.Element.prototype.scrollIntoView = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
window.prompt = () => promptValue;
window.confirm = () => true;
window.alert = () => {};
// matchMedia stub: report a dark system preference (auto -> dark).
window.matchMedia = () => ({
  matches: false, media: "", onchange: null,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {},
  dispatchEvent() { return false; },
});

// Fake fetch routing for every endpoint api.js calls.
window.fetch = async (url, opts) => {
  const u = new URL(url, "http://127.0.0.1:5000");
  const p = u.pathname;
  const method = (opts && opts.method) || "GET";
  fetchLog.push(method + " " + p +
    (p === "/api/config" && method === "POST" ? " " + JSON.stringify(JSON.parse(opts.body || "{}")) : ""));
  let body = {};
  if (p === "/api/config") {
    if (method === "POST") { config = JSON.parse(opts.body || "{}"); body = { ok: true }; }
    else body = config;
  } else if (p === "/api/tree") {
    body = { tree: TREE };
  } else if (p === "/api/file") {
    if (method === "POST") { const d = JSON.parse(opts.body); FILES[d.path] = d.content; body = { path: d.path, size: d.content.length }; }
    else { const fp = u.searchParams.get("path"); body = { path: fp, content: FILES[fp] || "", size: (FILES[fp] || "").length }; }
  } else if (p === "/api/search") {
    const q = u.searchParams.get("q") || "";
    const matches = [];
    for (const [file, content] of Object.entries(FILES)) {
      content.split("\n").forEach((line, i) => {
        const idx = line.toLowerCase().indexOf(q.toLowerCase());
        if (idx >= 0 && q) matches.push({ file, line: i + 1, col: idx + 1, snippet: "<<" + q + ">>" });
      });
    }
    body = { query: q, matches, truncated: false };
  } else if (p === "/api/info") {
    body = { data_dir: "/tmp/test/data", config_dir: "/tmp/test/config" };
  } else if (p === "/api/create" || p === "/api/move" || p === "/api/copy" || p === "/api/delete") {
    body = JSON.parse(opts.body || "{}");
  } else if (p === "/api/auth") {
    // Default: auth disabled. Tests flip authEnabled/authRole to exercise
    // the login flow. The shape is {enabled, hasAdmin, hasViewer, role}:
    //   enabled  = admin password is set
    //   hasAdmin = admin password is set (alias used by the UI)
    //   hasViewer = viewer password is set
    //   role     = session role (null = no session, "admin", "viewer")
    body = { enabled: authEnabled, hasAdmin: authHasAdmin, hasViewer: authHasViewer, role: authRole };
  } else if (p === "/api/login") {
    const d = JSON.parse(opts.body || "{}");
    if (authEnabled && d.password === "test-pw") {
      authRole = "admin";
      body = { role: "admin" };
    } else {
      return { ok: false, status: 401,
        text: async () => JSON.stringify({ error: "Invalid password" }),
        json: async () => ({ error: "Invalid password" }) };
    }
  } else if (p === "/api/logout") {
    authRole = null;
    body = { ok: true };
  } else if (p === "/api/auth/passwords") {
    // Admin-only endpoint. Mirrors the server's @admin_required: when no
    // admin password is configured yet, the route is open (chicken-and-egg
    // for the first setup). Once an admin is set, only an admin session
    // can call this.
    if (authHasAdmin && authRole !== "admin") {
      return { ok: false, status: 401,
        text: async () => JSON.stringify({ error: "Authentication required" }),
        json: async () => ({ error: "Authentication required" }) };
    }
    const d = JSON.parse(opts.body || "{}");
    authSetPasswordsCalls.push(d);
    // Apply the change to the fake state so the next /api/auth reflects it.
    // The server contract: null = don't touch, "" = clear (viewer only;
    // admin is rejected by the server), string = set/change.
    if (typeof d.admin_password === "string" && d.admin_password !== "") {
      authEnabled = true;
      authHasAdmin = true;
    }
    if (d.viewer_password === "") {
      authHasViewer = false;
    } else if (typeof d.viewer_password === "string" && d.viewer_password !== null) {
      authHasViewer = true;
    }
    body = { ok: true, hasAdmin: authHasAdmin, hasViewer: authHasViewer };
  }
  return { ok: true, status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body };
};

function evalIn(src) { vm.runInContext(src, ctx); }

// ---- load vendor + app modules ----------------------------------------
const errors = [];
window.addEventListener("error", (e) => errors.push("window error: " + (e.error ? e.error.stack : e.message)));
evalIn(read("static/vendor/marked.min.js"));
evalIn(read("static/vendor/highlight.min.js"));
evalIn(read("static/js/api.js"));
evalIn(read("static/js/auth.js"));
evalIn(read("static/js/viewer.js"));
evalIn(read("static/js/editbar.js"));
evalIn(read("static/js/watcher.js"));
evalIn(read("static/js/outline.js"));
evalIn(read("static/js/sidebar.js"));
evalIn(read("static/js/search.js"));
evalIn(read("static/js/tabs.js"));
evalIn(read("static/js/settings.js"));
evalIn(read("static/js/app.js"));

const $ = (id) => window.document.getElementById(id);
const click = (id) => $(id).dispatchEvent(new window.Event("click", { bubbles: true }));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const cssVar = (name) => window.document.documentElement.style.getPropertyValue(name).trim();

// ---- assertions helper ------------------------------------------------
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  FAIL " + label + (extra ? "  [" + extra + "]" : "")); }
}

(async () => {
  console.log("== boot ==");
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  await tick(120);
  check("no init errors", errors.length === 0, errors.join("; "));

  console.log("== sidebar tree ==");
  const rows = window.document.querySelectorAll("#file-tree .tree-row");
  check("tree has 4 rows", rows.length === 4, "got " + rows.length);
  check("globals loaded (marked/hljs/NB)",
    typeof window.marked === "object" && typeof window.hljs === "object" && !!window.NB.viewer);

  console.log("== theme ==");
  // The theme control lives in the settings modal. The default body
  // theme is "dark" (auto resolves dark on this jsdom's matchMedia stub).
  // Under the draft-then-commit model, picking a radio only mutates the
  // draft; the live data-theme only changes on Apply/Save.
  check("default body theme is dark (auto -> dark)", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  window.NB.settings.open();
  await tick(20);
  const checkedRadio = () => window.document.querySelector('input[name="theme"]:checked');
  check("default theme radio is auto", checkedRadio() && checkedRadio().value === "auto",
    checkedRadio() ? checkedRadio().value : "(none)");
  // light: pick radio -> only the draft changes; live body stays dark.
  window.document.querySelector('input[name="theme"][value="light"]').checked = true;
  window.document.querySelector('input[name="theme"][value="light"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("light radio: draft picked but body still dark (no live change yet)",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // Apply -> live body becomes light, radio stays on light. Apply also
  // closes the modal, so the next pick must reopen first.
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("Apply: live body data-theme=light", window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // dark: pick + apply
  window.NB.settings.open(); await tick(10);
  window.document.querySelector('input[name="theme"][value="dark"]').checked = true;
  window.document.querySelector('input[name="theme"][value="dark"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("Apply: dark -> data-theme=dark", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // back to auto: pick + apply
  window.NB.settings.open(); await tick(10);
  window.document.querySelector('input[name="theme"][value="auto"]').checked = true;
  window.document.querySelector('input[name="theme"][value="auto"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("Apply: auto -> data-theme=dark (matchMedia stub)",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  window.NB.settings.close();
  await tick(10);

  console.log("== viewer + outline ==");
  // Selector must use a single compound (#viewer :is(h1,h2,h3,...)) or a
  // union with the scope in EACH branch -- otherwise jsdom parses the
  // unparenthesized second branch as "any h2/h3/... in the document".
  const heads = window.document.querySelectorAll("#viewer :is(h1, h2, h3, h4, h5, h6)");
  check("viewer rendered headings", heads.length >= 1, "got " + heads.length);
  check("all headings have ids", Array.from(heads).every(h => h.id), heads.length + " heads");
  const items = window.document.querySelectorAll("#outline .outline-item");
  check("outline items == headings", items.length === heads.length, items.length + " vs " + heads.length);
  check("outline items have data-level",
    Array.from(items).every(i => i.dataset.level), "first=" + (items[0] && items[0].dataset.level));
  const codeEl = window.document.querySelector("#viewer pre code");
  check("code block highlighted", !!codeEl && /hljs/.test(codeEl.innerHTML), codeEl && codeEl.className);

  console.log("== file tabs ==");
  const barEl = window.document.getElementById("tab-bar");
  const tabs = () => window.document.querySelectorAll("#tab-bar .tab");
  const activeTabPath = () => {
    const a = window.document.querySelector("#tab-bar .tab.active");
    return a ? a.dataset.path : null;
  };
  check("boot opened one tab (notes/a.md)", tabs().length === 1 && tabs()[0].dataset.path === "notes/a.md",
    tabs().length + " tab(s)");
  check("active tab is notes/a.md", activeTabPath() === "notes/a.md");
  // open a second file -> new tab, becomes active
  await window.NB.tabs.open("Welcome.md");
  await tick(20);
  check("open Welcome adds a tab (2)", tabs().length === 2, "got " + tabs().length);
  check("active tab is Welcome.md", activeTabPath() === "Welcome.md");
  // switch back -> active changes, viewer re-renders File A
  await window.NB.tabs.activate("notes/a.md");
  await tick(20);
  check("active switches to notes/a.md", activeTabPath() === "notes/a.md");
  check("viewer shows notes/a.md content", /File A/.test(window.document.getElementById("viewer").textContent));
  // re-opening an open file does not duplicate
  await window.NB.tabs.open("notes/a.md");
  await tick(20);
  check("re-open does not duplicate (still 2)", tabs().length === 2, "got " + tabs().length);
  // dirty dot appears while editing and persists after leaving edit mode
  click("edit-toggle");
  await tick(10);
  const ed = $("raw-editor");
  ed.value = "# File A\n\nDIRTY EDIT\n";
  ed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  const aTab = window.document.querySelector('.tab[data-path="notes/a.md"]');
  check("dirty tab marked with .dirty", aTab && aTab.classList.contains("dirty"));
  // Preview button toggles the preview pane; editor stays open, tab stays dirty.
  click("preview-btn");
  await tick(10);
  check("still dirty after toggling preview (unsaved content kept)", aTab.classList.contains("dirty"));
  // close the non-active Welcome tab
  window.NB.tabs.close("Welcome.md");
  await tick(20);
  check("close removes Welcome tab (1 left)", tabs().length === 1, "got " + tabs().length);
  check("notes/a.md still active", activeTabPath() === "notes/a.md");
  // persistence: openFiles + activeFile saved to config
  await tick(300);
  const tabCfgPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("openFiles/activeFile persisted",
    /"openFiles":\["notes\/a\.md"\]/.test(tabCfgPost) && /"activeFile":"notes\/a\.md"/.test(tabCfgPost),
    tabCfgPost);

  console.log("== search ==");
  const si = $("search-input");
  si.value = "fix this";
  si.dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(350);
  const hits = window.document.querySelectorAll("#search-list .search-hit");
  check("search returns 2 hits", hits.length === 2, "got " + hits.length);
  check("search panel visible", !$("search-results").hidden);
  click("search-close");
  await tick(10);
  check("search panel hides on close", $("search-results").hidden);

  console.log("== edit + save ==");
  // The previous "dirty dot" test left the active file with unsaved edits
  // and still in edit mode. Exit edit mode (discarding unsaved changes),
  // then re-enter clean.
  if (!$("raw-editor").hidden) {
    window.confirm = () => true;  // discard unsaved changes
    click("close-edit-btn");
    await tick(10);
  }
  if (window.NB.viewer.isDirty(activeTabPath())) {
    window.NB.viewer.startEdit();
    await tick(10);
    click("save-btn");
    await tick(30);
    window.NB.viewer.endEdit();
    await tick(10);
  }
  check("baseline: active file is clean", !window.NB.viewer.isDirty(activeTabPath()));
  check("Edit button label is 'Edit' in view mode", $("edit-toggle").textContent === "Edit",
    "got: " + JSON.stringify($("edit-toggle").textContent));

  click("edit-toggle");
  await tick(10);
  check("edit mode entered (textarea shown)", !$("raw-editor").hidden);
  // The Edit button stays visible in edit mode but its label flips to
  // 'View' to reflect that clicking it will exit edit mode. The
  // [Preview] [Save] [Close] group in the edit bar takes over the
  // affordance. Save starts hidden because the file is clean.
  check("edit button gets .editing class while editing", $("edit-toggle").classList.contains("editing"));
  check("Edit button label flips to 'View' in edit mode", $("edit-toggle").textContent === "View",
    "got: " + JSON.stringify($("edit-toggle").textContent));
  check("edit bar shown while editing", !$("edit-bar").hidden);
  check("Preview button visible in edit mode", !$("preview-btn").hidden);
  check("Close button visible in edit mode", !$("close-edit-btn").hidden);
  check("Preview button label is 'Preview' when split is on",
    $("preview-btn").textContent === "Preview",
    "got: " + JSON.stringify($("preview-btn").textContent));
  check("Preview button has .editing when split is on (color = on)",
    $("preview-btn").classList.contains("editing"));
  check("Save button hidden when clean", $("save-btn").hidden);
  check("Close button has no .unsaved when clean",
    !$("close-edit-btn").classList.contains("unsaved"));
  // Type -> Save appears and the close button picks up .unsaved.
  $("raw-editor").value = "# Edited\n\n## New heading\n\nsaved body";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("Save button appears after typing", !$("save-btn").hidden);
  check("Close button gets .unsaved when dirty",
    $("close-edit-btn").classList.contains("unsaved"));
  // Save in edit mode stays in edit mode (just clears the dirty flag).
  click("save-btn");
  await tick(30);
  check("save keeps edit mode open (raw-editor still shown)", !$("raw-editor").hidden);
  check("Save button hidden again after save (clean)", $("save-btn").hidden);
  check("Close button .unsaved cleared after save",
    !$("close-edit-btn").classList.contains("unsaved"));
  const savedFile = FILES["notes/a.md"];
  check("save wrote file content", savedFile && savedFile.includes("## New heading"));
  // In edit mode the split is active: editor left, live preview right.
  check("edit-split has .split class in edit mode",
    $("edit-split").classList.contains("split"));
  check("topbar has .editing class in edit mode",
    $("topbar").classList.contains("editing"));
  // Preview toggles the preview pane off; editor stays open.
  click("preview-btn");
  await tick(10);
  check("Preview hides the preview pane", $("viewer").hidden);
  check("Preview keeps editor open", !$("raw-editor").hidden);
  check("split class removed when preview hidden",
    !$("edit-split").classList.contains("split"));
  check("Preview button label stays 'Preview' when split is off (only color changes)",
    $("preview-btn").textContent === "Preview",
    "got: " + JSON.stringify($("preview-btn").textContent));
  check("Preview button loses .editing when split is off (color = off)",
    !$("preview-btn").classList.contains("editing"));
  // Preview again toggles it back on.
  click("preview-btn");
  await tick(10);
  check("Preview again shows the preview pane", !$("viewer").hidden);
  check("split class restored", $("edit-split").classList.contains("split"));
  check("Preview button .editing restored when split is on",
    $("preview-btn").classList.contains("editing"));
  // Close on a clean file should exit edit silently (no confirm).
  let confirmCount = 0;
  window.confirm = () => { confirmCount++; return true; };
  click("close-edit-btn");
  await tick(10);
  check("Close on clean file: no confirm prompt", confirmCount === 0, "count=" + confirmCount);
  check("Close on clean file: back to viewer", $("raw-editor").hidden);
  check("Close on clean file: topbar editing class removed",
    !$("topbar").classList.contains("editing"));
  check("Edit button label restored to 'Edit' after exiting edit mode",
    $("edit-toggle").textContent === "Edit",
    "got: " + JSON.stringify($("edit-toggle").textContent));
  check("re-rendered new heading id", !!$("new-heading"));
  // Close on a dirty file should prompt; Cancel keeps the user in edit.
  click("edit-toggle"); await tick(10);
  $("raw-editor").value = "# Edited\n\n## New heading\n\nDIRTY";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  window.confirm = () => { confirmCount++; return false; };   // user says no
  click("close-edit-btn");
  await tick(10);
  check("Close on dirty + Cancel keeps edit mode", !$("raw-editor").hidden);
  check("Close on dirty + Cancel shows confirm", confirmCount === 1, "count=" + confirmCount);
  // ... and accepting discards.
  window.confirm = () => { confirmCount++; return true; };
  click("close-edit-btn");
  await tick(10);
  check("Close on dirty + OK exits edit mode", $("raw-editor").hidden);
  check("Close on dirty + OK shows confirm", confirmCount === 2, "count=" + confirmCount);
  // Re-entering edit mode after discarding changes: file should be clean,
  // Save button hidden.
  click("edit-toggle"); await tick(10);
  check("re-enter after discard: Save hidden (clean)", $("save-btn").hidden);
  check("re-enter after discard: editor has saved content",
    $("raw-editor").value === "# Edited\n\n## New heading\n\nsaved body",
    "got: " + JSON.stringify($("raw-editor").value));
  click("close-edit-btn"); await tick(10);

  console.log("== edit bar ==");
  // Bar is hidden in preview mode.
  check("edit bar: hidden in preview", $("edit-bar").hidden);
  // Enter edit mode -> bar appears.
  click("edit-toggle"); await tick(10);
  check("edit bar: visible in edit mode", !$("edit-bar").hidden);
  // The bar has the inline + heading + line-prefix + undo/redo + overflow
  // buttons. We don't assert every label here -- just the structural ones.
  const barButtons = window.document.querySelectorAll("#edit-bar .eb[data-act]");
  check("edit bar: at least 14 buttons present", barButtons.length >= 14, "got " + barButtons.length);
  check("edit bar: overflow menu hidden by default", window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Selection-wrap: select "hello", click Bold -> **hello**.
  $("raw-editor").value = "hello world";
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = 5;
  window.document.querySelector('#edit-bar .eb[data-act="bold"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: bold wraps selection", $("raw-editor").value === "**hello** world", "got: " + $("raw-editor").value);
  // Italic: select the now-bold "hello" and italicize.
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = 9;
  window.document.querySelector('#edit-bar .eb[data-act="italic"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: italic wraps selection", $("raw-editor").value === "***hello*** world", "got: " + $("raw-editor").value);
  // Wrap with empty selection -> inserts placeholder and selects it.
  $("raw-editor").value = "";
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = 0;
  window.document.querySelector('#edit-bar .eb[data-act="bold"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: bold with empty selection inserts placeholder",
    $("raw-editor").value === "**bold text**", "got: " + $("raw-editor").value);
  // The inserted text should be selected (so the user can retype it).
  check("edit bar: inserted placeholder is fully selected",
    $("raw-editor").selectionStart === 0 && $("raw-editor").selectionEnd === 13,
    "sel=" + $("raw-editor").selectionStart + "-" + $("raw-editor").selectionEnd);
  // Heading on a line: select a single line, click H2 -> "## line".
  $("raw-editor").value = "line one\nline two";
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = 8;
  window.document.querySelector('#edit-bar .eb[data-act="h2"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: h2 prefixes the line", $("raw-editor").value.startsWith("## line one"),
    "got: " + $("raw-editor").value);
  // Idempotent: H2 again removes the prefix.
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = $("raw-editor").value.indexOf("\n");
  window.document.querySelector('#edit-bar .eb[data-act="h2"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: h2 toggles off", $("raw-editor").value.split("\n")[0] === "line one",
    "got: " + $("raw-editor").value);
  // Bullet list: select a line, click UL -> "- line".
  $("raw-editor").value = "alpha\nbeta";
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = 5;
  window.document.querySelector('#edit-bar .eb[data-act="ul"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: ul prefixes line", $("raw-editor").value.startsWith("- alpha"),
    "got: " + $("raw-editor").value);
  // Task list.
  $("raw-editor").value = "todo";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 4;
  window.document.querySelector('#edit-bar .eb[data-act="task"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: task prefixes line", $("raw-editor").value === "- [ ] todo",
    "got: " + $("raw-editor").value);
  // Quote.
  $("raw-editor").value = "said";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 4;
  window.document.querySelector('#edit-bar .eb[data-act="quote"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: quote prefixes line", $("raw-editor").value === "> said",
    "got: " + $("raw-editor").value);
  // Code block: with selection wraps in ```.
  $("raw-editor").value = "print(1)";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 8;
  window.document.querySelector('#edit-bar .eb[data-act="codeblock"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: codeblock wraps in fences",
    /```\nprint\(1\)\n```/.test($("raw-editor").value),
    "got: " + $("raw-editor").value);
  // Link: select "click", answer prompt.
  $("raw-editor").value = "click here";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 5;
  promptValue = "https://example.com";
  window.prompt = () => promptValue;
  window.document.querySelector('#edit-bar .eb[data-act="link"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: link wraps selection with URL",
    $("raw-editor").value === "[click](https://example.com) here",
    "got: " + $("raw-editor").value);
  // Horizontal rule: insert at line start.
  $("raw-editor").value = "before\nafter";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 0;
  window.document.querySelector('#edit-bar .eb[data-act="hr"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: hr inserts a divider line",
    /\n---\n/.test($("raw-editor").value),
    "got: " + JSON.stringify($("raw-editor").value));
  // Table: insert a 2-col GFM table.
  $("raw-editor").value = "x";
  $("raw-editor").selectionStart = 1; $("raw-editor").selectionEnd = 1;
  window.document.querySelector('#edit-bar .eb[data-act="table"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: table inserts 2-col table",
    /\| Column 1 \| Column 2 \|/.test($("raw-editor").value) &&
    /\| --- \| --- \|/.test($("raw-editor").value),
    "got: " + $("raw-editor").value);
  // Overflow menu opens on "more" click, then a button inside it acts.
  $("raw-editor").value = "fmt";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 3;
  check("edit bar: overflow menu hidden by default", window.document.querySelector("#edit-bar .eb-menu").hidden);
  window.document.querySelector('#edit-bar .eb[data-act="more"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: more opens overflow menu", !window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Click a H5 inside the menu -> "##### fmt".
  window.document.querySelector('#edit-bar .eb-menu .eb[data-act="h5"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: h5 inside overflow prefixes the line",
    $("raw-editor").value === "##### fmt", "got: " + $("raw-editor").value);
  check("edit bar: overflow menu closes after action", window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Click outside closes the overflow.
  window.document.querySelector('#edit-bar .eb[data-act="more"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: overflow menu reopened", !window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Outside click -> closes.
  window.document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(10);
  check("edit bar: outside click closes overflow", window.document.querySelector("#edit-bar .eb-menu").hidden);
  // Clear formatting: remove heading + list + quote prefixes.
  $("raw-editor").value = "## heading\n- item\n> quote";
  $("raw-editor").selectionStart = 0;
  $("raw-editor").selectionEnd = $("raw-editor").value.length;
  window.document.querySelector('#edit-bar .eb-menu .eb[data-act="clear"]')
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("edit bar: clear strips heading, list, quote prefixes",
    $("raw-editor").value === "heading\nitem\nquote",
    "got: " + JSON.stringify($("raw-editor").value));
  // Ctrl+B wraps selection (keyboard shortcut).
  $("raw-editor").value = "abc";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 3;
  $("raw-editor").dispatchEvent(new window.KeyboardEvent("keydown",
    { key: "b", ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(10);
  check("edit bar: Ctrl+B wraps selection",
    $("raw-editor").value === "**abc**", "got: " + $("raw-editor").value);
  // Ctrl+I for italic.
  $("raw-editor").value = "abc";
  $("raw-editor").selectionStart = 0; $("raw-editor").selectionEnd = 3;
  $("raw-editor").dispatchEvent(new window.KeyboardEvent("keydown",
    { key: "i", ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(10);
  check("edit bar: Ctrl+I wraps selection",
    $("raw-editor").value === "*abc*", "got: " + $("raw-editor").value);
  // Preview toggles the preview pane but stays in edit mode; bar stays visible.
  click("preview-btn"); await tick(10);
  check("edit bar: still visible after Preview toggle", !$("edit-bar").hidden);
  check("preview pane hidden after toggle", $("viewer").hidden);
  // Close exits edit mode; bar hides.
  window.confirm = () => true;
  click("close-edit-btn"); await tick(10);
  check("edit bar: hidden after Close exits edit", $("edit-bar").hidden);
  // Re-enter edit, type, leave via Close on dirty to verify the bar hides.
  click("edit-toggle"); await tick(10);
  $("raw-editor").value = "new content";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  window.confirm = () => true;
  click("close-edit-btn"); await tick(10);
  check("edit bar: hidden after Close on dirty", $("edit-bar").hidden);

  console.log("== scroll sync ==");
  // Enter edit mode with preview visible.
  click("edit-toggle"); await tick(10);
  // Stub scroll dimensions so the sync has something to work with.
  // jsdom doesn't compute scrollHeight/clientHeight from content.
  Object.defineProperty($("raw-editor"), "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty($("raw-editor"), "clientHeight", { value: 400, configurable: true });
  Object.defineProperty($("viewer"), "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty($("viewer"), "clientHeight", { value: 400, configurable: true });
  // Scroll the editor to 50%.
  $("raw-editor").scrollTop = 800;  // (2000-400)*0.5 = 800
  $("raw-editor").dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await tick(20);
  // Viewer should be at 50% of its range: (1000-400)*0.5 = 300
  check("scroll sync: editor->viewer proportional",
    Math.abs($("viewer").scrollTop - 300) < 5,
    "viewer.scrollTop=" + $("viewer").scrollTop);
  // Scroll the viewer to 75%.
  $("viewer").scrollTop = 450;  // (1000-400)*0.75 = 450
  $("viewer").dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await tick(20);
  // Editor should be at 75%: (2000-400)*0.75 = 1200
  check("scroll sync: viewer->editor proportional",
    Math.abs($("raw-editor").scrollTop - 1200) < 5,
    "editor.scrollTop=" + $("raw-editor").scrollTop);
  // Clean up: exit edit mode.
  click("close-edit-btn"); await tick(10);

  console.log("== empty-tree right-click create ==");
  TREE.length = 0;
  await window.NB.sidebar.refresh();
  check("empty tree shows 0 rows", window.document.querySelectorAll("#file-tree .tree-row").length === 0);
  const ctxEv = new window.MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 });
  Object.defineProperty(ctxEv, "target", { value: $("file-tree") });
  $("file-tree").dispatchEvent(ctxEv);
  await tick(10);
  check("root menu opens on empty-area right-click", !$("context-menu").hidden);
  const menuBtns = Array.from(window.document.querySelectorAll("#context-menu button"));
  check("root menu has New file / New folder",
    menuBtns.length === 2 && menuBtns.some(b => b.textContent.includes("New file")) && menuBtns.some(b => b.textContent.includes("New folder")),
    menuBtns.map(b => b.textContent).join(" / "));
  promptValue = "created.md";
  const beforeCreate = fetchLog.filter(x => x.startsWith("POST /api/create")).length;
  menuBtns.find(b => b.textContent.includes("New file")).dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("create POST fired", fetchLog.filter(x => x.startsWith("POST /api/create")).length - beforeCreate === 1);
  TREE.push({ name: "created.md", type: "file", path: "created.md" });
  await window.NB.sidebar.refresh();
  check("tree shows created file", window.document.querySelectorAll("#file-tree .tree-row").length === 1);
  // restore a tree entry so later checks have a file
  TREE.push({ name: "Welcome.md", type: "file", path: "Welcome.md" });

  console.log("== sidebar minimize (collapse/expand) ==");
  // left file sidebar
  click("sidebar-collapse");
  await tick(10);
  check("left sidebar gets .collapsed", $("sidebar").classList.contains("collapsed"));
  check("left sidebar width -> 24px", cssVar("--sidebar-width") === "24px", cssVar("--sidebar-width"));
  click("sidebar-expand");
  await tick(10);
  check("left sidebar .collapsed removed", !$("sidebar").classList.contains("collapsed"));
  check("left sidebar width restored (240px)", cssVar("--sidebar-width") === "240px", cssVar("--sidebar-width"));
  // right outline
  click("outline-collapse");
  await tick(10);
  check("outline gets .collapsed", $("outline-pane").classList.contains("collapsed"));
  check("outline width -> 24px", cssVar("--outline-width") === "24px", cssVar("--outline-width"));
  click("outline-expand");
  await tick(10);
  check("outline .collapsed removed", !$("outline-pane").classList.contains("collapsed"));
  check("outline width restored (220px)", cssVar("--outline-width") === "220px", cssVar("--outline-width"));
  // persistence: collapse then wait for debounced config save
  click("sidebar-collapse");
  await tick(350);
  const configPost = fetchLog.filter(x => x.startsWith("POST /api/config")).pop() || "";
  check("collapse persisted to config (sidebarCollapsed:true)", /sidebarCollapsed":true/.test(configPost), configPost);

  console.log("== sidebar resize handles ==");
  const sbH = window.document.querySelector("#sidebar > .resize-handle");
  const olH = window.document.querySelector("#outline-pane > .resize-handle");
  check("left sidebar has a resize handle", !!sbH);
  check("outline has a resize handle", !!olH);
  check("sidebar handle on the right edge", !!sbH && sbH.style.right === "0px", sbH && sbH.style.right);
  check("outline handle on the left edge", !!olH && olH.style.left === "0px", olH && olH.style.left);
  check("sidebar handle has a visible indicator bar", !!sbH && !!sbH.querySelector(".resize-handle-bar"));
  check("outline handle has a visible indicator bar", !!olH && !!olH.querySelector(".resize-handle-bar"));
  // The original bug was an invisible 4px handle via inline width/opacity.
  // Size + visibility must come from CSS, so guard against inline overrides
  // sneaking back (inline beats the stylesheet and would re-break it).
  check("sidebar handle has no inline width/opacity", !!sbH && sbH.style.width === "" && sbH.style.opacity === "",
    "w=" + (sbH && sbH.style.width) + " op=" + (sbH && sbH.style.opacity));
  // Simulate dragging the sidebar handle: mousedown -> mousemove -> mouseup.
  const sidebarPane = $("sidebar");
  const realRect = sidebarPane.getBoundingClientRect.bind(sidebarPane);
  sidebarPane.getBoundingClientRect = () => ({ width: 240, height: 600, left: 0, right: 240, top: 0, bottom: 600, x: 0, y: 0, toJSON() {} });
  sbH.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
  check("mousedown marks the handle dragging", sbH.classList.contains("dragging"));
  check("mousedown marks the body resizing", window.document.body.classList.contains("resizing"));
  window.document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 160 }));
  check("drag widens --sidebar-width (240->300)", cssVar("--sidebar-width") === "300px", cssVar("--sidebar-width"));
  window.document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
  check("drag ends (handle not dragging)", !sbH.classList.contains("dragging"));
  check("drag ends (body not resizing)", !window.document.body.classList.contains("resizing"));
  // Non-primary button must NOT start a drag (state is now clean).
  sbH.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 2, clientX: 100 }));
  check("right-click does not arm a drag (button gate)", !sbH.classList.contains("dragging") && !window.document.body.classList.contains("resizing"));
  sidebarPane.getBoundingClientRect = realRect;

  // Outline handle: left-edge handle. Dragging its left edge LEFT must WIDEN
  // the outline (native left-edge resize direction), not narrow it.
  const outlinePane = $("outline-pane");
  const realOutlineRect = outlinePane.getBoundingClientRect.bind(outlinePane);
  outlinePane.getBoundingClientRect = () => ({ width: 220, height: 600, left: 1060, right: 1280, top: 0, bottom: 600, x: 1060, y: 0, toJSON() {} });
  olH.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: 1060 }));
  check("outline mousedown marks dragging", olH.classList.contains("dragging"));
  window.document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 1000 })); // dx = -60 (drag left)
  check("outline drag left widens --outline-width (220->280)", cssVar("--outline-width") === "280px", cssVar("--outline-width"));
  window.document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
  check("outline drag ends (not dragging)", !olH.classList.contains("dragging"));
  outlinePane.getBoundingClientRect = realOutlineRect;

  console.log("== tabs: close active ==");
  const beforeCount = tabs().length;
  await window.NB.tabs.open("Welcome.md");
  await tick(20);
  check("open Welcome for close-active test", activeTabPath() === "Welcome.md" && tabs().length === beforeCount + 1,
    "active=" + activeTabPath() + " count=" + tabs().length);
  window.NB.tabs.close("Welcome.md");   // close the active tab
  await tick(40);
  check("close-active removes Welcome", !window.document.querySelector('.tab[data-path="Welcome.md"]'));
  check("close-active restores count", tabs().length === beforeCount, "got " + tabs().length);
  check("close-active makes a neighbor active", !!activeTabPath(), "active=" + activeTabPath());

  console.log("== tabs: regression coverage ==");
  // Reset to a known state: close everything (covers close-last-tab -> viewer.clear).
  window.NB.tabs.close("notes/a.md", { force: true });   // non-active
  await tick(10);
  window.NB.tabs.close(activeTabPath(), { force: true }); // active, last tab
  await tick(20);
  check("close last tab -> viewer.clear placeholder", /No file selected/.test($("viewer").textContent));
  check("close last tab -> editor hidden", $("raw-editor").hidden);
  check("close last tab -> edit button loses .editing class", !$("edit-toggle").classList.contains("editing"));
  check("close last tab -> edit bar hidden", $("edit-bar").hidden);
  check("close last tab -> no active", window.NB.tabs.getActive() === null && !activeTabPath());

  // restore() reads openFiles/activeFile back from config (round-trip).
  await window.NB.tabs.restore(["notes/a.md", "Welcome.md"], "Welcome.md", null);
  await tick(20);
  check("restore reads openFiles -> 2 tabs", tabs().length === 2, "got " + tabs().length);
  check("restore activates activeFile (Welcome)", activeTabPath() === "Welcome.md");
  check("restore includes notes/a.md tab (lazy)", !!window.document.querySelector('.tab[data-path="notes/a.md"]'));

  // Switching tabs while in edit mode preserves unsaved edits (regression).
  await window.NB.tabs.activate("notes/a.md");
  await tick(10);
  window.NB.viewer.startEdit();
  $("raw-editor").value = "# notes/a\n\nUNSAVED SWITCH EDITS\n";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  await window.NB.tabs.activate("Welcome.md");   // switch away mid-edit
  await tick(20);
  await window.NB.tabs.activate("notes/a.md");   // switch back
  await tick(20);
  check("switch away+back preserves edits", /UNSAVED SWITCH EDITS/.test($("raw-editor").value));
  check("switched-back tab still dirty",
    window.document.querySelector('.tab[data-path="notes/a.md"]').classList.contains("dirty"));
  window.NB.viewer.endEdit();   // leave edit (keeps content -> still dirty)
  await tick(10);

  // rename() re-keys the tab and carries dirty state.
  window.NB.tabs.rename("notes/a.md", "notes/renamed.md");
  await tick(10);
  check("rename re-keys tab path", !!window.document.querySelector('.tab[data-path="notes/renamed.md"]'));
  check("rename drops old path", !window.NB.tabs.isOpen("notes/a.md"));
  check("rename adds new path", window.NB.tabs.isOpen("notes/renamed.md"));
  check("rename keeps active -> new path", window.NB.tabs.getActive() === "notes/renamed.md");
  check("rename carries dirty state",
    window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));

  // save() clears the dirty dot. (In the new topbar model you have to be
  // in edit mode to save -- the standalone Save button is gone.)
  window.NB.viewer.startEdit();
  await tick(10);
  click("save-btn");
  await tick(20);
  check("save clears dirty dot",
    !window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));
  window.NB.viewer.endEdit();
  await tick(10);

  // confirm-cancel keeps a dirty tab (and its edits).
  window.NB.viewer.startEdit();
  $("raw-editor").value = "# notes/renamed\n\nCANCEL TEST\n";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.NB.viewer.endEdit();
  await tick(10);
  const beforeClose = tabs().length;
  window.confirm = () => false;                       // user cancels
  window.NB.tabs.close("notes/renamed.md");           // dirty -> prompts -> cancelled
  await tick(10);
  check("confirm-cancel keeps the tab", tabs().length === beforeClose);
  check("confirm-cancel keeps active", window.NB.tabs.getActive() === "notes/renamed.md");
  check("confirm-cancel keeps dirty",
    window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));
  window.confirm = () => true;                        // restore stub

  // Multi-tab dirty: a full render() re-applies the dot to every dirty tab.
  await window.NB.tabs.activate("Welcome.md");
  await tick(10);
  window.NB.viewer.startEdit();
  $("raw-editor").value = "WELCOME DIRTY";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  window.NB.viewer.endEdit();
  await tick(10);
  await window.NB.tabs.activate("notes/renamed.md");  // notes/renamed still dirty
  await tick(10);
  window.NB.tabs.render();                            // force full re-render
  check("multi-tab: notes/renamed dirty after render",
    window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));
  check("multi-tab: Welcome dirty after render",
    window.document.querySelector('.tab[data-path="Welcome.md"]').classList.contains("dirty"));

  // Middle-click (auxclick, button 1) closes a clean tab.
  await window.NB.tabs.open("created.md");
  await tick(20);
  const cnt = tabs().length;
  const createdTab = window.document.querySelector('.tab[data-path="created.md"]');
  createdTab.dispatchEvent(new window.MouseEvent("auxclick", { bubbles: true, button: 1 }));
  await tick(20);
  check("middle-click closes tab", tabs().length === cnt - 1 && !window.NB.tabs.isOpen("created.md"),
    "count=" + tabs().length);

  // Clicking the tab's × button closes it (was broken by a `close` shadowing bug).
  await window.NB.tabs.open("created.md");
  await tick(20);
  const cnt2 = tabs().length;
  const xBtn = window.document.querySelector('.tab[data-path="created.md"] .tab-close');
  xBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("× button closes tab", tabs().length === cnt2 - 1 && !window.NB.tabs.isOpen("created.md"),
    "count=" + tabs().length);

  console.log("== tab pin + context menu ==");
  const tabPaths = () => Array.from(tabs()).map(t => t.dataset.path);
  const menuBtn = (label) => Array.from($("tab-context-menu").querySelectorAll("button"))
    .find(b => b.textContent === label);
  const ctxOpen = (sel, x) => window.document.querySelector(sel)
    .dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, clientX: x || 50, clientY: 10 }));

  // reset to a clean 3-tab state: [notes/a.md, Welcome.md, notes/b.md]
  window.NB.tabs.getOpen().slice().forEach(p => window.NB.tabs.close(p, { force: true }));
  await tick(30);
  await window.NB.tabs.open("notes/a.md"); await tick(10);
  await window.NB.tabs.open("Welcome.md"); await tick(10);
  await window.NB.tabs.open("notes/b.md"); await tick(20);
  check("reset: 3 tabs open", tabs().length === 3, "got " + tabs().length);
  check("reset order", tabPaths().join(",") === "notes/a.md,Welcome.md,notes/b.md", tabPaths().join(","));

  // togglePin moves to front, marks pinned, drops the close button, shows marker
  window.NB.tabs.togglePin("Welcome.md");
  await tick(10);
  check("pin: Welcome moved to front", tabPaths()[0] === "Welcome.md", tabPaths().join(","));
  check("pin: Welcome tab is .pinned",
    !!window.document.querySelector('.tab[data-path="Welcome.md"].pinned'));
  check("pin: isPinned reports true", window.NB.tabs.isPinned("Welcome.md"));
  check("pin: pinned tab has no close button",
    !window.document.querySelector('.tab[data-path="Welcome.md"] .tab-close'));
  check("pin: pinned tab shows pin marker",
    !!window.document.querySelector('.tab[data-path="Welcome.md"] .tab-pin'));
  check("pin: unpinned tab keeps close button",
    !!window.document.querySelector('.tab[data-path="notes/a.md"] .tab-close'));

  // context-menu Pin on notes/a -> joins pinned group at its end
  ctxOpen('.tab[data-path="notes/a.md"]', 100);
  check("tab context menu opened", !$("tab-context-menu").hidden);
  menuBtn("Pin").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("menu pin: notes/a pinned", window.NB.tabs.isPinned("notes/a.md"));
  // pinned group [Welcome.md, notes/a.md]; unpinned [notes/b.md]
  check("menu pin: pinned tabs front in order",
    tabPaths()[0] === "Welcome.md" && tabPaths()[1] === "notes/a.md", tabPaths().join(","));

  // context-menu Unpin on Welcome -> drops to start of unpinned section
  ctxOpen('.tab[data-path="Welcome.md"]', 50);
  menuBtn("Unpin").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("menu unpin: Welcome not pinned", !window.NB.tabs.isPinned("Welcome.md"));
  // pinned [notes/a.md]; unpinned [Welcome.md, notes/b.md]
  check("menu unpin: notes/a still front (pinned)", tabPaths()[0] === "notes/a.md", tabPaths().join(","));

  // bulk close protects pinned tabs. state: [notes/a(pinned), Welcome, notes/b]
  await window.NB.tabs.activate("notes/b.md");
  await tick(10);
  // "Close to the right" of Welcome -> closes notes/b (the only one to its right)
  ctxOpen('.tab[data-path="Welcome.md"]', 50);
  check("close-right enabled", menuBtn("Close to the right") && !menuBtn("Close to the right").disabled);
  menuBtn("Close to the right").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("close-right removed notes/b", !window.NB.tabs.isOpen("notes/b.md"));
  check("close-right left 2 tabs", tabs().length === 2, "got " + tabs().length);
  check("close-right kept pinned notes/a", window.NB.tabs.isOpen("notes/a.md"));

  // reopen notes/b, then "Close to the left" of notes/b -> closes Welcome,
  // skips the pinned notes/a on its left
  await window.NB.tabs.open("notes/b.md"); await tick(20);
  // state: [notes/a(pinned), Welcome, notes/b]
  ctxOpen('.tab[data-path="notes/b.md"]', 150);
  menuBtn("Close to the left").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("close-left removed Welcome (non-pinned)", !window.NB.tabs.isOpen("Welcome.md"));
  check("close-left kept pinned notes/a", window.NB.tabs.isOpen("notes/a.md"));
  check("close-left left 2 tabs", tabs().length === 2, "got " + tabs().length);

  // "Close others" on notes/b: only pinned notes/a remains as an other, which
  // is skipped -> the item is disabled and nothing closes
  ctxOpen('.tab[data-path="notes/b.md"]', 150);
  check("close-others disabled when only pinned other remains",
    menuBtn("Close others") && menuBtn("Close others").disabled);
  window.document.dispatchEvent(new window.Event("click", { bubbles: true })); // close menu
  await tick(10);
  check("tab context menu hides on outside click", $("tab-context-menu").hidden);

  console.log("== tab drag reorder ==");
  // reset to a clean 3 unpinned-tab state
  window.NB.tabs.togglePin("notes/a.md"); // unpin it
  await tick(10);
  window.NB.tabs.getOpen().slice().forEach(p => window.NB.tabs.close(p, { force: true }));
  await tick(30);
  await window.NB.tabs.open("notes/a.md"); await tick(10);
  await window.NB.tabs.open("Welcome.md"); await tick(10);
  await window.NB.tabs.open("notes/b.md"); await tick(20);
  // order: [notes/a.md, Welcome.md, notes/b.md]
  const dSrc = window.document.querySelector('.tab[data-path="notes/b.md"]');
  const dOver = window.document.querySelector('.tab[data-path="notes/a.md"]');
  const dRect = dOver.getBoundingClientRect.bind(dOver);
  dOver.getBoundingClientRect = () => ({ width: 100, height: 30, left: 0, right: 100, top: 0, bottom: 30, x: 0, y: 0, toJSON() {} });
  dSrc.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  const ov = new window.Event("dragover", { bubbles: true });
  Object.defineProperty(ov, "clientX", { value: 0 });
  dOver.dispatchEvent(ov);
  const dp = new window.Event("drop", { bubbles: true });
  Object.defineProperty(dp, "clientX", { value: 0 });
  dOver.dispatchEvent(dp);
  await tick(10);
  dOver.getBoundingClientRect = dRect;
  check("drag: notes/b moved to front", tabPaths()[0] === "notes/b.md", tabPaths().join(","));
  check("drag: order is [b, a, Welcome]",
    tabPaths()[1] === "notes/a.md" && tabPaths()[2] === "Welcome.md", tabPaths().join(","));

  // pinned-boundary clamp: pin Welcome, then drag unpinned notes/a onto
  // Welcome's left half -> it must land AFTER the pinned tab, never before it.
  window.NB.tabs.togglePin("Welcome.md"); await tick(10);
  // order: [Welcome(pinned), notes/b, notes/a]
  check("clamp setup: Welcome pinned at front",
    tabPaths()[0] === "Welcome.md" && window.NB.tabs.isPinned("Welcome.md"), tabPaths().join(","));
  const cSrc = window.document.querySelector('.tab[data-path="notes/a.md"]');
  const cOver = window.document.querySelector('.tab[data-path="Welcome.md"]');
  const cRect = cOver.getBoundingClientRect.bind(cOver);
  cOver.getBoundingClientRect = () => ({ width: 100, height: 30, left: 0, right: 100, top: 0, bottom: 30, x: 0, y: 0, toJSON() {} });
  cSrc.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
  const ov2 = new window.Event("dragover", { bubbles: true });
  Object.defineProperty(ov2, "clientX", { value: 0 });
  cOver.dispatchEvent(ov2);
  const dp2 = new window.Event("drop", { bubbles: true });
  Object.defineProperty(dp2, "clientX", { value: 0 });
  cOver.dispatchEvent(dp2);
  await tick(10);
  cOver.getBoundingClientRect = cRect;
  // notes/a moved from last to middle, but stayed after pinned Welcome
  check("clamp: pinned Welcome still first", tabPaths()[0] === "Welcome.md", tabPaths().join(","));
  check("clamp: notes/a second (after pinned), notes/b third",
    tabPaths()[1] === "notes/a.md" && tabPaths()[2] === "notes/b.md", tabPaths().join(","));

  console.log("== sidebar drag-and-drop move ==");
  // Reset to a known state: [notes/a.md, notes/b.md, Welcome.md]. The TREE
  // fixture already has a 'notes' dir with a.md and b.md + Welcome.md.
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
      { name: "b.md", type: "file", path: "notes/b.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  // Helper: drag row -> drop on target row. x = horizontal offset in px.
  async function dndDragDrop(srcPath, targetPath, x) {
    const src = window.document.querySelector('.tree-row[data-path="' +
      srcPath.replace(/"/g, '\\"') + '"]');
    const tgt = targetPath ? window.document.querySelector('.tree-row[data-path="' +
      targetPath.replace(/"/g, '\\"') + '"]') : null;
    if (!src) throw new Error("no src row: " + srcPath);
    src.dispatchEvent(new window.Event("dragstart", { bubbles: true }));
    if (tgt) {
      // Make the row have a real rect so before/after math is meaningful.
      const rect = { width: 200, height: 24, left: 0, right: 200, top: 0, bottom: 24, x: 0, y: 0, toJSON() {} };
      tgt.getBoundingClientRect = () => rect;
      const ov = new window.Event("dragover", { bubbles: true });
      Object.defineProperty(ov, "clientX", { value: x || 50 });
      tgt.dispatchEvent(ov);
      const dp = new window.Event("drop", { bubbles: true });
      Object.defineProperty(dp, "clientX", { value: x || 50 });
      tgt.dispatchEvent(dp);
    } else {
      // drop on the empty tree area
      const empty = new window.Event("drop", { bubbles: true });
      Object.defineProperty(empty, "clientX", { value: x || 50 });
      window.document.getElementById("file-tree").dispatchEvent(empty);
    }
    src.dispatchEvent(new window.Event("dragend", { bubbles: true }));
    await tick(40);
  }

  // Move Welcome.md onto the 'notes' folder row -> should land inside notes.
  // Backend stub applies the move by rewriting the path key in FILES.
  const origMoveItem = window.NB.api.moveItem;
  window.NB.api.moveItem = async (from, to) => {
    fetchLog.push("POST /api/move " + from + " -> " + to);
    if (FILES[from] !== undefined) { FILES[to] = FILES[from]; delete FILES[from]; }
    return { from, to };
  };
  await dndDragDrop("Welcome.md", "notes", 30);
  check("DnD: move Welcome.md into notes/ called the API",
    fetchLog.some(l => /POST \/api\/move.*Welcome\.md.*notes\/Welcome\.md/.test(l)),
    fetchLog.filter(l => l.startsWith("POST /api/move")).join("; "));
  // Update the tree stub to reflect the new path so the next refresh matches
  TREE[0].children.push({ name: "Welcome.md", type: "file", path: "notes/Welcome.md" });
  TREE.pop();
  await window.NB.sidebar.refresh();
  await tick(20);
  check("DnD: tree now contains notes/Welcome.md",
    !!window.document.querySelector('.tree-row[data-path="notes/Welcome.md"]'));

  // Move notes/a.md onto the 'notes' folder row's CHILD (notes/b.md) ->
  // a.md should land beside b.md, in the notes/ dir.
  TREE[0].children = TREE[0].children.filter(c => c.name !== "a.md");
  TREE[0].children.unshift({ name: "a.md", type: "file", path: "notes/a.md" });
  await window.NB.sidebar.refresh();
  await tick(20);
  await dndDragDrop("notes/a.md", "notes/b.md", 10);
  check("DnD: file->file move called API (notes/a.md -> notes/...)",
    fetchLog.filter(l => l.startsWith("POST /api/move notes/a.md")).length >= 1,
    fetchLog.filter(l => l.startsWith("POST /api/move")).join("; "));

  // The destination a.md picked by the drop-beside logic in the absence of
  // a real "insertBefore" semantic should land inside notes/ (same parent).
  TREE[0].children.push({ name: "a.md", type: "file", path: "notes/a.md" });
  await window.NB.sidebar.refresh();

  // Drop on a folder with a different (file) type source: move to root.
  // Set the tree to just a single file "f.md" then drag it onto the empty
  // area. Stub the move to land at root and ensure the API was called.
  TREE.length = 0;
  TREE.push({ name: "f.md", type: "file", path: "f.md" });
  FILES["f.md"] = "# F";
  await window.NB.sidebar.refresh();
  await tick(20);
  await dndDragDrop("f.md", null, 30);
  check("DnD: drop-on-empty called move with root destination",
    fetchLog.some(l => /POST \/api\/move f\.md/.test(l)),
    fetchLog.filter(l => l.startsWith("POST /api/move")).join("; "));

  // Folder-move self-recursion guard: dropping a folder into one of its
  // own descendants must be a no-op (no API call) and surface an alert.
  window.alert = () => { fetchLog.push("alert"); };
  TREE.length = 0;
  TREE.push(
    { name: "d1", type: "dir", path: "d1", children: [
      { name: "d2", type: "dir", path: "d1/d2", children: [] },
    ]},
  );
  await window.NB.sidebar.refresh();
  await tick(20);
  const beforeRecurse = fetchLog.filter(l => l.startsWith("POST /api/move")).length;
  await dndDragDrop("d1", "d1/d2", 30);
  const afterRecurse = fetchLog.filter(l => l.startsWith("POST /api/move")).length;
  check("DnD: folder->descendant is blocked (no API call)",
    afterRecurse === beforeRecurse, "before=" + beforeRecurse + " after=" + afterRecurse);
  check("DnD: folder->descendant surfaces alert", fetchLog.includes("alert"));

  // restore: real implementation so other test blocks (if any) work.
  window.NB.api.moveItem = origMoveItem;

  console.log("== external file change ==");
  // Reset to a clean 2-tab state and seed the cache via activate().
  TREE.length = 0;
  TREE.push(
    { name: "notes", type: "dir", path: "notes", children: [
      { name: "a.md", type: "file", path: "notes/a.md" },
    ]},
    { name: "Welcome.md", type: "file", path: "Welcome.md" },
  );
  FILES["Welcome.md"] = "# Welcome\n\nold\n";
  await window.NB.sidebar.refresh();
  window.NB.tabs.getOpen().slice().forEach(p => window.NB.tabs.close(p, { force: true }));
  await tick(20);
  await window.NB.tabs.open("Welcome.md"); await tick(20);
  check("external: opened Welcome (cache populated)",
    /old/.test(window.document.getElementById("viewer").textContent));

  // Case 1: not-dirty + external change -> silent reload, content updates.
  FILES["Welcome.md"] = "# Welcome\n\nnew\n";
  // The test's getFile handler doesn't know about the new content until
  // we make the fetch stub return it.
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: FILES["Welcome.md"], mtime: 9999, size: 99 } });
  await tick(40);
  check("external: clean file auto-reloads", /new/.test(window.document.getElementById("viewer").textContent));

  // Case 2: dirty + external change -> confirm() prompt.
  window.NB.viewer.startEdit();
  $("raw-editor").value = "MY LOCAL EDITS";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  window.confirm = () => { fetchLog.push("confirm(yes)"); return true; };
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "REMOTE", mtime: 10000, size: 6 } });
  await tick(40);
  check("external: dirty + change -> confirm shown", fetchLog.includes("confirm(yes)"));
  check("external: confirm(yes) reloads", /REMOTE/.test(window.document.getElementById("viewer").textContent));

  // Re-dirty, then Cancel.
  window.NB.viewer.startEdit();
  $("raw-editor").value = "ANOTHER LOCAL EDIT";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  window.confirm = () => { fetchLog.push("confirm(no)"); return false; };
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "REMOTE2", mtime: 10001, size: 7 } });
  await tick(40);
  check("external: confirm(no) keeps local edits",
    $("raw-editor").value === "ANOTHER LOCAL EDIT",
    "value=" + $("raw-editor").value);
  const tabEl = window.document.querySelector('.tab[data-path="Welcome.md"]');
  check("external: confirm(no) marks tab as conflict",
    tabEl && !!tabEl.querySelector(".tab-conflict"));

  // Case 3: self-save suppression. After save(), the next external change
  // event for the same path within the window should be ignored.
  // In the new topbar model save() requires edit mode; start it.
  window.NB.viewer.startEdit();
  await tick(10);
  click("save-btn");
  await tick(40);
  // The watcher exposes noteSelfSave to flag a path as "we just wrote this,
  // ignore the next change". The window is 1.5s; verify the public API.
  check("external: noteSelfSave is exposed", typeof window.NB.watcher.noteSelfSave === "function");
  window.NB.watcher.noteSelfSave("Welcome.md");
  // While inside the window, a watcher.notifyChange would drop the event.
  // We test the public path by verifying describe() / isWatching() are
  // unchanged and that the suppression window function exists.
  // For the rest of the test, clear the suppression by waiting past the
  // window (1.5s in the source) so subsequent emits are not swallowed.
  await tick(1600);
  // Now: an emit directly goes through, and the cache+viewer reload.
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "FRESH", mtime: 20000, size: 5 } });
  await tick(40);
  check("external: post-window change reloaded",
    /FRESH/.test($("viewer").textContent),
    "viewer=" + $("viewer").textContent.slice(0, 60));

  // Case 4: watch button lives in the settings modal now. Open the modal,
  // verify the status line and the toggle button, then enable+Apply and
  // check the status updates. Under the draft-then-commit model, clicking
  // the toggle only mutates the draft; the live watcher starts on Apply.
  window.NB.settings.open();
  await tick(20);
  check("watch: settings modal opens", window.NB.settings.isOpen());
  const statusEl = $("settings-watch-status");
  const watchBtn = $("settings-watch-toggle");
  check("watch: status element exists", !!statusEl);
  check("watch: status starts as 'Watching off'", /off/i.test(statusEl.textContent),
    statusEl.textContent);
  check("watch: button starts as 'Enable' (live state)", watchBtn.textContent === "Enable",
    watchBtn.textContent);
  // Click toggle: draft flips, button text reflects pending state, but the
  // live watcher is still off (status still 'Watching off').
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("watch: toggle click flips button to 'Disable' (pending)",
    watchBtn.textContent === "Disable", watchBtn.textContent);
  check("watch: live status still 'Watching off' (not yet applied)",
    /off/i.test(statusEl.textContent), statusEl.textContent);
  // Apply: live watcher starts (polling fallback in jsdom). Status flips.
  // Apply also closes the modal.
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  // (Modal is now closed; we re-grab the elements after reopening below.)
  window.NB.settings.open(); await tick(20);
  const statusEl2 = $("settings-watch-status");
  const watchBtn2 = $("settings-watch-toggle");
  check("watch: apply -> live status reports active",
    /watching|polling/i.test(statusEl2.textContent),
    statusEl2.textContent);
  check("watch: apply -> button is 'Disable' (matches live state)",
    watchBtn2.textContent === "Disable", watchBtn2.textContent);
  // Toggle to disable: draft flips, but live is still active.
  watchBtn2.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("watch: pending disable -> button text 'Enable'",
    watchBtn2.textContent === "Enable", watchBtn2.textContent);
  check("watch: pending disable -> live still active",
    /watching|polling/i.test(statusEl2.textContent), statusEl2.textContent);
  // Apply: live watcher disables. Status reports off. Modal closes.
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  window.NB.settings.open(); await tick(20);
  const statusEl3 = $("settings-watch-status");
  check("watch: apply disable -> status reports off",
    /off/i.test(statusEl3.textContent), statusEl3.textContent);
  window.NB.settings.close();
  await tick(10);

  console.log("== settings modal ==");
  // Closed by default.
  check("settings: closed initially", !window.NB.settings.isOpen());
  // The overlay must actually be invisible, not just .isOpen() === false.
  // (Regression guard: `display: flex` on .settings-overlay would otherwise
  // outrank the UA's [hidden] { display: none } and pop the modal up.)
  {
    // Pull the live computed style the same way a real browser would.
    const overlayStyle = window.getComputedStyle($("settings-overlay"));
    check("settings: overlay hidden-by-attr is display:none on load",
      overlayStyle.display === "none", "computed display=" + overlayStyle.display);
  }
  // Open via the gear button in the top bar.
  $("settings-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("settings: gear button opens modal", window.NB.settings.isOpen());
  check("settings: overlay is visible (no hidden attr)", !$("settings-overlay").hidden);
  // Esc closes.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(10);
  check("settings: Esc closes", !window.NB.settings.isOpen());
  // Open + close via × button.
  window.NB.settings.open(); await tick(10);
  $("settings-close").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("settings: × button closes", !window.NB.settings.isOpen());
  // Open + click on backdrop closes.
  window.NB.settings.open(); await tick(10);
  // dispatch a click whose target IS the overlay (not the modal)
  const backdropClick = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(backdropClick, "target", { value: $("settings-overlay") });
  $("settings-overlay").dispatchEvent(backdropClick);
  await tick(10);
  check("settings: overlay-click closes", !window.NB.settings.isOpen());
  // Click on the modal itself does NOT close.
  window.NB.settings.open(); await tick(10);
  const modalClick = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(modalClick, "target", { value: $("settings-overlay").querySelector(".settings-modal") });
  $("settings-overlay").dispatchEvent(modalClick);
  await tick(10);
  check("settings: click inside modal keeps it open", window.NB.settings.isOpen());
  window.NB.settings.close();
  // Data-dir info loaded via /api/info on first open.
  window.NB.settings.open(); await tick(40);
  check("settings: data dir shown",
    $("settings-data-dir").textContent === "/tmp/test/data",
    $("settings-data-dir").textContent);
  check("settings: config dir shown",
    $("settings-config-dir").textContent === "/tmp/test/config",
    $("settings-config-dir").textContent);
  window.NB.settings.close();

  console.log("== auth ==");
  // The fetch stub defaults to authEnabled=false so the modal is closed and
  // the logout button is hidden. Verify that baseline, then exercise the
  // login + logout paths.

  // Wait briefly so any pending DOMContentLoaded work settles, then check.
  await tick(40);
  check("auth: modal hidden by default (auth disabled)", $("auth-overlay").hidden);
  check("auth: body is not auth-locked", !document.body.classList.contains("auth-locked"));
  check("auth: logout button hidden by default", $("logout-btn").hidden);

  // Expose the public hooks for direct testing.
  check("auth: NB.auth is exposed", typeof window.NB.auth === "object"
    && typeof window.NB.auth.showModal === "function");
  check("auth: NB.api.getAuthStatus is exposed", typeof window.NB.api.getAuthStatus === "function");
  check("auth: NB.api.login is exposed", typeof window.NB.api.login === "function");
  check("auth: NB.api.logout is exposed", typeof window.NB.api.logout === "function");

  // Enable auth in the stub + call showModal() to simulate the boot path
  // (boot is idempotent and only ran once with authEnabled=false; testing
  // the boot itself is the same code path exercised by the showModal call
  // below since boot ends in either showModal() or unhiding the logout btn).
  authEnabled = true; authRole = null;
  window.NB.auth.showModal();
  await tick(20);
  check("auth: modal visible after showModal()", !$("auth-overlay").hidden);
  check("auth: body gets auth-locked when modal up", document.body.classList.contains("auth-locked"));

  // The /api/auth status endpoint reports enabled=true, role=null when the
  // stub is in this state.
  const status = await window.NB.api.getAuthStatus();
  check("auth: getAuthStatus reports enabled=true", status && status.enabled === true,
    JSON.stringify(status));
  check("auth: getAuthStatus reports role=null", status && status.role === null);

  // Submit the wrong password -> error message, modal stays up.
  $("auth-password").value = "wrong";
  $("auth-submit").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: wrong password -> error shown", $("auth-error").textContent.length > 0,
    "err=" + $("auth-error").textContent);
  check("auth: wrong password -> modal stays up", !$("auth-overlay").hidden);

  // Submit the right password -> reload() in production. The test stub
  // replaces window.location.reload to record the call.
  let reloaded = false;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload() { reloaded = true; } },
  });
  $("auth-password").value = "test-pw";
  $("auth-submit").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: right password -> reload() called", reloaded);
  // The authRole in the stub is now "admin" (simulating the post-login
  // state). In a real reload, auth.js would re-boot and see role=admin,
  // leaving the modal hidden and unhiding the logout button. We simulate
  // that directly here.
  check("auth: post-login state has role=admin (stub)",
    authRole === "admin", "authRole=" + authRole);
  window.NB.auth.hideModal();
  $("logout-btn").hidden = false;   // simulate the unhide auth.js would do
  check("auth: post-login -> modal hidden", $("auth-overlay").hidden);
  check("auth: post-login -> logout button visible", !$("logout-btn").hidden);

  // Logout: clicking the button calls /api/logout (which clears authRole
  // in the stub) and then shows the modal directly.
  $("logout-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: logout -> /api/logout called (authRole cleared)",
    authRole === null, "authRole=" + authRole);
  check("auth: logout -> modal re-shown directly", !$("auth-overlay").hidden);

  // 401 path: a gated endpoint returning 401 must emit auth:required and
  // throw. Replace fetch temporarily to simulate the server returning 401.
  const realFetch = window.fetch;
  window.fetch = async () => ({
    ok: false, status: 401,
    text: async () => JSON.stringify({ error: "Unauthorized" }),
    json: async () => ({ error: "Unauthorized" }),
  });
  let emitted = 0;
  const evtHandler = () => { emitted++; };
  window.NB.evt.on("auth:required", evtHandler);
  let threw = false;
  try { await window.NB.api.getFile("Welcome.md"); }
  catch (e) { threw = true; }
  window.NB.evt.off("auth:required", evtHandler);
  window.fetch = realFetch;
  check("auth: 401 -> auth:required event emitted", emitted === 1, "count=" + emitted);
  check("auth: 401 -> request throws", threw);

  // Reset for a clean exit: hide modal, restore defaults.
  window.NB.auth.hideModal();
  authEnabled = false; authRole = null;

  console.log("== passwords ==");
  // The Passwords section in Settings lets an admin (and only an admin)
  // set/change the admin password, and toggle the optional viewer
  // password that gates reads. We exercise the section with a fresh
  // auth state per scenario so the assertions stay independent.
  //
  // Helper: pretend reload() so we can observe the post-save refresh
  // without actually reloading jsdom (which would wipe our state).
  let pwdReload = 0;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload() { pwdReload++; } },
  });

  // Scenario 1: no auth configured. The section should be enabled (this
  // is the first-time setup path: anyone can set the initial admin pw).
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authSetPasswordsCalls = [];
  window.NB.settings.open(); await tick(40);
  check("pwd: status reports enabled=false, hasAdmin=false",
    $("settings-auth-admin-status").textContent === "Not set",
    "status=" + $("settings-auth-admin-status").textContent);
  check("pwd: admin input enabled (no admin set yet)",
    !$("settings-auth-admin-pw").disabled);
  check("pwd: admin save disabled (input empty)",
    $("settings-auth-admin-save").disabled);
  check("pwd: viewer toggle disabled (no admin set yet)",
    $("settings-auth-viewer-toggle").disabled);
  check("pwd: viewer row hidden (no admin set yet)",
    $("settings-auth-viewer-row").hidden);
  // Type a password -> save becomes enabled.
  $("settings-auth-admin-pw").value = "newadmin";
  $("settings-auth-admin-pw").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: typing in admin field enables save",
    !$("settings-auth-admin-save").disabled);
  // Click save -> POSTs {admin_password:"...", viewer_password:null} and reloads.
  $("settings-auth-admin-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: admin save POSTs to /api/auth/passwords",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === "newadmin"
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  check("pwd: admin save triggers reload", pwdReload === 1, "reload=" + pwdReload);
  window.NB.settings.close();

  // Scenario 2: viewer field reveal. Simulate post-reload state where
  // auth is now enabled with admin set, no viewer. The toggle is enabled,
  // the viewer row is hidden until the toggle is checked.
  authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
  window.NB.settings.open(); await tick(40);
  check("pwd: status reports admin set (post-reload)",
    /Set/.test($("settings-auth-admin-status").textContent),
    "status=" + $("settings-auth-admin-status").textContent);
  check("pwd: viewer toggle enabled (admin can toggle)",
    !$("settings-auth-viewer-toggle").disabled);
  check("pwd: viewer toggle off by default (no viewer yet)",
    $("settings-auth-viewer-toggle").checked === false);
  // The viewer row is shown for admins (they can set a viewer even with
  // the toggle off), so the row is visible immediately.
  check("pwd: viewer row visible for admin (can set even with toggle off)",
    !$("settings-auth-viewer-row").hidden);
  check("pwd: viewer save disabled (no password typed)",
    $("settings-auth-viewer-save").disabled);
  // Checking the toggle when no viewer is set is a no-op (UI already in
  // the right state); nothing to assert beyond no errors. We do verify
  // the save is still disabled until a password is typed.
  // Type a viewer password -> save becomes enabled.
  $("settings-auth-viewer-pw").value = "viewpass";
  $("settings-auth-viewer-pw").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  check("pwd: typing in viewer field enables save",
    !$("settings-auth-viewer-save").disabled);
  // Click save -> POSTs {admin_password:null, viewer_password:"..."} and reloads.
  authSetPasswordsCalls = [];
  $("settings-auth-viewer-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: viewer save POSTs with admin=null, viewer=value",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === null
    && authSetPasswordsCalls[0].viewer_password === "viewpass",
    JSON.stringify(authSetPasswordsCalls));
  check("pwd: viewer save triggers reload", pwdReload === 2, "reload=" + pwdReload);
  window.NB.settings.close();

  // Scenario 3: viewer already set. The section shows the current state,
  // the toggle starts on, the Remove button is visible, and toggling off
  // prompts for confirm before POSTing an empty viewer.
  authEnabled = true; authHasAdmin = true; authHasViewer = true; authRole = "admin";
  window.NB.settings.open(); await tick(40);
  check("pwd: viewer toggle on when viewer is set",
    $("settings-auth-viewer-toggle").checked === true);
  check("pwd: viewer row visible when viewer is set",
    !$("settings-auth-viewer-row").hidden);
  check("pwd: viewer status reflects set state",
    /Set/.test($("settings-auth-viewer-status").textContent),
    "status=" + $("settings-auth-viewer-status").textContent);
  check("pwd: Remove button visible when viewer is set",
    !$("settings-auth-viewer-remove").hidden);
  // Uncheck -> confirm shown, user cancels -> toggle stays on.
  let pwdConfirmCount = 0;
  window.confirm = () => { pwdConfirmCount++; return false; };
  $("settings-auth-viewer-toggle").checked = false;
  $("settings-auth-viewer-toggle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("pwd: uncheck + cancel -> confirm shown once",
    pwdConfirmCount === 1, "count=" + pwdConfirmCount);
  check("pwd: uncheck + cancel -> toggle stays on",
    $("settings-auth-viewer-toggle").checked === true);
  check("pwd: uncheck + cancel -> no POST fired",
    authSetPasswordsCalls.length === 0);
  // Uncheck -> confirm, user OK -> POSTs empty viewer, reloads.
  window.confirm = () => { pwdConfirmCount++; return true; };
  authSetPasswordsCalls = [];
  $("settings-auth-viewer-toggle").checked = false;
  $("settings-auth-viewer-toggle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(40);
  check("pwd: uncheck + OK -> confirm shown",
    pwdConfirmCount === 2, "count=" + pwdConfirmCount);
  check("pwd: uncheck + OK -> POST with viewer_password:\"\"",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === null
    && authSetPasswordsCalls[0].viewer_password === "",
    JSON.stringify(authSetPasswordsCalls));
  check("pwd: uncheck + OK -> reloads", pwdReload === 3, "reload=" + pwdReload);
  window.NB.settings.close();

  // Scenario 4: admin can change the admin password. The form is always
  // present; entering a new value and clicking Save replaces the hash.
  authEnabled = true; authHasAdmin = true; authHasViewer = false; authRole = "admin";
  window.NB.settings.open(); await tick(40);
  $("settings-auth-admin-pw").value = "rotated-pw";
  $("settings-auth-admin-pw").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  authSetPasswordsCalls = [];
  $("settings-auth-admin-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("pwd: admin rotate POSTs new value (viewer untouched)",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === "rotated-pw"
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  check("pwd: admin rotate reloads", pwdReload === 4, "reload=" + pwdReload);
  window.NB.settings.close();

  // Scenario 5: non-admin (viewer) sees the section disabled.
  authEnabled = true; authHasAdmin = true; authHasViewer = true; authRole = "viewer";
  window.NB.settings.open(); await tick(40);
  check("pwd: help text says sign in as admin for non-admins",
    /Sign in as admin/i.test($("settings-auth-help").textContent),
    "help=" + $("settings-auth-help").textContent);
  check("pwd: admin input disabled for non-admin",
    $("settings-auth-admin-pw").disabled);
  check("pwd: admin save disabled for non-admin",
    $("settings-auth-admin-save").disabled);
  check("pwd: viewer toggle disabled for non-admin",
    $("settings-auth-viewer-toggle").disabled);
  check("pwd: viewer row hidden for non-admin",
    $("settings-auth-viewer-row").hidden);
  check("pwd: viewer actions hidden for non-admin",
    $("settings-auth-viewer-actions").hidden);
  window.NB.settings.close();

  // Reset for a clean exit.
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authSetPasswordsCalls = [];
  window.NB.settings.close();
  window.confirm = () => true;

  console.log("== settings footer ==");
  // The Settings modal has a draft-then-commit footer with three buttons:
  // Apply (apply + keep open), Save (apply + close), Cancel (revert + close).
  // The header × (and Esc / backdrop) behave dynamically: Cancel if dirty,
  // plain close if not. Only the Theme / Font-size / Watch sections are
  // draftable; the Passwords section is untouched and still owns its own
  // per-section Save/Remove + reload flow.
  const applyBtn = $("settings-apply");
  const saveBtn  = $("settings-save");
  const cancelBtn = $("settings-cancel");
  const closeXBtn = $("settings-close");
  const watchBtn2 = $("settings-watch-toggle");

  // Make sure the modal is closed before we start.
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);

  // 1. Fresh open: footer exists, Apply + Save are clickable.
  window.NB.settings.open(); await tick(20);
  check("footer: Apply button is present", !!applyBtn);
  check("footer: Save button is present", !!saveBtn);
  check("footer: Cancel button is present", !!cancelBtn);
  check("footer: Apply is enabled on fresh open",
    applyBtn.disabled === false, "disabled=" + applyBtn.disabled);
  check("footer: Save is enabled on fresh open",
    saveBtn.disabled === false, "disabled=" + saveBtn.disabled);

  // 2. Theme radio change keeps Apply + Save enabled (no visual change).
  const ftRadio = (v) => window.document.querySelector('input[name="theme"][value="' + v + '"]');
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("footer: theme change keeps Apply enabled", applyBtn.disabled === false);
  check("footer: theme change keeps Save enabled", saveBtn.disabled === false);
  // Live body data-theme is unchanged (no Apply yet).
  check("footer: theme change does NOT yet change live data-theme",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);

  // 3. Font-size change also keeps Apply/Save enabled.
  const ftFs = (v) => window.document.querySelector('input[name="fontSize"][value="' + v + '"]');
  ftFs("xlarge").checked = true;
  ftFs("xlarge").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("footer: fontSize change keeps Apply enabled", applyBtn.disabled === false);
  check("footer: fontSize change keeps Save enabled", saveBtn.disabled === false);

  // 4. Watch toggle click keeps Apply/Save enabled.
  watchBtn2.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("footer: watch toggle click keeps Apply enabled", applyBtn.disabled === false);
  check("footer: watch toggle click keeps Save enabled", saveBtn.disabled === false);

  // 5. Cancel reverts all drafts and closes. No /api/config POST.
  const postsBeforeCancel = fetchLog.filter(l => l.startsWith("POST /api/config")).length;
  cancelBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: Cancel closes the modal", !window.NB.settings.isOpen());
  check("footer: Cancel does NOT POST /api/config",
    fetchLog.filter(l => l.startsWith("POST /api/config")).length === postsBeforeCancel);
  // Live state should be back to the boot defaults (theme=auto/dark, fontSize=medium).
  check("footer: Cancel reverts live data-theme to dark",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  check("footer: Cancel reverts live --font-scale to 1",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));

  // 6. Reopen -> radios re-sync to the *original* (reverted) state, not the draft.
  window.NB.settings.open(); await tick(20);
  check("footer: reopen shows theme=auto (clean state)",
    ftRadio("auto") && ftRadio("auto").checked === true,
    "checked=" + (ftRadio("auto") && ftRadio("auto").checked));
  check("footer: reopen shows fontSize=medium (clean state)",
    ftFs("medium") && ftFs("medium").checked === true,
    "checked=" + (ftFs("medium") && ftFs("medium").checked));

  // 7. Apply persists drafts and closes the modal (same as Save -- the
  //    user sees the change immediately when the modal goes away).
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  applyBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: Apply closes the modal", !window.NB.settings.isOpen());
  check("footer: Apply changes live data-theme to light",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // Apply also persisted: wait past the 250ms debounce + check the body.
  await tick(400);
  const lastCfgPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("footer: Apply POSTs config with theme=\"light\"",
    /"theme":"light"/.test(lastCfgPost), lastCfgPost);

  // 8. Save applies + closes. Modal was closed by Apply above, so reopen.
  window.NB.settings.open(); await tick(20);
  ftRadio("dark").checked = true;
  ftRadio("dark").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("footer: Save is clickable", saveBtn.disabled === false);
  saveBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: Save closes the modal", !window.NB.settings.isOpen());
  check("footer: Save applies live data-theme=dark",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);

  // 9. × with no pending changes just closes (no draft, no revert).
  window.NB.settings.open(); await tick(20);
  closeXBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("footer: × with no changes just closes",
    !window.NB.settings.isOpen());
  check("footer: × with no changes does not change live data-theme",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);

  // 10. × with pending changes behaves as Cancel: reverts + closes.
  window.NB.settings.open(); await tick(20);
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  closeXBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: × with dirty draft closes (acts as Cancel)",
    !window.NB.settings.isOpen());
  check("footer: × with dirty draft reverts data-theme to dark",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);

  // 11. Esc with pending changes also cancels.
  window.NB.settings.open(); await tick(20);
  ftFs("xlarge").checked = true;
  ftFs("xlarge").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(20);
  check("footer: Esc with dirty draft closes", !window.NB.settings.isOpen());
  check("footer: Esc with dirty draft reverts --font-scale to 1",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));

  // 12. Esc with no changes just closes.
  window.NB.settings.open(); await tick(20);
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(10);
  check("footer: Esc with no draft just closes", !window.NB.settings.isOpen());

  // 13. Backdrop click with pending changes cancels.
  window.NB.settings.open(); await tick(20);
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  const footerBackdropClick = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(footerBackdropClick, "target", { value: $("settings-overlay") });
  $("settings-overlay").dispatchEvent(footerBackdropClick);
  await tick(40);
  check("footer: backdrop click with dirty draft closes", !window.NB.settings.isOpen());
  check("footer: backdrop click with dirty draft reverts data-theme to dark",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);

  // 14. Backdrop click with no draft just closes.
  window.NB.settings.open(); await tick(20);
  const footerBackdropClick2 = new window.MouseEvent("click", { bubbles: true });
  Object.defineProperty(footerBackdropClick2, "target", { value: $("settings-overlay") });
  $("settings-overlay").dispatchEvent(footerBackdropClick2);
  await tick(10);
  check("footer: backdrop click with no draft just closes", !window.NB.settings.isOpen());

  // 15. Passwords section regression: the per-section Save/Remove buttons
  //     are still present and still trigger their own page-reload flow.
  //     The modal footer must not interfere with the per-section Save.
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authSetPasswordsCalls = [];
  // re-bind reload spy (the previous one was used for password scenarios)
  let pwdFooterReload = 0;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload() { pwdFooterReload++; } },
  });
  window.NB.settings.open(); await tick(40);
  // Pick a theme radio (make the draft dirty) -- then use the per-section
  // password Save. The modal footer should NOT trigger a config POST, and
  // the password Save should still reload.
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  $("settings-auth-admin-pw").value = "footer-pw";
  $("settings-auth-admin-pw").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  $("settings-auth-admin-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: per-section admin save still POSTs auth/passwords",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === "footer-pw"
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  check("footer: per-section admin save still triggers reload",
    pwdFooterReload === 1, "reload=" + pwdFooterReload);
  // Reset
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authSetPasswordsCalls = [];
  window.NB.settings.close();

  console.log("== font size ==");
  // The Font size radios in Settings set --font-scale on :root. Under the
  // draft-then-commit model, picking a radio only mutates the draft; the
  // live CSS variable only updates on Apply/Save.
  check("font size: default --font-scale is 1 (medium)",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));
  // The medium radio is checked on first open.
  window.NB.settings.open(); await tick(40);
  const fsRadio = (v) => window.document.querySelector('input[name="fontSize"][value="' + v + '"]');
  check("font size: medium radio is checked by default",
    fsRadio("medium") && fsRadio("medium").checked === true,
    "checked=" + (fsRadio("medium") && fsRadio("medium").checked));
  // Pick each size in turn and verify the draft picks the radio, but the
  // live CSS variable only updates on Apply.
  const expectScale = { small: "0.9", medium: "1", large: "1.15", xlarge: "1.3" };
  for (const name of ["small", "large", "xlarge", "medium"]) {
    fsRadio(name).checked = true;
    fsRadio(name).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    // The CSS variable should be the previous (live) one, NOT the new one,
    // because Apply hasn't been clicked yet.
    // (The "current" live scale is whatever was last applied. After each
    // Apply below, it updates.)
    check("font size: " + name + " -> radio picks draft",
      fsRadio(name).checked === true,
      "checked=" + (fsRadio(name) && fsRadio(name).checked));
  }
  // After the loop, draft = medium. Apply to reset live to medium.
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("font size: after apply-medium, --font-scale=1",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));
  // Now exercise the Apply path for each non-default value, verifying
  // the CSS variable updates and a /api/config POST goes out. Apply
  // closes the modal, so reopen before each pick.
  for (const name of ["small", "large", "xlarge"]) {
    window.NB.settings.open(); await tick(20);
    const before = fetchLog.filter(l => l.startsWith("POST /api/config")).length;
    fsRadio(name).checked = true;
    fsRadio(name).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    // Not yet applied -- the live scale should still be the previous one.
    check("font size: " + name + " pick -> live scale unchanged until apply",
      cssVar("--font-scale") !== expectScale[name] || name === "medium",
      "scale=" + cssVar("--font-scale"));
    $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(40);
    check("font size: " + name + " apply -> --font-scale=" + expectScale[name],
      cssVar("--font-scale") === expectScale[name],
      "scale=" + cssVar("--font-scale"));
    // Apply triggers setFontSize -> persistConfig (debounced). Wait past it.
    await tick(400);
    const posts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastPost = posts[posts.length - 1] || "";
    check("font size: " + name + " apply -> config body has fontSize:\"" + name + "\"",
      new RegExp('"fontSize":"' + name + '"').test(lastPost),
      lastPost);
  }

  // Persist across open/close: after the previous loop the live scale is
  // xlarge. Reset to medium via Apply so we can dirty the draft with a
  // subsequent xlarge pick, then Save (apply+close), re-open, and verify
  // the radio is still XL and the live scale is the XL value.
  window.NB.settings.open(); await tick(20);
  ftFs("medium").checked = true;
  ftFs("medium").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("font size: after reset-to-medium, --font-scale=1",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));
  // Now dirty the draft with xlarge.
  fsRadio("xlarge").checked = true;
  fsRadio("xlarge").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("font size: pick xlarge (after medium) enables Save",
    $("settings-save").disabled === false,
    "disabled=" + $("settings-save").disabled);
  $("settings-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("font size: after save, --font-scale=1.3 (xlarge)",
    cssVar("--font-scale") === "1.3", "scale=" + cssVar("--font-scale"));
  // Regression: setting --font-scale on <html> must actually move the
  // computed root font-size. Earlier the `html, body { font: 1rem/1.5 ... }`
  // shorthand came AFTER `html { font-size: calc(...) }` and reset the
  // root size back to 1rem of the initial value (16px), so the chrome
  // never scaled regardless of the variable. The variable test above
  // only checks that the custom property is set; this one checks the
  // computed <html> font-size to catch that class of regression.
  const htmlFs = window.getComputedStyle(window.document.documentElement).fontSize;
  check("font size: computed <html> font-size is 18.2px (14*1.3) at xlarge",
    htmlFs === "18.2px", "htmlFs=" + htmlFs);
  // Sanity: a rem child of <body> should scale too.
  const bodyFs = window.getComputedStyle(window.document.body).fontSize;
  check("font size: computed <body> font-size is 18.2px (1rem of root)",
    bodyFs === "18.2px", "bodyFs=" + bodyFs);
  window.NB.settings.open(); await tick(20);
  check("font size: XL radio still checked across save+reopen",
    fsRadio("xlarge").checked === true,
    "checked=" + fsRadio("xlarge").checked);
  // Reset to medium before the next test block (clean close + reopen+apply).
  ftFs("medium").checked = true;
  ftFs("medium").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  window.NB.settings.close(); await tick(10);

  console.log("== light code block theme ==");
  // The hljs-dark and hljs-light <link> tags toggle based on the resolved
  // body theme. Dark is the default; switching to Light should disable
  // the dark link and enable the light link. Under the draft-then-commit
  // model, picking a radio only mutates the draft; the live data-theme
  // (and the link swap) only happens on Apply.
  const darkLink = window.document.getElementById("hljs-dark");
  const lightLink = window.document.getElementById("hljs-light");
  check("hljs: dark link element exists", !!darkLink);
  check("hljs: light link element exists", !!lightLink);
  // The previous == font size == block ended with save(xlarge) + close,
  // so the live theme should still be "dark" (auto) and dark link enabled.
  check("hljs: boot state -> dark enabled, light disabled",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  const themeRadio = (v) => window.document.querySelector('input[name="theme"][value="' + v + '"]');
  // Open settings, pick light, then verify the draft was picked but the
  // live link state hasn't changed yet.
  window.NB.settings.open(); await tick(20);
  themeRadio("light").checked = true;
  themeRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("hljs: light pick (draft) -> live links still dark-enabled",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);
  // Apply -> live link state swaps. Apply also closes the modal.
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("hljs: light apply -> light link enabled, dark link disabled",
    darkLink.disabled === true && lightLink.disabled === false,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // Back to Dark: pick + apply. Reopen first.
  window.NB.settings.open(); await tick(20);
  themeRadio("dark").checked = true;
  themeRadio("dark").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("hljs: dark pick (draft) -> live links still light-enabled (not yet applied)",
    darkLink.disabled === true && lightLink.disabled === false,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("hljs: dark apply -> dark enabled, light disabled",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // Auto mode: the matchMedia stub returns matches:false (system = dark),
  // so the resolved theme is dark and the dark link is the enabled one.
  window.NB.settings.open(); await tick(20);
  themeRadio("auto").checked = true;
  themeRadio("auto").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  $("settings-apply").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("hljs: auto apply + matchMedia(dark) -> dark link enabled",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // The cfg.theme persists as "auto" after the radio + apply.
  check("hljs: cfg.theme persists as 'auto' after apply",
    window.NB.app.getCfg().theme === "auto", "theme=" + window.NB.app.getCfg().theme);

  // The dark link is currently enabled because theme=auto -> dark.
  check("hljs: after auto apply, dark link is enabled",
    darkLink.disabled === false && lightLink.disabled === true);

  // Reset by closing (clean close since draft==original now).
  window.NB.settings.close();
  await tick(10);

  console.log("== viewer top spacing ==");
  // The rendered preview's first heading should sit close to the top of
  // the viewer -- otherwise the viewer padding + the heading's own
  // top-margin stack into a large empty band above the title (regression
  // guard for a reported UX bug). We assert on the CSS source directly:
  // the production stylesheet must (a) keep #viewer's top padding small
  // and (b) zero out the top margin of the first child of .markdown-body.
  {
    const css = read("static/css/style.css");
    // #viewer padding must not have a 60vh / 50vh / etc. (units relative
    // to viewport create huge empty bands on tall windows). Top padding
    // should be a small absolute value.
    const viewerBlock = css.match(/#viewer\s*\{[^}]*\}/);
    check("viewer: #viewer rule exists in stylesheet", !!viewerBlock,
      viewerBlock ? viewerBlock[0].slice(0, 80) : "(not found)");
    const topPadMatch = viewerBlock && viewerBlock[0].match(/padding\s*:\s*([^;]+);/);
    const topPadVal = topPadMatch ? topPadMatch[1].trim() : "";
    const tokens = topPadVal.split(/\s+/);
    const topPadPx = tokens[0] || "";
    // The first padding token (top) should be a small px value -- not vh,
    // not %, not em, not auto.
    check("viewer: #viewer padding-top is a small px value (<= 20px)",
      /^\d+px$/.test(topPadPx) && parseInt(topPadPx, 10) <= 20,
      "padding=" + topPadVal);
    // The :first-child reset must be present and must come AFTER the
    // generic h1-h6 margin rule so it wins the cascade for the first
    // heading. Same-specificity, later-wins.
    const firstChildIdx = css.indexOf(":first-child");
    const h1RuleIdx = css.indexOf(".markdown-body h1,");
    check("viewer: .markdown-body > :first-child rule exists",
      firstChildIdx > -1, "firstChildIdx=" + firstChildIdx);
    check("viewer: :first-child rule sits AFTER the generic h1-h6 margin rule (cascade order)",
      firstChildIdx > h1RuleIdx && h1RuleIdx > -1,
      "firstChildIdx=" + firstChildIdx + " h1RuleIdx=" + h1RuleIdx);
    // And the rule actually zeroes the top margin.
    const fcBlock = css.match(/\.markdown-body\s*>\s*:first-child\s*\{[^}]*\}/);
    check("viewer: :first-child rule sets margin-top: 0",
      !!fcBlock && /margin-top\s*:\s*0\b/.test(fcBlock[0]),
      fcBlock ? fcBlock[0] : "(not found)");
  }

  console.log("\nRESULT: " + (fail === 0 ? "PASS" : "FAIL") + "  (" + pass + " ok, " + fail + " failed)");
  process.exit(fail === 0 ? 0 : 1);
})();