/* katex.js -- render Markdown code blocks tagged as math (```math or
 * ```katex) into typeset equations.
 *
 * KaTeX ships as a vendored bundle (static/vendor/katex/katex.min.js,
 * MIT licensed) that exposes window.katex when loaded in a browser. We
 * call a single function:
 *
 *   katex.renderToString(source, options)
 *     Parse `source` (LaTeX math) and return an HTML string. We pass
 *     displayMode:true so block math renders on its own line, and
 *     throwOnError:false so a bad expression renders the raw source
 *     (in red) instead of throwing -- the user sees exactly what to
 *     fix, no toast needed.
 *
 * Unlike mermaid/wavedrom, KaTeX output is HTML (spans + CSS), not an
 * SVG, so it does NOT use the shared lightbox. The stylesheet
 * (static/vendor/katex/katex.min.css) + its woff2 fonts are loaded via
 * <link> in index.html; the CSS is theme-independent (math is black on
 * transparent, which reads on both light and dark surfaces).
 *
 * Why a module at all: it keeps the KaTeX-specific parsing (which
 * blocks are math, decoding entities, the render options) out of
 * viewer.js, mirroring mermaid.js / wavedrom.js.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  let ready = false;

  function whenReady() {
    if (ready) return Promise.resolve(true);
    if (window.katex && typeof window.katex.renderToString === "function") {
      ready = true;
      return Promise.resolve(true);
    }
    // The bundle is loaded synchronously so this should be immediate, but
    // stay defensive: wait briefly in case the script tag is deferred or
    // the bundle failed to load.
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (window.katex && typeof window.katex.renderToString === "function") {
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

  function decodeHtml(str) {
    const el = document.createElement("div");
    el.innerHTML = str;
    return el.textContent || "";
  }

  /* renderOne(pre) -- render a single <pre><code class="language-math">
   * (or language-katex) into a .katex-container div holding the typeset
   * HTML. The block's raw text is decoded (marked leaves <pre><code>
   * bodies entity-encoded) then passed to KaTeX. */
  async function renderOne(pre) {
    const code = pre.querySelector("code");
    if (!code) return;
    const source = decodeHtml(code.textContent);
    if (!(await whenReady())) return; // katex unavailable -> leave source
    const container = document.createElement("div");
    container.className = "katex-container";
    container.dataset.katex = "ok";
    // Store the original source so hybrid mode's domToMarkdown can
    // round-trip the equation back to a ```math code block.
    container.dataset.katexSource = source;
    try {
      container.innerHTML = window.katex.renderToString(source, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
      pre.replaceWith(container);
    } catch (err) {
      // renderToString with throwOnError:false shouldn't throw, but be
      // defensive: fall back to a plain code block so nothing is lost.
      const msg = (err && err.message) ? String(err.message) : "Render failed";
      const firstLine = msg.split(/\r?\n/)[0].slice(0, 200);
      if (NB.app && NB.app.notify) {
        NB.app.notify("KaTeX error: " + firstLine, 4000, "warn");
      }
      const wrap = document.createElement("div");
      wrap.className = "katex-error";
      const head = document.createElement("div");
      head.className = "katex-error-head";
      head.textContent = "KaTeX error: " + firstLine;
      const src = document.createElement("pre");
      src.className = "katex-source";
      src.textContent = source;
      wrap.appendChild(head);
      wrap.appendChild(src);
      pre.replaceWith(wrap);
    }
  }

  /* renderAll(container) -- find every <pre><code class="language-math">
   * or language-katex inside `container` and render it sequentially.
   * Idempotent: a <pre> already replaced with a .katex-container (or
   * .katex-error) no longer holds a code.language-math, so the query
   * won't pick it up again. Runs in view mode AND live preview. */
  async function renderAll(container) {
    if (!container) return;
    if (!(await whenReady())) return;
    const blocks = container.querySelectorAll(
      "pre > code.language-math, pre > code.language-katex");
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      await renderOne(pre);
    }
  }

  NB.katex = { renderAll, whenReady };
})();
