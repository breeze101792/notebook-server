/* table-view.js -- hover/focus view controls for GFM tables in PREVIEW.
 *
 * Preview mode gets a toolbar over the table under the pointer or
 * containing focus: hide rows, hide columns, and a single-column sort.
 * The state is a per-file, per-table view overlay kept in localStorage
 * (`nb:tableView`) -- it is NEVER written to the note, never sent to
 * the server, and never appears in an export, because nothing here
 * touches the Markdown source or the serialization paths:
 *
 *   - Hiding is class-based only (`.nb-tv-hide-row` /
 *     `.nb-tv-hide-col`); no node is ever removed.
 *   - Sorting physically reorders the existing <tr> nodes (CSS cannot
 *     reorder table rows), so the DOM differs from the source while the
 *     controls are active. `hybrid:will-enter` is the last synchronous
 *     moment before contenteditable and the undo snapshot: tearDownForEdit()
 *     restores canonical source order and strips every view-only class
 *     and attribute there, so hybrid's turndown round-trip and undo
 *     snapshot never see the view state.
 *   - Live preview (`viewer:rendered` with `live:true`) must show the
 *     original table: sessions are dropped and never rebuilt there,
 *     because the textarea -- not the DOM -- is the source of truth.
 *
 * The overlay is a child of #viewer, deliberately OUTSIDE
 * #viewer-content (matching table-edit.js): turndown's clone and the
 * innerHTML undo snapshots never see the toolbar or popovers.
 *
 * Storage shape (versioned; a version mismatch discards the blob):
 *   { v: 1, files: { "<path>": { used, tables: { "<index>": {
 *       sig, used, sort: {col,dir}|absent, hiddenRows:[], hiddenCols:[]
 *   } } } } }
 * `sig` is the header cells' normalized text; if it differs from the
 * current table, the entry is STALE and is ignored (not applied, not
 * deleted) -- the table is a different table now.
 *
 * Known limitation: identity is positional index + header signature, so
 * two tables with identical headers cannot be told apart when a table is
 * inserted or removed above them.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const GRACE_MS = 120;        // hide delay after the pointer leaves a table
  const EDGE_SAFE = 4;         // min gap a control keeps from a #viewer edge
  const TOOLBAR_H = 28;        // fallback toolbar height before first measure
  const TOOLBAR_GAP = 8;       // table top -> toolbar bottom
  const TOOLBAR_MIN_W = 180;   // fallback toolbar width before first measure
  const POP_GAP = 4;           // anchor cell bottom -> popover top
  const POP_MIN_W = 180;       // fallback popover width before first measure
  const LABEL_MAX = 28;        // chars of a row/column label before the ellipsis
  const SIG_SEP = "\u0001";    // header signature separator

  const LS_KEY = "nb:tableView";       // localStorage namespace
  const SCHEMA_VERSION = 1;            // blob schema version
  const MAX_FILES = 50;                // LRU files kept in the blob
  const MAX_TABLES = 20;               // tables kept per file
  const MAX_BYTES = 100000;            // total serialized size guard

  const SORT_ASC = "ascending";
  const SORT_DESC = "descending";

  const HIDE_ROW_CLASS = "nb-tv-hide-row";
  const HIDE_COL_CLASS = "nb-tv-hide-col";

  const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  let viewerEl = null;         // #viewer: overlay host, position:relative
  let viewerContentEl = null;
  let overlay = null;          // .nb-tv-overlay
  let toolbar = null;          // .nb-tv-toolbar (persistent child of overlay)
  let sessions = new Map();    // tableEl -> session
  let activeTable = null;      // table whose toolbar is shown
  let openPop = null;          // open popover descriptor, or null
  let graceTimer = null;
  let lastRenderLive = false;  // last viewer:rendered was the live preview
  let lastPath = null;         // path of the last real render

  // Intl.Collator is comparatively expensive to build; create it once,
  // lazily, and reuse it for every non-numeric comparison.
  let collatorSvc = null;

  // In-memory mirror of the localStorage blob. Reloaded by load().
  let store = emptyStore();

  function emptyStore() { return { v: SCHEMA_VERSION, files: {} }; }

  /* --- tiny DOM helpers ------------------------------------------- */

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  /* Collapse whitespace runs to one space and trim, for signatures and
   * labels: marked's cell text may carry newlines / indentation. */
  function normText(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
  }

  /* Overlay-space rect helper: convert a viewport rect into the
   * overlay's coordinate space (subtract the #viewer origin once). */
  function toOverlay(rect) {
    const host = viewerEl.getBoundingClientRect();
    return { left: rect.left - host.left, top: rect.top - host.top,
             right: rect.right - host.left, bottom: rect.bottom - host.top,
             width: rect.width, height: rect.height };
  }

  function paneSize() {
    return { w: viewerEl.clientWidth, h: viewerEl.clientHeight };
  }

  function getCollator() {
    if (!collatorSvc) {
      collatorSvc = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    }
    return collatorSvc;
  }

  function notify(message) {
    if (NB.app && NB.app.notify) NB.app.notify(message);
  }

  /* --- storage ---------------------------------------------------- */

  /* Tolerant load: any malformed blob (bad JSON, wrong version, missing
   * `files`) is discarded and replaced with a fresh store, matching the
   * windows.js pattern. */
  function loadStore() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return emptyStore();
      const blob = JSON.parse(raw);
      if (!blob || blob.v !== SCHEMA_VERSION ||
          typeof blob.files !== "object" || blob.files === null) {
        return emptyStore();
      }
      return { v: SCHEMA_VERSION, files: blob.files };
    } catch (e) {
      return emptyStore();
    }
  }

  /* A record entry that is not an object (corrupt blob) is skipped or
   * dropped rather than dereferenced: a crash here would make persist()'s
   * catch swallow the write entirely. */
  function isRecord(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  /* Drop the oldest per-file entries first (LRU by `.used`), then the
   * oldest tables inside a file. Bounds storage so a long-lived notebook
   * with many one-off view customizations cannot grow without limit. */
  function prune() {
    const files = store.files;
    Object.keys(files).forEach((p) => {
      const f = files[p];
      if (!isRecord(f) || !isRecord(f.tables)) {
        if (!isRecord(f)) delete files[p];
        return;
      }
      const idxs = Object.keys(f.tables);
      if (idxs.length <= MAX_TABLES) return;
      idxs.sort((a, b) => {
        const ta = isRecord(f.tables[a]) ? f.tables[a].used : 0;
        const tb = isRecord(f.tables[b]) ? f.tables[b].used : 0;
        return (ta || 0) - (tb || 0);
      });
      idxs.slice(0, idxs.length - MAX_TABLES).forEach((i) => delete f.tables[i]);
    });
    const paths = Object.keys(files);
    if (paths.length > MAX_FILES) {
      paths.sort((a, b) => {
        const fa = isRecord(files[a]) ? files[a].used : 0;
        const fb = isRecord(files[b]) ? files[b].used : 0;
        return (fa || 0) - (fb || 0);
      });
      paths.slice(0, paths.length - MAX_FILES).forEach((p) => delete files[p]);
    }
  }

  /* Serialize with a hard size guard: when the blob exceeds MAX_BYTES,
   * drop the least-recently-used file records until it fits. */
  function serialize() {
    prune();
    let raw = JSON.stringify(store);
    if (raw.length <= MAX_BYTES) return raw;
    const paths = Object.keys(store.files);
    paths.sort((a, b) => {
      const fa = isRecord(store.files[a]) ? store.files[a].used : 0;
      const fb = isRecord(store.files[b]) ? store.files[b].used : 0;
      return (fa || 0) - (fb || 0);
    });
    for (const p of paths) {
      delete store.files[p];
      raw = JSON.stringify(store);
      if (raw.length <= MAX_BYTES) break;
    }
    return raw;
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, serialize()); } catch (e) { /* ignore */ }
  }

  /* Re-read the blob from localStorage. Returns the in-memory store so
   * tests can inspect it after a reload. */
  function load() {
    store = loadStore();
    return store;
  }

  function getState(path, index) {
    const f = store.files[path];
    if (!f || typeof f.tables !== "object" || f.tables === null) return null;
    return f.tables[String(index)] || null;
  }

  /* Re-key every record at or under `from` when a file OR folder is
   * moved/renamed. A folder move emits the directory path, so nested
   * `dir/note.md` records must be re-keyed too, or they are orphaned. */
  function renameFile(from, to) {
    if (!from || !to || from === to) return;
    const prefix = from + "/";
    let touched = false;
    Object.keys(store.files).forEach((p) => {
      if (p !== from && p.indexOf(prefix) !== 0) return;
      const f = store.files[p];
      delete store.files[p];
      store.files[to + p.slice(from.length)] = f;
      touched = true;
    });
    if (touched) persist();
  }

  /* Forget a deleted file's record, and every record under a deleted
   * folder (the event's path is the directory for folder deletes). */
  function pruneFile(path) {
    if (!path) return;
    const prefix = path + "/";
    let touched = false;
    Object.keys(store.files).forEach((p) => {
      if (p !== path && p.indexOf(prefix) !== 0) return;
      delete store.files[p];
      touched = true;
    });
    if (touched) persist();
  }

  function fileRecord(path) {
    let rec = store.files[path];
    if (!isRecord(rec)) { rec = { used: Date.now(), tables: {} }; store.files[path] = rec; }
    if (!isRecord(rec.tables)) rec.tables = {};
    return rec;
  }

  /* --- session capture -------------------------------------------- */

  /* Build the per-table session, or null when the table is ineligible.
   * Ineligible means: not exactly one <tbody>, or merged cells (GFM
   * cannot express spans, so hiding/sorting would be a lie). The body
   * cell text is cached HERE, once; sorting must never re-read it. */
  function buildSession(table, index) {
    if (!table || table.tBodies.length !== 1) return null;
    if (NB.hybrid && NB.hybrid.tableHasSpans && NB.hybrid.tableHasSpans(table)) {
      return null;
    }
    const header = (table.tHead && table.tHead.rows[0]) ? table.tHead.rows[0]
                                                        : table.rows[0];
    if (!header) return null;
    const tbody = table.tBodies[0];
    const sourceRows = Array.from(tbody.rows);
    const keys = sourceRows.map((row) => {
      const arr = [];
      Array.from(row.cells).forEach((cell) => {
        arr[cell.cellIndex] = normText(cell.textContent);
      });
      return arr;
    });
    const sig = Array.from(header.cells)
      .map((c) => normText(c.textContent)).join(SIG_SEP);
    // Header cells are the keyboard path into the controls; hybrid's
    // teardown strips these before the DOM can be edited.
    Array.from(header.cells).forEach((c) => c.setAttribute("tabindex", "0"));
    return { index, header, tbody, sourceRows, keys, sig };
  }

  /* --- applying view state ---------------------------------------- */

  function hideRows(session, set) {
    session.sourceRows.forEach((row, i) => {
      row.classList.toggle(HIDE_ROW_CLASS, set.has(i));
    });
  }

  function hideCols(session, set) {
    const table = session.tbody.closest("table");
    if (!table) return;
    Array.from(table.rows).forEach((row) => {
      Array.from(row.cells).forEach((cell) => {
        cell.classList.toggle(HIDE_COL_CLASS, set.has(cell.cellIndex));
      });
    });
  }

  function setColumnHidden(session, col, hidden) {
    const table = session.tbody.closest("table");
    if (!table) return;
    Array.from(table.rows).forEach((row) => {
      const cell = row.cells[col];
      if (cell) cell.classList.toggle(HIDE_COL_CLASS, hidden);
    });
  }

  /* The active sort is stored on the DOM (the single header cell with
   * aria-sort), so the session object stays exactly the captured shape
   * and the state is always readable, even mid-flight. */
  function readSort(session) {
    const cells = Array.from(session.header.cells);
    for (let i = 0; i < cells.length; i++) {
      const dir = cells[i].getAttribute("aria-sort");
      if (dir === SORT_ASC || dir === SORT_DESC) return { col: i, dir };
    }
    return null;
  }

  /* aria-sort belongs ONLY on the active sorted header; every other
   * header cell has it removed. */
  function refreshHeaderAttrs(session, sort) {
    Array.from(session.header.cells).forEach((cell, i) => {
      if (sort && sort.col === i) cell.setAttribute("aria-sort", sort.dir);
      else cell.removeAttribute("aria-sort");
    });
  }

  /* Order two cached keys. Empties sort LAST in BOTH directions (the
   * direction multiplier is never applied to them). A column is numeric
   * iff BOTH non-empty keys are numeric; otherwise the collator is used
   * (which handles mixed content naturally). */
  function compareEntries(a, b, dir) {
    const ak = a.key, bk = b.key;
    const aEmpty = ak === "", bEmpty = bk === "";
    if (aEmpty && bEmpty) return a.src - b.src;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    let c = 0;
    if (NUM_RE.test(ak) && NUM_RE.test(bk)) {
      const d = parseFloat(ak) - parseFloat(bk);
      c = d < 0 ? -1 : (d > 0 ? 1 : 0);
    }
    if (c === 0) c = getCollator().compare(ak, bk);
    if (c !== 0) return (dir === SORT_DESC ? -1 : 1) * (c < 0 ? -1 : 1);
    return a.src - b.src;   // stable tiebreak on captured source index
  }

  /* Reorder the body rows. `sort` is {col,dir} or null (restore source
   * order). Rows move physically because CSS cannot reorder table rows;
   * the cached keys are used, never the live cell text. */
  function sortRows(session, sort) {
    const col = sort ? sort.col : -1;
    const entries = session.sourceRows.map((row, i) => {
      const key = (col >= 0 && session.keys[i] && session.keys[i][col] != null)
        ? session.keys[i][col] : "";
      return { row, src: i, key };
    });
    if (sort) entries.sort((a, b) => compareEntries(a, b, sort.dir));
    else entries.sort((a, b) => a.src - b.src);
    entries.forEach((e) => session.tbody.appendChild(e.row));
  }

  /* Apply a stored entry to a freshly built session. A signature
   * mismatch means the table changed identity (rows/columns edited):
   * the entry is IGNORED but deliberately NOT deleted -- a transient or
   * reverted edit must not destroy the user's saved view. Out-of-range
   * indices are ignored; in-range ones still apply. */
  function applyState(table, session, state) {
    if (!session || !state) return;
    if (state.sig !== session.sig) return;
    const rowCount = session.sourceRows.length;
    const colCount = session.header.cells.length;
    const rowSet = new Set((state.hiddenRows || [])
      .filter((n) => Number.isInteger(n) && n >= 0 && n < rowCount));
    const colSet = new Set((state.hiddenCols || [])
      .filter((n) => Number.isInteger(n) && n >= 0 && n < colCount));
    hideRows(session, rowSet);
    hideCols(session, colSet);
    let sort = null;
    if (state.sort && Number.isInteger(state.sort.col) &&
        state.sort.col >= 0 && state.sort.col < colCount &&
        (state.sort.dir === SORT_ASC || state.sort.dir === SORT_DESC)) {
      sort = { col: state.sort.col, dir: state.sort.dir };
    }
    refreshHeaderAttrs(session, sort);
    sortRows(session, sort);
  }

  /* Read the DOM back into a persistable entry. */
  function readState(session) {
    const sort = readSort(session);
    const hiddenRows = [];
    session.sourceRows.forEach((row, i) => {
      if (row.classList.contains(HIDE_ROW_CLASS)) hiddenRows.push(i);
    });
    const hiddenCols = [];
    Array.from(session.header.cells).forEach((cell, i) => {
      if (cell.classList.contains(HIDE_COL_CLASS)) hiddenCols.push(i);
    });
    const st = { sig: session.sig, used: Date.now(), hiddenRows, hiddenCols };
    if (sort) st.sort = { col: sort.col, dir: sort.dir };
    return st;
  }

  function saveSessionState(path, session) {
    if (!path || !session) return;
    const rec = fileRecord(path);
    rec.used = Date.now();
    rec.tables[String(session.index)] = readState(session);
    persist();
  }

  /* Restore a session to its canonical form: no hidden rows/columns, no
   * sort, source row order. Used by both resetTable() and the hybrid
   * teardown (where it MUST run synchronously). */
  function revertTable(sessionOrTable) {
    const session = (sessionOrTable && sessionOrTable.sourceRows)
      ? sessionOrTable : sessions.get(sessionOrTable);
    if (!session) return;
    hideRows(session, new Set());
    hideCols(session, new Set());
    refreshHeaderAttrs(session, null);
    sortRows(session, null);
  }

  function resetTable(table) {
    const session = sessions.get(table);
    if (!session) return;
    revertTable(session);
    if (lastPath && store.files[lastPath] && store.files[lastPath].tables) {
      delete store.files[lastPath].tables[String(session.index)];
    }
    persist();
    closePop();
  }

  /* --- overlay geometry ------------------------------------------- */

  /* Position the toolbar above the table's CONTENT, anchored to cell
   * rects (the <table> box is display:block and full width, so its rect
   * would strand the toolbar at the pane edge). Top-clipping falls back
   * to the pane's top edge rather than off-screen. */
  function placeToolbar(table) {
    if (!toolbar) return;
    toolbar.hidden = false;
    const session = sessions.get(table);
    const header = (session && session.header) ||
      (table.tHead && table.tHead.rows[0]) || table.rows[0];
    let contentLeft = Infinity, contentTop = Infinity;
    if (header) {
      Array.from(header.cells).forEach((cell) => {
        const r = toOverlay(cell.getBoundingClientRect());
        contentLeft = Math.min(contentLeft, r.left);
        contentTop = Math.min(contentTop, r.top);
      });
    }
    if (!isFinite(contentLeft)) {
      const r = toOverlay((header || table).getBoundingClientRect());
      contentLeft = r.left;
      contentTop = r.top;
    }
    const V = paneSize();
    const w = toolbar.offsetWidth || TOOLBAR_MIN_W;
    const h = toolbar.offsetHeight || TOOLBAR_H;
    let left = clamp(contentLeft, EDGE_SAFE, V.w - w - EDGE_SAFE);
    let top = contentTop - h - TOOLBAR_GAP;
    if (top < EDGE_SAFE) top = EDGE_SAFE;   // top-clipping fallback
    toolbar.style.left = Math.round(left) + "px";
    toolbar.style.top = Math.round(top) + "px";
  }

  /* Position a popover below its anchor cell (or toolbar button),
   * clamped into the pane; flip above when it would overflow the bottom
   * of the pane. */
  function placePopover(anchor, pop) {
    const r = toOverlay(anchor.getBoundingClientRect());
    const V = paneSize();
    const w = pop.offsetWidth || POP_MIN_W;
    const h = pop.offsetHeight || 0;
    const left = clamp(r.left, EDGE_SAFE, V.w - w - EDGE_SAFE);
    let top = r.bottom + POP_GAP;
    if (top + h > V.h - EDGE_SAFE) {
      const above = r.top - h - POP_GAP;
      top = above >= EDGE_SAFE ? above
                               : Math.max(EDGE_SAFE, V.h - h - EDGE_SAFE);
    }
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  /* --- toolbar + popovers ----------------------------------------- */

  function mkBtn(label, title) {
    const b = el("button", "nb-tv-btn");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title || label);
    return b;
  }

  function buildToolbar() {
    if (!toolbar) return;
    toolbar.textContent = "";
    const rowsBtn = mkBtn("Rows", "Choose visible rows");
    rowsBtn.setAttribute("aria-haspopup", "true");
    rowsBtn.setAttribute("aria-expanded", "false");
    rowsBtn.addEventListener("click", (e) => { e.stopPropagation(); openChooser("rows", rowsBtn); });
    const colsBtn = mkBtn("Columns", "Choose visible columns");
    colsBtn.setAttribute("aria-haspopup", "true");
    colsBtn.setAttribute("aria-expanded", "false");
    colsBtn.addEventListener("click", (e) => { e.stopPropagation(); openChooser("cols", colsBtn); });
    const resetBtn = mkBtn("Reset", "Reset table view (sort + hidden rows/columns)");
    resetBtn.classList.add("nb-tv-reset");
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const table = activeTable;
      if (table) resetTable(table);
    });
    toolbar.append(rowsBtn, colsBtn, resetBtn);
  }

  function closePop() {
    if (!openPop) return;
    if (openPop.el && openPop.el.parentNode) openPop.el.remove();
    // Remove, never set false: a header cell must not carry any
    // view-only attribute (even a stale false) into the editable DOM.
    if (openPop.anchor && openPop.anchor.removeAttribute) {
      openPop.anchor.removeAttribute("aria-expanded");
    }
    openPop = null;
  }

  function hideToolbar() {
    if (!toolbar) return;
    toolbar.hidden = true;
    toolbar.textContent = "";
  }

  /* A checkbox menu row: label text, live-applied on change. */
  function menuCheckbox(label, checked, onChange) {
    const wrap = el("label", "nb-tv-item is-check");
    const input = el("input", "");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked, input));
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(input, span);
    return wrap;
  }

  function menuRadio(label, checked) {
    const b = el("button", "nb-tv-item");
    b.type = "button";
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", checked ? "true" : "false");
    b.textContent = label;
    return b;
  }

  function visibleColCount(session) {
    return Array.from(session.header.cells)
      .filter((c) => !c.classList.contains(HIDE_COL_CLASS)).length;
  }

  /* The header popover: explicit sort actions plus "Hide this column".
   * Exactly one radio is checked, mirroring the live sort state. */
  function openHeaderPop(table, session, cell, col, focusFirst) {
    closePop();
    const pop = el("div", "nb-tv-pop");
    pop.setAttribute("role", "menu");
    const cur = readSort(session);
    const onCol = cur && cur.col === col;
    const radios = {};
    const add = (key, label, dir, act) => {
      const b = menuRadio(label, onCol && cur.dir === dir);
      b.addEventListener("click", (e) => { e.stopPropagation(); act(); });
      radios[key] = { el: b, dir };
      pop.appendChild(b);
    };
    add("asc", "Sort ascending", SORT_ASC, () => setSort(table, session, col, SORT_ASC));
    add("desc", "Sort descending", SORT_DESC, () => setSort(table, session, col, SORT_DESC));
    add("clear", "Clear sort", null, () => setSort(table, session, col, null));
    const hide = menuRadio("Hide this column", cell.classList.contains(HIDE_COL_CLASS));
    hide.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!cell.classList.contains(HIDE_COL_CLASS) && visibleColCount(session) <= 1) {
        notify("At least one column must stay visible");
        return;
      }
      setColumnHidden(session, col, true);
      saveSessionState(lastPath, session);
      closePop();
    });
    pop.appendChild(hide);
    overlay.appendChild(pop);
    openPop = { table, col, kind: "header", el: pop, anchor: cell, radios };
    cell.setAttribute("aria-expanded", "true");
    placePopover(cell, pop);
    if (focusFirst) {
      const first = pop.querySelector("button");
      if (first) first.focus({ preventScroll: true });
    }
  }

  /* The rows/columns chooser: a live-applied checkbox per line. Rows
   * lists BODY rows only (the header can never be hidden); columns
   * lists every header column. */
  function openChooser(kind, anchor) {
    const table = activeTable;
    const session = table && sessions.get(table);
    if (!session) return;
    if (openPop && openPop.kind === kind && openPop.anchor === anchor) {
      closePop();
      return;
    }
    closePop();
    const pop = el("div", "nb-tv-pop");
    pop.setAttribute("role", "menu");
    if (kind === "rows") {
      if (!session.sourceRows.length) {
        const note = el("div", "nb-tv-empty");
        note.textContent = "No body rows";
        pop.appendChild(note);
      }
      session.sourceRows.forEach((row, i) => {
        const first = row.cells[0];
        const label = "#" + (i + 1) + " \u2014 " +
          truncate(normText(first ? first.textContent : ""), LABEL_MAX);
        pop.appendChild(menuCheckbox(label, row.classList.contains(HIDE_ROW_CLASS),
          (checked) => {
            row.classList.toggle(HIDE_ROW_CLASS, checked);
            saveSessionState(lastPath, session);
          }));
      });
    } else {
      Array.from(session.header.cells).forEach((cell, i) => {
        const label = "#" + (i + 1) + " \u2014 " +
          truncate(normText(cell.textContent), LABEL_MAX);
        pop.appendChild(menuCheckbox(label, cell.classList.contains(HIDE_COL_CLASS),
          (checked, input) => {
            if (checked && visibleColCount(session) <= 1) {
              notify("At least one column must stay visible");
              input.checked = false;
              return;
            }
            setColumnHidden(session, i, checked);
            saveSessionState(lastPath, session);
          }));
      });
    }
    overlay.appendChild(pop);
    openPop = { table, col: -1, kind, el: pop, anchor };
    anchor.setAttribute("aria-expanded", "true");
    placePopover(anchor, pop);
  }

  function refreshPopRadios(open) {
    const radios = open.radios;
    if (!radios) return;
    const session = sessions.get(open.table);
    if (!session) return;
    const cur = readSort(session);
    const onCol = cur && cur.col === open.col;
    Object.keys(radios).forEach((key) => {
      const entry = radios[key];
      const checked = onCol && cur.dir === entry.dir;
      entry.el.setAttribute("aria-checked", checked ? "true" : "false");
    });
  }

  /* Apply a sort (or clear it) to one table, persist, and resync the
   * open popover's radios. There is only ever ONE sorted column. */
  function setSort(table, session, col, dir) {
    const sort = dir ? { col, dir } : null;
    refreshHeaderAttrs(session, sort);
    sortRows(session, sort);
    saveSessionState(lastPath, session);
    if (openPop && openPop.table === table && openPop.kind === "header") {
      refreshPopRadios(openPop);
    }
  }

  /* Cycle the clicked column: none -> asc -> desc -> none. Clicking a
   * DIFFERENT header replaces the sort (ascending); the caller decides
   * which of those two branches runs. Returns the applied direction. */
  function cycleSort(table, col) {
    const session = sessions.get(table);
    if (!session) return null;
    const cur = readSort(session);
    let dir;
    if (cur && cur.col === col) dir = (cur.dir === SORT_DESC) ? null : SORT_DESC;
    else dir = SORT_ASC;
    setSort(table, session, col, dir);
    return dir;
  }

  /* --- reveal / hide ---------------------------------------------- */

  function canInteract(table) {
    return !!table && !lastRenderLive &&
      !(NB.hybrid && NB.hybrid.isActive()) &&
      !!viewerEl && !viewerEl.hidden &&
      sessions.has(table);
  }

  function hide() {
    closePop();
    hideToolbar();
    activeTable = null;
    if (overlay) {
      overlay.querySelectorAll(".nb-tv-note,.nb-tv-pop").forEach((n) => n.remove());
    }
  }

  function scheduleHide() {
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // Only hide when the pointer isn't resting on the overlay (moving
      // from a table onto its toolbar must not dismiss the controls).
      if (!overlay.matches(":hover") && !openPop) hide();
    }, GRACE_MS);
  }

  /* Anchor the merged-cell note to the table's rect (it has no session
   * and no toolbar, so this is the only control it gets). */
  function placeNote(table) {
    const note = overlay && overlay.querySelector(".nb-tv-note");
    if (!note) return;
    const host = viewerEl.getBoundingClientRect();
    const r = table.getBoundingClientRect();
    note.style.left = Math.round(r.left - host.left) + "px";
    note.style.top = Math.round(r.top - host.top) + "px";
  }

  function reveal(table) {
    if (!viewerEl || !viewerContentEl || !table) return;
    if (lastRenderLive || (NB.hybrid && NB.hybrid.isActive()) || viewerEl.hidden) return;
    // Merged cells: no controls. Show the same kind of note table-edit
    // shows, anchored to the table's rect (there is no session).
    if (NB.hybrid && NB.hybrid.tableHasSpans && NB.hybrid.tableHasSpans(table)) {
      if (activeTable === table && !toolbar.hidden) return;
      hideToolbar();
      activeTable = table;
      if (!overlay.querySelector(".nb-tv-note")) {
        const note = el("div", "nb-tv-note");
        note.textContent = "Merged cells: table view controls are unavailable";
        overlay.appendChild(note);
      }
      placeNote(table);
      return;
    }
    if (!canInteract(table)) return;
    if (activeTable === table && !toolbar.hidden) return;
    overlay.querySelectorAll(".nb-tv-note").forEach((n) => n.remove());
    activeTable = table;
    buildToolbar();
    placeToolbar(table);
  }

  /* Last synchronous moment before contenteditable and the undo
   * snapshot: restore canonical row order, strip every view-only class
   * and attribute, clear the overlay. Idempotent. Storage is untouched. */
  function tearDownForEdit() {
    closePop();
    hideToolbar();
    sessions.forEach((session) => {
      revertTable(session);
      Array.from(session.header.cells).forEach((cell) => {
        cell.removeAttribute("tabindex");
        cell.removeAttribute("aria-sort");
      });
    });
    sessions.clear();
    activeTable = null;
    if (overlay) {
      overlay.querySelectorAll(".nb-tv-note,.nb-tv-pop").forEach((n) => n.remove());
    }
  }

  /* --- event handlers --------------------------------------------- */

  /* Rebuild the per-table sessions after every REAL render, applying
   * whatever the user stored for this file. Live preview must restore
   * the original table, so it drops sessions instead. */
  function onRendered(ev) {
    const path = ev && ev.path;
    const live = !!(ev && ev.live);
    // An active hybrid session means the DOM is (or is about to become)
    // editable: a REAL render firing here (reload button, ai:applied,
    // watcher external change) must not re-apply sorted row order or hide
    // classes after the hybrid:will-enter teardown, or turndown/autosave
    // could serialize them. Treat it exactly like the live preview.
    const editActive = NB.hybrid && NB.hybrid.isActive();
    closePop();
    hideToolbar();
    lastRenderLive = live;
    lastPath = path || null;
    if (live || editActive || !path) {
      sessions.clear();
      activeTable = null;
      if (overlay) overlay.querySelectorAll(".nb-tv-note,.nb-tv-pop").forEach((n) => n.remove());
      return;
    }
    sessions.clear();
    let touched = false;
    const tables = Array.from(viewerContentEl.querySelectorAll("table"));
    tables.forEach((table, index) => {
      const session = buildSession(table, index);
      if (!session) return;
      sessions.set(table, session);
      // Only files the user has used controls on have a record; opening
      // a file must not create one.
      const rec = store.files[path];
      const st = rec && rec.tables ? rec.tables[String(index)] : null;
      if (st) {
        applyState(table, session, st);
        st.used = Date.now();
        rec.used = Date.now();
        touched = true;
      }
    });
    if (touched) persist();
  }

  function onOver(e) {
    if (!e.target.closest) return;
    const t = e.target.closest("#viewer-content table");
    if (t) reveal(t);
    // Keep the merged-cell note glued to the table as the pane scrolls
    // (the note has no session, so nothing else re-anchors it).
    if (overlay && overlay.querySelector(".nb-tv-note") && activeTable) {
      placeNote(activeTable);
    }
  }

  function onOut(e) {
    if (!activeTable) return;
    const from = e.target.closest && e.target.closest("#viewer-content table");
    const to = e.relatedTarget && e.relatedTarget.closest &&
      e.relatedTarget.closest("#viewer-content table");
    if (from && from === activeTable && to !== activeTable) scheduleHide();
  }

  function onFocusIn(e) {
    if (!e.target.closest) return;
    const t = e.target.closest("#viewer-content table");
    if (t) reveal(t);
  }

  function onFocusOut(e) {
    if (!activeTable) return;
    const from = e.target.closest && e.target.closest("#viewer-content table");
    const to = e.relatedTarget && e.relatedTarget.closest &&
      e.relatedTarget.closest("#viewer-content table");
    if (!from || from !== activeTable) return;
    const focusOnOverlay = e.relatedTarget && overlay && overlay.contains(e.relatedTarget);
    if (!to && !focusOnOverlay) scheduleHide();
  }

  /* A click/keypress only controls the table when it lands on a cell of
   * the table's HEADER row: body cells (<td>) are plain note content and
   * must never sort or open a popover. Returns the session when `cell`
   * belongs to the header row, else null. */
  function headerCell(table, cell) {
    const session = sessions.get(table);
    if (!session || cell.cellIndex < 0) return null;
    return Array.from(session.header.cells).indexOf(cell) !== -1 ? session : null;
  }

  /* Header click: a new header opens its popover and sorts ascending;
   * a repeated click on the same header advances the cycle while the
   * popover stays open. Clicks on real content (links, buttons, inputs)
   * inside the cell are left alone. */
  function onHeaderClick(e) {
    if (e.target.closest && e.target.closest("a,button,input")) return;
    const cell = e.target.closest && e.target.closest("th,td");
    if (!cell || !cell.closest) return;
    const table = cell.closest("table");
    const session = headerCell(table, cell);
    if (!session) return;
    const col = cell.cellIndex;
    if (openPop && openPop.table === table && openPop.kind === "header" &&
        openPop.col === col) {
      cycleSort(table, col);
    } else {
      openHeaderPop(table, session, cell, col, false);
      setSort(table, session, col, SORT_ASC);
    }
  }

  function onHeaderKey(e) {
    if (e.target.closest && e.target.closest("a,button,input")) return;
    const cell = e.target.closest && e.target.closest("th,td");
    if (!cell || !cell.closest) return;
    const table = cell.closest("table");
    const session = headerCell(table, cell);
    if (!session) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();   // Space must not scroll the pane
      if (openPop && openPop.kind === "header" && openPop.table === table &&
          openPop.col === cell.cellIndex) {
        closePop();
      } else {
        openHeaderPop(table, session, cell, cell.cellIndex, true);
      }
    }
  }

  /* Outside pointerdown closes an open popover; a pointerdown on its
   * anchor is exempt so the anchor's click handler can cycle the sort. */
  function onDocPointerDown(e) {
    if (!openPop) return;
    if (openPop.el && openPop.el.contains(e.target)) return;
    if (openPop.anchor && openPop.anchor.contains(e.target)) return;
    closePop();
  }

  function onDocKey(e) {
    if (!openPop || e.key !== "Escape") return;
    e.preventDefault();
    const anchor = openPop.anchor;
    closePop();
    if (anchor && anchor.focus) anchor.focus({ preventScroll: true });
  }

  /* --- build / wire ----------------------------------------------- */

  function build() {
    viewerEl = document.getElementById("viewer");
    viewerContentEl = document.getElementById("viewer-content");
    if (!viewerEl || !viewerContentEl) return;
    overlay = el("div", "nb-tv-overlay");
    toolbar = el("div", "nb-tv-toolbar");
    toolbar.hidden = true;
    overlay.appendChild(toolbar);
    // A child of #viewer, outside the contenteditable subtree: preview
    // mode owns it, hybrid teardown clears it.
    viewerEl.appendChild(overlay);

    NB.evt.on("viewer:rendered", onRendered);
    NB.evt.on("hybrid:will-enter", tearDownForEdit);
    NB.evt.on("hybrid:entered", tearDownForEdit);
    NB.evt.on("file:moved", ({ from, to }) => renameFile(from, to));
    NB.evt.on("file:deleted", (path) => pruneFile(path));

    viewerContentEl.addEventListener("mouseover", onOver);
    viewerContentEl.addEventListener("mouseout", onOut);
    viewerContentEl.addEventListener("focusin", onFocusIn);
    viewerContentEl.addEventListener("focusout", onFocusOut);
    viewerContentEl.addEventListener("click", onHeaderClick);
    viewerContentEl.addEventListener("keydown", onHeaderKey);
    // Positions are rect-based and drift on scroll; the cheapest correct
    // behaviour is to hide and re-reveal on the next interaction.
    viewerContentEl.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKey);
  }

  store = loadStore();
  build();

  NB.tableView = {
    reveal,
    hide,
    hideToolbar,
    onRendered,
    applyState,
    revertTable,
    resetTable,
    tearDownForEdit,
    cycleSort,
    canInteract,
    get activeTable() { return activeTable; },
    get sessions() { return sessions; },
    get lastRenderLive() { return lastRenderLive; },
    getState,
    _storage: {
      load,
      persist,
      renameFile,
      pruneFile,
      get store() { return store; },
    },
  };
})();
