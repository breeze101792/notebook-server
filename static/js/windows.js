/* windows.js -- make every .settings-modal a free-floating window.
 *
 * The app's dialogs (Settings, Export, VIM :help, Login) all share the
 * .settings-overlay > .settings-modal markup. By default the CSS centers
 * the modal on the viewport. This module upgrades each one so the user
 * can drag it around by its header and resize it with a bottom-right
 * grip, then persist the geometry (per modal, in localStorage).
 *
 * It stays deliberately decoupled: it wires drag/resize onto whatever
 * `.settings-modal` elements exist at boot AND any added later (the
 * :help overlay is created on demand by vimnav.js), so nothing else in
 * the app needs to know about it.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // localStorage namespace. Stored per modal, keyed by a stable id
  // (the overlay's id, which every modal overlay has).
  const LS_KEY = "nb:windowGeometry";
  const MIN_W = 320;
  const MIN_H = 240;
  const EDGE_MARGIN = 12;

  // Maximized state is a transient CSS class (never persisted): it overrides
  // the inline geometry applyGeometry writes, and is reset when the overlay
  // closes.
  const MAX_CLASS = "settings-modal--max";
  // The two glyphs, swapped by CSS on [aria-pressed="true"].
  const MAX_GLYPHS =
    '<svg class="win-max-icon" viewBox="0 0 16 16" width="15" height="15" ' +
      'aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />' +
    '</svg>' +
    '<svg class="win-max-restore" viewBox="0 0 16 16" width="15" height="15" ' +
      'aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M2 6h4V2M14 6h-4V2M14 10h-4v4M2 10h4v4" />' +
    '</svg>';

  const viewportW = () => window.innerWidth;
  const viewportH = () => window.innerHeight;

  // Clamp a value to [min, max].
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  let geo = {};
  try { geo = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { geo = {}; }
  function saveGeo() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(geo)); } catch (e) { /* ignore */ }
  }

  // Given a modal, figure out a stable key. Prefer the overlay's id.
  function keyOf(modal) {
    const overlay = modal.closest(".settings-overlay");
    return (overlay && overlay.id) || "modal";
  }

  function applyGeometry(modal) {
    const key = keyOf(modal);
    const g = geo[key];
    if (!g) return;
    const vpW = viewportW();
    const vpH = viewportH();
    const left = clamp(g.left, EDGE_MARGIN, Math.max(EDGE_MARGIN, vpW - MIN_W - EDGE_MARGIN));
    const top  = clamp(g.top,  EDGE_MARGIN, Math.max(EDGE_MARGIN, vpH - MIN_H - EDGE_MARGIN));
    const w    = clamp(g.w, MIN_W, vpW - 2 * EDGE_MARGIN);
    const h    = clamp(g.h, MIN_H, vpH - 2 * EDGE_MARGIN);
    modal.style.left = left + "px";
    modal.style.top = top + "px";
    modal.style.width = w + "px";
    modal.style.height = h + "px";
    modal.style.transform = "none";
  }

  function ensureGrip(modal) {
    if (modal.querySelector(".resize-grip")) return;
    const grip = document.createElement("div");
    grip.className = "resize-grip";
    grip.title = "Drag to resize";
    modal.appendChild(grip);
    startResize(modal, grip);
  }

  // Toggle the transient maximized class + the button's accessible state.
  function setMaximized(modal, on) {
    modal.classList.toggle(MAX_CLASS, !!on);
    const btn = modal.querySelector(".win-max");
    if (!btn) return;
    const label = on ? "Restore" : "Maximize";
    btn.setAttribute("aria-pressed", String(!!on));
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  function toggleMaximized(modal) {
    setMaximized(modal, !modal.classList.contains(MAX_CLASS));
  }

  // Inject one maximize/restore control into every modal header.
  //
  // The header is a two-child flex row under space-between ([title] ...
  // [close]). A bare third sibling would land between the title and the
  // close button (that was the Settings/Export bug), so group the trailing
  // control(s) with the max button in one right-aligned
  // .settings-header-actions container. Every header then shares the same
  // [title, actions] shape, with no per-modal markup.
  function ensureMaxButton(modal) {
    if (modal.querySelector(".win-max")) return;
    const header = modal.querySelector(".settings-header");
    if (!header) return;
    const btn = document.createElement("button");
    btn.className = "icon-btn win-max";
    btn.type = "button";
    btn.title = "Maximize";
    btn.setAttribute("aria-label", "Maximize");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = MAX_GLYPHS;
    btn.addEventListener("click", () => toggleMaximized(modal));

    const buttons = header.querySelectorAll("button");
    if (!buttons.length) {
      header.appendChild(btn);   // e.g. the Login dialog, which has no close
      return;
    }
    const last = buttons[buttons.length - 1];
    let actions = last.parentNode;
    if (!actions.classList || !actions.classList.contains("settings-header-actions")) {
      actions = document.createElement("div");
      actions.className = "settings-header-actions";
      last.parentNode.insertBefore(actions, last);
      actions.appendChild(last);
    }
    actions.insertBefore(btn, last);
  }

  function startDrag(modal) {
    const header = modal.querySelector(".settings-header");
    if (!header || header.dataset.windowsDrag) return;
    header.dataset.windowsDrag = "1";

    header.addEventListener("pointerdown", (e) => {
      // A maximized modal ignores drag; persisting its full-viewport rect
      // would overwrite the saved geometry.
      if (modal.classList.contains(MAX_CLASS)) return;
      // Ignore drags started on the close button (it has its own click).
      if (e.target.closest("button")) return;
      if (e.button !== 0) return;
      const key = keyOf(modal);

      // Convert the CSS-centered position into explicit left/top the
      // first time we grab, so dragging maths is straight pixels.
      const r = modal.getBoundingClientRect();
      modal.style.left = r.left + "px";
      modal.style.top = r.top + "px";
      modal.style.width = r.width + "px";
      modal.style.height = r.height + "px";
      modal.style.transform = "none";

      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startLeft = r.left, startTop = r.top;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let left = startLeft + dx;
        let top = startTop + dy;
        left = clamp(left, EDGE_MARGIN, Math.max(EDGE_MARGIN, viewportW() - r.width - EDGE_MARGIN));
        top  = clamp(top,  EDGE_MARGIN, Math.max(EDGE_MARGIN, viewportH() - r.height - EDGE_MARGIN));
        modal.style.left = left + "px";
        modal.style.top = top + "px";
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.classList.remove("modal-dragging");
        const r = modal.getBoundingClientRect();
        geo[key] = { left: r.left, top: r.top, w: r.width, h: r.height };
        saveGeo();
      }
      document.body.classList.add("modal-dragging");
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    // Double-clicking the header toggles maximize, like a desktop window.
    // Buttons are exempt (the click would fire too).
    header.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      toggleMaximized(modal);
    });
  }

  function startResize(modal, grip) {
    const key = keyOf(modal);
    grip.addEventListener("pointerdown", (e) => {
      // Same guard as drag: a resize while maximized would persist the
      // full-viewport rect.
      if (modal.classList.contains(MAX_CLASS)) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const rect = modal.getBoundingClientRect();
      const startW = rect.width, startH = rect.height;

      function onMove(ev) {
        const w = Math.max(MIN_W, startW + (ev.clientX - startX));
        const h = Math.max(MIN_H, startH + (ev.clientY - startY));
        modal.style.width = w + "px";
        modal.style.height = h + "px";
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.classList.remove("modal-resizing");
        const nr = modal.getBoundingClientRect();
        geo[key] = { left: nr.left, top: nr.top, w: nr.width, h: nr.height };
        saveGeo();
      }
      document.body.classList.add("modal-resizing");
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function wire(modal) {
    // Only real modals: overlays are direct body children, so a note
    // element carrying the class is never upgraded.
    if (!modal || !modal.closest("body > .settings-overlay")) return;
    if (modal.dataset.windowsWired) return;
    modal.dataset.windowsWired = "1";
    ensureGrip(modal);
    ensureMaxButton(modal);
    startDrag(modal);
    applyGeometry(modal);
  }

  // Wire everything already in the DOM, then keep up with dynamically
  // added modals (the VIM :help overlay is created on demand).
  document.querySelectorAll(".settings-modal").forEach(wire);
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      // Any `hidden` toggle on an overlay drops its transient maximize
      // state. Reset on both directions, not just when hidden: records are
      // delivered at the microtask checkpoint, so a synchronous close+reopen
      // would otherwise read the stale live value and skip the reset.
      if (m.type === "attributes") {
        const overlay = m.target;
        if (overlay.classList && overlay.classList.contains("settings-overlay")) {
          const modal = overlay.querySelector(".settings-modal");
          if (modal) setMaximized(modal, false);
        }
        continue;
      }
      for (const node of m.addedNodes) {
        if (!node.querySelectorAll) continue;
        node.querySelectorAll && node.querySelectorAll(".settings-modal").forEach(wire);
        if (node.nodeType === 1 && node.classList.contains("settings-modal")) wire(node);
      }
    }
  });
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });

  // Re-apply geometry after a window resize so modals stay on screen.
  let rto;
  window.addEventListener("resize", () => {
    clearTimeout(rto);
    rto = setTimeout(() => {
      document.querySelectorAll(".settings-modal").forEach((modal) => {
        if (modal.closest("body > .settings-overlay")) applyGeometry(modal);
      });
    }, 150);
  });

  NB.windows = { wire };
})();
