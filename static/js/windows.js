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

  function startDrag(modal) {
    const header = modal.querySelector(".settings-header");
    if (!header || header.dataset.windowsDrag) return;
    header.dataset.windowsDrag = "1";

    header.addEventListener("pointerdown", (e) => {
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
  }

  function startResize(modal, grip) {
    const key = keyOf(modal);
    grip.addEventListener("pointerdown", (e) => {
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
    if (!modal || modal.dataset.windowsWired) return;
    modal.dataset.windowsWired = "1";
    ensureGrip(modal);
    startDrag(modal);
    applyGeometry(modal);
  }

  // Wire everything already in the DOM, then keep up with dynamically
  // added modals (the VIM :help overlay is created on demand).
  document.querySelectorAll(".settings-modal").forEach(wire);
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!node.querySelectorAll) continue;
        node.querySelectorAll && node.querySelectorAll(".settings-modal").forEach(wire);
        if (node.nodeType === 1 && node.classList.contains("settings-modal")) wire(node);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Re-apply geometry after a window resize so modals stay on screen.
  let rto;
  window.addEventListener("resize", () => {
    clearTimeout(rto);
    rto = setTimeout(() => {
      document.querySelectorAll(".settings-modal").forEach(applyGeometry);
    }, 150);
  });

  NB.windows = { wire };
})();
