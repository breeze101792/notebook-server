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
  const widthRadios  = Array.from(document.querySelectorAll('input[name="export-width"]'));
  const themeRadios  = Array.from(document.querySelectorAll('input[name="export-theme"]'));
  const tocCheckbox  = document.getElementById("export-toc");
  const exportBtn    = document.getElementById("export-run");
  const previewBtn   = document.getElementById("export-preview");
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
   */
  function buildToc(host, mode) {
    const headings = Array.from(host.querySelectorAll("h1,h2,h3"));
    if (headings.length === 0) return null;
    const isSidebar = mode === "sidebar";

    const nav = document.createElement("nav");
    nav.className = "export-toc";
    const title = document.createElement("p");
    title.className = "export-toc-title";
    title.textContent = "Contents";
    nav.appendChild(title);

    let hideBtn = null;
    if (isSidebar) {
      hideBtn = document.createElement("button");
      hideBtn.type = "button";
      hideBtn.className = "export-toc-hide";
      hideBtn.textContent = "Hide sidebar";
      nav.appendChild(hideBtn);
    }

    const list = document.createElement("ul");
    list.className = "export-toc-root";

    if (isSidebar) {
      // Nested tree. Headings come in document order; nest each heading
      // under the most recent heading at a level one above it.
      const stack = [];
      for (const h of headings) {
        const level = parseInt(h.tagName.slice(1), 10);
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#" + (h.id || "");
        a.textContent = h.textContent;
        li.appendChild(a);
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        let parentUl = list;
        if (stack.length) {
          let children = stack[stack.length - 1].li.querySelector("ul.export-toc-children");
          if (!children) {
            children = document.createElement("ul");
            children.className = "export-toc-children";
            children.hidden = true;
            stack[stack.length - 1].li.appendChild(children);
          }
          parentUl = children;
          // Add a ▸/▾ toggle to the parent so it can expand/collapse.
          addToggle(stack[stack.length - 1].a, children);
        }
        parentUl.appendChild(li);
        stack.push({ level, li, a });
      }
      // Only h1 visible by default: collapse every nested branch.
      nav.querySelectorAll("ul.export-toc-children").forEach(u => { u.hidden = true; });
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

    nav.appendChild(list);

    if (isSidebar) {
      // Hide button collapses the whole sidebar.
      hideBtn.addEventListener("click", () => {
        nav.closest(".export-sidebar").classList.add("collapsed");
        document.body.classList.add("export-sidebar-hidden");
      });
    }

    return nav;
  }

  /* Add (or move, if present) a ▸/▾ collapse toggle to a TOC heading
   * that has children, and wire it to toggle the children <ul>. */
  function addToggle(a, childrenUl) {
    if (!a.querySelector(".export-toc-toggle")) {
      const toggle = document.createElement("span");
      toggle.className = "export-toc-toggle";
      toggle.textContent = "▸";
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        childrenUl.hidden = !childrenUl.hidden;
        toggle.textContent = childrenUl.hidden ? "▸" : "▾";
      });
      a.appendChild(toggle);
    }
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

    // Table of contents (h1-h3), prepended when requested.
    if (includeToc()) {
      const toc = buildToc(host, tocMode);
      if (toc) host.insertBefore(toc, host.firstChild);
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
    return renderInto(host, scope, "sidebar").then(() => {
      const title = path.split("/").pop().replace(/\.md$/i, "") || "note";
      const css = exportCss();
      // The width/theme classes are set on `host` by renderInto; carry them
      // onto the exported <main> so the embedded CSS can style the page.
      const mainClass = ["markdown-body", "export-body"]
        .concat(Array.from(host.classList).filter(c => c.indexOf("export-width-") === 0 || c.indexOf("export-theme-") === 0))
        .join(" ");
      // Pull the TOC nav out of the content (renderInto prepends it) and
      // place it in a fixed sidebar instead of inline.
      const toc = host.querySelector(".export-toc");
      const tocHtml = toc ? toc.outerHTML : "";
      if (toc) toc.remove();
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
        (tocHtml ? "  <aside class=\"export-sidebar\">" + tocHtml + "</aside>\n" : "") +
        "  <main class=\"" + mainClass + "\">\n" +
        host.innerHTML +
        "  </main>\n" +
        "</body>\n" +
        "</html>\n";
      downloadBlob(html, title + ".html", "text/html;charset=utf-8");
    });
  }

  /* The CSS embedded in an HTML export: the app's markdown rules + the
   * highlight.js theme, in the selected color theme (light or dark). Kept
   * in sync with style.css's .markdown-body block and the vendored
   * highlight-styles/github.css / github-dark.css. */
  function exportCss() {
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
      "body{margin:0;background:" + base.bg + ";color:" + base.fg + ";font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
      ".export-sidebar{position:fixed;top:0;left:0;bottom:0;width:240px;overflow-y:auto;background:" + base.rowOdd + ";border-right:1px solid " + base.border + ";padding:16px;box-sizing:border-box}",
      ".export-sidebar .export-toc{border:none;background:none;padding:0;margin:0}",
      ".export-sidebar .export-toc-title{font-size:1.1em;font-weight:700;margin:0 0 .6em}",
      ".export-sidebar .export-toc-hide{display:block;width:100%;margin-bottom:.8em;padding:5px 8px;font-size:.85em;text-align:center;cursor:pointer;color:" + base.fg + ";background:transparent;border:1px solid " + base.border + ";border-radius:6px}",
      ".export-sidebar .export-toc-hide:hover{background:" + base.quoteBg + "}",
      ".export-sidebar .export-toc ul{list-style:none;margin:0;padding:0}",
      ".export-sidebar .export-toc li{margin:.15em 0;line-height:1.4}",
      ".export-sidebar .export-toc a{color:" + base.link + ";text-decoration:none;display:block;padding:3px 6px;border-radius:4px;cursor:pointer}",
      ".export-sidebar .export-toc a:hover{background:" + base.quoteBg + ";text-decoration:none}",
      ".export-sidebar .export-toc .export-toc-children{margin-left:.9em;border-left:1px solid " + base.border + ";padding-left:.4em}",
      ".export-sidebar.collapsed{display:none}",
      ".export-sidebar .export-toc-toggle{margin-left:4px;color:" + base.muted + ";font-weight:400}",
      ".export-body{max-width:820px;margin:0 auto;padding:32px 24px 80px}",
      ".export-body.export-width-fit{max-width:820px}",
      ".export-body.export-width-80{max-width:80%}",
      ".export-body.export-width-full{max-width:none}",
      "body:has(.export-sidebar) .export-body{margin-left:240px}",
      "body.export-sidebar-hidden:has(.export-sidebar) .export-body{margin-left:auto}",
      "@media (max-width:900px){.export-sidebar{display:none}body:has(.export-sidebar) .export-body{margin-left:auto}}",
      // Inline (PDF) table of contents block.
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
      ".markdown-body a{color:" + base.link + "}",
      ".markdown-body ul,.markdown-body ol{padding-left:1.6em}",
      ".markdown-body blockquote{border-left:3px solid " + base.accent + ";margin:.8em 0;padding:.2em 1em;color:" + base.quoteColor + ";background:" + base.quoteBg + ";border-radius:0 6px 6px 0}",
      ".markdown-body code{font-family:'SFMono-Regular',Menlo,Consolas,monospace;background:" + base.codeBg + ";padding:.12em .4em;border-radius:4px;font-size:.9em}",
      ".markdown-body pre{background:" + base.preBg + ";border:1px solid " + base.border + ";border-radius:8px;padding:14px 16px;overflow-x:auto}",
      ".markdown-body pre code{background:none;padding:0;font-size:.88em}",
      ".markdown-body table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto}",
      ".markdown-body th,.markdown-body td{border:1px solid " + base.border + ";padding:6px 10px}",
      ".markdown-body tbody tr:nth-child(odd){background:" + base.rowOdd + "}",
      ".markdown-body hr{border:none;border-top:1px solid " + base.border + ";margin:1.5em 0}",
      ".markdown-body img{max-width:100%}",
      ".markdown-body svg{max-width:100%;height:auto}",
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

  /* Open the exported HTML in a new browser tab without downloading it.
   * Only meaningful for the HTML format (PDF goes through the print
   * dialog, which is its own preview). */
  function preview() {
    if (errorEl) errorEl.hidden = true;
    const scope = selectedScope();
    const path = targetPath || (NB.viewer && NB.viewer.getPath()) || "";
    if (!path) { if (errorEl) { errorEl.textContent = "No file is open to preview."; errorEl.hidden = false; } return; }
    const host = document.createElement("div");
    host.className = "markdown-body";
    renderInto(host, scope, "sidebar").then(() => {
      const title = path.split("/").pop().replace(/\.md$/i, "") || "note";
      const css = exportCss();
      const mainClass = ["markdown-body", "export-body"]
        .concat(Array.from(host.classList).filter(c => c.indexOf("export-width-") === 0 || c.indexOf("export-theme-") === 0))
        .join(" ");
      const toc = host.querySelector(".export-toc");
      const tocHtml = toc ? toc.outerHTML : "";
      if (toc) toc.remove();
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
        (tocHtml ? "  <aside class=\"export-sidebar\">" + tocHtml + "</aside>\n" : "") +
        "  <main class=\"" + mainClass + "\">\n" +
        host.innerHTML +
        "  </main>\n" +
        "</body>\n" +
        "</html>\n";
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }).catch(e => {
      if (errorEl) { errorEl.textContent = (e && e.message) || "Preview failed."; errorEl.hidden = false; }
      else alert("Preview failed: " + ((e && e.message) || e));
    });
  }

  const topbarBtn = document.getElementById("export-toggle");
  if (topbarBtn) topbarBtn.addEventListener("click", open);
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
