/* sessions.js -- the Sessions side-panel view (NB.sessions).
 *
 * Lists one row per session in creation order: the name, its unpinned tab
 * count, a dot when one of its files has unsaved changes, and a per-row
 * actions button. A name dialog creates and renames; a native confirm
 * deletes. The model, the tab data and the persistence live in tabs.js;
 * this module reads NB.tabs.getSessionList() / getActiveSessionId() and
 * writes only through the NB.tabs.* session operations.
 *
 * The activity host (#sessions-view) ships empty in index.html; this module
 * populates it at load with a .panel-header, the scrolling list and the
 * footnote, the bookmarks.js pattern. There is no mount path: the host stays
 * in the DOM, so list state survives every view switch.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const VIEW_ID = "sessions-view";
  const LIST_ID = "sessions-list";
  const DIALOG_ID = "session-dialog";
  const FORM_ID = "session-form";
  const TITLE_ID = "session-dialog-title";
  const HELP_ID = "session-dialog-help";
  const NAME_ID = "session-name";
  const ERROR_ID = "session-error";
  const SUBMIT_ID = "session-submit";
  const CANCEL_ID = "session-cancel";
  const CLOSE_ID = "session-dialog-close";
  const CAP_NOTE_ID = "sessions-cap-note";
  const TAB_BAR_ID = "tab-bar";

  // The limits are the model's, not a second copy; the view only repeats
  // them to explain why an action is unavailable.
  const LIMITS = (NB.tabs && NB.tabs.limits) || {};
  const MAX_SESSIONS = LIMITS.maxSessions || 20;
  const NAME_MAX = LIMITS.nameMax || 40;

  // The row's ⋯ menu sits 2 px under the button.
  const MENU_GAP = 2;

  const MODE_CREATE = "create";
  const MODE_RENAME = "rename";

  const LABEL_ADD = "New session";
  const TITLE_NEW = "New session";
  const TITLE_RENAME = "Rename session";
  const TITLE_ONLY_SESSION = "The only session can’t be deleted.";
  const TITLE_READ_ONLY = "Read-only: sessions can’t be changed.";
  const TITLE_NO_DIALOG = "Sessions can’t be changed on this page.";
  const TITLE_LIMIT = MAX_SESSIONS + " sessions is the limit. Delete one first.";
  const HELP_NEW = "A session is a named set of open tabs. Pinned tabs " +
    "stay in every session.";
  const HELP_RENAME = "Rename only changes the label. Its tabs stay open.";
  const SUBMIT_NEW = "Create session";
  const SUBMIT_RENAME = "Save";
  const BUSY_NEW = "Creating…";
  const BUSY_RENAME = "Saving…";
  const PLACEHOLDER_NEW = "Deep work";
  const EMPTY_NAME_ERROR = "Give the session a name.";
  const TOO_LONG_ERROR = "Session names are limited to " + NAME_MAX +
    " characters.";
  const CREATE_FAILED = "Could not create the session.";
  const RENAME_FAILED = "Could not rename the session.";
  const FOOT_TEXT = "Pinned tabs are shared by every session.";
  const ACTION_RENAME = "Rename…";
  const ACTION_DELETE = "Delete…";

  const viewEl = document.getElementById(VIEW_ID);
  // A shell without the host (an old cached index.html) gets no session UI
  // and no NB.sessions, so tabs.js builds no "Move to session" item.
  if (!viewEl) return;

  const dialogEl = document.getElementById(DIALOG_ID);
  const dlg = dialogEl ? {
    overlay: dialogEl,
    form: document.getElementById(FORM_ID),
    title: document.getElementById(TITLE_ID),
    help: document.getElementById(HELP_ID),
    name: document.getElementById(NAME_ID),
    error: document.getElementById(ERROR_ID),
    submit: document.getElementById(SUBMIT_ID),
    cancel: document.getElementById(CANCEL_ID),
    close: document.getElementById(CLOSE_ID),
  } : null;

  let listEl = null;
  let addBtn = null;
  let totalNumEl = null;
  // Row model, in list order: { id, name, count, dirty, active }.
  let sessions = [];
  let activeId = "";
  let dialogOpen = false;
  let dialogMode = MODE_CREATE;
  let editingId = null;
  let submitting = false;
  let opener = null;       // the control focus returns to on close
  let fromTabPath = null;  // set when the dialog was opened from a tab menu

  /* --- view construction --------------------------------------------- */
  /* Build the header, the list and the footnote once, at load. */
  function buildView() {
    viewEl.textContent = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    const heading = document.createElement("div");
    heading.className = "panel-heading";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "Sessions";
    heading.appendChild(title);
    const totalEl = document.createElement("span");
    totalEl.className = "session-total";
    totalNumEl = document.createElement("span");
    totalNumEl.className = "session-total-n";
    totalEl.appendChild(totalNumEl);
    const totalUnit = document.createElement("span");
    totalUnit.className = "sr-only";
    totalUnit.textContent = " sessions";
    totalEl.appendChild(totalUnit);
    heading.appendChild(totalEl);
    header.appendChild(heading);

    const actions = document.createElement("div");
    actions.className = "panel-header-actions";
    addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "session-add";
    addBtn.title = LABEL_ADD;
    addBtn.setAttribute("aria-label", LABEL_ADD);
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => openCreate());
    actions.appendChild(addBtn);
    if (NB.activity && NB.activity.makeCollapseBtn) {
      actions.appendChild(NB.activity.makeCollapseBtn());
    }
    header.appendChild(actions);
    viewEl.appendChild(header);

    listEl = document.createElement("div");
    listEl.id = LIST_ID;
    listEl.className = "sessions-list";
    viewEl.appendChild(listEl);

    // The cap reason, referenced by aria-describedby only while the +
    // is unavailable (it must stay reachable; sessions.md D15).
    const capNote = document.createElement("span");
    capNote.id = CAP_NOTE_ID;
    capNote.className = "sr-only";
    capNote.textContent = TITLE_LIMIT;
    viewEl.appendChild(capNote);

    const foot = document.createElement("p");
    foot.className = "sessions-foot";
    const footPin = document.createElement("span");
    footPin.className = "sessions-foot-pin";
    footPin.setAttribute("aria-hidden", "true");
    footPin.textContent = "📌";
    foot.appendChild(footPin);
    const hint = document.createElement("span");
    hint.textContent = FOOT_TEXT;
    foot.appendChild(hint);
    viewEl.appendChild(foot);
  }

  /* --- render --------------------------------------------------------- */
  /* A full rebuild is cheap at 20 rows but not free, and the viewer emits
   * dirty-changed on every transaction. Compare the visible state first so
   * typing inside an already-dirty file does not rebuild the list. */
  let lastSignature = "";

  function signature() {
    return sessions.map((s) => [
      s.id, s.name, s.count, s.dirty ? 1 : 0, s.active ? 1 : 0,
    ].join("\u0001")).join("\u0002");
  }

  function refresh() {
    if (!listEl) return;
    sessions = readSessions();
    activeId = readActiveId();
    for (const s of sessions) s.active = s.id === activeId;
    if (signature() === lastSignature) { updateAddBtn(); return; }
    render();
  }

  function readSessions() {
    if (!NB.tabs || typeof NB.tabs.getSessionList !== "function") return [];
    const list = NB.tabs.getSessionList();
    if (!Array.isArray(list)) return [];
    return list.map((s) => ({
      id: String(s.id),
      name: String(s.name == null ? "" : s.name),
      count: Number(s.count) || 0,
      dirty: !!s.dirty,
      active: !!s.active,
    }));
  }

  function readActiveId() {
    if (NB.tabs && typeof NB.tabs.getActiveSessionId === "function") {
      return String(NB.tabs.getActiveSessionId() || "");
    }
    const active = sessions.find((s) => s.active);
    return active ? active.id : "";
  }

  /* Rebuild every row from scratch. Focus is captured by session id and
   * control first, so the re-render a switch triggers cannot drop the
   * keyboard to <body>. */
  function render() {
    if (!listEl) return;
    const keep = focusedControl();
    listEl.textContent = "";
    for (const s of sessions) listEl.appendChild(buildRow(s));
    restoreFocus(keep);
    if (totalNumEl) totalNumEl.textContent = String(sessions.length);
    lastSignature = signature();
    updateAddBtn();
  }

  function focusedControl() {
    const active = document.activeElement;
    if (!active || !listEl.contains(active)) return null;
    const wrap = active.closest(".session-row-wrap");
    if (!wrap || !wrap.dataset.sessionId) return null;
    return {
      id: wrap.dataset.sessionId,
      control: active.classList.contains("session-more") ? "more" : "row",
    };
  }

  function restoreFocus(keep) {
    if (!keep) return;
    const wrap = rowById(keep.id);
    if (!wrap) return;
    const btn = wrap.querySelector(
      keep.control === "more" ? ".session-more" : ".session-row");
    if (btn) btn.focus({ preventScroll: true });
  }

  function buildRow(s) {
    const wrap = document.createElement("div");
    wrap.className = "session-row-wrap";
    wrap.dataset.sessionId = s.id;

    // A button cannot contain the actions button, so the two are siblings.
    const row = document.createElement("button");
    row.type = "button";
    row.className = "session-row";
    row.title = s.name;
    if (s.active) row.setAttribute("aria-current", "true");
    wrap.classList.toggle("is-active", s.active);

    const name = document.createElement("span");
    name.className = "session-name";
    name.textContent = s.name;
    row.appendChild(name);

    if (s.dirty) {
      const dot = document.createElement("span");
      dot.className = "session-dot";
      dot.setAttribute("aria-hidden", "true");
      row.appendChild(dot);
      const sr = document.createElement("span");
      sr.className = "sr-only";
      sr.textContent = ", unsaved changes";
      row.appendChild(sr);
    }

    const count = document.createElement("span");
    count.className = "session-count";
    count.textContent = String(s.count);
    const unit = document.createElement("span");
    unit.className = "sr-only";
    unit.textContent = s.count === 1 ? " tab" : " tabs";
    count.appendChild(unit);
    row.appendChild(count);

    row.addEventListener("click", () => switchTo(s.id));
    wrap.appendChild(row);

    const more = document.createElement("button");
    more.type = "button";
    more.className = "session-more";
    more.textContent = "⋯";
    more.title = s.name + " actions";
    more.setAttribute("aria-label", s.name + " actions");
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.addEventListener("click", (e) => {
      // The document-level close handler would otherwise close the menu
      // this click is about to open.
      e.stopPropagation();
      if (more.getAttribute("aria-expanded") === "true") {
        NB.menu.close("sessions");
        return;
      }
      const rect = more.getBoundingClientRect();
      openMenu(s.id, rect.left, rect.bottom + MENU_GAP, more);
    });
    wrap.appendChild(more);

    wrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openMenu(s.id, e.clientX, e.clientY, more);
    });

    return wrap;
  }

  function rowById(id) {
    if (!listEl || !id) return null;
    return Array.from(listEl.querySelectorAll(".session-row-wrap"))
      .find((wrap) => wrap.dataset.sessionId === id) || null;
  }

  /* The header + is unavailable at the 20-session cap and for a viewer,
   * but it keeps its tab stop so the reason stays reachable. */
  function updateAddBtn() {
    if (!addBtn) return;
    const writable = isWritable();
    const full = sessions.length >= MAX_SESSIONS;
    const noDialog = !dlg;
    if (!writable || full || noDialog) {
      addBtn.setAttribute("aria-disabled", "true");
    } else {
      addBtn.removeAttribute("aria-disabled");
    }
    addBtn.title = !writable ? TITLE_READ_ONLY
      : (full ? TITLE_LIMIT : (noDialog ? TITLE_NO_DIALOG : LABEL_ADD));
    if (full) addBtn.setAttribute("aria-describedby", CAP_NOTE_ID);
    else addBtn.removeAttribute("aria-describedby");
  }

  /* --- public actions -------------------------------------------------- */

  function switchTo(id) {
    if (!id || id === activeId) return;
    if (!NB.tabs || typeof NB.tabs.swapTo !== "function") return;
    // One instant, local swap; no busy state and no confirm. The
    // tabs:changed it emits re-renders the rows.
    settle(NB.tabs.swapTo(id));
  }

  function openCreate() {
    if (!isWritable() || sessions.length >= MAX_SESSIONS) return;
    openDialog(MODE_CREATE, null, { opener: addBtn });
  }

  function openRename(id) {
    if (!isWritable()) return;
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const wrap = rowById(id);
    openDialog(MODE_RENAME, session, {
      opener: wrap ? wrap.querySelector(".session-more") : null,
    });
  }

  function moveTo(path, id) {
    if (!isWritable() || !path || !id) return;
    if (!NB.tabs || typeof NB.tabs.moveToSession !== "function") return;
    settle(NB.tabs.moveToSession(path, id));
  }

  function newFromTab(path) {
    if (!isWritable() || !path) return;
    openDialog(MODE_CREATE, null, { opener: tabStripFocus(), tabPath: path });
  }

  /* --- row menu -------------------------------------------------------- */

  function openMenu(id, x, y, trigger) {
    const wrap = rowById(id);
    if (!wrap || !NB.menu) return;
    const writable = isWritable();
    const only = sessions.length <= 1;
    const items = [
      {
        label: ACTION_RENAME,
        disabled: !writable,
        title: writable ? undefined : TITLE_READ_ONLY,
        handler: () => openRename(id),
      },
      {
        label: ACTION_DELETE,
        danger: true,
        disabled: !writable || only,
        title: !writable ? TITLE_READ_ONLY
          : (only ? TITLE_ONLY_SESSION : undefined),
        handler: () => remove(id),
      },
    ];
    NB.menu.open({
      owner: "sessions",
      x: x,
      y: y,
      scope: wrap,
      items: items,
      focusFirst: true,
      // Escape hides the focused item; without this focus would fall to
      // <body>. A pick or a click outside moves no focus.
      onClose: (reason) => {
        trigger.setAttribute("aria-expanded", "false");
        if (reason === "esc" && trigger.isConnected) {
          trigger.focus({ preventScroll: true });
        }
      },
    });
    // After open(): open() closes any previous menu first, and that close
    // fires the previous trigger's onClose, which would clear this flag.
    trigger.setAttribute("aria-expanded", "true");
  }

  /* --- delete ---------------------------------------------------------- */

  function remove(id) {
    if (!isWritable()) return;
    const index = sessions.findIndex((s) => s.id === id);
    if (index < 0 || sessions.length <= 1) return;
    const session = sessions[index];
    if (!window.confirm(deleteMessage(session, index))) {
      // Cancel: the row is still there, so focus returns to its ⋯ rather
      // than falling to <body> with the closed menu.
      const more = rowById(id) && rowById(id).querySelector(".session-more");
      if (more) more.focus({ preventScroll: true });
      return;
    }
    // Where the list lands after the row goes: the previous session for an
    // active delete, else the row that takes its place.
    const neighbour = session.active
      ? (sessions[index - 1] || sessions[index + 1] || null)
      : (sessions[index + 1] || sessions[index - 1] || null);
    const targetId = neighbour ? neighbour.id : "";

    let done = null;
    if (NB.tabs && typeof NB.tabs.deleteSession === "function") {
      done = NB.tabs.deleteSession(id);
    }
    Promise.resolve(done).then((res) => {
      if (res === false) {
        // The model refused (a failed hybrid commit, or no such session):
        // nothing changed, so focus stays with the row the user acted on.
        const more = rowById(id) && rowById(id).querySelector(".session-more");
        if (more) more.focus({ preventScroll: true });
        return;
      }
      refresh();
      focusRow(targetId);
    }, () => { /* the model refuses the delete; nothing changed */ });
  }

  function deleteMessage(session, index) {
    const next = session.active
      ? (sessions[index - 1] || sessions[index + 1] || null)
      : null;
    let body;
    if (session.count === 0) body = "It has no open tabs.";
    else if (session.count === 1) body = "Its open tab will close.";
    else body = "Its " + session.count + " open tabs will close.";
    let text = "Delete “" + session.name + "”?\n" + body;
    if (next) text += " You’ll switch to “" + next.name + "”.";
    if (session.dirty) text += "\nUnsaved edits in its files will be lost.";
    return text;
  }

  function focusRow(id) {
    if (!id || !viewVisible()) return;
    const wrap = rowById(id);
    if (!wrap) return;
    const row = wrap.querySelector(".session-row");
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
  }

  /* --- the name dialog -------------------------------------------------- */

  function openDialog(mode, session, origin) {
    if (!dlg || !NB.dialog || dialogOpen) return;
    dialogMode = mode;
    editingId = session ? session.id : null;
    opener = (origin && origin.opener) || null;
    fromTabPath = (origin && origin.tabPath) || null;
    submitting = false;
    clearError();

    dlg.title.textContent = mode === MODE_RENAME ? TITLE_RENAME : TITLE_NEW;
    dlg.help.textContent = mode === MODE_RENAME ? HELP_RENAME : HELP_NEW;
    dlg.submit.textContent = mode === MODE_RENAME ? SUBMIT_RENAME : SUBMIT_NEW;
    dlg.name.placeholder = mode === MODE_RENAME ? "" : PLACEHOLDER_NEW;
    dlg.name.value = session ? session.name : "";
    dlg.form.removeAttribute("aria-busy");
    // A submit in the previous open left the button disabled; every open
    // starts from a usable form.
    dlg.submit.disabled = false;

    dialogOpen = true;
    dlg.overlay.hidden = false;
    NB.dialog.open(dlg.overlay, {
      initialFocus: dlg.name,
      fallbackFocus: opener,
    });
    if (mode === MODE_RENAME) dlg.name.select();
  }

  function closeDialog() {
    if (!dlg || !dialogOpen || submitting) return;
    finishDialog();
  }

  function finishDialog() {
    submitting = false;
    dlg.form.removeAttribute("aria-busy");
    dlg.submit.disabled = false;
    dialogOpen = false;
    dlg.overlay.hidden = true;
    NB.dialog.close(dlg.overlay);
    opener = null;
    fromTabPath = null;
  }

  function clearError() {
    if (!dlg) return;
    dlg.error.textContent = "";
    dlg.name.removeAttribute("aria-invalid");
  }

  function showError(message) {
    if (!dlg) return;
    dlg.error.textContent = message;
    if (message) dlg.name.setAttribute("aria-invalid", "true");
    else dlg.name.removeAttribute("aria-invalid");
    dlg.name.focus({ preventScroll: true });
  }

  function setSubmitting(busy) {
    submitting = busy;
    if (busy) dlg.form.setAttribute("aria-busy", "true");
    else dlg.form.removeAttribute("aria-busy");
    dlg.submit.disabled = busy;
    dlg.submit.textContent = !busy
      ? (dialogMode === MODE_RENAME ? SUBMIT_RENAME : SUBMIT_NEW)
      : (dialogMode === MODE_RENAME ? BUSY_RENAME : BUSY_NEW);
  }

  function duplicateMessage(name) {
    return "A session called “" + name + "” already exists.";
  }

  /* Empty, duplicate (trimmed, case-insensitive) and over-long are the
   * three conditions the field owns. `null` means the name is usable. */
  function validationError(name) {
    if (!name) return EMPTY_NAME_ERROR;
    if (name.length > NAME_MAX) return TOO_LONG_ERROR;
    const folded = name.toLowerCase();
    const duplicate = readSessions().some((s) =>
      s.id !== editingId && s.name.toLowerCase() === folded);
    return duplicate ? duplicateMessage(name) : null;
  }

  function submitDialog() {
    if (!dlg || !dialogOpen || submitting || !isWritable()) return;
    // maxlength stops typing; this covers a paste that browsers let
    // through. Validation runs on the truncated value.
    const name = dlg.name.value.trim().slice(0, NAME_MAX);
    const error = validationError(name);
    if (error) { showError(error); return; }

    const mode = dialogMode;
    const targetId = editingId;
    const tabPath = fromTabPath;
    const beforeIds = sessions.map((s) => s.id);
    setSubmitting(true);

    let request = null;
    if (!NB.tabs) request = Promise.resolve({ ok: false });
    else if (mode === MODE_RENAME) {
      request = NB.tabs.renameSession
        ? NB.tabs.renameSession(targetId, name)
        : Promise.resolve({ ok: false });
    } else if (tabPath && typeof NB.tabs.createSessionFromTab === "function") {
      // The tab path must not switch: the primitive creates the session,
      // moves the tab in and leaves the source active.
      request = NB.tabs.createSessionFromTab(tabPath, name);
    } else if (tabPath) {
      request = Promise.resolve({ ok: false });
    } else {
      request = NB.tabs.createSession
        ? NB.tabs.createSession(name)
        : Promise.resolve({ ok: false });
    }

    Promise.resolve(request).then((res) => {
      if (res && res.ok === false) {
        setSubmitting(false);
        showError(writeError(res, name, mode));
        return;
      }
      const createdId = res && res.id ? String(res.id) : "";
      finishDialog();
      refresh();
      if (tabPath) return;          // the tab move keeps its own focus rule
      if (mode === MODE_RENAME) { focusRow(targetId); return; }
      const newId = createdId ||
        (sessions.find((s) => beforeIds.indexOf(s.id) < 0) || {}).id;
      focusRow(newId);
    }, () => {
      setSubmitting(false);
      showError(mode === MODE_RENAME ? RENAME_FAILED : CREATE_FAILED);
    });
  }

  // A failed write is one line: the server's condition when the model
  // names one, the model's own sentence otherwise.
  function writeError(res, name, mode) {
    switch (res && res.code) {
      case "name_empty": return EMPTY_NAME_ERROR;
      case "name_too_long": return TOO_LONG_ERROR;
      case "name_duplicate": return duplicateMessage(name);
      default:
        break;
    }
    const message = String((res && res.message) || "");
    if (/duplicate|already/i.test(message)) return duplicateMessage(name);
    if (/empty|give/i.test(message)) return EMPTY_NAME_ERROR;
    if (/limited|characters|long/i.test(message)) return TOO_LONG_ERROR;
    return mode === MODE_RENAME ? RENAME_FAILED : CREATE_FAILED;
  }

  /* --- helpers ---------------------------------------------------------- */

  function isWritable() {
    // Only an admin may change sessions; a viewer or the unauthenticated
    // shell may switch but not create, rename, delete or move. Matches the
    // Move-to-session guard in tabs.js.
    return NB.pageRole ? NB.pageRole() === "admin" : true;
  }

  // A model call whose failure means "nothing changed": the strip is left
  // as it was, so the rejection must not surface on the console.
  function settle(promise) {
    if (promise && typeof promise.catch === "function") promise.catch(() => {});
    return promise;
  }

  function viewVisible() {
    return !!viewEl && !viewEl.hidden && viewEl.getClientRects().length > 0;
  }

  // Where focus lands when the dialog closes and the opener is gone: the
  // active tab, else the strip, which is where the moved tab left from.
  function tabStripFocus() {
    return document.querySelector("#" + TAB_BAR_ID + " .tab.active") ||
      document.getElementById("tab-list");
  }

  function wireDialog() {
    if (!dlg) return;
    dlg.cancel.addEventListener("click", closeDialog);
    dlg.close.addEventListener("click", closeDialog);
    dlg.overlay.addEventListener("click", (e) => {
      if (e.target === dlg.overlay) closeDialog();
    });
    dlg.overlay.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // One press must not also close something underneath.
      e.stopPropagation();
      closeDialog();
    });
    dlg.form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitDialog();
    });
    dlg.name.addEventListener("input", () => {
      if (dlg.name.value.length > NAME_MAX) {
        dlg.name.value = dlg.name.value.slice(0, NAME_MAX);
      }
      // The message clears on the first edit, never on blur.
      if (dlg.error.textContent) clearError();
    });
  }

  /* --- wiring ------------------------------------------------------------ */

  buildView();
  wireDialog();
  refresh();

  // Re-render even while the view is hidden, so opening it never shows a
  // stale count or dot.
  NB.evt.on("tabs:changed", () => refresh());
  NB.evt.on("viewer:dirty-changed", () => refresh());

  NB.sessions = {
    openCreate,
    openRename,
    moveTo,
    newFromTab,
    refresh,
  };
})();
