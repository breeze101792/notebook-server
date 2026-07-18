/* outline.js -- right-side heading-outline minimap.
 * Builds a TOC of H1-H6 from the rendered viewer, highlights the section
 * currently in view, and jumps to a heading on click.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const outlineEl = document.getElementById("outline");
  let headings = [];     // [{el, id, level, text}]
  let observer = null;
  let scrollEl = null;
  let ticking = false;
  let activeId = null;

  function build(rootEl) {
    const heads = Array.from(
      rootEl.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    headings = heads.map(el => ({
      el,
      id: el.id,
      level: parseInt(el.tagName.slice(1), 10),
      text: el.textContent || "(empty)",
    }));

    if (!headings.length) {
      outlineEl.innerHTML =
        '<div class="outline-empty">No headings</div>';
      return;
    }

    // Flat list, indented by level.
    const ul = document.createElement("ul");
    headings.forEach(h => {
      const li = document.createElement("li");
      li.className = "outline-item";
      li.dataset.id = h.id;
      li.dataset.level = h.level;
      li.style.paddingLeft = ((h.level - 1) * 12) + "px";
      const a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.text;
      a.title = h.text;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(h.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
    outlineEl.innerHTML = "";
    outlineEl.appendChild(ul);
    // New file = new outline; drop the vim cursor.
    vimCursorId = null;
  }

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    outlineEl.querySelectorAll(".outline-item.active")
      .forEach(el => el.classList.remove("active"));
    if (id) {
      const item = outlineEl.querySelector('.outline-item[data-id="' +
        cssEscape(id) + '"]');
      if (item) {
        item.classList.add("active");
        // keep the active outline item visible too
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }

  /* --- vim-mode cursor (NB.vimnav drives this) ------------------- */
  /* A separate highlight from .active (the scroll-spy'd heading).
   * j/k move the cursor; Enter/l scrolls the editor to that
   * heading. */
  let vimCursorId = null;
  function setVimCursor(id) {
    vimCursorId = id;
    outlineEl.querySelectorAll(".outline-item.vim-cursor")
      .forEach(el => el.classList.remove("vim-cursor"));
    if (!id) return;
    const item = outlineEl.querySelector('.outline-item[data-id="' +
      cssEscape(id) + '"]');
    if (item) {
      item.classList.add("vim-cursor");
      item.scrollIntoView({ block: "nearest" });
    }
  }
  function getVimCursor() { return vimCursorId; }
  function vimCursorNext() {
    if (!headings.length) return null;
    const idx = vimCursorId
      ? headings.findIndex(h => h.id === vimCursorId)
      : -1;
    const next = headings[Math.min(headings.length - 1, idx + 1)] || headings[0];
    if (next) setVimCursor(next.id);
    return next ? next.id : null;
  }
  function vimCursorPrev() {
    if (!headings.length) return null;
    const idx = vimCursorId
      ? headings.findIndex(h => h.id === vimCursorId)
      : headings.length;
    const prev = headings[Math.max(0, idx - 1)] || headings[0];
    if (prev) setVimCursor(prev.id);
    return prev ? prev.id : null;
  }
  function vimCursorScrollTo() {
    if (!vimCursorId) return false;
    const target = document.getElementById(vimCursorId);
    if (!target) return false;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  function vimCursorReset() {
    // Drop the cursor (called when the outline is rebuilt for a new file).
    vimCursorId = null;
    outlineEl.querySelectorAll(".outline-item.vim-cursor")
      .forEach(el => el.classList.remove("vim-cursor"));
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  function computeActive() {
    if (!scrollEl || !headings.length) return;
    const vTop = scrollEl.getBoundingClientRect().top;
    const threshold = vTop + 12; // just below the top edge
    let current = null;
    for (const h of headings) {
      if (h.el.getBoundingClientRect().top <= threshold) current = h.id;
      else break; // headings are in document order
    }
    setActive(current);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { computeActive(); ticking = false; });
  }

  function startWatching(rootEl) {
    stopWatching();
    scrollEl = rootEl;
    if (!headings.length) return;
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    // Also react to window resize (layout shifts change positions).
    window.addEventListener("resize", onScroll, { passive: true });
    computeActive();
  }

  function stopWatching() {
    if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    scrollEl = null;
  }

  NB.outline = {
    build, startWatching, stopWatching,
    setVimCursor, getVimCursor, vimCursorNext, vimCursorPrev,
    vimCursorScrollTo, vimCursorReset,
  };
})();