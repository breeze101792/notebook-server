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
      <select id="theme-select"><option value="auto">Auto</option><option value="dark">Dark</option><option value="light">Light</option></select>
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
  } else if (p === "/api/create" || p === "/api/move" || p === "/api/copy" || p === "/api/delete") {
    body = JSON.parse(opts.body || "{}");
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

function evalIn(src) { vm.runInContext(src, ctx); }

// ---- load vendor + app modules ----------------------------------------
const errors = [];
window.addEventListener("error", (e) => errors.push("window error: " + (e.error ? e.error.stack : e.message)));
evalIn(read("static/vendor/marked.min.js"));
evalIn(read("static/vendor/highlight.min.js"));
evalIn(read("static/js/api.js"));
evalIn(read("static/js/viewer.js"));
evalIn(read("static/js/outline.js"));
evalIn(read("static/js/sidebar.js"));
evalIn(read("static/js/search.js"));
evalIn(read("static/js/tabs.js"));
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
  check("default theme pref is auto", $("theme-select").value === "auto", "got " + $("theme-select").value);
  check("auto resolves to dark (system-dark stub)", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  $("theme-select").value = "light";
  $("theme-select").dispatchEvent(new window.Event("change", { bubbles: true }));
  check("explicit light sets data-theme=light", window.document.body.dataset.theme === "light",
    "data-theme=" + window.document.body.dataset.theme);
  $("theme-select").value = "dark";
  $("theme-select").dispatchEvent(new window.Event("change", { bubbles: true }));
  check("explicit dark sets data-theme=dark", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);
  $("theme-select").value = "auto";
  $("theme-select").dispatchEvent(new window.Event("change", { bubbles: true }));
  check("back to auto resolves dark", window.document.body.dataset.theme === "dark",
    "data-theme=" + window.document.body.dataset.theme);

  console.log("== viewer + outline ==");
  const heads = window.document.querySelectorAll("#viewer h1,h2,h3,h4,h5,h6");
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
  // Simulate dragging the sidebar handle: mousedown -> mousemove -> mouseup.
  const sidebarPane = $("sidebar");
  const realRect = sidebarPane.getBoundingClientRect.bind(sidebarPane);
  sidebarPane.getBoundingClientRect = () => ({ width: 240, height: 600, left: 0, right: 240, top: 0, bottom: 600, x: 0, y: 0, toJSON() {} });
  sbH.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
  window.document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 160 }));
  check("drag widens --sidebar-width (240->300)", cssVar("--sidebar-width") === "300px", cssVar("--sidebar-width"));
  window.document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
  check("drag ends (handle opacity reset)", sbH.style.opacity === "0", "opacity=" + sbH.style.opacity);
  sidebarPane.getBoundingClientRect = realRect;

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

  console.log("\nRESULT: " + (fail === 0 ? "PASS" : "FAIL") + "  (" + pass + " ok, " + fail + " failed)");
  process.exit(fail === 0 ? 0 : 1);
})();