/* lightbox.js -- shared full-screen SVG lightbox with zoom controls.
 *
 * Both mermaid.js and wavedrom.js render diagrams as inline SVGs in the
 * viewer. Each wants the same "click to inspect full-size, then zoom
 * in/out / fit / close" behaviour. Rather than duplicate ~150 lines of
 * overlay + zoom logic in each module, this module provides a single
 * factory that wires up one lightbox instance per diagram type.
 *
 * The overlay markup lives in index.html (one block per diagram type,
 * e.g. #mermaid-lightbox and #wavedrom-lightbox). Each block reuses the
 * generic .mermaid-lightbox-* / .mlb-* CSS classes; only the element
 * ids differ. A diagram module calls:
 *
 *   NB.lightbox.create({
 *     overlayId: "mermaid-lightbox",
 *     bodyId:    "mermaid-lightbox-body",
 *     closeId:   "mlb-close",
 *     zoomInId:  "mlb-zoom-in",
 *     zoomOutId: "mlb-zoom-out",
 *     fitId:     "mlb-fit",
 *     pctId:     "mlb-zoom-pct",
 *     containerSelector: ".mermaid-container",
 *   })
 *
 * and gets back { openLightbox, closeLightbox, zoomIn, zoomOut, fitToPage }.
 * The factory wires the overlay's buttons, backdrop click, mouse wheel,
 * and the global Escape / Ctrl++ / Ctrl+- keybindings, and installs a
 * delegated click handler on #viewer-content for `containerSelector`.
 *
 * Each instance keeps its own open/zoom state, so multiple diagram types
 * can each have a lightbox without interfering.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const ZOOM_STEP = 0.25;
  const ZOOM_MIN  = 0.25;
  const ZOOM_MAX  = 5;

  function create(cfg) {
    const overlay = document.getElementById(cfg.overlayId);
    const body    = document.getElementById(cfg.bodyId);
    if (!overlay || !body) {
      // Overlay markup missing (e.g. a stripped-down page). Return a
      // no-op façade so callers don't have to null-check every method.
      return { openLightbox() {}, closeLightbox() {}, zoomIn() {}, zoomOut() {}, fitToPage() {} };
    }

    let lightboxOpen = false;
    let zoomLevel = 1;          // 1 = 100%
    let zoomFit   = true;       // true when constrained to viewport
    let panX = 0;               // accumulated drag offset (in SVG px)
    let panY = 0;

    function getSvg() {
      return body.querySelector("svg");
    }

    function updateZoomDisplay() {
      const pct = document.getElementById(cfg.pctId);
      if (!pct) return;
      pct.textContent = zoomFit ? "Fit" : Math.round(zoomLevel * 100) + "%";
    }

    /* The zoom transform combines scale and pan. The pan is applied in
     * the SVG's local coordinate frame (before the scale). With CSS
     * transform translate(panX,panY) scale(s) and transform-origin
     * center, the translate is NOT amplified by the scale — the
     * element center moves by exactly (panX, panY) pixels on screen.
     * In fit mode (not zoomed) we normally drop the transform, but
     * during an active drag we allow the translate so the user can
     * reposition the image immediately on open. */
    function applyZoom() {
      const svg = getSvg();
      if (!svg) return;
      if (zoomFit && !dragging) {
        body.classList.add("svg-fit");
        svg.style.transform = "none";
        panX = 0;
        panY = 0;
      } else {
        body.classList.remove("svg-fit");
        svg.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoomLevel + ")";
      }
      updateZoomDisplay();
    }

    /* openLightbox(svg) clones the SVG into the overlay and shows it.
     * We clone the node so the original in the viewer remains untouched;
     * the clone carries all inline styles, classes, and the viewBox the
     * diagram library set during rendering. Starts in fit-to-page mode. */
    function openLightbox(svg) {
      body.innerHTML = "";
      const clone = svg.cloneNode(true);
      clone.removeAttribute("style");
      body.appendChild(clone);
      zoomLevel = 1;
      zoomFit   = true;
      panX = 0;
      panY = 0;
      body.classList.add("svg-fit");
      overlay.hidden = false;
      lightboxOpen = true;
      document.body.classList.add("mermaid-lightbox-active");
      applyZoom();
    }

    function closeLightbox() {
      if (!lightboxOpen) return;
      overlay.hidden = true;
      body.innerHTML = "";
      lightboxOpen = false;
      document.body.classList.remove("mermaid-lightbox-active");
    }

    function zoomIn() {
      if (!lightboxOpen) return;
      if (zoomFit) {
        // Leave fit mode and start at 100%.
        zoomFit   = false;
        zoomLevel = 1;
      } else {
        zoomLevel = Math.min(zoomLevel + ZOOM_STEP, ZOOM_MAX);
      }
      applyZoom();
    }

    function zoomOut() {
      if (!lightboxOpen) return;
      if (zoomFit) {
        // Leave fit mode and start at 100% (same as zoomIn) rather than
        // immediately stepping down from an arbitrary previous level.
        zoomFit   = false;
        zoomLevel = 1;
      } else {
        zoomLevel = Math.max(zoomLevel - ZOOM_STEP, ZOOM_MIN);
      }
      applyZoom();
    }

    function fitToPage() {
      if (!lightboxOpen) return;
      zoomFit   = true;
      zoomLevel = 1;
      applyZoom();
    }

    /* Wire the overlay's buttons, backdrop click, and mouse wheel. */
    const closeBtn = document.getElementById(cfg.closeId);
    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    const zoomInBtn  = document.getElementById(cfg.zoomInId);
    const zoomOutBtn = document.getElementById(cfg.zoomOutId);
    const fitBtn     = document.getElementById(cfg.fitId);
    if (zoomInBtn)  zoomInBtn.addEventListener("click", zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", zoomOut);
    if (fitBtn)     fitBtn.addEventListener("click", fitToPage);
    // Backdrop click: close when clicking the overlay background or any
    // blank area around the SVG (the body container). Clicks on the SVG
    // itself or the controls toolbar are ignored. A mouseup after a drag
    // starting on the SVG lands on a different element, so the browser
    // fires no click event on the backdrop -- a pan can never close the
    // lightbox on its own.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target === body) closeLightbox();
    });
    // Mouse wheel: zoom in/out over the overlay.
    overlay.addEventListener("wheel", (e) => {
      if (!lightboxOpen) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else              zoomOut();
    }, { passive: false });

    /* --- drag to pan (left or right mouse drag) -------------------- */
    /* When zoomed in past fit, drag the picture around the overlay.
     * Works with any primary mouse button (left or right); right-drag
     * is often how people grab diagrams, so we suppress the context
     * menu while dragging. A drag on the SVG pans; a plain click on the
     * backdrop still closes the overlay. */
    let dragging = null;   // { startX, startY, origPanX, origPanY, moved }
    const svgEl = () => getSvg();

    function setDraggingClass(on) {
      const s = svgEl();
      if (s) s.classList.toggle("dragging", on);
    }

    function onDragStart(e) {
      if (!lightboxOpen) return;
      // Left (0) or right (2) mouse button only; ignore middle (1).
      if (e.button !== 0 && e.button !== 2) return;
      // Ignore drags that begin on the controls toolbar.
      if (e.target.closest && e.target.closest(".mermaid-lightbox-controls")) return;
      e.preventDefault();
      dragging = { startX: e.clientX, startY: e.clientY, origPanX: panX, origPanY: panY, moved: false };
      setDraggingClass(true);
      // Apply the transform immediately so the SVG breaks out of the
      // fit constraint on the same frame the drag begins (no visual
      // jump on the first mousemove).
      applyZoom();
    }

    function onDragMove(e) {
      if (!dragging) return;
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
      // Track the cursor 1:1. With CSS transform
      // translate(panX,panY) scale(s) and transform-origin:center,
      // the translate is NOT amplified by the scale — the element
      // center moves by exactly (panX, panY) regardless of zoom.
      panX = dragging.origPanX + dx;
      panY = dragging.origPanY + dy;
      applyZoom();
    }

    function onDragEnd() {
      if (!dragging) return;
      dragging = null;
      setDraggingClass(false);
    }

    // Right button is used to drag the picture around (common for
    // grabbing diagrams). Suppress the browser's context menu whenever
    // the lightbox is open and zoomed, so a right-drag isn't interrupted
    // by the menu appearing. (The viewer's right-click context menu is
    // separate and only applies to the file tree, not the lightbox.)
    overlay.addEventListener("mousedown", onDragStart);
    overlay.addEventListener("contextmenu", (e) => {
      // Suppress the context menu during a drag (right-drag to pan)
      // or when zoomed (pan enabled). In fit mode without a drag,
      // allow the menu (matches normal page behaviour).
      if (dragging || !zoomFit) e.preventDefault();
    });
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);

    /* Keyboard: Escape closes the lightbox. Ctrl++ / Ctrl+- for zoom. */
    document.addEventListener("keydown", (e) => {
      if (!lightboxOpen) return;
      if (e.key === "Escape") {
        closeLightbox();
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          zoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          zoomOut();
        }
      }
    });

    /* Delegated click handler on #viewer-content: clicking any rendered
     * diagram container (e.g. .mermaid-container) opens the lightbox. We
     * skip clicks on <a> elements inside the SVG (be defensive). */
    const viewerContent = document.getElementById("viewer-content");
    if (viewerContent) {
      viewerContent.addEventListener("click", (e) => {
        // In hybrid (WYSIWYG) mode a click on a block means "edit it"
        // (hybrid.js swaps it to an editable source fence); the
        // lightbox only opens in preview mode.
        if (window.NB && NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) return;
        const container = e.target.closest(cfg.containerSelector);
        if (!container) return;
        if (e.target.closest("a")) return;
        const svg = container.querySelector("svg");
        if (!svg) return;
        e.stopPropagation();
        openLightbox(svg);
      });
    }

    return { openLightbox, closeLightbox, zoomIn, zoomOut, fitToPage };
  }

  NB.lightbox = { create };
})();
