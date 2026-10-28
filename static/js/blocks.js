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

  /* ------------------------------------------------------------------ */
  /* Rendered-figure sizing                                             */
  /* ------------------------------------------------------------------ */
  /* The four SVG renderers share one sizing model. A diagram keeps its
   * current (medium) size and follows the prose font scale. The measured
   * card width and 70% of the viewer height decide one of three layouts:
   *
   *   normal  the whole diagram fits the measured viewport
   *   tall    it fits the width but is taller than the viewport (up to
   *           TALL_MAX_VIEWS); keep the width-fitted size and let the
   *           card grow so the note page scrolls. No nested scroller.
   *   fit     it is more than TALL_MAX_VIEWS tall; scale it down to the
   *           viewport height and leave the lightbox for detail
   *
   * Diagrams are never upscaled past their natural size at the current
   * reference. The reference is the card's computed prose font size:
   * 1rem on desktop and 16px * --font-scale on the phone (the CSS token
   * --nb-ref-size mirrors that). */
  const CSS_BASE_PX = 14;          // the app's medium font size / design base
  const VIEWPORT_RATIO = 0.7;      // share of #viewer-content height
  const TALL_MAX_VIEWS = 3;        // taller than this -> shrink-to-fit
  const VIEWPORT_CLASS = "nb-figure-viewport";
  const FIGURE_SELECTOR =
    ".mermaid-container, .wavedrom-container, .viz-container, .svg-container";
  const RELAYOUT_DEBOUNCE_MS = 80;
  const PT_TO_PX = 4 / 3;
  const PC_TO_PX = 16;
  const IN_TO_PX = 96;
  const CM_TO_PX = 96 / 2.54;
  const MM_TO_PX = 96 / 25.4;
  const EX_RATIO = 0.5;

  let relayoutTimer = 0;
  let relayoutRoot = null;
  let resizeObserver = null;

  function px(n) {
    return String(n) + "px";
  }

  /* parseLength(value) -> { n, unit } | null. Unit "" means the CSS
   * default; for inline SVG attributes that is px. "%" and "ch" are
   * recognised but deliberately not convertible here. */
  function parseLength(value) {
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-z%]*)\s*$/i
      .exec(String(value == null ? "" : value));
    if (!m) return null;
    return { n: parseFloat(m[1]), unit: (m[2] || "").toLowerCase() };
  }

  /* Resolve a relative-unit origin lazily. `origins` carries getters so a
   * normal px/pt diagram never pays for a getComputedStyle read. */
  function originValue(origins, key, fallback) {
    if (!origins) return fallback;
    const v = (typeof origins[key] === "function") ? origins[key]() : origins[key];
    return v > 0 ? v : fallback;
  }

  function lengthToPx(parsed, refPx, origins) {
    if (!parsed) return 0;
    switch (parsed.unit) {
      case "": case "px": return parsed.n;
      case "pt": return parsed.n * PT_TO_PX;
      case "pc": return parsed.n * PC_TO_PX;
      case "in": return parsed.n * IN_TO_PX;
      case "cm": return parsed.n * CM_TO_PX;
      case "mm": return parsed.n * MM_TO_PX;
      // em is the SVG's own font, rem is the document root's font. They
      // differ on the phone (16px vs 14px prose) and when an authored SVG
      // sets its own font-size.
      case "em": return parsed.n * originValue(origins, "emPx", refPx);
      case "rem": return parsed.n * originValue(origins, "remPx", refPx);
      case "ex": return parsed.n * originValue(origins, "emPx", refPx) * EX_RATIO;
      default: return 0;               // % / ch / unknown
    }
  }

  function readFontPx(el, fallback) {
    try {
      const n = parseFloat(window.getComputedStyle(el).fontSize);
      if (n > 0) return n;
    } catch (_) { /* detached / no layout */ }
    return fallback;
  }

  function readRootFontPx(fallback) {
    try {
      const n = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
      if (n > 0) return n;
    } catch (_) { /* no document */ }
    return fallback;
  }

  function makeOrigins(svg, refPx, remOrigin, emOrigin) {
    let emPx = emOrigin > 0 ? emOrigin : 0;
    return {
      emPx: () => {
        if (!(emPx > 0)) emPx = readFontPx(svg, refPx);
        return emPx;
      },
      remPx: () => {
        if (typeof remOrigin === "function") return remOrigin();
        if (remOrigin > 0) return remOrigin;
        return readRootFontPx(refPx);
      },
    };
  }

  /* Graphviz emits width/height in pt. A unitless attribute is pt too;
   * viewBox units are pt and must never be treated as CSS px. */
  function ptLengthToPx(value, refPx, origins) {
    const p = parseLength(value);
    if (!p) return 0;
    if (p.unit === "") return p.n * PT_TO_PX;
    return lengthToPx(p, refPx, origins);
  }

  function viewBoxSize(svg) {
    const vb = svg.getAttribute && svg.getAttribute("viewBox");
    if (!vb) return null;
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { w: parts[2], h: parts[3] };
    }
    return null;
  }

  function rawDimension(svg, name) {
    const attr = svg.getAttribute && svg.getAttribute(name);
    if (attr != null && attr !== "") return attr;
    // The designer seam normalises before the note path measures, which
    // drops the height attribute. Keep the first author/library value so
    // Graphviz's pt height is still readable at prepare time.
    const key = name === "height" ? "nbOrigHeight" : "nbOrigWidth";
    const orig = svg.dataset && svg.dataset[key];
    if (orig) return orig;
    return (svg.style && svg.style[name]) || "";
  }

  function readRefPx(card) {
    return readFontPx(card, CSS_BASE_PX);
  }

  /* The natural size of one diagram, before card/viewport fitting.
   *
   * kind "font"     a library diagram or a viewBox-only / percentage
   *                 inline SVG: w/h are the drawing's natural px at a
   *                 14px base; the caller stores w/14 and multiplies by
   *                 the current reference. The viewBox is the design
   *                 size, never permission to stretch to the card.
   * kind "explicit" an inline SVG whose author gave a physical
   *                 width/height: w/h are CSS px now (reconverted on
   *                 every layout).
   *
   * null means "unknown": leave the SVG on the pre-existing fallback
   * path rather than guessing a size. */
  function measureNatural(svg, mod, refPx, origins) {
    const vb = viewBoxSize(svg);
    if (mod === "mermaid") {
      let w = 0, h = 0;
      if (vb) {
        w = vb.w;
        h = vb.h;
      } else {
        w = lengthToPx(parseLength(rawDimension(svg, "width")), refPx, origins);
        h = lengthToPx(parseLength(rawDimension(svg, "height")), refPx, origins);
      }
      if (!(w > 0 && h > 0)) return null;
      // Mermaid v11 emits width="100%" plus style="max-width:<natural>px".
      // The inline max-width wins over the app stylesheet and would cap
      // the font-scaled size, so drop it once the natural size is known.
      if (svg.style && svg.style.removeProperty) {
        svg.style.removeProperty("max-width");
      }
      return { kind: "font", w: w, h: h };
    }
    if (mod === "wavedrom") {
      let w = lengthToPx(parseLength(rawDimension(svg, "width")), refPx, origins);
      let h = lengthToPx(parseLength(rawDimension(svg, "height")), refPx, origins);
      if (!(w > 0 && h > 0) && vb) {
        w = vb.w;
        h = vb.h;
      }
      return (w > 0 && h > 0) ? { kind: "font", w: w, h: h } : null;
    }
    if (mod === "viz") {
      const w = ptLengthToPx(rawDimension(svg, "width"), refPx, origins);
      const h = ptLengthToPx(rawDimension(svg, "height"), refPx, origins);
      // No viewBox fallback: a Graphviz viewBox is in pt, not px.
      return (w > 0 && h > 0) ? { kind: "font", w: w, h: h } : null;
    }

    // Inline ```svg: a physical author size wins. A viewBox-only SVG or
    // any percentage dimension is a font-scaled drawing at its viewBox
    // size; a percentage is a responsive hint, not permission to enlarge
    // the drawing's internal text to the whole reading column.
    const rawW = rawDimension(svg, "width");
    const rawH = rawDimension(svg, "height");
    const pW = parseLength(rawW);
    const pH = parseLength(rawH);
    const isPercent = (p) => !!(p && p.unit === "%");
    if (vb && (isPercent(pW) || isPercent(pH) || (!pW && !pH))) {
      return { kind: "font", w: vb.w, h: vb.h };
    }
    if (pW && pH) {
      const w = lengthToPx(pW, refPx, origins);
      const h = lengthToPx(pH, refPx, origins);
      if (w > 0 && h > 0) {
        return { kind: "explicit", w: w, h: h, ratio: w / h, rawW: rawW, rawH: rawH };
      }
      return null;
    }
    if (!vb) return null;
    const ratio = vb.w / vb.h;
    if (pW) {
      const w = lengthToPx(pW, refPx, origins);
      return w > 0
        ? { kind: "explicit", w: w, h: w / ratio, ratio: ratio, rawW: rawW, rawH: rawH }
        : null;
    }
    if (pH) {
      const h = lengthToPx(pH, refPx, origins);
      return h > 0
        ? { kind: "explicit", w: h * ratio, h: h, ratio: ratio, rawW: rawW, rawH: rawH }
        : null;
    }
    return null;
  }

  /* normalizeSvg(svg) -- the single owner of the old per-renderer
   * viewBox/aspect-ratio block, including the designer preview path.
   * Removes the height attribute and pins the aspect ratio. Returns the
   * viewBox it used (synthesised from width/height when absent) or null. */
  function normalizeSvg(svg) {
    if (!svg) return null;
    if (!svg.dataset.nbOrigWidth) {
      svg.dataset.nbOrigWidth = svg.getAttribute("width") || "";
    }
    if (!svg.dataset.nbOrigHeight) {
      svg.dataset.nbOrigHeight = svg.getAttribute("height") || "";
    }
    let vb = viewBoxSize(svg);
    if (!vb) {
      const wRaw = parseLength(svg.getAttribute("width"));
      const hRaw = parseLength(svg.getAttribute("height"));
      if (wRaw && hRaw && wRaw.unit !== "%" && hRaw.unit !== "%" &&
          wRaw.n > 0 && hRaw.n > 0) {
        svg.setAttribute("viewBox", "0 0 " + wRaw.n + " " + hRaw.n);
        vb = { w: wRaw.n, h: hRaw.n };
      }
    }
    svg.removeAttribute("height");
    if (vb && svg.style) svg.style.aspectRatio = vb.w + " / " + vb.h;
    return vb;
  }

  function ensureViewport(card, svg) {
    const parent = svg.parentElement;
    if (parent && parent.classList && parent.classList.contains(VIEWPORT_CLASS)) {
      return parent;
    }
    const vp = document.createElement("div");
    vp.className = VIEWPORT_CLASS;
    if (svg.parentNode) svg.parentNode.insertBefore(vp, svg);
    vp.appendChild(svg);
    return vp;
  }

  /* prepareSvg(svg, { mod, card }) -- wrap one rendered SVG in its
   * sizing wrapper, record the renderer-specific natural-size factor,
   * and schedule one layout pass. Renderers call this after the SVG is
   * in the card; the designers' renderSvgElement seam calls
   * normalizeSvg() only, so their own preview card keeps its direct
   * child. */
  function prepareSvg(svg, opts) {
    if (!svg) return null;
    const mod = (opts && opts.mod) || "svg";
    const card = (opts && opts.card) ||
      (svg.closest && svg.closest(FIGURE_SELECTOR));
    if (!card) return null;
    const vp = ensureViewport(card, svg);
    svg.dataset.nbMod = mod;
    const refPx = readRefPx(card);
    const origins = makeOrigins(svg, refPx);
    const nat = measureNatural(svg, mod, refPx, origins);
    if (!nat) {
      svg.dataset.nbSizing = "fallback";
      delete svg.dataset.nbW;
      delete svg.dataset.nbH;
      delete svg.dataset.nbRatio;
      svg.style.removeProperty("--nb-w");
      scheduleRelayout(card);
      return { sizing: "fallback", viewport: vp };
    }

    if (nat.kind === "font") {
      const fw = nat.w / CSS_BASE_PX;
      const fh = nat.h / CSS_BASE_PX;
      const ratio = nat.w / nat.h;
      svg.dataset.nbSizing = "font";
      svg.dataset.nbW = String(fw);
      svg.dataset.nbH = String(fh);
      svg.dataset.nbRatio = String(ratio);
      // --nb-w drives the no-JS / exported-HTML width; the data
      // attributes keep the factor when lightbox.js strips style.
      svg.style.setProperty("--nb-w", String(fw));
      normalizeSvg(svg);
      // The width attribute is the lightbox/print intrinsic size: the
      // natural size at the 14px base, never the fitted matrix size.
      svg.setAttribute("width", String(nat.w));
    } else if (nat.kind === "explicit") {
      svg.dataset.nbSizing = "explicit";
      svg.dataset.nbW = String(nat.w);
      svg.dataset.nbH = String(nat.h);
      svg.dataset.nbRatio = String(nat.ratio || (nat.w / nat.h));
      svg.dataset.nbWRaw = nat.rawW || "";
      svg.dataset.nbHRaw = nat.rawH || "";
      svg.style.removeProperty("--nb-w");
    }
    scheduleRelayout(card);
    return { sizing: nat.kind, viewport: vp };
  }

  /* planFigure(naturalW, naturalH, contentW, viewportH) -> the layout
   * matrix. Kept pure so the DOM tests can cover every case without
   * layout or a browser. */
  function planFigure(naturalW, naturalH, contentW, viewportH) {
    if (!(naturalW > 0) || !(naturalH > 0) ||
        !(contentW > 0) || !(viewportH > 0)) {
      return { mode: "fallback", scale: 1, width: 0, height: 0 };
    }
    const widthScale = Math.min(1, contentW / naturalW);
    const height = naturalH * widthScale;
    if (height <= viewportH) {
      return {
        mode: "normal", scale: widthScale,
        width: naturalW * widthScale, height: height,
      };
    }
    if (height <= viewportH * TALL_MAX_VIEWS) {
      return {
        mode: "tall", scale: widthScale,
        width: naturalW * widthScale, height: height,
      };
    }
    const scale = Math.min(widthScale, viewportH / naturalH);
    return {
      mode: "fit", scale: scale,
      width: naturalW * scale, height: naturalH * scale,
    };
  }

  function explicitNatural(svg, refPx, origins) {
    const ratio = parseFloat(svg.dataset.nbRatio) || 0;
    const pW = parseLength(svg.dataset.nbWRaw || "");
    const pH = parseLength(svg.dataset.nbHRaw || "");
    if (pW && pW.unit !== "%") {
      const w = lengthToPx(pW, refPx, origins);
      if (w > 0) {
        const h = (pH && pH.unit !== "%")
          ? lengthToPx(pH, refPx, origins)
          : (ratio > 0 ? w / ratio : 0);
        if (h > 0) return { w: w, h: h };
      }
    }
    if (pH && pH.unit !== "%") {
      const h = lengthToPx(pH, refPx, origins);
      if (h > 0 && ratio > 0) return { w: h * ratio, h: h };
    }
    return null;
  }

  /* Remove any inner-scroll state left by the earlier scroll model (or by
   * a stale in-page upgrade). The wrapper only sizes and centres the SVG
   * now; the card grows and #viewer-content scrolls. */
  function clearViewportScroll(vp) {
    vp.style.removeProperty("height");
    vp.style.removeProperty("max-height");
    vp.style.removeProperty("overflow-y");
    vp.style.removeProperty("scrollbar-gutter");
    vp.style.removeProperty("overscroll-behavior-y");
    vp.removeAttribute("tabindex");
    vp.removeAttribute("role");
    vp.removeAttribute("aria-label");
  }

  function applyFallback(vp, svg) {
    clearViewportScroll(vp);
    if (svg) {
      svg.style.removeProperty("width");
      svg.style.removeProperty("height");
    }
    vp.dataset.nbMode = "fallback";
  }

  function applyPlan(vp, svg, plan) {
    if (!plan || plan.mode === "fallback") {
      applyFallback(vp, svg);
      return;
    }
    clearViewportScroll(vp);
    svg.style.width = px(plan.width);
    svg.style.height = px(plan.height);
    vp.dataset.nbMode = plan.mode;
  }

  function measureViewportH() {
    const viewer = document.getElementById("viewer-content");
    if (!viewer || !(viewer.clientHeight > 0)) return 0;
    return viewer.clientHeight * VIEWPORT_RATIO;
  }

  /* layoutFigure(card[, metrics]) -- apply the matrix to one card.
   * metrics is a test seam: { contentW, ref, viewportH, remPx, emPx }.
   * remPx/emPx may be numbers or (for the app's shared per-pass rem)
   * getters; in the app the values are measured from the viewport,
   * #viewer-content, and the document root. */
  function layoutFigure(card, metrics) {
    if (!card) return;
    const vp = card.querySelector(":scope > ." + VIEWPORT_CLASS);
    if (!vp) return;
    const svg = vp.querySelector("svg");
    if (!svg) return;
    const sizing = svg.dataset.nbSizing || "fallback";
    if (sizing === "fallback") {
      applyFallback(vp, svg);
      return;
    }
    const refPx = (metrics && metrics.ref) || readRefPx(card);
    const viewportH = (metrics && metrics.viewportH) || measureViewportH();
    if (!(viewportH > 0)) return;

    // Drop legacy scroll-bar state before measuring the full card width.
    // The wrapper no longer scrolls; the card grows and the note page owns
    // the only scrollbar.
    clearViewportScroll(vp);
    const contentW = (metrics && metrics.contentW != null)
      ? metrics.contentW
      : vp.clientWidth;
    if (!(contentW > 0)) return;

    let natural;
    if (sizing === "explicit") {
      const origins = makeOrigins(svg, refPx,
        metrics && metrics.remPx, metrics && metrics.emPx);
      natural = explicitNatural(svg, refPx, origins);
      if (!natural) {
        applyFallback(vp, svg);
        return;
      }
    } else {
      const fw = parseFloat(svg.dataset.nbW);
      const fh = parseFloat(svg.dataset.nbH);
      if (!(fw > 0 && fh > 0)) {
        applyFallback(vp, svg);
        return;
      }
      natural = { w: fw * refPx, h: fh * refPx };
    }

    const plan = planFigure(natural.w, natural.h, contentW, viewportH);
    applyPlan(vp, svg, plan);
  }

  function defaultRelayoutScope() {
    return document.getElementById("viewer-content") || document;
  }

  /* Normalise a scheduling root to the scope that actually needs a scan.
   * Cards inside the viewer always schedule the viewer (one pass covers
   * every figure); a card prepared before insertion resolves to the
   * viewer too, so the timer still catches it after insertion. A render
   * root outside the viewer (if one ever exists) is scanned directly.
   * Detached export hosts intentionally resolve to the viewer: they keep
   * their CSS-only baseline and never need JS layout. */
  function resolveRelayoutScope(root) {
    const viewer = document.getElementById("viewer-content");
    if (!root || root === document || root === document.documentElement ||
        root === document.body) {
      return viewer || document;
    }
    if (root.nodeType === 1) {
      if (viewer && viewer.contains(root)) return viewer;
      if (root.isConnected) return root;
      return viewer || document;
    }
    return viewer || document;
  }

  function layoutAll(root) {
    if (root && root.nodeType === 1 && root.isConnected === false) return;
    const scope = resolveRelayoutScope(root);
    const viewportH = measureViewportH();
    if (!(viewportH > 0)) return;
    const cards = [];
    if (scope.nodeType === 1 && scope.matches && scope.matches(FIGURE_SELECTOR)) {
      cards.push(scope);
    }
    if (scope.querySelectorAll) {
      scope.querySelectorAll(FIGURE_SELECTOR).forEach((card) => {
        if (cards.indexOf(card) === -1) cards.push(card);
      });
    }
    if (!cards.length) return;

    // The prose reference is one value for the whole pass. The cards
    // inherit it from the viewer; a render root outside the viewer is its
    // own source. rem is resolved lazily (once) only if a card's explicit
    // unit actually asks for it.
    const viewer = document.getElementById("viewer-content");
    let refHost = null;
    if (viewer && (scope === viewer ||
        (scope.nodeType === 1 && viewer.contains(scope)))) {
      refHost = viewer;
    }
    if (!refHost && scope.nodeType === 1) refHost = scope;
    const refPx = readRefPx(refHost || cards[0]);
    let rootPx = 0;
    const remPx = () => {
      if (!(rootPx > 0)) rootPx = readRootFontPx(refPx);
      return rootPx;
    };
    for (const card of cards) {
      layoutFigure(card, { viewportH: viewportH, ref: refPx, remPx: remPx });
    }
  }

  /* scheduleRelayout(scope) -- trailing debounce. Each call resets the
   * timer and remembers the (normalised) pending scope, so a burst of
   * renders/resizes yields one pass after the burst. The pass scans the
   * viewer or the passed render root, never the whole document. */
  function scheduleRelayout(root) {
    relayoutRoot = resolveRelayoutScope(root);
    if (relayoutTimer) window.clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => {
      relayoutTimer = 0;
      const scope = relayoutRoot;
      relayoutRoot = null;
      if (scope) layoutAll(scope);
    }, RELAYOUT_DEBOUNCE_MS);
  }

  function relayout(root) {
    layoutAll(root || defaultRelayoutScope());
  }

  function ensureResizeObserver() {
    if (resizeObserver || typeof window.ResizeObserver !== "function") return;
    const viewer = document.getElementById("viewer-content");
    if (!viewer) return;
    resizeObserver = new window.ResizeObserver(() => scheduleRelayout());
    resizeObserver.observe(viewer);
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
    return Promise.all(passes).then(() => {
      scheduleRelayout(container);
    });
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
    /* rendered-figure sizing */
    prepareSvg,
    normalizeSvg,
    planFigure,
    layoutFigure,
    layoutAll,
    relayout,
    scheduleRelayout,
  };

  /* Recompute on the events the app does not route through a render:
   * window resize, a sidebar/outline drag or split-pane change (one
   * guarded observer on the viewer), the phone/desktop flip, and the
   * explicit font-size change (app.js calls scheduleRelayout()). */
  ensureResizeObserver();
  window.addEventListener("resize", scheduleRelayout);
  // `toggle` does not bubble; capture it so a figure inside a closed
  // <details> gets laid out the moment the disclosure opens. While it was
  // closed its card had no measurable width and layout correctly skipped.
  document.addEventListener("toggle", (e) => {
    const el = e.target;
    if (!el || el.tagName !== "DETAILS" || !el.open) return;
    scheduleRelayout(el);
  }, true);
  if (NB.evt && NB.evt.on) {
    NB.evt.on("mobile:mode", scheduleRelayout);
  }
})();
