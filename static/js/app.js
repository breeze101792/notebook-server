/* app.js -- bootstrap: load config, wire everything together.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const DEFAULTS = {
    theme: "auto",
    lastFile: null,
    recentFiles: [],
    openFiles: [],
    activeFile: null,
    sidebarWidth: 240,
    outlineWidth: 220,
    sidebarCollapsed: false,
    outlineCollapsed: false,
    searchCaseSensitive: false,
  };

  // Width used while a sidebar is collapsed (a thin clickable strip).
  const COLLAPSED_W = 24;

  let cfg = { ...DEFAULTS };
  let saveTimer = null;

  const themeSel = document.getElementById("theme-select");
  const caseEl   = document.getElementById("search-case");
  const editBtn  = document.getElementById("edit-toggle");
  const saveBtn  = document.getElementById("save");
  const sidebarEl  = document.getElementById("sidebar");
  const outlineEl  = document.getElementById("outline-pane");

  /* --- theme ---------------------------------------------------------- */
  // "auto" follows the system color scheme; dark is the fallback when the
  // preference can't be queried (e.g. jsdom has no matchMedia).
  const themeMQ = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

  function resolveTheme(pref) {
    if (pref === "auto") return (themeMQ && themeMQ.matches) ? "light" : "dark";
    return pref === "light" ? "light" : "dark";
  }
  function applyTheme(pref) {
    cfg.theme = pref;
    document.body.dataset.theme = resolveTheme(pref);
    themeSel.value = pref;
  }
  if (themeMQ) {
    themeMQ.addEventListener("change", () => {
      if (cfg.theme === "auto") {
        document.body.dataset.theme = resolveTheme("auto");
      }
    });
  }

  /* --- config persistence ------------------------------------------- */
  function applyConfig(c) {
    cfg = { ...DEFAULTS, ...c };
    applyTheme(cfg.theme || "auto");
    caseEl.checked = !!cfg.searchCaseSensitive;
    applySidebarState();
    applyOutlineState();
  }

  /* Sidebar minimize: toggle between the saved width and a thin strip.
   * The collapsed state is persisted in config. */
  function applySidebarState() {
    if (cfg.sidebarCollapsed) {
      document.documentElement.style.setProperty("--sidebar-width", COLLAPSED_W + "px");
      sidebarEl.classList.add("collapsed");
    } else {
      document.documentElement.style.setProperty("--sidebar-width", (cfg.sidebarWidth || 240) + "px");
      sidebarEl.classList.remove("collapsed");
    }
  }
  function applyOutlineState() {
    if (cfg.outlineCollapsed) {
      document.documentElement.style.setProperty("--outline-width", COLLAPSED_W + "px");
      outlineEl.classList.add("collapsed");
    } else {
      document.documentElement.style.setProperty("--outline-width", (cfg.outlineWidth || 220) + "px");
      outlineEl.classList.remove("collapsed");
    }
  }

  function persistConfig() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      NB.api.saveConfig(cfg).catch(e => console.warn("config save failed", e));
      NB.evt.emit("config:changed", cfg);
    }, 250);
  }

  function updateRecent(path) {
    if (!path) return;
    cfg.recentFiles = [path, ...cfg.recentFiles.filter(p => p !== path)].slice(0, 20);
    cfg.lastFile = path;
    persistConfig();
  }

  /* --- wiring -------------------------------------------------------- */
  function wire() {
    // sidebar -> tabs (open / activate)
    NB.evt.on("file:open-request", async (path) => {
      try { await NB.tabs.open(path); }
      catch (e) { alert("Could not open: " + e.message); }
    });

    // any file shown -> update recents + tree highlight (fired by viewer.activate)
    NB.evt.on("file:open", (path) => { if (path) updateRecent(path); });

    // tab set changed -> persist open files + active file
    NB.evt.on("tabs:changed", ({ openFiles, activeFile }) => {
      cfg.openFiles = openFiles;
      cfg.activeFile = activeFile;
      persistConfig();
    });

    // search-case toggle persists config
    NB.evt.on("search-case-changed", (val) => {
      cfg.searchCaseSensitive = val;
      persistConfig();
    });

    // top bar actions
    saveBtn.addEventListener("click", () => NB.viewer.save());
    editBtn.addEventListener("click", () => NB.viewer.toggleEdit());

    // sidebar minimize (collapse / expand) for both sidebars
    document.getElementById("sidebar-collapse").addEventListener("click",
      () => { cfg.sidebarCollapsed = true; applySidebarState(); persistConfig(); });
    document.getElementById("sidebar-expand").addEventListener("click",
      () => { cfg.sidebarCollapsed = false; applySidebarState(); persistConfig(); });
    document.getElementById("outline-collapse").addEventListener("click",
      () => { cfg.outlineCollapsed = true; applyOutlineState(); persistConfig(); });
    document.getElementById("outline-expand").addEventListener("click",
      () => { cfg.outlineCollapsed = false; applyOutlineState(); persistConfig(); });

    // keyboard: Ctrl/Cmd+S saves
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        NB.viewer.save();
      }
    });

    // theme
    themeSel.addEventListener("change", () => {
      applyTheme(themeSel.value);
      persistConfig();
    });

    // resizable sidebars (drag the inner edge)
    setupResize("sidebar", "--sidebar-width", "right");
    setupResize("outline-pane", "--outline-width", "left");
  }

  function setupResize(id, cssVar, edge) {
    const pane = document.getElementById(id);
    let startX = 0, startW = 0, dragging = false;
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.style.cssText = "position:absolute;top:0;" + edge + ":0;width:4px;height:100%;" +
      "cursor:col-resize;z-index:10;opacity:0;";
    pane.style.position = "relative";
    pane.appendChild(handle);
    handle.addEventListener("mousedown", (e) => {
      dragging = true; startX = e.clientX;
      startW = pane.getBoundingClientRect().width;
      handle.style.opacity = "1";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const w = Math.max(140, Math.min(520, startW + dx));
      document.documentElement.style.setProperty(cssVar, w + "px");
    });
    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      handle.style.opacity = "0";
      const w = pane.getBoundingClientRect().width;
      if (id === "sidebar") cfg.sidebarWidth = w;
      else cfg.outlineWidth = w;
      persistConfig();
    });
  }

  function firstFilePath(tree) {
    for (const node of tree) {
      if (node.type === "file") return node.path;
      if (node.children && node.children.length) {
        const inner = firstFilePath(node.children);
        if (inner) return inner;
      }
    }
    return null;
  }

  /* --- boot ---------------------------------------------------------- */
  let booted = false;
  async function boot() {
    if (booted) return;   // idempotent: DOMContentLoaded fires once, but guard anyway
    booted = true;
    wire();
    try {
      const serverCfg = await NB.api.getConfig();
      applyConfig(serverCfg);
    } catch (e) { applyConfig({}); }

    await NB.sidebar.refresh();
    const tree = NB.sidebar.getTree();

    // Restore previously open tabs (filtered to files that still exist),
    // then activate the last active file; fall back to lastFile / first file.
    const openFiles = (cfg.openFiles || []).filter(p => treeHas(tree, p));
    const activeFile = cfg.activeFile && treeHas(tree, cfg.activeFile) ? cfg.activeFile : null;
    const lastFile = cfg.lastFile && treeHas(tree, cfg.lastFile) ? cfg.lastFile : null;
    const fallback = lastFile || firstFilePath(tree) || null;
    try { await NB.tabs.restore(openFiles, activeFile, fallback); }
    catch (e) { console.warn("restore tabs failed", e); }
  }

  function treeHas(tree, path) {
    for (const node of tree) {
      if (node.path === path) return true;
      if (node.children && treeHas(node.children, path)) return true;
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", boot);
})();