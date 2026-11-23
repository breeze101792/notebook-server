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
 *     the done map, and each edited row's prose) taken at open and again
 *     at Apply -- never a "changed" flag -- so move-down-then-up, or an
 *     edit and its window-level undo, writes no file and adds no undo entry.
 *   - Stale is the only read-only state. It is node identity, not
 *     content: when #viewer-content no longer contains the container the
 *     window keeps its rows, shows the notice strip, disables every tool
 *     and Apply, and writes nothing.
 *
 * A third: one row's prose can be edited in place (F2 or a double-press),
 * but only the item's own prose run. The nested list, the checkbox and the
 * plugin cards stay outside the field, and a run that does not hold all of
 * the item's text is refused rather than half-edited.
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

  // The prose run of one item: the contiguous direct children of its host
  // that carry text or inline content, up to the first child that opens or
  // splits it. Anything after that child is prose this window cannot reach,
  // which is why the editability guard refuses the row instead of offering a
  // partial edit.
  const RUN_BOUNDARY = "ul,ol,blockquote,p,pre,table,div,hr,input," +
    "[contenteditable=\"false\"]";
  const CARET_BR_ATTR = "data-hybrid-caret-br";
  // The engine's provenance marker: an authored element is content and keeps
  // every attribute (hybrid.js:144, :1459-1460).
  const AUTHORED_ATTR = "data-hybrid-authored";
  const RUN_KEEP_TAGS =
    new Set(["STRONG", "B", "EM", "I", "CODE", "A", "BR", "IMG"]);
  const RUN_DROP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const A_KEEP_ATTRS = ["href", "title", "data-wikilink", "data-wikilink-raw"];
  const IMG_KEEP_ATTRS = ["src", "alt", "title"];
  const NEWLINE_RUN = /[\r\n]+/g;

  const EDIT_TAP_MS = 350;   // a second press inside this window edits
  const EDIT_TAP_PX = 8;     // ... and inside this distance of the first

  const BASE_MARK_W = 20;      // the --le-mark-w stylesheet default, px
  const MARK_GAP = 4;          // px added to the widest visible marker
  const MARK_MIN_CSS = "20px"; // mirrors the stylesheet's --le-mark-w
  const MARK_CAP_CSS = "calc(3ch + 2px)";

  const DEFAULT_ROMAN = 3999;  // beyond this an ordinal falls back to decimal

  const DRAG_THRESHOLD = 4;    // px of travel before a press becomes a drag
  const AUTOSCROLL_EDGE = 24;  // px from the scroller's edge that scrolls
  const AUTOSCROLL_STEP = 8;   // px scrolled per animation frame

  const CHEV_SVG =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';

  const STALE_STATUS =
    "This list changed outside the window. Nothing was applied.";
  const STALE_CAUSE = "This list changed outside the window.";
  const NOT_RESTORED = "The saved state could not be restored";
  const APPLY_FAILED = "Could not apply — the list was not changed";
  const EDITED = "Edited 1 item";

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
    editRefused: "Editing needs one piece of text the window can keep.",
    dragLevel: "Dragging needs the selected items to share one level.",
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
  let scrollEl = null;
  let state = null;
  let stale = false;
  let drag = null;       // the live drag, null when there is none
  let pending = null;    // a press that has not yet crossed the threshold
  let swallowClick = false;   // the click the browser fires after a drop
  let editing = null;    // { rowId, span, baseHtml } -- the one live field
  let lastPress = null;  // the previous plain press: { rowId, x, y, t }
  let imeLatch = false;  // swallow the Enter that ends an IME composition

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

  /* The label the row shows, without the empty fallback: `ownText` is
   * immutable, so a dirty row's label comes from its `edits` entry. */
  function labelTextOf(row) {
    if (!row) return "";
    if (state && state.edits && state.edits.has(row.id)) {
      return stripRun(state.edits.get(row.id));
    }
    return row.ownText;
  }

  function labelOf(row) { return labelTextOf(row) || EMPTY_LABEL; }

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
      // Only rows whose prose differs from the live item: empty at open, so
      // the opening signature is byte-identical to a window without edits.
      edits: new Map(),
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
      texts: {},
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

    // An edited row's prose rides in the plan only while the row is in it, so
    // a deleted row's edit dies with the delete and a moved one writes where
    // the move put it.
    plan.rowOrder.forEach((id) => {
      if (state.edits.has(id)) plan.texts[id] = state.edits.get(id);
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
    // JSON.stringify escapes the field separator, so typed control
    // characters cannot forge a collision.
    const texts = plan.rowOrder
      .filter((id) => Object.prototype.hasOwnProperty.call(plan.texts, id))
      .map((id) => id + "=" + JSON.stringify(plan.texts[id]))
      .join("\u0002");
    return rows + "\u0001" + wrappers + "\u0001" + done + "\u0001" + texts;
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

    // 5. Text pass: each edited row's run is replaced where the row now is.
    // Recomputing the extent from the live <li> is why no boundary
    // reference has to be stored; a row that the delete pass removed is
    // absent from the plan, so its edit writes nothing.
    plan.rowOrder.forEach((id) => {
      if (!Object.prototype.hasOwnProperty.call(plan.texts, id)) return;
      const row = rec(id);
      if (row && row.node && row.node.parentNode) {
        writeRun(row, plan.texts[id]);
      }
    });

    // 6. P4: a row's child list is its last element child.
    state.rows.forEach((row) => {
      if (!keep.has(row.id)) return;
      const own = row.node.lastElementChild;
      if (own && /^(UL|OL)$/.test(own.tagName)) return;
      if (row.node.querySelector(":scope > ul, :scope > ol")) {
        throw new Error("child list is not last");
      }
    });

    // 7. Done flags: the property is the live authority, the attribute is
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

    // 8. Empty model: every row and wrapper is gone.
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

    const words = labelTextOf(row);
    const text = el("span", "le-text");
    if (!words) text.classList.add("is-empty");
    text.textContent = words || EMPTY_LABEL;
    text.title = words || EMPTY_LABEL;
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

  /* --- item text editing (one row, in place) ------------------------ */
  /* One row at a time carries an editable prose run: F2 on the focused row,
   * or a double-press on its text. The field is the row's own `.le-text`
   * span with contenteditable on it -- no overlay editor. Only the run is
   * written: the nested list, the checkbox and plugin cards stay outside it,
   * while the item's own breaks and images are run members. The decision to
   * offer a field at all is runCapture()'s two-part guard. */

  function isTaskBox(node) {
    return !!node && node.nodeType === 1 && node.tagName === "INPUT" &&
      node.type === "checkbox";
  }

  /* The element holding the item's prose: a loose item (marked wraps its
   * content in a <p>) hosts the run in that first <p> while the child list
   * follows as its sibling; a tight one hosts it in the <li>. A checkbox
   * outside the first <p> sends the host back to the <li>, whose first child
   * is then a boundary -- an empty, conservatively uneditable run. */
  function runHost(row) {
    const li = row && row.node;
    if (!li) return null;
    const p = Array.from(li.children).find((node) => node.tagName === "P");
    if (!p) return li;
    const box = NB.hybrid.taskCheckboxOf ? NB.hybrid.taskCheckboxOf(li) : null;
    return !box || p.contains(box) ? p : li;
  }

  /* A leading checkbox is state, not prose: the run starts right after it. */
  function runStartIndex(host) {
    const kids = Array.from(host.childNodes);
    let i = 0;
    while (i < kids.length && isTaskBox(kids[i])) i += 1;
    return i;
  }

  function isBoundary(node) {
    return node.nodeType === 1 && node.matches(RUN_BOUNDARY);
  }

  /* The ordered maximal contiguous run of the host's children: everything
   * after a leading checkbox, up to the first child that opens or splits the
   * text. */
  function runNodes(host) {
    if (!host) return [];
    const kids = Array.from(host.childNodes);
    const out = [];
    for (let i = runStartIndex(host); i < kids.length; i++) {
      if (isBoundary(kids[i])) break;
      out.push(kids[i]);
    }
    return out;
  }

  function boundaryAfterRun(host) {
    const kids = Array.from(host.childNodes);
    for (let i = runStartIndex(host); i < kids.length; i++) {
      if (isBoundary(kids[i])) return kids[i];
    }
    return null;
  }

  /* The extent's serialization. The caret <br> and the ZWS placeholder are
   * extent members -- a replacement removes them -- but never part of the
   * capture: the serializer sweeps both at save. */
  function captureRun(row) {
    const holder = document.createElement("div");
    runNodes(runHost(row)).forEach((node) => {
      holder.appendChild(node.cloneNode(true));
    });
    holder.querySelectorAll("[" + CARET_BR_ATTR + "]").forEach((node) => {
      node.remove();
    });
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT, null);
    const emptied = [];
    let text = walker.nextNode();
    while (text) {
      text.nodeValue = text.nodeValue.replace(ZERO_WIDTH, "");
      if (!text.nodeValue) emptied.push(text);
      text = walker.nextNode();
    }
    emptied.forEach((node) => node.remove());
    return holder.innerHTML;
  }

  /* The one flattening rule, applied to a run rather than a clone of the
   * whole <li>: what the field shows, flattened, is the label it must agree
   * with. */
  function stripRun(html) {
    const holder = document.createElement("div");
    holder.innerHTML = html == null ? "" : String(html);
    holder.querySelectorAll("br").forEach((br) => {
      br.replaceWith(document.createTextNode(" "));
    });
    return (holder.textContent || "")
      .replace(ZERO_WIDTH, "")
      .replace(WHITESPACE, " ")
      .trim();
  }

  function keepRunAttrs(node, keep) {
    Array.from(node.attributes).forEach((attr) => {
      if (keep.indexOf(attr.name) === -1) node.removeAttribute(attr.name);
    });
  }

  /* Attributes are deleted in place, never removed and re-added: a canonical
   * run re-serializes byte-identically, which is what the guard compares. */
  function cleanRun(parent, keepAll) {
    let node = parent.firstChild;
    while (node) {
      const next = node.nextSibling;
      if (node.nodeType === 3) {
        node.nodeValue = node.nodeValue.replace(NEWLINE_RUN, " ");
        node = next;
        continue;
      }
      if (node.nodeType !== 1) { node.remove(); node = next; continue; }
      const tag = node.tagName;
      if (RUN_DROP_TAGS.has(tag)) { node.remove(); node = next; continue; }
      if (keepAll || node.hasAttribute(AUTHORED_ATTR)) {
        // The engine's provenance contract: authored inline markup is
        // content and keeps every attribute.
        cleanRun(node, true);
        node = next;
        continue;
      }
      if (RUN_KEEP_TAGS.has(tag)) {
        keepRunAttrs(node, tag === "A" ? A_KEEP_ATTRS
          : tag === "IMG" ? IMG_KEEP_ATTRS : []);
        cleanRun(node, false);
        node = next;
        continue;
      }
      // Any other element unwraps to its children.
      cleanRun(node, false);
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      node.remove();
      node = next;
    }
  }

  /* The one choke point, and the security boundary: text, strong/b, em/i,
   * code, a (the serializer's own attribute set), br, img, and every
   * authored element untouched. Everything else unwraps; script, style,
   * noscript and template drop with their text; newline runs collapse to one
   * space. */
  function sanitizeRun(html) {
    const holder = document.createElement("div");
    holder.innerHTML = html == null ? "" : String(html);
    cleanRun(holder, false);
    return holder.innerHTML;
  }

  /* Two tests on the capture, not one: (a) canonical -- nothing in the extent
   * would be unwrapped, dropped or lose an attribute, because the other test
   * is text-only and ownText strips inputs and cards at any depth; (b) whole
   * prose -- the run's text is the item's whole label, so no words lie
   * outside the field. Either failure means no field, and one sentence. */
  function runCapture(row) {
    const capture = captureRun(row);
    if (sanitizeRun(capture) !== capture) return null;
    if (stripRun(capture) !== row.ownText) return null;
    return capture;
  }

  function fieldOf(rowId) {
    const cell = state && state.cells ? state.cells.get(rowId) : null;
    return cell ? cell.querySelector(".le-text") : null;
  }

  function placeCaretAtPointIn(field, point) {
    if (!field || !point) return;
    const sel = window.getSelection();
    if (!sel) return;
    const inside = (node) => !!node && (node === field || field.contains(node));
    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(point.x, point.y);
      if (range && inside(range.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(point.x, point.y);
      if (pos && inside(pos.offsetNode)) {
        const range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
    }
    // A press past the prose (or a platform with no hit test) puts the caret
    // at the end, never outside the field.
    placeCaret(field, true);
  }

  function scrollFieldIntoView(field) {
    if (field && field.scrollIntoView) {
      field.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /* The placeholder is CSS on a class, never a text node, and never shows
   * beside an image: the field holds an image and no words is not "empty". */
  function updateBlank(field) {
    const words = (field.textContent || "").replace(ZERO_WIDTH, "");
    field.classList.toggle("is-blank", !words && !field.querySelector("img"));
  }

  function onEditInput(e) {
    if (!editing || e.target !== editing.span) return;
    updateBlank(editing.span);
  }

  function onViewportResize() {
    // The on-screen keyboard shrinks no layout viewport this window can
    // read, so a resize is the only signal that the field may be covered.
    if (editing && editing.span) scrollFieldIntoView(editing.span);
  }

  function editRow(id, point) {
    if (!state || stale) return false;
    const row = rec(id);
    if (!row) return false;
    if (editing) {
      if (editing.rowId === id) return true;
      commitEdit({ keepFocus: true });
    }
    const capture = runCapture(row);
    if (capture === null) {
      showStatus(REASON.editRefused);
      return false;
    }
    const field = fieldOf(row.id);
    if (!field) return false;
    // The field shows the model's current value: the clean capture, or the
    // row's existing entry when it is already dirty.
    const baseHtml = state.edits.has(row.id)
      ? state.edits.get(row.id) : sanitizeRun(capture);
    editing = { rowId: row.id, span: field, baseHtml: baseHtml };
    field.textContent = "";
    field.innerHTML = baseHtml;
    if (!field.firstChild) {
      // An empty run still needs a caret host; the placeholder is CSS, so
      // nothing here can be committed.
      field.appendChild(document.createTextNode("\u200B"));
    }
    field.classList.add("is-editing");
    field.classList.remove("is-empty");
    updateBlank(field);
    field.setAttribute("contenteditable", "true");
    field.setAttribute("role", "textbox");
    field.setAttribute("aria-label", "Item text");
    field.setAttribute("aria-multiline", "false");
    field.tabIndex = -1;
    field.removeAttribute("title");
    const rowEl = field.closest(".le-row");
    if (rowEl) rowEl.classList.add("is-editing");
    const body = bodyEl();
    if (body) body.classList.add("is-editing");
    imeLatch = false;
    try { field.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    if (point) placeCaretAtPointIn(field, point);
    else placeCaret(field, true);
    scrollFieldIntoView(field);
    return true;
  }

  /* The field's HTML without the caret host: captureRun sweeps the same
   * placeholder, so an untouched empty field compares equal to "". A lone
   * <br> is the browser's break left in an emptied field -- this window
   * creates no breaks -- so it reads as the empty string too, never as a
   * phantom edit that would write it back. */
  function readField(field) {
    const html = sanitizeRun((field.innerHTML || "").replace(ZERO_WIDTH, ""));
    return /^(?:<br\s*\/?>\s*)+$/.test(html) ? "" : html;
  }

  function overlayHoldsFocus() {
    const active = document.activeElement;
    return !!(overlayEl && active && active !== overlayEl &&
      overlayEl.contains(active));
  }

  function restoreLabel(row) {
    const field = fieldOf(row.id);
    if (!field) return;
    const words = labelTextOf(row);
    field.textContent = words || EMPTY_LABEL;
    field.title = words || EMPTY_LABEL;
    field.classList.toggle("is-empty", !words);
    field.classList.remove("is-blank");
  }

  /* Every way out of the field goes through here, so no repaint can run over
   * a live span: the surface is stripped before anything renders. */
  function clearEditSurface() {
    const live = editing;
    editing = null;
    imeLatch = false;
    if (!live) return;
    const field = live.span;
    if (field) {
      const rowEl = field.closest(".le-row");
      if (rowEl) rowEl.classList.remove("is-editing");
      field.classList.remove("is-editing");
      field.classList.remove("is-blank");
      field.removeAttribute("contenteditable");
      field.removeAttribute("role");
      field.removeAttribute("aria-label");
      field.removeAttribute("aria-multiline");
      field.removeAttribute("tabindex");
    }
    const body = bodyEl();
    if (body) body.classList.remove("is-editing");
  }

  /* One commit is one step: the field's current value either matches
   * baseHtml (nothing, not even a repaint), reverts to the live prose (the
   * entry is deleted, which is a real change), or becomes the entry. */
  function commitEdit(opts) {
    if (!editing || !state) return false;
    const o = opts || {};
    const id = editing.rowId;
    const field = editing.span;
    const baseHtml = editing.baseHtml;
    const hadField = o.blur === true || document.activeElement === field;
    const value = field ? readField(field) : baseHtml;
    const row = rec(id);
    clearEditSurface();
    if (!row) return false;
    const routeFocus = hadField && !o.keepFocus && !overlayHoldsFocus();
    if (value === baseHtml) {
      restoreLabel(row);
      if (routeFocus) focusCell(id);
      return false;
    }
    const clean = sanitizeRun(captureRun(row));
    if (value === clean) state.edits.delete(id);
    else state.edits.set(id, value);
    afterChange(EDITED, true);
    if (routeFocus) focusCell(id);
    return true;
  }

  /* Esc, a stale re-render, a close: the field is discarded and the label
   * comes back from the model. */
  function abortEdit() {
    if (!editing || !state) return false;
    const id = editing.rowId;
    const hadField = document.activeElement === editing.span;
    clearEditSurface();
    const row = rec(id);
    if (!row) return false;
    restoreLabel(row);
    if (hadField && !overlayHoldsFocus()) focusCell(id);
    return true;
  }

  function runFragment(html) {
    const holder = document.createElement("div");
    holder.innerHTML = html == null ? "" : String(html);
    const frag = document.createDocumentFragment();
    while (holder.firstChild) frag.appendChild(holder.firstChild);
    return frag;
  }

  /* Apply's text write: the run is replaced where the row now sits. The
   * first extent node is the insertion point, recorded before anything is
   * removed; an empty extent inserts before the host's first boundary child
   * (never before a leading checkbox), else at the host's end. */
  function writeRun(row, html) {
    const host = runHost(row);
    if (!host) return;
    const nodes = runNodes(host);
    const frag = runFragment(html);
    if (!frag.firstChild) {
      // An emptied item keeps its line box: one ZWS, as the engine plants it.
      frag.appendChild(document.createTextNode("\u200B"));
    }
    const at = nodes.length ? nodes[0] : boundaryAfterRun(host);
    if (at && at.parentNode === host) host.insertBefore(frag, at);
    else host.appendChild(frag);
    nodes.forEach((node) => node.remove());
  }

  function insertPlainText(text) {
    const field = editing ? editing.span : null;
    if (!field) return;
    let inserted = false;
    try {
      inserted = !!(document.execCommand &&
        document.execCommand("insertText", false, text));
    } catch (_) { inserted = false; }
    if (!inserted) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && field.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        field.appendChild(document.createTextNode(text));
        placeCaret(field, true);
      }
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
    // A live edit commits first, whatever the verb: Safari does not focus a
    // clicked button, so the blur cannot be the only commit point.
    if (editing) commitEdit({ keepFocus: true });
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
    // The edit commits before the verb or the refusal, so a half-typed word
    // is never lost to a tool press.
    if (editing) commitEdit({ keepFocus: true });
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
    const keyed = level.map((row, index) => ({
      row: row, index: index, key: labelTextOf(row),
    }));
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
    // A live drag owns the model: Delete, Ctrl/Cmd+Z or a move chord would
    // mutate it under the pointer.
    if (drag) return;
    // A live edit owns every key: this grid's verbs are not its target.
    if (editing) { onEditKeydown(e); return; }
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
      case "F2":
        e.preventDefault();
        e.stopPropagation();
        editRow(state.focusId);
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

  /* While the field has focus every key is the field's except the named
   * few: Enter and Tab commit, F2 commits, Shift+Enter creates no break,
   * Ctrl/Cmd+B/I/U create no formatting, Alt chords and the model keys are
   * inert, and an IME confirm never commits. Esc is left to the overlay,
   * which cancels the edit before the window. */
  function onEditKeydown(e) {
    if (!editing) return;
    const key = e.key || "";
    if (key === "Escape") return;
    // Chrome reports keyCode 229 during a composition; WebKit can deliver
    // the confirm keydown after compositionend, hence the one-shot latch.
    if (e.isComposing || e.keyCode === 229) return;
    if (imeLatch) {
      imeLatch = false;
      if (key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) return;   // the field creates no break
      commitEdit();
      return;
    }
    if (key === "Tab" || key === "F2") {
      e.preventDefault();
      e.stopPropagation();
      commitEdit();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const letter = key.toLowerCase();
      if (letter === "b" || letter === "i" || letter === "u") {
        e.preventDefault();
        e.stopPropagation();
      }
      return;   // A/X/C/V/Z/Y stay the field's own
    }
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onGridFocusOut(e) {
    if (!editing || e.target !== editing.span) return;
    commitEdit({ blur: true });
  }

  function onEditCompositionEnd() {
    if (editing) imeLatch = true;
  }

  function onEditPaste(e) {
    if (!editing || !editing.span.contains(e.target)) return;
    e.preventDefault();
    const data = e.clipboardData || window.clipboardData;
    const text = data ? data.getData("text/plain") : "";
    // Plain text only, and no line break: this window cannot create
    // formatting, so it does not accept any either.
    insertPlainText(text.replace(WHITESPACE, " "));
  }

  function onEditDrop(e) {
    if (!editing || !editing.span.contains(e.target)) return;
    e.preventDefault();
    const data = e.dataTransfer;
    const text = data ? data.getData("text/plain") : "";
    if (text) insertPlainText(text.replace(WHITESPACE, " "));
  }

  function onOverlayKeydown(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    // One press spends one thing: the edit, then the drag, then the window.
    if (editing) { abortEdit(); return; }
    if (drag) { endDrag(false); return; }
    cancel();
  }

  /* --- pointer ------------------------------------------------------- */

  function onGridMousedown(e) {
    if (!state) return;
    if (e.button !== 0) return;
    const cell = e.target.closest && e.target.closest(".le-cell");
    if (!cell) return;
    // A press in the live field places the caret, so the pointer layer and
    // this handler both return for it and neither may preventDefault. Any
    // other press is one action, with no text drag-select.
    if (editing && editing.span && editing.span.contains(e.target)) return;
    e.preventDefault();
  }

  function onGridClick(e) {
    if (!state) return;
    if (swallowClick) { disarmClickGuard(); return; }
    const target = e.target;
    const chev = target.closest && target.closest(".le-chev");
    if (chev) {
      e.stopPropagation();
      if (editing) commitEdit({ keepFocus: true });
      if (!stale) toggleCollapse(Number(chev.getAttribute("data-row-id")));
      return;
    }
    const done = target.closest && target.closest(".le-done");
    if (done) {
      e.stopPropagation();
      if (editing) commitEdit({ keepFocus: true });
      if (!stale) toggleRowDone(Number(done.getAttribute("data-row-id")));
      return;
    }
    const cell = target.closest && target.closest(".le-cell");
    if (!cell) return;
    if (stale) return;
    const row = rec(Number(cell.parentElement.getAttribute("data-row-id")));
    if (!row) return;
    // The release that ends a double-press is still the field's: it must not
    // pull focus back to the cell.
    if (editing && editing.rowId === row.id) return;
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

  /* --- drag ---------------------------------------------------------- */
  /* A press on a row and a move past the threshold drags that row with its
   * whole subtree. A press on a selected root drags the block instead: the
   * span from the first selected root in its parent to the last one's whole
   * subtree, so the unselected siblings between them travel inside it. There
   * is no re-parenting: the slot is always a position among the block's own
   * siblings (Indent/Outdent are the level changes), and a selection spanning
   * two parents starts no drag at all. The decision is moveBlocks(); this
   * layer only maps the pointer to a beforeRowId and draws the line. */

  /* The index just past the last block of one level, in a row array. */
  function endOfLevel(rows, parentId) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].parentId !== parentId) continue;
      let at = i + 1;
      while (at < rows.length && rows[at].depth > rows[i].depth) at += 1;
      return at;
    }
    if (parentId === null) return 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === parentId) return i + 1;
    }
    return rows.length;
  }

  function orderedRows(rowIds) {
    const wanted = new Set(rowIds);
    return state.rows.filter((row) => wanted.has(row.id));
  }

  /* The contiguous span a block occupies: from the first root to the last
   * root's whole subtree, the rows between the roots included. */
  function spanOf(rowIds) {
    const ordered = orderedRows(rowIds);
    if (!ordered.length) return null;
    const from = indexOf(ordered[0].id);
    const to = blockEnd(indexOf(ordered[ordered.length - 1].id));
    if (from < 0 || to <= from) return null;
    return { from: from, to: to, ordered: ordered };
  }

  /* The pure decision behind a block drop, shared by the model step and the
   * line so the two can never disagree. `at` is an index in the model WITHOUT
   * the span, so the post-removal arithmetic is the splice's; `noop` is the
   * resulting id sequence compared with the current one, never `at === from`.
   * Returns null for every refusal. */
  function blockSlot(rowIds, beforeRowId) {
    if (!state) return null;
    const ids = Array.isArray(rowIds) ? rowIds.map(Number) : [];
    if (!ids.length) return null;
    // 1. Every id resolves, none repeats, and no root sits inside another.
    const seen = new Set();
    const roots = [];
    for (let i = 0; i < ids.length; i++) {
      if (seen.has(ids[i])) return null;
      const row = rec(ids[i]);
      if (!row) return null;
      seen.add(ids[i]);
      roots.push(row);
    }
    for (let i = 0; i < roots.length; i++) {
      if (isLockedWith(seen, roots[i].id)) return null;
    }
    // 2. One level: a mixed-parent block refuses whole, like To top/bottom.
    const parentId = roots[0].parentId;
    if (roots.some((row) => row.parentId !== parentId)) return null;
    const span = spanOf(ids);
    if (!span) return null;
    const spanIds = new Set();
    state.rows.slice(span.from, span.to).forEach((row) => spanIds.add(row.id));
    const position = levelRows(parentId).indexOf(span.ordered[0]);
    // 3. The slot: a same-level row OUTSIDE the span, or the level's end.
    let target = null;
    if (beforeRowId !== null && beforeRowId !== undefined) {
      target = rec(Number(beforeRowId));
      if (!target || target.parentId !== parentId) return null;
      if (spanIds.has(target.id)) return null;
    }
    const rest = state.rows.slice(0, span.from)
      .concat(state.rows.slice(span.to));
    const at = target ? rest.indexOf(target) : endOfLevel(rest, parentId);
    if (at < 0) return null;
    const block = state.rows.slice(span.from, span.to);
    const order = rest.slice(0, at).concat(block, rest.slice(at));
    let noop = order.length === state.rows.length;
    if (noop) {
      for (let i = 0; i < order.length; i++) {
        if (order[i].id !== state.rows[i].id) { noop = false; break; }
      }
    }
    return {
      from: span.from,
      to: span.to,
      at: at,
      position: position,
      count: span.ordered.length,
      firstId: span.ordered[0].id,
      parentId: parentId,
      spanIds: spanIds,
      order: order,
      noop: noop,
    };
  }

  /* Move a block -- one row, or the selected roots' whole span -- inside its
   * own parent level. Model only: no repaint and no history step, so the
   * caller owns both. `position` is the first root's 0-based index among its
   * siblings after the call and `count` the number of roots; a refusal leaves
   * the order untouched and reports position -1 and count 0. */
  function moveBlocks(rowIds, beforeRowId) {
    if (stale || !state) return { moved: false, position: -1, count: 0 };
    const slot = blockSlot(rowIds, beforeRowId);
    if (!slot) return { moved: false, position: -1, count: 0 };
    if (slot.noop) {
      return { moved: false, position: slot.position, count: slot.count };
    }
    state.rows = slot.order;
    deriveRows();
    const first = rec(slot.firstId);
    return {
      moved: true,
      position: first ? levelRows(first.parentId).indexOf(first) : -1,
      count: slot.count,
    };
  }

  /* The one-row wrapper the shipped tests and seam keep. */
  function moveBlock(rowId, beforeRowId) {
    const res = moveBlocks([rowId], beforeRowId);
    return { moved: res.moved, position: res.position };
  }

  function rowElementOf(id) {
    const cell = state && state.cells ? state.cells.get(id) : null;
    return cell ? cell.parentElement : null;
  }

  /* The slot under a pointer Y: the first visible row of the block's level
   * OUTSIDE its span whose vertical midpoint is below it, else null for the
   * end of the level. Other levels are never slots, so a descendant of
   * another row cannot open its level, and skipping the span is what makes
   * the block un-droppable -- including the rows between its roots. */
  function slotAt(d, y) {
    const level = visibleRows().filter((row) =>
      row.parentId === d.parentId && !d.spanIds.has(row.id));
    for (let i = 0; i < level.length; i++) {
      const node = rowElementOf(level[i].id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.height) continue;   // not laid out: no evidence, no slot
      if (y < rect.top + rect.height / 2) return level[i].id;
    }
    return null;
  }

  /* Where the line goes, in client coordinates: the top of the row the drop
   * lands before, else under the last block of the level outside the span.
   * Left is the level's indent start, right the body's right edge. */
  function lineBox(d, beforeRowId) {
    const right = gridEl.getBoundingClientRect().right;
    const level = visibleRows().filter((row) =>
      row.parentId === d.parentId && !d.spanIds.has(row.id));
    if (!level.length) return null;   // the span covers the level: no slot
    let top = null;
    if (beforeRowId !== null) {
      const node = rowElementOf(beforeRowId);
      if (!node) return null;
      top = node.getBoundingClientRect().top;
    } else {
      const last = level[level.length - 1];
      const after = blockEnd(indexOf(last.id));
      const following = state.rows[after] || null;
      const followingEl = following ? rowElementOf(following.id) : null;
      if (followingEl) {
        top = followingEl.getBoundingClientRect().top;
      } else {
        const endEl = rowElementOf(state.rows[after - 1].id);
        if (!endEl) return null;
        top = endEl.getBoundingClientRect().bottom;
      }
    }
    const row = rec(d.rowId);
    return { top: top, left: levelLeft(row ? row.depth : 0), right: right };
  }

  /* The level's indent start: the disclosure cell of any row at that depth,
   * which sits after the guides and before the chevron. */
  function levelLeft(depth) {
    const rows = visibleRows();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].depth !== depth) continue;
      const node = rowElementOf(rows[i].id);
      const chev = node
        ? node.querySelector(".le-chev, .le-chev-slot") : null;
      if (chev) return chev.getBoundingClientRect().left;
    }
    return gridEl.getBoundingClientRect().left;
  }

  function hideLine() {
    if (drag && drag.line) drag.line.style.display = "none";
  }

  function drawLine(d, beforeRowId) {
    if (!d || !d.line || !scrollEl) return;
    const slot = blockSlot(d.rowIds, beforeRowId);
    if (!slot || slot.noop) { hideLine(); return; }
    const box = lineBox(d, beforeRowId);
    if (!box || box.top === null) { hideLine(); return; }
    const scrollBox = scrollEl.getBoundingClientRect();
    const dx = scrollEl.scrollLeft - scrollBox.left;
    const dy = scrollEl.scrollTop - scrollBox.top;
    d.line.style.display = "";
    d.line.style.left = Math.round(box.left + dx) + "px";
    d.line.style.top = Math.round(box.top + dy - 1) + "px";
    d.line.style.width =
      Math.max(0, Math.round(box.right - box.left)) + "px";
  }

  /* Every row of the block's span dims: the roots, their subtrees and the
   * unselected rows between them, because all of them move. */
  function markSpan(d, on) {
    if (!state || !d) return;
    for (let i = d.from; i < d.to; i++) {
      const node = rowElementOf(state.rows[i].id);
      if (node) node.classList.toggle("is-dragging", on);
    }
  }

  function bodyEl() {
    return overlayEl ? overlayEl.querySelector(".le-body") : null;
  }

  function pointAt(y) {
    if (!drag) return;
    const beforeRowId = slotAt(drag, y);
    drag.beforeRowId = beforeRowId;
    drawLine(drag, beforeRowId);
  }

  function beginDrag(e, press) {
    pending = null;
    // The press that started this drag must not also count as half of an
    // edit pair: a press within the tap window after the drop would edit.
    lastPress = null;
    const roots = orderedRows(press.rowIds);
    if (!roots.length) return;
    const parentId = roots[0].parentId;
    // The mixed-level refusal is decided once, before the pointer is
    // captured: no line, no dim, no step, and the selection is untouched.
    if (roots.some((row) => row.parentId !== parentId)) {
      showStatus(REASON.dragLevel);
      return;
    }
    const span = spanOf(press.rowIds);
    if (!span) return;
    const spanIds = new Set();
    state.rows.slice(span.from, span.to).forEach((row) => spanIds.add(row.id));
    const line = el("div", "nb-drop-line le-drop-line");
    if (scrollEl) scrollEl.appendChild(line);
    drag = {
      pointerId: e.pointerId,
      rowId: press.rowId,
      rowIds: roots.map((row) => row.id),
      parentId: parentId,
      from: span.from,
      to: span.to,
      spanIds: spanIds,
      beforeRowId: null,
      lastY: e.clientY,
      line: line,
      raf: null,
    };
    // Capture on the grid: it survives every render, a row does not.
    try { gridEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const body = bodyEl();
    if (body) body.classList.add("is-dragging");
    document.body.classList.add("nb-le-drag");   // the grabbing cursor everywhere
    markSpan(drag, true);
    pointAt(e.clientY);
  }

  /* Every end path -- drop, Esc, pointercancel, close, stale -- goes
   * through here, so the line and the dim classes can never outlive it. */
  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    try { gridEl.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }
    if (d.line && d.line.parentNode) d.line.remove();
    markSpan(d, false);
    const body = bodyEl();
    if (body) body.classList.remove("is-dragging");
    document.body.classList.remove("nb-le-drag");
    // Every end path owes the browser one click -- a drop, a cancelled drag,
    // a close. It must not re-select the row; the next press retires it.
    armClickGuard();
    if (!commit || !state || stale) return;
    const res = moveBlocks(d.rowIds, d.beforeRowId);
    // Guarded explicitly: capture() dedupes on the whole snapshot including
    // the selection, so a no-op drop must never reach it.
    if (!res.moved) return;
    state.selected = new Set(d.rowIds);
    state.anchorId = d.rowId;   // the pressed root
    state.focusId = d.rowId;
    afterChange("Moved " + count(res.count, "item"), true);
  }

  function abortDrag() {
    pending = null;
    if (drag) endDrag(false);
  }

  /* The click the browser fires after the drag's pointerup must not select
   * the row again. One-shot: the boolean covers a direct click handler and
   * the overlay's capture listener covers anything above the grid. */
  function onGuardedClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    disarmClickGuard();
  }

  function disarmClickGuard() {
    swallowClick = false;
    if (overlayEl) overlayEl.removeEventListener("click", onGuardedClick, true);
  }

  function armClickGuard() {
    swallowClick = true;
    // Belt: a press that started a drag has already retired the edit pair,
    // and every end path goes through here, so no press can outlive a drop.
    lastPress = null;
    if (overlayEl) overlayEl.addEventListener("click", onGuardedClick, true);
  }

  /* A press that starts the next gesture retires the guard: the click a drop
   * owes the browser (when it fires at all) lands before it. */
  function onWindowPointerDown() {
    if (swallowClick) disarmClickGuard();
  }

  function stepScroll() {
    if (!drag) return;
    drag.raf = null;
    const box = scrollEl.getBoundingClientRect();
    const y = drag.lastY;
    let delta = 0;
    if (y < box.top + AUTOSCROLL_EDGE) delta = -AUTOSCROLL_STEP;
    else if (y > box.bottom - AUTOSCROLL_EDGE) delta = AUTOSCROLL_STEP;
    if (!delta) return;
    const before = scrollEl.scrollTop;
    scrollEl.scrollTop = before + delta;
    if (scrollEl.scrollTop === before) return;   // already at the edge
    pointAt(y);
    drag.raf = requestAnimationFrame(stepScroll);
  }

  function autoScroll(y) {
    if (!drag || drag.raf || !scrollEl) return;
    const box = scrollEl.getBoundingClientRect();
    if (y >= box.top + AUTOSCROLL_EDGE && y <= box.bottom - AUTOSCROLL_EDGE) {
      return;
    }
    drag.raf = requestAnimationFrame(stepScroll);
  }

  function selectRowOnly(id) {
    state.selected = new Set([id]);
    state.anchorId = id;
    state.focusId = id;
    paintSelection();
    paintActive();
    focusCell(id);
    syncToolbar();
    showStatus("");
  }

  /* Two plain presses within 350 ms and 8 px on the same row are one edit
   * gesture, for mouse, pen and touch alike. The detector is the pointer
   * layer's own, never the native dblclick: the press already calls
   * preventDefault and the compatibility events are not reliable. */
  function isDoublePress(e, rowId) {
    const now = Date.now();
    const previous = lastPress;
    lastPress = { rowId: rowId, x: e.clientX, y: e.clientY, t: now };
    if (!previous || previous.rowId !== rowId) return false;
    if (now - previous.t > EDIT_TAP_MS) return false;
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    return Math.sqrt(dx * dx + dy * dy) <= EDIT_TAP_PX;
  }

  function onGridPointerDown(e) {
    disarmClickGuard();
    if (!state || stale || drag) return;
    if (e.button !== 0) return;
    const target = e.target;
    if (!target || !target.closest) return;
    if (target.closest(".le-chev") || target.closest(".le-done")) return;
    const cell = target.closest(".le-cell");
    if (!cell) return;
    const rowId = Number(cell.parentElement.getAttribute("data-row-id"));
    const row = rec(rowId);
    if (!row) return;

    // A press inside the live field is the caret's, not this layer's: return
    // BEFORE preventDefault, which would suppress the compatibility mousedown
    // that actually places the caret. Nothing is armed and nothing changes.
    if (editing && editing.span && editing.span.contains(target)) return;

    // Any other press commits the live edit first, then does its own job --
    // one text step, then this press. A press on the same row but outside the
    // field only moves the caret region; it arms nothing either.
    if (editing) {
      if (editing.rowId === rowId) return;
      commitEdit({ keepFocus: true });
    }

    // `.le-meta` is a fact, not the item's words: no drag and no edit.
    if (target.closest(".le-meta")) { lastPress = null; return; }
    // A modifier press is the selection gesture it already is.
    if (e.ctrlKey || e.metaKey || e.shiftKey) { lastPress = null; return; }

    // The detector sits ahead of the drag candidate and consumes the press.
    if (isDoublePress(e, rowId)) {
      e.preventDefault();
      editRow(rowId, { x: e.clientX, y: e.clientY });
      return;
    }
    if (e.pointerType === "touch") return;   // touch pans; the toolbar reorders

    e.preventDefault();   // one press is one action; no native text drag
    // The press resolves the block: a press on a selected root keeps the
    // whole selection, and every selected root is the block. Any other press
    // replaces the selection with the pressed row and arms it alone.
    const keep = state.selected.has(rowId) && !isLocked(rowId);
    let blockIds;
    if (keep) {
      state.anchorId = rowId;
      state.focusId = rowId;
      paintActive();
      focusCell(rowId);
      blockIds = rootRecords().map((record) => record.id);
    } else {
      selectRowOnly(rowId);
      blockIds = [rowId];
    }
    pending = {
      pointerId: e.pointerId,
      rowId: rowId,
      rowIds: blockIds,
      x: e.clientX,
      y: e.clientY,
    };
  }

  function onGridPointerMove(e) {
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      drag.lastY = e.clientY;
      pointAt(e.clientY);
      autoScroll(e.clientY);
      return;
    }
    if (!pending || e.pointerId !== pending.pointerId) return;
    // The press was released outside the grid (no capture yet): a later
    // hover must not turn the stale candidate into a drag.
    if (!e.buttons) { pending = null; return; }
    const dx = e.clientX - pending.x;
    const dy = e.clientY - pending.y;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    beginDrag(e, pending);
  }

  function onGridPointerUp(e) {
    if (pending && e.pointerId === pending.pointerId) pending = null;
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.lastY = e.clientY;
    pointAt(e.clientY);
    endDrag(true);
  }

  /* No keyboard path mutates, undoes or closes while a drag is live: the
   * history engine's document-level chord listener sits behind this one.
   * Esc is left alone so onOverlayKeydown can cancel the drag. */
  function onDragKeyGuard(e) {
    if (!drag || e.key === "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  /* A press released outside the grid never reaches the grid's own
   * pointerup (there is no capture until a drag starts), so the page clears
   * the candidate; otherwise a later hover would turn it into a drag. The
   * same listener finishes a drag whose setPointerCapture failed: the grid's
   * own handler runs first, so this only ever sees a drag still live. */
  function onWindowPointerUp(e) {
    if (pending && e.pointerId === pending.pointerId) pending = null;
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.lastY = e.clientY;
    pointAt(e.clientY);
    endDrag(true);   // armClickGuard() is endDrag's, for every path
  }

  function onWindowPointerCancel(e) {
    if (pending && e.pointerId === pending.pointerId) pending = null;
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
  }

  function onGridPointerCancel(e) {
    if (pending && e.pointerId === pending.pointerId) pending = null;
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
  }

  function onGridCaptureLost(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
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
    abortDrag();
    // A field that cannot be written must not look writable: the edit is
    // discarded, never committed, and the label comes back from the model.
    abortEdit();
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
    // The commit lands after the guard and before the plan, so the signature
    // and the write both see the typed text.
    if (editing) commitEdit({ keepFocus: true });
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
    editing = null;
    lastPress = null;
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
    abortDrag();
    abortEdit();          // discard the typing; close never commits
    disarmClickGuard();
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
    const snap = {
      rows: state.rows.map((row) => ({
        i: row.id,
        p: row.parentId,
        d: row.done === null ? null : (row.done ? 1 : 0),
        c: !!row.collapsed,
      })),
      sel: Array.from(state.selected),
      anchor: state.anchorId,
    };
    // Present only when non-empty: omission is exact, not a cache. The pairs
    // are unfiltered, so undo of a delete brings its edited text back, and
    // sorted by id so the same map always serializes to the same string.
    if (state.edits.size) {
      snap.e = Array.from(state.edits.entries()).sort((a, b) => a[0] - b[0]);
    }
    return JSON.stringify(snap);
  }

  function restoreSnapshot(json) {
    if (!state || stale) return false;
    // The belt for the history bar's buttons, which the engine wires itself.
    // Inside the engine's restoring window this records no step, so the
    // restore governs: a mid-edit bar-click lands on the snapshot.
    if (editing) commitEdit({ keepFocus: true });
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

    // Text rides in the snapshot as data: a restore brings back the prose
    // that belonged to the state it restores, and the repaint derives every
    // label from it.
    const edits = new Map();
    (Array.isArray(snap.e) ? snap.e : []).forEach((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) return;
      if (typeof pair[0] !== "number" || typeof pair[1] !== "string") return;
      edits.set(pair[0], pair[1]);
    });
    state.edits = edits;

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
    scrollEl = overlayEl.querySelector(".le-scroll");
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
      // Ctrl/Cmd+Z must not undo mid-drag, and inside a row's text edit the
      // browser's own span undo owns the chord.
      ownsKey: () => !drag && !editing,
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
      gridEl.addEventListener("pointerdown", onGridPointerDown);
      gridEl.addEventListener("pointermove", onGridPointerMove);
      gridEl.addEventListener("pointerup", onGridPointerUp);
      gridEl.addEventListener("pointercancel", onGridPointerCancel);
      gridEl.addEventListener("lostpointercapture", onGridCaptureLost);
      gridEl.addEventListener("focusout", onGridFocusOut);
      gridEl.addEventListener("input", onEditInput);
      gridEl.addEventListener("paste", onEditPaste);
      gridEl.addEventListener("drop", onEditDrop);
      gridEl.addEventListener("compositionstart", () => { imeLatch = false; });
      gridEl.addEventListener("compositionend", onEditCompositionEnd);
    }

    // The on-screen keyboard shrinks no layout viewport this window can read.
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", onViewportResize);
    }

    // The page lives as long as the module, so these need no teardown.
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerCancel);
    document.addEventListener("keydown", onDragKeyGuard, true);

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
    _moveBlock: moveBlock,
    _moveBlocks: moveBlocks,
    editRow,               // public, like the verbs
    _editRow: editRow,     // the harness name: an alias, not a second seam
    _commitEdit: commitEdit,
    _abortEdit: abortEdit,
    _editing() {
      return editing ? { rowId: editing.rowId } : null;
    },
    _sanitizeRun: sanitizeRun,
    _signature() {
      return {
        open: state ? state.openSignature : null,
        current: currentSignature(),
      };
    },
    _select,
    overlayEl() { return overlayEl; },
    _undo() {
      if (editing) commitEdit({ keepFocus: true });
      return hist ? hist.undo() : null;
    },
    _redo() {
      if (editing) commitEdit({ keepFocus: true });
      return hist ? hist.redo() : null;
    },
    _history() {
      return hist ? hist.info()
        : { mode: "stack", depth: 0, index: -1, canUndo: false, canRedo: false };
    },
  };
})();