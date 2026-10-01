/* table-select.js -- rectangular cell selection for rendered GFM tables.
 *
 * A platform modifier + drag (Ctrl on Windows/Linux, Cmd on macOS) over a
 * table inside #viewer-content paints an inclusive cell rectangle; Ctrl+C
 * copies it as TSV (text/plain) plus an HTML <table> (text/html). One
 * shared engine serves preview and hybrid edit modes -- the gesture and
 * every listener are identical in both; only the event-driven teardown
 * differs.
 *
 * The chord is owned at mousedown: a modifier+press on an eligible cell
 * arms and preventDefaults immediately, so the native text selection / DnD
 * / caret gesture never starts (the table-edit.js startCommon precedent).
 * No removeAllRanges(), no user-select:none -- nothing native ever began.
 *
 * The painted classes are transient gesture chrome, never content: hybrid.js
 * strips them in prepareTurndownClone, clears before every undo snapshot, and
 * drops the tokens from its change-hash. clear() is DOM-driven (it queries
 * the live DOM), so a class that reached the DOM by a wholesale innerHTML
 * replacement is still stripped.
 *
 * State machine: IDLE -> ARMED -> DRAGGING -> HELD -> IDLE. Eligible means
 * inside #viewer-content, not live preview, no merged cells, no open modal.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const RANGE_CLASS = "nb-ts-range";   // on each selected td/th
  const DRAG_CLASS = "nb-ts-drag";     // on the <table> during the drag only
  const DRAG_THRESHOLD_PX = 3;         // jitter guard before takeover
  const ARM_SELECTOR = "a, img";       // click-default swallow targets (1.3)

  // View-only classes owned by table-view.js: hidden rows/columns are skipped
  // by the rectangle, and the injected header menu icon is stripped from the
  // copied cell text.
  const HIDE_ROW_CLASS = "nb-tv-hide-row";
  const HIDE_COL_CLASS = "nb-tv-hide-col";
  const HEAD_MENU_CLASS = "nb-tv-head-menu";

  // Platform primary modifier for the arm. The local copy mirrors
  // shortcuts.js:73-80: shortcuts.js is not loaded yet when this module
  // builds its state, and it exports neither helper.
  function isMac() {
    const p = (navigator.platform || "").toLowerCase();
    if (p.includes("mac")) return true;
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      return /mac/i.test(navigator.userAgentData.platform);
    }
    return /mac/i.test(navigator.userAgent || "");
  }

  const mac = isMac();
  function armModifier(e) { return mac ? (e.metaKey && !e.ctrlKey) : e.ctrlKey; }

  // The modal guard shortcuts.js:244-246 and vimnav.js:48-50 already
  // duplicate: a third private copy follows the established pattern and
  // avoids a new shared dependency for one selector.
  function modalIsOpen() {
    return !!document.querySelector(
      ".settings-overlay:not([hidden]), #auth-overlay:not([hidden])");
  }

  let viewerEl = null;           // #viewer
  let viewerContentEl = null;    // #viewer-content
  let state = "IDLE";            // IDLE | ARMED | DRAGGING | HELD
  let tableEl = null;            // the rectangle's (or the armed) table
  let anchorCell = null;         // arming cell
  let focusCell = null;          // current pointer cell
  let lastX = 0, lastY = 0;      // threshold reference
  let armConsumed = false;       // this press armed (click-swallow flag, 1.3)
  let painted = new Set();       // cells currently carrying RANGE_CLASS

  /* --- small helpers ---------------------------------------------- */

  /* Collapse whitespace runs to one space and trim, the normText pattern
   * table-view.js:123-125 uses: it kills any residual tab/newline that would
   * corrupt the copied grid. */
  function normText(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function eligible(table) {
    if (!table || !viewerContentEl || !viewerContentEl.contains(table)) return false;
    // Live preview: the DOM is disposable and the textarea is the source of
    // truth. A missing table-view.js is treated as not-live; every other gate
    // still applies.
    if (NB.tableView && NB.tableView.lastRenderLive) return false;
    // Merged cells have no well-defined grid (section 9.1).
    if (NB.hybrid && NB.hybrid.tableHasSpans && NB.hybrid.tableHasSpans(table)) {
      return false;
    }
    return true;
  }

  function cellFromEvent(e) {
    const t = e.target;
    if (!t || !t.closest) return null;
    const cell = t.closest("td,th");
    if (!cell || !viewerContentEl || !viewerContentEl.contains(cell)) return null;
    return cell;
  }

  function visibleRows(table) {
    return Array.from(table.rows).filter((row) => !row.classList.contains(HIDE_ROW_CLASS));
  }

  /* The visible column indices, read from the first row: hideCols toggles the
   * class on every row, so any row is representative. */
  function visibleColumns(table) {
    const cols = [];
    const first = table.rows[0];
    if (!first) return cols;
    Array.from(first.cells).forEach((cell) => {
      if (!cell.classList.contains(HIDE_COL_CLASS)) cols.push(cell.cellIndex);
    });
    return cols;
  }

  function cellAt(row, colIndex) {
    return Array.from(row.cells).find((cell) => cell.cellIndex === colIndex) || null;
  }

  /* --- rectangle + payload ---------------------------------------- */

  /* The inclusive rectangle between anchor and focus among VISIBLE rows and
   * columns, in DOM order (which is the visible order after a table-view
   * sort). Null when the anchor is gone or the cells share no grid. */
  function computeRectangle() {
    if (!tableEl || !anchorCell || !focusCell) return null;
    if (!tableEl.contains(anchorCell) || !tableEl.contains(focusCell)) return null;
    const rows = visibleRows(tableEl);
    const cols = visibleColumns(tableEl);
    const rA = rows.indexOf(anchorCell.parentElement);
    const rF = rows.indexOf(focusCell.parentElement);
    const cA = cols.indexOf(anchorCell.cellIndex);
    const cF = cols.indexOf(focusCell.cellIndex);
    if (rA < 0 || rF < 0 || cA < 0 || cF < 0) return null;
    return {
      table: tableEl,
      r0: Math.min(rA, rF), r1: Math.max(rA, rF),
      c0: Math.min(cA, cF), c1: Math.max(cA, cF),
    };
  }

  /* Cell text with view chrome stripped and <br>/<img> expanded: textContent
   * alone would leak the header chevron and collapse "foo<br>bar" to
   * "foobar". */
  function cellText(cell) {
    const clone = cell.cloneNode(true);
    clone.querySelectorAll("." + HEAD_MENU_CLASS).forEach((n) => n.remove());
    clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
    clone.querySelectorAll("img").forEach((img) => img.replaceWith(img.alt || ""));
    return normText(clone.textContent);
  }

  /* { tsv, html } for the active rectangle, or null. TSV is cells joined with
   * tabs and rows with newlines; the HTML is a real detached DOM tree, so
   * there is no manual escaping to get wrong. Both flavors carry the same
   * plain text. */
  function getPayload() {
    if (state !== "DRAGGING" && state !== "HELD") return null;
    const rect = computeRectangle();
    if (!rect) return null;
    const rows = visibleRows(rect.table);
    const cols = visibleColumns(rect.table);
    const lines = [];
    const table = document.createElement("table");
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row = rows[r];
      const tr = document.createElement("tr");
      const texts = [];
      for (let c = rect.c0; c <= rect.c1; c++) {
        const cell = row ? cellAt(row, cols[c]) : null;
        const text = cell ? cellText(cell) : "";
        texts.push(text);
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      lines.push(texts.join("\t"));
      table.appendChild(tr);
    }
    return { tsv: lines.join("\n"), html: table.outerHTML };
  }

  /* --- painting / clearing ---------------------------------------- */

  function paint() {
    const rect = computeRectangle();
    if (!rect) return;
    const rows = visibleRows(rect.table);
    const cols = visibleColumns(rect.table);
    const next = new Set();
    for (let r = rect.r0; r <= rect.r1; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = rect.c0; c <= rect.c1; c++) {
        const cell = cellAt(row, cols[c]);
        if (cell) next.add(cell);
      }
    }
    // Toggle only the changed cells, the churn discipline of hybrid.js's
    // onSelectionChange.
    painted.forEach((cell) => { if (!next.has(cell)) cell.classList.remove(RANGE_CLASS); });
    next.forEach((cell) => { if (!painted.has(cell)) cell.classList.add(RANGE_CLASS); });
    painted = next;
  }

  /* DOM-driven: strip every class the engine owns from the live DOM, then
   * reset state. Idempotent; cannot miss a class that reached the DOM by a
   * path other than painting. */
  function clear() {
    if (viewerContentEl) {
      viewerContentEl.querySelectorAll("." + RANGE_CLASS)
        .forEach((n) => n.classList.remove(RANGE_CLASS));
      viewerContentEl.querySelectorAll("." + DRAG_CLASS)
        .forEach((n) => n.classList.remove(DRAG_CLASS));
    }
    painted = new Set();
    state = "IDLE";
    tableEl = null;
    anchorCell = null;
    focusCell = null;
  }

  function isActive() {
    if (state !== "DRAGGING" && state !== "HELD") return false;
    // A wholesale innerHTML replacement can leave the anchor detached; a
    // stale rectangle must never be copied.
    if (!anchorCell || !anchorCell.isConnected ||
        !viewerContentEl || !viewerContentEl.contains(anchorCell)) {
      clear();
      return false;
    }
    return true;
  }

  function getRectangle() {
    if (!isActive()) return null;
    return computeRectangle();
  }

  /* --- lifecycle hooks -------------------------------------------- */

  function onRendered() { clear(); }

  function tearDownForEdit() { clear(); }

  /* --- event handlers --------------------------------------------- */

  /* Row 1: a new press always supersedes a held/dragging rectangle. Bound in
   * the capture phase so it runs before the arming listener below. */
  function _onDocMouseDown() {
    if (state === "HELD" || state === "DRAGGING") clear();
  }

  /* Row 2: arm on modifier+mousedown over an eligible cell, and suppress the
   * native selection / DnD / caret gesture. */
  function _onMouseDown(e) {
    // HELD/DRAGGING were already cleared by the capture listener; a second
    // press mid-ARM is ignored outright so it cannot corrupt the gesture.
    if (state !== "IDLE") return;
    // A fresh IDLE press supersedes the previous press's click-swallow flag
    // and drops the stale table pointer, so row 7 can never resolve the
    // wrong table.
    armConsumed = false;
    tableEl = null;
    if (modalIsOpen()) return;
    if (e.button !== 0) return;          // primary button only
    if (!armModifier(e)) return;
    if (!viewerEl || viewerEl.hidden) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    const table = cell.closest("table");
    if (!eligible(table)) return;
    state = "ARMED";
    tableEl = table;
    anchorCell = cell;
    focusCell = cell;
    lastX = e.clientX;
    lastY = e.clientY;
    armConsumed = true;
    e.preventDefault();
  }

  /* Rows 3-4: takeover on the first cross into another cell, then repaint. */
  function _onMouseMove(e) {
    if (state === "ARMED") {
      if (Math.abs(e.clientX - lastX) < DRAG_THRESHOLD_PX &&
          Math.abs(e.clientY - lastY) < DRAG_THRESHOLD_PX) return;
      const cell = cellFromEvent(e);
      if (!cell || !tableEl || cell.closest("table") !== tableEl) return;
      if (cell === anchorCell) return;
      state = "DRAGGING";
      tableEl.classList.add(DRAG_CLASS);
      focusCell = cell;
      paint();
      return;
    }
    if (state === "DRAGGING") {
      const cell = cellFromEvent(e);
      if (!cell || !tableEl || cell.closest("table") !== tableEl) return;
      focusCell = cell;
      paint();
    }
  }

  /* Rows 5-6: end the drag (HELD) or a no-takeover arm (IDLE). tableEl is
   * kept on the IDLE path so row 7 can still resolve the armed table. */
  function _onMouseUp() {
    if (state === "DRAGGING") {
      if (tableEl) tableEl.classList.remove(DRAG_CLASS);
      state = "HELD";
    } else if (state === "ARMED") {
      state = "IDLE";
    }
  }

  /* Row 16: finalize a drag cut short by window blur. An ARMED press that
   * never saw its mouseup (release outside the window, Alt-Tab) is dropped
   * outright -- otherwise the next hover would take over with no button
   * down and the next mousedown would be ignored as a mid-gesture press. */
  function _onBlur() {
    if (state === "DRAGGING") {
      if (tableEl) tableEl.classList.remove(DRAG_CLASS);
      state = "HELD";
    } else if (state === "ARMED") {
      clear();
    }
  }

  /* Row 7: a modifier+click on a link/image must not navigate, so swallow the
   * click default for the press that armed. Plain clicks never match. */
  function _onClick(e) {
    if (!armConsumed) return;
    const t = e.target;
    if (!t || !t.closest) return;
    const hit = t.closest(ARM_SELECTOR);
    if (!hit) return;
    if (!tableEl || !tableEl.contains(hit)) return;
    e.preventDefault();
    armConsumed = false;                 // swallow once, not for later clicks
  }

  /* Row 8: belt for the arm-time cancel -- no DnD may start mid-gesture. */
  function _onDragStart(e) {
    if (state === "ARMED" || state === "DRAGGING") {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /* Row 9: Esc cancels a drag or clears a held rectangle, unless a modal owns
   * the key. preventDefault only -- never stopPropagation. */
  function _onKey(e) {
    if (e.key !== "Escape") return;
    if (state !== "ARMED" && state !== "HELD" && state !== "DRAGGING") return;
    if (modalIsOpen()) return;
    clear();
    e.preventDefault();
  }

  /* Row 10: override the copy only for an active rectangle, and compute the
   * payload before preventDefault so a failure leaves the native copy intact. */
  function _onCopy(e) {
    if (!isActive()) return;
    if (modalIsOpen()) return;
    const payload = getPayload();
    if (!payload) return;
    if (!e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", payload.tsv);
    e.clipboardData.setData("text/html", payload.html);
  }

  /* Row 11: typing invalidates the rectangle. */
  function _onInput() {
    if (state === "HELD" || state === "DRAGGING") clear();
  }

  /* --- build / wire ------------------------------------------------ */

  function build() {
    viewerEl = document.getElementById("viewer");
    viewerContentEl = document.getElementById("viewer-content");
    if (!viewerContentEl) return;
    viewerContentEl.addEventListener("mousedown", _onMouseDown);
    viewerContentEl.addEventListener("input", _onInput);
    document.addEventListener("mousedown", _onDocMouseDown, true);
    document.addEventListener("mousemove", _onMouseMove);
    document.addEventListener("mouseup", _onMouseUp);
    document.addEventListener("click", _onClick, true);
    document.addEventListener("dragstart", _onDragStart, true);
    document.addEventListener("copy", _onCopy, true);
    document.addEventListener("keydown", _onKey, true);
    window.addEventListener("blur", _onBlur);
    NB.evt.on("viewer:rendered", onRendered);
    NB.evt.on("hybrid:will-enter", tearDownForEdit);
    NB.evt.on("hybrid:entered", tearDownForEdit);
    NB.evt.on("hybrid:exited", clear);
    NB.evt.on("file:external-change", clear);
  }

  build();

  NB.tableSelect = {
    /* Cancel a drag, strip every class from the live DOM, reset state.
     * Idempotent; DOM-driven (4.6). */
    clear,

    /* True while a rectangle is painted (DRAGGING or HELD) and its anchor
     * is still connected inside #viewer-content (stale-state guard, 8.4). */
    isActive,

    /* { table, r0, r1, c0, c1 } of the painted rectangle, or null.
     * Indices are positions among VISIBLE rows/columns. */
    getRectangle,

    /* { tsv, html } for the active rectangle, or null. Test seam; the
     * copy handler is its only in-app caller. */
    getPayload,

    /* viewer:rendered hook: any render (live or real) clears. */
    onRendered,

    /* hybrid:will-enter / hybrid:entered hook: synchronous teardown. */
    tearDownForEdit,

    /* Test seams (build() wires the real listeners to these). */
    _onMouseDown, _onMouseMove, _onMouseUp,
    _onCopy, _onKey, _onClick, _onDragStart,
  };
})();
