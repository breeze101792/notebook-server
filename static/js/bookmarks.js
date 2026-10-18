/* bookmarks.js -- the Bookmarks side-panel view (NB.bookmarks).
 *
 * Owns all bookmark state and UI: the ordered list of pinned file paths,
 * the list rendering, the ★ add button, drag-to-reorder, the bookmark
 * context menu, and the auto-prune when a file vanishes from the tree.
 * Extracted from sidebar.js so bookmarks live in their own activity-bar
 * view instead of a section above the file tree.
 *
 * The view host (#bookmarks-view) ships empty in index.html; this module
 * populates it at load with a standard .panel-header + the list. This
 * mirrors the Explorer view's eager-DOM pattern so the list state survives
 * view switches (activity.js only toggles [hidden]) and tests stay simple.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const viewEl = document.getElementById("bookmarks-view");
  const STAR_ON = "★";
  // Bookmarks: an ordered list of file paths. The source of truth on disk
  // is config.json; this list is the in-memory view. Insertion order:
  // toggle() appends; reordering is via drag.
  let bookmarks = [];
  // The bookmark row currently being dragged (only one at a time). Module
  // scope so the list-level dragover handler sees it without a closure.
  let draggingBookmark = null;
  // Tracks the active file so the ★ button shows only when there's a file
  // to bookmark (and it isn't already bookmarked).
  let activeFile = null;

  // DOM refs, filled by buildView(). Null when the host is missing, so
  // every use is guarded.
  let listEl = null;
  let addBtn = null;

  function isPhone() {
    return !!(window.NB && NB.mobile && NB.mobile.isOn && NB.mobile.isOn());
  }

  /* --- view construction --------------------------------------------- */
  /* Build the header + list once, at load. The host stays in the DOM
   * across view switches, so the list state survives. */
  function buildView() {
    if (!viewEl) return;
    viewEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "Bookmarks";
    header.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "panel-header-actions";
    addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "bookmarks-add";
    addBtn.id = "bookmarks-add";
    addBtn.title = "Bookmark the active file";
    addBtn.setAttribute("aria-label", "Bookmark the active file");
    addBtn.textContent = STAR_ON;
    addBtn.hidden = true;
    addBtn.addEventListener("click", () => {
      if (activeFile && !bookmarks.includes(activeFile)) toggle(activeFile);
    });
    actions.appendChild(addBtn);
    if (NB.activity && NB.activity.makeCollapseBtn) {
      actions.appendChild(NB.activity.makeCollapseBtn());
    }
    header.appendChild(actions);
    viewEl.appendChild(header);

    listEl = document.createElement("div");
    listEl.id = "bookmarks-list";
    listEl.className = "bookmarks-list";
    viewEl.appendChild(listEl);

    wireListDnD();
    render();
  }

  /* --- render --------------------------------------------------------- */
  /* The list is rebuilt from scratch on every render -- bookmarks are a
   * small set, so the cost is negligible and the code stays uniform. */
  function render() {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!bookmarks.length) {
      const empty = document.createElement("div");
      empty.className = "bookmarks-empty";
      empty.textContent = "No bookmarks yet. Add them from a desktop browser.";
      listEl.appendChild(empty);
      return;
    }
    for (const path of bookmarks) {
      listEl.appendChild(renderRow(path));
    }
  }

  function renderRow(path) {
    const row = document.createElement("div");
    row.className = "bookmark-row";
    row.dataset.path = path;
    row.draggable = !isPhone();
    // The leading ⭐ reserves the same width the tree uses for its icon so
    // the file name aligns across the two lists.
    const pin = document.createElement("span");
    pin.className = "bookmark-pin";
    pin.textContent = STAR_ON;
    const name = document.createElement("span");
    name.className = "bookmark-name";
    // Show just the base name; the full path is recoverable from data-path.
    name.textContent = baseName(path);
    name.title = path;
    row.append(pin, name);
    if (path === activeFile) row.classList.add("selected");
    row.addEventListener("click", () => NB.evt.emit("file:open-request", path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (isPhone()) return;   // read-only on the phone
      openBookmarkMenu(e, path);
    });
    return row;
  }

  /* --- public state --------------------------------------------------- */
  /* Config-load path: store + render, but do NOT persist (the caller --
   * app.js -- already owns the loaded value). */
  function set(list) {
    bookmarks = Array.isArray(list) ? list.slice() : [];
    render();
    updateAddBtn();
  }
  function get() { return bookmarks.slice(); }
  function has(path) { return bookmarks.includes(path); }

  /* Add or remove a path. The mutation -- render, persist, and the
   * bookmarks:changed notification the tree listens to -- stays in one
   * place so every call site (star click, context-menu item, + button,
   * drag-reorder drop, prune) is consistent. */
  function toggle(path) {
    if (!path || isPhone()) return;   // phone list is read-only

    const i = bookmarks.indexOf(path);
    if (i >= 0) {
      bookmarks.splice(i, 1);
    } else {
      bookmarks.push(path);
    }
    render();
    updateAddBtn();
    persist();
    NB.evt.emit("bookmarks:changed", { path });
  }

  /* The ★ button's hidden state depends on whether the active file is
   * bookmarked; re-evaluate it whenever the list or the active file
   * changes. */
  function updateAddBtn() {
    if (!addBtn) return;
    const show = !isPhone() && activeFile && !bookmarks.includes(activeFile);
    addBtn.hidden = !show;
  }

  /* Persist through the same cfg write path the rest of the UI uses.
   * NB.app.setBookmarks() is the central mutation point: it mutates
   * cfg.bookmarks, persists, and emits config:changed. */
  function persist() {
    if (NB.app && NB.app.setBookmarks) NB.app.setBookmarks(get());
  }

  /* Drop any bookmark whose path isn't in the current tree. Called by the
   * sidebar after every tree refresh so a deleted / renamed file doesn't
   * leave a dangling row. Persists only if something was pruned. */
  function prune(tree) {
    if (!bookmarks.length) return;
    const before = bookmarks.length;
    bookmarks = bookmarks.filter(p => treeHasPath(tree, p));
    if (bookmarks.length !== before) {
      render();
      persist();
      // The active file may have been the pruned one; re-evaluate the ★.
      updateAddBtn();
    }
  }

  function treeHasPath(tree, path) {
    for (const n of tree) {
      if (n.path === path) return true;
      if (n.children && treeHasPath(n.children, path)) return true;
    }
    return false;
  }

  /* --- drag-to-reorder ------------------------------------------------ */
  /* The handlers live on the list element so the empty area still accepts
   * a drop (which lands the row at the end). Reordering is purely a UI
   * concern: we mutate the list and persist -- no API call, no tree change. */
  function wireListDnD() {
    if (!listEl) return;
    listEl.addEventListener("dragstart", (e) => {
      if (isPhone()) { e.preventDefault(); return; }
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
    listEl.addEventListener("dragover", (e) => {
      if (isPhone() || !draggingBookmark) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearBookmarkDropMarks();
      const row = e.target.closest && e.target.closest(".bookmark-row");
      if (!row || row.dataset.path === draggingBookmark) {
        // Over the empty area below the last row, OR over the row being
        // dragged itself: mark the whole list.
        listEl.classList.add("drop-empty");
        return;
      }
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.classList.add(before ? "drop-before" : "drop-after");
    });
    listEl.addEventListener("drop", (e) => {
      if (isPhone() || !draggingBookmark) return;
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
    listEl.addEventListener("dragend", clearBookmarkDragging);
  }

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
        // Target vanished mid-drag (defensive): re-append.
        bookmarks.push(moved);
      } else {
        bookmarks.splice(before ? toIdx : toIdx + 1, 0, moved);
      }
    }
    render();
    persist();
  }

  function clearBookmarkDropMarks() {
    if (!listEl) return;
    listEl.querySelectorAll(".drop-before,.drop-after")
      .forEach(r => r.classList.remove("drop-before", "drop-after"));
    listEl.classList.remove("drop-empty");
  }
  function clearBookmarkDragging() {
    draggingBookmark = null;
    if (!listEl) return;
    listEl.querySelectorAll(".dragging")
      .forEach(r => r.classList.remove("dragging"));
    clearBookmarkDropMarks();
  }

  /* --- context menu --------------------------------------------------- */
  /* The canonical category order (Open | Create | Organize | View |
   * Terminal) minus Create -- a bookmark references an existing file. The
   * View group's "Show in file sidebar" reveals the file in the Explorer
   * tree. The façade functions are the ones the tree and tab menus also
   * use, so all three stay in step. */
  function bookmarkMenuItems(path) {
    return [
      { label: "Open", handler: () => NB.evt.emit("file:open-request", path) },
      { separator: true },
      { label: "Export…", handler: () => { if (NB.export && NB.export.open) NB.export.open(path); } },
      { label: "Rename / Move…", handler: () => sidebarOp("renameFile", path) },
      { label: "Copy…", handler: () => sidebarOp("copyFile", path) },
      { label: "Copy path", handler: () => NB.app.copyPath(path) },
      { label: "Copy link", handler: () => NB.app.copyLink(path) },
      { label: "Remove bookmark", handler: () => toggle(path) },
      { separator: true },
      { label: "Show in file sidebar", handler: () => sidebarOp("revealFile", path) },
      { separator: true },
      { label: "Delete", danger: true, handler: () => sidebarOp("deleteFile", path) },
    ];
  }

  function sidebarOp(name, path) {
    if (NB.sidebar && typeof NB.sidebar[name] === "function") NB.sidebar[name](path);
  }

  function openBookmarkMenu(e, path) {
    if (isPhone()) return;
    NB.menu.open({
      owner: "bookmarks", x: e.clientX, y: e.clientY, scope: viewEl,
      items: bookmarkMenuItems(path), focusFirst: true,
    });
  }

  /* --- helpers -------------------------------------------------------- */
  function baseName(path) {
    const i = path.lastIndexOf("/");
    return i < 0 ? path : path.slice(i + 1);
  }
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  NB.evt.on("mobile:mode", () => { render(); updateAddBtn(); });

  NB.bookmarks = { set, get, has, toggle, prune };

  // Keep the + button + row highlight in step with the active file,
  // however it was opened (tab click, search result, bookmark click, boot).
  NB.evt.on("file:open", (path) => {
    activeFile = path || null;
    if (listEl) {
      listEl.querySelectorAll(".bookmark-row.selected")
        .forEach(r => r.classList.remove("selected"));
      if (activeFile && bookmarks.includes(activeFile)) {
        const row = listEl.querySelector('.bookmark-row[data-path="' +
          cssEscape(activeFile) + '"]');
        if (row) row.classList.add("selected");
      }
    }
    updateAddBtn();
  });

  // A rename / move re-keys any bookmark pointing at the old path, so the
  // row follows the file instead of being pruned on the next refresh.
  NB.evt.on("file:moved", ({ from, to }) => {
    const i = bookmarks.indexOf(from);
    if (i < 0) return;
    bookmarks[i] = to;
    if (activeFile === from) activeFile = to;
    render();
    persist();
    updateAddBtn();
  });

  buildView();
})();
