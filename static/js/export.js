/* export.js -- export the current note to PDF (browser print-to-PDF) or
 * a self-contained HTML file.
 *
 * The app renders Markdown client-side (marked + highlight.js + mermaid /
 * katex / wavedrom / graphviz), so the most faithful export is produced by
 * re-rendering the active note into a standalone document and letting the
 * browser's print dialog save it as a PDF. The PDF path paginates that
 * document with the vendored Paged.js polyfill in a hidden same-origin
 * iframe, moves the finished A4 sheets into the current page as a
 * print-only layer, and opens the print dialog directly — no preview tab.
 * Printing the current top-level page (rather than the subframe) is what
 * makes Firefox's "Save to PDF" actually write a file.
 *
 * HTML export builds a standalone .html file with the rendered note plus
 * embedded styles (the app's markdown rules + the light highlight.js theme),
 * downloaded via a Blob. Diagrams are baked in as inline SVG, so the file
 * opens anywhere with no network.
 *
 * The modal is a small overlay (reusing the settings-modal look) with a
 * format choice and a scope choice. Scope is "the current file" -- the
 * active tab -- which is what the user asked for.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const overlayEl = document.getElementById("export-overlay");
  const modalEl   = overlayEl && overlayEl.querySelector(".settings-modal");
  const closeBtn  = document.getElementById("export-close");
  const closeFooterBtn = document.getElementById("export-close-btn");
  const formatRadios = Array.from(document.querySelectorAll('input[name="export-format"]'));
  const scopeRadios  = Array.from(document.querySelectorAll('input[name="export-scope"]'));
  const widthRadios  = Array.from(document.querySelectorAll('input[name="export-width"]'));
  const themeRadios  = Array.from(document.querySelectorAll('input[name="export-theme"]'));
  const tocCheckbox  = document.getElementById("export-toc");
  const exportBtn    = document.getElementById("export-run");
  const previewBtn   = document.getElementById("export-preview");
  const fileLabelEl  = document.getElementById("export-file-label");
  const sectionRowEl = document.getElementById("export-section-row");
  const sectionSelectEl = document.getElementById("export-section-select");
  const errorEl      = document.getElementById("export-error");

  // Width of the exported HTML's fixed TOC sidebar, in pixels. Also
  // reserved as left padding on <body> so the content stays anchored while
  // the sidebar is shown/hidden.
  const SIDEBAR_WIDTH = 320;

  // How long to wait for Paged.js to finish paginating the print document
  // before printing anyway. This is only a safety net against a renderer
  // that never signals completion.
  const PRINT_WINDOW_TIMEOUT = 15000;

  // Poll interval while waiting for the print window's polyfill to boot and
  // for the pagination-complete flag.
  const PRINT_WINDOW_POLL = 25;

  // Hidden same-origin iframe that Paged.js paginates the PDF into before
  // the finished sheets are moved into the current page for printing.
  // Created lazily and reused across exports.
  let printFrame = null;

  // The file the modal is exporting. null means "the active file" (open()
  // with no argument); a path means a specific file (the sidebar / tab
  // context menus), which may not be the active tab.
  let targetPath = null;

  function selectedFormat() {
    const r = formatRadios.find(x => x.checked);
    return r ? r.value : "pdf";
  }
  function selectedScope() {
    const r = scopeRadios.find(x => x.checked);
    return r ? r.value : "current";
  }
  function selectedWidth() {
    const r = widthRadios.find(x => x.checked);
    return r ? r.value : "fit";
  }
  function selectedTheme() {
    const r = themeRadios.find(x => x.checked);
    return r ? r.value : "light";
  }
  function includeToc() {
    return tocCheckbox ? tocCheckbox.checked : true;
  }

  /* --- section (h1-h3) extraction ------------------------------------ */
  /* Parse the active note's markdown and return the list of h1-h3
   * headings as {level, text, index} where `index` is the byte offset of
   * the heading line in the source. Used to populate the section dropdown
   * and to slice the source for a section-scoped export. */
  function extractHeadings(content) {
    const headings = [];
    const re = /^(#{1,3})\s+(.+?)\s*$/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      headings.push({
        level: m[1].length,
        text: m[2].trim(),
        index: m.index,
      });
    }
    return headings;
  }

  /* Slice `content` to the section starting at `startIndex` (the byte
   * offset of its heading line) and ending just before the next heading
   * of the same or higher level (h1-h3). If there is no such heading, the
   * slice runs to the end of the file. */
  function sliceSection(content, headings, startIndex) {
    const start = headings.find(h => h.index === startIndex);
    if (!start) return content;
    let end = content.length;
    for (const h of headings) {
      if (h.index > start.index && h.level <= start.level) {
        end = h.index;
        break;
      }
    }
    return content.slice(start.index, end);
  }

  /* Build a table-of-contents <nav> from the rendered host's headings
   * (h1-h3). Each entry links to the heading's id (assigned by renderInto
   * via the same slugify the viewer uses).
   *
   * `flat` (default) produces a single flat list, used for the inline
   * block in PDF export.
   *
   * `sidebar` produces a nested collapsible tree for the HTML export's
   * sidebar: only h1 headings are visible by default; clicking an h1
   * toggles its h2 children, clicking an h2 toggles its h3 children. A
   * "Hide sidebar" button is prepended and a collapse toggle (▸/▾)
   * shown before the indent-able headings that have children.
   *
   * Returns `{ nav, showLabel }` where `nav` is the sidebar nav (always
   * present, even when there are no headings) and `showLabel` is the
   * floating "Show sidebar" button. For sidebar mode, `showLabel` is a
   * SIBLING of the sidebar `<aside>` — not a descendant — so the user
   * can still click it once the sidebar is hidden. The caller is
   * responsible for placing `showLabel` as a direct child of `<body>`
   * in the serialized HTML; the CSS :has() toggle handles the rest.
   */
  function buildToc(host, mode) {
    const headings = Array.from(host.querySelectorAll("h1,h2,h3"));
    const isSidebar = mode === "sidebar";
    const empty = headings.length === 0;

    const nav = document.createElement("nav");
    nav.className = "export-toc";
    const title = document.createElement("p");
    title.className = "export-toc-title";
    title.textContent = "Contents";
    nav.appendChild(title);

    // Hide-sidebar toggle. A hidden checkbox + labels + CSS :has() drive
    // everything so it works in the exported .html with no JS (DOM
    // serialization strips any addEventListener handlers). Two labels point
    // at the same box: "Hide sidebar" lives in the sidebar itself, and a
    // floating "Show sidebar" button (rendered as a body-level sibling of
    // the sidebar, NOT inside it — otherwise the act of hiding the
    // sidebar would also hide the only control that can bring it back).
    let showLabel = null;
    if (isSidebar) {
      const hideWrapper = document.createElement("div");
      hideWrapper.className = "export-toc-hide";
      const hideInput = document.createElement("input");
      hideInput.type = "checkbox";
      hideInput.id = "export-toc-hide";
      hideInput.className = "export-toc-hide-input";
      const hideLabel = document.createElement("label");
      hideLabel.htmlFor = "export-toc-hide";
      hideLabel.className = "export-toc-hamburger";
      hideLabel.textContent = "☰";
      hideLabel.setAttribute("aria-label", "Hide sidebar");
      hideLabel.title = "Hide sidebar";
      hideWrapper.appendChild(hideInput);
      hideWrapper.appendChild(hideLabel);
      nav.appendChild(hideWrapper);

      showLabel = document.createElement("label");
      showLabel.htmlFor = "export-toc-hide";
      showLabel.className = "export-toc-show";
      showLabel.textContent = "☰";
      showLabel.setAttribute("aria-label", "Show sidebar");
      showLabel.title = "Show sidebar";

      const expandAll = document.createElement("button");
      expandAll.type = "button";
      expandAll.className = "export-toc-expandall";
      expandAll.setAttribute("aria-expanded", "false");
      expandAll.setAttribute("aria-label", "Expand all");
      expandAll.title = "Expand all";
      // Double-chevron icon. The same two stacked ">" shapes serve both
      // states: pointing right (») when collapsed (hint: "expand outward")
      // and rotated to point down (▼▼) when expanded (hint: "spread open").
      // A single SVG path set + a CSS rotate keeps the markup static (so
      // outerHTML serialization preserves it) and lets the aria-expanded
      // attribute — which the JS already sets — drive the visual state.
      expandAll.innerHTML =
        '<svg class="export-toc-expandall-icon" viewBox="0 0 16 16" ' +
        'aria-hidden="true" focusable="false">' +
        '<g fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="3,4 7,8 3,12"/>' +
        '<polyline points="9,4 13,8 9,12"/>' +
        '</g></svg>';
      nav.appendChild(expandAll);
    }

    const list = document.createElement("ul");
    list.className = "export-toc-root";

    if (!empty) {
      if (isSidebar) {
        // Nested <details>/<summary> tree. Native disclosure elements are
        // used so expand/collapse works in the exported .html with no JS
        // (serializing the DOM via outerHTML strips any addEventListener
        // handlers). Only the h1 level is open by default, so h1 and h2
        // titles are visible while h3+ stay hidden until the user opens the
        // h2 that contains them.
        const stack = [];
        for (const h of headings) {
          const level = parseInt(h.tagName.slice(1), 10);
          const li = document.createElement("li");
          const details = document.createElement("details");
          details.open = level <= 1;
          details.dataset.level = String(level);
          const summary = document.createElement("summary");
          const a = document.createElement("a");
          a.href = "#" + (h.id || "");
          a.textContent = h.textContent;
          summary.appendChild(a);
          details.appendChild(summary);
          li.appendChild(details);

          while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
          let parentUl = list;
          if (stack.length) {
            let children = stack[stack.length - 1].li.querySelector(".export-toc-children");
            if (!children) {
              children = document.createElement("ul");
              children.className = "export-toc-children";
              stack[stack.length - 1].li.querySelector("details").appendChild(children);
            }
            parentUl = children;
          }
          parentUl.appendChild(li);
          stack.push({ level, li });
        }
      } else {
        for (const h of headings) {
          const li = document.createElement("li");
          li.className = "export-toc-level-" + h.tagName.toLowerCase();
          const a = document.createElement("a");
          a.href = "#" + (h.id || "");
          a.textContent = h.textContent;
          li.appendChild(a);
          list.appendChild(li);
        }
      }
    }

    nav.appendChild(list);

    // Mark headings with no sub-headings (leaf nodes). They get no expand
    // arrow and a muted color, since clicking them cannot disclose anything.
    if (isSidebar) {
      nav.querySelectorAll("details").forEach(d => {
        if (!d.querySelector(".export-toc-children")) {
          const s = d.querySelector("summary");
          if (s) s.classList.add("export-toc-leaf");
        }
      });
    }

    return { nav, showLabel };
  }

  /* Apply the selected page-width and theme classes to a rendered
   * container. The classes drive max-width and colors via CSS (see
   * style.css / exportCss). */
  function applyWidth(host) {
    const w = selectedWidth();
    host.classList.remove("export-width-fit", "export-width-80", "export-width-full");
    host.classList.add("export-width-" + w);
    const t = selectedTheme();
    host.classList.remove("export-theme-light", "export-theme-dark");
    host.classList.add("export-theme-" + t);
  }

  /* Resolve the content to export. For the active file we read the
   * viewer's content cache (so unsaved edits are included); for a
   * specific path (context-menu export) we fetch it from the server. */
  async function resolveContent(path) {
    if (!path) {
      return (NB.viewer && NB.viewer.getContent) ? NB.viewer.getContent() : "";
    }
    if (path === (NB.viewer && NB.viewer.getPath())) {
      return (NB.viewer && NB.viewer.getContent) ? NB.viewer.getContent() : "";
    }
    const data = await NB.api.getFile(path);
    return (data && data.content) || "";
  }

  function refreshSections() {
    if (!sectionRowEl || !sectionSelectEl) return;
    const path = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    resolveContent(path).then(content => {
      const headings = extractHeadings(content);
      sectionSelectEl.innerHTML = "";
      for (const h of headings) {
        const opt = document.createElement("option");
        opt.value = String(h.index);
        opt.textContent = "#".repeat(h.level) + " " + h.text;
        sectionSelectEl.appendChild(opt);
      }
      sectionSelectEl.disabled = headings.length === 0;
      sectionRowEl.hidden = selectedScope() !== "section";
    }).catch(() => {
      sectionSelectEl.innerHTML = "";
      sectionSelectEl.disabled = true;
    });
  }

  /* Open the export modal. `path` is optional: when given, the modal
   * exports that specific file (used by the sidebar / tab context menus);
   * when omitted it exports the active file (the top-bar button). */
  function open(path) {
    if (!overlayEl) return;
    // The top-bar button dispatches a click Event; only a string path is
    // a real target. Anything else means "the active file".
    targetPath = (typeof path === "string" && path) ? path : null;
    const label = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    if (fileLabelEl) {
      fileLabelEl.textContent = label || "(no file open)";
      fileLabelEl.classList.toggle("empty", !label);
    }
    refreshSections();
    if (errorEl) errorEl.hidden = true;
    overlayEl.hidden = false;
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.hidden = true;
    if (document.activeElement && overlayEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function isOpen() { return overlayEl && !overlayEl.hidden; }

  /* --- rendering the note into a container --------------------------- */
  /* Render the target file's markdown into `host` using the same pipeline
   * the viewer uses (marked + highlight.js + the diagram renderers), so the
   * export matches the on-screen rendering. `scope` is "current" (the whole
   * file) or "section" (only the selected h1-h3 section). Returns the
   * rendered element. */
  async function renderInto(host, scope, tocMode) {
    const path = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    if (!path) throw new Error("No file is open to export.");
    let content = await resolveContent(path);
    if (!window.marked) throw new Error("marked.js is not available.");

    if (scope === "section") {
      const headings = extractHeadings(content);
      const idx = sectionSelectEl ? parseInt(sectionSelectEl.value, 10) : NaN;
      if (!Number.isFinite(idx) || !headings.some(h => h.index === idx)) {
        throw new Error("Select a section heading to export.");
      }
      content = sliceSection(content, headings, idx);
    }

    host.innerHTML = marked.parse(content, { gfm: true, breaks: false });

    // Heading ids (same slugify the viewer uses, so anchors match).
    host.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(h => {
      h.id = NB.slugify ? NB.slugify(h.textContent) : h.textContent;
    });

    // Table of contents (h1-h3), prepended when requested. PDF (tocMode
    // falsy) renders an inline flat TOC; HTML (tocMode === "sidebar")
    // renders a collapsible sidebar nav. In sidebar mode buildToc
    // returns `{nav, showLabel}` and we stash `showLabel` on the host
    // so exportHtml/preview can move it out of the sidebar.
    if (includeToc()) {
      const built = buildToc(host, tocMode);
      if (built) {
        host.insertBefore(built.nav, host.firstChild);
        if (built.showLabel) host._exportShowLabel = built.showLabel;
      }
    }

    // Page width.
    applyWidth(host);

    // Syntax highlighting.
    if (window.hljs) {
      host.querySelectorAll("pre code").forEach(el => {
        try { hljs.highlightElement(el); } catch (_) {}
      });
    }

    // Diagrams. Each renderer is idempotent and awaits sequentially.
    if (NB.mermaid && NB.mermaid.renderAll) await NB.mermaid.renderAll(host);
    if (NB.wavedrom && NB.wavedrom.renderAll) await NB.wavedrom.renderAll(host);
    if (NB.katex && NB.katex.renderAll) await NB.katex.renderAll(host);
    if (NB.viz && NB.viz.renderAll) await NB.viz.renderAll(host);

    return host;
  }

  /* --- PDF via Paged.js pagination + browser print-to-PDF ------------ */
  /* Build the same Paged.js document the Preview uses, paginate it in a
   * hidden iframe, move the finished A4 page sheets into the current page
   * as a print-only layer, then open the browser's print dialog directly.
   * Paged.js splits the note into real A4 sheets using the @page geometry
   * and break rules the print dialog would apply, so the saved PDF is
   * paginated exactly like the preview.
   *
   * No preview tab is opened: printing the *current* top-level page avoids
   * both the extra window the user would have to close and Firefox's
   * inability to save a hidden subframe to PDF (only a top-level document
   * saves reliably). The paginated content lives in an invisible container
   * on screen and replaces the app chrome only in print. */

  /* Poll a window until the Paged.js polyfill has booted. Resolves true
   * once `win.Paged` exists, false on timeout. */
  function waitForPaginator(win) {
    return new Promise(resolve => {
      let elapsed = 0;
      const timer = setInterval(() => {
        if (win && win.Paged) {
          clearInterval(timer);
          resolve(true);
        } else if ((elapsed += PRINT_WINDOW_POLL) >= PRINT_WINDOW_TIMEOUT) {
          clearInterval(timer);
          resolve(false);
        }
      }, PRINT_WINDOW_POLL);
    });
  }

  /* Wait for Paged.js to finish rendering every page. The inline
   * PagedConfig.after hook flips `window.__nbPagedRendered` once every
   * page has been laid out; that is the authoritative signal. Do NOT guess
   * completion from a stable page count: Firefox throttles timers in
   * background documents and can pause for seconds mid-pagination, which
   * made an "unchanged count" heuristic fire after page 1 and print only
   * the first sheet. Times out so a broken renderer can't hang the export. */
  function waitForPagination(win) {
    return new Promise(resolve => {
      let elapsed = 0;
      const timer = setInterval(() => {
        if (win && win.__nbPagedRendered) {
          clearInterval(timer);
          resolve();
        } else if ((elapsed += PRINT_WINDOW_POLL) >= PRINT_WINDOW_TIMEOUT) {
          clearInterval(timer);
          resolve();
        }
      }, PRINT_WINDOW_POLL);
    });
  }

  /* Hidden pagination iframe. Kept in the viewport but invisible: Firefox
   * throttles off-screen iframes hard, stalling pagination for seconds. */
  function ensurePrintFrame() {
    if (printFrame) return printFrame;
    printFrame = document.createElement("iframe");
    printFrame.id = "pdf-print-frame";
    printFrame.setAttribute("aria-hidden", "true");
    printFrame.style.cssText =
      "position:fixed;left:0;top:0;width:210mm;height:297mm;border:0;" +
      "opacity:0;pointer-events:none;z-index:-1;";
    document.body.appendChild(printFrame);
    return printFrame;
  }

  /* Move the finished page sheets and their Paged.js styles out of the
   * iframe and into the current document under a print-only container.
   * The styles are cloned with media="print" so they can't affect the app
   * on screen; the container is hidden on screen and replaces all other
   * body content only when printing. */
  function mountPrintRoot(frameDoc) {
    const pages = frameDoc.querySelector(".pagedjs_pages");
    if (!pages) return false;
    unmountPrintRoot();
    const root = document.createElement("div");
    root.id = "pdf-print-root";
    for (const st of Array.from(frameDoc.querySelectorAll("style"))) {
      const s = document.createElement("style");
      s.setAttribute("media", "print");
      s.textContent = st.textContent;
      root.appendChild(s);
    }
    root.appendChild(pages.cloneNode(true));
    const toggle = document.createElement("style");
    toggle.textContent =
      "@media screen{#pdf-print-root{display:none!important}}" +
      "@media print{" +
        "html,body{background:#fff!important;margin:0!important;padding:0!important}" +
        "body>*:not(#pdf-print-root){display:none!important}" +
        "#pdf-print-root{display:block!important;position:static!important}" +
      "}";
    root.appendChild(toggle);
    document.body.appendChild(root);
    return true;
  }

  function unmountPrintRoot() {
    const root = document.getElementById("pdf-print-root");
    if (root) root.remove();
  }

  async function exportPdf(scope) {
    const { html } = await buildExportDoc(scope, null, true, true);

    const frame = ensurePrintFrame();
    const frameWin = frame.contentWindow;
    const frameDoc = frame.contentDocument;
    // Load synchronously so contentWindow/contentDocument are valid now.
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    if (await waitForPaginator(frameWin)) {
      await waitForPagination(frameWin);
    }
    // One more frame so the SVG diagrams settle before the snapshot.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    if (!mountPrintRoot(frameDoc)) {
      throw new Error("Pagination produced no pages to print.");
    }
    window.addEventListener("afterprint", unmountPrintRoot, { once: true });
    window.print();
  }

  /* --- standalone HTML document builder ------------------------------ */
  /* Render the target note and assemble a complete standalone .html
   * document string. `tocMode` is "sidebar" for the HTML export (fixed
   * collapsible TOC aside) or falsy for the PDF layout (inline flat TOC).
   * `printPreview` applies the print rules on screen. Returns
   * { html, title }. */
  function buildExportDoc(scope, tocMode, printPreview, paged) {
    const path = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    if (!path) throw new Error("No file is open to export.");

    const host = document.createElement("div");
    host.className = "markdown-body";
    return renderInto(host, scope, tocMode).then(() => {
      const title = path.split("/").pop().replace(/\.md$/i, "") || "note";
      const css = exportCss(printPreview, paged);
      // The width/theme classes are set on `host` by renderInto; carry them
      // onto the exported <main> so the embedded CSS can style the page.
      const mainClass = ["markdown-body", "export-body"]
        .concat(Array.from(host.classList).filter(c => c.indexOf("export-width-") === 0 || c.indexOf("export-theme-") === 0))
        .join(" ");
      // Sidebar mode pulls the TOC out of the content into a fixed aside;
      // PDF mode leaves the inline (flat) TOC inside <main>.
      const sidebar = tocMode === "sidebar";
      let tocHtml = "";
      if (sidebar) {
        const toc = host.querySelector(".export-toc");
        tocHtml = toc ? toc.outerHTML : "";
        if (toc) toc.remove();
      }
      // The "Show sidebar" label must be a sibling of <aside>, not a
      // descendant — otherwise the act of hiding the sidebar would also
      // hide the only control that can bring it back.
      const showLabel = host._exportShowLabel;
      const showLabelHtml = showLabel ? showLabel.outerHTML : "";
      host._exportShowLabel = null;
      const html =
        "<!DOCTYPE html>\n" +
        "<html lang=\"en\">\n" +
        "<head>\n" +
        "  <meta charset=\"utf-8\">\n" +
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
        "  <title>" + escapeHtml(title) + "</title>\n" +
        "  <style>" + css + "</style>\n" +
        // Paged.js is loaded only for PDF export and the live PDF preview
        // (a same-origin absolute URL). The downloaded HTML export never
        // references it, so it stays fully standalone. The inline config
        // runs before the polyfill and flips a completion flag once every
        // page has been laid out, which is how exportPdf knows the print
        // snapshot is ready.
        (paged
          ? "  <script>window.__nbPagedRendered=false;window.PagedConfig={auto:true,after:function(){window.__nbPagedRendered=true;}};<\/script>\n" +
            "  <script src=\"" + window.location.origin + "/static/vendor/paged.polyfill.min.js\"><\/script>\n"
          : "") +
        "</head>\n" +
        "<body>\n" +
        (tocHtml ? "  <aside class=\"export-sidebar\">" + tocHtml + "</aside>\n" : "") +
        (showLabelHtml ? "  " + showLabelHtml + "\n" : "") +
        "  <main class=\"" + mainClass + "\">\n" +
        host.innerHTML +
        "  </main>\n" +
        tocScript() + "\n" +
        "</body>\n" +
        "</html>\n";
      return { html, title };
    });
  }

  /* --- self-contained HTML export ----------------------------------- */
  /* Download a standalone .html file: the rendered note + embedded styles
   * (the app's markdown rules + the light highlight.js theme) + the
   * diagram SVGs already baked in. */
  function exportHtml(scope) {
    return buildExportDoc(scope, "sidebar", false).then(({ html, title }) => {
      downloadBlob(html, title + ".html", "text/html;charset=utf-8");
    });
  }

  /* Inline script embedded in the exported HTML. The native <details> tree
   * handles individual expand/collapse, but "expand all" cannot be done in
   * pure CSS, so this one small script wires the button. It is a string
   * (not a live listener) precisely because DOM serialization through
   * outerHTML drops attached handlers. */
  function tocScript() {
    return "<script>\n" +
      "(function(){\n" +
      "  var btn=document.querySelector('.export-toc-expandall');\n" +
      "  if(!btn)return;\n" +
      "  btn.addEventListener('click',function(){\n" +
      "    var open=btn.getAttribute('aria-expanded')!=='true';\n" +
      "    var boxes=document.querySelectorAll('.export-sidebar details');\n" +
      "    for(var i=0;i<boxes.length;i++){\n" +
      "      var lvl=parseInt(boxes[i].dataset.level,10)||1;\n" +
      "      boxes[i].open=open?true:lvl<=1;\n" +
      "    }\n" +
      "    btn.setAttribute('aria-expanded',open?'true':'false');\n" +
      "    var lbl=open?'Collapse all':'Expand all';\n" +
      "    btn.setAttribute('aria-label',lbl);\n" +
      "    btn.title=lbl;\n" +
      "  });\n" +
      "})();\n" +
      "<\/script>";
  }

  /* Print rules shared by real printing (PDF export) and the on-screen
   * PDF preview. Kept in an array so the preview can apply the same rules
   * under @media screen and show exactly what the PDF will look like. */
  function printRules() {
    return [
      "body,html{background:#fff!important;color:#1f2330!important}",
      ".export-sidebar,.export-toc-show,.export-toc-hide,.export-toc-expandall{display:none!important}",
      "body:has(.export-sidebar){padding-left:0!important}",
      ".export-body{padding:0;max-width:100%}",
      ".export-toc{border:none;background:transparent;padding:0}",
      ".markdown-body a{color:#2f5fd0;text-decoration:underline}",
      ".markdown-body a[href^=\"http\"]::after{content:\" (\" attr(href) \")\";color:#5d6470}",
      ".markdown-body pre,.markdown-body code,.markdown-body blockquote,.markdown-body table,.markdown-body img,.markdown-body svg,.markdown-body .mermaid,.markdown-body .katex-display,.markdown-body figure{break-inside:avoid;page-break-inside:avoid}",
      ".markdown-body h1{break-before:page;page-break-before:always}",
      ".markdown-body>h1:first-child,.markdown-body>.export-toc+h1{break-before:auto;page-break-before:avoid}",
      ".markdown-body h2,.markdown-body h3{break-after:avoid;page-break-after:avoid}",
      ".export-body>.export-toc{break-before:page;page-break-before:always;break-after:page;page-break-after:always}",
    ];
  }

  /* The CSS embedded in an HTML export: the app's markdown rules + the
   * highlight.js theme, in the selected color theme (light or dark). Kept
   * in sync with style.css's .markdown-body block and the vendored
   * highlight-styles/github.css / github-dark.css. When `printPreview` is
   * true (the PDF preview path) the same print rules are also applied on
   * screen so the preview matches the printed output. */
  function exportCss(printPreview, paged) {
    const dark = selectedTheme() === "dark";
    const base = dark ? {
      bg: "#0d1117", fg: "#c9d1d9", border: "#30363d", muted: "#8b949e",
      link: "#58a6ff", codeBg: "#161b22", preBg: "#161b22",
      quoteBg: "rgba(88,166,255,.12)", quoteColor: "#8b949e",
      rowOdd: "#161b22", accent: "#58a6ff",
    } : {
      bg: "#fff", fg: "#1f2330", border: "#d8dde4", muted: "#5d6470",
      link: "#2f5fd0", codeBg: "#f0f2f5", preBg: "#f0f2f5",
      quoteBg: "rgba(47,95,208,.12)", quoteColor: "#5d6470",
      rowOdd: "#f6f7f9", accent: "#2f5fd0",
    };
    const hljs = dark ? DARK_HLJS : LIGHT_HLJS;
    return [
      // Base reset + print page setup. @page sizes the printable area
      // explicitly (browsers default to Letter with whatever margins they
      // feel like, which wastes space or clips content depending on the
      // engine); print-color-adjust makes blockquote backgrounds, code
      // blocks, table zebra stripes, and dark-mode colors actually render
      // in the PDF instead of being silently dropped to white.
      "@page{size:A4;margin:18mm 16mm}",
      "@page :first{margin-top:22mm}",
      "html{font-size:15px}",
      "body{margin:0;background:" + base.bg + ";color:" + base.fg + ";-webkit-print-color-adjust:exact;print-color-adjust:exact;font:16px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
      ".export-sidebar{position:fixed;top:0;left:0;bottom:0;width:" + SIDEBAR_WIDTH + "px;overflow-y:auto;background:" + base.rowOdd + ";border-right:1px solid " + base.border + ";padding:16px;box-sizing:border-box}",
      ".export-sidebar .export-toc{border:none;background:none;padding:0;margin:0}",
      ".export-sidebar .export-toc-title{font-size:1.1em;font-weight:700;margin:0 0 .6em;min-height:29px;display:flex;align-items:center;padding-left:46px}",
      // Both the hide and show hamburgers are pinned to the same top-left
      // spot, so the toggle does not move when the sidebar collapses; only
      // one is ever visible at a time.
      ".export-sidebar .export-toc-hide{position:fixed;left:12px;top:12px;z-index:10}",
      ".export-sidebar .export-toc-hide-input{position:absolute;opacity:0;pointer-events:none}",
      ".export-sidebar .export-toc-hide label,.export-toc-show{display:inline-block;padding:6px 11px;font-size:1.05em;line-height:1;cursor:pointer;color:" + base.fg + ";background:" + base.bg + ";border:1px solid " + base.border + ";border-radius:6px;box-shadow:0 1px 6px rgba(0,0,0,.15)}",
      ".export-sidebar .export-toc-hide label:hover,.export-toc-show:hover{background:" + base.quoteBg + "}",
      "body:has(.export-toc-hide-input:checked) .export-sidebar{display:none}",
      ".export-toc-show{position:fixed;left:12px;top:12px;z-index:10;display:none}",
      "body:has(.export-toc-hide-input:checked) .export-toc-show{display:block}",
      ".export-sidebar .export-toc-expandall{display:flex;align-items:center;justify-content:center;width:fit-content;margin:0 0 .6em 0;padding:5px 7px;cursor:pointer;color:" + base.fg + ";background:transparent;border:1px solid " + base.border + ";border-radius:6px;font-size:1em}",
      ".export-sidebar .export-toc-expandall:hover{background:" + base.quoteBg + "}",
      // The button has no visible text — the SVG is the label. Indent it
      // so its left edge lines up with the "Contents" title (which the
      // hamburger push down by 46px on the same row).
      ".export-sidebar .export-toc-expandall-icon{width:16px;height:16px;display:block;color:inherit;transform:rotate(0deg);transition:transform .15s ease}",
      ".export-sidebar .export-toc-expandall[aria-expanded=\"true\"] .export-toc-expandall-icon{transform:rotate(90deg)}",
      ".export-sidebar .export-toc ul{list-style:none;margin:0;padding:0}",
      ".export-sidebar .export-toc li{margin:.15em 0;line-height:1.4}",
      ".export-sidebar .export-toc summary{list-style:none;cursor:pointer;display:flex;align-items:baseline}",
      ".export-sidebar .export-toc summary::-webkit-details-marker{display:none}",
      ".export-sidebar .export-toc summary::before{content:'▾';color:" + base.muted + ";flex:none;margin-right:1ch}",
      ".export-sidebar .export-toc details:not([open])>summary::before{content:'▸'}",
      ".export-sidebar .export-toc summary.export-toc-leaf{cursor:default}",
      ".export-sidebar .export-toc summary.export-toc-leaf::before{content:'▸';visibility:hidden}",
      ".export-sidebar .export-toc summary.export-toc-leaf a{color:" + base.muted + "}",
      ".export-sidebar .export-toc summary.export-toc-leaf a:hover{background:transparent;text-decoration:none}",
      ".export-sidebar .export-toc a{color:" + base.link + ";text-decoration:none;display:block;flex:1;padding:3px 6px 3px 0;border-radius:4px}",
      ".export-sidebar .export-toc a:hover{background:" + base.quoteBg + ";text-decoration:none}",
      ".export-sidebar .export-toc .export-toc-children{margin-left:.9em;border-left:1px solid " + base.border + ";padding-left:.4em}",
      ".export-body{margin:0 auto;padding:32px 24px 80px}",
      ".export-body.export-width-fit{max-width:none}",
      ".export-body.export-width-80{max-width:80%}",
      ".export-body.export-width-full{max-width:none}",
      // Always reserve the sidebar's width as body padding so the content
      // stays anchored in place while the sidebar is toggled; the content's
      // `margin:0 auto` centers it in that fixed area. Hiding the sidebar
      // leaves the reserved gutter empty rather than shifting the content.
      "body:has(.export-sidebar){padding-left:" + SIDEBAR_WIDTH + "px}",
      "@media (max-width:900px){.export-sidebar{display:none}body:has(.export-sidebar){padding-left:0}}",
      // Inline (PDF) table of contents block. The border + background give
      // it weight on screen; in print we strip both so it sits as a clean
      // typography-only block that paginates with the page.
      ".export-toc{border:1px solid " + base.border + ";border-radius:8px;background:" + base.rowOdd + ";padding:14px 18px;margin:0 0 1.5em}",
      ".export-toc-title{margin:0 0 .4em;font-weight:650;font-size:1.05em}",
      ".export-toc ul{list-style:none;margin:0;padding:0}",
      ".export-toc li{margin:.15em 0}",
      ".export-toc a{color:" + base.link + ";text-decoration:none}",
      ".export-toc a:hover{text-decoration:underline}",
      ".export-toc-level-h2{padding-left:1.2em}",
      ".export-toc-level-h3{padding-left:2.4em}",
      ".markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{margin:1.4em 0 .5em;font-weight:650;line-height:1.25}",
      ".markdown-body> :first-child{margin-top:0}",
      ".markdown-body h1{font-size:1.9em;border-bottom:1px solid " + base.border + ";padding-bottom:.2em}",
      ".markdown-body h2{font-size:1.5em}",
      ".markdown-body h3{font-size:1.25em}",
      ".markdown-body p{margin:.7em 0}",
      ".markdown-body a{color:" + base.link + ";text-decoration:none}",
      ".markdown-body a:hover{text-decoration:underline}",
      ".markdown-body ul,.markdown-body ol{padding-left:1.6em}",
      ".markdown-body li{margin:.15em 0}",
      ".markdown-body blockquote{border-left:3px solid " + base.accent + ";margin:.8em 0;padding:.2em 1em;color:" + base.quoteColor + ";background:" + base.quoteBg + ";border-radius:0 6px 6px 0}",
      ".markdown-body code{font-family:'SFMono-Regular',Menlo,Consolas,monospace;background:" + base.codeBg + ";padding:.12em .4em;border-radius:4px;font-size:.9em}",
      ".markdown-body pre{background:" + base.preBg + ";border:1px solid " + base.border + ";border-radius:8px;padding:14px 16px;overflow-x:auto;white-space:pre}",
      ".markdown-body pre code{background:none;padding:0;font-size:.88em}",
      ".markdown-body table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}",
      ".markdown-body th,.markdown-body td{border:1px solid " + base.border + ";padding:6px 10px;text-align:left;vertical-align:top}",
      ".markdown-body tbody tr:nth-child(odd){background:" + base.rowOdd + "}",
      ".markdown-body hr{border:none;border-top:1px solid " + base.border + ";margin:1.5em 0}",
      ".markdown-body img{max-width:100%;height:auto}",
      ".markdown-body svg{max-width:100%;height:auto}",
      // Diagram hosts — keep each diagram on one page.
      ".markdown-body .mermaid,.markdown-body .katex-display,.markdown-body figure,.markdown-body pre,.markdown-body table,.markdown-body blockquote,.markdown-body img,.markdown-body svg{break-inside:avoid;page-break-inside:avoid}",
      // Headings: each h1 starts a new page in print (except the first
      // heading of the document, which sits at the top of page 1).
      ".markdown-body h1{break-before:page;page-break-before:always}",
      ".markdown-body>h1:first-child,.markdown-body>.export-toc+h1{break-before:auto;page-break-before:avoid}",
      ".markdown-body h2,.markdown-body h3{break-after:avoid;page-break-after:avoid}",
      ".markdown-body a[href^=\"http\"]::after{content:\" (\" attr(href) \")\";font-size:.85em;color:" + base.muted + "}",
      // Inline TOC on a new page so it isn't crammed onto page 1 with the
      // title. The first child of <main> is either the inline TOC (PDF
      // path) or the first content heading; in both cases the inline TOC
      // should sit alone on its own page before the body.
      ".export-body>.export-toc{break-before:page;page-break-before:always;break-after:page;page-break-after:always}",
      // --- Print rules -------------------------------------------------
      // The fixed-position sidebar and toggle buttons don't paginate and
      // are pointless on paper; force-disable them so the printed page
      // uses the full printable area and has no orphaned chrome. Dark
      // theme is also dropped to a light palette in print: a dark
      // background in a PDF costs ink and hurts contrast, and most
      // printed notes are meant to read on paper, not on screen.
      "@media print{",
      printRules().map(r => "  " + r).join("\n"),
      "}",
      // On-screen PDF preview: apply the same pagination/theme rules so the
      // browser tab looks like the printed page. A grey backdrop and a
      // fixed-width white sheet mirror the A4 printable area (210mm minus
      // the two 16mm @page margins = 178mm). Everything here is inside
      // @media screen — the 1px outline is only a visual sheet edge on
      // screen and must never print as a border around the page.
      printPreview
        ? "@media screen{" + printRules().join("") +
          "body{background:#e9ecef!important}" +
          ".export-body{max-width:178mm!important;margin:0 auto;background:#fff!important;box-shadow:0 0 0 1px " + base.border + "}" +
          "}"
        : "",
      // Paged.js preview: the polyfill replaces the single continuous
      // <main> with real page sheets. Style the generated sheets so each
      // page reads as a distinct white A4 sheet on the grey backdrop.
      paged
        ? "@media screen{" +
            "body{background:#e9ecef!important;margin:0!important}" +
            ".pagedjs_pages{display:flex;flex-direction:column;align-items:center;gap:16px;padding:16px 0}" +
            ".pagedjs_page{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18);margin:0!important}" +
            ".pagedjs_page .export-body{max-width:none!important;margin:0!important;box-shadow:none!important}" +
          "}" +
          "@media print{.pagedjs_pages{display:block;padding:0}.pagedjs_page{box-shadow:none;margin:0!important}}"
        : "",
      hljs,
    ].join("\n");
  }

  /* Inlined highlight.js themes (github.css / github-dark.css). */
  const LIGHT_HLJS = [
    "pre code.hljs{display:block;overflow-x:auto;padding:1em}",
    "code.hljs{padding:3px 5px}",
    ".hljs{color:#24292e;background:#fff}",
    ".hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#d73a49}",
    ".hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#6f42c1}",
    ".hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-variable,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id{color:#005cc5}",
    ".hljs-regexp,.hljs-string,.hljs-meta .hljs-string{color:#032f62}",
    ".hljs-built_in,.hljs-symbol{color:#e36209}",
    ".hljs-comment,.hljs-code,.hljs-formula{color:#6a737d}",
    ".hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo{color:#22863a}",
    ".hljs-subst{color:#24292e}",
    ".hljs-section{color:#005cc5;font-weight:bold}",
    ".hljs-bullet{color:#735c0f}",
    ".hljs-emphasis{color:#24292e;font-style:italic}",
    ".hljs-strong{color:#24292e;font-weight:bold}",
    ".hljs-addition{color:#22863a;background-color:#f0fff4}",
    ".hljs-deletion{color:#b31d28;background-color:#ffeef0}",
  ].join("\n");

  const DARK_HLJS = [
    "pre code.hljs{display:block;overflow-x:auto;padding:1em}",
    "code.hljs{padding:3px 5px}",
    ".hljs{color:#c9d1d9;background:#0d1117}",
    ".hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#ff7b72}",
    ".hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#d2a8ff}",
    ".hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#79c0ff}",
    ".hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#a5d6ff}",
    ".hljs-built_in,.hljs-symbol{color:#ffa657}",
    ".hljs-code,.hljs-comment,.hljs-formula{color:#8b949e}",
    ".hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#7ee787}",
    ".hljs-subst{color:#c9d1d9}",
    ".hljs-section{color:#1f6feb;font-weight:bold}",
    ".hljs-bullet{color:#f2cc60}",
    ".hljs-emphasis{color:#c9d1d9;font-style:italic}",
    ".hljs-strong{color:#c9d1d9;font-weight:bold}",
    ".hljs-addition{color:#aff5b4;background-color:#033a16}",
    ".hljs-deletion{color:#ffdcd7;background-color:#67060c}",
  ].join("\n");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* --- wiring -------------------------------------------------------- */
  function run() {
    if (errorEl) errorEl.hidden = true;
    const fmt = selectedFormat();
    const scope = selectedScope();
    const p = (fmt === "html") ? exportHtml(scope) : exportPdf(scope);
    p.catch(e => {
      if (errorEl) { errorEl.textContent = (e && e.message) || "Export failed."; errorEl.hidden = false; }
      else alert("Export failed: " + ((e && e.message) || e));
    });
  }

  /* Open a preview in a new browser tab without downloading it. The
   * preview respects the selected format: HTML shows the sidebar layout as
   * it will be exported, while PDF shows the real paginated document —
   * Paged.js renders it into page-by-page A4 sheets using the same @page
   * geometry and break rules the print dialog uses, so what the preview
   * shows is what the exported PDF contains. */
  function preview() {
    if (errorEl) errorEl.hidden = true;
    const path = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    if (!path) { if (errorEl) { errorEl.textContent = "No file is open to preview."; errorEl.hidden = false; } return; }
    const scope = selectedScope();
    const isPdf = selectedFormat() === "pdf";
    buildExportDoc(scope, isPdf ? null : "sidebar", isPdf, isPdf).then(({ html }) => {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(e => {
      if (errorEl) { errorEl.textContent = (e && e.message) || "Preview failed."; errorEl.hidden = false; }
      else alert("Preview failed: " + ((e && e.message) || e));
    });
  }

  if (exportBtn) exportBtn.addEventListener("click", run);
  if (previewBtn) previewBtn.addEventListener("click", preview);
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (closeFooterBtn) closeFooterBtn.addEventListener("click", close);
  if (overlayEl) {
    overlayEl.addEventListener("click", (e) => { if (e.target === overlayEl) close(); });
  }
  // Show/hide the section dropdown as the scope radio changes.
  scopeRadios.forEach(r => r.addEventListener("change", refreshSections));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  NB.export = { open, close, isOpen, exportPdf, exportHtml, preview, extractHeadings, sliceSection };
})();
