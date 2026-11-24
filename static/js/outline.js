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

    // Nest the flat heading list by level, then draw the file tree's guide
    // cells: one 18 px column per ancestor that keeps branching, plus this
    // row's own corner. A level jump (H1 -> H3) nests at the next depth,
    // like the tree. The classes are shared with the file tree so both
    // panes draw the same lines (style.css `.tree-guide`).
    const roots = [];
    const stack = [];
    headings.forEach(h => {
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      const node = { h, children: [] };
      (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
      stack.push({ level: h.level, node });
    });

    const ul = document.createElement("ul");
    const renderNodes = (nodes, ancestors, depth) => {
      nodes.forEach((node, idx) => {
        const h = node.h;
        const isLast = idx === nodes.length - 1;
        const isRoot = depth === 0;
        const li = document.createElement("li");
        li.className = "outline-item";
        li.dataset.id = h.id;
        li.dataset.level = h.level;
        li.appendChild(guideCells(ancestors, isLast, isRoot));
        const a = document.createElement("a");
        a.href = "#" + h.id;
        a.textContent = h.text;
        a.title = h.text;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          // Use the stored node: getElementById could return a note element
          // earlier in document order that reused the heading id.
          h.el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        li.appendChild(a);
        ul.appendChild(li);
        if (node.children.length) {
          // A top-level heading is a flat section title, so it spends no guide
          // column on its children: an H2's corner sits at column 0, like the
          // first level of `tree` output. Deeper levels pass their own pipe.
          const childAncestors = isRoot ? [] : ancestors.concat(!isLast);
          renderNodes(node.children, childAncestors, depth + 1);
        }
      });
    };
    renderNodes(roots, [], 0);
    outlineEl.innerHTML = "";
    outlineEl.appendChild(ul);
    // New file = new outline; drop the vim cursor.
    vimCursorId = null;
  }

  /* One 18 px cell per ancestor that keeps branching below this row, plus a
   * corner cell for the row itself ("├──" / "└──"); root rows stay flat.
   * The same markup the file tree builds (sidebar.js renderGuide), so the
   * outline and the tree read identically. */
  function guideCells(ancestors, isLast, isRoot) {
    const guide = document.createElement("span");
    guide.className = "tree-guide";
    guide.setAttribute("aria-hidden", "true");
    for (const pipe of ancestors) {
      const cell = document.createElement("span");
      cell.className = "tcell" + (pipe ? " vert" : "");
      guide.appendChild(cell);
    }
    if (!isRoot) {
      const corner = document.createElement("span");
      corner.className = "tcell" + (isLast ? " cnr-last" : " cnr");
      guide.appendChild(corner);
    }
    return guide;
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
    const heading = headings.find(h => h.id === vimCursorId);
    if (!heading || !heading.el) return false;
    heading.el.scrollIntoView({ behavior: "smooth", block: "start" });
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
    // A heading scrolled to by click-to-jump lands `--topbar-h + 8px`
    // below the scroller top (its scroll-margin-top). A threshold just
    // below the top edge therefore selects the PREVIOUS heading, and at
    // scrollTop 0 it selects none. Use the same offset plus a small
    // settle margin.
    const topbarH = parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--topbar-h")) || 0;
    const threshold = vTop + topbarH + 8 + 2;
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