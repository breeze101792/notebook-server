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
  // Search sort values accepted from config and the panel (server order=).
  const SEARCH_SORTS = ["path", "mtime", "count"];
  // Side-panel search target: note content or file name (server name=1).
  const SEARCH_TARGETS = ["content", "name"];
  // Persisted graph renderer mode. "3d" is the default.
  const GRAPH_MODE_2D = "2d";
  const GRAPH_MODE_3D = "3d";
  // UI state that follows a workspace root rather than the whole app. On a
  // workspace page these live under `workspaceState.<id>` in /api/config and
  // are written through POST /api/workspace-state; the top-level copies are
  // the pre-workspace format and the fallback for a page without one.
  const WORKSPACE_STATE_KEYS = [
    "lastFile", "openFiles", "activeFile", "pinnedFiles", "sessions",
    "activeSessionId", "recentFiles", "bookmarks", "pinnedFolders",
  ];
  // The keys a poll may copy onto `cfg`. The rest of WORKSPACE_STATE_KEYS are
  // this device's hints and are never applied from a remote state.
  const WORKSPACE_SHARED_KEYS = [
    "sessions", "pinnedFiles", "bookmarks", "recentFiles", "pinnedFolders",
  ];
  // Views that exist only in the desktop shell. A saved active view naming
  // one of them must fall back on a phone, or the drawer would open onto a
  // hidden host. Sessions is a phone view hosted in the drawer; the AI
  // assistant and the Outline have no phone surface.
  const PHONE_HIDDEN_VIEWS = ["ai", "outline"];
  // Special tabs with no phone surface. Restoring a shared session may make
  // one active; the phone shows another tab or Home instead of that pane.
  const PHONE_HIDDEN_TABS = ["§graph", "§sessions"];
  // Retired single-panel config keys, migrated on read (secondary-sidebar.md
  // §6.3) and never re-posted. A read-merge-write copies every key the server
  // blob still holds, so the merge must drop these explicitly or the first
  // desktop save would keep them in the file forever.
  const LEGACY_CONFIG_KEYS = ["activeView", "outlineWidth", "outlineCollapsed"];
  // A write that carries one of these is a write from the current client and
  // may retire the legacy keys above. A phone keyed write carries none of
  // them, so it must leave the legacy keys alone: dropping them there would
  // delete the desktop's right-panel width without writing its replacement.
  const LEGACY_RETIRING_KEYS = ["auxPanelWidth", "auxPanelCollapsed",
                                "activeViewLeft", "activeViewRight",
                                "sidebarSide"];
  // Same debounce as the config write below.
  const WORKSPACE_SAVE_DELAY_MS = 250;
  // Cross-device sync: the poll interval while the tab is visible, and the
  // ceiling the delay doubles up to after repeated failures.
  const WORKSPACE_SYNC_MS = 3000;
  const WORKSPACE_SYNC_MAX_MS = 30000;
  // Device-local selection keys: the active session and the active tab belong
  // to one device, so they live in localStorage, not in the shared state. The
  // default workspace keeps the unprefixed name (table-view.js convention).
  const DEVICE_ACTIVE_SESSION_KEY = "activeSession";
  const DEVICE_ACTIVE_FILE_KEY = "activeFile";
  const DEFAULT_WORKSPACE_ID = "default";

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
    // Which rail hosts each view. A per-view map, not a list: a view the map
    // does not name keeps the registration default (only the Outline
    // defaults right), which distinguishes "the user put it left" from "this
    // view did not exist when the list was written". Edited live in
    // Settings -> Appearance -> Activity bar.
    sidebarSide: {},
    // The active view of each side. Persisted separately so a reload lands
    // each panel on the view the user left it on. The server renders these
    // views visible in the shell for first paint; boot reconciles the
    // once-fetched config against that paint, one side at a time.
    activeViewLeft: "explorer",
    activeViewRight: "outline",
    // Left activity-bar icon order (view ids). Empty means the shipped
    // registration order; a partial list keeps the named views first and
    // appends the rest. One global order over both rails; each rail shows
    // the subsequence it owns. Edited in Settings -> Appearance.
    sidebarOrder: [],
    // Activity-bar views whose icons are hidden. The Settings list still
    // shows every view so this is reversible; the order above is kept and
    // so is the view's side.
    sidebarHidden: [],
    sidebarWidth: 240,
    sidebarCollapsed: false,
    // The auxiliary panel on the right, the #side-panel's twin. Its width and
    // collapsed flag are its own; no state is shared between the sides.
    auxPanelWidth: 240,
    auxPanelCollapsed: false,
    searchCaseSensitive: false,
    // Side-panel search only: one row per note (unique=1) is the default
    // because the panel's job is finding the note, not every hit.
    searchUnique: true,
    // Side-panel search order: "path" | "mtime" | "count" (server order=).
    searchSort: "path",
    // Side-panel search target: "content" searches note bodies, "name"
    // matches the file basename (server name=1).
    searchTarget: "content",
    // Ambient background particle drift in the graph view (neural
    // "network" feel). Off by default so it doesn't distract while
    // reading the graph; toggle in Settings -> Appearance.
    graphParticles: false,
    // Graph renderer: "3d" (the orbit view) or "2d" (the neural view).
    // Persisted so the graph tab reopens in the mode the user chose.
    graphMode: GRAPH_MODE_3D,
    // Hide the top bar (brand, search, actions). Toggled live from the
    // Appearance settings tab or the Ctrl+Shift+T shortcut. When on,
    // body gets .topbar-hidden and --topbar-h collapses to 0 so the
    // layout heights stay correct.
    hideTopbar: false,
    // Hide the file tab strip. The state is the `hidden` attribute on
    // #tab-bar (the server paints it on the first frame) plus
    // .tab-bar[hidden]; the reader gains the bar's 34 px. Toggled from
    // Appearance or Mod+Shift+B.
    hideTabBar: false,
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
    // explorerTopHeight is deliberately absent: no value means the section
    // keeps its content height under the 30 vh cap, exactly as before the
    // splitter existed. The splitter writes it once the user drags or keys
    // one, and its reset deletes it (docs/ui/side-panel-views.md §2.13).
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
    // The app's en_US spellcheck in hybrid mode: the misspelling
    // underline and the right-click Spelling block. Off also keeps the
    // browser's own spellcheck off on the editing surface, because the
    // app owns the feature (docs/architecture/spellcheck.md).
    spellcheck: true,
    // Personal words added from the Spelling block, lower-cased and
    // deduped. Normalised on read and on write below.
    spellcheckWords: [],
  };

  // Personal dictionary limits: refuse a word longer than the module's
  // token limit and keep the newest entries, so a hand-edited config
  // cannot grow the list without bound.
  const SPELL_WORD_MAX_CHARS = 64;
  const SPELL_WORD_MAX_ENTRIES = 1000;
  // The same token rule spellcheck.js and the dictionary use; a word
  // carrying anything else can never be matched to prose.
  const SPELL_WORD_RE = /^[A-Za-z][A-Za-z'\u2019\-]*[A-Za-z]$/;
  const CURLY_APOSTROPHE_RE = /\u2019/g;

  function clampAutosaveDelay(seconds) {
    const n = Math.round(Number(seconds));
    if (!Number.isFinite(n)) return AUTOSAVE_DELAY_DEFAULT_S;
    return Math.min(AUTOSAVE_DELAY_MAX_S, Math.max(AUTOSAVE_DELAY_MIN_S, n));
  }

  // Keep only unique view-id strings; anything else in a hand-edited
  // config is dropped, and the next write persists the clean list.
  function normalizeViewIdList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const id of list) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  /* Keep only registered view ids whose saved side is "left" or "right".
   * Anything else in a hand-edited config is dropped, and the next write
   * persists the clean object. */
  function normalizeSideMap(map) {
    const out = {};
    if (!map || typeof map !== "object" || Array.isArray(map)) return out;
    const known = (NB.activity && NB.activity.views) ? NB.activity.views() : null;
    for (const id of Object.keys(map)) {
      if (known && known.indexOf(id) < 0) continue;
      const side = map[id];
      if (side === "left" || side === "right") out[id] = side;
    }
    return out;
  }

  /* The personal spelling list, in the shape every reader expects: strings
   * only, trimmed, lower-cased, curly apostrophes folded, deduped in first-
   * seen order, and capped at the newest entries. A hand-edited config is
   * normalised on read, so the next write persists the clean list. */
  function normalizeSpellcheckWords(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of list) {
      if (typeof entry !== "string") continue;
      const word = entry.trim().replace(CURLY_APOSTROPHE_RE, "'").toLowerCase();
      if (!word || word.length > SPELL_WORD_MAX_CHARS) continue;
      if (!SPELL_WORD_RE.test(word)) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
    return out.slice(-SPELL_WORD_MAX_ENTRIES);
  }

  // Width used while a panel is collapsed. 0 -- the rail icons are the
  // re-expand affordance, so a panel hides completely instead of leaving a
  // thin strip.
  const PANEL_COLLAPSED_W = 0;
  // Default width of either panel. One value for both sides: the panels are
  // the same size at rest and each remembers its own dragged width.
  const DEFAULT_PANE_W = 240;
  // The CSS track caps (#layout in style.css) expressed in JS. The resize
  // handle must stop where the track clamps, or it drags past the point the
  // grid will paint: reader floor 352, one rail 48 each side, panel cap
  // 480, each panel's share of the budget 45 %.
  const SHELL_READER_MIN = 352;
  const SHELL_RAIL_W = 48;
  const SHELL_PANE_MAX = 480;
  const SHELL_PANE_MIN = 140;
  const SHELL_PANE_SHARE = 0.45;

  // Explorer's top-section splitter (docs/ui/side-panel-views.md §2.13).
  // Fallbacks only: the live bounds are read from the tokens on #sidebar, so
  // the CSS and the JS clamp cannot drift. The ceiling mirrors the server's.
  const EXPLORER_TOP_MIN_H = 56;
  const EXPLORER_TREE_MIN_H = 120;
  const EXPLORER_TOP_MAX_H = 2000;
  // Arrow-key steps on the splitter: one space step, one large step.
  const EXPLORER_TOP_STEP = 8;
  const EXPLORER_TOP_STEP_LARGE = 32;

  function paneMax() {
    const budget = window.innerWidth - 2 * SHELL_RAIL_W - SHELL_READER_MIN;
    const cap = Math.min(SHELL_PANE_MAX, SHELL_PANE_SHARE * budget);
    return Math.max(SHELL_PANE_MIN, cap);
  }

  let cfg = { ...DEFAULTS };
  // True while applyConfig() is re-homing views from the loaded side map:
  // the activation events that causes must not echo back as a config write.
  let applyingConfig = false;
  let saveTimer = null;
  let pendingConfigKeys = new Set();
  // One serial GET->POST chain for phone config writes. Overlapping
  // flushes would otherwise each read the same old blob and clobber the
  // other's key.
  let configFlushQueue = Promise.resolve();
  // Per-workspace state has its own debounce: it goes to its own endpoint
  // and must not be dragged into the global blob write.
  let wsSaveTimer = null;
  // Cross-device sync state. `wsRev` is the last rev the server reported for
  // this workspace and `wsRevKnown` whether it came from the server at all;
  // `lastServerState` is the base of the next write and `lastAckKey` the key
  // of the state the server acknowledged. `wsBootLoaded` gates both the write
  // and the poll: before a successful /api/config fetch there is no base.
  let wsRev = 0;
  let wsRevKnown = false;
  let wsBootLoaded = false;
  let lastAckKey = "";
  let lastServerState = null;
  let wsSyncDelay = WORKSPACE_SYNC_MS;
  let wsSyncTimer = null;
  // A page restored into a background tab must not poll before its first
  // visibilitychange. `visibilityState`, not `hidden`, because jsdom reports
  // hidden=true by default while its state is "prerender".
  let wsSyncPaused = !!(typeof document !== "undefined" &&
    document.visibilityState === "hidden");
  let wsSyncing = false;
  let wsSyncRunning = false;
  let wsLastAt = 0;
  let wsLastError = null;
  let wsStartToken = 0;
  let wsWritesOutstanding = 0;   // queued or in flight; a counter, not a flag
  // Adoptions are serialised through one chain: a poll response and a write
  // response can arrive together, and two interleaved rebuilds would each see
  // the other's intermediate model.
  let remoteApplyChain = Promise.resolve();
  let applyingRemote = false;

  // Role painted by the shell on <html data-role>. NB.pageRole normalises
  // the auth-off install (no session role, but full access) and an older
  // shell (no attribute at all). "viewer" and the empty role may not call
  // the admin-only routes.
  function pageRole() {
    return NB.pageRole ? NB.pageRole() : "admin";
  }

  function canAdminWrite() {
    return pageRole() === "admin";
  }

  function workspaceId() {
    return (NB.workspaceId && NB.workspaceId()) || "";
  }

  function workspaceStateSnapshot() {
    const out = {};
    for (const key of WORKSPACE_STATE_KEYS) out[key] = cfg[key];
    return out;
  }

  // Phone mode is decided by CSS (--ui-mode) and mirrored by mobile.js.
  function isPhoneMode() {
    return !!(NB.mobile && NB.mobile.isOn && NB.mobile.isOn());
  }

  const editBtn  = document.getElementById("edit-toggle");
  // The two side panels. #side-panel hosts the left active view, #aux-panel
  // the right one; resize + collapse operate on the panel, not the view, so
  // every activity view on a side shares that side's width.
  const sidePanelEl = document.getElementById("side-panel");
  const auxPanelEl = document.getElementById("aux-panel");

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
  // The wallpaper is painted on the element that owns its motion:
  //   "scroll" -> #viewer-content (the page). The pattern is part of the
  //               page, so it travels with the words -- including the
  //               elastic overscroll, which moves the page but not the
  //               clamped scroll offset.
  //   "fixed"  -> #viewer-scroll (the scrollport). The pattern is anchored
  //               to the scrollport, so the page moves over it.
  // The wallpaper-* classes move between the two hosts when the mode
  // changes. The class is always set (even when off) so the default state is
  // explicit and the CSS can grow more variants later without JS changes.
  //
  // Three independent settings:
  //   wallpaper  -> pattern (none / lines / grid)
  //   wallpaperColor    -> stroke color (neutral / blue / green / purple / amber)
  //   wallpaperIntensity-> stroke alpha (subtle / medium / bold)
  //   wallpaperScroll   -> pattern host (scroll / fixed)
  // The CSS variables --wp-rgb and --wp-a drive the actual paint, so the
  // color and intensity classes are just one-line variable overrides.
  const WALLPAPERS = ["none", "lines", "grid"];
  const WALLPAPER_COLORS = ["neutral", "blue", "green", "purple", "amber"];
  const WALLPAPER_INTENSITIES = ["subtle", "medium", "bold"];
  const WALLPAPER_SCROLL = ["scroll", "fixed"];
  const WALLPAPER_PREFIX = "wallpaper-";
  const viewerPageEl = document.getElementById("viewer-content");
  const viewerScrollEl = document.getElementById("viewer-scroll");
  function wallpaperHost() {
    return (cfg.wallpaperScroll === "fixed" && viewerScrollEl)
      ? viewerScrollEl
      : viewerPageEl;
  }
  function wallpaperClassList() {
    const classes = [
      "wallpaper-" + cfg.wallpaper,
      "wallpaper-intensity-" + cfg.wallpaperIntensity,
    ];
    if (cfg.wallpaperColor !== "neutral") {
      classes.push("wallpaper-color-" + cfg.wallpaperColor);
    }
    if (cfg.wallpaperScroll === "fixed") classes.push("wallpaper-fixed");
    return classes;
  }
  // Move the whole wallpaper-* set to the host for the current mode.
  // Clearing both first guarantees only one host ever paints a pattern.
  function syncWallpaperClasses() {
    for (const el of [viewerPageEl, viewerScrollEl]) {
      if (!el) continue;
      for (const name of Array.from(el.classList)) {
        if (name.indexOf(WALLPAPER_PREFIX) === 0) el.classList.remove(name);
      }
    }
    const host = wallpaperHost();
    if (host) host.classList.add(...wallpaperClassList());
  }
  function applyWallpaper(name) {
    cfg.wallpaper = WALLPAPERS.indexOf(name) >= 0 ? name : "none";
    syncWallpaperClasses();
  }
  function applyWallpaperColor(name) {
    // "neutral" is the absence of a color modifier (the CSS default is
    // white-in-dark / black-in-light, set by body[data-theme]).
    cfg.wallpaperColor = WALLPAPER_COLORS.indexOf(name) >= 0 ? name : "neutral";
    syncWallpaperClasses();
  }
  function applyWallpaperIntensity(name) {
    cfg.wallpaperIntensity = WALLPAPER_INTENSITIES.indexOf(name) >= 0 ? name : "subtle";
    syncWallpaperClasses();
  }
  function applyWallpaperScroll(mode) {
    cfg.wallpaperScroll = WALLPAPER_SCROLL.indexOf(mode) >= 0 ? mode : "scroll";
    syncWallpaperClasses();
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
  // The tab strip is hidden with an attribute, never a body class: its
  // display:flex outranks the UA [hidden] rule, so style.css adds
  // .tab-bar[hidden], and body:has(#tab-bar[hidden]) shows the rail's outline
  // twin. Nothing measures the bar, so the reader simply gains 34 px.
  function applyTabBar(hide) {
    cfg.hideTabBar = !!hide;
    const bar = document.getElementById("tab-bar");
    if (!bar) return;
    bar.hidden = cfg.hideTabBar;
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
  /* `serverFetched` says whether `c` is the body of a successful
   * GET /api/config. The failed-fetch path passes {} and false, so the sync
   * loop stays off: without a base a write could only guess.
   *
   * The legacy single-panel keys (`activeView`, `outlineWidth`,
   * `outlineCollapsed`) are migrated here once and then deleted from the
   * loaded object, so the next whole-blob POST drops them from the file
   * (secondary-sidebar.md §6.3). They are absent from DEFAULTS for the same
   * reason: while any writer still re-added them, every save would re-post
   * the old keys. */
  function applyConfig(c, serverFetched) {
    const fetched = (serverFetched === undefined)
      ? (!!c && typeof c === "object") : !!serverFetched;
    const loaded = (c && typeof c === "object") ? c : {};
    if (loaded.activeViewLeft === undefined &&
        typeof loaded.activeView === "string") {
      loaded.activeViewLeft = loaded.activeView;
    }
    if (loaded.auxPanelWidth === undefined &&
        typeof loaded.outlineWidth === "number") {
      loaded.auxPanelWidth = loaded.outlineWidth;
    }
    if (loaded.auxPanelCollapsed === undefined &&
        typeof loaded.outlineCollapsed === "boolean") {
      loaded.auxPanelCollapsed = loaded.outlineCollapsed;
    }
    for (const key of LEGACY_CONFIG_KEYS) delete loaded[key];
    cfg = { ...DEFAULTS, ...loaded };
    // Overlay the active workspace's state. Missing fields fall back to the
    // legacy top-level copy already spread above, so the first load after
    // the server migrates an old config shows the same session.
    const wsId = workspaceId();
    if (wsId && c && c.workspaceState && typeof c.workspaceState === "object") {
      const state = c.workspaceState[wsId];
      if (state && typeof state === "object") {
        for (const key of WORKSPACE_STATE_KEYS) {
          if (state[key] !== undefined) cfg[key] = state[key];
        }
      }
    }
    // Seed the cross-device sync from the same payload, before any write:
    // `lastAckKey` is the baseline for the dirty check, so boot does not
    // immediately rewrite the state the server just sent, and
    // `lastServerState` is the base the next write is merged against.
    const stateMap = (c && typeof c.workspaceState === "object") ? c.workspaceState : null;
    const revMap = (c && typeof c.workspaceStateRev === "object") ? c.workspaceStateRev : null;
    const bootState = (stateMap && wsId && typeof stateMap[wsId] === "object")
      ? stateMap[wsId] : {};
    lastServerState = bootState;
    lastAckKey = stateKey(bootState);
    wsRev = (revMap && wsId && Number.isInteger(revMap[wsId])) ? revMap[wsId] : 0;
    wsRevKnown = !!(revMap && wsId && Number.isInteger(revMap[wsId]));
    wsBootLoaded = fetched;
    applyTheme(cfg.theme || "auto");
    applyFontSize(cfg.fontSize || "medium");
    applySettingsModalWidth(cfg.settingsModalWidth || "medium");
    applySettingsModalHeight(cfg.settingsModalHeight || "medium");
    applyWallpaper(cfg.wallpaper || "none");
    applyWallpaperColor(cfg.wallpaperColor || "neutral");
    applyWallpaperIntensity(cfg.wallpaperIntensity || "subtle");
    applyWallpaperScroll(cfg.wallpaperScroll || "scroll");
    applyTopbar(!!cfg.hideTopbar);
    applyTabBar(!!cfg.hideTabBar);
    applySiteTitle(cfg.siteTitle || "Notebook");
    // Hand-edited config values are normalised here so every reader sees a
    // known shape; the normalised value is what the next write persists.
    cfg.searchUnique = (typeof cfg.searchUnique === "boolean")
      ? cfg.searchUnique : DEFAULTS.searchUnique;
    cfg.searchSort = SEARCH_SORTS.indexOf(cfg.searchSort) >= 0
      ? cfg.searchSort : DEFAULTS.searchSort;
    cfg.searchTarget = SEARCH_TARGETS.indexOf(cfg.searchTarget) >= 0
      ? cfg.searchTarget : DEFAULTS.searchTarget;
    cfg.sidebarSide = normalizeSideMap(cfg.sidebarSide);
    cfg.sidebarOrder = normalizeViewIdList(cfg.sidebarOrder);
    cfg.sidebarHidden = normalizeViewIdList(cfg.sidebarHidden);
    cfg.spellcheck = (typeof cfg.spellcheck === "boolean")
      ? cfg.spellcheck : DEFAULTS.spellcheck;
    cfg.spellcheckWords = normalizeSpellcheckWords(cfg.spellcheckWords);
    // Re-home only the views whose saved side differs from the one the shell
    // already has: setSide() moves the host node, which is not free, and it
    // must never run for every view on a boot that already agrees. The
    // activation events this causes must not echo back as a config write.
    if (NB.activity && NB.activity.setSide && NB.activity.sideOf) {
      applyingConfig = true;
      try {
        for (const id of Object.keys(cfg.sidebarSide)) {
          if (NB.activity.sideOf(id) !== cfg.sidebarSide[id]) {
            NB.activity.setSide(id, cfg.sidebarSide[id]);
          }
        }
      } finally {
        applyingConfig = false;
      }
    }
    if (NB.activity && NB.activity.setBarOrder) {
      NB.activity.setBarOrder(cfg.sidebarOrder);
    }
    if (NB.activity && NB.activity.setHidden) {
      NB.activity.setHidden(cfg.sidebarHidden);
    }
    applySidebarState();
    applyAuxState();
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
    // The saved split height, if the splitter has ever been dragged. Runs
    // before config:changed so the section is painted at its saved height
    // when the first list arrives.
    applyExplorerTopHeight();
    // A view can mount before the async config fetch resolves (Search can
    // be the saved view). Mark this as the load-time signal so the panel can
    // sync its controls without undoing a change the user made meanwhile.
    NB.evt.emit("config:changed", cfg, { loaded: true });
  }

  /* Side panel minimise: apply the saved width and collapsed flag from the
   * persisted config. NB.activity owns the rail highlighting and the
   * activate/toggle-on-click behavior; this function just paints the state on
   * boot and after a mode flip. The live toggle goes through the rail icon ->
   * NB.activity.activate(id, true) -> collapse()/expand() and is persisted by
   * the listeners below. */
  function applySidebarState() {
    if (isPhoneMode() || !sidePanelEl) return;
    if (cfg.sidebarCollapsed) {
      document.documentElement.style.setProperty("--side-panel-width", PANEL_COLLAPSED_W + "px");
      sidePanelEl.classList.add("collapsed");
    } else {
      document.documentElement.style.setProperty("--side-panel-width", (cfg.sidebarWidth || DEFAULT_PANE_W) + "px");
      sidePanelEl.classList.remove("collapsed");
    }
  }
  /* The right panel's half of the same state. It has its own width var and its
   * own collapsed flag; nothing is shared with the left panel. */
  function applyAuxState() {
    // A stale shell (a cached page from before the two-panel release) has no
    // #aux-panel; painting nothing beats throwing inside boot.
    if (isPhoneMode() || !auxPanelEl) return;
    if (cfg.auxPanelCollapsed) {
      document.documentElement.style.setProperty("--aux-panel-width", PANEL_COLLAPSED_W + "px");
      auxPanelEl.classList.add("collapsed");
    } else {
      document.documentElement.style.setProperty("--aux-panel-width", (cfg.auxPanelWidth || DEFAULT_PANE_W) + "px");
      auxPanelEl.classList.remove("collapsed");
    }
  }

  /* Explorer's top-section split. Absent or invalid means auto: the section
   * keeps its content height under the 30 vh cap, exactly as before the
   * splitter existed. A saved value becomes the fixed height. */
  function applyExplorerTopHeight() {
    const raw = cfg.explorerTopHeight;
    const n = Number(raw);
    // Unset means auto. A numeric value is clamped the way the server clamps
    // it, so the shell paint and this function cannot disagree: a
    // hand-edited 1 or -5 pins the floor instead of snapping back to auto.
    if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) {
      delete cfg.explorerTopHeight;
      document.documentElement.style.removeProperty("--explorer-top-height");
    } else {
      const h = Math.min(EXPLORER_TOP_MAX_H,
        Math.max(EXPLORER_TOP_MIN_H, Math.round(n)));
      cfg.explorerTopHeight = h;
      document.documentElement.style.setProperty("--explorer-top-height", h + "px");
    }
    updateExplorerTopAria();
  }

  /* The inline host that is currently visible, or null when the mode is
   * None or its list is empty. */
  function explorerTopHost() {
    const pins = document.getElementById("pinned-folders");
    if (pins && !pins.hidden) return pins;
    const marks = document.getElementById("explorer-bookmarks");
    if (marks && !marks.hidden) return marks;
    return null;
  }

  function explorerTopToken(pane, name, fallback) {
    const raw = getComputedStyle(pane).getPropertyValue(name);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function explorerTopMin(pane) {
    return explorerTopToken(pane, "--explorer-top-min", EXPLORER_TOP_MIN_H);
  }

  /* The largest section height that still leaves the tree its floor. Read
   * from the rendered header and strip, so it matches the CSS reserve. */
  function explorerTopMax(pane) {
    const header = pane.querySelector(".panel-header");
    const strip = document.getElementById("explorer-top-resize");
    const treeMin = explorerTopToken(pane, "--explorer-tree-min", EXPLORER_TREE_MIN_H);
    const reserve = (header ? header.offsetHeight : 0)
      + (strip ? strip.offsetHeight : 0) + treeMin;
    return Math.min(EXPLORER_TOP_MAX_H,
      Math.max(explorerTopMin(pane), pane.clientHeight - reserve));
  }

  function updateExplorerTopAria() {
    const handle = document.getElementById("explorer-top-resize");
    const pane = document.getElementById("sidebar");
    if (!handle || !pane) return;
    const min = explorerTopMin(pane);
    const max = explorerTopMax(pane);
    const host = explorerTopHost();
    // The host reads 0 while its view is hidden or the panel is collapsed;
    // keep the announced value inside the separator's own range.
    const now = Math.min(max, Math.max(min,
      host ? host.getBoundingClientRect().height : min));
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(now)));
    handle.setAttribute("aria-valuetext", Math.round(now) + " px");
  }

  /* Pointer, keyboard and reset for the Explorer splitter. It never resizes
   * the panel itself: only the inline top slot above the tree. */
  function setupExplorerTopResize() {
    const handle = document.getElementById("explorer-top-resize");
    const pane = document.getElementById("sidebar");
    if (!handle || !pane || handle.dataset.wired === "1") return;
    handle.dataset.wired = "1";
    let dragging = false, startY = 0, startH = 0, height = 0, moved = false;

    const clamp = (h) => Math.max(explorerTopMin(pane),
      Math.min(explorerTopMax(pane), h));

    function setHeight(h) {
      height = Math.round(clamp(h));
      document.documentElement.style.setProperty("--explorer-top-height", height + "px");
      updateExplorerTopAria();
    }

    function visibleHeight() {
      const host = explorerTopHost();
      return host ? host.getBoundingClientRect().height : explorerTopMin(pane);
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing", "resizing-v");
      // A plain click on the strip is not a resize: keep the auto height.
      if (!moved) return;
      cfg.explorerTopHeight = height;
      persistConfig(["explorerTopHeight"]);
    }

    /* Fit and auto are session states, not widths: the saved height is
     * cleared, and a second toggle returns to the capped auto. The key must
     * be named because the workspace merge only deletes keys the caller
     * lists; a keyless save would keep the old height on disk. */
    function toggleFit() {
      delete cfg.explorerTopHeight;
      document.documentElement.style.removeProperty("--explorer-top-height");
      const on = !pane.dataset.explorerTopFit;
      if (on) pane.dataset.explorerTopFit = "1";
      else delete pane.dataset.explorerTopFit;
      persistConfig(["explorerTopHeight"]);
      updateExplorerTopAria();
    }

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const host = explorerTopHost();
      if (!host) return;
      dragging = true;
      startY = e.clientY;
      startH = host.getBoundingClientRect().height;
      height = Math.round(clamp(startH));
      moved = false;
      handle.classList.add("dragging");
      document.body.classList.add("resizing", "resizing-v");
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      // The section sits above the tree, so a downward drag grows it.
      // A press with no movement is a click, not a resize: it must not
      // convert the auto height into a fixed one.
      if (e.clientY === startY) return;
      // If the active list emptied mid-drag the strip is display:none; the
      // gesture is over, and the last height still lands in the config.
      if (!explorerTopHost()) { endDrag(); return; }
      moved = true;
      // A real drag takes over from a fit: the section becomes a fixed height.
      delete pane.dataset.explorerTopFit;
      setHeight(startH + (e.clientY - startY));
    });
    document.addEventListener("mouseup", endDrag);
    // Recover from a drag abandoned off-window or in a hidden tab.
    window.addEventListener("blur", endDrag);
    document.addEventListener("visibilitychange", () => { if (document.hidden) endDrag(); });

    handle.addEventListener("dblclick", (e) => { e.preventDefault(); toggleFit(); });
    handle.addEventListener("keydown", (e) => {
      // Chrome shortcuts and window chords keep their own meaning.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? EXPLORER_TOP_STEP_LARGE : EXPLORER_TOP_STEP;
      if (e.key === "ArrowDown") setHeight(visibleHeight() + step);
      else if (e.key === "ArrowUp") setHeight(visibleHeight() - step);
      else if (e.key === "Home") setHeight(explorerTopMin(pane));
      else if (e.key === "End") setHeight(explorerTopMax(pane));
      else if (e.key === "Enter") { e.preventDefault(); toggleFit(); return; }
      else return;
      e.preventDefault();
      e.stopPropagation();
      cfg.explorerTopHeight = height;
      persistConfig(["explorerTopHeight"]);
    });
    handle.addEventListener("focus", updateExplorerTopAria);
    window.addEventListener("resize", updateExplorerTopAria);
    updateExplorerTopAria();
  }

  /* Persist config. `keys` names the only keys a caller may change.
   *
   * A named key that `cfg` no longer carries is deleted from the stored blob
   * (the workspace merge drops only named keys). A keyless call merges every
   * key `cfg` currently holds and therefore cannot delete one.
   *
   * Desktop posts the whole blob; a workspace page reads the current blob
   * first and merges, so the per-workspace state map survives. On a phone a
   * keyless call is a no-op (nothing is safe to write from the phone shell),
   * and a keyed call does a read-merge-write: fetch the current server blob,
   * copy the named keys from cfg, then POST the complete merged object. The
   * POST replaces the file verbatim, so a partial body would drop every
   * other key the desktop owns (open tabs, pane widths, ...).
   *
   * On a workspace page the workspace-owned keys never enter that blob:
   * they are posted to /api/workspace-state under the active id instead.
   * The global write still carries workspaceState, because POST /api/config
   * replaces the file verbatim; it is merged over a fresh read so other
   * workspaces' state is preserved. */
  function persistConfig(keys) {
    clearTimeout(saveTimer);
    if (Array.isArray(keys)) keys.forEach(k => pendingConfigKeys.add(k));
    saveTimer = setTimeout(flushConfig, 250);
    scheduleWorkspaceState();
  }

  function scheduleWorkspaceState() {
    if (!workspaceId()) return;
    // /api/workspace-state is admin-only. A viewer or the unauthenticated
    // shell must not queue a write that can only be refused, and must not
    // mark the state dirty: the server copy is authoritative and unchanged.
    if (!canAdminWrite()) return;
    // No write before boot: a failed /api/config fetch has no base, and
    // posting DEFAULTS would overwrite the server's state.
    if (!wsBootLoaded) return;
    if (stateKey(workspaceStateSnapshot()) === lastAckKey) return;
    clearTimeout(wsSaveTimer);
    wsSaveTimer = setTimeout(flushWorkspaceState, WORKSPACE_SAVE_DELAY_MS);
  }

  /* Send the state as it is now, with the state the server last acknowledged
   * as the base; the server merges a stale write and answers with what it now
   * holds. The response is applied, never re-posted: a merge that changed
   * another session converges through applyRemoteWorkspaceState. */
  function flushWorkspaceState() {
    wsSaveTimer = null;
    const id = workspaceId();
    if (!id || !canAdminWrite() || !wsBootLoaded) return Promise.resolve();
    const state = workspaceStateSnapshot();
    const key = stateKey(state);
    if (key === lastAckKey) return Promise.resolve();
    const base = lastServerState || {};
    // Move the ack to what is being sent, so an unrelated later save (theme,
    // pane width) does not post this same state again. A failed write puts
    // the old key back and the state stays dirty.
    const previousAck = lastAckKey;
    lastAckKey = key;
    wsWritesOutstanding++;
    const run = () => NB.api.saveWorkspaceState(id, state, base).then(async (res) => {
      if (!res || typeof res.rev !== "number") return;
      // A poll that started later may already have applied a newer state;
      // adopting this older one would regress the revision and drop tabs.
      if (wsRevKnown && res.rev < wsRev) return;
      wsLastError = null;
      // A local change landed while this write was in flight. Applying the
      // response would erase it, so keep the local model and let the pending
      // write publish it; the server's state becomes the next base.
      lastServerState = res.state || {};
      wsRev = res.rev;
      wsRevKnown = true;
      if (stateKey(workspaceStateSnapshot()) !== key) {
        lastAckKey = stateKey(lastServerState);
        return;
      }
      await applyRemoteWorkspaceState(res.state || {});
    }).catch((e) => {
      if (lastAckKey === key) lastAckKey = previousAck;
      wsLastError = e;
      console.warn("workspace state save failed", e);
    }).then(() => {
      wsWritesOutstanding = Math.max(0, wsWritesOutstanding - 1);
    });
    // Same serial chain as the config write: two writes must not overlap, or
    // their responses can land out of order and move `lastServerState` back.
    configFlushQueue = configFlushQueue.then(run, run);
    return configFlushQueue;
  }

  /* --- cross-device sync -------------------------------------------- */
  /* A client never merges: it polls the versioned read with the rev it has,
   * writes its own state with the base it started from, and adopts whatever
   * the server answers. The loop is a setTimeout chain, not an interval, so a
   * slow response never stacks requests. */

  /* The dirty check: the whole state, in a fixed key order, so key order and
   * absent keys cannot produce a false diff. */
  function stateKey(s) {
    const out = {};
    for (const k of WORKSPACE_STATE_KEYS) out[k] = (s || {})[k];
    return JSON.stringify(out);
  }

  /* The narrower fingerprint: the keys a peer's write changes on screen. It
   * drops the device-local hints and the per-session `activeFile`, so a peer
   * clicking a tab does no work here. */
  function syncProjection(s) {
    const src = (s && Array.isArray(s.sessions)) ? s.sessions : [];
    const list = (v) => (Array.isArray(v) ? v : []);
    return JSON.stringify({
      pinnedFiles: list(s && s.pinnedFiles),
      bookmarks: list(s && s.bookmarks),
      recentFiles: list(s && s.recentFiles),
      pinnedFolders: list(s && s.pinnedFolders),
      sessions: src.map(x => [x && x.id, x && x.name, (x && x.openFiles) || []]),
    });
  }

  /* Adopt a state the server returned, for both a poll response and the state
   * a POST returns, so a merge result takes exactly one path. Copies the
   * shared keys only: `openFiles`, `activeFile`, `lastFile` and
   * `activeSessionId` are this device's hints, and publishing a peer's would
   * move this reader. Deliberately does not call applyConfig, which would
   * re-run applyTheme, applyFontSize and mermaid.reinit. */
  function applyRemoteWorkspaceState(state) {
    const run = () => adoptRemoteWorkspaceState(state);
    remoteApplyChain = remoteApplyChain.then(run, run);
    return remoteApplyChain;
  }

  async function adoptRemoteWorkspaceState(state) {
    const next = (state && typeof state === "object") ? state : {};
    // Nothing changed on screen. Keep the base current but leave the ack key
    // alone: recomputing it from a peer's `activeFile` would make the next
    // save look dirty and echo it back.
    if (syncProjection(next) === syncProjection(cfg)) {
      lastServerState = next;
      return;
    }
    for (const key of WORKSPACE_SHARED_KEYS) {
      cfg[key] = Array.isArray(next[key]) ? next[key] : [];
    }
    lastServerState = next;
    // The key of the state as just adopted, before the model is rebuilt: a
    // rebuild that could not take the server's copy verbatim rewrites it and
    // schedules exactly one republish below.
    lastAckKey = stateKey(workspaceStateSnapshot());
    applyingRemote = true;
    try {
      if (NB.tabs && NB.tabs.applyRemoteState) {
        const tree = (NB.sidebar && NB.sidebar.getTree) ? NB.sidebar.getTree() : [];
        await NB.tabs.applyRemoteState({
          sessions: cfg.sessions,
          pinnedFiles: cfg.pinnedFiles,
          // An empty tree means "not loaded yet", never "every path is gone":
          // filtering against it would drop a whole workspace from one failed
          // /api/tree and then republish the erasure.
          known: (p) => isSpecialTab(p) || !tree.length || treeHas(tree, p),
        });
      }
    } finally {
      applyingRemote = false;
    }
    // The tab model is the truth for what is open here, so rebuild the two
    // keys it owns; the dirty check decides whether one republish is due.
    if (NB.tabs && NB.tabs.snapshot) {
      const open = NB.tabs.getOpen ? NB.tabs.getOpen() : [];
      cfg.sessions = NB.tabs.snapshot();
      cfg.pinnedFiles = open.filter(p => NB.tabs.isPinned && NB.tabs.isPinned(p));
    }
    scheduleWorkspaceState();
    if (NB.bookmarks && NB.bookmarks.set) NB.bookmarks.set(cfg.bookmarks || []);
    if (NB.sidebar && NB.sidebar.setPinnedFolders) {
      NB.sidebar.setPinnedFolders(cfg.pinnedFolders || []);
    }
    NB.evt.emit("config:changed", cfg, { remote: true });
  }

  /* One pass. `unsupported` is the answer to a server without the endpoint,
   * so the caller stops instead of asking again every interval. `force` is
   * the phone's single catch-up read on return: the phone still arms no
   * timer, but a page kept alive in the background must not stay stale
   * (sessions.md §17.4, AC73). */
  async function syncOnce(force) {
    if (!workspaceId() || !wsBootLoaded || wsSyncPaused || wsSyncing) {
      return { ok: true, rev: wsRev };
    }
    if (isPhoneMode() && !force) return { ok: true, rev: wsRev };
    // A queued or in-flight local write answers with the merged state;
    // polling now would apply the server's copy over an unsent change.
    if (wsSaveTimer !== null || wsWritesOutstanding > 0) return { ok: true, rev: wsRev };
    wsSyncing = true;
    // What the page held when the request left. If it moved on, the response
    // is older than the local state and must not be applied over it.
    const localKey = stateKey(workspaceStateSnapshot());
    try {
      const res = await NB.api.getWorkspaceState(
        workspaceId(), wsRevKnown ? wsRev : undefined);
      if (res && res.notModified) return { ok: true, rev: wsRev };
      if (!res || typeof res.rev !== "number") {
        return { ok: false, rev: wsRev, unsupported: true };
      }
      if (wsRevKnown && res.rev < wsRev) return { ok: true, rev: wsRev };
      wsLastError = null;
      if (stateKey(workspaceStateSnapshot()) !== localKey) {
        // A local change outpaced this poll; keep it and update the base.
        lastServerState = res.state || {};
        lastAckKey = stateKey(lastServerState);
        wsRev = res.rev;
        wsRevKnown = true;
        return { ok: true, rev: wsRev };
      }
      await applyRemoteWorkspaceState(res.state || {});
      // Only after the apply: a throw here must leave the rev where it was,
      // or every later poll would 304 and the client would stop catching up.
      wsRev = res.rev;
      wsRevKnown = true;
      wsSyncDelay = WORKSPACE_SYNC_MS;
      return { ok: true, rev: wsRev };
    } catch (e) {
      wsLastError = e;
      // A 404/405 is a server without the endpoint, not a transient failure:
      // stop asking instead of backing off forever.
      if (e && (e.status === 404 || e.status === 405)) {
        return { ok: false, rev: wsRev, unsupported: true };
      }
      wsSyncDelay = Math.min(wsSyncDelay * 2, WORKSPACE_SYNC_MAX_MS);
      return { ok: false, rev: wsRev };
    } finally {
      wsSyncing = false;
      wsLastAt = Date.now();
    }
  }

  function armSync() {
    if (!wsSyncRunning || wsSyncPaused || wsSyncTimer !== null) return;
    wsSyncTimer = setTimeout(syncTick, wsSyncDelay);
  }

  async function syncTick() {
    wsSyncTimer = null;
    const res = await syncOnce();
    if (res.unsupported) { wsSyncRunning = false; return; }
    armSync();
  }

  /* Async and idempotent. A phone, a workspace page without an id, and a page
   * whose /api/config fetch failed keep the loop off; a server without the
   * endpoint is probed once and then left alone. */
  async function startSync() {
    if (wsSyncRunning) return true;
    if (!workspaceId() || isPhoneMode() || !wsBootLoaded) return false;
    const token = ++wsStartToken;
    const res = await syncOnce();
    // stop() during the probe wins, and a hidden page arms nothing until it
    // is shown.
    if (token !== wsStartToken) return false;
    if (res.unsupported) return false;
    // A transport failure still arms the chain: the backoff is what recovers
    // a page that booted before the network came up.
    wsSyncRunning = true;
    armSync();
    return true;
  }

  function stopSync() {
    wsStartToken++;
    wsSyncRunning = false;
    if (wsSyncTimer !== null) {
      clearTimeout(wsSyncTimer);
      wsSyncTimer = null;
    }
  }

  function pauseSync() { wsSyncPaused = true; }

  function resumeSync() {
    // Network recovery can fire while the page is hidden; showing it again is
    // what resumes, so a hidden page still sends nothing (AC71).
    if (document.hidden) return;
    wsSyncPaused = false;
    if (isPhoneMode()) {
      // The phone has no timer (AC73). One conditional read when the page
      // comes back is what lets a backgrounded PWA show the desktop's
      // sessions and tabs without a reload.
      void syncOnce(true);
      return;
    }
    // A page that booted offline never armed; coming back online starts it.
    if (!wsSyncRunning) {
      if (wsBootLoaded) void startSync();
      return;
    }
    // One pass now, so a tab that was hidden catches up without waiting out
    // the interval; then make sure a timer is armed (a hidden boot had none).
    void syncOnce().then(armSync);
  }

  function syncStatus() {
    return {
      running: wsSyncRunning,
      paused: wsSyncPaused,
      pending: wsSaveTimer !== null || wsWritesOutstanding > 0,
      rev: wsRev,
      delayMs: wsSyncDelay,
      lastAt: wsLastAt,
      lastError: wsLastError,
    };
  }

  // A hidden tab sends nothing; showing it again polls at once. Coming back
  // online is the same catch-up. A page restored from the back/forward cache
  // gets no visibilitychange, so it has its own hook.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseSync(); else resumeSync();
  });
  window.addEventListener("online", resumeSync);
  window.addEventListener("pageshow", (e) => { if (e.persisted) resumeSync(); });

  /* --- device-local tab selection ------------------------------------ */
  /* The active session and the active tab are one device's, so they are
   * stored per workspace in localStorage with the convention table-view.js
   * and mobile.js use. */
  function deviceLocalKey(base) {
    const id = workspaceId();
    return (id && id !== DEFAULT_WORKSPACE_ID)
      ? "nb:" + id + ":" + base : "nb:" + base;
  }

  function readDeviceLocal(base) {
    try {
      const value = localStorage.getItem(deviceLocalKey(base));
      return (typeof value === "string") ? value : "";
    } catch (e) { return ""; }
  }

  function writeDeviceLocal(base, value) {
    try {
      if (value) localStorage.setItem(deviceLocalKey(base), String(value));
      else localStorage.removeItem(deviceLocalKey(base));
    } catch (e) { /* storage unavailable */ }
  }

  /* The active tab this device last used. Desktop writes it from
   * `tabs:changed`; a phone that has not yet written one falls back to its
   * mobile resume note, so the first boot after the update keeps the note it
   * was reading. */
  function localActiveFile() {
    const stored = readDeviceLocal(DEVICE_ACTIVE_FILE_KEY);
    if (stored) return stored;
    if (isPhoneMode() && NB.mobile && NB.mobile.resumePath) {
      return NB.mobile.resumePath() || "";
    }
    return "";
  }

  /* The input for NB.tabs.normaliseSessions: the shared `sessions` with this
   * device's active session and active tab preferred when they still name
   * something that exists. A local choice that names nothing falls back to
   * the shared value. */
  function bootSessionInput(shared, known) {
    const localSession = readDeviceLocal(DEVICE_ACTIVE_SESSION_KEY);
    const localFile = localActiveFile();
    const raw = Array.isArray(shared.sessions) ? shared.sessions : [];
    const pins = Array.isArray(shared.pinnedFiles) ? shared.pinnedFiles : [];
    const namesSession = (id) => !!id &&
      raw.some(s => s && typeof s === "object" && s.id === id);
    const activeSessionId = namesSession(localSession)
      ? localSession : shared.activeSessionId;
    let sessions = raw;
    if (localFile && known(localFile)) {
      sessions = raw.map(s => {
        if (!s || typeof s !== "object" || s.id !== activeSessionId) return s;
        const files = Array.isArray(s.openFiles) ? s.openFiles : [];
        if (files.indexOf(localFile) < 0 && pins.indexOf(localFile) < 0) return s;
        return Object.assign({}, s, { activeFile: localFile });
      });
    }
    return {
      sessions,
      activeSessionId,
      openFiles: shared.openFiles,
      activeFile: shared.activeFile,
      pinnedFiles: shared.pinnedFiles,
    };
  }

  /* Copy the global keys out of `cfg` onto a freshly read blob. The
   * per-workspace state is not carried: the server owns it, strips any copy
   * from this POST, and re-attaches its own. */
  function mergeGlobalKeys(fresh, keyList) {
    const merged = (fresh && typeof fresh === "object") ? { ...fresh } : {};
    if (keyList.some((key) => LEGACY_RETIRING_KEYS.indexOf(key) >= 0)) {
      for (const key of LEGACY_CONFIG_KEYS) delete merged[key];
    }
    for (const key of keyList) {
      if (key === "workspaceState" || key === "workspaceStateRev") continue;
      if (WORKSPACE_STATE_KEYS.indexOf(key) >= 0) continue;
      if (cfg[key] === undefined) delete merged[key];
      else merged[key] = cfg[key];
    }
    return merged;
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
          const merged = mergeGlobalKeys(fresh, keyList);
          const wrote = keyList.some((key) =>
            !(workspaceId() && WORKSPACE_STATE_KEYS.indexOf(key) >= 0));
          if (!wrote) return undefined;
          return NB.api.saveConfig(merged);
        }).catch(e => console.warn("config save failed", e));
      }
      const wsId = workspaceId();
      if (!wsId) {
        return NB.api.saveConfig(cfg).catch(e => console.warn("config save failed", e));
      }
      // Workspace page: read-merge-write, so a global key changes without
      // dropping one another client edited in between. The per-workspace
      // state is not this route's to write. The named keys are merged even
      // when cfg no longer carries them: a delete (the Explorer splitter's
      // reset, a retired legacy key) is expressed by naming the key.
      return NB.api.getConfig().then((fresh) => {
        const keys = keyList.length
          ? Array.from(new Set([...Object.keys(cfg), ...keyList]))
          : Object.keys(cfg);
        return NB.api.saveConfig(mergeGlobalKeys(fresh, keys));
      }).catch(e => console.warn("config save failed", e));
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

  /* Map a path -- or any path under it -- from an old location to a new one.
   * Returns null when the path is not affected by the move. */
  function remapMovedPath(p, from, to) {
    if (p === from) return to;
    if (typeof p === "string" && p.startsWith(from + "/")) {
      return to + p.slice(from.length);
    }
    return null;
  }

  /* Recents and lastFile are written only on file:open, so a rename/move has
   * to re-key them or the Recent view keeps a dead path. */
  function rekeyRecentFiles(from, to) {
    if (!from || !to || from === to) return;
    const seen = new Set();
    const recents = [];
    let changed = false;
    for (const p of cfg.recentFiles || []) {
      const mapped = remapMovedPath(p, from, to);
      if (mapped !== null) changed = true;
      const next = mapped !== null ? mapped : p;
      if (seen.has(next)) continue;   // a rename can collide with an older entry
      seen.add(next);
      recents.push(next);
    }
    if (!isPhoneMode() && cfg.lastFile) {
      const mappedLast = remapMovedPath(cfg.lastFile, from, to);
      if (mappedLast !== null) {
        cfg.lastFile = mappedLast;
        changed = true;
      }
    }
    if (!changed) return;
    cfg.recentFiles = recents;
    if (isPhoneMode()) persistConfig(["recentFiles"]);
    else persistConfig();
  }

  /* --- wiring -------------------------------------------------------- */
  function wire() {
    // sidebar -> tabs (open / activate)
    const openErrorEl = document.getElementById("viewer-error");
    const openErrorMsg = document.getElementById("viewer-error-msg");
    const openErrorRetry = document.getElementById("viewer-error-retry");
    let failedOpenPath = null;
    function hideOpenError() {
      if (openErrorEl) openErrorEl.hidden = true;
      failedOpenPath = null;
    }
    function showOpenError(path, err) {
      failedOpenPath = path;
      if (openErrorMsg) {
        openErrorMsg.textContent = "Couldn’t open “" + path + "”. " +
          (err && err.message ? err.message : "The file may have been moved or deleted.");
      }
      if (openErrorEl) openErrorEl.hidden = false;
    }
    if (openErrorRetry) openErrorRetry.addEventListener("click", () => {
      if (failedOpenPath) NB.evt.emit("file:open-request", failedOpenPath);
    });
    NB.evt.on("file:open", hideOpenError);
    NB.evt.on("file:open-request", async (path) => {
      try {
        await NB.tabs.open(path);
        hideOpenError();
      } catch (e) {
        showOpenError(path, e);
      }
    });

    // any file shown -> update recents + tree highlight (fired by viewer.activate)
    NB.evt.on("file:open", (path) => { if (path) updateRecent(path); });

    // tab set changed -> persist open files + active file + pinned files.
    // `openFiles`/`activeFile` stay mirrors of the active session; `sessions`
    // and `activeSessionId` are authoritative and arrive in the same payload.
    NB.evt.on("tabs:changed", ({ openFiles, activeFile, pinnedFiles, sessions, activeSessionId }) => {
      // A remote apply rebuilds `cfg` from the model itself; taking the
      // payload here would race that rebuild and republish the peer's state.
      if (applyingRemote) return;
      cfg.openFiles = openFiles;
      cfg.activeFile = activeFile;
      if (pinnedFiles) cfg.pinnedFiles = pinnedFiles;
      if (sessions) cfg.sessions = sessions;
      if (activeSessionId !== undefined) cfg.activeSessionId = activeSessionId;
      // The active session and tab are this device's selection: keep them
      // locally so a reload lands here rather than where a peer is.
      writeDeviceLocal(DEVICE_ACTIVE_SESSION_KEY, activeSessionId);
      writeDeviceLocal(DEVICE_ACTIVE_FILE_KEY, activeFile);
      persistConfig();
    });

    // a rename / move re-keys the Recent view and lastFile
    NB.evt.on("file:moved", ({ from, to }) => rekeyRecentFiles(from, to));

    // search-case toggle persists config
    NB.evt.on("search-case-changed", (val) => {
      cfg.searchCaseSensitive = !!val;
      persistConfig(["searchCaseSensitive"]);
    });

    // top bar: enter/exit edit mode. The Preview / Save / Close buttons
    // for the edit-mode toolbar are wired inside viewer.js (where the
    // edit-mode state machine lives) so the dirty-aware visibility for
    // Save stays in one place.
    editBtn.addEventListener("click", () => NB.viewer.toggleEdit());

    // Panel open/closed and the active view are owned by NB.activity, one
    // record per side. Each panel's own header chevron goes through the same
    // delegated [data-collapse-view] path, so there is no per-id click
    // handler here any more: the side is resolved at click time.
    if (NB.evt) {
      // `activity:collapsed` / `activity:expanded` carry the side; the
      // matching flag is the only one written.
      NB.evt.on("activity:collapsed", ({ side }) => {
        if (isPhoneMode() || applyingConfig) return;
        if (side === "right") {
          cfg.auxPanelCollapsed = true; applyAuxState(); persistConfig();
        } else {
          cfg.sidebarCollapsed = true; applySidebarState(); persistConfig();
        }
      });
      NB.evt.on("activity:expanded", ({ side }) => {
        if (isPhoneMode() || applyingConfig) return;
        if (side === "right") {
          cfg.auxPanelCollapsed = false; applyAuxState(); persistConfig();
        } else {
          cfg.sidebarCollapsed = false; applySidebarState(); persistConfig();
        }
      });
      // Switching the active view persists that side's key so a reload
      // restores both panels. Fired by activity.js on every activation; the
      // comparison guards against the boot activation of the saved view.
      NB.evt.on("activity:changed", ({ id, side }) => {
        if (isPhoneMode() || applyingConfig) return;
        if (side === "right") {
          if (cfg.activeViewRight !== id) { cfg.activeViewRight = id; persistConfig(); }
        } else if (cfg.activeViewLeft !== id) {
          cfg.activeViewLeft = id; persistConfig();
        }
      });
    }

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
          if (NB.activity && NB.activity.openSearch) NB.activity.openSearch();
        },
        tabPrev: () => NB.vimnav && NB.vimnav.cycleTabWithCommit && NB.vimnav.cycleTabWithCommit("prev"),
        tabNext: () => NB.vimnav && NB.vimnav.cycleTabWithCommit && NB.vimnav.cycleTabWithCommit("next"),
        toggleEdit: () => { if (NB.viewer && NB.viewer.toggleEdit) NB.viewer.toggleEdit(); },
        toggleHybrid: () => { NB.evt.emit("shortcut:toggleHybrid"); },
        windowCycle: () => NB.vimnav && NB.vimnav.cycleWindow && NB.vimnav.cycleWindow(),
        toggleTopbar: () => NB.app.setHideTopbar(!NB.app.getHideTopbar()),
        toggleTabbar: () => NB.app.setHideTabBar(!NB.app.getHideTabBar()),
        openSettings: () => { if (NB.settings && NB.settings.open) NB.settings.open(); },
      });
    }

    // Settings: the gear button opens a modal. The modal lives in its own
    // module (settings.js) and reads/writes the cfg through these hooks.
    document.getElementById("activity-settings-btn").addEventListener("click",
      () => NB.settings && NB.settings.open());

    // resizable panels (drag the inner edge). Installed only on the desktop
    // shell; a later phone->desktop mode flip re-runs this.
    ensureResizeHandles();
    NB.evt.on("mobile:mode", ({ mode }) => {
      if (mode !== "desktop") return;
      applySidebarState();
      applyAuxState();
      ensureResizeHandles();
    });
  }

  function ensureResizeHandles() {
    if (isPhoneMode()) return;
    // The Explorer's in-view splitter is desktop-only too: a drawer has no
    // room for a second resize target.
    setupExplorerTopResize();
    // Both panels stop where their CSS track clamps: the reader keeps its
    // floor and each panel takes at most 45 % of the shared budget.
    setupResize("side-panel", "--side-panel-width", "right", { max: paneMax });
    setupResize("aux-panel", "--aux-panel-width", "left", { max: paneMax });
  }

  function setupResize(id, cssVar, edge, opts) {
    const pane = document.getElementById(id);
    if (!pane || pane.querySelector(".resize-handle")) return;
    // Max may be a fixed number or a function evaluated live on each drag
    // tick (the panel caps depend on the viewport), so a window resize
    // mid-drag keeps working.
    const maxOpt = (opts && opts.max !== undefined) ? opts.max : SHELL_PANE_MAX;
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
      // Each panel owns one saved width (§6.1): the left writes sidebarWidth,
      // the right writes auxPanelWidth.
      if (id === "side-panel") cfg.sidebarWidth = w;
      else if (id === "aux-panel") cfg.auxPanelWidth = w;
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
      // A left-edge handle (the aux panel) widens when dragged away from the
      // pane (dragging left => wider), so flip the sign; a right-edge handle
      // (the side panel) drags naturally with +dx.
      const sign = edge === "left" ? -1 : 1;
      const w = Math.max(SHELL_PANE_MIN, Math.min(typeof maxOpt === "function" ? maxOpt() : maxOpt, startW + sign * dx));
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
      let opened = await NB.tabs.open(file);
      if (!opened) {
        // The active session is at its tab cap. A deep link is explicit
        // navigation, so make room by closing the current tab, but only
        // when it has nothing unsaved to lose. Otherwise the refusal
        // stands and boot keeps the URL so a refresh can retry.
        const active = NB.tabs.getActive();
        const hybridDirty = !!(NB.hybrid && NB.hybrid.isActive &&
          NB.hybrid.isActive() && NB.hybrid.isDirty && NB.hybrid.isDirty());
        const dirty = !!(active && (NB.viewer.isDirty(active) || hybridDirty));
        if (active && active !== file && !dirty) {
          NB.tabs.close(active);
          opened = await NB.tabs.open(file);
        }
      }
      if (!opened) return false;
    } else if (NB.tabs.getActive() !== file) {
      await NB.tabs.activate(file);
      if (NB.tabs.getActive() !== file) return false;
    }
    if (heading) {
      const ok = NB.viewer.scrollToHeading(heading);
      if (!ok) console.warn("Deep link heading not found:", heading);
    }
    return true;
  }

  /* Panel state the server rendered into the shell, read back from the DOM,
   * one record per side. boot() snapshots this before the async config fetch
   * so a failed fetch restores it instead of repainting the panels with
   * DEFAULTS (which would reveal the file tree, expand a collapsed panel, and
   * lose the saved widths). A collapsed panel's width reads 0 in the DOM; the
   * saved width is kept by cfg, so 0 is left untouched here. */
  function shellPanelState() {
    const px = (name) => parseInt(document.documentElement.style.getPropertyValue(name), 10);
    const viewIn = (panel) => {
      if (!panel) return null;
      const el = panel.querySelector(".side-panel-view:not([hidden])");
      return el ? el.dataset.view : null;
    };
    // The rails are painted by activity.js from the server-rendered
    // data-sidebar-order attribute; read it back for the failed-fetch path.
    const barEl = document.getElementById("activity-bar");
    const rawOrder = (barEl && barEl.dataset) ? barEl.dataset.sidebarOrder : "";
    const rawHidden = (barEl && barEl.dataset) ? barEl.dataset.sidebarHidden : "";
    const layoutEl = document.getElementById("layout");
    let sidebarSide = {};
    try {
      sidebarSide = (layoutEl && layoutEl.dataset.sidebarSide)
        ? JSON.parse(layoutEl.dataset.sidebarSide) : {};
    } catch (_) {
      sidebarSide = {};
    }
    return {
      left: {
        activeView: viewIn(sidePanelEl),
        collapsed: !!(sidePanelEl && sidePanelEl.classList.contains("collapsed")),
        width: px("--side-panel-width"),
      },
      right: {
        activeView: viewIn(auxPanelEl),
        collapsed: !!(auxPanelEl && auxPanelEl.classList.contains("collapsed")),
        width: px("--aux-panel-width"),
      },
      // NaN when the shell painted no split height (still auto).
      explorerTopHeight: px("--explorer-top-height"),
      sidebarOrder: rawOrder ? rawOrder.split(",").filter(Boolean) : [],
      sidebarHidden: rawHidden ? rawHidden.split(",").filter(Boolean) : [],
      sidebarSide,
    };
  }

  /* Does a successful config fetch name a different view for this side? The
   * id to activate, or null to leave the panel alone. A failed fetch (no
   * string), a fetch that names the view already showing, and a user who
   * switched that side away from the shell-painted view while the fetch was
   * in flight all return null. */
  function resolveBootView(currentView, shellView, fetchedView) {
    if (typeof fetchedView !== "string") return null;
    if (currentView !== shellView) return null;
    if (fetchedView === shellView) return null;
    return fetchedView;
  }

  /* The side's saved active view, validated with the server's per-side rules
   * (§6.2): it must be homed on this side and must not be hidden; otherwise
   * the first visible view on that side in rail order takes over, or null.
   * A raw id that fails validation is never passed to activate(). */
  function resolveSideView(side, c) {
    if (!NB.activity || !NB.activity.barItems) return null;
    const items = NB.activity.barItems().filter(item => item.side === side);
    const visible = items.filter(item => !item.hidden);
    const saved = side === "right" ? c.activeViewRight : c.activeViewLeft;
    if (typeof saved === "string" && visible.some(item => item.id === saved)) {
      return saved;
    }
    return visible.length ? visible[0].id : null;
  }

  /* --- boot ---------------------------------------------------------- */
  let booted = false;
  async function boot() {
    if (booted) return;   // idempotent: DOMContentLoaded fires once, but guard anyway
    booted = true;
    wire();
    // Snapshot both panels before the async config fetch so the failed-fetch
    // path below can restore them intact.
    const shellPanel = shellPanelState();
    let serverCfg = null;
    try {
      serverCfg = await NB.api.getConfig();
      applyConfig(serverCfg);
    } catch (e) {
      applyConfig({}, false);
      // The shell already painted the saved panels; a failed fetch must not
      // reset them to DEFAULTS. Restore what applyConfig just overwrote, then
      // let activity.js adopt each side's painted view again.
      cfg.sidebarCollapsed = shellPanel.left.collapsed;
      cfg.auxPanelCollapsed = shellPanel.right.collapsed;
      cfg.sidebarOrder = shellPanel.sidebarOrder;
      cfg.sidebarHidden = shellPanel.sidebarHidden;
      cfg.sidebarSide = shellPanel.sidebarSide;
      if (shellPanel.left.width > 0) cfg.sidebarWidth = shellPanel.left.width;
      if (shellPanel.right.width > 0) cfg.auxPanelWidth = shellPanel.right.width;
      // The shell painted the saved split height; applyConfig() just removed
      // it because the failed fetch had no config to read. Restore it, so an
      // offline reload keeps the split instead of dropping back to auto.
      if (Number.isFinite(shellPanel.explorerTopHeight)) {
        cfg.explorerTopHeight = shellPanel.explorerTopHeight;
      }
      if (NB.activity && NB.activity.setBarOrder) {
        NB.activity.setBarOrder(cfg.sidebarOrder);
      }
      if (NB.activity && NB.activity.setHidden) {
        NB.activity.setHidden(cfg.sidebarHidden);
      }
      applySidebarState();
      applyAuxState();
      applyExplorerTopHeight();
      if (!isPhoneMode() && NB.activity && NB.activity.adoptShellView) {
        // Adopting emits activity:changed; suppress the listener so a failed
        // fetch never turns the shell paint into a config write (§7.8 step 5).
        applyingConfig = true;
        try {
          NB.activity.adoptShellView("left");
          NB.activity.adoptShellView("right");
        } finally {
          applyingConfig = false;
        }
      }
    }
    // watcher.js auto-starts the polling fallback at module load; a saved
    // "off" choice must stop it once config has arrived.
    if (cfg.watchEnabled === false && NB.watcher && NB.watcher.disable) {
      NB.watcher.disable();
    }
    // Reconcile each side on its own: only when the fetched config names a
    // different, valid view for it AND the user has not switched that side
    // while the fetch was in flight (see resolveBootView). A failed fetch
    // reconciles nothing.
    if (!isPhoneMode() && serverCfg) {
      for (const side of ["left", "right"]) {
        const snapshot = shellPanel[side];
        const current = NB.activity.getActive(side);
        const next = resolveSideView(side, serverCfg);
        const target = resolveBootView(current, snapshot.activeView, next);
        if (target) NB.activity.activate(target, false);
      }
    }
    // Phone has no AI or Outline view; a saved desktop active view of one, or
    // any hidden view, must not leave the drawer pointing at an unusable
    // host. Pick the first visible phone view instead.
    if (isPhoneMode() && NB.activity.visible && NB.activity.getActive) {
      const usable = NB.activity.visible()
        .filter(id => PHONE_HIDDEN_VIEWS.indexOf(id) < 0);
      const active = NB.activity.getActive();
      if (usable.length && usable.indexOf(active) < 0) {
        NB.activity.activate(usable[0], false);
      }
    }
    // Each panel is the source of truth for its side's active view -- the
    // failed path leaves cfg at DEFAULTS -- so mirror both back. Without this
    // a later unrelated save would persist the defaults and drop the saved
    // views. A null side keeps whatever it had: null is not a view id.
    if (NB.activity.getActive) {
      const left = NB.activity.getActive("left");
      const right = NB.activity.getActive("right");
      if (left) cfg.activeViewLeft = left;
      if (right) cfg.activeViewRight = right;
    }

    await NB.sidebar.refresh();
    const tree = NB.sidebar.getTree();

    // Init the VIM keymap from the persisted cfg. vimnav.js attaches
    // its global keydown listener at module-load time (so it can be
    // called on first paint without a race), but the listener is
    // gated by an `enabled` flag that setEnabled() flips. Off by
    // default; only the user opt-in turns it on.
    if (NB.vimnav) NB.vimnav.setEnabled(!!cfg.vimMode);

    // Normalise the saved sessions against the live tree, then restore. The
    // tree may have changed since the state was written, so `known` is the
    // same predicate the old hand-rolled filter used. The fallback file is
    // used only on the first boot after the upgrade: afterwards an empty
    // session stays empty.
    const known = (p) => isSpecialTab(p) || treeHas(tree, p);
    // Both shells restore the same session model, so the list and its tabs
    // are shared. The phone still shows one note at a time (no tab strip),
    // but it no longer starts from a private "Main" that would overwrite the
    // workspace on its first write. The device-local active session and tab
    // win over the shared ones while they still name something that exists.
    const sessionState = NB.tabs.normaliseSessions(
      bootSessionInput(cfg, known), known);
    const fallback = (sessionState.migrated)
      ? (cfg.lastFile && treeHas(tree, cfg.lastFile) ? cfg.lastFile
        : firstFilePath(tree) || null)
      : null;
    // Read the incoming link BEFORE restoring anything: a phone boot must
    // not let a resume note rewrite the URL (mobile.js suppresses its
    // history entries for the whole boot window) or replace the requested
    // note.
    const deepLink = parseDeepLink();
    // The phone's Continue note is its device-local selection and opens after
    // restore; a deep link opens after that and wins. Without either, the
    // shared active session's active tab shows, or Home when it has none. The
    // phone never uses the desktop migration fallback (first file in the tree).
    const phoneResume = (isPhoneMode() && NB.mobile && NB.mobile.resumePath)
      ? NB.mobile.resumePath() : null;
    const phoneResumeKnown = !!(phoneResume && treeHas(tree, phoneResume));
    const restoreFallback = isPhoneMode() ? null : fallback;
    if (NB.mobile && NB.mobile.beginBoot) NB.mobile.beginBoot();
    try {
      try {
        await NB.tabs.restore([], null, restoreFallback, [], sessionState);
      } catch (e) { console.warn("restore tabs failed", e); }

      // The shared active session may hold other tabs; the phone still
      // opens the note it last read on this device, in that session.
      if (phoneResumeKnown && !deepLink && NB.tabs.getActive() !== phoneResume) {
        try { await NB.tabs.open(phoneResume); }
        catch (e) { console.warn("resume open failed", e); }
      }
      // A shared active tab may be a desktop-only special view. Keep it in
      // the model, but never make the phone render it on boot.
      if (isPhoneMode()) {
        const active = NB.tabs.getActive();
        if (active && PHONE_HIDDEN_TABS.indexOf(active) >= 0) {
          const visible = NB.tabs.getOpen()
            .find(p => PHONE_HIDDEN_TABS.indexOf(p) < 0);
          if (visible) await NB.tabs.activate(visible);
          else { NB.tabs.clearActive(); NB.viewer.showSessionEmpty(); }
        }
      }

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
          // shareable/retryable. Desktop keeps it too when the tab could
          // not open (a full session), so a refresh retries.
          if (!isPhoneMode() && opened) {
            try { history.replaceState(null, "", window.location.pathname); }
            catch (_) {}
          }
        } catch (e) { console.warn("deep link failed", e); }
      }
    } finally {
      if (NB.mobile && NB.mobile.endBoot) NB.mobile.endBoot();
    }
    // Poll for peer changes only once the view is settled: a poll that ran
    // earlier could apply a state under the boot restore.
    await NB.sync.start();
  }

  function isSpecialTab(path) {
    // Special tabs (the graph) carry a "§" id and are not files, so the
    // boot-time tree filter must let them through. NB.tabs.restore() drops
    // ids no longer registered.
    return !!(NB.tabs && NB.tabs.isSpecial && NB.tabs.isSpecial(path));
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

  /* Cross-device sync seam (sessions.md §17.10): `tick()` is one pass now,
   * `status()` is the diagnostics shape. */
  NB.sync = {
    start: startSync,
    stop: stopSync,
    pause: pauseSync,
    resume: resumeSync,
    tick: syncOnce,
    status: syncStatus,
  };

  /* Tiny façade so other modules (settings.js) can read live config and
   * trigger a persist without reaching into our module-scoped state. */
  NB.app = {
    getCfg: () => cfg,
    // The canonical width of each panel, read by NB.activity.expand() to
    // restore that panel to the user's last-dragged size after a collapse
    // cycle. Kept here so each width has one owner.
    getSidePanelWidth: () => (cfg.sidebarWidth || DEFAULT_PANE_W),
    getAuxPanelWidth: () => (cfg.auxPanelWidth || DEFAULT_PANE_W),
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
    // Side-panel search prefs. Keyed persists so a phone can write only
    // these keys through its read-merge-write path.
    setSearchUnique: (on) => {
      cfg.searchUnique = (typeof on === "boolean") ? on : DEFAULTS.searchUnique;
      persistConfig(["searchUnique"]);
    },
    getSearchUnique: () => (typeof cfg.searchUnique === "boolean")
      ? cfg.searchUnique : DEFAULTS.searchUnique,
    setSearchSort: (sort) => {
      cfg.searchSort = SEARCH_SORTS.indexOf(sort) >= 0 ? sort : DEFAULTS.searchSort;
      persistConfig(["searchSort"]);
    },
    getSearchSort: () => SEARCH_SORTS.indexOf(cfg.searchSort) >= 0
      ? cfg.searchSort : DEFAULTS.searchSort,
    setSearchTarget: (value) => {
      cfg.searchTarget = SEARCH_TARGETS.indexOf(value) >= 0
        ? value : DEFAULTS.searchTarget;
      persistConfig(["searchTarget"]);
    },
    getSearchTarget: () => SEARCH_TARGETS.indexOf(cfg.searchTarget) >= 0
      ? cfg.searchTarget : DEFAULTS.searchTarget,
    // Left activity-bar icon order. The setter re-renders the bar live and
    // persists the cleaned list; a keyed write keeps the phone path safe.
    setSidebarOrder: (order) => {
      const next = normalizeViewIdList(order);
      const current = normalizeViewIdList(cfg.sidebarOrder);
      if (next.length === current.length &&
          next.every((id, i) => id === current[i])) return;
      cfg.sidebarOrder = next;
      if (NB.activity && NB.activity.setBarOrder) {
        NB.activity.setBarOrder(cfg.sidebarOrder);
      }
      persistConfig(["sidebarOrder"]);
    },
    getSidebarOrder: () => normalizeViewIdList(cfg.sidebarOrder),
    // Hidden activity-bar views. Hiding or showing re-renders the bar live;
    // the order list keeps every row so a hidden view can be restored.
    setSidebarHidden: (ids) => {
      const next = normalizeViewIdList(ids);
      const current = normalizeViewIdList(cfg.sidebarHidden);
      if (next.length === current.length &&
          next.every((id, i) => id === current[i])) return;
      cfg.sidebarHidden = next;
      if (NB.activity && NB.activity.setHidden) {
        NB.activity.setHidden(cfg.sidebarHidden);
      }
      persistConfig(["sidebarHidden"]);
    },
    getSidebarHidden: () => normalizeViewIdList(cfg.sidebarHidden),
    // Which rail hosts a view. The live move is NB.activity.setSide (it moves
    // the host node and re-renders both rails); this records the applied side
    // in the saved map and persists it with an explicit key list, which is
    // what the phone's read-merge-write path can write safely.
    setSidebarSide: (id, side) => {
      if (!id || (side !== "left" && side !== "right")) return;
      if (!NB.activity || !NB.activity.setSide) return;
      const applied = NB.activity.setSide(id, side);
      if (!applied) return;
      cfg.sidebarSide = { ...normalizeSideMap(cfg.sidebarSide), [id]: applied };
      persistConfig(["sidebarSide"]);
    },
    getSidebarSide: () => normalizeSideMap(cfg.sidebarSide),
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
    setHideTabBar: (on) => { applyTabBar(!!on); persistConfig(); },
    getHideTabBar: () => !!cfg.hideTabBar,
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
    getGraphMode: () => (cfg.graphMode === GRAPH_MODE_2D ? GRAPH_MODE_2D : GRAPH_MODE_3D),
    setGraphMode: (mode) => {
      cfg.graphMode = mode === GRAPH_MODE_2D ? GRAPH_MODE_2D : GRAPH_MODE_3D;
      persistConfig(["graphMode"]);
    },
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
    // The app's en_US spellcheck switch (hybrid mode). Hybrid reads it on
    // every routing decision, so persisting the flag is enough; the
    // config:changed emit repaints an open session.
    setSpellcheck: (on) => {
      cfg.spellcheck = on !== false;
      persistConfig(["spellcheck"]);
    },
    getSpellcheck: () => cfg.spellcheck !== false,
    // Replace the personal spelling list. The Spelling block is the only
    // caller on the user-mutation path; the normaliser caps and dedupes it,
    // and the module reads it call-time.
    setSpellcheckWords: (words) => {
      cfg.spellcheckWords = normalizeSpellcheckWords(words);
      persistConfig(["spellcheckWords"]);
      return cfg.spellcheckWords;
    },
    getSpellcheckWords: () => normalizeSpellcheckWords(cfg.spellcheckWords),
    // The Personal words editor validates each line before it saves, so the
    // same normaliser must be reachable from settings.js.
    normalizeSpellcheckWords: (list) => normalizeSpellcheckWords(list),
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
