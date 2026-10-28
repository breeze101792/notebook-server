/* svg.js -- render Markdown code blocks tagged ```svg as inline SVG.
 *
 * Why a fence instead of raw <svg> in the note body: raw inline SVG
 * renders, but hybrid Save runs turndown over the DOM and mangles or
 * drops unknown elements. A registered fence keeps the source in
 * dataset.svgSource, so the block survives Save, export, and the hybrid
 * click-to-edit round-trip like the other plugin renderers.
 *
 * The source is parsed as XML (image/svg+xml), not HTML: an SVG that
 * fails to parse is shown in the error box with its source intact
 * instead of being silently reinterpreted. Simple hand-written diagrams
 * are the intended case, so there is no vendor bundle and no lazy gate.
 *
 * Sanitization: SVG can execute script, so <script> and <foreignObject>
 * are dropped and every on* attribute and external href / xlink:href is
 * removed. Fragment refs (#id) and inline data: URIs stay. This keeps
 * inline SVG self-contained and inert; it is not a full sanitizer.
 *
 * Sizing is owned by blocks.js: a viewBox-only SVG renders at its
 * viewBox dimensions (scaled with the prose font), not stretched to the
 * reading column; a physical author width/height still wins.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const SVG_NS = "http://www.w3.org/2000/svg";
  const FENCE = "svg";
  const SELECTOR = "pre > code.language-svg";
  const DROP_TAGS = ["script", "foreignObject"];
  const SAFE_HREF_PREFIXES = ["#", "data:"];

  // Attributes whose external value would pull in a file the note does
  // not carry. Fragment-only and data: references stay self-contained.
  function isExternalHref(value) {
    const v = (value || "").trim().toLowerCase();
    return !SAFE_HREF_PREFIXES.some((p) => v.indexOf(p) === 0);
  }

  function sanitize(root) {
    for (const tag of DROP_TAGS) {
      root.querySelectorAll(tag).forEach((el) => el.remove());
    }
    const all = [root].concat(Array.from(root.querySelectorAll("*")));
    for (const el of all) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name === "href" || name === "xlink:href") {
          if (isExternalHref(attr.value)) el.removeAttributeNode(attr);
        } else if (name.indexOf("on") === 0) {
          el.removeAttributeNode(attr);
        }
      }
    }
  }

  function buildError(source, message) {
    const wrap = document.createElement("div");
    wrap.className = "svg-error";
    wrap.dataset.svg = "error";
    const head = document.createElement("div");
    head.className = "svg-error-head";
    head.textContent = "SVG error: " + message;
    const src = document.createElement("pre");
    src.className = "svg-source";
    src.textContent = source;
    wrap.appendChild(head);
    wrap.appendChild(src);
    return wrap;
  }

  /* renderOne(pre) -- parse the fence source and replace the <pre> with
   * a .svg-container holding the sanitized <svg>. Failures become a
   * .svg-error box that keeps the source visible. */
  function renderOne(pre) {
    const code = pre.querySelector("code");
    if (!code) return;
    const source = code.textContent;

    const doc = new window.DOMParser().parseFromString(source, "image/svg+xml");
    const root = doc.documentElement;
    const bad = !root || doc.getElementsByTagName("parsererror").length > 0 ||
      root.localName !== "svg";

    if (bad) {
      pre.replaceWith(buildError(source, "could not parse the block as SVG"));
      return;
    }

    sanitize(root);

    const card = document.createElement("div");
    card.className = "svg-container";
    card.dataset.svg = "ok";
    card.dataset.svgSource = source;
    card.appendChild(document.importNode(root, true));
    const svg = card.querySelector("svg");
    if (svg && NB.blocks && NB.blocks.prepareSvg) {
      NB.blocks.prepareSvg(svg, { mod: "svg", card: card });
    }
    pre.replaceWith(card);
  }

  /* renderAll(container) -- synchronous; no vendor gate. Idempotent: a
   * replaced <pre> no longer holds a code.language-svg. Runs in view mode
   * and live preview. */
  function renderAll(container) {
    if (!container) return;
    const blocks = container.querySelectorAll(SELECTOR);
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      renderOne(pre);
    }
  }

  /* --- lightbox: click a rendered SVG to see it full-size ------------- */
  /* The full-screen overlay + zoom controls live in the shared lightbox
   * module (static/js/lightbox.js). We hand it our element ids and the
   * container selector; it wires the buttons, backdrop click, wheel,
   * and Escape / Ctrl++ / Ctrl+- keybindings, and returns the public
   * methods we re-expose. */
  const lightbox = NB.lightbox.create({
    overlayId: "svg-lightbox",
    bodyId:    "svg-lightbox-body",
    closeId:   "svglb-close",
    zoomInId:  "svglb-zoom-in",
    zoomOutId: "svglb-zoom-out",
    fitId:     "svglb-fit",
    pctId:     "svglb-zoom-pct",
    containerSelector: ".svg-container",
  });

  NB.svg = { renderAll,
    openLightbox: lightbox.openLightbox,
    closeLightbox: lightbox.closeLightbox,
    zoomIn: lightbox.zoomIn,
    zoomOut: lightbox.zoomOut,
    fitToPage: lightbox.fitToPage };

  if (NB.blocks) {
    NB.blocks.register({
      mod: "svg",
      langs: [FENCE],
      name: "SVG",
      fence: FENCE,
      selector: SELECTOR,
      containerClass: "svg-container",
      marker: { attr: "data-svg", value: "ok" },
      datasetKey: "svgSource",
      errorClass: "svg-error",
      errorMarker: { attr: "data-svg", value: "error" },
      sourceClass: "svg-source",
      renderAll,
    });
  }
})();
