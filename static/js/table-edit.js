/* table-edit.js -- drag handles for tables in hybrid (WYSIWYG) mode.
 *
 * One overlay layer (a child of #viewer, deliberately OUTSIDE the
 * contentEditable subtree) carries grips for the table under the
 * pointer or containing focus:
 *
 *   - a row grip in the left gutter of every body row (the header row
 *     grip is rendered but disabled: GFM tables always keep the header
 *     first, and hybrid pins rows[0] as the header);
 *   - a column grip above every header cell.
 *
 * Dragging reorders rows / columns with Pointer Events
 * (pointerdown + setPointerCapture -- never HTML5 DnD, which hijacks
 * text selection inside cells and behaves differently across engines).
 * The actual mutation is hybrid.js's moveRow()/moveCol(), which moves
 * the existing nodes and marks the note dirty.
 *
 * Serialization-safety contract:
 *   - The overlay is NOT in #viewer-content, so turndown's clone and
 *     hybrid's innerHTML undo snapshots never see grips, drop lines or
 *     drag ghosts. No stripping code is needed anywhere.
 *   - No class or attribute is ever put on a table node during a drag;
 *     the "lifted row" is drawn as a translucent ghost in the overlay.
 *   - The overlay hides on scroll (cheapest correct behaviour: positions
 *     are rect-based and drift otherwise); it re-shows on the next
 *     pointer/focus interaction with a table.
 *
 * The context menu and the Alt+arrow chords remain the keyboard and
 * touch paths; this module is the mouse path.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const GRACE_MS = 120;      // hide delay after the pointer leaves a table
  const GRIP_SIZE = 24;      // px, must match .nb-row-grip/.nb-col-grip CSS
  const GUTTER_X = 28;       // row-grip offset left of the row's left edge
  const COL_OVERLAP = 12;    // how far the col grip dips into the header cell
  const BTN_SIZE = 24;       // + / - hit target
  const PAIR_GAP = 4;        // gap between the two buttons of a pair
  const ROW_PAIR_GAP = 6;    // table content right edge -> row rail
  const COL_PAIR_GAP = 6;    // table content bottom edge -> column pair
  const EDGE_SAFE = 8;       // min distance a control keeps from a #viewer edge
  const DENSE_PITCH = 24;    // below this line pitch, grips collapse to the
                             // active line (a 24px target cannot fit a 22px row)
  const SCROLLBAR_SAFE = 22; // extra bottom reserve with a horizontal scrollbar
  const PAIR_W = 2 * BTN_SIZE + PAIR_GAP;   // 52

  let viewerEl = null;       // #viewer: overlay host, position:relative
  let viewerContentEl = null;
  let overlay = null;        // .nb-table-overlay
  let enabled = false;
  let activeTable = null;    // table whose grips are shown
  let graceTimer = null;
  let rafPending = false;
  // The line under the pointer (or caret): the only lines whose
  // insert/delete pair is drawn. Index into body rows / header cells.
  let activeRowIndex = -1;
  let activeColIndex = -1;
  // Hover-intent lock: while the pointer is over an overlay control (or
  // a drag is running), the active line must not re-target to a
  // neighbouring row — moving diagonally onto `+` would otherwise flip
  // the pair to the row below the moment it leaves the cell.
  let controlHover = false;
  // The row rail's box in overlay space during the current render pass
  // (for placeColPair's corner de-conflict). Null when no row pair.
  let rowPairBox = null;

  // Drag state (null when idle).
  let drag = null;

  /* --- tiny DOM helpers ------------------------------------------- */

  const SVG_DOT_GRID = (cols, rows) =>
    '<svg class="nb-grip-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
    Array.from({ length: rows }, (_, ry) =>
      Array.from({ length: cols }, (_, cx) =>
        `<circle cx="${cx * 4 + 1}" cy="${ry * 4 + 1}" r="1.1"/>`).join("")
    ).join("") +
    "</svg>";

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* Position an overlay element. `rect` is a VIEWPORT rect (the raw
   * getBoundingClientRect output); the host origin is subtracted here,
   * once, so callers can pass plain viewport rects everywhere. */
  function placeAt(node, rect) {
    const host = viewerEl.getBoundingClientRect();
    node.style.left = Math.round(rect.left - host.left) + "px";
    node.style.top = Math.round(rect.top - host.top) + "px";
  }

  /* Position from OVERLAY-space numbers (already relative to #viewer).
   * Used by the pair builders, whose clamp math runs in overlay space. */
  function placeAtOverlay(node, x, y) {
    node.style.left = Math.round(x) + "px";
    node.style.top = Math.round(y) + "px";
  }

  /* --- grip building ---------------------------------------------- */

  function makeGrip(kind, label, title) {
    const b = el("button", kind);
    b.type = "button";
    b.tabIndex = 0;
    b.setAttribute("aria-label", label);
    b.title = title;
    b.innerHTML = kind === "nb-col-grip" ? SVG_DOT_GRID(3, 2) : SVG_DOT_GRID(2, 3);
    return b;
  }

  /* The "+" / "-" buttons: text glyphs (the dot grid reads as a drag
   * handle). They live as flex children of a .nb-pair wrapper, so they
   * are positioned once per pair, not per button. */
  function makeBtn(kind, label, title) {
    const b = el("button", kind);
    b.type = "button";
    b.tabIndex = 0;
    b.textContent = kind.indexOf("nb-del-btn") !== -1 ? "\u2212" : "+";
    b.setAttribute("aria-label", label);
    b.title = title;
    return b;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  /* Viewport-space edges of #viewer for clamping, in overlay space. */
  function paneEdges() {
    return { left: 0, top: 0,
             right: viewerEl.clientWidth, bottom: viewerEl.clientHeight };
  }

  /* True when two {left,top,right,bottom} boxes in overlay space
   * intersect. */
  function rectsIntersect(a, b) {
    return a.left < b.right && b.left < a.right &&
           a.top < b.bottom && b.top < a.bottom;
  }

  /* Extra bottom reserve when #viewer-content shows a horizontal
   * scrollbar: the column pair must not sit under it. */
  function scrollbarReserve() {
    return (viewerContentEl.scrollWidth > viewerContentEl.clientWidth)
      ? SCROLLBAR_SAFE : 0;
  }

  /* Overlay-space rect helper: convert a viewport rect into the
   * overlay's coordinate space. */
  function toOverlay(rect) {
    const host = viewerEl.getBoundingClientRect();
    return { left: rect.left - host.left, top: rect.top - host.top,
             right: rect.right - host.left, bottom: rect.bottom - host.top,
             width: rect.width, height: rect.height };
  }

  /* The table's CONTENT box, measured from the cells -- never from the
   * block-level <table> rect. `.markdown-body table { display: block }`
   * makes the table box full width, so anchoring the right rail to it
   * would strand the rail at the pane's edge even for a 300px table. */
  function contentBox(table, header) {
    const cells = header ? Array.from(header.cells) : [];
    const rows = Array.from(table.rows);
    let contentLeft = Infinity, contentRight = -Infinity, contentBottom = -Infinity;
    if (header) cells.forEach((c) => {
      const r = toOverlay(c.getBoundingClientRect());
      contentLeft = Math.min(contentLeft, r.left);
      contentRight = Math.max(contentRight, r.right);
    });
    rows.forEach((row) => {
      const r = toOverlay(row.getBoundingClientRect());
      contentBottom = Math.max(contentBottom, r.bottom);
    });
    return { contentLeft, contentRight, contentBottom };
  }

  /* Rebuild the overlay's controls for the given table. Layout rule
   * ("grips own the margins, insert/delete own the roomy sides"):
   *   - LEFT gutter and TOP strip: drag grips only (one 24px slot).
   *   - Right rail: a vertical +/- pair for the ACTIVE row.
   *   - Bottom strip: a horizontal +/- pair for the ACTIVE column,
   *     nudged clear of the row pair when the two would meet.
   * Per-line buttons are gone: two 24px controls need 52px and the
   * pane gutter is 40px -- per-line pairs are what overlapped. */
  function renderGrips() {
    overlay.textContent = "";
    rowPairBox = null;
    if (!activeTable || !viewerEl || !viewerContentEl) return;
    const table = activeTable;
    if (!viewerContentEl.contains(table)) { activeTable = null; return; }

    if (NB.hybrid.tableHasSpans(table)) {
      // Merged cells: reordering is refused (GFM cannot represent
      // spans); show nothing rather than grips that do nothing.
      const note = el("div", "nb-table-note");
      note.textContent = "Merged cells: row/column reordering is unavailable";
      placeAt(note, table.getBoundingClientRect());
      overlay.appendChild(note);
      return;
    }

    const tableRows = Array.from(table.rows);
    const header = tableRows[0];
    const bodyRows = tableRows.slice(1);
    const V = paneEdges();
    const { contentRight, contentBottom, contentLeft } =
      contentBox(table, header);
    const denseRows = bodyRows.length > 0 &&
      Math.min(...bodyRows.map((r) => r.getBoundingClientRect().height)) < DENSE_PITCH;
    const denseCols = header && header.cells.length > 0 &&
      Math.min(...Array.from(header.cells).map((c) =>
        c.getBoundingClientRect().width)) < DENSE_PITCH;

    // Row grips: per body row (active only when the rows are too tight
    // to host a 24px handle each). The header's grip is rendered but
    // disabled -- it keeps the gutter regular and teaches the pin.
    const single = bodyRows.length <= 1;
    const visibleRows = denseRows
      ? tableRows.filter((row, i) => i === 0 || i === activeRowIndex + 1)
      : tableRows;
    Array.from(visibleRows).forEach((row) => {
      const i = tableRows.indexOf(row);
      const r = toOverlay(row.getBoundingClientRect());
      const grip = makeGrip(
        "nb-row-grip",
        i === 0 ? "Header row (fixed)" : "Move row " + i,
        i === 0 ? "The header row always stays first in Markdown"
                : (single ? "Nothing to reorder" : "Drag to move this row"));
      placeAtOverlay(grip,
        r.left - GUTTER_X,
        r.top + r.height / 2 - GRIP_SIZE / 2);
      if (i === 0 || single) {
        grip.setAttribute("aria-disabled", "true");
        grip.setAttribute("tabindex", "-1");
      }
      if (i > 0 && !single) {
        grip.addEventListener("pointerdown", (e) => startRowDrag(e, row));
      }
      overlay.appendChild(grip);
    });

    // Column grips: per header cell, straddling the header top; active
    // column only when the columns are too tight to host one each.
    const cols = header ? header.cells.length : 0;
    if (header && cols > 0) {
      const hr = toOverlay(header.getBoundingClientRect());
      const visibleCells = denseCols
        ? [header.cells[clamp(activeColIndex, 0, cols - 1)]]
        : Array.from(header.cells);
      visibleCells.forEach((cell) => {
        const i = cell.cellIndex;
        const c = toOverlay(cell.getBoundingClientRect());
        const grip = makeGrip("nb-col-grip", "Move column " + (i + 1),
          cols <= 1 ? "Nothing to reorder" : "Drag to move this column");
        placeAtOverlay(grip,
          c.left + c.width / 2 - GRIP_SIZE / 2,
          hr.top - COL_OVERLAP);
        if (cols <= 1) {
          grip.setAttribute("aria-disabled", "true");
          grip.setAttribute("tabindex", "-1");
        } else {
          grip.addEventListener("pointerdown", (e) => startColDrag(e, i));
        }
        overlay.appendChild(grip);
      });
    }

    // Insert/delete pairs: ONE pair per axis, for the active line only
    // (per-line pairs are what overlapped; see the layout rule above).
    placeRowPair(table, bodyRows, V, contentRight);
    placeColPair(table, header, V, contentLeft, contentBottom);
  }

  /* The vertical +/- pair in the right rail for the active body row.
   * `+` inserts a row below it, `-` deletes it. */
  function placeRowPair(table, bodyRows, V, contentRight) {
    if (activeRowIndex < 0 || activeRowIndex >= bodyRows.length) return;
    const row = bodyRows[activeRowIndex];
    const r = toOverlay(row.getBoundingClientRect());
    const pairH = 2 * BTN_SIZE + PAIR_GAP;
    const left = clamp(contentRight + ROW_PAIR_GAP,
                       V.left + EDGE_SAFE, V.right - EDGE_SAFE - BTN_SIZE);
    const top = clamp(r.top + r.height / 2 - PAIR_W / 2,
                      V.top + EDGE_SAFE, V.bottom - EDGE_SAFE - PAIR_W);
    const add = makeBtn("nb-add-btn nb-add-row",
      "Insert row below row " + (activeRowIndex + 1), "Click to insert a row below");
    add.addEventListener("click", () => insertRowBelow(row));
    const del = makeBtn("nb-del-btn nb-del-row", "Delete row " + (activeRowIndex + 1),
      table.rows.length <= 2 ? "The last body row cannot be deleted"
                             : "Click to delete this row");
    // Header + one body row is the minimum; deleting the last body row
    // would leave the header orphaned in GFM.
    if (table.rows.length <= 2) {
      del.setAttribute("aria-disabled", "true");
      del.setAttribute("tabindex", "-1");
    } else {
      del.addEventListener("click", () => deleteRow(row));
    }
    const pair = el("div", "nb-pair is-row");
    pair.append(add, del);
    // Pair math runs in overlay space; place directly.
    placeAtOverlay(pair, left, top);
    overlay.appendChild(pair);
    // Recorded for placeColPair's corner de-conflict; reset at the top
    // of each render pass.
    rowPairBox = { left, top, right: left + BTN_SIZE, bottom: top + PAIR_W };
  }

  /* The horizontal +/- pair below the table for the active column.
   * `+` inserts right of it (doubles as append when it is the last
   * column), `-` deletes it. Nudged clear of the row pair when the two
   * would meet in the bottom-right corner -- geometrically, never by
   * z-index; the 200px bottom padding makes the move free. */
  function placeColPair(table, header, V, contentLeft, contentBottom) {
    if (!header) return;
    const cols = header.cells.length;
    if (!cols) return;
    const colIndex = clamp(activeColIndex, 0, cols - 1);
    const cell = header.cells[colIndex];
    const c = toOverlay(cell.getBoundingClientRect());
    const reserve = scrollbarReserve();
    const top0 = clamp(contentBottom + COL_PAIR_GAP,
                       V.top + EDGE_SAFE,
                       V.bottom - EDGE_SAFE - BTN_SIZE - reserve);
    const left0 = clamp(c.left + c.width / 2 - PAIR_W / 2,
                        V.left + EDGE_SAFE, V.right - EDGE_SAFE - PAIR_W);
    const isLast = colIndex === cols - 1;
    const add = makeBtn("nb-add-btn nb-add-col",
      isLast ? "Append a column" : "Insert a column right of column " + (colIndex + 1),
      isLast ? "Click to append a column" : "Click to insert a column to the right");
    add.addEventListener("click", () => insertColRightOf(cell));
    const del = makeBtn("nb-del-btn nb-del-col", "Delete column " + (colIndex + 1),
      cols <= 1 ? "A table needs at least one column"
                : "Click to delete this column");
    if (cols <= 1) {
      del.setAttribute("aria-disabled", "true");
      del.setAttribute("tabindex", "-1");
    } else {
      del.addEventListener("click", () => deleteCol(cell));
    }
    const pair = el("div", "nb-pair is-col");
    pair.append(add, del);
    let top = top0;
    // Pair math runs in overlay space; place directly.
    placeAtOverlay(pair, left0, top);
    overlay.appendChild(pair);
    // Corner de-conflict: if the pair would cover the row rail, drop it
    // below the rail (free -- the pane reserves 200px of bottom padding)
    // and re-clamp.
    if (rowPairBox) {
      const pr = { left: left0, top,
                   right: left0 + PAIR_W, bottom: top + BTN_SIZE };
      if (rectsIntersect(rowPairBox, pr)) {
        top = clamp(rowPairBox.bottom + PAIR_GAP,
                    V.top + EDGE_SAFE,
                    V.bottom - EDGE_SAFE - BTN_SIZE - reserve);
        placeAtOverlay(pair, left0, top);
      }
    }
  }

  /* Click-to-insert handlers. Inserting via the existing hybrid
   * helpers keeps cell tags/align consistent with the column and keeps
   * the dirty/undo bookkeeping in one place. The caret lands in the
   * new row/column so the user can type right away. */
  function insertRowBelow(row) {
    if (!activeTable || !viewerContentEl.contains(row)) return;
    // Clear the caret/selection first: execCommand-free DOM insertion
    // still behaves better without a live range over the table.
    if (window.getSelection && window.getSelection()) {
      window.getSelection().removeAllRanges();
    }
    const t = activeTable;
    const idx = Array.from(t.rows).indexOf(row);
    NB.hybrid.insertRow(row, "below");
    // Focus the new row's first cell if it landed where we expect.
    const fresh = t.rows[idx + 1] && t.rows[idx + 1] !== row ? t.rows[idx + 1] : null;
    if (fresh && fresh.cells[0]) focusCellOf(fresh.cells[0]);
  }

  /* Insert a column right of `cell`, then caret into the new cell. */
  function insertColRightOf(cell) {
    if (!activeTable || !viewerContentEl.contains(cell)) return;
    const t = activeTable;
    const idx = cell.cellIndex;
    NB.hybrid.insertCol(cell, "right");
    const head = t.rows[0] && t.rows[0].cells[idx + 1];
    if (head) focusCellOf(head);
  }

  /* Delete handlers: after the mutation the caret moves to the
   * remaining cell at the same index (or the last column) so the
   * keyboard context isn't lost. The overlay is re-rendered from the
   * onContentChange -> refresh path. */
  function deleteRow(row) {
    if (!activeTable || !viewerContentEl.contains(row)) return;
    const t = activeTable;
    // A table always needs its header + at least one body row; the
    // button is aria-disabled there, this is the belt to its braces.
    if (t.rows.length <= 2) return;
    const idx = Array.from(t.rows).indexOf(row);
    NB.hybrid.deleteRow(row);
    const remaining = t.rows[Math.min(idx, t.rows.length - 1)];
    if (remaining && remaining.cells[0]) focusCellOf(remaining.cells[0]);
  }

  function deleteCol(cell) {
    if (!activeTable || !viewerContentEl.contains(cell)) return;
    const t = activeTable;
    if (t.rows[0] && t.rows[0].cells.length <= 1) return;
    const idx = cell.cellIndex;
    NB.hybrid.deleteCol(cell);
    const head = t.rows[0] &&
      t.rows[0].cells[Math.min(idx, t.rows[0].cells.length - 1)];
    if (head) focusCellOf(head);
  }

  function focusCellOf(cell) {
    if (!cell || !viewerContentEl.contains(cell)) return;
    cell.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.selectNodeContents(cell);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /* --- drag state machine ----------------------------------------- */

  function clearOverlayDynamic() {
    overlay.querySelectorAll(".nb-drop-line,.nb-drag-proxy,.nb-drag-ghost")
      .forEach((n) => n.remove());
  }

  function startCommon(e) {
    e.preventDefault();                 // never move the caret / start selection
    e.stopPropagation();
    const grip = e.currentTarget;
    grip.setPointerCapture && grip.setPointerCapture(e.pointerId);
    drag = { pointerId: e.pointerId, grip };
    document.body.classList.add("nb-table-drag");
    renderGrips();                      // drop stale dynamic nodes
  }

  function startRowDrag(e, row) {
    if (!enabled || !activeTable) return;
    startCommon(e);
    const header = activeTable.rows[0];
    const tbody = row.parentNode;
    const ghost = el("div", "nb-drag-ghost");
    const proxy = el("div", "nb-drag-proxy");
    proxy.textContent = "Row: " + rowSummary(row);
    const line = el("div", "nb-drop-line is-row");
    overlay.append(ghost, proxy, line);
    drag = Object.assign(drag, {
      kind: "row", row, tbody, header, ghost, proxy, line,
    });
    moveRowDrag(e);
  }

  /* One-line readable summary of a row for the drag chip: cells joined
   * with a separator, whitespace collapsed (raw textContent otherwise
   * reads as "r1br1a\n\nr1c"). */
  function rowSummary(node) {
    const text = Array.from(node.cells || [node])
      .map((c) => (c.textContent || "").trim())
      .filter(Boolean)
      .join(" · ");
    return text.length > 28 ? text.slice(0, 27) + "…" : (text || "(empty)");
  }

  function startColDrag(e, srcIndex) {
    if (!enabled || !activeTable) return;
    startCommon(e);
    const proxy = el("div", "nb-drag-proxy");
    const head = activeTable.rows[0] && activeTable.rows[0].cells[srcIndex];
    proxy.textContent = "Column: " + (head
      ? rowSummary({ cells: [head] })
      : "#" + (srcIndex + 1));
    const line = el("div", "nb-drop-line is-col");
    overlay.append(proxy, line);
    drag = Object.assign(drag, {
      kind: "col", srcIndex, proxy, line, destIndex: null,
    });
    moveColDrag(e);
  }

  /* Horizontal boundary for a row drop: the row to insert before, or
   * null to append. The header is skipped as a boundary target. */
  function rowBoundary(y) {
    const tbody = drag.tbody;
    for (const row of Array.from(tbody.children)) {
      if (row.tagName !== "TR" || row === drag.header) continue;
      const r = row.getBoundingClientRect();
      if (y < r.top + r.height / 2) return row;
    }
    return null;
  }

  function moveRowDrag(e) {
    const g = drag.ghost, r = drag.row.getBoundingClientRect();
    placeAt(g, r);
    g.style.width = Math.round(r.width) + "px";
    g.style.height = Math.round(r.height) + "px";
    const host = viewerEl.getBoundingClientRect();
    drag.proxy.style.left = Math.round(e.clientX - host.left + 8) + "px";
    drag.proxy.style.top = Math.round(e.clientY - host.top + 8) + "px";

    drag.before = rowBoundary(e.clientY);
    if (drag.before === drag.row || drag.before === drag.row.nextElementSibling) {
      drag.before = null;   // no-op drop position: hide the line
      drag.line.style.display = "none";
      return;
    }
    // Span: union of cell rects' left/right at the boundary y.
    const row = drag.before || drag.tbody.lastElementChild;
    if (!row || row.tagName !== "TR") { drag.line.style.display = "none"; return; }
    const cells = Array.from(row.cells);
    if (!cells.length) { drag.line.style.display = "none"; return; }
    const l = cells[0].getBoundingClientRect().left;
    const rr = cells[cells.length - 1].getBoundingClientRect().right;
    const y = drag.before
      ? drag.before.getBoundingClientRect().top - 1
      : row.getBoundingClientRect().bottom - 1;
    placeAt(drag.line, { left: l, top: y });
    drag.line.style.width = Math.round(rr - l) + "px";
    drag.line.style.display = "";
  }

  function moveColDrag(e) {
    const host = viewerEl.getBoundingClientRect();
    drag.proxy.style.left = Math.round(e.clientX - host.left + 8) + "px";
    drag.proxy.style.top = Math.round(e.clientY - host.top + 8) + "px";

    const table = activeTable;
    const cells = Array.from(table.rows[0] ? table.rows[0].cells : []);
    let t = null;   // boundary index 0..n
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i].getBoundingClientRect();
      if (e.clientX < c.left + c.width / 2) { t = i; break; }
    }
    if (t === null) t = cells.length;
    drag.destIndex = t > drag.srcIndex ? t - 1 : t;
    if (drag.destIndex === drag.srcIndex) {
      drag.line.style.display = "none";
      return;
    }
    // Vertical line at boundary x, spanning the table's rect height.
    const ref = cells[Math.min(t, cells.length - 1)].getBoundingClientRect();
    const x = (t === cells.length) ? ref.right - 1
      : (t > drag.srcIndex ? cells[t - 1].getBoundingClientRect().right - 1
                           : cells[t].getBoundingClientRect().left - 1);
    const tr = table.getBoundingClientRect();
    placeAt(drag.line, { left: x, top: tr.top });
    drag.line.style.height = Math.round(tr.height) + "px";
    drag.line.style.display = "";
  }

  function onPointerMove(e) {
    trackPointer(e);
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!drag) return;
      if (drag.kind === "row") moveRowDrag(e);
      else moveColDrag(e);
    });
  }

  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove("nb-table-drag");
    try { d.grip.releasePointerCapture(d.pointerId); } catch (_) {}
    if (commit) {
      if (d.kind === "row") {
        NB.hybrid.moveRow(d.row, d.before);
      } else if (d.kind === "col" && d.destIndex !== null &&
                 d.destIndex !== d.srcIndex) {
        NB.hybrid.moveCol(activeTable, d.srcIndex, d.destIndex);
      }
    }
    clearOverlayDynamic();
    renderGrips();   // recompute after the move (or no-op cancel)
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(true);
  }
  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
  }

  // Escape cancels a drag; Ctrl+Z during a drag cancels it too (and
  // must NOT run hybrid's undo while the DOM is mid-state).
  function onDragKey(e) {
    if (!drag) return;
    if (e.key === "Escape" ||
        ((e.ctrlKey || e.metaKey) && (e.key || "").toLowerCase() === "z")) {
      e.preventDefault();
      e.stopPropagation();
      endDrag(false);
    }
  }

  /* --- reveal / hide ----------------------------------------------- */

  function hide() {
    if (drag) return;   // never wipe the overlay mid-drag
    activeTable = null;
    activeRowIndex = -1;
    activeColIndex = -1;
    overlay.textContent = "";
  }

  function reveal(table) {
    if (!enabled || !table || table === activeTable) return;
    clearTimeout(graceTimer);
    graceTimer = null;
    activeTable = table;
    renderGrips();
  }

  /* Compute the active row/column from the pointer position and
   * re-render ONLY when the line changed (hover costs must stay low:
   * this runs on every mousemove over a table). */
  function trackPointer(e) {
    if (!enabled || !activeTable || drag) return;
    if (controlHover) return;   // hover-intent lock (see below)
    const tableRows = Array.from(activeTable.rows);
    let ri = -1, ci = -1;
    // Body row whose y-range contains the pointer.
    for (let i = 1; i < tableRows.length; i++) {
      const r = tableRows[i].getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY < r.bottom) { ri = i - 1; break; }
    }
    const header = tableRows[0];
    if (header) {
      for (const cell of header.cells) {
        const r = cell.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX < r.right) { ci = cell.cellIndex; break; }
      }
    }
    if (ri !== activeRowIndex || ci !== activeColIndex) {
      activeRowIndex = ri;
      activeColIndex = ci;
      renderGrips();
    }
  }

  /* Derive the active line from the caret's cell (focus path: the
   * keyboard user's context follows the selection). */
  function trackCaret() {
    if (!enabled || !activeTable) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const cell = node && node.closest && node.closest("td,th");
    if (!cell || !activeTable.contains(cell)) return;
    const tableRows = Array.from(activeTable.rows);
    const ri = Array.from(cell.closest("tr").parentNode.children)
      .indexOf(cell.closest("tr"));
    const bodyIdx = ri - 1;   // row 0 is the header
    const ci = cell.cellIndex;
    if (bodyIdx !== activeRowIndex || ci !== activeColIndex) {
      activeRowIndex = bodyIdx;
      activeColIndex = ci;
      renderGrips();
    }
  }

  function scheduleHide() {
    if (drag) return;   // a drag owns the overlay until pointerup
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // Only hide when the pointer isn't resting on the overlay (i.e.
      // the user moved from a row onto its gutter grip).
      if (!overlay.matches(":hover")) hide();
    }, GRACE_MS);
  }

  /* Delegated listeners -- tables come and go constantly in hybrid
   * mode, so per-table listeners would leak. */
  function onOver(e) {
    if (!enabled) return;
    // Hover-intent lock: entering/leaving an overlay control must not
    // re-target the active line (moving diagonally onto a `+` must not
    // flip the pair to the neighbouring row).
    const onControl = e.target.closest &&
      e.target.closest(".nb-row-grip,.nb-col-grip,.nb-add-btn,.nb-del-btn,.nb-pair");
    const was = controlHover;
    controlHover = !!onControl;
    const t = e.target.closest && e.target.closest("#viewer-content table");
    if (t) reveal(t);
    if (!controlHover) trackPointer(e);
    else if (was !== controlHover) renderGrips();   // lock engaged: freeze
  }
  function onOut(e) {
    if (!enabled || !activeTable) return;
    const from = e.target.closest && e.target.closest("#viewer-content table");
    const to = e.relatedTarget && e.relatedTarget.closest &&
      e.relatedTarget.closest("#viewer-content table");
    if (from && from === activeTable && to !== activeTable) scheduleHide();
  }
  function onFocusIn(e) {
    if (!enabled) return;
    const t = e.target.closest && e.target.closest("#viewer-content table");
    if (t) reveal(t);
    trackCaret();
  }
  function onFocusOut(e) {
    if (!enabled || !activeTable) return;
    const from = e.target.closest && e.target.closest("#viewer-content table");
    const to = e.relatedTarget && e.relatedTarget.closest &&
      e.relatedTarget.closest("#viewer-content table");
    if (from && from === activeTable && !to) scheduleHide();
  }

  /* --- enable / disable -------------------------------------------- */

  function enable() {
    if (!viewerEl || !overlay || enabled) return;
    enabled = true;
    viewerEl.appendChild(overlay);
    viewerContentEl.addEventListener("mouseover", onOver);
    viewerContentEl.addEventListener("mouseout", onOut);
    viewerContentEl.addEventListener("focusin", onFocusIn);
    viewerContentEl.addEventListener("focusout", onFocusOut);
    viewerEl.addEventListener("pointermove", onPointerMove);
    viewerEl.addEventListener("pointerup", onPointerUp);
    viewerEl.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("keydown", onDragKey, true);
    viewerContentEl.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    if (drag) endDrag(false);
    clearTimeout(graceTimer);
    graceTimer = null;
    hide();
    viewerContentEl.removeEventListener("mouseover", onOver);
    viewerContentEl.removeEventListener("mouseout", onOut);
    viewerContentEl.removeEventListener("focusin", onFocusIn);
    viewerContentEl.removeEventListener("focusout", onFocusOut);
    viewerEl.removeEventListener("pointermove", onPointerMove);
    viewerEl.removeEventListener("pointerup", onPointerUp);
    viewerEl.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("keydown", onDragKey, true);
    viewerContentEl.removeEventListener("scroll", hide);
    window.removeEventListener("resize", hide);
  }

  function build() {
    viewerEl = document.getElementById("viewer");
    viewerContentEl = document.getElementById("viewer-content");
    if (!viewerEl || !viewerContentEl) return;
    overlay = el("div", "nb-table-overlay");
    overlay.hidden = false;   // visibility is CSS-driven; empty == invisible
    // The overlay is appended on enable() (a child of #viewer, outside
    // the contenteditable subtree) so preview mode never carries it.
  }

  build();

  NB.evt.on("hybrid:entered", () => { if (!overlay) build(); enable(); });
  NB.evt.on("hybrid:exited", disable);

  // Re-exported for tests (jsdom drives the module directly).
  NB.tableEdit = {
    get overlay() { return overlay; },
    get isEnabled() { return enabled; },
    get activeTable() { return activeTable; },
    reveal,
    hide,
    renderGrips,
    enable,
    disable,
    // Test hooks: set the active line (the pair target) directly.
    setActiveLine(rowIdx, colIdx) {
      activeRowIndex = rowIdx;
      activeColIndex = colIdx;
    },
    startRowDrag,     // test hook
    startColDrag,     // test hook
    get drag() { return drag; },
    _endDrag: endDrag,
  };
})();