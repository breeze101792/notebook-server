/* table-edit.js -- the hybrid-mode "Edit table" control.
 *
 * Hybrid mode has exactly one table affordance: a 24px button in the left
 * gutter, centred on the table's header row. It sits outside the table's
 * content box, so it never covers the line above the table, the rows, or
 * the text to the right. Clicking it opens the table editor modal
 * (table-editor.js), which owns every structural operation -- row and
 * column move, insert, delete, alignment, sort, transpose, delete table.
 *
 * The overlay is a child of #viewer, outside the contentEditable subtree,
 * so it never reaches a save, an export, or an undo snapshot. The active
 * table follows the pointer (hover) and the caret (focus); it hides after
 * a short grace delay so the pointer can travel from the table onto the
 * button.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const BTN_SIZE = 24;      // px, must match .nb-te-open
  const BTN_GAP = 4;        // button right edge -> table left edge
  const EDGE_SAFE = 8;      // min distance a control keeps from a #viewer edge
  const GRACE_MS = 120;     // hide delay after the pointer leaves the table
  const CONTROL_SELECTOR = ".nb-te-open";

  let viewerEl = null;       // #viewer: overlay host, position:relative
  let viewerContentEl = null;
  let overlay = null;        // .nb-table-overlay
  let enabled = false;
  let activeTable = null;
  let graceTimer = null;
  let controlHover = false;

  const SVG_EDIT_TABLE =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
    '<path d="M2 3h12v10H2z"/><path d="M2 7h12M6 3v10"/></svg>';

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

  /* Viewport-space edges of #viewer, in overlay space. */
  function paneEdges() {
    return { left: 0, top: 0,
             right: viewerEl.clientWidth, bottom: viewerEl.clientHeight };
  }

  /* Overlay-space rect helper: convert a viewport rect into the
   * overlay's coordinate space. */
  function toOverlay(rect) {
    const host = viewerEl.getBoundingClientRect();
    return { left: rect.left - host.left, top: rect.top - host.top,
             right: rect.right - host.left, bottom: rect.bottom - host.top,
             width: rect.width, height: rect.height };
  }

  /* Rebuild the overlay: one button in the left gutter, vertically
   * centred on the header row. The gutter is empty in both surfaces, so
   * the control covers no text; when the pane edge leaves less room than
   * the button needs it is pinned inside the pane rather than floating
   * over the line above. */
  function render() {
    if (!overlay) return;
    overlay.textContent = "";
    if (!activeTable || !viewerContentEl) return;
    if (!viewerContentEl.contains(activeTable)) { activeTable = null; return; }
    const header = activeTable.rows[0];
    if (!header) return;

    const V = paneEdges();
    const hr = toOverlay(header.getBoundingClientRect());
    const left = clamp(hr.left - BTN_SIZE - BTN_GAP,
                       V.left + EDGE_SAFE, V.right - EDGE_SAFE - BTN_SIZE);
    const top = clamp(hr.top + hr.height / 2 - BTN_SIZE / 2,
                      V.top + EDGE_SAFE, V.bottom - EDGE_SAFE - BTN_SIZE);

    const btn = el("button", "nb-te-open");
    btn.type = "button";
    btn.tabIndex = 0;
    btn.setAttribute("aria-label", "Edit table");
    btn.title = "Edit table";
    btn.innerHTML = SVG_EDIT_TABLE;
    btn.style.left = left + "px";
    btn.style.top = top + "px";
    btn.addEventListener("click", () => {
      if (NB.tableEditor) NB.tableEditor.open(activeTable);
    });
    overlay.appendChild(btn);
  }

  /* --- reveal / hide ------------------------------------------------ */

  function hide() {
    activeTable = null;
    if (overlay) overlay.textContent = "";
  }

  function reveal(table) {
    if (!enabled || !table) return;
    clearTimeout(graceTimer);
    graceTimer = null;
    if (table === activeTable && overlay.childElementCount) return;
    activeTable = table;
    render();
  }

  function scheduleHide() {
    clearTimeout(graceTimer);
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // Only hide when the pointer isn't resting on the overlay (i.e.
      // the user moved from the table onto its button).
      if (!overlay || !overlay.matches(":hover")) hide();
    }, GRACE_MS);
  }

  /* Delegated listeners -- tables come and go constantly in hybrid
   * mode, so per-table listeners would leak. */
  function onOver(e) {
    if (!enabled) return;
    // Hover-intent lock: entering/leaving the overlay control must not
    // drop the table it belongs to.
    const onControl = e.target.closest &&
      e.target.closest(CONTROL_SELECTOR);
    controlHover = !!onControl;
    if (controlHover) return;
    const t = e.target.closest && e.target.closest("#viewer-content table");
    if (t) reveal(t);
  }

  function onOut(e) {
    if (!enabled || !activeTable) return;
    const from = e.target.closest && e.target.closest("#viewer-content table");
    const to = e.relatedTarget && e.relatedTarget.closest &&
      e.relatedTarget.closest("#viewer-content table, .nb-table-overlay");
    if (from && from === activeTable && !to) scheduleHide();
  }

  function onFocusIn(e) {
    if (!enabled) return;
    const t = e.target.closest && e.target.closest("#viewer-content table");
    if (t) reveal(t);
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
    viewerContentEl.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    clearTimeout(graceTimer);
    graceTimer = null;
    hide();
    viewerContentEl.removeEventListener("mouseover", onOver);
    viewerContentEl.removeEventListener("mouseout", onOut);
    viewerContentEl.removeEventListener("focusin", onFocusIn);
    viewerContentEl.removeEventListener("focusout", onFocusOut);
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
    render,
    enable,
    disable,
  };
})();
