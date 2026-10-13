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

  // { owner, scope } of the open menu; null while closed. `scope` is the
  // element a right-click must land inside to leave the menu open.
  let state = null;

  /* --- public API --------------------------------------------------- */

  function open(opts) {
    const owner = opts.owner;
    const scope = opts.scope;
    const items = opts.items;
    validateOptions(opts);
    validateItems(items);

    el.innerHTML = "";
    buildItems(el, items);
    el.hidden = false;

    // Measure after unhiding, then clamp on all four edges.
    const maxLeft = window.innerWidth - el.offsetWidth - VIEWPORT_EDGE;
    const maxTop = window.innerHeight - el.offsetHeight - VIEWPORT_EDGE;
    el.style.left = Math.max(VIEWPORT_EDGE, Math.min(opts.x, maxLeft)) + "px";
    el.style.top = Math.max(VIEWPORT_EDGE, Math.min(opts.y, maxTop)) + "px";
    el.setAttribute("role", "menu");

    state = { owner, scope };
    if (opts.focusFirst) {
      const first = el.querySelector("button:not([disabled])");
      if (first) first.focus({ preventScroll: true });
    }
  }

  function close(owner) {
    if (el.hidden) return;
    if (owner != null && (!state || state.owner !== owner)) return;
    el.hidden = true;
    el.querySelectorAll(".submenu.open").forEach((s) => s.classList.remove("open"));
    state = null;
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
      btn.addEventListener("click", (e) => { e.stopPropagation(); close(); item.handler(); });
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
    // Click toggles .open so touch / single-click devices work.
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      el.querySelectorAll(".submenu.open").forEach((s) => { if (s !== wrap) s.classList.remove("open"); });
      wrap.classList.toggle("open");
    });
    return wrap;
  }

  /* Open `wrap` and close any sibling submenu. */
  function openOnly(wrap) {
    el.querySelectorAll(".submenu.open").forEach((s) => { if (s !== wrap) s.classList.remove("open"); });
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
    if (e.key === "Escape") { close(); return; }
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
