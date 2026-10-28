/* wavedrom.js -- render Markdown code blocks tagged as wavedrom timing
 * waveform diagrams.
 *
 * Wavedrom ships as a ~98KB UMD bundle (see static/vendor/wavedrom.unpkg.min.js,
 * MIT licensed) that exposes window.wavedrom when loaded in a browser. We
 * treat it as a black box; the only functions we call are:
 *
 *   wavedrom.renderWaveForm(index, source, output)
 *     Render a single waveform. `index` is a per-call ordinal;
 *     `source` is the parsed JSON object (the block's data);
 *     `output` is a string id PREFIX, and WaveDrom creates/repaints an
 *     element with id `output + index`. Unlike mermaid, WaveDrom's SVG
 *     carries its own embedded <style>, so waveform colors come from the
 *     block (or the default skin) and do not flip with the app theme.
 *
 * The bundle also needs `window.WaveSkin` set to the default skin -- the
 * UMD does not assign it for us, so we default it on module load.
 *
 * Why a module at all: the library is heavier than a hand-rolled
 * renderer and we want to keep viewer.js focused on the Markdown
 * pipeline. Centralising the WaveDrom-specific logic here means the
 * integration -- the (index, source) -> svg dance into a container we
 * own, the error fallback, and the "is window.wavedrom ready yet?"
 * wait -- lives in one place, mirroring mermaid.js.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // UMD bundle fetched on demand by whenReady (see there). If it never
  // loads, the render pass simply no-ops and the blocks stay as readable
  // source code.
  const VENDOR_SRC = "/static/vendor/wavedrom.unpkg.min.js";

  let ready = false;
  let loadPromise = null;
  // Every call gets a unique index (WaveDrom wants distinct suffix ids so
  // concurrent blocks never collide).
  let idCounter = 0;

  function ensureSkin() {
    // WaveDrom's renderWaveForm reads window.WaveSkin for defaults. The
    // bundle doesn't seed it, so do it here (idempotent at module load).
    if (!window.WaveSkin && window.wavedrom) {
      window.WaveSkin = window.wavedrom.waveSkin;
    }
  }

  function whenReady() {
    if (ready) return Promise.resolve(true);
    if (window.wavedrom && typeof window.wavedrom.renderWaveForm === "function") {
      ready = true;
      ensureSkin();
      return Promise.resolve(true);
    }
    // Pull the bundle on demand; the timeout runs independently of the
    // fetch so a failed/unreachable load resolves false (leaving the
    // source block in place) instead of hanging.
    if (!loadPromise) {
      loadPromise = new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          ready = ok;
          if (!ok) loadPromise = null;   // allow a later retry
          resolve(ok);
        };
        const isReady = () =>
          !!(window.wavedrom && typeof window.wavedrom.renderWaveForm === "function");
        const start = Date.now();
        Promise.resolve(NB.lazyload.script(VENDOR_SRC)).catch(() => {});
        const tick = () => {
          if (isReady()) { ensureSkin(); finish(true); }
          else if (Date.now() - start > 2500) finish(false);
          else setTimeout(tick, 20);
        };
        tick();
      });
    }
    return loadPromise;
  }

  /* renderSvgElement(source) -- render one WaveDrom source through the
   * vendored library and return the responsive <svg>. This is the shared
   * renderer seam: the note path and the design window's preview/Apply
   * validation both go through it (docs/architecture/
   * dot-wavedrom-designer.md §D6). WaveDrom paints errors instead of
   * throwing, so a host without an <svg> rejects with the painted text. */
  async function renderSvgElement(source) {
    if (!(await whenReady())) throw new Error("WaveDrom renderer unavailable");
    const index = ++idCounter;
    const output = "Wavedrom_NB__";
    // WaveDrom looks the target element up by id, so the host must be in
    // the document while renderWaveForm runs.
    const host = document.createElement("div");
    host.id = output + index;
    host.style.display = "none"; // hidden until replaced, so it never flashes
    document.body.appendChild(host);
    try {
      try {
        // WaveDrom's canonical notation allows unquoted (JS-style) keys,
        // e.g. {signal:[{name:"clk",wave:"p.....|..."}]}. Strict
        // JSON.parse rejects that, so parse leniently, mirroring the
        // official WaveDrom editor, which does eval("(" + source + ")").
        // First try strict JSON; only fall back to the lenient path when
        // that fails. The source is the note owner's own notebook content
        // (the viewer already renders it unsanitised), so this eval is
        // no escalation of trust.
        const data = parseSource(source);
        window.wavedrom.renderWaveForm(index, data, output, false);
      } catch (err) {
        // Malformed source (or a render error). WaveDrom paints a
        // human-readable error into the host; prefer that over a raw
        // throw if it exists.
        if (!host.innerHTML) throw err;
      }
      const svg = host.querySelector("svg");
      if (!svg) {
        const painted = (host.textContent || "").trim().split(/\r?\n/)[0];
        throw new Error(painted || "No SVG rendered");
      }
      host.removeChild(svg);
      // Shared viewBox/aspect-ratio normalisation (blocks.js). The note
      // path additionally records the natural size/factor in prepareSvg;
      // the designer preview calls this seam directly.
      if (NB.blocks && NB.blocks.normalizeSvg) NB.blocks.normalizeSvg(svg);
      // Sanitise: WaveDrom's SVG is generated from user JSON by a lib
      // we control, the same class of trust as mermaid's output, so we
      // accept it as-is. Strip the id suffix so a block is uniquely
      // addressable and re-renders are idempotent.
      svg.removeAttribute("id");
      return svg;
    } finally {
      host.remove();
    }
  }

  /* renderOne(pre) -- render a single <pre><code class="language-wavedrom">.
   *
   * The block's text comes straight from textContent, already
   * entity-decoded by the DOM. The old decodeHtml helper re-parsed it as
   * HTML and ate `<...>` in the source; don't reintroduce it.
   *
   * The parsed object is built by parseSource() (strict JSON first,
   * lenient WaveDrom notation via eval on failure).
   *
   * On success: replace the <pre> with a <div class="wavedrom-container">
   * holding the rendered SVG.
   *
   * On failure: a toast + an error box (header + raw source), and the
   * <pre> is kept replaceable so a later pass can retry -- but we never
   * retry automatically; the source stays visible for fixing.
   */
  async function renderOne(pre) {
    const code = pre.querySelector("code");
    if (!code) return;
    const source = code.textContent;
    if (!(await whenReady())) return; // wavedrom unavailable -> leave source
    const container = document.createElement("div");
    container.className = "wavedrom-container";
    // Focusable so a keyboard user can Tab to the diagram and open the
    // hybrid context menu with Shift+F10 / the Menu key (and reach the
    // copy-image button, which is revealed on :focus-within).
    container.tabIndex = 0;
    container.dataset.wavedrom = "ok";
    // Store the original source so hybrid mode's domToMarkdown can
    // round-trip the diagram back to a ```wavedrom code block instead
    // of losing it to turndown's SVG-to-text stripping.
    container.dataset.wavedromSource = source;
    try {
      const svg = await renderSvgElement(source);
      container.appendChild(svg);
      if (NB.blocks && NB.blocks.prepareSvg) {
        NB.blocks.prepareSvg(svg, { mod: "wavedrom", card: container });
      }
      pre.replaceWith(container);
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : "Render failed";
      const firstLine = msg.split(/\r?\n/)[0].slice(0, 200);
      if (NB.app && NB.app.notify) {
        NB.app.notify("WaveDrom error: " + firstLine, 4000, "warn");
      }
      const wrap = document.createElement("div");
      wrap.className = "wavedrom-error";
      wrap.dataset.wavedrom = "error";
      const head = document.createElement("div");
      head.className = "wavedrom-error-head";
      head.textContent = "WaveDrom error: " + firstLine;
      const src = document.createElement("pre");
      src.className = "wavedrom-source";
      src.textContent = source;
      wrap.appendChild(head);
      wrap.appendChild(src);
      pre.replaceWith(wrap);
    }
  }

  /* renderAll(container) -- find every <pre><code class="language-wavedrom">
   * inside `container` and render it sequentially.
   *
   * Idempotency: a <pre> already replaced with a .wavedrom-container (or a
   * .wavedrom-error box) no longer holds a code.language-wavedrom, so the
   * query below won't pick it up again. Runs in view mode AND live
   * preview so diagrams update as the user types. */
  async function renderAll(container) {
    if (!container) return;
    const blocks = container.querySelectorAll("pre > code.language-wavedrom");
    // Nothing to render -> don't fetch the bundle.
    if (!blocks.length) return;
    if (!(await whenReady())) return;
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      await renderOne(pre);
    }
  }

  /* parseSource(raw) -- parse a ```wavedrom block body into a JS object.
   *
   * The official WaveDrom notation is not strict JSON: keys may be
   * unquoted ({signal:[...]}), so we cannot use JSON.parse alone. The
   * reference editor parses with eval("(" + source + ")"). We try strict
   * JSON first (for hand-typed, quoted blocks) and fall back to the
   * lenient eval path. Throws with a readable message if both fail.
   *
   * The source is the note owner's own file (the viewer already renders
   * notebook content unsanitised), so this eval is no escalation of
   * trust -- it only runs inside the render path for ```wavedrom blocks. */
  function parseSource(raw) {
    const t = raw.trim();
    try {
      return JSON.parse(t);
    } catch (_) {
      // Lenient path: wrap the body in parentheses and eval it as a JS
      // object expression. Rejected (by design) if it doesn't end in a
      // value, but eval already throws on genuinely malformed input.
      let wrapped = t;
      if (t[0] !== "(") wrapped = "(" + t + ")";
      // eslint-disable-next-line no-eval
      return (0, eval)(wrapped);
    }
  }

  NB.wavedrom = { renderAll, whenReady, parseSource, renderSvgElement };

  /* --- lightbox: click a rendered waveform to see it full-size -------- */
  /* The full-screen overlay + zoom controls live in the shared lightbox
   * module (static/js/lightbox.js). We hand it our element ids and the
   * container selector; it wires the buttons, backdrop click, wheel, and
   * Escape / Ctrl++ / Ctrl+- keybindings, and returns the public methods
   * we re-expose. The overlay reuses the generic .mermaid-lightbox-* /
   * .mlb-* CSS classes but has its own element ids, so it is fully
   * independent of the mermaid lightbox. */
  const lightbox = NB.lightbox.create({
    overlayId: "wavedrom-lightbox",
    bodyId:    "wavedrom-lightbox-body",
    closeId:   "wdlb-close",
    zoomInId:  "wdlb-zoom-in",
    zoomOutId: "wdlb-zoom-out",
    fitId:     "wdlb-fit",
    pctId:     "wdlb-zoom-pct",
    containerSelector: ".wavedrom-container",
  });

  NB.wavedrom = { renderAll, whenReady, parseSource, renderSvgElement,
    openLightbox: lightbox.openLightbox,
    closeLightbox: lightbox.closeLightbox,
    zoomIn: lightbox.zoomIn,
    zoomOut: lightbox.zoomOut,
    fitToPage: lightbox.fitToPage };

  // Register with the shared blocks registry: one authoritative list for
  // the render pipelines, the hybrid click-to-edit table, and the Save
  // round-trip.
  if (NB.blocks) {
    NB.blocks.register({
      mod: "wavedrom",
      langs: ["wavedrom"],
      name: "WaveDrom",
      fence: "wavedrom",
      selector: "pre > code.language-wavedrom",
      containerClass: "wavedrom-container",
      marker: { attr: "data-wavedrom", value: "ok" },
      datasetKey: "wavedromSource",
      errorClass: "wavedrom-error",
      errorMarker: { attr: "data-wavedrom", value: "error" },
      sourceClass: "wavedrom-source",
      design: "wavedromDesign",
      renderAll,
    });
  }
})();
