/* list-editor.js -- the Edit list window: one list container of a hybrid
 * (WYSIWYG) note, managed as a multi-select treegrid.
 *
 * The window works on the live rows in its own view: open() reads the
 * container into a flat model, every verb reorders that model only, and
 * nothing in the note moves until Apply. Apply mutates the live container
 * IN PLACE -- commitPlan() moves the existing <li> nodes and creates or
 * removes wrapper nodes inside the live container, so every <ul>/<ol>
 * keeps its identity, its start/reversed/type and every authored
 * attribute, and one Apply is one note-level undo step.
 *
 * Two invariants surprise:
 *   - A no-op Apply writes nothing. The check is a structural signature
 *     (row ids in order with their depths, the wrappers' ids/tags/attrs,
 *     the done map) taken at open and again at Apply -- never a "changed"
 *     flag -- so move-down-then-up writes no file and adds no undo entry.
 *   - Stale is the only read-only state. It is node identity, not
 *     content: when #viewer-content no longer contains the container the
 *     window keeps its rows, shows the notice strip, disables every tool
 *     and Apply, and writes nothing.
 *
 * The overlay is static markup in index.html and carries .settings-overlay,
 * so NB.dialog owns focus containment and NB.windows owns drag/resize. The
 * history is the shared NB.editWindow stack (window-local, never a note
 * write). Entry point: the hybrid context menu's "Edit list..." item.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Sort collation mirrors the table editor: numeric-aware text compare
  // with an explicit stable tiebreak.
  const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

  const EMPTY_LABEL = "Empty item";
  const BULLET = "\u2022";
  const ZERO_WIDTH = /\u200B/g;
  const WHITESPACE = /\s+/g;
  const CHROME_STRIP = "ul,ol,input,[contenteditable=\"false\"]";

  const BASE_MARK_W = 20;      // the --le-mark-w stylesheet default, px
  const MARK_GAP = 4;          // px added to the widest visible marker
  const MARK_MIN_CSS = "20px"; // mirrors the stylesheet's --le-mark-w
  const MARK_CAP_CSS = "calc(3ch + 2px)";

  const DEFAULT_ROMAN = 3999;  // beyond this an ordinal falls back to decimal

  const CHEV_SVG =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';

  const STALE_STATUS =
    "This list changed outside the window. Nothing was applied.";
  const STALE_CAUSE = "This list changed outside the window.";
  const NOT_RESTORED = "The saved state could not be restored";
  const APPLY_FAILED = "Could not apply — the list was not changed";

  const REASON = {
    first: "Every selected item is already first.",
    last: "Every selected item is already last.",
    oneLevelTop: "To top needs the selected items to share one level.",
    oneLevelBottom: "To bottom needs the selected items to share one level.",
    atTop: "The selected items are already at the top.",
    atBottom: "The selected items are already at the bottom.",
    indentEdge: "The first item in a group cannot indent.",
    outdentEdge: "Top-level items cannot outdent.",
    sortSmall: "Nothing to sort in this level.",
    noDone: "No done items to move.",
    nothingToSelect: "Nothing to select.",
    nothingSelected: "Nothing is selected.",
    noTask: "Only task items have a done state.",
    noneDone: "No task item is done.",
    nothingToDelete: "Nothing to delete.",
  };

  // id, accessible base name and chord, in the shipped toolbar order.
  const TOOLS = [
    { id: "le-move-up", name: "Move up", chord: "Alt+↑" },
    { id: "le-move-down", name: "Move down", chord: "Alt+↓" },
    { id: "le-move-top", name: "To top", chord: "Alt+Shift+↑" },
    { id: "le-move-bottom", name: "To bottom", chord: "Alt+Shift+↓" },
    { id: "le-outdent", name: "Outdent", chord: "Shift+Tab" },
    { id: "le-indent", name: "Indent", chord: "Tab" },
    { id: "le-sort-asc", name: "Sort A to Z", chord: "Alt+Shift+A" },
    { id: "le-sort-desc", name: "Sort Z to A", chord: "Alt+Shift+Z" },
    { id: "le-sort-done", name: "Done to bottom", chord: "Alt+Shift+B" },
    { id: "le-select-all", name: "Select all", chord: "Ctrl/Cmd+A" },
    { id: "le-select-none", name: "Select none", chord: "Ctrl/Cmd+Shift+A" },
    { id: "le-mark-done", name: "Mark done", chord: "Alt+Shift+D" },
    { id: "le-mark-open", name: "Mark open", chord: "Alt+Shift+O" },
    { id: "le-delete", name: "Delete", chord: "Delete" },
  ];

  let overlayEl = null;
  let gridEl = null;
  let noticeEl = null;
  let statusEl = null;
  let emptyEl = null;
  let typeEl = null;
  let toolbarEl = null;
  let applyBtn = null;
  let cancelBtn = null;
  let hist = null;

  let viewerContentEl = null;
  let state = null;
  let stale = false;

  /* --- DOM helpers -------------------------------------------------- */

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  function count(n, noun) { return n + " " + noun + (n === 1 ? "" : "s"); }

  function focusableIn(scope) {
    if (!scope) return [];
    return Array.from(
      scope.querySelectorAll("button, [href], input, select, textarea")
    ).filter((node) => !node.disabled && !node.hidden &&
      node.getAttribute("aria-disabled") !== "true");
  }

  function placeCaret(node, atEnd) {
    if (!node) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(!atEnd);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function focusViewer() {
    if (viewerContentEl && viewerContentEl.focus) {
      try { viewerContentEl.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    }
  }

  /* --- row text ----------------------------------------------------- */

  /* One strip for the row label and the sort key: a nested subtree is not
   * this row's text, a checkbox is state, and a rendered plugin card is
   * chrome (a Mermaid item labels as its own prose, never the source). */
  function ownText(li) {
    if (!li) return "";
    const clone = li.cloneNode(true);
    clone.querySelectorAll(CHROME_STRIP).forEach((node) => node.remove());
    clone.querySelectorAll("br").forEach((br) => {
      br.replaceWith(document.createTextNode(" "));
    });
    return (clone.textContent || "")
      .replace(ZERO_WIDTH, "")
      .replace(WHITESPACE, " ")
      .trim();
  }

  function labelOf(row) { return row.ownText || EMPTY_LABEL; }

  /* --- model -------------------------------------------------------- */

  function rec(id) {
    return state && id != null ? state.byId[id] || null : null;
  }

  function focusRecord() {
    if (!state) return null;
    return rec(state.focusId) || (state.rows.length ? state.rows[0] : null);
  }

  function indexOf(id) {
    if (!state) return -1;
    for (let i = 0; i < state.rows.length; i++) {
      if (state.rows[i].id === id) return i;
    }
    return -1;
  }

  function blockEnd(i) {
    const rows = state.rows;
    if (i < 0 || i >= rows.length) return i;
    let j = i + 1;
    while (j < rows.length && rows[j].depth > rows[i].depth) j += 1;
    return j;
  }

  function descendants(id) {
    const i = indexOf(id);
    if (i < 0) return [];
    return state.rows.slice(i + 1, blockEnd(i));
  }

  /* parentId and the collapsible flag are derived from the flat order, so
   * the verbs only ever permute the array and set depths. */
  function deriveRows() {
    const rows = state.rows;
    const stack = [];
    rows.forEach((row, i) => {
      while (stack.length && stack[stack.length - 1].depth >= row.depth) {
        stack.pop();
      }
      row.parentId = stack.length ? stack[stack.length - 1].id : null;
      stack.push(row);
      const next = rows[i + 1];
      row.collapsible = !!next && next.depth === row.depth + 1;
      if (!row.collapsible) row.collapsed = false;
    });
  }

  function levelRows(parentId) {
    return state.rows.filter((row) => row.parentId === parentId);
  }

  function levelStart(parentId) {
    if (parentId == null) return 0;
    const i = indexOf(parentId);
    return i < 0 ? 0 : i + 1;
  }

  function isTaskRow(row) { return !!row && row.done !== null; }

  function isLocked(id) {
    let row = rec(id);
    while (row && row.parentId != null) {
      if (state.selected.has(row.parentId)) return true;
      row = rec(row.parentId);
    }
    return false;
  }

  function isMarked(id) {
    return !!state && (state.selected.has(id) || isLocked(id));
  }

  function rootsOnly(ids) {
    const out = new Set();
    ids.forEach((id) => { if (!isLockedWith(ids, id)) out.add(id); });
    return out;
  }

  function isLockedWith(ids, id) {
    let row = rec(id);
    while (row && row.parentId != null) {
      if (ids.has(row.parentId)) return true;
      row = rec(row.parentId);
    }
    return false;
  }

  function rootRecords() {
    if (!state) return [];
    if (!state.selected.size) {
      const focus = focusRecord();
      return focus ? [focus] : [];
    }
    return state.rows.filter((row) => state.selected.has(row.id));
  }

  function targetRecords() {
    if (!state) return [];
    if (!state.selected.size) {
      const focus = focusRecord();
      return focus ? [focus] : [];
    }
    return state.rows.filter((row) => isMarked(row.id));
  }

  function visibleRows() {
    const out = [];
    let hiddenUnder = null;
    state.rows.forEach((row) => {
      if (hiddenUnder !== null && row.depth > hiddenUnder) return;
      if (hiddenUnder !== null) hiddenUnder = null;
      out.push(row);
      if (row.collapsed) hiddenUnder = row.depth;
    });
    return out;
  }

  /* --- opening the model -------------------------------------------- */

  function attrsOf(node) {
    if (!node || !node.attributes) return "";
    return Array.from(node.attributes)
      .map((a) => a.name + "=" + a.value)
      .join(" ");
  }

  function childListOf(li) {
    return li.querySelector(":scope > ul, :scope > ol");
  }

  /* P0: every list under the container holds only <li> children, no item
   * holds two child lists, an item's child list is its last element child,
   * and every row's ancestor chain back to the container is only
   * li -> (ul|ol). Anything else would corrupt turndown's numbering. */
  function shapeOk(container, rows) {
    const lists = [container].concat(
      Array.from(container.querySelectorAll("ul,ol"))
    );
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i];
      const kids = Array.from(list.children);
      for (let k = 0; k < kids.length; k++) {
        if (kids[k].tagName !== "LI") return false;
      }
      if (i === 0) continue;
      const parentTag = list.parentElement ? list.parentElement.tagName : "";
      if (parentTag !== "LI" && parentTag !== "BLOCKQUOTE" &&
          parentTag !== "TD" && parentTag !== "TH") return false;
    }
    for (let i = 0; i < rows.length; i++) {
      const node = rows[i].node;
      const own = node.querySelectorAll(":scope > ul, :scope > ol");
      if (own.length > 1) return false;
      if (own.length === 1 && node.lastElementChild !== own[0]) return false;
      let walk = node.parentElement;
      while (walk && walk !== container) {
        if (!/^(UL|OL)$/.test(walk.tagName)) return false;
        walk = walk.parentElement;
        if (walk && walk !== container && walk.tagName !== "LI") return false;
        walk = walk ? walk.parentElement : null;
      }
      if (!walk) return false;
    }
    return true;
  }

  function buildModel(container) {
    const rows = [];
    const wrappers = [];
    const byId = [];
    const wrapperById = [];
    const nodeId = new Map();
    const wrapperIdByNode = new Map();

    const rootWrapper = {
      node: container,
      id: 0,
      tag: container.tagName,
      attrs: attrsOf(container),
      parentId: null,
      hadRows: false,
    };
    wrappers.push(rootWrapper);
    wrapperById.push(rootWrapper);
    wrapperIdByNode.set(container, 0);

    // Every list level under the container gets a stable id, including an
    // authored child list that holds no items yet.
    function addWrapper(node, hadRows) {
      const parentLi = node.parentElement && node.parentElement.tagName === "LI"
        ? node.parentElement : null;
      const wrapper = {
        node: node,
        id: wrappers.length,
        tag: node.tagName,
        attrs: attrsOf(node),
        parentId: parentLi ? nodeId.get(parentLi) : null,
        hadRows: hadRows,
      };
      wrappers.push(wrapper);
      wrapperById.push(wrapper);
      wrapperIdByNode.set(node, wrapper.id);
      return wrapper.id;
    }

    const items = (NB.hybrid.listItems ? NB.hybrid.listItems(container) : [])
      .filter((li) => NB.hybrid.listContainer(li) === container);

    items.forEach((node) => {
      const parent = node.parentElement;
      if (!parent || !/^(UL|OL)$/.test(parent.tagName)) return;
      const wrapperId = wrapperIdByNode.has(parent)
        ? wrapperIdByNode.get(parent) : addWrapper(parent, true);
      const row = {
        node: node,
        id: rows.length,
        depth: NB.hybrid.listItemDepth(node, container),
        parentId: null,
        sourceTag: parent.tagName,
        wrapperId: wrapperId,
        done: null,
        collapsible: false,
        collapsed: false,
        ownText: ownText(node),
      };
      const box = NB.hybrid.taskCheckboxOf ? NB.hybrid.taskCheckboxOf(node) : null;
      if (box) row.done = !!box.checked;
      nodeId.set(node, row.id);
      byId.push(row);
      rows.push(row);
    });

    if (!rows.length) return null;

    rows.forEach((row) => {
      const child = childListOf(row.node);
      if (child && !wrapperIdByNode.has(child)) addWrapper(child, false);
    });

    state = {
      container: container,
      rows: rows,
      byId: byId,
      wrappers: wrappers,
      wrapperById: wrapperById,
      selected: new Set(),
      anchorId: rows[0].id,
      focusId: rows[0].id,
      cells: new Map(),
      openSignature: null,
    };
    rootWrapper.hadRows = true;
    deriveRows();
    if (!shapeOk(container, rows)) { state = null; return null; }
    state.openSignature = signatureOf(rebuildPlan());
    return state;
  }

  /* --- plan and signature ------------------------------------------- */

  /* The pure planner: the complete commit-and-sign payload, computed from
   * the model and the live wrappers. It never mutates anything. */
  function rebuildPlan() {
    if (!state) return null;
    const rows = state.rows;
    if (!shapeOk(state.container, rows)) return null;

    const root = state.wrapperById[0];
    const plan = {
      wrappers: [{
        key: "root",
        depth: 0,
        tag: root.tag,
        wrapperId: root.id,
        attrs: root.attrs,
        parentRowId: null,
        node: null,
        rowIds: [],
      }],
      rowOrder: [],
      done: {},
      empty: rows.length === 0,
    };

    // The stack walk: a row one level deeper than its predecessor opens a
    // level under that predecessor; equal or shallower rows join or pop.
    const stack = [];
    rows.forEach((row, i) => {
      const depth = row.depth;
      let desc;
      if (depth === 0) {
        stack.length = 1;
        stack[0] = plan.wrappers[0];
        desc = plan.wrappers[0];
      } else {
        const prevDepth = i > 0 ? rows[i - 1].depth : -1;
        stack.length = prevDepth < depth ? depth : depth + 1;
        desc = stack[depth] || null;
        if (!desc) {
          const opener = rows[i - 1];
          const child = opener ? childListOf(opener.node) : null;
          const known = child
            ? state.wrappers.find((wrapper) => wrapper.node === child) || null
            : null;
          desc = {
            key: depth + ":" + (opener ? opener.id : "none"),
            depth: depth,
            tag: child ? child.tagName : row.sourceTag,
            wrapperId: known ? known.id : null,
            attrs: known ? known.attrs : "",
            parentRowId: opener ? opener.id : null,
            node: null,
            rowIds: [],
          };
          plan.wrappers.push(desc);
          stack[depth] = desc;
        }
      }
      desc.rowIds.push(row.id);
      plan.rowOrder.push(row.id);
      plan.done[row.id] = row.done === null ? null : (row.done ? 1 : 0);
    });

    return plan;
  }

  function rowDepthOf(id) {
    const row = rec(id);
    return row ? row.depth : -1;
  }

  function signatureOf(plan) {
    if (!plan) return "";
    const rows = plan.rowOrder
      .map((id) => id + ":" + rowDepthOf(id))
      .join(",");
    const wrappers = plan.wrappers
      .map((w) => w.wrapperId + ":" + w.tag + ":" + w.attrs)
      .join("|");
    const done = plan.rowOrder
      .map((id) => (plan.done[id] === null ? "n" : plan.done[id]))
      .join("");
    return rows + "\u0001" + wrappers + "\u0001" + done;
  }

  function currentSignature() {
    return state ? signatureOf(rebuildPlan()) : "";
  }

  /* The only code that mutates the note. The container is never copied or
   * replaced, so every wrapper keeps its identity and its attributes. */
  function commitPlan(plan) {
    if (!plan || !state) return;
    const container = state.container;
    const keep = new Set(plan.rowOrder);

    // 1. Delete pass: rows the plan dropped leave with their whole subtree.
    state.byId.forEach((row) => {
      if (keep.has(row.id)) return;
      if (row.node && row.node.parentNode) row.node.remove();
    });

    // 2. Create pass: only wrappers the plan could not claim.
    plan.wrappers.forEach((desc) => {
      if (desc.wrapperId !== null) {
        const known = state.wrapperById[desc.wrapperId];
        desc.node = known ? known.node : null;
        return;
      }
      const parent = desc.parentRowId == null
        ? container : rec(desc.parentRowId).node;
      const created = document.createElement(desc.tag);
      parent.appendChild(created);
      desc.node = created;
    });

    // 3. Level passes, outermost first: a row can never be appended into a
    // wrapper that still sits inside its own subtree.
    const maxDepth = plan.wrappers.reduce((m, w) => Math.max(m, w.depth), 0);
    for (let depth = 0; depth <= maxDepth; depth++) {
      plan.wrappers.forEach((desc) => {
        if (desc.depth !== depth || !desc.node) return;
        desc.rowIds.forEach((id) => {
          const row = rec(id);
          if (row && row.node) desc.node.appendChild(row.node);
        });
      });
    }

    // 4. Wrapper cleanup: a claimed-now-empty level is removed.
    state.wrappers.forEach((wrapper) => {
      if (wrapper.id === 0 || !wrapper.hadRows) return;
      if (!wrapper.node.parentNode) return;
      if (wrapper.node.querySelector(":scope > li")) return;
      wrapper.node.remove();
    });

    // 5. P4: a row's child list is its last element child.
    state.rows.forEach((row) => {
      if (!keep.has(row.id)) return;
      const own = row.node.lastElementChild;
      if (own && /^(UL|OL)$/.test(own.tagName)) return;
      if (row.node.querySelector(":scope > ul, :scope > ol")) {
        throw new Error("child list is not last");
      }
    });

    // 6. Done flags: the property is the live authority, the attribute is
    // what hybrid's innerHTML undo snapshots serialize.
    state.rows.forEach((row) => {
      if (!keep.has(row.id)) return;
      const want = plan.done[row.id];
      if (want === null) return;
      const box = NB.hybrid.taskCheckboxOf ? NB.hybrid.taskCheckboxOf(row.node) : null;
      if (!box || box.checked === !!want) return;
      box.checked = !!want;
      if (want) box.setAttribute("checked", "");
      else box.removeAttribute("checked");
    });

    // 7. Empty model: every row and wrapper is gone.
    if (plan.empty) container.remove();
  }

  /* --- rendering ---------------------------------------------------- */

  function markerFor(row) {
    let wrapper = null;
    if (row.parentId == null) {
      wrapper = state.wrappers[0];
    } else {
      const parent = rec(row.parentId);
      const child = parent ? childListOf(parent.node) : null;
      wrapper = child
        ? state.wrappers.find((w) => w.node === child) || null
        : null;
    }
    const tag = wrapper ? wrapper.tag : row.sourceTag;
    if (tag !== "OL") return BULLET;
    const siblings = levelRows(row.parentId);
    const index = siblings.indexOf(row);
    return ordinal(index, siblings.length, wrapper);
  }

  function ordinal(index, total, wrapper) {
    const node = wrapper ? wrapper.node : null;
    const type = node ? node.getAttribute("type") : null;
    const reversed = !!(node && node.hasAttribute("reversed"));
    const startAttr = node ? parseInt(node.getAttribute("start"), 10) : NaN;
    const start = Number.isFinite(startAttr) ? startAttr : (reversed ? total : 1);
    const value = reversed ? start - index : start + index;
    return formatOrdinal(value, type);
  }

  function formatOrdinal(value, type) {
    if (type === "a" || type === "A") {
      const text = alphaValue(value);
      return (type === "a" ? text.toLowerCase() : text.toUpperCase()) + ".";
    }
    if (type === "i" || type === "I") {
      const text = romanValue(value);
      if (text) return (type === "i" ? text.toLowerCase() : text.toUpperCase()) + ".";
    }
    return value + ".";
  }

  function alphaValue(value) {
    if (!Number.isFinite(value) || value < 1) return String(value);
    let n = value;
    let out = "";
    while (n > 0) {
      const rest = (n - 1) % 26;
      out = String.fromCharCode(65 + rest) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function romanValue(value) {
    if (!Number.isFinite(value) || value < 1 || value > DEFAULT_ROMAN) return "";
    const table = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"],
      [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"],
      [5, "V"], [4, "IV"], [1, "I"],
    ];
    let n = value;
    let out = "";
    table.forEach((pair) => {
      while (n >= pair[0]) {
        out += pair[1];
        n -= pair[0];
      }
    });
    return out;
  }

  function metaFor(row, index) {
    const parts = [];
    const nested = row.node.querySelectorAll("li").length - descendants(row.id).length;
    if (nested > 0) parts.push("+" + nested + " nested");
    if (row.collapsed) {
      const hidden = descendants(row.id).length;
      if (hidden > 0) parts.push(hidden + " hidden");
    }
    return parts.join(" · ");
  }

  function buildRow(row, index) {
    const rowEl = el("div", "le-row");
    rowEl.setAttribute("role", "row");
    rowEl.setAttribute("data-row-id", String(row.id));
    rowEl.setAttribute("aria-level", String(row.depth + 1));
    rowEl.setAttribute("aria-rowindex", String(index + 1));
    const marked = isMarked(row.id);
    const locked = !state.selected.has(row.id) && isLocked(row.id);
    rowEl.setAttribute("aria-selected", marked ? "true" : "false");
    if (row.collapsible) {
      rowEl.setAttribute("aria-expanded", row.collapsed ? "false" : "true");
    }
    if (marked) rowEl.classList.add("is-selected");
    if (locked) rowEl.classList.add("is-locked");

    const cell = el("div", "le-cell");
    cell.setAttribute("role", "gridcell");
    cell.tabIndex = row.id === state.focusId ? 0 : -1;

    const box = el("span", "le-select");
    box.setAttribute("aria-hidden", "true");
    cell.appendChild(box);

    if (row.done === null) {
      const mark = el("span", "le-mark");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = markerFor(row);
      cell.appendChild(mark);
    } else {
      const done = el("button", "le-done");
      done.type = "button";
      done.setAttribute("role", "checkbox");
      done.setAttribute("aria-checked", row.done ? "true" : "false");
      done.setAttribute("aria-label", "Done");
      done.tabIndex = -1;
      done.setAttribute("data-row-id", String(row.id));
      cell.appendChild(done);
    }

    const rail = el("span", "le-indent");
    for (let d = 0; d < row.depth; d++) {
      const guide = el("span", "le-guide");
      guide.setAttribute("aria-hidden", "true");
      rail.appendChild(guide);
    }
    if (row.collapsible) {
      const chev = el("button", "le-chev");
      chev.type = "button";
      chev.tabIndex = -1;
      chev.setAttribute("aria-expanded", row.collapsed ? "false" : "true");
      chev.setAttribute("aria-label",
        (row.collapsed ? "Expand: " : "Collapse: ") + labelOf(row));
      chev.setAttribute("data-row-id", String(row.id));
      chev.innerHTML = CHEV_SVG;
      rail.appendChild(chev);
    } else {
      const slot = el("span", "le-chev-slot");
      slot.setAttribute("aria-hidden", "true");
      rail.appendChild(slot);
    }
    cell.appendChild(rail);

    const label = labelOf(row);
    const text = el("span", "le-text");
    if (!row.ownText) text.classList.add("is-empty");
    text.textContent = label;
    text.title = label;
    cell.appendChild(text);

    const meta = metaFor(row, index);
    if (meta) {
      const metaEl = el("span", "le-meta");
      metaEl.textContent = meta;
      cell.appendChild(metaEl);
    }

    rowEl.appendChild(cell);
    state.cells.set(row.id, cell);
    return rowEl;
  }

  function renderTree() {
    if (!gridEl || !state) return;
    state.cells = new Map();
    gridEl.textContent = "";
    const rows = visibleRows();
    rows.forEach((row, index) => gridEl.appendChild(buildRow(row, index)));
    gridEl.setAttribute("aria-rowcount", String(rows.length));
    const empty = state.rows.length === 0;
    gridEl.hidden = empty;
    if (emptyEl) emptyEl.hidden = !empty;
    measureMarkers();
  }

  /* One read pass per render, one write after it: the widest visible
   * marker, capped at three glyphs of the marker's own type. */
  function measureMarkers() {
    if (!gridEl) return;
    let widest = 0;
    gridEl.querySelectorAll(".le-mark").forEach((node) => {
      const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (rect && rect.width > widest) widest = rect.width;
    });
    if (widest <= BASE_MARK_W) {
      gridEl.style.removeProperty("--le-mark-w");
      return;
    }
    gridEl.style.setProperty("--le-mark-w",
      "max(" + MARK_MIN_CSS + ", min(" + Math.ceil(widest + MARK_GAP) +
      "px, " + MARK_CAP_CSS + "))");
  }

  function paintActive() {
    if (!state || !state.cells) return;
    state.cells.forEach((cell, id) => {
      cell.tabIndex = id === state.focusId ? 0 : -1;
    });
  }

  function paintSelection() {
    if (!state || !state.cells) return;
    state.cells.forEach((cell, id) => {
      const rowEl = cell.parentElement;
      if (!rowEl) return;
      const root = state.selected.has(id);
      const locked = !root && isLocked(id);
      const marked = root || locked;
      rowEl.setAttribute("aria-selected", marked ? "true" : "false");
      rowEl.classList.toggle("is-selected", marked);
      rowEl.classList.toggle("is-locked", locked);
    });
  }

  function focusCell(id) {
    if (!state || !state.cells) return;
    const cell = state.cells.get(id);
    if (!cell) return;
    try { cell.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    if (cell.scrollIntoView) {
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /* --- status ------------------------------------------------------- */

  function countsText() {
    if (!state) return "";
    const items = state.rows.length;
    let selected = 0;
    let done = 0;
    state.rows.forEach((row) => {
      if (isMarked(row.id)) selected += 1;
      if (row.done === true) done += 1;
    });
    return count(items, "item") + " · " + selected + " selected · " +
      done + " done";
  }

  function showStatus(result) {
    if (!statusEl) return;
    const counts = countsText();
    statusEl.textContent = result ? counts + " — " + result : counts;
  }

  function showRaw(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function refresh() {
    deriveRows();
    renderTree();
    paintSelection();
    syncToolbar();
  }

  function afterChange(result, changed) {
    const hadFocus = !!(gridEl && gridEl.contains(document.activeElement));
    refresh();
    showStatus(result);
    if (state.rows.length === 0) {
      if (applyBtn) applyBtn.focus({ preventScroll: true });
    } else if (hadFocus) {
      focusCell(state.focusId);
    }
    if (changed && hist) hist.capture("structural");
  }

  /* --- toolbar ------------------------------------------------------ */

  function toolReasons() {
    const reasons = {};
    if (!state) return reasons;
    const rows = state.rows;
    const roots = rootRecords();
    const targets = targetRecords();
    const targetIds = new Set(targets.map((row) => row.id));

    const groups = new Map();
    roots.forEach((row) => {
      const key = row.parentId == null ? "root" : String(row.parentId);
      if (!groups.has(key)) groups.set(key, { parentId: row.parentId, rows: [] });
      groups.get(key).rows.push(row);
    });

    let anyFirst = roots.length === 0;
    let anyLast = roots.length === 0;
    groups.forEach((group) => {
      const level = levelRows(group.parentId);
      const positions = group.rows
        .map((row) => level.indexOf(row))
        .filter((i) => i >= 0);
      if (!positions.length) return;
      if (Math.min.apply(null, positions) > 0) anyFirst = false;
      if (Math.max.apply(null, positions) < level.length - 1) anyLast = false;
    });
    if (anyFirst) reasons["le-move-up"] = REASON.first;
    if (anyLast) reasons["le-move-down"] = REASON.last;

    if (groups.size > 1) {
      reasons["le-move-top"] = REASON.oneLevelTop;
      reasons["le-move-bottom"] = REASON.oneLevelBottom;
    } else if (groups.size === 1) {
      const group = groups.values().next().value;
      const level = levelRows(group.parentId);
      const positions = group.rows.map((row) => level.indexOf(row));
      const first = Math.min.apply(null, positions);
      const last = Math.max.apply(null, positions);
      if (first === 0) reasons["le-move-top"] = REASON.atTop;
      if (last === level.length - 1) reasons["le-move-bottom"] = REASON.atBottom;
    } else {
      reasons["le-move-top"] = REASON.atTop;
      reasons["le-move-bottom"] = REASON.atBottom;
    }

    let canIndent = false;
    roots.forEach((row) => {
      const level = levelRows(row.parentId);
      const prev = level[level.indexOf(row) - 1];
      if (prev && !targetIds.has(prev.id)) canIndent = true;
    });
    if (!canIndent) reasons["le-indent"] = REASON.indentEdge;

    if (roots.every((row) => row.depth === 0)) {
      reasons["le-outdent"] = REASON.outdentEdge;
    }

    const focus = focusRecord();
    const sortLevel = focus ? levelRows(focus.parentId) : [];
    if (sortLevel.length < 2) {
      reasons["le-sort-asc"] = REASON.sortSmall;
      reasons["le-sort-desc"] = REASON.sortSmall;
    }

    if (!rows.some((row) => row.done === true)) {
      reasons["le-sort-done"] = REASON.noDone;
    }

    if (!rows.length) reasons["le-select-all"] = REASON.nothingToSelect;
    if (!state.selected.size) reasons["le-select-none"] = REASON.nothingSelected;

    const tasks = targets.filter(isTaskRow);
    if (!tasks.length) {
      reasons["le-mark-done"] = REASON.noTask;
      reasons["le-mark-open"] = REASON.noTask;
    } else if (!tasks.some((row) => row.done === true)) {
      reasons["le-mark-open"] = REASON.noneDone;
    }

    if (!rows.length) reasons["le-delete"] = REASON.nothingToDelete;
    return reasons;
  }

  function syncToolbar() {
    if (!overlayEl) return;
    const reasons = stale ? {} : toolReasons();
    TOOLS.forEach((tool) => {
      const node = byId(tool.id);
      if (!node) return;
      const reason = stale ? STALE_CAUSE : (reasons[tool.id] || "");
      if (reason) node.setAttribute("aria-disabled", "true");
      else node.removeAttribute("aria-disabled");
      node.setAttribute("aria-label",
        reason ? tool.name + ". " + reason : tool.name);
      node.title = tool.name + " (" + tool.chord + ")" +
        (reason ? " — " + reason : "");
    });
  }

  function dispatchTool(id) {
    switch (id) {
      case "le-move-up": moveRows("up"); break;
      case "le-move-down": moveRows("down"); break;
      case "le-move-top": moveRowsToEdge("top"); break;
      case "le-move-bottom": moveRowsToEdge("bottom"); break;
      case "le-outdent": outdentRows(); break;
      case "le-indent": indentRows(); break;
      case "le-sort-asc": sortRows("asc"); break;
      case "le-sort-desc": sortRows("desc"); break;
      case "le-sort-done": doneToBottom(); break;
      case "le-select-all": selectAll(); break;
      case "le-select-none": selectNone(); break;
      case "le-mark-done": markDone(true); break;
      case "le-mark-open": markDone(false); break;
      case "le-delete": deleteRows(); break;
      default: break;
    }
  }

  function onToolClick(id) {
    if (!state) return;
    if (stale) { showRaw(STALE_STATUS); return; }
    const reason = toolReasons()[id];
    if (reason) { showStatus(reason); return; }
    dispatchTool(id);
  }

  /* --- selection verbs ---------------------------------------------- */

  function selectAll() {
    if (stale || !state) return false;
    if (!state.rows.length) { showStatus(REASON.nothingToSelect); return false; }
    const ids = new Set();
    state.rows.forEach((row) => { if (row.depth === 0) ids.add(row.id); });
    state.selected = ids;
    paintSelection();
    syncToolbar();
    showStatus("Selected all " + count(state.rows.length, "item"));
    return true;
  }

  function selectNone() {
    if (stale || !state) return false;
    if (!state.selected.size) { showStatus(REASON.nothingSelected); return false; }
    state.selected = new Set();
    state.anchorId = state.focusId;
    paintSelection();
    syncToolbar();
    showStatus("Selection cleared");
    return true;
  }

  function setSelection(ids) {
    state.selected = rootsOnly(ids);
    paintSelection();
    syncToolbar();
    showStatus("");
  }

  function toggleSelected(id, moveAnchor) {
    if (isLocked(id)) return false;
    if (state.selected.has(id)) {
      state.selected.delete(id);
    } else {
      state.selected.forEach((other) => {
        let row = rec(other);
        while (row && row.parentId != null) {
          if (row.parentId === id) { state.selected.delete(other); break; }
          row = rec(row.parentId);
        }
      });
      state.selected.add(id);
    }
    if (moveAnchor) state.anchorId = id;
    state.focusId = id;
    paintSelection();
    paintActive();
    syncToolbar();
    showStatus("");
    return true;
  }

  function anchorRowId() {
    const anchor = rec(state.anchorId);
    const visible = visibleRows();
    if (anchor && visible.indexOf(anchor) !== -1) return anchor.id;
    return state.focusId;
  }

  function extendTo(id) {
    const visible = visibleRows();
    const from = visible.findIndex((row) => row.id === anchorRowId());
    const to = visible.findIndex((row) => row.id === id);
    if (from < 0 || to < 0) return false;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const ids = new Set();
    for (let i = lo; i <= hi; i++) ids.add(visible[i].id);
    state.selected = rootsOnly(ids);
    state.focusId = id;
    paintSelection();
    paintActive();
    focusCell(id);
    syncToolbar();
    showStatus("");
    return true;
  }

  function _select(arg) {
    if (!state || stale) return;
    if (Array.isArray(arg)) {
      const ids = new Set(arg.map(Number));
      state.selected = rootsOnly(ids);
      const first = state.rows.find((row) => state.selected.has(row.id));
      state.anchorId = first ? first.id : state.focusId;
    } else if (arg && typeof arg === "object") {
      if (arg.focus != null) state.focusId = Number(arg.focus);
      if (arg.extend) {
        if (arg.anchor != null) state.anchorId = Number(arg.anchor);
        extendTo(state.focusId);
        return;
      }
      state.anchorId = arg.anchor != null ? Number(arg.anchor) : state.focusId;
      state.selected = state.focusId == null ? new Set() : new Set([state.focusId]);
    }
    paintSelection();
    paintActive();
    if (arg && !Array.isArray(arg) && arg.focus != null) focusCell(state.focusId);
    syncToolbar();
    showStatus("");
  }

  /* --- move verbs ---------------------------------------------------- */

  function moveGroup(sign) {
    const roots = rootRecords();
    const groups = new Map();
    roots.forEach((row) => {
      const key = row.parentId == null ? "root" : String(row.parentId);
      if (!groups.has(key)) groups.set(key, { parentId: row.parentId, rows: [] });
      groups.get(key).rows.push(row);
    });
    let moved = 0;
    let skipped = 0;
    groups.forEach((group) => {
      const level = levelRows(group.parentId);
      const positions = group.rows
        .map((row) => level.indexOf(row))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (!positions.length) return;
      const start = positions[0];
      const end = positions[positions.length - 1];
      if (sign < 0 && start === 0) { skipped += group.rows.length; return; }
      if (sign > 0 && end === level.length - 1) {
        skipped += group.rows.length;
        return;
      }
      const from = indexOf(level[start].id);
      const to = blockEnd(indexOf(level[end].id));
      const block = state.rows.splice(from, to - from);
      if (sign < 0) {
        const before = indexOf(level[start - 1].id);
        state.rows.splice(before, 0, ...block);
      } else {
        const after = blockEnd(indexOf(level[end + 1].id));
        state.rows.splice(after, 0, ...block);
      }
      moved += group.rows.length;
    });
    return { moved: moved, skipped: skipped };
  }

  function moveRows(dir) {
    if (stale || !state) return false;
    if (!state.rows.length) { showStatus(REASON.first); return false; }
    const sign = dir === "up" ? -1 : 1;
    const reason = toolReasons()[sign < 0 ? "le-move-up" : "le-move-down"];
    if (reason) { showStatus(reason); return false; }
    const result = moveGroup(sign);
    if (!result.moved) {
      showStatus(sign < 0 ? REASON.first : REASON.last);
      return false;
    }
    let text = "Moved " + count(result.moved, "item") + (sign < 0 ? " up" : " down");
    if (result.skipped) {
      text += " · " + count(result.skipped, "item") + " could not move";
    }
    afterChange(text, true);
    return true;
  }

  function moveRowsToEdge(edge) {
    if (stale || !state) return false;
    const key = edge === "top" ? "le-move-top" : "le-move-bottom";
    const reason = toolReasons()[key];
    if (reason) { showStatus(reason); return false; }
    const roots = rootRecords();
    if (!roots.length) return false;
    const parentId = roots[0].parentId;
    const level = levelRows(parentId);
    const selectedIds = new Set(roots.map((row) => row.id));
    const from = indexOf(roots[0].id);
    const to = blockEnd(indexOf(roots[roots.length - 1].id));
    const block = state.rows.splice(from, to - from);
    if (edge === "top") {
      state.rows.splice(levelStart(parentId), 0, ...block);
    } else {
      let last = null;
      for (let i = level.length - 1; i >= 0; i--) {
        if (!selectedIds.has(level[i].id)) { last = level[i]; break; }
      }
      const at = last ? blockEnd(indexOf(last.id)) : levelStart(parentId);
      state.rows.splice(at, 0, ...block);
    }
    afterChange("Moved " + count(roots.length, "item") + " to the " + edge, true);
    return true;
  }

  /* --- level verbs --------------------------------------------------- */

  function indentRows() {
    if (stale || !state) return false;
    const roots = rootRecords();
    const targetIds = new Set(roots.map((row) => row.id));
    let moved = 0;
    let skipped = 0;
    roots.forEach((row) => {
      const level = levelRows(row.parentId);
      const prev = level[level.indexOf(row) - 1];
      if (!prev || targetIds.has(prev.id)) { skipped += 1; return; }
      const from = indexOf(row.id);
      const to = blockEnd(from);
      const block = state.rows.splice(from, to - from);
      const at = blockEnd(indexOf(prev.id));
      block.forEach((item) => { item.depth += 1; });
      state.rows.splice(at, 0, ...block);
      deriveRows();
      moved += 1;
    });
    if (!moved) { showStatus(REASON.indentEdge); return false; }
    let text = "Indented " + count(moved, "item");
    if (skipped) text += " · " + count(skipped, "item") + " could not indent";
    afterChange(text, true);
    return true;
  }

  function outdentRows() {
    if (stale || !state) return false;
    const roots = rootRecords();
    const groups = new Map();
    roots.forEach((row) => {
      if (row.parentId == null) return;
      const key = String(row.parentId);
      if (!groups.has(key)) groups.set(key, { parentId: row.parentId, rows: [] });
      groups.get(key).rows.push(row);
    });
    let moved = 0;
    const skipped = roots.length - roots.filter((row) => row.parentId != null).length;
    groups.forEach((group) => {
      const level = levelRows(group.parentId);
      const ordered = group.rows
        .slice()
        .sort((a, b) => level.indexOf(a) - level.indexOf(b));
      const run = [];
      ordered.forEach((row) => {
        const from = indexOf(row.id);
        const to = blockEnd(from);
        const block = state.rows.splice(from, to - from);
        block.forEach((item) => { item.depth -= 1; });
        run.push(...block);
      });
      const at = blockEnd(indexOf(group.parentId));
      state.rows.splice(at, 0, ...run);
      deriveRows();
      moved += ordered.length;
    });
    if (!moved) { showStatus(REASON.outdentEdge); return false; }
    let text = "Outdented " + count(moved, "item");
    if (skipped) text += " · " + count(skipped, "item") + " could not outdent";
    afterChange(text, true);
    return true;
  }

  /* --- sort / done --------------------------------------------------- */

  function parseNumber(text) {
    const value = (text || "").trim();
    if (!value || !NUMBER_RE.test(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function compareKeys(a, b) {
    const an = parseNumber(a);
    const bn = parseNumber(b);
    if (an !== null && bn !== null) return an < bn ? -1 : (an > bn ? 1 : 0);
    return COLLATOR.compare(a, b);
  }

  function reorderLevel(parentId, ordered) {
    const level = levelRows(parentId);
    if (!level.length) return;
    const from = indexOf(level[0].id);
    const to = blockEnd(indexOf(level[level.length - 1].id));
    const blocks = new Map();
    level.forEach((row) => {
      const start = indexOf(row.id);
      blocks.set(row.id, state.rows.slice(start, blockEnd(start)));
    });
    const rebuilt = [];
    ordered.forEach((row) => {
      const block = blocks.get(row.id);
      if (block) rebuilt.push(...block);
    });
    state.rows.splice(from, to - from, ...rebuilt);
  }

  function sortRows(dir) {
    if (stale || !state) return false;
    const reason = toolReasons()[dir === "desc" ? "le-sort-desc" : "le-sort-asc"];
    if (reason) { showStatus(reason); return false; }
    const focus = focusRecord();
    const level = levelRows(focus.parentId);
    const keyed = level.map((row, index) => ({ row: row, index: index, key: row.ownText }));
    const filled = keyed.filter((item) => item.key !== "");
    const empty = keyed.filter((item) => item.key === "");
    filled.sort((a, b) => {
      const cmp = compareKeys(a.key, b.key);
      const directed = dir === "desc" ? -cmp : cmp;
      return directed !== 0 ? directed : a.index - b.index;
    });
    reorderLevel(focus.parentId, filled.concat(empty).map((item) => item.row));
    let text = "Sorted " + count(level.length, "item") + " at level " +
      (focus.depth + 1);
    if (dir === "desc") text += ", Z to A";
    afterChange(text, true);
    return true;
  }

  function doneToBottom() {
    if (stale || !state) return false;
    const doneCount = state.rows.filter((row) => row.done === true).length;
    if (!doneCount) { showStatus(REASON.noDone); return false; }
    const byParent = new Map();
    state.rows.forEach((row) => {
      const key = row.parentId == null ? "root" : String(row.parentId);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(row);
    });
    const ordered = [];
    const walk = (parentId) => {
      const key = parentId == null ? "root" : String(parentId);
      const kids = byParent.get(key) || [];
      const open = kids.filter((row) => row.done !== true);
      const done = kids.filter((row) => row.done === true);
      open.concat(done).forEach((row) => {
        ordered.push(row);
        walk(row.id);
      });
    };
    walk(null);
    state.rows = ordered;
    afterChange("Moved " + count(doneCount, "done item") + " to the bottom", true);
    return true;
  }

  /* --- state verbs --------------------------------------------------- */

  function markDone(done) {
    if (stale || !state) return false;
    const targets = targetRecords();
    const tasks = targets.filter(isTaskRow);
    if (!tasks.length) { showStatus(REASON.noTask); return false; }
    if (!done && !tasks.some((row) => row.done === true)) {
      showStatus(REASON.noneDone);
      return false;
    }
    const changed = tasks.filter((row) => row.done !== done);
    if (!changed.length) {
      showStatus("All " + count(tasks.length, "item") +
        (tasks.length === 1 ? " was" : " were") +
        (done ? " already done" : " already open"));
      return false;
    }
    changed.forEach((row) => { row.done = done; });
    afterChange("Marked " + count(changed.length, "item") + (done ? " done" : " open"), true);
    return true;
  }

  function toggleRowDone(id) {
    if (stale || !state) return false;
    const row = rec(id);
    if (!row || row.done === null) return false;
    row.done = !row.done;
    state.focusId = row.id;
    afterChange("Marked " + count(1, "item") + (row.done ? " done" : " open"), true);
    return true;
  }

  function deleteRows() {
    if (stale || !state) return false;
    if (!state.rows.length) { showStatus(REASON.nothingToDelete); return false; }
    const roots = rootRecords();
    if (!roots.length) return false;
    const lastRoot = roots[roots.length - 1];
    const afterIndex = blockEnd(indexOf(lastRoot.id));
    const afterRow = state.rows[afterIndex] || null;
    const beforeRow = state.rows[indexOf(lastRoot.id) - 1] || null;

    const doomed = new Set();
    roots.forEach((row) => {
      doomed.add(row.id);
      descendants(row.id).forEach((child) => doomed.add(child.id));
    });
    state.selected.forEach((id) => {
      if (doomed.has(id)) state.selected.delete(id);
    });
    state.rows = state.rows.filter((row) => !doomed.has(row.id));

    let nextFocus = null;
    if (afterRow && !doomed.has(afterRow.id)) nextFocus = afterRow.id;
    else if (beforeRow && !doomed.has(beforeRow.id)) nextFocus = beforeRow.id;
    else if (state.rows.length) nextFocus = state.rows[0].id;
    state.focusId = nextFocus;
    if (!state.selected.size) state.anchorId = nextFocus;

    let text = "Deleted " + count(doomed.size, "item");
    if (!state.rows.length) text += ". The list is empty.";
    afterChange(text, true);
    return true;
  }

  function toggleCollapse(id) {
    if (!state) return false;
    const row = rec(id);
    if (!row || !row.collapsible) return false;
    row.collapsed = !row.collapsed;
    if (row.collapsed) {
      const hidden = descendants(row.id);
      if (hidden.some((child) => child.id === state.focusId)) {
        state.focusId = row.id;
      }
    }
    const hadFocus = !!(gridEl && gridEl.contains(document.activeElement));
    refresh();
    showStatus("");
    if (state.rows.length && hadFocus) focusCell(state.focusId);
    return true;
  }

  /* --- keyboard ------------------------------------------------------ */

  function focusLastBarControl() {
    const items = focusableIn(toolbarEl);
    if (items.length) {
      items[items.length - 1].focus({ preventScroll: true });
      return true;
    }
    const bar = overlayEl && overlayEl.querySelector(".edit-bar");
    const fallback = focusableIn(bar);
    if (fallback.length) {
      fallback[fallback.length - 1].focus({ preventScroll: true });
      return true;
    }
    return false;
  }

  function stepFocus(delta, extend) {
    const visible = visibleRows();
    if (!visible.length) return;
    const at = visible.findIndex((row) => row.id === state.focusId);
    const next = clamp(at + delta, 0, visible.length - 1);
    if (extend) {
      extendTo(visible[next].id);
      return;
    }
    state.focusId = visible[next].id;
    paintActive();
    focusCell(state.focusId);
    showStatus("");
  }

  function jumpFocus(toEnd, extend) {
    const visible = visibleRows();
    if (!visible.length) return;
    const row = toEnd ? visible[visible.length - 1] : visible[0];
    if (extend) {
      extendTo(row.id);
      return;
    }
    state.focusId = row.id;
    paintActive();
    focusCell(state.focusId);
    showStatus("");
  }

  function onGridKeydown(e) {
    if (!state) return;
    const cell = e.target.closest && e.target.closest(".le-cell");
    if (!cell) return;
    const key = e.key;
    const letter = (key || "").toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const alt = e.altKey;

    if (key === "Escape") return;    // the overlay owns Esc

    if (stale) {
      if (key === "ArrowUp" || key === "ArrowDown" || key === "Home" ||
          key === "End") {
        e.preventDefault();
        e.stopPropagation();
        if (key === "Home") jumpFocus(false, false);
        else if (key === "End") jumpFocus(true, false);
        else stepFocus(key === "ArrowDown" ? 1 : -1, false);
      }
      return;
    }

    if (alt && !mod) {
      if (letter === "arrowup" || letter === "arrowdown") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) moveRowsToEdge(letter === "arrowup" ? "top" : "bottom");
        else moveRows(letter === "arrowup" ? "up" : "down");
        return;
      }
      if (letter === "a") { e.preventDefault(); e.stopPropagation(); sortRows("asc"); return; }
      if (letter === "z") { e.preventDefault(); e.stopPropagation(); sortRows("desc"); return; }
      if (letter === "b") { e.preventDefault(); e.stopPropagation(); doneToBottom(); return; }
      if (letter === "d") { e.preventDefault(); e.stopPropagation(); markDone(true); return; }
      if (letter === "o") { e.preventDefault(); e.stopPropagation(); markDone(false); return; }
      return;
    }

    if (mod) {
      if (letter === "a") {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) selectNone();
        else selectAll();
      }
      return;   // Ctrl/Cmd+Z stays with the history engine
    }

    switch (key) {
      case "ArrowUp":
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        stepFocus(key === "ArrowDown" ? 1 : -1, e.shiftKey);
        break;
      case "Home":
      case "End":
        e.preventDefault();
        e.stopPropagation();
        jumpFocus(key === "End", e.shiftKey);
        break;
      case "ArrowRight":
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) return;
        expandFocused(true);
        break;
      case "ArrowLeft":
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) return;
        expandFocused(false);
        break;
      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        expandFocused(null);
        break;
      case " ":
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) toggleRowDone(state.focusId);
        else toggleSelected(state.focusId, true);
        break;
      case "Tab": {
        const visible = visibleRows();
        const first = visible[0];
        const last = visible[visible.length - 1];
        if (!e.shiftKey && last && state.focusId === last.id) {
          e.preventDefault();
          e.stopPropagation();
          if (cancelBtn) cancelBtn.focus({ preventScroll: true });
          break;
        }
        if (e.shiftKey && first && state.focusId === first.id) {
          e.preventDefault();
          e.stopPropagation();
          focusLastBarControl();
          break;
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) outdentRows();
        else indentRows();
        break;
      }
      case "Delete":
        e.preventDefault();
        e.stopPropagation();
        deleteRows();
        break;
      default:
        break;
    }
  }

  /* ArrowRight expands, ArrowLeft collapses, Enter toggles; `expand` null
   * means toggle. A leaf, or a parent already in the asked state, is a
   * no-op. */
  function expandFocused(expand) {
    const row = rec(state.focusId);
    if (!row || !row.collapsible) return false;
    if (expand === null) return toggleCollapse(row.id);
    const isExpanded = !row.collapsed;
    if (isExpanded !== expand) return toggleCollapse(row.id);
    return false;
  }

  function onOverlayKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  /* --- pointer ------------------------------------------------------- */

  function onGridMousedown(e) {
    if (!state) return;
    if (e.button !== 0) return;
    const cell = e.target.closest && e.target.closest(".le-cell");
    if (!cell) return;
    e.preventDefault();   // one press is one action; no text drag-select
  }

  function onGridClick(e) {
    if (!state) return;
    const target = e.target;
    const chev = target.closest && target.closest(".le-chev");
    if (chev) {
      e.stopPropagation();
      if (!stale) toggleCollapse(Number(chev.getAttribute("data-row-id")));
      return;
    }
    const done = target.closest && target.closest(".le-done");
    if (done) {
      e.stopPropagation();
      if (!stale) toggleRowDone(Number(done.getAttribute("data-row-id")));
      return;
    }
    const cell = target.closest && target.closest(".le-cell");
    if (!cell) return;
    if (stale) return;
    const row = rec(Number(cell.parentElement.getAttribute("data-row-id")));
    if (!row) return;
    if (e.shiftKey) {
      extendTo(row.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSelected(row.id, false);
      return;
    }
    setSelection(new Set([row.id]));
    state.anchorId = row.id;
    state.focusId = row.id;
    paintActive();
    focusCell(row.id);
    showStatus("");
  }

  /* --- apply / cancel ------------------------------------------------ */

  function focusFirstItem(container) {
    if (!container || !viewerContentEl || !viewerContentEl.contains(container)) {
      focusViewer();
      return;
    }
    focusViewer();
    const li = container.querySelector("li");
    if (li && NB.hybrid && NB.hybrid.focusListItem) NB.hybrid.focusListItem(li);
    else placeCaret(container, false);
  }

  function focusListItemNode(node) {
    if (!node || !viewerContentEl || !viewerContentEl.contains(node)) return false;
    focusViewer();
    if (NB.hybrid && NB.hybrid.focusListItem) NB.hybrid.focusListItem(node);
    else placeCaret(node, false);
    return true;
  }

  function focusAfterContainer(container) {
    focusViewer();
    if (!container || !container.isConnected) {
      placeCaret(viewerContentEl, false);
      return;
    }
    const next = container.nextElementSibling;
    const prev = container.previousElementSibling;
    if (next) placeCaret(next, false);
    else if (prev) placeCaret(prev, true);
    else placeCaret(viewerContentEl, false);
  }

  function focusAfterRemoval(anchor) {
    focusViewer();
    if (!viewerContentEl) return;
    if (anchor && anchor.next && anchor.next.isConnected) {
      placeCaret(anchor.next, false);
    } else if (anchor && anchor.prev && anchor.prev.isConnected) {
      placeCaret(anchor.prev, true);
    } else {
      placeCaret(viewerContentEl, false);
    }
  }

  function focusAfterStale() {
    focusViewer();
    if (!viewerContentEl) return;
    const list = viewerContentEl.querySelector("ul,ol");
    const li = list && list.querySelector("li");
    if (li && NB.hybrid && NB.hybrid.focusListItem) NB.hybrid.focusListItem(li);
    else if (list) placeCaret(list, false);
    else placeCaret(viewerContentEl, false);
  }

  function goStale() {
    if (!state || stale) return;
    stale = true;
    if (noticeEl) noticeEl.hidden = false;
    if (gridEl) gridEl.setAttribute("aria-readonly", "true");
    if (applyBtn) {
      applyBtn.hidden = false;
      applyBtn.disabled = true;
    }
    syncToolbar();
    if (hist) hist.sync();
    showRaw(STALE_STATUS);
    if (cancelBtn) cancelBtn.focus({ preventScroll: true });
  }

  function apply() {
    if (!state) return;
    if (stale) return;
    if (!state.container || !viewerContentEl ||
        !viewerContentEl.contains(state.container)) {
      goStale();
      return;
    }
    const plan = rebuildPlan();
    if (!plan) { showStatus(APPLY_FAILED); return; }
    let removedAnchor = null;
    if (plan.empty) {
      removedAnchor = {
        next: state.container.nextElementSibling,
        prev: state.container.previousElementSibling,
      };
    }
    if (signatureOf(plan) === state.openSignature) {
      close({ focusList: true });
      return;
    }
    if (NB.hybrid && NB.hybrid.clearSelection) NB.hybrid.clearSelection();
    if (NB.hybrid && NB.hybrid.flushPendingSnapshot) {
      NB.hybrid.flushPendingSnapshot();
    }
    const savedHtml = viewerContentEl.innerHTML;
    try {
      commitPlan(plan);
    } catch (err) {
      viewerContentEl.innerHTML = savedHtml;
      showStatus(APPLY_FAILED);
      return;
    }
    if (NB.hybrid && NB.hybrid.onContentChange) NB.hybrid.onContentChange();
    close({ focusList: !plan.empty, skipCaret: plan.empty });
    if (plan.empty) focusAfterRemoval(removedAnchor);
  }

  function cancel() { close(); }

  /* --- open / close -------------------------------------------------- */

  function typeBadge() {
    if (!state) return "";
    if (state.wrappers[0].tag === "OL") return "Numbered list";
    const allTasks = state.rows.every((row) => row.done !== null);
    return allTasks ? "Task list" : "Bulleted list";
  }

  function open(item) {
    if (!overlayEl || !item) return false;
    if (!NB.hybrid || !NB.hybrid.isActive || !NB.hybrid.isActive()) return false;
    if (!NB.auth || !NB.auth.canWrite || !NB.auth.canWrite()) return false;
    viewerContentEl = viewerContentEl || document.getElementById("viewer-content");
    if (!viewerContentEl) return false;
    if (!NB.hybrid.listContainer) return false;
    const container = NB.hybrid.listContainer(item);
    if (!container || !viewerContentEl.contains(container)) return false;
    if (isOpen()) close({ skipCaret: true });

    stale = false;
    if (!buildModel(container)) { state = null; return false; }
    if (typeEl) typeEl.textContent = typeBadge();

    if (applyBtn) {
      applyBtn.hidden = false;
      applyBtn.disabled = false;
    }
    if (noticeEl) noticeEl.hidden = true;
    if (gridEl) gridEl.removeAttribute("aria-readonly");
    overlayEl.hidden = false;
    refresh();
    showStatus("");
    // Seeding comes after the model is built, so a reopened window cannot
    // inherit the previous list.
    if (hist) hist.reset();

    const firstCell = state.cells.get(state.focusId) || null;
    if (NB.dialog) NB.dialog.open(overlayEl, { fallbackFocus: firstCell });
    focusCell(state.focusId);
    if (NB.listEdit && NB.listEdit.disable) NB.listEdit.disable();
    return true;
  }

  function close(opts) {
    if (!overlayEl || overlayEl.hidden) return;
    const options = opts || {};
    const wasStale = stale;
    const focusRow = state ? rec(state.focusId) : null;
    const focusNode = focusRow ? focusRow.node : null;
    const container = state ? state.container : null;

    overlayEl.hidden = true;
    if (NB.dialog) NB.dialog.close(overlayEl);

    state = null;
    stale = false;
    if (gridEl) {
      gridEl.textContent = "";
      gridEl.hidden = false;
      gridEl.removeAttribute("aria-readonly");
      gridEl.style.removeProperty("--le-mark-w");
    }
    if (emptyEl) emptyEl.hidden = true;
    if (noticeEl) noticeEl.hidden = true;
    if (statusEl) statusEl.textContent = "";
    if (applyBtn) {
      applyBtn.hidden = false;
      applyBtn.disabled = false;
    }
    if (hist) hist.clear();

    if (!options.skipCaret) {
      if (wasStale) focusAfterStale();
      else if (options.focusList) focusFirstItem(container);
      else if (!focusListItemNode(focusNode)) focusAfterContainer(container);
    }
    if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive() &&
        NB.listEdit && NB.listEdit.enable) {
      NB.listEdit.enable();
    }
  }

  function isOpen() { return !!overlayEl && !overlayEl.hidden; }

  function isStale() { return isOpen() && stale; }

  /* --- history ------------------------------------------------------- */

  function snapshotState() {
    if (!state) return "";
    return JSON.stringify({
      rows: state.rows.map((row) => ({
        i: row.id,
        p: row.parentId,
        d: row.done === null ? null : (row.done ? 1 : 0),
        c: !!row.collapsed,
      })),
      sel: Array.from(state.selected),
      anchor: state.anchorId,
    });
  }

  function restoreSnapshot(json) {
    if (!state || stale) return false;
    let snap;
    try { snap = JSON.parse(json); } catch (_) { return false; }
    if (!snap || !Array.isArray(snap.rows)) return false;

    const rows = [];
    const depths = new Map();
    for (let i = 0; i < snap.rows.length; i++) {
      const entry = snap.rows[i];
      if (!entry || typeof entry.i !== "number") return false;
      const row = state.byId[entry.i];
      if (!row) return false;
      const depth = entry.p == null ? 0 : depths.get(entry.p);
      if (depth == null) return false;
      if (i > 0 && depth > rows[rows.length - 1].depth + 1) return false;
      row.depth = depth;
      row.done = entry.d === null ? null : !!entry.d;
      row.collapsed = !!entry.c;
      depths.set(row.id, depth + 1);
      rows.push(row);
    }
    if (rows.length && rows[0].depth !== 0) return false;

    const previousFocus = state.focusId;
    state.rows = rows;
    deriveRows();

    const present = new Set(rows.map((row) => row.id));
    const selected = new Set();
    (snap.sel || []).forEach((id) => {
      if (present.has(id)) selected.add(id);
    });
    state.selected = rootsOnly(selected);
    state.anchorId = present.has(snap.anchor) ? snap.anchor : null;

    let focus = present.has(previousFocus) ? previousFocus : null;
    if (focus === null) {
      const at = rows.findIndex((row) => row.id === previousFocus);
      focus = at > 0 ? rows[at - 1].id : (rows.length ? rows[0].id : null);
    }
    state.focusId = focus;
    if (state.anchorId == null) state.anchorId = focus;

    const hadFocus = !!(gridEl && gridEl.contains(document.activeElement));
    refresh();
    showStatus("");
    if (rows.length && hadFocus) focusCell(state.focusId);
    return true;
  }

  /* --- wiring -------------------------------------------------------- */

  function wire() {
    overlayEl = byId("list-editor-overlay");
    if (!overlayEl) return;
    gridEl = byId("list-editor-grid");
    noticeEl = byId("list-editor-notice");
    statusEl = byId("list-editor-status");
    emptyEl = overlayEl.querySelector(".le-empty");
    typeEl = byId("list-editor-type");
    toolbarEl = byId("le-toolbar");
    applyBtn = byId("list-editor-apply");
    cancelBtn = byId("list-editor-cancel");

    hist = NB.editWindow.attach({
      overlay: overlayEl,
      prefix: "list-editor",
      isOpen: isOpen,
      enabled: () => !!state && !stale,
      ownsKey: () => true,
      snapshot: snapshotState,
      restore: restoreSnapshot,
      onError: (msg) => showRaw(msg || NOT_RESTORED),
    });

    overlayEl.addEventListener("keydown", onOverlayKeydown);
    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) cancel();
    });

    const closeBtn = byId("list-editor-close");
    if (closeBtn) closeBtn.addEventListener("click", cancel);
    if (cancelBtn) cancelBtn.addEventListener("click", cancel);
    if (applyBtn) applyBtn.addEventListener("click", apply);

    if (gridEl) {
      gridEl.addEventListener("keydown", onGridKeydown);
      gridEl.addEventListener("mousedown", onGridMousedown);
      gridEl.addEventListener("click", onGridClick);
    }

    if (toolbarEl) {
      toolbarEl.querySelectorAll(".le-tool").forEach((node) => {
        node.addEventListener("click", () => onToolClick(node.id));
      });
    }
  }

  wire();

  NB.evt.on("hybrid:rerendered", () => {
    if (!isOpen() || !state) return;
    if (!viewerContentEl || !viewerContentEl.contains(state.container)) goStale();
  });

  NB.evt.on("hybrid:exited", () => {
    if (!isOpen()) return;
    close({ skipCaret: true });
    focusViewer();
  });

  NB.listEditor = {
    open,
    close,
    isOpen,
    isStale,
    apply,
    cancel,
    _apply: apply,
    _cancel: cancel,
    moveRows,
    moveRowsToEdge,
    indentRows,
    outdentRows,
    sortRows,
    doneToBottom,
    markDone,
    deleteRows,
    toggleCollapse,
    getState() { return state; },
    rebuildPlan,
    _signature() {
      return {
        open: state ? state.openSignature : null,
        current: currentSignature(),
      };
    },
    _select,
    overlayEl() { return overlayEl; },
    _undo() { return hist ? hist.undo() : null; },
    _redo() { return hist ? hist.redo() : null; },
    _history() {
      return hist ? hist.info()
        : { mode: "stack", depth: 0, index: -1, canUndo: false, canRedo: false };
    },
  };
})();