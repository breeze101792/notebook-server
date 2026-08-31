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
   * On error: fire a toast notification (NB.app.notify) with the
   * first line of mermaid's error message and replace the <pre>
   * with a warning error box (header + raw source) so the failed
   * block is visibly marked in place while the source stays
   * readable/copyable for fixing.
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
      // Store the original source so hybrid mode's domToMarkdown can
      // round-trip the diagram back to a ```mermaid code block instead
      // of losing it to turndown's SVG-to-text stripping.
      container.dataset.mermaidSource = source;
      // result.svg is the rendered diagram. innerHTML is safe here:
      // the lib generated the string from parsing `source`, which
      // IS user content, but the lib has already sanitised it
      // through its own parser (the securityLevel:"strict" config
      // above disables click-jacking too).
      container.innerHTML = result.svg;
      // Make the SVG responsive: mermaid emits fixed pixel width /
      // height attributes that don't scale with the pane. We strip
      // the height and pin aspect-ratio from the viewBox so the
      // browser scales the SVG element uniformly when either max-
      // width or max-height kicks in (otherwise height: auto + a
      // max-height clips the bottom instead of rescaling).
      const svg = container.querySelector("svg");
      if (svg) {
        svg.removeAttribute("height");
        // mermaid emits width/height attributes. Use the viewBox if
        // present, else fall back to the original width/height. The
        // CSS then scales the SVG to the container width and the
        // browser preserves the aspect ratio.
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
            svg.setAttribute("viewBox", `0 0 ${vbW} ${vbH}`);
          }
        }
        // Pin the aspect ratio on the SVG element so max-width and
        // max-height both scale the element (not clip it). Browsers
        // respect aspect-ratio even when one dimension is constrained
        // and the other is "auto".
        if (vbW > 0 && vbH > 0) {
          svg.style.aspectRatio = `${vbW} / ${vbH}`;
        }
      }
      pre.replaceWith(container);
    } catch (err) {
      // Parse / render failure. Surface the problem as a toast
      // notification (via NB.app.notify) AND replace the diagram
      // area with a warning error box (header + raw source) so the
      // failed block is clearly marked in place and the user can
      // read/copy the source. Because the replacement has no
      // code.language-mermaid child (like a successful render's
      // .mermaid-container), renderAll stays idempotent -- a failed
      // block won't be re-rendered (and re-toasted) on the next
      // pass.
      const msg = (err && err.message) ? String(err.message) : "Render failed";
      // mermaid's error messages are usually multi-line. Collapse
      // them to a single line for the header / toast.
      const firstLine = msg.split(/\r?\n/)[0].slice(0, 200);
      if (NB.app && NB.app.notify) {
        NB.app.notify("Mermaid error: " + firstLine, 4000, "warn");
      }
      // When render() rejects, mermaid appends a stray
      // <div id="d<render-id>"> (holding a big "Syntax error" SVG)
      // to the end of <body>. Remove it so the error doesn't linger
      // at the bottom of the page -- we surface our own block +
      // toast instead.
      const stray = document.getElementById("d" + id);
      if (stray) stray.remove();
      const wrap = document.createElement("div");
      wrap.className = "mermaid-error";
      const head = document.createElement("div");
      head.className = "mermaid-error-head";
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
   * .mermaid-container (or a .mermaid-error box on failure) no
   * longer has a <code class="language-mermaid"> inside it, so the
   * query below won't pick it up again. We don't need to track
   * which blocks we've already processed.
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
  /* The full-screen overlay + zoom controls live in the shared lightbox
   * module (static/js/lightbox.js). We just hand it our element ids and
   * the container selector; it wires the buttons, backdrop click, wheel,
   * and Escape / Ctrl++ / Ctrl+- keybindings, and returns the public
   * methods we re-expose. */
  const lightbox = NB.lightbox.create({
    overlayId: "mermaid-lightbox",
    bodyId:    "mermaid-lightbox-body",
    closeId:   "mlb-close",
    zoomInId:  "mlb-zoom-in",
    zoomOutId: "mlb-zoom-out",
    fitId:     "mlb-fit",
    pctId:     "mlb-zoom-pct",
    containerSelector: ".mermaid-container",
  });

  NB.mermaid = { renderAll, reinit, whenReady,
    openLightbox: lightbox.openLightbox,
    closeLightbox: lightbox.closeLightbox,
    zoomIn: lightbox.zoomIn,
    zoomOut: lightbox.zoomOut,
    fitToPage: lightbox.fitToPage };
})();
