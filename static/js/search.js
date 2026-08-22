/* search.js -- search inside notebooks, render results, jump to matches.
 *
 * The top-bar search input triggers a search; results render as a special
 * tab (§search) in the tab bar, a .special-tab-view sibling of #viewer
 * inside #edit-split. The search input stays in the topbar; typing a
 * query + Enter opens/activates the §search tab and fills it with hits.
 * Clicking a hit opens the file as a normal file tab (the search tab
 * stays open so the user can return to the results).
 *
 * Server returns matches with line numbers and a snippet marked with
 * << >> around the hit; the client re-wraps that as a <mark> using safe
 * textContent-based construction (no innerHTML on untrusted snippet text).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const TAB_ID = "§search";

  const inputEl   = document.getElementById("search-input");
  const caseEl    = document.getElementById("search-case");
  const resultsEl = document.getElementById("search-results");
  const listEl    = document.getElementById("search-list");
  const summaryEl = document.getElementById("search-summary");
  const closeBtn  = document.getElementById("search-close");

  let debounceTimer = null;
  // --- search-results list keyboard nav (vim-style) --------------------
  // After pressing Enter in the search input, focus moves to the list
  // and the user can navigate hits with j/k/arrows, open with Enter/l,
  // jump to first/last with gg/G, and pop back to the input with Esc
  // (Esc from the input itself still closes the search tab). The active
  // hit carries .is-active; navigation updates it and scrolls it into
  // view. The vim shell keymap yields while the search tab is open
  // (vimnav.js), so the list's own keydown handler owns the keys.
  let activeIdx = 0;
  let currentMatches = [];
  let focusListOnResults = false;
  const CHORD_MS = 800;
  let listChord = null;
  let lastQuery = "";
  let lastCaseSensitive = false;

  /* Open the search results as a special tab. If the tab isn't open yet,
   * NB.tabs.openSpecial creates it and activates it; if it's already open,
   * it just activates it. The special-tab's onActivate handler shows
   * #search-results (handled by the tab system + viewer.showSpecial).
   * suppressReSearch prevents onTabActivate from re-running the search
   * that triggered this open (which would loop). */
  let suppressReSearch = false;
  async function openTab() {
    if (NB.tabs && NB.tabs.openSpecial) {
      suppressReSearch = true;
      try { await NB.tabs.openSpecial(TAB_ID); }
      finally { suppressReSearch = false; }
    }
    // Fallback (e.g. before tabs.js loads): just unhide the container.
    if (!resultsEl || resultsEl.hidden) {
      if (resultsEl) resultsEl.hidden = false;
    }
  }

  /* Close the search tab. Called by the × button, Esc from the input,
   * and the auth:locked handler. */
  function close() {
    if (NB.tabs && NB.tabs.isOpen && NB.tabs.isOpen(TAB_ID)) {
      NB.tabs.close(TAB_ID);
    }
    if (resultsEl) resultsEl.hidden = true;
    // If focus was on the list (now hidden), drop it to the body so
    // it doesn't dangle on a removed subtree.
    if (document.activeElement && listEl && listEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  /* Special-tab lifecycle: called by tabs.js when §search becomes active.
   * Only re-runs the search when the user manually switches to the search
   * tab (e.g. clicking it in the tab bar), not when openTab() activates
   * it as part of running a search (which would cause an infinite loop). */
  function onTabActivate() {
    if (resultsEl) resultsEl.hidden = false;
    if (suppressReSearch) return;
    // Re-run the last search so the results are fresh when the user
    // switches back to the search tab after viewing a file.
    const q = (inputEl && inputEl.value || "").trim();
    if (q) { runSearch(); }
    else if (lastQuery) {
      inputEl.value = lastQuery;
      if (caseEl) caseEl.checked = lastCaseSensitive;
      runSearch();
    }
  }
  function onTabClose() {
    if (resultsEl) resultsEl.hidden = true;
  }

  // Register the special tab with the tab system. Done at module load
  // so the tab is available as soon as tabs.js is ready. The search
  // module loads before tabs.js, so we defer registration via a
  // DOMContentLoaded / readystatechange callback that runs after tabs.js.
  function registerTab() {
    if (NB.tabs && NB.tabs.registerSpecial) {
      NB.tabs.registerSpecial({
        id: TAB_ID,
        icon: "🔍",
        label: "Search",
        onActivate: onTabActivate,
        onClose: onTabClose,
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerTab);
  } else {
    registerTab();
  }

  async function runSearch() {
    const q = (inputEl && inputEl.value || "").trim();
    const caseSensitive = caseEl ? caseEl.checked : false;
    if (!q) { close(); return; }
    lastQuery = q;
    lastCaseSensitive = caseSensitive;
    let data;
    try {
      data = await NB.api.search(q, caseSensitive);
    } catch (e) {
      if (summaryEl) summaryEl.textContent = "Search error: " + e.message;
      await openTab();
      return;
    }
    renderResults(data, q, caseSensitive);
  }

  async function renderResults(data, q, caseSensitive) {
    listEl.innerHTML = "";
    const matches = data.matches || [];
    const n = matches.length;
    if (summaryEl) {
      summaryEl.textContent = data.truncated
        ? n + "+ matches (truncated) for \"" + q + "\""
        : n + " match" + (n === 1 ? "" : "es") + " for \"" + q + "\"";
    }
    if (!n) {
      const li = document.createElement("li");
      li.className = "search-empty";
      li.style.color = "var(--fg-muted)";
      li.style.padding = "16px";
      li.textContent = "No matches found.";
      listEl.appendChild(li);
      currentMatches = [];
      activeIdx = 0;
      focusListOnResults = false;
      await openTab();
      return;
    }

    matches.forEach(m => {
      const hit = document.createElement("div");
      hit.className = "search-hit";
      hit.addEventListener("click", () => onHitClick(m, q, caseSensitive));

      const fileLine = document.createElement("div");
      const fileSpan = document.createElement("span");
      fileSpan.className = "hit-file";
      fileSpan.textContent = m.file;
      const metaSpan = document.createElement("span");
      metaSpan.className = "hit-meta";
      metaSpan.textContent = "line " + m.line + ", col " + m.col;
      fileLine.append(fileSpan, metaSpan);

      const snip = document.createElement("div");
      snip.className = "hit-snippet";
      snip.appendChild(buildSnippet(m.snippet));

      hit.append(fileLine, snip);
      listEl.appendChild(hit);
    });
    currentMatches = matches;
    activeIdx = 0;
    applyActive();
    await openTab();
    // After the latest results settle, move focus to the list if Enter
    // asked for it.
    if (focusListOnResults) {
      focusListOnResults = false;
      listEl.focus();
    }
  }

  /* Move the .is-active class to currentMatches[activeIdx] (clamped).
   * Scrolls the active hit into view so j/k navigation never hides the
   * cursor off-screen. */
  function applyActive() {
    const hits = listEl.querySelectorAll(".search-hit");
    if (!hits.length) return;
    activeIdx = Math.max(0, Math.min(activeIdx, hits.length - 1));
    hits.forEach((h, i) => h.classList.toggle("is-active", i === activeIdx));
    const el = hits[activeIdx];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest" });
    }
  }

  function openActiveHit() {
    const m = currentMatches[activeIdx];
    if (!m) return;
    const q = inputEl.value;
    const cs = caseEl ? caseEl.checked : false;
    onHitClick(m, q, cs);
  }

  /* Server snippet has the match wrapped in << ... >>. Build a DOM node
   * with the match inside <mark>, using textContent (no HTML injection). */
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

  /* Clicking a hit opens the file as a normal file tab. The search tab
   * stays open in the tab bar so the user can return to the results
   * after reading the hit. */
  async function onHitClick(m, q, caseSensitive) {
    if (NB.tabs) await NB.tabs.open(m.file);
    else if (NB.viewer) await NB.viewer.activate(m.file);
    // Wait a tick for render to settle before scrolling to the match.
    requestAnimationFrame(() => {
      if (NB.viewer && NB.viewer.jumpToMatch) {
        const ok = NB.viewer.jumpToMatch(q, caseSensitive);
        if (!ok) {
          document.getElementById("viewer-content").scrollTop = 0;
        }
      }
    });
  }

  /* --- events --------------------------------------------------------- */
  if (inputEl) inputEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 250);
  });
  if (inputEl) inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounceTimer);
      focusListOnResults = true;
      runSearch();
    }
    if (e.key === "Escape") {
      inputEl.value = "";
      close();
      inputEl.blur();
    }
  });

  /* Keyboard nav for the results list. Active while listEl has focus. */
  if (listEl) listEl.addEventListener("keydown", (e) => {
    const hits = listEl.querySelectorAll(".search-hit");
    if (!hits.length) {
      if (e.key === "Escape" || e.key === "/") {
        e.preventDefault();
        listChord = null;
        inputEl.focus();
        inputEl.select();
      }
      return;
    }
    if (listChord) {
      if (e.key === listChord.key && Date.now() - listChord.t < CHORD_MS) {
        listChord = null;
        activeIdx = 0;
        applyActive();
        e.preventDefault();
        return;
      }
      listChord = null;
    }
    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, hits.length - 1);
        applyActive();
        return;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        applyActive();
        return;
      case "G":
        e.preventDefault();
        activeIdx = hits.length - 1;
        applyActive();
        return;
      case "g":
        e.preventDefault();
        listChord = { key: "g", t: Date.now() };
        return;
      case "Enter":
      case "l":
        e.preventDefault();
        openActiveHit();
        return;
      case "Escape":
      case "/":
        e.preventDefault();
        listChord = null;
        inputEl.focus();
        inputEl.select();
        return;
    }
  });
  if (listEl) listEl.addEventListener("focus", () => {
    activeIdx = 0;
    applyActive();
  });
  if (caseEl) caseEl.addEventListener("change", () => {
    if (inputEl.value.trim()) runSearch();
    NB.evt.emit("search-case-changed", caseEl.checked);
  });
  if (closeBtn) closeBtn.addEventListener("click", close);

  NB.search = { runSearch, close, openTab };
})();