/* menu.js -- shared right-click context-menu module (NB.menu).
 *
 * One singleton <div id="nb-menu" class="context-menu"> on document.body,
 * one renderer for descriptor arrays, one close dispatcher. Surfaces own
 * *when* a menu opens, *what* its items are, and the element that counts
 * as "inside" for close-on-right-click; this module owns building,
 * positioning, closing, and keyboard handling.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const MENU_ID = "nb-menu";
  const MENU_CLASS = "context-menu";
  const VIEWPORT_EDGE = 10;   // px gap kept between the menu and a viewport edge

  const el = document.createElement("div");
  el.id = MENU_ID;
  el.className = MENU_CLASS;
  el.hidden = true;
  document.body.appendChild(el);

  // { owner, scope, onClose } of the open menu; null while closed. `scope`
  // is the element a right-click must land inside to leave the menu open.
  let state = null;

  // Flyout entry grace, keyed by submenu button: { x, y, left, top, bottom }
  // of the triangle between the pointer's exit point and the flyout's near
  // edge. A pointer heading for a lower flyout row leaves the item through
  // its bottom edge while still left of the flyout; inside the triangle the
  // flyout stays open. `graceMove` is the document listener while armed.
  const graces = new Map();
  let graceMove = null;

  /* --- public API --------------------------------------------------- */

  function open(opts) {
    const owner = opts.owner;
    const scope = opts.scope;
    const items = opts.items;
    validateOptions(opts);
    validateItems(items);

    // A menu opened over another one closes the first with the "outside"
    // reason, so its owner can clear the state it set on the trigger.
    if (!el.hidden) close(undefined, "outside");
    retireAllGraces();

    el.innerHTML = "";
    buildItems(el, items);
    el.hidden = false;

    // Measure after unhiding, then clamp on all four edges.
    const maxLeft = window.innerWidth - el.offsetWidth - VIEWPORT_EDGE;
    const maxTop = window.innerHeight - el.offsetHeight - VIEWPORT_EDGE;
    el.style.left = Math.max(VIEWPORT_EDGE, Math.min(opts.x, maxLeft)) + "px";
    el.style.top = Math.max(VIEWPORT_EDGE, Math.min(opts.y, maxTop)) + "px";
    el.setAttribute("role", "menu");

    // The accessible name belongs to the surface that opened the menu; the
    // singleton is shared, so a fixed label would misname the other menus.
    const label = typeof opts.label === "string" ? opts.label : "";
    if (label) el.setAttribute("aria-label", label);
    else el.removeAttribute("aria-label");

    state = {
      owner,
      scope,
      label,
      onClose: typeof opts.onClose === "function" ? opts.onClose : null,
    };
    if (opts.focusFirst) {
      const first = el.querySelector("button:not([disabled])");
      if (first) first.focus({ preventScroll: true });
    }
  }

  // `owner` restricts the close to a surface's own menu; `reason` is the
  // single dispatcher's account of why it closed: an Escape press ("esc"),
  // a picked item ("pick"), or anything else ("outside", the default).
  function close(owner, reason) {
    if (el.hidden) return;
    if (owner != null && (!state || state.owner !== owner)) return;
    el.hidden = true;
    el.querySelectorAll(".submenu.open").forEach((s) => s.classList.remove("open"));
    retireAllGraces();
    const finished = state;
    state = null;
    if (finished && finished.onClose) finished.onClose(reason || "outside");
  }

  /* --- flyout entry grace ------------------------------------------- */

  // One listener while at least one grace is armed; nothing runs otherwise.
  function trackGrace(e) {
    for (const [wrap, g] of Array.from(graces)) {
      if (e.clientX >= g.left && e.clientY >= g.top && e.clientY <= g.bottom) {
        // Reached the flyout's column: its own hover takes over.
        retireGrace(wrap);
        continue;
      }
      if (inGrace(g, e.clientX, e.clientY)) continue;
      retireGrace(wrap);
      wrap.classList.remove("open");
    }
  }

  // Point-in-triangle by the sign of three cross products.
  function inGrace(g, x, y) {
    const side = (ax, ay, bx, by) => (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d1 = side(g.x, g.y, g.left, g.top);
    const d2 = side(g.left, g.top, g.left, g.bottom);
    const d3 = side(g.left, g.bottom, g.x, g.y);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  function armGrace(wrap, e) {
    // Touch has no travel to protect, and a stale grace would clear the
    // flyout a later tap opens.
    if (e.pointerType === "touch") return;
    const fly = wrap.querySelector("." + MENU_CLASS);
    if (!fly) return;
    const box = fly.getBoundingClientRect();
    // A hidden flyout measures 0; a triangle with no width has no interior.
    if (!box.width || box.left <= e.clientX) return;
    // A deeper flyout cannot outlive the level that anchors it.
    for (const nested of fly.querySelectorAll("button.submenu")) {
      nested.classList.remove("open");
      retireGrace(nested);
    }
    graces.set(wrap, {
      x: e.clientX,
      y: e.clientY,
      left: box.left,
      top: box.top,
      bottom: box.bottom,
    });
    if (!graceMove) {
      graceMove = trackGrace;
      document.addEventListener("pointermove", graceMove, true);
    }
  }

  function retireGrace(wrap) {
    graces.delete(wrap);
    if (!graces.size && graceMove) {
      document.removeEventListener("pointermove", graceMove, true);
      graceMove = null;
    }
  }

  function retireAllGraces() {
    for (const wrap of Array.from(graces.keys())) retireGrace(wrap);
  }

  /* --- rendering ---------------------------------------------------- */

  function validateItems(items) {
    for (const item of items || []) {
      if (item.separator) continue;
      if (item.submenu) { validateItems(item.submenu); continue; }
      if (item.disabled) continue;
      if (typeof item.handler !== "function") {
        throw new TypeError("Context-menu item needs a handler: " + String(item.label));
      }
    }
  }

  function validateOptions(opts) {
    if (!opts || typeof opts.owner !== "string") {
      throw new TypeError("Context-menu open() needs a string owner");
    }
    if (typeof opts.x !== "number" || !Number.isFinite(opts.x) ||
        typeof opts.y !== "number" || !Number.isFinite(opts.y)) {
      throw new TypeError("Context-menu open() needs finite x/y coordinates");
    }
    if (!opts.scope || typeof opts.scope.contains !== "function") {
      throw new TypeError("Context-menu open() needs a scope element");
    }
  }

  function buildItems(parent, items) {
    for (const item of items || []) {
      if (item.separator) { parent.appendChild(document.createElement("hr")); continue; }
      if (item.submenu) { parent.appendChild(buildSubmenu(item)); continue; }
      parent.appendChild(buildButton(item));
    }
  }

  function buildButton(item) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    if (item.danger) btn.classList.add("danger");
    if (item.disabled) {
      // Disabled entries advertise an unavailable command; they carry the
      // reason and never fire (no click listener attached).
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      if (item.title) btn.title = item.title;
    } else {
      btn.addEventListener("click", (e) => { e.stopPropagation(); close(undefined, "pick"); item.handler(); });
    }
    appendKbd(btn, item.kbd);
    return btn;
  }

  function buildSubmenu(item) {
    const wrap = document.createElement("button");
    wrap.className = "submenu";
    wrap.textContent = item.label;
    appendKbd(wrap, item.kbd);
    const fly = document.createElement("div");
    fly.className = MENU_CLASS;
    fly.hidden = false;   // CSS shows the flyout via .submenu:hover / .open
    buildItems(fly, item.submenu);
    wrap.appendChild(fly);
    if (item.disabled) {
      // A disabled parent advertises an unavailable command: native
      // disabled keeps it out of the arrow walk, and its reason stays on
      // the title. No click handler.
      wrap.disabled = true;
      wrap.setAttribute("aria-disabled", "true");
      if (item.title) wrap.title = item.title;
      return wrap;
    }
    // Hover opens the flyout at once. `.open` is what survives the pointer
    // leaving the item through its bottom edge, where :hover alone drops.
    wrap.addEventListener("mouseenter", () => {
      retireGrace(wrap);
      openOnly(wrap);
    });
    wrap.addEventListener("pointerleave", (e) => {
      if (wrap.classList.contains("open")) armGrace(wrap, e);
    });
    // Click opens, never toggles: hover has already set `.open`, so a toggle
    // would close what the pointer just opened, and phones fire mouseenter
    // before click.
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      retireGrace(wrap);
      openOnly(wrap);
    });
    return wrap;
  }

  /* Open `wrap` and close the flyouts beside it in the same panel. Ancestors
   * stay open: the hybrid prose menu nests two levels (Insert > Mermaid). */
  function openOnly(wrap) {
    const panel = wrap.parentElement;
    if (panel) {
      for (const sib of Array.from(panel.children)) {
        if (sib === wrap || !sib.classList.contains("submenu")) continue;
        retireGrace(sib);
        sib.classList.remove("open");
      }
    }
    wrap.classList.add("open");
  }

  /* The enabled buttons that are direct children of `container` (the
   * top-level menu or one flyout); nested flyout items are excluded. */
  function enabledIn(container) {
    return Array.from(container.children).filter(
      (c) => c.tagName === "BUTTON" && !c.disabled);
  }

  function appendKbd(btn, hint) {
    if (!hint) return;
    const kbd = document.createElement("kbd");
    kbd.className = "context-menu-kbd";
    kbd.textContent = hint;
    btn.appendChild(kbd);
  }

  /* --- one close dispatcher, three permanent listeners -------------- */

  document.addEventListener("click", (e) => {
    if (!el.hidden && !el.contains(e.target)) close();
  });

  // Capture phase: decide close/no-close before any surface handler runs, so
  // a right-click inside the scope never clobbers the menu it is about to
  // rebuild.
  document.addEventListener("contextmenu", (e) => {
    if (!el.hidden && state && state.scope && !state.scope.contains(e.target)) close();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (el.hidden) return;
    if (e.key === "Escape") { close(undefined, "esc"); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" &&
        e.key !== "ArrowRight" && e.key !== "ArrowLeft" &&
        e.key !== "Enter" && e.key !== " ") return;
    if (!el.contains(e.target)) return;
    e.preventDefault();
    const active = document.activeElement;
    if (!active || !el.contains(active)) return;

    if (e.key === "Enter" || e.key === " ") {
      active.click();
      return;
    }
    if (e.key === "ArrowRight") {
      if (active.classList.contains("submenu")) {
        openOnly(active);
        const fly = active.querySelector("." + MENU_CLASS);
        const first = fly ? enabledIn(fly)[0] : null;
        if (first) first.focus({ preventScroll: true });
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      const wrap = active.closest("button.submenu");
      if (wrap) {
        retireGrace(wrap);
        wrap.classList.remove("open");
        wrap.focus({ preventScroll: true });
      }
      return;
    }

    // ArrowUp / ArrowDown walk the focused level's enabled items: the top
    // level, or the flyout the focus is inside.
    const items = enabledIn(active.parentElement);
    let i = items.indexOf(active);
    if (i < 0) i = e.key === "ArrowDown" ? -1 : 0;
    const next = e.key === "ArrowDown"
      ? items[(i + 1 + items.length) % items.length]
      : items[(i - 1 + items.length) % items.length];
    if (next) next.focus({ preventScroll: true });
  });

  NB.menu = { open, close };
})();
