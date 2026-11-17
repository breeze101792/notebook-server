/* copy-image.js -- the single owner of the copy-action PAIR on every
 * rendered block in the viewer: "Copy text" (the authored source) and
 * "Copy image" (a PNG of the block). The same scan appends the diagram
 * cards' Preview button, built by lightbox.js, so a card's whole action
 * row is created in one place.
 *
 * One entry point, attachBlockActions(host), wires both actions into every
 * block kind it finds (BLOCK_KINDS below, plus every <pre> fence):
 *   - A fenced code block: text = the sanitized source text, image = a
 *     snapshot of the rendered card.
 *   - A card (mermaid, wavedrom, graphviz, svg, html-live): text = the
 *     AUTHORED fence source from the container's data-* attribute (never the
 *     rendered markup), image = the rasterized diagram, or for an html-live
 *     card the stored fenced HTML + CSS snapshotted inertly into a real
 *     html>body document so `html`/`body` page styles apply.
 *   - KaTeX: text only. Its image is deliberately NOT offered yet: the
 *     snapshot renders in SVG-image secure static mode, which loads no
 *     webfonts, so KaTeX's KaTeX_Main/Math symbols fall back and the formula
 *     comes out garbled. Recorded as a follow-up rather than shipped broken.
 *
 * Static-snapshot limits (see htmlToPngBlob): scripts do not run, and
 * SVG-image secure static mode blocks external subresources (images,
 * @import, url(), web fonts), so script/canvas/animation output and remote
 * assets are not captured. An SVG that renders through <foreignObject>
 * (Mermaid flowcharts and class diagrams do) is loaded from a data: URL,
 * because Chromium and WebKit taint the canvas for the blob: form; every
 * other SVG stays on blob:. The rule itself lives on svgToPngBlob.
 * When the clipboard image write is unavailable (insecure context,
 * unsupported browser, denied permission, or a failed rasterize), it
 * downloads the PNG instead.
 * The preview table-view's "Copy image" action reuses this same rasterizer
 * (copyHtmlToPng), so this file stays the single owner of PNG copying and of
 * the snapshot frame's inset; only the size, the file name and the two toast
 * messages differ.
 *
 * Why a MutationObserver: the renderer modules replace their <pre> with a
 * container asynchronously, after the viewer already emitted
 * "viewer:rendered". Watching #viewer-content for child-list changes is
 * the reliable signal that new containers appeared. Injection is
 * idempotent (a container with a button is skipped), so the observer's own
 * mutations converge.
 *
 * Scope: only ever acts inside #viewer-content, and only in view/preview
 * mode -- the CM6 split-view live preview is excluded (its DOM is
 * disposable and the textarea is the source of truth), so the buttons are
 * removed when a live render arrives. The export pipeline builds diagrams
 * in its own offscreen host and must stay untouched. In hybrid (WYSIWYG)
 * mode the buttons are removed before the DOM becomes editable; both
 * button kinds carry .code-copy-btn, which hybrid.js strips from the note
 * on save, so they can never round-trip into the note or an export.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const VIEWER_CONTENT_ID = "viewer-content";
  // The block kinds that carry the copy-action pair, one row per rendered
  // card: `dataset` holds the authored fence source the TEXT button copies
  // (read at click time, so a re-render is picked up), `image` says how the
  // PNG is rasterized -- "svg" = the rendered diagram, "html" = the stored
  // fence, null = no image action (katex; see the module header).
  const BLOCK_KINDS = [
    { selector: ".mermaid-container", dataset: "mermaidSource", image: "svg" },
    { selector: ".wavedrom-container", dataset: "wavedromSource", image: "svg" },
    { selector: ".viz-container", dataset: "vizSource", image: "svg" },
    { selector: ".svg-container", dataset: "svgSource", image: "svg" },
    { selector: ".htmlpreview-card", dataset: "htmlpreviewSource", image: "html" },
    { selector: ".katex-container", dataset: "katexSource", image: null },
  ];

  // The text button and the image button share the base class so they style
  // identically and hybrid.js strips both from the note on save (it skips
  // .code-copy-btn). The image button adds its own modifier for the icon.
  const BUTTON_BASE_CLASS = "code-copy-btn";
  const IMAGE_BUTTON_CLASS = "nb-copy-img-btn";
  // The diagram cards' Preview action (lightbox.js). It shares the base
  // class, so the text-copy guard must exclude it.
  const PREVIEW_BUTTON_CLASS = "nb-preview-btn";
  const IMAGE_BUTTON_LABEL = "Copy image";

  const TEXT_BUTTON_LABEL = "Copy";
  const TEXT_BUTTON_ARIA = "Copy code to clipboard";
  // The code-block PNG action, next to the text one on every fence.
  const CODE_IMAGE_LABEL = "Copy code as image";
  const CODE_IMAGE_NAME = "code.png";
  const CODE_IMAGE_DONE_MSG = "Code copied as image";
  const CODE_IMAGE_FAIL_MSG = "Could not copy the code as an image";
  const COPIED_LABEL = "Copied!";
  const COPIED_HOLD_MS = 1200;
  const TEXT_COPIED_MESSAGE = "Copied to clipboard";
  const TEXT_FAIL_MESSAGE = "Copy failed";
  const TEXT_FAIL_MS = 2200;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const SVG_MIME = "image/svg+xml;charset=utf-8";
  // Data-URL prefix for every SVG that contains a <foreignObject>. Chromium
  // and WebKit taint the canvas for the blob: form, so both SVG paths pick
  // their URL from the rule documented on svgToPngBlob.
  const SVG_DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";
  const FOREIGN_OBJECT_RE = /foreignObject/;
  const PNG_MIME = "image/png";

  // The code card's language label. The live label is a ::after drawn from
  // data-fence-lang, which cannot be cloned, so the snapshot recreates it as
  // a span. These mirror the ::after rule in style.css (.72em/1.2 monospace,
  // fg-muted); the label's own top/left/font/colour are read from the live
  // pseudo-element when the engine exposes it and fall back to these. The
  // left inset is the pre's computed padding-left, which already follows the
  // desktop (16px) / phone (14px) rules, so no breakpoint is repeated here.
  const CODE_LABEL_FONT_STACK =
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const CODE_LABEL_SCALE = 0.72;
  const CODE_LABEL_LINE_HEIGHT = 1.2;
  const CODE_LABEL_TOP = "6px";
  // Space the two band buttons need on the right; the label never runs
  // under them (style.css keeps the same guard on the live ::after).
  const CODE_LABEL_MAX_GUARD = 132;
  // Transient chrome a code block could carry (none occurs on a fence today:
  // hybrid uses the browser's native selection and these classes belong to
  // tables and <hr>), stripped so a stale one can never reach the image.
  const CODE_CHROME_CLASSES = ["nb-ts-range", "nb-ts-drag", "nb-hr-selected"];
  const TRANSPARENT_COLOR_RE =
    /^(?:transparent|rgba?\(\s*0,\s*0,\s*0,\s*0\s*\))$/;

  // Namespaces that XMLSerializer already knows how to declare; attributes in
  // them (xlink:*, xml:*, xmlns:*) are left untouched by the sanitizer below.
  const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

  // XML 1.0 NCName (a Name with no colon) character classes, written out
  // rather than reusing a loose "identifier" test because HTML attribute
  // names like "@click" and ":class" would pass a loose check and then break
  // the XML parse. BMP only; attribute names outside the BMP do not occur in
  // practice.
  const XML_NC_START =
    "A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF" +
    "\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F" +
    "\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
  const XML_NC_REST = XML_NC_START + "\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
  const XML_NCNAME_RE = new RegExp("^[" + XML_NC_START + "][" + XML_NC_REST + "]*$");

  const ICON_SIZE = 16;

  // Rasterize at a scale that stays crisp on high-DPI screens; clamp so
  // neither canvas dimension can exceed MAX_CANVAS_DIM (browser canvas
  // limits are typically 4096-16384, and a pasted image rarely needs more).
  const SCALE_FLOOR = 2;
  const MAX_CANVAS_DIM = 4096;
  // Transparent PNGs paste badly into apps that assume a white page
  // (mermaid and graphviz emit no background), so paint white first.
  const CANVAS_BG = "#ffffff";

  // The reset the html-live preview iframe injects, reproduced so the
  // snapshot lays out like the preview. The preview nests body inside html,
  // each with 12px padding, so the content inset is 12px(html) + the source's
  // own body padding (12px default). This variant is used when the source has
  // no html background (the common case); it keeps that exact inset while
  // still letting a body background fill the frame.
  //
  // Two deliberate changes from the preview's literal reset, both because an
  // SVG-image document differs from a real document:
  //   - html gets no padding; body carries the 12px as a transparent BORDER.
  //     In the preview the html padding ring is invisible (the html/body
  //     background propagates to the canvas); here there is no propagation,
  //     so html padding would paint a visible ring. A body border takes the
  //     same space and, with the default background-clip:border-box, is
  //     painted with the body background -- so a body background fills the
  //     frame with no ring, and the content inset stays 12 + body padding
  //     (the border survives a source's `body{padding:0}` override, so an
  //     edge-to-edge source lands at the same offset as the preview).
  //   - html/body get height:100% so a short demo's body background does not
  //     leave a blank band at the bottom.
  // The reset is a stylesheet (not inline), placed before the source, so a
  // source's own `html`/`body`/`:root` rules win and its `<style>` after it
  // still overrides the base.
  // The frame's per-side inset, exported as snapshotInset: the body border
  // plus its padding below. A caller sizing an image must add 2 * this.
  const SNAPSHOT_INSET = 12 + 12;
  const SNAPSHOT_RESET =
    "html{margin:0;padding:0;height:100%;box-sizing:border-box;" +
    "background:" + CANVAS_BG + ";font-family:system-ui,sans-serif;overflow:hidden}" +
    "body{margin:0;border:12px solid transparent;padding:12px;height:100%;" +
    "box-sizing:border-box;display:flex;align-items:flex-start;" +
    "justify-content:center;font-family:system-ui,sans-serif}";

  // Variant used when the source itself sets an `html`/`:root` background.
  // Then the html background is the page color and the body may be shorter
  // than the frame, so html must stay the full frame height while body is
  // auto-height (min-height:0) and the 12px inset is split across html/body
  // exactly as the preview does -- otherwise the body would paint over the
  // html background below it.
  const SNAPSHOT_RESET_HTML_BG =
    "html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;overflow:hidden}" +
    "html{height:100%;box-sizing:border-box}" +
    "body{display:flex;align-items:flex-start;justify-content:center;min-height:0}";

  // Best-effort text scan of the source's <style> rules for an `html`/`:root`
  // selector with a background declaration. CSS is not parsed. A miss is
  // benign except for the rare source that sets BOTH an html and a body
  // background: the fill reset's full-height body would then cover the html
  // background below a short body. An html-only background still renders
  // (the transparent body lets it show through).
  const HTML_BG_RE = /(?:^|[\s{},])(?:html|:root)\b[^{}]*\{[^{}]*background/i;
  function sourceStylesHtmlBackground(fragment) {
    if (!fragment || typeof fragment.querySelectorAll !== "function") return false;
    const styles = fragment.querySelectorAll("style");
    for (let i = 0; i < styles.length; i++) {
      if (HTML_BG_RE.test(styles[i].textContent || "")) return true;
    }
    return false;
  }

  /* isXmlQName(name, declared) -> boolean.
   * A snapshot attribute name must be a legal XML QName: either an NCName, or
   * "prefix:local" where both parts are NCNames and the prefix is declared.
   * HTML happily accepts names XML rejects -- "@click" and ":class" have
   * illegal start characters, "v-bind:title" / "v-on:click" carry an
   * undeclared prefix -- and XMLSerializer copies them verbatim, so the whole
   * SVG then fails to parse. */
  function isXmlQName(name, declared) {
    const colon = name.indexOf(":");
    if (colon === -1) return XML_NCNAME_RE.test(name);
    const prefix = name.slice(0, colon);
    const local = name.slice(colon + 1);
    return local.indexOf(":") === -1 &&
      XML_NCNAME_RE.test(prefix) &&
      XML_NCNAME_RE.test(local) &&
      declared.has(prefix);
  }

  /* sanitizeXmlAttributes(root) -- drop attributes that are not legal XML
   * QNames from the adopted snapshot subtree before serialization. This is
   * lossless for rendering: the snapshot is inert (no script runs), so a
   * framework binding such as Alpine's `@click` or Vue's `:class` has no
   * visual effect anyway, while leaving it in makes the entire SVG fail to
   * load (Firefox hard-fails on the first bad name). Namespaced attributes
   * (xlink:*, xml:*, xmlns:*) are left for XMLSerializer to declare, and all
   * visually meaningful plain attributes (class, style, id, src, width,
   * height, href, ...) are NCNames and survive untouched. */
  function sanitizeXmlAttributes(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    const elements = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));
    // First pass: the prefixes this subtree declares, so a legitimate
    // "foo:bar" alongside "xmlns:foo" is kept.
    const declared = new Set(["xml", "xmlns"]);
    for (const el of elements) {
      const attrs = el.attributes;
      if (!attrs) continue;
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        if (a.namespaceURI === XMLNS_NS) {
          if (a.prefix === "xmlns") declared.add(a.localName);
          else if (a.localName === "xmlns") declared.add("");
        } else if (!a.namespaceURI) {
          if (a.name === "xmlns") declared.add("");
          else if (a.name.indexOf("xmlns:") === 0) declared.add(a.name.slice(6));
        }
      }
    }
    // Second pass: remove illegal names. Namespaced attributes are valid by
    // construction and skipped.
    for (const el of elements) {
      const attrs = el.attributes;
      if (!attrs) continue;
      const doomed = [];
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        if (a.namespaceURI) continue;
        if (!isXmlQName(a.name, declared)) doomed.push(a.name);
      }
      for (const name of doomed) el.removeAttribute(name);
    }
  }

  // Fallback intrinsic size when an SVG carries neither a usable viewBox
  // nor width/height attributes.
  const FALLBACK_W = 800;
  const FALLBACK_H = 600;

  const FALLBACK_NAME = "diagram.png";
  const EXT_RE = /\.[^./]+$/;

  // Inline sizing/transform are cleared on the clone: CSS beats a
  // presentation attribute, so a leftover `style="width:..."` (from the
  // lightbox or a renderer) would make the browser ignore the explicit
  // width/height attributes and Firefox would draw nothing.
  const STRIPPED_STYLE_PROPS = [
    "transform", "width", "height", "max-width", "max-height", "aspect-ratio",
  ];

  const NOTIFY_MS = 1500;
  const REVOKE_DELAY_MS = 1000;

  // Bound on the clipboard image write. Some Safari builds return a write
  // promise that never settles, which would hang the copy forever; on
  // timeout we fall through to the download fallback.
  const CLIPBOARD_TIMEOUT_MS = 3000;
  // Bound on the measuring iframe (see measureSnapshotHeight): a frame that
  // never loads must reject, not hang the copy.
  const MEASURE_TIMEOUT_MS = 5000;
  // Body children that render nothing, skipped when the measured height is
  // read (the snapshot source's own <style> lands in the body).
  const UNRENDERED_TAGS = ["STYLE", "LINK", "META", "SCRIPT", "TEMPLATE", "TITLE", "BASE"];

  const COPIED_MESSAGE = "Diagram copied as image";
  const DOWNLOAD_MESSAGE = "Image clipboard unavailable \u2014 downloaded PNG";
  const OPEN_TAB_MESSAGE =
    "Image clipboard unavailable \u2014 opened the PNG; right-click or long-press to save";
  const FAIL_MESSAGE = "Could not copy diagram image";

  // Set from each viewer:rendered event. Live-preview renders (split-view
  // editing) must not get buttons; the flag also gates the MutationObserver
  // callback, which fires after the event as the async renderers swap in
  // their containers.
  let livePreview = false;

  /* notify(message, cls?) -- the app's single toast. Guarded because
   * app.js (which owns NB.app.notify) loads after this module. */
  function notify(message, cls) {
    if (NB.app && NB.app.notify) NB.app.notify(message, NOTIFY_MS, cls);
  }

  /* pngName() -- "<note basename>.png", derived lazily at click time
   * because NB.viewer loads after this module. Falls back to
   * "diagram.png" when no file is open. */
  function pngName() {
    let path = "";
    try {
      if (NB.viewer && NB.viewer.getPath) path = NB.viewer.getPath() || "";
    } catch (_) { path = ""; }
    const base = path.split("/").pop();
    if (!base) return FALLBACK_NAME;
    const stem = base.replace(EXT_RE, "");
    return stem ? stem + ".png" : FALLBACK_NAME;
  }

  /* buildIcon() -- the inline 16px copy glyph (two overlapping rounded
   * rectangles), built with createElementNS so no markup is assigned via
   * innerHTML. */
  function buildIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + ICON_SIZE + " " + ICON_SIZE);
    svg.setAttribute("width", String(ICON_SIZE));
    svg.setAttribute("height", String(ICON_SIZE));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const back = document.createElementNS(SVG_NS, "rect");
    back.setAttribute("x", "2");
    back.setAttribute("y", "2");
    back.setAttribute("width", "9");
    back.setAttribute("height", "9");
    back.setAttribute("rx", "1.5");
    back.setAttribute("fill", "none");
    back.setAttribute("stroke", "currentColor");
    back.setAttribute("stroke-width", "1.5");
    const front = document.createElementNS(SVG_NS, "rect");
    front.setAttribute("x", "5");
    front.setAttribute("y", "5");
    front.setAttribute("width", "9");
    front.setAttribute("height", "9");
    front.setAttribute("rx", "1.5");
    front.setAttribute("fill", "none");
    front.setAttribute("stroke", "currentColor");
    front.setAttribute("stroke-width", "1.5");
    svg.append(back, front);
    return svg;
  }

  /* prepareClone(svgEl) -> { el, width, height }.
   * Clone the SVG, strip view-only sizing/transform, and pin explicit
   * width/height attributes (Firefox will not draw an SVG image that has
   * only a viewBox). Adds xmlns if the clone lacks it. */
  function prepareClone(svgEl) {
    const clone = svgEl.cloneNode(true);
    clone.removeAttribute("transform");
    if (clone.style && clone.style.removeProperty) {
      STRIPPED_STYLE_PROPS.forEach((prop) => clone.style.removeProperty(prop));
    }
    let width = 0;
    let height = 0;
    let hasViewBox = false;
    const vb = clone.getAttribute("viewBox");
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        width = parts[2];
        height = parts[3];
        hasViewBox = true;
      }
    }
    if (!hasViewBox) {
      width = parseFloat(clone.getAttribute("width")) || 0;
      height = parseFloat(clone.getAttribute("height")) || 0;
    }
    if (!(width > 0 && height > 0)) {
      width = FALLBACK_W;
      height = FALLBACK_H;
    }
    if (!hasViewBox) {
      clone.setAttribute("viewBox", "0 0 " + width + " " + height);
    }
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", SVG_NS);
    return { el: clone, width, height };
  }

  /* computeScale(width, height) -- DPR-aware scale, clamped so the
   * longest canvas side stays within MAX_CANVAS_DIM. */
  function computeScale(width, height) {
    let scale = Math.max(SCALE_FLOOR, window.devicePixelRatio || 1);
    const longest = Math.max(width, height);
    if (longest > 0 && longest * scale > MAX_CANVAS_DIM) {
      scale = MAX_CANVAS_DIM / longest;
    }
    return scale;
  }

  /* drawToBlob(img, width, height) -> Promise<Blob>. Paints a white
   * background then the image, and encodes PNG. */
  function drawToBlob(img, width, height) {
    return new Promise((resolve, reject) => {
      const scale = computeScale(width, height);
      const cw = Math.max(1, Math.round(width * scale));
      const ch = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext ? canvas.getContext("2d") : null;
      if (!ctx) { reject(new Error("Canvas 2D unavailable")); return; }
      ctx.fillStyle = CANVAS_BG;
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      if (typeof canvas.toBlob !== "function") {
        reject(new Error("canvas.toBlob unavailable"));
        return;
      }
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG encoding failed"));
      }, PNG_MIME);
    });
  }

  /* svgToPngBlob(svgEl) -> Promise<Blob>.
   * The executor runs synchronously, so the clone, serialization, URL and
   * <img> setup all happen before the caller's next line -- the clipboard
   * write can then be called inside the user gesture with this promise as
   * the ClipboardItem value (Safari requires that shape).
   *
   * URL rule, stated once for every SVG rasterize: a blob: URL for a plain
   * SVG, a data: URL whenever the SVG carries a <foreignObject>. Chromium
   * and WebKit taint the canvas for a foreignObject SVG loaded from blob:
   * (canvas.toBlob then throws SecurityError) while both allow the data:
   * form; plain SVGs stay on blob: because a data: URL has length limits.
   * If the chosen form fails to load, the other one is tried once. */
  function svgToPngBlob(svgEl) {
    return new Promise((resolve, reject) => {
      let objectUrl = null;
      const cleanup = () => {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      };
      let prepared;
      try {
        prepared = prepareClone(svgEl);
      } catch (err) {
        reject(err);
        return;
      }
      let xml;
      try {
        xml = new XMLSerializer().serializeToString(prepared.el);
      } catch (err) {
        reject(err);
        return;
      }
      const needsDataUrl = FOREIGN_OBJECT_RE.test(xml) ||
        !!prepared.el.querySelector("foreignObject");
      let dataTried = false;
      let blobTried = false;
      let img = null;
      const attempt = (asDataUrl) => {
        if (asDataUrl) dataTried = true;
        else blobTried = true;
        if (img) {
          img.onload = null;
          img.onerror = null;
        }
        cleanup();
        img = new Image();
        img.onload = () => {
          drawToBlob(img, prepared.width, prepared.height).then(
            (blob) => { cleanup(); resolve(blob); },
            (err) => { cleanup(); reject(err); },
          );
        };
        img.onerror = () => {
          if (!dataTried) { attempt(true); return; }
          if (!blobTried) { attempt(false); return; }
          cleanup();
          reject(new Error("SVG image failed to load"));
        };
        if (asDataUrl) {
          img.src = SVG_DATA_URL_PREFIX + encodeURIComponent(xml);
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([xml], { type: SVG_MIME }));
        img.src = objectUrl;
      };
      attempt(needsDataUrl);
    });
  }

  /* buildSnapshotDocument(source) -> { html, body }.
   * The source is parsed into an inert <template> first: template content is
   * not connected, so its <script>s never run and its images are never
   * fetched. It is then placed inside a real XHTML html>head>body document,
   * not a bare <div>. This matters: a source that styles `html`, `body`, or
   * `:root` (nearly every standalone demo) only matches if those elements
   * exist, and the preview puts the source in exactly such a body. The
   * source's own <html>/<head>/<body> wrappers were already dropped by the
   * HTML parse, so its <style>/<link>/<meta> and body content land flat
   * inside <body>, after the head reset -- matching the preview's cascade.
   *
   * Shared by the SVG build and the measuring iframe, so the reset and the
   * measured layout cannot drift apart.
   *
   * Serializing html/head/body into foreignObject content is valid XHTML and
   * is rendered (with CSS matching) by Chromium and Firefox. Attribute names
   * illegal in XML are stripped first (see sanitizeXmlAttributes) so a single
   * framework binding cannot break the load. */
  function buildSnapshotDocument(source) {
    const t = document.createElement("template");
    t.innerHTML = source;
    const html = document.createElementNS(XHTML_NS, "html");
    const head = document.createElementNS(XHTML_NS, "head");
    const style = document.createElementNS(XHTML_NS, "style");
    style.textContent = sourceStylesHtmlBackground(t.content)
      ? SNAPSHOT_RESET_HTML_BG
      : SNAPSHOT_RESET;
    head.appendChild(style);
    const body = document.createElementNS(XHTML_NS, "body");
    body.append(t.content);
    // HTML attribute names illegal in XML (@click, :class, v-bind:*, ...)
    // would poison the serialized SVG and make the whole load fail; drop them
    // (they have no visual effect here) while keeping every real attribute.
    sanitizeXmlAttributes(body);
    html.appendChild(head);
    html.appendChild(body);
    return { html, body };
  }

  /* buildHtmlSnapshotSvg(source, width, height) -> SVGSVGElement.
   * Wrap the snapshot document in an SVG <foreignObject> so it can go through
   * the same Image -> canvas path the SVG diagrams use. */
  function buildHtmlSnapshotSvg(source, width, height) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", "0");
    fo.setAttribute("y", "0");
    fo.setAttribute("width", String(width));
    fo.setAttribute("height", String(height));
    fo.appendChild(buildSnapshotDocument(source).html);
    svg.appendChild(fo);
    return svg;
  }

  /* measureSnapshotHeight(source, width) -> Promise<number>.
   * The snapshot's own layout does not always match the live box it came
   * from (a table's line-height, wrapping and hidden rows all re-flow), so
   * the caller that cannot supply a height gets the rendered one: the same
   * document, mounted in a hidden same-origin iframe at the target width.
   * Resolves to the content element's height plus the frame inset, or
   * rejects when the frame never loads (never hangs). */
  function measureSnapshotHeight(source, width) {
    return new Promise((resolve, reject) => {
      const doc = new XMLSerializer().serializeToString(
        buildSnapshotDocument(source).html);
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("tabindex", "-1");
      frame.style.cssText = "position:absolute;left:-20000px;top:0;border:0;" +
        "width:" + width + "px;height:10px;";
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        frame.remove();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Snapshot measure failed to load"));
      };
      const timer = setTimeout(fail, MEASURE_TIMEOUT_MS);
      frame.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        let height = 0;
        try {
          const body = frame.contentDocument && frame.contentDocument.body;
          // The source's own <style> sits in the body of the serialized
          // document, so the first RENDERED child is the content element.
          const content = body && Array.from(body.children).find((n) =>
            UNRENDERED_TAGS.indexOf(n.tagName) === -1);
          // scrollHeight is content + padding, so it is short by the border.
          height = (content && content.getBoundingClientRect().height) ||
            (body ? body.scrollHeight + SNAPSHOT_INSET : 0);
        } catch (_) { /* cross-origin or detached: reject below */ }
        cleanup();
        if (height > 0) resolve(Math.ceil(height) + 2 * SNAPSHOT_INSET);
        else reject(new Error("Snapshot measured no height"));
      };
      frame.onerror = fail;
      frame.srcdoc = doc;
      document.body.appendChild(frame);
    });
  }

  /* htmlToPngBlob(source, width, height) -> Promise<Blob>.
   * The executor runs synchronously, so the caller can hand this promise to
   * the clipboard write inside the user gesture (see copyBlobToPng). Rejects
   * on any failure -- invalid size, XML serialization, image load, or a
   * tainted canvas -- and a rejection surfaces the failure message; only a
   * clipboard-write failure/timeout falls back to the download.
   * `height` is optional: without it the snapshot is measured first, so the
   * frame always equals what is drawn (see measureSnapshotHeight).
   *
   * Loaded through the data: URL form that foreignObject content requires
   * (the URL rule is on svgToPngBlob): Chromium and WebKit taint the canvas
   * for the blob: form of such an SVG.
   *
   * This is a STATIC snapshot: no script runs (inert template + image
   * document), and an SVG loaded as an <img> renders in secure static mode,
   * which does not fetch external subresources (remote images, @import,
   * url(), webfonts). So a JS-rendered demo (canvas, DOM built by script)
   * copies as its pre-script markup, and remote images/fonts come out
   * blank/fallback. Local system fonts and inline data:/gradients work. */
  function htmlToPngBlob(source, width, height) {
    return new Promise((resolve, reject) => {
      if (!(width > 0)) {
        reject(new Error("Invalid snapshot size"));
        return;
      }
      const render = (h) => {
        if (!(h > 0)) {
          reject(new Error("Invalid snapshot size"));
          return;
        }
        let xml;
        try {
          const svg = buildHtmlSnapshotSvg(source, width, h);
          xml = new XMLSerializer().serializeToString(svg);
        } catch (err) {
          reject(err);
          return;
        }
        const img = new Image();
        img.onload = () => {
          drawToBlob(img, width, h).then(resolve, reject);
        };
        img.onerror = () => reject(new Error("HTML snapshot failed to load"));
        img.src = SVG_DATA_URL_PREFIX + encodeURIComponent(xml);
      };
      if (height > 0) {
        render(height);
        return;
      }
      measureSnapshotHeight(source, width).then(render, reject);
    });
  }

  /* clipboardAvailable() -- the modern image-clipboard path is gated on a
   * secure context, the async Clipboard API, and ClipboardItem. */
  function clipboardAvailable() {
    return !!(window.isSecureContext && navigator.clipboard &&
      navigator.clipboard.write && typeof ClipboardItem !== "undefined");
  }

  /* openInTab(url) -- last-resort fallback when <a download> is a no-op or
   * throws (Safari/iOS often ignores a download for a blob URL). Opens the
   * blob in a new tab so the user can right-click / long-press to save or
   * copy it. Returns false when the browser blocks the popup. */
  function openInTab(url) {
    try {
      return !!window.open(url, "_blank");
    } catch (_) {
      return false;
    }
  }

  /* downloadBlob(blob, name) -> "download" | "opened" | "failed".
   * The anchor path is the happy case (Firefox downloads fine). If it
   * throws, open the PNG in a new tab as the last resort. The object URL is
   * always kept alive for REVOKE_DELAY_MS so the save dialog or the new tab
   * can read the blob before it is revoked. */
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    let outcome = "download";
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name || FALLBACK_NAME;
      a.rel = "noopener";
      document.body.appendChild(a);   // Firefox needs the link in the DOM
      try {
        a.click();
      } finally {
        a.remove();
      }
    } catch (_) {
      outcome = openInTab(url) ? "opened" : "failed";
    }
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    return outcome;
  }

  /* copyBlobToPng(blobPromise, name, message, failMessage) -- shared tail of
   * both image-copy paths: hand the PNG blob to the system clipboard, or
   * fall back to the download (then a new tab) when the clipboard image
   * write is unavailable, fails, or never settles. Exactly one toast fires
   * per outcome; `message` overrides the success toast and `failMessage`
   * the failure toast for a caller with its own wording (the table-view
   * action); they default to COPIED_MESSAGE and FAIL_MESSAGE.
   *
   * blobPromise must already exist. The caller creates it synchronously
   * inside the click handler, so the write below can happen inside the user
   * gesture (Safari); only the await is bounded. The no-op catch swallows a
   * late rejection after we have already timed out and moved on. */
  async function copyBlobToPng(blobPromise, name, message, failMessage) {
    const failure = failMessage || FAIL_MESSAGE;
    // A failed rasterize must not surface as an unhandled rejection (the
    // clipboard write and the fallback both attach later); the await below
    // still sees the same rejection and reports it.
    blobPromise.catch(() => {});
    if (clipboardAvailable()) {
      const writePromise = navigator.clipboard.write([
        new ClipboardItem({ [PNG_MIME]: blobPromise }),
      ]);
      writePromise.catch(() => {});
      let clipTimer = null;
      const timeout = new Promise((resolve) => {
        clipTimer = setTimeout(() => resolve("timeout"), CLIPBOARD_TIMEOUT_MS);
      });
      const outcome = await Promise.race([
        writePromise.then(() => "ok", () => "fail"),
        timeout,
      ]);
      clearTimeout(clipTimer);
      if (outcome === "ok") {
        notify(message || COPIED_MESSAGE);
        return;
      }
      // "fail" or "timeout": fall through to the download fallback. A
      // rejected rasterize is NOT recovered here -- it rejects the await
      // below and surfaces the failure message instead.
    }

    try {
      const blob = await blobPromise;
      const outcome = downloadBlob(blob, name);
      if (outcome === "opened") notify(OPEN_TAB_MESSAGE);
      else if (outcome === "failed") notify(failure, "warn");
      else notify(DOWNLOAD_MESSAGE);
    } catch (_) {
      notify(failure, "warn");
    }
  }

  /* copySvgToPng(svgEl, { name, message, failMessage }) -- rasterize an SVG
   * diagram to a PNG and copy it, falling back to the download path. The
   * blob promise is built synchronously, before any await (see
   * copyBlobToPng). */
  async function copySvgToPng(svgEl, opts) {
    const name = (opts && opts.name) || FALLBACK_NAME;
    if (!svgEl) {
      notify((opts && opts.failMessage) || FAIL_MESSAGE, "warn");
      return;
    }
    const blobPromise = svgToPngBlob(svgEl);
    return copyBlobToPng(blobPromise, name, opts && opts.message,
      opts && opts.failMessage);
  }

  /* copyHtmlToPng(source, { name, width, height, message, failMessage }) --
   * rasterize an html-live card's stored source to a PNG and copy it, with
   * the same download fallback. Also the preview table-view's Copy image
   * path, which passes its own name and both toast messages. The blob
   * promise is built synchronously, before any await (see copyBlobToPng). */
  async function copyHtmlToPng(source, opts) {
    const name = (opts && opts.name) || FALLBACK_NAME;
    if (!source) {
      notify((opts && opts.failMessage) || FAIL_MESSAGE, "warn");
      return;
    }
    const width = opts && opts.width;
    const height = opts && opts.height;
    const blobPromise = htmlToPngBlob(source, width, height);
    return copyBlobToPng(blobPromise, name, opts && opts.message,
      opts && opts.failMessage);
  }

  /* htmlPreviewSize(container) -> { width, height }.
   * The snapshot matches the preview frame's on-screen box. jsdom reports
   * zero for every rect, so fall back to the card box and then to the fixed
   * fallback; round up so a fractional layout never yields a 0px
   * dimension. */
  function htmlPreviewSize(container) {
    const measure = (el) => {
      if (!el) return { width: 0, height: 0 };
      const r = el.getBoundingClientRect();
      return { width: r && r.width, height: r && r.height };
    };
    let { width, height } = measure(container.querySelector("iframe.htmlpreview-frame"));
    if (!(width > 0 && height > 0)) {
      ({ width, height } = measure(container));
    }
    width = Math.ceil(width);
    height = Math.ceil(height);
    if (!(width > 0 && height > 0)) {
      width = FALLBACK_W;
      height = FALLBACK_H;
    }
    return { width, height };
  }

  /* --- code block snapshot ---------------------------------------- */

  /* One computed-style value of a node, or "". jsdom and detached nodes
   * answer "", so every caller has a fallback. Pseudo-elements are never
   * queried: the live language label is a ::after, and a pseudo computed
   * style is not reliably readable across engines, so its metrics come from
   * the pre and the constants below instead. */
  function styleValue(node, prop) {
    if (!node || !window.getComputedStyle) return "";
    const cs = window.getComputedStyle(node);
    return (cs && cs.getPropertyValue(prop)) || "";
  }

  /* A style attribute string from the pairs that have a value, so a
   * property the engine reports as "" never becomes an empty declaration. */
  function styleText(pairs) {
    return pairs
      .filter((pair) => pair[1])
      .map((pair) => pair[0] + ":" + pair[1])
      .join(";");
  }

  /* codeBlockSnapshot(pre) -> { source, width } or null.
   * The PNG snapshot of a rendered code card: the clone carries the card's
   * look as inline styles (the app stylesheet is not present in the
   * snapshot), every highlight span keeps its own colours, both copy
   * buttons and any transient selection chrome are dropped, and the fence's
   * language label -- a ::after live, which cannot be cloned -- is
   * recreated as a real span. The clone never enters the document. */
  function codeBlockSnapshot(pre) {
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    if (!(width > 0)) return null;
    const clone = pre.cloneNode(true);
    clone.querySelectorAll("." + BUTTON_BASE_CLASS).forEach((n) => n.remove());
    CODE_CHROME_CLASSES.forEach((cls) => {
      clone.querySelectorAll("." + cls).forEach((n) => n.classList.remove(cls));
    });
    const borderWidth = styleValue(pre, "border-top-width");
    const borderStyle = styleValue(pre, "border-top-style");
    const borderColor = styleValue(pre, "border-top-color");
    clone.setAttribute("style", styleText([
      ["position", "relative"],
      ["box-sizing", "border-box"],
      // A <pre> is a flex item in the snapshot body, so its natural width is
      // max-content; it must fill the measured frame instead.
      ["width", "100%"],
      // The card's own margin is page flow between blocks, not part of the
      // image: the frame is sized to the card, so it starts at the inset.
      ["margin", "0"],
      ["background-color", styleValue(pre, "background-color")],
      ["border", (borderWidth && borderStyle && borderColor)
        ? borderWidth + " " + borderStyle + " " + borderColor : ""],
      ["border-radius", styleValue(pre, "border-radius")],
      ["padding", styleValue(pre, "padding")],
      ["font-family", styleValue(pre, "font-family")],
      ["font-size", styleValue(pre, "font-size")],
      ["line-height", styleValue(pre, "line-height")],
      ["color", styleValue(pre, "color")],
      ["white-space", styleValue(pre, "white-space")],
      ["overflow-wrap", styleValue(pre, "overflow-wrap")],
    ]));
    // Highlighting without the app stylesheet: each element of the live
    // <code> subtree hands its own text colour, non-transparent background,
    // weight, style and decoration to the matching clone element. Nothing
    // else is copied -- no layout, no padding, no font size.
    const liveCode = pre.querySelector("code");
    const cloneCode = clone.querySelector("code");
    if (liveCode && cloneCode) {
      // The <code> element carries the block's own .88em / line-height rules
      // AND the highlight theme's block box (display + 1em padding in the
      // hljs themes), so its box metrics are copied too: without them the
      // text lays out at the pre's size and the block's height is wrong.
      const codeBox = styleText([
        ["display", styleValue(liveCode, "display")],
        ["padding", styleValue(liveCode, "padding")],
        ["font-family", styleValue(liveCode, "font-family")],
        ["font-size", styleValue(liveCode, "font-size")],
        ["line-height", styleValue(liveCode, "line-height")],
      ]);
      if (codeBox) cloneCode.setAttribute("style", codeBox);
      const liveEls = [liveCode].concat(Array.from(liveCode.querySelectorAll("*")));
      const cloneEls = [cloneCode].concat(Array.from(cloneCode.querySelectorAll("*")));
      liveEls.forEach((src, i) => {
        const dst = cloneEls[i];
        if (!dst) return;
        const decls = [
          ["color", styleValue(src, "color")],
          ["font-weight", styleValue(src, "font-weight")],
          ["font-style", styleValue(src, "font-style")],
          ["text-decoration-line", styleValue(src, "text-decoration-line")],
        ];
        const bg = styleValue(src, "background-color");
        if (bg && !TRANSPARENT_COLOR_RE.test(bg)) decls.push(["background-color", bg]);
        const existing = dst.getAttribute("style") || "";
        const extra = styleText(decls);
        if (extra) {
          dst.setAttribute("style",
            existing ? existing.replace(/;$/, "") + ";" + extra : extra);
        }
      });
    }
    // Recreate the language label. The live one is generated content, so it
    // cannot be cloned and its ::after metrics are not portably readable:
    // the label is rebuilt from the pre's own box (padding-left is the same
    // 16px/14px inset the live rule uses, and .72em of the pre's font-size)
    // with the constants above. Colour is the pre's text colour -- the live
    // --fg-muted has no element to sample -- which stays legible on the
    // card's own background.
    const lang = (pre.dataset && pre.dataset.fenceLang) || "";
    if (lang) {
      const preFont = parseFloat(styleValue(pre, "font-size"));
      const label = document.createElement("span");
      label.className = "nb-code-lang";
      label.textContent = lang;
      label.setAttribute("aria-hidden", "true");
      label.setAttribute("style", styleText([
        ["position", "absolute"],
        ["left", styleValue(pre, "padding-left") || "16px"],
        ["top", CODE_LABEL_TOP],
        ["font-family", CODE_LABEL_FONT_STACK],
        ["font-size", preFont > 0 ? (preFont * CODE_LABEL_SCALE) + "px" : ""],
        ["line-height", String(CODE_LABEL_LINE_HEIGHT)],
        ["color", styleValue(pre, "color")],
        ["max-width", "calc(100% - " + CODE_LABEL_MAX_GUARD + "px)"],
        ["white-space", "nowrap"],
        ["overflow", "hidden"],
        ["pointer-events", "none"],
        ["z-index", "0"],
      ]));
      clone.appendChild(label);
    }
    return { source: clone.outerHTML, width: width + 2 * SNAPSHOT_INSET };
  }

  /* copyCodeToPng(pre) -- copy the rendered code card as a PNG through the
   * shared rasterizer. Only the width is supplied; copy-image measures the
   * snapshot height itself. Returns the snapshot, or false and a toast. */
  function copyCodeToPng(pre) {
    const snap = codeBlockSnapshot(pre);
    if (!snap || !NB.copyButton || !NB.copyButton.copyHtmlToPng) {
      notify(CODE_IMAGE_FAIL_MSG, "warn");
      return false;
    }
    NB.copyButton.copyHtmlToPng(snap.source, {
      name: CODE_IMAGE_NAME,
      width: snap.width,
      message: CODE_IMAGE_DONE_MSG,
      failMessage: CODE_IMAGE_FAIL_MSG,
    });
    return snap;
  }

  /* --- button injection ------------------------------------------- */

  /* sourceTextOf(targetEl) -- the copyable source of a block, with any
   * copy-button chrome stripped. The button is a child of the target, so a
   * plain textContent would include its "Copy" label (and, if a button-like
   * node ever sat inside the target, its icon). Clone, drop the
   * .code-copy-btn descendants, then read the text. */
  function sourceTextOf(targetEl) {
    const clone = targetEl.cloneNode(true);
    clone.querySelectorAll("." + BUTTON_BASE_CLASS).forEach((el) => el.remove());
    return clone.textContent;
  }

  /* attachTextCopy(targetEl, getText) -- wire a text "Copy" button into
   * targetEl. This is the single owner of the source-block copy behavior
   * (viewer.js and the AI panel delegate their <pre> buttons here).
   * Byte-for-byte the same UX: "Copy" -> "Copied!" + .copied for a short
   * hold, plus a toast. Idempotent: a target that already has a TEXT
   * .code-copy-btn is skipped -- the image and preview buttons share that
   * base class, so neither may count.
   *
   * getText, when supplied, is the source getter and is used unchanged
   * (the katex container passes a dataset-source getter). With no getText,
   * the sanitized sourceTextOf default is used so the button never copies
   * its own label. On a fence the image button is inserted before an
   * existing image button (or appended), so the text action always comes
   * first in the DOM. */
  function attachTextCopy(targetEl, getText) {
    if (!targetEl) return;
    if (targetEl.querySelector(
      "." + BUTTON_BASE_CLASS + ":not(." + IMAGE_BUTTON_CLASS +
      "):not(." + PREVIEW_BUTTON_CLASS + ")")) return;
    const read = (typeof getText === "function")
      ? getText
      : () => sourceTextOf(targetEl);
    const btn = buildTextButton(read);
    const imageBtn = targetEl.querySelector("." + IMAGE_BUTTON_CLASS);
    if (imageBtn) targetEl.insertBefore(btn, imageBtn);
    else targetEl.appendChild(btn);
  }

  /* attachCodeImageCopy(pre) -- wire the PNG action into a rendered fenced
   * code block, next to the text Copy. Idempotent, and only for a fence (a
   * <pre> with a direct <code> child); plugin error boxes keep their single
   * text button. */
  function attachCodeImageCopy(pre) {
    if (!pre) return;
    if (pre.querySelector("." + IMAGE_BUTTON_CLASS)) return;
    const isFence = Array.from(pre.children)
      .some((node) => node.tagName === "CODE");
    if (!isFence) return;
    pre.appendChild(buildImageButton(() => copyCodeToPng(pre), CODE_IMAGE_LABEL));
  }

  function buildTextButton(getText) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON_BASE_CLASS;
    btn.textContent = TEXT_BUTTON_LABEL;
    btn.setAttribute("aria-label", TEXT_BUTTON_ARIA);
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // textContent / a stored dataset string strips the highlight <span>s;
      // the raw text matches the original markdown source.
      const text = getText();
      try {
        if (NB.app && NB.app.copyToClipboard) {
          await NB.app.copyToClipboard(text);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error("No clipboard API available");
        }
        // Flip the button to "Copied!" for a short moment; the notify toast
        // is the canonical feedback, the flip keeps it anchored to the
        // affordance the user just clicked.
        const prev = btn.textContent;
        btn.textContent = COPIED_LABEL;
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove("copied");
        }, COPIED_HOLD_MS);
        if (NB.app && NB.app.notify) NB.app.notify(TEXT_COPIED_MESSAGE);
      } catch (err) {
        if (NB.app && NB.app.notify) NB.app.notify(TEXT_FAIL_MESSAGE, TEXT_FAIL_MS);
        else console.error("copy failed", err);
      }
    });
    return btn;
  }

  /* attachImageCopy(container) -- wire the PNG "Copy image" button into a
   * rendered SVG diagram container. Idempotent, and skipped when the
   * container holds no <svg> (the button's own icon would otherwise satisfy
   * a later query). */
  function attachImageCopy(container) {
    if (!container || container.querySelector("." + IMAGE_BUTTON_CLASS)) return;
    if (!container.querySelector("svg")) return;
    container.appendChild(buildImageButton(() => {
      // The diagram lives in the sizing wrapper; prefer it so a
      // copy-button icon (also an <svg>) can never be mistaken for the
      // figure.
      const diagram = container.querySelector(".nb-figure-viewport > svg") ||
        container.querySelector("svg");
      copySvgToPng(diagram, { name: pngName() });
    }));
  }

  /* attachHtmlImageCopy(container) -- wire the same icon button into an
   * html-live card, rasterizing the stored fenced source instead of an
   * <svg>. Skipped when the card carries no source. Idempotent. The source
   * is read at click time (like the katex path) so a later re-render of the
   * card is picked up. */
  function attachHtmlImageCopy(container) {
    if (!container || container.querySelector("." + IMAGE_BUTTON_CLASS)) return;
    if (!container.dataset.htmlpreviewSource) return;
    container.appendChild(buildImageButton(() => {
      const source = container.dataset.htmlpreviewSource || "";
      const size = htmlPreviewSize(container);
      copyHtmlToPng(source, { name: pngName(), width: size.width, height: size.height });
    }));
  }

  /* buildImageButton(onClick) -- the shared square icon button. Base +
   * modifier class: the shared chrome plus the icon tweak, and the
   * .code-copy-btn class hybrid.js strips from the note on save. */
  function buildImageButton(onClick, label) {
    const name = label || IMAGE_BUTTON_LABEL;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON_BASE_CLASS + " " + IMAGE_BUTTON_CLASS;
    btn.title = name;
    btn.setAttribute("aria-label", name);
    btn.appendChild(buildIcon());
    btn.addEventListener("click", (e) => {
      // Both are required: preventDefault stops the anchor/button default,
      // stopPropagation keeps the card's own handlers (hybrid click-to-edit
      // above all) from seeing a click on the button.
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /* --- block actions ---------------------------------------------- */

  /* The pair for a fenced code block: text Copy (the sanitized source) and,
   * on a real fence only, PNG Copy image. A plugin error box holds a
   * text-only <pre> and keeps the single text button. */
  function attachFenceActions(pre) {
    attachTextCopy(pre);
    attachCodeImageCopy(pre);
  }

  /* The pair for a rendered card, per its BLOCK_KINDS row. The text action
   * copies the AUTHORED fence source from the dataset, never the rendered
   * markup; it is only offered when a source was stored, so a failed render
   * cannot yield a "Copied!" toast for an empty string. A diagram card also
   * gets the full-screen Preview action from lightbox.js, inserted before
   * the pair so the DOM order matches the visual order. */
  function attachCardActions(card, kind) {
    // Preview comes first so the DOM order matches the visual left-to-right
    // order (Preview at the card's left edge, the copy pair at its right).
    if (NB.lightbox && typeof NB.lightbox.previewButtonFor === "function") {
      const preview = NB.lightbox.previewButtonFor(card);
      if (preview) card.appendChild(preview);
    }
    const read = () => card.dataset[kind.dataset] || "";
    if (read()) attachTextCopy(card, read);
    if (kind.image === "svg") attachImageCopy(card);
    else if (kind.image === "html") attachHtmlImageCopy(card);
  }

  /* attachBlockActions(host) -- the single entry point: wire the copy-action
   * pair into every rendered block under `host` (the <pre> fences and every
   * card kind). Idempotent, so a re-render or a mutation-observer pass can
   * call it freely. viewer.js and the AI panel delegate to this. */
  function attachBlockActions(host) {
    if (!host || host.nodeType !== 1) return;
    if (host.tagName === "PRE") attachFenceActions(host);
    host.querySelectorAll("pre").forEach(attachFenceActions);
    BLOCK_KINDS.forEach((kind) => {
      if (host.matches && host.matches(kind.selector)) attachCardActions(host, kind);
      host.querySelectorAll(kind.selector).forEach((card) => {
        attachCardActions(card, kind);
      });
    });
  }

  /* removeAll() -- drop the buttons THIS module injected: every image button
   * (cards and code fences) and every text button that is NOT inside a <pre>.
   * A fence's text button survives, as before: hybrid.js strips both button
   * kinds from the note when it serializes, and a cancelled edit must find
   * its text button again. */
  function removeAll() {
    const host = document.getElementById(VIEWER_CONTENT_ID);
    if (!host) return;
    host.querySelectorAll("." + IMAGE_BUTTON_CLASS).forEach((btn) => btn.remove());
    host.querySelectorAll(
      "." + BUTTON_BASE_CLASS + ":not(." + IMAGE_BUTTON_CLASS + ")")
      .forEach((btn) => {
        if (btn.closest("pre")) return;
        btn.remove();
      });
  }

  /* onRendered(ev) -- every render updates livePreview. A live-preview
   * render drops the buttons and injects nothing; a real render rescans.
   * The MutationObserver callback below reads the same flag, so the
   * containers the async renderers swap in later obey it too. */
  function onRendered(ev) {
    livePreview = !!(ev && ev.live);
    if (livePreview) { removeAll(); return; }
    scan();
  }

  /* scan(root) -- inject the pair into every rendered block under `root`
   * (through attachBlockActions). Skipped in hybrid mode and in the live
   * preview; the buttons are view-only chrome and must never enter the
   * editable / serialized DOM. `root` defaults to the note viewer; a caller
   * passing another reading root (the AI panel's chat log) covers blocks the
   * viewer-scoped MutationObserver cannot see. */
  function scan(root) {
    const viewerHost = document.getElementById(VIEWER_CONTENT_ID);
    const host = (root && root.nodeType === 1) ? root : viewerHost;
    if (!host) return;
    if (host === viewerHost) {
      if (livePreview) return;
      if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) return;
    }
    attachBlockActions(host);
  }

  function boot() {
    const host = document.getElementById(VIEWER_CONTENT_ID);
    if (!host) return;

    if (typeof window.MutationObserver === "function") {
      // scan() reads an optional render root as its first argument, so the
      // observer's records array and the event payloads below are wrapped:
      // the default root stays the viewer.
      new MutationObserver(() => scan()).observe(host, { childList: true, subtree: true });
    }
    NB.evt.on("viewer:rendered", onRendered);
    NB.evt.on("hybrid:will-enter", removeAll);
    NB.evt.on("hybrid:entered", removeAll);
    NB.evt.on("hybrid:exited", () => scan());
    scan();
  }

  NB.copyButton = {
    attachTextCopy, attachImageCopy, attachHtmlImageCopy, attachCodeImageCopy,
    attachBlockActions,
    copySvgToPng, copyHtmlToPng, codeBlockSnapshot, copyCodeToPng,
    scan,
    snapshotInset: SNAPSHOT_INSET,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
