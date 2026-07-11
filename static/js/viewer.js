/* viewer.js -- render Markdown client-side with marked.js + highlight.js.
 * Also owns the edit/view toggle and the search "jump to match" helper.
 *
 * NOTE: notebooks are the user's own files in data/, so we render them
 * un-sanitized. If untrusted content is ever introduced, add DOMPurify
 * (vendored) and sanitize before setting innerHTML.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const viewerEl  = document.getElementById("viewer");
  const editorEl  = document.getElementById("raw-editor");
  const editBtn   = document.getElementById("edit-toggle");

  const state = { path: null, content: "", editMode: false };

  /* --- slug + dedup for heading ids ----------------------------------- */
  let seenIds = {};

  function slugify(text) {
    const base = String(text)
      .replace(/<[^>]+>/g, "")      // strip any inline html
      .replace(/[^\w\s-]/g, "")      // drop punctuation
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-") || "heading";
    let id = base, n = 2;
    while (seenIds[id]) { id = base + "-" + (n++); }
    seenIds[id] = true;
    return id;
  }
  NB.slugify = slugify; // exposed for potential reuse

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* --- render --------------------------------------------------------- */
  /* We let marked render with its defaults, then post-process the DOM:
   *   - assign ids to headings (for the outline + click-to-scroll)
   *   - run highlight.js on code blocks
   * This avoids marked's custom-renderer `this.parser` binding, which is
   * unreliable across marked versions. */
  function render() {
    seenIds = {}; // reset dedup per render
    if (window.marked) {
      viewerEl.innerHTML = marked.parse(state.content || "",
        { gfm: true, breaks: false });
    } else {
      viewerEl.innerHTML = "<p>marked.js failed to load.</p>";
      return;
    }

    // Heading ids (deduped).
    viewerEl.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(h => {
      h.id = slugify(h.textContent);
    });

    // Syntax highlighting via highlight.js (vendored).
    if (window.hljs) {
      viewerEl.querySelectorAll("pre code").forEach(el => {
        try { hljs.highlightElement(el); }
        catch (e) { /* fall back to plain text already in place */ }
      });
    }

    if (NB.outline) {
      NB.outline.build(viewerEl);
      NB.outline.startWatching(viewerEl);
    }
  }

  /* --- public API ----------------------------------------------------- */
  const viewer = {
    async open(path) {
      const data = await NB.api.getFile(path);
      state.path = path;
      state.content = data.content || "";
      if (state.editMode) { editorEl.value = state.content; }
      render();
      NB.evt.emit("file:open", path);
      return state.content;
    },

    getPath() { return state.path; },
    getContent() { return state.editMode ? editorEl.value : state.content; },

    startEdit() {
      state.editMode = true;
      editorEl.value = state.content;
      editorEl.hidden = false;
      viewerEl.hidden = true;
      editBtn.textContent = "Preview";
      editorEl.focus();
    },

    endEdit() {
      if (state.editMode) state.content = editorEl.value;
      state.editMode = false;
      editorEl.hidden = true;
      viewerEl.hidden = false;
      editBtn.textContent = "Edit";
      render();
    },

    toggleEdit() { state.editMode ? this.endEdit() : this.startEdit(); },

    async save() {
      if (!state.path) { alert("No file open."); return; }
      const content = state.editMode ? editorEl.value : state.content;
      await NB.api.saveFile(state.path, content);
      state.content = content;
      if (state.editMode) this.endEdit(); else render();
      NB.evt.emit("file:saved", state.path);
    },

    /* Jump to the first occurrence of `term` in the rendered DOM and
     * scroll it into view. Used by search.js on result click. */
    jumpToMatch(term, caseSensitive) {
      if (!term) return;
      const flags = caseSensitive ? "" : "i";
      const re = new RegExp(escapeRegex(term), flags);
      const walker = document.createTreeWalker(
        viewerEl, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const txt = node.nodeValue;
        const m = re.exec(txt);
        if (m) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const mark = document.createElement("mark");
          mark.className = "search-highlight";
          range.surroundContents(mark);
          mark.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
      }
      return false;
    },
  };

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  NB.viewer = viewer;
})();