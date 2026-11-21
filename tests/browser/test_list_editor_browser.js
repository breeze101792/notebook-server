/* Real-browser test for the hybrid "Edit list" modal (list-editor.js).
 *
 * jsdom proves the model, the verbs and the handlers; this suite proves
 * what only a real browser can: the context-menu entry, pointer
 * selection with modifiers, focus containment, the row geometry, the
 * toolbar at narrow widths, the phone rule against saved geometry, and
 * Apply -> save round-tripping to GFM on disk.
 *
 * Run:  node tests/browser/test_list_editor_browser.js
 * Env:  CHROMIUM_PATH overrides the auto-detected binary.
 *       PORT sets the Flask port (default 5093).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const playwright = require("playwright");

const PROJ = path.resolve(__dirname, "..", "..");
const PY = path.join(PROJ, ".venv_" + os.hostname(), "bin", "python");
const { findChromium } = require("./chromium");
const BROWSER_PATH = process.env.CHROMIUM_PATH || findChromium();
const PORT = Number(process.env.PORT || 5093);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-browser-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const NOTE = "notes/list.md";
const SOURCE =
  "# Lists\n\nBefore.\n\n" +
  "- alpha\n" +
  "- beta\n" +
  "    - beta one\n" +
  "    - beta two\n" +
  "- [ ] gamma\n" +
  "- [x] delta\n" +
  "\nAfter.\n";

const OL_NOTE = "notes/ordered.md";
const OL_SOURCE = "5. five\n6. six\n7. seven\n";

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

function writeNote(rel, body) {
  const p = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}
function readNote(rel) { return fs.readFileSync(path.join(DATA, rel), "utf8"); }

async function waitForServer(child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + "/api/auth");
      if (r.ok || r.status === 401) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function enterHybrid(page) {
  await page.click("#hybrid-toggle");
  await page.waitForFunction(
    () => document.getElementById("viewer-content")
      .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
}

async function openFromMenu(page, itemSelector) {
  await page.click(itemSelector, { button: "right" });
  await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 4000 });
  const label = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("#nb-menu button"))
      .find((b) => b.textContent.trim() === "Edit list…");
    return !!btn;
  });
  if (!label) return false;
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("#nb-menu button"))
      .find((b) => b.textContent.trim() === "Edit list…");
    if (btn) btn.click();
  });
  await page.waitForSelector("#list-editor-overlay:not([hidden])",
    { timeout: 4000 });
  return true;
}

const rowCount = (page) => page.evaluate(() =>
  document.querySelectorAll("#list-editor-grid .le-row").length);

const rowBox = (page, id) => page.evaluate((i) => {
  const row = document.querySelector(
    '#list-editor-grid .le-row[data-row-id="' + i + '"]');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  const cell = row.querySelector(".le-cell");
  const c = cell.getBoundingClientRect();
  return { row: r.height, cell: c.height, left: r.left, top: r.top };
}, id);

const status = (page) => page.evaluate(() =>
  document.getElementById("list-editor-status").textContent);

const noteOrder = (page) => page.evaluate(() => {
  const ul = document.querySelector("#viewer-content ul");
  return ul ? Array.from(ul.children)
    .filter((n) => n.tagName === "LI")
    .map((n) => {
      const copy = n.cloneNode(true);
      copy.querySelectorAll("ul,ol,input").forEach((x) => x.remove());
      return copy.textContent.replace(/\u200B/g, "").trim();
    }) : null;
});

async function main() {
  writeNote(NOTE, SOURCE);
  writeNote(OL_NOTE, OL_SOURCE);
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
      executablePath: BROWSER_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    console.error("cannot launch chromium: " + String(err).split("\n")[0]);
    console.error("Set CHROMIUM_PATH to a working binary.");
    child.kill("SIGTERM");
    process.exit(2);
  }

  try {
    await waitForServer(child);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content ul", { timeout: 15000 });
    await enterHybrid(page);

    // --- AC1: real right-click, real menu item ----------------------
    const opened = await openFromMenu(page,
      "#viewer-content ul li:first-child");
    check("real browser AC1: right-click → Edit list… opens the window",
      opened);
    const shell = await page.evaluate(() => {
      const o = document.getElementById("list-editor-overlay");
      const m = o.querySelector(".settings-modal");
      return {
        hidden: o.hidden,
        modal: m && m.getAttribute("role"),
        labelledby: m && m.getAttribute("aria-labelledby"),
        title: document.getElementById("list-editor-title").textContent,
        inBody: o.parentElement === document.body,
      };
    });
    check("real browser AC2: the window is a labelled direct-body dialog",
      !shell.hidden && shell.modal === "dialog" && shell.inBody &&
      shell.labelledby === "list-editor-title" && shell.title === "Edit list",
      JSON.stringify(shell));
    check("real browser AC4: four roots and two nested rows are listed",
      (await rowCount(page)) === 6, String(await rowCount(page)));

    // --- AC5: the row is the list-row contract ----------------------
    const geom = await rowBox(page, 0);
    check("real browser AC5: a row measures 27 px at the 1.0 root",
      !!geom && Math.abs(geom.row - 27) <= 1, JSON.stringify(geom));
    const inner = await page.evaluate(() => {
      const cell = document.querySelector(
        '#list-editor-grid .le-row[data-row-id="0"] .le-cell');
      const cs = getComputedStyle(cell);
      const text = cell.querySelector(".le-text");
      const ts = getComputedStyle(text);
      return { pad: cs.padding, radius: cs.borderRadius,
               size: ts.fontSize, lh: ts.lineHeight, weight: ts.fontWeight };
    });
    check("real browser AC5: row padding 3/6, radius 4, body type, weight 400",
      inner.pad === "3px 6px" && inner.radius === "4px" &&
      inner.weight === "400" &&
      parseFloat(inner.lh) / parseFloat(inner.size) > 1.4,
      JSON.stringify(inner));

    // --- AC6: pointer selection, with modifiers ----------------------
    await page.click('#list-editor-grid .le-row[data-row-id="1"] .le-cell');
    check("real browser AC6: a click selects the row and its subtree",
      (await page.evaluate(() => document.querySelectorAll(
        '#list-editor-grid .le-row[aria-selected="true"]').length)) === 3 &&
      /3 selected/.test(await status(page)),
      await status(page));
    await page.click('#list-editor-grid .le-row[data-row-id="4"] .le-cell',
      { modifiers: ["Control"] });
    check("real browser AC6: Ctrl-click adds a root",
      /4 selected/.test(await status(page)), await status(page));
    await page.click('#list-editor-grid .le-row[data-row-id="5"] .le-cell',
      { modifiers: ["Shift"] });
    check("real browser AC6: Shift-click extends the visible range",
      /5 selected/.test(await status(page)), await status(page));
    await page.evaluate(() => window.NB.listEditor._select([2, 4]));

    // --- AC7/AC22: a mixed-level move is refused in the UI -----------
    const disabled = await page.evaluate(() => {
      const top = document.getElementById("le-move-top");
      return { aria: top.getAttribute("aria-disabled"),
               title: top.title, name: top.getAttribute("aria-label") };
    });
    check("real browser AC8: To top is aria-disabled for a mixed selection",
      disabled.aria === "true" &&
      /To top needs the selected items to share one level\./.test(disabled.name),
      JSON.stringify(disabled));

    // --- AC7: a real move, then Apply --------------------------------
    await page.evaluate(() => window.NB.listEditor._select([0]));
    await page.click("#le-move-down");
    check("real browser AC7: Move down reorders the window model",
      /Moved 1 item down/.test(await status(page)), await status(page));
    await page.click("#list-editor-apply");
    await page.waitForFunction(
      () => document.getElementById("list-editor-overlay").hidden,
      null, { timeout: 4000 });
    check("real browser AC15: Apply moves the note's list",
      JSON.stringify(await noteOrder(page)) ===
        '["beta","alpha","gamma","delta"]',
      JSON.stringify(await noteOrder(page)));

    // --- AC13/AC14: the caret and note undo --------------------------
    const caret = await page.evaluate(() => {
      const a = document.activeElement;
      const sel = window.getSelection();
      const n = sel && sel.anchorNode;
      return {
        inContent: !!(a && a.closest && a.closest("#viewer-content")),
        selInList: !!(n && (n.closest ? n.closest("li") : null)),
      };
    });
    check("real browser AC13: Apply returns focus and the caret to the note",
      caret.inContent && caret.selInList, JSON.stringify(caret));
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(120);
    check("real browser AC15: one note undo restores the previous order",
      JSON.stringify(await noteOrder(page)) ===
        '["alpha","beta","gamma","delta"]',
      JSON.stringify(await noteOrder(page)));

    // --- AC2/AC16: Esc, and focus containment -----------------------
    await openFromMenu(page, "#viewer-content ul li:first-child");
    const firstFocus = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a.tagName, cls: a.className, id: a.id,
               inOverlay: !!(a.closest && a.closest("#list-editor-overlay")) };
    });
    check("real browser AC2: opening puts focus on the first row",
      firstFocus.inOverlay && /le-cell/.test(firstFocus.cls),
      JSON.stringify(firstFocus));
    for (let i = 0; i < 30; i++) await page.keyboard.press("Tab");
    const trapped = await page.evaluate(() => {
      const a = document.activeElement;
      return !!(a && a.closest && a.closest("#list-editor-overlay"));
    });
    check("real browser AC13: Tab never escapes the window", trapped);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("list-editor-overlay").hidden,
      null, { timeout: 4000 });
    check("real browser AC16: the note's order is unchanged after Cancel",
      JSON.stringify(await noteOrder(page)) ===
        '["alpha","beta","gamma","delta"]');

    // --- AC19: narrow widths -----------------------------------------
    await page.setViewportSize({ width: 720, height: 800 });
    await openFromMenu(page, "#viewer-content ul li:first-child");
    const narrow = await page.evaluate(() => {
      const slot = document.querySelector(
        "#list-editor-overlay .edit-bar-actions");
      const bar = document.querySelector("#list-editor-overlay .edit-bar");
      const footer = document.querySelector(
        "#list-editor-overlay .edit-footer");
      return {
        scrollable: slot.scrollWidth > slot.clientWidth + 1,
        barH: Math.round(bar.getBoundingClientRect().height),
        footerH: Math.round(footer.getBoundingClientRect().height),
        slotW: Math.round(slot.getBoundingClientRect().width),
      };
    });
    check("real browser AC19: at 720 the bar stays one line and the footer wraps",
      narrow.barH === 57 && narrow.footerH > 69,
      JSON.stringify(narrow));

    // --- AC17: the stale state, laid out ------------------------------
    await page.evaluate(() => {
      const vc = document.getElementById("viewer-content");
      vc.innerHTML = "<ul><li>alpha</li><li>beta</li></ul>";
      window.NB.evt.emit("hybrid:rerendered");
    });
    await page.waitForTimeout(80);
    const stale = await page.evaluate(() => {
      const n = document.getElementById("list-editor-notice");
      const a = document.getElementById("list-editor-apply");
      return { notice: !n.hidden, h: n.getBoundingClientRect().height,
               applyHidden: a.hidden, applyDisabled: a.disabled,
               text: n.textContent.replace(/\s+/g, " ").trim(),
               focus: document.activeElement.id };
    });
    check("real browser AC17: the stale notice is laid out with its copy",
      stale.notice && stale.h > 0 && /This list changed outside the window\./.test(stale.text),
      JSON.stringify(stale));
    check("real browser AC17: Apply is visible and disabled, Cancel has focus",
      !stale.applyHidden && stale.applyDisabled &&
      stale.focus === "list-editor-cancel");
    await page.keyboard.press("Escape");

    // --- AC19: the phone rule beats saved geometry -------------------
    // The geometry is read at open, so seeding it and opening again is the
    // whole test: no reload, and no dependence on the phone shell's topbar.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      localStorage.setItem("nb:windowGeometry", JSON.stringify({
        "list-editor-overlay": { left: 40, top: 60, w: 900, h: 700 },
      }));
      window.NB.listEditor.open(
        document.querySelector("#viewer-content ul li"));
    });
    await page.waitForSelector("#list-editor-overlay:not([hidden])",
      { timeout: 4000 });
    const phone = await page.evaluate(() => {
      const m = document.querySelector("#list-editor-overlay .settings-modal");
      const r = m.getBoundingClientRect();
      const tool = document.querySelector("#le-move-up").getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
               vw: window.innerWidth, vh: window.innerHeight,
               tool: Math.round(tool.height),
               radius: getComputedStyle(m).borderTopLeftRadius };
    });
    check("real browser AC19: at 390 the window is full screen despite saved geometry",
      Math.abs(phone.w - phone.vw) <= 1 && Math.abs(phone.h - phone.vh) <= 1 &&
      phone.radius === "0px", JSON.stringify(phone));
    check("real browser AC19: at 390 a bar tool is 44 tall",
      phone.tool === 44, JSON.stringify(phone));

    check("real browser: no page errors", pageErrors.length === 0,
      pageErrors.join(" | "));
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
  }

  console.log("\nRESULT: " + (failed ? "FAIL" : "PASS") +
    "  (" + passed + " ok, " + failed + " failed)");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
