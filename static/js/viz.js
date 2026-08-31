/* viz.js -- render Markdown code blocks tagged as graphviz (```dot or
 * ```graphviz) into SVG diagrams.
 *
 * Graphviz is compiled to WASM and shipped as two vendored bundles
 * (static/vendor/viz.js + static/vendor/viz.full.js, MIT / EPL-1.0):
 *
 *   - viz.js        -- the Viz class (the public API)
 *   - viz.full.js   -- the compiled Graphviz WASM module + render fn
 *
 * Loaded in that order via <script> tags in index.html; full.render.js
 * auto-attaches its `render`/`Module` onto window.Viz, so we can just do:
 *
 *   const viz = new window.Viz();
 *   viz.renderString(src, { format: "svg" })  -> Promise<string>
 *
 * The returned string is a full SVG document. We extract the <svg>
 * element, make it responsive, and drop it into a .viz-container. Because
 * the output is an SVG, it uses the shared lightbox (static/js/lightbox.js)
 * for click-to-inspect + zoom, exactly like mermaid and wavedrom.
 *
 * Why a module at all: it keeps the Graphviz-specific parsing (which
 * blocks are dot, decoding entities, extracting + sizing the SVG, the
 * async renderString dance) out of viewer.js, mirroring mermaid.js /
 * wavedrom.js.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  let ready = false;
  let vizInstance = null;

  function whenReady() {
    if (ready) return Promise.resolve(true);
    if (window.Viz && typeof window.Viz === "function") {
      ready = true;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (window.Viz && typeof window.Viz === "function") {
          ready = true;
          resolve(true);
        } else if (Date.now() - start > 2500) {
          resolve(false);
        } else {
          setTimeout(tick, 20);
        }
      };
      tick();
    });
  }

  function getViz() {
    if (!vizInstance) vizInstance = new window.Viz();
    return vizInstance;
  }

  function decodeHtml(str) {
    const el = document.createElement("div");
    el.innerHTML = str;
    return el.textContent || "";
  }

  /* renderOne(pre) -- render a single <pre><code class="language-dot">
   * (or language-graphviz) into a .viz-container holding the SVG. */
  async function renderOne(pre) {
    const code = pre.querySelector("code");
    if (!code) return;
    const source = decodeHtml(code.textContent);
    if (!(await whenReady())) return; // viz unavailable -> leave source
    const container = document.createElement("div");
    container.className = "viz-container";
    container.dataset.viz = "ok";
    container.dataset.vizSource = source;
    try {
      const svgText = await getViz().renderString(source, { format: "svg" });
      // renderString returns a full SVG document; extract the <svg>.
      const tmp = document.createElement("div");
      tmp.innerHTML = svgText;
      const svg = tmp.querySelector("svg");
      if (!svg) throw new Error("No SVG rendered");
      // Make the SVG responsive: Graphviz emits fixed width/height +
      // a viewBox. Pin the aspect ratio from the viewBox (as mermaid.js
      // does) so max-width + max-height both scale the element uniformly.
      const vb = svg.getAttribute("viewBox");
      let vbW = 0, vbH = 0;
      if (vb) {
        const parts = vb.split(/\s+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          vbW = parts[2];
          vbH = parts[3];
        }
      }
      if (!vbW || !vbH) {
        vbW = parseFloat(svg.getAttribute("width")) || 0;
        vbH = parseFloat(svg.getAttribute("height")) || 0;
        if (vbW > 0 && vbH > 0) svg.setAttribute("viewBox", "0 0 " + vbW + " " + vbH);
      }
      svg.removeAttribute("height");
      svg.removeAttribute("width");
      if (vbW > 0 && vbH > 0) svg.style.aspectRatio = vbW + " / " + vbH;
      container.appendChild(svg);
      pre.replaceWith(container);
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : "Render failed";
      const firstLine = msg.split(/\r?\n/)[0].slice(0, 200);
      if (NB.app && NB.app.notify) {
        NB.app.notify("Graphviz error: " + firstLine, 4000, "warn");
      }
      const wrap = document.createElement("div");
      wrap.className = "viz-error";
      const head = document.createElement("div");
      head.className = "viz-error-head";
      head.textContent = "Graphviz error: " + firstLine;
      const src = document.createElement("pre");
      src.className = "viz-source";
      src.textContent = source;
      wrap.appendChild(head);
      wrap.appendChild(src);
      pre.replaceWith(wrap);
    }
  }

  /* renderAll(container) -- find every <pre><code class="language-dot">
   * or language-graphviz inside `container` and render it sequentially.
   * Idempotent: a <pre> already replaced with a .viz-container (or
   * .viz-error) no longer holds a code.language-dot, so the query won't
   * pick it up again. Runs in view mode AND live preview. */
  async function renderAll(container) {
    if (!container) return;
    if (!(await whenReady())) return;
    const blocks = container.querySelectorAll(
      "pre > code.language-dot, pre > code.language-graphviz");
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      await renderOne(pre);
    }
  }

  /* --- lightbox: click a rendered graph to see it full-size ---------- */
  /* The full-screen overlay + zoom controls live in the shared lightbox
   * module (static/js/lightbox.js). We hand it our element ids and the
   * container selector; it wires the buttons, backdrop click, wheel, and
   * Escape / Ctrl++ / Ctrl+- keybindings, and returns the public methods
   * we re-expose. The overlay reuses the generic .mermaid-lightbox-* /
   * .mlb-* CSS classes but has its own element ids, so it is fully
   * independent of the mermaid / wavedrom lightboxes. */
  const lightbox = NB.lightbox.create({
    overlayId: "viz-lightbox",
    bodyId:    "viz-lightbox-body",
    closeId:   "vizlb-close",
    zoomInId:  "vizlb-zoom-in",
    zoomOutId: "vizlb-zoom-out",
    fitId:     "vizlb-fit",
    pctId:     "vizlb-zoom-pct",
    containerSelector: ".viz-container",
  });

  NB.viz = { renderAll, whenReady,
    openLightbox: lightbox.openLightbox,
    closeLightbox: lightbox.closeLightbox,
    zoomIn: lightbox.zoomIn,
    zoomOut: lightbox.zoomOut,
    fitToPage: lightbox.fitToPage };
})();
