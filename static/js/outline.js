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

  NB.outline = { build, startWatching, stopWatching };
})();