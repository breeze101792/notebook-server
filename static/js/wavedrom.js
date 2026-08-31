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

  // UMD bundle loaded via a plain <script> tag in index.html (synchronously
  // with the other vendored libs, so window.wavedrom exists before this
  // module runs). If it somehow didn't, the render pass simply no-ops and
  // the blocks stay as readable source code.
  let ready = false;
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
    // The bundle is loaded synchronously so this should be immediate, but
    // stay defensive: wait briefly in case the script tag is deferred or
    // the bundle failed to load.
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (window.wavedrom && typeof window.wavedrom.renderWaveForm === "function") {
          ready = true;
          ensureSkin();
          resolve(true);
        } else if (Date.now() - start > 2500) {
          // 2.5s timeout: bundle failed to load. The viewer falls through
          // to the plain-source path on its own.
          resolve(false);
        } else {
          setTimeout(tick, 20);
        }
      };
      tick();
    });
  }

  /* renderOne(pre) -- render a single <pre><code class="language-wavedrom">.
   *
   * The block's raw text is decoded (marked leaves <pre><code> bodies
   * entity-encoded), then parsed to a JS object by parseSource() (strict
   * JSON first, lenient WaveDrom notation via eval on failure).
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
    const source = decodeHtml(code.textContent);
    const index = ++idCounter;
    const output = "Wavedrom_NB__";
    // WaveDrom renders into / creates an element with id output+index.
    // We mount a fresh container before the call so the SVG lands inside
    // the notebook node rather than at the end of <body>.
    const host = document.createElement("div");
    host.id = output + index;
    host.style.display = "none"; // hidden until replaced, so it never flashes
    pre.insertAdjacentElement("beforebegin", host);
    try {
      if (!(await whenReady())) {
        host.remove();
        return; // wavedrom unavailable -> leave the original <pre> in place
      }
      let text = "";
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
        text = host.innerHTML;
      } catch (err) {
        // Malformed source (or a render error). WaveDrom paints a
        // human-readable error into the host; prefer that over a raw
        // throw if it exists.
        text = host.innerHTML || "";
        if (!text) throw err;
      }
      host.style.display = "";
      const container = document.createElement("div");
      container.className = "wavedrom-container";
      container.dataset.wavedrom = "ok";
      // Store the original source so hybrid mode's domToMarkdown can
      // round-trip the diagram back to a ```wavedrom code block instead
      // of losing it to turndown's SVG-to-text stripping.
      container.dataset.wavedromSource = source;
      // WaveDrom emits a single <svg>. Move it out of the temp host and
      // into the container.
      const svg = host.querySelector("svg");
      if (svg) {
        host.removeChild(svg);
        container.appendChild(svg);
        // Make the SVG responsive: WaveDrom emits fixed width/height
        // attributes + a viewBox. Pin the aspect ratio from the viewBox
        // (as mermaid.js does) so max-width + max-height both scale the
        // element uniformly instead of clipping.
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
          if (vbW > 0 && vbH > 0) {
            svg.setAttribute("viewBox", "0 0 " + vbW + " " + vbH);
          }
        }
        svg.removeAttribute("height");
        svg.removeAttribute("width");
        if (vbW > 0 && vbH > 0) svg.style.aspectRatio = vbW + " / " + vbH;
        // Sanitise: WaveDrom's SVG is generated from user JSON by a lib
        // we control, the same class of trust as mermaid's output, so we
        // accept it as-is. Strip the id suffix so a block is uniquely
        // addressable and re-renders are idempotent.
        svg.removeAttribute("id");
        pre.replaceWith(container);
      } else {
        // No <svg> (blank/empty source). Treat as a render that produced
        // nothing useful; surface it as an error so the block isn't
        // silently dropped.
        throw new Error("No SVG rendered");
      }
    } catch (err) {
      const msg = (err && err.message) ? String(err.message) : "Render failed";
      const firstLine = msg.split(/\r?\n/)[0].slice(0, 200);
      if (NB.app && NB.app.notify) {
        NB.app.notify("WaveDrom error: " + firstLine, 4000, "warn");
      }
      const wrap = document.createElement("div");
      wrap.className = "wavedrom-error";
      const head = document.createElement("div");
      head.className = "wavedrom-error-head";
      head.textContent = "WaveDrom error: " + firstLine;
      const src = document.createElement("pre");
      src.className = "wavedrom-source";
      src.textContent = source;
      wrap.appendChild(head);
      wrap.appendChild(src);
      pre.replaceWith(wrap);
    } finally {
      host.remove();
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
    if (!(await whenReady())) return;
    const blocks = container.querySelectorAll("pre > code.language-wavedrom");
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      await renderOne(pre);
    }
  }

  function decodeHtml(str) {
    const el = document.createElement("div");
    el.innerHTML = str;
    return el.textContent || "";
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

  NB.wavedrom = { renderAll, whenReady };

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

  NB.wavedrom = { renderAll, whenReady,
    openLightbox: lightbox.openLightbox,
    closeLightbox: lightbox.closeLightbox,
    zoomIn: lightbox.zoomIn,
    zoomOut: lightbox.zoomOut,
    fitToPage: lightbox.fitToPage };
})();
