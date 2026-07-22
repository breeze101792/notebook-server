/* mermaid.js -- render Markdown code blocks tagged as mermaid diagrams.
 *
 * Mermaid ships as a 3.5MB UMD bundle (see static/vendor/mermaid.min.js)
 * that exposes window.mermaid. We treat it as a black box: the only
 * functions we call are:
 *
 *   mermaid.initialize({ startOnLoad: false, theme: "default"|"dark", ... })
 *     Configure mermaid's runtime. We disable startOnLoad because we
 *     drive rendering explicitly (the script picks up <pre class="mermaid">
 *     elements on DOMContentLoaded, which we don't want -- our code
 *     blocks are <pre><code class="language-mermaid"> and we render
 *     them on our own schedule, after marked + highlight.js have
 *     already processed the document).
 *
 *   mermaid.render(id, source) -> Promise<{ svg }>
 *     Compile + render a single diagram. We give each block a stable
 *     id so re-renders are idempotent (mermaid requires unique ids).
 *
 * Why a module at all: the library is heavy, and we want to keep the
 * viewer.js code focused on the Markdown pipeline. Centralising the
 * mermaid-specific logic here means the integration can be reasoned
 * about in one place: theme sync, the (id, source) -> svg dance, the
 * error fallback, and the "is window.mermaid ready yet?" wait.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Mermaid is configured per-theme: the "default" theme works in
  // light mode; "dark" works in dark mode. The user can pin a
  // specific theme later if we ever expose that in Settings; for
  // now we follow body[data-theme] like the rest of the app.
  let initializedFor = null;        // last theme we initialized for
  let initPromise = null;            // pending init (mermaid.initialize is async-ish in v10+)
  // Counter used to mint unique diagram ids. Mermaid requires
  // globally unique ids per render call, so we bump this for each
  // block. The id is also used to find the rendered SVG container
  // if a re-render is needed.
  let idCounter = 0;

  function nextId() { return "mermaid-svg-" + (++idCounter); }

  // Wait for the vendored UMD bundle to attach window.mermaid. The
  // <script> tag is `defer`, so the global is available shortly
  // after DOMContentLoaded; this helper covers the gap so the
  // caller's `await renderAll(container)` is robust to load order.
  function whenReady() {
    if (window.mermaid && typeof window.mermaid.render === "function") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (window.mermaid && typeof window.mermaid.render === "function") {
          resolve();
        } else if (Date.now() - start > 5000) {
          // 5s timeout: if the bundle failed to load, surface the
          // error rather than hang forever. The viewer will fall
          // through to the source-fallback path on its own.
          resolve();
        } else {
          setTimeout(tick, 20);
        }
      };
      tick();
    });
  }

  function currentTheme() {
    // body[data-theme] is the resolved theme ("light" / "dark"),
    // set by app.js. "auto" is already resolved by then, so we
    // never see "auto" here.
    return (document.body && document.body.dataset.theme === "dark")
      ? "dark"
      : "default";
  }

  async function ensureInitialized() {
    const theme = currentTheme();
    if (initializedFor === theme) return;
    if (!window.mermaid) {
      await whenReady();
    }
    if (!window.mermaid) {
      throw new Error("mermaid bundle not available");
    }
    // Mermaid v10+ exposes initialize + render. The config object
    // here is intentionally minimal: startOnLoad:false is critical
    // (otherwise the lib walks the DOM on load and tries to render
    // things we don't want), securityLevel:"strict" is the safest
    // default (clicks/links disabled), and theme is light/dark.
    initializedFor = theme;
    initPromise = Promise.resolve(window.mermaid.initialize({
      startOnLoad: false,
      theme: theme,
      securityLevel: "strict",
      // fontFamily matches our app's monospace stack so the text
      // inside diagram nodes reads as part of the notebook.
      fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
    }));
    await initPromise;
  }

  /* renderOne(pre) -- render a single <pre><code class="language-mermaid">.
   *
   * On success: replace the <pre> with a <div class="mermaid-container">
   * that holds the rendered SVG. The SVG is inserted via innerHTML
   * (mermaid returns it as a string of trusted markup that the lib
   * itself generated; we don't pass user content to innerHTML).
   *
   * On error: replace the <pre> with a small "Mermaid error" header +
   * a <pre> holding the raw source so the user can fix the syntax
   * (matches the GitHub-style fallback). The error message comes
   * from mermaid; we surface the first line to keep the layout
   * tidy.
   */
  async function renderOne(pre) {
    const code = pre.querySelector("code");
    if (!code) return;
    const source = code.textContent;
    const id = nextId();
    try {
      await ensureInitialized();
      const result = await window.mermaid.render(id, source);
      const container = document.createElement("div");
      container.className = "mermaid-container";
      container.dataset.mermaid = "ok";
      // result.svg is the rendered diagram. innerHTML is safe here:
      // the lib generated the string from parsing `source`, which
      // IS user content, but the lib has already sanitised it
      // through its own parser (the securityLevel:"strict" config
      // above disables click-jacking too).
      container.innerHTML = result.svg;
      // Make the SVG responsive: mermaid emits fixed pixel width /
      // height attributes that don't scale with the pane. We strip
      // the height and let the CSS aspect-ratio + max-width do the
      // work, then re-derive the height from the SVG's viewBox so
      // the aspect ratio stays correct.
      const svg = container.querySelector("svg");
      if (svg) {
        svg.removeAttribute("height");
        svg.style.maxWidth = "100%";
        svg.style.height = "auto";
        // mermaid emits width/height attributes. Use the viewBox if
        // present, else fall back to the original width/height. The
        // CSS then scales the SVG to the container width and the
        // browser preserves the aspect ratio.
        const vb = svg.getAttribute("viewBox");
        if (!vb) {
          const w = parseFloat(svg.getAttribute("width")) || 0;
          const h = parseFloat(svg.getAttribute("height")) || 0;
          if (w > 0 && h > 0) {
            svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
          }
        }
      }
      pre.replaceWith(container);
    } catch (err) {
      // Parse / render failure. Replace the original <pre> with a
      // small error block + the source so the user can see what
      // was wrong and copy the source back into the editor.
      const wrap = document.createElement("div");
      wrap.className = "mermaid-error";
      const head = document.createElement("div");
      head.className = "mermaid-error-head";
      const msg = (err && err.message) ? String(err.message) : "Render failed";
      // mermaid's error messages are usually multi-line. Collapse
      // them to a single line for the header so the layout is
      // compact; the full message is still on the err object in
      // devtools.
      const firstLine = msg.split(/\r?\n/)[0].slice(0, 200);
      head.textContent = "Mermaid error: " + firstLine;
      const src = document.createElement("pre");
      src.className = "mermaid-source";
      src.textContent = source;
      wrap.appendChild(head);
      wrap.appendChild(src);
      pre.replaceWith(wrap);
    }
  }

  /* renderAll(container) -- find every <pre><code class="language-mermaid">
   * inside `container` and render it. Each block is rendered
   * sequentially; we deliberately don't Promise.all them because
   * mermaid's render() can be heavy on a large document and we
   * don't want to fight the event loop.
   *
   * Idempotency: a <pre> that's already been replaced with a
   * .mermaid-container or .mermaid-error no longer has a
   * <code class="language-mermaid"> inside it, so the query
   * below won't pick it up again. We don't need to track which
   * blocks we've already processed.
   */
  async function renderAll(container) {
    if (!container) return;
    await whenReady();
    if (!window.mermaid) {
      // Bundle never loaded (offline, blocked, etc.). Don't try to
      // replace anything -- the <pre> stays as-is and the user
      // sees the source in a plain code block, which is the same
      // fallback the GitHub viewer uses when mermaid isn't
      // available.
      return;
    }
    const blocks = container.querySelectorAll("pre > code.language-mermaid");
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre) continue;
      // Skip if the parent isn't actually a <pre> (defensive; query
      // already filters on `pre > code`).
      if (pre.tagName !== "PRE") continue;
      await renderOne(pre);
    }
  }

  /* reinit(theme?)
   * Force mermaid to re-initialize with a new theme. Called by
   * the viewer's theme-switch path so existing diagrams pick up
   * the new theme on the next render. (Mermaid bakes the theme
   * into the SVG, so theme changes don't auto-apply to already-
   * rendered diagrams; the user gets the new theme on the next
   * file open / live preview refresh.)
   */
  function reinit(theme) {
    initializedFor = null;
    if (theme) {
      if (document.body) document.body.dataset.theme = theme;
    }
  }

  /* --- lightbox: click a rendered diagram to see it full-size -------- */
  /* openLightbox(svg) clones the SVG into the lightbox overlay and
   * shows it. We clone the node so the original in the viewer remains
   * untouched; the clone carries all inline styles, classes, and the
   * viewBox that mermaid set during rendering. The SVG starts in
   * "fit-to-page" mode (constrained to the viewport). */
  let lightboxOpen = false;
  let zoomLevel = 1;          // 1 = 100%
  let zoomFit   = true;       // true when constrained to viewport

  function openLightbox(svg) {
    const overlay = document.getElementById("mermaid-lightbox");
    const body    = document.getElementById("mermaid-lightbox-body");
    if (!overlay || !body) return;
    body.innerHTML = "";
    const clone = svg.cloneNode(true);
    clone.removeAttribute("style");
    body.appendChild(clone);
    // Start in fit-to-page mode.
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
    const overlay = document.getElementById("mermaid-lightbox");
    if (overlay) overlay.hidden = true;
    lightboxOpen = false;
    document.body.classList.remove("mermaid-lightbox-active");
  }

  /* --- zoom controls ------------------------------------------------- */
  const ZOOM_STEP = 0.25;
  const ZOOM_MIN  = 0.25;
  const ZOOM_MAX  = 5;

  function getSvg() {
    const body = document.getElementById("mermaid-lightbox-body");
    return body ? body.querySelector("svg") : null;
  }

  function applyZoom() {
    const body = document.getElementById("mermaid-lightbox-body");
    const svg  = getSvg();
    if (!body || !svg) return;
    if (zoomFit) {
      body.classList.add("svg-fit");
      svg.style.transform = "none";
    } else {
      body.classList.remove("svg-fit");
      svg.style.transform = "scale(" + zoomLevel + ")";
    }
    updateZoomDisplay();
  }

  function updateZoomDisplay() {
    const pct = document.getElementById("mlb-zoom-pct");
    if (!pct) return;
    pct.textContent = zoomFit ? "Fit" : Math.round(zoomLevel * 100) + "%";
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
      zoomFit   = false;
      zoomLevel = 1;
    }
    zoomLevel = Math.max(zoomLevel - ZOOM_STEP, ZOOM_MIN);
    applyZoom();
  }

  function fitToPage() {
    if (!lightboxOpen) return;
    zoomFit   = true;
    zoomLevel = 1;
    applyZoom();
  }

  /* Wire up the lightbox's close/zoom/backdrop/Escape. Called once at
   * module init. */
  function wireLightbox() {
    const overlay = document.getElementById("mermaid-lightbox");
    if (!overlay) return;
    // Close button.
    const closeBtn = document.getElementById("mlb-close");
    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    // Zoom buttons.
    const zoomInBtn  = document.getElementById("mlb-zoom-in");
    const zoomOutBtn = document.getElementById("mlb-zoom-out");
    const fitBtn     = document.getElementById("mlb-fit");
    if (zoomInBtn)  zoomInBtn.addEventListener("click", zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", zoomOut);
    if (fitBtn)     fitBtn.addEventListener("click", fitToPage);
    // Backdrop click: close when clicking the overlay background or any
    // blank area around the SVG (the body container). Clicks on the SVG
    // itself or the controls toolbar are ignored.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target === document.getElementById("mermaid-lightbox-body")) closeLightbox();
    });
    // Mouse wheel: zoom in/out over the overlay.
    overlay.addEventListener("wheel", (e) => {
      if (!lightboxOpen) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else              zoomOut();
    }, { passive: false });
  }

  /* Set up delegated click handler on #viewer-content so that clicking
   * any rendered .mermaid-container opens the lightbox. We skip clicks
   * on <a> elements inside the SVG (mermaid disables links with
   * securityLevel:"strict" but be defensive). */
  function setupClickHandler() {
    const viewerContent = document.getElementById("viewer-content");
    if (!viewerContent) return;
    viewerContent.addEventListener("click", (e) => {
      const container = e.target.closest(".mermaid-container");
      if (!container) return;
      if (e.target.closest("a")) return;
      const svg = container.querySelector("svg");
      if (!svg) return;
      e.stopPropagation();
      openLightbox(svg);
    });
  }

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

  wireLightbox();
  setupClickHandler();

  NB.mermaid = { renderAll, reinit, whenReady,
    openLightbox, closeLightbox, zoomIn, zoomOut, fitToPage };
})();
