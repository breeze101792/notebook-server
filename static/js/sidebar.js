/* sidebar.js -- left file tree + context-menu file operations
 * (open, new file, new folder, rename/move, copy, delete).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const treeEl = document.getElementById("file-tree");
  const menuEl = document.getElementById("context-menu");
  const DIR_ICON = "📁";
  const FILE_ICON = "📄";
  const CARET = "▾";

  const collapsed = new Set();      // collapsed dir paths (relative)
  let selectedPath = null;
  let menuCtx = null;               // { node } the menu was opened for
  let draggingNode = null;          // { path, type } the row being dragged (module state: works in jsdom too)

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
    tree.forEach(node => treeEl.appendChild(renderNode(node, 0)));
  }

  function renderNode(node) {
    const wrap = document.createElement("div");
    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = node.path;
    row.draggable = true;
    if (node.type === "dir") {
      const isCollapsed = collapsed.has(node.path);
      if (isCollapsed) row.classList.add("collapsed");
      const caret = document.createElement("span");
      caret.className = "tree-caret";
      caret.textContent = CARET;
      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = DIR_ICON;
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      row.append(caret, icon, name);
      row.addEventListener("click", () => toggleDir(node));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault(); openMenu(e, node);
      });
      wrap.appendChild(row);
      const childWrap = document.createElement("div");
      childWrap.className = "tree-children";
      if (node.children) {
        node.children.forEach(c => childWrap.appendChild(renderNode(c)));
      }
      wrap.appendChild(childWrap);
      if (isCollapsed) childWrap.style.display = "none";
    } else {
      const caret = document.createElement("span");
      caret.className = "tree-caret";
      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = FILE_ICON;
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = node.name;
      row.append(caret, icon, name);
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
    if (collapsed.has(node.path)) collapsed.delete(node.path);
    else collapsed.add(node.path);
    refresh();
  }

  function setSelected(path) {
    selectedPath = path;
    document.querySelectorAll(".tree-row.selected")
      .forEach(r => r.classList.remove("selected"));
    const row = document.querySelector('.tree-row[data-path="' +
      cssEscape(path) + '"]');
    if (row) row.classList.add("selected");
  }
  function openFile(path) {
    setSelected(path);
    NB.evt.emit("file:open-request", path);
  }

  /* --- context menu --------------------------------------------------- */
  function openMenu(e, node) {
    menuCtx = node;
    menuEl.innerHTML = "";
    const isDir = node.type === "dir";

    if (!isDir) addMenuItem("Open", () => openFile(node.path));
    addMenuItem(isDir ? "New file here…" : "New file beside…", () => doNewFile(node, isDir));
    addMenuItem("New folder here…", () => doNewFolder(node, isDir));
    menuEl.appendChild(document.createElement("hr"));
    addMenuItem("Rename / Move…", () => doRename(node));
    addMenuItem("Copy…", () => doCopy(node));
    menuEl.appendChild(document.createElement("hr"));
    addMenuItem("Delete", () => doDelete(node), true);

    menuEl.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 190);
    const y = Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 10);
    menuEl.style.left = x + "px";
    menuEl.style.top = y + "px";
  }

  function addMenuItem(label, handler, danger) {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (danger) btn.classList.add("danger");
    btn.addEventListener("click", () => { hideMenu(); handler(); });
    menuEl.appendChild(btn);
  }

  function hideMenu() {
    menuEl.hidden = true;
    menuCtx = null;
  }
  document.addEventListener("click", hideMenu);
  document.addEventListener("contextmenu", (e) => {
    // clicking outside the tree closes any open menu
    if (!treeEl.contains(e.target)) hideMenu();
  });

  /* Right-clicking the empty sidebar area (or an empty folder region)
   * offers root-level New file / New folder, so there's always a way to
   * create the first file without top-bar buttons. */
  function openRootMenu(e) {
    menuCtx = null;
    menuEl.innerHTML = "";
    addMenuItem("New file…", () => createAtRoot("file"));
    addMenuItem("New folder…", () => createAtRoot("dir"));
    menuEl.hidden = false;
    const x = Math.min(e.clientX, window.innerWidth - 190);
    const y = Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 10);
    menuEl.style.left = x + "px";
    menuEl.style.top = y + "px";
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

  function dirForNew(node, isDir) {
    // For a dir node, create inside it; for a file, create beside it.
    return isDir ? node.path : parentOf(node.path);
  }

  async function doNewFile(node, isDir) {
    const dir = dirForNew(node, isDir);
    const name = prompt("New file name (e.g. notes.md):", "untitled.md");
    if (!name) return;
    const path = dir ? dir + "/" + name : name;
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
    const name = prompt(type === "dir" ? "New folder name:" : "New file name:", type === "dir" ? "new-folder" : "untitled.md");
    if (!name) return;
    try {
      await NB.api.createItem(name, type);
      if (type === "dir") collapsed.delete(name);
      await refresh();
      if (type === "file") openFile(name);
    } catch (e) { alert("Create failed: " + e.message); }
  }

  /* --- helpers -------------------------------------------------------- */
  let treeCache = [];
  async function refresh() {
    try {
      treeCache = await NB.api.getTree();
      render(treeCache);
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

  NB.sidebar = { refresh, render, openFile, createAtRoot, getTree };

  // Keep the tree highlight in sync whenever a file is shown, regardless of
  // how it was opened (tab click, search result, boot).
  NB.evt.on("file:open", (path) => { if (path) setSelected(path); });
})();