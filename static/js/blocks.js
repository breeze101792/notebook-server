/* blocks.js -- the registry that unifies the "plugin" code-block renderers.
 *
 * The notebook renders several fenced languages specially: ```mermaid,
 * ```wavedrom, ```math/```katex, ```dot/```graphviz, ```html-live, and
 * ```svg. Each lives in its own module (mermaid.js, wavedrom.js,
 * katex.js, viz.js, htmlpreview.js, svg.js) because their rendering
 * cores are genuinely
 * different library glue. What they DO share is the plumbing:
 *
 *   - the ordered list of renderers the viewer / hybrid / export
 *     pipelines must run;
 *   - turning a rendered block (or its error box) back into a fenced
 *     block on the hybrid Save path (domToMarkdown);
 *   - the hybrid click-to-edit type table (selector -> language ->
 *     module -> source extractor);
 *   - the fenced examples served to both Insert menus (the hybrid
 *     right-click menu and the edit bar).
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
 * htmlpreview, svg).
 *
 * Deliberately NOT here: a generic renderOne lifecycle. The six
 * renderOne bodies share almost nothing (mermaid theme init, wavedrom
 * JSON dance, katex options, viz WASM, htmlpreview sandbox, svg XML
 * parse + sanitize), so a
 * lifecycle abstraction would be a framework with one implementation
 * per plugin. Modules keep their own renderAll/renderOne; the registry
 * only orchestrates them and owns the round-trip.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Registered descriptors, in registration (render) order.
  const registry = [];

  /* Fenced examples offered by the Insert menus (the hybrid right-click
   * menu and the edit bar). `lang` must be a registry fence; a language
   * may appear more than once, which is how mermaid offers one example
   * per editable diagram family. */
  const EXAMPLES = [
    {
      lang: "mermaid",
      label: "Flowchart",
      source: "flowchart LR\n  A[Note] --> B{Code block?}\n  B -- yes --> C[Render]\n  B -- no --> D[Text]",
    },
    {
      lang: "mermaid",
      label: "Sequence",
      source: "sequenceDiagram\n  participant U as User\n  participant N as Notebook\n  U->>N: Open note\n  N-->>U: Render Markdown",
    },
    {
      lang: "mermaid",
      label: "Pie",
      source: "pie title Notes by kind\n  \"Ideas\" : 40\n  \"Tasks\" : 35\n  \"Reference\" : 25",
    },
    {
      lang: "mermaid",
      label: "State",
      source: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Editing: open file\n  Editing --> Saved: save\n  Saved --> Editing: edit\n  Saved --> [*]: close",
    },
    {
      lang: "mermaid",
      label: "Class",
      source: "classDiagram\n  class Note {\n    +String path\n    +open()\n    +save()\n  }\n  class Renderer {\n    +render(md)\n  }\n  Note --> Renderer : uses",
    },
    {
      lang: "mermaid",
      label: "ER",
      source: "erDiagram\n  NOTE ||--o{ TAG : has\n  NOTE {\n    string path PK\n    string title\n  }\n  TAG {\n    string name PK\n  }",
    },
    {
      lang: "mermaid",
      label: "Gantt schedule",
      source: "gantt\n  title Notebook release plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Example menus      :done,    a1, 2026-10-01, 3d\n  Syntax note        :active,  a2, after a1, 2d\n  section Test\n  DOM suite          :         a3, after a2, 2d",
    },
    {
      lang: "mermaid",
      label: "Timeline",
      source: "timeline\n  title Notebook history\n  2024 : Prototype\n  2025 : Mobile shell\n  2026 : Visual Mermaid editor",
    },
    {
      lang: "wavedrom",
      label: "WaveDrom timing",
      source: "{signal: [\n  {name: 'clk', wave: 'p.....|...'},\n  {name: 'data', wave: 'x.345x|=.x', data: ['head', 'body', 'tail']}\n]}",
    },
    {
      lang: "math",
      label: "Math (KaTeX)",
      source: "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
    },
    {
      lang: "dot",
      label: "Graphviz graph",
      source: "digraph G {\n  Note -> Render;\n  Note -> Text;\n}",
    },
    {
      lang: "html-live",
      label: "HTML preview",
      source: "<div class=\"demo\">\n  <strong>Live HTML</strong>\n  <button onclick=\"this.textContent='Clicked!'\">Click me</button>\n</div>",
    },
    {
      lang: "svg",
      label: "SVG drawing",
      source: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 60\" width=\"120\" height=\"60\">\n  <rect x=\"1\" y=\"1\" width=\"118\" height=\"58\" rx=\"8\" fill=\"none\" stroke=\"currentColor\"/>\n  <circle cx=\"30\" cy=\"30\" r=\"12\" fill=\"currentColor\"/>\n  <text x=\"52\" y=\"36\" font-size=\"14\" fill=\"currentColor\">SVG</text>\n</svg>",
    },
  ];

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
   *   marker         {attr, value} set on a successfully rendered block;
   *                  identity requires it, so a raw element with the same
   *                  class is not mistaken for a rendered block
   *   datasetKey     camelCase dataset key holding the original source
   *   renderAll      the module's renderAll(container) function
   *
   * Optional:
   *   errorClass     class of the failure box (null when the type has no
   *                  error box, e.g. htmlpreview)
   *   errorMarker    {attr, value} set on the failure box (defaults to
   *                  errorClass identity when absent)
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
   * click-to-edit path. Identity is marker-keyed for both shapes. */
  function forElement(el) {
    if (!el || !el.closest) return null;
    for (const d of registry) {
      const sel = selectorFor(d);
      if (sel && el.closest(sel)) return d;
    }
    return null;
  }

  function markerSelector(marker) {
    if (!marker || !marker.attr) return "";
    return "[" + marker.attr + '="' + marker.value + '"]';
  }

  function containerSelector(d) {
    return d.marker ? markerSelector(d.marker)
      : (d.containerClass ? "." + d.containerClass : "");
  }

  function errorSelector(d) {
    return d.errorMarker ? markerSelector(d.errorMarker)
      : (d.errorClass ? "." + d.errorClass : "");
  }

  /* selectorFor(d) -> "[data-mermaid=ok],[data-mermaid=error]" (the shape
   * hybrid's codeBlockAt expects). */
  function selectorFor(d) {
    return [containerSelector(d), errorSelector(d)].filter(Boolean).join(",");
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
   * descriptor's `fence` language. Identity is marker-keyed, so an
   * authored element that merely reuses a renderer class is left as
   * raw HTML instead of being replaced with an empty fence. */
  function restoreForMarkdown(clone) {
    if (!clone) return;
    for (const d of registry) {
      const containerSel = containerSelector(d);
      if (containerSel) {
        clone.querySelectorAll(containerSel).forEach((el) => {
          el.replaceWith(makeFence(d.fence, sourceOf(d, el)));
        });
      }
      const errorSel = errorSelector(d);
      if (errorSel) {
        clone.querySelectorAll(errorSel).forEach((el) => {
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
      // Optional visual-editor hook (e.g. "mermaidDesign"); null when the
      // type has no visual editor.
      design: d.design || null,
    }));
  }

  /* examples() -- the fenced examples the Insert menus offer, in registry
   * order (and in EXAMPLES order within one language). Shape: {lang,
   * label, source}. A renderer with no entry is skipped rather than shown
   * with an empty block. */
  function examples() {
    const out = [];
    for (const d of registry) {
      for (const ex of EXAMPLES) {
        if (ex.lang === d.fence) {
          out.push({ lang: ex.lang, label: ex.label, source: ex.source });
        }
      }
    }
    return out;
  }

  /* exampleGroups() -- examples grouped for the Insert menus. A language
   * with more than one example becomes one submenu ({label, items}); a
   * language with a single example stays a flat entry ({lang, label,
   * source}). Grouped item labels drop the redundant language prefix
   * Mermaid is the only language with several examples today. */
  function exampleGroups() {
    const byLang = new Map();
    for (const ex of examples()) {
      if (!byLang.has(ex.lang)) byLang.set(ex.lang, []);
      byLang.get(ex.lang).push(ex);
    }
    const out = [];
    for (const [lang, items] of byLang) {
      if (items.length === 1) {
        out.push(items[0]);
        continue;
      }
      const desc = registry.find((d) => d.fence === lang);
      const name = desc ? desc.name : lang;
      out.push({
        label: name.charAt(0).toUpperCase() + name.slice(1),
        items: items.map((ex) => ({
          lang: ex.lang,
          label: ex.label,
          source: ex.source,
        })),
      });
    }
    return out;
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
    examples,
    exampleGroups,
  };
})();
