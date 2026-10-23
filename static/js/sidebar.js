/* sidebar.js -- left file tree + context-menu file operations
 * (open, new file, new folder, rename/move, copy, delete).
 * Bookmark state and UI live in bookmarks.js (NB.bookmarks); this module
 * keeps only the tree's inline ⭐ and reads NB.bookmarks for its state.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const treeEl = document.getElementById("file-tree");
  const sidebarEl = document.getElementById("sidebar");
  const SVG_NS = "http://www.w3.org/2000/svg";
  // Tree icons are inline SVGs referencing the hidden <symbol> sprite in
  // index.html (id "nb-icon-<name>"). Inline SVG renders in colour on every
  // platform and does not depend on a colour-emoji font being installed.
  const DIR_ICON = "folder";
  const DIR_ICON_OPEN = "folder-open";
  const FILE_ICON = "file";
  const PIN_ICON = "pin";
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
  // Pinned folders: an ordered list of folder paths pinned to the top of
  // the Explorer view. Each pin expands in place to show its subtree,
  // independently of the main tree (pinExpanded is a separate set). Source
  // of truth on disk is config.json (pinnedFolders); this is the in-memory
  // view.
  let pinnedFolders = [];
  // Folder paths expanded inside the Pinned section. Deliberately NOT the
  // main tree's `collapsed` set -- the Pinned area's expand state is its
  // own concern and must never affect the tree.
  const pinExpanded = new Set();
  // The pin row being dragged (only one at a time). Module scope so the
  // list-level dragover handler sees it without a closure.
  let draggingPin = null;
  // Top-header manual reload button. A user-driven refresh bypasses the
  // watcher's cheap JSON compare so the button always re-fetches.
  const refreshBtn = document.getElementById("sidebar-refresh");
  // menu.js creates the singleton at load, before this module: cache it so
  // a note element carrying the same id cannot shadow it later.
  const menuEl = document.getElementById("nb-menu");
  // The Pinned section host, above the tree. Built by renderPins().
  const pinsEl = document.getElementById("pinned-folders");
  let selectedPath = null;
  let draggingNode = null;          // { path, type } the row being dragged (module state: works in jsdom too)

  function isPhone() {
    return !!(window.NB && NB.mobile && NB.mobile.isOn && NB.mobile.isOn());
  }

  /* --- render -------------------------------------------------------- */
  function render(tree) {
    treeEl.innerHTML = "";
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
   * unbroken stroke (text glyphs like │ leave a gap between them).
   * ancestors[] holds one boolean per ancestor level, set true when the
   * pipe must continue past this row. Shared by the main tree and the
   * Pinned section so both read identically. */
  function renderGuide(ancestors, isLast, isRoot) {
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
    return guide;
  }

  function renderNode(node, isLast, ancestors, isRoot) {
    const wrap = document.createElement("div");
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = node.path;
    row.draggable = !isPhone();
    row.appendChild(renderGuide(ancestors, isLast, isRoot));
    // Phone-only row action button (CSS-hidden on desktop). It reuses the
    // shared menu module; stopPropagation + preventDefault keeps the row's
    // own open/toggle click and drag from firing.
    function appendMore() {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "tree-more";
      more.textContent = "\u22EF";
      more.title = node.name + " actions";
      more.setAttribute("aria-label", node.name + " actions");
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        openRowMenu(more, node);
      });
      more.addEventListener("mousedown", (e) => e.stopPropagation());
      more.addEventListener("dragstart", (e) => e.preventDefault());
      row.appendChild(more);
    }
    if (node.type === "dir") {
      const isCollapsed = collapsed.has(node.path);
      if (isCollapsed) row.classList.add("collapsed");
      const icon = iconEl(isCollapsed ? DIR_ICON : DIR_ICON_OPEN);
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      // Inline pin toggle, mirroring the file row's ⭐. Hidden by default
      // (CSS); shown on row hover, always shown (lit) when the folder is
      // pinned. Click toggles the pin and stops propagation so the row's
      // own expand/collapse click doesn't also fire.
      const isPinned = hasPin(node.path);
      const pin = document.createElement("span");
      pin.className = "tree-pin" + (isPinned ? " is-pinned" : "");
      pin.title = isPinned ? "Unpin folder" : "Pin folder";
      pin.appendChild(iconEl(PIN_ICON));
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePin(node.path);
      });
      pin.addEventListener("mousedown", (e) => e.stopPropagation());
      pin.addEventListener("dragstart", (e) => e.preventDefault());
      row.append(icon, name, pin);
      appendMore();
      row.addEventListener("click", () => toggleDir(node));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (isPhone()) return;   // the phone uses the … button only
        openMenu(e, node);
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
      const pinned = NB.bookmarks && NB.bookmarks.has(node.path);
      const star = document.createElement("span");
      star.className = "tree-star" + (pinned ? " is-bookmarked" : "");
      star.textContent = pinned ? STAR_ON : STAR_OFF;
      star.title = pinned ? "Remove bookmark" : "Add bookmark";
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        if (NB.bookmarks) NB.bookmarks.toggle(node.path);
      });
      star.addEventListener("mousedown", (e) => e.stopPropagation());
      star.addEventListener("dragstart", (e) => e.preventDefault());
      row.append(icon, name, star);
      appendMore();
      if (node.path === selectedPath) row.classList.add("selected");
      row.addEventListener("click", () => openFile(node.path));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (isPhone()) return;
        openMenu(e, node);
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

  /* Keep a single tree row's star class in sync without a full re-render.
   * The bookmarks module fires bookmarks:changed from toggle(); this
   * redraws one row's star rather than re-walking the whole tree. */
  function updateTreeStar(path) {
    const row = treeEl.querySelector(
      '.tree-row[data-path="' + cssEscape(path) + '"]');
    if (!row) return;
    const star = row.querySelector(".tree-star");
    if (!star) return;
    const isOn = NB.bookmarks && NB.bookmarks.has(path);
    star.textContent = isOn ? STAR_ON : STAR_OFF;
    star.title = isOn ? "Remove bookmark" : "Add bookmark";
    star.classList.toggle("is-bookmarked", isOn);
  }

  /* Keep a single folder row's pin indicator in sync without a full
   * re-render (mirrors updateTreeStar). The pin span's state is the
   * .is-pinned class plus its title -- no text swap is needed. */
  function updateTreePin(path) {
    const row = treeEl.querySelector(
      '.tree-row[data-path="' + cssEscape(path) + '"]');
    if (!row) return;
    const pin = row.querySelector(".tree-pin");
    if (!pin) return;
    const isOn = hasPin(path);
    pin.title = isOn ? "Unpin folder" : "Pin folder";
    pin.classList.toggle("is-pinned", isOn);
  }

  function setSelected(path) {
    selectedPath = path;
    treeEl.querySelectorAll(".tree-row.selected")
      .forEach(r => r.classList.remove("selected"));
    const row = treeEl.querySelector('.tree-row[data-path="' +
      cssEscape(path) + '"]');
    if (row) row.classList.add("selected");
  }

  /* --- pinned folders ------------------------------------------------- */
  /* The Pinned section sits above the tree inside the Explorer view. A
   * pinned folder is a folder path; clicking its row expands it in place
   * to show its subtree (and collapses it again), independently of the
   * main tree. State is persisted as cfg.pinnedFolders (see app.js). */
  function setPinnedFolders(list) {
    pinnedFolders = Array.isArray(list) ? list.slice() : [];
    renderPins();
  }

  function getPinnedFolders() { return pinnedFolders.slice(); }

  function hasPin(path) { return pinnedFolders.includes(path); }

  /* Drop any pinExpanded entry that is no longer a pinned folder or a
   * descendant of one (a removed pin, or a folder moved away). */
  function prunePinExpanded() {
    for (const p of [...pinExpanded]) {
      if (!pinnedFolders.some(pin => p === pin || p.startsWith(pin + "/"))) {
        pinExpanded.delete(p);
      }
    }
  }

  /* Add or remove a folder pin. The mutation -- render pins + persist --
   * stays in one place so the tree's inline pin, the context menu, the
   * pin-row menu, and prune are all consistent. The main tree is updated
   * in place (updateTreePin), never re-rendered. */
  function togglePin(path) {
    if (!path) return;
    const i = pinnedFolders.indexOf(path);
    if (i >= 0) {
      pinnedFolders.splice(i, 1);
      pinExpanded.delete(path);
    } else {
      pinnedFolders.push(path);
    }
    prunePinExpanded();
    renderPins();
    updateTreePin(path);
    persistPins();
  }

  function persistPins() {
    if (NB.app && NB.app.setPinnedFolders) NB.app.setPinnedFolders(getPinnedFolders());
  }

  /* Rebuild the Pinned section from scratch. Hidden entirely when there
   * are no pins; otherwise a header row ("Pinned") followed by one
   * expandable row per pin, each showing its subtree when expanded. */
  function renderPins() {
    if (!pinsEl) return;
    pinsEl.innerHTML = "";
    if (!pinnedFolders.length) {
      pinsEl.hidden = true;
      return;
    }
    pinsEl.hidden = false;
    const header = document.createElement("div");
    header.className = "pinned-header";
    const title = document.createElement("span");
    title.className = "pinned-title";
    title.textContent = "Pinned";
    header.appendChild(title);
    pinsEl.appendChild(header);
    for (const path of pinnedFolders) {
      pinsEl.appendChild(renderPinRow(path));
      if (pinExpanded.has(path)) {
        const node = findNode(treeCache, path);
        // A pin whose folder vanished simply renders no children until the
        // next prune removes it.
        if (node && node.children) {
          node.children.forEach((child, i) => {
            for (const el of renderPinChild(child, i === node.children.length - 1, [])) {
              pinsEl.appendChild(el);
            }
          });
        }
      }
    }
  }

  /* A pinned root row, drawn exactly like a tree root row: flat (no guide
   * cells), folder icon flipping open/closed with expansion, name. The lit
   * pin at the right matches a pinned folder's tree row and unpins on click. */
  function renderPinRow(path) {
    const row = document.createElement("div");
    row.className = "pin-row";
    row.dataset.path = path;
    row.draggable = true;
    row.appendChild(renderGuide([], true, true));
    const icon = iconEl(pinExpanded.has(path) ? DIR_ICON_OPEN : DIR_ICON);
    const name = document.createElement("span");
    name.className = "tree-name";
    // Show just the base name; the full path is recoverable from data-path.
    name.textContent = baseName(path);
    name.title = path;
    const pin = document.createElement("span");
    pin.className = "tree-pin is-pinned";
    pin.title = "Unpin folder";
    pin.appendChild(iconEl(PIN_ICON));
    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePin(path);
    });
    pin.addEventListener("mousedown", (e) => e.stopPropagation());
    pin.addEventListener("dragstart", (e) => e.preventDefault());
    row.append(icon, name, pin);
    row.addEventListener("click", () => togglePinExpand(path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (isPhone()) return;
      openPinMenu(e, path);
    });
    return row;
  }

  /* Toggle one folder's expansion inside the Pinned section. Only the
   * pins area re-renders -- the main tree is never touched. */
  function togglePinExpand(path) {
    if (pinExpanded.has(path)) pinExpanded.delete(path);
    else pinExpanded.add(path);
    renderPins();
  }

  /* Fold every expanded pin back to a single row. Backs the Pinned area's
   * "Collapse all pinned folders" menu item; only the pins area re-renders. */
  function collapseAllPins() {
    if (!pinExpanded.size) return;
    pinExpanded.clear();
    renderPins();
  }

  /* A descendant row inside an expanded pin, drawn exactly like a tree row
   * (guide cells + icon + name). Returns the row plus any expanded
   * descendants so the caller can append them linearly. Uses .pin-child
   * (never .pin-row / .tree-row) so the pin-reorder drag handlers, the
   * main-tree drag handlers, and the vim cursor ignore it. */
  function renderPinChild(node, isLast, ancestors) {
    const row = document.createElement("div");
    row.className = "pin-child";
    row.dataset.path = node.path;
    row.appendChild(renderGuide(ancestors, isLast, false));
    if (node.type === "dir") {
      const expanded = pinExpanded.has(node.path);
      const icon = iconEl(expanded ? DIR_ICON_OPEN : DIR_ICON);
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      name.title = node.path;
      row.append(icon, name);
      row.addEventListener("click", () => togglePinExpand(node.path));
    } else {
      const icon = iconEl(fileIconId(node.name));
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      name.title = node.path;
      row.append(icon, name);
      if (node.path === selectedPath) row.classList.add("selected");
      row.addEventListener("click", () => openFile(node.path));
    }
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (isPhone()) return;
      openMenu(e, node);
    });
    if (node.type === "dir" && pinExpanded.has(node.path) && node.children) {
      const out = [row];
      const childAncestors = ancestors.concat(!isLast);
      node.children.forEach((child, i) => {
        for (const el of renderPinChild(child, i === node.children.length - 1, childAncestors)) {
          out.push(el);
        }
      });
      return out;
    }
    return [row];
  }

  /* A pinned row's context menu groups the pin-specific actions together at
   * the top (expand/collapse, collapse all, unpin), then shows the SAME menu
   * the file browser shows for a folder row minus its redundant pin toggle. */
  function openPinMenu(e, path) {
    const node = findNode(treeCache, path) || { path, type: "dir", name: baseName(path) };
    const items = [
      {
        label: pinExpanded.has(path) ? "Collapse" : "Expand",
        handler: () => togglePinExpand(path),
      },
      { label: "Collapse all pinned folders", handler: collapseAllPins },
      { label: "Unpin folder", handler: () => togglePin(path) },
      { separator: true },
    ].concat(treeFolderMenuItems(node, { skipPin: true }));
    NB.menu.open({
      owner: "sidebar", x: e.clientX, y: e.clientY, scope: sidebarEl,
      items, focusFirst: true,
    });
  }

  /* Right-clicking the empty Pinned area offers the pinned-section
   * counterpart of the tree's "Collapse all folders": one item that folds
   * every expanded pin. Disabled while nothing is expanded. */
  function openPinsRootMenu(e) {
    NB.menu.open({
      owner: "sidebar", x: e.clientX, y: e.clientY, scope: sidebarEl,
      items: [
        {
          label: "Collapse all pinned folders",
          handler: collapseAllPins,
          disabled: pinExpanded.size === 0,
        },
      ],
      focusFirst: true,
    });
  }

  /* Drop any pin whose folder isn't in the current tree (delete / rename).
   * Persists only if something changed. */
  function prunePins(tree) {
    if (!pinnedFolders.length) return;
    const before = pinnedFolders.length;
    pinnedFolders = pinnedFolders.filter(p => treeHasPath(tree, p));
    if (pinnedFolders.length !== before) {
      prunePinExpanded();
      renderPins();
      persistPins();
    }
  }

  function treeHasPath(tree, path) { return !!findNode(tree, path); }

  /* --- pin drag-to-reorder -------------------------------------------- */
  /* Mirror the bookmarks list: handlers live on the section element so the
   * empty area still accepts a drop (which lands the row at the end). */
  function wirePinsDnD() {
    if (!pinsEl) return;
    pinsEl.addEventListener("dragstart", (e) => {
      const row = e.target.closest && e.target.closest(".pin-row");
      if (!row || !row.dataset.path) { e.preventDefault(); return; }
      draggingPin = row.dataset.path;
      row.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "pin:" + row.dataset.path); }
        catch (_) {}
      }
    });
    pinsEl.addEventListener("dragover", (e) => {
      if (!draggingPin) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearPinDropMarks();
      const row = e.target.closest && e.target.closest(".pin-row");
      if (!row || row.dataset.path === draggingPin) {
        pinsEl.classList.add("drop-empty");
        return;
      }
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      row.classList.add(before ? "drop-before" : "drop-after");
    });
    pinsEl.addEventListener("drop", (e) => {
      if (!draggingPin) return;
      e.preventDefault();
      const row = e.target.closest && e.target.closest(".pin-row");
      // Dropping a row on itself is a no-op (not an append-to-end).
      if (row && row.dataset.path === draggingPin) { clearPinDragging(); return; }
      let targetPath = null, before = true;
      if (row && row.dataset.path && row.dataset.path !== draggingPin) {
        const rect = row.getBoundingClientRect();
        targetPath = row.dataset.path;
        before = e.clientY < rect.top + rect.height / 2;
      }
      const from = draggingPin;
      clearPinDragging();
      try { reorderPin(from, targetPath, before); }
      catch (err) { console.error("pin reorder failed", err); }
    });
    pinsEl.addEventListener("dragend", clearPinDragging);
  }

  function reorderPin(fromPath, toPath, before) {
    const fromIdx = pinnedFolders.indexOf(fromPath);
    if (fromIdx < 0) return;
    const [moved] = pinnedFolders.splice(fromIdx, 1);
    if (!toPath) {
      pinnedFolders.push(moved);
    } else {
      const toIdx = pinnedFolders.indexOf(toPath);
      if (toIdx < 0) {
        pinnedFolders.push(moved);
      } else {
        pinnedFolders.splice(before ? toIdx : toIdx + 1, 0, moved);
      }
    }
    renderPins();
    persistPins();
  }

  function clearPinDropMarks() {
    if (!pinsEl) return;
    pinsEl.querySelectorAll(".drop-before,.drop-after")
      .forEach(r => r.classList.remove("drop-before", "drop-after"));
    pinsEl.classList.remove("drop-empty");
  }
  function clearPinDragging() {
    draggingPin = null;
    if (!pinsEl) return;
    pinsEl.querySelectorAll(".dragging")
      .forEach(r => r.classList.remove("dragging"));
    clearPinDropMarks();
  }

  /* --- vim-mode cursor (NB.vimnav drives this) ------------------- */
  /* A separate highlight from .selected (the active file). The vim
   * cursor is what j/k moves; Enter/l opens. We track it as a path
   * and re-render its highlight on every move. */
  let vimCursorPath = null;
  function vimCursorRows() {
    // Only the rows that are currently visible in the DOM (we don't
    // walk the tree model -- the rendered order is what j/k follows,
    // matching the user's mental model of the tree). Bookmarks are a
    // separate side-panel view now, so vim j/k navigates the tree only.
    // Scoped to #file-tree: a note can carry a stray .tree-row.
    return Array.from(treeEl.querySelectorAll(".tree-row"));
  }
  function setVimCursor(path) {
    vimCursorPath = path;
    treeEl.querySelectorAll(".tree-row.vim-cursor")
      .forEach(r => r.classList.remove("vim-cursor"));
    if (!path) return;
    const row = treeEl.querySelector('.tree-row[data-path="' +
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
    const row = treeEl.querySelector('.tree-row[data-path="' +
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
    const row = treeEl.querySelector('.tree-row[data-path="' +
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
   * the path and highlight the file's row. Backs the "Show in file
   * sidebar" item on the tab and bookmark menus. Any folder that's
   * collapsed along the path is opened so the file's location is visible.
   *
   * Both callers open while some side-panel view is active -- the bookmark
   * menu while Bookmarks is showing, the tab menu perhaps while Search or
   * AI is. Bring the Explorer view forward (and expand the panel if it was
   * collapsed) so the revealed tree is actually on screen. */
  function revealFile(path) {
    if (!path) return;
    if (NB.activity && NB.activity.activate) {
      NB.activity.activate("explorer", false);
      if (NB.activity.isCollapsed && NB.activity.isCollapsed()) NB.activity.expand();
    }
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
        label: (NB.bookmarks && NB.bookmarks.has(node.path))
          ? "Remove bookmark" : "Add bookmark",
        handler: () => { if (NB.bookmarks) NB.bookmarks.toggle(node.path); },
      },
    ];
    return withCollapseAndDelete(items, node);
  }

  /* Tree folder row: Create | Organize | View | Terminal. No Open, no
   * Export, no bookmark toggle (guarded to files). `opts.skipPin` drops the
   * Pin/Unpin item when the caller renders the pin-specific actions itself
   * (the pinned row's menu groups them at the top). */
  function treeFolderMenuItems(node, opts) {
    const items = [
      { label: "New file…", handler: () => doNewFile(node, true) },
      { label: "New folder…", handler: () => doNewFolder(node, true) },
      { separator: true },
      { label: "Rename / Move…", handler: () => doRename(node) },
      { label: "Copy…", handler: () => doCopy(node) },
    ];
    if (!(opts && opts.skipPin)) {
      // Pin toggle for folders. The label flips on the current state so
      // the user always sees the action that the click will perform.
      items.push({
        label: hasPin(node.path) ? "Unpin folder" : "Pin folder",
        handler: () => togglePin(node.path),
      });
    }
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

  /* Phone row menu: read-only v1 items only (Open / Copy link / Copy
   * path). Anchored to the row's `…` button; menu.js clamps to the
   * viewport. */
  function openRowMenu(button, node) {
    const rect = button.getBoundingClientRect();
    const items = node.type === "dir" ? [
      { label: "Open", handler: () => toggleDir(node) },
      { label: "Copy link", handler: () => NB.app.copyLink(node.path) },
      { label: "Copy path", handler: () => NB.app.copyPath(node.path) },
    ] : [
      { label: "Open", handler: () => openFile(node.path) },
      { label: "Copy link", handler: () => NB.app.copyLink(node.path) },
      { label: "Copy path", handler: () => NB.app.copyPath(node.path) },
    ];
    NB.menu.open({
      owner: "sidebar", x: rect.left, y: rect.bottom + 4, scope: sidebarEl,
      items, focusFirst: true,
    });
    // Return focus to the row's trigger when the menu closes (selection,
    // outside click, or Esc). menu.js has no close callback; watch its
    // hidden attribute.
    if (menuEl && window.MutationObserver) {
      const obs = new MutationObserver(() => {
        if (!menuEl.hidden) return;
        obs.disconnect();
        try { button.focus({ preventScroll: true }); } catch (_) {}
      });
      obs.observe(menuEl, { attributes: true, attributeFilter: ["hidden"] });
    }
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
    if (isPhone()) return;
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
      // render so the row never appears against a missing file.
      if (NB.bookmarks) NB.bookmarks.prune(treeCache);
      // Same for pinned folders, so a pin never points at a missing folder.
      prunePins(treeCache);
      render(treeCache);
      // The Pinned section lives above the tree; refresh it after render
      // so its rows reflect the tree we just built.
      renderPins();
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
    if (isPhone()) return;   // phone Browse is read-only
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
    if (isPhone()) { e.preventDefault(); return; }
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
    if (isPhone() || !draggingNode) return;
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
    if (isPhone() || !draggingNode) return;
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
    // Thin back-compat façade over the bookmarks module (NB.bookmarks
    // owns the state and UI now). tabs.js and app.js call these.
    setBookmarks: (list) => { if (NB.bookmarks) NB.bookmarks.set(list); },
    getBookmarks: () => (NB.bookmarks ? NB.bookmarks.get() : []),
    toggleBookmark: (path) => { if (NB.bookmarks) NB.bookmarks.toggle(path); },
    // Pinned folders: the section above the tree is part of the Explorer
    // view, so its state and UI live here (not in a separate module).
    setPinnedFolders, getPinnedFolders, togglePin, hasPin,
    // File-operation façade. The tab menu runs the same rename / copy /
    // delete actions the tree and bookmark menus run, for the same path.
    renameFile: (path) => doRename({ path, type: "file" }),
    copyFile: (path) => doCopy({ path, type: "file" }),
    deleteFile: (path) => doDelete({ path, type: "file" }),
  };

  // Wire the pin list's drag-to-reorder + paint the (initially empty)
  // section. setPinnedFolders() re-renders it again once config loads.
  wirePinsDnD();
  renderPins();

  // Right-clicking the empty Pinned area (not a pin row) opens the
  // pinned-section menu; rows handle their own contextmenu.
  if (pinsEl) {
    pinsEl.addEventListener("contextmenu", (e) => {
      if (e.target.closest && e.target.closest(".pin-row,.pin-child")) return;
      e.preventDefault();
      if (isPhone()) return;
      openPinsRootMenu(e);
    });
  }

  // Keep the tree highlight in sync whenever a file is shown, regardless
  // of how it was opened (tab click, search result, boot). Mirror the
  // active file into the Pinned section's child rows too, so their
  // .selected never goes stale.
  NB.evt.on("file:open", (path) => {
    if (path) setSelected(path);
    if (!pinsEl) return;
    pinsEl.querySelectorAll(".pin-child.selected")
      .forEach(r => r.classList.remove("selected"));
    if (!path) return;
    const row = pinsEl.querySelector('.pin-child[data-path="' +
      cssEscape(path) + '"]');
    if (row) row.classList.add("selected");
  });

  // Bookmark list changes -> refresh that file's inline tree star. The
  // bookmarks module fires this from toggle(); prune re-renders and
  // persists directly and the next tree refresh redraws the stars.
  NB.evt.on("bookmarks:changed", ({ path }) => updateTreeStar(path));

  // Mode flips must update already-rendered rows: draggable=false on
  // phone, and restored for a phone->desktop flip without a reload.
  NB.evt.on("mobile:mode", () => {
    const draggable = !isPhone();
    treeEl.querySelectorAll(".tree-row").forEach((r) => {
      r.draggable = draggable;
    });
  });

  // A rename / move re-keys pinned folders whose path IS the moved folder
  // or lives inside it (prefix form -- moving a parent renames descendants).
  // Expanded pins follow the same remap so they stay open across a move.
  NB.evt.on("file:moved", ({ from, to }) => {
    if (!from || !to) return;
    const prefix = from + "/";
    const rekey = (p) => {
      if (p === from) return to;
      if (p.startsWith(prefix)) return to + p.slice(from.length);
      return null;
    };
    let changed = false;
    pinnedFolders = pinnedFolders.map(p => {
      const mapped = rekey(p);
      if (mapped !== null) { changed = true; return mapped; }
      return p;
    });
    const remappedExpanded = [];
    for (const p of pinExpanded) {
      const mapped = rekey(p);
      remappedExpanded.push(mapped !== null ? mapped : p);
    }
    pinExpanded.clear();
    for (const p of remappedExpanded) pinExpanded.add(p);
    if (!changed) return;
    prunePinExpanded();
    renderPins();
    persistPins();
  });
})();