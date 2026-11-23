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

/* The in-place edit's note: a short row, one long enough to press inside the
 * prose, a parent (chevron and meta), and two task rows. */
const EDIT_NOTE = "notes/editing.md";
const EDIT_SOURCE =
  "# Editing\n\nBefore.\n\n" +
  "- alpha\n" +
  "- bravo charlie delta echo foxtrot golf hotel india juliet kilo lima\n" +
  "- parent\n" +
  "    - parent one\n" +
  "    - parent two\n" +
  "- [ ] gamma\n" +
  "- [x] delta\n" +
  "\nAfter.\n";

/* The block drag's note: four roots and a two-child parent, so two roots can
 * be selected with an unselected sibling between them and a real slot
 * beyond them. */
const BLOCK_NOTE = "notes/blocks.md";
const BLOCK_SOURCE =
  "# Blocks\n\n" +
  "- one\n" +
  "- two\n" +
  "    - two a\n" +
  "    - two b\n" +
  "- three\n" +
  "- four\n" +
  "- five\n" +
  "- six\n";

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

const gridTexts = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("#list-editor-grid .le-row .le-text"))
    .map((n) => n.textContent));

const gridLevels = (page) => page.evaluate(() =>
  Array.from(document.querySelectorAll("#list-editor-grid .le-row"))
    .map((n) => Number(n.getAttribute("aria-level"))));

/* A press point inside a row: x is the cell's middle, y is `fy` of its
 * height, so 0.3 is above the midpoint and 0.8 below it. */
const cellPoint = (page, id, fy) => page.evaluate(([i, f]) => {
  const row = document.querySelector(
    '#list-editor-grid .le-row[data-row-id="' + i + '"]');
  if (!row) return null;
  const r = row.querySelector(".le-cell").getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2),
           y: Math.round(r.top + r.height * f),
           top: Math.round(r.top), bottom: Math.round(r.bottom) };
}, [id, fy]);

const dropLine = (page) => page.evaluate(() => {
  const l = document.querySelector("#list-editor-overlay .le-drop-line");
  if (!l) return null;
  const r = l.getBoundingClientRect();
  return {
    display: getComputedStyle(l).display,
    inScroll: !!l.parentElement &&
      l.parentElement.classList.contains("le-scroll"),
    top: Math.round(r.top), left: Math.round(r.left),
    width: Math.round(r.width), height: Math.round(r.height),
  };
});

const dragMarks = (page) => page.evaluate(() => ({
  rows: document.querySelectorAll(
    "#list-editor-grid .le-row.is-dragging").length,
  body: !!document.querySelector("#list-editor-overlay .le-body.is-dragging"),
}));

async function reopen(page) {
  const open = await page.evaluate(() =>
    !document.getElementById("list-editor-overlay").hidden);
  if (open) {
    await page.click("#list-editor-cancel");
    await page.waitForFunction(
      () => document.getElementById("list-editor-overlay").hidden,
      null, { timeout: 4000 });
  }
  return openFromMenu(page, "#viewer-content ul li:first-child");
}

/* Press a row, clear the 4 px threshold, then travel to a Y. */
async function grab(page, id, y) {
  const from = await cellPoint(page, id, 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 12, { steps: 4 });
  if (typeof y === "number") await page.mouse.move(from.x, y, { steps: 8 });
  return from;
}

/* Press a row and hold: the selection the press resolves is read before any
 * travel, which is the moment the block is decided. */
async function pressHold(page, id, fy) {
  const p = await cellPoint(page, id, fy === undefined ? 0.5 : fy);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  return p;
}

/* A Ctrl/Cmd press on a row: the window's own multi-select gesture. */
async function ctrlClick(page, id, fy) {
  const p = await cellPoint(page, id, fy === undefined ? 0.5 : fy);
  await page.keyboard.down("Control");
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up("Control");
  return p;
}

/* Two plain presses at one point: inside 350 ms and 8 px, so one edit
 * gesture on every pointer type. */
async function doublePress(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.down();
  await page.mouse.up();
}

/* The centre (and vertical extent) of an element by selector. */
const boxOf = (page, selector) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
  };
}, selector);

/* The live field and where focus and the caret are. */
const fieldState = (page) => page.evaluate(() => {
  const f = document.querySelector("#list-editor-grid .le-text.is-editing");
  const row = document.querySelector("#list-editor-grid .le-row.is-editing");
  const sel = window.getSelection();
  const active = document.activeElement;
  const activeRow = active && active.closest
    ? active.closest(".le-row") : null;
  return {
    present: !!f,
    editable: f ? f.getAttribute("contenteditable") : null,
    role: f ? f.getAttribute("role") : null,
    text: f ? f.textContent : null,
    rowId: row ? Number(row.getAttribute("data-row-id")) : -1,
    editing: window.NB.listEditor._editing(),
    activeIsCell: !!(active && active.classList &&
      active.classList.contains("le-cell")),
    activeRow: activeRow ? Number(activeRow.getAttribute("data-row-id")) : -1,
    caretInField: !!(sel && sel.anchorNode && f && f.contains(sel.anchorNode)),
    caretOffset: sel ? sel.anchorOffset : -1,
    caretText: sel && sel.anchorNode ? sel.anchorNode.nodeValue : null,
  };
});

/* Cancel anything open, re-read the note from disk, enter hybrid and open
 * the window on the first item: every pointer block starts from a known
 * note and a closed window. */
async function openWindow(page, rel, sel, phone) {
  await page.evaluate(() => {
    if (window.NB.listEditor.isOpen()) window.NB.listEditor.cancel();
  });
  await page.goto(BASE + "/?file=" + encodeURIComponent(rel));
  await page.waitForSelector("#viewer-content ul", { timeout: 15000 });
  if (phone) {
    // At 390 the toolbar collapses its buttons and the context menu is the
    // phone's own sheet, so the chord enters hybrid and the seam opens the
    // window -- the AC19 block's own path.
    await page.keyboard.press("Control+e");
    await page.waitForFunction(
      () => document.getElementById("viewer-content")
        .getAttribute("contenteditable") === "true", null, { timeout: 8000 });
    await page.evaluate(() => {
      localStorage.removeItem("nb:windowGeometry");
      window.NB.listEditor.open(
        document.querySelector("#viewer-content ul li"));
    });
    await page.waitForSelector("#list-editor-overlay:not([hidden])",
      { timeout: 4000 });
    return true;
  }
  await enterHybrid(page);
  return openFromMenu(page, sel);
}

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
  writeNote(EDIT_NOTE, EDIT_SOURCE);
  writeNote(BLOCK_NOTE, BLOCK_SOURCE);
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
    // Every save the window's Apply owes the note, so "one write" is counted
    // rather than inferred from the file's contents.
    const filePosts = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/file/.test(req.url())) {
        filePosts.push(req.url());
      }
    });

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

    // --- AC23-AC30: the pointer drag, on a fresh page ------------------
    // jsdom proves the model step (_moveBlock); this block drives the real
    // pointer, because only a laid-out browser has row midpoints, the
    // line's client coordinates and pointer capture. The earlier blocks
    // left the note's DOM replaced and the viewport at 390, so this one
    // starts from a reload of the original note.
    await page.evaluate(() => {
      if (window.NB.listEditor.isOpen()) window.NB.listEditor.cancel();
      localStorage.removeItem("nb:windowGeometry");
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    writeNote(NOTE, SOURCE);
    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content ul", { timeout: 15000 });
    await enterHybrid(page);
    await openFromMenu(page, "#viewer-content ul li:first-child");

    const OPEN_ORDER =
      '["alpha","beta","beta one","beta two","gamma","delta"]';
    const startOrder = await gridTexts(page);
    check("real browser AC4: the drag block starts from the six-row list",
      JSON.stringify(startOrder) === OPEN_ORDER, JSON.stringify(startOrder));

    // --- AC23/AC25/AC26: one drag, one drop, one history step ----------
    {
      const h0 = await page.evaluate(() => window.NB.listEditor._history());
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      const line = await dropLine(page);
      check("real browser AC23: a press past the threshold draws the drop line",
        !!line && line.display !== "none" && line.inScroll &&
        line.height === 2 && Math.abs(line.top - delta.top) <= 3,
        JSON.stringify(line));
      await page.mouse.up();
      await page.waitForTimeout(60);
      const dropped = await gridTexts(page);
      check("real browser AC23: the drop reorders inside the root level",
        JSON.stringify(dropped) ===
          '["beta","beta one","beta two","gamma","alpha","delta"]',
        JSON.stringify(dropped));
      check("real browser AC26: the drag reports Moved 1 item",
        /Moved 1 item/.test(await status(page)), await status(page));
      const h1 = await page.evaluate(() => window.NB.listEditor._history());
      check("real browser AC26: one drop is exactly one history step",
        h1.depth === h0.depth + 1 && h1.canUndo === true,
        JSON.stringify(h0) + " -> " + JSON.stringify(h1));
      await page.click("#list-editor-undo");
      const undone = await gridTexts(page);
      const h2 = await page.evaluate(() => window.NB.listEditor._history());
      check("real browser AC26: one Undo press restores the order",
        JSON.stringify(undone) === OPEN_ORDER && h2.canUndo === false,
        JSON.stringify(undone) + " / " + JSON.stringify(h2));
      check("real browser AC26: Undo is disabled again after the single step",
        await page.evaluate(() =>
          document.getElementById("list-editor-undo").disabled));
    }

    // --- AC23: a parent carries its visible children; a child goes alone
    {
      await reopen(page);
      const delta = await cellPoint(page, 5, 0.85);
      await grab(page, 1, delta.y);
      const marks = await dragMarks(page);
      check("real browser AC23: dragging a parent dims its whole block",
        marks.rows === 3 && marks.body, JSON.stringify(marks));
      const line = await dropLine(page);
      check("real browser AC23: the level's end draws the line below the block",
        !!line && line.display !== "none" &&
        Math.abs(line.top - delta.bottom) <= 4,
        JSON.stringify(line) + " / " + JSON.stringify(delta));
      await page.mouse.up();
      await page.waitForTimeout(60);
      const moved = await gridTexts(page);
      check("real browser AC23: the parent and both children travel together",
        JSON.stringify(moved) ===
          '["alpha","gamma","delta","beta","beta one","beta two"]',
        JSON.stringify(moved));
      const one = await cellPoint(page, 2, 0.3);
      await grab(page, 3, one.y);
      const childMarks = await dragMarks(page);
      check("real browser AC23: a childless drag dims one row only",
        childMarks.rows === 1, JSON.stringify(childMarks));
      await page.mouse.up();
      await page.waitForTimeout(60);
      const childMoved = await gridTexts(page);
      check("real browser AC23: a child drags alone inside its own level",
        JSON.stringify(childMoved) ===
          '["alpha","gamma","delta","beta","beta two","beta one"]',
        JSON.stringify(childMoved));
      const levels = await gridLevels(page);
      check("real browser AC24: no drag changed a depth",
        levels.join(",") === "1,1,1,1,2,2", levels.join(","));
    }

    // --- AC24: another row's child level is never a slot ---------------
    {
      await reopen(page);
      const overChild = await cellPoint(page, 2, 0.5);
      const alpha = await cellPoint(page, 0, 0.5);
      await grab(page, 4, overChild.y);
      const over = await dropLine(page);
      check("real browser AC24: hovering a nested child draws no line",
        !over || over.display === "none", JSON.stringify(over));
      await page.mouse.move(alpha.x, alpha.top + 6, { steps: 6 });
      const atRoot = await dropLine(page);
      check("real browser AC24: the line sits on the dragged row's own level",
        !!atRoot && atRoot.display !== "none" &&
        Math.abs(atRoot.top - alpha.top) <= 3,
        JSON.stringify(atRoot) + " / " + JSON.stringify(alpha));
      await page.keyboard.press("Escape");
      await page.mouse.up();
    }

    // --- AC25: a no-op drop writes no line, no status, no step ----------
    {
      await reopen(page);
      const h0 = await page.evaluate(() => window.NB.listEditor._history());
      const alpha = await cellPoint(page, 0, 0.5);
      await grab(page, 0, alpha.top + 20);
      const line = await dropLine(page);
      check("real browser AC25: a drop at the row's own position draws no line",
        !line || line.display === "none", JSON.stringify(line));
      await page.mouse.up();
      await page.waitForTimeout(60);
      const noopStatus = await status(page);
      check("real browser AC25: the no-op drop writes no result to the status",
        noopStatus === "6 items · 1 selected · 1 done", noopStatus);
      const keptOrder = await gridTexts(page);
      check("real browser AC25: the no-op drop leaves the order alone",
        JSON.stringify(keptOrder) === OPEN_ORDER, JSON.stringify(keptOrder));
      const h1 = await page.evaluate(() => window.NB.listEditor._history());
      const undoOff = await page.evaluate(() =>
        document.getElementById("list-editor-undo").disabled);
      check("real browser AC25: the no-op drop adds no history step",
        h1.depth === h0.depth && h1.canUndo === false && undoOff,
        JSON.stringify(h1));
    }

    // --- AC27: Esc during a drag cancels the drag only ------------------
    {
      await reopen(page);
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      const drawn = await dropLine(page);
      await page.keyboard.press("Escape");
      const after = await page.evaluate(() => ({
        open: !document.getElementById("list-editor-overlay").hidden,
        line: !!document.querySelector("#list-editor-overlay .le-drop-line"),
        marks: document.querySelectorAll(
          "#list-editor-grid .le-row.is-dragging").length,
        body: !!document.querySelector(
          "#list-editor-overlay .le-body.is-dragging"),
      }));
      await page.mouse.up();
      check("real browser AC27: the drag had drawn its line before Esc",
        !!drawn && drawn.display !== "none", JSON.stringify(drawn));
      check("real browser AC27: Esc mid-drag cancels the drag, keeps the window",
        after.open && !after.line && after.marks === 0 && !after.body,
        JSON.stringify(after));
      const escOrder = await gridTexts(page);
      const escUndo = await page.evaluate(() =>
        window.NB.listEditor._history().canUndo);
      check("real browser AC27: Esc mid-drag leaves the order and history alone",
        JSON.stringify(escOrder) === OPEN_ORDER && escUndo === false,
        JSON.stringify(escOrder) + " / " + escUndo);
    }

    // --- AC30 and §3.2: the click after a drop, modifiers, chev, done ---
    {
      await reopen(page);
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      await page.mouse.up();
      await page.waitForTimeout(80);
      // The pointer is released over delta's row, which the reorder leaves
      // under it: a leaked click would select delta (id 5) instead.
      const afterDrop = await page.evaluate(() => {
        const rows = document.querySelectorAll(
          '#list-editor-grid .le-row[aria-selected="true"]');
        const a = document.activeElement;
        const cell = a && a.closest ? a.closest(".le-row") : null;
        return {
          open: !document.getElementById("list-editor-overlay").hidden,
          count: rows.length,
          id: rows.length === 1 ? rows[0].getAttribute("data-row-id") : null,
          focusId: cell ? cell.getAttribute("data-row-id") : null,
        };
      });
      check("real browser AC30: the click after the drop re-selects nothing",
        afterDrop.open && afterDrop.count === 1 && afterDrop.id === "0" &&
        afterDrop.focusId === "0", JSON.stringify(afterDrop));

      const gamma = await cellPoint(page, 4, 0.5);
      await page.keyboard.down("Control");
      await page.mouse.move(gamma.x, gamma.y);
      await page.mouse.down();
      await page.mouse.move(gamma.x, gamma.y + 24, { steps: 5 });
      const ctrl = await dragMarks(page);
      const ctrlLine = await dropLine(page);
      await page.mouse.up();
      await page.keyboard.up("Control");
      check("real browser §3.2: Ctrl + press starts no drag",
        ctrl.rows === 0 && (!ctrlLine || ctrlLine.display === "none"),
        JSON.stringify(ctrl));

      const beta = await cellPoint(page, 1, 0.5);
      await page.keyboard.down("Shift");
      await page.mouse.move(beta.x, beta.y);
      await page.mouse.down();
      await page.mouse.move(beta.x, beta.y + 24, { steps: 5 });
      const shift = await dragMarks(page);
      const shiftLine = await dropLine(page);
      await page.mouse.up();
      await page.keyboard.up("Shift");
      check("real browser §3.2: Shift + press starts no drag",
        shift.rows === 0 && (!shiftLine || shiftLine.display === "none"),
        JSON.stringify(shift));

      const chev = await page.evaluate(() => {
        const c = document.querySelector(
          '#list-editor-grid .le-row[data-row-id="1"] .le-chev');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2),
                 y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(chev.x, chev.y);
      await page.mouse.down();
      await page.mouse.move(chev.x, chev.y + 24, { steps: 5 });
      const onChev = await dragMarks(page);
      const chevLine = await dropLine(page);
      await page.mouse.up();
      check("real browser §3.2: a press on the chevron starts no drag",
        onChev.rows === 0 && (!chevLine || chevLine.display === "none"),
        JSON.stringify(onChev));

      const done = await page.evaluate(() => {
        const d = document.querySelector(
          '#list-editor-grid .le-row[data-row-id="5"] .le-done');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2),
                 y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(done.x, done.y);
      await page.mouse.down();
      await page.mouse.move(done.x, done.y + 20, { steps: 5 });
      const onDone = await dragMarks(page);
      const doneLine = await dropLine(page);
      await page.mouse.up();
      check("real browser §3.2: a press on the done circle starts no drag",
        onDone.rows === 0 && (!doneLine || doneLine.display === "none"),
        JSON.stringify(onDone));
    }

    // --- AC23/AC26/AC16: Apply writes the drag; Cancel discards it ------
    {
      const fileFirst = () => {
        const m = readNote(NOTE).match(/^-\s+(?:\[[ x]\]\s+)?(\w+)/m);
        return m ? m[1] : null;
      };
      await reopen(page);
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      await page.mouse.up();
      await page.waitForTimeout(60);
      await page.click("#list-editor-apply");
      await page.waitForFunction(
        () => document.getElementById("list-editor-overlay").hidden,
        null, { timeout: 4000 });
      const applied = await noteOrder(page);
      check("real browser AC23: Apply writes the dragged order to the note",
        JSON.stringify(applied) === '["beta","gamma","alpha","delta"]',
        JSON.stringify(applied));
      for (let i = 0; i < 50 && fileFirst() !== "beta"; i++) {
        await page.waitForTimeout(100);
      }
      check("real browser AC23: the dragged order reached the file",
        fileFirst() === "beta", String(fileFirst()));
      await page.keyboard.press("Control+z");
      for (let i = 0; i < 50 && fileFirst() !== "alpha"; i++) {
        await page.waitForTimeout(100);
      }
      const restored = await noteOrder(page);
      check("real browser AC26: one note-level undo restores the order",
        JSON.stringify(restored) === '["alpha","beta","gamma","delta"]' &&
        fileFirst() === "alpha",
        JSON.stringify(restored) + " / " + String(fileFirst()));

      await reopen(page);
      const delta2 = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta2.y);
      await page.mouse.up();
      await page.waitForTimeout(60);
      const dragged = await gridTexts(page);
      await page.click("#list-editor-cancel");
      await page.waitForFunction(
        () => document.getElementById("list-editor-overlay").hidden,
        null, { timeout: 4000 });
      const keptNote = await noteOrder(page);
      const dirty = await page.evaluate(() => window.NB.hybrid.isDirty());
      check("real browser AC16: Cancel after a drag leaves the note unchanged",
        JSON.stringify(dragged) ===
          '["beta","beta one","beta two","gamma","alpha","delta"]' &&
        JSON.stringify(keptNote) === '["alpha","beta","gamma","delta"]' &&
        fileFirst() === "alpha" && !dirty,
        JSON.stringify(dragged) + " / " + JSON.stringify(keptNote));
    }

    // --- AC27: pointercancel mid-drag -----------------------------------
    {
      await reopen(page);
      await page.evaluate(() => {
        window.__pid = null;
        document.addEventListener("pointerdown",
          (e) => { window.__pid = e.pointerId; }, true);
      });
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      const drawn = await dropLine(page);
      const pid = await page.evaluate(() => window.__pid);
      const cancelled = await page.evaluate((id) => {
        document.getElementById("list-editor-grid").dispatchEvent(
          new PointerEvent("pointercancel", {
            bubbles: true, cancelable: true,
            pointerId: id, pointerType: "mouse",
          }));
        return {
          line: !!document.querySelector(
            "#list-editor-overlay .le-drop-line"),
          rows: document.querySelectorAll(
            "#list-editor-grid .le-row.is-dragging").length,
          body: !!document.querySelector(
            "#list-editor-overlay .le-body.is-dragging"),
          nb: document.body.classList.contains("nb-le-drag"),
          open: !document.getElementById("list-editor-overlay").hidden,
        };
      }, pid);
      await page.mouse.up();
      const afterCancel = await gridTexts(page);
      const cancelUndo = await page.evaluate(() =>
        window.NB.listEditor._history().canUndo);
      check("real browser AC27: pointercancel removes the line, the dim, the classes",
        !!drawn && drawn.display !== "none" && pid !== null &&
        !cancelled.line && cancelled.rows === 0 && !cancelled.body &&
        !cancelled.nb,
        JSON.stringify(cancelled) + " pid=" + pid);
      check("real browser AC27: pointercancel leaves the order, history and window",
        JSON.stringify(afterCancel) === OPEN_ORDER && cancelUndo === false &&
        cancelled.open, JSON.stringify(afterCancel) + " / " + cancelUndo);
    }

    // --- AC27: close() mid-drag -----------------------------------------
    {
      await reopen(page);
      const fileBefore = readNote(NOTE);
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      const drawn = await dropLine(page);
      const closed = await page.evaluate(() => {
        window.NB.listEditor.close();
        return {
          line: !!document.querySelector(
            "#list-editor-overlay .le-drop-line"),
          rows: document.querySelectorAll(
            "#list-editor-grid .le-row.is-dragging").length,
          body: !!document.querySelector(
            "#list-editor-overlay .le-body.is-dragging"),
          nb: document.body.classList.contains("nb-le-drag"),
          state: window.NB.listEditor.getState(),
          open: window.NB.listEditor.isOpen(),
        };
      });
      await page.mouse.up();
      check("real browser AC27: close() mid-drag clears the line, the dim and the classes",
        !!drawn && drawn.display !== "none" && !closed.line &&
        closed.rows === 0 && !closed.body && !closed.nb,
        JSON.stringify(closed));
      check("real browser AC27: close() mid-drag drops the model and writes nothing",
        closed.state === null && !closed.open && readNote(NOTE) === fileBefore,
        String(closed.state));
      await reopen(page);
      const clean = await page.evaluate(() => ({
        line: !!document.querySelector("#list-editor-overlay .le-drop-line"),
        rows: document.querySelectorAll("#list-editor-grid .le-row").length,
        nb: document.body.classList.contains("nb-le-drag"),
      }));
      check("real browser AC27: reopening after a close mid-drag starts clean",
        !clean.line && !clean.nb && clean.rows === 6 &&
        readNote(NOTE) === fileBefore, JSON.stringify(clean));
    }

    // --- AC29: a synthetic touch press never drags ----------------------
    {
      await reopen(page);
      const h0 = await page.evaluate(() => window.NB.listEditor._history());
      const touch = await page.evaluate(() => {
        const cell = document.querySelector(
          '#list-editor-grid .le-row[data-row-id="0"] .le-cell');
        const r = cell.getBoundingClientRect();
        const grid = document.getElementById("list-editor-grid");
        const x = Math.round(r.left + 30);
        const y0 = Math.round(r.top + 6);
        const opts = (extra) => Object.assign({
          bubbles: true, cancelable: true, pointerId: 77,
          pointerType: "touch", isPrimary: true,
          clientX: x, clientY: y0, button: 0,
        }, extra);
        cell.dispatchEvent(new PointerEvent("pointerdown", opts({ buttons: 1 })));
        grid.dispatchEvent(new PointerEvent("pointermove",
          opts({ buttons: 1, clientY: y0 + 40 })));
        const mid = {
          line: !!document.querySelector(
            "#list-editor-overlay .le-drop-line"),
          nb: document.body.classList.contains("nb-le-drag"),
        };
        grid.dispatchEvent(new PointerEvent("pointerup",
          opts({ buttons: 0, clientY: y0 + 40 })));
        return mid;
      });
      const afterTouch = await gridTexts(page);
      const touchHist = await page.evaluate(() => ({
        canUndo: window.NB.listEditor._history().canUndo,
        open: !document.getElementById("list-editor-overlay").hidden,
      }));
      check("real browser AC29: a touch press and move start no drag",
        !touch.line && !touch.nb, JSON.stringify(touch));
      check("real browser AC29: a touch press reorders nothing and adds no step",
        JSON.stringify(afterTouch) === OPEN_ORDER &&
        touchHist.canUndo === false && h0.canUndo === false && touchHist.open,
        JSON.stringify(afterTouch) + " / " + JSON.stringify(touchHist));
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0, delta.y);
      await page.mouse.up();
      await page.waitForTimeout(60);
      const afterMouse = await gridTexts(page);
      check("real browser AC29: a mouse drag still works after a touch press",
        JSON.stringify(afterMouse) ===
          '["beta","beta one","beta two","gamma","alpha","delta"]',
        JSON.stringify(afterMouse));
    }

    // --- AC30: the backdrop click a drop owes the browser ---------------
    // Released over the backdrop (the slot only reads Y), the drop commits,
    // and the click the pointerup owes lands on the overlay, whose own
    // handler cancels the window. The guard must swallow it.
    {
      await reopen(page);
      const modal = await page.evaluate(() => {
        const m = document.querySelector("#list-editor-overlay .settings-modal");
        const r = m.getBoundingClientRect();
        return { left: Math.round(r.left), top: Math.round(r.top) };
      });
      const delta = await cellPoint(page, 5, 0.3);
      await grab(page, 0);
      await page.mouse.move(Math.max(4, Math.round(modal.left / 2)), delta.y,
        { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(60);
      const dropped = await gridTexts(page);
      const backdrop = await page.evaluate(() => {
        const o = document.getElementById("list-editor-overlay");
        const m = o.querySelector(".settings-modal").getBoundingClientRect();
        return { overlay: o.dispatchEvent(new MouseEvent("click", {
          bubbles: true, cancelable: true,
          clientX: Math.round(m.left / 2), clientY: Math.round(m.top + 20),
        })) };
      });
      await page.waitForTimeout(60);
      const afterBackdrop = await page.evaluate(() => {
        const overlay = document.getElementById("list-editor-overlay");
        const rows = document.querySelectorAll(
          '#list-editor-grid .le-row[aria-selected="true"]');
        return {
          open: !overlay.hidden,
          isOpen: window.NB.listEditor.isOpen(),
          count: rows.length,
          id: rows.length === 1 ? rows[0].getAttribute("data-row-id") : null,
          status: document.getElementById("list-editor-status").textContent,
        };
      });
      check("real browser AC30: the drop released over the backdrop still commits",
        JSON.stringify(dropped) ===
          '["beta","beta one","beta two","gamma","alpha","delta"]' &&
        /Moved 1 item/.test(afterBackdrop.status),
        JSON.stringify(dropped) + " / " + JSON.stringify(backdrop));
      check("real browser AC30: the backdrop click after a drop keeps the window open",
        afterBackdrop.open && afterBackdrop.isOpen,
        JSON.stringify(afterBackdrop));
      check("real browser AC30: the backdrop click re-selects no row",
        afterBackdrop.count === 1 && afterBackdrop.id === "0",
        JSON.stringify(afterBackdrop));
      if (afterBackdrop.open) {
        await page.click("#list-editor-cancel");
        await page.waitForFunction(
          () => document.getElementById("list-editor-overlay").hidden,
          null, { timeout: 4000 });
      }
    }

    // --- AC28: the stale window refuses the drag ------------------------
    {
      await reopen(page);
      await page.evaluate(() => {
        const vc = document.getElementById("viewer-content");
        vc.innerHTML = "<ul><li>alpha</li><li>beta</li></ul>";
        window.NB.evt.emit("hybrid:rerendered");
      });
      await page.waitForTimeout(100);
      const before = await page.evaluate(() => ({
        stale: window.NB.listEditor.isStale(),
        canUndo: window.NB.listEditor._history().canUndo,
        texts: Array.from(
          document.querySelectorAll("#list-editor-grid .le-row .le-text"))
          .map((n) => n.textContent),
      }));
      const first = await cellPoint(page, 0, 0.5);
      await grab(page, 0, first.y + 20);
      const hit = await dragMarks(page);
      const line = await dropLine(page);
      await page.mouse.up();
      const after = await page.evaluate(() => ({
        canUndo: window.NB.listEditor._history().canUndo,
        texts: Array.from(
          document.querySelectorAll("#list-editor-grid .le-row .le-text"))
          .map((n) => n.textContent),
      }));
      check("real browser AC28: in stale a press starts no drag, draws no line",
        before.stale && hit.rows === 0 && !hit.body &&
        (!line || line.display === "none"),
        JSON.stringify(before.stale) + " / " + JSON.stringify(hit));
      check("real browser AC28: in stale the model and the history stay put",
        JSON.stringify(after.texts) === JSON.stringify(before.texts) &&
        after.canUndo === false && before.canUndo === false,
        JSON.stringify(after));
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.getElementById("list-editor-overlay").hidden,
        null, { timeout: 4000 });
    }

    // --- AC31/AC33/AC34/AC36/AC39: the in-place edit, real pointer ------
    // jsdom opens the field through _editRow and cannot type; only the real
    // browser can prove the double-press, the caret at the press point, the
    // real keys and the focus hand-back.
    {
      writeNote(EDIT_NOTE, EDIT_SOURCE);
      await openWindow(page, EDIT_NOTE, "#viewer-content ul li:first-child");
      const h0 = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      const p = await cellPoint(page, 0, 0.5);
      await doublePress(page, p.x, p.y);
      await page.waitForTimeout(40);
      const st = await fieldState(page);
      check("real browser AC31: a double-press opens the field on that row",
        st.present && st.editable === "true" && st.rowId === 0 &&
        st.role === "textbox" && st.text === "alpha" &&
        st.editing && st.editing.rowId === 0,
        JSON.stringify(st));
      check("real browser AC31: the edit opens with that row alone selected",
        await page.evaluate(() => {
          const s = window.NB.listEditor.getState().selected;
          return s.size === 1 && s.has(0);
        }));
      check("real browser AC31: the pair draws no line and adds no step",
        !(await dropLine(page)) &&
        (await page.evaluate(() => window.NB.listEditor._history().depth)) === h0);

      // The caret lands where the press landed, not at the end.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(30);
      const longBox = await page.evaluate(() => {
        const t = document.querySelector(
          '#list-editor-grid .le-row[data-row-id="1"] .le-text');
        const r = document.createRange();
        r.selectNodeContents(t);
        const rect = r.getBoundingClientRect();
        const cell = t.closest(".le-cell").getBoundingClientRect();
        const left = Math.round(rect.left);
        const right = Math.round(Math.min(rect.right, cell.right - 20));
        return { left: left, pressX: Math.round(left + (right - left) * 0.4),
                 pressY: Math.round(rect.top + rect.height / 2),
                 length: t.textContent.length };
      });
      await doublePress(page, longBox.pressX, longBox.pressY);
      await page.waitForTimeout(40);
      const mid = await fieldState(page);
      const caret = await page.evaluate(() => {
        const sel = window.getSelection();
        const r = sel.getRangeAt(0).getBoundingClientRect();
        return { x: Math.round(r.left), offset: sel.anchorOffset };
      });
      check("real browser AC37: a press inside the prose puts the caret there",
        mid.present && mid.caretInField && caret.offset > 0 &&
        caret.offset < longBox.length &&
        Math.abs(caret.x - longBox.pressX) <= 12,
        JSON.stringify(mid.caretText) + " / " +
        JSON.stringify(caret) + " / " + JSON.stringify(longBox));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(30);

      // What never starts an edit: the chevron, the done circle, the meta.
      const chev = await boxOf(page,
        '#list-editor-grid .le-row[data-row-id="2"] .le-chev');
      await doublePress(page, chev.x, chev.y);
      await page.waitForTimeout(40);
      check("real browser AC31: a pair on the chevron opens no field",
        !(await fieldState(page)).present &&
        (await page.evaluate(() => window.NB.listEditor._editing())) === null);
      await page.mouse.click(chev.x, chev.y);
      await page.waitForTimeout(40);
      const collapsed = await page.evaluate(() => document.querySelector(
        '#list-editor-grid .le-row[data-row-id="2"]').getAttribute("aria-expanded"));
      check("real browser AC31: the chevron keeps its own collapse",
        collapsed === "false" && !(await fieldState(page)).present,
        String(collapsed));

      const doneBefore = await page.evaluate(() => document.querySelector(
        '#list-editor-grid .le-row[data-row-id="5"] .le-done')
        .getAttribute("aria-checked"));
      const doneBox = await boxOf(page,
        '#list-editor-grid .le-row[data-row-id="5"] .le-done');
      await doublePress(page, doneBox.x, doneBox.y);
      await page.waitForTimeout(60);
      const doneAfter = await page.evaluate(() => document.querySelector(
        '#list-editor-grid .le-row[data-row-id="5"] .le-done')
        .getAttribute("aria-checked"));
      check("real browser AC31: a pair on the done circle opens no field",
        !(await fieldState(page)).present);
      check("real browser AC31: the done circle keeps its own toggle",
        doneBefore === doneAfter, String(doneBefore) + " -> " + String(doneAfter));

      // A collapsed parent carries the "2 hidden" meta: facts, not words.
      const metaBox = await boxOf(page,
        '#list-editor-grid .le-row[data-row-id="2"] .le-meta');
      const hMeta = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      if (metaBox) await doublePress(page, metaBox.x, metaBox.y);
      await page.waitForTimeout(40);
      check("real browser AC31: a pair on the meta opens no field",
        !!metaBox && !(await fieldState(page)).present &&
        (await page.evaluate(() => window.NB.listEditor._history().depth)) === hMeta,
        JSON.stringify(metaBox));
      await page.mouse.click(chev.x, chev.y);
      await page.waitForTimeout(40);

      // A modifier press is the selection gesture it already is.
      const modP = await cellPoint(page, 6, 0.5);
      await page.keyboard.down("Control");
      await doublePress(page, modP.x, modP.y);
      await page.keyboard.up("Control");
      await page.waitForTimeout(40);
      check("real browser AC31: Ctrl presses open no field",
        !(await fieldState(page)).present);
      await page.keyboard.down("Shift");
      await doublePress(page, modP.x, modP.y);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(40);
      check("real browser AC31: Shift presses open no field",
        !(await fieldState(page)).present);

      // Enter commits, and the row's cell takes focus back.
      const ap = await cellPoint(page, 0, 0.5);
      await doublePress(page, ap.x, ap.y);
      await page.waitForTimeout(40);
      await page.keyboard.press("End");
      await page.keyboard.type(" edited");
      const hEnter = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      const committed = await fieldState(page);
      const committedTexts = await gridTexts(page);
      check("real browser AC31: Enter commits the typed text",
        !committed.present && committedTexts[0] === "alpha edited" &&
        /Edited 1 item$/.test(await status(page)),
        JSON.stringify(committedTexts) + " / " + await status(page));
      check("real browser AC31: a commit returns focus to the row's cell",
        committed.activeIsCell && committed.activeRow === 0,
        JSON.stringify(committed));
      check("real browser AC34: the commit is exactly one history step",
        (await page.evaluate(() => window.NB.listEditor._history().depth)) ===
          hEnter + 1);

      // A press on another row commits first, then selects that row.
      await doublePress(page, ap.x, ap.y);
      await page.waitForTimeout(40);
      await page.keyboard.type("!");
      const other = await cellPoint(page, 2, 0.5);
      const hOther = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      await page.mouse.click(other.x, other.y);
      await page.waitForTimeout(80);
      const handOver = await page.evaluate(() => {
        const s = window.NB.listEditor.getState();
        return {
          editing: window.NB.listEditor._editing(),
          depth: window.NB.listEditor._history().depth,
          texts: Array.from(document.querySelectorAll(
            "#list-editor-grid .le-row .le-text")).map((n) => n.textContent),
          selected: Array.from(s.selected),
        };
      });
      check("real browser AC39: a press on another row commits the edit first",
        handOver.editing === null && handOver.depth === hOther + 1 &&
        handOver.texts[0] === "alpha edited!",
        JSON.stringify(handOver));
      check("real browser AC39: then the pressed row is the one selected",
        JSON.stringify(handOver.selected) === "[2]",
        JSON.stringify(handOver.selected));
    }

    // --- AC34: Apply writes the prose once, one note undo restores it ----
    {
      writeNote(EDIT_NOTE, EDIT_SOURCE);
      await openWindow(page, EDIT_NOTE, "#viewer-content ul li:first-child");
      const p = await cellPoint(page, 0, 0.5);
      await doublePress(page, p.x, p.y);
      await page.waitForTimeout(40);
      await page.keyboard.press("End");
      await page.keyboard.type(" edited");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(80);
      const posts = filePosts.length;
      await page.click("#list-editor-apply");
      await page.waitForFunction(
        () => document.getElementById("list-editor-overlay").hidden,
        null, { timeout: 4000 });
      const applied = await page.evaluate(() => {
        const li = document.querySelector("#viewer-content ul li");
        const copy = li.cloneNode(true);
        copy.querySelectorAll("ul,ol,input").forEach((n) => n.remove());
        return { text: copy.textContent.replace(/\u200B/g, "").trim(),
                 strongs: li.querySelectorAll("strong").length,
                 boxes: li.querySelectorAll("input").length };
      });
      check("real browser AC34: Apply writes the edited prose once",
        applied.text === "alpha edited" && applied.strongs === 0 &&
        applied.boxes === 0, JSON.stringify(applied));
      // The note's autosave is debounced (~5 s); wait for the write it owes,
      // then count it.
      for (let i = 0; i < 80 && !/alpha edited/.test(readNote(EDIT_NOTE)); i++) {
        await page.waitForTimeout(100);
      }
      check("real browser AC34: the file carries the new prose",
        /alpha edited/.test(readNote(EDIT_NOTE)), readNote(EDIT_NOTE));
      check("real browser AC34: one Apply is one POST",
        filePosts.length - posts === 1, "" + (filePosts.length - posts));
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
      const undone = await page.evaluate(() => {
        const li = document.querySelector("#viewer-content ul li");
        return li ? li.textContent.trim() : null;
      });
      check("real browser AC34: one note-level undo restores the text",
        undone === "alpha",
        JSON.stringify(undone) + " / " + readNote(EDIT_NOTE));
    }

    // --- AC38: the phone edits at a 16 px field, clear of the keyboard ---
    {
      writeNote(EDIT_NOTE, EDIT_SOURCE);
      await page.setViewportSize({ width: 390, height: 844 });
      await openWindow(page, EDIT_NOTE, "#viewer-content ul li:first-child", true);
      // No on-screen keyboard in a headless browser: force the inset the
      // stylesheet reserves for one.
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--m-kb", "320px"));
      const tap = await page.evaluate(() =>
        getComputedStyle(document.querySelector(
          "#list-editor-grid .le-cell")).touchAction);
      const p = await cellPoint(page, 0, 0.5);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(40);
      const onePress = await fieldState(page);
      await page.waitForTimeout(400);   // outside the pair's 350 ms window
      await doublePress(page, p.x, p.y);
      await page.waitForTimeout(200);
      const phone = await page.evaluate(() => {
        const f = document.querySelector("#list-editor-grid .le-text.is-editing");
        const body = document.querySelector("#list-editor-overlay .le-body");
        const scroll = document.querySelector("#list-editor-overlay .le-scroll");
        const space3 = parseFloat(getComputedStyle(scroll)
          .getPropertyValue("--space-3"));
        return {
          present: !!f,
          size: f ? parseFloat(getComputedStyle(f).fontSize) : -1,
          pad: parseFloat(getComputedStyle(scroll).paddingBottom),
          space3: space3,
          bodyEditing: !!body && body.classList.contains("is-editing"),
          bottom: f ? Math.round(f.getBoundingClientRect().bottom) : -1,
          limit: window.innerHeight - 320,
        };
      });
      check("real browser AC38: the phone cell takes no tap delay",
        tap === "manipulation", String(tap));
      check("real browser AC38: one press only selects, two press edit",
        !onePress.present && phone.present, JSON.stringify(onePress));
      check("real browser AC38: the phone field computes 16 px",
        phone.size === 16, String(phone.size));
      check("real browser AC38: the scroller reserves the keyboard inset",
        phone.bodyEditing && Math.abs(phone.pad - (phone.space3 + 320)) <= 1,
        JSON.stringify(phone));
      check("real browser AC38: the field sits above innerHeight - kb",
        phone.bottom > 0 && phone.bottom <= phone.limit, JSON.stringify(phone));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
      await page.evaluate(() =>
        document.documentElement.style.removeProperty("--m-kb"));
      await page.setViewportSize({ width: 1280, height: 900 });
    }

    // --- AC41/AC42/AC43: the block drag, real pointer --------------------
    {
      writeNote(BLOCK_NOTE, BLOCK_SOURCE);
      await openWindow(page, BLOCK_NOTE, "#viewer-content ul li:first-child");
      const ORDER =
        '["one","two","two a","two b","three","four","five","six"]';
      check("real browser AC4: the block block starts from the eight-row list",
        JSON.stringify(await gridTexts(page)) === ORDER,
        JSON.stringify(await gridTexts(page)));

      // Two roots with an unselected sibling (and its subtree) between them.
      const first = await cellPoint(page, 0, 0.5);
      await page.mouse.click(first.x, first.y);
      await ctrlClick(page, 4, 0.5);
      const marked = () => page.evaluate(() => ({
        size: window.NB.listEditor.getState().selected.size,
        marked: document.querySelectorAll(
          '#list-editor-grid .le-row[aria-selected="true"]').length,
      }));
      const twoRoots = await marked();
      check("real browser AC41: the two roots are the selection",
        twoRoots.size === 2 && twoRoots.marked === 2,
        JSON.stringify(twoRoots));

      const h0 = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      const from = await pressHold(page, 0, 0.5);
      const held = await marked();
      check("real browser AC42: a press on a selected root keeps the selection",
        held.size === 2 && held.marked === 2, JSON.stringify(held));
      await page.mouse.move(from.x, from.y + 12, { steps: 4 });
      const marks = await dragMarks(page);
      check("real browser AC41: every row of the span dims",
        marks.rows === 5 && marks.body, JSON.stringify(marks));

      // Over a nested child the line is still the root level's, and the only
      // slot there reproduces the order, so it is hidden: nothing is drawn
      // over the block or between its roots.
      const inner = await cellPoint(page, 2, 0.5);
      await page.mouse.move(from.x, inner.y, { steps: 8 });
      const overBlock = await dropLine(page);
      check("real browser AC41: no line sits over the block or between its roots",
        !overBlock || overBlock.display === "none",
        JSON.stringify(overBlock));

      const endBox = await cellPoint(page, 7, 0.8);
      await page.mouse.move(from.x, endBox.y, { steps: 8 });
      const endLine = await dropLine(page);
      check("real browser AC41: the level's end draws the line under its last row",
        !!endLine && endLine.display !== "none" && endLine.inScroll &&
        Math.abs(endLine.top - (await cellPoint(page, 7, 0)).bottom) <= 4,
        JSON.stringify(endLine));

      await page.mouse.up();
      await page.waitForTimeout(100);
      const dropped = await gridTexts(page);
      check("real browser AC41: the drop gathers the span at the slot",
        JSON.stringify(dropped) ===
          '["four","five","six","one","two","two a","two b","three"]',
        JSON.stringify(dropped));
      check("real browser AC41: one block drop is one step, Moved 2 items",
        (await page.evaluate(() => window.NB.listEditor._history().depth)) ===
          h0 + 1 && /Moved 2 items$/.test(await status(page)),
        await status(page));
      const settled = await page.evaluate(() => {
        const s = window.NB.listEditor.getState();
        const a = document.activeElement;
        const row = a && a.closest ? a.closest(".le-row") : null;
        return {
          selected: Array.from(s.selected).sort(),
          anchor: s.anchorId, focus: s.focusId,
          activeRow: row ? Number(row.getAttribute("data-row-id")) : -1,
        };
      });
      check("real browser AC42: the roots are the selection, the pressed root the anchor",
        JSON.stringify(settled.selected) === "[0,4]" && settled.anchor === 0 &&
        settled.focus === 0 && settled.activeRow === 0,
        JSON.stringify(settled));
    }

    // --- AC42: what a press resolves; AC43: one level only ---------------
    {
      writeNote(BLOCK_NOTE, BLOCK_SOURCE);
      await openWindow(page, BLOCK_NOTE, "#viewer-content ul li:first-child");
      const a = await cellPoint(page, 0, 0.5);
      await page.mouse.click(a.x, a.y);
      await ctrlClick(page, 4, 0.5);
      const depth0 = await page.evaluate(() =>
        window.NB.listEditor._history().depth);

      // (a) an unselected row, pressed inside a multi-selection, drags alone.
      const from = await pressHold(page, 6, 0.5);
      const alone = await page.evaluate(() => {
        const s = window.NB.listEditor.getState().selected;
        return { size: s.size, has6: s.has(6) };
      });
      await page.mouse.move(from.x, from.y + 12, { steps: 4 });
      const oneMark = await dragMarks(page);
      const top = await cellPoint(page, 0, 0.3);
      await page.mouse.move(from.x, top.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      check("real browser AC42: a press on an unselected row selects it alone",
        alone.size === 1 && alone.has6 && oneMark.rows === 1,
        JSON.stringify(alone) + " / " + JSON.stringify(oneMark));
      const afterAlone = await gridTexts(page);
      check("real browser AC42: that drag moves the one row",
        JSON.stringify(afterAlone) ===
          '["five","one","two","two a","two b","three","four","six"]' &&
        /Moved 1 item$/.test(await status(page)),
        JSON.stringify(afterAlone) + " / " + await status(page));

      // (b) a locked descendant drags alone, inside its own level.
      const two = await cellPoint(page, 1, 0.5);
      await page.mouse.click(two.x, two.y);
      const fromChild = await pressHold(page, 2, 0.5);
      const locked = await page.evaluate(() => {
        const s = window.NB.listEditor.getState().selected;
        return { size: s.size, has2: s.has(2) };
      });
      await page.mouse.move(fromChild.x, fromChild.y + 12, { steps: 4 });
      const childMark = await dragMarks(page);
      const belowSibling = await cellPoint(page, 3, 0.8);
      await page.mouse.move(fromChild.x, belowSibling.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const childOrder = await gridTexts(page);
      check("real browser AC42: a locked descendant is selected and dragged alone",
        locked.size === 1 && locked.has2 && childMark.rows === 1,
        JSON.stringify(locked) + " / " + JSON.stringify(childMark));
      check("real browser AC42: the child moved inside its own level",
        JSON.stringify(childOrder) ===
          '["five","one","two","two b","two a","three","four","six"]',
        JSON.stringify(childOrder));

      // (c) a press and release with no travel collapses the selection.
      const a2 = await cellPoint(page, 0, 0.5);
      await page.mouse.click(a2.x, a2.y);
      await ctrlClick(page, 4, 0.5);
      const hClick = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      await pressHold(page, 0, 0.5);
      await page.mouse.up();
      await page.waitForTimeout(60);
      const collapsed = await page.evaluate(() => {
        const s = window.NB.listEditor.getState().selected;
        return { size: s.size, list: Array.from(s) };
      });
      check("real browser AC42: a click without travel collapses the selection",
        collapsed.size === 1 && JSON.stringify(collapsed.list) === "[0]" &&
        (await page.evaluate(() => window.NB.listEditor._history().depth)) ===
          hClick,
        JSON.stringify(collapsed));

      // (d) a mixed-level selection refuses at the threshold.
      const childRow = await cellPoint(page, 2, 0.5);
      await page.mouse.click(childRow.x, childRow.y);
      await ctrlClick(page, 5, 0.5);
      const mixedSel = await page.evaluate(() => {
        const s = window.NB.listEditor.getState().selected;
        return Array.from(s).sort();
      });
      const hMixed = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      const fromMixed = await pressHold(page, 2, 0.5);
      await page.mouse.move(fromMixed.x, fromMixed.y + 6, { steps: 4 });
      const mixed = {
        marks: await dragMarks(page),
        line: await dropLine(page),
        status: await status(page),
        selected: await page.evaluate(() => {
          const s = window.NB.listEditor.getState().selected;
          return Array.from(s).sort();
        }),
        depth: await page.evaluate(() => window.NB.listEditor._history().depth),
      };
      check("real browser AC43: a mixed-level selection starts no drag",
        mixedSel.length === 2 && mixed.marks.rows === 0 && !mixed.marks.body &&
        (!mixed.line || mixed.line.display === "none"),
        JSON.stringify(mixedSel) + " / " + JSON.stringify(mixed.marks));
      check("real browser AC43: the refusal writes one sentence and keeps the selection",
        /Dragging needs the selected items to share one level\.$/
          .test(mixed.status) &&
        JSON.stringify(mixed.selected) === JSON.stringify(mixedSel) &&
        mixed.depth === hMixed,
        JSON.stringify(mixed));
      await page.mouse.up();
      await page.waitForTimeout(60);

      // (e) the whole level has no slot: no line, no step, no message.
      await page.evaluate(() =>
        window.NB.listEditor._select([0, 1, 2, 3, 4, 5, 6, 7]));
      const hWhole = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      const fromWhole = await pressHold(page, 0, 0.5);
      await page.mouse.move(fromWhole.x, fromWhole.y + 12, { steps: 4 });
      const wholeLine = await dropLine(page);
      await page.mouse.up();
      await page.waitForTimeout(80);
      check("real browser AC41: a span covering the whole level draws no line",
        !wholeLine || wholeLine.display === "none", JSON.stringify(wholeLine));
      check("real browser AC41: that drop adds no step and no message",
        (await page.evaluate(() => window.NB.listEditor._history().depth)) ===
          hWhole && !/Moved/.test(await status(page)), await status(page));
    }

    // --- AC44: a press that starts a block drag commits the edit first ---
    // F2 opens the field without a press, so the two-root selection survives
    // the entry -- a double-press would collapse it to its row (UI §3.2).
    {
      writeNote(BLOCK_NOTE, BLOCK_SOURCE);
      await openWindow(page, BLOCK_NOTE, "#viewer-content ul li:first-child");
      const a = await cellPoint(page, 0, 0.5);
      await page.mouse.click(a.x, a.y);
      await ctrlClick(page, 4, 0.5);
      await page.keyboard.press("F2");
      await page.waitForTimeout(40);
      await page.keyboard.press("End");
      await page.keyboard.type(" EDITED");
      const hE = await page.evaluate(() =>
        window.NB.listEditor._history().depth);
      const entered = await fieldState(page);
      check("real browser AC44: the edit opens on a selected root",
        entered.editing !== null && entered.text === "three EDITED" &&
        (await page.evaluate(() =>
          window.NB.listEditor.getState().selected.size)) === 2,
        JSON.stringify(entered));

      const other = await cellPoint(page, 0, 0.5);
      await page.mouse.move(other.x, other.y);
      await page.mouse.down();
      await page.waitForTimeout(60);
      const committed = await page.evaluate(() => {
        const s = window.NB.listEditor.getState();
        return {
          editing: window.NB.listEditor._editing(),
          depth: window.NB.listEditor._history().depth,
          texts: Array.from(document.querySelectorAll(
            "#list-editor-grid .le-row .le-text")).map((n) => n.textContent),
          selected: Array.from(s.selected).sort(),
        };
      });
      check("real browser AC44: the press commits the text first",
        committed.editing === null && committed.depth === hE + 1 &&
        committed.texts[4] === "three EDITED",
        JSON.stringify(committed));
      check("real browser AC44: the press then arms the block, not a single row",
        JSON.stringify(committed.selected) === "[0,4]",
        JSON.stringify(committed.selected));
      await page.mouse.move(other.x, other.y + 12, { steps: 4 });
      const armed = await dragMarks(page);
      const endBox = await cellPoint(page, 7, 0.8);
      await page.mouse.move(other.x, endBox.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const afterDrop = await gridTexts(page);
      check("real browser AC44: the drop adds its own step",
        armed.rows === 5 &&
        (await page.evaluate(() => window.NB.listEditor._history().depth)) ===
          hE + 2,
        JSON.stringify(armed));
      check("real browser AC44: the moved roots carry the edited text",
        JSON.stringify(afterDrop) ===
          '["four","five","six","one","two","two a","two b","three EDITED"]',
        JSON.stringify(afterDrop));
      await page.click("#list-editor-cancel");
      await page.waitForFunction(
        () => document.getElementById("list-editor-overlay").hidden,
        null, { timeout: 4000 });
      check("real browser AC44: Cancel discards the text and the drag",
        readNote(BLOCK_NOTE) === BLOCK_SOURCE &&
        !(await page.evaluate(() => window.NB.hybrid.isDirty())),
        readNote(BLOCK_NOTE));
    }

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
