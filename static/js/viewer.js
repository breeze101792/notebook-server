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
  // #cm-host is the CodeMirror 6 mount point. We no longer talk
  // to a <textarea> directly; cm-bridge.js owns the view and
  // exposes a small API at NB.cmEditor.
  const cmHostEl  = document.getElementById("cm-host");
  const editSplit = document.getElementById("edit-split");
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

  /* --- wikilinks: [[Target]] internal note links --------------------- */
  /* Obsidian-style internal links. A `[[Target]]` (or `[[Target|label]]`)
   * in a note renders as an in-app link to another note. The target is
   * resolved the same way the backend's graph view does (see
   * _normalise_link in app.py):
   *   - a bare stem (no path separator) matches a note by basename
   *     without extension, so [[README]] and [[README.md]] both link to
   *     README.md even from a subfolder;
   *   - a path is treated as relative to the current note's folder;
   *   - a trailing #anchor is kept as a heading deep-link.
   * Unresolvable targets render as plain text (no dead link), matching
   * the graph view's "no ghost nodes" rule.
   *
   * We register a marked inline extension so `[[...]]` is tokenised
   * before marked's default link handling. The extension emits an <a>
   * with a data-wikilink attribute; the click handler below routes it
   * through the same in-app navigation as a normal cross-note link. */
  function registerWikilinkExtension() {
    if (!window.marked || window.marked.__nbWikilink) return;
    window.marked.__nbWikilink = true;
    window.marked.use({
      extensions: [{
        name: "wikilink",
        level: "inline",
        start(src) { return src.indexOf("[["); },
        tokenizer(src) {
          const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
          if (!m) return undefined;
          return {
            type: "wikilink",
            raw: m[0],
            target: m[1].trim(),
            text: (m[2] || "").trim() || m[1].trim(),
          };
        },
        renderer(token) {
          // Only emit a link when the target resolves to a known note
          // (matching the graph view's "no ghost nodes" rule); otherwise
          // render the raw [[...]] as plain text so there's no dead
          // link. resolveWikilink reads the current note + tree.
          const resolved = resolveWikilink(token.target);
          if (!resolved) return token.raw;
          // Escape the href so a target with quotes/spaces can't break
          // out of the attribute. The text is the note's own content
          // (rendered unsanitised anyway), so we pass it through.
          const href = String(token.target).replace(/"/g, "&quot;");
          return '<a href="' + href + '" data-wikilink="1">' + token.text + "</a>";
        },
      }],
    });
  }

  /* resolveWikilink(target) -> { path, heading } | null. Resolves a
   * [[target]] against the current note + the file tree, mirroring the
   * backend's _normalise_link. Returns null when the target can't be
   * resolved to a known note. */
  function resolveWikilink(target) {
    const tree = (NB.sidebar && NB.sidebar.getTree) ? NB.sidebar.getTree() : [];
    const currentPath = (active || "").replace(/^\/+/, "");
    const currentDir = currentPath.includes("/")
      ? currentPath.slice(0, currentPath.lastIndexOf("/"))
      : "";

    // Split off a #heading anchor.
    let heading = null;
    let t = target;
    if (t.includes("#")) {
      const i = t.indexOf("#");
      heading = t.slice(i + 1);
      t = t.slice(0, i);
    }
    t = t.trim();
    if (!t) return null;

    // Build a stem index (basename without extension -> path) so a bare
    // stem resolves even when the file lives in a subfolder.
    const stemIndex = {};
    (function index(nodes) {
      for (const n of nodes) {
        if (n.type === "file") {
          const base = n.path.split("/").pop();
          const stem = base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
          if (!(stem in stemIndex)) stemIndex[stem] = n.path;
        }
        if (n.children) index(n.children);
      }
    })(tree);

    // A bare stem (no path separator): try the stem index first.
    let resolved = null;
    if (!t.includes("/")) {
      let stem = t;
      if (stem.toLowerCase().endsWith(".md")) stem = stem.slice(0, -3);
      if (stem in stemIndex) resolved = stemIndex[stem];
    }
    // Otherwise (or if the stem didn't match) treat it as a relative
    // path from the current note's folder.
    if (!resolved) {
      const candidate = (currentDir ? currentDir + "/" : "") + t;
      const norm = candidate.split("/").filter(Boolean).join("/");
      // Normalise "." and ".." segments.
      const parts = [];
      for (const seg of norm.split("/")) {
        if (seg === "." || seg === "") continue;
        if (seg === "..") parts.pop();
        else parts.push(seg);
      }
      const clean = parts.join("/");
      if (treeHasPath(tree, clean)) resolved = clean;
    }

    if (!resolved) return null;
    return { path: resolved, heading };
  }

  function treeHasPath(tree, path) {
    for (const n of tree) {
      if (n.path === path) return true;
      if (n.children && treeHasPath(n.children, path)) return true;
    }
    return false;
  }

  /* --- copy button on code blocks ----------------------------------- */
  /* attachCopyButton(pre) wires a single "Copy" button into a <pre>
   * wrapper. The button:
   *   - Sits absolutely positioned in the top-right of the pre.
   *   - Is hidden by default and shown on hover (CSS).
   *   - On click, copies the RAW source text (the <pre>'s textContent,
   *     which is the un-highlighted code) to the clipboard via
   *     NB.app.copyToClipboard. We use textContent rather than
   *     the post-highlight innerHTML so the pasted code is real
   *     source, not a soup of <span class="hljs-..."> markup.
   *   - Flips its label to "Copied!" for ~1.2s and reverts. Also
   *     fires a shared toast via NB.app.notify so the user gets
   *     the same feedback regardless of where the click landed.
   *
   * The button is appended to the <pre> itself, not to a wrapper
   * around it, so the <pre> needs position:relative in CSS. The
   * button gets a class .code-copy-btn so styles can target it. */
  function attachCopyButton(pre) {
    if (pre.querySelector(".code-copy-btn")) return;   // idempotent
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // textContent strips the highlight <span>s; the raw text
      // matches the original markdown source.
      const text = pre.textContent;
      try {
        if (NB.app && NB.app.copyToClipboard) {
          await NB.app.copyToClipboard(text);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error("No clipboard API available");
        }
        // Flip the button to "Copied!" for a short moment. The
        // NB.app.notify toast is the canonical user feedback, but
        // the button flip keeps the action anchored to the
        // affordance the user just clicked -- useful when the user
        // has scrolled the toast out of view.
        const prev = btn.textContent;
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove("copied");
        }, 1200);
        if (NB.app && NB.app.notify) NB.app.notify("Copied to clipboard");
      } catch (err) {
        if (NB.app && NB.app.notify) NB.app.notify("Copy failed", 2200);
        else console.error("copy failed", err);
      }
    });
    pre.appendChild(btn);
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

    // Syntax highlighting via highlight.js (vendored). Highlight
    // FIRST so the <code> elements get their hljs classes; the
    // mermaid pass below looks for `code.language-mermaid` and
    // skips non-mermaid blocks (so the order is fine -- hljs
    // doesn't touch language-mermaid blocks meaningfully, they
    // are still rendered as code).
    if (window.hljs) {
      viewerContentEl.querySelectorAll("pre code").forEach(el => {
        try { hljs.highlightElement(el); }
        catch (e) { /* fall back to plain text already in place */ }
      });
    }

    // Mermaid diagrams: blocks tagged ```mermaid are replaced with
    // rendered SVGs (or a warning error box + source block with a
    // toast notification on parse failure). Runs in BOTH view mode
    // and live preview so the user sees the diagram update as they
    // type. renderAll awaits each block sequentially -- mermaid.render
    // is heavy and Promise.all-ing 10 blocks would spike the main
    // thread.
    if (NB.mermaid && NB.mermaid.renderAll) {
      NB.mermaid.renderAll(viewerContentEl);
    }

    // WaveDrom timing diagrams: blocks tagged ```wavedrom are replaced
    // with rendered waveform SVGs (or a warning error box + source block
    // on failure). Mirrors the mermaid pass above; runs in BOTH view mode
    // and live preview so the user sees the diagram update as they type.
    // NB.wavedrom.renderAll awaits each block sequentially (WaveDrom is
    // lighter than mermaid, but the same sequential discipline keeps the
    // main thread calm on a large document).
    if (NB.wavedrom && NB.wavedrom.renderAll) {
      NB.wavedrom.renderAll(viewerContentEl);
    }

    // KaTeX math: blocks tagged ```math (or ```katex) are replaced with
    // typeset equations. Renders to HTML (not SVG), so no lightbox.
    // Runs in BOTH view mode and live preview.
    if (NB.katex && NB.katex.renderAll) {
      NB.katex.renderAll(viewerContentEl);
    }

    // Graphviz diagrams: blocks tagged ```dot (or ```graphviz) are
    // replaced with rendered SVG graphs. Uses the shared lightbox for
    // click-to-inspect + zoom. Runs in BOTH view mode and live preview.
    if (NB.viz && NB.viz.renderAll) {
      NB.viz.renderAll(viewerContentEl);
    }

    // Copy buttons on code blocks. Only in view mode (content is
    // undefined); the live preview during editing gets the same
    // highlight but no button so the right pane stays focused on
    // the text. The button is positioned absolutely in the top-right
    // of the <pre> wrapper and is shown on hover (CSS). It copies
    // the RAW source text (pre-hljs), not the post-highlight HTML,
    // so the user pastes real code, not markup.
    if (content === undefined) {
      viewerContentEl.querySelectorAll("pre").forEach(attachCopyButton);
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
      render(NB.cmEditor.getValue());
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

  function onEditorScroll() {
    const scroller = NB.cmEditor.scrollDOM();
    if (scroller) syncScroll(scroller, viewerContentEl);
  }
  function onViewerScroll() {
    const scroller = NB.cmEditor.scrollDOM();
    if (scroller) syncScroll(viewerContentEl, scroller);
  }

  /* --- per-file scroll position memory ------------------------------ */
  /* The back button restores where the user was reading on the source
   * note. We track scroll position per file in this Map (path -> last
   * scrollTop) on every scroll event, debounced via rAF. The Map is
   * updated by both preview-mode and edit-mode scrolling -- the user's
   * reading position in either case is what back should restore. */
  const scrollPositions = new Map();
  let scrollTrackTicking = false;
  function onViewerScrollTrack() {
    if (scrollTrackTicking) return;
    scrollTrackTicking = true;
    requestAnimationFrame(() => {
      if (active != null) scrollPositions.set(active, viewerContentEl.scrollTop);
      scrollTrackTicking = false;
    });
  }
  viewerContentEl.addEventListener("scroll", onViewerScrollTrack, { passive: true });

  function showViewer() {
    clearTimeout(liveTimer);
    editSplit.classList.remove("split");
    if (cmHostEl) cmHostEl.hidden = true;
    // Drop CM focus before hiding the host. Otherwise the contentDOM
    // stays the document.activeElement, and CM6's view.hasFocus keeps
    // returning true -- which makes the shell keymap (vimnav) keep
    // yielding to "CM has focus" even after edit mode is gone. jsdom
    // doesn't auto-blur hidden elements, so we do it explicitly.
    if (NB.cmEditor) NB.cmEditor.blur();
    viewerEl.hidden = false;
    // The welcome page is the empty-state sibling of #viewer; hide it
    // whenever a file is actually shown, so it doesn't stack on top
    // of the markdown content visually.
    if (welcomeEl) welcomeEl.hidden = true;
    const scroller = NB.cmEditor.scrollDOM();
    if (scroller) scroller.removeEventListener("scroll", onEditorScroll);
    viewerContentEl.removeEventListener("scroll", onViewerScroll);
    refreshTopbar();
    if (NB.editbar) NB.editbar.hide();
    // Hide any special-tab content containers that live as siblings of
    // #viewer inside #edit-split (graph, search-as-tab, etc.). Each
    // special view also listens for file:open to hide itself, but this
    // covers the case where a file tab is activated without the special
    // view being a party to the switch (e.g. restore-on-boot).
    hideSpecialContainers();
  }
  /* Hide every element inside #edit-split that carries the
   * .special-tab-view class. Called when a file tab activates so a
   * previously-active special tab's content disappears. Each special
   * view owns its own visibility via its onActivate handler; this is
   * the belt-and-suspenders fallback. */
  function hideSpecialContainers() {
    if (!editSplit) return;
    editSplit.querySelectorAll(".special-tab-view").forEach(el => { el.hidden = true; });
  }
  /* Called by tabs.js when a special tab (§graph, §search) becomes
   * active. Hides the viewer + welcome + editor so the special view's
   * container (a .special-tab-view sibling inside #edit-split) is the
   * only visible child. The special view's onActivate handler shows
   * its own container. */
  function showSpecial() {
    if (cmHostEl) cmHostEl.hidden = true;
    viewerEl.hidden = true;
    if (welcomeEl) welcomeEl.hidden = true;
    // Remove the edit-mode split class so #edit-split reverts to a
    // simple column layout. If the user was in edit mode (split =
    // editor + preview side by side) before opening a special tab
    // (graph / search), the .split class would otherwise persist and
    // make #edit-split a flex row, which can confuse the layout of
    // the special-tab-view container.
    editSplit.classList.remove("split");
    hideSpecialContainers();
    refreshTopbar();
    if (NB.editbar) NB.editbar.hide();
  }
  function showEditor() {
    if (cmHostEl) cmHostEl.hidden = false;
    viewerEl.hidden = !showPreview;
    if (welcomeEl) welcomeEl.hidden = true;
    previewBtn.classList.toggle("editing", showPreview);
    if (showPreview) {
      editSplit.classList.add("split");
      render(NB.cmEditor.getValue());
      const scroller = NB.cmEditor.scrollDOM();
      if (scroller) scroller.addEventListener("scroll", onEditorScroll, { passive: true });
      viewerContentEl.addEventListener("scroll", onViewerScroll, { passive: true });
    } else {
      editSplit.classList.remove("split");
      const scroller = NB.cmEditor.scrollDOM();
      if (scroller) scroller.removeEventListener("scroll", onEditorScroll);
      viewerContentEl.removeEventListener("scroll", onViewerScroll);
    }
    refreshTopbar();
    NB.cmEditor.focus();
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
    setHasActiveFile(false);
    cache.clear();
    clearTimeout(liveTimer);
    editSplit.classList.remove("split");
    const scroller = NB.cmEditor.scrollDOM();
    if (scroller) scroller.removeEventListener("scroll", onEditorScroll);
    viewerContentEl.removeEventListener("scroll", onViewerScroll);
    if (cmHostEl) cmHostEl.hidden = true;
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
        if (prev && prev.editMode) prev.content = NB.cmEditor.getValue();
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
      if (t.editMode) { NB.cmEditor.setValue(t.content); showEditor(); }
      else { showViewer(); render(); }
      setHasActiveFile(true);
      NB.evt.emit("file:open", path);
      return t.content;
    },

    /* Drop the cache for a closed tab. */
    close(path) {
      cache.delete(path);
      if (NB.watcher) NB.watcher.forget(path);
      if (active === path) { active = null; setHasActiveFile(false); }
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
    /* Hide the viewer + welcome + editor so a special tab's content
     * container (a .special-tab-view sibling in #edit-split) becomes
     * the only visible child. Called by tabs.js when a special tab
     * (§graph, §search) is activated. */
    showSpecial() { showSpecial(); },

    getPath() { return active; },
    getContent() { const t = cur(); return t ? (t.editMode ? NB.cmEditor.getValue() : t.content) : ""; },
    isDirty(path) {
      const t = cache.get(path);
      if (!t) return false;
      const current = (path === active && t.editMode) ? NB.cmEditor.getValue() : t.content;
      return current !== t.savedContent;
    },

    startEdit() {
      const t = cur(); if (!t) return;
      t.editMode = true;
      showPreview = true;  // always start with the preview pane visible
      NB.cmEditor.setValue(t.content);
      showEditor();
    },
    /* End edit mode and render the saved content. */
    endEdit() {
      const t = cur(); if (!t) return;
      t.content = NB.cmEditor.getValue();
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
        NB.cmEditor.setValue(t.savedContent);
      }
      this.endEdit();
      return true;
    },
    toggleEdit() { const t = cur(); if (!t) return; t.editMode ? this.closeEdit() : this.startEdit(); },

    /* Manually re-fetch the active file from disk and re-render, so the
     * user can force a refresh without waiting for the watcher. Prompts
     * before discarding unsaved edits (same guard as the external-change
     * handler). Returns true if the reload happened, false if the user
     * cancelled or there was nothing to reload. */
    async reload() {
      const path = active;
      const t = cache.get(path);
      if (!path || !t) return false;
      if (viewer.isDirty(path)) {
        const ok = confirm('"' + path + '" has unsaved edits.\n\n' +
          'Discard them and reload from disk?');
        if (!ok) return false;
      }
      try {
        const fresh = await NB.api.getFile(path);
        if (!fresh) return false;
        t.content = fresh.content;
        t.savedContent = fresh.content;
        t.mtime = fresh.mtime != null ? fresh.mtime : t.mtime;
        t.editMode = false;
        showPreview = true;
        if (NB.watcher) NB.watcher.noteOpened(path, t.mtime);
        showViewer();
        if (NB.cmEditor) NB.cmEditor.setValue(t.content);
        render();
        NB.evt.emit("viewer:dirty-changed", { path, dirty: false });
        NB.evt.emit("viewer:conflict", { path, conflict: false });
        return true;
      } catch (e) {
        return false;
      }
    },

    /* Commit before navigating away (tab switch via Alt+H/L or the
     * browser back button). If the current file is in edit mode:
     *   - clean: just exit edit mode, no prompt.
     *   - dirty: confirm; on OK save (failure aborts the nav), on
     *     Cancel revert the editor to the last saved content.
     * Also delegates to NB.hybrid.commitForTabSwitch when hybrid mode
     * is active (the hybrid module owns its own dirty + exit logic).
     * Returns true if the caller may proceed with the nav, false if
     * the user (or a failed save) wants to stay. */
    async commitForTabSwitch() {
      // Hybrid mode takes priority -- it sits on top of preview mode,
      // so editMode is false while hybrid is active.
      if (NB.hybrid && NB.hybrid.isActive) {
        const ok = await NB.hybrid.commitForTabSwitch();
        if (!ok) return false;
      }
      const t = cur(); if (!t) return true;
      if (!t.editMode) return true;
      if (!viewer.isDirty(active)) {
        this.endEdit();
        return true;
      }
      const ok = confirm('Save changes to "' + active + '" before switching?');
      if (ok) {
        try { await this.save(); }
        catch (e) {
          alert("Save failed: " + (e && e.message ? e.message : e));
          return false;
        }
      } else {
        // Revert the editor to the last saved content so the next
        // edit session starts clean.
        NB.cmEditor.setValue(t.savedContent);
      }
      this.endEdit();
      return true;
    },

    /* In-app nav API. The back button (and the H/L vim keys via
     * vimnav.js) call these. goBack() returns true on success.
     * goForward() re-applies the last goBack(). */
    async goBack() { return goBack(); },
    async goForward() { return goForward(); },
    canGoBack() { return navStack.length > 0; },
    canGoForward() { return redoStack.length > 0; },

    async save() {
      // Hybrid (WYSIWYG) mode sits on top of preview mode, so editMode
      // is false while it's active. Let the hybrid module own the save
      // (it converts the DOM back to Markdown). The keyboard shortcut
      // (Ctrl+S / vim s / :w) routes here, so this delegation is what
      // makes the shortcut save while hybrid-editing.
      if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) {
        return NB.hybrid.save();
      }
      const t = cur();
      if (!t) { alert("No file open."); return; }
      if (!t.editMode) return;                 // no toolbar in preview mode
      const content = NB.cmEditor.getValue();
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

    /* Another module (the AI assistant, or hybrid/WYSIWYG mode) wrote
     * the file and wants the viewer's cache refreshed so the next render
     * shows the fresh content. Mirrors the ai:applied event handler but
     * takes the already-converted content instead of an async refetch,
     * so hybrid save -> exit re-renders the saved bytes, not the stale
     * cache. Also marks the write as a self-save so the watcher swallows
     * its echo. */
    noteSaved(path, content) {
      const t = cache.get(path);
      if (!t) return;
      t.content = content;
      t.savedContent = content;
      if (NB.watcher) NB.watcher.noteSelfSave(path);
      NB.evt.emit("viewer:dirty-changed", { path, dirty: false });
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
   * pane (debounced) so the user sees their Markdown in real time.
   *
   * The CM6 updateListener fires on every doc transaction; the
   * cm-bridge's onChange() relays those events. */
  NB.cmEditor.onChange(() => {
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
    const scroller = NB.cmEditor.scrollDOM();
    if (showPreview) {
      viewerEl.hidden = false;
      editSplit.classList.add("split");
      render(NB.cmEditor.getValue());
      if (scroller) scroller.addEventListener("scroll", onEditorScroll, { passive: true });
      viewerContentEl.addEventListener("scroll", onViewerScroll, { passive: true });
    } else {
      viewerEl.hidden = true;
      editSplit.classList.remove("split");
      if (scroller) scroller.removeEventListener("scroll", onEditorScroll);
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
    if (wasActive) {
      showViewer();
      // In case the fresh copy came from data (conditional GET didn't run
      // -- e.g. some callers pass pre-fetched data), mirror into the CM6
      // editor if edit mode had been active. endEdit() semantics.
      if (NB.cmEditor && t.content !== undefined) NB.cmEditor.setValue(t.content);
      render();
    }
    NB.evt.emit("viewer:dirty-changed", { path, dirty: false });
    NB.evt.emit("viewer:conflict", { path, conflict: false });
  });

  /* AI proposal applied (ai.js wrote via POST /api/edit and the watcher
   * is about to fire file:external-change for the same path). Bypass the
   * "changed on disk" confirm -- the user just clicked Apply on this
   * very change. Fresh data arrives in the event payload. */
  NB.evt.on("ai:applied", ({ path, data }) => {
    const t = cache.get(path);
    if (!t) return;
    if (NB.watcher) NB.watcher.noteSelfSave(path);
    if (data) {
      t.content = data.content;
      t.savedContent = data.content;
      t.mtime = data.mtime;
      if (NB.watcher) NB.watcher.noteOpened(path, data.mtime);
      const wasActive = (active === path);
      if (wasActive) { showViewer(); render(); }
      NB.evt.emit("viewer:dirty-changed", { path, dirty: false });
    }
  });

  /* In-app link interception. A Markdown link like
   * `[b](notes/b.md#intro)` resolves to a same-origin <a> inside the
   * rendered viewer. Without interception, clicking it triggers a
   * full page navigation (slow, drops unsaved edits, resets scroll
   * position on the new file). With interception, the click is
   * routed through NB.app.openDeepLink -- the SPA stays mounted and
   * the target tab opens in place.
   *
   * For the back button, we also record the source position in a
   * module-local `navStack` (defined in the back-button section at
   * the bottom of this IIFE). Two entry shapes:
   *   cross-note  -- different file. pushNav({type:"cross-note",
   *                  fromFile, fromScroll}). The back button pops
   *                  and restores: activate the source tab + restore
   *                  its scroll.
   *   in-page     -- same file, a #anchor. pushNav({type:"in-page",
   *                  file, scroll}). Back restores the pre-click
   *                  scroll position.
   *
   * We don't use history.pushState for the in-app nav (the
   * popstate handler fires on the entry being *entered*, which is
   * the prior entry, not the one we're leaving -- the wrong place
   * to store source-side info). The navStack is the source of truth
   * for restore; the browser's popstate is just one signal that
   * pops from the stack. */
  viewerContentEl.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    // Respect modifier keys + non-primary buttons: the user's intent
    // (open in new tab, etc.) goes through the browser's default.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    // Wikilink: [[Target]] rendered as <a data-wikilink>. Resolve the
    // target against the current note + tree and route through the same
    // in-app navigation as a cross-note link (push a navStack entry so
    // back can return, then openDeepLink).
    if (a.getAttribute("data-wikilink") === "1") {
      e.preventDefault();
      const resolved = resolveWikilink(a.getAttribute("href") || "");
      if (!resolved) return; // unresolvable -> nothing to do
      const currentPath = (NB.viewer.getPath() || "").replace(/^\/+/, "");
      const fromFile = currentPath || null;
      const fromScroll = viewerContentEl.scrollTop;
      pushNav({ type: "cross-note", fromFile, fromScroll });
      NB.app.openDeepLink({ file: resolved.path, heading: resolved.heading });
      return;
    }
    // Same-origin only. new URL(broken) throws -- bail on bad input.
    let url;
    try { url = new URL(a.getAttribute("href"), window.location.href); }
    catch (_) { return; }
    if (url.origin !== window.location.origin) return;
    // The boot path replaces the URL with `/`, so the current "active
    // note" for routing purposes is NB.viewer.getPath() (the file
    // actually shown in the viewer), not window.location.pathname
    // (which is always `/` after the first replaceState).
    const currentPath = (NB.viewer.getPath() || "").replace(/^\/+/, "");
    const linkPath = url.pathname.replace(/^\/+/, "");
    // In-page anchor: a same-file link with a #fragment. The href
    // may be a bare "#slug" (resolves to pathname = "/" via the URL
    // constructor) or "./#slug" (also resolves to the current
    // pathname). Both should hit this branch when we're viewing
    // currentPath. Detecting by the resolved pathname matching the
    // active note (since window.location.pathname is always `/` after
    // the boot replaceState, we can't compare against that).
    if (url.hash && (linkPath === "" || linkPath === currentPath) && currentPath) {
      // Same-file in-page anchor. We own the scroll so we can also
      // record a navStack entry the back button can pop.
      e.preventDefault();
      const preScroll = viewerContentEl.scrollTop;
      const slug = decodeURIComponent(url.hash.replace(/^#/, ""));
      pushNav({ type: "in-page", file: currentPath, scroll: preScroll });
      NB.viewer.scrollToHeading(slug);
      return;
    }
    if (linkPath === currentPath) return;   // bare same-file href: pass through
    // Cross-note deep link: prevent the full navigation, push a
    // navStack entry capturing where we are (so back can return),
    // then route through openDeepLink. The link's href may have been
    // a relative path from the current note (e.g. "b.md" while
    // viewing "notes/a.md"); the resolved URL has already done the
    // right thing, so url.pathname is the absolute notebook path.
    e.preventDefault();
    const heading = url.hash ? decodeURIComponent(url.hash.replace(/^#/, "")) : null;
    const fromFile = currentPath || null;
    const fromScroll = viewerContentEl.scrollTop;
    pushNav({ type: "cross-note", fromFile, fromScroll });
    NB.app.openDeepLink({ file: linkPath, heading });
  });

  /* `pushNav` is defined at the bottom of this IIFE -- it appends to
   * the navStack and updates the back button's disabled state. The
   * handler above calls it as a forward declaration; function
   * declarations are hoisted within the IIFE, so the forward
   * reference resolves at call time. */

  NB.viewer = viewer;

  /* --- keyboard scrolling ------------------------------------------- */
  /* Arrow Up/Down and Page Up/Down scroll the markdown content when the
   * viewer is visible and the user isn't typing in a field. This is the
   * natural "read the note" scroll: the browser's default for these keys
   * scrolls the whole page, but the app's content lives in an inner
   * scroller (#viewer-content), so we route the keys to it. We yield
   * when an input/textarea has focus (typing), when the editor is up
   * (CM owns the keys), or when a special tab (graph/search) is active.
   * VIM mode's shell keymap already handles arrows in edit mode; this
   * handler only fires in preview. */
  const SCROLL_LINE = 48;   // px per Arrow Up/Down press
  function scrollViewerBy(dy) {
    if (!viewerContentEl) return;
    viewerContentEl.scrollTop += dy;
  }
  function viewerScrollTargetHasFocus() {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    if (a.isContentEditable) return true;
    const tag = a.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }
  function viewerIsScrollable() {
    // The viewer must be the visible content: a file is active, the
    // viewer shell is shown, and we're not in edit mode (cm-host up)
    // or on a special tab.
    if (!active) return false;
    if (viewerEl.hidden) return false;
    if (cmHostEl && !cmHostEl.hidden) return false;
    return true;
  }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (viewerScrollTargetHasFocus()) return;
    if (!viewerIsScrollable()) return;
    let dy = 0;
    if (e.key === "ArrowUp") dy = -SCROLL_LINE;
    else if (e.key === "ArrowDown") dy = SCROLL_LINE;
    else if (e.key === "PageUp") dy = -(viewerContentEl.clientHeight || 0);
    else if (e.key === "PageDown") dy = (viewerContentEl.clientHeight || 0);
    else return;
    e.preventDefault();
    scrollViewerBy(dy);
  });

  // Register the [[wikilink]] marked extension once at module load so
  // every render (viewer + hybrid) tokenises [[...]] into in-app links.
  registerWikilinkExtension();

  /* --- back button + navStack popstate handler --------------------- */
  /* The back button (#back-btn) in the topbar pops the top of
   * navStack and applies it. The popstate handler does the same
   * (popping the stack) when the browser fires back, so Alt+Left /
   * browser back button / history.back() all reach the same code
   * path.
   *
   * navStack is the source of truth for restoration; the browser's
   * history is just a back-signal. We don't push to history from the
   * in-app link click handler because (a) the boot path's
   * replaceState leaves a state-less entry at the bottom of the
   * stack and (b) popstate fires on the entry being entered (the
   * prior entry), not the one we're leaving. The cleanest separation
   * is a local stack: every in-app nav pushes a restore recipe;
   * back pops it. The boot path leaves navStack empty so canGoBack
   * is false until the first push. */
  const navStack = [];
  const backBtn = document.getElementById("back-btn");
  const reloadBtn = document.getElementById("reload-btn");
  function setHasNavHistory(has) {
    if (backBtn) backBtn.disabled = !has;
  }
  function setHasActiveFile(has) {
    if (reloadBtn) reloadBtn.disabled = !has;
  }
  function pushNav(entry) {
    navStack.push(entry);
    if (navStack.length > 100) navStack.shift();   // hard cap
    clearRedo();
    setHasNavHistory(true);
  }
  function popNav() {
    const e = navStack.pop();
    setHasNavHistory(navStack.length > 0);
    return e;
  }

  async function applyNavEntry(entry) {
    if (!entry) return;
    if (entry.type === "cross-note") {
      if (!entry.fromFile) return;
      try {
        if (NB.tabs.isOpen(entry.fromFile)) {
          await NB.tabs.activate(entry.fromFile);
        } else {
          await NB.tabs.open(entry.fromFile);
        }
        // requestAnimationFrame waits one frame for the render
        // (activate -> viewer.activate -> render) to settle; setting
        // scrollTop before then would race the layout.
        requestAnimationFrame(() => {
          viewerContentEl.scrollTop = entry.fromScroll || 0;
        });
      } catch (err) {
        console.warn("back cross-note restore failed", err);
      }
    } else if (entry.type === "in-page") {
      // Same file -- just restore the scroll. No tab swap.
      requestAnimationFrame(() => {
        viewerContentEl.scrollTop = entry.scroll || 0;
      });
    }
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => goBack());
  }
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => NB.viewer.reload());
  }

  // A redo stack: H/L in vim navigate in-app history back/forward.
  // We track a separate stack so "L" (forward) replays the entries
  // we just popped. Cleared on every push (forward invalidates).
  const redoStack = [];
  function clearRedo() { redoStack.length = 0; }

  // Public nav API (used by vimnav.js for H/L).
  async function goBack() {
    if (navStack.length === 0) return false;
    const entry = popNav();
    // Remember where we are *now* (the destination of the back is
    // entry.fromFile, so by symmetry the destination of a future
    // forward is the file we're leaving from). Capture it on the
    // entry before mirroring it onto the redo stack.
    const curFile = (NB.viewer.getPath() || "").replace(/^\/+/, "") || null;
    const curScroll = viewerContentEl.scrollTop;
    entry._forwardTarget = { file: curFile, scroll: curScroll };
    // Mirror onto the redo stack so goForward can re-apply it.
    redoStack.push(entry);
    await applyNavEntry(entry);
    // Update the forward button if there is one (currently there
    // isn't, but the symmetry is here for vimnav's H/L).
    return true;
  }
  async function goForward() {
    if (redoStack.length === 0) return false;
    const entry = redoStack.pop();
    // Re-push onto the back stack so the user can undo a forward.
    navStack.push(entry);
    setHasNavHistory(true);
    // If this entry was a cross-note back, the forward target is the
    // file we left from at goBack time (stored in _forwardTarget).
    // applyNavEntry handles the cross-note case using that field.
    if (entry._forwardTarget) {
      await applyForwardTarget(entry);
    } else {
      await applyNavEntry(entry);
    }
    return true;
  }
  async function applyForwardTarget(entry) {
    const t = entry._forwardTarget;
    if (!t || !t.file) return;
    try {
      if (NB.tabs.isOpen(t.file)) {
        await NB.tabs.activate(t.file);
      } else {
        await NB.tabs.open(t.file);
      }
      requestAnimationFrame(() => {
        viewerContentEl.scrollTop = t.scroll || 0;
      });
    } catch (err) {
      console.warn("forward cross-note restore failed", err);
    }
  }

  // Browser back (Alt+Left, history.back(), swipe). The browser
  // changes history.state; we treat that as a back signal and pop
  // our stack. If the stack is empty (e.g. browser back after a
  // reload that started with a clean state), this listener is a
  // no-op and the browser handles the nav as it normally would.
  window.addEventListener("popstate", () => {
    if (navStack.length === 0) return;
    const entry = popNav();
    applyNavEntry(entry);
  });
})();