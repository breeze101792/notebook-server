/* tabs.js -- top-bar file tabs. Owns the ordered set of open files and the
 * active file; coordinates with viewer.js (per-file content cache) and
 * persists the open set + active file to config.
 *
 * Open/switch/close a tab -> viewer activates/renders the cached content
 * (unsaved edits are preserved per file when switching tabs).
 *
 * Tabs are drag-reorderable. Pinned tabs live in a fixed left group: they
 * render narrower with a pin marker, have no close button, and are skipped
 * by the bulk-close actions (close others / right / left) in the tab
 * right-click menu.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const barEl = document.getElementById("tab-bar");
  const menuEl = document.getElementById("tab-context-menu");
  const ordered = [];          // [path] in display order (pinned tabs first)
  const openSet = new Set();   // path membership
  const pinned = new Set();    // pinned paths (always a contiguous prefix of `ordered`)
  let activePath = null;

  /* Special tabs: pseudo-paths that render in the tab bar like file tabs
   * but show a non-file view (graph, search) in the content area instead
   * of a rendered note. A special tab's id starts with "§" so it never
   * collides with a real file path (paths are relative + can't start
   * with § on any sane filesystem). Each special tab registers a
   * { id, icon, label, onActivate, onClose } factory; tabs.js owns the
   * tab bar lifecycle (open/activate/close/reorder) and delegates the
   * content-area swap to onActivate/onClose. */
  const specialTabs = new Map();   // id -> { icon, label, onActivate(id), onClose(id) }
  function isSpecial(path) { return typeof path === "string" && path.startsWith("§"); }
  function isSpecialOpen(path) { return openSet.has(path); }

  // Drag-and-drop reorder state. We track the dragged path here instead of
  // in dataTransfer so the same code works in jsdom (which has no real DnD).
  let draggingPath = null;

  function baseName(p) { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
  function isPinned(path) { return pinned.has(path); }
  function pinnedCount() { return pinned.size; }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* Resolve the .tab element an event is firing on (handles text-node targets). */
  function targetTab(e) {
    let n = e.target;
    if (n && n.nodeType === 3) n = n.parentElement;   // text node -> its element
    return n && n.closest ? n.closest(".tab") : null;
  }

  /* Re-segment `ordered` so pinned paths form a contiguous prefix, preserving
   * relative order within each group. */
  function segment() {
    const p = ordered.filter(x => pinned.has(x));
    const u = ordered.filter(x => !pinned.has(x));
    ordered.length = 0;
    ordered.push(...p, ...u);
  }

  /* --- render the tab bar -------------------------------------------- */
  function render() {
    barEl.innerHTML = "";
    ordered.forEach(path => {
      const tab = document.createElement("div");
      tab.className = "tab" + (path === activePath ? " active" : "");
      if (pinned.has(path)) tab.classList.add("pinned");
      if (isSpecial(path)) tab.classList.add("special");
      // Special tabs are never dirty; file tabs consult the viewer.
      if (!isSpecial(path) && NB.viewer.isDirty(path)) tab.classList.add("dirty");
      tab.dataset.path = path;
      tab.title = isSpecial(path) ? (specialTabs.get(path) || {}).label || path : path;
      tab.draggable = true;

      if (pinned.has(path)) {
        const pin = document.createElement("span");
        pin.className = "tab-pin";
        pin.textContent = "📌";
        pin.title = "Pinned";
        tab.appendChild(pin);
      }

      const label = document.createElement("span");
      label.className = "tab-label";
      if (isSpecial(path)) {
        const spec = specialTabs.get(path) || {};
        if (spec.icon) {
          const icon = document.createElement("span");
          icon.className = "tab-special-icon";
          icon.textContent = spec.icon;
          label.appendChild(icon);
        }
        const text = document.createElement("span");
        text.textContent = spec.label || path;
        label.appendChild(text);
      } else {
        label.textContent = baseName(path);
      }
      if (!isSpecial(path) && conflictSet.has(path)) {
        const badge = document.createElement("span");
        badge.className = "tab-conflict";
        badge.textContent = "↻";
        badge.title = "Disk has a newer version of this file (your edits are kept locally).";
        label.appendChild(badge);
      }
      tab.appendChild(label);

      // Pinned tabs have no close button (unpin first). Middle-click also
      // refuses to close a pinned tab.
      if (!pinned.has(path)) {
        const closeBtn = document.createElement("button");
        closeBtn.className = "tab-close";
        closeBtn.textContent = "×";
        closeBtn.title = "Close (middle-click also closes)";
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(path); });
        tab.appendChild(closeBtn);
      }

      tab.addEventListener("click", () => activate(path));
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1 && !pinned.has(path)) { e.preventDefault(); close(path); }
      });
      tab.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(path, e); });
      barEl.appendChild(tab);
    });
  }

  function emitChanged() {
    NB.evt.emit("tabs:changed", {
      openFiles: ordered.slice(),
      activeFile: activePath,
      pinnedFiles: [...pinned],
    });
  }

  /* Remove a path from the open set + cache (no re-activate). */
  function dropTab(path) {
    const idx = ordered.indexOf(path);
    if (idx >= 0) ordered.splice(idx, 1);
    openSet.delete(path);
    pinned.delete(path);
    if (isSpecial(path)) {
      const spec = specialTabs.get(path);
      if (spec && spec.onClose) { try { spec.onClose(path); } catch (e) { console.error(e); } }
    } else {
      NB.viewer.close(path);
    }
  }
  function pickNeighbor(idx) {
    return ordered[idx] || ordered[idx - 1] || ordered[0] || null;
  }

  /* --- open / activate / close --------------------------------------- */
  async function activate(path) {
    if (!openSet.has(path)) return;
    // Block tab switching when hybrid mode has unsaved changes, so the
    // user doesn't silently lose their WYSIWYG edits. Prompt to save;
    // on Cancel, stay on the current tab. On OK, save then proceed.
    if (path !== activePath && NB.hybrid && NB.hybrid.isActive) {
      const ok = await NB.hybrid.commitForTabSwitch();
      if (!ok) return;
    }
    // Special tabs don't go through viewer.activate; they own their
    // own content-area container. The viewer hides itself + welcome so
    // the special view's container is the only visible sibling in
    // #edit-split. onActivate receives the id so the view can show /
    // refresh itself.
    if (isSpecial(path)) {
      const spec = specialTabs.get(path);
      // Tell the viewer to step aside (hide #viewer + #welcome + #cm-host).
      if (NB.viewer && NB.viewer.showSpecial) NB.viewer.showSpecial();
      activePath = path;
      render();
      emitChanged();
      if (spec && spec.onActivate) { try { spec.onActivate(path); } catch (e) { console.error(e); } }
      return;
    }
    // Switching FROM a special tab TO a file: the special tab's container
    // is still visible; showViewer (called below) restores #viewer. The
    // special tab's onClose hides its container when it sees the file:open
    // event or its own onActivate(false) -- simpler: each special view
    // listens for "file:open" to hide itself, so we just emit it below.
    try {
      await NB.viewer.activate(path);
      if (!openSet.has(path)) {
        NB.viewer.close(path);
        if (ordered.length) activate(ordered[0]);
        else NB.viewer.clear();
        return;
      }
      activePath = path;
      render();
      emitChanged();
    } catch (e) {
      const idx = ordered.indexOf(path);
      dropTab(path);
      const next = pickNeighbor(idx);
      if (next) { await activate(next); }
      else { activePath = null; NB.viewer.clear(); render(); emitChanged(); }
    }
  }

  async function open(path, opts) {
    opts = opts || {};
    const doActivate = opts.activate !== false;
    if (!openSet.has(path)) { openSet.add(path); ordered.push(path); }
    if (doActivate) { await activate(path); }
    else { render(); emitChanged(); }
  }

  function close(path, opts) {
    opts = opts || {};
    if (!openSet.has(path)) return;
    // Confirm before discarding unsaved edits (skipped for force-close on
    // delete, and for special tabs which have no edit state).
    if (!opts.force && !isSpecial(path) && NB.viewer.isDirty(path)) {
      if (!confirm('Close "' + baseName(path) + '"? Unsaved changes will be lost.')) return;
    }
    const idx = ordered.indexOf(path);
    const wasActive = (activePath === path);
    dropTab(path);

    if (wasActive) {
      const next = pickNeighbor(idx);
      activePath = null;
      render();            // immediately drop the closed tab + clear active
      emitChanged();
      if (next) { activate(next); }   // async: load + re-render neighbor
      else { NB.viewer.clear(); }
    } else {
      render();
      emitChanged();
    }
  }

  function rename(from, to) {
    if (!openSet.has(from) || from === to) return;
    const idx = ordered.indexOf(from);
    ordered[idx] = to;
    openSet.delete(from); openSet.add(to);
    if (pinned.has(from)) { pinned.delete(from); pinned.add(to); }
    NB.viewer.rename(from, to);
    if (activePath === from) activePath = to;
    render();
    emitChanged();
  }

  /* --- pin / unpin --------------------------------------------------- */
  function togglePin(path) {
    if (!openSet.has(path)) return;
    const i = ordered.indexOf(path);
    if (i < 0) return;
    if (pinned.has(path)) {
      pinned.delete(path);
      ordered.splice(i, 1);
      ordered.splice(pinnedCount(), 0, path);     // start of unpinned section
    } else {
      pinned.add(path);
      ordered.splice(i, 1);
      ordered.splice(pinnedCount() - 1, 0, path); // end of pinned section
    }
    render();
    emitChanged();
  }

  /* --- drag-and-drop reorder ----------------------------------------- */
  function onDragStart(e) {
    if (e.target.closest && e.target.closest(".tab-close")) { e.preventDefault(); return; }
    const tab = targetTab(e);
    if (!tab || !tab.dataset.path) return;
    draggingPath = tab.dataset.path;
    tab.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", draggingPath); } catch (_) {}
    }
  }

  function onDragOver(e) {
    if (!draggingPath) return;
    const tab = targetTab(e);
    if (!tab) return;                       // over empty bar area -> handled on drop
    e.preventDefault();                     // allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    const rect = tab.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    tab.classList.add(before ? "drop-before" : "drop-after");
  }

  function onDrop(e) {
    if (!draggingPath) return;
    e.preventDefault();
    const tab = targetTab(e);
    let targetPath = null, before = true;
    if (tab && tab.dataset.path) {
      targetPath = tab.dataset.path;
      const rect = tab.getBoundingClientRect();
      before = e.clientX < rect.left + rect.width / 2;
    }
    dropOnto(draggingPath, targetPath, before);
    clearDragging();
  }

  /* Reorder `path` to land before/after `targetPath` (or at the end when
   * targetPath is null, i.e. dropped on empty bar area). Clamps to the
   * dragged tab's segment so a pinned tab stays in the pinned block and an
   * unpinned tab stays after it. */
  function dropOnto(path, targetPath, before) {
    if (!path || path === targetPath) { render(); return; }
    const di = ordered.indexOf(path);
    if (di < 0) return;
    ordered.splice(di, 1);
    let ti;
    if (targetPath == null) {
      ti = ordered.length;
    } else {
      ti = ordered.indexOf(targetPath);
      if (ti < 0) { ordered.splice(di, 0, path); return; }   // target vanished -> abort
      if (!before) ti += 1;
    }
    if (pinned.has(path)) ti = Math.max(0, Math.min(ti, pinnedCount() - 1));
    else                  ti = Math.max(pinnedCount(), Math.min(ti, ordered.length));
    ordered.splice(ti, 0, path);
    render();
    emitChanged();
  }

  function clearDropMarks() {
    barEl.querySelectorAll(".drop-before,.drop-after")
      .forEach(t => t.classList.remove("drop-before", "drop-after"));
  }
  function clearDragging() {
    draggingPath = null;
    barEl.querySelectorAll(".dragging").forEach(t => t.classList.remove("dragging"));
    clearDropMarks();
  }

  barEl.addEventListener("dragstart", onDragStart);
  barEl.addEventListener("dragover", onDragOver);
  barEl.addEventListener("drop", onDrop);
  barEl.addEventListener("dragend", clearDragging);   // also covers Esc / window-leave

  /* --- bulk close (close others / right / left) ---------------------- */
  /* `paths` is already filtered to exclude pinned tabs. Confirms once if any
   * of the targets is dirty, then force-closes them. */
  function closeMany(paths) {
    if (!paths.length) return;
    const dirty = paths.filter(p => NB.viewer.isDirty(p));
    if (dirty.length) {
      const names = dirty.map(baseName).join(", ");
      if (!confirm("Close " + paths.length + " tab(s)? Unsaved changes in: " + names)) return;
    }
    // snapshot: close() splices `ordered` mid-iteration
    paths.slice().forEach(p => close(p, { force: true }));
  }

  // Close every open tab without prompting (used when the session
  // expires or the notebook is locked: we drop all paths so the tab
  // bar doesn't keep showing files the user can no longer read).
  function clearAll() {
    if (!ordered.length) return;
    ordered.slice().forEach(p => dropTab(p));
    activePath = null;
    if (NB.viewer && NB.viewer.clear) NB.viewer.clear();
    render();
    emitChanged();
  }

  function closeOthers(path) {
    closeMany(ordered.filter(p => p !== path && !pinned.has(p)));
  }
  function closeRight(path) {
    const i = ordered.indexOf(path);
    if (i < 0) return;
    closeMany(ordered.slice(i + 1).filter(p => !pinned.has(p)));
  }
  function closeLeft(path) {
    const i = ordered.indexOf(path);
    if (i < 0) return;
    closeMany(ordered.slice(0, i).filter(p => !pinned.has(p)));
  }

  /* --- tab context menu --------------------------------------------- */
  let menuPath = null;

  function openMenu(path, e) {
    menuPath = path;
    menuEl.innerHTML = "";

    const i = ordered.indexOf(path);
    const others = ordered.filter(p => p !== path && !pinned.has(p));
    const right  = ordered.slice(i + 1).filter(p => !pinned.has(p));
    const left   = ordered.slice(0, i).filter(p => !pinned.has(p));

    addMenuItem(pinned.has(path) ? "Unpin" : "Pin", () => togglePin(path));
    addMenuItem("Show in file sidebar", () => {
      if (NB.sidebar && NB.sidebar.revealFile) NB.sidebar.revealFile(path);
    });
    menuEl.appendChild(document.createElement("hr"));
    addMenuItem("Close", () => close(path), { danger: true });
    addMenuItem("Close others", () => closeOthers(path), { disabled: !others.length });
    addMenuItem("Close to the right", () => closeRight(path), { disabled: !right.length });
    addMenuItem("Close to the left", () => closeLeft(path), { disabled: !left.length });

    menuEl.hidden = false;
    positionMenu(e);
  }

  function addMenuItem(label, handler, opts) {
    opts = opts || {};
    const btn = document.createElement("button");
    btn.textContent = label;
    if (opts.danger) btn.classList.add("danger");
    if (opts.disabled) btn.disabled = true;
    btn.addEventListener("click", () => { hideMenu(); handler(); });
    menuEl.appendChild(btn);
  }

  function positionMenu(e) {
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 10);
    menuEl.style.left = x + "px";
    menuEl.style.top = y + "px";
  }

  function hideMenu() { menuEl.hidden = true; menuPath = null; }
  document.addEventListener("click", hideMenu);
  document.addEventListener("contextmenu", (e) => {
    // a right-click that didn't start on a tab closes any open tab menu
    if (!barEl.contains(e.target)) hideMenu();
  });

  /* --- restore on boot ----------------------------------------------- */
  /* openFiles/activeFile/pinnedFiles come from config. We populate the tab
   * bar without fetching; only the active file is loaded eagerly (others
   * fetch lazily on first activation). `fallback` is used when nothing is
   * open yet. */
  async function restore(openFiles, activeFile, fallback, pinnedFiles) {
    (openFiles || []).forEach(p => {
      if (!openSet.has(p)) { openSet.add(p); ordered.push(p); }
    });
    (pinnedFiles || []).forEach(p => { if (openSet.has(p)) pinned.add(p); });
    segment();     // enforce pinned-first invariant

    if (!ordered.length) {
      if (fallback) { await open(fallback); return; }
      NB.viewer.clear(); render(); emitChanged();
      return;
    }
    let startActive = (activeFile && openSet.has(activeFile)) ? activeFile : ordered[0];
    render();
    await activate(startActive);
  }

  function getActive() { return activePath; }
  function getOpen() { return ordered.slice(); }
  function isOpen(path) { return openSet.has(path); }

  // Cycle to the previous / next tab. No-op if there's only one
  // (or zero) tab. Returns the new active path, or null.
  async function prev() {
    if (ordered.length < 2) return activePath;
    const i = ordered.indexOf(activePath);
    const ni = (i <= 0) ? ordered.length - 1 : i - 1;
    await activate(ordered[ni]);
    return ordered[ni];
  }
  async function next() {
    if (ordered.length < 2) return activePath;
    const i = ordered.indexOf(activePath);
    const ni = (i < 0 || i === ordered.length - 1) ? 0 : i + 1;
    await activate(ordered[ni]);
    return ordered[ni];
  }

  NB.tabs = {
    open, close, activate, rename, restore, getActive, getOpen, isOpen, render,
    togglePin, isPinned, closeOthers, closeRight, closeLeft, prev, next, clearAll,
    /* Register a special tab type. `def` = { id, icon, label, onActivate, onClose }.
     * id must start with "§". onActivate(id) is called when the tab becomes
     * active; onClose(id) when it's closed. Re-registering the same id
     * replaces the definition (used by hot reload / test reset). */
    registerSpecial(def) {
      if (!def || !def.id || !def.id.startsWith("§")) return;
      specialTabs.set(def.id, def);
    },
    /* Open a special tab (by id) and activate it. If it's already open,
     * just activate it (no duplicate). */
    async openSpecial(id) {
      if (!specialTabs.has(id)) return;
      if (!openSet.has(id)) { openSet.add(id); ordered.push(id); }
      await activate(id);
    },
    isSpecial,
  };

  /* --- keep the bar in sync with viewer-driven changes --------------- */
  // Dirty dot while typing: toggle just the affected tab's class.
  NB.evt.on("viewer:dirty-changed", ({ path, dirty }) => {
    const el = barEl.querySelector('.tab[data-path="' + cssEscape(path) + '"]');
    if (el) el.classList.toggle("dirty", !!dirty);
  });

  // A file deleted from disk closes its tab (and, for a dir, any tab under it).
  NB.evt.on("file:deleted", (path) => {
    const prefix = path + "/";
    ordered.filter(p => p === path || p.startsWith(prefix))
      .forEach(p => close(p, { force: true }));
  });

  /* Re-key a tab when its file is moved/renamed; unsaved edits travel. */
  NB.evt.on("file:moved", ({ from, to }) => rename(from, to));

  // External disk change with unsaved local edits -> mark the tab as a
  // conflict. The badge is cleared on the next reload, save, or re-key.
  const conflictSet = new Set();
  NB.evt.on("viewer:conflict", ({ path, conflict }) => {
    if (conflict) conflictSet.add(path);
    else conflictSet.delete(path);
    render();
  });
  // A close or rename that drops the path from the open set also drops
  // its conflict flag (otherwise the badge would reappear on re-open).
  function _dropTab(path) { conflictSet.delete(path); }
  // Wrap the existing dropTab so we don't lose the original. Simpler: the
  // existing dropTab already deletes from the open set; clear conflicts
  // at the same spot by hooking the close() path through an event.
  NB.evt.on("tabs:changed", () => {
    ordered.forEach(p => { if (!openSet.has(p)) conflictSet.delete(p); });
  });
  // When the notebook is locked (auth required, session gone), drop
  // every open tab so the bar doesn't keep showing files the user
  // is no longer authorized to read. The viewer / tree / search
  // content is wiped by auth.js on the same event.
  NB.evt.on("auth:locked", () => { clearAll(); });
})();