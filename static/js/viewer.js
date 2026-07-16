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

  // #viewer is the non-scrolling shell; #viewer-content is the scroller
  // that holds the rendered markdown. Operations on the content (render,
  // scroll, query) target viewerContentEl; visibility toggles target
  // viewerEl (the shell) so the whole pane disappears at once.
  const viewerEl        = document.getElementById("viewer");
  const viewerContentEl = document.getElementById("viewer-content");
  const welcomeEl       = document.getElementById("welcome");
  const editorEl   = document.getElementById("raw-editor");
  const editSplit  = document.getElementById("edit-split");
  const topbar     = document.getElementById("topbar");
  const editBtn    = document.getElementById("edit-toggle");
  const previewBtn = document.getElementById("preview-btn");
  const saveBtn    = document.getElementById("save-btn");
  const closeEditBtn = document.getElementById("close-edit-btn");

  // path -> { content, editMode, savedContent }
  const cache = new Map();
  let active = null;   // path currently displayed
  let showPreview = true;  // preview pane visible in edit mode
  let liveTimer = null;    // debounce timer for live preview

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
   * unreliable across marked versions.
   *
   * When `content` is passed (live preview), use it directly instead of
   * reading from the cache. The outline is NOT rebuilt during live preview
   * (it would flicker on every keystroke). */
  function render(content) {
    const src = content !== undefined ? content : (cur() ? cur().content : null);
    if (src == null) { viewerContentEl.innerHTML = ""; return; }
    seenIds = {}; // reset dedup per render
    if (window.marked) {
      viewerContentEl.innerHTML = marked.parse(src, { gfm: true, breaks: false });
    } else {
      viewerContentEl.innerHTML = "<p>marked.js failed to load.</p>";
      return;
    }

    // Heading ids (deduped).
    viewerContentEl.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(h => {
      h.id = slugify(h.textContent);
    });

    // Syntax highlighting via highlight.js (vendored).
    if (window.hljs) {
      viewerContentEl.querySelectorAll("pre code").forEach(el => {
        try { hljs.highlightElement(el); }
        catch (e) { /* fall back to plain text already in place */ }
      });
    }

    // Only rebuild the outline for the "real" render (not live preview).
    if (content === undefined && NB.outline) {
      NB.outline.build(viewerContentEl);
      NB.outline.startWatching(viewerContentEl);
    }
  }

  /* Debounced live preview: re-render the viewer from the textarea content.
   * Called on every keystroke; the actual render fires ~150ms after the
   * user stops typing. */
  function scheduleLivePreview() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (!active || !showPreview) return;
      render(editorEl.value);
    }, 150);
  }

  /* --- top-bar / edit-bar mode ------------------------------------ */
  /* Preview mode: the top bar shows [Edit] in the default color.
   * Edit mode: the Edit button stays visible but gets an accent color
   * to indicate we're editing; the top bar also gets a tint. The edit
   * bar appears under the tabs, and the main area splits into editor
   * (left) + live preview (right). */
  function refreshTopbar() {
    const t = cur();
    const inEdit = !!(t && t.editMode);
    setEditModeLabel(inEdit);
    if (inEdit) {
      editBtn.classList.add("editing");
    } else {
      editBtn.classList.remove("editing");
    }
    if (inEdit) {
      saveBtn.hidden = !viewer.isDirty(active);
      closeEditBtn.classList.toggle("unsaved", viewer.isDirty(active));
      topbar.classList.add("editing");
    } else {
      topbar.classList.remove("editing");
    }
  }

  /* The top-bar Edit button toggles a state, so its label should describe
   * the *next* action the click will take, not the current state. Stash
   * the original text on first use so the helper is idempotent. */
  function setEditModeLabel(inEdit) {
    if (editBtn.dataset.originalLabel == null) {
      editBtn.dataset.originalLabel = editBtn.textContent;
    }
    editBtn.textContent = inEdit ? "View" : editBtn.dataset.originalLabel;
  }

  /* --- scroll sync -------------------------------------------------- */
  /* While the split pane is visible, scrolling one side proportionally
   * scrolls the other so the user can see the same spot in both. A guard
   * flag prevents the scroll event we fire from re-triggering the sync. */
  let syncing = false;

  function syncScroll(source, target) {
    if (syncing) return;
    const srcMax = source.scrollHeight - source.clientHeight;
    const tgtMax = target.scrollHeight - target.clientHeight;
    if (srcMax <= 0 || tgtMax <= 0) return;
    const pct = source.scrollTop / srcMax;
    syncing = true;
    target.scrollTop = pct * tgtMax;
    requestAnimationFrame(() => { syncing = false; });
  }

  function onEditorScroll() { syncScroll(editorEl, viewerContentEl); }
  function onViewerScroll() { syncScroll(viewerContentEl, editorEl); }

  function showViewer() {
    clearTimeout(liveTimer);
    editSplit.classList.remove("split");
    editorEl.hidden = true;
    viewerEl.hidden = false;
    // The welcome page is the empty-state sibling of #viewer; hide it
    // whenever a file is actually shown, so it doesn't stack on top
    // of the markdown content visually.
    if (welcomeEl) welcomeEl.hidden = true;
    editorEl.removeEventListener("scroll", onEditorScroll);
    viewerContentEl.removeEventListener("scroll", onViewerScroll);
    refreshTopbar();
    if (NB.editbar) NB.editbar.hide();
  }
  function showEditor() {
    editorEl.hidden = false;
    viewerEl.hidden = !showPreview;
    if (welcomeEl) welcomeEl.hidden = true;
    previewBtn.classList.toggle("editing", showPreview);
    if (showPreview) {
      editSplit.classList.add("split");
      render(editorEl.value);
      editorEl.addEventListener("scroll", onEditorScroll, { passive: true });
      viewerContentEl.addEventListener("scroll", onViewerScroll, { passive: true });
    } else {
      editSplit.classList.remove("split");
      editorEl.removeEventListener("scroll", onEditorScroll);
      viewerContentEl.removeEventListener("scroll", onViewerScroll);
    }
    refreshTopbar();
    editorEl.focus();
    if (NB.editbar) NB.editbar.show();
  }

  /* --- empty state: welcome page ------------------------------------ */
  /* The welcome page is shown whenever there are no open tabs. The
   * "New note" button delegates to NB.sidebar.createAtRoot("file") so
   * the user gets the same prompt + create + open flow as the sidebar's
   * right-click "New file…" action. The "Open Welcome.md" button only
   * appears when the file actually exists in the tree (a power user
   * who deleted the starter notebook doesn't see a dead link). */
  function findInTree(tree, basename) {
    for (const n of tree) {
      if (n.type === "file" && n.name === basename) return n;
      if (n.children && findInTree(n.children, basename)) return n;
    }
    return null;
  }
  function showWelcome() {
    active = null;
    cache.clear();
    clearTimeout(liveTimer);
    editSplit.classList.remove("split");
    editorEl.removeEventListener("scroll", onEditorScroll);
    viewerContentEl.removeEventListener("scroll", onViewerScroll);
    editorEl.hidden = true;
    viewerEl.hidden = true;
    welcomeEl.hidden = false;
    // Clear the previous file's rendered markdown from #viewer-content
    // (and drop the per-render heading-id dedup state via seenIds).
    // Without this, the old HTML stays in the DOM inside the now-hidden
    // #viewer and resurfaces whenever something briefly un-hides it
    // (a CSS transition, a tab switch mid-fade, devtools, etc.). It
    // also means the next file's outline.build() starts from a clean
    // slate -- no leftover heading ids to collide with.
    viewerContentEl.innerHTML = "";
    seenIds = {};
    // Reveal "Open Welcome.md" iff Welcome.md is in the current tree.
    const openWelcomeBtn = welcomeEl.querySelector('[data-act="open-welcome"]');
    if (openWelcomeBtn) {
      const tree = (NB.sidebar && NB.sidebar.getTree) ? NB.sidebar.getTree() : [];
      openWelcomeBtn.hidden = !findInTree(tree, "Welcome.md");
    }
    // The outline still watches viewerContentEl (which is hidden but
    // present); rebuild it so the right-pane shows "No headings" rather
    // than stale entries from the last opened file.
    if (NB.outline) NB.outline.build(viewerContentEl);
    refreshTopbar();
    if (NB.editbar) NB.editbar.hide();
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
        t = { content, editMode: false, savedContent: content, mtime: (data && data.mtime) || null };
        cache.set(path, t);
        if (NB.watcher) NB.watcher.noteOpened(path, t.mtime);
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
      if (NB.watcher) NB.watcher.forget(path);
      if (active === path) active = null;
    },

    /* Re-key a tab when its file is moved/renamed; unsaved edits travel. */
    rename(from, to) {
      const t = cache.get(from);
      if (t) { cache.delete(from); cache.set(to, t); }
      if (active === from) active = to;
    },

    /* No tabs open: show the welcome page. The page is a sibling of
     * #viewer inside #edit-split, with a small "New note" /
     * "Open Welcome.md" action panel. The Open-Welcome button is only
     * revealed when Welcome.md actually exists in the tree, so a power
     * user who deleted it doesn't see a dead link. */
    clear() { showWelcome(); },
    /* Re-enter the empty state (e.g. after a test close). Alias for
     * clear(); exposed under its own name so callers (and tests) can
     * be explicit about intent. */
    showWelcome() { showWelcome(); },

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
      showPreview = true;  // always start with the preview pane visible
      editorEl.value = t.content;
      showEditor();
    },
    /* End edit mode and render the saved content. */
    endEdit() {
      const t = cur(); if (!t) return;
      t.content = editorEl.value;
      t.editMode = false;
      showPreview = true;  // reset for next edit session
      showViewer();
      render();
      NB.evt.emit("viewer:dirty-changed", { path: active, dirty: viewer.isDirty(active) });
    },
    /* Close button: exit edit mode, but prompt before discarding unsaved
     * edits. Returns true if the user chose to proceed, false if they
     * stayed in edit mode. */
    closeEdit() {
      const t = cur(); if (!t) return false;
      if (viewer.isDirty(active)) {
        const ok = confirm('You have unsaved changes in "' + active + '".\n\n' +
          'Discard them and exit edit mode?');
        if (!ok) return false;
        // Revert the editor to the last saved content so the next edit
        // session starts clean (Save button hidden until they type).
        editorEl.value = t.savedContent;
      }
      this.endEdit();
      return true;
    },
    toggleEdit() { const t = cur(); if (!t) return; t.editMode ? this.closeEdit() : this.startEdit(); },

    async save() {
      const t = cur();
      if (!t) { alert("No file open."); return; }
      if (!t.editMode) return;                 // no toolbar in preview mode
      const content = editorEl.value;
      await NB.api.saveFile(active, content);
      t.content = content;
      t.savedContent = content;
      // Stay in edit mode after save — the user might still be editing.
      // Just refresh the toolbar (Save button hides because no longer dirty).
      refreshTopbar();
      // Tell the watcher our next save's mtime echo should be ignored.
      if (NB.watcher) NB.watcher.noteSelfSave(active);
      // Re-fetch to pick up the new mtime the server stamped on the file.
      try {
        const data = await NB.api.getFile(active);
        if (data && data.mtime != null) {
          t.mtime = data.mtime;
          if (NB.watcher) NB.watcher.noteOpened(active, data.mtime);
        }
      } catch (_) { /* non-fatal; the file did save */ }
      NB.evt.emit("viewer:dirty-changed", { path: active, dirty: false });
      NB.evt.emit("file:saved", active);
    },

    /* Scroll the rendered viewer to a heading by its slugified id.
     * The id is the same string the renderer's slugify() produces on
     * each h1..h6 (e.g. "## Core rules" -> "core-rules"). Used by
     * NB.app.openDeepLink() to honor a `?file=...&heading=...` URL.
     * Same getElementById + scrollIntoView pattern as the outline
     * click handler (outline.js:44-48). Returns true on hit, false
     * on miss (missing id or empty slug). */
    scrollToHeading(slug) {
      if (!slug) return false;
      const el = document.getElementById(slug);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    },

    /* Jump to the first occurrence of `term` in the rendered DOM and
     * scroll it into view. Used by search.js on result click. */
    jumpToMatch(term, caseSensitive) {
      if (!term) return;
      const flags = caseSensitive ? "" : "i";
      const re = new RegExp(escapeRegex(term), flags);
      const walker = document.createTreeWalker(
        viewerContentEl, NodeFilter.SHOW_TEXT, null);
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

  /* Live dirty dot + live preview: while editing, report changed-dirty
   * so the tab bar can mark the active file's tab without a full
   * re-render, keep the Save button in sync, and re-render the preview
   * pane (debounced) so the user sees their Markdown in real time. */
  editorEl.addEventListener("input", () => {
    if (!active) return;
    refreshTopbar();
    NB.evt.emit("viewer:dirty-changed", { path: active, dirty: viewer.isDirty(active) });
    if (showPreview) scheduleLivePreview();
  });

  /* Edit-mode toolbar buttons. Preview toggles the live-preview pane;
   * Close exits edit mode (prompting on unsaved changes); Save is gated
   * by refreshTopbar() based on the dirty flag. */
  previewBtn.addEventListener("click", () => {
    showPreview = !showPreview;
    previewBtn.classList.toggle("editing", showPreview);
    if (showPreview) {
      viewerEl.hidden = false;
      editSplit.classList.add("split");
      render(editorEl.value);
      editorEl.addEventListener("scroll", onEditorScroll, { passive: true });
      viewerContentEl.addEventListener("scroll", onViewerScroll, { passive: true });
    } else {
      viewerEl.hidden = true;
      editSplit.classList.remove("split");
      editorEl.removeEventListener("scroll", onEditorScroll);
      viewerContentEl.removeEventListener("scroll", onViewerScroll);
    }
  });
  saveBtn.addEventListener("click", () => NB.viewer.save());
  closeEditBtn.addEventListener("click", () => NB.viewer.closeEdit());

  /* Welcome page action buttons. "New note" -> sidebar's create-at-root
   * flow (same path the right-click context menu uses). "Open
   * Welcome.md" -> tabs.open() with the standard bootstrap path. */
  welcomeEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".welcome-action");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "new") {
      if (NB.sidebar && NB.sidebar.createAtRoot) NB.sidebar.createAtRoot("file");
    } else if (act === "open-welcome") {
      if (NB.tabs) NB.tabs.open("Welcome.md");
    }
  });

  /* External file change (watcher or poll). Refetch the file. If the user
   * has unsaved edits, prompt; if they say no, mark the tab as a conflict
   * and keep their version. */
  NB.evt.on("file:external-change", async ({ path, data }) => {
    const t = cache.get(path);
    if (!t) return;          // never opened -> the next activate will refetch
    let fresh = data;
    if (!fresh) {
      try { fresh = await NB.api.getFile(path); }
      catch (e) { return; } // file gone or unreadable; let the sidebar handle it
    }
    if (fresh.mtime != null) t.mtime = fresh.mtime;
    const wasActive = (active === path);
    if (viewer.isDirty(path)) {
      const ok = confirm('"' + path + '" changed on disk.\n\n' +
        'Discard your unsaved edits and reload from disk?\n' +
        '(Cancel keeps your edits and marks the tab as a conflict.)');
      if (!ok) {
        NB.evt.emit("viewer:conflict", { path, conflict: true });
        return;
      }
    }
    t.content = fresh.content;
    t.savedContent = fresh.content;
    t.editMode = false;
    showPreview = true;  // reset for next edit session
    if (wasActive) { showViewer(); render(); }
    NB.evt.emit("viewer:dirty-changed", { path, dirty: false });
    NB.evt.emit("viewer:conflict", { path, conflict: false });
  });

  /* In-app link interception. A Markdown link like
   * `[b](notes/b.md#intro)` resolves to a same-origin <a> inside the
   * rendered viewer. Without interception, clicking it triggers a
   * full page navigation (slow, drops unsaved edits, resets scroll
   * position on the new file). With interception, the click is
   * routed through NB.app.openDeepLink -- the SPA stays mounted, the
   * target tab opens, the heading scrolls, and history.replaceState
   * keeps the address bar clean. Same-file in-page anchors (`[#sec]`)
   * and external links (`[GH](https://...)`) are passed through
   * unchanged so the browser's native behavior handles them. */
  viewerContentEl.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    // Respect modifier keys + non-primary buttons: the user's intent
    // (open in new tab, etc.) goes through the browser's default.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    // Same-origin only. new URL(broken) throws -- bail on bad input.
    let url;
    try { url = new URL(a.getAttribute("href"), window.location.href); }
    catch (_) { return; }
    if (url.origin !== window.location.origin) return;
    // Same-file in-page anchor: the resolved pathname matches the
    // current URL's pathname (the boot path replaces the URL with `/`
    // on first load, so a relative link to a different .md path is
    // correctly distinguished from an in-page #anchor). The browser
    // does the scroll natively because we assign slugified ids to
    // every h1..h6 in render().
    const currentPath = window.location.pathname.replace(/^\/+/, "");
    const linkPath = url.pathname.replace(/^\/+/, "");
    if (linkPath === currentPath) return;
    // Cross-note deep link: prevent the full navigation and route
    // through openDeepLink. The link's href may have been a relative
    // path from the current note (e.g. "b.md" while viewing
    // "notes/a.md"); the resolved URL has already done the right
    // thing, so url.pathname is the absolute notebook path.
    e.preventDefault();
    const heading = url.hash ? decodeURIComponent(url.hash.replace(/^#/, "")) : null;
    NB.app.openDeepLink({ file: linkPath, heading });
  });

  NB.viewer = viewer;
})();