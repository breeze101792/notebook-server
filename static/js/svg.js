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

  /* sizeForContainer(root) -- an SVG with only a viewBox has no intrinsic
   * width, so let it fill the card and pin the aspect ratio for the
   * height:auto CSS. An explicit width/height from the author wins. */
  function sizeForContainer(root) {
    const viewBox = root.getAttribute("viewBox");
    if (!viewBox) return;
    if (root.hasAttribute("width") || root.hasAttribute("height")) return;
    root.setAttribute("width", "100%");
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      root.style.aspectRatio = parts[2] + " / " + parts[3];
    }
  }

  function buildError(source, message) {
    const wrap = document.createElement("div");
    wrap.className = "svg-error";
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
    sizeForContainer(root);

    const card = document.createElement("div");
    card.className = "svg-container";
    card.dataset.svgSource = source;
    card.appendChild(document.importNode(root, true));
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

  NB.svg = { renderAll };

  if (NB.blocks) {
    NB.blocks.register({
      mod: "svg",
      langs: [FENCE],
      name: "SVG",
      fence: FENCE,
      selector: SELECTOR,
      containerClass: "svg-container",
      datasetKey: "svgSource",
      errorClass: "svg-error",
      sourceClass: "svg-source",
      renderAll,
    });
  }
})();
