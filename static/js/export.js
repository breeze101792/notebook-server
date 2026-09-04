/* export.js -- export the current note to PDF (browser print-to-PDF) or
 * a self-contained HTML file.
 *
 * The app renders Markdown client-side (marked + highlight.js + mermaid /
 * katex / wavedrom / graphviz), so the most faithful export is produced by
 * re-rendering the active note into a dedicated print container and letting
 * the browser's print dialog save it as a PDF. A print stylesheet hides the
 * app chrome (topbar, sidebars, tabs, outline) and shows only that container,
 * so the PDF matches what the user sees in the viewer.
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
  const exportBtn    = document.getElementById("export-run");
  const fileLabelEl  = document.getElementById("export-file-label");
  const sectionRowEl = document.getElementById("export-section-row");
  const sectionSelectEl = document.getElementById("export-section-select");
  const errorEl      = document.getElementById("export-error");

  // The print container is created lazily and reused. It lives as a direct
  // child of <body> so the print stylesheet can target it cleanly.
  let printHost = null;

  // The file the modal is exporting. null means "the active file" (the
  // top-bar Export button); a path means a specific file (the sidebar /
  // tab context menus), which may not be the active tab.
  let targetPath = null;

  function selectedFormat() {
    const r = formatRadios.find(x => x.checked);
    return r ? r.value : "pdf";
  }
  function selectedScope() {
    const r = scopeRadios.find(x => x.checked);
    return r ? r.value : "current";
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
  async function renderInto(host, scope) {
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

  /* --- PDF via browser print-to-PDF --------------------------------- */
  /* Render the active note into the print host, then open the print
   * dialog. The @media print stylesheet (style.css) hides the app chrome
   * and shows only #print-host, so the user's "Save as PDF" captures the
   * note alone. */
  async function exportPdf(scope) {
    if (!printHost) {
      printHost = document.createElement("div");
      printHost.id = "print-host";
      printHost.className = "markdown-body";
      document.body.appendChild(printHost);
    }
    await renderInto(printHost, scope);
    // Give the browser a moment to lay out the freshly-rendered content
    // (diagram SVGs in particular) before the print snapshot is taken.
    await new Promise(r => setTimeout(r, 50));
    window.print();
  }

  /* --- self-contained HTML export ----------------------------------- */
  /* Build a standalone .html file: the rendered note + embedded styles
   * (the app's markdown rules + the light highlight.js theme) + the
   * diagram SVGs already baked in. Downloaded via a Blob. */
  function exportHtml(scope) {
    const path = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    if (!path) throw new Error("No file is open to export.");

    const host = document.createElement("div");
    host.className = "markdown-body";
    // Render synchronously enough for HTML export: diagrams are async, so
    // we render the base markdown + highlight now and let the caller await
    // the diagram pass before serializing. To keep this simple we reuse
    // renderInto on a detached node.
    return renderInto(host, scope).then(() => {
      const title = path.split("/").pop().replace(/\.md$/i, "") || "note";
      const css = exportCss();
      const html =
        "<!DOCTYPE html>\n" +
        "<html lang=\"en\">\n" +
        "<head>\n" +
        "  <meta charset=\"utf-8\">\n" +
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
        "  <title>" + escapeHtml(title) + "</title>\n" +
        "  <style>" + css + "</style>\n" +
        "</head>\n" +
        "<body>\n" +
        "  <main class=\"markdown-body export-body\">\n" +
        host.innerHTML +
        "  </main>\n" +
        "</body>\n" +
        "</html>\n";
      downloadBlob(html, title + ".html", "text/html;charset=utf-8");
    });
  }

  /* The CSS embedded in an HTML export: the app's markdown rules (light
   * theme) + the light highlight.js theme. Kept in sync with style.css's
   * .markdown-body block and static/vendor/highlight-styles/github.css. */
  function exportCss() {
    return [
      "body{margin:0;background:#fff;color:#1f2330;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
      ".export-body{max-width:820px;margin:0 auto;padding:32px 24px 80px}",
      ".markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{margin:1.4em 0 .5em;font-weight:650;line-height:1.25}",
      ".markdown-body> :first-child{margin-top:0}",
      ".markdown-body h1{font-size:1.9em;border-bottom:1px solid #d8dde4;padding-bottom:.2em}",
      ".markdown-body h2{font-size:1.5em}",
      ".markdown-body h3{font-size:1.25em}",
      ".markdown-body p{margin:.7em 0}",
      ".markdown-body a{color:#2f5fd0}",
      ".markdown-body ul,.markdown-body ol{padding-left:1.6em}",
      ".markdown-body blockquote{border-left:3px solid #2f5fd0;margin:.8em 0;padding:.2em 1em;color:#5d6470;background:rgba(47,95,208,.12);border-radius:0 6px 6px 0}",
      ".markdown-body code{font-family:'SFMono-Regular',Menlo,Consolas,monospace;background:#f0f2f5;padding:.12em .4em;border-radius:4px;font-size:.9em}",
      ".markdown-body pre{background:#f0f2f5;border:1px solid #d8dde4;border-radius:8px;padding:14px 16px;overflow-x:auto}",
      ".markdown-body pre code{background:none;padding:0;font-size:.88em}",
      ".markdown-body table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}",
      ".markdown-body th,.markdown-body td{border:1px solid #d8dde4;padding:6px 10px}",
      ".markdown-body tbody tr:nth-child(odd){background:#f6f7f9}",
      ".markdown-body hr{border:none;border-top:1px solid #d8dde4;margin:1.5em 0}",
      ".markdown-body img{max-width:100%}",
      ".markdown-body svg{max-width:100%;height:auto}",
      // Light highlight.js theme (github.css), inlined.
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
  }

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

  const topbarBtn = document.getElementById("export-toggle");
  if (topbarBtn) topbarBtn.addEventListener("click", open);
  if (exportBtn) exportBtn.addEventListener("click", run);
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

  NB.export = { open, close, isOpen, exportPdf, exportHtml, extractHeadings, sliceSection };
})();
