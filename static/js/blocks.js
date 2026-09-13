/* blocks.js -- the registry that unifies the "plugin" code-block renderers.
 *
 * The notebook renders several fenced languages specially: ```mermaid,
 * ```wavedrom, ```math/```katex, ```dot/```graphviz, and ```html-live.
 * Each lives in its own module (mermaid.js, wavedrom.js, katex.js,
 * viz.js, htmlpreview.js) because their rendering cores are genuinely
 * different library glue. What they DO share is the plumbing:
 *
 *   - the ordered list of renderers the viewer / hybrid / export
 *     pipelines must run;
 *   - turning a rendered block (or its error box) back into a fenced
 *     block on the hybrid Save path (domToMarkdown);
 *   - the hybrid click-to-edit type table (selector -> language ->
 *     module -> source extractor).
 *
 * Before this module that list was hand-copied into viewer.js,
 * hybrid.js (twice: render pipeline + round-trip) and export.js, and
 * the hybrid type table. Adding a renderer meant editing all of them,
 * and a miss was silent -- the service worker's PRECACHE list had
 * already drifted (missing wavedrom/katex/viz/lightbox) before this
 * change. This registry makes the list exist once.
 *
 * Each renderer module calls NB.blocks.register({...}) at load. The
 * driver (NB.blocks.renderAll) and the round-trip
 * (NB.blocks.restoreForMarkdown) then work for every registered type
 * without knowing its internals. Registration order is the render
 * order (script load order: mermaid, wavedrom, katex, viz,
 * htmlpreview).
 *
 * Deliberately NOT here: a generic renderOne lifecycle. The five
 * renderOne bodies share almost nothing (mermaid theme init, wavedrom
 * JSON dance, katex options, viz WASM, htmlpreview sandbox), so a
 * lifecycle abstraction would be a framework with one implementation
 * per plugin. Modules keep their own renderAll/renderOne; the registry
 * only orchestrates them and owns the round-trip.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Registered descriptors, in registration (render) order.
  const registry = [];

  /* register(desc) -- called once per renderer module at load.
   *
   * Required:
   *   mod            NB.<mod> namespace key (also the menu's module ref)
   *   langs          fence languages this type claims
   *   name           display name for the hybrid "Edit X source" menu
   *   fence          language written back on the hybrid round-trip
   *                  (may differ from a claimed lang: ```katex -> ```math)
   *   selector       CSS that finds the raw fences (pre > code.language-X)
   *   containerClass class of a successfully rendered block
   *   datasetKey     camelCase dataset key holding the original source
   *   renderAll      the module's renderAll(container) function
   *
   * Optional:
   *   errorClass     class of the failure box (null when the type has no
   *                  error box, e.g. htmlpreview)
   *   sourceClass    class of the <pre> holding the source inside the
   *                  error box (null when errorClass is null)
   */
  function register(desc) {
    if (!desc || !desc.mod || !desc.containerClass || !desc.renderAll) {
      // Be tolerant: a malformed descriptor should never break module
      // load. It simply won't participate.
      return false;
    }
    registry.push(desc);
    return true;
  }

  function all() { return registry.slice(); }

  /* forLang(lang) -> descriptor | null. Used by the hybrid language pill
   * to decide which module re-renders a fence after the user edits its
   * language. Matches a claimed lang OR the round-trip fence. */
  function forLang(lang) {
    const low = (lang || "").toLowerCase();
    if (!low) return null;
    for (const d of registry) {
      if ((d.langs || []).indexOf(low) !== -1) return d;
      if (d.fence === low) return d;
    }
    return null;
  }

  /* forElement(el) -> descriptor | null. Walks up from `el` to the
   * nearest rendered container or error box. Used by the hybrid
   * click-to-edit path. */
  function forElement(el) {
    if (!el || !el.closest) return null;
    for (const d of registry) {
      if (d.containerClass && el.closest("." + d.containerClass)) return d;
      if (d.errorClass && el.closest("." + d.errorClass)) return d;
    }
    return null;
  }

  /* buildCardSelector(d) -> ".mermaid-container,.mermaid-error" (the
   * shape hybrid's codeBlockAt expects). */
  function selectorFor(d) {
    const parts = [];
    if (d.containerClass) parts.push("." + d.containerClass);
    if (d.errorClass) parts.push("." + d.errorClass);
    return parts.join(",");
  }

  /* sourceOf(d, el) -> the original fence source held by a rendered
   * container (dataset) or an error box (its .sourceClass child). */
  function sourceOf(d, el) {
    if (!el) return "";
    if (d.datasetKey && el.dataset && el.dataset[d.datasetKey] != null) {
      return el.dataset[d.datasetKey];
    }
    if (d.sourceClass) {
      const srcEl = el.querySelector("." + d.sourceClass);
      if (srcEl) return srcEl.textContent || "";
    }
    return "";
  }

  /* makeFence(lang, source) -> a <pre><code class="language-lang">. */
  function makeFence(lang, source) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = "language-" + lang;
    code.textContent = source || "";
    pre.appendChild(code);
    return pre;
  }

  /* restoreForMarkdown(clone) -- the hybrid Save round-trip.
   *
   * Replaces every rendered block and error box in the cloned DOM with
   * a fenced block holding its original source, so turndown emits a
   * ```lang fence instead of stripping the SVG/HTML to text. Runs over
   * every registered type, so a new renderer cannot be silently
   * forgotten on the data-loss-critical save path.
   *
   * Containers read their source from dataset[datasetKey]; error boxes
   * read it from their .sourceClass child. Both become a fence with the
   * descriptor's `fence` language. */
  function restoreForMarkdown(clone) {
    if (!clone) return;
    for (const d of registry) {
      if (d.containerClass) {
        clone.querySelectorAll("." + d.containerClass).forEach((el) => {
          el.replaceWith(makeFence(d.fence, sourceOf(d, el)));
        });
      }
      if (d.errorClass) {
        clone.querySelectorAll("." + d.errorClass).forEach((el) => {
          el.replaceWith(makeFence(d.fence, sourceOf(d, el)));
        });
      }
    }
  }

  /* renderAll(container) -- run every registered renderer's renderAll.
   *
   * Each renderer owns its own lazy gate and sequential per-block loop;
   * we run the modules concurrently (Promise.all), exactly as the viewer
   * already fired them (viewer.js previously called each renderAll
   * without awaiting). Export awaits the aggregate, which is a superset
   * of its previous sequential awaits. */
  function renderAll(container) {
    const passes = [];
    for (const d of registry) {
      try {
        passes.push(Promise.resolve(d.renderAll(container)));
      } catch (_) {
        /* one renderer failing must not stop the others */
      }
    }
    return Promise.all(passes);
  }

  /* pluginTypes() -- the array hybrid.js used to hard-code. Derived from
   * the registry so a new renderer is automatically click-to-editable
   * and round-trippable. Shape: {sel, lang, name, mod, src(el)}. */
  function pluginTypes() {
    return registry.map((d) => ({
      sel: selectorFor(d),
      lang: d.fence,
      name: d.name,
      mod: d.mod,
      src: (el) => sourceOf(d, el),
    }));
  }

  NB.blocks = {
    register,
    all,
    forLang,
    forElement,
    selectorFor,
    sourceOf,
    renderAll,
    restoreForMarkdown,
    pluginTypes,
  };
})();
