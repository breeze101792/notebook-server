/* workspaces.js -- the workspace picker, the add/rename dialog, and the
 * Settings -> Workspaces list.
 *
 * The picker has two mounts -- the topbar chip (#workspace-switch inside
 * #workspace-bar) and the activity-bar glyph (#workspace-rail-btn), one
 * visible at a time -- sharing a single popover. The chip's name is
 * server-rendered (boot.workspace_name); the rows come from
 * GET /api/workspaces and are rendered on first open. Rows are
 * navigation, so the active one carries aria-current="page" rather than a
 * checked state. The picker is deliberately not NB.menu: it needs a check
 * column, a second line for a missing folder, and it must be positioned
 * against whichever mount opened it. The popover is moved to <body> at
 * boot because both mounts sit inside clipping ancestors (#topbar's
 * #app shell and #activity-bar, which hides overflow). The dialog and the
 * inert background are NB.dialog's job.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const BAR_ID = "workspace-bar";
  const RAIL_ID = "workspace-rail-btn";
  const SWITCH_ID = "workspace-switch";
  const MENU_ID = "workspace-menu";
  const MENU_LIST_ID = "workspace-menu-list";
  const DIALOG_ID = "workspace-dialog";
  const FORM_ID = "ws-form";
  const NAME_ID = "ws-name";
  const PATH_ID = "ws-path";
  const PATH_ROW_ID = "ws-path-row";
  const RESOLVED_ID = "ws-resolved";
  const RESOLVED_ROW_ID = "ws-resolved-row";
  const ERROR_ID = "ws-error";
  const TITLE_ID = "ws-dialog-title";
  const HELP_ID = "ws-dialog-help";
  const SUBMIT_ID = "ws-submit";
  const CANCEL_ID = "ws-cancel";
  const CLOSE_ID = "ws-dialog-close";
  const SETTINGS_LIST_ID = "settings-workspace-list";
  const SETTINGS_ADD_ID = "settings-workspace-add";
  const DRAFT_BAR_ID = "draft-bar";

  // Popover placement, measured from the mount that opened it: a 6 px gap
  // from the trigger and an 8 px margin from the viewport edges.
  const POP_GAP = 6;
  const POP_MARGIN = 8;

  const ADD_ROW_ACTION = "add";
  const DIALOG_ADD = "add";
  const DIALOG_RENAME = "rename";

  const TITLE_ADD = "Add workspace";
  const TITLE_RENAME = "Rename workspace";
  const HELP_ADD = "Point at a folder of Markdown notes on this machine. " +
    "Nothing is copied or moved.";
  const HELP_RENAME = "Rename only changes the label. The folder stays " +
    "where it is.";
  const SUBMIT_ADD = "Add workspace";
  const SUBMIT_RENAME = "Save";
  const BUSY_ADD = "Adding…";
  const BUSY_RENAME = "Saving…";
  const NOTE_MISSING = "Folder not found";
  const BADGE_ACTIVE = "Active";
  const BADGE_DEFAULT = "Default";
  const BADGE_MISSING = "Not found";
  const ACTION_RENAME = "Rename";
  const ACTION_REMOVE = "Remove";
  const REMOVE_DEFAULT_TITLE = "The default workspace can't be removed.";
  const REMOVE_ACTIVE_TITLE =
    "Switch to another workspace before removing this one.";
  const EMPTY_NAME_ERROR = "Give the workspace a name.";
  const ABSOLUTE_PATH_ERROR = "Use an absolute path, like /home/you/notes.";
  const MISSING_PATH_ERROR = "That folder doesn’t exist.";
  const NOT_DIRECTORY_ERROR = "That path is a file, not a folder.";
  const INSTALL_PATH_ERROR = "That folder is inside the server’s install " +
    "folder. Pick a folder outside it.";
  const SERVER_OVERLAP_ERROR = "That folder overlaps the server’s install " +
    "or config folder. Pick another folder.";
  const PERMISSION_ERROR = "That folder can’t be read. Check its permissions.";
  const OVERLAP_FALLBACK =
    "This folder overlaps another workspace. Workspaces can’t contain one another.";

  // Server workspace errors carry a `code`. Map it to the field the dialog
  // must mark; null means no field owns the condition, so the message is
  // form-level. A code this client does not know falls back to the wording.
  const ERROR_FIELD_BY_CODE = {
    name_empty: "name",
    name_too_long: "name",
    name_duplicate: "name",
    path_not_absolute: "path",
    path_missing: "path",
    path_not_directory: "path",
    path_overlap: "path",
    path_inside_install: "path",
    path_unreadable: "path",
    too_many: null,
    state_too_large: null,
    not_admin: null,
    loopback_required: null,
    unknown_workspace: null,
    bad_body: null,
    default_not_removable: null,
    write_failed: null,
  };

  const chipEl = document.getElementById(BAR_ID);
  const railBtn = document.getElementById(RAIL_ID);
  const switchBtn = document.getElementById(SWITCH_ID);
  const menuEl = document.getElementById(MENU_ID);
  const menuListEl = document.getElementById(MENU_LIST_ID);
  const dialogEl = document.getElementById(DIALOG_ID);

  // A page with no workspace shell (old server, or the login screen) still
  // loads this module; every entry point then no-ops.
  const enabled = !!(chipEl && switchBtn && menuEl && menuListEl);

  // One popover, two mounts. It is a direct <body> child so neither
  // #activity-bar (overflow: hidden) nor .tab-bar can clip it; append (do
  // not clone) keeps the ids and the aria-controls relationship intact.
  if (menuEl && menuEl.parentNode !== document.body) {
    document.body.appendChild(menuEl);
  }

  // <html data-role> is "admin", "viewer", or "" (unauthenticated). An
  // absent attribute means the shell exposes no role (an older server, or
  // the test harness). NB.pageRole folds in the auth-off install, which has
  // no session role but embeds the workspace list and keeps full access.
  // Add / rename / remove and the workspace-state write are admin-only
  // routes: never build them for a viewer, and never make the picker
  // interactive without a role.
  const pageRole = NB.pageRole ? NB.pageRole() : "admin";
  const canManage = pageRole === "admin";
  const pickerUsable = canManage || pageRole === "viewer";

  const dialog = dialogEl ? {
    overlay: dialogEl,
    form: document.getElementById(FORM_ID),
    title: document.getElementById(TITLE_ID),
    help: document.getElementById(HELP_ID),
    name: document.getElementById(NAME_ID),
    path: document.getElementById(PATH_ID),
    pathRow: document.getElementById(PATH_ROW_ID),
    resolved: document.getElementById(RESOLVED_ID),
    resolvedRow: document.getElementById(RESOLVED_ROW_ID),
    error: document.getElementById(ERROR_ID),
    submit: document.getElementById(SUBMIT_ID),
    cancel: document.getElementById(CANCEL_ID),
    close: document.getElementById(CLOSE_ID),
  } : null;

  let items = null;         // cached rows; null until seeded or fetched
  let activeId = (NB.workspaceId && NB.workspaceId()) || "";
  let activeTrigger = null; // the mount the open popover is placed against
  let pickerBusy = false;
  let dialogOpen = false;
  let dialogMode = DIALOG_ADD;
  let dialogOrigin = "picker";
  let editing = null;
  let submitting = false;
  let nameTouched = false;
  let errorField = null;

  /* --- data ---------------------------------------------------------- */

  // boot.workspaces gives the first open something to draw before the list
  // request lands. It carries no path, so Settings still waits for the
  // fetch before it can show the full rows.
  function seedItems() {
    if (items) return items;
    const raw = chipEl && chipEl.dataset.workspaces;
    if (raw) {
      try {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) items = list;
      } catch (_) { /* malformed attribute: fetch instead */ }
    }
    return items;
  }

  function activeWorkspace() {
    if (!items) return null;
    return items.find(ws => ws.id === activeId) || null;
  }

  function notify(message) {
    if (NB.app && NB.app.notify) NB.app.notify(message);
  }

  function refresh() {
    if (!pickerUsable) return Promise.resolve(items);
    if (!NB.api || !NB.api.listWorkspaces) return Promise.resolve(items);
    const before = pickerSignature(items);
    return NB.api.listWorkspaces().then((res) => {
      const next = (res && Array.isArray(res.workspaces)) ? res.workspaces : [];
      if (!activeId && res && res.active) activeId = res.active;
      items = next;
      updateMounts();
      renderSettings();
      // Re-render the open picker only when a row it shows actually changed;
      // an identical refresh must not churn focus under the user's hands.
      if (enabled && !menuEl.hidden && pickerSignature(items) !== before) {
        renderPicker();
      }
      return items;
    });
  }

  function pickerSignature(list) {
    return JSON.stringify((list || []).map(
      ws => [ws.id, ws.name, ws.available === false]));
  }

  /* --- mounts -------------------------------------------------------- */

  // Both mounts name the same workspace, so one pass keeps them in step:
  // the chip carries the name, the rail mount carries it as an aria-label
  // and a title (it is icon-only).
  function updateMounts() {
    if (!switchBtn) return;
    const ws = activeWorkspace();
    if (!ws) return;
    const nameEl = switchBtn.querySelector(".workspace-name");
    if (nameEl) nameEl.textContent = ws.name;
    const missing = ws.available === false;
    switchBtn.classList.toggle("is-missing", missing);
    if (railBtn) railBtn.classList.toggle("is-missing", missing);

    let warn = switchBtn.querySelector(".workspace-warn");
    if (missing && !warn) {
      warn = document.createElement("span");
      warn.className = "workspace-warn";
      warn.setAttribute("aria-hidden", "true");
      warn.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-warning"/></svg>';
      const caret = switchBtn.querySelector(".workspace-caret");
      switchBtn.insertBefore(warn, caret || null);
    } else if (!missing && warn) {
      warn.remove();
    }

    if (typeof ws.path === "string") {
      const label = missing
        ? ws.name + " — folder not found: " + ws.path
        : ws.name + " — " + ws.path;
      switchBtn.title = label;
      if (railBtn) {
        railBtn.title = label;
        railBtn.setAttribute("aria-label", "Workspace: " + ws.name);
      }
    }
  }

  /* --- picker -------------------------------------------------------- */

  function usableRows() {
    return Array.from(menuListEl.querySelectorAll(".ws-item")).filter(
      row => row.getAttribute("aria-disabled") !== "true");
  }

  function rowKey(row) {
    return row ? (row.dataset.wsId || ADD_ROW_ACTION) : null;
  }

  function rowByKey(key) {
    if (!key) return null;
    return Array.from(menuListEl.querySelectorAll(".ws-item")).find(
      row => rowKey(row) === key) || null;
  }

  function setRoving(row) {
    for (const el of menuListEl.querySelectorAll(".ws-item")) {
      el.tabIndex = -1;
    }
    if (row) row.tabIndex = 0;
  }

  function buildPickerRow(ws) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ws-item";
    row.setAttribute("role", "menuitem");
    row.tabIndex = -1;
    row.dataset.wsId = ws.id;

    const check = document.createElement("span");
    check.className = "ws-check";
    check.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "ws-item-name";
    name.textContent = ws.name;

    if (ws.id === activeId) {
      row.setAttribute("aria-current", "page");
      check.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-check"/></svg>';
    }

    if (ws.available === false) {
      row.classList.add("is-unavailable");
      row.setAttribute("aria-disabled", "true");
      row.title = ws.path ? NOTE_MISSING + ": " + ws.path : NOTE_MISSING;

      const body = document.createElement("span");
      body.className = "ws-item-body";
      const note = document.createElement("span");
      note.className = "ws-item-note";
      note.textContent = NOTE_MISSING;
      body.appendChild(name);
      body.appendChild(note);

      const warn = document.createElement("span");
      warn.className = "ws-item-warn";
      warn.setAttribute("aria-hidden", "true");
      warn.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-warning"/></svg>';

      row.appendChild(check);
      row.appendChild(body);
      row.appendChild(warn);
      return row;
    }

    row.appendChild(check);
    row.appendChild(name);
    row.addEventListener("click", () => pick(ws));
    return row;
  }

  function buildAddRow() {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ws-item";
    row.setAttribute("role", "menuitem");
    row.dataset.action = ADD_ROW_ACTION;
    row.tabIndex = -1;
    const check = document.createElement("span");
    check.className = "ws-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "+";
    const name = document.createElement("span");
    name.className = "ws-item-name";
    name.textContent = "Add workspace…";
    row.appendChild(check);
    row.appendChild(name);
    row.addEventListener("click", () => {
      if (pickerBusy) return;
      openAdd();
    });
    return row;
  }

  /* Rebuild the rows in place. Focus is preserved by key so an async
   * refresh cannot send the arrow keys back to the top. */
  function renderPicker() {
    const hadFocus = menuListEl.contains(document.activeElement);
    const focused = hadFocus ? rowKey(document.activeElement) : null;
    menuListEl.textContent = "";
    for (const ws of items || []) {
      menuListEl.appendChild(buildPickerRow(ws));
    }
    // Adding a workspace is admin-only; leave the rows out rather than
    // offering an action the server must refuse.
    if (canManage) {
      const sep = document.createElement("hr");
      sep.className = "ws-sep";
      sep.setAttribute("role", "separator");
      menuListEl.appendChild(sep);
      menuListEl.appendChild(buildAddRow());
    }

    const target = rowByKey(focused) ||
      usableRows().find(row => row.dataset.wsId === activeId) ||
      usableRows()[0] || null;
    setRoving(target);
    if (hadFocus && target) target.focus({ preventScroll: true });
  }

  // Both mounts expose the same expanded state; aria-expanded on the
  // hidden mount is harmless and keeps the state honest if CSS flips.
  function setExpanded(expanded) {
    for (const el of triggers()) {
      if (el.hasAttribute("aria-haspopup")) {
        el.setAttribute("aria-expanded", expanded ? "true" : "false");
      }
    }
  }

  function triggers() {
    return railBtn ? [switchBtn, railBtn] : [switchBtn];
  }

  // The mount the user can actually click: the chip while the topbar is
  // on, the rail glyph while it is hidden, and on the phone only the chip.
  function visibleTrigger() {
    for (const el of triggers()) {
      if (el.getClientRects().length) return el;
    }
    return switchBtn;
  }

  /* Place the popover against the mount that opened it: below-left of the
   * chip, or to the right of the rail glyph aligned to its top. It flips
   * above when the bottom would overflow, flips left of the rail glyph
   * when the right edge would, and is clamped to an 8 px margin either
   * way. Re-run on open and on window resize; a scroll closes instead. */
  function placeMenu(trigger) {
    const rect = (trigger || visibleTrigger()).getBoundingClientRect();
    const width = menuEl.offsetWidth;
    const height = menuEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fromRail = trigger === railBtn;

    let left = fromRail ? rect.right + POP_GAP : rect.left;
    let top = fromRail ? rect.top : rect.bottom + POP_GAP;

    if (fromRail && left + width > vw - POP_MARGIN) {
      left = rect.left - width - POP_GAP;
    }
    left = Math.max(POP_MARGIN, Math.min(left, vw - width - POP_MARGIN));

    if (top + height > vh - POP_MARGIN) {
      top = rect.top - height - POP_GAP;
    }
    top = Math.max(POP_MARGIN, Math.min(top, vh - height - POP_MARGIN));

    menuEl.style.left = left + "px";
    menuEl.style.top = top + "px";
  }

  function openPicker(trigger, focusMode) {
    if (!enabled || pickerBusy || !pickerUsable) return;
    activeTrigger = trigger || visibleTrigger();
    seedItems();
    menuEl.hidden = false;
    setExpanded(true);
    renderPicker();
    // Measure after the rows exist: the flip-above test needs the height.
    placeMenu(activeTrigger);

    const rows = usableRows();
    let target;
    if (focusMode === "first") target = rows[0];
    else if (focusMode === "last") target = rows[rows.length - 1];
    else target = rows.find(row => row.dataset.wsId === activeId) || rows[0];
    setRoving(target || null);
    if (target) target.focus({ preventScroll: true });

    refresh().catch(() => { /* keep the seeded or cached rows */ });
  }

  function closePicker(returnFocus) {
    if (!enabled || menuEl.hidden) return;
    const trigger = activeTrigger || visibleTrigger();
    menuEl.hidden = true;
    setExpanded(false);
    activeTrigger = null;
    if (returnFocus) trigger.focus({ preventScroll: true });
  }

  function setPickerBusy(busy) {
    pickerBusy = busy;
    menuListEl.setAttribute("aria-busy", busy ? "true" : "false");
    // A switch is in flight: both mounts would only be told to wait, so
    // mark them disabled for the same interval as the rows.
    for (const el of triggers()) {
      if (busy) el.setAttribute("aria-disabled", "true");
      else el.removeAttribute("aria-disabled");
    }
    for (const row of menuListEl.querySelectorAll(".ws-item")) {
      if (busy) row.setAttribute("aria-disabled", "true");
      else if (!row.classList.contains("is-unavailable")) {
        row.removeAttribute("aria-disabled");
      }
      row.tabIndex = -1;
    }
  }

  function hasUnsavedDraft() {
    const bar = document.getElementById(DRAFT_BAR_ID);
    return !!(bar && !bar.hidden);
  }

  function pick(ws) {
    if (pickerBusy) return;
    if (ws.id === activeId) { closePicker(true); return; }
    if (hasUnsavedDraft() &&
        !window.confirm("Switch to “" + ws.name + "”?\n\n" +
          "The page reloads and your unsaved draft is discarded.")) {
      return;
    }
    switchTo(ws.id);
  }

  function switchTo(id) {
    setPickerBusy(true);
    NB.api.setActiveWorkspace(id).then(() => {
      window.location.reload();
      // A blocked reload would otherwise leave the popover disabled.
      setPickerBusy(false);
    }).catch((e) => {
      setPickerBusy(false);
      renderPicker();
      notify("Could not switch workspace: " + e.message);
    });
  }

  /* --- dialog -------------------------------------------------------- */

  function isAbsolute(path) {
    return typeof path === "string" && path.charAt(0) === "/";
  }

  function basename(path) {
    const trimmed = String(path == null ? "" : path).replace(/\/+$/, "");
    const parts = trimmed.split("/");
    return parts[parts.length - 1] || "";
  }

  function clearError() {
    if (!dialog) return;
    dialog.error.textContent = "";
    dialog.name.removeAttribute("aria-invalid");
    dialog.path.removeAttribute("aria-invalid");
    errorField = null;
  }

  function showError(field, message) {
    if (!dialog) return;
    clearError();
    errorField = field || null;
    if (!field) {
      // No field owns the condition (for example the workspace-count cap).
      // Show the sentence without blaming an input.
      dialog.error.textContent = message;
      return;
    }
    const input = field === "name" ? dialog.name : dialog.path;
    input.setAttribute("aria-invalid", "true");
    dialog.error.textContent = message;
    input.focus({ preventScroll: true });
  }

  function updateResolved() {
    if (!dialog) return;
    if (dialogMode === DIALOG_RENAME) {
      dialog.resolvedRow.hidden = false;
      return;
    }
    const path = dialog.path.value.trim();
    const showPath = path.length > 1 && isAbsolute(path);
    dialog.resolvedRow.hidden = !showPath;
    if (showPath) dialog.resolved.textContent = path;
  }

  function updateSubmitState() {
    if (!dialog) return;
    const nameEmpty = !dialog.name.value.trim();
    const pathEmpty = dialogMode === DIALOG_ADD && !dialog.path.value.trim();
    dialog.submit.disabled = submitting || nameEmpty || pathEmpty;
  }

  function syncSuggestedName() {
    if (!dialog || dialogMode !== DIALOG_ADD || nameTouched) return;
    const path = dialog.path.value.trim();
    if (isAbsolute(path) && path.length > 1) {
      dialog.name.value = basename(path);
    } else {
      dialog.name.value = "";
    }
  }

  function openDialog(mode, ws, origin) {
    if (!dialog || !canManage) return;
    dialogMode = mode;
    dialogOrigin = origin || "picker";
    editing = ws || null;
    submitting = false;
    nameTouched = mode === DIALOG_RENAME;
    clearError();

    dialog.title.textContent = mode === DIALOG_RENAME ? TITLE_RENAME : TITLE_ADD;
    dialog.help.textContent = mode === DIALOG_RENAME ? HELP_RENAME : HELP_ADD;
    dialog.submit.textContent = mode === DIALOG_RENAME ? SUBMIT_RENAME : SUBMIT_ADD;
    dialog.form.removeAttribute("aria-busy");

    dialog.pathRow.hidden = mode === DIALOG_RENAME;
    dialog.resolvedRow.hidden = true;
    dialog.resolved.textContent = mode === DIALOG_RENAME && ws ? ws.path : "";
    dialog.name.value = mode === DIALOG_RENAME && ws ? ws.name : "";
    dialog.path.value = "";

    dialogOpen = true;
    dialog.overlay.hidden = false;
    updateResolved();
    updateSubmitState();
    NB.dialog.open(dialog.overlay, {
      initialFocus: dialog.name,
      // Return to whichever mount the user is looking at, not to the hidden
      // one (the chip is display:none while the topbar is hidden).
      fallbackFocus: visibleTrigger(),
    });
    if (mode === DIALOG_RENAME) {
      dialog.name.select();
    }
  }

  // Re-establish the Settings modal's containment after our overlay closes.
  // NB.dialog is a single-owner module, so opening this dialog took it over.
  // Called from finishDialog, i.e. on every close path (cancel, ×, scrim,
  // Esc, and a successful request), not only after a list refresh.
  function restoreSettingsContainment() {
    if (!NB.settings || !NB.settings.isOpen || !NB.settings.isOpen()) return;
    const settingsOverlay = document.getElementById("settings-overlay");
    if (!settingsOverlay) return;
    const focused = document.activeElement;
    // The dialog's own invoker may be gone (the row was rebuilt) or outside
    // the settings modal (the bar button). In that case let the settings
    // dialog container take focus instead of moving focus to the background.
    const initialFocus =
      focused && focused !== document.body && settingsOverlay.contains(focused)
        ? focused : null;
    NB.dialog.open(settingsOverlay, {
      initialFocus: initialFocus || undefined,
      fallbackFocus: document.getElementById("activity-settings-btn"),
    });
  }

  function closeDialog() {
    if (!dialog || !dialogOpen || submitting) return;
    finishDialog();
  }

  function finishDialog() {
    submitting = false;
    dialog.form.removeAttribute("aria-busy");
    dialogOpen = false;
    dialog.overlay.hidden = true;
    NB.dialog.close(dialog.overlay);
    // Restore the Settings containment here so a failed follow-up refresh
    // cannot leave that modal uninert.
    restoreSettingsContainment();
  }

  function setSubmitting() {
    submitting = true;
    dialog.form.setAttribute("aria-busy", "true");
    dialog.submit.disabled = true;
    dialog.submit.textContent = dialogMode === DIALOG_RENAME ? BUSY_RENAME : BUSY_ADD;
  }

  // Map a server failure onto the field it belongs to. New servers name the
  // condition in `code`, which is authoritative; an older server's prose is
  // the fallback. `null` means the condition belongs to no field.
  function serverErrorField(error) {
    const code = error && error.code;
    if (code &&
        Object.prototype.hasOwnProperty.call(ERROR_FIELD_BY_CODE, code)) {
      return ERROR_FIELD_BY_CODE[code];
    }
    const msg = String((error && error.message) || "");
    if (/name/i.test(msg) &&
        /empty|blank|required|must|give|limited|characters|long/i.test(msg)) {
      return "name";
    }
    if (/already|duplicate/i.test(msg)) return "name";
    if (/overlaps the server|install or config/i.test(msg)) return "path";
    if (/overlap|contain/i.test(msg)) return "path";
    if (/install/i.test(msg)) return "path";
    if (/permission|denied|not readable|can.t read|read access/i.test(msg)) {
      return "path";
    }
    if (/absolute/i.test(msg)) return "path";
    if (/not a directory|is a file|directory/i.test(msg)) return "path";
    if (/does not exist|doesn.t exist|not found|missing/i.test(msg)) return "path";
    return "path";
  }

  // Name the other workspace (and its path) when the server's overlap
  // sentence carries them; otherwise use the shared fallback.
  function overlapMessage(message) {
    const quoted = message.match(/[“"]([^”"]+)[”"]\s*\(([^)]+)\)/);
    if (quoted) {
      return "This folder overlaps “" + quoted[1] + "” (" + quoted[2] +
        "). Workspaces can’t contain one another.";
    }
    return OVERLAP_FALLBACK;
  }

  function serverErrorMessage(error) {
    const msg = String((error && error.message) || "");
    const name = dialog ? dialog.name.value.trim() : "";
    switch (error && error.code) {
      case "name_empty":
        return EMPTY_NAME_ERROR;
      case "name_too_long":
        // The server sentence carries the limit; keep its sentence, only
        // normalising the final punctuation.
        return msg.replace(/[.!?]*$/, ".");
      case "name_duplicate":
        return "A workspace called “" + name + "” already exists.";
      case "path_not_absolute":
        return ABSOLUTE_PATH_ERROR;
      case "path_missing":
        return MISSING_PATH_ERROR;
      case "path_not_directory":
        return NOT_DIRECTORY_ERROR;
      case "path_inside_install":
        // The server uses this code for two different faults: a folder
        // inside the install tree, and a folder that contains the install
        // or config tree. They must not share the "inside" sentence.
        return /install or config/i.test(msg)
          ? SERVER_OVERLAP_ERROR : INSTALL_PATH_ERROR;
      case "path_unreadable":
        return PERMISSION_ERROR;
      case "path_overlap":
        return overlapMessage(msg);
      default:
        break;
    }
    if (/absolute/i.test(msg)) return ABSOLUTE_PATH_ERROR;
    if (/does not exist|doesn.t exist|not found/i.test(msg)) {
      return MISSING_PATH_ERROR;
    }
    if (/not a directory|is a file|directory/i.test(msg)) {
      return NOT_DIRECTORY_ERROR;
    }
    if (/overlaps the server|install or config/i.test(msg)) {
      return SERVER_OVERLAP_ERROR;
    }
    if (/overlap|contain/i.test(msg)) return overlapMessage(msg);
    if (/install/i.test(msg)) return INSTALL_PATH_ERROR;
    if (/permission|denied|not readable|can.t read|read access/i.test(msg)) {
      return PERMISSION_ERROR;
    }
    if (/already|duplicate/i.test(msg)) {
      return "A workspace called “" + name + "” already exists.";
    }
    if (/name/i.test(msg) && /empty|blank|required|give/i.test(msg)) {
      return EMPTY_NAME_ERROR;
    }
    if (/name/i.test(msg) && /limited|characters|long/i.test(msg)) {
      return msg.replace(/[.!?]*$/, ".");
    }
    const verb = dialogMode === DIALOG_RENAME ? "rename" : "add";
    if (!msg) return "Could not " + verb + " the workspace.";
    const sentence = /[.!?]$/.test(msg) ? msg : msg + ".";
    return "Could not " + verb + " the workspace: " + sentence;
  }

  function submitDialog() {
    if (!dialog || submitting || !dialogOpen || !canManage) return;
    const name = dialog.name.value.trim();
    const path = dialog.path.value.trim();
    if (!name) { showError("name", EMPTY_NAME_ERROR); return; }
    if (dialogMode === DIALOG_ADD && !isAbsolute(path)) {
      showError("path", ABSOLUTE_PATH_ERROR);
      return;
    }

    setSubmitting();
    const request = dialogMode === DIALOG_RENAME
      ? NB.api.renameWorkspace(editing.id, name)
      : NB.api.createWorkspace(name, path);
    // Failure of the write itself is the only path that keeps the dialog
    // open; a failure of the follow-up list refresh must not reopen it or
    // report a phantom error.
    request.then((res) => {
      const ws = res && res.workspace;
      finishDialog();
      if (dialogMode === DIALOG_RENAME) {
        if (ws && items) {
          items = items.map(item => item.id === ws.id ? ws : item);
        }
        updateMounts();
        renderSettings();
        focusSettingsRename(ws && ws.id);
        return;
      }
      // Adding never switches (D6). From the picker, reopen it with the new
      // row focused; from Settings, stay where the user is.
      return refresh().then(() => {
        if (dialogOrigin === "picker") openPickerFor(ws && ws.id);
        restoreSettingsContainment();
      }).catch(() => {
        // finishDialog already restored containment; the row exists on the
        // server even when the list fetch failed.
      });
    }, (e) => {
      submitting = false;
      dialog.form.removeAttribute("aria-busy");
      dialog.submit.textContent =
        dialogMode === DIALOG_RENAME ? SUBMIT_RENAME : SUBMIT_ADD;
      updateSubmitState();
      const err = e || {};
      showError(serverErrorField(err), serverErrorMessage(err));
    });
  }

  function openPickerFor(id) {
    openPicker(visibleTrigger(), "current");
    const row = id ? rowByKey(id) : null;
    if (row) {
      setRoving(row);
      row.focus({ preventScroll: true });
    }
  }

  /* --- settings list ------------------------------------------------- */

  function badge(text, modifier) {
    const el = document.createElement("span");
    el.className = "ws-badge" + (modifier ? " " + modifier : "");
    el.textContent = text;
    return el;
  }

  function buildSettingsRow(ws) {
    const row = document.createElement("div");
    row.className = "ws-row";
    row.setAttribute("role", "listitem");
    row.dataset.wsId = ws.id;

    const active = ws.id === activeId;
    const missing = ws.available === false;
    if (active) row.classList.add("is-active");

    const main = document.createElement("button");
    main.type = "button";
    main.className = "ws-row-main";
    if (active) main.setAttribute("aria-current", "page");
    if (missing) {
      main.disabled = true;
      main.title = NOTE_MISSING + ": " + (ws.path || ws.name);
    }

    const check = document.createElement("span");
    check.className = "ws-row-check";
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = active ? '<svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-check"/></svg>' : "";

    const text = document.createElement("span");
    text.className = "ws-row-text";
    const nameLine = document.createElement("span");
    nameLine.className = "ws-row-name";
    const label = document.createElement("span");
    label.className = "ws-row-label";
    label.textContent = ws.name;
    nameLine.appendChild(label);
    if (active) nameLine.appendChild(badge(BADGE_ACTIVE, ""));
    if (ws.is_default) nameLine.appendChild(badge(BADGE_DEFAULT, "ws-badge--default"));
    if (missing) nameLine.appendChild(badge(BADGE_MISSING, "ws-badge--warn"));

    const pathLine = document.createElement("span");
    pathLine.className = "ws-row-path";
    pathLine.textContent = ws.path || "";

    text.appendChild(nameLine);
    text.appendChild(pathLine);
    main.appendChild(check);
    main.appendChild(text);
    if (!active && !missing) {
      main.addEventListener("click", () => pick(ws));
    }

    const actions = document.createElement("div");
    actions.className = "ws-row-actions";
    if (canManage) {
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "settings-action ws-btn";
      rename.textContent = ACTION_RENAME;
      rename.addEventListener("click", () => openDialog(DIALOG_RENAME, ws, "settings"));
      actions.appendChild(rename);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "settings-action ws-btn ws-btn--danger";
      remove.textContent = ACTION_REMOVE;
      if (ws.is_default) {
        remove.disabled = true;
        remove.title = REMOVE_DEFAULT_TITLE;
      } else if (active) {
        remove.disabled = true;
        remove.title = REMOVE_ACTIVE_TITLE;
      } else {
        remove.addEventListener("click", () => removeWorkspace(ws));
      }
      actions.appendChild(remove);
    }

    row.appendChild(main);
    if (canManage) row.appendChild(actions);
    return row;
  }

  function renderSettings() {
    const host = document.getElementById(SETTINGS_LIST_ID);
    if (!host || !items) return;
    host.textContent = "";
    for (const ws of items) host.appendChild(buildSettingsRow(ws));
  }

  // Put focus back on the renamed row's Rename button: the success path
  // rebuilds the list, which would otherwise drop focus to the body.
  function focusSettingsRename(id) {
    if (!id) return;
    const rows = document.querySelectorAll(
      "#" + SETTINGS_LIST_ID + " .ws-row");
    for (const row of rows) {
      if (row.dataset.wsId !== id) continue;
      const btn = row.querySelector(".ws-btn");
      if (btn) btn.focus({ preventScroll: true });
      return;
    }
  }

  function removeWorkspace(ws) {
    if (!canManage) return;
    const ok = window.confirm("Remove “" + ws.name + "” from the workspace " +
      "list?\n\nIts folder and notes stay on disk.");
    if (!ok) return;
    NB.api.deleteWorkspace(ws.id).then(
      () => refresh()
    ).catch((e) => notify("Could not remove the workspace: " + e.message));
  }

  /* --- public surface ------------------------------------------------ */

  function openAdd() {
    if (!canManage) return;
    const fromSettings = !!(NB.settings && NB.settings.isOpen &&
      NB.settings.isOpen());
    openDialog(DIALOG_ADD, null, fromSettings ? "settings" : "picker");
  }

  function openRename(wsOrId) {
    if (!canManage) return;
    const ws = typeof wsOrId === "string"
      ? (items || []).find(item => item.id === wsOrId)
      : wsOrId;
    if (!ws) return;
    const fromSettings = !!(NB.settings && NB.settings.isOpen &&
      NB.settings.isOpen());
    openDialog(DIALOG_RENAME, ws, fromSettings ? "settings" : "picker");
  }

  NB.workspaces = {
    openPicker: () => openPicker(visibleTrigger(), "current"),
    closePicker: () => closePicker(true),
    openAdd,
    openRename,
    refresh,
    list: () => (items || []).map(ws => ({ ...ws })),
  };

  if (!enabled) return;

  /* --- wiring -------------------------------------------------------- */

  // No role means the shell is the unauthenticated login screen: no mount
  // is interactive, so no admin-only route may be reachable from it.
  if (!pickerUsable) {
    for (const el of triggers()) {
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
    }
    switchBtn.title = "Workspace";
  }

  function wireTrigger(el) {
    el.addEventListener("click", () => {
      if (menuEl.hidden) openPicker(el, "current");
      else closePicker(true);
    });

    el.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (menuEl.hidden) openPicker(el, e.key === "ArrowDown" ? "first" : "last");
    });

    // Leaving the mount for the popover (or back) is not a real exit; the
    // deferred check decides once focus has landed.
    el.addEventListener("focusout", onMountFocusOut);
  }

  wireTrigger(switchBtn);
  if (railBtn) wireTrigger(railBtn);

  menuEl.addEventListener("keydown", (e) => {
    if (menuEl.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker(true);
      return;
    }
    const rows = usableRows();
    if (!rows.length) return;
    const current = rows.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = current < 0
        ? (step > 0 ? rows[0] : rows[rows.length - 1])
        : rows[(current + step + rows.length) % rows.length];
      setRoving(next);
      next.focus({ preventScroll: true });
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? rows[0] : rows[rows.length - 1];
      setRoving(next);
      next.focus({ preventScroll: true });
    }
  });

  // Roving tabindex follows focus so a later Tab starts from the row the
  // user left. Disabled rows never receive focus, so they stay out of it.
  menuEl.addEventListener("focusin", (e) => {
    if (e.target.classList && e.target.classList.contains("ws-item")) {
      setRoving(e.target);
    }
  });

  // Both mounts and the popover count as inside: the popover lives on
  // <body>, so containment is by identity, not by a common ancestor.
  function isInside(node) {
    if (!node) return false;
    return menuEl.contains(node) || chipEl.contains(node) ||
      !!(railBtn && railBtn.contains(node));
  }

  document.addEventListener("click", (e) => {
    if (menuEl.hidden) return;
    if (isInside(e.target)) return;
    closePicker(false);
  });

  function onMountFocusOut(e) {
    if (menuEl.hidden) return;
    if (e.relatedTarget && isInside(e.relatedTarget)) return;
    // Removing the focused row during a re-render fires focusout before the
    // replacement row is focused. Defer the decision so that transient state
    // (and a click landing on a mount) is not treated as a real exit.
    setTimeout(() => {
      if (menuEl.hidden) return;
      if (isInside(document.activeElement)) return;
      closePicker(false);
    }, 0);
  }

  menuEl.addEventListener("focusout", onMountFocusOut);

  // The popover is placed with fixed coordinates, so it cannot follow a
  // scroll: close on any scroll behind it instead. Its own list may scroll
  // without dismissing it.
  window.addEventListener("scroll", (e) => {
    if (menuEl.hidden) return;
    if (e.target && menuEl.contains(e.target)) return;
    closePicker(false);
  }, true);

  window.addEventListener("resize", () => {
    if (menuEl.hidden || !activeTrigger) return;
    placeMenu(activeTrigger);
  });

  if (NB.settings && NB.settings.onOpen) {
    NB.settings.onOpen(() => {
      refresh().catch((e) => {
        notify("Could not load workspaces: " + e.message);
      });
    });
  }

  const addBtn = document.getElementById(SETTINGS_ADD_ID);
  if (addBtn) {
    if (canManage) addBtn.addEventListener("click", openAdd);
    else { addBtn.disabled = true; addBtn.hidden = true; }
  }

  if (dialog) {
    dialog.cancel.addEventListener("click", closeDialog);
    dialog.close.addEventListener("click", closeDialog);
    dialog.overlay.addEventListener("click", (e) => {
      if (e.target === dialog.overlay) closeDialog();
    });
    dialog.overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Settings also listens for Escape on document. Without stopping
        // the bubble here, one key press closes this dialog and the modal
        // behind it.
        e.stopPropagation();
        closeDialog();
      }
    });
    dialog.form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitDialog();
    });
    dialog.name.addEventListener("input", () => {
      nameTouched = true;
      if (errorField === "name") clearError();
      updateSubmitState();
    });
    dialog.path.addEventListener("input", () => {
      if (errorField === "path") clearError();
      syncSuggestedName();
      updateResolved();
      updateSubmitState();
    });
  }
})();
