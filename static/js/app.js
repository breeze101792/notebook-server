/* app.js -- bootstrap: load config, wire everything together.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Autosave idle-delay bounds and default, in seconds. The delay is
  // the quiet time after the last keyboard/mouse interaction before a
  // WYSIWYG session writes itself. Configurable in Settings -> General.
  const AUTOSAVE_DELAY_MIN_S = 1;
  const AUTOSAVE_DELAY_MAX_S = 300;
  const AUTOSAVE_DELAY_DEFAULT_S = 5;

  const DEFAULTS = {
    theme: "auto",
    fontSize: "medium",
    wallpaper: "none",
    // Pattern stroke color. "neutral" uses the theme default (white in
    // dark / black in light); the other presets are mid-saturation
    // RGB values that read on both themes. The default is "neutral"
    // because the wallpaper itself is off by default -- the color
    // only matters when the user picks a pattern.
    wallpaperColor: "neutral",
    // Pattern stroke alpha. "subtle" is a barely-there hint, the
    // default -- the wallpaper is meant to be a background detail
    // that stays out of the way unless the user dials it up.
    wallpaperIntensity: "subtle",
    // "scroll" -> pattern scrolls with the content (paper-rolled-along);
    // "fixed"  -> pattern stays in the viewport, text scrolls over it
    // (windowpane). Default to "scroll" because the pattern lives on
    // the same element as the content, so this is the natural feel.
    wallpaperScroll: "scroll",
    lastFile: null,
    recentFiles: [],
    openFiles: [],
    activeFile: null,
    pinnedFiles: [],
    // The active side-panel view id (see NB.activity.register). Persisted
    // so a reload lands on the same view the user left (Explorer, Bookmarks,
    // Recent, Search, AI) instead of always snapping back to the file tree.
    // The server renders this view visible in the shell for first paint;
    // boot reconciles the once-fetched config against it.
    activeView: "explorer",
    sidebarWidth: 240,
    outlineWidth: 220,
    sidebarCollapsed: false,
    outlineCollapsed: false,
    searchCaseSensitive: false,
    // Ambient background particle drift in the graph view (neural
    // "network" feel). Off by default so it doesn't distract while
    // reading the graph; toggle in Settings -> Appearance.
    graphParticles: false,
    // Hide the top bar (brand, search, actions). Toggled live from the
    // Appearance settings tab or the Ctrl+Shift+T shortcut. When on,
    // body gets .topbar-hidden and --topbar-h collapses to 0 so the
    // layout heights stay correct.
    hideTopbar: false,
    // The site title shown in the browser tab and the top-bar brand.
    // Defaults to "Notebook"; the user can rename it in General settings.
    siteTitle: "Notebook",
    // Bookmarks: an ordered array of file paths the user has pinned in
    // the Bookmarks view. Insertion order; the bookmarks module reorders
    // them via drag-and-drop. Missing files (e.g. after a delete) are
    // pruned silently on the next tree refresh.
    bookmarks: [],
    // Pinned folders: an ordered array of folder paths the user has
    // pinned to the top of the Explorer view. Insertion order; the
    // sidebar reorders them via drag-and-drop. Folders that vanish from
    // the tree (e.g. after a delete) are pruned on the next refresh.
    pinnedFolders: [],
    // Which section fills the Explorer view's top slot: "pinned" for the
    // pinned-folder list, "bookmarks" for an inline copy of the bookmark
    // list, or "none". The header toggle cycles all three.
    explorerTop: "pinned",
    // User-supplied vimrc: lines of VIM initial script applied to the
    // editor's vim plugin (cm-bridge.compileVimrc). Empty by default;
    // populated via the Settings modal's VIM script pane. Stored as
    // a plain string so the user can hand-edit config.json without
    // going through the UI.
    vimrc: "",
    // "compact" / "medium" / "wide". Drives the --settings-modal-width
    // custom property that .settings-modal reads in style.css. Default
    // is "medium" (75vw) -- the modal scales with the viewport so the
    // same preset is comfortable on laptops and spacious on a wide
    // monitor. The two-column settings layout (left nav + right
    // sections) sits comfortably at this width.
    settingsModalWidth: "medium",
    // Same scheme as settingsModalWidth, but for height. Default
    // "medium" (80vh) leaves room for the Appearance tab's 7 rows on
    // a 1080p screen without scrolling; shorter viewports trigger the
    // 92vh outer clamp in the CSS rule.
    settingsModalHeight: "medium",
    // VIM-style keymap (shell keymap + CodeMirror 6's vim mode in
    // the editor). Off by default -- opt-in via the General settings
    // tab. The live state is mirrored to NB.vimnav.setEnabled() on
    // boot + on every toggle.
    vimMode: false,
    // Autosave (WYSIWYG / hybrid edit mode only). When on, the note
    // saves itself once keyboard/mouse interaction stops for
    // autosaveDelay seconds (or immediately when the tab is hidden or
    // the open file changes). Vim / CodeMirror edit mode is unaffected.
    // On by default -- the WYSIWYG editor is expected to behave like a
    // word processor. Gated in hybrid.js.
    autosave: true,
    autosaveDelay: AUTOSAVE_DELAY_DEFAULT_S,
    // Per-action keyboard bindings for the non-vim keymap. See
    // static/js/shortcuts.js for the chord format and the list of
    // actions. Missing keys fall back to that module's DEFAULTS,
    // so a fresh `{}` here means "use the shipped defaults".
    shortcuts: {},
  };

  function clampAutosaveDelay(seconds) {
    const n = Math.round(Number(seconds));
    if (!Number.isFinite(n)) return AUTOSAVE_DELAY_DEFAULT_S;
    return Math.min(AUTOSAVE_DELAY_MAX_S, Math.max(AUTOSAVE_DELAY_MIN_S, n));
  }

  // Width used while the side panel is collapsed. 0 -- the activity
  // bar's icons are the re-expand affordance, so the panel itself hides
  // completely instead of leaving a thin strip.
  const PANEL_COLLAPSED_W = 0;
  // The outline pane's visibility is toggled from the tab-bar icon, so it
  // hides completely (width 0) when collapsed -- no thin strip.
  const OUTLINE_COLLAPSED_W = 0;

  let cfg = { ...DEFAULTS };
  let saveTimer = null;
  let pendingConfigKeys = new Set();
  // One serial GET->POST chain for phone config writes. Overlapping
  // flushes would otherwise each read the same old blob and clobber the
  // other's key.
  let configFlushQueue = Promise.resolve();

  // Phone mode is decided by CSS (--ui-mode) and mirrored by mobile.js.
  function isPhoneMode() {
    return !!(NB.mobile && NB.mobile.isOn && NB.mobile.isOn());
  }

  const caseEl   = document.getElementById("search-case");
  const editBtn  = document.getElementById("edit-toggle");
  // The outer side panel (hosts the active activity view). The old
  // #sidebar is now a view inside it; resize + collapse operate on the
  // panel, not the view, so every activity view shares one width.
  const sidePanelEl = document.getElementById("side-panel");
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
  /* Swap the vendored highlight.js stylesheet to match the resolved theme.
   * Both stylesheets are loaded into the document; we toggle the `disabled`
   * attribute on each so the browser picks the right one. The light
   * stylesheet is `disabled` in the HTML, so dark is the default at boot
   * (matches the body's default `data-theme="dark"`). */
  function applyHljsTheme(resolved) {
    const light = document.getElementById("hljs-light");
    const dark  = document.getElementById("hljs-dark");
    if (light) light.disabled = resolved !== "light";
    if (dark)  dark.disabled  = resolved === "light";
  }
  function applyTheme(pref) {
    cfg.theme = pref;
    const resolved = resolveTheme(pref);
    document.body.dataset.theme = resolved;
    applyHljsTheme(resolved);
    // Mermaid bakes the theme into the rendered SVG, so theme
    // changes don't propagate to already-rendered diagrams
    // automatically. Force the next render() to reinitialize
    // mermaid so the new theme is picked up. The viewer's render
    // pipeline (which runs on every file open + live preview
    // tick) will then produce SVGs in the right theme.
    if (NB.mermaid && NB.mermaid.reinit) NB.mermaid.reinit(resolved);
  }
  if (themeMQ) {
    themeMQ.addEventListener("change", () => {
      if (cfg.theme === "auto") {
        const resolved = resolveTheme("auto");
        document.body.dataset.theme = resolved;
        applyHljsTheme(resolved);
        if (NB.mermaid && NB.mermaid.reinit) NB.mermaid.reinit(resolved);
      }
    });
  }

  /* --- font size ------------------------------------------------------ */
  // The base size is 14px (= 1rem); these multipliers are applied to the
  // html element via --font-scale, so every rem-based font-size in the
  // app scales together. The chrome (topbar, sidebar, tabs, edit bar,
  // settings modal) is rem-ified in style.css to take advantage of this.
  const FONT_SCALES = {
    small:  0.9,
    medium: 1.0,
    large:  1.15,
    xlarge: 1.3,
  };
  function applyFontSize(name) {
    const mult = FONT_SCALES[name] != null ? FONT_SCALES[name] : 1;
    cfg.fontSize = (FONT_SCALES[name] != null) ? name : "medium";
    document.documentElement.style.setProperty("--font-scale", String(mult));
    // Rendered diagrams store a unitless factor, not a px size, but the
    // matrix (scroll vs fit) depends on the prose size; recompute once
    // the new scale is live.
    if (NB.blocks && NB.blocks.scheduleRelayout) NB.blocks.scheduleRelayout();
  }

  /* --- settings modal width ----------------------------------------- */
  // The settings modal reads its width and height from
  // --settings-modal-width / --settings-modal-height (set on :root via
  // the inline style). Three presets cover the common cases; unknown
  // values fall back to "medium" so a corrupt config can't leave the
  // modal at 0 size. Values are CSS unit strings (vw / vh), not px,
  // so the modal scales with the viewport -- on a 1920x1080 display
  // 75vw = 1440px and 80vh = 864px, on a 1280x768 laptop the same
  // 75vw / 80vh = 960 / 614px.
  //
  // The 96vw / 92vh outer clamp in the .settings-modal CSS rule
  // keeps the modal slightly inset from the viewport edge on very
  // small screens; the chosen preset can never push the modal off
  // the visible area.
  const SETTINGS_MODAL_WIDTHS = {
    compact: "60vw",
    medium:  "75vw",
    wide:    "90vw",
  };
  const SETTINGS_MODAL_HEIGHTS = {
    // Floor is 80vh: even the smallest preset gives the modal most of
    // the viewport's vertical real estate, so the body is always
    // roomy and the dim backdrop stays a thin strip on the top and
    // bottom. The three presets are evenly spaced 5vh apart so each
    // step is a small, predictable jump.
    compact: "80vh",
    medium:  "85vh",
    wide:    "90vh",
  };
  function applySettingsModalWidth(name) {
    const v = SETTINGS_MODAL_WIDTHS[name] != null ? SETTINGS_MODAL_WIDTHS[name] : SETTINGS_MODAL_WIDTHS.medium;
    cfg.settingsModalWidth = (SETTINGS_MODAL_WIDTHS[name] != null) ? name : "medium";
    document.documentElement.style.setProperty("--settings-modal-width", v);
  }
  function applySettingsModalHeight(name) {
    const v = SETTINGS_MODAL_HEIGHTS[name] != null ? SETTINGS_MODAL_HEIGHTS[name] : SETTINGS_MODAL_HEIGHTS.medium;
    cfg.settingsModalHeight = (SETTINGS_MODAL_HEIGHTS[name] != null) ? name : "medium";
    document.documentElement.style.setProperty("--settings-modal-height", v);
  }

  /* --- wallpaper --------------------------------------------------- */
  // The wallpaper lives on #viewer-content (the actual scroller / content
  // element) so it's anchored to the content and can never drift out of
  // sync with the text as the user scrolls. The class is always set (even
  // when off) so the default state is explicit and the CSS can grow more
  // variants later without JS changes.
  //
  // Three independent settings:
  //   wallpaper  -> pattern (none / lines / grid)
  //   wallpaperColor    -> stroke color (neutral / blue / green / purple / amber)
  //   wallpaperIntensity-> stroke alpha (subtle / medium / bold)
  //   wallpaperScroll   -> scroll behavior (scroll / fixed)
  // Each is a separate class on #viewer-content. The CSS variables
  // --wp-rgb and --wp-a drive the actual paint, so the color and
  // intensity classes are just one-line variable overrides.
  const WALLPAPERS = ["none", "lines", "grid"];
  const WALLPAPER_COLORS = ["neutral", "blue", "green", "purple", "amber"];
  const WALLPAPER_INTENSITIES = ["subtle", "medium", "bold"];
  const WALLPAPER_SCROLL = ["scroll", "fixed"];
  const viewerEl = document.getElementById("viewer-content");
  function applyWallpaper(name) {
    const w = WALLPAPERS.indexOf(name) >= 0 ? name : "none";
    cfg.wallpaper = w;
    if (viewerEl) {
      viewerEl.classList.remove("wallpaper-none", "wallpaper-lines", "wallpaper-grid");
      viewerEl.classList.add("wallpaper-" + w);
    }
  }
  function applyWallpaperColor(name) {
    const c = WALLPAPER_COLORS.indexOf(name) >= 0 ? name : "neutral";
    cfg.wallpaperColor = c;
    if (viewerEl) {
      // "neutral" is the absence of a color modifier (the CSS default
      // is white-in-dark / black-in-light, set by body[data-theme]).
      // For all other presets, set the explicit color class.
      viewerEl.classList.remove(
        "wallpaper-color-neutral",
        "wallpaper-color-blue",
        "wallpaper-color-green",
        "wallpaper-color-purple",
        "wallpaper-color-amber"
      );
      if (c !== "neutral") viewerEl.classList.add("wallpaper-color-" + c);
    }
  }
  function applyWallpaperIntensity(name) {
    const i = WALLPAPER_INTENSITIES.indexOf(name) >= 0 ? name : "subtle";
    cfg.wallpaperIntensity = i;
    if (viewerEl) {
      viewerEl.classList.remove(
        "wallpaper-intensity-subtle",
        "wallpaper-intensity-medium",
        "wallpaper-intensity-bold"
      );
      viewerEl.classList.add("wallpaper-intensity-" + i);
    }
  }
  function applyWallpaperScroll(mode) {
    const m = WALLPAPER_SCROLL.indexOf(mode) >= 0 ? mode : "scroll";
    cfg.wallpaperScroll = m;
    if (viewerEl) {
      // Always remove + re-add so the class is in a known state even
      // after the user switches back to "scroll" from "fixed".
      viewerEl.classList.toggle("wallpaper-fixed", m === "fixed");
    }
  }

  /* --- top bar + site title ----------------------------------------- */
  // Hiding the top bar is a body class + a --topbar-h collapse (see
  // style.css). The class drives the CSS; the variable keeps every
  // height that references --topbar-h (tabs, viewer scroll-margin,
  // popover max-heights) correct when the bar is gone.
  function applyTopbar(hide) {
    cfg.hideTopbar = !!hide;
    document.body.classList.toggle("topbar-hidden", cfg.hideTopbar);
  }
  // The site title shows in the browser tab (<title>) and the top-bar
  // brand. Empty input falls back to the default so the tab never
  // shows a blank title.
  function applySiteTitle(title) {
    const t = (typeof title === "string" && title.trim()) ? title.trim() : "Notebook";
    cfg.siteTitle = t;
    const brand = document.getElementById("brand");
    if (brand) {
      const icon = brand.querySelector(".brand-icon");
      brand.textContent = t;
      if (icon) brand.prepend(icon);
    }
    document.title = t;
  }

  /* --- config persistence ------------------------------------------- */
  function applyConfig(c) {
    cfg = { ...DEFAULTS, ...c };
    applyTheme(cfg.theme || "auto");
    applyFontSize(cfg.fontSize || "medium");
    applySettingsModalWidth(cfg.settingsModalWidth || "medium");
    applySettingsModalHeight(cfg.settingsModalHeight || "medium");
    applyWallpaper(cfg.wallpaper || "none");
    applyWallpaperColor(cfg.wallpaperColor || "neutral");
    applyWallpaperIntensity(cfg.wallpaperIntensity || "subtle");
    applyWallpaperScroll(cfg.wallpaperScroll || "scroll");
    applyTopbar(!!cfg.hideTopbar);
    applySiteTitle(cfg.siteTitle || "Notebook");
    caseEl.checked = !!cfg.searchCaseSensitive;
    applySidebarState();
    applyOutlineState();
    // Hand the loaded bookmarks to the bookmarks module so the list
    // renders before the first tree refresh arrives. Done here, not
    // in boot(), so any cfg source (load from server, future sync,
    // tests) goes through the same path.
    if (NB.bookmarks && NB.bookmarks.set) {
      NB.bookmarks.set(cfg.bookmarks || []);
    }
    // Same for pinned folders: hand the loaded list to the sidebar so the
    // Pinned section renders before the first tree refresh arrives.
    if (NB.sidebar && NB.sidebar.setPinnedFolders) {
      NB.sidebar.setPinnedFolders(cfg.pinnedFolders || []);
    }
    // Explorer top-section mode: the sidebar owns the valid set and
    // normalizes a hand-edited config value; read the result back so a
    // later write persists a known value.
    if (NB.sidebar && NB.sidebar.setExplorerTop) {
      NB.sidebar.setExplorerTop(cfg.explorerTop);
      cfg.explorerTop = NB.sidebar.getExplorerTop();
    } else {
      cfg.explorerTop = DEFAULTS.explorerTop;
    }
  }

  /* Side panel minimize: toggle between the saved width and a thin strip.
   * The collapsed state is persisted in config. NB.activity owns the
   * activity-bar icon highlighting and the activate/toggle-on-click
   * behavior; this function just applies the width + class from the
   * persisted config on boot. The live toggle goes through the icon
   * click -> NB.activity.activate(id, true) -> collapse()/expand() and
   * is persisted by the listener below. */
  function applySidebarState() {
    if (isPhoneMode()) return;
    if (cfg.sidebarCollapsed) {
      document.documentElement.style.setProperty("--side-panel-width", PANEL_COLLAPSED_W + "px");
      sidePanelEl.classList.add("collapsed");
    } else {
      document.documentElement.style.setProperty("--side-panel-width", (cfg.sidebarWidth || 240) + "px");
      sidePanelEl.classList.remove("collapsed");
    }
  }
  function applyOutlineState() {
    if (isPhoneMode()) return;
    if (cfg.outlineCollapsed) {
      document.documentElement.style.setProperty("--outline-width", OUTLINE_COLLAPSED_W + "px");
      outlineEl.classList.add("collapsed");
    } else {
      document.documentElement.style.setProperty("--outline-width", (cfg.outlineWidth || 220) + "px");
      outlineEl.classList.remove("collapsed");
    }
  }

  /* Persist config. `keys` names the only keys a caller may change.
   *
   * Desktop keeps its single whole-blob POST. On a phone a keyless call is
   * a no-op (nothing is safe to write from the phone shell), and a keyed
   * call does a read-merge-write: fetch the current server blob, copy the
   * named keys from cfg, then POST the complete merged object. The POST
   * replaces the file verbatim, so a partial body would drop every other
   * key the desktop owns (open tabs, pane widths, ...). */
  function persistConfig(keys) {
    clearTimeout(saveTimer);
    if (Array.isArray(keys)) keys.forEach(k => pendingConfigKeys.add(k));
    saveTimer = setTimeout(flushConfig, 250);
  }

  function flushConfig() {
    const keyList = [...pendingConfigKeys];
    pendingConfigKeys.clear();
    const run = () => {
      if (isPhoneMode()) {
        // Keyless-only calls (desktop-only settings) write nothing on a
        // phone. Pending keyed calls are never dropped by a later keyless
        // one, so theme + fontSize + recentFiles can share a debounce.
        if (!keyList.length) return Promise.resolve();
        return NB.api.getConfig().then((fresh) => {
          const merged = (fresh && typeof fresh === "object") ? { ...fresh } : {};
          for (const key of keyList) {
            if (cfg[key] === undefined) delete merged[key];
            else merged[key] = cfg[key];
          }
          return NB.api.saveConfig(merged);
        }).catch(e => console.warn("config save failed", e));
      }
      return NB.api.saveConfig(cfg).catch(e => console.warn("config save failed", e));
    };
    configFlushQueue = configFlushQueue.then(run, run).then(() => {
      NB.evt.emit("config:changed", cfg);
      // Keys that arrived while this flush was in flight get one more
      // serialized pass immediately.
      if (pendingConfigKeys.size) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flushConfig, 0);
      }
    });
  }

  function updateRecent(path) {
    if (!path) return;
    cfg.recentFiles = [path, ...cfg.recentFiles.filter(p => p !== path)].slice(0, 20);
    if (isPhoneMode()) {
      persistConfig(["recentFiles"]);
      return;
    }
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

    // tab set changed -> persist open files + active file + pinned files
    NB.evt.on("tabs:changed", ({ openFiles, activeFile, pinnedFiles }) => {
      if (isPhoneMode()) return;   // phone tabs are one note and never persist
      cfg.openFiles = openFiles;
      cfg.activeFile = activeFile;
      if (pinnedFiles) cfg.pinnedFiles = pinnedFiles;
      persistConfig();
    });

    // search-case toggle persists config
    NB.evt.on("search-case-changed", (val) => {
      cfg.searchCaseSensitive = val;
      persistConfig();
    });

    // top bar: enter/exit edit mode. The Preview / Save / Close buttons
    // for the edit-mode toolbar are wired inside viewer.js (where the
    // edit-mode state machine lives) so the dirty-aware visibility for
    // Save stays in one place.
    editBtn.addEventListener("click", () => NB.viewer.toggleEdit());

    // side panel minimize (collapse). The collapse button lives inside
    // the Explorer view's header. Re-expansion is via the activity bar's
    // icons (clicking any icon expands the panel and shows that view),
    // so there's no separate expand button on the panel itself.
    document.getElementById("sidebar-collapse").addEventListener("click",
      () => {
        if (isPhoneMode()) {
          if (NB.mobile && NB.mobile.closeDrawer) NB.mobile.closeDrawer();
          return;
        }
        cfg.sidebarCollapsed = true; applySidebarState(); persistConfig();
      });
    // The activity-bar icon toggle path: clicking the active icon
    // collapses the panel via NB.activity; persist that state so a
    // reload lands on the same shape. Activating a different icon from
    // a collapsed panel expands it -- persist that too.
    if (NB.evt) {
      NB.evt.on("activity:collapsed", () => {
        if (isPhoneMode()) return;
        cfg.sidebarCollapsed = true; applySidebarState(); persistConfig();
      });
      NB.evt.on("activity:expanded", () => {
        if (isPhoneMode()) return;
        cfg.sidebarCollapsed = false; applySidebarState(); persistConfig();
      });
      // Switching the active view persists so a reload restores it. Fired
      // by activity.js on every activation; guard against the boot
      // activation of the already-saved view to avoid a redundant save.
      NB.evt.on("activity:changed", ({ id }) => {
        if (isPhoneMode()) return;
        if (cfg.activeView !== id) { cfg.activeView = id; persistConfig(); }
      });
    }
    document.getElementById("outline-collapse").addEventListener("click",
      () => {
        if (isPhoneMode()) return;
        cfg.outlineCollapsed = true; applyOutlineState(); persistConfig();
      });
    // Tab-bar icon toggles the right outline pane on/off (collapse =
    // hide the pane completely to 0 width; there's no thin strip to
    // re-expand it). Mirrors how the activity-bar icon toggles the left
    // side panel, giving both panes one persistent visibility control.
    document.getElementById("outline-toggle").addEventListener("click", () => {
      if (isPhoneMode()) return;
      cfg.outlineCollapsed = !cfg.outlineCollapsed;
      applyOutlineState();
      persistConfig();
    });

    // App-level keyboard shortcuts (active when VIM mode is off; see
    // static/js/shortcuts.js). The module owns the keydown listener
    // and the per-action chord (default + user override) lookup; we
    // just hand it the handler map. openSearch / openSettings /
    // tabPrev / tabNext are new -- previously these had no app-level
    // shortcut (only the buttons, or in VIM mode, the vimnav
    // bindings). save was the lone Ctrl+S binding before; it now
    // lives here too so the user can rebind it.
    if (NB.shortcuts) {
      // Cycle to the previous / next tab with the same dirty-aware
      // commit logic vimnav uses (commitForTabSwitch prompts to save
      // a dirty file first; a failed save aborts the cycle).
      NB.shortcuts.install({
        save: () => NB.viewer.save(),
        openSearch: () => {
          const si = document.getElementById("search-input");
          if (si) { si.focus(); si.select(); }
        },
        tabPrev: () => NB.vimnav && NB.vimnav.cycleTabWithCommit && NB.vimnav.cycleTabWithCommit("prev"),
        tabNext: () => NB.vimnav && NB.vimnav.cycleTabWithCommit && NB.vimnav.cycleTabWithCommit("next"),
        toggleEdit: () => { if (NB.viewer && NB.viewer.toggleEdit) NB.viewer.toggleEdit(); },
        toggleHybrid: () => { NB.evt.emit("shortcut:toggleHybrid"); },
        windowCycle: () => NB.vimnav && NB.vimnav.cycleWindow && NB.vimnav.cycleWindow(),
        toggleTopbar: () => NB.app.setHideTopbar(!NB.app.getHideTopbar()),
        openSettings: () => { if (NB.settings && NB.settings.open) NB.settings.open(); },
      });
    }

    // Settings: the gear button opens a modal. The modal lives in its own
    // module (settings.js) and reads/writes the cfg through these hooks.
    document.getElementById("activity-settings-btn").addEventListener("click",
      () => NB.settings && NB.settings.open());

    // resizable sidebars (drag the inner edge). Installed only on the
    // desktop shell; a later phone->desktop mode flip re-runs this.
    ensureResizeHandles();
    NB.evt.on("mobile:mode", ({ mode }) => {
      if (mode !== "desktop") return;
      applySidebarState();
      applyOutlineState();
      ensureResizeHandles();
    });
  }

  function ensureResizeHandles() {
    if (isPhoneMode()) return;
    // The sidebar may be dragged up to half the viewport width; the
    // outline is capped to a fixed 520px so it stays a minimap.
    setupResize("side-panel", "--side-panel-width", "right", { max: () => window.innerWidth / 2 });
    setupResize("outline-pane", "--outline-width", "left");
  }

  function setupResize(id, cssVar, edge, opts) {
    const pane = document.getElementById(id);
    if (pane.querySelector(".resize-handle")) return;
    // Max may be a fixed number (default 520) or a function evaluated
    // live on each drag tick (e.g. half the current viewport width), so
    // a window resize mid-drag keeps working.
    const maxOpt = (opts && opts.max !== undefined) ? opts.max : 520;
    let startX = 0, startW = 0, dragging = false;
    // The handle is a wider, hover-visible grab strip on the pane's inner
    // edge (size + look come from .resize-handle in CSS). Only the edge
    // (right:0 / left:0) is set here, per pane.
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.style.cssText = "position:absolute;top:0;" + edge + ":0;height:100%;z-index:10;";
    const bar = document.createElement("div");
    bar.className = "resize-handle-bar";
    handle.appendChild(bar);
    pane.appendChild(handle);

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      const w = pane.getBoundingClientRect().width;
      if (id === "side-panel") cfg.sidebarWidth = w;
      else cfg.outlineWidth = w;
      persistConfig();
    }

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;            // primary button only
      dragging = true; startX = e.clientX;
      startW = pane.getBoundingClientRect().width;
      handle.classList.add("dragging");
      document.body.classList.add("resizing"); // keep col-resize cursor over siblings mid-drag
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      // A left-edge handle (outline) widens when dragged away from the pane
      // (dragging left => wider), so flip the sign; a right-edge handle
      // (sidebar) drags naturally with +dx.
      const sign = edge === "left" ? -1 : 1;
      const w = Math.max(140, Math.min(typeof maxOpt === "function" ? maxOpt() : maxOpt, startW + sign * dx));
      document.documentElement.style.setProperty(cssVar, w + "px");
    });
    document.addEventListener("mouseup", endDrag);
    // Recover from a drag abandoned mid-gesture (button released off-window,
    // alt-tab, tab hidden) -- otherwise body.resizing freezes the whole UI.
    window.addEventListener("blur", endDrag);
    document.addEventListener("visibilitychange", () => { if (document.hidden) endDrag(); });
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

  /* --- deep link ---------------------------------------------------- */
  // The app honors two URL forms on boot and on in-app navigation:
  //   1. ?file=<path>&heading=<slug>  (query string, the original form)
  //   2. /<path>#<slug>               (path + fragment, the GitHub-style
  //                                   Markdown link format e.g.
  //                                   http://server/README.md#core-rules)
  // The query-string form is tried first so it's deterministic. The
  // path form is the natural output of a Markdown link like
  // `[b](notes/b.md#intro)`: the browser navigates to the resolved URL
  // and the SPA's catch-all server route + this parser handle it.
  //
  // The path-form "looks like a notebook" check (`\.md$` or contains
  // `/`) is what keeps the catch-all from firing on every devtools /
  // favicon / random URL hit -- anything that doesn't look like a
  // notebook file falls through to a normal boot.
  function parseDeepLink(url) {
    const u = new URL(url || window.location.href);
    // Form 1: query string.
    const qsFile = u.searchParams.get("file");
    if (qsFile) {
      return { file: qsFile, heading: u.searchParams.get("heading") || null };
    }
    // Form 2: path + fragment.
    const path = u.pathname.replace(/^\/+/, "");
    if (!path) return null;
    if (!/\.md$/i.test(path) && !path.includes("/")) return null;
    const heading = u.hash ? decodeURIComponent(u.hash.replace(/^#/, "")) : null;
    return { file: path, heading: heading || null };
  }

  // Open the deep-link target. If the file isn't in the tree we log
  // and bail (the normal boot already left a working view in place);
  // if the heading doesn't exist the file still opens, just without
  // a scroll target. The URL cleanup is the caller's job: the boot
  // path strips the query/path (replaceState, no history push); the
  // in-app link click path already pushed a state with a clean URL,
  // so no extra history mutation is needed here. Keeping the two
  // concerns split lets openDeepLink be safely re-entrant -- the
  // popstate handler calls it without stomping on the just-restored
  // history.state.
  async function openDeepLink({ file, heading }) {
    const tree = NB.sidebar.getTree();
    if (!treeHas(tree, file)) {
      if (NB.mobile && NB.mobile.isOn && NB.mobile.isOn() &&
          NB.mobile.showNotFound) {
        NB.mobile.showNotFound(file);
      }
      console.warn("Deep link target not in tree:", file);
      return false;
    }
    if (!NB.tabs.isOpen(file)) {
      await NB.tabs.open(file);
    } else if (NB.tabs.getActive() !== file) {
      await NB.tabs.activate(file);
    }
    if (heading) {
      const ok = NB.viewer.scrollToHeading(heading);
      if (!ok) console.warn("Deep link heading not found:", heading);
    }
    return true;
  }

  /* Panel state the server rendered into the shell, read back from the DOM.
   * boot() snapshots this before the async config fetch so a failed fetch
   * restores it instead of repainting the panel with DEFAULTS (which would
   * reveal the file tree, expand a collapsed panel, and lose the saved
   * width). The collapsed width reads 0 in the DOM; the saved width is kept
   * by cfg when the panel is expanded, so 0 is left untouched here. */
  function shellPanelState() {
    const px = (name) => parseInt(document.documentElement.style.getPropertyValue(name), 10);
    return {
      activeView: (NB.activity.getActive && NB.activity.getActive()) || cfg.activeView,
      collapsed: !!(sidePanelEl && sidePanelEl.classList.contains("collapsed")),
      width: px("--side-panel-width"),
      outlineCollapsed: !!(outlineEl && outlineEl.classList.contains("collapsed")),
      outlineWidth: px("--outline-width"),
    };
  }

  /* Decide whether a successful config fetch should switch the side panel
   * to a different view. Returns the id to activate, or null to leave the
   * panel alone. A failed fetch (fetchedView is not a string), a fetch that
   * names the view already showing, and a user who switched away from the
   * shell-painted view while the fetch was in flight all return null. */
  function resolveBootView(currentView, shellView, fetchedView) {
    if (typeof fetchedView !== "string") return null;
    if (currentView !== shellView) return null;
    if (fetchedView === shellView) return null;
    return fetchedView;
  }

  /* --- boot ---------------------------------------------------------- */
  let booted = false;
  async function boot() {
    if (booted) return;   // idempotent: DOMContentLoaded fires once, but guard anyway
    booted = true;
    wire();
    // Snapshot the shell-painted panel before the async config fetch so the
    // failed-fetch path below can restore it intact.
    const shellPanel = shellPanelState();
    let serverCfg = null;
    try {
      serverCfg = await NB.api.getConfig();
      applyConfig(serverCfg);
    } catch (e) {
      applyConfig({});
      // The shell already painted the saved panel; a failed fetch must not
      // reset it to DEFAULTS. Restore what applyConfig just overwrote.
      cfg.sidebarCollapsed = shellPanel.collapsed;
      cfg.outlineCollapsed = shellPanel.outlineCollapsed;
      if (shellPanel.width > 0) cfg.sidebarWidth = shellPanel.width;
      if (shellPanel.outlineWidth > 0) cfg.outlineWidth = shellPanel.outlineWidth;
      applySidebarState();
      applyOutlineState();
    }
    // watcher.js auto-starts the polling fallback at module load; a saved
    // "off" choice must stop it once config has arrived.
    if (cfg.watchEnabled === false && NB.watcher && NB.watcher.disable) {
      NB.watcher.disable();
    }
    // Reconcile the fetched view only when it names a different view than
    // the shell painted AND the user has not switched away while the fetch
    // was in flight (see resolveBootView). A failed fetch reconciles nothing.
    const bootView = isPhoneMode() ? null : resolveBootView(
      NB.activity.getActive(), shellPanel.activeView,
      serverCfg && serverCfg.activeView);
    if (bootView) NB.activity.activate(bootView, false);
    // Phone has no AI view; a saved desktop activeView of "ai" must not
    // leave the drawer showing a hidden host.
    if (isPhoneMode() && NB.activity.getActive && NB.activity.getActive() === "ai") {
      NB.activity.activate("explorer", false);
    }
    // The panel is the source of truth for the active view -- the failed
    // path leaves cfg at DEFAULTS -- so mirror it back. Without this a later
    // unrelated save would persist "explorer" and drop the saved view.
    if (NB.activity.getActive) cfg.activeView = NB.activity.getActive();

    await NB.sidebar.refresh();
    const tree = NB.sidebar.getTree();

    // Init the VIM keymap from the persisted cfg. vimnav.js attaches
    // its global keydown listener at module-load time (so it can be
    // called on first paint without a race), but the listener is
    // gated by an `enabled` flag that setEnabled() flips. Off by
    // default; only the user opt-in turns it on.
    if (NB.vimnav) NB.vimnav.setEnabled(!!cfg.vimMode);

    // Restore previously open tabs (filtered to files that still exist),
    // then activate the last active file; fall back to lastFile / first file.
    const openFiles = (cfg.openFiles || []).filter(p => treeHas(tree, p));
    const activeFile = cfg.activeFile && treeHas(tree, cfg.activeFile) ? cfg.activeFile : null;
    const lastFile = cfg.lastFile && treeHas(tree, cfg.lastFile) ? cfg.lastFile : null;
    const fallback = lastFile || firstFilePath(tree) || null;
    const pinnedFiles = (cfg.pinnedFiles || []).filter(p => openFiles.includes(p));
    // Read the incoming link BEFORE restoring anything: a phone boot must
    // not let a resume note rewrite the URL (mobile.js suppresses its
    // history entries for the whole boot window) or replace the requested
    // note.
    const deepLink = parseDeepLink();
    // Phone: one reader, one tab, no desktop session restore. A deep link
    // wins over the device-local resume fallback; with neither, boot lands
    // on Home. The desktop path below is unchanged.
    let restoreOpen = openFiles;
    let restoreActive = activeFile;
    let restoreFallback = fallback;
    let restorePinned = pinnedFiles;
    if (isPhoneMode()) {
      restoreOpen = [];
      restoreActive = null;
      restorePinned = [];
      if (deepLink) {
        restoreFallback = treeHas(tree, deepLink.file) ? deepLink.file : null;
      } else {
        const resume = (NB.mobile && NB.mobile.resumePath) ? NB.mobile.resumePath() : null;
        restoreFallback = (resume && treeHas(tree, resume)) ? resume : null;
      }
    }
    if (NB.mobile && NB.mobile.beginBoot) NB.mobile.beginBoot();
    try {
      try { await NB.tabs.restore(restoreOpen, restoreActive, restoreFallback, restorePinned); }
      catch (e) { console.warn("restore tabs failed", e); }

      // Deep link: if the URL requested a specific file (and optional
      // heading), override the restored active tab with it. Runs AFTER
      // restore so session tabs are preserved in the background while
      // the deep-linked file becomes the visible view. Auth (if any)
      // reloads the page on success, so this code path is only reached
      // with a valid session.
      if (deepLink) {
        try {
          const opened = await openDeepLink(deepLink);
          // Strip the URL (replaceState, NOT push) so a refresh doesn't
          // re-apply the deep link and the back button doesn't see this
          // as a navigation. Boot is a fresh entry point, not a history
          // event. file:// / restricted env: harmless to skip. On a phone
          // a bad target keeps its address so "Note not found" stays
          // shareable/retryable.
          if (!isPhoneMode()) {
            try { history.replaceState(null, "", window.location.pathname); }
            catch (_) {}
          }
        } catch (e) { console.warn("deep link failed", e); }
      }
    } finally {
      if (NB.mobile && NB.mobile.endBoot) NB.mobile.endBoot();
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

  /* --- shared helpers ----------------------------------------------- */
  /* notify(message, ms, cls?)
   *   A tiny toast used by ad-hoc "Copied!" / "Saved!" style feedback.
   *   Reuses a single DOM element so we never pile up toasts; the
   *   element lives at a fixed spot in the viewport (bottom-right),
   *   is hidden by default, and animates a fade-in on each call.
   *   Optional `cls` is a modifier class (e.g. "warn") for error
   *   or attention kinds of feedback.
   *
   *   Future: this is the seed of a notification system. If more
   *   modules start needing toasts, this is the place to grow the
   *   API (multi-toast queue, action buttons, etc.) -- until then
   *   a single-element "last write wins" is plenty. */
  let toastEl = null;
  let toastTimer = null;
  function notify(message, ms, cls) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.className = "toast" + (cls ? " " + cls : "");
    toastEl.textContent = message;
    // Force a reflow between successive identical messages so the
    // CSS transition re-runs and the toast visibly re-appears.
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, ms || 1500);
  }

  /* copyToClipboard(text)
   *   Modern path: navigator.clipboard.writeText. Works in secure
   *   contexts (https, localhost) which covers the app's default
   *   bind of 127.0.0.1. Returns a Promise that resolves on success.
   *   Fallback: a hidden <textarea> + document.execCommand("copy").
   *   That second path is the universal path -- it works in insecure
   *   contexts and older browsers where the Clipboard API is gated
   *   or missing. The fallback is the deprecated execCommand API,
   *   but the deprecation is one of those "still works everywhere"
   *   ones; we use it only when the modern API isn't available.
   *
   *   Throws on the rare path where both fail (e.g. permissions
   *   denied in a sandboxed iframe with no DOM) so callers can
   *   surface a clear error instead of silently swallowing it. */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (_) {
      // Fall through to the textarea path. The Clipboard API can
      // throw (permission denied, user gesture required) -- the
      // textarea+execCommand path doesn't need a user gesture, so
      // it covers those cases.
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand && document.execCommand("copy"); }
    catch (_) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error("Clipboard write failed");
  }

  /* copyPath(path) / copyLink(path)
   *   Copy a note's notebook-relative path, or a deep link to it
   *   (?file=<encoded path>), through copyToClipboard. Shared by the
   *   file-like context menus. */
  function copyPath(path) {
    if (!path) return;
    copyToClipboard(path).catch(() => {});
  }

  function copyLink(path) {
    if (!path) return;
    const url = location.origin + location.pathname + "?file=" + encodeURIComponent(path);
    copyToClipboard(url).catch(() => {});
  }

  /* Tiny façade so other modules (settings.js) can read live config and
   * trigger a persist without reaching into our module-scoped state. */
  NB.app = {
    getCfg: () => cfg,
    // The canonical side-panel width, read by NB.activity.expand() to
    // restore the panel to the user's last-dragged size after a
    // collapse cycle. Kept here so the width has one owner.
    getSidePanelWidth: () => (cfg.sidebarWidth || 240),
    // Shared helpers used by ad-hoc UX (code-block Copy button, etc.).
    // notify() is the single-line toast; copyToClipboard() is the
    // Clipboard-API-with-fallback writer; copyPath()/copyLink() are the
    // file-menu clipboard actions.
    notify, copyToClipboard, copyPath, copyLink,
    // The active shell mode (read from mobile.js, which reads the CSS token).
    getMode: () => (isPhoneMode() ? "phone" : "desktop"),
    isMobile: isPhoneMode,
    setTheme: (pref) => { applyTheme(pref); persistConfig(["theme"]); },
    setFontSize: (name) => { applyFontSize(name); persistConfig(["fontSize"]); },
    getFontSize: () => cfg.fontSize || "medium",
    setSettingsModalWidth: (name) => { applySettingsModalWidth(name); persistConfig(); },
    getSettingsModalWidth: () => cfg.settingsModalWidth || "medium",
    setSettingsModalHeight: (name) => { applySettingsModalHeight(name); persistConfig(); },
    getSettingsModalHeight: () => cfg.settingsModalHeight || "medium",
    setWallpaper: (name) => { applyWallpaper(name); persistConfig(); },
    getWallpaper: () => cfg.wallpaper || "none",
    setWallpaperColor: (name) => { applyWallpaperColor(name); persistConfig(); },
    getWallpaperColor: () => cfg.wallpaperColor || "neutral",
    setWallpaperIntensity: (name) => { applyWallpaperIntensity(name); persistConfig(); },
    getWallpaperIntensity: () => cfg.wallpaperIntensity || "subtle",
    setWallpaperScroll: (mode) => { applyWallpaperScroll(mode); persistConfig(); },
    setHideTopbar: (on) => { applyTopbar(!!on); persistConfig(); },
    getHideTopbar: () => !!cfg.hideTopbar,
    // File watching is on by default; the Settings toggle persists the
    // user's off choice, and boot honours it.
    getWatchEnabled: () => cfg.watchEnabled !== false,
    setWatchEnabled: (on) => {
      cfg.watchEnabled = !!on;
      persistConfig(["watchEnabled"]);
    },
    setGraphParticles: (on) => {
      cfg.graphParticles = !!on;
      if (NB.graph && NB.graph.setParticleField) NB.graph.setParticleField(cfg.graphParticles);
      persistConfig();
    },
    getGraphParticles: () => !!cfg.graphParticles,
    setSiteTitle: (title) => { applySiteTitle(title); persistConfig(); },
    getSiteTitle: () => cfg.siteTitle || "Notebook",
    setVimMode: (on) => {
      cfg.vimMode = !!on;
      if (NB.vimnav) NB.vimnav.setEnabled(cfg.vimMode);
      // VIM mode is the whole stack: the shell keymap (vimnav, above)
      // AND the editor's vim keymap (cm-bridge compartment). Toggling
      // the setting flips both so vim can be disabled completely.
      if (NB.cmEditor && NB.cmEditor.setVimMode) NB.cmEditor.setVimMode(cfg.vimMode);
      // VIM mode hides the edit toolbar; refresh it live so toggling the
      // setting while editing shows/hides the bar without a reload.
      if (NB.editbar && NB.editbar.refresh) NB.editbar.refresh();
      persistConfig();
    },
    // Replace the full shortcut override map (called by shortcuts.js
    // when the user changes a binding or hits "Reset all"). Live:
    // the shortcuts listener reads cfg.shortcuts on every keydown, so
    // the new bindings take effect on the next press.
    setShortcuts: (map) => {
      cfg.shortcuts = (map && typeof map === "object") ? { ...map } : {};
      persistConfig();
    },
    getVimMode: () => !!cfg.vimMode,
    // Autosave toggle (hybrid / WYSIWYG edit mode only). Flipping it
    // just persists the flag + emits config:changed; hybrid.js reads
    // cfg.autosave live via getCfg() on each keystroke, so no further
    // wiring is needed.
    setAutosave: (on) => {
      cfg.autosave = on !== false;
      persistConfig();
    },
    getAutosave: () => cfg.autosave !== false,
    // Idle seconds after the last interaction before WYSIWYG autosave
    // writes. Clamped so hand-edited config.json cannot disable it or
    // leave a note unsaved for hours.
    setAutosaveDelay: (seconds) => {
      cfg.autosaveDelay = clampAutosaveDelay(seconds);
      persistConfig();
    },
    getAutosaveDelay: () => clampAutosaveDelay(cfg.autosaveDelay),
    getWallpaperScroll: () => cfg.wallpaperScroll || "scroll",
    // Replace the full bookmark list. The bookmarks module is the only
    // caller on the user-mutation path; the config load path also
    // calls it, but that goes via NB.bookmarks.set directly
    // (applyConfig). Persists + emits config:changed so any listener
    // can react.
    setBookmarks: (list) => {
      cfg.bookmarks = Array.isArray(list) ? list.slice() : [];
      persistConfig();
    },
    // Replace the full pinned-folder list. The sidebar is the only
    // caller on the user-mutation path; the config load path goes via
    // NB.sidebar.setPinnedFolders directly (applyConfig). Persists +
    // emits config:changed so any listener can react.
    setPinnedFolders: (list) => {
      cfg.pinnedFolders = Array.isArray(list) ? list.slice() : [];
      persistConfig();
    },
    // Read the pinned-folder list (a copy) so callers can snapshot it
    // before a mutation or during a test.
    getPinnedFolders: () => (cfg.pinnedFolders || []).slice(),
    // Explorer top-section mode. The header toggle calls this; the value
    // is validated and persisted through the same debounced write path as
    // the other UI preferences.
    setExplorerTop: (mode) => {
      if (NB.sidebar && NB.sidebar.setExplorerTop) {
        NB.sidebar.setExplorerTop(mode);
        cfg.explorerTop = NB.sidebar.getExplorerTop();
      } else {
        cfg.explorerTop = DEFAULTS.explorerTop;
      }
      persistConfig();
    },
    getExplorerTop: () => cfg.explorerTop || DEFAULTS.explorerTop,
    // Update the user's vimrc. The Settings modal calls this on save;
    // applyConfig already pulls cfg.vimrc into the editor when the
    // view is created (and when setVimMode(true) re-creates the
    // plugin), so this method just persists. Re-apply is the modal's
    // responsibility (it can call NB.cmEditor.applyVimrc(text) to
    // surface parse errors before persisting).
    setVimrc: (text) => {
      cfg.vimrc = typeof text === "string" ? text : "";
      persistConfig();
    },
    getVimrc: () => cfg.vimrc || "",
    // Deep link: parse + apply `?file=...&heading=...` URLs.
    // parseDeepLink takes an optional URL string; openDeepLink takes
    // the {file, heading} object it returns. Exposed for tests.
    parseDeepLink,
    openDeepLink,
    save: () => persistConfig(),
    // Boot helpers. shellPanelState() reads the shell-painted panel back
    // from the DOM (used by the failed-fetch fallback); resolveBootView()
    // decides whether a successful fetch should switch the active view.
    // Exposed for tests.
    shellPanelState,
    resolveBootView,
  };
})();
