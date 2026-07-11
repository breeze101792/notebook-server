/* tabs.js -- top-bar file tabs. Owns the ordered set of open files and the
 * active file; coordinates with viewer.js (per-file content cache) and
 * persists the open set + active file to config.
 *
 * Open/switch/close a tab -> viewer activates/renders the cached content
 * (unsaved edits are preserved per file when switching tabs).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const barEl = document.getElementById("tab-bar");
  const ordered = [];          // [path] in display order
  const openSet = new Set();   // path membership
  let activePath = null;

  function baseName(p) { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* --- render the tab bar -------------------------------------------- */
  function render() {
    barEl.innerHTML = "";
    ordered.forEach(path => {
      const tab = document.createElement("div");
      tab.className = "tab" + (path === activePath ? " active" : "");
      if (NB.viewer.isDirty(path)) tab.classList.add("dirty");
      tab.dataset.path = path;
      tab.title = path;

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = baseName(path);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "×";
      closeBtn.title = "Close (middle-click also closes)";
      closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(path); });

      tab.append(label, closeBtn);
      tab.addEventListener("click", () => activate(path));
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1) { e.preventDefault(); close(path); } // middle-click
      });
      barEl.appendChild(tab);
    });
  }

  function emitChanged() {
    NB.evt.emit("tabs:changed", { openFiles: ordered.slice(), activeFile: activePath });
  }

  /* Remove a path from the open set + cache (no re-activate). */
  function dropTab(path) {
    const idx = ordered.indexOf(path);
    if (idx >= 0) ordered.splice(idx, 1);
    openSet.delete(path);
    NB.viewer.close(path);
  }
  function pickNeighbor(idx) {
    return ordered[idx] || ordered[idx - 1] || ordered[0] || null;
  }

  /* --- open / activate / close --------------------------------------- */
  async function activate(path) {
    if (!openSet.has(path)) return;
    try {
      await NB.viewer.activate(path);
      // The tab may have been closed while we were awaiting the fetch
      // (user click, or the directory-delete loop taking a sibling). If so,
      // undo the viewer side and recover to a still-open tab (or clear).
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
      // file no longer exists (deleted externally); drop it and fall back.
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
    // Confirm before discarding unsaved edits (skipped for force-close on delete).
    if (!opts.force && NB.viewer.isDirty(path)) {
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
    NB.viewer.rename(from, to);
    if (activePath === from) activePath = to;
    render();
    emitChanged();
  }

  /* --- restore on boot ----------------------------------------------- */
  /* openFiles/activeFile come from config. We populate the tab bar without
   * fetching; only the active file is loaded eagerly (others fetch lazily on
   * first activation). `fallback` is used when nothing is open yet. */
  async function restore(openFiles, activeFile, fallback) {
    (openFiles || []).forEach(p => {
      if (!openSet.has(p)) { openSet.add(p); ordered.push(p); }
    });
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

  NB.tabs = { open, close, activate, rename, restore, getActive, getOpen, isOpen, render };

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

  // A file moved/renamed re-keys its tab; unsaved edits travel with it.
  NB.evt.on("file:moved", ({ from, to }) => rename(from, to));
})();