/* copy-image.js -- the single owner of the "Copy" affordance on every
 * rendered code-block variant in the viewer.
 *
 * Two kinds of button, one shared look:
 *   - Source blocks (plain <pre> code, katex equations, html-live cards)
 *     get a text button that copies the block's source string. The <pre>
 *     buttons are wired by viewer.js through attachTextCopy; the katex /
 *     html-live containers are wired here.
 *   - The three SVG-producing block types (mermaid, wavedrom, graphviz)
 *     get an icon button that rasterizes the diagram to PNG and writes it
 *     to the system clipboard, so the user can paste it into another app.
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
  // SVG diagrams: an image button (rasterize to PNG).
  const IMAGE_CONTAINER_SELECTOR = ".mermaid-container, .wavedrom-container, .viz-container";
  // HTML-ish rendered blocks: a text button (copy the stored source), but
  // only when the container actually carries a non-empty source string.
  const KATEX_CONTAINER_SELECTOR = ".katex-container";
  const HTMLPREVIEW_CONTAINER_SELECTOR = ".htmlpreview-card";
  // Used only to remove this module's text buttons; injection is gated on
  // the source string, not on this combined selector.
  const TEXT_CONTAINER_SELECTOR =
    KATEX_CONTAINER_SELECTOR + ", " + HTMLPREVIEW_CONTAINER_SELECTOR;

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
  const SVG_MIME = "image/svg+xml;charset=utf-8";
  const PNG_MIME = "image/png";

  const ICON_SIZE = 16;

  // Rasterize at a scale that stays crisp on high-DPI screens; clamp so
  // neither canvas dimension can exceed MAX_CANVAS_DIM (browser canvas
  // limits are typically 4096-16384, and a pasted image rarely needs more).
  const SCALE_FLOOR = 2;
  const MAX_CANVAS_DIM = 4096;
  // Transparent PNGs paste badly into apps that assume a white page
  // (mermaid and graphviz emit no background), so paint white first.
  const CANVAS_BG = "#ffffff";

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

  /* copySvgToPng(svgEl, { name }) -- copy the diagram as a PNG, or fall
   * back to the download (then a new tab) when the clipboard image write is
   * unavailable, fails, or never settles. Exactly one toast fires per
   * outcome. */
  async function copySvgToPng(svgEl, opts) {
    const name = (opts && opts.name) || FALLBACK_NAME;
    if (!svgEl) { notify(FAIL_MESSAGE, "warn"); return; }

    // Built synchronously, before any await: the clipboard write below
    // must happen inside the user gesture and is handed this promise.
    const blobPromise = svgToPngBlob(svgEl);

    if (clipboardAvailable()) {
      // The write is CALLED synchronously in this turn (Safari gesture
      // requirement); only the await is bounded. The no-op catch swallows a
      // late rejection after we have already timed out and moved on.
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
   * (katex / html-live pass a dataset-source getter). With no getText, the
   * sanitized sourceTextOf default is used so the button never copies its
   * own label. */
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
    container.appendChild(buildImageButton(container));
  }

  function buildImageButton(container) {
    const btn = document.createElement("button");
    btn.type = "button";
    // Base + modifier: the shared chrome plus the square-icon tweak, and
    // the .code-copy-btn class hybrid.js strips from the note on save.
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
      const svg = container.querySelector("svg");
      copySvgToPng(svg, { name: pngName() });
    });
    return btn;
  }

  /* removeAll() -- drop the buttons THIS module injected (image buttons on
   * diagram containers, text buttons on the katex / html-live containers).
   * The <pre> buttons belong to viewer.js and are left alone. */
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
   * button into each SVG diagram container, a text button into the katex /
   * html-live containers. Skipped in hybrid mode and in the live preview;
   * the buttons are view-only chrome and must never enter the editable /
   * serialized DOM. */
  function scan() {
    if (livePreview) return;
    if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) return;
    const host = document.getElementById(VIEWER_CONTENT_ID);
    if (!host) return;
    host.querySelectorAll(IMAGE_CONTAINER_SELECTOR).forEach(attachImageCopy);
    // Only offer the text button when there is a source to copy, so a
    // render that stores nothing never yields a "Copied!" toast for an
    // empty string.
    host.querySelectorAll(KATEX_CONTAINER_SELECTOR).forEach((container) => {
      if (!container.dataset.katexSource) return;
      attachTextCopy(container, () => container.dataset.katexSource || "");
    });
    host.querySelectorAll(HTMLPREVIEW_CONTAINER_SELECTOR).forEach((container) => {
      if (!container.dataset.htmlpreviewSource) return;
      attachTextCopy(container, () => container.dataset.htmlpreviewSource || "");
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

  NB.copyButton = { attachTextCopy, attachImageCopy, copySvgToPng };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
