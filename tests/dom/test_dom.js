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

const html = `<!DOCTYPE html><html><body data-theme="dark">
  <div id="app">
    <header id="topbar">
      <div class="brand">📓 Notebook</div>
      <input id="search-input" type="search">
      <input type="checkbox" id="search-case">
      <button id="edit-toggle">Edit</button>
      <button id="save">Save</button>
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
        <div id="viewer" class="markdown-body"></div>
        <textarea id="raw-editor" hidden></textarea>
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
evalIn(read("static/js/viewer.js"));
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
  // The theme control now lives in the settings modal. The default body
  // theme is "dark" (auto resolves dark on this jsdom's matchMedia stub).
  check("default body theme is dark (auto -> dark)", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  window.NB.settings.open();
  await tick(20);
  const checkedRadio = () => window.document.querySelector('input[name="theme"]:checked');
  check("default theme radio is auto", checkedRadio() && checkedRadio().value === "auto",
    checkedRadio() ? checkedRadio().value : "(none)");
  // light
  window.document.querySelector('input[name="theme"][value="light"]').checked = true;
  window.document.querySelector('input[name="theme"][value="light"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("light radio sets data-theme=light", window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  // dark
  window.document.querySelector('input[name="theme"][value="dark"]').checked = true;
  window.document.querySelector('input[name="theme"][value="dark"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("dark radio sets data-theme=dark", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  // back to auto
  window.document.querySelector('input[name="theme"][value="auto"]').checked = true;
  window.document.querySelector('input[name="theme"][value="auto"]')
    .dispatchEvent(new window.Event("change", { bubbles: true }));
  await tick(20);
  check("auto radio resolves dark (matchMedia stub)", window.document.body.dataset.theme === "dark",
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
  click("edit-toggle"); // exit edit (keeps unsaved content)
  await tick(10);
  check("still dirty after exiting edit", aTab.classList.contains("dirty"));
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
  click("edit-toggle");
  await tick(10);
  check("edit mode entered (textarea shown)", !$("raw-editor").hidden);
  check("edit button shows Preview", $("edit-toggle").textContent === "Preview");
  $("raw-editor").value = "# Edited\n\n## New heading\n\nsaved body";
  click("save");
  await tick(30);
  check("save exits edit mode", $("raw-editor").hidden);
  check("re-rendered new heading id", !!$("new-heading"));
  const savedFile = FILES["notes/a.md"];
  check("save wrote file content", savedFile && savedFile.includes("## New heading"));

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
  check("close last tab -> edit button resets", $("edit-toggle").textContent === "Edit");
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

  // save() clears the dirty dot.
  click("save");
  await tick(20);
  check("save clears dirty dot",
    !window.document.querySelector('.tab[data-path="notes/renamed.md"]').classList.contains("dirty"));

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
  window.NB.viewer.endEdit();
  await tick(20);
  click("save");
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
  // verify the status line and the toggle button, then enable and check
  // the status updates.
  window.NB.settings.open();
  await tick(20);
  check("watch: settings modal opens", window.NB.settings.isOpen());
  const statusEl = $("settings-watch-status");
  const watchBtn = $("settings-watch-toggle");
  check("watch: status element exists", !!statusEl);
  check("watch: status starts as 'Watching off'", /off/i.test(statusEl.textContent),
    statusEl.textContent);
  check("watch: button starts as 'Enable'", watchBtn.textContent === "Enable",
    watchBtn.textContent);
  // Enable: jsdom has no FileSystemObserver, so the polling fallback kicks in.
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("watch: enable -> status reports active",
    /watching|polling/i.test(statusEl.textContent),
    statusEl.textContent);
  check("watch: button flips to 'Disable'",
    watchBtn.textContent === "Disable", watchBtn.textContent);
  // Disable
  watchBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await tick(40);
  check("watch: disable -> status reports off",
    /off/i.test(statusEl.textContent), statusEl.textContent);
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

  console.log("\nRESULT: " + (fail === 0 ? "PASS" : "FAIL") + "  (" + pass + " ok, " + fail + " failed)");
  process.exit(fail === 0 ? 0 : 1);
})();