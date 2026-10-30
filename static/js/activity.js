/* activity.js -- the left activity bar + side-panel view switcher.
 *
 * Owns the narrow vertical icon strip (#activity-bar) pinned to the
 * far-left edge and the #side-panel that hosts the currently-active
 * view. Each view registers via NB.activity.register({ id, icon, label,
 * mount }) and gets an icon button in the strip. Clicking an icon
 * activates that view (mounts it into the panel and shows it); clicking
 * the active icon again collapses the panel so only the strip remains.
 *
 * The bar is intentionally generic: the module adopts whichever
 * .side-panel-view host the server rendered visible as the boot view
 * (so a reload shows the saved view with no flash), falling back to
 * Explorer when none is visible. Further views (Pinned, Bookmarks,
 * Recent, Search, AI, future plugins) register the same way, so adding
 * a new side-panel function is a single NB.activity.register() call.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const barEl = document.getElementById("activity-bar");
  const panelEl = document.getElementById("side-panel");

  // A side-panel view can be adopted while this script evaluates, before
  // app.js defines NB.app. Read search prefs through these fallbacks; the
  // config:changed load event syncs the controls once app.js boots.
  const SEARCH_DEFAULTS = {
    unique: true, sort: "path", caseSensitive: false, target: "content",
  };
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
  //   { id, icon, label, mount(panelHostEl), unmount?() }
  // mount() is called the first time a view is activated and is expected
  // to populate its host element (the #side-panel child with
  // data-view=<id>). Subsequent activations just reveal it; mount is NOT
  // re-called. This preserves per-view state (scroll, selection, filter
  // text) across switches, mirroring how VS Code keeps each pane alive.
  const views = [];
  const mounted = new Set();
  // The currently-active view id. Null when the panel is collapsed (no
  // view is "active" while collapsed -- the icon strip is the only
  // visible chrome on the left).
  let activeId = null;

  function register(v) {
    if (!v || !v.id) return;
    // De-dupe by id: a second register with the same id replaces the
    // earlier entry so re-registration (e.g. a hot reload) doesn't
    // leave stale icons.
    const i = views.findIndex(x => x.id === v.id);
    if (i >= 0) views[i] = v; else views.push(v);
    renderBar();
  }

  function renderBar() {
    if (!barEl) return;
    // Render view icons into a dedicated container so the bottom-pinned
    // action buttons (settings) and the spacer stay untouched. Create
    // the container lazily on first render.
    let viewsEl = barEl.querySelector(".activity-bar-views");
    if (!viewsEl) {
      viewsEl = document.createElement("div");
      viewsEl.className = "activity-bar-views";
      barEl.insertBefore(viewsEl, barEl.firstChild);
    }
    viewsEl.innerHTML = "";
    for (const v of views) {
      const btn = document.createElement("button");
      btn.className = "activity-btn";
      btn.dataset.view = v.id;
      btn.title = v.label || v.id;
      btn.setAttribute("aria-label", v.label || v.id);
      const icon = document.createElement("span");
      icon.className = "activity-icon";
      icon.textContent = v.icon || "?";
      btn.appendChild(icon);
      btn.addEventListener("click", () => activate(v.id, /*toggle*/ true));
      viewsEl.appendChild(btn);
    }
    syncActiveClass();
  }

  function syncActiveClass() {
    if (!barEl) return;
    // Only view icons (those with data-view) get the active class; the
    // bottom-pinned action buttons have no data-view and stay neutral.
    barEl.querySelectorAll(".activity-btn[data-view]").forEach(b => {
      const on = b.dataset.view === activeId;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function hostEl(id) {
    return panelEl && panelEl.querySelector(
      '.side-panel-view[data-view="' + id + '"]');
  }

  function isPhone() {
    return !!(window.NB && NB.mobile && NB.mobile.isOn && NB.mobile.isOn());
  }

  function activate(id, toggle) {
    const v = views.find(x => x.id === id);
    if (!v) return;
    // Phone: the panel is a drawer. Tapping the active rail icon closes
    // it; activating any view opens it. Neither path touches the desktop
    // .collapsed state, the width var, or activity:collapsed/expanded.
    if (isPhone()) {
      if (toggle && activeId === id && NB.mobile && NB.mobile.isDrawerOpen &&
          NB.mobile.isDrawerOpen()) {
        NB.mobile.closeDrawer();
        return;
      }
      if (panelEl) {
        panelEl.querySelectorAll(".side-panel-view").forEach(el => {
          el.hidden = el.dataset.view !== id;
        });
      }
      activeId = id;
      if (!mounted.has(id)) {
        const host = hostEl(id);
        if (host && v.mount) {
          try { v.mount(host); } catch (e) { console.error("view mount failed", id, e); }
        }
        mounted.add(id);
      }
      syncActiveClass();
      NB.evt.emit("activity:changed", { id });
      if (toggle && NB.mobile && NB.mobile.openDrawer) NB.mobile.openDrawer();
      return;
    }
    // Clicking the already-active icon toggles the panel collapsed /
    // expanded (VS Code behavior). The active view is preserved across
    // the toggle so re-expanding returns to the same view.
    if (toggle && activeId === id && !panelEl.classList.contains("collapsed")) {
      collapse();
      return;
    }
    // Only a user toggle (icon click) may expand a collapsed panel. The
    // load-time adoptShellView() calls activate(id, false) while the
    // shell is already rendered with the saved collapsed state; expanding
    // here would flash the panel open and (once app.js has wired its
    // activity:expanded listener) persist the wrong sidebarCollapsed.
    if (toggle && panelEl.classList.contains("collapsed")) expand();
    // Hide every view's host, then show the target.
    if (panelEl) {
      panelEl.querySelectorAll(".side-panel-view").forEach(el => {
        el.hidden = el.dataset.view !== id;
      });
    }
    activeId = id;
    if (!mounted.has(id)) {
      const host = hostEl(id);
      if (host && v.mount) {
        try { v.mount(host); } catch (e) { console.error("view mount failed", id, e); }
      }
      mounted.add(id);
    }
    syncActiveClass();
    NB.evt.emit("activity:changed", { id });
  }

  function collapse() {
    if (isPhone()) {
      if (NB.mobile && NB.mobile.closeDrawer) NB.mobile.closeDrawer();
      return;
    }
    if (!panelEl) return;
    panelEl.classList.add("collapsed");
    document.documentElement.style.setProperty(
      "--side-panel-width", COLLAPSED_W + "px");
    // Keep activeId so the icon stays highlighted and re-expanding
    // returns to the same view. VS Code does the same: the active icon
    // stays lit while the panel is hidden.
    NB.evt.emit("activity:collapsed");
  }

  function expand() {
    if (isPhone()) {
      if (NB.mobile && NB.mobile.openDrawer) NB.mobile.openDrawer();
      return;
    }
    if (!panelEl) return;
    panelEl.classList.remove("collapsed");
    // Restore the saved width. app.js owns the canonical width value;
    // we read the CSS var it last set so the panel returns to the size
    // the user dragged it to.
    if (NB.app && NB.app.getSidePanelWidth) {
      const w = NB.app.getSidePanelWidth();
      document.documentElement.style.setProperty(
        "--side-panel-width", w + "px");
    }
    NB.evt.emit("activity:expanded");
  }

  function getActive() { return activeId; }
  function isCollapsed() {
    return panelEl && panelEl.classList.contains("collapsed");
  }

  /* Open the side-panel Search view and focus its input. Used by the
   * app-level openSearch shortcut and the shell VIM keymap. Activating
   * an already-mounted view only reveals it, so focus is applied here
   * rather than only in mountSearch. */
  function openSearch() {
    activate("search", false);
    if (isPhone()) {
      if (NB.mobile && NB.mobile.openDrawer) NB.mobile.openDrawer();
    } else if (isCollapsed()) {
      expand();
    }
    const host = hostEl("search");
    const input = host && host.querySelector(".search-panel-input");
    if (!input) return;
    requestAnimationFrame(() => {
      try { input.focus(); input.select(); } catch (_) {}
    });
  }

  // The boot view is the data-view of the one .side-panel-view host the
  // server rendered without `hidden`. Returns null when no host is
  // visible or the visible one is not a registered view, so the caller
  // can fall back to Explorer instead of showing an empty pane.
  function shellViewId() {
    if (!panelEl) return null;
    const el = panelEl.querySelector(".side-panel-view:not([hidden])");
    if (!el) return null;
    const id = el.dataset.view;
    return views.some(v => v.id === id) ? id : null;
  }

  function adoptShellView() {
    activate(shellViewId() || "explorer", false);
  }

  // Build a collapse button for a side-panel view's header. Every view
  // (Explorer, Recent, Search, AI) gets one so the user can close the
  // panel from any of them. Clicking it collapses the whole panel via
  // NB.activity.collapse() (the same path the activity-bar icon toggle
  // uses), so the state persists and re-expanding returns to this view.
  function makeCollapseBtn() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "collapse-btn";
    const phone = isPhone();
    btn.title = phone ? "Close panel" : "Collapse panel";
    btn.setAttribute("aria-label", phone ? "Close panel" : "Collapse panel");
    btn.textContent = phone ? "×" : "‹";
    btn.addEventListener("click", () => collapse());
    return btn;
  }

  // Width used while the side panel is collapsed. 0 -- the activity bar's
  // icons are the re-expand trigger, so no strip is left behind.
  const COLLAPSED_W = 0;

  NB.activity = {
    register,
    activate,
    collapse,
    expand,
    openSearch,
    getActive,
    isCollapsed,
    makeCollapseBtn,
    views: () => views.map(v => v.id),
    adoptShellView,
  };

  /* --- Recent / Quick open view -------------------------------------- */
  /* A side-panel view listing recently edited files with a fuzzy filter.
   * Reads from cfg.recentFiles (kept up-to-date by app.js on every file
   * open) and re-renders on every activation so a stale list isn't
   * shown. The filter input lives at the top of the view; the list
   * below it updates as the user types. Enter opens the top match.
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
    header.appendChild(makeCollapseBtn());
    host.appendChild(header);

    const input = document.createElement("input");
    input.type = "search";
    input.className = "recent-filter";
    input.placeholder = "Filter recent files…  (Enter to open top match)";
    host.appendChild(input);

    const list = document.createElement("div");
    list.className = "recent-list";
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
    }

    function openFile(path) {
      if (!path) return;
      NB.evt.emit("file:open-request", path);
    }
    function baseName(p) { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
    function parentOf(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }

    input.addEventListener("input", () => { selectedIdx = 0; renderList(); });
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
      if (NB.activity.getActive() === "recent") renderList();
    });
    NB.evt.on("file:open", () => {
      if (NB.activity.getActive() === "recent") renderList();
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
    header.appendChild(makeCollapseBtn());
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

    function summaryFor(matches, isUnique, truncated, perFileTruncated) {
      const n = matches.length;
      if (isUnique) {
        if (truncated) {
          return plural(n, "note", "notes") + " shown — more results exist";
        }
        let total = 0;
        matches.forEach(m => {
          total += (typeof m.count === "number" && isFinite(m.count) && m.count >= 0)
            ? m.count : 1;
        });
        return plural(n, "note", "notes") + " · " +
          plural(total, "match", "matches");
      }
      const paths = new Set(matches.map(m => m.file));
      if (truncated) {
        let s = plural(n, "match", "matches") + " shown — more results exist";
        if (perFileTruncated) s += " · some notes have more matches";
        return s;
      }
      let s = plural(n, "match", "matches") + " in " +
        plural(paths.size, "note", "notes");
      if (perFileTruncated) s += " · some notes have more matches";
      return s;
    }

    function summaryForNames(matches, truncated) {
      const n = matches.length;
      if (truncated) {
        return plural(n, "note", "notes") + " shown — more results exist";
      }
      return plural(n, "note", "notes");
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
      const hadFocus = list.contains(document.activeElement);
      list.innerHTML = "";
      setListBusy(false);
      note.hidden = true;
      note.textContent = "";

      if (!matches.length) {
        setSummary(isName ? "0 notes" : "0 matches");
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
        ? summaryForNames(matches, truncated)
        : summaryFor(matches, isUnique, truncated, perFileTruncated));
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

    function panelVisible() {
      if (host.hidden) return false;
      if (NB.activity) {
        if (NB.activity.getActive && NB.activity.getActive() !== "search") {
          return false;
        }
        if (NB.activity.isCollapsed && NB.activity.isCollapsed()) return false;
      }
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

  /* --- register the built-in views ---------------------------------- */
  // Explorer is the default view; its host (#sidebar) already ships in
  // the HTML with the file tree wired by sidebar.js, so mount is a no-op.
  register({
    id: "explorer",
    icon: "📁",
    label: "Explorer",
    mount: function () {},
  });
  // Pinned folders: the same pin rows the Explorer's inline top section
  // shows, mounted into their own pane on first activation.
  register({
    id: "pinned",
    icon: "📌",
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
    icon: "🔖",
    label: "Bookmarks",
    mount: function () {},
  });
  register({
    id: "recent",
    icon: "🕒",
    label: "Recent files",
    mount: mountRecent,
  });
  register({
    id: "search",
    icon: "🔍",
    label: "Search",
    mount: mountSearch,
  });
  register({
    id: "ai",
    icon: "✨",
    label: "AI Assistant",
    mount: function (host) {
      if (NB.ai && typeof NB.ai.mount === "function") NB.ai.mount(host);
    },
  });

  // Adopt the view the server rendered visible so the first frame is the
  // saved view; fall back to Explorer when the shell shows none.
  adoptShellView();
})();