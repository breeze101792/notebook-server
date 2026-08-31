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

    function getSvg() {
      return body.querySelector("svg");
    }

    function updateZoomDisplay() {
      const pct = document.getElementById(cfg.pctId);
      if (!pct) return;
      pct.textContent = zoomFit ? "Fit" : Math.round(zoomLevel * 100) + "%";
    }

    function applyZoom() {
      const svg = getSvg();
      if (!svg) return;
      if (zoomFit) {
        body.classList.add("svg-fit");
        svg.style.transform = "none";
      } else {
        body.classList.remove("svg-fit");
        svg.style.transform = "scale(" + zoomLevel + ")";
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
      body.classList.add("svg-fit");
      overlay.hidden = false;
      lightboxOpen = true;
      document.body.classList.add("mermaid-lightbox-active");
      updateZoomDisplay();
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
    // itself or the controls toolbar are ignored.
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
