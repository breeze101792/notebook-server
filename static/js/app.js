/* app.js -- bootstrap: load config, wire everything together.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

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
    sidebarWidth: 240,
    outlineWidth: 220,
    sidebarCollapsed: false,
    outlineCollapsed: false,
    searchCaseSensitive: false,
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
    // Per-action keyboard bindings for the non-vim keymap. See
    // static/js/shortcuts.js for the chord format and the list of
    // actions. Missing keys fall back to that module's DEFAULTS,
    // so a fresh `{}` here means "use the shipped defaults".
    shortcuts: {},
  };

  // Width used while a sidebar is collapsed (a thin clickable strip).
  const COLLAPSED_W = 24;

  let cfg = { ...DEFAULTS };
  let saveTimer = null;

  const caseEl   = document.getElementById("search-case");
  const editBtn  = document.getElementById("edit-toggle");
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
  }
  if (themeMQ) {
    themeMQ.addEventListener("change", () => {
      if (cfg.theme === "auto") {
        const resolved = resolveTheme("auto");
        document.body.dataset.theme = resolved;
        applyHljsTheme(resolved);
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

    // tab set changed -> persist open files + active file + pinned files
    NB.evt.on("tabs:changed", ({ openFiles, activeFile, pinnedFiles }) => {
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

    // sidebar minimize (collapse / expand) for both sidebars
    document.getElementById("sidebar-collapse").addEventListener("click",
      () => { cfg.sidebarCollapsed = true; applySidebarState(); persistConfig(); });
    document.getElementById("sidebar-expand").addEventListener("click",
      () => { cfg.sidebarCollapsed = false; applySidebarState(); persistConfig(); });
    document.getElementById("outline-collapse").addEventListener("click",
      () => { cfg.outlineCollapsed = true; applyOutlineState(); persistConfig(); });
    document.getElementById("outline-expand").addEventListener("click",
      () => { cfg.outlineCollapsed = false; applyOutlineState(); persistConfig(); });

    // App-level keyboard shortcuts (active when VIM mode is off; see
    // static/js/shortcuts.js). The module owns the keydown listener
    // and the per-action chord (default + user override) lookup; we
    // just hand it the handler map. openSearch / openSettings are
    // new -- previously these had no app-level shortcut (only the
    // buttons). save was the lone Ctrl+S binding before; it now
    // lives here too so the user can rebind it.
    if (NB.shortcuts) {
      NB.shortcuts.install({
        save: () => NB.viewer.save(),
        openSearch: () => {
          const si = document.getElementById("search-input");
          if (si) { si.focus(); si.select(); }
        },
        toggleEdit: () => NB.viewer && NB.viewer.toggleEdit
          ? NB.viewer.toggleEdit() : null,
        openSettings: () => NB.settings && NB.settings.open
          ? NB.settings.open() : null,
      });
    }

    // Settings: the gear button opens a modal. The modal lives in its own
    // module (settings.js) and reads/writes the cfg through these hooks.
    document.getElementById("settings-btn").addEventListener("click",
      () => NB.settings && NB.settings.open());

    // resizable sidebars (drag the inner edge)
    setupResize("sidebar", "--sidebar-width", "right");
    setupResize("outline-pane", "--outline-width", "left");
  }

  function setupResize(id, cssVar, edge) {
    const pane = document.getElementById(id);
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
    pane.style.position = "relative";
    pane.appendChild(handle);

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      const w = pane.getBoundingClientRect().width;
      if (id === "sidebar") cfg.sidebarWidth = w;
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
      const w = Math.max(140, Math.min(520, startW + sign * dx));
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
    try { await NB.tabs.restore(openFiles, activeFile, fallback, pinnedFiles); }
    catch (e) { console.warn("restore tabs failed", e); }

    // Deep link: if the URL requested a specific file (and optional
    // heading), override the restored active tab with it. Runs AFTER
    // restore so session tabs are preserved in the background while
    // the deep-linked file becomes the visible view. Auth (if any)
    // reloads the page on success, so this code path is only reached
    // with a valid session.
    const deepLink = parseDeepLink();
    if (deepLink) {
      try {
        await openDeepLink(deepLink);
        // Strip the URL (replaceState, NOT push) so a refresh doesn't
        // re-apply the deep link and the back button doesn't see this
        // as a navigation. Boot is a fresh entry point, not a history
        // event. file:// / restricted env: harmless to skip.
        try { history.replaceState(null, "", window.location.pathname); }
        catch (_) {}
      } catch (e) { console.warn("deep link failed", e); }
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

  /* Tiny façade so other modules (settings.js) can read live config and
   * trigger a persist without reaching into our module-scoped state. */
  NB.app = {
    getCfg: () => cfg,
    setTheme: (pref) => { applyTheme(pref); persistConfig(); },
    setFontSize: (name) => { applyFontSize(name); persistConfig(); },
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
    setVimMode: (on) => {
      cfg.vimMode = !!on;
      if (NB.vimnav) NB.vimnav.setEnabled(cfg.vimMode);
      // VIM mode is the whole stack: the shell keymap (vimnav, above)
      // AND the editor's vim keymap (cm-bridge compartment). Toggling
      // the setting flips both so vim can be disabled completely.
      if (NB.cmEditor && NB.cmEditor.setVimMode) NB.cmEditor.setVimMode(cfg.vimMode);
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
    getWallpaperScroll: () => cfg.wallpaperScroll || "scroll",
    // Deep link: parse + apply `?file=...&heading=...` URLs.
    // parseDeepLink takes an optional URL string; openDeepLink takes
    // the {file, heading} object it returns. Exposed for tests.
    parseDeepLink,
    openDeepLink,
    save: () => persistConfig(),
  };
})();
