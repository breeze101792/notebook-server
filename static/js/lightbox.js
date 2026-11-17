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
 * and the global Escape / Ctrl++ / Ctrl+- keybindings.
 *
 * The only entry point is a Preview button in the card's own action row.
 * copy-image.js appends it through NB.lightbox.previewButtonFor(container),
 * so a click anywhere else on the card selects text and never opens the
 * overlay.
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

  // The Preview action appended to every diagram card. It carries the shared
  // .code-copy-btn base class so it inherits the row's chrome, hover reveal,
  // phone size, and the hybrid.js chrome strip on save. .nb-preview-btn is
  // the placement modifier and the hook tests and callers select.
  const BASE_BUTTON_CLASS = "code-copy-btn";
  const PREVIEW_BUTTON_CLASS = "nb-preview-btn";
  const PREVIEW_BUTTON_LABEL = "Preview";
  const PREVIEW_BUTTON_TITLE = "Open preview";
  const PREVIEW_BUTTON_ARIA = "Open preview full screen";

  // One entry per created lightbox, keyed by the card selector it serves.
  // previewButtonFor() resolves a card to the matching instance; a second
  // create() on the same selector would replace the first, so keep them
  // distinct.
  const instances = new Map();

  /* svgOf(container) -> SVGElement | null.
   * Prefer the diagram inside the sizing wrapper: the copy buttons also
   * carry an icon <svg>, and they can follow the diagram in the card. */
  function svgOf(container) {
    return container.querySelector(".nb-figure-viewport > svg") ||
      container.querySelector("svg");
  }

  function buildPreviewButton(instance, container) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BASE_BUTTON_CLASS + " " + PREVIEW_BUTTON_CLASS;
    btn.textContent = PREVIEW_BUTTON_LABEL;
    btn.title = PREVIEW_BUTTON_TITLE;
    // The visible label must stay inside the accessible name (WCAG 2.5.3);
    // the diagram type makes four buttons distinguishable to a screen reader.
    btn.setAttribute("aria-label", instance.label
      ? PREVIEW_BUTTON_LABEL + " " + instance.label
      : PREVIEW_BUTTON_ARIA);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Hybrid mode has no preview entry point in the note: a click on the
      // block means "edit it". The AI chat log keeps its button, so guard
      // the click as well.
      if (window.NB && NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) return;
      const svg = svgOf(container);
      if (svg) instance.openLightbox(svg);
    });
    return btn;
  }

  /* previewButtonFor(container) -> HTMLButtonElement | null.
   * Returns a freshly built Preview button for a card this module serves,
   * or null when the card has no lightbox or already carries the button.
   * Idempotent, so the copy-image scan may call it on every pass. */
  function previewButtonFor(container) {
    if (!container || typeof container.matches !== "function") return null;
    let instance = null;
    for (const it of instances.values()) {
      if (container.matches(it.selector)) { instance = it; break; }
    }
    if (!instance) return null;
    if (container.querySelector("." + PREVIEW_BUTTON_CLASS)) return null;
    return buildPreviewButton(instance, container);
  }

  function create(cfg) {
    let overlay = document.getElementById(cfg.overlayId);
    let body    = document.getElementById(cfg.bodyId);
    if ((!overlay || !body) && document.getElementById("lightbox-template")) {
      const frag = document.getElementById("lightbox-template").content.cloneNode(true);
      overlay = frag.querySelector(".mermaid-lightbox-overlay");
      body = overlay.querySelector(".mermaid-lightbox-body");
      overlay.id = cfg.overlayId;
      body.id = cfg.bodyId;
      overlay.querySelector('[data-lb="zoom-out"]').id = cfg.zoomOutId;
      overlay.querySelector('[data-lb="zoom-in"]').id = cfg.zoomInId;
      overlay.querySelector('[data-lb="fit"]').id = cfg.fitId;
      overlay.querySelector('[data-lb="close"]').id = cfg.closeId;
      overlay.querySelector(".mlb-zoom-pct").id = cfg.pctId;
      document.body.appendChild(frag);
    }
    // Owned by this lightbox, so capture it now: a lazy lookup could hit a
    // note element that happens to reuse the id.
    const pctEl   = document.getElementById(cfg.pctId);
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
      if (!pctEl) return;
      pctEl.textContent = zoomFit ? "Fit" : Math.round(zoomLevel * 100) + "%";
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
        svg.style.width = "";
        svg.style.height = "";
        panX = 0;
        panY = 0;
      } else {
        // Lock the SVG at its current fitted dimensions so it doesn't
        // jump to its intrinsic size (mermaid sets large fixed pixel
        // width/height attrs). The .svg-fit CSS constraints stay active
        // to prevent overflow; inline style overrides width:auto while
        // max-width/max-height remain as a safety net. scale() then
        // handles the visual sizing from this stable baseline.
        if (!svg.style.width) {
          svg.style.width  = svg.offsetWidth  + "px";
          svg.style.height = svg.offsetHeight + "px";
        }
        svg.style.transform = "translate(" + panX + "px, " + panY + "px) scale(" + zoomLevel + ")";
      }
      updateZoomDisplay();
    }

    /* openLightbox(svg) clones the SVG into the overlay and shows it.
     * We clone the node so the original in the viewer remains untouched;
     * the clone carries all inline styles, classes, and the viewBox the
     * diagram library set during rendering. Starts in fit-to-page mode. */
    let lastTrigger = null;

    function openLightbox(svg) {
      lastTrigger = document.activeElement;
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", cfg.label || "Diagram");
      const pct = document.getElementById(cfg.pctId);
      if (pct) pct.setAttribute("aria-live", "polite");
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
      const close = document.getElementById(cfg.closeId);
      if (close) close.focus({ preventScroll: true });
    }

    function closeLightbox() {
      if (!lightboxOpen) return;
      overlay.hidden = true;
      body.innerHTML = "";
      lightboxOpen = false;
      document.body.classList.remove("mermaid-lightbox-active");
      if (lastTrigger && lastTrigger.isConnected) {
        lastTrigger.focus({ preventScroll: true });
      }
      lastTrigger = null;
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
      // Skip drags on the backdrop (overlay background or body).
      // The click handler will close the lightbox instead.
      if (e.target === overlay || e.target === body) return;
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

    /* Register this instance: copy-image.js asks previewButtonFor() for the
     * button on every scan and binds it to openLightbox(). */
    instances.set(cfg.containerSelector, {
      selector: cfg.containerSelector,
      label: cfg.label || "",
      openLightbox,
    });

    return { openLightbox, closeLightbox, zoomIn, zoomOut, fitToPage };
  }

  NB.lightbox = { create, previewButtonFor };
})();
