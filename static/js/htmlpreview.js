/* htmlpreview.js -- render Markdown code blocks tagged ```html-live as a
 * live, sandboxed HTML preview (CSS animations, inline scripts, canvas,
 * anything a browser can run).
 *
 * Why a distinct fence: plain ```html keeps its usual meaning (highlight
 * the markup as source, exactly like GitHub/Obsidian). A note author who
 * wants the block to actually RUN opts in by tagging it ```html-live.
 *
 * Why an <iframe> instead of innerHTML: assigning innerHTML executes no
 * <script> tags, so script-driven animation is impossible that way.
 * An iframe with srcdoc runs a full document. We give it
 * sandbox="allow-scripts" and deliberately do NOT include
 * allow-same-origin: the previewed document then gets an opaque origin,
 * so its scripts cannot read the app's cookies, DOM, or call the
 * authenticated /api/* routes as the signed-in user. That is the whole
 * point of the sandbox here.
 *
 * No vendor bundle is involved, so unlike mermaid/wavedrom/katex/viz
 * there is no whenReady() gate -- rendering is a synchronous DOM swap.
 *
 * Why a module at all: it keeps the block-selection, the iframe
 * construction, the source/live toggle, and the error fallback out of
 * viewer.js, mirroring mermaid.js / wavedrom.js.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Fences that opt into the live preview. Keep "html-live" as the
  // primary name.
  const LANGS = ["html-live", "htmlpreview", "htmlpreview-live"];

  // Initial height of a preview frame until its content reports its own
  // size. The frame then auto-fits its content (see RESIZE_BRIDGE), so a
  // note never shows an inner scrollbar that would steal the page wheel.
  const DEFAULT_HEIGHT = 260;
  // Floor for the auto-fit height so a nearly-empty demo is still tappable.
  const MIN_HEIGHT = 80;
  // Runaway guard only. The frame is meant to fit its content, so this
  // is set far above any sane demo -- it exists solely so a pathological
  // self-growing document cannot expand the note without bound. Content
  // is NOT trimmed at any realistic height.
  const AUTO_MAX_HEIGHT = 100000;

  // Build the selector for the supported fences.
  const SELECTOR = LANGS.map((l) => "pre > code.language-" + l).join(", ");

  /* parseHeight(source) -> number | null.
   * The author may put a single "height: 480" (or "height=480") line in
   * the first comment of the block to set a MINIMUM height for the frame
   * (short demos get some breathing room). The frame still grows to fit
   * taller content, so no inner scrollbar appears. Returns null when
   * absent or out of range. */
  function parseHeight(source) {
    const m = /(?:^|\n)\s*(?:\/\/|<!--|#)?\s*height\s*[:=]\s*(\d+)/i.exec(source);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    if (!isFinite(h) || h < MIN_HEIGHT || h > AUTO_MAX_HEIGHT) return null;
    return h;
  }

  /* The sandbox gives the preview an opaque origin, so the injected
   * bridge cannot reach into the parent directly -- it postMessages.
   * The parent validates messages by matching event.source against the
   * frames it created (origin matching is impossible cross-origin). */
  const KEY_MSG = "__nbHtmlPreviewKey";

  /* Injected into every preview. Forwards only modified keydowns
   * (Ctrl/Cmd/Alt) to the parent so app shortcuts (Ctrl+E, Ctrl+S, ...)
   * keep working while the frame has focus. Unmodified keys stay in the
   * demo, so the preview still gets normal typing. We do NOT
   * preventDefault: the demo keeps its own copy/select-all behavior,
   * and the parent simply also reacts to the forwarded chord. */
  const KEY_BRIDGE =
    "<script>(function(){" +
    'document.addEventListener("keydown",function(e){' +
    "if(!(e.ctrlKey||e.metaKey||e.altKey))return;" +
    "try{parent.postMessage({__nbHtmlPreviewKey:true,key:e.key," +
    "ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,shiftKey:e.shiftKey}," +
    '"*");}catch(_){}}' +
    ",true);})();</" + "script>";

  // Message tag for content-height reports from the preview.
  const SIZE_MSG = "__nbHtmlPreviewSize";

  /* Injected into every preview. Reports the document's content height
   * to the parent so it can size the frame to fit -- the parent cannot
   * measure a cross-origin (sandboxed) document itself.
   *
   * Three things matter here:
   *   1. Run only after the body exists. This script is injected in
   *      <head>, so at parse time document.body is null; calling
   *      ResizeObserver.observe(null) threw and aborted the whole bridge
   *      (no size report ever fired -> the frame stayed clipped). We
   *      defer setup to DOMContentLoaded.
   *   2. Observe document.documentElement, not body. The body box is
   *      only as tall as its content, but the html element grows with
   *      it, and observing the root reliably catches later growth
   *      (canvas, animations).
   *   3. Report the max of documentElement/body scrollHeight. */
  const RESIZE_BRIDGE =
    "<script>(function(){" +
    "function h(){return Math.max(" +
    "document.documentElement.scrollHeight," +
    "(document.body?document.body.scrollHeight:0));}" +
    "function post(){try{parent.postMessage(" +
    "{__nbHtmlPreviewSize:true,h:h()},'*');}catch(_){}}" +
    "function setup(){post();" +
    'if(window.ResizeObserver){try{new ResizeObserver(post)' +
    ".observe(document.documentElement);}catch(_){}}" +
    "}" +
    'if(document.readyState==="loading"){' +
    'document.addEventListener("DOMContentLoaded",setup);' +
    "}else{setup();}" +
    'window.addEventListener("load",post);' +
    "setTimeout(post,50);setTimeout(post,400);" +
    "})();</" + "script>";

  // The parent trusts only messages whose source is one of its own,
  // currently-connected preview frames. Origin matching is impossible
  // cross-origin, so we compare `event.source` against the frames in the
  // DOM. Looking them up live (rather than keeping a Set) means a
  // re-render that drops old frames cannot leak stale window proxies.
  function isLivePreviewFrame(source) {
    if (!source) return false;
    const frames = document.querySelectorAll("iframe.htmlpreview-frame");
    for (const frame of frames) {
      if (frame === source || frame.contentWindow === source) return true;
    }
    return false;
  }

  function installKeyBridge() {
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (!isLivePreviewFrame(ev.source)) return;
      // Content-height report: size the frame to fit so it never shows an
      // internal scrollbar. Look the frame up by source (we validated it
      // already) and apply the reported height within our bounds.
      if (d[SIZE_MSG] === true) {
        const frame = previewFrameFor(ev.source);
        if (frame && typeof d.h === "number" && isFinite(d.h)) {
          applyHeight(frame, d.h);
        }
        return;
      }
      if (d[KEY_MSG] !== true) return;
      // Replay as a real keydown on the app document so the existing
      // shortcut layer (and any other document-level handler) sees it
      // unchanged. The synthetic event is marked to avoid a loop.
      let evt;
      try {
        evt = new KeyboardEvent("keydown", {
          key: d.key,
          ctrlKey: !!d.ctrlKey,
          metaKey: !!d.metaKey,
          altKey: !!d.altKey,
          shiftKey: !!d.shiftKey,
          bubbles: true,
          cancelable: true,
        });
      } catch (_) { return; }
      Object.defineProperty(evt, "__nbHtmlPreviewSynthetic",
        { value: true, enumerable: false });
      document.dispatchEvent(evt);
    }, true);
  }
  installKeyBridge();

  /* Find the live preview frame whose contentWindow (or element) is
   * `source`, or null. Used to route a size report back to its frame. */
  function previewFrameFor(source) {
    if (!source) return null;
    const frames = document.querySelectorAll("iframe.htmlpreview-frame");
    for (const frame of frames) {
      if (frame === source || frame.contentWindow === source) return frame;
    }
    return null;
  }

  /* applyHeight(frame, contentH): size the frame to its content height,
   * clamped to [MIN_HEIGHT, AUTO_MAX_HEIGHT] and never below the
   * author's `height:` floor (stored in dataset). The frame is then tall
   * enough for the content, so no inner scrollbar appears and the wheel
   * scrolls the note instead of the preview. */
  function applyHeight(frame, contentH) {
    const floor = parseInt(frame.dataset.minHeight, 10) || 0;
    let h = Math.ceil(contentH);
    if (floor > h) h = floor;
    if (h < MIN_HEIGHT) h = MIN_HEIGHT;
    if (h > AUTO_MAX_HEIGHT) h = AUTO_MAX_HEIGHT;
    // Never shrink below the current height (a transient 0 during load
    // would collapse the frame) and avoid needless style writes.
    const cur = parseFloat(frame.style.height) || 0;
    if (h <= cur) return;
    frame.style.height = h + "px";
  }

  /* buildFrame(source, height) -> HTMLIFrameElement.
   *
   * srcdoc is used exactly as authored (including any height: hint
   * comment -- harmless in the document). sandbox="allow-scripts"
   * without allow-same-origin is the security boundary: scripts run but
   * are cross-origin to the app. We also inject a minimal viewport /
   * margin reset so the preview fills its frame, plus the key bridge. */
  function buildFrame(source, height) {
    const frame = document.createElement("iframe");
    frame.className = "htmlpreview-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", "HTML preview");
    frame.setAttribute("loading", "lazy");
    frame.style.height = (height || DEFAULT_HEIGHT) + "px";
    // The author's `height:` is a floor, not a fixed size -- the frame
    // still grows to fit content so no inner scrollbar appears.
    frame.dataset.minHeight = String(height || MIN_HEIGHT);

    // Left/top-align the demo so the content flows from the top. The
    // earlier vertical centering (align-items:center) pushed content
    // above the frame's top edge when it was taller than the initial
    // height; scrollHeight does not count overflow above the origin, so
    // it under-reported and the frame stayed too short. Horizontal
    // centering (justify-content) is kept.
    const head = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<style>html,body{margin:0;padding:12px;font-family:system-ui,sans-serif;" +
      "overflow:hidden}" +
      "body{display:flex;align-items:flex-start;justify-content:center;" +
      "min-height:0}</style>" +
      KEY_BRIDGE +
      RESIZE_BRIDGE +
      "</head><body>";
    const tail = "</body></html>";
    const doc = head + source + tail;
    // Assignment after creation so the parser never sees it.
    frame.setAttribute("srcdoc", doc);
    return frame;
  }

  /* renderOne(pre) -- replace <pre><code class="language-html-live">
   * with a .htmlpreview-card holding the sandboxed iframe + a header
   * with a "Source" / "Preview" toggle. */
  function renderOne(pre) {
    const code = pre.querySelector("code");
    if (!code) return;
    // textContent is already the decoded source (marked entity-encodes
    // it in the HTML, the DOM gives us the real characters back). Do
    // NOT run it through an HTML parser -- that would strip the very
    // tags we are here to preview.
    const source = code.textContent;
    const height = parseHeight(source);

    const card = document.createElement("div");
    card.className = "htmlpreview-card";
    card.dataset.htmlpreview = "ok";
    // Store the original source so hybrid mode's domToMarkdown can
    // round-trip the block back to a ```html-live fence.
    card.dataset.htmlpreviewSource = source;

    const bar = document.createElement("div");
    bar.className = "htmlpreview-bar";
    const label = document.createElement("span");
    label.className = "htmlpreview-label";
    label.textContent = "HTML preview";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "htmlpreview-toggle";
    toggle.textContent = "Source";
    bar.appendChild(label);
    bar.appendChild(toggle);

    const body = document.createElement("div");
    body.className = "htmlpreview-body";

    const frame = buildFrame(source, height);
    body.appendChild(frame);

    // The source pane is created lazily on first toggle so a note with
    // many previews does not pay for the highlighted copy up front.
    let srcPane = null;
    let showingSource = false;
    function toggleView() {
      showingSource = !showingSource;
      if (showingSource) {
        if (!srcPane) {
          srcPane = document.createElement("pre");
          srcPane.className = "htmlpreview-source";
          const c = document.createElement("code");
          c.className = "language-html";
          c.textContent = source;
          srcPane.appendChild(c);
          if (window.hljs) {
            try { hljs.highlightElement(c); } catch (_) {}
          }
        }
        frame.hidden = true;
        if (!srcPane.parentNode) body.appendChild(srcPane);
        srcPane.hidden = false;
        toggle.textContent = "Preview";
      } else {
        if (srcPane) srcPane.hidden = true;
        frame.hidden = false;
        toggle.textContent = "Source";
      }
    }
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleView();
    });

    card.appendChild(bar);
    card.appendChild(body);
    pre.replaceWith(card);
  }

  /* renderAll(container) -- find every supported fence inside
   * `container` and render it. Idempotent: a <pre> already replaced
   * with a .htmlpreview-card no longer holds a code.language-html-live,
   * so the query won't pick it up again. Runs in view mode AND live
   * preview. */
  function renderAll(container) {
    if (!container) return;
    const blocks = container.querySelectorAll(SELECTOR);
    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre || pre.tagName !== "PRE") continue;
      renderOne(pre);
    }
  }

  NB.htmlpreview = { renderAll };

  // Register this renderer with the shared blocks registry so the
  // viewer/hybrid/export pipelines, the hybrid click-to-edit table, and
  // the Save round-trip all pick it up without hand-listing it. It has
  // no vendor gate (no lazy bundle), no error box, and no lightbox.
  if (NB.blocks) {
    NB.blocks.register({
      mod: "htmlpreview",
      langs: LANGS,
      name: "HTML preview",
      fence: "html-live",
      selector: SELECTOR,
      containerClass: "htmlpreview-card",
      datasetKey: "htmlpreviewSource",
      errorClass: null,
      sourceClass: null,
      renderAll,
    });
  }
})();
