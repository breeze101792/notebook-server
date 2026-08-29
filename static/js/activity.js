/* activity.js -- the left activity bar + side-panel view switcher.
 *
 * Owns the narrow vertical icon strip (#activity-bar) pinned to the
 * far-left edge and the #side-panel that hosts the currently-active
 * view. Each view registers via NB.activity.register({ id, icon, label,
 * mount }) and gets an icon button in the strip. Clicking an icon
 * activates that view (mounts it into the panel and shows it); clicking
 * the active icon again collapses the panel so only the strip remains.
 *
 * The bar is intentionally generic: the Explorer view (the original
 * file tree + bookmarks) ships here by default, but further views
 * (Recent, future plugins) register the same way, so adding a new
 * side-panel function is a single NB.activity.register() call.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const barEl = document.getElementById("activity-bar");
  const panelEl = document.getElementById("side-panel");

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

  function activate(id, toggle) {
    const v = views.find(x => x.id === id);
    if (!v) return;
    // Clicking the already-active icon toggles the panel collapsed /
    // expanded (VS Code behavior). The active view is preserved across
    // the toggle so re-expanding returns to the same view.
    if (toggle && activeId === id && !panelEl.classList.contains("collapsed")) {
      collapse();
      return;
    }
    if (panelEl.classList.contains("collapsed")) expand();
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

  // Width used while the side panel is collapsed. 0 -- the activity bar's
  // icons are the re-expand trigger, so no strip is left behind.
  const COLLAPSED_W = 0;

  NB.activity = {
    register,
    activate,
    collapse,
    expand,
    getActive,
    isCollapsed,
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
   * case-toggle, and results list. Independent from the top-bar search
   * (which keeps its overlay behavior); both call the same
   * NB.api.search backend. Clicking a hit opens the file and jumps to
   * the match via NB.viewer.jumpToMatch.
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
    host.appendChild(header);

    const inputRow = document.createElement("div");
    inputRow.className = "search-panel-input-row";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "search-panel-input";
    input.placeholder = "Search notebooks…";
    const caseToggle = document.createElement("label");
    caseToggle.className = "search-panel-case";
    caseToggle.title = "Case sensitive";
    const caseCb = document.createElement("input");
    caseCb.type = "checkbox";
    const caseLabel = document.createElement("span");
    caseLabel.textContent = "Aa";
    caseToggle.append(caseCb, caseLabel);
    inputRow.append(input, caseToggle);
    host.appendChild(inputRow);

    const summary = document.createElement("div");
    summary.className = "search-panel-summary";
    host.appendChild(summary);

    const list = document.createElement("div");
    list.className = "search-panel-list";
    host.appendChild(list);

    let debounceTimer = null;
    let activeIdx = 0;
    let currentMatches = [];

    async function runSearch() {
      const q = input.value.trim();
      if (!q) {
        summary.textContent = "";
        list.innerHTML = "";
        currentMatches = [];
        return;
      }
      const caseSensitive = caseCb.checked;
      let data;
      try {
        data = await NB.api.search(q, caseSensitive);
      } catch (e) {
        summary.textContent = "Search error: " + e.message;
        return;
      }
      renderResults(data, q, caseSensitive);
    }

    function renderResults(data, q, caseSensitive) {
      list.innerHTML = "";
      const matches = data.matches || [];
      const n = matches.length;
      summary.textContent = data.truncated
        ? n + "+ matches (truncated)"
        : n + " match" + (n === 1 ? "" : "es");
      if (!n) {
        const empty = document.createElement("div");
        empty.className = "search-panel-empty";
        empty.textContent = "No matches found.";
        list.appendChild(empty);
        currentMatches = [];
        activeIdx = 0;
        return;
      }
      matches.forEach(m => {
        const hit = document.createElement("div");
        hit.className = "search-panel-hit";
        const fileLine = document.createElement("div");
        fileLine.className = "search-panel-hit-file";
        const fSpan = document.createElement("span");
        fSpan.className = "sp-file";
        fSpan.textContent = m.file;
        const mSpan = document.createElement("span");
        mSpan.className = "sp-meta";
        mSpan.textContent = "line " + m.line;
        fileLine.append(fSpan, mSpan);
        const snip = document.createElement("div");
        snip.className = "search-panel-hit-snippet";
        snip.appendChild(buildSnippet(m.snippet));
        hit.append(fileLine, snip);
        hit.addEventListener("click", () => onHitClick(m, q, caseSensitive));
        list.appendChild(hit);
      });
      currentMatches = matches;
      activeIdx = 0;
      applyActive();
    }

    function buildSnippet(snippet) {
      const frag = document.createDocumentFragment();
      const parts = String(snippet).split(/(<<|>>)/);
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
      const hits = list.querySelectorAll(".search-panel-hit");
      if (!hits.length) return;
      activeIdx = Math.max(0, Math.min(activeIdx, hits.length - 1));
      hits.forEach((h, i) => h.classList.toggle("is-active", i === activeIdx));
      const el = hits[activeIdx];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }

    async function onHitClick(m, q, caseSensitive) {
      if (NB.tabs) await NB.tabs.open(m.file);
      else if (NB.viewer) await NB.viewer.activate(m.file);
      requestAnimationFrame(() => {
        if (NB.viewer && NB.viewer.jumpToMatch) {
          NB.viewer.jumpToMatch(q, caseSensitive);
        }
      });
    }

    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 250);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(debounceTimer);
        const hits = list.querySelectorAll(".search-panel-hit");
        if (hits.length) {
          activeIdx = 0;
          hits[0].click();
        } else {
          runSearch();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIdx = Math.min(currentMatches.length - 1, activeIdx + 1);
        applyActive();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIdx = Math.max(0, activeIdx - 1);
        applyActive();
      }
    });
    caseCb.addEventListener("change", () => {
      if (input.value.trim()) runSearch();
    });

    setTimeout(() => { try { input.focus(); } catch (_) {} }, 0);
  }

  /* --- register the built-in views ---------------------------------- */
  // Explorer is the default view; its host (#sidebar) already ships in
  // the HTML with bookmarks + the file tree wired by sidebar.js, so
  // mount is a no-op.
  register({
    id: "explorer",
    icon: "📁",
    label: "Explorer",
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

  // Activate Explorer on first load so the file tree is visible without
  // requiring a click.
  activate("explorer", false);
})();