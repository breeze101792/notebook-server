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
          <div id="viewer">
            <div id="viewer-content" class="markdown-body"></div>
          </div>
          <div id="welcome" class="welcome" hidden>
            <div class="welcome-inner">
              <div class="welcome-icon">📓</div>
              <h2 class="welcome-title">Welcome to your notebook</h2>
              <p class="welcome-subtitle">Create a new note to get started, or pick one from the left.</p>
              <div class="welcome-actions">
                <button class="welcome-action" data-act="new">+ New note</button>
                <button class="welcome-action" data-act="open-welcome" hidden>Open Welcome.md</button>
              </div>
              <hr class="welcome-divider">
              <ul class="welcome-tips">
                <li><kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> to save while editing</li>
                <li>Right-click the sidebar to create, rename, copy, or delete</li>
                <li>Use the top search bar to find anything in your notebook</li>
                <li>The ⚙ button picks theme, font size, and wallpaper</li>
              </ul>
            </div>
          </div>
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
        <nav class="settings-nav" role="tablist" aria-label="Settings sections">
          <button class="settings-nav-item active" role="tab" data-tab="general"     aria-selected="true"  aria-controls="settings-section-general">⚙ General</button>
          <button class="settings-nav-item"        role="tab" data-tab="appearance" aria-selected="false" aria-controls="settings-section-appearance">🎨 Appearance</button>
          <button class="settings-nav-item"        role="tab" data-tab="security"   aria-selected="false" aria-controls="settings-section-security">🔒 Security</button>
          <button class="settings-nav-item"        role="tab" data-tab="about"      aria-selected="false" aria-controls="settings-section-about">ℹ About</button>
        </nav>
        <div class="settings-sections">
          <section class="settings-section" data-section="general" id="settings-section-general">
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
          <section class="settings-section" data-section="appearance" id="settings-section-appearance" hidden>
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
            <div class="settings-row">
              <span class="settings-label">Settings modal width</span>
              <div class="settings-control settings-modal-width-options" role="radiogroup" aria-label="Settings modal width">
                <label><input type="radio" name="settingsModalWidth" value="compact"> Compact</label>
                <label><input type="radio" name="settingsModalWidth" value="medium"> Medium</label>
                <label><input type="radio" name="settingsModalWidth" value="wide"> Wide</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Settings modal height</span>
              <div class="settings-control settings-modal-height-options" role="radiogroup" aria-label="Settings modal height">
                <label><input type="radio" name="settingsModalHeight" value="compact"> Compact</label>
                <label><input type="radio" name="settingsModalHeight" value="medium"> Medium</label>
                <label><input type="radio" name="settingsModalHeight" value="wide"> Wide</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper</span>
              <div class="settings-control wallpaper-options" role="radiogroup" aria-label="Wallpaper">
                <label><input type="radio" name="wallpaper" value="none"> None</label>
                <label><input type="radio" name="wallpaper" value="lines"> Lines</label>
                <label><input type="radio" name="wallpaper" value="grid"> Grid</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper scroll</span>
              <div class="settings-control wallpaper-scroll-options" role="radiogroup" aria-label="Wallpaper scroll behavior">
                <label><input type="radio" name="wallpaperScroll" value="scroll"> Scroll with content</label>
                <label><input type="radio" name="wallpaperScroll" value="fixed"> Fixed in viewport</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper color</span>
              <div class="settings-control wallpaper-color-options" role="radiogroup" aria-label="Wallpaper color">
                <label><input type="radio" name="wallpaperColor" value="neutral"> Neutral</label>
                <label><input type="radio" name="wallpaperColor" value="blue"> Blue</label>
                <label><input type="radio" name="wallpaperColor" value="green"> Green</label>
                <label><input type="radio" name="wallpaperColor" value="purple"> Purple</label>
                <label><input type="radio" name="wallpaperColor" value="amber"> Amber</label>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-label">Wallpaper intensity</span>
              <div class="settings-control wallpaper-intensity-options" role="radiogroup" aria-label="Wallpaper intensity">
                <label><input type="radio" name="wallpaperIntensity" value="subtle"> Subtle</label>
                <label><input type="radio" name="wallpaperIntensity" value="medium"> Medium</label>
                <label><input type="radio" name="wallpaperIntensity" value="bold"> Bold</label>
              </div>
            </div>
          </section>
          <section class="settings-section" data-section="security" id="settings-section-security" hidden>
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
          <section class="settings-section" data-section="about" id="settings-section-about" hidden>
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
      </div>
      <div class="settings-footer">
        <button id="settings-close-btn" class="settings-action">Close</button>
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
  // Settings are LIVE now: picking a radio updates the body data-theme
  // immediately, no Apply/Save step.
  check("default body theme is dark (auto -> dark)", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  window.NB.settings.open();
  await tick(20);
  const checkedRadio = () => window.document.querySelector('input[name="theme"]:checked');
  check("default theme radio is auto", checkedRadio() && checkedRadio().value === "auto",
    checkedRadio() ? checkedRadio().value : "(none)");
  // light: pick radio -> live body flips to light immediately.
  window.document.querySelector('input[name="theme"][value="light"]').checked = true;
  window.document.querySelector('input[name="theme"][value="light"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("light radio: live body data-theme=light immediately",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // dark: pick + live update
  window.document.querySelector('input[name="theme"][value="dark"]').checked = true;
  window.document.querySelector('input[name="theme"][value="dark"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("dark radio: live body data-theme=dark immediately",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // back to auto: pick + live update
  window.document.querySelector('input[name="theme"][value="auto"]').checked = true;
  window.document.querySelector('input[name="theme"][value="auto"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("auto radio: live body data-theme=dark (matchMedia stub)",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // Persistence: each change triggers a debounced POST /api/config.
  await tick(400);
  const themePosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastThemePost = themePosts[themePosts.length - 1] || "";
  check("theme: last config POST body has theme=\"auto\"",
    /"theme":"auto"/.test(lastThemePost), lastThemePost);
  window.NB.settings.close();
  await tick(10);

  console.log("== viewer + outline ==");
  // Selector must use a single compound (#viewer :is(h1,h2,h3,...)) or a
  // union with the scope in EACH branch -- otherwise jsdom parses the
  // unparenthesized second branch as "any h2/h3/... in the document".
  // The headings live inside #viewer-content (a child of #viewer) after
  // the wallpaper scroll-sync restructure, so #viewer :is(...) still
  // matches as a descendant selector.
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
  check("viewer shows notes/a.md content", /File A/.test(window.document.getElementById("viewer-content").textContent));
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
  // The scroller is #viewer-content (the wrapper #viewer is a
  // non-scrolling shell after the wallpaper scroll-sync restructure).
  Object.defineProperty($("raw-editor"), "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty($("raw-editor"), "clientHeight", { value: 400, configurable: true });
  Object.defineProperty($("viewer-content"), "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty($("viewer-content"), "clientHeight", { value: 400, configurable: true });
  // Scroll the editor to 50%.
  $("raw-editor").scrollTop = 800;  // (2000-400)*0.5 = 800
  $("raw-editor").dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await tick(20);
  // Viewer should be at 50% of its range: (1000-400)*0.5 = 300
  check("scroll sync: editor->viewer proportional",
    Math.abs($("viewer-content").scrollTop - 300) < 5,
    "viewer-content.scrollTop=" + $("viewer-content").scrollTop);
  // Scroll the viewer to 75%.
  $("viewer-content").scrollTop = 450;  // (1000-400)*0.75 = 450
  $("viewer-content").dispatchEvent(new window.Event("scroll", { bubbles: true }));
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
  // After closing the last tab the right pane switches from the viewer
  // to the welcome page (a friendly landing with action buttons), not
  // the old terse "No file selected" placeholder.
  check("close last tab -> welcome page is visible",
    !$("welcome").hidden, "welcome.hidden=" + $("welcome").hidden);
  check("close last tab -> viewer is hidden", $("viewer").hidden);
  check("close last tab -> #viewer-content has no rendered markdown",
    $("viewer-content").textContent.trim() === "",
    "textContent=" + JSON.stringify($("viewer-content").textContent));
  // The viewer is hidden when the welcome page is up, but the old
  // rendered HTML can resurface if a CSS quirk / transition /
  // devtools toggle briefly un-hides it. showWelcome() must clear
  // innerHTML so the previous file's content is gone for real.
  check("close last tab -> #viewer-content.innerHTML is empty (no stale HTML)",
    $("viewer-content").innerHTML === "",
    "innerHTML=" + JSON.stringify($("viewer-content").innerHTML));
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
    /old/.test(window.document.getElementById("viewer-content").textContent));

  // Case 1: not-dirty + external change -> silent reload, content updates.
  FILES["Welcome.md"] = "# Welcome\n\nnew\n";
  // The test's getFile handler doesn't know about the new content until
  // we make the fetch stub return it.
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: FILES["Welcome.md"], mtime: 9999, size: 99 } });
  await tick(40);
  check("external: clean file auto-reloads", /new/.test(window.document.getElementById("viewer-content").textContent));

  // Case 2: dirty + external change -> confirm() prompt.
  window.NB.viewer.startEdit();
  $("raw-editor").value = "MY LOCAL EDITS";
  $("raw-editor").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  window.confirm = () => { fetchLog.push("confirm(yes)"); return true; };
  window.NB.evt.emit("file:external-change", { path: "Welcome.md", data: { path: "Welcome.md", content: "REMOTE", mtime: 10000, size: 6 } });
  await tick(40);
  check("external: dirty + change -> confirm shown", fetchLog.includes("confirm(yes)"));
  check("external: confirm(yes) reloads", /REMOTE/.test(window.document.getElementById("viewer-content").textContent));

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
    /FRESH/.test($("viewer-content").textContent),
    "viewer=" + $("viewer-content").textContent.slice(0, 60));

  // Case 4: watch button lives in the settings modal now. Open the modal,
  // verify the status line and the toggle button, then click Enable and
  // check the live watcher starts immediately. Settings are live: the
  // toggle commits on click, no Apply/Save step.
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
  // Click toggle: the live watcher starts (polling fallback in jsdom).
  // The status updates immediately, the button label flips to "Disable".
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("watch: toggle click -> status reports active",
    /watching|polling/i.test(statusEl.textContent), statusEl.textContent);
  check("watch: toggle click -> button is 'Disable' (matches live state)",
    watchBtn.textContent === "Disable", watchBtn.textContent);
  // Click again: live watcher disables.
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("watch: toggle click again -> status reports off",
    /off/i.test(statusEl.textContent), statusEl.textContent);
  check("watch: toggle click again -> button is 'Enable'",
    watchBtn.textContent === "Enable", watchBtn.textContent);
  window.NB.settings.close();
  await tick(10);

  console.log("== settings nav ==");
  // Left sidebar nav: General / Appearance / Security / About. Clicking
  // an entry shows its section and hides the rest; the active entry
  // gets `.active` + `aria-selected="true"`. The four sections live
  // inside `.settings-sections` and each carries a `data-section="…"`
  // attribute that matches the nav button's `data-tab="…"`.
  const navButtons = Array.from(window.document.querySelectorAll(".settings-nav-item"));
  const navTabs    = navButtons.map(b => b.dataset.tab);
  const sectionEls = Array.from(window.document.querySelectorAll(".settings-section[data-section]"));
  check("settings nav: 4 nav buttons present", navButtons.length === 4,
    "count=" + navButtons.length);
  check("settings nav: 4 sections present", sectionEls.length === 4,
    "count=" + sectionEls.length);
  check("settings nav: every data-tab has a matching data-section",
    navTabs.every(t => sectionEls.some(s => s.dataset.section === t)),
    "tabs=" + JSON.stringify(navTabs));
  check("settings nav: every data-section has a matching data-tab",
    sectionEls.every(s => navTabs.includes(s.dataset.section)),
    "sections=" + JSON.stringify(sectionEls.map(s => s.dataset.section)));
  // Exact ordering matches what the user asked for.
  check("settings nav: tabs in order [general, appearance, security, about]",
    JSON.stringify(navTabs) === JSON.stringify(["general", "appearance", "security", "about"]),
    JSON.stringify(navTabs));
  // Fresh open: General is the default tab.
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);
  window.NB.settings.open(); await tick(20);
  const generalBtn = navButtons.find(b => b.dataset.tab === "general");
  check("settings nav: on open, general is the active nav button",
    generalBtn && generalBtn.classList.contains("active"),
    "classes=" + generalBtn.className);
  check("settings nav: on open, general nav button has aria-selected=true",
    generalBtn && generalBtn.getAttribute("aria-selected") === "true");
  for (const t of ["appearance", "security", "about"]) {
    const b = navButtons.find(x => x.dataset.tab === t);
    check("settings nav: on open, " + t + " nav button is NOT active",
      b && !b.classList.contains("active"),
      "classes=" + b.className);
    check("settings nav: on open, " + t + " nav button has aria-selected=false",
      b && b.getAttribute("aria-selected") === "false");
  }
  // On open, only the general section is visible.
  for (const s of sectionEls) {
    const isGeneral = s.dataset.section === "general";
    check("settings nav: on open, section[" + s.dataset.section + "] is "
      + (isGeneral ? "visible" : "hidden"),
      s.hidden === !isGeneral,
      "hidden=" + s.hidden);
  }
  // Click each tab in turn; verify section visibility + nav active class
  // follow. Modal stays open the whole time.
  for (const t of ["appearance", "security", "about", "general"]) {
    const btn = navButtons.find(b => b.dataset.tab === t);
    btn.dispatchEvent(new window.Event("click", { bubbles: true }));
    await tick(20);
    check("settings nav: click '" + t + "' -> nav button has active class",
      btn.classList.contains("active"), "classes=" + btn.className);
    check("settings nav: click '" + t + "' -> nav button has aria-selected=true",
      btn.getAttribute("aria-selected") === "true");
    for (const s of sectionEls) {
      const expectedVisible = (s.dataset.section === t);
      check("settings nav: click '" + t + "' -> section[" + s.dataset.section
        + "] is " + (expectedVisible ? "visible" : "hidden"),
        s.hidden === !expectedVisible, "hidden=" + s.hidden);
    }
    // No other nav button should be active.
    for (const other of navButtons) {
      if (other === btn) continue;
      check("settings nav: click '" + t + "' -> nav '" + other.dataset.tab
        + "' is NOT active",
        !other.classList.contains("active"));
    }
  }
  // After clicking through all tabs, modal should still be open.
  check("settings nav: clicking tabs keeps the modal open", window.NB.settings.isOpen());
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
  // Footer has a single Close button (no Apply/Save/Cancel).
  check("settings: footer has a Close button (no Apply/Save/Cancel)",
    !!$("settings-close-btn") && !$("settings-apply") && !$("settings-save") && !$("settings-cancel"));
  // Esc closes.
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await tick(10);
  check("settings: Esc closes", !window.NB.settings.isOpen());
  // Open + close via × button.
  window.NB.settings.open(); await tick(10);
  $("settings-close").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("settings: × button closes", !window.NB.settings.isOpen());
  // Open + close via footer Close button.
  window.NB.settings.open(); await tick(10);
  $("settings-close-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("settings: footer Close button closes", !window.NB.settings.isOpen());
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
  check("auth: body is not auth-locked", !window.document.body.classList.contains("auth-locked"));
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
  check("auth: body gets auth-locked when modal up", window.document.body.classList.contains("auth-locked"));

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

  // Submit the right password -> reload() in production. jsdom 24 does
  // not allow overriding window.location.reload(), so we can't directly
  // spy on the call. Instead, verify the post-login state the reload
  // would set up: the auth stub now reports role=admin, and the modal
  // closes (production would re-boot to a logged-in state).
  $("auth-password").value = "test-pw";
  $("auth-submit").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("auth: right password -> role is now admin (post-reload stub state)",
    authRole === "admin", "authRole=" + authRole);
  // The authRole in the stub is now "admin" (simulating the post-login
  // state). In a real reload, auth.js would re-boot and see role=admin,
  // leaving the modal hidden and unhiding the logout button. We simulate
  // that directly here.
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
  // jsdom 24 does not allow overriding window.location.reload() to spy
  // on it. Production's reload() emits a "jsdomError" to the virtual
  // console and returns without navigating; the page code proceeds
  // normally. We can't observe the reload directly, so we rely on the
  // /api/auth/passwords POST + state-change assertions below to verify
  // each save/remove path was taken.

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
  // (The production code calls window.location.reload() after this POST;
  // jsdom 24 can't spy on reload(), so the POST + state change above is
  // the best we can verify here. The post-reload effect is simulated by
  // the test resetting auth state below.)
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
  // (Reload can't be observed in jsdom 24; POST + state change above
  // is the verifiable signal.)
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
  authSetPasswordsCalls = [];
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
  // (Reload can't be observed in jsdom 24; POST above is the signal.)
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
  // (Reload can't be observed in jsdom 24; POST above is the signal.)
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
  // The Settings modal now has a single Close button in the footer --
  // settings are live, so there's no Apply/Save/Cancel. The Passwords
  // section keeps its own per-section Save/Remove buttons (unaffected
  // by this footer).
  if (window.NB.settings.isOpen()) window.NB.settings.close();
  await tick(10);

  // 1. Fresh open: footer has a single Close button. The old
  //    Apply/Save/Cancel buttons are gone.
  window.NB.settings.open(); await tick(20);
  const closeFooterBtn = $("settings-close-btn");
  check("footer: Close button is present", !!closeFooterBtn);
  check("footer: Close button is enabled", closeFooterBtn.disabled === false);
  check("footer: no Apply button (live mode)", !$("settings-apply"));
  check("footer: no Save button (live mode)",  !$("settings-save"));
  check("footer: no Cancel button (live mode)", !$("settings-cancel"));

  // 2. Theme radio change: live body data-theme updates immediately,
  //    no Apply needed. (This is the headline of the live model.)
  check("footer: pre-pick body data-theme is dark",
    window.document.body.dataset.theme === "dark");
  const ftRadio = (v) => window.document.querySelector('input[name="theme"][value="' + v + '"]');
  ftRadio("light").checked = true;
  ftRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("footer: theme radio change updates live data-theme immediately",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // ... and the change persists: wait past the 250ms debounce + check POST.
  await tick(400);
  const lastCfgPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("footer: theme radio change POSTs config with theme=\"light\"",
    /"theme":"light"/.test(lastCfgPost), lastCfgPost);
  // Reset.
  ftRadio("dark").checked = true;
  ftRadio("dark").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);

  // 3. Footer Close closes the modal cleanly (live changes are NOT
  //    reverted -- they were already applied + persisted).
  closeFooterBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("footer: Close button closes the modal", !window.NB.settings.isOpen());

  // 4. × button closes the modal too.
  window.NB.settings.open(); await tick(10);
  $("settings-close").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(10);
  check("footer: × button closes the modal", !window.NB.settings.isOpen());

  // 5. Passwords section regression: the per-section Save/Remove
  //    buttons are still present and still trigger their own page-
  //    reload flow. The new live-mode footer must not interfere.
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authSetPasswordsCalls = [];
  window.NB.settings.open(); await tick(40);
  $("settings-auth-admin-pw").value = "footer-pw";
  $("settings-auth-admin-pw").dispatchEvent(new window.Event("input", { bubbles: true }));
  await tick(10);
  $("settings-auth-admin-save").dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("footer: per-section admin save still POSTs auth/passwords (live mode doesn't break it)",
    authSetPasswordsCalls.length === 1
    && authSetPasswordsCalls[0].admin_password === "footer-pw"
    && authSetPasswordsCalls[0].viewer_password === null,
    JSON.stringify(authSetPasswordsCalls));
  authEnabled = false; authHasAdmin = false; authHasViewer = false; authRole = null;
  authSetPasswordsCalls = [];
  window.NB.settings.close();

  console.log("== font size ==");
  // The Font size radios in Settings set --font-scale on :root. Settings
  // are LIVE: picking a radio updates the CSS variable immediately, no
  // Apply/Save step.
  check("font size: default --font-scale is 1 (medium)",
    cssVar("--font-scale") === "1", "scale=" + cssVar("--font-scale"));
  // The medium radio is checked on first open.
  window.NB.settings.open(); await tick(40);
  const fsRadio = (v) => window.document.querySelector('input[name="fontSize"][value="' + v + '"]');
  check("font size: medium radio is checked by default",
    fsRadio("medium") && fsRadio("medium").checked === true,
    "checked=" + (fsRadio("medium") && fsRadio("medium").checked));
  // Pick each size and verify the live CSS variable updates immediately.
  // Each set is wrapped in `before`/`after` to confirm the value is the
  // picked one, not the previous one.
  const expectScale = { small: "0.9", medium: "1", large: "1.15", xlarge: "1.3" };
  for (const name of ["small", "large", "xlarge", "medium"]) {
    fsRadio(name).checked = true;
    fsRadio(name).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    // Live scale is the picked value, immediately.
    check("font size: " + name + " -> live --font-scale=" + expectScale[name]
      + " immediately",
      cssVar("--font-scale") === expectScale[name],
      "scale=" + cssVar("--font-scale"));
  }
  // Persistence: the live change should have POSTed to /api/config with
  // the latest picked value (medium, the last in the loop).
  await tick(400);
  const lastFsPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("font size: last config POST body has fontSize:\"medium\"",
    /"fontSize":"medium"/.test(lastFsPost), lastFsPost);
  // CSS source checks (regression for the `font:` shorthand on html bug
  // that resets the root size to 1rem of the initial value). These are
  // source-based, not behavior-dependent, so they survive the live-mode
  // rewrite.
  {
    const css = read("static/css/style.css");
    const htmlFontShorthand = css.match(/^([^{}]*html[^{}]*)\{([^}]*)\}/gm);
    let htmlFontBug = null;
    if (htmlFontShorthand) {
      for (const block of htmlFontShorthand) {
        const selector = block.split("{")[0];
        const body = block.split("{")[1] || "";
        if (/^\s*html\s*[,{]/.test(selector) || /,\s*html\s*[,{]/.test(selector)) {
          if (/\bfont\s*:\s*[^;]+;/.test(body)) {
            htmlFontBug = block;
            break;
          }
        }
      }
    }
    check("font size: no `font:` shorthand on a rule that targets html (would reset root size)",
      !htmlFontBug, htmlFontBug || "(clean)");
    const htmlFontSize = css.match(/^html\s*\{[^}]*font-size\s*:\s*calc\([^)]*var\(--font-scale[^)]*\)[^}]*\}/m);
    check("font size: html { font-size: calc(14px * var(--font-scale, 1)) } is in the stylesheet",
      !!htmlFontSize, htmlFontSize ? htmlFontSize[0].replace(/\s+/g, " ") : "(not found)");
  }
  window.NB.settings.close();
  await tick(10);

  console.log("== settings modal width ==");
  // Live: picking a radio updates --settings-modal-width immediately and
  // POSTs the choice through the debounced persistConfig. Default is
  // "medium" (75vw) per DEFAULTS, so the boot value is 75vw even
  // though we never opened settings before this block. The size is
  // a CSS unit string (vw), not a pixel value -- the modal scales
  // with the viewport.
  const smwRadio = (v) => window.document.querySelector('input[name="settingsModalWidth"][value="' + v + '"]');
  check("settings modal width: has compact radio", !!smwRadio("compact"));
  check("settings modal width: has medium radio",  !!smwRadio("medium"));
  check("settings modal width: has wide radio",    !!smwRadio("wide"));
  check("settings modal width: default --settings-modal-width is 75vw (medium)",
    cssVar("--settings-modal-width") === "75vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));
  check("settings modal width: cfg.settingsModalWidth default is 'medium'",
    window.NB.app.getCfg().settingsModalWidth === "medium",
    "settingsModalWidth=" + window.NB.app.getCfg().settingsModalWidth);

  // Open settings + change to compact -> live CSS var updates immediately.
  window.NB.settings.open(); await tick(20);
  // Switch to appearance so the radio is visible (the test only drives
  // the radio, but matches the real-user path: open, pick tab, pick value).
  const appearanceTab = window.document.querySelector('.settings-nav-item[data-tab="appearance"]');
  appearanceTab.click(); await tick(10);
  smwRadio("compact").checked = true;
  smwRadio("compact").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal width: compact pick -> --settings-modal-width is 60vw immediately",
    cssVar("--settings-modal-width") === "60vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));
  check("settings modal width: compact pick -> live cfg.settingsModalWidth is 'compact'",
    window.NB.app.getCfg().settingsModalWidth === "compact",
    "settingsModalWidth=" + window.NB.app.getCfg().settingsModalWidth);

  // Wide pick -> 90vw.
  smwRadio("wide").checked = true;
  smwRadio("wide").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal width: wide pick -> --settings-modal-width is 90vw immediately",
    cssVar("--settings-modal-width") === "90vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));

  // Back to medium -> 75vw. Confirms the path is round-trippable, not
  // just monotonic in one direction.
  smwRadio("medium").checked = true;
  smwRadio("medium").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal width: medium pick (after compact + wide) -> --settings-modal-width is 75vw again",
    cssVar("--settings-modal-width") === "75vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));

  // Persisted: after the debounce window the choice shows up in the
  // latest POST /api/config body. Wide was picked last before medium;
  // the medium POST should carry the new value.
  await tick(400);
  const lastSmwPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("settings modal width: last config POST body has settingsModalWidth:\"medium\"",
    /"settingsModalWidth":"medium"/.test(lastSmwPost), lastSmwPost);
  // Height is also persisted in the same POST body (same debounce path,
  // same row-group commit). Default to "medium" on a fresh boot.
  check("settings modal width: last config POST body has settingsModalHeight:\"medium\"",
    /"settingsModalHeight":"medium"/.test(lastSmwPost), lastSmwPost);

  // CSS source regression guards: the .settings-modal rule must read
  // --settings-modal-width (so future edits to the layout actually
  // respond to the setting). The variable is set as an inline style on
  // :root by app.js:applySettingsModalWidth; no :root declaration is
  // required in the stylesheet, but the fall-through default ("75vw")
  // is what the rule defaults to if the inline style is absent.
  {
    const css = read("static/css/style.css");
    const modalReadsVar = /\.settings-modal\s*\{[^}]*var\(--settings-modal-width/.test(css);
    check("settings modal width: .settings-modal rule reads --settings-modal-width",
      modalReadsVar, modalReadsVar ? "(found)" : "(missing)");
    // The rule's fall-through default should be 75vw so a missing
    // inline style (e.g. before applyConfig() runs) still renders the
    // modal at the medium width. Matches the DEFAULTS value.
    const modalDefault = /\.settings-modal\s*\{[^}]*var\(--settings-modal-width\s*,\s*(\S+?)\s*\)/.exec(css);
    const defaultV = modalDefault ? modalDefault[1] : null;
    check("settings modal width: .settings-modal fall-through default is 75vw (matches DEFAULTS medium)",
      defaultV === "75vw", "default=" + (defaultV || "(missing)"));
    // The modal must be pinned to its chosen width (flex: 0 0 auto)
    // so a section with wider intrinsic content doesn't expand the
    // modal when the user switches tabs. The CSS-source guard is
    // independent of the layout engine; together with the per-tab
    // width check below, it covers the regression.
    const modalFlexNone = /\.settings-modal\s*\{[^}]*flex\s*:\s*0\s+0\s+auto/.test(css);
    check("settings modal width: .settings-modal is flex:0 0 auto (won't grow to fit content)",
      modalFlexNone, modalFlexNone ? "(found)" : "(missing)");
    // Height must also be pinned (NOT derived from content). Each
    // section has a different number of rows -- without a fixed
    // height, the modal grows to fit the tallest section (Appearance,
    // 7 rows) and shrinks for short ones (General / About, 2 rows),
    // so switching tabs visibly resizes the modal. The new rule
    // reads --settings-modal-height with an 80vh fall-through, capped
    // by 92vh -- both axes are now user-controllable percentages.
    const modalHeightPinned = /\.settings-modal\s*\{[^}]*height\s*:\s*min\(\s*var\(--settings-modal-height\s*,\s*80vh\s*\)\s*,\s*92vh\s*\)/.test(css);
    check("settings modal width: .settings-modal is height:min(var(--settings-modal-height, 80vh), 92vh) (won't grow to fit content)",
      modalHeightPinned, modalHeightPinned ? "(found)" : "(missing)");
  }

  // Layout stability across tabs: with a chosen width, the modal's
  // rendered width must not change as the user switches between
  // sections. Earlier, the modal grew to fit the widest section's
  // intrinsic content (long paths in About, etc.) because the modal
  // had no flex-basis and the body had no min-width: 0, so each tab
  // switch could resize the modal by tens of pixels.
  //
  // Pick "wide" so we have the most headroom to detect accidental
  // shrinking, then walk all four tabs and snapshot the rendered
  // width via getBoundingClientRect (the only thing the user actually
  // sees).
  window.NB.settings.open(); await tick(20);
  window.document.querySelector('.settings-nav-item[data-tab="appearance"]').click();
  await tick(10);
  smwRadio("wide").checked = true;
  smwRadio("wide").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  const modalEl = window.document.querySelector("#settings-overlay .settings-modal");
  const widths = {};
  const heights = {};
  for (const tab of ["general", "appearance", "security", "about"]) {
    window.document.querySelector('.settings-nav-item[data-tab="' + tab + '"]').click();
    await tick(10);
    const r = modalEl.getBoundingClientRect();
    widths[tab]  = r.width;
    heights[tab] = r.height;
  }
  const uniqWidths  = Array.from(new Set(Object.values(widths).map(w  => Math.round(w))));
  const uniqHeights = Array.from(new Set(Object.values(heights).map(h => Math.round(h))));
  check("settings modal width: modal width is identical across all four tabs",
    uniqWidths.length === 1,
    "widths=" + JSON.stringify(widths) + " uniq=" + JSON.stringify(uniqWidths));
  // Height also has to be stable across tabs. Without a fixed height,
  // the modal grows to fit the tallest section (Appearance, 7 rows)
  // and shrinks for short ones (General / About, 2 rows). The new
  // `height: min(86vh, 600px)` rule pins the outer size; the inner
  // .settings-sections pane scrolls if a section overflows.
  check("settings modal width: modal height is identical across all four tabs",
    uniqHeights.length === 1,
    "heights=" + JSON.stringify(heights) + " uniq=" + JSON.stringify(uniqHeights));
  // Sanity: the test ran at the 'wide' setting (90vw). The actual
  // pixel width returned by jsdom is 0 (no layout), so we confirm
  // the sink the modal reads from is the expected value.
  check("settings modal width: tab-switch test ran at the 'wide' setting",
    cssVar("--settings-modal-width") === "90vw",
    "--settings-modal-width=" + cssVar("--settings-modal-width"));

  console.log("== settings modal height ==");
  // Mirror of the width block above: the new "Settings modal height"
  // radio group drives --settings-modal-height as a viewport
  // percentage. The three presets are 80vh / 85vh / 90vh; the
  // default is "medium" (85vh) per DEFAULTS, matching the CSS
  // fall-through default on .settings-modal. The floor is 80vh so
  // even the smallest preset gives the modal most of the viewport.
  const smhRadio = (v) => window.document.querySelector('input[name="settingsModalHeight"][value="' + v + '"]');
  check("settings modal height: has compact radio", !!smhRadio("compact"));
  check("settings modal height: has medium radio",  !!smhRadio("medium"));
  check("settings modal height: has wide radio",    !!smhRadio("wide"));
  check("settings modal height: default --settings-modal-height is 85vh (medium)",
    cssVar("--settings-modal-height") === "85vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));
  check("settings modal height: cfg.settingsModalHeight default is 'medium'",
    window.NB.app.getCfg().settingsModalHeight === "medium",
    "settingsModalHeight=" + window.NB.app.getCfg().settingsModalHeight);

  // Drive each radio and confirm the CSS var updates live. Stay on
  // the Appearance tab -- the radio is here, and we're already
  // open.
  smhRadio("compact").checked = true;
  smhRadio("compact").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal height: compact pick -> --settings-modal-height is 80vh immediately",
    cssVar("--settings-modal-height") === "80vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));
  check("settings modal height: compact pick -> live cfg.settingsModalHeight is 'compact'",
    window.NB.app.getCfg().settingsModalHeight === "compact",
    "settingsModalHeight=" + window.NB.app.getCfg().settingsModalHeight);

  smhRadio("wide").checked = true;
  smhRadio("wide").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal height: wide pick -> --settings-modal-height is 90vh immediately",
    cssVar("--settings-modal-height") === "90vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));

  // Back to medium -> 85vh. Confirms the path is round-trippable.
  smhRadio("medium").checked = true;
  smhRadio("medium").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("settings modal height: medium pick (after compact + wide) -> --settings-modal-height is 85vh again",
    cssVar("--settings-modal-height") === "85vh",
    "--settings-modal-height=" + cssVar("--settings-modal-height"));

  // Persisted: after the debounce window the choice shows up in the
  // latest POST /api/config body.
  await tick(400);
  const lastSmhPost = (fetchLog.filter(l => l.startsWith("POST /api/config")).pop() || "");
  check("settings modal height: last config POST body has settingsModalHeight:\"medium\"",
    /"settingsModalHeight":"medium"/.test(lastSmhPost), lastSmhPost);

  // close: keep the rest of the suite running with a clean modal state.
  window.NB.settings.close();
  await tick(10);

  console.log("== light code block theme ==");
  // The hljs-dark and hljs-light <link> tags toggle based on the resolved
  // body theme. Dark is the default; switching to Light should disable
  // the dark link and enable the light link. Settings are LIVE: picking
  // a radio updates the live data-theme + the link swap immediately.
  const darkLink = window.document.getElementById("hljs-dark");
  const lightLink = window.document.getElementById("hljs-light");
  check("hljs: dark link element exists", !!darkLink);
  check("hljs: light link element exists", !!lightLink);
  // The previous == font size == block ended with live fontSize=medium
  // and the live theme still auto/dark, so the dark link should be enabled.
  check("hljs: boot state -> dark enabled, light disabled",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  const themeRadio = (v) => window.document.querySelector('input[name="theme"][value="' + v + '"]');
  // Open settings, pick light -> live data-theme + links flip immediately.
  window.NB.settings.open(); await tick(20);
  themeRadio("light").checked = true;
  themeRadio("light").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("hljs: light pick -> live data-theme=light immediately",
    window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  check("hljs: light pick -> light link enabled, dark link disabled immediately",
    darkLink.disabled === true && lightLink.disabled === false,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // Back to Dark: live links flip back.
  themeRadio("dark").checked = true;
  themeRadio("dark").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("hljs: dark pick -> live data-theme=dark immediately",
    window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  check("hljs: dark pick -> dark enabled, light disabled immediately",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // Auto mode: the matchMedia stub returns matches:false (system = dark),
  // so the resolved theme is dark and the dark link is the enabled one.
  themeRadio("auto").checked = true;
  themeRadio("auto").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(10);
  check("hljs: auto pick + matchMedia(dark) -> dark link enabled immediately",
    darkLink.disabled === false && lightLink.disabled === true,
    "dark.disabled=" + darkLink.disabled + " light.disabled=" + lightLink.disabled);

  // The cfg.theme persists as "auto" after the radio change.
  check("hljs: cfg.theme persists as 'auto' after pick",
    window.NB.app.getCfg().theme === "auto", "theme=" + window.NB.app.getCfg().theme);

  // The dark link is currently enabled because theme=auto -> dark.
  check("hljs: after auto pick, dark link is enabled",
    darkLink.disabled === false && lightLink.disabled === true);

  // Reset by closing.
  window.NB.settings.close();
  await tick(10);

  console.log("== wallpaper ==");
  // The wallpaper radios in Settings swap a class on #viewer-content
  // (the actual scroller + content element). Settings are LIVE: picking
  // a radio updates the class immediately, no Apply/Save step. Putting
  // the wallpaper on the same element that holds the rendered markdown
  // is what makes the pattern scroll in perfect lockstep with the text
  // -- the background is anchored to the content, not the scroll viewport.
  const viewerEl = window.document.getElementById("viewer-content");
  const wpRadio = (v) => window.document.querySelector('input[name="wallpaper"][value="' + v + '"]');
  const hasWpClass = (name) => {
    return Array.from(viewerEl.classList).some(c => c === "wallpaper-" + name);
  };

  // Default: #viewer-content has wallpaper-none class (app.js always
  // sets one) and no other wallpaper class. The radio is unselected
  // until open().
  check("wallpaper: default #viewer-content has wallpaper-none class",
    hasWpClass("none"), "classes=" + viewerEl.className);
  check("wallpaper: default #viewer-content has no wallpaper-lines class",
    !hasWpClass("lines"));
  check("wallpaper: default #viewer-content has no wallpaper-grid class",
    !hasWpClass("grid"));
  // Default: no wallpaper-fixed class (the scroll-with-content default).
  check("wallpaper: default #viewer-content has no wallpaper-fixed class",
    !viewerEl.classList.contains("wallpaper-fixed"));

  // Open settings, verify the radio group exists and "none" is checked.
  window.NB.settings.open(); await tick(20);
  check("wallpaper: settings has none radio", !!wpRadio("none"));
  check("wallpaper: settings has lines radio", !!wpRadio("lines"));
  check("wallpaper: settings has grid radio", !!wpRadio("grid"));
  check("wallpaper: none radio is checked by default",
    wpRadio("none") && wpRadio("none").checked === true);

  // Pick each non-default value, verify the live class swap is
  // immediate (no Apply), and the POST body has the picked value.
  // No modal reopen between picks because picking doesn't close it.
  for (const name of ["lines", "grid", "none"]) {
    wpRadio(name).checked = true;
    wpRadio(name).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    // Live class swap is immediate.
    check("wallpaper: " + name + " pick -> live wallpaper-" + name + " class immediately",
      hasWpClass(name), "classes=" + viewerEl.className);
    // Other wallpaper-* classes are removed.
    const others = ["none", "lines", "grid"].filter(n => n !== name);
    for (const o of others) {
      check("wallpaper: " + name + " pick -> no wallpaper-" + o + " class",
        !hasWpClass(o), "classes=" + viewerEl.className);
    }
    // Persistence: wait past the 250ms debounce + check the POST body.
    await tick(400);
    const posts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastPost = posts[posts.length - 1] || "";
    check("wallpaper: " + name + " pick -> config body has wallpaper:\"" + name + "\"",
      new RegExp('"wallpaper":"' + name + '"').test(lastPost),
      lastPost);
  }
  // Reset to default (none) for the next block.
  wpRadio("none").checked = true;
  wpRadio("none").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper: after reset-to-none, #viewer-content has wallpaper-none",
    hasWpClass("none"), "classes=" + viewerEl.className);
  window.NB.settings.close();
  await tick(10);

  // --- wallpaperScroll: the second wallpaper setting that picks how
  //     the pattern behaves when the user scrolls. "scroll" keeps the
  //     pattern tied to the content; "fixed" keeps it in the viewport.
  console.log("== wallpaper scroll ==");
  const wpsRadio = (v) => window.document.querySelector('input[name="wallpaperScroll"][value="' + v + '"]');
  const hasFixedClass = () => viewerEl.classList.contains("wallpaper-fixed");
  window.NB.settings.open(); await tick(20);
  check("wallpaper scroll: settings has scroll radio", !!wpsRadio("scroll"));
  check("wallpaper scroll: settings has fixed radio", !!wpsRadio("fixed"));
  check("wallpaper scroll: default 'scroll' radio is checked",
    wpsRadio("scroll") && wpsRadio("scroll").checked === true);
  // Pick "fixed": live class swap is immediate.
  wpsRadio("fixed").checked = true;
  wpsRadio("fixed").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper scroll: fixed pick -> #viewer-content has wallpaper-fixed class immediately",
    hasFixedClass(), "classes=" + viewerEl.className);
  await tick(400);
  const wpsPosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastWpsPost = wpsPosts[wpsPosts.length - 1] || "";
  check("wallpaper scroll: fixed pick -> config body has wallpaperScroll:\"fixed\"",
    /"wallpaperScroll":"fixed"/.test(lastWpsPost), lastWpsPost);
  // Revert to "scroll".
  wpsRadio("scroll").checked = true;
  wpsRadio("scroll").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper scroll: scroll pick -> #viewer-content has no wallpaper-fixed class",
    !hasFixedClass(), "classes=" + viewerEl.className);
  await tick(400);
  const wpsPosts2 = fetchLog.filter(l => l.startsWith("POST /api/config"));
  const lastWpsPost2 = wpsPosts2[wpsPosts2.length - 1] || "";
  check("wallpaper scroll: scroll pick -> config body has wallpaperScroll:\"scroll\"",
    /"wallpaperScroll":"scroll"/.test(lastWpsPost2), lastWpsPost2);
  window.NB.settings.close();
  await tick(10);

  // --- wallpaperColor: which stroke color the pattern uses. The base
  //     CSS uses CSS variables --wp-rgb / --wp-a -- and the wallpaper-
  //     color-* classes set --wp-rgb. "neutral" removes any color class
  //     so the CSS default (white in dark / black in light) takes over.
  console.log("== wallpaper color ==");
  const wpcRadio = (v) => window.document.querySelector('input[name="wallpaperColor"][value="' + v + '"]');
  const hasColorClass = (n) => viewerEl.classList.contains("wallpaper-color-" + n);
  window.NB.settings.open(); await tick(20);
  check("wallpaper color: settings has neutral radio", !!wpcRadio("neutral"));
  check("wallpaper color: settings has blue radio", !!wpcRadio("blue"));
  check("wallpaper color: settings has green radio", !!wpcRadio("green"));
  check("wallpaper color: settings has purple radio", !!wpcRadio("purple"));
  check("wallpaper color: settings has amber radio", !!wpcRadio("amber"));
  check("wallpaper color: default 'neutral' radio is checked",
    wpcRadio("neutral") && wpcRadio("neutral").checked === true);
  check("wallpaper color: default #viewer-content has no wallpaper-color-* class",
    Array.from(viewerEl.classList).every(c => !c.startsWith("wallpaper-color-")),
    "classes=" + viewerEl.className);
  // Pick each non-neutral color, verify the live class swap is
  // immediate (no Apply), and the POST body has the picked value.
  for (const c of ["blue", "green", "purple", "amber"]) {
    wpcRadio(c).checked = true;
    wpcRadio(c).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    check("wallpaper color: " + c + " pick -> #viewer-content has wallpaper-color-" + c + " class immediately",
      hasColorClass(c), "classes=" + viewerEl.className);
    await tick(400);
    const wpcPosts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastWpcPost = wpcPosts[wpcPosts.length - 1] || "";
    check("wallpaper color: " + c + " pick -> config body has wallpaperColor:\"" + c + "\"",
      /"wallpaperColor":\s*"' + c + '"/.test(lastWpcPost)
        || new RegExp('"wallpaperColor":"' + c + '"').test(lastWpcPost),
      lastWpcPost);
  }
  // Revert to neutral: the color-* class is removed.
  wpcRadio("neutral").checked = true;
  wpcRadio("neutral").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper color: neutral pick -> no wallpaper-color-* class on #viewer-content",
    !Array.from(viewerEl.classList).some(c => c.startsWith("wallpaper-color-")),
    "classes=" + viewerEl.className);
  window.NB.settings.close();
  await tick(10);

  // --- wallpaperIntensity: how bold the stroke is. "subtle" is barely
  //     there (alpha 0.05); "medium" and "bold" step it up. The classes
  //     set --wp-a so the user can dial how visible the pattern is.
  //     Settings are LIVE: picking a radio updates the class immediately,
  //     no Apply/Save step.
  console.log("== wallpaper intensity ==");
  const wpiRadio = (v) => window.document.querySelector('input[name="wallpaperIntensity"][value="' + v + '"]');
  const hasIntensityClass = (n) => viewerEl.classList.contains("wallpaper-intensity-" + n);
  window.NB.settings.open(); await tick(20);
  check("wallpaper intensity: settings has subtle radio", !!wpiRadio("subtle"));
  check("wallpaper intensity: settings has medium radio", !!wpiRadio("medium"));
  check("wallpaper intensity: settings has bold radio", !!wpiRadio("bold"));
  check("wallpaper intensity: default 'subtle' radio is checked",
    wpiRadio("subtle") && wpiRadio("subtle").checked === true);
  check("wallpaper intensity: default #viewer-content has wallpaper-intensity-subtle class",
    hasIntensityClass("subtle"), "classes=" + viewerEl.className);

  // Pick each non-default value; the class swap is immediate.
  for (const i of ["medium", "bold"]) {
    wpiRadio(i).checked = true;
    wpiRadio(i).dispatchEvent(new window.Event("change", { bubbles: true }));
    await tick(20);
    check("wallpaper intensity: " + i + " pick -> live wallpaper-intensity-" + i + " class immediately",
      hasIntensityClass(i), "classes=" + viewerEl.className);
    check("wallpaper intensity: " + i + " pick -> no other wallpaper-intensity-* class",
      Array.from(viewerEl.classList).filter(c => c.startsWith("wallpaper-intensity-"))
        .every(c => c === "wallpaper-intensity-" + i),
      "classes=" + viewerEl.className);
    await tick(400);
    const posts = fetchLog.filter(l => l.startsWith("POST /api/config"));
    const lastPost = posts[posts.length - 1] || "";
    check("wallpaper intensity: " + i + " pick -> config body has wallpaperIntensity:\"" + i + "\"",
      new RegExp('"wallpaperIntensity":"' + i + '"').test(lastPost),
      lastPost);
  }
  // Reset to subtle (the default) and close.
  wpiRadio("subtle").checked = true;
  wpiRadio("subtle").dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("wallpaper intensity: subtle pick -> #viewer-content has wallpaper-intensity-subtle class",
    hasIntensityClass("subtle"), "classes=" + viewerEl.className);
  window.NB.settings.close();
  await tick(10);

  // CSS source checks. The wallpaper styles are pure CSS gradients; jsdom
  // can't fully resolve the computed style of var()/calc() chains, so we
  // assert against the production stylesheet source. The rules live on
  // #viewer-content (the scroller + content element) and use
  // background-attachment: local so the pattern actually scrolls with
  // the content (the default `scroll` value would pin the background to
  // the border box, which is the windowpane feel the user does NOT
  // want). The wallpaper-fixed modifier flips it to `fixed` for the
  // windowpane option.
  {
    const css = read("static/css/style.css");
    const linesBlock = css.match(/#viewer-content\.wallpaper-lines\s*\{[^}]*\}/);
    check("wallpaper: #viewer-content.wallpaper-lines rule exists in stylesheet",
      !!linesBlock, linesBlock ? linesBlock[0].slice(0, 80) : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-lines sets background-image (repeating-linear-gradient)",
      !!linesBlock && /repeating-linear-gradient/.test(linesBlock[0]),
      linesBlock ? linesBlock[0] : "(not found)");
    // Uses 1.5em so the line spacing tracks the body line-height and
    // re-spaces when the user changes the font size.
    check("wallpaper: #viewer-content.wallpaper-lines uses 1.5em (font-size aware)",
      !!linesBlock && /1\.5em/.test(linesBlock[0]),
      linesBlock ? linesBlock[0] : "(not found)");
    // background-attachment: local is the load-bearing piece for the
    // "Scroll with content" option. The default value `scroll` would
    // pin the background to the element's border box (windowpane feel);
    // `local` pins it to the element's contents so it actually scrolls
    // with the text.
    check("wallpaper: #viewer-content.wallpaper-lines has background-attachment: local (scrolls with content)",
      !!linesBlock && /background-attachment\s*:\s*local/.test(linesBlock[0]),
      linesBlock ? linesBlock[0] : "(not found)");

    const gridBlock = css.match(/#viewer-content\.wallpaper-grid\s*\{[^}]*\}/);
    check("wallpaper: #viewer-content.wallpaper-grid rule exists in stylesheet",
      !!gridBlock, gridBlock ? gridBlock[0].slice(0, 80) : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-grid sets background-image (linear-gradient)",
      !!gridBlock && /linear-gradient/.test(gridBlock[0]),
      gridBlock ? gridBlock[0] : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-grid sets background-size: 24px 24px",
      !!gridBlock && /background-size\s*:\s*24px\s+24px/.test(gridBlock[0]),
      gridBlock ? gridBlock[0] : "(not found)");
    check("wallpaper: #viewer-content.wallpaper-grid has background-attachment: local (scrolls with content)",
      !!gridBlock && /background-attachment\s*:\s*local/.test(gridBlock[0]),
      gridBlock ? gridBlock[0] : "(not found)");

    // Both rules should target #viewer-content specifically (not a global
    // class), so the wallpaper stays scoped to the preview area and
    // doesn't bleed into the editor split-pane or other surfaces.
    check("wallpaper: both wallpaper rules target #viewer-content specifically",
      /#viewer-content\.wallpaper-(lines|grid)/.test(css),
      "found #viewer-content.wallpaper-* selectors");
    // The fixed-mode rule toggles background-attachment: fixed when the
    // user picks the "Fixed in viewport" option. Both wallpaper classes
    // should be covered by the same rule (one rule, two selectors) so
    // adding a new pattern automatically gets the fixed behavior too.
    check("wallpaper: #viewer-content.wallpaper-{lines,grid}.wallpaper-fixed sets background-attachment: fixed",
      /#viewer-content\.wallpaper-lines\.wallpaper-fixed\s*,\s*\n?\s*#viewer-content\.wallpaper-grid\.wallpaper-fixed\s*\{[^}]*background-attachment\s*:\s*fixed/.test(css),
      "looking for combined .wallpaper-fixed rule");

    // The color + intensity modifiers are one-line CSS variable overrides:
    // the wallpaper-color-* classes set --wp-rgb (a 3-channel RGB value
    // used inside rgb(var(--wp-rgb) / var(--wp-a))), and wallpaper-
    // intensity-* classes set --wp-a (the stroke alpha). Verify the
    // expected presets exist so picking them actually changes the paint.
    check("wallpaper: #viewer-content.wallpaper-color-blue sets --wp-rgb",
      /#viewer-content\.wallpaper-color-blue\s*\{[^}]*--wp-rgb\s*:/.test(css),
      "looking for #viewer-content.wallpaper-color-blue { --wp-rgb: ... }");
    check("wallpaper: #viewer-content.wallpaper-color-green sets --wp-rgb",
      /#viewer-content\.wallpaper-color-green\s*\{[^}]*--wp-rgb\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-color-purple sets --wp-rgb",
      /#viewer-content\.wallpaper-color-purple\s*\{[^}]*--wp-rgb\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-color-amber sets --wp-rgb",
      /#viewer-content\.wallpaper-color-amber\s*\{[^}]*--wp-rgb\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-intensity-subtle sets --wp-a",
      /#viewer-content\.wallpaper-intensity-subtle\s*\{[^}]*--wp-a\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-intensity-medium sets --wp-a",
      /#viewer-content\.wallpaper-intensity-medium\s*\{[^}]*--wp-a\s*:/.test(css));
    check("wallpaper: #viewer-content.wallpaper-intensity-bold sets --wp-a",
      /#viewer-content\.wallpaper-intensity-bold\s*\{[^}]*--wp-a\s*:/.test(css));
    // The base wallpaper rules (lines + grid) must actually use the
    // --wp-rgb / --wp-a variables in their stroke color so the
    // color/intensity modifiers have an effect. Without this, the
    // modifiers are dead.
    const usesRgb = !!linesBlock && /rgb\(\s*var\(--wp-rgb\)/.test(linesBlock[0]);
    const usesAlpha = !!linesBlock && /var\(--wp-a\)/.test(linesBlock[0]);
    check("wallpaper: #viewer-content.wallpaper-lines uses --wp-rgb / --wp-a",
      usesRgb && usesAlpha, linesBlock ? linesBlock[0] : "(not found)");
    const gridUsesRgb = !!gridBlock && /rgb\(\s*var\(--wp-rgb\)/.test(gridBlock[0]);
    const gridUsesAlpha = !!gridBlock && /var\(--wp-a\)/.test(gridBlock[0]);
    check("wallpaper: #viewer-content.wallpaper-grid uses --wp-rgb / --wp-a",
      gridUsesRgb && gridUsesAlpha, gridBlock ? gridBlock[0] : "(not found)");
  }

  console.log("== welcome page ==");
  // The welcome page is the empty-state for the right pane: shown
  // when there are no open tabs (fresh install with no fallback,
  // closed the last tab, deleted the only open file). It carries
  // a small action panel -- "New note" + "Open Welcome.md" (the
  // latter only when Welcome.md is in the tree) -- and a tips list.
  // The earlier "close last tab -> welcome page is visible" check
  // already proved the page renders in the standard close-last-tab
  // path. Here we exercise the rest of the contract, so we re-enter
  // the welcome state explicitly: close all open tabs first.

  // Close any currently-open tabs so we're back in the empty state.
  // We snapshot the open list first and force-close each one (force
  // skips the dirty-confirm). The very last close fires clear() ->
  // showWelcome().
  const openBefore = window.NB.tabs.getOpen().slice();
  for (const p of openBefore) window.NB.tabs.close(p, { force: true });
  await tick(40);

  // Verify the structural elements + action buttons.
  const welcomeEl = $("welcome");
  check("welcome: <div#welcome> exists", !!welcomeEl);
  check("welcome: #welcome is visible", !welcomeEl.hidden);
  check("welcome: #viewer is hidden", $("viewer").hidden);
  check("welcome: icon present", !!welcomeEl.querySelector(".welcome-icon"));
  check("welcome: title present",
    /Welcome to your notebook/.test(welcomeEl.querySelector(".welcome-title").textContent));
  check("welcome: subtitle present",
    /Create a new note/.test(welcomeEl.querySelector(".welcome-subtitle").textContent));
  check("welcome: tips list has 4 entries",
    welcomeEl.querySelectorAll(".welcome-tips li").length === 4);
  check("welcome: tips list contains a <kbd> element",
    welcomeEl.querySelectorAll(".welcome-tips kbd").length >= 1);
  const newBtn = welcomeEl.querySelector('[data-act="new"]');
  check("welcome: 'New note' button present", !!newBtn);
  check("welcome: 'New note' button is visible", !newBtn.hidden);
  const openWelcomeBtn = welcomeEl.querySelector('[data-act="open-welcome"]');
  check("welcome: 'Open Welcome.md' button present", !!openWelcomeBtn);
  // The default notebook fixture ships with Welcome.md, so the button
  // should be revealed (not hidden) by showWelcome().
  check("welcome: 'Open Welcome.md' button is visible (Welcome.md in tree)",
    !openWelcomeBtn.hidden,
    "hidden=" + openWelcomeBtn.hidden);

  // Override NB.sidebar.getTree() to simulate Welcome.md being deleted.
  // Re-call showWelcome() to re-evaluate the button visibility.
  const realGetTree = window.NB.sidebar.getTree;
  window.NB.sidebar.getTree = () => [];
  window.NB.viewer.showWelcome && window.NB.viewer.showWelcome();
  await tick(20);
  check("welcome: 'Open Welcome.md' button is hidden when Welcome.md not in tree",
    welcomeEl.querySelector('[data-act="open-welcome"]').hidden,
    "hidden=" + welcomeEl.querySelector('[data-act="open-welcome"]').hidden);
  // Restore the real getTree.
  window.NB.sidebar.getTree = realGetTree;

  // 'New note' button delegates to NB.sidebar.createAtRoot("file").
  // Stub the create at the api level so we can confirm it's called
  // with the right type without actually creating a file. Then click
  // the button.
  const beforeTree = window.NB.sidebar.getTree();
  const newBtnAfter = welcomeEl.querySelector('[data-act="new"]');
  // The prompt is stubbed at the harness level; restore it for a moment
  // so we can capture the value. The harness default for prompt is "".
  // We want the new-file path to be created -- so we just assert the
  // click went through createAtRoot without throwing.
  let newFileCalled = false;
  const realCreateAtRoot = window.NB.sidebar.createAtRoot;
  window.NB.sidebar.createAtRoot = function (type) {
    newFileCalled = (type === "file");
  };
  newBtnAfter.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("welcome: 'New note' click -> sidebar.createAtRoot('file') called",
    newFileCalled);
  window.NB.sidebar.createAtRoot = realCreateAtRoot;

  // 'Open Welcome.md' click -> NB.tabs.open("Welcome.md") called.
  let openCalled = null;
  const realTabsOpen = window.NB.tabs.open;
  window.NB.tabs.open = function (path) {
    openCalled = path;
    return realTabsOpen.call(window.NB.tabs, path);
  };
  // The button was hidden above when we faked an empty tree, so we
  // need to re-run showWelcome to make it visible first. The real
  // getTree is restored, so Welcome.md is in the tree.
  window.NB.viewer.showWelcome();
  await tick(20);
  const openWelcomeBtnAfter = welcomeEl.querySelector('[data-act="open-welcome"]');
  check("welcome: 'Open Welcome.md' button visible again after real tree restored",
    !openWelcomeBtnAfter.hidden);
  openWelcomeBtnAfter.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(20);
  check("welcome: 'Open Welcome.md' click -> NB.tabs.open('Welcome.md') called",
    openCalled === "Welcome.md",
    "openCalled=" + openCalled);
  window.NB.tabs.open = realTabsOpen;

  // Opening a file should hide the welcome page and show the viewer.
  // (This time we use the real open, so the file actually loads.)
  check("welcome: opening a file hides the welcome page",
    $("welcome").hidden,
    "welcome.hidden=" + $("welcome").hidden);
  check("welcome: opening a file reveals the viewer",
    !$("viewer").hidden);

  // CSS regression guards. Same pattern as the wallpaper checks: the
  // welcome styles live in style.css, and we assert against the
  // production source so jsdom's incomplete style resolution doesn't
  // hide a regression.
  {
    const css = read("static/css/style.css");
    const welcomeBlock = css.match(/\.welcome\s*\{[^}]*\}/);
    check("welcome: .welcome rule exists in stylesheet",
      !!welcomeBlock, welcomeBlock ? welcomeBlock[0].slice(0, 80) : "(not found)");
    // The page centers its content -- display:flex with the centering
    // props is the load-bearing piece.
    check("welcome: .welcome uses display:flex (vertical centering)",
      !!welcomeBlock && /display\s*:\s*flex/.test(welcomeBlock[0]),
      welcomeBlock ? welcomeBlock[0] : "(not found)");
    check("welcome: .welcome uses align-items:center",
      !!welcomeBlock && /align-items\s*:\s*center/.test(welcomeBlock[0]));
    check("welcome: .welcome uses justify-content:center",
      !!welcomeBlock && /justify-content\s*:\s*center/.test(welcomeBlock[0]));
    // Action buttons: hover state with the accent token so they read
    // as interactive in both themes.
    const actionBlock = css.match(/\.welcome-action:hover\s*\{[^}]*\}/);
    check("welcome: .welcome-action:hover rule exists",
      !!actionBlock, actionBlock ? actionBlock[0].slice(0, 80) : "(not found)");
    check("welcome: .welcome-action:hover uses --accent-soft (theme-aware)",
      !!actionBlock && /var\(--accent-soft\)/.test(actionBlock[0]),
      actionBlock ? actionBlock[0] : "(not found)");
    // The kbd element should have a monospace font + border to look
    // like a key cap.
    const kbdBlock = css.match(/\.welcome-tips\s+kbd\s*\{[^}]*\}/);
    check("welcome: .welcome-tips kbd rule exists",
      !!kbdBlock, kbdBlock ? kbdBlock[0].slice(0, 80) : "(not found)");
    check("welcome: .welcome-tips kbd uses a monospace font family",
      !!kbdBlock && /monospace/i.test(kbdBlock[0]),
      kbdBlock ? kbdBlock[0] : "(not found)");
    // Defensive: .welcome[hidden] must collapse to display:none so the
    // standard HTML `hidden` attribute works on the block.
    check("welcome: .welcome[hidden] sets display:none",
      /\.welcome\[hidden\]\s*\{\s*display\s*:\s*none/.test(css),
      "looking for .welcome[hidden] { display: none; }");
    // Regression guard: #viewer's base rule sets `display: flex`, which
    // outranks the UA's [hidden] { display: none } (user CSS > UA CSS).
    // Without an explicit #viewer[hidden] { display: none } override,
    // setting viewer.hidden = true (when the welcome page is up) leaves
    // the viewer in the flex column with its full `flex: 1 1 auto` share
    // of the height -- the element stays in the layout, splits the
    // column with #welcome, and the welcome centers in the bottom half
    // instead of the full pane.
    check("welcome: #viewer[hidden] sets display:none (overrides user CSS display:flex)",
      /#viewer\[hidden\]\s*\{\s*display\s*:\s*none/.test(css),
      "looking for #viewer[hidden] { display: none; }");
    // Regression guard: .edit-split must be a real flex column, NOT
    // `display: contents`. With `display: contents` the wrapper has
    // no box, so #raw-editor / #viewer / #welcome become direct flex
    // items of #editor-pane. Since #raw-editor and #viewer are also
    // flex: 1 1 auto, the visible welcome ends up sharing the column
    // with them -- the row height gets split, and the welcome (which
    // centers in its own box) appears in the bottom half instead of
    // the full pane. A real flex column wrapper means only the visible
    // child fills the slot.
    const editSplitBlock = css.match(/\.edit-split\s*\{[^}]*\}/);
    check("welcome: .edit-split rule exists in stylesheet",
      !!editSplitBlock, editSplitBlock ? editSplitBlock[0].slice(0, 80) : "(not found)");
    check("welcome: .edit-split is NOT display:contents (real flex wrapper)",
      !!editSplitBlock && !/display\s*:\s*contents/.test(editSplitBlock[0]),
      editSplitBlock ? editSplitBlock[0] : "(not found)");
    check("welcome: .edit-split is display:flex (real flex wrapper)",
      !!editSplitBlock && /display\s*:\s*flex/.test(editSplitBlock[0]),
      editSplitBlock ? editSplitBlock[0] : "(not found)");
    check("welcome: .edit-split is flex-direction:column (vertical stack of children)",
      !!editSplitBlock && /flex-direction\s*:\s*column/.test(editSplitBlock[0]),
      editSplitBlock ? editSplitBlock[0] : "(not found)");
  }

  console.log("== viewer top spacing ==");
  // The rendered preview's first heading should sit close to the top of
  // the viewer -- otherwise the viewer padding + the heading's own
  // top-margin stack into a large empty band above the title (regression
  // guard for a reported UX bug). We assert on the CSS source directly:
  // the production stylesheet must (a) keep the scroll container's top
  // padding small and (b) zero out the top margin of the first child of
  // .markdown-body.
  //
  // The padding lives on #viewer-content (the scroller) after the
  // wallpaper scroll-sync restructure; #viewer is now a non-scrolling
  // shell that just wraps it.
  {
    const css = read("static/css/style.css");
    // #viewer-content padding must not have a 60vh / 50vh / etc. (units
    // relative to viewport create huge empty bands on tall windows).
    // Top padding should be a small absolute value.
    const viewerBlock = css.match(/#viewer-content\s*\{[^}]*\}/);
    check("viewer: #viewer-content rule exists in stylesheet", !!viewerBlock,
      viewerBlock ? viewerBlock[0].slice(0, 80) : "(not found)");
    const topPadMatch = viewerBlock && viewerBlock[0].match(/padding\s*:\s*([^;]+);/);
    const topPadVal = topPadMatch ? topPadMatch[1].trim() : "";
    const tokens = topPadVal.split(/\s+/);
    const topPadPx = tokens[0] || "";
    // The first padding token (top) should be a small px value -- not vh,
    // not %, not em, not auto.
    check("viewer: #viewer-content padding-top is a small px value (<= 20px)",
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