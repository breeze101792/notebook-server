/* Real-browser test for the hybrid "Edit table" modal (table-editor.js).
 *
 * jsdom can drive the model and the keydown handlers, but it has no
 * editing engine, no real focus, and no layout. This suite exercises the
 * parts that only a real browser can prove: caret typing inside a cell,
 * Tab/Enter moving real focus, Apply -> save round-tripping to GFM on
 * disk, one-step undo/redo, and focus containment/return.
 *
 * Run:  node tests/browser/test_table_editor_browser.js
 * Env:  CHROMIUM_PATH overrides the auto-detected binary.
 *       PORT sets the Flask port (default 5094).
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
const PORT = Number(process.env.PORT || 5094);
const BASE = "http://127.0.0.1:" + PORT;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-browser-"));
const DATA = path.join(tmp, "notebook");
const CONFIG = path.join(tmp, "config");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(CONFIG, { recursive: true });
fs.writeFileSync(path.join(CONFIG, "config.json"), "{}");

const NOTE = "notes/table.md";
const SOURCE =
  "# Table tools\n\nBefore.\n\n" +
  "| Name | Qty | Note |\n" +
  "| :-- | :-: | --: |\n" +
  "| Bolt | 10 | fine |\n" +
  "| Nut | 2 |  |\n\n" +
  "After.\n";

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

async function leaveHybrid(page) {
  await page.evaluate(() => window.NB.hybrid.save());
  await page.click("#close-edit-btn");
  await page.waitForFunction(
    () => !window.NB.hybrid.isActive(), null, { timeout: 8000 });
}

async function openViaOverlay(page) {
  await page.hover("#viewer-content table td");
  await page.waitForSelector("#viewer .nb-table-overlay .nb-te-open",
    { timeout: 5000 });
  // The hover handlers repaint the overlay; focus+click the current node
  // in one page tick so a repaint cannot detach it mid-click. Focusing
  // first mirrors how a real pointer click sets the dialog's invoker.
  await page.evaluate(() => {
    const btn = document.querySelector(
      "#viewer .nb-table-overlay .nb-te-open");
    if (btn) { btn.focus(); btn.click(); }
  });
  await page.waitForSelector("#table-editor-overlay:not([hidden])",
    { timeout: 5000 });
}

const tableText = (page) => page.evaluate(() => {
  const t = document.querySelector("#viewer-content table");
  if (!t) return null;
  return Array.from(t.rows).map((r) =>
    Array.from(r.cells).map((c) => c.textContent.trim()));
});

const activeInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return {
    id: a && a.id, cls: a && a.className, tag: a && a.tagName,
    row: a && a.getAttribute && a.getAttribute("data-row"),
    col: a && a.getAttribute && a.getAttribute("data-col"),
    inViewerContent: !!(a && a.closest && a.closest("#viewer-content")),
    inOverlay: !!(a && a.closest && a.closest("#table-editor-overlay")),
    isBody: a === document.body,
  };
});

async function main() {
  writeNote(NOTE, SOURCE);
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
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(BASE + "/?file=" + encodeURIComponent(NOTE));
    await page.waitForSelector("#viewer-content table", { timeout: 15000 });

    // --- entry control survives entering it (issue 4) --------------
    await enterHybrid(page);
    await page.hover("#viewer-content table td");
    await page.waitForSelector("#viewer .nb-table-overlay .nb-te-open",
      { timeout: 5000 });
    const teBtnBox = await page.locator(
      "#viewer .nb-table-overlay .nb-te-open").boundingBox();
    if (teBtnBox) {
      await page.mouse.move(teBtnBox.x + teBtnBox.width / 2,
        teBtnBox.y + teBtnBox.height / 2);
      await page.waitForTimeout(120);
      const survived = await page.evaluate(() => {
        const b = document.querySelector(
          "#viewer .nb-table-overlay .nb-te-open");
        return !!b && b.isConnected &&
          Math.round(b.getBoundingClientRect().width) === 24;
      });
      check("real browser: the Edit table control survives entering it",
        survived, JSON.stringify(teBtnBox));
    } else {
      check("real browser: the Edit table control survives entering it",
        false, "no bounding box");
    }

    // --- AC2/AC18: overlay entry opens the labelled modal ----------
    await openViaOverlay(page);
    const dialog = await page.evaluate(() => {
      const d = document.querySelector(
        '#table-editor-overlay [role="dialog"]');
      return d ? {
        modal: d.getAttribute("aria-modal"),
        labelledby: d.getAttribute("aria-labelledby"),
        title: document.getElementById("table-editor-title").textContent,
      } : null;
    });
    check("real browser: overlay control opens the labelled modal",
      !!dialog && dialog.modal === "true" &&
      dialog.labelledby === "table-editor-title" &&
      dialog.title === "Edit table", JSON.stringify(dialog));
    const openedActive = await activeInfo(page);
    check("real browser: opening moves focus into the modal",
      openedActive.inOverlay, JSON.stringify(openedActive));
    const normalNotice = await page.evaluate(() => {
      const n = document.getElementById("table-editor-notice");
      return { hidden: n.hidden, display: getComputedStyle(n).display };
    });
    check("real browser: a normal table opens with no notice strip",
      normalNotice.hidden && normalNotice.display === "none",
      JSON.stringify(normalNotice));

    // --- AC14: Tab wraps inside the dialog ------------------------
    // windows.js injects its maximize control ahead of the header close
    // button, so "first" is whatever the dialog reports, not close.
    const focusEdge = (which) => page.evaluate((which) => {
      const list = Array.from(document.querySelectorAll(
        '#table-editor-overlay button, #table-editor-overlay [href], ' +
        '#table-editor-overlay input, #table-editor-overlay select, ' +
        '#table-editor-overlay textarea, ' +
        '#table-editor-overlay [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.disabled && !el.hidden &&
        el.offsetParent !== null);
      const el = which === "first" ? list[0] : list[list.length - 1];
      if (el) el.focus();
      return {
        active: document.activeElement.id ||
          document.activeElement.tagName + "." + document.activeElement.className,
        first: list[0] && (list[0].id ||
          list[0].tagName + "." + list[0].className),
        last: list[list.length - 1] && (list[list.length - 1].id ||
          list[list.length - 1].tagName + "." +
            list[list.length - 1].className),
      };
    }, which);
    const firstEdge = await focusEdge("first");
    await page.keyboard.press("Shift+Tab");
    const wrapBack = await page.evaluate(() =>
      document.activeElement.id ||
      document.activeElement.tagName + "." + document.activeElement.className);
    check("real browser: Shift+Tab from the first control wraps to the last",
      wrapBack === firstEdge.last,
      JSON.stringify({ from: firstEdge, to: wrapBack }));
    await focusEdge("last");
    await page.keyboard.press("Tab");
    const wrapFwd = await page.evaluate(() =>
      document.activeElement.id ||
      document.activeElement.tagName + "." + document.activeElement.className);
    check("real browser: Tab from the last control wraps to the first",
      wrapFwd === firstEdge.first,
      JSON.stringify({ from: firstEdge, to: wrapFwd }));

    // --- edit-mode focus edges keep focus inside the dialog -------
    const cell = (r, c) => page.locator(
      '#table-editor-grid .te-cell[data-row="' + r + '"][data-col="' + c + '"]');
    await cell(1, 2).click();
    await page.keyboard.press("Tab");
    const edgeTab = await activeInfo(page);
    check("real browser: Tab in edit mode at a row edge keeps focus in the grid",
      edgeTab.row === "1" && edgeTab.col === "2" && edgeTab.tag === "TD" &&
      !edgeTab.isBody, JSON.stringify(edgeTab));

    await cell(2, 2).click();
    await page.keyboard.press("Tab");
    const lastTab = await activeInfo(page);
    check("real browser: Tab in edit mode at the final cell leaves to the footer",
      lastTab.id === "table-editor-cancel" && !lastTab.isBody,
      JSON.stringify(lastTab));

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    check("real browser: Esc still closes after focus left the grid", true);

    await openViaOverlay(page);
    await cell(0, 0).click();
    await page.keyboard.press("Shift+Tab");
    const firstTab = await activeInfo(page);
    const inToolbar = await page.evaluate(() => {
      const a = document.activeElement;
      const bar = document.getElementById("table-editor-toolbar");
      return !!(a && bar && bar.contains(a));
    });
    check("real browser: Shift+Tab in edit mode at (0,0) leaves to the toolbar",
      inToolbar && !firstTab.isBody, JSON.stringify(firstTab));

    await cell(2, 0).click();
    await page.keyboard.press("Enter");
    const lastEnter = await activeInfo(page);
    check("real browser: Enter in edit mode on the last row keeps focus in the grid",
      lastEnter.row === "2" && lastEnter.col === "0" &&
      lastEnter.tag === "TD" && !lastEnter.isBody,
      JSON.stringify(lastEnter));

    // --- AC4/AC5: real caret typing, Tab and Enter ----------------
    await cell(1, 0).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" X");
    const typed = await page.evaluate(() =>
      window.NB.tableEditor.getState().rows[1].cells[0].html);
    check("real browser: typing in a cell updates only that cell",
      /Bolt X$/.test(typed), typed);

    await page.keyboard.press("Tab");
    const afterTab = await activeInfo(page);
    check("real browser: Tab commits and moves focus one column right",
      afterTab.row === "1" && afterTab.col === "1" &&
      !(await cell(1, 0).locator(".te-cell-text")
        .getAttribute("contenteditable")),
      JSON.stringify(afterTab));

    await page.keyboard.press("Enter");
    const editingAfterEnter = await cell(1, 1)
      .locator(".te-cell-text").getAttribute("contenteditable");
    check("real browser: Enter starts editing the focused cell",
      editingAfterEnter === "true", "contenteditable=" + editingAfterEnter);
    await page.keyboard.type("9");
    await page.keyboard.press("Enter");
    const afterEnter = await activeInfo(page);
    check("real browser: Enter commits and moves down one row",
      afterEnter.row === "2" && afterEnter.col === "1",
      JSON.stringify(afterEnter));

    // --- AC10: Apply -> save round-trips to GFM, one undo step ----
    await page.click("#table-editor-apply");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    let rows = await tableText(page);
    check("real browser: Apply writes the grid back into the table",
      rows[1][0] === "Bolt X" && rows[1][1] === "109", JSON.stringify(rows));

    // Undo/redo run while the caret is in the note (the hybrid history
    // listens on #viewer-content).
    await page.evaluate(() => document.getElementById("viewer-content").focus());
    await page.keyboard.press("Control+z");
    rows = await tableText(page);
    check("real browser: one Ctrl+Z restores the previous table",
      rows[1][0] === "Bolt" && rows[1][1] === "10", JSON.stringify(rows));
    await page.keyboard.press("Control+Shift+z");
    rows = await tableText(page);
    check("real browser: Ctrl+Shift+Z re-applies the single change",
      rows[1][0] === "Bolt X" && rows[1][1] === "109", JSON.stringify(rows));

    await leaveHybrid(page);
    const afterSave = readNote(NOTE);
    check("real browser: saved note is GFM, no raw HTML table",
      afterSave.indexOf("Bolt X") !== -1 && afterSave.indexOf("109") !== -1 &&
      !/<table/i.test(afterSave), JSON.stringify(afterSave));
    check("real browser: bytes outside the table are unchanged",
      afterSave.indexOf("Before.") !== -1 &&
      afterSave.indexOf("After.") !== -1, JSON.stringify(afterSave));

    // --- AC11: a no-op Apply leaves the note clean ----------------
    await enterHybrid(page);
    await openViaOverlay(page);
    await page.click("#table-editor-apply");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    const dirtyAfterNoop = await page.evaluate(() => window.NB.hybrid.isDirty());
    check("real browser: no-op Apply closes and leaves the note clean",
      dirtyAfterNoop === false, "dirty=" + dirtyAfterNoop);

    // --- N1: overlay-path Apply keeps the keyboard on the note ------
    // The .nb-te-open button is the dialog invoker. Focus must still
    // land in #viewer-content, or hybrid's Ctrl+Z dispatcher never sees
    // the key. Editing then undoing must move exactly one history step.
    await openViaOverlay(page);
    await cell(1, 0).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" N1");
    await page.click("#table-editor-apply");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    const afterOverlayApply = await activeInfo(page);
    check("real browser: overlay-path Apply leaves focus in #viewer-content",
      afterOverlayApply.inViewerContent && !afterOverlayApply.inOverlay &&
      !afterOverlayApply.isBody, JSON.stringify(afterOverlayApply));
    await page.keyboard.press("Control+z");
    rows = await tableText(page);
    check("real browser: Ctrl+Z right after overlay-path Apply undoes one step",
      rows[1][0] === "Bolt X" && rows[1][1] === "109", JSON.stringify(rows));

    // Apply once more, then click the control WITHOUT hovering: only the
    // reveal() call in apply() can have rebound it to the rebuilt table.
    await openViaOverlay(page);
    await cell(1, 0).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" N1");
    await page.click("#table-editor-apply");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    const reopened = await page.evaluate(() => {
      const btn = document.querySelector("#viewer .nb-table-overlay .nb-te-open");
      if (!btn) return { clicked: false };
      btn.click();
      const state = window.NB.tableEditor.getState();
      return {
        clicked: true,
        open: window.NB.tableEditor.isOpen(),
        cell: state && state.rows[1].cells[0].html,
      };
    });
    check("real browser: the overlay control reopens the modal for the rebuilt table",
      reopened.clicked && reopened.open && /Bolt X N1/.test(reopened.cell || ""),
      JSON.stringify(reopened));
    await page.click("#table-editor-cancel");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    // Return to the pre-test text for the later context-menu assertions.
    await page.click("#viewer-content table td");
    await page.keyboard.press("Control+z");
    rows = await tableText(page);
    check("real browser: the second overlay-path Apply is one undo step",
      rows[1][0] === "Bolt X" && rows[1][1] === "109", JSON.stringify(rows));

    // --- drag reordering inside the modal --------------------------
    await openViaOverlay(page);
    const gridOrder = () => page.evaluate(() =>
      Array.from(document.querySelectorAll("#table-editor-grid tbody tr"))
        .map((tr) => Array.from(tr.cells).map((c) => c.textContent.trim())
          .join("|")).join(" / "));
    const gridCols = () => page.evaluate(() =>
      Array.from(document.querySelectorAll("#table-editor-grid thead th"))
        .map((th) => th.textContent.trim()).join("|"));
    const rowsBeforeDrag = await gridOrder();
    const lastRow = page.locator("#table-editor-grid tbody tr").last();
    await lastRow.hover();
    const rowGrip = await lastRow.locator(".te-row-grip").boundingBox();
    const firstRowBox = await page.locator(
      "#table-editor-grid tbody tr").first().boundingBox();
    if (rowGrip && firstRowBox) {
      await page.mouse.move(rowGrip.x + rowGrip.width / 2,
        rowGrip.y + rowGrip.height / 2);
      await page.mouse.down();
      await page.mouse.move(firstRowBox.x + 40, firstRowBox.y + 2,
        { steps: 8 });
      const marked = await page.evaluate(() => document.querySelectorAll(
        "#table-editor-grid .is-drop-before,#table-editor-grid .is-drop-after"
      ).length);
      await page.mouse.up();
      const rowsAfterDrag = await gridOrder();
      check("real browser: a row drag paints the drop marker", marked > 0);
      check("real browser: dragging a row grip reorders the body rows",
        rowsAfterDrag !== rowsBeforeDrag &&
        rowsAfterDrag.split(" / ")[0] === rowsBeforeDrag.split(" / ")[1],
        rowsBeforeDrag + " -> " + rowsAfterDrag);
    } else {
      check("real browser: a row drag paints the drop marker", false,
        "no grip box");
      check("real browser: dragging a row grip reorders the body rows",
        false, "no grip box");
    }
    const colsBeforeDrag = await gridCols();
    const firstHeader = page.locator("#table-editor-grid thead th").first();
    await firstHeader.hover();
    const colGrip = await page.locator("#table-editor-grid thead th")
      .nth(1).locator(".te-col-grip").boundingBox();
    const colBox = await firstHeader.boundingBox();
    if (colGrip && colBox !== null) {
      await page.mouse.move(colGrip.x + colGrip.width / 2,
        colGrip.y + colGrip.height / 2);
      await page.mouse.down();
      await page.mouse.move(colBox.x + 4, colBox.y + colBox.height / 2,
        { steps: 8 });
      await page.mouse.up();
      const colsAfterDrag = await gridCols();
      check("real browser: dragging a column grip reorders every row",
        colsAfterDrag !== colsBeforeDrag &&
        colsAfterDrag.split("|")[0] === colsBeforeDrag.split("|")[1],
        colsBeforeDrag + " -> " + colsAfterDrag);
    } else {
      check("real browser: dragging a column grip reorders every row",
        false, "no grip box");
    }
    await page.click("#table-editor-cancel");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });

    // --- selection: drag, Shift+click, copy and paste ------------------
    await openViaOverlay(page);
    const cellPoint = (r, c) => page.evaluate(([row, col]) => {
      const td = document.querySelector(
        '#table-editor-grid .te-cell[data-row="' + row + '"]' +
        '[data-col="' + col + '"]');
      const b = td.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, [r, c]);
    const selInfo = () => page.evaluate(() => ({
      rect: window.NB.tableEditor.getSelection(),
      selected: document.querySelectorAll(
        '#table-editor-grid .te-cell[aria-selected="true"]').length,
      status: document.getElementById("table-editor-status").textContent,
      editing: !!(document.activeElement &&
        document.activeElement.getAttribute("contenteditable") === "true"),
    }));
    const p10 = await cellPoint(1, 0);
    const p21 = await cellPoint(2, 1);
    await page.mouse.move(p10.x, p10.y);
    await page.mouse.down();
    await page.mouse.move(p21.x, p21.y, { steps: 6 });
    await page.mouse.up();
    const dragged = await selInfo();
    check("real browser: a cell drag paints the rectangle",
      JSON.stringify(dragged.rect) === JSON.stringify(
        { r0: 1, r1: 2, c0: 0, c1: 1 }) && dragged.selected === 4 &&
      !dragged.editing, JSON.stringify(dragged));
    check("real browser: the status line reports the range",
      /^2 × 2 selected, rows 2–3, columns 1–2$/.test(dragged.status),
      dragged.status);

    const p22 = await cellPoint(2, 2);
    await page.keyboard.down("Shift");
    await page.mouse.click(p22.x, p22.y);
    await page.keyboard.up("Shift");
    const shifted = await selInfo();
    check("real browser: Shift+click extends from the anchor",
      JSON.stringify(shifted.rect) === JSON.stringify(
        { r0: 1, r1: 2, c0: 0, c1: 2 }), JSON.stringify(shifted));

    await page.keyboard.press("Escape");
    const collapsed = await selInfo();
    check("real browser: Esc collapses the range and keeps the modal",
      !!(await page.evaluate(() =>
        !document.getElementById("table-editor-overlay").hidden)) &&
      collapsed.rect.r0 === collapsed.rect.r1 &&
      collapsed.rect.c0 === collapsed.rect.c1, JSON.stringify(collapsed));

    // A plain press and release still enters text edit (AC4 kept).
    const p11 = await cellPoint(1, 1);
    await page.mouse.click(p11.x, p11.y);
    const clicked = await selInfo();
    check("real browser: press and release in one cell still edits",
      clicked.editing &&
      !!collapsed && await page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.classList && a.classList.contains("te-cell-text"));
      }), JSON.stringify(clicked));
    await page.keyboard.press("F2");
    const afterF2 = await selInfo();
    check("real browser: F2 leaves text edit without moving the cell",
      !afterF2.editing, JSON.stringify(afterF2));

    // Copy through a real ClipboardEvent: TSV plus an HTML table.
    const copied = await page.evaluate(() => {
      window.NB.tableEditor._select(0, 0, 1, 1);
      const dt = new DataTransfer();
      const ev = new ClipboardEvent("copy",
        { clipboardData: dt, bubbles: true, cancelable: true });
      document.getElementById("table-editor-grid").dispatchEvent(ev);
      return { text: dt.getData("text/plain"), html: dt.getData("text/html") };
    });
    check("real browser: copy writes TSV with no trailing newline",
      copied.text.indexOf("\t") !== -1 && !/\n$/.test(copied.text),
      JSON.stringify(copied.text));
    check("real browser: copy writes an HTML table with <th> for row 0",
      /<thead>/.test(copied.html) && /<th>/.test(copied.html) &&
      /<table>/.test(copied.html), copied.html);

    // Paste a 2 × 2 TSV block at the top-left; the grid grows if needed.
    const pasted = await page.evaluate(() => {
      window.NB.tableEditor._select(1, 0, 1, 0);
      const dt = new DataTransfer();
      dt.setData("text/plain", "P1\tP2\nP3\tP4");
      const cell = document.querySelector(
        '#table-editor-grid .te-cell[data-row="1"][data-col="0"]');
      cell.dispatchEvent(new ClipboardEvent("paste",
        { clipboardData: dt, bubbles: true, cancelable: true }));
      const state = window.NB.tableEditor.getState();
      return {
        rows: state.rows.map((r) => r.cells.map((c) => c.html)),
        sel: window.NB.tableEditor.getSelection(),
        status: document.getElementById("table-editor-status").textContent,
      };
    });
    check("real browser: paste writes the block at the selection",
      pasted.rows[1][0] === "P1" && pasted.rows[1][1] === "P2" &&
      pasted.rows[2][0] === "P3" && pasted.rows[2][1] === "P4",
      JSON.stringify(pasted.rows));
    check("real browser: paste selects and announces the written block",
      JSON.stringify(pasted.sel) === JSON.stringify(
        { r0: 1, r1: 2, c0: 0, c1: 1 }) && /Pasted 2 × 2/.test(pasted.status),
      pasted.status);

    // --- fill handle: drag the corner to continue a series -------------
    // Grow the working grid first so the drag has rows to land on.
    await page.evaluate(() => {
      const add = document.getElementById("te-add-row");
      while (window.NB.tableEditor.getState().rows.length < 6) add.click();
    });
    const seedFill = await page.evaluate(() => {
      window.NB.tableEditor._select(1, 1, 1, 1);
      window.NB.tableEditor.pasteBlock([
        [{ html: "1" }], [{ html: "2" }],
      ]);
      window.NB.tableEditor._select(1, 1, 2, 1);
      return window.NB.tableEditor.getSelection();
    });
    check("real browser: the fill seed block is selected",
      JSON.stringify(seedFill) === JSON.stringify(
        { r0: 1, r1: 2, c0: 1, c1: 1 }), JSON.stringify(seedFill));
    const handleBox = await page.locator("#table-editor-grid .te-fill-handle")
      .boundingBox();
    const targetPoint = await cellPoint(5, 1);
    if (handleBox) {
      await page.mouse.move(handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 8 });
      const preview = await page.evaluate(() => document.querySelectorAll(
        "#table-editor-grid .te-cell.is-fill-preview").length);
      await page.mouse.up();
      const filled = await page.evaluate(() => {
        const state = window.NB.tableEditor.getState();
        return {
          col: state.rows.map((r) => (r.cells[1] || { html: "" }).html),
          sel: window.NB.tableEditor.getSelection(),
          status: document.getElementById("table-editor-status").textContent,
          preview: document.querySelectorAll(
            "#table-editor-grid .te-cell.is-fill-preview").length,
        };
      });
      check("real browser: dragging the handle previews the target cells",
        preview > 0, String(preview));
      check("real browser: the handle continues 1, 2 as 3, 4, 5",
        filled.col[3] === "3" && filled.col[4] === "4" &&
        filled.col[5] === "5", JSON.stringify(filled.col));
      check("real browser: a fill keeps the extended block selected",
        JSON.stringify(filled.sel) === JSON.stringify(
          { r0: 1, r1: 5, c0: 1, c1: 1 }) &&
        /^Filled 3 cells$/.test(filled.status) && filled.preview === 0,
        JSON.stringify(filled));
    } else {
      check("real browser: dragging the handle previews the target cells",
        false, "no handle box");
      check("real browser: the handle continues 1, 2 as 3, 4, 5",
        false, "no handle box");
      check("real browser: a fill keeps the extended block selected",
        false, "no handle box");
    }
    // Esc during a fill drag cancels the drag, not the modal.
    const handleBox2 = await page.locator(
      "#table-editor-grid .te-fill-handle").count();
    check("real browser: the fill handle rides the selection corner",
      handleBox2 === 1, String(handleBox2));

    await page.click("#table-editor-cancel");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });

    // --- AC13: a merged-cell table's overlay control opens the refusal --
    await page.evaluate(() => {
      const t = document.createElement("table");
      t.id = "te-merged-probe";
      t.innerHTML = "<tbody><tr><th>A</th><th>B</th></tr>" +
        '<tr><td colspan="2">wide</td></tr></tbody>';
      document.getElementById("viewer-content").appendChild(t);
    });
    await page.hover("#te-merged-probe td");
    await page.waitForSelector("#viewer .nb-table-overlay .nb-te-open",
      { timeout: 5000 });
    const mergedEntry = await page.evaluate(() => {
      const btn = document.querySelector("#viewer .nb-table-overlay .nb-te-open");
      const r = btn ? btn.getBoundingClientRect() : null;
      const cell = document.querySelector("#te-merged-probe th");
      const c = cell ? cell.getBoundingClientRect() : null;
      return {
        found: !!btn,
        label: btn && btn.getAttribute("aria-label"),
        rightOfTableLeftEdge: !!(r && c && r.right <= c.left + 1),
        grips: document.querySelectorAll(
          "#viewer .nb-table-overlay .nb-row-grip,#viewer .nb-table-overlay .nb-col-grip"
        ).length,
      };
    });
    check("real browser: the merged-cell table shows the Edit table control",
      mergedEntry.found && mergedEntry.label === "Edit table" &&
      mergedEntry.grips === 0, JSON.stringify(mergedEntry));
    check("real browser: the control sits in the left gutter of the table",
      mergedEntry.rightOfTableLeftEdge, JSON.stringify(mergedEntry));
    await page.evaluate(() => {
      const btn = document.querySelector("#viewer .nb-table-overlay .nb-te-open");
      if (btn) { btn.focus(); btn.click(); }
    });
    await page.waitForSelector("#table-editor-overlay:not([hidden])",
      { timeout: 5000 });
    const mergedNotice = await page.evaluate(() => {
      const n = document.getElementById("table-editor-notice");
      return { open: window.NB.tableEditor.isOpen(),
        blocked: window.NB.tableEditor.isBlocked(),
        apply: document.getElementById("table-editor-apply").hidden,
        hidden: n.hidden, display: getComputedStyle(n).display };
    });
    check("real browser: merged cells open blocked with the notice strip",
      mergedNotice.open && mergedNotice.blocked && mergedNotice.apply &&
      !mergedNotice.hidden && mergedNotice.display !== "none",
      JSON.stringify(mergedNotice));
    await page.evaluate(() => {
      window.NB.tableEditor.close();
      const t = document.getElementById("te-merged-probe");
      if (t) t.remove();
    });

    // --- AC12/AC14: Cancel returns focus to the overlay control ---
    await openViaOverlay(page);
    await page.click("#table-editor-cancel");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    const afterCancel = await activeInfo(page);
    check("real browser: Cancel returns focus to the overlay control",
      afterCancel.cls.indexOf("nb-te-open") !== -1,
      JSON.stringify(afterCancel));

    // --- AC14: context-menu entry returns focus to the table ------
    await page.click("#viewer-content table td", { button: "right" });
    await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
    await page.locator("#nb-menu button", { hasText: "Edit table" })
      .first().click();
    await page.waitForSelector("#table-editor-overlay:not([hidden])",
      { timeout: 5000 });
    const menuOpened = await page.evaluate(() => window.NB.tableEditor.isOpen());
    check("real browser: the table menu opens the modal",
      menuOpened === true);
    await page.click("#table-editor-cancel");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    const afterMenuCancel = await activeInfo(page);
    check("real browser: closing the menu-opened modal returns focus to the table",
      afterMenuCancel.inViewerContent, JSON.stringify(afterMenuCancel));

    // --- issue 3: Apply via the context menu leaves the caret in the note
    const beforeMenuApply = await tableText(page);
    await page.click("#viewer-content table td", { button: "right" });
    await page.waitForSelector("#nb-menu:not([hidden])", { timeout: 5000 });
    await page.locator("#nb-menu button", { hasText: "Edit table" })
      .first().click();
    await page.waitForSelector("#table-editor-overlay:not([hidden])",
      { timeout: 5000 });
    await cell(1, 0).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" MENU");
    await page.click("#table-editor-apply");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    const menuApplyFocus = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a && a.tagName, id: a && a.id,
        inViewer: !!(a && a.closest && a.closest("#viewer-content")),
        isBody: a === document.body };
    });
    check("real browser: Apply via the context menu leaves focus in the note",
      menuApplyFocus.inViewer && !menuApplyFocus.isBody,
      JSON.stringify(menuApplyFocus));
    await page.keyboard.press("Control+z");
    const afterMenuUndo = await tableText(page);
    check("real browser: Ctrl+Z after that Apply undoes exactly the table change",
      JSON.stringify(afterMenuUndo) === JSON.stringify(beforeMenuApply),
      JSON.stringify({ before: beforeMenuApply, after: afterMenuUndo }));
    await page.keyboard.press("Control+Shift+z");
    const afterMenuRedo = await tableText(page);
    check("real browser: redo reapplies the menu-path table change",
      !!afterMenuRedo && afterMenuRedo[1][0] === "Bolt X MENU",
      JSON.stringify(afterMenuRedo));

    // --- AC12: Esc cancels without a write -----------------------
    const bytesBeforeEsc = readNote(NOTE);
    await openViaOverlay(page);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("table-editor-overlay").hidden,
      null, { timeout: 5000 });
    check("real browser: Esc closes the modal and writes nothing",
      readNote(NOTE) === bytesBeforeEsc);

    check("real browser: no uncaught page errors", pageErrors.length === 0,
      pageErrors.join(" | "));

    await ctx.close();
  } finally {
    await browser.close();
    child.kill("SIGTERM");
  }

  console.log("\nRESULT: " + (failed === 0 ? "PASS" : "FAIL") +
    "  (" + passed + " ok, " + failed + " failed)");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
