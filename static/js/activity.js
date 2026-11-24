/* activity.js -- two activity rails, two panels, and the view registry.
 *
 * Each side owns one rail and one panel:
 *   left  -> #activity-bar      + #side-panel   (view icons + the actions)
 *   right -> #activity-bar-right + #aux-panel   (view icons only)
 *
 * Every view registers via NB.activity.register({ id, icon, label, side,
 * mount }) and gets an icon on the rail of its home side. Clicking an icon
 * activates that view in its side's panel; clicking the active icon again
 * collapses that panel. A view's home is the saved sidebarSide entry when
 * there is one, else the `side` it registered with ("left" for every view
 * but the Outline).
 *
 * Exactly one DOM element carries data-view="<id>": the template ships it
 * inside the panel its side names, and setSide() moves it with appendChild
 * when the user changes the side. It is never rebuilt, because sidebar.js,
 * bookmarks.js, sessions.js, tabs-view.js and outline.js capture their nodes
 * at load.
 *
 * The bar is generic: the module adopts whichever .side-panel-view host the
 * server rendered visible on each side as that side's boot view (so a reload
 * shows the saved views with no flash), falling back to the first visible
 * view on that side. On the phone the sides collapse into one drawer: every
 * host moves into #side-panel and only the last activated one shows.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const barEl = document.getElementById("activity-bar");
  const barRightEl = document.getElementById("activity-bar-right");
  const layoutEl = document.getElementById("layout");
  const panelEl = document.getElementById("side-panel");
  const auxPanelEl = document.getElementById("aux-panel");

  const SIDES = ["left", "right"];
  /* Per-side state (§2.3): one active id, one mounted set, one panel, one
   * rail and one width var each. Nothing is shared between the sides. */
  const sideState = {
    left: {
      bar: barEl,
      panel: panelEl,
      widthVar: "--side-panel-width",
      activeId: null,
      mounted: new Set(),
    },
    right: {
      bar: barRightEl,
      panel: auxPanelEl,
      widthVar: "--aux-panel-width",
      activeId: null,
      mounted: new Set(),
    },
  };
  /* The last view activated on either side. getActive() with no argument
   * returns it: the phone drawer has one panel, and the Settings announcer
   * speaks about the row that just changed. */
  let lastActiveId = null;

  /* The saved side of each view, read from #layout's data-sidebar-side
   * before register() runs, so a right-homed view's first icon lands on the
   * right rail without waiting for GET /api/config. forceescape in the
   * template keeps the quotes intact. */
  function readBootSideMap() {
    const raw = layoutEl && layoutEl.dataset ? layoutEl.dataset.sidebarSide : "";
    if (!raw) return {};
    try {
      const map = JSON.parse(raw);
      return (map && typeof map === "object" && !Array.isArray(map)) ? map : {};
    } catch (_) {
      // A malformed map must not abort the first register(): that would
      // leave both rails empty for the whole session.
      return {};
    }
  }

  // The server embeds the saved bar order on the nav so the first icon pass
  // matches the saved setting instead of reordering when config loads.
  function readBootBarOrder() {
    const raw = barEl && barEl.dataset ? barEl.dataset.sidebarOrder : "";
    if (!raw) return [];
    return raw.split(",").filter(Boolean);
  }

  // Hidden views are listed in the same server-rendered form so their icons
  // are absent from the first pass, not removed once config lands.
  function readBootHiddenViews() {
    const raw = barEl && barEl.dataset ? barEl.dataset.sidebarHidden : "";
    if (!raw) return [];
    return raw.split(",").filter(Boolean);
  }

  // The phone rail is one row of equal columns: the first six visible views
  // in the saved bar order, then the More action. 7 x 44 = 308 px, so seven
  // slots still clear the 44 px floor at 320 px.
  const PHONE_RAIL_SLOTS = 6;
  // Views with no phone surface at all. They take neither a rail slot nor a
  // More row, because a row that opens an empty drawer is worse than no row.
  // The Outline is one of them: sides are a desktop concept, so its host has
  // no phone surface and activate() refuses it there (§9.5, §9.6).
  const PHONE_OFF_VIEWS = ["ai", "outline"];

  // A side-panel view can be adopted while this script evaluates, before
  // app.js defines NB.app. Read search prefs through these fallbacks; the
  // config:changed load event syncs the controls once app.js boots.
  const SEARCH_DEFAULTS = {
    unique: true, sort: "path", caseSensitive: false, target: "content",
  };

  // /api/search sets `timedOut` when its scan stopped at the deadline and
  // `matches` is incomplete. The server owns that deadline, so this copy
  // names no duration and stays true if the budget changes.
  const SEARCH_TIMEOUT_SUFFIX =
    "search stopped early — results may be incomplete";

  function searchPrefUnique() {
    if (NB.app && NB.app.getSearchUnique) return NB.app.getSearchUnique();
    return SEARCH_DEFAULTS.unique;
  }
  function searchPrefSort() {
    if (NB.app && NB.app.getSearchSort) return NB.app.getSearchSort();
    return SEARCH_DEFAULTS.sort;
  }
  function searchPrefCase() {
    if (NB.app && NB.app.getCfg) return !!NB.app.getCfg().searchCaseSensitive;
    return SEARCH_DEFAULTS.caseSensitive;
  }
  function searchPrefTarget() {
    if (NB.app && NB.app.getSearchTarget) return NB.app.getSearchTarget();
    return SEARCH_DEFAULTS.target;
  }

  // Search rows lead with the file name and show the containing folder in
  // parentheses; a root-level note has no folder part.
  function hitPathParts(path) {
    const p = String(path == null ? "" : path);
    const i = p.lastIndexOf("/");
    return i < 0
      ? { name: p, dir: "" }
      : { name: p.slice(i + 1), dir: p.slice(0, i) };
  }

  // Registered views, in registration order. Each entry:
  //   { id, icon, label, side, mount(hostEl), unmount?() }
  // `side` is the resolved home ("left" | "right"). mount() is called the
  // first time a view is activated and is expected to populate its host
  // element (the panel child with data-view=<id>). Subsequent activations
  // just reveal it; mount is NOT re-called. This preserves per-view state
  // (scroll, selection, filter text) across switches, mirroring how VS Code
  // keeps each pane alive.
  const views = [];
  // View ids in the user's saved bar order (cfg.sidebarOrder). Seeded from
  // the server-rendered attribute; views the list does not name keep
  // registration order after the named ones.
  const barOrder = readBootBarOrder();
  const hiddenViews = new Set(readBootHiddenViews());
  // The saved side map. A map, not a list: a view the map does not name
  // keeps its registration default, which a list could not distinguish from
  // "the user put it left".
  const sideMap = readBootSideMap();

  function normalizeSide(side) {
    return side === "right" ? "right" : "left";
  }

  /* A view's home side: the saved map wins, then the registration default,
   * then "left" (§2.2). */
  function resolveSide(id, declared) {
    const saved = sideMap[id];
    if (saved === "left" || saved === "right") return saved;
    return declared === "right" ? "right" : "left";
  }

  function sideOf(id) {
    const v = views.find(x => x.id === id);
    return v ? v.side : null;
  }

  function register(v) {
    if (!v || !v.id) return;
    // De-dupe by id: a second register with the same id replaces the
    // earlier entry so re-registration (e.g. a hot reload) doesn't
    // leave stale icons.
    const entry = {
      id: v.id,
      icon: v.icon,
      label: v.label,
      mount: v.mount,
      unmount: v.unmount,
      side: resolveSide(v.id, v.side),
    };
    const i = views.findIndex(x => x.id === entry.id);
    if (i >= 0) views[i] = entry; else views.push(entry);
    renderBar();
    refreshCollapseButtons();
  }

  // Registered views sorted by the saved bar order, then registration
  // order for anything the saved list does not name.
  function orderedViews() {
    if (!barOrder.length) return views.slice();
    const rank = new Map();
    barOrder.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
    const known = [];
    const rest = [];
    for (const v of views) {
      if (rank.has(v.id)) known.push(v); else rest.push(v);
    }
    known.sort((a, b) => rank.get(a.id) - rank.get(b.id));
    return known.concat(rest);
  }

  function setBarOrder(ids) {
    barOrder.length = 0;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id && barOrder.indexOf(id) < 0) barOrder.push(id);
      }
    }
    renderBar();
  }

  function visibleViews() {
    return orderedViews().filter(v => !hiddenViews.has(v.id));
  }

  // The visible views whose home is one side, in global (rail) order.
  function visibleOnSide(side) {
    return visibleViews().filter(v => v.side === side);
  }

  // The views the phone can host: everything visible except the
  // desktop-only ones, which have no phone surface.
  function phoneViews() {
    return visibleViews().filter(v => PHONE_OFF_VIEWS.indexOf(v.id) < 0);
  }

  // What one rail draws. Off the phone it is every visible view homed on
  // that side; on the phone there is one rail, holding the first six views
  // of the saved order whatever their home.
  function railViews(side) {
    if (isPhone()) {
      return side === "left" ? phoneViews().slice(0, PHONE_RAIL_SLOTS) : [];
    }
    return visibleOnSide(side);
  }

  // The visible views the phone rail cannot hold, in bar order. The More
  // sheet lists these; off the phone there are none.
  function offRailViews() {
    return isPhone() ? phoneViews().slice(PHONE_RAIL_SLOTS) : [];
  }

  function setHidden(ids) {
    hiddenViews.clear();
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id) hiddenViews.add(id);
      }
    }
    renderBar();
    reconcileHiddenActive();
    updateRightEmpty();
  }

  /* A hidden view cannot stay active: its icon is gone, so switching it away
   * keeps the panel reachable. Per side (§7.5): the first visible view on
   * that side takes over; with none left the side empties, and its panel
   * collapses. On the right that also hides the rail (data-right-empty). */
  function reconcileHiddenActive() {
    for (const side of SIDES) reconcileHiddenActiveSide(side);
    updateRightEmpty();
  }

  function reconcileHiddenActiveSide(side) {
    const st = sideState[side];
    if (!st) return;
    const current = st.activeId;
    const stillValid = current && !hiddenViews.has(current) && sideOf(current) === side;
    if (stillValid) return;
    if (!current) return;              // never adopted; nothing to reconcile
    st.activeId = null;
    const visible = visibleOnSide(side);
    if (visible.length) {
      activate(visible[0].id, false);
      return;
    }
    hideAllAndCollapse(side);
  }

  /* One side with nothing to show: every host there hides and the panel
   * collapses to 0. The left rail keeps its action buttons (Settings must
   * stay reachable); the right rail also hides, through data-right-empty. */
  function hideAllAndCollapse(side) {
    const s = normalizeSide(side);
    const st = sideState[s];
    if (!st) return;
    st.activeId = null;
    if (st.panel) {
      st.panel.querySelectorAll(".side-panel-view").forEach(el => { el.hidden = true; });
    }
    syncActiveClass();
    if (isPhone()) {
      if (NB.mobile && NB.mobile.closeDrawer) NB.mobile.closeDrawer();
    } else {
      collapse(s);
    }
    updateRightEmpty();
    NB.evt.emit("activity:changed", { id: null, side: s });
  }

  /* data-right-empty is derived, never toggled: recomputed from the
   * visible-view set on every register(), setSide(), setHidden(),
   * collapse()/expand() and applyLayout(). A stale true would hide a view
   * that was just moved or unhidden. Until the first view registers there is
   * nothing to derive from, so the server's first-paint attribute stands. */
  function updateRightEmpty() {
    if (!layoutEl || !layoutEl.dataset) return;
    if (!views.length) return;
    const empty = !visibleOnSide("right").length;
    layoutEl.dataset.rightEmpty = empty ? "true" : "false";
  }

  function renderBar() {
    for (const side of SIDES) renderSideBar(side);
    syncActiveClass();
    updateRightEmpty();
  }

  function renderSideBar(side) {
    const st = sideState[side];
    if (!st || !st.bar) return;
    // Render view icons into a dedicated container so the bottom-pinned
    // action buttons (settings) and the spacer stay untouched. The template
    // ships the right rail's container; the left rail's is created lazily.
    let viewsEl = st.bar.querySelector(".activity-bar-views");
    if (!viewsEl) {
      viewsEl = document.createElement("div");
      viewsEl.className = "activity-bar-views";
      // A static top-pinned control (the workspace mount) keeps the first
      // slot; the view icons go after it.
      const pin = st.bar.querySelector(".activity-pin");
      st.bar.insertBefore(viewsEl, pin ? pin.nextSibling : st.bar.firstChild);
    }
    viewsEl.innerHTML = "";
    for (const v of railViews(side)) {
      const btn = document.createElement("button");
      btn.className = "activity-btn";
      btn.type = "button";
      btn.dataset.view = v.id;
      btn.title = v.label || v.id;
      btn.setAttribute("aria-label", v.label || v.id);
      if (v.icon && v.icon.indexOf("nb-icon-") === 0) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "activity-icon");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
        use.setAttribute("href", "#" + v.icon);
        svg.appendChild(use);
        btn.appendChild(svg);
      } else {
        const icon = document.createElement("span");
        icon.className = "activity-icon";
        icon.textContent = v.icon || "?";
        btn.appendChild(icon);
      }
      btn.addEventListener("click", () => activate(v.id, /*toggle*/ true));
      viewsEl.appendChild(btn);
    }
  }

  function syncActiveClass() {
    // Both rails carry icons; the active one is that rail's active view. On
    // the phone there is one rail and one drawer view.
    for (const side of SIDES) {
      const st = sideState[side];
      if (!st || !st.bar) continue;
      const active = isPhone() ? lastActiveId : st.activeId;
      // Only view icons (those with data-view) get the active class; the
      // bottom-pinned action buttons have no data-view and stay neutral.
      st.bar.querySelectorAll(".activity-btn[data-view]").forEach(b => {
        const on = b.dataset.view === active;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
  }

  /* The single host element for a view id. On the desktop it lives in the
   * panel its side names; on the phone every host lives in #side-panel, so
   * searching only that panel is correct there too. */
  function hostEl(id) {
    const v = views.find(x => x.id === id);
    if (!v) return null;
    const panel = isPhone() ? panelEl : sideState[v.side].panel;
    return panel ? panel.querySelector(
      '.side-panel-view[data-view="' + id + '"]') : null;
  }

  // mobile.js owns the mode mirror, but activity.js is parsed before it, so
  // the first register() calls have no NB.mobile to ask. Read the same CSS
  // token mobile.js mirrors, then fall back to the module.
  function isPhone() {
    if (window.NB && NB.mobile && NB.mobile.isOn) return !!NB.mobile.isOn();
    try {
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue("--ui-mode").trim();
      if (token) return token === "phone";
    } catch (_) { /* jsdom / no stylesheet: fall through */ }
    return document.documentElement.dataset.uiMode === "phone";
  }

  /* Mount a view into its host the first time it is activated. The mounted
   * record is per side and follows a host that setSide() moves, so a moved
   * view is never re-mounted (which would wipe its content). */
  function mountView(v) {
    const st = sideState[v.side];
    if (!st || st.mounted.has(v.id)) return;
    const host = hostEl(v.id);
    if (host && v.mount) {
      try { v.mount(host); } catch (e) { console.error("view mount failed", v.id, e); }
    }
    st.mounted.add(v.id);
  }

  /* Activate a view on its home side. `toggle` is true only for a user click
   * on a rail icon: it may collapse the panel (clicking the active icon) and
   * expand a collapsed one. A programmatic activation (boot, a shortcut)
   * passes false and never expands a collapsed panel. */
  function activate(id, toggle) {
    const v = views.find(x => x.id === id);
    if (!v) return false;
    // A hidden view has no icon; activating it would strand the panel with
    // no rail control. Unhide it in Settings first.
    if (hiddenViews.has(id)) return false;
    // Phone: the panel is a drawer. Tapping the active rail icon closes
    // it; activating any view opens it. Neither path touches the desktop
    // .collapsed state, the width var, or activity:collapsed/expanded.
    if (isPhone()) {
      // A view with no phone surface is refused here, not merely absent
      // from the rail: a saved right-homed view or a shortcut must not open
      // a host the phone cannot show (§9.5).
      if (PHONE_OFF_VIEWS.indexOf(id) >= 0) return false;
      if (toggle && lastActiveId === id && NB.mobile && NB.mobile.isDrawerOpen &&
          NB.mobile.isDrawerOpen()) {
        NB.mobile.closeDrawer();
        return true;
      }
      if (panelEl) {
        panelEl.querySelectorAll(".side-panel-view").forEach(el => {
          el.hidden = el.dataset.view !== id;
        });
      }
      lastActiveId = id;
      // The drawer shows one view; keep the per-side record in step so a flip
      // back to the desktop shell lands on this view where it lives.
      const home = sideState[v.side];
      if (home) home.activeId = id;
      mountView(v);
      syncActiveClass();
      NB.evt.emit("activity:changed", { id, side: v.side });
      if (toggle && NB.mobile && NB.mobile.openDrawer) NB.mobile.openDrawer();
      return true;
    }
    const st = sideState[v.side];
    if (!st || !st.panel) return false;
    const collapsed = st.panel.classList.contains("collapsed");
    // Clicking the already-active icon toggles that side's panel collapsed /
    // expanded (VS Code behavior). The active view is preserved across the
    // toggle so re-expanding returns to the same view, and the icon stays
    // lit.
    if (toggle && st.activeId === id && !collapsed) {
      collapse(v.side);
      return true;
    }
    // Only a user toggle (icon click) may expand a collapsed panel. The
    // load-time adoptShellView() calls activate(id, false) while the shell
    // is already rendered with the saved collapsed state; expanding here
    // would flash the panel open and (once app.js has wired its
    // activity:expanded listener) persist the wrong collapsed flag.
    if (toggle && collapsed) expand(v.side);
    // Hide this side's other hosts, then show the target. The other side is
    // untouched: its active view, width and collapsed state are its own.
    st.panel.querySelectorAll(".side-panel-view").forEach(el => {
      el.hidden = el.dataset.view !== id;
    });
    st.activeId = id;
    lastActiveId = id;
    mountView(v);
    syncActiveClass();
    NB.evt.emit("activity:changed", { id, side: v.side });
    return true;
  }

  function setPanelWidth(st, w) {
    if (!st || !st.widthVar) return;
    document.documentElement.style.setProperty(st.widthVar, w + "px");
  }

  function collapse(side) {
    const s = normalizeSide(side);
    if (isPhone()) {
      if (NB.mobile && NB.mobile.closeDrawer) NB.mobile.closeDrawer();
      return;
    }
    const st = sideState[s];
    if (!st || !st.panel) return;
    st.panel.classList.add("collapsed");
    // Keep activeId so the icon stays highlighted and re-expanding returns
    // to the same view. VS Code does the same: the active icon stays lit
    // while the panel is hidden.
    setPanelWidth(st, 0);
    NB.evt.emit("activity:collapsed", { side: s });
  }

  function expand(side) {
    const s = normalizeSide(side);
    if (isPhone()) {
      if (NB.mobile && NB.mobile.openDrawer) NB.mobile.openDrawer();
      return;
    }
    const st = sideState[s];
    if (!st || !st.panel) return;
    st.panel.classList.remove("collapsed");
    // Restore the saved width. app.js owns the canonical width value; we ask
    // it for the one that belongs to this side so the panel returns to the
    // size the user dragged it to.
    let w = 0;
    if (NB.app && (s === "right" ? NB.app.getAuxPanelWidth : NB.app.getSidePanelWidth)) {
      w = s === "right" ? NB.app.getAuxPanelWidth() : NB.app.getSidePanelWidth();
    }
    setPanelWidth(st, w);
    NB.evt.emit("activity:expanded", { side: s });
  }

  /* The active view of one side, or -- with no argument -- the last view
   * activated on either side. Callers that used to ask "is my panel on
   * screen?" ask isViewVisible() instead: with two panels, "active" no
   * longer means "on screen". */
  function getActive(side) {
    if (side === "left" || side === "right") return sideState[side].activeId;
    return lastActiveId;
  }

  function isCollapsed(side) {
    const st = sideState[normalizeSide(side)];
    return !!(st && st.panel && st.panel.classList.contains("collapsed"));
  }

  /* A view is visible when its side's panel is open and that side's active
   * id is this view. On the phone it is visible when its host is the one
   * the drawer shows. */
  function isViewVisible(id) {
    const v = views.find(x => x.id === id);
    if (!v) return false;
    if (isPhone()) {
      if (PHONE_OFF_VIEWS.indexOf(id) >= 0) return false;
      const host = hostEl(id);
      return !!(host && !host.hidden);
    }
    const st = sideState[v.side];
    if (!st || !st.panel) return false;
    return st.activeId === id && !st.panel.classList.contains("collapsed");
  }

  /* Open the side-panel Search view and focus its input. Used by the
   * app-level openSearch shortcut and the shell VIM keymap. Activating
   * an already-mounted view only reveals it, so focus is applied here
   * rather than only in mountSearch. Search's home side is whatever
   * sidebarSide says, so the expansion happens on that side. */
  function openSearch() {
    if (!activate("search", false)) return;
    const side = sideOf("search") || "left";
    if (isPhone()) {
      if (NB.mobile && NB.mobile.openDrawer) NB.mobile.openDrawer();
    } else if (isCollapsed(side)) {
      expand(side);
    }
    const host = hostEl("search");
    const input = host && host.querySelector(".search-panel-input");
    if (!input) return;
    requestAnimationFrame(() => {
      try { input.focus(); input.select(); } catch (_) {}
    });
  }

  /* The boot view of one side: the data-view of the one .side-panel-view
   * host that panel has without `hidden`. Returns null when no host is
   * visible or the visible one is not a registered view, so the caller can
   * fall back to that side's first visible view instead of showing an
   * empty pane. */
  function shellViewId(side) {
    const st = sideState[normalizeSide(side)];
    if (!st || !st.panel) return null;
    const el = st.panel.querySelector(".side-panel-view:not([hidden])");
    if (!el) return null;
    const id = el.dataset.view;
    return views.some(v => v.id === id) ? id : null;
  }

  /* Adopt the shell paint for one side, or for both when called with no
   * argument. The server renders each side's saved active view visible, so
   * a reload lands on it with no flash; a side with nothing visible falls
   * back to its first visible view. */
  function adoptShellView(side) {
    if (side === "left" || side === "right") {
      adoptSide(normalizeSide(side));
      return;
    }
    SIDES.forEach(adoptSide);
    updateRightEmpty();
  }

  function adoptSide(side) {
    const st = sideState[side];
    if (!st || !st.panel) return;
    const shell = shellViewId(side);
    const visible = visibleOnSide(side);
    const target = (shell && !hiddenViews.has(shell) && sideOf(shell) === side)
      ? shell
      : (visible[0] && visible[0].id);
    if (target) {
      activate(target, false);
      return;
    }
    // Nothing to show on this side: hide its hosts. The panel's own
    // collapsed class is whatever the server painted -- adopting is not a
    // place to emit a collapse.
    st.activeId = null;
    st.panel.querySelectorAll(".side-panel-view").forEach(el => { el.hidden = true; });
    syncActiveClass();
  }

  /* The collapse glyph and title for one header button. The side is
   * resolved now, never captured: bookmarks.js, sessions.js, tabs-view.js,
   * sidebar.js and ai.js build their headers at load and never re-render on
   * a side change, so a captured side would leave a left-pointing chevron
   * and a left-panel collapse in the right panel forever. */
  const COLLAPSE_LABELS = { explorer: "files", outline: "outline" };

  function applyCollapseGlyph(btn, id) {
    if (!btn) return;
    const phone = isPhone();
    const side = sideOf(id);
    let glyph = "nb-icon-chevron-left";
    let title = "Collapse panel";
    if (phone) {
      glyph = "nb-icon-close";
      title = "Close panel";
    } else if (side === "right") {
      glyph = "nb-icon-chevron-right";
    }
    if (!phone) {
      const v = views.find(x => x.id === id);
      const name = COLLAPSE_LABELS[id] || (v && v.label) || id;
      title = "Collapse " + name;
    }
    btn.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#' +
      glyph + '"/></svg>';
    btn.title = title;
    btn.setAttribute("aria-label", title);
  }

  /* Re-glyph and re-title every header collapse button. Called by
   * register(), setSide() and applyLayout(): the side decides the glyph. */
  function refreshCollapseButtons() {
    document.querySelectorAll("[data-collapse-view]").forEach(btn => {
      applyCollapseGlyph(btn, btn.getAttribute("data-collapse-view"));
    });
  }

  /* A collapse button for a view header. The button carries its view id and
   * nothing else: the delegated listener installed on each panel resolves
   * the side at click time. Views that build their header at module load
   * (Recent, Search, Bookmarks, Sessions, Tabs, AI, Pinned) call this with
   * their id. */
  function makeCollapseBtn(id) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "collapse-btn";
    if (id) btn.dataset.collapseView = id;
    applyCollapseGlyph(btn, id);
    return btn;
  }

  /* One delegated listener per panel: every [data-collapse-view] inside it
   * collapses the panel that hosts the view at click time. The panels are
   * static template nodes, so this is installed once. */
  function installCollapseDelegates() {
    for (const side of SIDES) {
      const st = sideState[side];
      if (!st || !st.panel || st.panel.dataset.collapseBound) continue;
      st.panel.dataset.collapseBound = "1";
      st.panel.addEventListener("click", (e) => {
        const target = e.target;
        const btn = target && target.closest
          ? target.closest("[data-collapse-view]") : null;
        if (!btn || !st.panel.contains(btn)) return;
        const id = btn.getAttribute("data-collapse-view");
        if (id) collapse(sideOf(id) || side);
      });
    }
  }

  /* Move a view to the other side (§7.3). The host node is moved with
   * appendChild -- never rebuilt, because its content was built at module
   * load and its module holds element references. Returns the applied side. */
  function setSide(id, side) {
    const v = views.find(x => x.id === id);
    if (!v) return null;
    const next = side === "right" ? "right" : "left";
    const prev = v.side;
    if (prev === next) return next;
    sideMap[id] = next;
    v.side = next;
    const src = sideState[prev];
    const dst = sideState[next];
    const host = hostElAnywhere(id);
    // On the phone every host lives in the drawer panel; only the map and
    // the rails change.
    if (!isPhone() && host && dst && dst.panel) dst.panel.appendChild(host);
    // The mounted record follows the host: a moved view is never re-mounted.
    if (src && src.mounted.has(id)) {
      src.mounted.delete(id);
      if (dst) dst.mounted.add(id);
    }
    renderBar();
    refreshCollapseButtons();
    updateRightEmpty();
    if (isPhone()) return next;

    const wasActive = src && src.activeId === id;
    if (wasActive) {
      // The source side takes its first visible view, or empties and
      // collapses; the moved view becomes the destination's active view and
      // the destination expands (§7.3 steps 4-5).
      src.activeId = null;
      const remaining = visibleOnSide(prev);
      if (remaining.length) activate(remaining[0].id, false);
      else hideAllAndCollapse(prev);
      if (host) host.hidden = false;
      activate(id, false);
      expand(next);
    } else if (host && dst && dst.activeId !== id) {
      // It stays in the background: visible only if its new side already
      // shows it.
      host.hidden = true;
    }
    return next;
  }

  /* Lay the shell out for a mode. "phone": every host, whatever its home,
   * moves into #side-panel so the drawer can show it, exactly one stays
   * visible, and the drawer status row is re-appended last. "desktop": each
   * host returns to its side's panel and that panel shows its active view. */
  function applyLayout(mode) {
    const phone = mode === "phone";
    for (const v of views) {
      const host = hostElAnywhere(v.id);
      if (!host) continue;
      const target = phone ? panelEl : (sideState[v.side] && sideState[v.side].panel);
      if (target && host.parentNode !== target) target.appendChild(host);
    }
    if (phone) {
      let keep = null;
      if (lastActiveId && !hiddenViews.has(lastActiveId) &&
          PHONE_OFF_VIEWS.indexOf(lastActiveId) < 0) {
        keep = lastActiveId;
      }
      if (!keep) {
        const first = phoneViews()[0];
        keep = first ? first.id : null;
      }
      if (panelEl) {
        panelEl.querySelectorAll(".side-panel-view").forEach(el => {
          el.hidden = el.dataset.view !== keep;
        });
      }
      if (keep) {
        lastActiveId = keep;
        const v = views.find(x => x.id === keep);
        if (v) {
          const home = sideState[v.side];
          if (home) home.activeId = keep;
          mountView(v);
        }
      }
      // mobile.js appends the drawer status row into the panel; the host
      // moves above must not leave it in the middle of the stack.
      const status = document.getElementById("mobile-drawer-status");
      if (status && status.parentNode === panelEl) panelEl.appendChild(status);
    } else {
      for (const side of SIDES) {
        const st = sideState[side];
        if (!st || !st.panel) continue;
        if (st.activeId &&
            (hiddenViews.has(st.activeId) || sideOf(st.activeId) !== side)) {
          st.activeId = null;
        }
        st.panel.querySelectorAll(".side-panel-view").forEach(el => {
          el.hidden = el.dataset.view !== st.activeId;
        });
      }
    }
    renderBar();
    refreshCollapseButtons();
    updateRightEmpty();
  }

  /* hostEl() resolves the panel from the view's side, which is wrong mid
   * move; applyLayout needs the node wherever it currently is. */
  function hostElAnywhere(id) {
    for (const side of SIDES) {
      const st = sideState[side];
      const host = st && st.panel
        ? st.panel.querySelector('.side-panel-view[data-view="' + id + '"]')
        : null;
      if (host) return host;
    }
    return panelEl
      ? panelEl.querySelector('.side-panel-view[data-view="' + id + '"]')
      : null;
  }

  NB.activity = {
    register,
    activate,
    setSide,
    sideOf,
    collapse,
    expand,
    applyLayout,
    openSearch,
    getActive,
    isCollapsed,
    isViewVisible,
    makeCollapseBtn,
    refreshCollapseButtons,
    views: () => views.map(v => v.id),
    // Every view in bar order, with its hidden flag and its side. Settings
    // lists all rows so a hidden view can be unhidden, and each row shows
    // which rail the view lives on.
    barItems: () => orderedViews().map(v => ({
      id: v.id, label: v.label || v.id, icon: v.icon || "",
      hidden: hiddenViews.has(v.id), side: v.side,
    })),
    setBarOrder,
    setHidden,
    // The views the phone can host, or every visible view off the phone. A
    // caller picking "some view to show" must never land on one with no phone
    // surface (the Outline, AI).
    visible: () => (isPhone() ? phoneViews() : visibleViews()).map(v => v.id),
    visibleOnSide: (side) => visibleOnSide(normalizeSide(side)).map(v => v.id),
    // The rail is a slice of the saved order on the phone; the More sheet
    // lists the rest. Off the phone the phone list is every visible view
    // and the off-rail list is empty. railViews(side) is one rail's icons;
    // with no side it is the left rail, which on the phone is the only one.
    railViews: (side) => railViews(normalizeSide(side)),
    offRailViews,
    adoptShellView,
  };
  installCollapseDelegates();

  /* --- Recent / Quick open view -------------------------------------- */
  /* A side-panel view listing recently edited files with a fuzzy filter.
   * Reads from cfg.recentFiles (kept up-to-date by app.js on every file
   * open and re-keyed on a rename/move) and re-renders on every activation
   * so a stale list isn't shown. The filter input lives at the top of the
   * view; the list below it updates as the user types. Enter opens the top
   * match.
   *
   * Mount is lazy: the host is empty until the first time the Recent
   * icon is activated, so the view costs nothing until the user asks
   * for it. State (filter text) is preserved across view switches by
   * virtue of the host staying in the DOM once mounted.
   */
  function mountRecent(host) {
    host.innerHTML = "";
    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "Recent";
    header.appendChild(title);
    header.appendChild(makeCollapseBtn("recent"));
    host.appendChild(header);

    const strip = document.createElement("div");
    strip.className = "recent-strip";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "recent-filter";
    input.placeholder = "Filter recent files…  (Enter to open top match)";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-label", "Filter recent files");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "recent-list");
    strip.appendChild(input);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "recent-clear";
    clear.setAttribute("aria-label", "Clear recent filter");
    clear.title = "Clear filter";
    clear.textContent = "×";
    clear.hidden = true;
    clear.addEventListener("click", () => {
      input.value = "";
      selectedIdx = 0;
      renderList();
      input.focus();
    });
    strip.appendChild(clear);
    host.appendChild(strip);

    const list = document.createElement("div");
    list.className = "recent-list";
    list.id = "recent-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Recent files");
    host.appendChild(list);

    let selectedIdx = 0;

    function currentItems() {
      const q = (input.value || "").trim().toLowerCase();
      const recent = (NB.app && NB.app.getCfg && NB.app.getCfg().recentFiles) || [];
      if (!q) return recent.slice();
      // Simple fuzzy: every char of the query must appear in order in
      // the path. Matches the path case-insensitively so "notes/a.md"
      // is hit by "na". Good enough for a single-user notebook with a
      // few dozen recents; avoids pulling in a fuzzy lib.
      return recent.filter(p => {
        let i = 0;
        for (const ch of p.toLowerCase()) {
          if (ch === q[i]) i++;
          if (i >= q.length) return true;
        }
        return false;
      });
    }

    function renderList() {
      const items = currentItems();
      list.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "recent-empty";
        empty.textContent = "No recent files match.";
        list.appendChild(empty);
        selectedIdx = 0;
        return;
      }
      items.forEach((p, idx) => {
        const row = document.createElement("div");
        row.className = "recent-row" + (idx === selectedIdx ? " selected" : "");
        row.dataset.path = p;
        row.id = "recent-option-" + idx;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", idx === selectedIdx ? "true" : "false");
        const name = document.createElement("span");
        name.className = "recent-name";
        name.textContent = baseName(p);
        const dir = document.createElement("span");
        dir.className = "recent-dir";
        dir.textContent = parentOf(p);
        row.append(name, dir);
        row.addEventListener("click", () => openFile(p));
        row.addEventListener("mouseenter", () => {
          selectedIdx = idx;
          list.querySelectorAll(".recent-row").forEach((r, i) =>
            r.classList.toggle("selected", i === selectedIdx));
        });
        list.appendChild(row);
      });
      if (selectedIdx >= items.length) selectedIdx = 0;
      clear.hidden = !input.value;
      const active = items[selectedIdx] ? "recent-option-" + selectedIdx : "";
      if (active) input.setAttribute("aria-activedescendant", active);
      else input.removeAttribute("aria-activedescendant");
    }

    function openFile(path) {
      if (!path) return;
      NB.evt.emit("file:open-request", path);
    }
    function baseName(p) { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
    function parentOf(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }

    input.addEventListener("input", () => {
      selectedIdx = 0;
      clear.hidden = !input.value;
      renderList();
    });
    input.addEventListener("keydown", (e) => {
      const items = currentItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIdx = Math.min(items.length - 1, selectedIdx + 1);
        renderList();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIdx = Math.max(0, selectedIdx - 1);
        renderList();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const p = items[selectedIdx];
        if (p) openFile(p);
      }
    });

    // Render on every activation so a stale list isn't shown. The host
    // stays in the DOM (so the filter input keeps its text), but the
    // list re-reads recentFiles each time the view becomes active.
    NB.evt.on("activity:changed", () => {
      if (isViewVisible("recent")) renderList();
    });
    NB.evt.on("file:open", () => {
      if (isViewVisible("recent")) renderList();
    });

    renderList();
    // Focus the filter the first time the view mounts so the user can
    // type immediately.
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
  }

  /* --- Search view (side panel) ------------------------------------- */
  /* A self-contained search panel in the side panel: its own input,
   * case-toggle, and results list. Clicking a hit opens the file and
   * jumps to the match via NB.viewer.jumpToMatch.
   *
   * Mount is lazy: the host is empty until the first time the Search
   * icon is activated. The query + case state survive view switches
   * because the host stays in the DOM once mounted.
   */
  function mountSearch(host) {
    host.innerHTML = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "Search";
    header.appendChild(title);
    header.appendChild(makeCollapseBtn("search"));
    host.appendChild(header);

    const inputRow = document.createElement("div");
    inputRow.className = "search-panel-input-row";
    const inputWrap = document.createElement("div");
    inputWrap.className = "search-panel-input-wrap";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "search-panel-input";
    input.placeholder = "Search notebooks…";
    input.setAttribute("aria-label", "Search notebooks");
    inputWrap.appendChild(input);
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "search-panel-clear";
    clearBtn.setAttribute("aria-label", "Clear search");
    clearBtn.title = "Clear search";
    clearBtn.hidden = true;
    const clearSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    clearSvg.setAttribute("viewBox", "0 0 12 12");
    clearSvg.setAttribute("aria-hidden", "true");
    clearSvg.setAttribute("focusable", "false");
    const clearPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    clearPath.setAttribute("d", "M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5");
    clearPath.setAttribute("fill", "none");
    clearPath.setAttribute("stroke", "currentColor");
    clearPath.setAttribute("stroke-width", "1.5");
    clearPath.setAttribute("stroke-linecap", "round");
    clearSvg.appendChild(clearPath);
    clearBtn.appendChild(clearSvg);
    inputWrap.appendChild(clearBtn);
    inputRow.append(inputWrap);
    syncClear();

    const controls = document.createElement("div");
    controls.className = "search-panel-controls";
    controls.appendChild(inputRow);

    const filters = document.createElement("div");
    filters.className = "search-panel-filters";
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Search filters");

    const targetFilter = document.createElement("div");
    targetFilter.className = "search-panel-filter";
    const targetFilterLabel = document.createElement("span");
    targetFilterLabel.className = "search-panel-filter-label";
    targetFilterLabel.textContent = "Search in";

    const targetGroup = document.createElement("div");
    targetGroup.className = "search-panel-mode";
    targetGroup.setAttribute("role", "radiogroup");
    targetGroup.setAttribute("aria-label", "Search in");
    const mode = document.createElement("div");
    mode.className = "search-panel-mode";
    mode.setAttribute("role", "radiogroup");
    mode.setAttribute("aria-label", "Result grouping");
    function addModeOption(group, radioName, value, text) {
      const opt = document.createElement("label");
      opt.className = "search-panel-mode-opt";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = radioName;
      radio.value = value;
      const span = document.createElement("span");
      span.textContent = text;
      opt.append(radio, span);
      group.appendChild(opt);
      return radio;
    }
    const contentRadio = addModeOption(
      targetGroup, "search-panel-target", "content", "Content");
    const nameRadio = addModeOption(
      targetGroup, "search-panel-target", "name", "File name");
    const allRadio = addModeOption(
      mode, "search-panel-mode", "all", "All matches");
    const uniqueRadio = addModeOption(
      mode, "search-panel-mode", "unique", "One per note");

    const groupFilter = document.createElement("div");
    groupFilter.className = "search-panel-filter";
    groupFilter.id = "search-group-filter";
    const groupFilterLabel = document.createElement("span");
    groupFilterLabel.className = "search-panel-filter-label";
    groupFilterLabel.textContent = "Grouping";

    const sortFilter = document.createElement("div");
    sortFilter.className = "search-panel-filter search-panel-filter--sort";
    const sortLabel = document.createElement("label");
    sortLabel.className = "search-panel-filter-label";
    sortLabel.htmlFor = "search-panel-sort";
    sortLabel.textContent = "Sort";
    const sortSelect = document.createElement("select");
    sortSelect.id = "search-panel-sort";
    sortSelect.className = "search-panel-select";
    [
      ["path", "Path (A–Z)"],
      ["mtime", "Recently modified"],
      ["count", "Most matches"],
    ].forEach(([value, text]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      sortSelect.appendChild(opt);
    });
    const countOption = sortSelect.querySelector('option[value="count"]');

    const caseToggle = document.createElement("label");
    caseToggle.className = "search-panel-case";
    caseToggle.title = "Case sensitive";
    const caseCb = document.createElement("input");
    caseCb.type = "checkbox";
    caseCb.setAttribute("aria-label", "Case sensitive");
    const caseLabel = document.createElement("span");
    caseLabel.textContent = "Aa";
    caseToggle.append(caseCb, caseLabel);

    const caseFilter = document.createElement("div");
    caseFilter.className = "search-panel-filter search-panel-filter--case";
    const caseFilterLabel = document.createElement("span");
    caseFilterLabel.className = "search-panel-filter-label";
    caseFilterLabel.textContent = "Match case";

    targetFilter.append(targetFilterLabel, targetGroup);
    groupFilter.append(groupFilterLabel, mode);
    caseFilter.append(caseFilterLabel, caseToggle);
    sortFilter.append(sortLabel, sortSelect);
    filters.append(targetFilter, groupFilter, caseFilter, sortFilter);

    const advancedRow = document.createElement("div");
    advancedRow.className = "search-panel-advanced-row";
    const advancedBtn = document.createElement("button");
    advancedBtn.type = "button";
    advancedBtn.className = "search-panel-advanced-toggle";
    advancedBtn.setAttribute("aria-expanded", "false");
    advancedBtn.setAttribute("aria-controls", "search-panel-advanced");
    const advancedLabel = document.createElement("span");
    advancedLabel.className = "search-panel-advanced-label";
    advancedLabel.textContent = "Advanced";
    const advancedBadge = document.createElement("span");
    advancedBadge.className = "search-panel-advanced-badge";
    advancedBadge.setAttribute("aria-hidden", "true");
    const advancedChevron = document.createElement("span");
    advancedChevron.className = "search-panel-advanced-chevron";
    advancedChevron.setAttribute("aria-hidden", "true");
    advancedBtn.append(advancedLabel, advancedBadge, advancedChevron);
    const advancedSummary = document.createElement("span");
    advancedSummary.className = "search-panel-advanced-summary";
    advancedSummary.id = "search-panel-advanced-summary";
    advancedRow.append(advancedBtn, advancedSummary);

    const advanced = document.createElement("div");
    advanced.className = "search-panel-advanced";
    advanced.id = "search-panel-advanced";
    advanced.hidden = true;
    advanced.appendChild(filters);

    controls.append(advancedRow, advanced);
    host.appendChild(controls);

    const summary = document.createElement("div");
    summary.className = "search-panel-summary";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.setAttribute("aria-atomic", "true");
    const summaryText = document.createElement("span");
    summaryText.className = "search-panel-summary-text";
    summary.appendChild(summaryText);
    host.appendChild(summary);

    const note = document.createElement("div");
    note.className = "search-panel-note";
    note.hidden = true;
    host.appendChild(note);

    const list = document.createElement("div");
    list.className = "search-panel-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Search results");
    list.setAttribute("aria-busy", "false");
    host.appendChild(list);

    let debounceTimer = null;
    // Latest-response-wins: every run (and every clear) bumps the token;
    // a response whose token is stale is discarded.
    let requestToken = 0;
    let activeIdx = 0;
    let visibleRows = [];
    let visibleQuery = "";
    let visibleCase = false;
    let visibleTarget = "content";
    let caseSensitive = searchPrefCase();
    let unique = searchPrefUnique();
    let sort = searchPrefSort();
    let target = searchPrefTarget();
    let advancedOpen = false;
    let focusFirstPending = false;
    let pendingCaseRerun = false;
    // api.js emits auth:required on 401 before rejecting. The diff lets the
    // panel discard that response without showing it as a search error.
    let authFailures = 0;
    // Set whenever the user changes a control, so a config load that lands
    // later does not revert it.
    const userChanged = { case: false, unique: false, sort: false, target: false };

    function normalizeSort(value) {
      const valid = Array.from(sortSelect.options, (opt) => opt.value);
      return valid.indexOf(value) >= 0 ? value : searchPrefSort();
    }

    // File-name mode has no match counts, so grouping is hidden and the
    // count sort is unavailable; demote a stored count sort to path.
    function setAdvancedOpen(open) {
      advancedOpen = !!open;
      advanced.hidden = !advancedOpen;
      advancedBtn.setAttribute("aria-expanded", advancedOpen ? "true" : "false");
    }

    function advancedSummaryText() {
      const parts = [];
      if (target === "name") parts.push("File name");
      if (caseSensitive) parts.push("Match case");
      if (target !== "name" && !unique) parts.push("All matches");
      if (sort !== "path") {
        const opt = sortSelect.options[sortSelect.selectedIndex];
        if (opt) parts.push(opt.textContent);
      }
      return parts.join(" · ");
    }

    // Collapsed options still apply; the summary (or the narrow badge) makes
    // a non-default state visible while the controls are hidden.
    function syncAdvancedSummary() {
      const text = advancedSummaryText();
      const active = text !== "";
      let count = 0;
      if (target === "name") count += 1;
      if (caseSensitive) count += 1;
      if (target !== "name" && !unique) count += 1;
      if (sort !== "path") count += 1;

      advancedSummary.textContent = text;
      advancedSummary.title = text;
      advancedBadge.textContent = active ? String(count) : "";
      advancedRow.classList.toggle("has-nondefault", active);
      if (active) {
        advancedBtn.setAttribute("aria-describedby", advancedSummary.id);
        advancedBtn.title = "Search options: " + text;
      } else {
        advancedBtn.removeAttribute("aria-describedby");
        advancedBtn.removeAttribute("title");
      }
    }

    function applyTargetUi() {
      const isName = target === "name";
      filters.classList.toggle("is-name", isName);
      groupFilter.classList.toggle("is-hidden", isName);
      mode.classList.toggle("is-hidden", isName);
      countOption.disabled = isName;
      if (isName && sort === "count") {
        sort = "path";
        sortSelect.value = sort;
        userChanged.sort = true;
        if (NB.app && NB.app.setSearchSort) NB.app.setSearchSort(sort);
      }
      syncSortTitle();
      syncAdvancedSummary();
    }

    // A narrow select clips its label; mirror the selected option so the
    // full text is still reachable on hover.
    function syncSortTitle() {
      const opt = sortSelect.options[sortSelect.selectedIndex];
      sortSelect.title = opt ? opt.textContent : "";
    }

    function syncControls() {
      contentRadio.checked = target !== "name";
      nameRadio.checked = target === "name";
      allRadio.checked = !unique;
      uniqueRadio.checked = unique;
      sortSelect.value = sort;
      caseCb.checked = caseSensitive;
      applyTargetUi();
    }

    function applyConfigSync(cfg, loaded) {
      if (!cfg) return;
      if (!loaded || !userChanged.case) {
        caseSensitive = !!cfg.searchCaseSensitive;
        caseCb.checked = caseSensitive;
      }
      if (!loaded || !userChanged.unique) {
        unique = (typeof cfg.searchUnique === "boolean")
          ? cfg.searchUnique : searchPrefUnique();
        allRadio.checked = !unique;
        uniqueRadio.checked = unique;
      }
      if (!loaded || !userChanged.target) {
        target = (cfg.searchTarget === "name") ? "name" : "content";
        contentRadio.checked = target !== "name";
        nameRadio.checked = target === "name";
      }
      if (!loaded || !userChanged.sort) {
        sort = normalizeSort(cfg.searchSort);
        sortSelect.value = sort;
      }
      applyTargetUi();
      // The load replaced cfg with the server blob. Re-apply anything the
      // user changed while the fetch was in flight so it is also persisted,
      // not just left visible in a control.
      if (loaded) {
        if (userChanged.unique && NB.app && NB.app.setSearchUnique) {
          NB.app.setSearchUnique(unique);
        }
        if (userChanged.sort && NB.app && NB.app.setSearchSort) {
          NB.app.setSearchSort(sort);
        }
        if (userChanged.target && NB.app && NB.app.setSearchTarget) {
          NB.app.setSearchTarget(target);
        }
        if (userChanged.case) NB.evt.emit("search-case-changed", caseSensitive);
      }
    }

    function plural(n, one, many) {
      return n + " " + (n === 1 ? one : many);
    }

    function summaryFor(matches, isUnique, truncated, perFileTruncated, timedOut) {
      const n = matches.length;
      let s;
      if (isUnique) {
        if (truncated) {
          s = plural(n, "note", "notes") + " shown — more results exist";
        } else {
          let total = 0;
          matches.forEach(m => {
            total += (typeof m.count === "number" && isFinite(m.count) && m.count >= 0)
              ? m.count : 1;
          });
          s = plural(n, "note", "notes") + " · " +
            plural(total, "match", "matches");
        }
      } else {
        const paths = new Set(matches.map(m => m.file));
        if (truncated) {
          s = plural(n, "match", "matches") + " shown — more results exist";
        } else {
          s = plural(n, "match", "matches") + " in " +
            plural(paths.size, "note", "notes");
        }
        if (perFileTruncated) s += " · some notes have more matches";
      }
      return timedOut ? s + " · " + SEARCH_TIMEOUT_SUFFIX : s;
    }

    function summaryForNames(matches, truncated, timedOut) {
      const n = matches.length;
      let s = plural(n, "note", "notes");
      if (truncated) s += " shown — more results exist";
      return timedOut ? s + " · " + SEARCH_TIMEOUT_SUFFIX : s;
    }

    function clearSummaryActions() {
      summary.querySelectorAll(".search-panel-retry").forEach(el => el.remove());
    }

    function setSummary(text) {
      summary.setAttribute("role", "status");
      summary.setAttribute("aria-live", "polite");
      summary.classList.remove("error");
      clearSummaryActions();
      summaryText.textContent = text;
      summaryText.classList.toggle("is-incomplete", text.includes(SEARCH_TIMEOUT_SUFFIX));
      summary.title = text;
    }

    function setSummaryError(text) {
      summary.setAttribute("role", "alert");
      summary.setAttribute("aria-live", "assertive");
      summary.classList.add("error");
      clearSummaryActions();
      summaryText.textContent = text;
      summary.title = text;
    }

    function setListBusy(busy) {
      list.setAttribute("aria-busy", busy ? "true" : "false");
      list.classList.toggle("is-loading", busy);
    }

    function setIdle() {
      requestToken++;
      clearTimeout(debounceTimer);
      debounceTimer = null;
      focusFirstPending = false;
      setSummary("");
      note.hidden = true;
      note.textContent = "";
      list.innerHTML = "";
      setListBusy(false);
      visibleRows = [];
      visibleQuery = "";
      visibleCase = false;
      activeIdx = 0;
    }

    function runSearch(opts) {
      opts = opts || {};
      clearTimeout(debounceTimer);
      debounceTimer = null;
      const q = input.value.trim();
      if (!q) { setIdle(); return; }
      const token = ++requestToken;
      focusFirstPending = !!opts.focusFirst;
      const runCase = caseSensitive;
      const runUnique = unique;
      const runSort = sort;
      const runTarget = target;
      const authBefore = authFailures;
      setSummary("Searching…");
      setListBusy(true);
      NB.api.search(q, {
        caseSensitive: runCase,
        unique: runTarget === "name" ? false : runUnique,
        name: runTarget === "name",
        order: runSort,
        desc: runSort !== "path",
      }).then(data => {
        if (token !== requestToken) return;
        if (authFailures !== authBefore) {
          focusFirstPending = false;
          setListBusy(false);
          setSummary("");
          return;
        }
        renderResults(data, q, runCase, runUnique, runTarget);
      }).catch(e => {
        if (token !== requestToken) return;
        if (authFailures !== authBefore) {
          focusFirstPending = false;
          setListBusy(false);
          setSummary("");
          return;
        }
        showSearchError(e && e.message ? e.message : "Request failed");
      });
    }

    /* Failure keeps the query and any results already on screen; Retry
     * re-runs the same query once. */
    function showSearchError(message) {
      focusFirstPending = false;
      setListBusy(false);
      setSummaryError("Search error: " + message + " ");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "search-panel-retry";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => {
        if (retry.disabled) return;
        retry.disabled = true;
        runSearch();
      });
      summary.appendChild(retry);
    }

    function showOpenError(path) {
      setSummaryError(
        "Could not open “" + path + "”. It may have been moved or deleted. ");
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "search-panel-retry";
      refresh.textContent = "Refresh results";
      refresh.addEventListener("click", () => {
        if (refresh.disabled) return;
        refresh.disabled = true;
        runSearch();
      });
      summary.appendChild(refresh);
    }

    function renderResults(data, q, runCase, isUnique, runTarget) {
      const isName = runTarget === "name";
      const matches = Array.isArray(data && data.matches) ? data.matches : [];
      const truncated = !!(data && data.truncated);
      const perFileTruncated = !!(data && data.perFileTruncated);
      const timedOut = !!(data && data.timedOut);
      const hadFocus = list.contains(document.activeElement);
      list.innerHTML = "";
      setListBusy(false);
      note.hidden = true;
      note.textContent = "";

      if (!matches.length) {
        // An empty result from a stopped scan is not a clean "no hits", so
        // the summary still carries the incomplete-scan caveat.
        setSummary((isName ? "0 notes" : "0 matches") +
          (timedOut ? " · " + SEARCH_TIMEOUT_SUFFIX : ""));
        const empty = document.createElement("div");
        empty.className = "search-panel-empty search-panel-state";
        empty.setAttribute("role", "presentation");
        empty.textContent = "No matches found.";
        list.appendChild(empty);
        // A wrong Content/File name choice looks like "no such note"; offer
        // the other mode instead of a dead end.
        const alt = document.createElement("button");
        alt.type = "button";
        alt.className = "search-panel-retry search-panel-empty-action";
        alt.textContent = isName
          ? "Search content instead"
          : "Search file names instead";
        alt.addEventListener("click", () => {
          target = isName ? "content" : "name";
          contentRadio.checked = target === "content";
          nameRadio.checked = target === "name";
          userChanged.target = true;
          applyTargetUi();
          if (NB.app && NB.app.setSearchTarget) NB.app.setSearchTarget(target);
          runSearch();
        });
        note.textContent = "";
        note.appendChild(alt);
        note.hidden = false;
        visibleRows = [];
        visibleQuery = q;
        visibleCase = runCase;
        visibleTarget = runTarget;
        activeIdx = 0;
        focusFirstPending = false;
        return;
      }

      setSummary(isName
        ? summaryForNames(matches, truncated, timedOut)
        : summaryFor(matches, isUnique, truncated, perFileTruncated, timedOut));
      if (isUnique && !isName) {
        note.textContent = "Click a row to open its first match.";
        note.hidden = false;
      }

      matches.forEach((m, idx) => {
        const hit = document.createElement("button");
        hit.type = "button";
        hit.className = "search-panel-hit";
        hit.setAttribute("role", "option");
        hit.setAttribute("aria-selected", "false");
        hit.tabIndex = -1;
        if (m.line != null) hit.dataset.line = String(m.line);

        const fileLine = document.createElement("span");
        fileLine.className = "search-panel-hit-file";
        const pathWrap = document.createElement("span");
        pathWrap.className = "search-panel-path";
        pathWrap.title = m.file;
        const fSpan = document.createElement("span");
        fSpan.className = "sp-file";
        const parts = hitPathParts(m.file);
        fSpan.textContent = parts.name;
        pathWrap.appendChild(fSpan);
        if (parts.dir) {
          const dirSpan = document.createElement("span");
          dirSpan.className = "sp-dir";
          dirSpan.textContent = " (" + parts.dir + ")";
          pathWrap.appendChild(dirSpan);
        }
        fileLine.appendChild(pathWrap);

        // File-name rows are one note each: no count, line label, or snippet.
        if (!isName) {
          if (isUnique) {
            if (typeof m.count === "number" && isFinite(m.count) &&
                m.count >= 0) {
              const count = document.createElement("span");
              count.className = "sp-count";
              count.textContent = plural(m.count, "match", "matches");
              count.title = "total occurrences in this note";
              fileLine.appendChild(count);
            }
          } else {
            const mSpan = document.createElement("span");
            mSpan.className = "sp-meta";
            mSpan.textContent = "line " + m.line;
            fileLine.appendChild(mSpan);
          }

          const snip = document.createElement("span");
          snip.className = "search-panel-hit-snippet";
          snip.appendChild(buildSnippet(m.snippet));
          hit.append(fileLine, snip);
        } else {
          hit.appendChild(fileLine);
        }
        if (isUnique && !isName) {
          const sr = document.createElement("span");
          sr.className = "search-panel-sr";
          sr.textContent = "Opens at the first match.";
          hit.appendChild(sr);
        }
        hit.addEventListener("click", () => {
          activeIdx = idx;
          applyActive();
          openHit(m, q, runCase, runTarget);
        });
        list.appendChild(hit);
      });

      visibleRows = matches;
      visibleQuery = q;
      visibleCase = runCase;
      visibleTarget = runTarget;
      activeIdx = 0;
      applyActive();
      if (hadFocus || focusFirstPending) focusRow(0);
      focusFirstPending = false;
    }

    function buildSnippet(snippet) {
      const frag = document.createDocumentFragment();
      const parts = String(snippet == null ? "" : snippet).split(/(<<|>>)/);
      let inMatch = false;
      parts.forEach(part => {
        if (part === "<<") { inMatch = true; return; }
        if (part === ">>") { inMatch = false; return; }
        if (inMatch) {
          const mark = document.createElement("mark");
          mark.textContent = part;
          frag.appendChild(mark);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      });
      return frag;
    }

    function applyActive() {
      const rows = list.querySelectorAll(".search-panel-hit");
      if (!rows.length) return;
      activeIdx = Math.max(0, Math.min(activeIdx, rows.length - 1));
      rows.forEach((row, i) => {
        const on = i === activeIdx;
        row.classList.toggle("is-active", on);
        row.tabIndex = on ? 0 : -1;
        row.setAttribute("aria-selected", on ? "true" : "false");
      });
      const el = rows[activeIdx];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }

    function focusRow(idx) {
      const rows = list.querySelectorAll(".search-panel-hit");
      if (!rows.length) return;
      activeIdx = Math.max(0, Math.min(idx, rows.length - 1));
      applyActive();
      try { rows[activeIdx].focus({ preventScroll: true }); }
      catch (_) { rows[activeIdx].focus(); }
    }

    async function openHit(m, q, runCase, runTarget) {
      const wasOpen = !!(NB.tabs && NB.tabs.isOpen && NB.tabs.isOpen(m.file));
      let failed = false;
      try {
        if (NB.tabs) await NB.tabs.open(m.file);
        else if (NB.viewer) await NB.viewer.activate(m.file);
      } catch (_) {
        failed = true;
      }
      // tabs.open swallows a failed read and drops the new tab; checking
      // isOpen catches that without turning the failure into a rejection.
      if (!failed && NB.tabs && NB.tabs.isOpen && !NB.tabs.isOpen(m.file)) {
        failed = true;
      }
      if (failed) {
        if (!wasOpen && NB.tabs && NB.tabs.isOpen && NB.tabs.isOpen(m.file) &&
            NB.tabs.close) {
          try { NB.tabs.close(m.file, { force: true }); } catch (_) {}
        }
        if (wasOpen && NB.tabs && NB.tabs.isOpen && !NB.tabs.isOpen(m.file) &&
            NB.tabs.open) {
          try { await NB.tabs.open(m.file, { activate: false }); } catch (_) {}
        }
        showOpenError(m.file);
        return;
      }
      requestAnimationFrame(() => {
        if (runTarget !== "name" && NB.viewer && NB.viewer.jumpToMatch) {
          NB.viewer.jumpToMatch(q, runCase);
        }
      });
    }

    /* "Is the Search view on screen?" It used to compare the active view id
     * with "search"; with two panels, active no longer means visible, so ask
     * the registry and keep the drawer check the phone needs. */
    function panelVisible() {
      if (!isViewVisible("search")) return false;
      if (NB.mobile && NB.mobile.isOn && NB.mobile.isOn() &&
          NB.mobile.isDrawerOpen && !NB.mobile.isDrawerOpen()) {
        return false;
      }
      return true;
    }

    advancedBtn.addEventListener("click", () => {
      setAdvancedOpen(!advancedOpen);
      if (advancedOpen && NB.mobile && NB.mobile.isOn && NB.mobile.isOn()) {
        try { input.blur(); } catch (_) {}
      }
    });
    advanced.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setAdvancedOpen(false);
        advancedBtn.focus();
      }
    });

    function syncClear() {
      clearBtn.hidden = input.value.trim() === "";
    }

    function clearQuery() {
      input.value = "";
      setIdle();
      syncClear();
    }

    clearBtn.addEventListener("pointerdown", (e) => e.preventDefault());
    clearBtn.addEventListener("click", () => {
      clearQuery();
      input.focus();
    });

    input.addEventListener("input", () => {
      syncClear();
      clearTimeout(debounceTimer);
      if (!input.value.trim()) { setIdle(); return; }
      debounceTimer = setTimeout(runSearch, 250);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch({ focusFirst: true });
      } else if (e.key === "Escape") {
        if (input.value.trim()) {
          e.preventDefault();
          e.stopPropagation();
          clearQuery();
        }
      }
    });

    list.addEventListener("keydown", (e) => {
      const rows = list.querySelectorAll(".search-panel-hit");
      if (!rows.length) {
        if (e.key === "Escape") {
          e.preventDefault();
          input.focus();
          input.select();
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          focusRow(activeIdx + 1);
          return;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          focusRow(activeIdx - 1);
          return;
        case "Home":
          e.preventDefault();
          focusRow(0);
          return;
        case "End":
          e.preventDefault();
          focusRow(rows.length - 1);
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          if (visibleRows[activeIdx]) {
            openHit(visibleRows[activeIdx], visibleQuery, visibleCase,
              visibleTarget);
          }
          return;
        case "Escape":
          e.preventDefault();
          input.focus();
          input.select();
          return;
      }
    });

    targetGroup.addEventListener("change", (e) => {
      if (!e.target || e.target.type !== "radio") return;
      target = nameRadio.checked ? "name" : "content";
      userChanged.target = true;
      applyTargetUi();
      if (NB.app && NB.app.setSearchTarget) NB.app.setSearchTarget(target);
      if (input.value.trim()) runSearch();
    });
    mode.addEventListener("change", (e) => {
      if (!e.target || e.target.type !== "radio") return;
      unique = uniqueRadio.checked;
      userChanged.unique = true;
      syncAdvancedSummary();
      if (NB.app && NB.app.setSearchUnique) NB.app.setSearchUnique(unique);
      if (input.value.trim()) runSearch();
    });
    sortSelect.addEventListener("change", () => {
      sort = normalizeSort(sortSelect.value);
      sortSelect.value = sort;
      syncSortTitle();
      syncAdvancedSummary();
      userChanged.sort = true;
      if (NB.app && NB.app.setSearchSort) NB.app.setSearchSort(sort);
      if (input.value.trim()) runSearch();
    });
    caseCb.addEventListener("change", () => {
      caseSensitive = caseCb.checked;
      userChanged.case = true;
      syncAdvancedSummary();
      NB.evt.emit("search-case-changed", caseSensitive);
      if (input.value.trim()) runSearch();
    });

    NB.evt.on("config:changed", (cfg, meta) => {
      applyConfigSync(cfg, !!(meta && meta.loaded));
    });
    NB.evt.on("search-case-changed", (val) => {
      const next = !!val;
      const changed = next !== caseSensitive;
      caseSensitive = next;
      caseCb.checked = next;
      userChanged.case = true;
      syncAdvancedSummary();
      if (!changed || !input.value.trim()) return;
      if (panelVisible()) runSearch();
      else pendingCaseRerun = true;
    });
    NB.evt.on("activity:changed", (e) => {
      if (!e || e.id !== "search") return;
      if (pendingCaseRerun) {
        pendingCaseRerun = false;
        if (input.value.trim()) runSearch();
      }
    });
    NB.evt.on("auth:required", () => { authFailures++; });

    syncControls();
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
  }

  // A rotation or a resize across the breakpoint re-homes every host and
  // re-slices the rail; the module that mirrors the mode emits this once per
  // real change.
  NB.evt.on("mobile:mode", ({ mode }) => {
    applyLayout(mode === "phone" ? "phone" : "desktop");
  });

  /* --- register the built-in views ---------------------------------- */
  // Explorer is the default view; its host (#sidebar) already ships in
  // the HTML with the file tree wired by sidebar.js, so mount is a no-op.
  register({
    id: "explorer",
    icon: "nb-icon-explorer",
    label: "Explorer",
    mount: function () {},
  });
  // Sessions: the host (#sessions-view) ships empty; sessions.js populates
  // its header + list at load, so mount is not needed. Only [hidden] toggles
  // here.
  register({ id: "sessions", icon: "nb-icon-session", label: "Sessions" });
  // Pinned folders: the same pin rows the Explorer's inline top section
  // shows, mounted into their own pane on first activation.
  register({
    id: "pinned",
    icon: "nb-icon-pin",
    label: "Pinned folders",
    mount: function (host) {
      if (NB.sidebar && typeof NB.sidebar.mountPinnedView === "function") {
        NB.sidebar.mountPinnedView(host);
      }
    },
  });
  // Bookmarks: the host (#bookmarks-view) ships empty; bookmarks.js
  // populates its header + list at load, so mount is a no-op.
  register({
    id: "bookmarks",
    icon: "nb-icon-bookmark",
    label: "Bookmarks",
    mount: function () {},
  });
  register({
    id: "recent",
    icon: "nb-icon-clock",
    label: "Recent files",
    mount: mountRecent,
  });
  register({
    id: "search",
    icon: "nb-icon-search",
    label: "Search",
    mount: mountSearch,
  });
  register({
    id: "ai",
    icon: "nb-icon-ai",
    label: "AI Assistant",
    mount: function (host) {
      if (NB.ai && typeof NB.ai.mount === "function") NB.ai.mount(host);
    },
  });
  // Tabs: the open files of the active session as a list. The host
  // (#tabs-view) ships empty; tabs-view.js fills it at load, so mount is not
  // needed. Registered before the Outline so the phone rail keeps its six
  // slots and Tabs stays a More row until the user promotes it.
  register({ id: "tabs", icon: "nb-icon-tabs", label: "Tabs" });
  // Outline: the only view whose registration default is the right rail
  // (app.py's _VIEW_SIDES holds the same table). Its host ships populated by
  // the template -- #outline is resolved once by outline.js -- so mount is a
  // no-op, the Explorer pattern.
  register({
    id: "outline",
    icon: "nb-icon-outline",
    label: "Outline",
    side: "right",
    mount: function () {},
  });

  // Adopt the view the server rendered visible on each side so the first
  // frame is the saved view; fall back to that side's first visible view
  // when the shell shows none. Adopt first: applyLayout() re-hides hosts, so
  // it must run after the shell paint has been read. Then lay the shell out
  // for the current mode -- on the phone this moves every host into the
  // drawer.
  adoptShellView();
  applyLayout(isPhone() ? "phone" : "desktop");
  reconcileHiddenActive();
})();