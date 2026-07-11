/* app.js -- bootstrap: load config, wire everything together.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const DEFAULTS = {
    theme: "dark",
    lastFile: null,
    recentFiles: [],
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

  /* --- config persistence ------------------------------------------- */
  function applyConfig(c) {
    cfg = { ...DEFAULTS, ...c };
    document.body.dataset.theme = cfg.theme || "dark";
    themeSel.value = cfg.theme || "dark";
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
    // sidebar -> viewer
    NB.evt.on("file:open-request", async (path) => {
      try { await NB.viewer.open(path); updateRecent(path); }
      catch (e) { alert("Could not open: " + e.message); }
    });

    // tree changes (after mutations) -> sidebar refresh already handled in sidebar.js
    // deleted current file -> clear viewer
    NB.evt.on("file:deleted", (path) => {
      if (NB.viewer.getPath() === path) {
        document.getElementById("viewer").innerHTML =
          '<p style="color:var(--fg-muted)">No file selected.</p>';
      }
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
      cfg.theme = themeSel.value;
      document.body.dataset.theme = cfg.theme;
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

    const startPath = cfg.lastFile && treeHas(tree, cfg.lastFile)
      ? cfg.lastFile
      : firstFilePath(tree);
    if (startPath) {
      try { await NB.viewer.open(startPath); updateRecent(startPath); }
      catch (e) { console.warn("open start file failed", e); }
    }
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