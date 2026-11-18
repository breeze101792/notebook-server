/* sessions-page.js -- the §sessions content page.
 *
 * Every session as a card, every card listing its own unpinned tabs, so a
 * tab can be moved from one session to another by dragging it, or by the
 * row menu. The page is a special tab: it renders in the content area beside
 * the reader and both panels stay (docs/ui/sessions-page.md is the spec).
 *
 * The model lives in tabs.js; this module reads NB.tabs.snapshot() /
 * getActiveSessionId() / getActive() / isSpecial() / getSpecial() /
 * isConflicted() / NB.viewer.isDirty(), and writes only through
 * NB.tabs.moveSessionTabs() / swapTo() / activate(). The host
 * (#sessions-page) ships empty in index.html and this module builds the
 * header, grid, cards and footer at load, the sessions.js pattern: there is
 * no mount path, so scroll and row state survive every view switch.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const TAB_ID = "§sessions";
  const TAB_ICON = "nb-icon-session";
  const TAB_LABEL = "Sessions";
  const VIEW_ID = "sessions-page";

  const CARD_CLASS = "session-card";
  const ROW_WRAP_CLASS = "session-card-tab-wrap";
  const ROW_CLASS = "session-card-tab";
  const SELECTED_CLASS = "is-selected";
  const DRAGGING_CLASS = "is-dragging";
  const DROP_CLASS = "is-drop-target";
  const CARD_SELECTOR = "." + CARD_CLASS;
  const WRAP_SELECTOR = "." + ROW_WRAP_CLASS;
  const ROW_SELECTOR = "." + ROW_CLASS;

  const TITLE = "Sessions";
  const FOOT_DRAG = "Drag a tab onto another session to move it. ";
  const FOOT_PIN = "Pinned tabs are shared and are not listed here.";
  const EMPTY_TEXT = "No tabs";
  const MOVE_MENU = "Move to session";
  const MOVE_HERE = "Move here";
  const ONLY_SESSION = "There is only one session.";
  const READ_ONLY = "Read-only: sessions can’t be changed.";
  const SELECTED_ONE = "1 tab selected";
  const SELECTED_MANY = " tabs selected";
  const CLEARED = "Selection cleared";
  const CLEAR_LABEL = "Clear selection";

  const LABEL_SELECTED = ", selected";
  const LABEL_DIRTY = ", unsaved changes";
  const LABEL_CONFLICT = ", changed on disk";
  const LABEL_CURRENT_CARD = ", current session";

  // Selection keys join a session id and a path. The separator is a control
  // character, so no id or path can be read as two fields.
  const KEY_SEP = "\u0001";
  // Signature separators, the tabs-view.js rule.
  const SIG_FIELD = "\u0002";
  const SIG_CARD = "\u0003";
  const SIG_END = "\u0004";

  const MENU_OWNER = "sessions-page";
  const MENU_GAP = 2;
  const MENU_INSET = 8;

  const CLOSE_ICON = '<svg class="icon" aria-hidden="true" focusable="false">' +
    '<use href="#nb-icon-close"/></svg>';
  const CONFLICT_ICON = '<svg class="icon" aria-hidden="true" focusable="false">' +
    '<use href="#nb-icon-conflict"/></svg>';

  const pageEl = document.getElementById(VIEW_ID);
  // A shell without the host (an older cached index.html) gets no page.
  if (!pageEl || !NB.tabs || typeof NB.tabs.registerSpecial !== "function") return;

  const sessionFull = (NB.tabs.messages && NB.tabs.messages.sessionFull) || "";

  let titleEl = null;
  let summaryEl = null;
  let chipEl = null;
  let chipNumEl = null;
  let liveEl = null;
  let bodyEl = null;
  let gridEl = null;
  let footEl = null;

  // The visible state the current cards were built from; a rebuild runs only
  // when it moved (the sessions.js guard).
  let lastSig = null;
  // Selection: key -> { sessionId, path }. Keys are per occurrence, because
  // the same note may be open in two sessions.
  const selected = new Map();
  // The row the next Shift+click ranges from.
  let anchor = null;
  // The dragged rows, or null. Held as data so a rebuild cannot inherit a
  // mark from the rows it replaced.
  let dragItems = null;
  // The model at dragstart: a mid-drag change abandons the drag, so the
  // cards the pointer crosses are the cards this held.
  let dragSessions = null;
  // The card carrying the drop mark, or null. One at a time.
  let dropCard = null;
  // A drop must never also open the tab it released over.
  let swallowClick = false;
  // The row a menu-driven move should focus once the target has it.
  let pendingFocus = null;
  // True while a jump is switching sessions, so a double click cannot queue
  // two swaps.
  let jumping = false;
  // True while this page's row menu is open.
  let menuOpen = false;

  /* --- the model as this page shows it -------------------------------- */
  function snapshot() {
    const snap = NB.tabs.snapshot ? NB.tabs.snapshot() : [];
    return Array.isArray(snap) ? snap : [];
  }

  function activeSessionId() {
    return NB.tabs.getActiveSessionId ? NB.tabs.getActiveSessionId() : "";
  }

  function activePath() {
    return NB.tabs.getActive ? NB.tabs.getActive() : null;
  }

  function isSpecialPath(path) {
    return !!(NB.tabs.isSpecial && NB.tabs.isSpecial(path));
  }

  function specialSpec(path) {
    return isSpecialPath(path) && NB.tabs.getSpecial ? (NB.tabs.getSpecial(path) || null) : null;
  }

  function isDirty(path) {
    return !isSpecialPath(path) && !!(NB.viewer && NB.viewer.isDirty &&
      NB.viewer.isDirty(path));
  }

  function isConflicted(path) {
    return !isSpecialPath(path) && !!(NB.tabs.isConflicted &&
      NB.tabs.isConflicted(path));
  }

  function isAdmin() {
    return NB.pageRole ? NB.pageRole() === "admin" : true;
  }

  /* The model's own per-session bit, so the card dot cannot disagree with
   * the Sessions view (it also covers a hybrid edit on the live file). */
  function sessionDirty(s) {
    const list = NB.tabs.getSessionList ? NB.tabs.getSessionList() : [];
    const row = list.find((x) => x.id === s.id);
    if (row) return !!row.dirty;
    return (s.openFiles || []).some(isDirty);
  }

  function baseName(path) {
    const p = String(path == null ? "" : path);
    const i = p.lastIndexOf("/");
    return i < 0 ? p : p.slice(i + 1);
  }

  function rowName(path) {
    const spec = specialSpec(path);
    return spec && spec.label ? spec.label : baseName(path);
  }

  function keyOf(sessionId, path) {
    return sessionId + KEY_SEP + path;
  }

  function labelCount(n, one, many) {
    return n + (n === 1 ? one : many);
  }

  function countText(n) {
    return labelCount(n, " tab", " tabs");
  }

  /* --- view construction ---------------------------------------------- */
  /* Build the header, the grid, the footer and the live region once, at
   * load. The anatomy is the graph page's: a 47 px header, the scroller, a
   * footer; the header carries the page title, the summary and the selection
   * chip. */
  function buildView() {
    pageEl.textContent = "";

    const header = document.createElement("header");
    header.className = "sessions-page-header";
    titleEl = document.createElement("h1");
    titleEl.className = "sessions-page-title";
    titleEl.tabIndex = -1;          // focus fallback when the last row goes
    titleEl.textContent = TITLE;
    header.appendChild(titleEl);

    summaryEl = document.createElement("span");
    summaryEl.className = "sessions-page-summary";
    header.appendChild(summaryEl);

    chipEl = document.createElement("span");
    chipEl.className = "sessions-page-selection";
    chipEl.hidden = true;
    chipNumEl = document.createElement("span");
    chipNumEl.className = "sessions-page-selection-n";
    chipEl.appendChild(chipNumEl);
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "sessions-page-clear";
    clearBtn.setAttribute("aria-label", CLEAR_LABEL);
    clearBtn.title = CLEAR_LABEL;
    clearBtn.innerHTML = CLOSE_ICON;
    clearBtn.addEventListener("click", () => clearSelection());
    chipEl.appendChild(clearBtn);
    header.appendChild(chipEl);

    pageEl.appendChild(header);

    bodyEl = document.createElement("div");
    bodyEl.className = "sessions-page-body";
    gridEl = document.createElement("div");
    gridEl.className = "sessions-page-grid";
    bodyEl.appendChild(gridEl);
    pageEl.appendChild(bodyEl);

    footEl = document.createElement("p");
    footEl.className = "sessions-page-foot";
    pageEl.appendChild(footEl);

    // The selection announcements; the chip is not a live region, so a
    // keyboard toggle would otherwise be silent.
    liveEl = document.createElement("p");
    liveEl.className = "sr-only sessions-page-live";
    liveEl.setAttribute("role", "status");
    liveEl.setAttribute("aria-live", "polite");
    pageEl.appendChild(liveEl);
  }

  /* --- render --------------------------------------------------------- */
  /* What the page shows, serialised: the card order, each session's name and
   * tab list, the active session and the active tab. Pins are visible
   * through openFiles because pinning strips a path from every session. */
  function signature(snap) {
    const parts = snap.map((s) => [
      s.id,
      s.name,
      s.activeFile || "",
      (s.openFiles || []).join(SIG_FIELD),
    ].join(SIG_FIELD));
    parts.push(SIG_END, activeSessionId(), SIG_FIELD, activePath() || "");
    return parts.join(SIG_CARD);
  }

  function refresh() {
    const snap = snapshot();
    const sig = signature(snap);
    pruneSelection(snap);
    updateChrome(snap);
    if (sig === lastSig) return;
    render(snap, sig);
  }

  /* A re-render replaces every row, so focus is captured by key first and
   * restored after, and the scroller keeps its position. */
  function render(snap, sig) {
    if (!gridEl) return;
    const keep = focusedKey();
    const scrollTop = bodyEl ? bodyEl.scrollTop : 0;

    dropCard = null;                 // the old card nodes go with the old grid
    gridEl.textContent = "";
    snap.forEach((s, i) => gridEl.appendChild(buildCard(s, i)));

    if (bodyEl) bodyEl.scrollTop = scrollTop;
    if (keep || pendingFocus) restoreFocus(keep);
    lastSig = sig;
  }

  function updateChrome(snap) {
    if (summaryEl) {
      const tabs = snap.reduce((n, s) => n + (s.openFiles || []).length, 0);
      summaryEl.textContent = labelCount(snap.length, " session", " sessions") +
        " · " + labelCount(tabs, " tab", " tabs");
    }
    updateChip();
    if (footEl) footEl.textContent = (isAdmin() ? FOOT_DRAG : "") + FOOT_PIN;
  }

  function buildCard(s, index) {
    const id = s.id;
    const current = id === activeSessionId();
    const dirty = sessionDirty(s);

    const card = document.createElement("section");
    card.className = CARD_CLASS + (current ? " is-current" : "");
    card.dataset.sessionId = id;

    const header = document.createElement("div");
    header.className = "session-card-header";

    const title = document.createElement("h2");
    title.className = "session-card-title";
    title.id = "sp-card-" + index;

    const name = document.createElement("span");
    name.className = "session-card-name";
    name.textContent = s.name;
    name.title = s.name;
    title.appendChild(name);

    const count = document.createElement("span");
    count.className = "session-card-count";
    count.textContent = countText((s.openFiles || []).length);
    count.dataset.countText = count.textContent;
    title.appendChild(count);

    const dirtySr = document.createElement("span");
    dirtySr.className = "sr-only sr-dirty";
    dirtySr.textContent = dirty ? LABEL_DIRTY : "";
    title.appendChild(dirtySr);

    if (current) {
      const currentSr = document.createElement("span");
      currentSr.className = "sr-only";
      currentSr.textContent = LABEL_CURRENT_CARD;
      title.appendChild(currentSr);
    }
    header.appendChild(title);
    if (dirty) header.appendChild(dotEl());
    card.appendChild(header);
    card.setAttribute("aria-labelledby", title.id);

    const files = s.openFiles || [];
    if (!files.length) {
      const empty = document.createElement("p");
      empty.className = "session-card-empty";
      empty.textContent = EMPTY_TEXT;
      card.appendChild(empty);
      return card;
    }

    const list = document.createElement("ul");
    list.className = "session-card-list";
    for (const path of files) list.appendChild(buildRow(id, path));
    card.appendChild(list);
    return card;
  }

  function dotEl() {
    const dot = document.createElement("span");
    dot.className = "session-card-dot";
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }

  function buildRow(sessionId, path) {
    const key = keyOf(sessionId, path);
    const name = rowName(path);
    const dirty = isDirty(path);
    const conflict = isConflicted(path);
    const on = selected.has(key);
    const special = isSpecialPath(path);
    const current = sessionId === activeSessionId() && path === activePath();

    // A button cannot be the drag source without becoming its own handle, so
    // the wrapper carries the facts and the drag (the Sessions row's shape).
    const wrap = document.createElement("li");
    wrap.className = ROW_WRAP_CLASS;
    wrap.dataset.path = path;
    wrap.dataset.sessionId = sessionId;
    wrap.dataset.key = key;
    wrap.dataset.name = name;
    if (isAdmin()) wrap.draggable = true;
    if (special) wrap.classList.add("is-special");

    const row = document.createElement("button");
    row.type = "button";
    row.className = ROW_CLASS + (on ? " " + SELECTED_CLASS : "");
    row.dataset.path = path;
    row.dataset.sessionId = sessionId;
    row.dataset.key = key;
    row.dataset.name = name;
    row.title = special ? name : path;
    row.setAttribute("aria-label", labelFor(name, on, dirty, conflict));
    if (current) row.setAttribute("aria-current", "true");

    row.appendChild(buildMark(path));
    const label = document.createElement("span");
    label.className = "session-card-tab-name";
    label.textContent = name;
    row.appendChild(label);
    row.appendChild(buildState(dirty, conflict));
    wrap.appendChild(row);
    return wrap;
  }

  function labelFor(name, on, dirty, conflict) {
    let text = name;
    if (on) text += LABEL_SELECTED;
    if (dirty) text += LABEL_DIRTY;
    if (conflict) text += LABEL_CONFLICT;
    return text;
  }

  function buildMark(path) {
    const mark = document.createElement("span");
    mark.className = "session-card-mark";
    mark.setAttribute("aria-hidden", "true");
    const spec = specialSpec(path);
    const icon = spec && spec.icon ? spec.icon : "";
    if (icon.indexOf("nb-icon-") === 0) {
      mark.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false">' +
        '<use href="#' + icon + '"/></svg>';
    } else if (icon) {
      const glyph = document.createElement("span");
      glyph.textContent = icon;
      mark.appendChild(glyph);
    } else {
      mark.classList.add("is-empty");
    }
    return mark;
  }

  /* The state column, one box for both facts: a conflict only exists on an
   * unsaved file, so it replaces the dot rather than taking a second column. */
  function buildState(dirty, conflict) {
    const state = document.createElement("span");
    state.className = "session-card-state";
    state.setAttribute("aria-hidden", "true");
    if (conflict) state.innerHTML = CONFLICT_ICON;
    else if (dirty) state.appendChild(dotEl());
    else state.classList.add("is-empty");
    return state;
  }

  /* --- focus across a rebuild ------------------------------------------ */
  function focusedKey() {
    const active = document.activeElement;
    if (!active || !pageEl.contains(active)) return null;
    const wrap = active.closest ? active.closest(WRAP_SELECTOR) : null;
    return wrap && wrap.dataset.key ? wrap.dataset.key : null;
  }

  function wrapByKey(key) {
    if (!gridEl || !key) return null;
    return Array.from(gridEl.querySelectorAll(WRAP_SELECTOR))
      .find((wrap) => wrap.dataset.key === key) || null;
  }

  /* The remembered row can be gone (it moved, or another client closed it);
   * then the page's title holds focus rather than <body>. A menu-driven move
   * focuses the row at its new key, which the caller queued before the
   * model changed. */
  function restoreFocus(keep) {
    let key = keep;
    if (pendingFocus) {
      key = keyOf(pendingFocus.sessionId, pendingFocus.path);
      pendingFocus = null;
    }
    const wrap = wrapByKey(key);
    const row = wrap ? wrap.querySelector(ROW_SELECTOR) : null;
    const target = row || titleEl;
    if (target) target.focus({ preventScroll: true });
  }

  /* --- selection ------------------------------------------------------- */
  function pruneSelection(snap) {
    if (!selected.size && !anchor) return;
    const alive = new Set();
    for (const s of snap) {
      for (const p of s.openFiles || []) alive.add(keyOf(s.id, p));
    }
    for (const key of Array.from(selected.keys())) {
      if (!alive.has(key)) selected.delete(key);
    }
    if (anchor && !alive.has(keyOf(anchor.sessionId, anchor.path))) anchor = null;
  }

  function announce(text) {
    if (liveEl) liveEl.textContent = text;
  }

  function announceSelection() {
    announce(selected.size
      ? (selected.size === 1 ? SELECTED_ONE : selected.size + SELECTED_MANY)
      : CLEARED);
  }

  function updateChip() {
    if (!chipEl) return;
    const hadFocus = chipEl.contains(document.activeElement);
    // A single selection is the row's face alone; the chip marks multi-select.
    chipEl.hidden = selected.size < 2;
    if (hadFocus && chipEl.hidden && titleEl) titleEl.focus({ preventScroll: true });
    if (chipNumEl) {
      chipNumEl.textContent = selected.size === 1
        ? SELECTED_ONE : selected.size + SELECTED_MANY;
    }
  }

  /* Selection is a face and a phrase; a rebuild is not needed to paint it. */
  function repaintRows() {
    if (!gridEl) return;
    for (const wrap of gridEl.querySelectorAll(WRAP_SELECTOR)) {
      const row = wrap.querySelector(ROW_SELECTOR);
      if (!row) continue;
      const on = selected.has(wrap.dataset.key);
      row.classList.toggle(SELECTED_CLASS, on);
      row.setAttribute("aria-label", labelFor(
        wrap.dataset.name || "", on,
        isDirty(wrap.dataset.path), isConflicted(wrap.dataset.path)));
    }
  }

  function paintRow(key) {
    const wrap = wrapByKey(key);
    if (!wrap) return;
    const row = wrap.querySelector(ROW_SELECTOR);
    if (!row) return;
    const on = selected.has(key);
    row.classList.toggle(SELECTED_CLASS, on);
    row.setAttribute("aria-label", labelFor(
      wrap.dataset.name || "",
      on,
      isDirty(wrap.dataset.path),
      isConflicted(wrap.dataset.path)));
  }

  function toggleKey(key) {
    if (!isAdmin() || !key) return;
    const wrap = wrapByKey(key);
    if (!wrap) return;
    if (selected.has(key)) selected.delete(key);
    else selected.set(key, { sessionId: wrap.dataset.sessionId, path: wrap.dataset.path });
    anchor = { sessionId: wrap.dataset.sessionId, path: wrap.dataset.path };
    paintRow(key);
    updateChip();
    announceSelection();
  }

  /* A plain click selects that row and nothing else. Multi-select is
   * explicit: Ctrl/Cmd adds or removes, Shift ranges (docs §7). */
  function selectOnly(key, sessionId, path) {
    if (!isAdmin() || !key) return;
    const same = selected.size === 1 && selected.has(key);
    selected.clear();
    selected.set(key, { sessionId, path });
    anchor = { sessionId, path };
    repaintRows();
    if (same) return;
    updateChip();
    announce(SELECTED_ONE);
  }

  /* Shift+click replaces that card's selection with the range from the
   * anchor, and leaves every other card's rows alone. */
  function selectRange(sessionId, path) {
    if (!isAdmin()) return;
    const snap = snapshot();
    const s = snap.find((x) => x.id === sessionId);
    if (!s) return;
    const files = s.openFiles || [];
    const to = files.indexOf(path);
    if (to < 0) return;
    const from = anchor && anchor.sessionId === sessionId
      ? files.indexOf(anchor.path) : -1;
    if (from < 0) {
      selected.set(keyOf(sessionId, path), { sessionId, path });
      anchor = { sessionId, path };
      paintRow(keyOf(sessionId, path));
      updateChip();
      announceSelection();
      return;
    }
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (const key of Array.from(selected.keys())) {
      if (selected.get(key).sessionId === sessionId) {
        selected.delete(key);
        paintRow(key);
      }
    }
    for (let i = lo; i <= hi; i += 1) {
      const p = files[i];
      selected.set(keyOf(sessionId, p), { sessionId, path: p });
      paintRow(keyOf(sessionId, p));
    }
    anchor = { sessionId, path };
    updateChip();
    announceSelection();
  }

  function clearSelection(focusKey, moveFocus) {
    if (!selected.size) return;
    const last = focusKey || Array.from(selected.keys()).pop();
    selected.clear();
    anchor = null;
    repaintRows();
    updateChip();
    announce(CLEARED);
    // A pointer click already focuses the row it landed on; only the chip's
    // button needs the focus moved, or it would fall to <body> when the chip
    // hides.
    if (moveFocus === false) return;
    const wrap = wrapByKey(last);
    const row = wrap ? wrap.querySelector(ROW_SELECTOR) : null;
    const target = row || titleEl;
    if (target) target.focus({ preventScroll: true });
  }

  /* --- drag ------------------------------------------------------------ */
  function wrapOf(node) {
    const wrap = node && node.closest ? node.closest(WRAP_SELECTOR) : null;
    return wrap && wrap.dataset.key ? wrap : null;
  }

  function cardOf(node) {
    const card = node && node.closest ? node.closest(CARD_SELECTOR) : null;
    return card && card.dataset.sessionId ? card : null;
  }

  function holdsAll(session, items) {
    const files = (session && session.openFiles) || [];
    return items.every((it) => files.indexOf(it.path) >= 0);
  }

  function markDropCard(card) {
    if (dropCard === card) return;
    unmarkDropCard();
    if (!card) return;
    dropCard = card;
    card.classList.add(DROP_CLASS);
    const count = card.querySelector(".session-card-count");
    if (count) count.textContent = MOVE_HERE;
  }

  function unmarkDropCard() {
    if (!dropCard) return;
    dropCard.classList.remove(DROP_CLASS);
    const count = dropCard.querySelector(".session-card-count");
    if (count && count.dataset.countText) count.textContent = count.dataset.countText;
    dropCard = null;
  }

  function clearDrag() {
    dragItems = null;
    dragSessions = null;
    unmarkDropCard();
    Array.from(gridEl.querySelectorAll("." + DRAGGING_CLASS))
      .forEach((wrap) => wrap.classList.remove(DRAGGING_CLASS));
  }

  function wireDnD() {
    gridEl.addEventListener("dragstart", (e) => {
      if (!isAdmin()) { e.preventDefault(); return; }
      const wrap = wrapOf(e.target);
      if (!wrap) { e.preventDefault(); return; }
      const key = wrap.dataset.key;
      dragSessions = snapshot();
      dragItems = selected.has(key)
        ? Array.from(selected.values()).map((it) => ({ sourceId: it.sessionId, path: it.path }))
        : [{ sourceId: wrap.dataset.sessionId, path: wrap.dataset.path }];
      for (const it of dragItems) {
        const w = wrapByKey(keyOf(it.sourceId, it.path));
        if (w) w.classList.add(DRAGGING_CLASS);
      }
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", dragItems[0].path); } catch (_) {}
      }
    });

    gridEl.addEventListener("dragover", (e) => {
      if (!dragItems) return;
      const card = cardOf(e.target);
      const session = card
        ? (dragSessions || []).find((s) => s.id === card.dataset.sessionId) : null;
      // No mark where the batch would be empty: the card already holds every
      // carried path, so the drop is a no-op.
      if (!card || !session || holdsAll(session, dragItems)) {
        unmarkDropCard();
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      markDropCard(card);
    });

    gridEl.addEventListener("drop", (e) => {
      if (!dragItems) return;
      const card = cardOf(e.target);
      if (!card) return;
      e.preventDefault();
      const targetId = card.dataset.sessionId;
      const session = (dragSessions || []).find((s) => s.id === targetId);
      if (session && holdsAll(session, dragItems)) { clearDrag(); return; }
      const items = dragItems.slice();
      // Clear first: the model emits tabs:changed synchronously, and a mark
      // cleared after it would paint rows that no longer exist.
      clearDrag();
      swallowClick = true;
      try {
        if (!NB.tabs.moveSessionTabs) return;
        const done = NB.tabs.moveSessionTabs(targetId, items);
        if (done && typeof done.catch === "function") {
          done.catch((err) => console.error("tab move failed", err));
        }
      } catch (err) { console.error("tab move failed", err); }
    });

    gridEl.addEventListener("dragend", clearDrag);

    gridEl.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && gridEl.contains(e.relatedTarget)) return;
      unmarkDropCard();
    });
  }

  /* A click anywhere on the page that is not a row and not the chip ends
   * the selection: empty space, a card header, the footer, the body. The
   * row's own click runs first (it is inside the grid), so this only sees
   * what the rows did not take. Opening the row menu is not a click here;
   * its outside-click handling belongs to NB.menu. */
  function wireBackground() {
    pageEl.addEventListener("click", (e) => {
      if (!selected.size) return;
      if (e.target.closest && (e.target.closest(ROW_SELECTOR) ||
          e.target.closest(".sessions-page-selection"))) return;
      clearSelection(undefined, false);
    });
  }

  /* --- the row menu ---------------------------------------------------- */
  /* The drag has no keyboard or touch path; this is it. One item, whose
   * submenu lists the sessions the batch would actually enter. */
  function carriedFor(sessionId, path) {
    const key = keyOf(sessionId, path);
    if (!selected.has(key)) return [{ sourceId: sessionId, path }];
    return Array.from(selected.values())
      .map((it) => ({ sourceId: it.sessionId, path: it.path }));
  }

  function openRowMenu(sessionId, path, x, y, scope) {
    if (!NB.menu || !NB.menu.open) return;
    const carried = carriedFor(sessionId, path);
    const targets = snapshot().filter((s) => !holdsAll(s, carried));
    const limit = sessionLimit();
    const items = targets.map((s) => {
      const files = s.openFiles || [];
      const fresh = carried.filter((it) => files.indexOf(it.path) < 0);
      const full = !!limit && files.length + fresh.length > limit;
      return {
        label: s.name,
        disabled: full,
        title: full ? sessionFull : undefined,
        handler: () => {
          pendingFocus = { sessionId: s.id, path };
          let done = null;
          try {
            done = NB.tabs.moveSessionTabs
              ? NB.tabs.moveSessionTabs(s.id, carried) : null;
          } catch (err) {
            console.error("tab move failed", err);
          }
          if (!done || typeof done.then !== "function") return;
          // A refusal resolves false: nothing re-rendered, so the queued
          // focus would leak into an unrelated later rebuild.
          done.then((ok) => {
            if (ok) return;
            pendingFocus = null;
            const row = scope && scope.isConnected ? scope.querySelector(ROW_SELECTOR) : null;
            (row || titleEl).focus({ preventScroll: true });
          }, (err) => {
            pendingFocus = null;
            console.error("tab move failed", err);
          });
        },
      };
    });
    const parent = { label: MOVE_MENU, submenu: items };
    if (!isAdmin()) {
      parent.disabled = true;
      parent.title = READ_ONLY;
    } else if (!items.length) {
      parent.disabled = true;
      parent.title = ONLY_SESSION;
    }
    menuOpen = true;
    NB.menu.open({
      owner: MENU_OWNER,
      x: x,
      y: y,
      scope: scope,
      items: [parent],
      focusFirst: true,
      onClose: (reason) => {
        menuOpen = false;
        if (reason === "esc" && scope && scope.isConnected) {
          const row = scope.querySelector(ROW_SELECTOR);
          if (row) row.focus({ preventScroll: true });
        }
      },
    });
  }

  function sessionLimit() {
    return (NB.tabs.limits && NB.tabs.limits.filesMax) || 0;
  }

  function menuAt(e, wrap, row) {
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    let x = e.clientX;
    let y = e.clientY;
    if (!x && !y) {
      x = rect.left + MENU_INSET;
      y = rect.bottom + MENU_GAP;
    }
    openRowMenu(wrap.dataset.sessionId, wrap.dataset.path, x, y, wrap);
  }

  /* --- opening a tab --------------------------------------------------- */
  /* One jump at a time. A swap that fails leaves the page and the focus
   * where they were; a swap that succeeds has already replaced the page. */
  async function jump(sessionId, path) {
    if (jumping) return;
    if (!path || !NB.tabs.activate) return;
    jumping = true;
    try {
      if (sessionId !== activeSessionId()) {
        const ok = await NB.tabs.swapTo(sessionId);
        if (!ok) return;
      }
      await NB.tabs.activate(path);
    } catch (err) {
      console.error("open tab failed", err);
    } finally {
      jumping = false;
    }
  }

  /* --- wiring ---------------------------------------------------------- */
  function wireGrid() {
    gridEl.addEventListener("click", (e) => {
      const row = e.target.closest ? e.target.closest(ROW_SELECTOR) : null;
      if (!row) return;
      if (swallowClick) { swallowClick = false; return; }
      const wrap = wrapOf(row);
      if (!wrap) return;
      // A keyboard activation (Enter) reports detail 0 and no modifiers; it
      // is a jump, like a plain click.
      if (e.detail === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        jump(wrap.dataset.sessionId, wrap.dataset.path);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleKey(wrap.dataset.key);
        return;
      }
      if (e.shiftKey) {
        selectRange(wrap.dataset.sessionId, wrap.dataset.path);
        return;
      }
      // A single click selects that row alone; it never opens. Opening is a
      // double click, or Enter.
      selectOnly(wrap.dataset.key, wrap.dataset.sessionId, wrap.dataset.path);
    });

    gridEl.addEventListener("dblclick", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      const row = e.target.closest ? e.target.closest(ROW_SELECTOR) : null;
      const wrap = wrapOf(row);
      if (!wrap) return;
      jump(wrap.dataset.sessionId, wrap.dataset.path);
    });

    gridEl.addEventListener("mousedown", () => { swallowClick = false; });
    // A keyboard activation fires no mousedown; the guard must never eat an
    // Enter either (the tabs-view rule).
    gridEl.addEventListener("keydown", () => { swallowClick = false; });

    gridEl.addEventListener("keydown", (e) => {
      const row = e.target.closest ? e.target.closest(ROW_SELECTOR) : null;
      if (!row) return;
      const wrap = wrapOf(row);
      if (!wrap) return;
      if (e.key === " " || e.key === "Spacebar") {
        // The native activation fires on keyup; preventing it here is what
        // keeps Space a selection toggle rather than an open.
        e.preventDefault();
        toggleKey(wrap.dataset.key);
        return;
      }
      if (e.key === "F10" && e.shiftKey) {
        menuAt(e, wrap, row);
        return;
      }
      if (e.key === "ContextMenu" || e.key === "Apps") {
        menuAt(e, wrap, row);
      }
    });

    gridEl.addEventListener("contextmenu", (e) => {
      const row = e.target.closest ? e.target.closest(ROW_SELECTOR) : null;
      const wrap = wrapOf(row);
      if (!wrap) return;
      menuAt(e, wrap, row);
    });
  }

  /* A dirty bit or a conflict arrives per path; patch those rows and their
   * card's dot rather than rebuilding the grid on every keystroke. */
  function patchPath(path) {
    if (!gridEl || !path) return;
    const wraps = Array.from(gridEl.querySelectorAll(WRAP_SELECTOR))
      .filter((wrap) => wrap.dataset.path === path);
    for (const wrap of wraps) {
      const cell = wrap.querySelector(".session-card-state");
      const dirty = isDirty(path);
      const conflict = isConflicted(path);
      if (cell) {
        const fresh = buildState(dirty, conflict);
        cell.replaceWith(fresh);
      }
      const row = wrap.querySelector(ROW_SELECTOR);
      if (row) {
        row.setAttribute("aria-label", labelFor(
          wrap.dataset.name || "", selected.has(wrap.dataset.key), dirty, conflict));
      }
      const card = wrap.closest(CARD_SELECTOR);
      if (card) patchCardDot(card);
    }
  }

  function patchCardDot(card) {
    const s = snapshot().find((x) => x.id === card.dataset.sessionId);
    if (!s) return;
    const dirty = sessionDirty(s);
    const dot = card.querySelector(".session-card-header .session-card-dot");
    const sr = card.querySelector(".sr-dirty");
    if (dirty && !dot) {
      const header = card.querySelector(".session-card-header");
      if (header) header.appendChild(dotEl());
    } else if (!dirty && dot) {
      dot.remove();
    }
    if (sr) sr.textContent = dirty ? LABEL_DIRTY : "";
  }

  buildView();
  refresh();
  wireGrid();
  wireDnD();
  wireBackground();

  NB.evt.on("tabs:changed", () => {
    // A re-render detaches the source row, so dragend never arrives: the
    // drag must be abandoned before the rebuild, not after it.
    clearDrag();
    // Off screen, the rebuild is 20 x 40 rows of work nobody sees; the
    // signature is left stale and onActivate refreshes.
    if (pageEl.hidden) return;
    refresh();
  });
  NB.evt.on("viewer:dirty-changed", (evt) => {
    if (evt && evt.path) patchPath(evt.path);
  });
  NB.evt.on("viewer:conflict", (evt) => {
    if (evt && evt.path) patchPath(evt.path);
  });

  NB.tabs.registerSpecial({
    id: TAB_ID,
    icon: TAB_ICON,
    label: TAB_LABEL,
    onActivate: () => {
      pageEl.hidden = false;
      refresh();
    },
    onClose: () => {
      clearDrag();
      if (menuOpen && NB.menu && NB.menu.close) NB.menu.close();
      pageEl.hidden = true;
    },
  });
})();
