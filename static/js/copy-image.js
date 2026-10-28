/* copy-image.js -- the single owner of the "Copy" affordance on every
 * rendered code-block variant in the viewer.
 *
 * Two kinds of button, one shared look:
 *   - Source blocks (plain <pre> code, katex equations) get a text button
 *     that copies the block's source string. The <pre> buttons are wired
 *     by viewer.js through attachTextCopy; the katex container is wired
 *     here.
 *   - The image-producing blocks (mermaid, wavedrom, graphviz, and the
 *     html-live card) get an icon button that rasterizes the block to PNG
 *     and writes it to the system clipboard, so the user can paste it into
 *     another app. For an html-live card the rasterized source is the
 *     stored fenced HTML + CSS, snapshotted inertly into a real
 *     html>body document so `html`/`body` page styles apply. Static-snapshot
 *     limits (see htmlToPngBlob): scripts do not run, and SVG-image secure
 *     static mode blocks external subresources (images, @import, url(),
 *     web fonts), so script/canvas/animation output and remote assets are
 *     not captured.
 *     When the clipboard image write is unavailable (insecure context,
 *     unsupported browser, denied permission, or a failed rasterize), it
 *     downloads the PNG instead.
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
  // SVG diagrams: an image button (rasterize the <svg> to PNG).
  const IMAGE_CONTAINER_SELECTOR = ".mermaid-container, .wavedrom-container, .viz-container, .svg-container";
  // Katex: a text button (copy the stored LaTeX source).
  const KATEX_CONTAINER_SELECTOR = ".katex-container";
  // Live HTML previews: an image button (rasterize the stored source).
  const HTMLPREVIEW_CONTAINER_SELECTOR = ".htmlpreview-card";
  // Used only to remove this module's text buttons; injection is gated on
  // the source string, not on this selector.
  const TEXT_CONTAINER_SELECTOR = KATEX_CONTAINER_SELECTOR;

  // The text button and the image button share the base class so they style
  // identically and hybrid.js strips both from the note on save (it skips
  // .code-copy-btn). The image button adds its own modifier for the icon.
  const BUTTON_BASE_CLASS = "code-copy-btn";
  const IMAGE_BUTTON_CLASS = "nb-copy-img-btn";
  const IMAGE_BUTTON_LABEL = "Copy image";

  const TEXT_BUTTON_LABEL = "Copy";
  const TEXT_BUTTON_ARIA = "Copy code to clipboard";
  const COPIED_LABEL = "Copied!";
  const COPIED_HOLD_MS = 1200;
  const TEXT_COPIED_MESSAGE = "Copied to clipboard";
  const TEXT_FAIL_MESSAGE = "Copy failed";
  const TEXT_FAIL_MS = 2200;

  const SVG_NS = "http://www.w3.org/2000/svg";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const SVG_MIME = "image/svg+xml;charset=utf-8";
  // Data-URL prefix for the html-live snapshot. Chromium/WebKit taint the
  // canvas for an SVG-with-foreignObject loaded from blob:, so this path
  // must not use a blob URL.
  const SVG_DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";
  const PNG_MIME = "image/png";

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
   * The executor runs synchronously, so the clone, serialization, object
   * URL, and <img> setup all happen before the caller's next line -- the
   * clipboard write can then be called inside the user gesture with this
   * promise as the ClipboardItem value (Safari requires that shape). */
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
      const svgBlob = new Blob([xml], { type: SVG_MIME });
      objectUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        drawToBlob(img, prepared.width, prepared.height).then(
          (blob) => { cleanup(); resolve(blob); },
          (err) => { cleanup(); reject(err); },
        );
      };
      img.onerror = () => { cleanup(); reject(new Error("SVG image failed to load")); };
      img.src = objectUrl;
    });
  }

  /* buildHtmlSnapshotSvg(source, width, height) -> SVGSVGElement.
   * Wrap the card's stored source in an SVG <foreignObject> so it can go
   * through the same Image -> canvas path the SVG diagrams use.
   *
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
   * Serializing html/head/body into foreignObject content is valid XHTML and
   * is rendered (with CSS matching) by Chromium and Firefox. Attribute names
   * illegal in XML are stripped first (see sanitizeXmlAttributes) so a single
   * framework binding cannot break the load. */
  function buildHtmlSnapshotSvg(source, width, height) {
    const t = document.createElement("template");
    t.innerHTML = source;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    const fo = document.createElementNS(SVG_NS, "foreignObject");
    fo.setAttribute("x", "0");
    fo.setAttribute("y", "0");
    fo.setAttribute("width", String(width));
    fo.setAttribute("height", String(height));

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

    fo.appendChild(html);
    svg.appendChild(fo);
    return svg;
  }

  /* htmlToPngBlob(source, width, height) -> Promise<Blob>.
   * The executor runs synchronously, so the caller can hand this promise to
   * the clipboard write inside the user gesture (see copyBlobToPng). Rejects
   * on any failure -- invalid size, XML serialization, image load, or a
   * tainted canvas -- and a rejection surfaces the failure message; only a
   * clipboard-write failure/timeout falls back to the download.
   *
   * Loaded from a data: URL, NOT a blob: URL: Chromium and WebKit taint the
   * canvas for an SVG containing <foreignObject> loaded from blob: (so
   * canvas.toBlob throws SecurityError), while both allow the data-URL form.
   * svgToPngBlob stays on blob: -- those diagrams emit no foreignObject.
   *
   * This is a STATIC snapshot: no script runs (inert template + image
   * document), and an SVG loaded as an <img> renders in secure static mode,
   * which does not fetch external subresources (remote images, @import,
   * url(), webfonts). So a JS-rendered demo (canvas, DOM built by script)
   * copies as its pre-script markup, and remote images/fonts come out
   * blank/fallback. Local system fonts and inline data:/gradients work. */
  function htmlToPngBlob(source, width, height) {
    return new Promise((resolve, reject) => {
      if (!(width > 0 && height > 0)) {
        reject(new Error("Invalid snapshot size"));
        return;
      }
      let xml;
      try {
        const svg = buildHtmlSnapshotSvg(source, width, height);
        xml = new XMLSerializer().serializeToString(svg);
      } catch (err) {
        reject(err);
        return;
      }
      const img = new Image();
      img.onload = () => {
        drawToBlob(img, width, height).then(resolve, reject);
      };
      img.onerror = () => reject(new Error("HTML snapshot failed to load"));
      img.src = SVG_DATA_URL_PREFIX + encodeURIComponent(xml);
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

  /* copyBlobToPng(blobPromise, name) -- shared tail of both image-copy
   * paths: hand the PNG blob to the system clipboard, or fall back to the
   * download (then a new tab) when the clipboard image write is
   * unavailable, fails, or never settles. Exactly one toast fires per
   * outcome.
   *
   * blobPromise must already exist. The caller creates it synchronously
   * inside the click handler, so the write below can happen inside the user
   * gesture (Safari); only the await is bounded. The no-op catch swallows a
   * late rejection after we have already timed out and moved on. */
  async function copyBlobToPng(blobPromise, name) {
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
        notify(COPIED_MESSAGE);
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
      else if (outcome === "failed") notify(FAIL_MESSAGE, "warn");
      else notify(DOWNLOAD_MESSAGE);
    } catch (_) {
      notify(FAIL_MESSAGE, "warn");
    }
  }

  /* copySvgToPng(svgEl, { name }) -- rasterize an SVG diagram to a PNG and
   * copy it, falling back to the download path. The blob promise is built
   * synchronously, before any await (see copyBlobToPng). */
  async function copySvgToPng(svgEl, opts) {
    const name = (opts && opts.name) || FALLBACK_NAME;
    if (!svgEl) { notify(FAIL_MESSAGE, "warn"); return; }
    const blobPromise = svgToPngBlob(svgEl);
    return copyBlobToPng(blobPromise, name);
  }

  /* copyHtmlToPng(source, { name, width, height }) -- rasterize an
   * html-live card's stored source to a PNG and copy it, with the same
   * download fallback. The blob promise is built synchronously, before any
   * await (see copyBlobToPng). */
  async function copyHtmlToPng(source, opts) {
    const name = (opts && opts.name) || FALLBACK_NAME;
    if (!source) { notify(FAIL_MESSAGE, "warn"); return; }
    const width = opts && opts.width;
    const height = opts && opts.height;
    const blobPromise = htmlToPngBlob(source, width, height);
    return copyBlobToPng(blobPromise, name);
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
   * hold, plus a toast. Idempotent: a target that already has a
   * .code-copy-btn is skipped.
   *
   * getText, when supplied, is the source getter and is used unchanged
   * (the katex container passes a dataset-source getter). With no getText,
   * the sanitized sourceTextOf default is used so the button never copies
   * its own label. */
  function attachTextCopy(targetEl, getText) {
    if (!targetEl) return;
    if (targetEl.querySelector("." + BUTTON_BASE_CLASS)) return;
    const read = (typeof getText === "function")
      ? getText
      : () => sourceTextOf(targetEl);
    targetEl.appendChild(buildTextButton(read));
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
  function buildImageButton(onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BUTTON_BASE_CLASS + " " + IMAGE_BUTTON_CLASS;
    btn.title = IMAGE_BUTTON_LABEL;
    btn.setAttribute("aria-label", IMAGE_BUTTON_LABEL);
    btn.appendChild(buildIcon());
    btn.addEventListener("click", (e) => {
      // Both are required: preventDefault stops the anchor/button default,
      // stopPropagation stops the delegated lightbox click handler on
      // #viewer-content from also opening the full-screen overlay.
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /* removeAll() -- drop the buttons THIS module injected (image buttons on
   * the diagram containers and the html-live cards, text buttons on the
   * katex containers). The <pre> buttons belong to viewer.js and are left
   * alone. */
  function removeAll() {
    const host = document.getElementById(VIEWER_CONTENT_ID);
    if (!host) return;
    host.querySelectorAll("." + IMAGE_BUTTON_CLASS).forEach((btn) => btn.remove());
    host.querySelectorAll(TEXT_CONTAINER_SELECTOR).forEach((container) => {
      const btn = container.querySelector("." + BUTTON_BASE_CLASS);
      if (btn) btn.remove();
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

  /* scan() -- inject the right button into every rendered block: an image
   * button into each SVG diagram container and each html-live card, a text
   * button into the katex container. Skipped in hybrid mode and in the live
   * preview; the buttons are view-only chrome and must never enter the
   * editable / serialized DOM. */
  function scan() {
    if (livePreview) return;
    if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) return;
    const host = document.getElementById(VIEWER_CONTENT_ID);
    if (!host) return;
    host.querySelectorAll(IMAGE_CONTAINER_SELECTOR).forEach(attachImageCopy);
    host.querySelectorAll(HTMLPREVIEW_CONTAINER_SELECTOR).forEach(attachHtmlImageCopy);
    // Only offer the text button when there is a source to copy, so a
    // render that stores nothing never yields a "Copied!" toast for an
    // empty string.
    host.querySelectorAll(KATEX_CONTAINER_SELECTOR).forEach((container) => {
      if (!container.dataset.katexSource) return;
      attachTextCopy(container, () => container.dataset.katexSource || "");
    });
  }

  function boot() {
    const host = document.getElementById(VIEWER_CONTENT_ID);
    if (!host) return;

    if (typeof window.MutationObserver === "function") {
      new MutationObserver(scan).observe(host, { childList: true, subtree: true });
    }
    NB.evt.on("viewer:rendered", onRendered);
    NB.evt.on("hybrid:will-enter", removeAll);
    NB.evt.on("hybrid:entered", removeAll);
    NB.evt.on("hybrid:exited", scan);
    scan();
  }

  NB.copyButton = {
    attachTextCopy, attachImageCopy, attachHtmlImageCopy, copySvgToPng, copyHtmlToPng,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
