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

  function open() {
    resultsEl.hidden = false;
    document.getElementById("viewer").hidden = true;
    const ed = document.getElementById("raw-editor");
    if (ed) ed.hidden = true;
  }
  function close() {
    resultsEl.hidden = true;
    document.getElementById("viewer").hidden = false;
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
    open();
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
    if (e.key === "Enter") { clearTimeout(debounceTimer); runSearch(); }
    if (e.key === "Escape") { inputEl.value = ""; close(); inputEl.blur(); }
  });
  caseEl.addEventListener("change", () => {
    if (inputEl.value.trim()) runSearch();
    NB.evt.emit("search-case-changed", caseEl.checked);
  });
  closeBtn.addEventListener("click", close);

  NB.search = { runSearch, close };
})();