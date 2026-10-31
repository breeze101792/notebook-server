/* graph.js -- the §graph special tab facade and 2D/3D mode switch.
 *
 * The renderers themselves live in graph-2d.js (NB.graph2d) and
 * graph-3d.js (NB.graph3d). This module owns the tab registration, the
 * activity-bar button, the shared header chrome, and the persisted
 * mode. Only one renderer is active at a time: switching mode
 * deactivates the old renderer before activating the new one.
 *
 * The public NB.graph surface is kept for compatibility (settings.js,
 * app.js, and the browser tests read it) and delegates to the active
 * renderer. Mode-specific camera helpers only make sense in 3D; in 2D
 * they return null / 1 / "2d".
 */
(function () {
  "use strict";

  window.NB = window.NB || {};

  const TAB_ID = "§graph";
  const MODE_2D = "2d";
  const MODE_3D = "3d";
  const DEFAULT_MODE = MODE_3D;
  const VALID_MODES = [MODE_2D, MODE_3D];

  const HOST_LABEL_2D =
    "2D graph of linked notes. Drag to pan. Scroll to zoom. " +
    "Click a note to select it. Double-click a note to open it.";
  const HOST_LABEL_3D =
    "3D graph of linked notes. Drag to orbit. Scroll to zoom. " +
    "Right-drag to pan. Click a note to select it. Double-click a note to open it.";

  const el = {
    view: document.getElementById("graph-view"),
    host: document.getElementById("graph-view-canvas-host"),
    canvas2d: document.getElementById("graph-view-canvas-2d"),
    canvas3d: document.getElementById("graph-view-canvas"),
    badge: document.getElementById("graph-view-mode-badge"),
    mode2dBtn: document.getElementById("graph-view-mode-2d"),
    mode3dBtn: document.getElementById("graph-view-mode-3d"),
    fit: document.getElementById("graph-view-fit"),
  };

  let wired = false;
  let tabActive = false;
  let currentMode = DEFAULT_MODE;
  // The last real note the user had open. `cfg.activeFile` becomes "§graph"
  // while the graph tab is active, so it cannot drive the active-file ring.
  let lastNotePath = null;

  function isNotePath(path) {
    return typeof path === "string" && path.length > 0 &&
      path.charAt(0) !== "§";
  }

  function currentNotePath() {
    if (isNotePath(lastNotePath)) return lastNotePath;
    try {
      if (NB.app && NB.app.getCfg) {
        const cfg = NB.app.getCfg();
        if (isNotePath(cfg.lastFile)) return cfg.lastFile;
        if (isNotePath(cfg.activeFile)) return cfg.activeFile;
      }
    } catch (_) {}
    return null;
  }

  function normalizeMode(mode) {
    return VALID_MODES.indexOf(mode) >= 0 ? mode : DEFAULT_MODE;
  }

  function rendererFor(mode) {
    return mode === MODE_2D ? window.NB.graph2d : window.NB.graph3d;
  }

  function activeRenderer() {
    return rendererFor(currentMode);
  }

  function otherMode(mode) {
    return mode === MODE_2D ? MODE_3D : MODE_2D;
  }

  function getMode() {
    try {
      if (NB.app && NB.app.getGraphMode) return normalizeMode(NB.app.getGraphMode());
      if (NB.app && NB.app.getCfg) return normalizeMode(NB.app.getCfg().graphMode);
    } catch (_) {}
    return DEFAULT_MODE;
  }

  function applyModeUi(mode) {
    if (el.view) el.view.dataset.graphMode = mode;
    if (el.canvas2d) el.canvas2d.hidden = mode !== MODE_2D;
    if (el.canvas3d) el.canvas3d.hidden = mode !== MODE_3D;
    if (el.mode2dBtn) {
      el.mode2dBtn.setAttribute("aria-pressed", mode === MODE_2D ? "true" : "false");
    }
    if (el.mode3dBtn) {
      el.mode3dBtn.setAttribute("aria-pressed", mode === MODE_3D ? "true" : "false");
    }
    if (el.badge) el.badge.textContent = mode === MODE_2D ? "2D" : "3D";
    if (el.fit) {
      // The same control resets the orbit camera in 3D and re-centers
      // the pan/zoom view in 2D.
      if (mode === MODE_2D) {
        el.fit.setAttribute("aria-label", "Re-center graph");
        el.fit.title = "Re-center graph";
      } else {
        el.fit.setAttribute("aria-label", "Reset camera and fit graph");
        el.fit.title = "Reset camera and fit graph (Home)";
      }
    }
    if (el.host) {
      // Safe default for both modes. The 3D renderer claims `application`
      // only once its canvas is interactive; its loading/empty/error card
      // must stay a normal status region.
      el.host.setAttribute("role", "group");
      el.host.setAttribute("aria-label", mode === MODE_2D ? HOST_LABEL_2D : HOST_LABEL_3D);
    }
  }

  function activateMode(mode, options) {
    const r = rendererFor(mode);
    if (!r) return;
    if (r.setActiveFile) r.setActiveFile(currentNotePath());
    if (r.activate) r.activate(options);
  }

  function deactivateMode(mode) {
    const r = rendererFor(mode);
    if (r && r.deactivate) r.deactivate();
  }

  function setMode(mode) {
    const next = normalizeMode(mode);
    if (next === currentMode) return;
    // Stop the old renderer before starting the new one so they never
    // draw or listen together.
    deactivateMode(currentMode);
    currentMode = next;
    applyModeUi(next);
    try {
      if (NB.app && NB.app.setGraphMode) NB.app.setGraphMode(next);
    } catch (_) {}
    if (tabActive) activateMode(next);
  }

  function onTabActivate() {
    tabActive = true;
    currentMode = getMode();
    applyModeUi(currentMode);
    if (el.view) el.view.hidden = false;
    // Returning to a background graph tab must re-read the tree, so a
    // tab activation refreshes. A mode switch reuses the target's layout.
    deactivateMode(otherMode(currentMode));
    activateMode(currentMode, { refresh: true });
  }

  function onTabClose() {
    tabActive = false;
    deactivateMode(MODE_2D);
    deactivateMode(MODE_3D);
    if (el.view) el.view.hidden = true;
  }

  function registerOnLoad() {
    if (wired) return;
    wired = true;
    if (NB.tabs && NB.tabs.registerSpecial) {
      NB.tabs.registerSpecial({
        id: TAB_ID,
        icon: "🕸",
        label: "Graph",
        onActivate: onTabActivate,
        onClose: onTabClose,
      });
    }
    const toggleBtn = document.getElementById("activity-graph-btn");
    if (toggleBtn && !toggleBtn.dataset.graphWired) {
      toggleBtn.dataset.graphWired = "1";
      toggleBtn.addEventListener("click", function () {
        currentMode = getMode();
        applyModeUi(currentMode);
        if (NB.tabs && NB.tabs.openSpecial) NB.tabs.openSpecial(TAB_ID);
      });
    }
    if (el.mode2dBtn) {
      el.mode2dBtn.addEventListener("click", function () { setMode(MODE_2D); });
    }
    if (el.mode3dBtn) {
      el.mode3dBtn.addEventListener("click", function () { setMode(MODE_3D); });
    }
    currentMode = getMode();
    lastNotePath = currentNotePath();
    applyModeUi(currentMode);
  }

  if (NB.tabs && NB.tabs.registerSpecial) {
    registerOnLoad();
  } else if (document.readyState === "complete") {
    registerOnLoad();
  } else {
    // This module loads before tabs.js (both deferred), so the tab API
    // does not exist yet. Register once the deferred modules have all
    // executed.
    document.addEventListener("DOMContentLoaded", registerOnLoad, { once: true });
  }

  // Keep the facade asleep when the viewer hides the graph for a file
  // tab. The renderers stop themselves too; this covers a renderer that
  // is not mounted yet and keeps tabActive honest.
  if (NB.evt && NB.evt.on) {
    NB.evt.on("file:open", function (path) {
      if (isNotePath(path)) lastNotePath = path;
      if (el.view && !el.view.hidden) return;
      tabActive = false;
      deactivateMode(MODE_2D);
      deactivateMode(MODE_3D);
    });
  }

  function activeValue(key, fallback) {
    const r = activeRenderer();
    return r ? r[key] : fallback;
  }

  // --- public compatibility surface -----------------------------------
  NB.graph = {
    mount: function () {
      const r = activeRenderer();
      if (r && r.mount) r.mount();
    },
    loadGraph: function (options) {
      const r = activeRenderer();
      return r && r.loadGraph ? r.loadGraph(options) : Promise.resolve();
    },
    refresh: function (options) {
      const r = activeRenderer();
      return r && r.loadGraph ? r.loadGraph(options) : Promise.resolve();
    },
    get nodes() { return activeValue("nodes", []); },
    get edges() { return activeValue("edges", []); },
    get selectedId() { return activeValue("selectedId", null); },
    get activeFile() { return activeValue("activeFile", null); },
    get scale() { return activeValue("scale", 1); },
    get pan() { return activeValue("pan", { x: 0, y: 0 }); },
    get width() { return activeValue("width", 0); },
    get height() { return activeValue("height", 0); },
    get running() { return !!activeValue("running", false); },
    setParticleField: function (on) {
      // The setting is global, so both renderers keep the flag even
      // while one of them is inactive.
      if (NB.graph2d && NB.graph2d.setParticleField) NB.graph2d.setParticleField(on);
      if (NB.graph3d && NB.graph3d.setParticleField) NB.graph3d.setParticleField(on);
    },
    getParticleField: function () {
      const r = activeRenderer();
      return r && r.getParticleField ? r.getParticleField() : false;
    },
    getCamera: function () {
      return (currentMode === MODE_3D && NB.graph3d && NB.graph3d.getCamera)
        ? NB.graph3d.getCamera() : null;
    },
    getDepthSpread: function () {
      return (currentMode === MODE_3D && NB.graph3d && NB.graph3d.getDepthSpread)
        ? NB.graph3d.getDepthSpread() : 1;
    },
    getTier: function () {
      return (currentMode === MODE_3D && NB.graph3d && NB.graph3d.getTier)
        ? NB.graph3d.getTier() : "2d";
    },
    setMode: setMode,
    getMode: getMode,
    TAB_ID: TAB_ID,
  };
})();
