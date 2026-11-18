/* tabs-view.js -- the Tabs side-panel view.
 *
 * Lists every open file of the active session, pinned first, with its state:
 * the pin or the special tab's module sprite, the name, a dot for unsaved
 * edits or the conflict glyph, and a close button (an inert gap on a pinned
 * row). Every row is the same four boxes -- mark 14, name flex, state 14,
 * close 24 -- so all names share one left edge and one truncation point.
 *
 * The model lives in tabs.js; this module only reads NB.tabs.getOpen() /
 * getActive() / isPinned() / isSpecial() / getSpecial() / isConflicted() and
 * NB.viewer.isDirty(), and writes through NB.tabs.activate() / close() /
 * openTabMenu(). The host (#tabs-view) ships empty in index.html and this
 * module builds its header, list, empty line and footnote at load, the
 * sessions.js pattern: there is no mount path, so list state survives every
 * view switch.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const VIEW_ID = "tabs-view";
  const WRAP_CLASS = "tab-item-wrap";
  const ROW_CLASS = "tab-item";
  const CLOSE_CLASS = "tab-item-close";
  const GAP_CLASS = "tab-item-gap";
  const ROW_SELECTOR = "." + ROW_CLASS;
  const CLOSE_SELECTOR = "." + CLOSE_CLASS;
  const WRAP_SELECTOR = "." + WRAP_CLASS;
  const COLLAPSE_SELECTOR = ".panel-header .collapse-btn";

  // Drag marks, one class each: the source row, the edge the drop lands on,
  // and list-wide "append" when the pointer is off the rows.
  const DRAGGING_CLASS = "dragging";
  const DROP_BEFORE_CLASS = "drop-before";
  const DROP_AFTER_CLASS = "drop-after";
  const DROP_EMPTY_CLASS = "drop-empty";
  const MARK_SELECTOR = "." + DROP_BEFORE_CLASS + ",." + DROP_AFTER_CLASS;

  const TITLE = "Tabs";
  const EMPTY_TEXT = "No files are open. Open one in Explorer.";
  const FOOT_TEXT = "Pinned tabs are shared by every session.";
  const COUNT_UNIT = " open files";
  const LABEL_PINNED = ", pinned";
  const LABEL_DIRTY = ", unsaved changes";
  const LABEL_CONFLICT = ", changed on disk";
  const CLOSE_PREFIX = "Close ";

  // Signature separators: control characters, so no path or label can join
  // two fields into one.
  const SIG_FIELD = "\u0001";
  const SIG_ROW = "\u0002";

  const PIN_ICON = '<svg class="icon" aria-hidden="true" focusable="false">' +
    '<use href="#nb-icon-pin"/></svg>';
  const CLOSE_ICON = '<svg class="icon" aria-hidden="true" focusable="false">' +
    '<use href="#nb-icon-close"/></svg>';
  const CONFLICT_ICON = '<svg class="icon" aria-hidden="true" focusable="false">' +
    '<use href="#nb-icon-conflict"/></svg>';

  const viewEl = document.getElementById(VIEW_ID);
  // A shell without the host (an old cached index.html) gets no Tabs view.
  if (!viewEl) return;

  let listEl = null;
  let emptyEl = null;
  let totalNumEl = null;
  // The visible state the current rows were built from; the events below
  // rebuild only when it moved (the sessions.js guard).
  let lastSig = null;
  // The dirty and conflict bit each row currently shows, per path. Those two
  // events carry the new bit, so a repeat costs one lookup; signature() below
  // re-seeds both maps whenever it reads the model.
  let shownDirty = new Map();
  let shownConflict = new Map();
  // The path whose context menu is open, so a re-render that runs while the
  // menu is up keeps aria-expanded on that path's new row.
  let menuPath = null;
  // The path being dragged, or null. The state is a path, not a class, so a
  // rebuild cannot inherit a mark from the rows it replaced; the classes are
  // re-derived from this on the current wraps only.
  let dragPath = null;
  // A drop must never activate the tab it released over: a native drag
  // suppresses the click in the browser, and this swallows one anyway. Any
  // following press clears it, so it can never eat a real click.
  let swallowClick = false;
  // True when the press that began the gesture landed on a close button. The
  // browser retargets dragstart at the draggable wrapper, so the drag event
  // cannot tell (the sessions.js pattern); dragstart refuses on this and
  // clears it.
  let dragFromClose = false;

  /* --- view construction --------------------------------------------- */
  /* Build the header, the list, the empty line and the footnote once, at
   * load. The anatomy is the Sessions view's: heading (title + count chip),
   * then the bare collapse control as the header's second flex child. The
   * empty line and the footnote are siblings of the scroller. */
  function buildView() {
    viewEl.textContent = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    const heading = document.createElement("div");
    heading.className = "panel-heading";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = TITLE;
    heading.appendChild(title);
    const total = document.createElement("span");
    total.className = "session-total tabs-total";
    totalNumEl = document.createElement("span");
    totalNumEl.className = "tabs-total-n";
    totalNumEl.textContent = "0";
    total.appendChild(totalNumEl);
    // The unit lives inside the chip, the Sessions pattern: the chip is one
    // node that reads "5 open files", while only the number is painted.
    const unit = document.createElement("span");
    unit.className = "sr-only";
    unit.textContent = COUNT_UNIT;
    total.appendChild(unit);
    heading.appendChild(total);
    header.appendChild(heading);

    if (NB.activity && NB.activity.makeCollapseBtn) {
      header.appendChild(NB.activity.makeCollapseBtn());
    }
    viewEl.appendChild(header);

    listEl = document.createElement("div");
    listEl.className = "tabs-list";
    viewEl.appendChild(listEl);

    emptyEl = document.createElement("p");
    emptyEl.className = "tabs-empty";
    emptyEl.textContent = EMPTY_TEXT;
    emptyEl.hidden = true;
    viewEl.appendChild(emptyEl);

    const foot = document.createElement("p");
    foot.className = "sessions-foot tabs-foot";
    const footPin = document.createElement("span");
    footPin.className = "sessions-foot-pin tab-foot-pin";
    footPin.setAttribute("aria-hidden", "true");
    footPin.innerHTML = PIN_ICON;
    foot.appendChild(footPin);
    const hint = document.createElement("span");
    hint.textContent = FOOT_TEXT;
    foot.appendChild(hint);
    viewEl.appendChild(foot);
  }

  /* --- the model as this view shows it -------------------------------- */
  function readOpen() {
    if (!NB.tabs || typeof NB.tabs.getOpen !== "function") return [];
    const open = NB.tabs.getOpen();
    return Array.isArray(open) ? open.slice() : [];
  }

  function isSpecialPath(path) {
    return !!(NB.tabs && NB.tabs.isSpecial && NB.tabs.isSpecial(path));
  }

  function specialSpec(path) {
    if (!isSpecialPath(path)) return null;
    if (!NB.tabs || typeof NB.tabs.getSpecial !== "function") return null;
    return NB.tabs.getSpecial(path) || null;
  }

  function isPinnedPath(path) {
    return !!(NB.tabs && NB.tabs.isPinned && NB.tabs.isPinned(path));
  }

  // A special tab is a module, never a file: it has no draft and no disk
  // conflict, so both states are false there.
  function isDirtyPath(path, special) {
    return !special && !!(NB.viewer && NB.viewer.isDirty &&
      NB.viewer.isDirty(path));
  }

  function isConflictedPath(path, special) {
    return !special && !!(NB.tabs && NB.tabs.isConflicted &&
      NB.tabs.isConflicted(path));
  }

  function currentPath() {
    return NB.tabs && typeof NB.tabs.getActive === "function"
      ? NB.tabs.getActive() : null;
  }

  /* --- render --------------------------------------------------------- */
  /* What a row shows: path, active, pinned, dirty, conflicted, and a special
   * tab's icon and label -- the icon too, because registerSpecial can replace
   * a definition under an open tab. Reading it walks the whole model, so it
   * also re-seeds the per-path dirty/conflict cache; every caller below keeps
   * the model and that cache in step through this one function. */
  function signature() {
    const active = currentPath();
    const dirty = new Map();
    const conflict = new Map();
    const sig = readOpen().map((path) => {
      const special = isSpecialPath(path);
      const spec = special ? specialSpec(path) : null;
      const isDirty = isDirtyPath(path, special) ? 1 : 0;
      const isConflict = isConflictedPath(path, special) ? 1 : 0;
      dirty.set(path, isDirty);
      conflict.set(path, isConflict);
      return [
        path,
        active === path ? 1 : 0,
        isPinnedPath(path) ? 1 : 0,
        isDirty,
        isConflict,
        special && spec && spec.label ? spec.label : "",
        special && spec && spec.icon ? spec.icon : "",
      ].join(SIG_FIELD);
    }).join(SIG_ROW);
    shownDirty = dirty;
    shownConflict = conflict;
    return sig;
  }

  /* Rebuild only when what a row says moved. The signature is computed once
   * here and handed to render(), so the guard and the rebuild read one model.
   */
  function refresh() {
    const sig = signature();
    if (sig === lastSig) return;
    render(sig);
  }

  /* A full rebuild replaces every row, so focus is captured by path and
   * control first and restored after, and the scroller keeps its position
   * (the strip preserves scrollLeft the same way). */
  function render(sig) {
    if (!listEl) return;
    const keep = focusedControl();
    const scrollTop = listEl.scrollTop;
    listEl.textContent = "";
    // The list node survives the rebuild, so its own mark is cleared here;
    // the rows' marks left with the rows.
    listEl.classList.remove(DROP_EMPTY_CLASS);

    for (const path of readOpen()) {
      const wrap = buildRow(path);
      if (wrap) listEl.appendChild(wrap);
    }

    const count = listEl.children.length;
    listEl.hidden = count === 0;
    if (emptyEl) emptyEl.hidden = count > 0;
    if (totalNumEl) totalNumEl.textContent = String(count);
    listEl.scrollTop = scrollTop;
    restoreFocus(keep);
    lastSig = sig;
  }

  function buildRow(path) {
    const special = isSpecialPath(path);
    const spec = special ? specialSpec(path) : null;
    const name = special
      ? ((spec && spec.label) || baseName(path))
      : baseName(path);
    const pinned = isPinnedPath(path);
    const dirty = isDirtyPath(path, special);
    const conflicted = isConflictedPath(path, special);
    const active = currentPath() === path;

    // A button cannot contain a button, so the wrapper groups the row and
    // its close (the sessions row's shape).
    const wrap = document.createElement("div");
    wrap.className = WRAP_CLASS;
    wrap.dataset.path = path;
    // Only an admin may reorder; a viewer's rows are not draggable at all.
    if (canReorder()) wrap.draggable = true;
    if (special) wrap.classList.add("is-special");

    const row = document.createElement("button");
    row.type = "button";
    row.className = ROW_CLASS;
    row.dataset.path = path;
    row.title = special ? name : path;
    row.setAttribute("aria-label", accessibleName(name, pinned, dirty, conflicted));
    row.setAttribute("aria-haspopup", "menu");
    // The menu outlives a re-render triggered while it is open, so the flag
    // is re-applied here and cleared by the menu's own onClose.
    if (menuPath === path) row.setAttribute("aria-expanded", "true");
    if (active) row.setAttribute("aria-current", "true");

    row.appendChild(buildMark(special ? spec : null, pinned));
    const label = document.createElement("span");
    label.className = "tab-item-name";
    label.textContent = name;
    row.appendChild(label);
    row.appendChild(buildState(dirty, conflicted));
    wrap.appendChild(row);

    row.addEventListener("click", () => {
      if (swallowClick) { swallowClick = false; return; }
      activate(path);
    });
    wrap.addEventListener("auxclick", (e) => {
      if (e.button === 1 && !pinned) { e.preventDefault(); closeTab(path); }
    });
    // Suppress the browser's autoscroll, which a middle press otherwise
    // starts on a scroll container (the strip's rule). Any other press is the
    // start of an interaction the drop guard must not see, and it is the only
    // place a close-button gesture can be recognised: the browser retargets
    // dragstart at the draggable wrapper, never at the button (sessions.js).
    wrap.addEventListener("mousedown", (e) => {
      if (e.button === 1) { e.preventDefault(); return; }
      swallowClick = false;
      dragFromClose = !!(e.target.closest && e.target.closest(CLOSE_SELECTOR));
    });
    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMenu(path, row, e);
    });

    if (pinned) {
      const gap = document.createElement("span");
      gap.className = GAP_CLASS;
      gap.setAttribute("aria-hidden", "true");
      wrap.appendChild(gap);
      return wrap;
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = CLOSE_CLASS;
    closeBtn.setAttribute("aria-label", CLOSE_PREFIX + name);
    closeBtn.innerHTML = CLOSE_ICON;
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(path);
    });
    wrap.appendChild(closeBtn);
    return wrap;
  }

  /* The mark column: the pin on a pinned row, else a special tab's module
   * sprite, else an empty box that keeps its width (visibility: hidden). */
  function buildMark(spec, pinned) {
    const mark = document.createElement("span");
    mark.className = "tab-item-mark";
    mark.setAttribute("aria-hidden", "true");
    if (pinned) {
      mark.innerHTML = PIN_ICON;
      return mark;
    }
    const icon = spec && spec.icon ? spec.icon : "";
    if (icon.indexOf("nb-icon-") === 0) {
      mark.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false">' +
        '<use href="#' + icon + '"/></svg>';
    } else if (icon) {
      const glyph = document.createElement("span");
      glyph.className = "tab-item-mark-text";
      glyph.textContent = icon;
      mark.appendChild(glyph);
    } else {
      mark.classList.add("is-empty");
    }
    return mark;
  }

  /* The state column, one box for both states: a conflict can only exist on
   * an unsaved file, so it replaces the dot rather than taking a column. */
  function buildState(dirty, conflicted) {
    const state = document.createElement("span");
    state.className = "tab-item-state";
    state.setAttribute("aria-hidden", "true");
    if (conflicted) {
      state.innerHTML = CONFLICT_ICON;
      return state;
    }
    if (dirty) {
      const dot = document.createElement("span");
      dot.className = "tab-item-dot";
      state.appendChild(dot);
      return state;
    }
    state.classList.add("is-empty");
    return state;
  }

  function accessibleName(name, pinned, dirty, conflicted) {
    let text = name;
    if (pinned) text += LABEL_PINNED;
    if (dirty) text += LABEL_DIRTY;
    if (conflicted) text += LABEL_CONFLICT;
    return text;
  }

  /* --- focus across a rebuild ----------------------------------------- */
  /* Only a control inside this view is a restore target; focus elsewhere (the
   * reader, the editor, the strip) is left where the user put it. */
  function focusedControl() {
    const active = document.activeElement;
    if (!active || !viewEl.contains(active)) return null;
    const wrap = active.closest ? active.closest("." + WRAP_CLASS) : null;
    if (!wrap || !wrap.dataset.path) return null;
    return {
      path: wrap.dataset.path,
      control: active.classList.contains(CLOSE_CLASS) ? "close" : "row",
    };
  }

  /* The remembered control can be gone: pinning a row replaces its close
   * button with the inert gap. Fall back to that path's row, then the first
   * row, then the collapse control, so focus never lands on a detached node
   * (which would drop it to <body>). */
  function restoreFocus(keep) {
    if (!keep) return;
    const wrap = rowWrapByPath(keep.path);
    const row = wrap ? wrap.querySelector(ROW_SELECTOR) : null;
    const target =
      (wrap && keep.control === "close" ? wrap.querySelector(CLOSE_SELECTOR) : null) ||
      row ||
      firstRow() ||
      collapseBtn();
    if (target) target.focus({ preventScroll: true });
  }

  function rowWrapByPath(path) {
    if (!listEl || !path) return null;
    return Array.from(listEl.querySelectorAll("." + WRAP_CLASS))
      .find((wrap) => wrap.dataset.path === path) || null;
  }

  function rowWraps() {
    if (!listEl) return [];
    return Array.from(listEl.querySelectorAll("." + WRAP_CLASS));
  }

  function firstRow() {
    return listEl ? listEl.querySelector(ROW_SELECTOR) : null;
  }

  function collapseBtn() {
    return viewEl.querySelector(COLLAPSE_SELECTOR);
  }

  /* --- actions --------------------------------------------------------- */
  /* A tap or a click opens the file. On the phone the drawer closes once the
   * activation resolves, but only if that tab is the active one: an
   * activation the model refused (a cancelled confirm, a load error) leaves
   * the drawer up (the sessions.js switch rule). */
  function activate(path) {
    if (!path || !NB.tabs || typeof NB.tabs.activate !== "function") return;
    const done = settle(NB.tabs.activate(path));
    Promise.resolve(done).then(() => {
      if (currentPath() !== path) return;
      if (NB.mobile && NB.mobile.isDrawerOpen && NB.mobile.isDrawerOpen()) {
        NB.mobile.closeDrawer();
      }
    }).catch(() => {});
    return done;
  }

  function closeTab(path) {
    if (!path || !NB.tabs || typeof NB.tabs.close !== "function") return;
    const wrap = rowWrapByPath(path);
    const hadFocus = !!(wrap && wrap.contains(document.activeElement));
    const index = wrap ? rowWraps().indexOf(wrap) : -1;
    settle(NB.tabs.close(path));
    if (hadFocus) focusNeighbour(index);
  }

  /* Closing moves focus to the row that took the closed row's place, else the
   * previous row, else the collapse control: the focus move is the
   * announcement, and without it the keyboard would fall to <body>. A close
   * the model refused (a cancelled confirm) leaves the row in place, so this
   * lands on that same row. */
  function focusNeighbour(index) {
    const wraps = rowWraps();
    const wrap = index >= 0 ? wraps[Math.min(index, wraps.length - 1)] : null;
    const row = wrap ? wrap.querySelector(ROW_SELECTOR) : null;
    if (row) {
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
      return;
    }
    const fallback = collapseBtn();
    if (fallback) fallback.focus({ preventScroll: true });
  }

  // A refused model call changes nothing; it must not surface on the console.
  function settle(promise) {
    if (promise && typeof promise.catch === "function") promise.catch(() => {});
    return promise;
  }

  /* --- the row menu ---------------------------------------------------- */
  /* A real pointer carries a position, so the menu opens at the pointer like
   * the strip's; a keyboard context-menu request (Shift+F10) reports 0,0 and
   * hangs the menu from the row instead. The open path is remembered in the
   * view so a re-render keeps aria-expanded on the new row. */
  function openMenu(path, row, e) {
    if (!NB.tabs || typeof NB.tabs.openTabMenu !== "function") return;
    const opts = {
      anchor: row,
      host: viewEl,
      onClose: () => { if (menuPath === path) menuPath = null; },
    };
    if (e && (e.clientX || e.clientY)) {
      opts.x = e.clientX;
      opts.y = e.clientY;
    }
    if (NB.tabs.openTabMenu(path, opts)) menuPath = path;
  }

  function baseName(path) {
    const p = String(path == null ? "" : path);
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  /* --- drag-and-drop reorder -------------------------------------------- */
  /* The pointer contract is the Sessions view's: the wrapper is the drag
   * item, the model call is NB.tabs.moveTab, and the tabs:changed it emits
   * re-renders the rows, so nothing here calls refresh() after a drop. */
  function canReorder() {
    // Matches the Move-to-session guard: a viewer keeps the list read-only.
    return NB.pageRole ? NB.pageRole() === "admin" : true;
  }

  function rowWrapAt(node) {
    const wrap = node && node.closest ? node.closest(WRAP_SELECTOR) : null;
    return wrap && wrap.dataset.path ? wrap : null;
  }

  function clearDropMarks() {
    if (!listEl) return;
    listEl.querySelectorAll(MARK_SELECTOR).forEach((wrap) => {
      wrap.classList.remove(DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
    });
    listEl.classList.remove(DROP_EMPTY_CLASS);
  }

  function clearDrag() {
    dragPath = null;
    if (!listEl) return;
    listEl.querySelectorAll("." + DRAGGING_CLASS)
      .forEach((wrap) => wrap.classList.remove(DRAGGING_CLASS));
    clearDropMarks();
  }

  function wireDnD() {
    if (!listEl) return;

    listEl.addEventListener("dragstart", (e) => {
      // A press on the close button is a click, not a drag (the strip's rule).
      // The press flag is the one that fires in a browser that retargets the
      // event; the target check still guards one that does not.
      const fromClose = dragFromClose;
      dragFromClose = false;
      if (!canReorder() || fromClose ||
          (e.target.closest && e.target.closest(CLOSE_SELECTOR))) {
        // A dragstart refused here produces no dragend, so no marks are left.
        e.preventDefault();
        return;
      }
      const wrap = rowWrapAt(e.target);
      if (!wrap) { e.preventDefault(); return; }
      dragPath = wrap.dataset.path;
      wrap.classList.add(DRAGGING_CLASS);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", dragPath); } catch (_) {}
      }
    });

    listEl.addEventListener("dragover", (e) => {
      if (!dragPath) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearDropMarks();
      const wrap = rowWrapAt(e.target);
      if (!wrap) {
        // Off the rows but still in the list: the tab lands last.
        listEl.classList.add(DROP_EMPTY_CLASS);
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      wrap.classList.add(before ? DROP_BEFORE_CLASS : DROP_AFTER_CLASS);
    });

    listEl.addEventListener("drop", (e) => {
      if (!dragPath) return;
      e.preventDefault();
      const fromPath = dragPath;
      const wrap = rowWrapAt(e.target);
      let targetPath = null;
      let before = true;
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        targetPath = wrap.dataset.path;
        before = e.clientY < rect.top + rect.height / 2;
      }
      // Clear first: moveTab renders through tabs:changed synchronously, so
      // state cleared after the call would mark rows that no longer exist.
      clearDrag();
      swallowClick = true;
      if (!NB.tabs || typeof NB.tabs.moveTab !== "function") return;
      try { NB.tabs.moveTab(fromPath, targetPath, before); }
      catch (err) { console.error("tab reorder failed", err); }
    });

    listEl.addEventListener("dragend", clearDrag);

    // A keyboard activation fires click with no press, so the drop guard is
    // cleared here too: it must never eat an Enter.
    listEl.addEventListener("keydown", () => { swallowClick = false; });

    // dragleave also fires moving between rows, so only a leave of the list
    // itself clears: a real exit reports a relatedTarget outside it.
    listEl.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && listEl.contains(e.relatedTarget)) return;
      clearDrag();
    });
  }

  /* --- wiring ------------------------------------------------------------ */
  buildView();
  refresh();
  wireDnD();

  /* viewer:dirty-changed fires per keystroke, not per debounce (the CM6
   * update listener relays every transaction and the payload already says
   * whether the file is dirty). A repeat of the bit a row shows is skipped
   * with one lookup; only a real transition pays for a full signature, which
   * serialises the document through viewer.isDirty(). */
  function unchanged(shown, evt, key) {
    return !!evt && shown.has(evt.path) &&
      shown.get(evt.path) === (evt[key] ? 1 : 0);
  }

  // Re-render even while the view is hidden, so opening it never shows a
  // stale row or count -- but only when what a row says changed, or the
  // per-keystroke dirty pass would rebuild every row and reset the scroll.
  // A render during a drag detaches the source row, so the drag is abandoned
  // first: the drop would otherwise resolve against rows the user never saw.
  NB.evt.on("tabs:changed", () => {
    clearDrag();
    refresh();
  });
  NB.evt.on("viewer:dirty-changed", (evt) => {
    if (unchanged(shownDirty, evt, "dirty")) return;
    refresh();
  });
  NB.evt.on("viewer:conflict", (evt) => {
    if (unchanged(shownConflict, evt, "conflict")) return;
    refresh();
  });
})();
