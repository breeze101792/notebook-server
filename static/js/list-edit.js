/* list-edit.js -- drag handles for list items in hybrid (WYSIWYG) mode.
 *
 * One overlay layer (a child of #viewer, deliberately OUTSIDE the
 * contentEditable subtree) carries, for the list item under the pointer
 * or containing the caret:
 *
 *   - a grip in the left gutter (the same hover-reveal model as the
 *     table row grip in table-edit.js);
 *   - during a drag, a translucent ghost of the lifted item, a chip
 *     that follows the pointer, and a drop line at the resolved
 *     insertion point.
 *
 * Dragging reorders a whole item subtree with Pointer Events
 * (pointerdown + setPointerCapture -- never HTML5 DnD, which hijacks
 * text selection inside the item and behaves differently across
 * engines). The actual mutation is hybrid.js's moveListItem(), which
 * moves the existing <li> node and marks the note dirty; the keyboard
 * path (the List context submenu, Alt+Up/Down) is moveItemBySelection().
 *
 * Serialization-safety contract:
 *   - The overlay is a SIBLING of .nb-table-overlay, not the same node.
 *     table-edit.js clears its own layer on every render and would wipe
 *     a list drop line mid-drag; the two layers never touch each other's
 *     nodes.
 *   - The overlay is NOT in #viewer-content, so turndown's clone and
 *     hybrid's innerHTML undo snapshots never see grips, drop lines or
 *     drag ghosts. No stripping code is needed anywhere.
 *   - No class or attribute is ever put on a list node during a drag;
 *     the lifted item is drawn as a translucent ghost in the overlay. A
 *     zero-height item is given the same marked caret <br> the enter
 *     path uses so it can be measured, and it is removed again as soon
 *     as the measurement is taken (and it is hash-stripped on save).
 *   - The overlay hides on scroll (positions are rect-based and drift
 *     otherwise); it re-shows on the next pointer/focus interaction.
 *
 * A polite aria-live region outside #viewer-content announces every
 * completed move (drag or keyboard): "Item moved to position 3, level 1".
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const GRACE_MS = 120;       // hide delay after the pointer leaves an item
  const GRIP_SIZE = 24;       // px, must match .nb-list-grip CSS
  // The grip's right edge is flush with the item's left edge, so there is
  // no dead strip between the two that a mouseover could fall into and
  // clear the grip (the "hover-intent" hole). See pointerInItemGutter for
  // the belt-and-braces guard at the clamped/edge cases.
  const GUTTER_X = GRIP_SIZE;
  const PROXY_OFFSET = 8;     // pointer -> drag chip offset
  const FALLBACK_INDENT = 26; // px, when the CSS list indent cannot be read
  const MAX_DEPTH = 99;       // sanity cap on a rail-derived nesting level
  const SUMMARY_MAX = 28;     // drag-chip text limit before an ellipsis
  const EDGE_SAFE = 4;        // min px the grip keeps from the #viewer left edge

  let viewerEl = null;        // #viewer: overlay host, position:relative
  let viewerContentEl = null;
  let overlay = null;        // .nb-list-overlay
  let liveRegion = null;      // polite aria-live announcer
  let built = false;
  let enabled = false;
  let activeItem = null;      // item whose grip is shown
  let graceTimer = null;
  let rafPending = false;
  // Hover-intent lock: while the pointer is over a grip (or a drag is
  // running), the active item must not re-target to a neighbouring item.
  let controlHover = false;

  // Drag state (null when idle).
  let drag = null;

  /* --- tiny DOM helpers (same shapes as table-edit.js) ------------- */

  const SVG_DOT_GRID =
    '<svg class="nb-grip-icon" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
    '<circle cx="1" cy="1" r="1.1"/><circle cx="5" cy="1" r="1.1"/>' +
    '<circle cx="1" cy="5" r="1.1"/><circle cx="5" cy="5" r="1.1"/>' +
    '<circle cx="1" cy="9" r="1.1"/><circle cx="5" cy="9" r="1.1"/>' +
    "</svg>";

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  /* Overlay-space rect helper: a viewport rect -> overlay space. */
  function toOverlay(rect) {
    const host = viewerEl.getBoundingClientRect();
    return { left: rect.left - host.left, top: rect.top - host.top,
             right: rect.right - host.left, bottom: rect.bottom - host.top,
             width: rect.width, height: rect.height };
  }

  function placeAt(node, rect) {
    const host = viewerEl.getBoundingClientRect();
    node.style.left = Math.round(rect.left - host.left) + "px";
    node.style.top = Math.round(rect.top - host.top) + "px";
  }

  function placeAtOverlay(node, x, y) {
    node.style.left = Math.round(x) + "px";
    node.style.top = Math.round(y) + "px";
  }

  /* --- list geometry ---------------------------------------------- */

  /* The viewport rect of `li`'s OWN box (never the checkbox's). A
   * zero-height item (emptied during this session) is given the marked
   * line box just long enough to measure, then the exact box added is
   * removed again. Null when the item still has no box. */
  function liBox(li) {
    let r = li.getBoundingClientRect();
    if (!r.height) {
      const br = NB.hybrid.addMeasureLineBox(li);
      if (br) {
        r = li.getBoundingClientRect();
        NB.hybrid.stripMeasureLineBox(br);
      }
    }
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
             width: r.width, height: r.height };
  }

  /* The viewport rect of `li`'s hit region: the UNION of its own box and
   * its checkbox's rect, because a task checkbox hangs outside the item's
   * border box (margin: 0 .53em 0 -1.53em) and a pointer over that marker
   * column would otherwise resolve no item. */
  function hitRect(li) {
    const r = liBox(li);
    if (!r) return null;
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    const cb = NB.hybrid.taskCheckboxOf(li);
    if (cb) {
      const cr = cb.getBoundingClientRect();
      if (cr.width && cr.height) {
        left = Math.min(left, cr.left);
        top = Math.min(top, cr.top);
        right = Math.max(right, cr.right);
        bottom = Math.max(bottom, cr.bottom);
      }
    }
    return { left: left, top: top, right: right, bottom: bottom,
             width: right - left, height: bottom - top };
  }

  /* Overlay-space hit rect (marker-inclusive union), or null. */
  function itemRect(li) {
    const r = hitRect(li);
    return r ? toOverlay(r) : null;
  }

  /* The deepest item whose hit region contains the point, searched
   * within `scope`. Reverse document order so an inner item wins over
   * the outer item whose box contains it. */
  function itemAtPoint(x, y, scope) {
    const items = Array.from(scope.querySelectorAll("li"));
    for (let i = items.length - 1; i >= 0; i--) {
      const r = hitRect(items[i]);
      if (!r) continue;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
        return items[i];
      }
    }
    return null;
  }

  /* The item on the pointer's row, in document order (the gutter
   * fallback: the pointer is left of every item, so the row decides). */
  function itemAtRow(y, scope) {
    for (const li of Array.from(scope.querySelectorAll("li"))) {
      const r = hitRect(li);
      if (r && y >= r.top && y < r.bottom) return li;
    }
    return null;
  }

  /* The item under a viewport point, resolved by the engine's own hit
   * test (O(1) instead of scanning every <li>). The overlay is
   * pointer-events:none, so only the grip can shadow the content; a
   * point over the grip resolves no <li> and the caller keeps its lock. */
  function itemAtPointer(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    const li = el.closest("li");
    return li && viewerContentEl.contains(li) ? li : null;
  }

  /* True when a viewport point is in the narrow gutter between `li`'s own
   * box and its grip (GUTTER_X - GRIP_SIZE wide). Crossing that strip must
   * not clear the grip: it is the approach path, not a new target. */
  function pointerInItemGutter(x, y, li) {
    const r = hitRect(li);
    if (!r) return false;
    return y >= r.top && y < r.bottom &&
      x >= r.left - GUTTER_X && x < r.left;
  }

  /* The container's rail geometry: the base rail (x of a top-level
   * item's text) and the width of one nesting step (the CSS list
   * indent). The step is read from the layout, so the same rule works
   * inside the root, a blockquote, or a table cell. */
  function containerGeometry(container) {
    const step = parseFloat(getComputedStyle(container).paddingLeft) ||
      FALLBACK_INDENT;
    const rect = container.getBoundingClientRect();
    return { baseX: rect.left + step, step: step };
  }

  /* The nesting level the pointer x picks: the nearest indent rail,
   * never left of the base rail. The hybrid resolver clamps it to the
   * legal range. */
  function depthFromX(x, geo) {
    const d = Math.round((x - geo.baseX) / geo.step);
    return clamp(d, 0, MAX_DEPTH);
  }

  /* --- grip building ---------------------------------------------- */

  function makeGrip() {
    const b = el("button", "nb-list-grip");
    b.type = "button";
    b.tabIndex = 0;
    b.setAttribute("aria-label", "Reorder list item");
    b.title = "Drag to move this list item";
    b.innerHTML = SVG_DOT_GRID;
    return b;
  }

  /* Rebuild the overlay's single grip for the active item. The x comes
   * from the item's hit region so a task checkbox -- which overhangs the
   * item's box -- never has the grip drawn on top of it (the grip must
   * stay clickable-but-clear, and the checkbox clickable). It is clamped
   * to #viewer's left edge so a deep overhang cannot clip it off-screen. */
  function renderGrip() {
    overlay.textContent = "";
    if (!activeItem || !viewerEl || !viewerContentEl) return;
    if (!viewerContentEl.contains(activeItem)) { activeItem = null; return; }
    const r = itemRect(activeItem);
    if (!r) return;
    const grip = makeGrip();
    placeAtOverlay(grip,
      Math.max(r.left - GUTTER_X, EDGE_SAFE),
      r.top + r.height / 2 - GRIP_SIZE / 2);
    grip.addEventListener("pointerdown", (e) => startDrag(e, activeItem));
    overlay.appendChild(grip);
  }

  /* Show the grip for `item` only when it changed. Called on mouseover
   * (not on every pointermove), so the hover cost is one elementFromPoint
   * hit test plus, at most, one render. */
  function setActiveItem(item) {
    if (item === activeItem) return;
    activeItem = item;
    renderGrip();
  }

  function trackPointer(e) {
    if (!enabled || drag || controlHover) return;
    const item = itemAtPointer(e.clientX, e.clientY);
    if (item) { setActiveItem(item); return; }
    // No item under the pointer. If it crossed the few px between the
    // active item's box and its own grip (GUTTER_X - GRIP_SIZE), keep the
    // item: that strip is the grip's approach path, not a new target.
    if (activeItem && pointerInItemGutter(e.clientX, e.clientY, activeItem)) {
      return;
    }
    setActiveItem(null);
  }

  /* Derive the active item from the caret (focus path: the keyboard
   * user's context follows the selection). */
  function trackCaret() {
    if (!enabled || drag) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const li = node && node.closest && node.closest("li");
    if (li && viewerContentEl.contains(li)) setActiveItem(li);
  }

  /* --- drag state machine ----------------------------------------- */

  function clearOverlayDynamic() {
    overlay.querySelectorAll(".nb-drop-line,.nb-drag-ghost,.nb-drag-proxy")
      .forEach((n) => n.remove());
  }

  /* One-line readable summary of an item for the drag chip: its own
   * text with nested lists and checkboxes removed. */
  function itemSummary(li) {
    const clone = li.cloneNode(true);
    clone.querySelectorAll("ul,ol,input").forEach((n) => n.remove());
    const text = (clone.textContent || "").trim().replace(/\s+/g, " ");
    return text.length > SUMMARY_MAX
      ? text.slice(0, SUMMARY_MAX - 1) + "\u2026"
      : (text || "(empty item)");
  }

  function startDrag(e, item) {
    if (!enabled || !item) return;
    // Primary button only. A right/middle press must fall through to the
    // native context menu; preventDefault below would swallow it.
    if (e.button !== undefined && e.button !== 0) return;
    const container = NB.hybrid.listContainer(item);
    if (!container) return;
    e.preventDefault();                 // never move the caret / start selection
    e.stopPropagation();
    // Capture on #viewer, not on the grip: renderGrip() removes and
    // rebuilds the grip on the next render, and capture on a removed
    // node is released by the engine. #viewer persists for the drag.
    if (viewerEl.setPointerCapture) viewerEl.setPointerCapture(e.pointerId);
    // Drop the stale grip BEFORE adding the drag chrome (renderGrip clears
    // the overlay wholesale -- the table-edit startCommon order).
    renderGrip();
    const ghost = el("div", "nb-drag-ghost");
    const proxy = el("div", "nb-drag-proxy");
    proxy.textContent = itemSummary(item);
    const line = el("div", "nb-drop-line is-list");
    overlay.append(ghost, proxy, line);
    drag = { pointerId: e.pointerId, item: item, container: container,
             ghost: ghost, proxy: proxy, line: line,
             startRect: item.getBoundingClientRect(),
             lastX: e.clientX, lastY: e.clientY, resolved: null };
    document.body.classList.add("nb-list-drag");
    moveDrag(e);
  }

  /* Resolve the pointer to (target, side, depth) and the dry-run
   * destination. Null when the drop is refused (outside the movable
   * container, onto a non-list block, or into the item's own subtree) or
   * resolves to the item's current position. */
  function resolveDrop(x, y) {
    const item = drag.item;
    const container = drag.container;
    const geo = containerGeometry(container);
    let target = itemAtPoint(x, y, container);
    let railX = x;
    if (!target) {
      // Left of every item: clamp x to the base rail and match by row.
      target = itemAtRow(y, container);
      railX = geo.baseX;
      if (!target) return null;
    }
    const r = hitRect(target);
    if (!r) return null;
    const side = (y < r.top + r.height / 2) ? "before" : "after";
    const depth = depthFromX(railX, geo);
    const dest = NB.hybrid.resolveListItemMove(item, target, side, depth);
    if (!dest) return null;
    if (dest.list === item.parentNode &&
        (dest.before === item || dest.before === item.nextElementSibling)) {
      return null;                     // no-op drop position
    }
    return { target: target, side: side, depth: depth, dest: dest };
  }

  function drawLine(res) {
    const d = res.dest;
    let left, top, right;
    if (d.list) {
      const ref = d.before || d.list.lastElementChild;
      if (!ref) { drag.line.style.display = "none"; return; }
      const r = toOverlay(ref.getBoundingClientRect());
      left = r.left;
      right = r.right;
      top = d.before ? r.top : r.bottom;
    } else {
      // A new child list under createParent: one step right of its text,
      // on the line below it.
      const r = toOverlay(d.createParent.getBoundingClientRect());
      const step = containerGeometry(drag.container).step;
      left = r.left + step;
      right = r.right;
      top = r.bottom;
    }
    drag.line.style.left = Math.round(left) + "px";
    drag.line.style.top = Math.round(top - 1) + "px";
    drag.line.style.width = Math.max(0, Math.round(right - left)) + "px";
    drag.line.style.display = "";
  }

  function moveDrag(e) {
    const start = drag.startRect;
    placeAt(drag.ghost, start);
    drag.ghost.style.width = Math.round(start.width) + "px";
    drag.ghost.style.height = Math.round(start.height) + "px";
    const host = viewerEl.getBoundingClientRect();
    drag.proxy.style.left = Math.round(e.clientX - host.left + PROXY_OFFSET) + "px";
    drag.proxy.style.top = Math.round(e.clientY - host.top + PROXY_OFFSET) + "px";
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    const res = resolveDrop(e.clientX, e.clientY);
    drag.resolved = res;
    if (!res) { drag.line.style.display = "none"; return; }
    drawLine(res);
  }

  function onPointerMove(e) {
    // Hover tracking is mouseover-driven (see onOver), not pointermove:
    // a pointermove over the gutter left of every item would otherwise
    // resolve no item and clear the grip the instant the pointer moves
    // toward it. pointermove here only drives an in-progress drag.
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!drag) return;
      moveDrag(e);
    });
  }

  /* Finish (or cancel) a drag. On commit the mutation is hybrid's
   * moveListItem(); a refused or no-op drop is decided inside it BEFORE
   * any snapshot flush, so the history is untouched. The drag chrome is
   * always torn down, even if the mutation throws, so a ghost/line can
   * never leak. */
  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove("nb-list-drag");
    try { if (viewerEl.releasePointerCapture) viewerEl.releasePointerCapture(d.pointerId); } catch (_) {}
    try {
      if (commit && d.resolved) {
        const res = d.resolved;
        NB.hybrid.moveListItem(d.item, res.target, res.side, res.depth);
      }
    } finally {
      clearOverlayDynamic();
      renderGrip();
    }
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(true);
  }
  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
  }

  // Escape cancels a drag; Ctrl+Z during a drag cancels it too (and must
  // NOT run hybrid's undo while the DOM is mid-state).
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
    activeItem = null;
    overlay.textContent = "";
  }

  /* Hover-intent lock: entering/leaving a grip must not re-target the
   * active item (moving onto the grip must not flip to the item below).
   * Bound on #viewer -- the grip's own layer and #viewer-content are both
   * its children, so a mouseover on the grip reaches this listener. */
  function onOver(e) {
    if (!enabled || drag) return;
    controlHover = !!(e.target.closest && e.target.closest(".nb-list-grip"));
    if (!controlHover) {
      // Re-entering an item cancels a pending hide (the table-edit reveal
      // rule); without it the grace timer armed when the pointer left the
      // grip fires and removes the grip just re-shown.
      clearTimeout(graceTimer);
      graceTimer = null;
      trackPointer(e);
    }
  }
  function onOut(e) {
    if (!enabled || !activeItem || drag) return;
    const from = e.target.closest && e.target.closest("#viewer-content li");
    const to = e.relatedTarget && e.relatedTarget.closest &&
      e.relatedTarget.closest("#viewer-content li");
    if (from && from !== to) scheduleHide();
  }
  function onFocusIn(e) {
    if (!enabled) return;
    trackCaret();
  }
  function onFocusOut(e) {
    if (!enabled || !activeItem || drag) return;
    scheduleHide();
  }
  function onSelectionChange() {
    if (!enabled || drag || controlHover) return;
    trackCaret();
  }

  function scheduleHide() {
    if (drag) return;   // a drag owns the overlay until pointerup
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // Only hide when the pointer isn't resting on the overlay (i.e.
      // the user moved from an item onto its gutter grip).
      if (!overlay.matches(":hover")) hide();
    }, GRACE_MS);
  }

  /* --- enable / disable -------------------------------------------- */

  function enable() {
    if (!viewerEl || !overlay || enabled) return;
    enabled = true;
    viewerEl.appendChild(overlay);
    if (liveRegion) viewerEl.appendChild(liveRegion);
    viewerEl.addEventListener("mouseover", onOver);
    viewerEl.addEventListener("mouseout", onOut);
    viewerContentEl.addEventListener("focusin", onFocusIn);
    viewerContentEl.addEventListener("focusout", onFocusOut);
    viewerEl.addEventListener("pointermove", onPointerMove);
    viewerEl.addEventListener("pointerup", onPointerUp);
    viewerEl.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("keydown", onDragKey, true);
    document.addEventListener("selectionchange", onSelectionChange);
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
    viewerEl.removeEventListener("mouseover", onOver);
    viewerEl.removeEventListener("mouseout", onOut);
    viewerContentEl.removeEventListener("focusin", onFocusIn);
    viewerContentEl.removeEventListener("focusout", onFocusOut);
    viewerEl.removeEventListener("pointermove", onPointerMove);
    viewerEl.removeEventListener("pointerup", onPointerUp);
    viewerEl.removeEventListener("pointercancel", onPointerCancel);
    document.removeEventListener("keydown", onDragKey, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    viewerContentEl.removeEventListener("scroll", hide);
    window.removeEventListener("resize", hide);
  }

  function build() {
    viewerEl = document.getElementById("viewer");
    viewerContentEl = document.getElementById("viewer-content");
    if (!viewerEl || !viewerContentEl) return;
    overlay = el("div", "nb-list-overlay");
    overlay.hidden = false;   // visibility is CSS-driven; empty == invisible
    liveRegion = el("div", "nb-list-live");
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    built = true;
    // Both are appended on enable() (children of #viewer, outside the
    // contenteditable subtree) so preview mode never carries them.
  }

  /* Announce every completed move, drag or keyboard: position among the
   * item's siblings (1-based) and its nesting level (1-based). */
  NB.evt.on("list:item-moved", ({ item }) => {
    if (!item || !liveRegion || !NB.hybrid) return;
    const container = NB.hybrid.listContainer(item);
    if (!container || !item.parentNode) return;
    const siblings = Array.from(item.parentNode.children)
      .filter((n) => n.tagName === "LI");
    const pos = siblings.indexOf(item) + 1;
    const level = NB.hybrid.listItemDepth(item, container) + 1;
    liveRegion.textContent = "Item moved to position " + pos + ", level " + level;
  });

  build();

  NB.evt.on("hybrid:entered", () => { if (!built) build(); enable(); });
  NB.evt.on("hybrid:exited", disable);

  // Re-exported for tests (jsdom drives the module directly).
  NB.listEdit = {
    get overlay() { return overlay; },
    get isEnabled() { return enabled; },
    get activeItem() { return activeItem; },
    get liveRegion() { return liveRegion; },
    get drag() { return drag; },
    setActiveItem,
    renderGrip,
    hide,
    enable,
    disable,
    startDrag,        // test hook
    _endDrag: endDrag,
  };
})();
