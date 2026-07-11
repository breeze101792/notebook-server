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

  NB.sidebar = { refresh, render, openFile, createAtRoot, getTree };

  // Keep the tree highlight in sync whenever a file is shown, regardless of
  // how it was opened (tab click, search result, boot).
  NB.evt.on("file:open", (path) => { if (path) setSelected(path); });
})();