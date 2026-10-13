/* sidebar.js -- left file tree + context-menu file operations
 * (open, new file, new folder, rename/move, copy, delete) +
 * bookmarks section above the tree.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const treeEl = document.getElementById("file-tree");
  const sidebarEl = document.getElementById("sidebar");
  const bookmarksEl = document.getElementById("bookmarks");
  const bookmarksListEl = document.getElementById("bookmarks-list");
  const bookmarksAddBtn = document.getElementById("bookmarks-add");
  const SVG_NS = "http://www.w3.org/2000/svg";
  // Tree icons are inline SVGs referencing the hidden <symbol> sprite in
  // index.html (id "nb-icon-<name>"). Inline SVG renders in colour on every
  // platform and does not depend on a colour-emoji font being installed.
  const DIR_ICON = "folder";
  const DIR_ICON_OPEN = "folder-open";
  const FILE_ICON = "file";
  const STAR_ON = "★";
  const STAR_OFF = "☆";
  // Well-known note names get a distinct icon. Keyed by the basename stem
  // (extension stripped, lowercased); any other file falls back to
  // FILE_ICON.
  const FILE_ICON_MAP = {
    readme: "readme",
    claude: "claude",
    agents: "claude",
    gemini: "claude",
    copilot: "claude",
    instructions: "claude",
    license: "license",
    licence: "license",
    copying: "license",
    roadmap: "roadmap",
  };

  const collapsed = new Set();      // collapsed dir paths (relative)
  // Top-header manual reload button. A user-driven refresh bypasses the
  // watcher's cheap JSON compare so the button always re-fetches.
  const refreshBtn = document.getElementById("sidebar-refresh");
  let selectedPath = null;
  let draggingNode = null;          // { path, type } the row being dragged (module state: works in jsdom too)
  // Bookmarks: an ordered list of file paths. Lives in module state and is
  // mirrored to cfg.bookmarks by app.js's persistConfig() -- the source of
  // truth on disk is config.json; this list is the in-memory view. Insertion
  // order: bookmark(file) appends; reordering is via drag.
  let bookmarks = [];
  // The bookmark row currently being dragged (only one at a time). Same
  // idiom as draggingNode for the tree -- module-scoped so the dragover
  // handler on the list can see it without a closure.
  let draggingBookmark = null;
  // Tracks the active file so the bookmarks "+" button is enabled only
  // when there's a file to bookmark (and not already bookmarked).
  let activeFile = null;

  /* --- render -------------------------------------------------------- */
  function render(tree) {
    treeEl.innerHTML = "";
    renderBookmarks();
    if (!tree.length) {
      const empty = document.createElement("div");
      empty.className = "tree-empty";
      empty.textContent = "No files yet. Right-click here to create one.";
      treeEl.appendChild(empty);
      return;
    }
    tree.forEach((node, i) => {
      treeEl.appendChild(renderNode(node, i === tree.length - 1, [], true));
    });
  }

  /* Build the leading "tree-command" guide for a row: one 18px cell per
   * ancestor level (drawing a vertical pipe when that level keeps
   * branching below) plus one last cell with the row's own corner
   * ("├──" branch / "└── end). The verticals are CSS-drawn 1px lines
   * that overlap rows' padding, so consecutive rows read as one
   * unbroken stroke (text glyphs like │ leave a gap between rows).
   * ancestors[] holds one boolean per ancestor level, set true when the
   * pipe must continue past this row. */
  function renderNode(node, isLast, ancestors, isRoot) {
    const wrap = document.createElement("div");
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = node.path;
    row.draggable = true;
    const guide = document.createElement("span");
    guide.className = "tree-guide";
    for (const pipe of ancestors) {
      const cell = document.createElement("span");
      cell.className = "tcell" + (pipe ? " vert" : "");
      guide.appendChild(cell);
    }
    // Root-level rows are flat -- no corner cell, no branch above them.
    if (!isRoot) {
      const corner = document.createElement("span");
      corner.className = "tcell" + (isLast ? " cnr-last" : " cnr");
      guide.appendChild(corner);
    }
    row.appendChild(guide);
    if (node.type === "dir") {
      const isCollapsed = collapsed.has(node.path);
      if (isCollapsed) row.classList.add("collapsed");
      const icon = iconEl(isCollapsed ? DIR_ICON : DIR_ICON_OPEN);
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      row.append(icon, name);
      row.addEventListener("click", () => toggleDir(node));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault(); openMenu(e, node);
      });
      wrap.appendChild(row);
      const childWrap = document.createElement("div");
      childWrap.className = "tree-children";
      if (node.children) {
        // Root rows are flat, so they contribute no ancestor column --
        // their children start at their own corner. Every deeper level
        // adds one pipe cell that tracks whether the branch continues.
        const childAncestors = isRoot ? [] : ancestors.concat(!isLast);
        node.children.forEach((c, i) => {
          childWrap.appendChild(renderNode(c, i === node.children.length - 1, childAncestors, false));
        });
      }
      wrap.appendChild(childWrap);
      if (isCollapsed) childWrap.style.display = "none";
    } else {
      const icon = iconEl(fileIconId(node.name));
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      // Inline ⭐ toggle. Hidden by default (CSS); shown on row hover, and
      // always shown (in the "is-bookmarked" color) when the file is
      // already pinned. Click toggles bookmark state and updates both the
      // list and the tree row's class. Click handler stops propagation
      // so the row's own openFile click doesn't also fire.
      const star = document.createElement("span");
      star.className = "tree-star" + (bookmarks.includes(node.path) ? " is-bookmarked" : "");
      star.textContent = bookmarks.includes(node.path) ? STAR_ON : STAR_OFF;
      star.title = bookmarks.includes(node.path) ? "Remove bookmark" : "Add bookmark";
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleBookmark(node.path);
      });
      star.addEventListener("mousedown", (e) => e.stopPropagation());
      star.addEventListener("dragstart", (e) => e.preventDefault());
      row.append(icon, name, star);
      if (node.path === selectedPath) row.classList.add("selected");
      row.addEventListener("click", () => openFile(node.path));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault(); openMenu(e, node);
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  function toggleDir(node) {
    if (collapsed.has(node.path)) {
      collapsed.delete(node.path);
      // Expanding a folder shows just one level down; everything beneath
      // the newly-revealed subfolders stays closed, so the tree looks fresh
      // instead of replaying whatever sub-state lingered before the parent
      // was collapsed.
      collapseUnder(node);
    } else {
      collapsed.add(node.path);
      // Closing a folder also closes every subfolder underneath it.
      collapseUnder(node);
    }
    refresh();
  }

  /* Collapse all subfolders nested under `node` (recursively). */
  function collapseUnder(node) {
    if (!node.children) return;
    for (const c of node.children) {
      if (c.type !== "dir") continue;
      collapsed.add(c.path);
      collapseUnder(c);
    }
  }

  /* Collapse every folder in the tree. Backs the "Collapse all folders"
   * context-menu item; reuses the same `collapsed` set that manual
   * toggles populate, so a later refresh() keeps the tree collapsed. */
  function collapseAll() {
    markAllCollapsed(treeCache);
    render(treeCache);
  }

  /* Add every folder in `nodes` to the `collapsed` set (recursive). */
  function markAllCollapsed(nodes) {
    for (const n of nodes || []) {
      if (n.type === "dir") {
        collapsed.add(n.path);
        markAllCollapsed(n.children);
      }
    }
  }

  /* True when the tree contains at least one folder (root-level or
   * nested) -- gates the "Collapse all folders" menu item so the
   * no-op action doesn't show on a file-only / empty tree. */
  function treeHasDir(tree) {
    for (const n of tree) {
      if (n.type === "dir") return true;
      if (n.children && treeHasDir(n.children)) return true;
    }
    return false;
  }

  /* --- bookmarks ------------------------------------------------------ */
  /* The bookmark section is a fixed list rendered above the file tree.
   * State lives in module-scope `bookmarks` (an array of file paths in
   * insertion order) and is mirrored to cfg.bookmarks by app.js via the
   * NB.sidebar.setBookmarks() setter. The list is rebuilt from scratch on
   * every render -- bookmarks are a small set (a dozen or two at most), so
   * the cost of re-rendering is negligible and the code stays uniform with
   * the tree's render path. */
  function renderBookmarks() {
    if (!bookmarksListEl) return;
    bookmarksListEl.innerHTML = "";
    if (!bookmarks.length) {
      const empty = document.createElement("div");
      empty.className = "bookmarks-empty";
      empty.textContent = "No bookmarks yet. Right-click a file to pin it.";
      bookmarksListEl.appendChild(empty);
      return;
    }
    for (const path of bookmarks) {
      bookmarksListEl.appendChild(renderBookmarkRow(path));
    }
  }

  function renderBookmarkRow(path) {
    const row = document.createElement("div");
    row.className = "bookmark-row";
    row.dataset.path = path;
    row.draggable = true;
    // Reserve the same width the tree uses for its leading icon so the
    // file name aligns across the two sections. Empty strings keep
    // the row's name at the same x position a .tree-row would put it.
    const pin = document.createElement("span");
    pin.className = "bookmark-pin";
    pin.textContent = STAR_ON;
    const name = document.createElement("span");
    name.className = "bookmark-name";
    // Show just the base name in the list; the full path is recoverable
    // from data-path. baseName() is the existing helper further down.
    name.textContent = baseName(path);
    name.title = path;
    row.append(pin, name);
    if (path === selectedPath) row.classList.add("selected");
    row.addEventListener("click", () => openFile(path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openBookmarkMenu(e, path);
    });
    return row;
  }

  /* Add or remove a path from the bookmark list. The setter call below
   * is the only path that mutates `bookmarks` AND fires config:changed;
   * every other call site (star click, context-menu item, + button,
   * drag-reorder drop, prune-on-refresh) goes through this function so
   * the order of operations -- mutate, render, persist -- stays in one
   * place. */
  function toggleBookmark(path) {
    if (!path) return;
    const i = bookmarks.indexOf(path);
    if (i >= 0) {
      bookmarks.splice(i, 1);
    } else {
      bookmarks.push(path);
    }
    render(treeCache);
    // Reflect the new state in the tree-row's star class. The full
    // re-render above already redrew the row, but a re-render may not
    // have happened if render() was called before this function; the
    // explicit toggle below covers that case (idempotent if the class
    // is already correct from the re-render).
    updateTreeStar(path);
    // The + button's hidden state depends on whether the active file
    // is bookmarked; re-evaluate it now so the UI reflects the change
    // immediately (e.g. clicking the + on a file should hide the +,
    // toggling a file's star off should show the + again).
    setActiveFile(activeFile);
    persistBookmarks();
  }

  /* Keep a single tree row's star class in sync without a full re-render
   * -- used after a bookmark-list re-render so the tree's row matches
   * the new state without re-running the full tree walk. */
  function updateTreeStar(path) {
    const row = document.querySelector(
      '.tree-row[data-path="' + cssEscape(path) + '"]');
    if (!row) return;
    const star = row.querySelector(".tree-star");
    if (!star) return;
    const isOn = bookmarks.includes(path);
    star.textContent = isOn ? STAR_ON : STAR_OFF;
    star.title = isOn ? "Remove bookmark" : "Add bookmark";
    star.classList.toggle("is-bookmarked", isOn);
  }

  /* Drag-to-reorder the bookmark list. The handlers live on the list
   * element so the empty area of the list still accepts a drop (which
   * would otherwise leave the user with no way to drop a row at the end).
   * Reordering is purely a UI concern: we mutate `bookmarks` in place
   * and call persistBookmarks() -- no API call, no tree change. */
  function reorderBookmark(fromPath, toPath, before) {
    const fromIdx = bookmarks.indexOf(fromPath);
    if (fromIdx < 0) return;
    const [moved] = bookmarks.splice(fromIdx, 1);
    if (!toPath) {
      // Drop on the empty area: append at the end.
      bookmarks.push(moved);
    } else {
      const toIdx = bookmarks.indexOf(toPath);
      if (toIdx < 0) {
        // Target vanished mid-drag (unlikely but defensive): re-append.
        bookmarks.push(moved);
      } else {
        bookmarks.splice(before ? toIdx : toIdx + 1, 0, moved);
      }
    }
    renderBookmarks();
    persistBookmarks();
  }

  /* Prune any bookmark whose path isn't in the current tree. Called
   * after every tree refresh (which already runs after create / rename /
   * delete). Silently drops stale entries; the user's mental model of
   * the list stays in sync with what's actually on disk. */
  function pruneBookmarks(tree) {
    if (!bookmarks.length) return;
    const before = bookmarks.length;
    bookmarks = bookmarks.filter(p => treeHasPath(tree, p));
    if (bookmarks.length !== before) persistBookmarks();
  }

  function treeHasPath(tree, path) {
    for (const n of tree) {
      if (n.path === path) return true;
      if (n.children && treeHasPath(n.children, path)) return true;
    }
    return false;
  }

  /* The setter app.js calls after a config load. Triggers a re-render
   * so the list reflects the loaded state without waiting for the next
   * tree refresh. */
  function setBookmarks(list) {
    bookmarks = Array.isArray(list) ? list.slice() : [];
    renderBookmarks();
  }
  function getBookmarks() { return bookmarks.slice(); }

  /* Persist through the same cfg write path the rest of the UI uses.
   * NB.app.setBookmarks() is the central mutation point: it mutates
   * cfg.bookmarks, persists, and emits config:changed so any listener
   * (e.g. the tabs module) can react. Keeping it on app.js mirrors the
   * existing setTheme / setFontSize / setWallpaper pattern. */
  function persistBookmarks() {
    if (NB.app && NB.app.setBookmarks) NB.app.setBookmarks(bookmarks);
  }

  /* The "+" button in the bookmarks header: bookmark the active file
   * if there is one and it isn't already bookmarked. The button is
   * shown/hidden by setActiveFile() so it only appears when it'd be
   * useful. */
  if (bookmarksAddBtn) {
    bookmarksAddBtn.addEventListener("click", () => {
      if (activeFile && !bookmarks.includes(activeFile)) {
        toggleBookmark(activeFile);
      }
    });
  }

  function setActiveFile(path) {
    activeFile = path || null;
    if (bookmarksAddBtn) {
      // Show the + only when there's an active file AND it isn't
      // already bookmarked. When the active file IS bookmarked, the
      // row's inline star in the tree is the affordance to remove it.
      const show = activeFile && !bookmarks.includes(activeFile);
      bookmarksAddBtn.hidden = !show;
    }
  }

  /* --- drag-and-drop handlers for the bookmark list ---------------- */
  /* Wired up after setActiveFile so the helpers it depends on exist
   * when the listeners fire. We re-use the same `dataTransfer` pattern
   * the tree uses (effectAllowed = "move"), but the data key is local
   * to this module so a tree drag can't accidentally trigger a bookmark
   * drop. */
  if (bookmarksListEl) {
    bookmarksListEl.addEventListener("dragstart", (e) => {
      const row = e.target.closest && e.target.closest(".bookmark-row");
      if (!row || !row.dataset.path) { e.preventDefault(); return; }
      draggingBookmark = row.dataset.path;
      row.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "bookmark:" + row.dataset.path); }
        catch (_) {}
      }
    });
    bookmarksListEl.addEventListener("dragover", (e) => {
      if (!draggingBookmark) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearBookmarkDropMarks();
      const row = e.target.closest && e.target.closest(".bookmark-row");
      if (!row || row.dataset.path === draggingBookmark) {
        // Over the empty area below the last row, OR over the row being
        // dragged itself. The empty area marker is the list-level
        // .drop-empty class so the dashed outline shows around the
        // whole list, not a single row.
        bookmarksListEl.classList.add("drop-empty");
        return;
      }
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.classList.add(before ? "drop-before" : "drop-after");
    });
    bookmarksListEl.addEventListener("drop", (e) => {
      if (!draggingBookmark) return;
      e.preventDefault();
      const row = e.target.closest && e.target.closest(".bookmark-row");
      let targetPath = null, before = true;
      if (row && row.dataset.path && row.dataset.path !== draggingBookmark) {
        const rect = row.getBoundingClientRect();
        targetPath = row.dataset.path;
        before = e.clientY < rect.top + rect.height / 2;
      }
      const from = draggingBookmark;
      clearBookmarkDragging();
      try { reorderBookmark(from, targetPath, before); }
      catch (err) { console.error("bookmark reorder failed", err); }
    });
    bookmarksListEl.addEventListener("dragend", clearBookmarkDragging);
  }
  function clearBookmarkDropMarks() {
    if (!bookmarksListEl) return;
    bookmarksListEl.querySelectorAll(".drop-before,.drop-after")
      .forEach(r => r.classList.remove("drop-before", "drop-after"));
    bookmarksListEl.classList.remove("drop-empty");
  }
  function clearBookmarkDragging() {
    draggingBookmark = null;
    if (!bookmarksListEl) return;
    bookmarksListEl.querySelectorAll(".dragging")
      .forEach(r => r.classList.remove("dragging"));
    clearBookmarkDropMarks();
  }

  /* --- context menu for the bookmark list -------------------------- */
  /* The item categories follow the canonical order: Open, Create,
   * Organize, View, Terminal, with a separator between each pair of
   * adjacent non-empty categories. A bookmark references a single file,
   * so it shows no Create and no View category (Collapse all folders is
   * a sidebar action, not a file action). */
  function bookmarkMenuItems(path) {
    return [
      { label: "Open", handler: () => openFile(path) },
      { separator: true },
      { label: "Export…", handler: () => doExport(path) },
      // Rename / Move mirrors the tree row's menu shape so the user's
      // mental model is the same: both menus on a file path are
      // identical. doRename() re-keys the bookmark on the file:moved
      // event (see below) so the row follows the file to its new path.
      { label: "Rename / Move…", handler: () => doRename({ path, type: "file" }) },
      { label: "Copy…", handler: () => doCopy({ path, type: "file" }) },
      { label: "Copy path", handler: () => NB.app.copyPath(path) },
      { label: "Copy link", handler: () => NB.app.copyLink(path) },
      { label: "Remove bookmark", handler: () => toggleBookmark(path) },
      { separator: true },
      { label: "Delete", danger: true, handler: () => doDelete({ path, type: "file" }) },
    ];
  }

  function openBookmarkMenu(e, path) {
    NB.menu.open({
      owner: "sidebar", x: e.clientX, y: e.clientY, scope: sidebarEl,
      items: bookmarkMenuItems(path), focusFirst: true,
    });
  }


  function setSelected(path) {
    selectedPath = path;
    document.querySelectorAll(".tree-row.selected")
      .forEach(r => r.classList.remove("selected"));
    const row = document.querySelector('.tree-row[data-path="' +
      cssEscape(path) + '"]');
    if (row) row.classList.add("selected");
  }

  /* --- vim-mode cursor (NB.vimnav drives this) ------------------- */
  /* A separate highlight from .selected (the active file). The vim
   * cursor is what j/k moves; Enter/l opens. We track it as a path
   * and re-render its highlight on every move. */
  let vimCursorPath = null;
  function vimCursorRows() {
    // Only the rows that are currently visible in the DOM (we don't
    // walk the tree model -- the rendered order is what j/k follows,
    // matching the user's mental model of the tree). Bookmarks are
    // included so j/k moves continuously across both sections: the
    // bookmark list sits above the tree in the rendered DOM, so a
    // single querySelectorAll in document order naturally interleaves
    // them.
    return Array.from(document.querySelectorAll(".tree-row, .bookmark-row"));
  }
  function setVimCursor(path) {
    vimCursorPath = path;
    document.querySelectorAll(".tree-row.vim-cursor")
      .forEach(r => r.classList.remove("vim-cursor"));
    if (!path) return;
    const row = document.querySelector('.tree-row[data-path="' +
      cssEscape(path) + '"]');
    if (row) row.classList.add("vim-cursor");
  }
  function getVimCursor() { return vimCursorPath; }
  function vimCursorNext() {
    const rows = vimCursorRows();
    if (rows.length === 0) return null;
    const idx = vimCursorPath
      ? rows.findIndex(r => r.dataset.path === vimCursorPath)
      : -1;
    const next = rows[Math.min(rows.length - 1, idx + 1)] || rows[0];
    if (next) setVimCursor(next.dataset.path);
    return next ? next.dataset.path : null;
  }
  function vimCursorPrev() {
    const rows = vimCursorRows();
    if (rows.length === 0) return null;
    const idx = vimCursorPath
      ? rows.findIndex(r => r.dataset.path === vimCursorPath)
      : rows.length;
    const prev = rows[Math.max(0, idx - 1)] || rows[0];
    if (prev) setVimCursor(prev.dataset.path);
    return prev ? prev.dataset.path : null;
  }
  function vimCursorOpen() {
    if (!vimCursorPath) return;
    // Bookmarks are always openable; the row's "collapsed" semantics
    // only exist for tree folders, so for a bookmark we go straight to
    // openFile.
    const bRow = document.querySelector('.bookmark-row[data-path="' +
      cssEscape(vimCursorPath) + '"]');
    if (bRow) { openFile(vimCursorPath); return; }
    const row = document.querySelector('.tree-row[data-path="' +
      cssEscape(vimCursorPath) + '"]');
    if (!row) return;
    if (row.classList.contains("collapsed")) {
      // Expand a folder.
      collapsed.delete(vimCursorPath);
      row.classList.remove("collapsed");
      // The children appear in the DOM; the cursor stays on the
      // folder. (NB.vimnav's "h" handles collapse.)
    } else {
      openFile(vimCursorPath);
    }
  }
  function vimCursorCollapse() {
    if (!vimCursorPath) return;
    // A bookmark is a leaf; "h" on a bookmark jumps to its parent
    // folder the same way it does for a file.
    const bRow = document.querySelector('.bookmark-row[data-path="' +
      cssEscape(vimCursorPath) + '"]');
    if (bRow) {
      const path = vimCursorPath;
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        const parent = path.slice(0, lastSlash);
        setVimCursor(parent);
      }
      return;
    }
    const row = document.querySelector('.tree-row[data-path="' +
      cssEscape(vimCursorPath) + '"]');
    if (!row) return;
    if (row.classList.contains("dir")) {
      collapsed.add(vimCursorPath);
      row.classList.add("collapsed");
    } else {
      // File: move cursor to its parent directory, if any.
      const path = vimCursorPath;
      const lastSlash = path.lastIndexOf("/");
      if (lastSlash > 0) {
        const parent = path.slice(0, lastSlash);
        setVimCursor(parent);
      }
    }
  }
  function openFile(path) {
    setSelected(path);
    NB.evt.emit("file:open-request", path);
  }

  /* Reveal a file in the sidebar tree: expand every ancestor folder on
   * the path and highlight the file's row. Backs the tab context menu's
   * "Show in file sidebar" item. Any folder that's collapsed along the
   * path is opened so the file's location is visible. */
  function revealFile(path) {
    if (!path) return;
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      collapsed.delete(parts.slice(0, i).join("/"));
    }
    selectedPath = path;
    refresh();
  }

  /* --- context menu --------------------------------------------------- */
  /* Tree file row: Open | Create | Organize | View | Terminal. */
  function treeFileMenuItems(node) {
    const items = [
      { label: "Open", handler: () => openFile(node.path) },
      { separator: true },
      { label: "New file…", handler: () => doNewFile(node, false) },
      { label: "New folder…", handler: () => doNewFolder(node, false) },
      { separator: true },
      { label: "Export…", handler: () => doExport(node.path) },
      { label: "Rename / Move…", handler: () => doRename(node) },
      { label: "Copy…", handler: () => doCopy(node) },
      { label: "Copy path", handler: () => NB.app.copyPath(node.path) },
      { label: "Copy link", handler: () => NB.app.copyLink(node.path) },
      // Bookmark toggle for files only (folders can't be opened as a
      // single document, and a "bookmark" on a folder is ambiguous --
      // does it pin the folder itself or every file inside?). The label
      // flips based on the current state so the user always sees the
      // action that the click will perform.
      {
        label: bookmarks.includes(node.path) ? "Remove bookmark" : "Add bookmark",
        handler: () => toggleBookmark(node.path),
      },
    ];
    return withCollapseAndDelete(items, node);
  }

  /* Tree folder row: Create | Organize | View | Terminal. No Open, no
   * Export, and no bookmark toggle (guarded to files). */
  function treeFolderMenuItems(node) {
    const items = [
      { label: "New file…", handler: () => doNewFile(node, true) },
      { label: "New folder…", handler: () => doNewFolder(node, true) },
      { separator: true },
      { label: "Rename / Move…", handler: () => doRename(node) },
      { label: "Copy…", handler: () => doCopy(node) },
    ];
    return withCollapseAndDelete(items, node);
  }

  /* Append the View category (Collapse all folders, only when the tree has
   * a folder) and the Terminal category (Delete), each separated from the
   * group before it. */
  function withCollapseAndDelete(items, node) {
    if (treeHasDir(treeCache)) {
      items.push({ separator: true });
      items.push({ label: "Collapse all folders", handler: () => collapseAll() });
    }
    items.push({ separator: true });
    items.push({ label: "Delete", danger: true, handler: () => doDelete(node) });
    return items;
  }

  function openMenu(e, node) {
    const items = node.type === "dir" ? treeFolderMenuItems(node) : treeFileMenuItems(node);
    NB.menu.open({
      owner: "sidebar", x: e.clientX, y: e.clientY, scope: sidebarEl,
      items, focusFirst: true,
    });
  }

  /* Right-clicking the empty sidebar area (or an empty folder region)
   * offers root-level New file / New folder, so there's always a way to
   * create the first file without top-bar buttons. */
  function openRootMenu(e) {
    const items = [
      { label: "New file…", handler: () => createAtRoot("file") },
      { label: "New folder…", handler: () => createAtRoot("dir") },
    ];
    if (treeHasDir(treeCache)) {
      items.push({ separator: true });
      items.push({ label: "Collapse all folders", handler: () => collapseAll() });
    }
    NB.menu.open({
      owner: "sidebar", x: e.clientX, y: e.clientY, scope: sidebarEl,
      items, focusFirst: true,
    });
  }
  treeEl.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".tree-row")) return;   // a file/folder row handles itself
    e.preventDefault();
    openRootMenu(e);
  });

  /* --- operations ----------------------------------------------------- */
  function parentOf(path) {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
  }
  function baseName(path) {
    const i = path.lastIndexOf("/");
    return i < 0 ? path : path.slice(i + 1);
  }

  // A tree icon: a 16x16 <svg> that pulls its shape from the hidden
  // <symbol> sprite in index.html via <use>. `data-icon` carries the icon
  // name so tests and CSS can identify it without resolving the sprite.
  function iconEl(id) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tree-icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.dataset.icon = id;
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#nb-icon-" + id);
    svg.appendChild(use);
    return svg;
  }

  // Icon id for a file row: the well-known-name lookup, else the generic
  // file icon. Matching is on the stem with its extension stripped,
  // case-folded ("README.md" and "readme.markdown" both map to readme).
  function fileIconId(name) {
    const dot = name.lastIndexOf(".");
    const stem = (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
    return FILE_ICON_MAP[stem] || FILE_ICON;
  }

  function dirForNew(node, isDir) {
    // For a dir node, create inside it; for a file, create beside it.
    return isDir ? node.path : parentOf(node.path);
  }

  // Notes are always Markdown. Force the .md extension on the basename
  // (a dot in a parent folder like "v1.0/notes" must not be mistaken
  // for an extension), so the user never picks an unsupported type.
  function withMdExtension(name) {
    const i = name.lastIndexOf("/");
    const dir = i < 0 ? "" : name.slice(0, i + 1);
    const base = i < 0 ? name : name.slice(i + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    return dir + stem + ".md";
  }

  async function doNewFile(node, isDir) {
    const dir = dirForNew(node, isDir);
    const name = prompt("New file name:", "untitled");
    if (!name) return;
    const path = dir ? dir + "/" + withMdExtension(name) : withMdExtension(name);
    try {
      await NB.api.createItem(path, "file");
      await refresh();
      openFile(path);
    } catch (e) { alert("Create failed: " + e.message); }
  }

  async function doNewFolder(node, isDir) {
    const dir = dirForNew(node, isDir);
    const name = prompt("New folder name:", "new-folder");
    if (!name) return;
    const path = dir ? dir + "/" + name : name;
    try {
      await NB.api.createItem(path, "dir");
      collapsed.delete(path);
      await refresh();
    } catch (e) { alert("Create failed: " + e.message); }
  }

  async function doRename(node) {
    const to = prompt("Move / rename to (path relative to data/):", node.path);
    if (!to || to === node.path) return;
    try {
      await NB.api.moveItem(node.path, to);
      NB.evt.emit("file:moved", { from: node.path, to });
      if (selectedPath === node.path) openFile(to);
      await refresh();
    } catch (e) { alert("Move failed: " + e.message); }
  }

  async function doCopy(node) {
    const dot = baseName(node.path).lastIndexOf(".");
    const stem = dot > 0 ? baseName(node.path).slice(0, dot) : baseName(node.path);
    const ext = dot > 0 ? baseName(node.path).slice(dot) : "";
    const suggested = parentOf(node.path)
      ? parentOf(node.path) + "/" + stem + "-copy" + ext
      : stem + "-copy" + ext;
    const to = prompt("Copy to (path relative to data/):", suggested);
    if (!to || to === node.path) return;
    try {
      await NB.api.copyItem(node.path, to);
      await refresh();
    } catch (e) { alert("Copy failed: " + e.message); }
  }

  function doExport(path) {
    if (NB.export && NB.export.open) NB.export.open(path);
  }

  async function doDelete(node) {
    const kind = node.type === "dir" ? "folder and all its contents" : "file";
    if (!confirm("Delete " + kind + ":\n" + node.path + "\nThis cannot be undone.")) return;
    try {
      await NB.api.deleteItem(node.path);
      if (selectedPath === node.path) selectedPath = null;
      await refresh();
      NB.evt.emit("file:deleted", node.path);
    } catch (e) { alert("Delete failed: " + e.message); }
  }

  /* --- root-level shortcuts (top bar) -------------------------------- */
  async function createAtRoot(type) {
    let name = prompt(type === "dir" ? "New folder name:" : "New file name:", type === "dir" ? "new-folder" : "untitled");
    if (!name) return;
    if (type === "file") name = withMdExtension(name);
    try {
      await NB.api.createItem(name, type);
      if (type === "dir") collapsed.delete(name);
      await refresh();
      if (type === "file") openFile(name);
    } catch (e) { alert("Create failed: " + e.message); }
  }

  /* --- helpers -------------------------------------------------------- */
  let treeCache = [];
  let didInitialCollapse = false;   // collapse every folder on first load
  async function refresh() {
    try {
      treeCache = await NB.api.getTree();
      // On the first load of the session the tree starts fully collapsed:
      // every folder closed, so a page reload lands on a tidy sidebar
      // instead of replaying every expansion. Only the first fetch -- the
      // user's manual expands/collapses drive the state from then on.
      if (!didInitialCollapse) {
        didInitialCollapse = true;
        markAllCollapsed(treeCache);
      }
      // Prune any bookmarks whose file vanished (delete, rename) BEFORE
      // render so the row never appears against a missing file. Skipped
      // when the bookmark list is empty to avoid the no-op work.
      if (bookmarks.length) pruneBookmarks(treeCache);
      render(treeCache);
      NB.evt.emit("tree:refreshed", treeCache);
    } catch (e) { console.error("tree fetch failed", e); }
  }
  function getTree() { return treeCache; }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* --- drag-and-drop move ------------------------------------------- */
  /* Files and folders can be dragged onto a folder row (lands inside it) or
   * onto a file row (lands beside it in the same parent). Dropping on the
   * empty tree area moves to the root. */
  function findNode(tree, path) {
    for (const n of tree) {
      if (n.path === path) return n;
      if (n.children) { const r = findNode(n.children, path); if (r) return r; }
    }
    return null;
  }

  function isAncestorOrSelf(ancestor, descendant) {
    if (ancestor === descendant) return true;
    if (!descendant.startsWith(ancestor + "/")) return false;
    return true;
  }

  function resolveDropTarget(targetRow, mouseX) {
    if (!targetRow) return { dir: "", insertBefore: null };
    const node = findNode(treeCache, targetRow.dataset.path);
    if (node && node.type === "dir") {
      return { dir: node.path, insertBefore: null };
    }
    // file row -> drop beside, in the same parent
    const parent = parentOf(targetRow.dataset.path);
    const rect = targetRow.getBoundingClientRect();
    const before = mouseX < rect.left + rect.width / 2;
    return { dir: parent, insertBefore: { parent, path: targetRow.dataset.path, before } };
  }

  async function performMove(from, target) {
    let to;
    if (target.insertBefore) {
      const { parent, path, before } = target.insertBefore;
      const name = baseName(from);
      const siblings = (function listSiblings(t) {
        if (parent === "") return t;
        const p = findNode(t, parent);
        return p ? p.children : [];
      })(treeCache);
      // Find the index of the target sibling among its parent's children
      const i = siblings.findIndex(n => n.path === path);
      const j = i + (before ? 0 : 1);
      const beforeName = j > 0 ? baseName(siblings[j - 1].path) : null;
      const afterName  = j < siblings.length ? baseName(siblings[j].path) : null;
      // Backend requires an exact destination path (no "insert before X"
      // syntax). Derive a non-conflicting destination by picking before or
      // after and disambiguating on conflict.
      const tryName = (suffix) => (parent ? parent + "/" : "") + name + suffix;
      to = beforeName
        ? tryName(" (before " + beforeName + ")")
        : afterName
          ? tryName(" (after " + afterName + ")")
          : tryName("");
      // Collapse "name (before X) (before Y)" style collisions: try
      // sequentially and back off to a numbered copy on conflict.
      let attempt = to;
      for (let n = 2; n < 1000; n++) {
        try {
          await NB.api.moveItem(from, attempt);
          to = attempt;
          break;
        } catch (e) {
          if (!/409|exists|already/i.test(e.message) || n === 999) throw e;
          attempt = tryName(" (" + n + ")");
        }
      }
    } else {
      // dropped onto a folder or the empty area
      const name = baseName(from);
      to = target.dir ? target.dir + "/" + name : name;
      await NB.api.moveItem(from, to);
    }
    NB.evt.emit("file:moved", { from, to });
    if (selectedPath === from) openFile(to);
    await refresh();
  }

  treeEl.addEventListener("dragstart", (e) => {
    const row = e.target.closest && e.target.closest(".tree-row");
    if (!row || !row.dataset.path) { e.preventDefault(); return; }
    const node = findNode(treeCache, row.dataset.path);
    if (!node) { e.preventDefault(); return; }
    draggingNode = { path: node.path, type: node.type };
    row.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", node.path); } catch (_) {}
    }
  });

  treeEl.addEventListener("dragover", (e) => {
    if (!draggingNode) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    const row = e.target.closest && e.target.closest(".tree-row");
    if (!row) {
      // over the empty tree area: mark the whole pane for "move to root"
      treeEl.classList.add("drop-empty");
      return;
    }
    if (row.dataset.path === draggingNode.path) return;   // can't drop on self
    const node = findNode(treeCache, row.dataset.path);
    if (!node) return;
    if (node.type === "dir" && draggingNode.type === "dir" &&
        isAncestorOrSelf(draggingNode.path, node.path)) return;   // no recurse
    if (node.type === "dir") row.classList.add("drop-folder-target");
    else {
      const rect = row.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      row.classList.add(before ? "drop-before" : "drop-after");
    }
  });

  treeEl.addEventListener("drop", async (e) => {
    if (!draggingNode) return;
    e.preventDefault();
    const row = e.target.closest && e.target.closest(".tree-row");
    const target = row ? resolveDropTarget(row, e.clientX)
                       : { dir: "", insertBefore: null };
    // Final guard: a folder can't move into itself or a descendant. We
    // check this BEFORE clearing state so the guard has the data it needs.
    if (draggingNode.type === "dir" && target.dir &&
        isAncestorOrSelf(draggingNode.path, target.dir)) {
      clearDragging();
      alert("Cannot move a folder into itself or one of its subfolders.");
      return;
    }
    const from = draggingNode.path;
    clearDragging();
    try { await performMove(from, target); }
    catch (e) { alert("Move failed: " + e.message); await refresh(); }
  });

  treeEl.addEventListener("dragend", clearDragging);

  function clearDropMarks() {
    treeEl.querySelectorAll(".drop-before,.drop-after,.drop-folder-target")
      .forEach(r => r.classList.remove("drop-before", "drop-after", "drop-folder-target"));
    treeEl.classList.remove("drop-empty");
  }
  function clearDragging() {
    draggingNode = null;
    treeEl.querySelectorAll(".dragging").forEach(r => r.classList.remove("dragging"));
    clearDropMarks();
  }

  /* --- manual reload -------------------------------------------------- */
  /* The header's ↻ button. A direct user action, so it refreshes
   * unconditionally (no cheap JSON compare -- the user asked for a
   * fetch). Animated spin gives feedback that the click registered. */
  async function manualReload() {
    if (refreshBtn) {
      refreshBtn.classList.remove("spinning");
      void refreshBtn.offsetWidth;   // restart the animation on repeated clicks
      refreshBtn.classList.add("spinning");
      refreshBtn.addEventListener("animationend",
        () => refreshBtn.classList.remove("spinning"), { once: true });
    }
    await refresh();
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", manualReload);
  }

  NB.sidebar = {
    refresh, render, openFile, createAtRoot, getTree,
    collapseAll, revealFile,
    setVimCursor, getVimCursor, vimCursorNext, vimCursorPrev,
    vimCursorOpen, vimCursorCollapse,
    // Bookmark façade. setBookmarks is called by app.js after a config
    // load; getBookmarks / toggleBookmark are exposed for tests and
    // any future external trigger (e.g. a "pin current tab" shortcut).
    setBookmarks, getBookmarks, toggleBookmark,
    // File-operation façade. The tab menu runs the same rename / copy /
    // delete actions the tree and bookmark menus run, for the same path.
    renameFile: (path) => doRename({ path, type: "file" }),
    copyFile: (path) => doCopy({ path, type: "file" }),
    deleteFile: (path) => doDelete({ path, type: "file" }),
  };

  // Keep the tree highlight in sync whenever a file is shown, regardless of
  // how it was opened (tab click, search result, boot). Also drives the
  // bookmarks "+" button visibility: it shows only when the active file
  // isn't already bookmarked.
  NB.evt.on("file:open", (path) => {
    if (path) {
      setSelected(path);
      setActiveFile(path);
      // Mirror selection into the bookmark list so the same active
      // file in the tree reads as active in the bookmarks.
      document.querySelectorAll(".bookmark-row.selected")
        .forEach(r => r.classList.remove("selected"));
      if (bookmarks.includes(path)) {
        const bRow = document.querySelector(
          '.bookmark-row[data-path="' + cssEscape(path) + '"]');
        if (bRow) bRow.classList.add("selected");
      }
    } else {
      setActiveFile(null);
    }
  });

  // file:moved (rename via the bookmark menu's Rename / Move…, the
  // tree menu, or drag-and-drop) re-keys any bookmark pointing at the
  // old path. Without this the bookmark row would point at a file
  // that no longer exists, and the next refresh would silently prune
  // it. Re-keying inline keeps the bookmark across the rename without
  // a second user action.
  NB.evt.on("file:moved", ({ from, to }) => {
    const i = bookmarks.indexOf(from);
    if (i < 0) return;
    bookmarks[i] = to;
    renderBookmarks();
    persistBookmarks();
  });
})();