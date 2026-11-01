/* table-editor.js -- spreadsheet-style modal editor for one GFM table in
 * hybrid (WYSIWYG) mode.
 *
 * The modal shows a grid whose row 0 is the table header. Cells hold the
 * live surface's rendered inline HTML verbatim, so bold/italic/code/links
 * survive Apply. The model is a rectangular snapshot of the table; ragged
 * rows are padded at open time as a display convenience (padding alone is
 * never written -- an untouched Apply compares equal and closes without a
 * write, so the original bytes stay intact).
 *
 * Apply rebuilds a <table> with one <tbody> (row 0 = th, body rows = td)
 * and writes the editor's alignment state (`:--`, `:-:`, `--:`), so a
 * column whose source delimiter was a plain `---` becomes `:--` once the
 * table is edited. It then replaces the source table through the hybrid
 * write path: flushPendingSnapshot() first, replaceWith(), then
 * onContentChange(). That ordering is the whole undo contract: the
 * pre-edit state is one snapshot and the replacement is the next change.
 * Nothing is written by Cancel, Esc, the header x, or the backdrop, and a
 * no-op Apply writes nothing and adds no undo entry.
 *
 * The overlay is static markup in index.html and carries .settings-overlay,
 * so NB.dialog owns focus containment and NB.windows owns drag/resize.
 * Entry points (the hybrid Table submenu and table-edit.js's overlay
 * button) call open(); merged-cell tables open in a refused, read-only
 * state because GFM cannot represent spans.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const ALIGN_CYCLE = { left: "center", center: "right", right: "left" };

  // Sort collation mirrors the design: numeric-aware for text, explicit
  // stability. Empty keys are partitioned out so they stay last both ways.
  const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  const DRAG_SLOP = 4;         // px a cell press may move before it paints
  const LONG_PRESS_MS = 500;   // touch: hold this long to start a range

  const GRIP_DOTS =
    '<svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">' +
    '<g fill="currentColor">' +
    '<circle cx="2" cy="2" r="1.1"/><circle cx="6" cy="2" r="1.1"/>' +
    '<circle cx="2" cy="6" r="1.1"/><circle cx="6" cy="6" r="1.1"/>' +
    '<circle cx="2" cy="10" r="1.1"/><circle cx="6" cy="10" r="1.1"/>' +
    '</g></svg>';

  let overlayEl = null;
  let gridEl = null;
  let noticeEl = null;
  let statusEl = null;
  let sortColEl = null;
  let sortDirEl = null;
  let applyBtn = null;
  let cancelBtn = null;

  let originalTable = null;
  let viewerContentEl = null;
  let state = null;          // { cols, rows: [{cells:[{html,align}]}], changed }
  let readOnly = false;      // merged-cell refusal
  let editing = false;       // the active cell's .te-cell-text is contenteditable
  let activeRow = 0;           // the focus corner; the cell with the ring
  let activeCol = 0;
  let anchorRow = 0;           // the corner that stays put while extending
  let anchorCol = 0;
  let sortedCol = -1;
  let sortedDir = "asc";

  /* --- DOM lookups -------------------------------------------------- */

  function byId(id) { return document.getElementById(id); }

  function cellAt(row, col) {
    if (!gridEl) return null;
    return gridEl.querySelector(
      '.te-cell[data-row="' + row + '"][data-col="' + col + '"]'
    );
  }

  function activeCell() { return cellAt(activeRow, activeCol); }

  /* --- selection model ---------------------------------------------- */
  /* A rectangle between the anchor corner and the focus corner. The
   * focus corner is the active cell: it carries the ring and the DOM
   * focus, so every existing "focused cell" verb keeps working. */

  function selRect() {
    return {
      r0: Math.min(anchorRow, activeRow), r1: Math.max(anchorRow, activeRow),
      c0: Math.min(anchorCol, activeCol), c1: Math.max(anchorCol, activeCol),
    };
  }

  function selectionSize() {
    const r = selRect();
    return { rows: r.r1 - r.r0 + 1, cols: r.c1 - r.c0 + 1, rect: r };
  }

  function isMulti() {
    const size = selectionSize();
    return size.rows > 1 || size.cols > 1;
  }

  function collapseSelection() {
    anchorRow = activeRow;
    anchorCol = activeCol;
  }

  function paintSelection() {
    if (!gridEl || !state || readOnly) return;
    const r = selRect();
    gridEl.querySelectorAll(".te-cell").forEach((td) => {
      const row = Number(td.getAttribute("data-row"));
      const col = Number(td.getAttribute("data-col"));
      const on = row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
      td.classList.toggle("is-selected", on);
      td.setAttribute("aria-selected", on ? "true" : "false");
      td.classList.toggle("is-sel-top", on && row === r.r0);
      td.classList.toggle("is-sel-bottom", on && row === r.r1);
      td.classList.toggle("is-sel-left", on && col === r.c0);
      td.classList.toggle("is-sel-right", on && col === r.c1);
    });
  }

  /* --- model snapshot ----------------------------------------------- */

  function snapshotTable(table) {
    const trs = Array.from(table.rows);
    let cols = 0;
    trs.forEach((tr) => { cols = Math.max(cols, tr.cells.length); });
    cols = Math.max(1, cols);
    const rows = trs.map((tr, ri) => {
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const cell = tr.cells[c];
        if (cell) {
          cells.push({
            html: cell.innerHTML,
            align: cell.getAttribute("align"),
          });
        } else {
          cells.push({ html: "", align: null });
        }
      }
      return { cells };
    });
    return { cols, rows, changed: false };
  }

  function htmlToText(html) {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.textContent || "";
  }

  /* --- grid rendering ----------------------------------------------- */

  function setGridAttrs() {
    gridEl.setAttribute("role", "grid");
    gridEl.setAttribute("aria-label", "Table cells");
    gridEl.setAttribute("aria-rowcount", String(state.rows.length));
    gridEl.setAttribute("aria-colcount", String(state.cols));
    gridEl.setAttribute("aria-readonly", readOnly ? "true" : "false");
    if (readOnly) gridEl.removeAttribute("aria-multiselectable");
    else gridEl.setAttribute("aria-multiselectable", "true");
  }

  /* Drag handles are the pointer path for reordering; the Move buttons
   * are the keyboard path. They live inside the cell (never inside
   * .te-cell-text), so the model's cell HTML never sees them. */
  function makeGrip(ri, ci) {
    const isCol = ri === 0;
    if (!isCol && ci !== 0) return null;   // one row grip per row, in cell 0
    const grip = document.createElement("span");
    grip.className = isCol ? "te-col-grip" : "te-row-grip";
    grip.setAttribute("aria-hidden", "true");
    if (isCol) grip.setAttribute("data-drag-col", String(ci));
    else grip.setAttribute("data-drag-row", String(ri));
    grip.innerHTML = GRIP_DOTS;
    return grip;
  }

  function renderGrid() {
    if (!gridEl || !state) return;
    gridEl.textContent = "";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");

    state.rows.forEach((row, ri) => {
      const tr = document.createElement("tr");
      tr.setAttribute("role", "row");
      tr.setAttribute("data-row", String(ri));
      row.cells.forEach((cell, ci) => {
        const td = document.createElement(ri === 0 ? "th" : "td");
        td.className = "te-cell";
        td.setAttribute("data-row", String(ri));
        td.setAttribute("data-col", String(ci));
        if (!readOnly) {
          td.setAttribute("aria-rowindex", String(ri + 1));
          td.setAttribute("aria-colindex", String(ci + 1));
        }
        if (ri === 0) {
          td.setAttribute("role", "columnheader");
          td.setAttribute("scope", "col");
        } else {
          td.setAttribute("role", "gridcell");
        }
        const isActive = !readOnly && ri === activeRow && ci === activeCol;
        if (isActive) td.classList.add("is-active");
        td.tabIndex = readOnly ? -1 : (isActive ? 0 : -1);
        if (cell.align != null) td.setAttribute("align", cell.align);
        if (ri === 0 && ci === sortedCol && !readOnly) {
          td.setAttribute("aria-sort", sortedDir === "asc" ? "ascending" : "descending");
          td.setAttribute("data-sort", sortedDir);
        }
        const span = document.createElement("span");
        span.className = "te-cell-text";
        span.innerHTML = cell.html;
        td.appendChild(span);
        if (!readOnly) {
          const grip = makeGrip(ri, ci);
          if (grip) td.appendChild(grip);
        }
        tr.appendChild(td);
      });
      (ri === 0 ? thead : tbody).appendChild(tr);
    });

    if (thead.children.length) gridEl.appendChild(thead);
    if (tbody.children.length) gridEl.appendChild(tbody);
    setGridAttrs();
    paintSelection();
  }

  /* Repaint only the active-cell ring / roving tabindex, so a move never
   * rebuilds the editable DOM (and never disturbs the caret). */
  function paintActive() {
    if (!gridEl || readOnly) return;
    gridEl.querySelectorAll(".te-cell").forEach((td) => {
      const on = Number(td.getAttribute("data-row")) === activeRow &&
        Number(td.getAttribute("data-col")) === activeCol;
      td.classList.toggle("is-active", on);
      td.tabIndex = on ? 0 : -1;
    });
  }

  /* --- caret helpers ------------------------------------------------ */

  function placeCaretAtEnd(span) {
    if (!span) return;
    const range = document.createRange();
    range.selectNodeContents(span);
    range.collapse(false);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCaretAtPoint(span, x, y) {
    if (!span) return;
    const sel = window.getSelection();
    if (!sel) return;
    const inside = (node) => node === span || span.contains(node);
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range && inside(range.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos && inside(pos.offsetNode)) {
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    // A click in the cell's padding must not drop the caret outside the
    // editable span (text typed there would never reach the model).
    placeCaretAtEnd(span);
  }

  function scrollCellIntoView(td) {
    if (td && typeof td.scrollIntoView === "function") {
      td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /* --- editing state ------------------------------------------------ */

  function syncCellFromDom(row, col) {
    const td = cellAt(row, col);
    const span = td && td.querySelector(".te-cell-text");
    if (!span || !state.rows[row] || !state.rows[row].cells[col]) return;
    state.rows[row].cells[col].html = span.innerHTML;
  }

  function commitEdit() {
    if (!editing) return;
    const td = activeCell();
    if (td) {
      syncCellFromDom(activeRow, activeCol);
      const span = td.querySelector(".te-cell-text");
      if (span) span.removeAttribute("contenteditable");
    }
    editing = false;
  }

  function startEdit(row, col, opts) {
    if (readOnly) return;
    opts = opts || {};
    if (editing) {
      if (row === activeRow && col === activeCol) return;
      commitEdit();
    }
    setActive(row, col);
    collapseSelection();
    paintSelection();
    const td = activeCell();
    if (!td) return;
    const span = td.querySelector(".te-cell-text");
    if (!span) return;

    editing = true;
    span.setAttribute("contenteditable", "true");
    if (opts.insertText) {
      span.appendChild(document.createTextNode(opts.insertText));
      syncCellFromDom(row, col);
      state.changed = true;
    }
    span.focus({ preventScroll: true });
    if (opts.point) placeCaretAtPoint(span, opts.point.x, opts.point.y);
    else placeCaretAtEnd(span);
    updateStatus();
  }

  function setActive(row, col) {
    activeRow = clamp(row, 0, Math.max(0, state.rows.length - 1));
    activeCol = clamp(col, 0, Math.max(0, state.cols - 1));
    paintActive();
    paintSelection();
    scrollCellIntoView(activeCell());
    if (!press) updateStatus();   // a live drag announces once, on pointerup
    syncToolbar();
  }

  /* Move the focus corner. `extend` keeps the anchor (Shift+arrow and the
   * paste result); otherwise the selection collapses onto the new cell. */
  function focusCell(row, col, extend) {
    if (readOnly) return;
    setActive(row, col);
    if (!extend) collapseSelection();
    paintSelection();
    const td = activeCell();
    if (td) td.focus({ preventScroll: true });
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  function focusableControls(scope) {
    if (!scope) return [];
    return Array.from(
      scope.querySelectorAll("button, [href], input, select, textarea")
    ).filter((node) => !node.disabled && !node.hidden &&
      node.getAttribute("aria-disabled") !== "true");
  }

  /* Tab at the grid's outer edge leaves the grid on purpose. Put focus on
    * the first footer / last toolbar control explicitly; letting Chromium
    * blur from the last tabbable cell lands on <body>. */
  function focusOutsideGrid(dir) {
    const scope = dir > 0
      ? overlayEl.querySelector(".te-footer")
      : overlayEl.querySelector(".te-toolbar");
    const items = focusableControls(scope);
    if (!items.length) return false;
    const node = dir > 0 ? items[0] : items[items.length - 1];
    node.focus({ preventScroll: true });
    return true;
  }

  /* --- keyboard ----------------------------------------------------- */

  /* Tab moves one column and stops at the row edge (no wrap). At the
   * grid's final cell Tab is allowed to leave to the footer; at the very
   * first cell Shift+Tab leaves to the toolbar. Inside the grid it is
   * swallowed so focus never jumps rows. */
  function tabDestination(dir) {
    const next = activeCol + dir;
    if (next >= 0 && next < state.cols) return { row: activeRow, col: next };
    const leaves = dir > 0
      ? activeRow === state.rows.length - 1
      : activeRow === 0;
    return leaves ? null : { stop: true };
  }

  function onGridKeydown(e) {
    if (readOnly) return;
    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    const row = Number(td.getAttribute("data-row"));
    const col = Number(td.getAttribute("data-col"));
    const inEdit = editing && row === activeRow && col === activeCol;

    if (inEdit) {
      if (e.key === "Tab") {
        const dir = e.shiftKey ? -1 : 1;
        const dest = tabDestination(dir);
        commitEdit();
        if (dest) {
          e.preventDefault();
          e.stopPropagation();
          if (dest.stop) focusCell(activeRow, activeCol);
          else focusCell(dest.row, dest.col);
        } else if (focusOutsideGrid(dir)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitEdit();
        const next = activeRow + 1;
        if (next < state.rows.length) focusCell(next, activeCol);
        else focusCell(activeRow, activeCol);
        return;
      }
      // F2 toggles out of text edit without moving the cell, so a pointer
      // user can stop typing and then drag a range from that same cell.
      if (e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        commitEdit();
        focusCell(activeRow, activeCol);
        return;
      }
      // Arrows move the caret natively while editing; Esc is handled at
      // the overlay so it reaches Cancel from either state.
      return;
    }

    // IME composition starts with key "Process" / keyCode 229. Enter
    // edit mode so CJK input works without Enter/F2; do not cancel the
    // keydown, or the composition never starts.
    if (e.key === "Process" || e.keyCode === 229) {
      e.stopPropagation();
      startEdit(row, col);
      return;
    }

    switch (e.key) {
      case "Tab": {
        const dir = e.shiftKey ? -1 : 1;
        const dest = tabDestination(dir);
        if (dest) {
          e.preventDefault();
          e.stopPropagation();
          if (dest.stop) focusCell(activeRow, activeCol);
          else focusCell(dest.row, dest.col);
        } else if (focusOutsideGrid(dir)) {
          e.preventDefault();
          e.stopPropagation();
        }
        break;
      }
      case "Enter":
      case "F2":
        e.preventDefault();
        e.stopPropagation();
        startEdit(row, col);
        break;
      case "Escape":
        if (isMulti()) {
          e.preventDefault();
          e.stopPropagation();
          collapseSelection();
          paintSelection();
          updateStatus();
        }
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        e.stopPropagation();
        const step = {
          ArrowLeft: [0, -1], ArrowRight: [0, 1],
          ArrowUp: [-1, 0], ArrowDown: [1, 0],
        }[e.key];
        focusCell(activeRow + step[0], activeCol + step[1], e.shiftKey);
        break;
      }
      case "Home":
      case "End": {
        e.preventDefault();
        e.stopPropagation();
        const last = state.cols - 1;
        focusCell(activeRow, e.key === "Home" ? 0 : last, e.shiftKey);
        break;
      }
      case " ":
        e.preventDefault();
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
          anchorRow = 0;
          anchorCol = activeCol;
          focusCell(state.rows.length - 1, activeCol, true);
        } else if (e.shiftKey) {
          anchorRow = activeRow;
          anchorCol = 0;
          focusCell(activeRow, state.cols - 1, true);
        }
        break;
      case "a":
      case "A":
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          anchorRow = 0;
          anchorCol = 0;
          focusCell(state.rows.length - 1, state.cols - 1, true);
        }
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
        break;
      default:
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey &&
            !e.altKey && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          startEdit(row, col, { insertText: e.key });
        }
    }
  }

  function onOverlayKeydown(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }

  /* --- grid pointer / input ---------------------------------------- */

  /* A cell press is handled by the pointer path; this only stops the
   * browser's own text selection from starting in navigate mode. */
  function onGridMousedown(e) {
    if (readOnly || e.button !== 0) return;
    if (e.target.closest && e.target.closest(".te-row-grip,.te-col-grip")) return;
    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    if (editing && Number(td.getAttribute("data-row")) === activeRow &&
        Number(td.getAttribute("data-col")) === activeCol) return;
    e.preventDefault();
  }

  function onGridInput(e) {
    if (readOnly) return;
    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    const row = Number(td.getAttribute("data-row"));
    const col = Number(td.getAttribute("data-col"));
    syncCellFromDom(row, col);
    state.changed = true;
    if (row === 0) rebuildSortOptions(sortColEl.value);
  }

  function onGridFocusOut(e) {
    if (!editing) return;
    if (!e.target.classList || !e.target.classList.contains("te-cell-text")) return;
    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    // A move to another cell is committed by startEdit; guard so a stale
    // focusout for the previous cell cannot commit the new one.
    if (Number(td.getAttribute("data-row")) !== activeRow ||
        Number(td.getAttribute("data-col")) !== activeCol) return;
    commitEdit();
  }

  /* --- clipboard ---------------------------------------------------- */
  /* Copy/cut/paste work on the selection rectangle. The grid stores cell
   * HTML; the clipboard carries TSV plus an HTML table, and pasted HTML
   * is reduced to the inline subset before it reaches the model, so the
   * note can still never receive HTML. */

  const INLINE_TAGS = { STRONG: true, B: true, EM: true, I: true,
    CODE: true, A: true };
  const DROP_WITH_TEXT = { SCRIPT: true, STYLE: true, NOSCRIPT: true,
    TEMPLATE: true };
  const CLIPBOARD_BLOCKED =
    "Clipboard is unavailable: this table has merged cells.";

  const textNode = (text) => document.createTextNode(text);

  function cleanInline(node) {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }
      const tag = child.tagName;
      if (DROP_WITH_TEXT[tag]) { child.remove(); return; }
      cleanInline(child);
      if (tag === "BR") { child.replaceWith(textNode(" ")); return; }
      if (!INLINE_TAGS[tag]) {
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        return;
      }
      const href = tag === "A" ? child.getAttribute("href") : null;
      Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
      if (href != null) child.setAttribute("href", href);
    });
  }

  /* Inline subset only: strong/b, em/i, code, a[href]. Block markup is
   * unwrapped to its text, script/style are dropped with their text, and
   * a line break becomes one space (GFM has no in-row break). */
  function sanitizeInline(html) {
    const host = document.createElement("div");
    host.innerHTML = html || "";
    cleanInline(host);
    return host.innerHTML.replace(/[\r\n]+/g, " ");
  }

  function cellText(html) {
    return htmlToText(html).replace(/[\t\r\n]+/g, " ");
  }

  function padBlock(rows) {
    const width = rows.reduce((m, row) => Math.max(m, row.length), 0);
    rows.forEach((row) => {
      while (row.length < width) row.push({ html: "" });
    });
    return rows;
  }

  function blockFromHtml(markup) {
    const host = document.createElement("div");
    host.innerHTML = markup || "";
    const table = host.querySelector("table");
    if (!table) return null;
    const rows = Array.from(table.rows).map((tr) =>
      Array.from(tr.cells).map((cell) => ({
        html: sanitizeInline(cell.innerHTML),
      })));
    while (rows.length && rows[rows.length - 1].every((c) => c.html === "")) {
      rows.pop();
    }
    return rows.length ? padBlock(rows) : null;
  }

  function blockFromText(text) {
    let t = text.replace(/\r\n?/g, "\n");
    if (t.indexOf("\t") === -1 && t.indexOf("\n") === -1) {
      return [[{ html: sanitizeInline(cellHtmlFromText(t)) }]];
    }
    const lines = t.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return padBlock(lines.map((line) =>
      line.split("\t").map((field) => ({
        html: sanitizeInline(cellHtmlFromText(field)),
      }))));
  }

  function cellHtmlFromText(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span.innerHTML;
  }

  function parseClipboard(data) {
    if (!data) return null;
    const html = data.getData("text/html");
    if (html) {
      const block = blockFromHtml(html);
      if (block) return block;
    }
    const text = data.getData("text/plain");
    if (text) return blockFromText(text);
    if (html) return blockFromText(htmlToText(html));
    return null;
  }

  function selectionPayload() {
    const r = selRect();
    const lines = [];
    const head = [];
    const body = [];
    for (let row = r.r0; row <= r.r1; row++) {
      const fields = [];
      const cellsHtml = [];
      for (let col = r.c0; col <= r.c1; col++) {
        const cell = state.rows[row] && state.rows[row].cells[col];
        const html = cell ? cell.html : "";
        fields.push(cellText(html));
        const tag = row === 0 ? "th" : "td";
        cellsHtml.push("<" + tag + ">" + sanitizeInline(html) + "</" + tag + ">");
      }
      lines.push(fields.join("\t"));
      const rowHtml = "<tr>" + cellsHtml.join("") + "</tr>";
      (row === 0 ? head : body).push(rowHtml);
    }
    let html = "<table>";
    if (head.length) html += "<thead>" + head.join("") + "</thead>";
    if (body.length) html += "<tbody>" + body.join("") + "</tbody>";
    html += "</table>";
    return { text: lines.join("\n"), html };
  }

  function sizeLabel(rect) {
    return (rect.r1 - rect.r0 + 1) + " × " + (rect.c1 - rect.c0 + 1);
  }

  /* Paste a parsed block at the selection's top-left. Growth is only at
   * the bottom and the right, so the header and the minimums survive. */
  function pasteBlock(block) {
    if (readOnly || !state || !block || !block.length) return false;
    commitEdit();
    const size = selectionSize();
    const r0 = size.rect.r0;
    const c0 = size.rect.c0;
    const h = block.length;
    const w = block.reduce((m, row) => Math.max(m, row.length), 0);
    if (!h || !w) return false;
    const single = h === 1 && w === 1;
    const height = single ? size.rows : h;
    const width = single ? size.cols : w;

    while (r0 + height > state.rows.length) state.rows.push(emptyRow());
    while (c0 + width > state.cols) {
      state.rows.forEach((row) => {
        row.cells.push({ html: "&nbsp;", align: "left" });
      });
      state.cols += 1;
    }

    let changed = false;
    for (let dr = 0; dr < height; dr++) {
      for (let dc = 0; dc < width; dc++) {
        const src = single ? block[0][0]
                           : (block[dr] && block[dr][dc]) || { html: "" };
        const cell = state.rows[r0 + dr] && state.rows[r0 + dr].cells[c0 + dc];
        if (!cell) continue;
        if (cell.html !== src.html) { cell.html = src.html; changed = true; }
      }
    }
    if (changed) markChanged();
    anchorRow = r0 + height - 1;
    anchorCol = c0 + width - 1;
    activeRow = r0;
    activeCol = c0;
    finishStructure(true);
    setStatusMessage(single
      ? "Pasted 1 cell into " + (height * width) + " cells"
      : "Pasted " + height + " × " + width);
    return true;
  }

  function clearSelection() {
    if (readOnly || !state) return false;
    commitEdit();
    const r = selRect();
    let changed = false;
    for (let row = r.r0; row <= r.r1; row++) {
      for (let col = r.c0; col <= r.c1; col++) {
        const cell = state.rows[row] && state.rows[row].cells[col];
        if (cell && cell.html !== "") { cell.html = ""; changed = true; }
      }
    }
    if (changed) markChanged();
    finishStructure(true);
    setStatusMessage(changed ? "Cleared " + sizeLabel(r) : "Nothing to clear");
    return changed;
  }

  /* In the merged-cell state the control stays focusable and inert, and
   * activating it explains why. */
  function withClipboard(fn) {
    if (readOnly) { setStatusMessage(CLIPBOARD_BLOCKED); return; }
    fn();
  }

  function copyToClipboard() {
    if (readOnly || !state) return false;
    const payload = selectionPayload();
    const size = selectionSize();
    const label = size.rows === 1 && size.cols === 1
      ? "Copied 1 cell" : "Copied " + sizeLabel(size.rect);
    const done = () => setStatusMessage(label);
    const fallback = () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload.text).then(
          () => setStatusMessage(label + " as text"),
          () => setStatusMessage("Press Ctrl+C to copy"));
        return;
      }
      setStatusMessage("Press Ctrl+C to copy");
    };
    try {
      if (window.ClipboardItem && navigator.clipboard &&
          navigator.clipboard.write && window.isSecureContext) {
        const item = new window.ClipboardItem({
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
          "text/html": new Blob([payload.html], { type: "text/html" }),
        });
        navigator.clipboard.write([item]).then(done, fallback);
        return true;
      }
    } catch (_) { /* fall through to the text-only path */ }
    fallback();
    return true;
  }

  function pasteFromClipboard() {
    if (readOnly || !state) return;
    if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
      navigator.clipboard.readText().then((text) => {
        const block = text ? blockFromText(text) : null;
        if (!block) setStatusMessage("Nothing to paste");
        else pasteBlock(block);
      }, () => setStatusMessage("Press Ctrl+V to paste"));
      return;
    }
    setStatusMessage("Press Ctrl+V to paste");
  }

  function onGridCopy(e) {
    if (readOnly || editing) return;    // edit mode copies the cell's text
    if (!e.clipboardData) return;
    const payload = selectionPayload();
    const size = selectionSize();
    e.clipboardData.setData("text/plain", payload.text);
    e.clipboardData.setData("text/html", payload.html);
    e.preventDefault();
    setStatusMessage(size.rows === 1 && size.cols === 1
      ? "Copied 1 cell" : "Copied " + sizeLabel(size.rect));
  }

  function onGridCut(e) {
    if (readOnly || editing) return;
    if (!e.clipboardData) return;
    const payload = selectionPayload();
    const size = selectionSize();
    e.clipboardData.setData("text/plain", payload.text);
    e.clipboardData.setData("text/html", payload.html);
    e.preventDefault();
    clearSelection();
    setStatusMessage(size.rows === 1 && size.cols === 1
      ? "Cut 1 cell" : "Cut " + sizeLabel(size.rect));
  }

  function onGridPaste(e) {
    if (readOnly) return;
    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    const data = e.clipboardData || window.clipboardData;
    if (!data) return;
    const text = data.getData("text/plain");
    if (editing) {
      const plain = !data.getData("text/html") &&
        text.indexOf("\t") === -1 && text.indexOf("\n") === -1 &&
        text.indexOf("\r") === -1;
      if (plain) {
        e.preventDefault();
        // GFM has no in-row line break: any whitespace run becomes one space.
        insertPlainText(text.replace(/\s+/g, " "));
        return;
      }
      commitEdit();
    }
    const block = parseClipboard(data);
    if (!block) { setStatusMessage("Nothing to paste"); return; }
    e.preventDefault();
    pasteBlock(block);
  }

  /* A native drop carries HTML as well as text. Route it through the
   * same plain-text path as paste so block markup can never enter the
   * model (and never reach the saved GFM). */
  function onGridDrop(e) {
    if (readOnly) return;
    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    const data = e.dataTransfer;
    const text = data ? data.getData("text/plain") : "";
    e.preventDefault();
    if (!text) return;
    const row = Number(td.getAttribute("data-row"));
    const col = Number(td.getAttribute("data-col"));
    if (!editing || row !== activeRow || col !== activeCol) startEdit(row, col);
    insertPlainText(text.replace(/\s+/g, " "));
  }

  function onGridBeforeInput(e) {
    if (readOnly) return;
    if (e.inputType && e.inputType.indexOf("insertFromDrop") === 0) {
      // onGridDrop owns the insertion; block the native rich-text drop.
      e.preventDefault();
    }
  }

  function insertPlainText(text) {
    const td = activeCell();
    const span = td && td.querySelector(".te-cell-text");
    if (!span) return;
    let inserted = false;
    try {
      inserted = document.execCommand && document.execCommand("insertText", false, text);
    } catch (_) { inserted = false; }
    if (!inserted) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && span.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        span.appendChild(document.createTextNode(text));
        placeCaretAtEnd(span);
      }
    }
    syncCellFromDom(activeRow, activeCol);
    state.changed = true;
  }

  /* --- grid drag reordering ---------------------------------------- */
  /* Pointer path for moving a row or a column. The grips are the only
   * draggable nodes; the drop target is read from the cell under the
   * pointer, so the grid keeps no phantom nodes and the model is touched
   * only once, on pointerup. The Move buttons are the keyboard path. */

  let drag = null;   // { axis: "row"|"col", from, pos }
  let press = null;  // { row, col, x, y, shift, moved, pressAt, longTimer }

  const DROP_CLASSES = ["is-drop-before", "is-drop-after",
    "is-drop-left", "is-drop-right"];

  function clearDropMarks() {
    if (!gridEl) return;
    gridEl.querySelectorAll(
      ".is-drop-before,.is-drop-after,.is-drop-left,.is-drop-right"
    ).forEach((node) => node.classList.remove(...DROP_CLASSES));
  }

  function paintDrop(axis, index, after) {
    clearDropMarks();
    if (axis === "row") {
      const tr = gridEl.querySelector('tr[data-row="' + index + '"]');
      if (tr) tr.classList.add(after ? "is-drop-after" : "is-drop-before");
      return;
    }
    gridEl.querySelectorAll('.te-cell[data-col="' + index + '"]')
      .forEach((td) => td.classList.add(after ? "is-drop-right" : "is-drop-left"));
  }

  function cellUnder(e) {
    if (!gridEl || typeof document.elementFromPoint !== "function") return null;
    const node = document.elementFromPoint(e.clientX, e.clientY);
    return node && node.closest ? node.closest(".te-cell") : null;
  }

  function onGridPointerDown(e) {
    if (readOnly || e.button !== 0) return;
    const grip = e.target.closest &&
      e.target.closest(".te-row-grip,.te-col-grip");
    if (grip) {
      const axis = grip.classList.contains("te-row-grip") ? "row" : "col";
      const from = Number(grip.getAttribute(
        axis === "row" ? "data-drag-row" : "data-drag-col"));
      if (!Number.isFinite(from)) return;
      e.preventDefault();
      commitEdit();
      drag = { axis, from, pos: from };
      if (gridEl.setPointerCapture) gridEl.setPointerCapture(e.pointerId);
      return;
    }

    const td = e.target.closest && e.target.closest(".te-cell");
    if (!td) return;
    const row = Number(td.getAttribute("data-row"));
    const col = Number(td.getAttribute("data-col"));
    // A press inside the cell being edited belongs to that cell's text.
    if (editing && row === activeRow && col === activeCol) return;
    e.preventDefault();
    if (editing) commitEdit();

    if (!e.shiftKey) {
      anchorRow = row;
      anchorCol = col;
    }
    setActive(row, col);
    paintSelection();
    press = {
      row, col, x: e.clientX, y: e.clientY, shift: !!e.shiftKey,
      moved: false, point: { x: e.clientX, y: e.clientY },
      touch: e.pointerType === "touch", started: !e.pointerType ||
        e.pointerType !== "touch",
    };
    if (press.touch) {
      // Touch: a long press starts a range, a short tap edits.
      press.longTimer = setTimeout(() => {
        if (!press) return;
        press.started = true;
        setStatusMessage("Drag to select a range");
      }, LONG_PRESS_MS);
    }
    if (gridEl.setPointerCapture) gridEl.setPointerCapture(e.pointerId);
  }

  function onGridPointerMove(e) {
    if (press) {
      const dx = Math.abs(e.clientX - press.x);
      const dy = Math.abs(e.clientY - press.y);
      if (dx > DRAG_SLOP || dy > DRAG_SLOP) press.moved = true;
      if (press.touch && !press.started) return;   // touch paints after the hold
      const td = cellUnder(e);
      if (td) {
        const row = Number(td.getAttribute("data-row"));
        const col = Number(td.getAttribute("data-col"));
        if (row !== activeRow || col !== activeCol) {
          setActive(row, col);
          paintSelection();
        }
      }
      return;
    }
    if (!drag) return;
    if (typeof document.elementFromPoint !== "function") return;
    const node = document.elementFromPoint(e.clientX, e.clientY);
    const td = node && node.closest ? node.closest(".te-cell") : null;
    if (!td) return;
    const rect = td.getBoundingClientRect();
    if (drag.axis === "row") {
      const row = Number(td.getAttribute("data-row"));
      const after = e.clientY > rect.top + rect.height / 2;
      drag.pos = Math.max(1, row + (after ? 1 : 0));
      paintDrop("row", row, after);
      return;
    }
    const col = Number(td.getAttribute("data-col"));
    const after = e.clientX > rect.left + rect.width / 2;
    drag.pos = col + (after ? 1 : 0);
    paintDrop("col", col, after);
  }

  function onGridPointerUp() {
    if (press) {
      const p = press;
      press = null;
      clearTimeout(p.longTimer);
      if (p.touch && !p.started) {
        // A short touch tap edits; a short touch drag does nothing.
        if (!p.moved) startEdit(p.row, p.col, { point: p.point });
        return;
      }
      if (!p.moved && !p.shift) {
        startEdit(p.row, p.col, { point: p.point });
      } else {
        paintSelection();
        updateStatus();
      }
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;
    clearDropMarks();
    // `pos` is an insertion index, so a move downward shifts by one
    // once the source is removed.
    let dest = d.pos;
    if (dest > d.from) dest -= 1;
    if (d.axis === "row") {
      if (moveRowTo(d.from, dest)) setStatusMessage("Moved the row");
    } else if (moveColTo(d.from, dest)) {
      setStatusMessage("Moved the column");
    }
  }

  function onGridPointerCancel() {
    drag = null;
    if (press) clearTimeout(press.longTimer);
    press = null;
    clearDropMarks();
  }

  /* --- toolbar state ------------------------------------------------ */

  function rowDeleteReason() {
    if (!state) return "No row selected";
    if (activeRow === 0) return "The header row can't be deleted.";
    if (state.rows.length <= 2) return "A table needs at least one body row.";
    return "";
  }

  function columnDeleteReason() {
    if (!state) return "No column selected";
    if (state.cols <= 1) return "A table needs at least one column.";
    return "";
  }

  function rowMoveReason(dir) {
    if (!state) return "No row selected";
    if (activeRow === 0) return "The header row can't be moved.";
    if (dir < 0 && activeRow <= 1) return "This is already the first body row.";
    if (dir > 0 && activeRow >= state.rows.length - 1) {
      return "This is already the last body row.";
    }
    return "";
  }

  function columnMoveReason(dir) {
    if (!state) return "No column selected";
    if (dir < 0 && activeCol <= 0) return "This is already the first column.";
    if (dir > 0 && activeCol >= state.cols - 1) {
      return "This is already the last column.";
    }
    return "";
  }

  function sortBlockedReason() {
    if (!state) return "Nothing to sort.";
    if (state.rows.length - 1 < 2) return "Nothing to sort.";
    return "";
  }

  function setDisabled(node, disabled, reason) {
    if (!node) return;
    const base = node.dataset.teTitle != null
      ? node.dataset.teTitle
      : (node.title || "");
    if (node.dataset.teTitle == null) node.dataset.teTitle = base;
    if (disabled) {
      node.setAttribute("aria-disabled", "true");
      node.title = reason || base;
      if (statusEl && statusEl.id) node.setAttribute("aria-describedby", statusEl.id);
    } else {
      node.removeAttribute("aria-disabled");
      node.removeAttribute("aria-describedby");
      node.title = base;
    }
  }

  function syncToolbar() {
    if (!state || !overlayEl) return;
    const rowReason = rowDeleteReason();
    const colReason = columnDeleteReason();
    const sortReason = sortBlockedReason();
    if (readOnly) {
      overlayEl.querySelectorAll(".te-tool").forEach((node) => {
        node.setAttribute("aria-disabled", "true");
        const base = node.dataset.teTitle != null
          ? node.dataset.teTitle
          : (node.title || "");
        node.title = node.closest(".te-clip-group")
          ? CLIPBOARD_BLOCKED : base + " (editing disabled)";
        if (statusEl && statusEl.id) {
          node.setAttribute("aria-describedby", statusEl.id);
        }
      });
      if (sortColEl) {
        sortColEl.disabled = true;
        sortColEl.setAttribute("aria-disabled", "true");
      }
      return;
    }
    // A previous blocked open set aria-disabled on every tool. Clear that
    // blanket state before applying only the predicates that are true now.
    overlayEl.querySelectorAll(".te-tool").forEach((node) => {
      node.removeAttribute("aria-disabled");
      node.removeAttribute("aria-describedby");
      if (node.dataset.teTitle != null) node.title = node.dataset.teTitle;
    });
    const upReason = rowMoveReason(-1);
    const downReason = rowMoveReason(1);
    const leftReason = columnMoveReason(-1);
    const rightReason = columnMoveReason(1);
    setDisabled(byId("te-move-row-up"), upReason !== "", upReason);
    setDisabled(byId("te-move-row-down"), downReason !== "", downReason);
    setDisabled(byId("te-insert-row-above"), activeRow === 0,
      "No row can be inserted above the header.");
    setDisabled(byId("te-delete-row"), rowReason !== "", rowReason);
    setDisabled(byId("te-move-col-left"), leftReason !== "", leftReason);
    setDisabled(byId("te-move-col-right"), rightReason !== "", rightReason);
    setDisabled(byId("te-delete-col"), colReason !== "", colReason);
    setDisabled(byId("te-align-col"), false, "");
    setDisabled(byId("te-transpose"), false, "");
    setDisabled(sortColEl, sortReason !== "", sortReason);
    if (sortColEl) sortColEl.disabled = false;
    if (sortDirEl) {
      setDisabled(sortDirEl, sortReason !== "", sortReason);
      if (sortReason === "") {
        const dirTitle = sortedDir === "asc" ? "Sort ascending" : "Sort descending";
        sortDirEl.title = dirTitle;
        sortDirEl.dataset.teTitle = dirTitle;
        sortDirEl.setAttribute("aria-label", dirTitle);
      }
      sortDirEl.setAttribute("aria-pressed",
        sortedDir === "asc" ? "true" : "false");
    }
    const alignBtn = byId("te-align-col");
    if (alignBtn) {
      const cur = currentAlign(activeCol);
      alignBtn.title = "Cycle column alignment (" + cur + ")";
      alignBtn.dataset.teTitle = alignBtn.title;
    }
  }

  function currentAlign(col) {
    const head = state.rows[0] && state.rows[0].cells[col];
    return (head && head.align) || "left";
  }

  function rebuildSortOptions(selected) {
    if (!sortColEl || !state) return;
    const keep = selected == null ? sortColEl.value : String(selected);
    sortColEl.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Sort by…";
    sortColEl.appendChild(placeholder);
    for (let c = 0; c < state.cols; c++) {
      const opt = document.createElement("option");
      opt.value = String(c);
      const label = htmlToText(state.rows[0] && state.rows[0].cells[c]
        ? state.rows[0].cells[c].html : "").trim();
      opt.textContent = label || "Column " + (c + 1);
      sortColEl.appendChild(opt);
    }
    if (keep !== "" && Number(keep) < state.cols) sortColEl.value = keep;
    else sortColEl.value = "";
  }

  /* --- toolbar actions --------------------------------------------- */

  function markChanged() {
    if (state) state.changed = true;
  }

  /* Repaint after a structural change. The grid, the sort options, and
   * the focused cell are rebuilt together so a row or column move never
   * leaves a stale option label or a detached active cell. */
  function finishStructure(keepSelection) {
    renderGrid();
    rebuildSortOptions(sortColEl ? sortColEl.value : "");
    anchorRow = clamp(anchorRow, 0, Math.max(0, state.rows.length - 1));
    anchorCol = clamp(anchorCol, 0, Math.max(0, state.cols - 1));
    focusCell(activeRow, activeCol, !!keepSelection);
    syncToolbar();
  }

  function emptyRow() {
    const cells = [];
    for (let c = 0; c < state.cols; c++) {
      const head = state.rows[0] && state.rows[0].cells[c];
      cells.push({ html: "&nbsp;", align: head ? head.align : null });
    }
    return { cells };
  }

  /* Insert a body row at `index` (1..rows.length). Row 0 is the fixed
   * header: GFM has no row above it. */
  function insertRowAt(index) {
    if (readOnly || !state) return;
    commitEdit();
    const at = clamp(index, 1, state.rows.length);
    state.rows.splice(at, 0, emptyRow());
    markChanged();
    activeRow = at;
    activeCol = Math.min(activeCol, state.cols - 1);
    finishStructure();
    setStatusMessage("Inserted a row");
  }

  /* Move a body row to `dest` (1..rows.length-1). Returns false when the
   * header would move or the destination is the current position. */
  function moveRowTo(from, dest) {
    if (readOnly || !state) return false;
    if (from <= 0 || from >= state.rows.length) return false;
    const to = clamp(dest, 1, state.rows.length - 1);
    if (to === from) return false;
    commitEdit();
    const row = state.rows.splice(from, 1)[0];
    state.rows.splice(to, 0, row);
    markChanged();
    activeRow = to;
    finishStructure();
    return true;
  }

  function insertColAt(index) {
    if (readOnly || !state) return;
    commitEdit();
    const at = clamp(index, 0, state.cols);
    state.rows.forEach((row) => {
      row.cells.splice(at, 0, { html: "&nbsp;", align: "left" });
    });
    state.cols += 1;
    markChanged();
    activeCol = at;
    if (sortedCol >= at) sortedCol += 1;
    finishStructure();
    setStatusMessage("Inserted a column");
  }

  function moveColTo(from, dest) {
    if (readOnly || !state) return false;
    if (from < 0 || from >= state.cols) return false;
    const to = clamp(dest, 0, state.cols - 1);
    if (to === from) return false;
    commitEdit();
    state.rows.forEach((row) => {
      const cell = row.cells.splice(from, 1)[0];
      row.cells.splice(to, 0, cell);
    });
    markChanged();
    activeCol = to;
    if (sortedCol === from) sortedCol = to;
    else if (sortedCol === to) sortedCol = from;
    finishStructure();
    return true;
  }

  function addRow() {
    if (readOnly || !state) return;
    insertRowAt(state.rows.length);
    setStatusMessage("Added a row");
  }

  function selectedBodyRows() {
    const r = selRect();
    const rows = [];
    for (let i = r.r0; i <= r.r1; i++) if (i > 0) rows.push(i);
    return rows;
  }

  function selectedColumns() {
    const r = selRect();
    const cols = [];
    for (let i = r.c0; i <= r.c1; i++) cols.push(i);
    return cols;
  }

  function deleteRow() {
    if (readOnly || !state) return;
    const rows = selectedBodyRows();
    if (!rows.length) {
      setStatusMessage("The header row can't be deleted.");
      return;
    }
    if (state.rows.length - 1 - rows.length < 1) {
      setStatusMessage("A table needs at least one body row.");
      return;
    }
    commitEdit();
    for (let i = rows.length - 1; i >= 0; i--) state.rows.splice(rows[i], 1);
    markChanged();
    activeRow = Math.min(rows[0], state.rows.length - 1);
    activeCol = Math.min(activeCol, state.cols - 1);
    collapseSelection();
    finishStructure();
    setStatusMessage(rows.length === 1 ? "Deleted 1 row"
      : "Deleted " + rows.length + " rows");
  }

  function addColumn() {
    if (readOnly || !state) return;
    insertColAt(state.cols);
    setStatusMessage("Added a column");
  }

  function deleteColumn() {
    if (readOnly || !state) return;
    const cols = selectedColumns();
    if (state.cols - cols.length < 1) {
      setStatusMessage("A table needs at least one column.");
      return;
    }
    commitEdit();
    state.rows.forEach((row) => {
      for (let i = cols.length - 1; i >= 0; i--) {
        if (row.cells[cols[i]]) row.cells.splice(cols[i], 1);
      }
    });
    state.cols -= cols.length;
    markChanged();
    if (sortedCol >= 0) {
      if (cols.indexOf(sortedCol) !== -1) sortedCol = -1;
      else {
        cols.forEach((c) => { if (c < sortedCol) sortedCol -= 1; });
      }
    }
    activeRow = Math.min(activeRow, state.rows.length - 1);
    activeCol = Math.min(cols[0], state.cols - 1);
    collapseSelection();
    finishStructure();
    setStatusMessage(cols.length === 1 ? "Deleted 1 column"
      : "Deleted " + cols.length + " columns");
  }

  function moveRowStep(dir) {
    if (readOnly || !state) return;
    const reason = rowMoveReason(dir);
    if (reason) { setStatusMessage(reason); return; }
    if (moveRowTo(activeRow, activeRow + dir)) {
      setStatusMessage(dir < 0 ? "Moved the row up" : "Moved the row down");
    }
  }

  function moveColStep(dir) {
    if (readOnly || !state) return;
    const reason = columnMoveReason(dir);
    if (reason) { setStatusMessage(reason); return; }
    if (moveColTo(activeCol, activeCol + dir)) {
      setStatusMessage(dir < 0 ? "Moved the column left" : "Moved the column right");
    }
  }

  function insertRowRelative(where) {
    if (readOnly || !state) return;
    if (where === "above" && activeRow === 0) {
      setStatusMessage("No row can be inserted above the header.");
      return;
    }
    insertRowAt(where === "above" ? activeRow : activeRow + 1);
  }

  function insertColRelative(where) {
    if (readOnly || !state) return;
    insertColAt(where === "left" ? activeCol : activeCol + 1);
  }

  /* Delete the whole table: the same one-step write Apply performs, with
   * the caret parked on the neighbouring block. */
  function deleteTable() {
    if (readOnly || !state) return;
    const table = originalTable;
    if (!table || !viewerContentEl || !viewerContentEl.contains(table)) {
      return close({ focusTable: true });
    }
    commitEdit();
    const anchor = table.nextElementSibling || table.previousElementSibling;
    if (NB.hybrid && NB.hybrid.flushPendingSnapshot) NB.hybrid.flushPendingSnapshot();
    table.remove();
    originalTable = null;
    if (NB.hybrid && NB.hybrid.onContentChange) NB.hybrid.onContentChange();
    if (NB.tableEdit && NB.tableEdit.hide) NB.tableEdit.hide();
    close();
    focusAfterTable(anchor);
    setStatusMessage("");
  }

  /* Land the caret on the block that took the table's place. */
  function focusAfterTable(node) {
    if (!node || !viewerContentEl) return;
    viewerContentEl.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function cycleAlign() {
    if (readOnly) return;
    commitEdit();
    const next = ALIGN_CYCLE[currentAlign(activeCol)] || "center";
    state.rows.forEach((row) => {
      if (row.cells[activeCol]) row.cells[activeCol].align = next;
    });
    markChanged();
    finishStructure();
    setStatusMessage("Column " + (activeCol + 1) + " aligned " + next);
  }

  function parseNumber(text) {
    const t = (text || "").trim();
    if (!t || !NUMBER_RE.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function compareKeys(a, b) {
    const an = parseNumber(a);
    const bn = parseNumber(b);
    if (an !== null && bn !== null) return an < bn ? -1 : (an > bn ? 1 : 0);
    return COLLATOR.compare(a, b);
  }

  function sortByColumn(col) {
    if (readOnly) return;
    const reason = sortBlockedReason();
    if (reason) { setStatusMessage(reason); return; }
    if (col == null || col === "" || Number.isNaN(Number(col))) return;
    col = Number(col);
    if (col < 0 || col >= state.cols) return;
    commitEdit();
    const body = state.rows.slice(1).map((row, index) => ({
      row,
      index,
      text: htmlToText(row.cells[col] ? row.cells[col].html : ""),
    }));
    const nonEmpty = [];
    const empty = [];
    body.forEach((item) => {
      if (item.text.trim() === "") empty.push(item);
      else nonEmpty.push(item);
    });
    nonEmpty.sort((a, b) => {
      const cmp = compareKeys(a.text, b.text);
      const directed = sortedDir === "desc" ? -cmp : cmp;
      return directed !== 0 ? directed : a.index - b.index;
    });
    // Empty cells last in BOTH directions; explicit index keeps both
    // partitions stable.
    const ordered = nonEmpty.concat(empty);
    state.rows = [state.rows[0]].concat(ordered.map((item) => item.row));
    markChanged();
    sortedCol = col;
    renderGrid();
    rebuildSortOptions(col);
    focusCell(Math.min(activeRow, state.rows.length - 1), col);
    const label = htmlToText(state.rows[0].cells[col].html).trim() || "Column " + (col + 1);
    setStatusMessage("Sorted by " + label + ", " +
      (sortedDir === "asc" ? "ascending" : "descending"));
  }

  function toggleSortDirection() {
    if (readOnly) return;
    const reason = sortBlockedReason();
    if (reason) { setStatusMessage(reason); return; }
    sortedDir = sortedDir === "asc" ? "desc" : "asc";
    const col = sortColEl && sortColEl.value !== "" ? Number(sortColEl.value) : sortedCol;
    syncToolbar();
    if (col >= 0) sortByColumn(col);
  }

  function transpose() {
    if (readOnly) return;
    commitEdit();
    const oldRows = state.rows;
    const oldCols = state.cols;
    const newRows = oldCols;
    const newCols = oldRows.length;
    const rows = [];
    for (let r = 0; r < newRows; r++) {
      const cells = [];
      for (let c = 0; c < newCols; c++) {
        const src = oldRows[c] && oldRows[c].cells[r];
        cells.push({
          html: src ? src.html : "",
          align: null,   // transpose destroys per-column alignment
        });
      }
      rows.push({ cells });
    }
    state = { cols: newCols, rows, changed: true };
    activeRow = 0;
    activeCol = 0;
    sortedCol = -1;
    renderGrid();
    rebuildSortOptions();
    focusCell(0, 0);
    setStatusMessage("Transposed: " + newCols + " columns × " + newRows + " rows");
  }

  /* --- status ------------------------------------------------------- */

  function updateStatus() {
    if (!statusEl || !state) return;
    if (!readOnly && isMulti()) {
      const r = selRect();
      statusEl.textContent = sizeLabel(r) + " selected, rows " +
        (r.r0 + 1) + "–" + (r.r1 + 1) + ", columns " +
        (r.c0 + 1) + "–" + (r.c1 + 1);
      return;
    }
    const rowLabel = activeRow === 0
      ? "Header row"
      : "Row " + (activeRow + 1) + " of " + state.rows.length;
    statusEl.textContent = rowLabel + " · Column " + (activeCol + 1) +
      " of " + state.cols;
  }

  function setStatusMessage(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  /* --- apply / cancel ----------------------------------------------- */

  function sameTable(a, b) {
    return normalizedOuter(a) === normalizedOuter(b);
  }

  /* Marked emits pretty-printed structural whitespace between rows/cells;
   * the rebuilt table is compact. Those text nodes are never data, so
   * strip them from both sides before the no-op comparison. Cell content
   * is untouched (the cells themselves are never parents here). */
  function normalizedOuter(table) {
    if (!table) return "";
    const clone = table.cloneNode(true);
    clone.querySelectorAll("table,thead,tbody,tfoot,tr").forEach((parent) => {
      Array.from(parent.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) {
          node.remove();
        }
      });
    });
    return clone.outerHTML;
  }

  /* `canonicalAlign: false` builds the table exactly as the source spells
   * it (`align` only where the source had one); the default build writes
   * the editor's alignment state instead, so a column whose source
   * delimiter was a plain `---` (read as left) is written `:--` once an
   * edited table is applied. The no-op comparison uses the source-faithful
   * build, so an add-then-delete cycle that ends where it started still
   * writes nothing. */
  function rebuildTable(opts) {
    if (!originalTable || !state) return null;
    const canonical = !opts || opts.canonicalAlign !== false;
    const table = originalTable.cloneNode(false);
    const tbody = document.createElement("tbody");
    state.rows.forEach((row, ri) => {
      const tr = document.createElement("tr");
      row.cells.forEach((cell) => {
        const node = document.createElement(ri === 0 ? "th" : "td");
        const align = cell.align != null
          ? cell.align
          : (canonical && ri === 0 ? "left" : null);
        if (align != null) node.setAttribute("align", align);
        node.innerHTML = cell.html;
        tr.appendChild(node);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function apply() {
    if (!state || readOnly) return close({ focusTable: true });
    if (!originalTable || !viewerContentEl.contains(originalTable)) {
      return close({ focusTable: true });
    }
    const built = rebuildTable();
    if (!built) return close({ focusTable: true });
    // An untouched table is never rewritten: padding a ragged row or
    // dropping a non-GFM wrapper on open must not count as an edit. The
    // source-faithful comparison also catches add-then-delete (and
    // transpose-twice) cycles that end where they started, before the
    // canonical alignment state can make the build look different.
    if (!state.changed ||
        sameTable(rebuildTable({ canonicalAlign: false }), originalTable)) {
      return close({ focusTable: true });
    }
    const table = originalTable;
    if (NB.hybrid && NB.hybrid.flushPendingSnapshot) NB.hybrid.flushPendingSnapshot();
    table.replaceWith(built);
    originalTable = built;   // the close-time focus fallback targets the new table
    // table-edit.js still points at the replaced node; rebind it so the
    // overlay's Edit control opens the live table again.
    if (NB.tableEdit && NB.tableEdit.reveal) NB.tableEdit.reveal(built);
    if (NB.hybrid && NB.hybrid.onContentChange) NB.hybrid.onContentChange();
    close({ focusTable: true });
  }

  function cancel() {
    // Cancel never writes, even if the watcher replaced the table under
    // the open modal; closing is the whole answer.
    close();
  }

  /* --- open / close ------------------------------------------------- */

  function setBlocked(blocked) {
    readOnly = blocked;
    if (noticeEl) noticeEl.hidden = !blocked;
    if (applyBtn) {
      applyBtn.hidden = blocked;
      applyBtn.disabled = blocked;
    }
    if (gridEl) gridEl.setAttribute("aria-readonly", blocked ? "true" : "false");
  }

  function open(table) {
    if (!overlayEl || !table) return false;
    if (!NB.hybrid || !NB.hybrid.isActive || !NB.hybrid.isActive()) return false;
    viewerContentEl = viewerContentEl || document.getElementById("viewer-content");
    if (!viewerContentEl || !viewerContentEl.contains(table)) return false;
    if (!table.rows.length) return false;
    if (isOpen()) close();

    originalTable = table;
    const blocked = !!(NB.hybrid.tableHasSpans && NB.hybrid.tableHasSpans(table));
    state = snapshotTable(table);
    activeRow = 0;
    activeCol = 0;
    anchorRow = 0;
    anchorCol = 0;
    editing = false;
    sortedCol = -1;
    sortedDir = "asc";
    setBlocked(blocked);

    overlayEl.hidden = false;
    renderGrid();
    rebuildSortOptions("");
    syncToolbar();

    const firstCell = gridEl && gridEl.querySelector(".te-cell");
    if (NB.dialog) NB.dialog.open(overlayEl, { fallbackFocus: firstCell });

    if (blocked) {
      setStatusMessage("This table has merged cells and cannot be edited here.");
      if (cancelBtn) cancelBtn.focus({ preventScroll: true });
    } else {
      focusCell(0, 0);
      updateStatus();
    }
    return true;
  }

  function isBlocked() {
    return isOpen() && readOnly;
  }

  /* Land focus in the note after close. A <td> is not focusable in
   * Chromium, so focus #viewer-content (contenteditable while hybrid is
   * active) and put a collapsed Range inside the first cell -- the
   * table-edit.js focusCellOf pattern. Keys such as Ctrl+Z then reach the
   * hybrid dispatcher. */
  function focusTableCaret(table) {
    if (!viewerContentEl || !viewerContentEl.contains(table)) return;
    viewerContentEl.focus({ preventScroll: true });
    const cell = table.querySelector("th,td");
    if (!cell) return;
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function close(opts) {
    if (!overlayEl || overlayEl.hidden) return;
    commitEdit();
    const forceTableFocus = !!(opts && opts.focusTable);
    const focusTable = originalTable;
    overlayEl.hidden = true;
    if (NB.dialog) NB.dialog.close(overlayEl);
    // The context-menu path opens from a menu item that is already hidden
    // when the click runs, so dialog.close() has no usable invoker. Land
    // the caret back in the table instead of dropping it on <body>. Apply
    // always lands in the table so Ctrl+Z reaches the hybrid dispatcher,
    // even when the overlay button survives as the dialog's invoker.
    const active = document.activeElement;
    const lost = !active || active === document.body ||
      overlayEl.contains(active);
    if ((lost || forceTableFocus) && focusTable) focusTableCaret(focusTable);
    state = null;
    originalTable = null;
    editing = false;
    readOnly = false;
    if (gridEl) gridEl.textContent = "";
    if (statusEl) statusEl.textContent = "";
  }

  function isOpen() {
    return !!overlayEl && !overlayEl.hidden;
  }

  /* --- wiring ------------------------------------------------------- */

  function wire() {
    overlayEl = byId("table-editor-overlay");
    if (!overlayEl) return;
    gridEl = byId("table-editor-grid");
    noticeEl = byId("table-editor-notice");
    statusEl = byId("table-editor-status");
    sortColEl = byId("te-sort-col");
    sortDirEl = byId("te-sort-dir");
    applyBtn = byId("table-editor-apply");
    cancelBtn = byId("table-editor-cancel");

    overlayEl.addEventListener("keydown", onOverlayKeydown);
    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) cancel();
    });

    const closeBtn = byId("table-editor-close");
    if (closeBtn) closeBtn.addEventListener("click", cancel);
    if (cancelBtn) cancelBtn.addEventListener("click", cancel);
    if (applyBtn) applyBtn.addEventListener("click", apply);

    if (gridEl) {
      gridEl.addEventListener("keydown", onGridKeydown, true);
      gridEl.addEventListener("mousedown", onGridMousedown);
      gridEl.addEventListener("input", onGridInput);
      gridEl.addEventListener("focusout", onGridFocusOut);
      gridEl.addEventListener("paste", onGridPaste);
      gridEl.addEventListener("copy", onGridCopy);
      gridEl.addEventListener("cut", onGridCut);
      gridEl.addEventListener("drop", onGridDrop);
      gridEl.addEventListener("beforeinput", onGridBeforeInput);
      gridEl.addEventListener("pointerdown", onGridPointerDown);
      gridEl.addEventListener("pointermove", onGridPointerMove);
      gridEl.addEventListener("pointerup", onGridPointerUp);
      gridEl.addEventListener("pointercancel", onGridPointerCancel);
    }

    const wireButton = (id, fn) => {
      const node = byId(id);
      if (node) node.addEventListener("click", fn);
    };
    overlayEl.querySelectorAll(".te-tool").forEach((node) => {
      node.dataset.teTitle = node.title || "";
    });
    wireButton("te-add-row", addRow);
    wireButton("te-delete-row", deleteRow);
    wireButton("te-add-col", addColumn);
    wireButton("te-delete-col", deleteColumn);
    wireButton("te-move-row-up", () => moveRowStep(-1));
    wireButton("te-move-row-down", () => moveRowStep(1));
    wireButton("te-insert-row-above", () => insertRowRelative("above"));
    wireButton("te-insert-row-below", () => insertRowRelative("below"));
    wireButton("te-move-col-left", () => moveColStep(-1));
    wireButton("te-move-col-right", () => moveColStep(1));
    wireButton("te-insert-col-left", () => insertColRelative("left"));
    wireButton("te-insert-col-right", () => insertColRelative("right"));
    wireButton("te-delete-table", deleteTable);
    wireButton("te-copy", () => withClipboard(copyToClipboard));
    wireButton("te-cut", () => withClipboard(() => {
      if (copyToClipboard()) clearSelection();
    }));
    wireButton("te-paste", () => withClipboard(pasteFromClipboard));
    wireButton("te-clear", () => withClipboard(clearSelection));
    wireButton("te-align-col", cycleAlign);
    wireButton("te-transpose", transpose);
    wireButton("te-sort-dir", toggleSortDirection);
    if (sortColEl) {
      sortColEl.addEventListener("change", () => {
        if (sortColEl.value === "") return;
        sortByColumn(sortColEl.value);
      });
    }
  }

  wire();

  NB.tableEditor = {
    open,
    close,
    isOpen,
    isBlocked,
    // Test hooks: the live model, the table a non-mutating Apply would
    // write, the two commit verbs, and the overlay element.
    getState() { return state; },
    rebuildTable,
    _apply: apply,
    _cancel: cancel,
    overlayEl() { return overlayEl; },
    // Model verbs behind the Move/Insert buttons and the drag path.
    moveRowTo,
    moveColTo,
    insertRowAt,
    insertColAt,
    _deleteTable: deleteTable,
    selectionPayload,
    pasteBlock,
    clearSelection,
    _parseClipboard: parseClipboard,
    getSelection() { return selRect(); },
    // Test hook: set both corners (the keyboard path is exercised too).
    _select(r0, c0, r1, c1) {
      if (!state || readOnly) return;
      anchorRow = clamp(r0, 0, Math.max(0, state.rows.length - 1));
      anchorCol = clamp(c0, 0, Math.max(0, state.cols - 1));
      focusCell(r1, c1, true);
    },
  };
})();
