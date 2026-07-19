/* search.js -- search inside notebooks, render results, jump to matches.
 * Server returns matches with line numbers and a snippet marked with
 * << >> around the hit; the client re-wraps that as a <mark> using safe
 * textContent-based construction (no innerHTML on untrusted snippet text).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

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
  // (Esc from the input itself still closes the overlay). The active
  // hit carries .is-active; navigation updates it and scrolls it into
  // view. The vim shell keymap yields while the search overlay is open
  // (vimnav.js), so the list's own keydown handler owns the keys.
  let activeIdx = 0;
  let currentMatches = [];       // mirrors data.matches from the last search
  let focusListOnResults = false;  // set on Enter; consumed by renderResults
  const CHORD_MS = 800;
  let listChord = null;           // { key, t } -- two-key chords on the list

  function open() {
    resultsEl.hidden = false;
    document.getElementById("viewer").hidden = true;
    const ed = document.getElementById("cm-host");
    if (ed) ed.hidden = true;
  }
  function close() {
    resultsEl.hidden = true;
    document.getElementById("viewer").hidden = false;
    // If focus was on the list (now hidden), drop it to the body so
    // it doesn't dangle on a removed subtree.
    if (document.activeElement && listEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  async function runSearch() {
    const q = inputEl.value.trim();
    const caseSensitive = caseEl.checked;
    if (!q) { close(); return; }
    let data;
    try {
      data = await NB.api.search(q, caseSensitive);
    } catch (e) {
      summaryEl.textContent = "Search error: " + e.message;
      open();
      return;
    }
    renderResults(data, q, caseSensitive);
  }

  function renderResults(data, q, caseSensitive) {
    listEl.innerHTML = "";
    const matches = data.matches || [];
    const n = matches.length;
    summaryEl.textContent = data.truncated
      ? n + "+ matches (truncated) for \"" + q + "\""
      : n + " match" + (n === 1 ? "" : "es") + " for \"" + q + "\"";
    if (!n) {
      const li = document.createElement("li");
      li.className = "search-empty";
      li.style.color = "var(--fg-muted)";
      li.style.padding = "16px";
      li.textContent = "No matches found.";
      listEl.appendChild(li);
      currentMatches = [];
      activeIdx = 0;
      focusListOnResults = false;  // nothing to navigate to
      open();
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
    open();
    // After the latest results settle, move focus to the list if Enter
    // asked for it. This is what the user sees as "Enter -> I can nav
    // with hjkl": Enter ran the search, the list now has hits, focus
    // lands on the list with the first hit active. If there are no
    // hits we kept focus on the input above (nothing to navigate).
    if (focusListOnResults) {
      focusListOnResults = false;
      listEl.focus();
    }
  }

  /* Move the .is-active class to currentMatches[activeIdx] (clamped).
   * Scrolls the active hit into view within the overlay so j/k
   * navigation never hides the cursor off-screen. */
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
    const cs = caseEl.checked;
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

  async function onHitClick(m, q, caseSensitive) {
    close();
    if (NB.tabs) await NB.tabs.open(m.file);
    else if (NB.viewer) await NB.viewer.activate(m.file);
    // Wait a tick for render to settle before scrolling to the match.
    requestAnimationFrame(() => {
      if (NB.viewer && NB.viewer.jumpToMatch) {
        const ok = NB.viewer.jumpToMatch(q, caseSensitive);
        if (!ok) {
          // Fall back to scrolling to top. The scroll container is
          // #viewer-content, not #viewer (which is a non-scrolling
          // shell that wraps it).
          document.getElementById("viewer-content").scrollTop = 0;
        }
      }
    });
  }

  /* --- events --------------------------------------------------------- */
  inputEl.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 250);
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounceTimer);
      // Run the search immediately AND, once it renders, hand focus
      // to the results list so the user can navigate with hjkl.
      focusListOnResults = true;
      runSearch();
    }
    if (e.key === "Escape") { inputEl.value = ""; close(); inputEl.blur(); }
  });

  /* Keyboard nav for the results list. Active while listEl has focus
   * (the vim shell keymap yields when the search overlay is open, so
   * these keys reach the list's bubble-phase handler). The list is
   * the focus container; the active hit is tracked by index. */
  listEl.addEventListener("keydown", (e) => {
    const hits = listEl.querySelectorAll(".search-hit");
    if (!hits.length) {
      // Only the "No matches" placeholder. Esc still returns to input.
      if (e.key === "Escape" || e.key === "/") {
        e.preventDefault();
        listChord = null;
        inputEl.focus();
        inputEl.select();
      }
      return;
    }
    // Resolve chord (gg -> first). A non-g key while waiting cancels.
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
        // First of a gg chord.
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
        // Back to the search input so the user can refine the query.
        // Esc from the input itself still closes the overlay (the
        // input's own keydown handler does that); from the list it
        // just hands focus back, leaving the query intact.
        e.preventDefault();
        listChord = null;
        inputEl.focus();
        inputEl.select();
        return;
    }
  });
  /* If the user clicks into the list whitespace (tabindex makes it
   * focusable on click), reset the active hit to the top so the
   * visible "cursor" matches the just-focused state. */
  listEl.addEventListener("focus", () => {
    activeIdx = 0;
    applyActive();
  });
  caseEl.addEventListener("change", () => {
    if (inputEl.value.trim()) runSearch();
    NB.evt.emit("search-case-changed", caseEl.checked);
  });
  closeBtn.addEventListener("click", close);

  NB.search = { runSearch, close };
})();