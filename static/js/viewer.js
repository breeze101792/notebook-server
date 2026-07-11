/* viewer.js -- render Markdown client-side with marked.js + highlight.js.
 * Owns a per-file content/edit cache; the active file is driven by NB.tabs.
 * Also owns the edit/view toggle and the search "jump to match" helper.
 *
 * NOTE: notebooks are the user's own files in data/, so we render them
 * un-sanitized. If untrusted content is ever introduced, add DOMPurify
 * (vendored) and sanitize before setting innerHTML.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const viewerEl = document.getElementById("viewer");
  const editorEl = document.getElementById("raw-editor");
  const editBtn  = document.getElementById("edit-toggle");

  // path -> { content, editMode, savedContent }
  const cache = new Map();
  let active = null;   // path currently displayed

  function cur() { return active ? cache.get(active) : null; }

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

  /* --- render --------------------------------------------------------- */
  /* We let marked render with its defaults, then post-process the DOM:
   *   - assign ids to headings (for the outline + click-to-scroll)
   *   - run highlight.js on code blocks
   * This avoids marked's custom-renderer `this.parser` binding, which is
   * unreliable across marked versions. */
  function render() {
    const t = cur();
    if (!t) { viewerEl.innerHTML = ""; return; }
    seenIds = {}; // reset dedup per render
    if (window.marked) {
      viewerEl.innerHTML = marked.parse(t.content || "",
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

  function showViewer() {
    editorEl.hidden = true;
    viewerEl.hidden = false;
    editBtn.textContent = "Edit";
  }
  function showEditor() {
    editorEl.hidden = false;
    viewerEl.hidden = true;
    editBtn.textContent = "Preview";
    editorEl.focus();
  }

  /* --- public API ----------------------------------------------------- */
  const viewer = {
    /* Load `path` into the cache (fetch on miss) and show it. Emits
     * file:open so the sidebar highlight and recent list stay in sync.
     * Flushes any in-flight textarea edits from the tab being left into its
     * cache entry, so unsaved edits survive switching tabs mid-edit. */
    async activate(path) {
      if (active && active !== path) {
        const prev = cache.get(active);
        if (prev && prev.editMode) prev.content = editorEl.value;
      }
      let t = cache.get(path);
      if (!t) {
        const data = await NB.api.getFile(path);
        const content = (data && data.content) || "";
        t = { content, editMode: false, savedContent: content };
        cache.set(path, t);
      }
      active = path;
      if (t.editMode) { editorEl.value = t.content; showEditor(); }
      else { showViewer(); render(); }
      NB.evt.emit("file:open", path);
      return t.content;
    },

    /* Drop the cache for a closed tab. */
    close(path) {
      cache.delete(path);
      if (active === path) active = null;
    },

    /* Re-key a tab when its file is moved/renamed; unsaved edits travel. */
    rename(from, to) {
      const t = cache.get(from);
      if (t) { cache.delete(from); cache.set(to, t); }
      if (active === from) active = to;
    },

    /* No tabs open: show a placeholder. */
    clear() {
      active = null;
      cache.clear();
      editorEl.hidden = true;
      viewerEl.hidden = false;
      editBtn.textContent = "Edit";
      viewerEl.innerHTML =
        '<p style="color:var(--fg-muted)">No file selected.</p>';
      if (NB.outline) NB.outline.build(viewerEl);
    },

    getPath() { return active; },
    getContent() { const t = cur(); return t ? (t.editMode ? editorEl.value : t.content) : ""; },
    isDirty(path) {
      const t = cache.get(path);
      if (!t) return false;
      const current = (path === active && t.editMode) ? editorEl.value : t.content;
      return current !== t.savedContent;
    },

    startEdit() {
      const t = cur(); if (!t) return;
      t.editMode = true;
      editorEl.value = t.content;
      showEditor();
    },
    endEdit() {
      const t = cur(); if (!t) return;
      t.content = editorEl.value;
      t.editMode = false;
      showViewer();
      render();
      NB.evt.emit("viewer:dirty-changed", { path: active, dirty: viewer.isDirty(active) });
    },
    toggleEdit() { const t = cur(); if (!t) return; t.editMode ? this.endEdit() : this.startEdit(); },

    async save() {
      const t = cur();
      if (!t) { alert("No file open."); return; }
      const content = t.editMode ? editorEl.value : t.content;
      await NB.api.saveFile(active, content);
      t.content = content;
      t.savedContent = content;
      if (t.editMode) { t.editMode = false; showViewer(); render(); }
      NB.evt.emit("viewer:dirty-changed", { path: active, dirty: false });
      NB.evt.emit("file:saved", active);
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

  /* Live dirty dot: while editing, report changed-dirty so the tab bar
   * can mark the active file's tab without a full re-render. */
  editorEl.addEventListener("input", () => {
    if (!active) return;
    NB.evt.emit("viewer:dirty-changed", { path: active, dirty: viewer.isDirty(active) });
  });

  NB.viewer = viewer;
})();