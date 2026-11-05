/* Real-browser functional audit of the notebook server's core desktop UI.
 *
 * Each section drives the REAL app through the same gestures a user makes
 * (right-click, dialogs, drag-and-drop, keyboard) and asserts both the DOM
 * and the files/config on disk. Nothing here mocks the backend.
 *
 * Run:  CHROMIUM_PATH=/path/to/chromium node tests/browser/test_core_ui_browser.js
 * Env:  PORT (default 5080), CHROMIUM_PATH override the browser binary.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const PORT = Number(process.env.PORT || 5080);
const BASE = "http://127.0.0.1:" + PORT;
const { findChromium } = require("./chromium");
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || findChromium();
const VIEW = { width: 1280, height: 800 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-core-ui-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const LONG_BODY = (() => {
  const lines = ["# Long", "", "Intro paragraph.", ""];
  for (let i = 1; i <= 12; i++) {
    lines.push("## Section " + i, "");
    for (let p = 0; p < 6; p++) {
      lines.push("Paragraph " + i + "." + p + " with enough text to force the " +
        "viewer to scroll when a later heading is requested. ".repeat(3));
      lines.push("");
    }
  }
  return lines.join("\n");
})();

const LONG_URL = "https://example.com/" + "a".repeat(280);
const LONG_WORD = "b".repeat(300);
const LONG_CODE = "c".repeat(300);
const LONG_CODE_LINE = "d".repeat(300);
const TABLE_HEAD = Array.from({ length: 20 }, (_, i) => "H" + i).join(" | ");
const TABLE_RULE = Array.from({ length: 20 }, () => "---").join(" | ");
const TABLE_ROW = Array.from({ length: 20 }, (_, i) => ("r" + i).repeat(20)).join(" | ");
const OVERFLOW_BODY = [
  "# Overflow",
  "",
  LONG_URL,
  "",
  "Inline `" + LONG_CODE + "` tail.",
  "",
  "## " + LONG_WORD,
  "",
  "| " + TABLE_HEAD + " |",
  "| " + TABLE_RULE + " |",
  "| " + TABLE_ROW + " |",
  "",
  "```text",
  LONG_CODE_LINE,
  "```",
  "",
].join("\n");

const TAB_FILES = Array.from({ length: 13 }, (_, i) =>
  "many/" + String(i + 1).padStart(2, "0") + ".md");

const NOTES = Object.assign({
  "Welcome.md": "# Welcome\n\nRoot note.\n",
  "Long.md": LONG_BODY,
  "Watcher.md": "# Watcher\n\nOriginal watcher body.\n",
  "Overflow.md": OVERFLOW_BODY,
  "notes/a.md": "# Note A\n\nAn alpha needle line in a subfolder.\n",
  "notes/b.md": "# Note B\n\nA beta needle line for search.\n",
}, Object.fromEntries(TAB_FILES.map((p, i) => [p, "# Tab " + (i + 1) + "\n\nBody.\n"])));

for (const [rel, body] of Object.entries(NOTES)) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred, timeout, interval) {
  const deadline = Date.now() + (timeout || 5000);
  while (Date.now() < deadline) {
    try { if (await pred()) return true; } catch (_) {}
    await sleep(interval || 80);
  }
  return false;
}

function exists(rel) { return fs.existsSync(path.join(DATA, rel)); }
function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(CONFIG, "config.json"), "utf8")); }
  catch (_) { return null; }
}
function waitDisk(rel, present, timeout) {
  return waitFor(() => exists(rel) === present, timeout || 5000);
}
function waitConfig(pred, timeout) {
  return waitFor(() => { const c = readConfig(); return !!c && pred(c); }, timeout || 5000);
}
// Content-bearing UI state (open tabs, pins, bookmarks) is scoped per
// workspace: config.json -> workspaceState["default"] for the fixture root.
function readWorkspaceState() {
  const c = readConfig();
  const all = c && c.workspaceState;
  return all && all.default ? all.default : null;
}
function waitWorkspaceState(pred, timeout) {
  return waitFor(() => {
    const s = readWorkspaceState();
    return !!s && pred(s);
  }, timeout || 5000);
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/auth");
      if (r.ok || r.status === 401) return;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("server did not start");
}

async function main() {
  const child = spawn(PY, ["app.py", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: PROJ,
    env: Object.assign({}, process.env, {
      NOTEBOOK_DATA_DIR: DATA,
      NOTEBOOK_CONFIG_DIR: CONFIG,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => { serverLog += d; });
  child.stderr.on("data", (d) => { serverLog += d; });

  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      executablePath: CHROMIUM_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    console.error("cannot launch chromium: " + String(err).split("\n")[0]);
    console.error("Set CHROMIUM_PATH to a working binary.");
    child.kill("SIGTERM");
    process.exit(2);
  }

  const ctx = await browser.newContext({
    viewport: VIEW,
    serviceWorkers: "block",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.stack) || e)));

  const dialogSeen = [];
  const dialogQueue = [];
  page.on("dialog", async (d) => {
    dialogSeen.push({ type: d.type(), message: d.message(), defaultValue: d.defaultValue() });
    const q = dialogQueue.shift();
    if (!q) { await d.dismiss(); return; }
    if (q.dismiss) await d.dismiss();
    else await d.accept(q.value);
  });
  const queuePrompt = (value) => dialogQueue.push({ value });
  const queueConfirm = () => dialogQueue.push({ value: undefined });

  const row = (p) => page.locator('#file-tree .tree-row[data-path="' + p + '"]');
  const menuBtn = (text) => page.locator("#nb-menu > button").filter({ hasText: text }).first();
  const tab = (p) => page.locator('.tab[data-path="' + p + '"]');

  try {
    await waitForServer();
    await page.goto(BASE + "/?file=Welcome.md");
    await page.waitForFunction(
      () => window.NB && NB.tabs && NB.sidebar && NB.viewer &&
        document.querySelectorAll("#file-tree .tree-row").length > 0,
      null, { timeout: 20000 });
    await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
    await page.bringToFront();

    // ---------------------------------------------------------------
    console.log("== desktop file tree ==");
    // Expand notes so its children are real, visible rows.
    await row("notes").click();
    await page.waitForFunction(() => {
      const r = document.querySelector('#file-tree .tree-row[data-path="notes/a.md"]');
      return r && r.getBoundingClientRect().height > 0;
    }, null, { timeout: 8000 });

    // Right-click a file: menu renders and stays inside the viewport.
    await row("notes/a.md").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden,
      null, { timeout: 5000 });
    const fileMenu = await page.evaluate(() => {
      const el = document.getElementById("nb-menu");
      const r = el.getBoundingClientRect();
      return {
        hidden: el.hidden, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
        vw: innerWidth, vh: innerHeight,
        items: Array.from(el.querySelectorAll(":scope > button"))
          .map((b) => b.textContent.replace(/\s+/g, " ").trim()),
      };
    });
    check("file menu renders with file actions",
      !fileMenu.hidden && fileMenu.items.some((t) => /New file/.test(t)) &&
      fileMenu.items.some((t) => /Rename \/ Move/.test(t)) &&
      fileMenu.items.some((t) => /^Copy/.test(t)) &&
      fileMenu.items.some((t) => /^Delete/.test(t)),
      fileMenu.items.join(" | "));
    check("file menu is inside the viewport",
      fileMenu.left >= 9 && fileMenu.top >= 9 &&
      fileMenu.right <= fileMenu.vw - 9 && fileMenu.bottom <= fileMenu.vh - 9,
      JSON.stringify(fileMenu));
    await page.keyboard.press("Escape");
    check("context menu closes on Escape",
      await page.evaluate(() => document.getElementById("nb-menu").hidden));

    // Right-click a folder: its menu renders and a create item works.
    await row("notes").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden,
      null, { timeout: 5000 });
    const folderMenu = await page.evaluate(() => {
      const el = document.getElementById("nb-menu");
      const r = el.getBoundingClientRect();
      return {
        items: Array.from(el.querySelectorAll(":scope > button"))
          .map((b) => b.textContent.replace(/\s+/g, " ").trim()),
        inside: r.left >= 9 && r.top >= 9 &&
          r.right <= innerWidth - 9 && r.bottom <= innerHeight - 9,
      };
    });
    check("folder menu renders with folder actions",
      folderMenu.items.some((t) => /New file/.test(t)) &&
      folderMenu.items.some((t) => /New folder/.test(t)) &&
      folderMenu.items.some((t) => /Pin folder/.test(t)),
      folderMenu.items.join(" | "));
    check("folder menu is inside the viewport", folderMenu.inside,
      JSON.stringify(folderMenu));

    // Create a file through the folder menu.
    queuePrompt("created");
    await menuBtn("New file").click();
    check("create file: disk gets notes/created.md",
      await waitDisk("notes/created.md", true));
    check("create file: tree row refreshes in",
      await waitFor(() => row("notes/created.md").count().then((n) => n === 1)));
    check("create file: prompt asked for a name",
      dialogSeen.some((d) => d.type === "prompt" && /New file name/.test(d.message)),
      JSON.stringify(dialogSeen));

    // Create a folder through the same menu.
    await row("notes").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden);
    queuePrompt("sub");
    await menuBtn("New folder").click();
    check("create folder: disk gets notes/sub/",
      await waitDisk("notes/sub", true));
    check("create folder: tree row refreshes in",
      await waitFor(() => row("notes/sub").count().then((n) => n === 1)));

    // Rename / move.
    await row("notes/created.md").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden);
    queuePrompt("notes/renamed.md");
    await menuBtn("Rename / Move").click();
    check("rename: old path is gone", await waitDisk("notes/created.md", false));
    check("rename: new path exists", await waitDisk("notes/renamed.md", true));
    check("rename: tree row follows the move",
      await waitFor(() => row("notes/renamed.md").count().then((n) => n === 1)) &&
      await row("notes/created.md").count().then((n) => n === 0));

    // Copy a non-empty note so the byte comparison is meaningful.
    await row("notes/a.md").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden);
    queuePrompt("notes/a-copy.md");
    await menuBtn("Copy").click();
    check("copy: destination exists", await waitDisk("notes/a-copy.md", true));
    check("copy: source still exists", await waitDisk("notes/a.md", true));
    check("copy: tree row refreshes in",
      await waitFor(() => row("notes/a-copy.md").count().then((n) => n === 1)));
    const sourceBytes = fs.readFileSync(path.join(DATA, "notes/a.md"), "utf8");
    const copied = fs.readFileSync(path.join(DATA, "notes/a-copy.md"), "utf8");
    check("copy: bytes match the source", copied === sourceBytes,
      "content=" + JSON.stringify(copied));

    // Delete.
    await row("notes/a-copy.md").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden);
    queueConfirm();
    await menuBtn("Delete").click();
    check("delete: file is removed from disk", await waitDisk("notes/a-copy.md", false));
    check("delete: tree row disappears",
      await waitFor(() => row("notes/a-copy.md").count().then((n) => n === 0)));
    check("delete: confirmation was shown",
      dialogSeen.some((d) => d.type === "confirm" && /cannot be undone/.test(d.message)),
      JSON.stringify(dialogSeen.slice(-2)));

    // ---------------------------------------------------------------
    console.log("== preview overflow ==");
    await page.setViewportSize({ width: 1440, height: 900 });
    await row("Overflow.md").click();
    await page.waitForFunction(() => NB.tabs.getActive() === "Overflow.md", null, { timeout: 8000 });
    await page.waitForSelector("#viewer-content h1", { timeout: 8000 });
    const overflow = await page.evaluate(() => {
      const viewer = document.getElementById("viewer-content");
      const code = viewer.querySelector("p code");
      const link = viewer.querySelector('a[href^="https://example.com/"]');
      const pre = viewer.querySelector("pre");
      // highlight.js makes the inner <code> the scroller; the <pre> is the
      // visible box either way.
      const codeScroller = pre && pre.scrollWidth > pre.clientWidth
        ? pre : (pre && pre.querySelector("code"));
      if (codeScroller) codeScroller.scrollLeft = codeScroller.scrollWidth - codeScroller.clientWidth;
      const table = viewer.querySelector("table");
      // Content box = border box minus padding. The clipped prose lives
      // here, so geometry against this edge is the real assertion; the
      // page and the viewer both clip, which hides the failure.
      const style = getComputedStyle(viewer);
      const box = viewer.getBoundingClientRect();
      const contentLeft = box.left + (parseFloat(style.paddingLeft) || 0);
      const contentRight = box.right - (parseFloat(style.paddingRight) || 0);
      const linkBox = link ? link.getBoundingClientRect() : null;
      const para = link ? link.closest("p") : null;
      const paraBox = para ? para.getBoundingClientRect() : null;
      return {
        viewerOverflow: viewer.scrollWidth - viewer.clientWidth,
        contentLeft: contentLeft,
        contentRight: contentRight,
        linkText: link ? link.textContent : "",
        linkLeft: linkBox ? linkBox.left : 0,
        linkRight: linkBox ? linkBox.right : 0,
        linkLines: link ? link.getClientRects().length : 0,
        paragraphRight: paraBox ? paraBox.right : 0,
        codeRight: code ? code.getBoundingClientRect().right : 0,
        preRight: pre ? pre.getBoundingClientRect().right : 0,
        viewerRight: box.right,
        preOwnScroller: !!codeScroller && codeScroller.scrollWidth > codeScroller.clientWidth,
        preScrolled: !!codeScroller && codeScroller.scrollLeft > 0,
        tableOwnScroller: !!table && table.scrollWidth > table.clientWidth,
      };
    });
    check("preview overflow: #viewer-content's content fits its box",
      overflow.viewerOverflow <= 1, "overflow=" + overflow.viewerOverflow);
    check("preview overflow: the long bare URL stays inside the viewer content box",
      overflow.linkRight <= overflow.contentRight + 1 &&
      overflow.linkLeft >= overflow.contentLeft - 1,
      JSON.stringify({ left: overflow.linkLeft, right: overflow.linkRight,
        box: [overflow.contentLeft, overflow.contentRight] }));
    check("preview overflow: the bare URL is complete and wraps onto more than one line",
      overflow.linkText === LONG_URL && overflow.linkLines > 1,
      JSON.stringify({ len: overflow.linkText.length, lines: overflow.linkLines }));
    check("preview overflow: the paragraph containing the bare URL stays inside the content box",
      overflow.paragraphRight <= overflow.contentRight + 1,
      JSON.stringify({ para: overflow.paragraphRight, box: overflow.contentRight }));
    // Inline code padding legitimately paints into the viewer's padding
    // gutter, so this compares against the border box (the clip edge).
    check("preview overflow: long inline code stays inside the viewer",
      overflow.codeRight <= overflow.viewerRight + 1,
      JSON.stringify({ code: overflow.codeRight, viewer: overflow.viewerRight }));
    // Code blocks wrap (style.css: "Code blocks wrap long lines; the note
    // page owns the only scrollbar"), so the fence must not grow its own
    // horizontal scroller and must stay inside the viewer's clip edge.
    check("preview overflow: a fenced block wraps inside the viewer (no inner scroller)",
      !overflow.preOwnScroller && !overflow.preScrolled &&
      overflow.preRight <= overflow.viewerRight + 1,
      JSON.stringify(overflow));
    check("preview overflow: a wide table keeps its own horizontal scroller",
      overflow.tableOwnScroller, JSON.stringify(overflow));
    await page.setViewportSize(VIEW);

    // ---------------------------------------------------------------
    console.log("== tabs ==");
    // Clear whatever the file operations left open, through the close buttons.
    for (let i = 0; i < 12; i++) {
      const closers = page.locator("#tab-list .tab:not(.ghost) .tab-close");
      if (await closers.count() === 0) break;
      await closers.first().click();
      await sleep(60);
    }
    await page.waitForFunction(() => NB.tabs.getOpen().length === 0, null, { timeout: 5000 });

    for (const p of ["notes/a.md", "notes/b.md", "Welcome.md"]) {
      await row(p).click();
      await page.waitForFunction((f) => NB.tabs.getActive() === f, p, { timeout: 8000 });
    }
    let order = await page.evaluate(() => NB.tabs.getOpen());
    check("tabs: three files open from the tree",
      order.length === 3 && order.includes("notes/a.md") &&
      order.includes("notes/b.md") && order.includes("Welcome.md"), order.join(","));
    check("tabs: both/all tab labels render",
      await page.locator("#tab-list .tab:not(.ghost) .tab-label").count() === 3);

    await tab("notes/a.md").click();
    await page.waitForFunction(() => NB.tabs.getActive() === "notes/a.md");
    check("tabs: clicking a tab switches the active file",
      (await page.locator("#viewer-content h1").textContent()).trim() === "Note A",
      await page.locator("#viewer-content h1").textContent());

    // A dirty source edit keeps its buffer across a tab switch; the
    // return shows a Recover bar and applying it is undoable in CM.
    {
      const beforeDialogs = dialogSeen.length;
      await page.click("#edit-toggle");
      await page.waitForFunction(
        () => !document.getElementById("cm-host").hidden, null, { timeout: 8000 });
      await page.evaluate(() => {
        NB.cmEditor.setValue(NB.cmEditor.getValue() + "\nDRAFT_TOKEN\n");
      });
      check("tabs: dirty precondition for the switch",
        await page.evaluate(() => NB.viewer.isDirty("notes/a.md")));
      await tab("Welcome.md").click();
      await page.waitForFunction(() => NB.tabs.getActive() === "Welcome.md", null, { timeout: 8000 });
      check("tabs: a dirty switch leaves without a prompt",
        dialogSeen.length === beforeDialogs,
        JSON.stringify(dialogSeen.slice(beforeDialogs)));
      check("tabs: the unsaved buffer is kept as a draft",
        await page.evaluate(() => !!NB.viewer.getDraft("notes/a.md")));
      await tab("notes/a.md").click();
      await page.waitForFunction(() => NB.tabs.getActive() === "notes/a.md", null, { timeout: 8000 });
      check("tabs: the Recover bar appears on return",
        await page.locator("#draft-bar").isVisible());
      await page.click("#draft-recover");
      await page.waitForFunction(
        () => !document.getElementById("cm-host").hidden, null, { timeout: 8000 });
      check("tabs: Recover restores the draft in source mode",
        await page.evaluate(() =>
          NB.cmEditor.getValue().includes("DRAFT_TOKEN") &&
          NB.viewer.isDirty("notes/a.md")));
      await page.evaluate(() => NB.cmEditor.setSelection(0, 0));
      await page.keyboard.press("Control+z");
      await sleep(120);
      check("tabs: Ctrl+Z after Recover returns to the saved text",
        await page.evaluate(() =>
          !NB.cmEditor.getValue().includes("DRAFT_TOKEN") &&
          NB.viewer.isDirty("notes/a.md")));
      await page.keyboard.press("Control+Shift+z");
      await sleep(120);
      check("tabs: Ctrl+Shift+Z puts the recovered draft back",
        await page.evaluate(() =>
          NB.cmEditor.getValue().includes("DRAFT_TOKEN")));
      await page.evaluate(() => NB.viewer.forceCloseEdit());
      await page.waitForFunction(
        () => document.getElementById("cm-host").hidden, null, { timeout: 8000 });
    }

    // Close a non-active tab and check config persistence.
    await tab("notes/b.md").locator(".tab-close").click();
    check("tabs: close button removes the tab",
      await waitFor(() => page.evaluate(() =>
        !NB.tabs.isOpen("notes/b.md") &&
        !document.querySelector('.tab[data-path="notes/b.md"]'))));
    check("tabs: closed file drops out of config.openFiles",
      await waitWorkspaceState((s) => Array.isArray(s.openFiles) &&
        !s.openFiles.includes("notes/b.md")));

    // Drag-reorder: move Welcome (currently last) before Note A.
    const beforeDrag = await page.evaluate(() => NB.tabs.getOpen());
    await tab("Welcome.md").dragTo(tab("notes/a.md"), {
      targetPosition: { x: 4, y: 10 },
    });
    const afterDrag = await page.evaluate(() => NB.tabs.getOpen());
    check("tabs: drag-reorder moves Welcome to the front",
      afterDrag[0] === "Welcome.md" && afterDrag[1] === "notes/a.md",
      beforeDrag.join(",") + " -> " + afterDrag.join(","));

    // Pin through the real context menu.
    await tab("Welcome.md").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden);
    await menuBtn("Pin").click();
    check("tabs: pinned tab moves to the pinned region",
      await page.locator('#tab-pinned .tab.pinned[data-path="Welcome.md"]').count() === 1);
    check("tabs: pinned tab has no close button",
      await page.locator('#tab-pinned .tab[data-path="Welcome.md"] .tab-close').count() === 0);
    check("tabs: pin persists in config.pinnedFiles",
      await waitWorkspaceState((s) => Array.isArray(s.pinnedFiles) &&
        s.pinnedFiles.includes("Welcome.md")));

    await tab("notes/a.md").click();
    await page.waitForFunction(() => NB.tabs.getActive() === "notes/a.md");
    check("tabs: active file persists in config.activeFile",
      await waitWorkspaceState((s) => s.activeFile === "notes/a.md"));

    // ---------------------------------------------------------------
    console.log("== tab strip scroll ==");
    const tabVisible = (path) => page.evaluate((p) => {
      const strip = document.getElementById("tab-list");
      const el = strip.querySelector('.tab[data-path="' + p + '"]');
      if (!el) return false;
      const b = strip.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      return t.left >= b.left - 1 && t.right <= b.right + 1;
    }, path);
    await page.evaluate(() => NB.tabs.clearAll());
    await page.waitForFunction(() => NB.tabs.getOpen().length === 0, null, { timeout: 5000 });
    await page.evaluate(async (paths) => {
      for (const p of paths) await NB.tabs.open(p);
    }, TAB_FILES);
    await page.waitForFunction((n) => NB.tabs.getOpen().length === n, TAB_FILES.length,
      { timeout: 15000 });
    check("tab strip: thirteen tabs leave the active tab fully visible",
      await waitFor(() => tabVisible(TAB_FILES[TAB_FILES.length - 1]), 4000),
      await page.evaluate(() => {
        const s = document.getElementById("tab-list");
        return "scroll=" + s.scrollLeft + " max=" + (s.scrollWidth - s.clientWidth);
      }));

    await page.evaluate(async (p) => NB.tabs.activate(p), TAB_FILES[0]);
    await page.evaluate(() => document.getElementById("tab-list").scrollTo({ left: 0, behavior: "instant" }));
    await page.evaluate(async (p) => NB.tabs.activate(p), TAB_FILES[TAB_FILES.length - 1]);
    check("tab strip: activating a far tab reveals it",
      await waitFor(() => tabVisible(TAB_FILES[TAB_FILES.length - 1]), 4000));

    // Re-activating the tab that is already active must still reveal it:
    // a sidebar click on the active note lands on this path, and the tab may
    // have been scrolled out of view since it was activated.
    const activeTab = TAB_FILES[TAB_FILES.length - 1];
    await page.evaluate(() =>
      document.getElementById("tab-list").scrollTo({ left: 0, behavior: "instant" }));
    await page.evaluate(async (p) => NB.tabs.activate(p), activeTab);
    check("tab strip: re-activating the active tab reveals it again",
      await waitFor(() => tabVisible(activeTab), 4000),
      await page.evaluate(() => "scrollLeft=" + document.getElementById("tab-list").scrollLeft));

    await page.evaluate(async (p) => NB.tabs.activate(p), TAB_FILES[0]);
    check("tab strip: activating a tab to the left reveals it",
      await waitFor(() => tabVisible(TAB_FILES[0]), 4000));

    // Chromium keeps the pixel offset across an innerHTML rebuild when no
    // layout flush happens between the clear and the re-append, so the final
    // value alone cannot prove render() restores it. Record the helper's own
    // reads and writes instead: it must read the current offset before
    // clearing and write it back after the rebuild.
    const scrollContract = await page.evaluate(() => {
      const list = document.getElementById("tab-list");
      list.scrollTo({ left: 300, behavior: "instant" });
      const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
      const log = [];
      Object.defineProperty(list, "scrollLeft", {
        configurable: true,
        get() {
          const value = proto.get.call(this);
          log.push({ op: "get", value });
          return value;
        },
        set(value) {
          log.push({ op: "set", value, tabs: this.children.length });
          proto.set.call(this, value);
        },
      });
      window.NB.tabs.render();
      delete list.scrollLeft;
      return { log, final: list.scrollLeft };
    });
    const savedAt = scrollContract.log.findIndex((e) => e.op === "get" && e.value === 300);
    const restoredAt = scrollContract.log.findIndex((e) => e.op === "set" &&
      e.value === 300 && e.tabs > 0);
    check("tab strip: a plain re-render saves the manual scroll before clearing",
      savedAt !== -1, JSON.stringify(scrollContract.log.slice(0, 4)));
    check("tab strip: a plain re-render restores the manual scroll after rebuilding",
      savedAt !== -1 && restoredAt > savedAt,
      JSON.stringify(scrollContract.log.slice(Math.max(savedAt, 0), Math.max(savedAt, 0) + 3)));
    check("tab strip: the restored scroll position survives the render",
      Math.abs(scrollContract.final - 300) <= 1, "scrollLeft=" + scrollContract.final);

    await page.evaluate(() => document.getElementById("tab-list").scrollTo({ left: 200, behavior: "instant" }));
    await page.evaluate(() => NB.tabs.open("Overflow.md", { activate: false }));
    await page.waitForFunction(() => NB.tabs.isOpen("Overflow.md"), null, { timeout: 5000 });
    check("tab strip: a background tab does not move the strip",
      await page.evaluate(() => Math.abs(document.getElementById("tab-list").scrollLeft - 200) <= 1),
      await page.evaluate(() => "scrollLeft=" + document.getElementById("tab-list").scrollLeft));

    const closedTab = TAB_FILES[TAB_FILES.length - 1];
    await page.evaluate(async (p) => NB.tabs.activate(p), closedTab);
    await waitFor(() => tabVisible(closedTab), 4000);
    await page.evaluate((p) => NB.tabs.close(p), closedTab);
    await page.waitForFunction((p) => {
      const active = NB.tabs.getActive();
      return active && active !== p;
    }, closedTab, { timeout: 5000 });
    const nextActive = await page.evaluate(() => NB.tabs.getActive());
    check("tab strip: closing the active tab reveals the newly active tab",
      await waitFor(() => tabVisible(nextActive), 4000), nextActive);

    // ---------------------------------------------------------------
    console.log("== search ==");
    await page.evaluate(() => NB.activity.openSearch());

    await page.click(".search-panel-advanced-toggle");
    const caseLayout = await page.evaluate(() => {
      const cb = document.querySelector(".search-panel-case input");
      const row = cb.closest(".search-panel-filter--case");
      const label = row.querySelector(".search-panel-filter-label");
      const box = row.querySelector(".search-panel-case");
      return {
        inAdvanced: !!cb.closest("#search-panel-advanced"),
        label: label ? label.textContent.trim() : "",
        w: getComputedStyle(box).width,
        h: getComputedStyle(box).height,
      };
    });
    check("search case: Aa sits in Advanced under a Match case label",
      caseLayout.inAdvanced && caseLayout.label === "Match case",
      JSON.stringify(caseLayout));
    check("search case: desktop Aa is 28x32",
      caseLayout.w === "28px" && caseLayout.h === "32px",
      JSON.stringify(caseLayout));
    await page.evaluate(() => {
      const cb = document.querySelector(".search-panel-case input");
      cb.checked = true;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.click(".search-panel-advanced-toggle");
    check("search case: the collapsed summary names Match case",
      /Match case/.test(await page.locator(".search-panel-advanced-summary").textContent()),
      await page.locator(".search-panel-advanced-summary").textContent());
    await page.click(".search-panel-advanced-toggle");
    await page.evaluate(() => {
      const cb = document.querySelector(".search-panel-case input");
      cb.checked = false;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.click(".search-panel-advanced-toggle");

    await page.fill(".search-panel-input", "needle");
    await page.press(".search-panel-input", "Enter");
    await page.waitForFunction(() =>
      document.querySelectorAll(".search-panel-hit").length >= 2,
      null, { timeout: 10000 });
    const hits = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".search-panel-hit")).map((h) => ({
        file: h.querySelector(".search-panel-path").title,
        snippet: h.querySelector(".search-panel-hit-snippet").textContent,
      })));
    check("search: finds matches in a subfolder",
      hits.some((h) => h.file === "notes/a.md") &&
      hits.some((h) => h.file === "notes/b.md"),
      JSON.stringify(hits));
    check("search: snippet wraps the hit in <mark>",
      await page.locator(".search-panel-hit .search-panel-hit-snippet mark").count() >= 2 &&
      (await page.locator(".search-panel-hit .search-panel-hit-snippet mark").first().textContent())
        .toLowerCase().includes("needle"));
    check("search: summary reports the hit count",
      /match/.test(await page.locator(".search-panel-summary").textContent()),
      await page.locator(".search-panel-summary").textContent());

    const clearBox = await page.evaluate(() => {
      const btn = document.querySelector(".search-panel-clear");
      const input = document.querySelector(".search-panel-input");
      const cs = getComputedStyle(btn);
      return {
        hidden: btn.hidden,
        w: cs.width,
        h: cs.height,
        padRight: getComputedStyle(input).paddingRight,
        inputWidth: input.getBoundingClientRect().width,
      };
    });
    check("search clear: visible and 22x22 on desktop",
      clearBox.hidden === false && clearBox.w === "22px" && clearBox.h === "22px",
      JSON.stringify(clearBox));
    check("search clear: input reserves a 32px right slot",
      clearBox.padRight === "32px", clearBox.padRight);
    await page.click(".search-panel-clear");
    await page.waitForFunction(() =>
      document.querySelector(".search-panel-input").value === "");
    const cleared = await page.evaluate(() => ({
      hits: document.querySelectorAll(".search-panel-hit").length,
      summary: document.querySelector(".search-panel-summary").textContent,
      focused: document.activeElement === document.querySelector(".search-panel-input"),
      hidden: document.querySelector(".search-panel-clear").hidden,
      inputWidth: document.querySelector(".search-panel-input").getBoundingClientRect().width,
    }));
    check("search clear: click clears the query and results",
      cleared.hits === 0 && cleared.summary === "" && cleared.hidden === true,
      JSON.stringify(cleared));
    check("search clear: focus stays in the input", cleared.focused === true);
    check("search clear: input width does not shift",
      cleared.inputWidth === clearBox.inputWidth,
      clearBox.inputWidth + " -> " + cleared.inputWidth);

    await page.fill(".search-panel-input", "needle");
    await page.press(".search-panel-input", "Enter");
    await page.waitForFunction(() =>
      document.querySelectorAll(".search-panel-hit").length >= 2,
      null, { timeout: 10000 });

    check("search: Enter moves focus to the result list",
      await waitFor(() => page.evaluate(() => document.activeElement &&
        document.activeElement.classList.contains("search-panel-hit")), 3000));
    const firstActive = await page.evaluate(() => {
      const hits = Array.from(document.querySelectorAll(".search-panel-hit"));
      return hits.findIndex((h) => h.classList.contains("is-active"));
    });
    await page.keyboard.press("ArrowDown");
    const secondActive = await page.evaluate(() => {
      const hits = Array.from(document.querySelectorAll(".search-panel-hit"));
      return hits.findIndex((h) => h.classList.contains("is-active"));
    });
    check("search: ArrowDown moves the active result", secondActive === firstActive + 1,
      firstActive + " -> " + secondActive);
    check("search: ArrowUp moves it back",
      await page.keyboard.press("ArrowUp").then(() => page.evaluate(() => {
        const hits = Array.from(document.querySelectorAll(".search-panel-hit"));
        return hits.findIndex((h) => h.classList.contains("is-active"));
      })).then((i) => i === firstActive));
    await page.keyboard.press("ArrowDown");
    const targetFile = await page.evaluate(() => {
      const h = document.querySelector(".search-panel-hit.is-active .search-panel-path");
      return h ? h.title : null;
    });
    await page.keyboard.press("Enter");
    check("search: Enter opens the active result",
      await waitFor(() => page.evaluate((f) => NB.tabs.getActive() === f, targetFile), 6000),
      targetFile);
    await page.evaluate(() => NB.activity.activate("explorer", false));

    // ---------------------------------------------------------------
    console.log("== bookmarks ==");
    await row("notes/renamed.md").hover();
    await row("notes/renamed.md").locator(".tree-star").click();
    check("bookmarks: tree star marks the file",
      await waitFor(() => page.evaluate(() =>
        NB.bookmarks.has("notes/renamed.md") &&
        document.querySelector('.tree-row[data-path="notes/renamed.md"] .tree-star')
          .classList.contains("is-bookmarked"))));
    check("bookmarks: first bookmark persists in config",
      await waitWorkspaceState((s) => Array.isArray(s.bookmarks) &&
        s.bookmarks.includes("notes/renamed.md")));

    await row("notes/b.md").hover();
    await row("notes/b.md").locator(".tree-star").click();
    check("bookmarks: second star adds the second file",
      await waitFor(() => page.evaluate(() =>
        NB.bookmarks.get().length === 2 && NB.bookmarks.has("notes/b.md"))));

    await page.click('#activity-bar .activity-btn[data-view="bookmarks"]');
    await page.waitForFunction(() =>
      !document.getElementById("bookmarks-view").hidden &&
      document.querySelectorAll("#bookmarks-list .bookmark-row").length === 2,
      null, { timeout: 5000 });
    check("bookmarks: panel lists both bookmarks",
      await page.locator("#bookmarks-list .bookmark-row").count() === 2);

    const bmRows = page.locator("#bookmarks-list .bookmark-row");
    await bmRows.nth(1).dragTo(bmRows.nth(0), { targetPosition: { x: 20, y: 2 } });
    check("bookmarks: drag-reorder moves the second row first",
      await waitFor(() => page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#bookmarks-list .bookmark-row"));
        return rows.length === 2 && rows[0].dataset.path === "notes/b.md" &&
          rows[1].dataset.path === "notes/renamed.md";
      })));
    check("bookmarks: reordered list persists",
      await waitWorkspaceState((s) => Array.isArray(s.bookmarks) &&
        s.bookmarks[0] === "notes/b.md" && s.bookmarks[1] === "notes/renamed.md"));

    await page.locator('#bookmarks-list .bookmark-row[data-path="notes/b.md"]')
      .click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden);
    await menuBtn("Remove bookmark").click();
    check("bookmarks: context-menu remove drops the row",
      await waitFor(() => page.evaluate(() =>
        NB.bookmarks.get().length === 1 && !NB.bookmarks.has("notes/b.md"))));
    check("bookmarks: removal persists in config",
      await waitWorkspaceState((s) => Array.isArray(s.bookmarks) &&
        s.bookmarks.length === 1 && !s.bookmarks.includes("notes/b.md")));

    // ---------------------------------------------------------------
    console.log("== outline ==");
    await page.click('#activity-bar .activity-btn[data-view="explorer"]');
    await page.waitForFunction(() => !document.getElementById("sidebar").hidden);
    await row("Long.md").click();
    await page.waitForFunction(() => NB.tabs.getActive() === "Long.md", null, { timeout: 8000 });
    await page.waitForSelector("#outline .outline-item", { timeout: 8000 });
    const outlineCount = await page.locator("#outline .outline-item").count();
    check("outline: every heading is listed", outlineCount >= 13,
      "items=" + outlineCount);
    check("outline: first item is the document title",
      (await page.locator("#outline .outline-item a").first().textContent()).trim() === "Long");

    // A middle heading has enough content below it to actually reach
    // the top of the scroller, so the scroll-spy expectation is exact.
    const targetOutline = page.locator("#outline .outline-item").nth(6);
    const targetId = await targetOutline.getAttribute("data-id");
    await targetOutline.locator("a").click();
    check("outline: clicking a heading scrolls the viewer",
      await waitFor(() => page.evaluate(() =>
        document.getElementById("viewer-scroll").scrollTop > 100), 5000));
    const clickActive = await waitFor(() => page.evaluate((id) => {
      const a = document.querySelector("#outline .outline-item.active");
      return !!a && a.dataset.id === id;
    }, targetId), 5000);
    // Measure only after the smooth scroll has had time to settle.
    await sleep(1000);
    const clickGeom = await page.evaluate((id) => {
      const h = document.getElementById(id);
      const v = document.getElementById("viewer-scroll");
      const a = document.querySelector("#outline .outline-item.active");
      return {
        active: a ? a.dataset.id : "(none)",
        headingTop: h ? Math.round(h.getBoundingClientRect().top) : null,
        scrollerTop: Math.round(v.getBoundingClientRect().top),
        scrollTop: Math.round(v.scrollTop),
      };
    }, targetId);
    check("outline: scroll-spy activates the clicked heading", clickActive,
      "expected " + targetId + " got " + JSON.stringify(clickGeom));

    // Force the scroller back to the top.
    await page.evaluate(() => {
      const v = document.getElementById("viewer-scroll");
      v.scrollTo({ top: 0, behavior: "auto" });
      v.dispatchEvent(new Event("scroll"));
    });
    const topActive = await waitFor(() => page.evaluate(() => {
      const a = document.querySelector("#outline .outline-item.active");
      return !!a && a.dataset.id === "long";
    }, null), 4000);
    const topGeom = await page.evaluate(() => {
      const h = document.querySelector("#viewer-content h1");
      const v = document.getElementById("viewer-scroll");
      const a = document.querySelector("#outline .outline-item.active");
      return {
        active: a ? a.dataset.id : "(none)",
        headingTop: h ? Math.round(h.getBoundingClientRect().top) : null,
        scrollerTop: Math.round(v.getBoundingClientRect().top),
        scrollTop: Math.round(v.scrollTop),
      };
    });
    check("outline: scroll-spy follows a scroll back to the top", topActive,
      "got " + JSON.stringify(topGeom));

    // ---------------------------------------------------------------
    console.log("== graph ==");
    await page.click("#activity-graph-btn");
    await page.waitForFunction(() =>
      !document.getElementById("graph-view").hidden &&
      window.NB.graph && NB.graph.nodes.length > 0 &&
      document.getElementById("graph-view-state").hidden,
      null, { timeout: 10000 });
    // Let the initial physics warm-up settle before measuring geometry.
    await sleep(1200);

    // Blocker regression: the screen-reader layers are visually hidden and
    // must not consume layout space, and the canvas host must still own the
    // full height after notes populate.
    const srLayout = await page.evaluate(() => {
      const live = document.getElementById("graph-view-sr-live");
      const list = document.getElementById("graph-view-sr-list");
      const host = document.getElementById("graph-view-canvas-host");
      const lr = live.getBoundingClientRect();
      const ur = list.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      const liveCs = getComputedStyle(live);
      const listCs = getComputedStyle(list);
      return {
        liveW: lr.width, liveH: lr.height,
        listW: ur.width, listH: ur.height,
        hostH: hr.height,
        livePos: liveCs.position, listPos: listCs.position,
        liveClip: liveCs.clip, listClipPath: listCs.clipPath,
      };
    });
    check("graph: sr-only live region takes no layout space",
      srLayout.liveW <= 1 && srLayout.liveH <= 1 &&
      srLayout.livePos === "absolute" &&
      (srLayout.liveClip !== "auto" || srLayout.listClipPath !== "none"),
      JSON.stringify(srLayout));
    check("graph: sr-only note list takes no layout space",
      srLayout.listW <= 1 && srLayout.listH <= 1 &&
      srLayout.listPos === "absolute",
      JSON.stringify(srLayout));
    check("graph: canvas host keeps a non-zero height with notes populated",
      srLayout.hostH > 50, JSON.stringify(srLayout));

    check("graph: summary reports nodes and links",
      /\d+ notes? · \d+ links?/.test(await page.locator("#graph-view-summary").textContent()),
      await page.locator("#graph-view-summary").textContent());
    const canvasData = await page.evaluate(() => {
      const c = document.getElementById("graph-view-canvas");
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let opaque = 0;
      const colors = new Set();
      for (let i = 0; i < d.length; i += 4 * 53) {
        if (d[i + 3] > 8) opaque++;
        colors.add(d[i] + "," + d[i + 1] + "," + d[i + 2] + "," + d[i + 3]);
      }
      return { w: c.width, h: c.height, opaque, colors: colors.size };
    });
    check("graph: canvas has a real backing size",
      canvasData.w > 200 && canvasData.h > 200, JSON.stringify(canvasData));
    check("graph: canvas is non-blank and non-uniform",
      canvasData.opaque > 100 && canvasData.colors > 4, JSON.stringify(canvasData));

    const camInit = await page.evaluate(() => NB.graph.getCamera());
    check("graph: camera exposes yaw/pitch/dist/target/fov",
      typeof camInit.yaw === "number" && typeof camInit.pitch === "number" &&
      typeof camInit.dist === "number" && !!camInit.target &&
      Math.abs(camInit.fov - 50 * Math.PI / 180) < 1e-9,
      JSON.stringify(camInit));

    const canvasBox = await page.locator("#graph-view-canvas").boundingBox();

    // Orbit: drag empty space near the bottom-left corner.
    const orbitX = canvasBox.x + 14;
    const orbitY = canvasBox.y + canvasBox.height - 14;
    const yawBefore = await page.evaluate(() => NB.graph.getCamera().yaw);
    await page.mouse.move(orbitX, orbitY);
    await page.mouse.down();
    await page.mouse.move(orbitX + 90, orbitY - 55, { steps: 8 });
    await page.mouse.up();
    await sleep(120);
    const yawAfter = await page.evaluate(() => NB.graph.getCamera().yaw);
    check("graph: left-drag orbits the camera (yaw changes)",
      Math.abs(yawAfter - yawBefore) > 0.02,
      "before=" + yawBefore.toFixed(3) + " after=" + yawAfter.toFixed(3));

    // Wheel: dolly distance changes in the right direction.
    const distBefore = await page.evaluate(() => NB.graph.getCamera().dist);
    await page.mouse.move(canvasBox.x + canvasBox.width / 2,
      canvasBox.y + canvasBox.height / 2);
    await page.mouse.wheel(0, -400);
    await sleep(150);
    const distAfter = await page.evaluate(() => NB.graph.getCamera().dist);
    check("graph: wheel changes the dolly distance",
      distAfter < distBefore,
      "before=" + distBefore.toFixed(1) + " after=" + distAfter.toFixed(1));

    // Right-drag pans the camera target.
    const targetBefore = await page.evaluate(() => NB.graph.getCamera().target);
    await page.mouse.move(canvasBox.x + canvasBox.width / 2,
      canvasBox.y + canvasBox.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 70,
      canvasBox.y + canvasBox.height / 2 + 40, { steps: 6 });
    await page.mouse.up({ button: "right" });
    await sleep(120);
    const targetAfter = await page.evaluate(() => NB.graph.getCamera().target);
    check("graph: right-drag pans the camera target",
      targetAfter.x !== targetBefore.x || targetAfter.y !== targetBefore.y ||
      targetAfter.z !== targetBefore.z,
      "before=" + JSON.stringify(targetBefore) +
      " after=" + JSON.stringify(targetAfter));

    // Fit resets yaw/pitch to the defaults.
    await page.click("#graph-view-fit");
    await sleep(700);
    const fitCam = await page.evaluate(() => NB.graph.getCamera());
    check("graph: fit resets yaw and pitch",
      Math.abs(fitCam.yaw - (-0.52)) < 0.03 &&
      Math.abs(fitCam.pitch - 0.30) < 0.03,
      JSON.stringify(fitCam));

    // Keyboard select, chip, Enter-opens.
    await page.locator("#graph-view-canvas-host").focus();
    await page.keyboard.press("]");
    await sleep(200);
    const sel = await page.evaluate(() => ({
      id: NB.graph.selectedId,
      chipHidden: document.getElementById("graph-view-chip").hidden,
      name: document.getElementById("graph-view-chip-name").textContent,
      meta: document.getElementById("graph-view-chip-meta").textContent,
      live: document.getElementById("graph-view-sr-live").textContent,
    }));
    check("graph: ] selects a note and shows the chip",
      !!sel.id && sel.chipHidden === false && !!sel.name && /link/.test(sel.meta),
      JSON.stringify(sel));
    check("graph: selection is announced to screen readers",
      sel.live.indexOf("Selected ") === 0, sel.live);
    await page.keyboard.press("Enter");
    check("graph: Enter opens the selected note",
      await waitFor(() => page.evaluate((id) => NB.tabs.getActive() === id, sel.id), 8000),
      sel.id);
    await page.click('#tab-bar .tab[data-path="§graph"]');
    await page.waitForFunction(() => NB.tabs.getActive() === "§graph", null, { timeout: 5000 });
    await sleep(300);

    // Regression: "/" on the graph host focuses the filter and must not
    // open the Search side panel (the document shortcut listener yields).
    const activityBeforeSlash = await page.evaluate(() => NB.activity.getActive());
    await page.locator("#graph-view-canvas-host").focus();
    await page.keyboard.press("/");
    await sleep(150);
    const slashState = await page.evaluate(() => ({
      activeElement: document.activeElement && document.activeElement.id,
      activity: NB.activity.getActive(),
      searchHidden: document.getElementById("search-view").hidden,
    }));
    check("graph: / focuses the filter input",
      slashState.activeElement === "graph-view-filter", JSON.stringify(slashState));
    check("graph: / does not open the Search side panel",
      slashState.activity !== "search" &&
      slashState.activity === activityBeforeSlash && slashState.searchHidden === true,
      JSON.stringify(slashState));

    // Double-click a projected node. The test mirrors the renderer's
    // projection from the public camera API; the old pan + x*scale math
    // no longer applies.
    const dbl = await page.evaluate(() => {
      const g = NB.graph;
      const host = document.getElementById("graph-view-canvas-host");
      const r = host.getBoundingClientRect();
      const W = r.width, H = r.height;
      const cam = g.getCamera();
      const focal = (Math.min(W, H) / 2) / Math.tan(cam.fov / 2);
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const dir = { x: cp * sy, y: sp, z: cp * cy };
      const pos = {
        x: cam.target.x + dir.x * cam.dist,
        y: cam.target.y + dir.y * cam.dist,
        z: cam.target.z + dir.z * cam.dist,
      };
      const fwd = { x: -dir.x, y: -dir.y, z: -dir.z };
      let rx = -fwd.z, ry = 0, rz = fwd.x;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      const right = { x: rx, y: ry, z: rz };
      const up = {
        x: ry * fwd.z - rz * fwd.y,
        y: rz * fwd.x - rx * fwd.z,
        z: rx * fwd.y - ry * fwd.x,
      };
      const dz = g.getDepthSpread();
      const project = (n) => {
        const p = { x: n.x, y: n.y, z: n.z * dz };
        const rel = { x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z };
        const depth = rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z;
        if (depth <= 12) return null;
        const cx = rel.x * right.x + rel.y * right.y + rel.z * right.z;
        const uy = rel.x * up.x + rel.y * up.y + rel.z * up.z;
        return {
          x: r.left + W / 2 + (cx / depth) * focal,
          y: r.top + H / 2 - (uy / depth) * focal,
        };
      };
      for (const n of g.nodes) {
        const pt = project(n);
        // Keep clear of the chip (bottom-right) and the edges.
        if (pt && pt.x > r.left + 30 && pt.x < r.right - 260 &&
            pt.y > r.top + 30 && pt.y < r.bottom - 120) {
          return { id: n.id, x: pt.x, y: pt.y };
        }
      }
      return null;
    });
    if (dbl) {
      await page.mouse.dblclick(dbl.x, dbl.y);
      check("graph: double-click opens a projected node",
        await waitFor(() => page.evaluate((id) => NB.tabs.getActive() === id, dbl.id), 8000),
        dbl.id);
      await page.click('#tab-bar .tab[data-path="§graph"]');
      await page.waitForFunction(() => NB.tabs.getActive() === "§graph", null, { timeout: 5000 });
      await sleep(300);
    } else {
      check("graph: a projected node lands on the canvas", false);
    }

    // Filter: a known label narrows the summary and appends the count.
    const filterQuery = await page.evaluate(() => {
      const n = NB.graph.nodes.find((x) => x.id === "Welcome.md") || NB.graph.nodes[0];
      return (n.label || n.id).replace(/\.md$/i, "");
    });
    await page.fill("#graph-view-filter", filterQuery);
    await sleep(250);
    check("graph: filter appends a match count to the summary",
      /· \d+ match(?:es)?$/.test(await page.locator("#graph-view-summary").textContent()),
      await page.locator("#graph-view-summary").textContent());
    await page.fill("#graph-view-filter", "");
    await sleep(150);

    // Regression: at ~900px the summary must stay visible (the 980px rule
    // only ellipsises it) and the filter's match count must still update.
    await page.setViewportSize({ width: 900, height: VIEW.height });
    await sleep(300);
    const narrowSummary = await page.evaluate(() => {
      const s = document.getElementById("graph-view-summary");
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      const heading = s.closest(".graph-view-heading");
      const header = s.closest(".graph-view-header");
      const tools = header && header.querySelector(".graph-view-tools");
      return {
        display: cs.display, visibility: cs.visibility,
        width: r.width, height: r.height, text: s.textContent,
        scrollWidth: s.scrollWidth, maxWidth: cs.maxWidth, flexShrink: cs.flexShrink,
        headingW: heading ? heading.getBoundingClientRect().width : -1,
        headerW: header ? header.getBoundingClientRect().width : -1,
        toolsW: tools ? tools.getBoundingClientRect().width : -1,
        sidePanelW: document.getElementById("side-panel").getBoundingClientRect().width,
        viewport: window.innerWidth,
      };
    });
    check("graph: summary is not display:none at 900px",
      narrowSummary.display !== "none" && narrowSummary.visibility !== "hidden" &&
      narrowSummary.height > 0,
      JSON.stringify(narrowSummary));
    // The 980px rule only caps/ellipsises the summary; it must still own a
    // readable box. At 900px the header is squeezed by the side panel and
    // outline, so this guards against the flex item collapsing to 0 width.
    check("graph: summary keeps a readable width at 900px",
      narrowSummary.width > 0,
      JSON.stringify(narrowSummary));
    await page.fill("#graph-view-filter", filterQuery);
    await sleep(250);
    check("graph: filter match count still updates at 900px",
      /· \d+ match(?:es)?$/.test(await page.locator("#graph-view-summary").textContent()),
      await page.locator("#graph-view-summary").textContent());
    await page.fill("#graph-view-filter", "");
    await sleep(150);
    await page.setViewportSize({ width: VIEW.width, height: VIEW.height });
    await page.waitForFunction(() => window.innerWidth === 1280, null, { timeout: 5000 });
    await sleep(250);

    // Depth spread: 0 flattens the field, 100 restores it.
    await page.locator("#graph-view-depth").evaluate((el) => {
      el.value = "0";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(200);
    check("graph: depth 0% flattens the z-axis",
      await page.evaluate(() => NB.graph.getDepthSpread() === 0 &&
        document.getElementById("graph-view-depth-value").textContent === "0%" &&
        document.getElementById("graph-view-depth").getAttribute("aria-valuetext") === "0 percent"));
    await page.locator("#graph-view-depth").evaluate((el) => {
      el.value = "100";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(200);
    check("graph: depth returns to 100%",
      await page.evaluate(() => NB.graph.getDepthSpread() === 1 &&
        document.getElementById("graph-view-depth-value").textContent === "100%"));

    // Theme: the canvas repaints with the light tokens and the chrome
    // reads the light graph variables.
    const sampleCanvas = () => page.evaluate(() => {
      const c = document.getElementById("graph-view-canvas");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const out = [];
      const step = Math.max(4, Math.floor(d.length / 4 / 500)) * 4;
      for (let i = 0; i < d.length; i += step) out.push(d[i], d[i + 1], d[i + 2], d[i + 3]);
      return out.join(",");
    });
    // Force dark first: Playwright's default color scheme makes "auto"
    // resolve to light, so the light switch must start from a known dark
    // body for the repaint comparison to be meaningful.
    await page.click("#activity-settings-btn");
    await page.waitForFunction(() => !document.getElementById("settings-overlay").hidden,
      null, { timeout: 5000 });
    await page.click('.settings-nav-item[data-tab="appearance"]');
    await page.locator('input[name="theme"][value="dark"]').check();
    await page.waitForFunction(() => document.body.dataset.theme === "dark",
      null, { timeout: 4000 });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("settings-overlay").hidden,
      null, { timeout: 4000 });
    await sleep(400);
    const sampleBeforeTheme = await sampleCanvas();
    await page.click("#activity-settings-btn");
    await page.waitForFunction(() => !document.getElementById("settings-overlay").hidden,
      null, { timeout: 5000 });
    await page.click('.settings-nav-item[data-tab="appearance"]');
    await page.locator('input[name="theme"][value="light"]').check();
    await page.waitForFunction(() => document.body.dataset.theme === "light",
      null, { timeout: 4000 });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("settings-overlay").hidden,
      null, { timeout: 4000 });
    await sleep(600);
    const lightTokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return {
        theme: document.body.dataset.theme,
        label: cs.getPropertyValue("--graph-label-rgb").trim(),
        edge: cs.getPropertyValue("--graph-edge-rgb").trim(),
      };
    });
    const sampleAfterTheme = await sampleCanvas();
    check("graph: light theme uses the light graph tokens",
      lightTokens.theme === "light" && lightTokens.label === "31 35 48" &&
      lightTokens.edge === "80 130 230",
      JSON.stringify(lightTokens));
    check("graph: theme switch repaints the canvas",
      sampleAfterTheme !== sampleBeforeTheme,
      "sample unchanged after theme flip");

    // Reload with the graph tab open: app.js must keep the § id through
    // the boot tree filter so NB.tabs.restore reopens and activates it.
    await page.click('#tab-bar .tab[data-path="§graph"]');
    await page.waitForFunction(() => NB.tabs.getActive() === "§graph", null, { timeout: 5000 });
    check("graph: config persists §graph in openFiles and activeFile",
      await waitFor(() => {
        const s = readWorkspaceState();
        return !!s && Array.isArray(s.openFiles) && s.openFiles.includes("§graph") &&
          s.activeFile === "§graph";
      }, 6000),
      JSON.stringify(readConfig()));
    await page.reload();
    await page.waitForFunction(() => window.NB && NB.tabs && NB.graph, null, { timeout: 20000 });
    check("graph: reload restores and activates the §graph tab",
      await waitFor(() => page.evaluate(() =>
        NB.tabs.getActive() === "§graph" &&
        !document.getElementById("graph-view").hidden &&
        NB.graph.nodes.length > 0), 15000),
      await page.evaluate(() => ({ active: NB.tabs.getActive(),
        nodes: NB.graph ? NB.graph.nodes.length : -1 })));

    // Reduced motion: auto-orbit is forced off and the toggle is disabled.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.waitForFunction(() => window.NB && NB.tabs && NB.graph &&
      NB.graph.nodes.length > 0 && !document.getElementById("graph-view").hidden,
      null, { timeout: 20000 });
    await sleep(400);
    const rmState = await page.evaluate(() => ({
      disabled: document.getElementById("graph-view-rotate").disabled,
      pressed: document.getElementById("graph-view-rotate").getAttribute("aria-pressed"),
      label: document.getElementById("graph-view-rotate").getAttribute("aria-label"),
    }));
    check("graph: reduced motion disables auto-orbit",
      rmState.disabled === true && rmState.pressed === "false",
      JSON.stringify(rmState));
    await page.locator("#graph-view-canvas-host").focus();
    await page.keyboard.press("r");
    await sleep(150);
    check("graph: reduced motion ignores the R auto-orbit shortcut",
      await page.evaluate(() =>
        document.getElementById("graph-view-rotate").getAttribute("aria-pressed") === "false"));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await sleep(250);
    check("graph: leaving reduced motion re-enables auto-orbit",
      await page.evaluate(() => document.getElementById("graph-view-rotate").disabled === false));

    // ---------------------------------------------------------------
    console.log("== graph mode switch ==");
    // 3D is the default mode. Only the 3D canvas is visible and the
    // depth/orbit chrome belongs to it.
    await page.waitForFunction(() =>
      !document.getElementById("graph-view").hidden &&
      window.NB.graph && NB.graph.getMode() === "3d" && NB.graph3d.nodes.length > 0,
      null, { timeout: 15000 });
    await sleep(500);
    const mode3d = await page.evaluate(() => ({
      mode: NB.graph.getMode(),
      canvas3dHidden: document.getElementById("graph-view-canvas").hidden,
      canvas2dHidden: document.getElementById("graph-view-canvas-2d").hidden,
      depth: getComputedStyle(document.getElementById("graph-view-depth")).display,
      rotate: getComputedStyle(document.getElementById("graph-view-rotate")).display,
      pressed3d: document.getElementById("graph-view-mode-3d").getAttribute("aria-pressed"),
      badge: document.getElementById("graph-view-mode-badge").textContent,
    }));
    check("graph mode: default is 3D with only the 3D canvas visible",
      mode3d.mode === "3d" && mode3d.canvas3dHidden === false &&
      mode3d.canvas2dHidden === true && mode3d.depth !== "none" &&
      mode3d.rotate !== "none" && mode3d.pressed3d === "true" &&
      mode3d.badge === "3D",
      JSON.stringify(mode3d));

    // Real click into 2D.
    await page.click("#graph-view-mode-2d");
    await page.waitForFunction(() =>
      NB.graph.getMode() === "2d" && NB.graph2d.nodes.length > 0,
      null, { timeout: 15000 });
    await sleep(900);                       // let the 2D layout settle
    const mode2d = await page.evaluate(() => {
      const depth = document.getElementById("graph-view-depth");
      const label = depth.closest(".graph-view-depth");
      return {
        mode: NB.graph.getMode(),
        canvas3dHidden: document.getElementById("graph-view-canvas").hidden,
        canvas2dHidden: document.getElementById("graph-view-canvas-2d").hidden,
        depth: getComputedStyle(depth).display,
        rotate: getComputedStyle(document.getElementById("graph-view-rotate")).display,
        depthLabel: label ? getComputedStyle(label).display : "missing",
        attr: document.getElementById("graph-view").dataset.graphMode,
        pressed2d: document.getElementById("graph-view-mode-2d").getAttribute("aria-pressed"),
        badge: document.getElementById("graph-view-mode-badge").textContent,
        fitLabel: document.getElementById("graph-view-fit").getAttribute("aria-label"),
        running3d: NB.graph3d.running,
      };
    });
    check("graph mode: 2D click swaps the canvases and the badge",
      mode2d.mode === "2d" && mode2d.canvas3dHidden === true &&
      mode2d.canvas2dHidden === false && mode2d.attr === "2d" &&
      mode2d.pressed2d === "true" && mode2d.badge === "2D",
      JSON.stringify(mode2d));
    // The wrapper is display:none, so the range input's own computed
    // display stays inline-block; the label geometry is what matters.
    check("graph mode: 2D hides the depth and orbit controls",
      mode2d.depthLabel === "none" && mode2d.rotate === "none" &&
      mode2d.fitLabel === "Re-center graph" && mode2d.running3d === false,
      JSON.stringify(mode2d));

    const box2d = await page.locator("#graph-view-canvas-2d").boundingBox();
    check("graph mode: the 2D canvas has a real box",
      !!box2d && box2d.width > 100 && box2d.height > 100,
      JSON.stringify(box2d));

    // 2D wheel zoom.
    const scaleBefore2d = await page.evaluate(() => NB.graph.scale);
    await page.mouse.move(box2d.x + box2d.width / 2, box2d.y + box2d.height / 2);
    await page.mouse.wheel(0, -200);
    await sleep(180);
    const scaleAfter2d = await page.evaluate(() => NB.graph.scale);
    check("graph mode: 2D wheel zooms in",
      scaleAfter2d > scaleBefore2d * 1.05,
      "before=" + scaleBefore2d.toFixed(3) + " after=" + scaleAfter2d.toFixed(3));

    // 2D background drag pans.
    const panBefore2d = await page.evaluate(() =>
      ({ x: NB.graph.pan.x, y: NB.graph.pan.y }));
    const px2d = box2d.x + 20;
    const py2d = box2d.y + box2d.height - 20;
    await page.mouse.move(px2d, py2d);
    await page.mouse.down();
    await page.mouse.move(px2d + 70, py2d - 40, { steps: 8 });
    await page.mouse.up();
    await sleep(180);
    const panAfter2d = await page.evaluate(() =>
      ({ x: NB.graph.pan.x, y: NB.graph.pan.y }));
    check("graph mode: 2D background drag pans the view",
      Math.abs(panAfter2d.x - panBefore2d.x) > 1 ||
      Math.abs(panAfter2d.y - panBefore2d.y) > 1,
      "before=" + JSON.stringify(panBefore2d) +
      " after=" + JSON.stringify(panAfter2d));

    // 2D click selects, double-click opens. Screen = pan + node * scale.
    const target2d = await page.evaluate(() => {
      const p = NB.graph.pan;
      const s = NB.graph.scale;
      const host = document.getElementById("graph-view-canvas-host").getBoundingClientRect();
      for (const n of NB.graph.nodes) {
        const x = host.left + p.x + n.x * s;
        const y = host.top + p.y + n.y * s;
        if (x > host.left + 30 && x < host.right - 30 &&
            y > host.top + 30 && y < host.bottom - 30) {
          return { id: n.id, x: x, y: y };
        }
      }
      return null;
    });
    check("graph mode: a 2D node projects onto the canvas",
      !!target2d, JSON.stringify(target2d));
    if (target2d) {
      await page.mouse.click(target2d.x, target2d.y);
      await sleep(200);
      check("graph mode: 2D click selects a node",
        await page.evaluate((id) => NB.graph.selectedId === id, target2d.id),
        await page.evaluate(() => "selected=" + NB.graph.selectedId));
      await page.mouse.dblclick(target2d.x, target2d.y);
      check("graph mode: 2D double-click opens the note",
        await waitFor(() => page.evaluate((id) => NB.tabs.getActive() === id, target2d.id), 8000),
        target2d.id);
      await page.click('#tab-bar .tab[data-path="§graph"]');
      await page.waitForFunction(() => NB.tabs.getActive() === "§graph" &&
        !document.getElementById("graph-view").hidden && NB.graph.getMode() === "2d",
        null, { timeout: 10000 });
      await sleep(400);
    }

    // 2D fit re-centers the pan/zoom view.
    await page.click("#graph-view-fit");
    await sleep(200);
    const fit2d = await page.evaluate(() => ({
      scale: NB.graph.scale,
      pan: { x: NB.graph.pan.x, y: NB.graph.pan.y },
      w: NB.graph.width, h: NB.graph.height,
    }));
    check("graph mode: 2D fit re-centers the view",
      fit2d.scale === 1 &&
      Math.abs(fit2d.pan.x - fit2d.w / 2) < 1 &&
      Math.abs(fit2d.pan.y - fit2d.h / 2) < 1,
      JSON.stringify(fit2d));

    // Back to 3D: the 2D loop stops and orbit still works.
    await page.click("#graph-view-mode-3d");
    await page.waitForFunction(() => NB.graph.getMode() === "3d" && !NB.graph2d.running,
      null, { timeout: 10000 });
    await sleep(300);
    const back3d = await page.evaluate(() => ({
      mode: NB.graph.getMode(),
      canvas3dHidden: document.getElementById("graph-view-canvas").hidden,
      canvas2dHidden: document.getElementById("graph-view-canvas-2d").hidden,
      depth: getComputedStyle(document.getElementById("graph-view-depth")).display,
      rotate: getComputedStyle(document.getElementById("graph-view-rotate")).display,
      pressed3d: document.getElementById("graph-view-mode-3d").getAttribute("aria-pressed"),
      badge: document.getElementById("graph-view-mode-badge").textContent,
      running2d: NB.graph2d.running,
    }));
    check("graph mode: switching back restores 3D and stops the 2D loop",
      back3d.mode === "3d" && back3d.canvas3dHidden === false &&
      back3d.canvas2dHidden === true && back3d.depth !== "none" &&
      back3d.rotate !== "none" && back3d.pressed3d === "true" &&
      back3d.badge === "3D" && back3d.running2d === false,
      JSON.stringify(back3d));

    const box3d = await page.locator("#graph-view-canvas").boundingBox();
    const yawBeforeRoundTrip = await page.evaluate(() => NB.graph.getCamera().yaw);
    await page.mouse.move(box3d.x + 14, box3d.y + box3d.height - 14);
    await page.mouse.down();
    await page.mouse.move(box3d.x + 104, box3d.y + box3d.height - 69, { steps: 8 });
    await page.mouse.up();
    await sleep(180);
    const yawAfterRoundTrip = await page.evaluate(() => NB.graph.getCamera().yaw);
    check("graph mode: 3D orbit still works after the mode round-trip",
      Math.abs(yawAfterRoundTrip - yawBeforeRoundTrip) > 0.02,
      "before=" + yawBeforeRoundTrip.toFixed(3) +
      " after=" + yawAfterRoundTrip.toFixed(3));

    // Persistence: choose 2D, reload with §graph open, and the tab must
    // come back in 2D.
    await page.click("#graph-view-mode-2d");
    await page.waitForFunction(() => NB.graph.getMode() === "2d" &&
      NB.graph2d.nodes.length > 0, null, { timeout: 15000 });
    check("graph mode: the 2D choice persists to config",
      await waitConfig((c) => c.graphMode === "2d"), JSON.stringify(readConfig()));
    check("graph mode: config keeps §graph open and active for the reload",
      await waitFor(() => {
        const s = readWorkspaceState();
        return !!s && Array.isArray(s.openFiles) && s.openFiles.includes("§graph") &&
          s.activeFile === "§graph";
      }, 6000),
      JSON.stringify(readConfig()));
    await page.reload();
    await page.waitForFunction(() =>
      window.NB && NB.tabs && NB.graph && NB.graph2d, null, { timeout: 20000 });
    const restored2d = await waitFor(() => page.evaluate(() =>
      NB.tabs.getActive() === "§graph" &&
      !document.getElementById("graph-view").hidden &&
      NB.graph.getMode() === "2d" &&
      NB.graph2d.nodes.length > 0 &&
      document.getElementById("graph-view").dataset.graphMode === "2d" &&
      document.getElementById("graph-view-canvas-2d").hidden === false &&
      document.getElementById("graph-view-canvas").hidden === true), 15000);
    check("graph mode: reload restores and activates 2D",
      restored2d, await page.evaluate(() => ({
        active: NB.tabs.getActive(),
        mode: NB.graph.getMode(),
        nodes: NB.graph2d ? NB.graph2d.nodes.length : -1,
      })));

    // Leave the app in 3D so the later sections are unaffected.
    await page.click("#graph-view-mode-3d");
    await page.waitForFunction(() => NB.graph.getMode() === "3d" &&
      !document.getElementById("graph-view-canvas").hidden && !NB.graph2d.running,
      null, { timeout: 10000 });
    check("graph mode: back to 3D for the remaining sections",
      await waitConfig((c) => c.graphMode === "3d"), JSON.stringify(readConfig()));

    // ---------------------------------------------------------------
    console.log("== graph tab return refresh ==");
    // A tab activation refreshes the graph, so a note added or deleted
    // while the graph sits in the background must show up on return.
    {
      const added = "graph-return-" + Date.now() + ".md";
      const base = await page.evaluate(() => ({
        mode: NB.graph.getMode(),
        nodes: NB.graph3d.nodes.length,
        edges: NB.graph3d.edges.length,
        summary: document.getElementById("graph-view-summary").textContent,
      }));

      // 3D: add a note while the graph is hidden, then return.
      await row("Welcome.md").click();
      check("graph return: a file tab takes the graph into the background",
        await waitFor(() => page.evaluate(() =>
          NB.tabs.getActive() === "Welcome.md" &&
          document.getElementById("graph-view").hidden === true), 8000));
      fs.writeFileSync(path.join(DATA, added),
        "# Graph return\n\nAdded while the graph was hidden.\n");
      await page.click('#tab-bar .tab[data-path="§graph"]');
      check("graph return: 3D refresh picks up a note added while hidden",
        await waitFor(() => page.evaluate((n) =>
          NB.tabs.getActive() === "§graph" &&
          NB.graph.getMode() === "3d" &&
          NB.graph3d.nodes.length === n, base.nodes + 1), 15000),
        await page.evaluate(() => "nodes=" + NB.graph3d.nodes.length));
      check("graph return: 3D summary reflects the added note",
        await waitFor(() => page.evaluate((expected) =>
          document.getElementById("graph-view-summary").textContent === expected,
          (base.nodes + 1) + " notes · " + base.edges + " links"), 5000),
        await page.locator("#graph-view-summary").textContent());

      // 2D: bring its copy up to date, then delete the note while hidden.
      await page.click("#graph-view-mode-2d");
      await waitFor(() => page.evaluate(() => NB.graph.getMode() === "2d"), 10000);
      await page.click("#graph-view-refresh");
      check("graph return: 2D refresh picks up the added note",
        await waitFor(() => page.evaluate((n) =>
          NB.graph.getMode() === "2d" && NB.graph2d.nodes.length === n,
          base.nodes + 1), 15000),
        await page.evaluate(() => "nodes=" + NB.graph2d.nodes.length));
      await row("Welcome.md").click();
      await waitFor(() => page.evaluate(() => NB.tabs.getActive() === "Welcome.md"), 8000);
      fs.unlinkSync(path.join(DATA, added));
      await page.click('#tab-bar .tab[data-path="§graph"]');
      check("graph return: 2D refresh drops a note deleted while hidden",
        await waitFor(() => page.evaluate((n) =>
          NB.tabs.getActive() === "§graph" &&
          NB.graph.getMode() === "2d" &&
          NB.graph2d.nodes.length === n, base.nodes), 15000),
        await page.evaluate(() => "nodes=" + NB.graph2d.nodes.length));
      check("graph return: 2D summary reflects the deleted note",
        await waitFor(() => page.evaluate((expected) =>
          document.getElementById("graph-view-summary").textContent === expected,
          base.nodes + " notes · " + base.edges + " links"), 5000),
        await page.locator("#graph-view-summary").textContent());

      // Restore the baseline for the sections that follow.
      await page.click("#graph-view-mode-3d");
      await waitFor(() => page.evaluate(() => NB.graph.getMode() === "3d"), 10000);
      await page.click("#graph-view-refresh");
      check("graph return: 3D is restored to the baseline",
        await waitFor(() => page.evaluate((n) =>
          NB.graph.getMode() === "3d" && !NB.graph2d.running &&
          NB.graph3d.nodes.length === n, base.nodes), 15000),
        await page.evaluate(() => "nodes=" + NB.graph3d.nodes.length));
    }

    // ---------------------------------------------------------------
    console.log("== settings ==");
    await page.click("#activity-settings-btn");
    await page.waitForFunction(() => !document.getElementById("settings-overlay").hidden,
      null, { timeout: 5000 });
    await page.click('.settings-nav-item[data-tab="appearance"]');

    await page.locator('input[name="theme"][value="light"]').check();
    check("settings: theme radio switches the body theme",
      await waitFor(() => page.evaluate(() =>
        document.body.dataset.theme === "light"), 4000),
      await page.evaluate(() => document.body.dataset.theme));
    check("settings: light theme enables the light code stylesheet",
      await page.evaluate(() => {
        const light = document.getElementById("hljs-light");
        const dark = document.getElementById("hljs-dark");
        return light && dark && light.disabled === false && dark.disabled === true;
      }));
    check("settings: theme persists in config",
      await waitConfig((c) => c.theme === "light"));

    await page.locator('input[name="fontSize"][value="xlarge"]').check();
    check("settings: font size changes --font-scale",
      await waitFor(() => page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-scale").trim() === "1.3"), 3000));
    check("settings: font size persists in config",
      await waitConfig((c) => c.fontSize === "xlarge"));

    await page.keyboard.press("Escape");
    check("settings: Esc closes the modal",
      await page.evaluate(() => document.getElementById("settings-overlay").hidden));

    await page.click("#activity-settings-btn");
    await page.waitForFunction(() => !document.getElementById("settings-overlay").hidden);
    await page.click("#settings-close-btn");
    check("settings: footer Close closes the modal",
      await page.evaluate(() => document.getElementById("settings-overlay").hidden));

    // Watcher toggle is live; verify its state and whether it persists.
    await page.click("#activity-settings-btn");
    await page.waitForFunction(() => !document.getElementById("settings-overlay").hidden);
    await page.click('.settings-nav-item[data-tab="general"]');
    check("settings: watcher reports the auto-started polling fallback",
      /Polling \(5s\)/.test(await page.locator("#settings-watch-status").textContent()),
      await page.locator("#settings-watch-status").textContent());
    check("settings: watcher toggle starts as Disable",
      (await page.locator("#settings-watch-toggle").textContent()).trim() === "Disable");
    await page.click("#settings-watch-toggle");
    check("settings: watcher toggle turns change detection off",
      await waitFor(() => page.evaluate(() => NB.watcher.state() === "off"), 3000) &&
      /Watching off/.test(await page.locator("#settings-watch-status").textContent()));
    await sleep(700);
    const cfgAfterWatch = readConfig();
    const watchKeys = Object.keys(cfgAfterWatch || {}).filter((k) => /watch/i.test(k));
    const persistedWatchOff = watchKeys.some((k) =>
      cfgAfterWatch[k] === false || cfgAfterWatch[k] === "off");
    check("settings: watcher toggle persists in config", persistedWatchOff,
      "watch keys=" + JSON.stringify(watchKeys) + " config=" + JSON.stringify(cfgAfterWatch));
    // Restore polling for the watcher section without relying on the native
    // directory picker (which needs a real user gesture and secure context).
    await page.evaluate(() => NB.watcher.startPolling());
    await page.waitForFunction(() => NB.watcher.state() === "polling", null, { timeout: 3000 });
    await page.click("#settings-close-btn");

    // ---------------------------------------------------------------
    console.log("== watcher ==");
    await row("Watcher.md").click();
    await page.waitForFunction(() => NB.tabs.getActive() === "Watcher.md", null, { timeout: 8000 });
    await page.waitForFunction(() =>
      /Original watcher body/.test(document.getElementById("viewer-content").textContent),
      null, { timeout: 5000 });
    await sleep(500);
    const marker = "EXTERNAL-CHANGE-" + Date.now();
    fs.writeFileSync(path.join(DATA, "Watcher.md"),
      "# Watcher\n\nOriginal watcher body.\n\n" + marker + "\n");
    check("watcher: an external edit refreshes the open note within 5s poll",
      await waitFor(() => page.evaluate((m) =>
        document.getElementById("viewer-content").textContent.includes(m), marker), 12000),
      marker);

    fs.writeFileSync(path.join(DATA, "External.md"), "# External\n\nCreated outside the app.\n");
    check("watcher: an externally-created note reaches the tree within 5s poll",
      await waitFor(() => page.evaluate(() =>
        !!document.querySelector('#file-tree .tree-row[data-path="External.md"]')), 12000));

    // ---------------------------------------------------------------
    console.log("== sidebar multi-select ==");
    // Isolated fixtures created directly on disk, then pulled in through
    // the same sidebar-refresh button a user clicks.
    fs.writeFileSync(path.join(DATA, "ms-a.md"), "# MS A\n\nroot a\n");
    fs.writeFileSync(path.join(DATA, "ms-b.md"), "# MS B\n\nroot b\n");
    fs.mkdirSync(path.join(DATA, "ms-dest"));
    await page.click("#sidebar-refresh");
    check("multi-select: refresh brings in the fixtures",
      await waitFor(() => page.evaluate(() =>
        !!document.querySelector('#file-tree .tree-row[data-path="ms-a.md"]') &&
        !!document.querySelector('#file-tree .tree-row[data-path="ms-b.md"]') &&
        !!document.querySelector('#file-tree .tree-row[data-path="ms-dest"]')), 8000));

    // 1. Ctrl+click selects without opening.
    await row("ms-a.md").click({ modifiers: ["Control"] });
    await row("ms-b.md").click({ modifiers: ["Control"] });
    const msSelectedNow = await page.evaluate(() => ({
      paths: Array.from(document.querySelectorAll("#file-tree .tree-row.multi-selected"))
        .map((el) => el.dataset.path),
      aOpen: NB.tabs.isOpen("ms-a.md"),
      bOpen: NB.tabs.isOpen("ms-b.md"),
    }));
    check("multi-select: ctrl+click marks exactly two rows",
      msSelectedNow.paths.length === 2 &&
      msSelectedNow.paths.includes("ms-a.md") &&
      msSelectedNow.paths.includes("ms-b.md"),
      JSON.stringify(msSelectedNow.paths));
    check("multi-select: ctrl+click does not open a file",
      msSelectedNow.aOpen === false && msSelectedNow.bOpen === false,
      JSON.stringify(msSelectedNow));

    // 2. Right-click a selected row -> move the whole selection via prompt.
    await row("ms-a.md").click({ button: "right" });
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden,
      null, { timeout: 5000 });
    const msMenuLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#nb-menu > button"))
        .map((b) => b.textContent));
    check("multi-select: selected row offers 'Move 2 items to…'",
      msMenuLabels.includes("Move 2 items to…"), JSON.stringify(msMenuLabels));
    queuePrompt("ms-dest");
    await menuBtn("Move 2 items to").click();
    check("multi-select: menu move relocates both files on disk",
      await waitFor(() => exists("ms-dest/ms-a.md") && exists("ms-dest/ms-b.md") &&
        !exists("ms-a.md") && !exists("ms-b.md"), 10000));
    check("multi-select: sidebar drops the old rows after the move",
      await waitFor(() => page.evaluate(() =>
        !document.querySelector('#file-tree .tree-row[data-path="ms-a.md"]') &&
        !document.querySelector('#file-tree .tree-row[data-path="ms-b.md"]') &&
        !!document.querySelector('#file-tree .tree-row[data-path="ms-dest/ms-a.md"]') &&
        !!document.querySelector('#file-tree .tree-row[data-path="ms-dest/ms-b.md"]')), 8000));

    // 3. Multi-item drag onto a root file lands both in the root.
    const msDestCollapsed = await row("ms-dest").evaluate(
      (el) => el.classList.contains("collapsed"));
    if (msDestCollapsed) await row("ms-dest").click();
    await row("ms-dest/ms-a.md").click({ modifiers: ["Control"] });
    await row("ms-dest/ms-b.md").click({ modifiers: ["Control"] });
    check("multi-select: ctrl+click selects both moved rows",
      await page.evaluate(() =>
        document.querySelectorAll("#file-tree .tree-row.multi-selected").length === 2));
    await row("ms-dest/ms-a.md").dragTo(row("Welcome.md"), {
      targetPosition: { x: 20, y: 2 },
    });
    check("multi-select: multi-drag onto a root file moves both to the root",
      await waitFor(() => exists("ms-a.md") && exists("ms-b.md") &&
        !exists("ms-dest/ms-a.md") && !exists("ms-dest/ms-b.md"), 12000));

    // 4. Clean up the isolated fixtures and refresh the tree.
    fs.unlinkSync(path.join(DATA, "ms-a.md"));
    fs.unlinkSync(path.join(DATA, "ms-b.md"));
    fs.rmdirSync(path.join(DATA, "ms-dest"));
    await page.click("#sidebar-refresh");
    check("multi-select: cleanup removes the fixture rows",
      await waitFor(() => page.evaluate(() =>
        !document.querySelector('#file-tree .tree-row[data-path="ms-a.md"]') &&
        !document.querySelector('#file-tree .tree-row[data-path="ms-b.md"]') &&
        !document.querySelector('#file-tree .tree-row[data-path="ms-dest"]')), 8000));

    // ---------------------------------------------------------------
    console.log("== workspace add dialog ==");
    await page.click("#activity-settings-btn");
    await page.waitForFunction(() => !document.getElementById("settings-overlay").hidden,
      null, { timeout: 5000 });
    await page.click('.settings-nav-item[data-tab="workspaces"]');
    await page.click("#settings-workspace-add");
    await page.waitForFunction(() => !document.getElementById("workspace-dialog").hidden,
      null, { timeout: 5000 });
    const wsStack = await page.evaluate(() => ({
      dialog: Number(getComputedStyle(document.getElementById("workspace-dialog")).zIndex),
      settings: Number(getComputedStyle(document.getElementById("settings-overlay")).zIndex),
      focused: document.activeElement && document.activeElement.id,
    }));
    // Both overlays are body children; #settings-overlay is later in the
    // document, so equal z-index would paint the Settings card over the
    // dialog and the Add form would never appear.
    check("workspace dialog: opens above the Settings overlay",
      wsStack.dialog > wsStack.settings, JSON.stringify(wsStack));
    check("workspace dialog: focus lands in the name field",
      wsStack.focused === "ws-name", String(wsStack.focused));
    await page.keyboard.press("Escape");
    check("workspace dialog: Escape closes the dialog and leaves Settings open",
      await waitFor(() => page.evaluate(() =>
        document.getElementById("workspace-dialog").hidden &&
        !document.getElementById("settings-overlay").hidden), 4000));
    await page.keyboard.press("Escape");

    // ---------------------------------------------------------------
    console.log("== sessions ==");
    // A saved activeView of sessions makes the reload land on the view; the
    // rail icon toggles collapse when already active, so only click when it
    // is not the active, expanded view.
    const openSessionsView = async () => {
      await page.evaluate(() => {
        if (NB.activity.getActive() !== "sessions" || NB.activity.isCollapsed()) {
          document.querySelector('#activity-bar .activity-btn[data-view="sessions"]').click();
        }
      });
      await page.waitForFunction(() => {
        const v = document.getElementById("sessions-view");
        return v && !v.hidden && v.getBoundingClientRect().width > 0 &&
          document.querySelectorAll("#sessions-list .session-row-wrap").length >= 1;
      }, null, { timeout: 8000 });
    };
    await openSessionsView();
    check("sessions: the rail icon opens the Sessions view",
      await page.evaluate(() =>
        !document.getElementById("sessions-view").hidden &&
        document.querySelector('#activity-bar .activity-btn[data-view="sessions"]')
          .classList.contains("active")));
    check("sessions: the view builds its header, list and footnote",
      await page.evaluate(() =>
        (document.querySelector("#sessions-view .panel-title") || {}).textContent === "Sessions" &&
        !!document.querySelector("#sessions-view .session-add") &&
        /Pinned tabs are shared by every session/.test(
          (document.querySelector("#sessions-view .sessions-foot") || {}).textContent || "")));

    // Known strip: one shared pin plus two unpinned tabs in the active session.
    await page.evaluate(async () => {
      if (NB.hybrid.isActive()) await NB.hybrid.exit(false);
      NB.tabs.getOpen().slice().forEach((p) => NB.tabs.close(p, { force: true }));
      await NB.tabs.open("Welcome.md");
      NB.tabs.togglePin("Welcome.md");
      await NB.tabs.open("notes/a.md");
      await NB.tabs.open("notes/b.md");
    });
    await page.waitForFunction(() =>
      NB.tabs.getOpen().join(",") === "Welcome.md,notes/a.md,notes/b.md" &&
      NB.tabs.getActive() === "notes/b.md", null, { timeout: 8000 });
    const mainId = await page.evaluate(() => NB.tabs.getActiveSessionId());
    check("sessions: the active row shows its unpinned count",
      await waitFor(() => page.evaluate((id) => {
        const w = document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"]');
        return !!w && Number(String(w.querySelector(".session-count").textContent)
          .replace(/\D.*$/, "")) === 2 &&
          w.querySelector(".session-row").getAttribute("aria-current") === "true";
      }, mainId), 6000));
    check("sessions: the shared pin renders in its own region, not the count",
      await page.locator('#tab-pinned .tab[data-path="Welcome.md"]').count() === 1 &&
      await page.locator('#tab-list .tab:not(.ghost)').count() === 2);

    // Create a second session through + and the name dialog.
    await page.click("#sessions-view .session-add");
    await page.waitForFunction(() =>
      !document.getElementById("session-dialog").hidden, null, { timeout: 5000 });
    check("sessions: + opens the New session dialog with focus in the name field",
      await page.evaluate(() =>
        document.getElementById("session-dialog-title").textContent === "New session" &&
        document.activeElement && document.activeElement.id === "session-name"));
    await page.fill("#session-name", "Browser Session");
    await page.click("#session-submit");
    await page.waitForFunction(() =>
      document.getElementById("session-dialog").hidden &&
      NB.tabs.getSessionList().length === 2 &&
      NB.tabs.getSessionList()[1].name === "Browser Session", null, { timeout: 8000 });
    const createdId = await page.evaluate(() => NB.tabs.getSessionList()[1].id);
    check("sessions: a created session is appended and becomes active",
      await page.evaluate((id) =>
        NB.tabs.getActiveSessionId() === id &&
        document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"] .session-row')
          .getAttribute("aria-current") === "true", createdId));
    check("sessions: the new session's strip is the shared pinned set only",
      await waitFor(() => page.evaluate(() =>
        NB.tabs.getOpen().join(",") === "Welcome.md" &&
        !!document.querySelector('#tab-pinned .tab[data-path="Welcome.md"]')), 6000));
    // DEFECT (reported): a successful submit leaves the primary button
    // disabled (static/js/sessions.js:472, :488-496), so the next dialog
    // cannot be submitted. Kept as a check; the workaround below lets the
    // rest of the section run.
    check("sessions: the dialog's submit is enabled for the next open",
      await page.evaluate(() =>
        document.getElementById("session-submit").disabled === false),
      "disabled=" + await page.evaluate(() =>
        document.getElementById("session-submit").disabled));
    await page.evaluate(() => {
      document.getElementById("session-submit").disabled = false;
    });

    // Switch back by clicking the row: the strip swaps in place, the pin stays.
    await page.locator('#sessions-list .session-row-wrap[data-session-id="' +
      mainId + '"] .session-row').click();
    check("sessions: clicking a row swaps the unpinned strip in place",
      await waitFor(() => page.evaluate((id) =>
        NB.tabs.getActiveSessionId() === id &&
        NB.tabs.getOpen().join(",") === "Welcome.md,notes/a.md,notes/b.md" &&
        !!document.querySelector('#tab-pinned .tab[data-path="Welcome.md"]'), mainId), 6000));
    check("sessions: the active marker follows the switch",
      await page.evaluate((id) =>
        document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"] .session-row')
          .getAttribute("aria-current") === "true", mainId));

    // The row ⋯ menu renames the session.
    await page.locator('#sessions-list .session-row-wrap[data-session-id="' +
      createdId + '"] .session-more').click();
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden,
      null, { timeout: 5000 });
    check("sessions: the row \u22ef menu offers Rename and Delete",
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("#nb-menu > button"))
          .map((b) => b.textContent).join("|") === "Rename\u2026|Delete\u2026"),
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("#nb-menu > button"))
          .map((b) => b.textContent).join("|")));
    await menuBtn("Rename\u2026").click();
    await page.waitForFunction(() =>
      !document.getElementById("session-dialog").hidden, null, { timeout: 5000 });
    check("sessions: Rename prefills the field with the row's name",
      await page.evaluate(() =>
        document.getElementById("session-name").value === "Browser Session"));
    await page.fill("#session-name", "Renamed Session");
    await page.click("#session-submit");
    check("sessions: the rename changes only the row text",
      await waitFor(() => page.evaluate((id) => {
        const w = document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"]');
        return NB.tabs.getSessionList().length === 2 &&
          w && w.querySelector(".session-name").textContent === "Renamed Session";
      }, createdId), 6000));

    // A dirty source buffer in the hidden session shows a row dot; coming
    // back shows the tab dot and the Recover bar.
    await page.click('#tab-list .tab[data-path="notes/a.md"]');
    await page.waitForFunction(() => NB.tabs.getActive() === "notes/a.md",
      null, { timeout: 8000 });
    await page.click("#edit-toggle");
    await page.waitForFunction(() => !document.getElementById("cm-host").hidden,
      null, { timeout: 8000 });
    await page.evaluate(() =>
      NB.cmEditor.setValue(NB.cmEditor.getValue() + "\nSESSION_DIRTY\n"));
    await page.locator('#sessions-list .session-row-wrap[data-session-id="' +
      createdId + '"] .session-row').click();
    check("sessions: a hidden dirty buffer puts a dot on its session row",
      await waitFor(() => page.evaluate((id) =>
        !!document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"] .session-dot'),
        mainId), 6000));
    check("sessions: the dirty buffer is kept as a draft",
      await page.evaluate(() =>
        !!NB.viewer.getDraft("notes/a.md") && NB.viewer.isDirty("notes/a.md")));
    await page.locator('#sessions-list .session-row-wrap[data-session-id="' +
      mainId + '"] .session-row').click();
    check("sessions: returning shows the tab dot and the Recover bar",
      await waitFor(() => page.evaluate(() => {
        const t = document.querySelector('.tab[data-path="notes/a.md"]');
        return !!t && t.classList.contains("dirty") &&
          !document.getElementById("draft-bar").hidden;
      }), 6000));
    await page.evaluate(() => NB.viewer.discardDraft());
    check("sessions: discarding the draft clears the row dot",
      await waitFor(() => page.evaluate((id) =>
        !document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"] .session-dot'),
        mainId), 6000));

    // Delete the inactive session from its ⋯ menu.
    await page.locator('#sessions-list .session-row-wrap[data-session-id="' +
      createdId + '"] .session-more').click();
    await page.waitForFunction(() => !document.getElementById("nb-menu").hidden,
      null, { timeout: 5000 });
    queueConfirm();
    await menuBtn("Delete\u2026").click();
    check("sessions: deleting an inactive session removes only its row",
      await waitFor(() => page.evaluate((id) =>
        !document.querySelector(
          '#sessions-list .session-row-wrap[data-session-id="' + id + '"]') &&
        NB.tabs.getSessionList().length === 1, createdId), 6000));
    check("sessions: the active strip is unchanged by that delete",
      await page.evaluate(() =>
        NB.tabs.getActiveSessionId() === "main" &&
        NB.tabs.getOpen().join(",") === "Welcome.md,notes/a.md,notes/b.md"));
    check("sessions: the delete asked for confirmation",
      dialogSeen.some((d) => d.type === "confirm" && /Renamed Session/.test(d.message)),
      JSON.stringify(dialogSeen.slice(-1)));

    // Persistence and reload restore.
    check("sessions: the session shape persists to the workspace state",
      await waitWorkspaceState((s) => Array.isArray(s.sessions) &&
        s.sessions.length === 1 && s.activeSessionId === "main" &&
        Array.isArray(s.sessions[0].openFiles) &&
        s.sessions[0].openFiles.join(",") === "notes/a.md,notes/b.md"));
    await page.reload();
    await page.waitForFunction(() =>
      window.NB && NB.tabs && NB.sidebar &&
      document.querySelectorAll("#file-tree .tree-row").length > 0,
      null, { timeout: 20000 });
    await page.waitForSelector("#viewer-content h1", { timeout: 15000 });
    await openSessionsView();
    check("sessions: reload restores the session, its tabs and the pin",
      await page.evaluate(() =>
        NB.tabs.getSessionList().length === 1 &&
        NB.tabs.getSessionList()[0].name === "Main" &&
        NB.tabs.getSessionList()[0].count === 2 &&
        NB.tabs.getOpen().join(",") === "Welcome.md,notes/a.md,notes/b.md" &&
        NB.tabs.getActiveSessionId() === "main"));
    check("sessions: reload restores the shared pinned region",
      await page.locator('#tab-pinned .tab[data-path="Welcome.md"]').count() === 1);

    // A 900 px viewport keeps the view and its rows usable.
    await page.setViewportSize({ width: 900, height: VIEW.height });
    check("sessions: the view fits at 900 px",
      await waitFor(() => page.evaluate(() => {
        const v = document.getElementById("sessions-view");
        const list = document.getElementById("sessions-list");
        const more = document.querySelector("#sessions-list .session-more");
        return !v.hidden && v.getBoundingClientRect().width > 0 &&
          list.scrollWidth <= list.clientWidth + 1 &&
          !!more && more.getBoundingClientRect().width > 0;
      }), 4000),
      await page.evaluate(() => {
        const list = document.getElementById("sessions-list");
        return "scroll=" + (list.scrollWidth - list.clientWidth);
      }));
    await page.setViewportSize(VIEW);

    // The light theme renders the view with a distinct active row.
    await page.click("#activity-settings-btn");
    await page.waitForFunction(() =>
      !document.getElementById("settings-overlay").hidden, null, { timeout: 5000 });
    await page.click('.settings-nav-item[data-tab="appearance"]');
    await page.locator('input[name="theme"][value="light"]').check();
    await waitFor(() => page.evaluate(() => document.body.dataset.theme === "light"), 4000);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.getElementById("settings-overlay").hidden, null, { timeout: 5000 });
    await openSessionsView();
    const lightRow = await page.evaluate(() => {
      const row = document.querySelector('#sessions-list .session-row[aria-current="true"]');
      const name = row && row.querySelector(".session-name");
      if (!row || !name) return null;
      const rs = getComputedStyle(row);
      const ns = getComputedStyle(name);
      return {
        theme: document.body.dataset.theme,
        bg: rs.backgroundColor,
        color: ns.color,
        height: row.getBoundingClientRect().height,
      };
    });
    check("sessions: the view renders in the light theme with a distinct active row",
      !!lightRow && lightRow.theme === "light" && lightRow.height > 0 &&
      lightRow.bg !== "rgba(0, 0, 0, 0)" && lightRow.color !== lightRow.bg,
      JSON.stringify(lightRow));

    // Clean up every session the section created.
    await page.evaluate(async () => {
      for (const s of NB.tabs.getSessionList().slice(1)) {
        await NB.tabs.deleteSession(s.id);
      }
    });
    check("sessions: cleanup leaves the single Main session",
      await page.evaluate(() => NB.tabs.getSessionList().length === 1 &&
        NB.tabs.getSessionList()[0].name === "Main"));

    // ---------------------------------------------------------------
    console.log("== page errors ==");
    check("no uncaught page errors", pageErrors.length === 0,
      pageErrors.slice(0, 3).join(" | "));
  } catch (err) {
    failed++;
    console.log("  FAIL harness: " + String(err && err.stack || err));
    console.log("  server log tail: " + serverLog.split("\n").slice(-12).join(" | "));
  } finally {
    try { await ctx.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
    try { child.kill("SIGTERM"); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main();
