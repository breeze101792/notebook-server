/* settings.js -- the settings modal. Opened by the ⚙ button in the top
 * bar; closed by the × button, the Esc key, the dim backdrop, or the
 * footer's Close button.
 *
 * The modal is structured as a left sidebar nav (General / Appearance /
 * Security / About) plus a right section pane. Clicking a nav entry
 * shows its section; the others are hidden. The active nav entry gets
 * `.active` and `aria-selected="true"`.
 *
 * All settings on the Appearance + General tabs are LIVE: changing a
 * radio or toggling file watching updates NB.app / NB.watcher
 * immediately and persists to config in the same debounced path the
 * rest of the UI uses. There is no Apply / Save / Cancel flow anymore;
 * the footer is a single Close button.
 *
 * The Security tab (Passwords) keeps its own per-section Save / Remove
 * buttons that reload the page on success — auth state is too sensitive
 * to live-update, and a reload is the cleanest way to re-boot the
 * session with the new credentials.
 *
 * State is read from / written to the rest of the app via small hooks
 * on NB.app and NB.watcher. We never reach into their internals.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const overlayEl = document.getElementById("settings-overlay");
  const modalEl   = overlayEl.querySelector(".settings-modal");
  const settingsBtn = document.getElementById("activity-settings-btn");
  const closeBtn  = document.getElementById("settings-close");
  const closeFooterBtn = document.getElementById("settings-close-btn");
  const navItems = Array.from(overlayEl.querySelectorAll(".settings-nav-item"));
  const sectionEls = Array.from(overlayEl.querySelectorAll(".settings-section[data-section]"));
  const navEl = overlayEl.querySelector(".settings-nav");
  if (navEl) navEl.setAttribute("aria-orientation", "vertical");
  for (const item of navItems) {
    item.id = "settings-tab-" + item.dataset.tab;
    item.tabIndex = item.classList.contains("active") ? 0 : -1;
  }
  for (const el of sectionEls) {
    el.setAttribute("role", "tabpanel");
    el.setAttribute("aria-labelledby", "settings-tab-" + el.dataset.section);
  }
  const themeRadios = Array.from(overlayEl.querySelectorAll('input[name="theme"]'));
  const fontSizeRadios = Array.from(overlayEl.querySelectorAll('input[name="fontSize"]'));
  const settingsModalWidthRadios = Array.from(overlayEl.querySelectorAll('input[name="settingsModalWidth"]'));
  const settingsModalHeightRadios = Array.from(overlayEl.querySelectorAll('input[name="settingsModalHeight"]'));
  const wallpaperRadios = Array.from(overlayEl.querySelectorAll('input[name="wallpaper"]'));
  const wallpaperScrollRadios = Array.from(overlayEl.querySelectorAll('input[name="wallpaperScroll"]'));
  const wallpaperColorRadios = Array.from(overlayEl.querySelectorAll('input[name="wallpaperColor"]'));
  const wallpaperIntensityRadios = Array.from(overlayEl.querySelectorAll('input[name="wallpaperIntensity"]'));
  const watchStatusEl = document.getElementById("settings-watch-status");
  const watchToggleBtn = document.getElementById("settings-watch-toggle");
  const autosaveToggleEl = document.getElementById("settings-autosave-toggle");
  const autosaveDelayEl = document.getElementById("settings-autosave-delay");
  const vimToggleEl = document.getElementById("settings-vim-toggle");
  const vimrcEl     = document.getElementById("settings-vimrc");
  const vimrcSaveEl = document.getElementById("settings-vimrc-save");
  const vimrcStatus = document.getElementById("settings-vimrc-status");
  const hideTopbarEl = document.getElementById("settings-hide-topbar");
  const hideTabbarEl = document.getElementById("settings-hide-tabbar");
  const graphParticlesEl = document.getElementById("settings-graph-particles");
  const siteTitleEl  = document.getElementById("settings-site-title");
  const dataDirEl   = document.getElementById("settings-data-dir");
  const configDirEl = document.getElementById("settings-config-dir");
  const fontSizeCurrentEl = document.getElementById("settings-font-size-current");
  const spellcheckToggleEl = document.getElementById("settings-spellcheck-toggle");
  const spellcheckNoteEl = document.getElementById("settings-spellcheck-note");
  const spellcheckWordsEl = document.getElementById("settings-spellcheck-words");
  const spellcheckWordsSaveEl = document.getElementById("settings-spellcheck-words-save");
  const spellcheckWordsStatusEl =
    document.getElementById("settings-spellcheck-words-status");

  // True while the personal-word textarea holds an unsaved edit, so a remote
  // config change cannot overwrite typing in progress.
  let spellcheckWordsDirty = false;
  // The store's cap lives in app.js (SPELL_WORD_MAX_ENTRIES); the status
  // line names the number, so it repeats the value here.
  const SPELL_WORDS_CAP = 1000;

  // General -> Spelling: the two degraded states, in the doc's wording
  // (docs/ui/spellcheck.md §3). The first is a load failure, the second a
  // browser without the CSS Highlight API.
  const SPELL_FAILED_NOTE = "Spelling dictionary could not be loaded.";
  const SPELL_UNSUPPORTED_NOTE =
    "This browser has no text-highlight API; its own spellcheck is used.";

  // Shortcuts section handles. The rows themselves are rendered into
  // #settings-shortcuts-list by renderShortcuts() (the action list
  // and defaults come from NB.shortcuts). `capturingAction` is the
  // id of the action currently in capture mode, or null.
  const shortcutsListEl  = document.getElementById("settings-shortcuts-list");
  const shortcutsResetAllBtn = document.getElementById("settings-shortcuts-reset-all");
  const sidebarOrderListEl = document.getElementById("settings-sidebar-order");
  const sidebarOrderStatusEl = document.getElementById("settings-sidebar-order-status");
  const settingsSectionsEl = overlayEl.querySelector(".settings-sections");
  // Auto-scroll while dragging: depth of the top/bottom band and the step
  // per animation frame (about 480 px/s at 60 Hz).
  const SIDEBAR_DRAG_SCROLL_BAND_PX = 32;
  const SIDEBAR_DRAG_SCROLL_STEP_PX = 8;
  // View id being dragged in the activity-bar order list, or null.
  let sidebarDragId = null;
  let sidebarDragX = 0;
  let sidebarDragY = 0;
  let sidebarDragFrame = 0;
  let capturingAction = null;

  // Passwords section handles. The admin section adapts to state:
  // not-set shows a "Set" form (new + confirm); set shows a "Change
  // password" button that reveals a 3-field form (current + new +
  // confirm). The viewer section keeps a single field plus a confirm
  // row (the viewer is set/cleared by the admin, never rotated in
  // place -- to "change" the viewer, clear and set again).
  const authHelpEl         = document.getElementById("settings-auth-help");
  const adminStatusEl      = document.getElementById("settings-auth-admin-status");
  // The status note is "Admin password: <value>" where <value> is a
  // child span -- the label is fixed and the value is what we update.
  const adminStatusValueEl = document.getElementById("settings-auth-admin-status-value");
  const adminSetBlock      = document.getElementById("settings-auth-admin-set");
  const adminNewEl         = document.getElementById("settings-auth-admin-new");
  const adminConfirmEl     = document.getElementById("settings-auth-admin-confirm");
  const adminSaveBtn       = document.getElementById("settings-auth-admin-save");
  const adminChangeBlock   = document.getElementById("settings-auth-admin-change");
  const adminCurrentEl     = document.getElementById("settings-auth-admin-current");
  const adminNew2El        = document.getElementById("settings-auth-admin-new2");
  const adminConfirm2El    = document.getElementById("settings-auth-admin-confirm2");
  const adminSave2Btn      = document.getElementById("settings-auth-admin-save2");
   const adminCancelBtn     = document.getElementById("settings-auth-admin-cancel");
   const adminRemoveBtn     = document.getElementById("settings-auth-admin-remove-btn");
   const adminRemoveBlock   = document.getElementById("settings-auth-admin-remove");
   const adminRemoveCurrentEl = document.getElementById("settings-auth-admin-remove-current");
   const adminRemoveConfirmBtn = document.getElementById("settings-auth-admin-remove-confirm");
  const viewerToggleEl     = document.getElementById("settings-auth-viewer-toggle");
  const viewerRowEl        = document.getElementById("settings-auth-viewer-row");
  const viewerConfirmRowEl = document.getElementById("settings-auth-viewer-confirm-row");
  const viewerActionsEl    = document.getElementById("settings-auth-viewer-actions");
  const viewerPwEl         = document.getElementById("settings-auth-viewer-pw");
  const viewerConfirmEl    = document.getElementById("settings-auth-viewer-confirm");
  // The viewer status note is "Viewer password: <value>" where
  // <value> is a child span. The label is fixed and the value is
  // what the JS updates.
  const viewerStatusValueEl = document.getElementById("settings-auth-viewer-status-value");
  const viewerSaveBtn      = document.getElementById("settings-auth-viewer-save");
  const viewerRemoveBtn    = document.getElementById("settings-auth-viewer-remove");
  const authErrorEl        = document.getElementById("settings-auth-error");
  // No toggle state needed: the change form is always shown when the
  // admin password is set, and always hidden when it isn't.

  let infoLoaded = false;
  let onOpenListeners = [];
  let clearInitialFocus = null;
  // The currently visible tab name. Defaults to "general" so the file
  // watching section shows first; reset on every open() so the user
  // always lands somewhere predictable.
  let activeTab = "general";

  /* --- tab navigation ------------------------------------------------- */
  // Show the section for `name` and hide the rest. The matching nav
  // entry gets the `.active` class + `aria-selected="true"` so the
  // highlight follows.
  function showTab(name) {
    if (!sectionEls.some(el => el.dataset.section === name)) return;
    activeTab = name;
    for (const item of navItems) {
      const on = item.dataset.tab === name;
      item.classList.toggle("active", on);
      item.setAttribute("aria-selected", on ? "true" : "false");
      item.tabIndex = on ? 0 : -1;
    }
    for (const el of sectionEls) {
      el.hidden = (el.dataset.section !== name);
    }
  }
  for (const item of navItems) {
    item.addEventListener("click", () => showTab(item.dataset.tab));
    item.addEventListener("keydown", (e) => {
      const i = navItems.indexOf(item);
      let next = null;
      if (e.key === "ArrowDown") next = navItems[(i + 1) % navItems.length];
      else if (e.key === "ArrowUp") next = navItems[(i - 1 + navItems.length) % navItems.length];
      else if (e.key === "Home") next = navItems[0];
      else if (e.key === "End") next = navItems[navItems.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
        showTab(next.dataset.tab);
      }
    });
  }

  // The row label repeats the selected option's px value. The string is
  // copied from the tile's caption, so the four sizes exist once, in the
  // markup -- nothing recomputes px here.
  function syncFontSizeValue() {
    if (!fontSizeCurrentEl) return;
    const picked = fontSizeRadios.find(r => r.checked);
    const pxEl = picked && picked.parentElement
      ? picked.parentElement.querySelector(".fs-tile-px") : null;
    if (pxEl) fontSizeCurrentEl.textContent = pxEl.textContent;
  }

  // Sync a radio group's `checked` from the current cfg. Each radio's
  // `value` is the same string the cfg uses for the field, so we walk
  // the group and check the one whose value matches. Called on open so
  // the radios always reflect the live state (important for live mode:
  // a previous open's pick is now persisted in cfg, and the radio
  // should show it on the next open, not the HTML default).
  function syncRadios() {
    if (!NB.app || !NB.app.getCfg) return;
    const cfg = NB.app.getCfg();
    const groups = [
      [themeRadios,             cfg.theme],
      [fontSizeRadios,          cfg.fontSize],
      [settingsModalWidthRadios, cfg.settingsModalWidth],
      [settingsModalHeightRadios, cfg.settingsModalHeight],
      [wallpaperRadios,         cfg.wallpaper],
      [wallpaperScrollRadios,   cfg.wallpaperScroll],
      [wallpaperColorRadios,    cfg.wallpaperColor],
      [wallpaperIntensityRadios,cfg.wallpaperIntensity],
    ];
    for (const [radios, val] of groups) {
      for (const r of radios) {
        r.checked = (r.value === val);
      }
    }
    syncFontSizeValue();
  }

  /* Focus lands on the Close button, and a forced ring keeps it visible
   * after a mouse click (where :focus-visible may not match). The ring
   * clears on the first key or pointer press inside the dialog, or on
   * blur. */
  function markInitialFocus() {
    if (!closeBtn) return;
    if (clearInitialFocus) clearInitialFocus();
    closeBtn.classList.add("stg-initial-focus");
    const clear = () => {
      closeBtn.classList.remove("stg-initial-focus");
      modalEl.removeEventListener("keydown", clear, true);
      modalEl.removeEventListener("pointerdown", clear, true);
      closeBtn.removeEventListener("blur", clear);
      if (clearInitialFocus === clear) clearInitialFocus = null;
    };
    clearInitialFocus = clear;
    modalEl.addEventListener("keydown", clear, true);
    modalEl.addEventListener("pointerdown", clear, true);
    closeBtn.addEventListener("blur", clear);
  }

  function open() {
    // Always start on the General tab so the user lands somewhere
    // predictable (and sees the file-watching status, which is the
    // most likely "what's the state of the app" question).
    showTab(activeTab);
    // Sync radios from the live cfg so opening the modal shows the
    // current state, not whatever the HTML defaults to.
    syncRadios();
    syncVimToggle();
    syncAutosaveToggle();
    syncVimrc();
    syncAppearanceText();
    syncSpellcheck();
    syncSpellcheckWords(true);
    refreshWatchStatus();
    refreshAuthState();
    renderShortcuts();
    renderSidebarOrder();
    if (!infoLoaded) loadInfo();
    overlayEl.hidden = false;
    markInitialFocus();
    if (NB.dialog) {
      NB.dialog.open(overlayEl, {
        initialFocus: closeBtn || modalEl,
        fallbackFocus: settingsBtn,
      });
    }
    onOpenListeners.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function close() {
    if (clearInitialFocus) clearInitialFocus();
    overlayEl.hidden = true;
    if (NB.dialog) NB.dialog.close(overlayEl);
    // Release focus held by any field inside the modal. In the browser
    // hiding the overlay blurs its inputs automatically, but doing it
    // explicitly keeps keyboard state sane (e.g. VIM mode, which yields
    // to editable fields) in every environment.
    if (document.activeElement && overlayEl.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function isOpen() { return !overlayEl.hidden; }

  /* --- live radio listeners ------------------------------------------
   * Every radio change calls the matching NB.app.set*() directly. Each
   * setter writes to the cfg, updates the DOM, and triggers the
   * debounced persistConfig() so the choice survives a reload. There
   * is no draft, no Apply, no Cancel. */
  themeRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setTheme(r.value);
  }));
  fontSizeRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) {
      NB.app.setFontSize(r.value);
      syncFontSizeValue();
    }
  }));
  settingsModalWidthRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setSettingsModalWidth(r.value);
  }));
  settingsModalHeightRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setSettingsModalHeight(r.value);
  }));
  wallpaperRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setWallpaper(r.value);
  }));
  wallpaperScrollRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setWallpaperScroll(r.value);
  }));
  wallpaperColorRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setWallpaperColor(r.value);
  }));
  wallpaperIntensityRadios.forEach(r => r.addEventListener("change", () => {
    if (r.checked) NB.app.setWallpaperIntensity(r.value);
  }));

  /* --- shortcuts tab --------------------------------------------------
   * The Shortcuts tab lists every configurable app action with its
   * current binding. The user can rebind (one-shot key capture) or
   * reset to the default. Changes are live: shortcuts.js reads the
   * current cfg.shortcuts on every keydown, so a freshly set
   * binding takes effect on the next press.
   *
   * The VIM keymap is deliberately not in this list -- it's its own
   * thing, configured under VIM mode and documented in the :help
   * overlay. */
  function buildShortcutRow(action) {
    const labels = NB.shortcuts.getActionLabels();
    const label = labels[action] || action;
    const row = document.createElement("div");
    row.className = "shortcut-row";
    row.dataset.action = action;
    row.setAttribute("role", "listitem");
    row.innerHTML =
      '<span class="shortcut-label"></span>' +
      '<span class="shortcut-binding-wrap">' +
        '<kbd class="shortcut-binding"></kbd>' +
        '<button type="button" class="settings-action shortcut-change">Change…</button>' +
        '<button type="button" class="settings-action shortcut-reset" hidden>Reset</button>' +
      '</span>';
    row.querySelector(".shortcut-label").textContent = label;
    const changeBtn = row.querySelector(".shortcut-change");
    const resetBtn = row.querySelector(".shortcut-reset");
    changeBtn.addEventListener("click", () => beginCapture(action, row));
    resetBtn.addEventListener("click", () => {
      NB.shortcuts.resetBinding(action);
      renderShortcuts();
    });
    return row;
  }

  function renderShortcuts() {
    if (!shortcutsListEl || !NB.shortcuts) return;
    shortcutsListEl.innerHTML = "";
    const actions = NB.shortcuts.getActionOrder();
    for (const action of actions) {
      const row = buildShortcutRow(action);
      const bindingEl = row.querySelector(".shortcut-binding");
      const resetBtn = row.querySelector(".shortcut-reset");
      const defaults = NB.shortcuts.getDefaults();
      const current = NB.shortcuts.getBinding(action);
      bindingEl.textContent = NB.shortcuts.format(current);
      // Mark "Reset" as available only when the binding differs from
      // the default (so unchanged rows don't show a no-op button).
      resetBtn.hidden = (current === (defaults[action] || ""));
      shortcutsListEl.appendChild(row);
    }
    // Localize the fixed hybrid-editor reference rows: "Mod+B" renders
    // as Ctrl+B / Cmd+B per platform via the same formatter.
    if (overlayEl) {
      overlayEl.querySelectorAll("kbd.shortcut-binding[data-key]").forEach((k) => {
        k.textContent = NB.shortcuts.format(k.dataset.key || "");
      });
    }
  }

  // Activity-bar order: one card per registered view. The grip is the only
  // drag source; the row's toggle hides or restores the icon without losing
  // its place. Reads the live bar order so a partial saved list still shows
  // every view.
  function renderSidebarOrder() {
    if (!sidebarOrderListEl || !NB.activity || !NB.activity.barItems) return;
    const items = NB.activity.barItems();
    sidebarOrderListEl.innerHTML = "";
    items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "sidebar-order-row";
      row.classList.toggle("is-hidden", !!item.hidden);
      row.dataset.view = item.id;
      row.setAttribute("role", "listitem");
      row.setAttribute("aria-posinset", String(idx + 1));
      row.setAttribute("aria-setsize", String(items.length));
      row.addEventListener("dragstart", (e) => startSidebarDrag(e, row));
      row.addEventListener("dragover", (e) => dragOverSidebarRow(e, row));
      row.addEventListener("dragleave", (e) => {
        if (e.relatedTarget && row.contains(e.relatedTarget)) return;
        row.classList.remove("drop-before", "drop-after");
      });
      row.addEventListener("drop", (e) => dropSidebarRow(e, row));
      row.addEventListener("dragend", endSidebarDrag);
      const grip = document.createElement("span");
      grip.className = "sidebar-order-grip";
      grip.draggable = true;
      grip.setAttribute("aria-hidden", "true");
      grip.innerHTML =
        '<svg class="icon" aria-hidden="true" focusable="false">' +
        '<use href="#nb-icon-grip"/></svg>';
      row.appendChild(grip);
      const icon = document.createElement("span");
      icon.className = "sidebar-order-icon";
      icon.setAttribute("aria-hidden", "true");
      if (item.icon && item.icon.indexOf("nb-icon-") === 0) {
        icon.innerHTML =
          '<svg aria-hidden="true" focusable="false"><use href="#' +
          item.icon + '"/></svg>';
      } else {
        icon.textContent = item.icon || "";
      }
      row.appendChild(icon);
      const label = document.createElement("span");
      label.className = "sidebar-order-label";
      label.textContent = item.label;
      row.appendChild(label);
      const actions = document.createElement("span");
      actions.className = "sidebar-order-actions";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "settings-action sidebar-order-toggle";
      toggle.textContent = item.hidden ? "Unhide" : "Hide";
      toggle.title = (item.hidden ? "Unhide " : "Hide ") + item.label;
      toggle.setAttribute("aria-label", toggle.title);
      toggle.addEventListener("click", () => toggleSidebarHidden(item.id));
      actions.appendChild(toggle);
      row.appendChild(actions);
      sidebarOrderListEl.appendChild(row);
    });
  }
  function sidebarRequestFrame(fn) {
    return window.requestAnimationFrame
      ? window.requestAnimationFrame(fn) : window.setTimeout(fn, 16);
  }
  function sidebarCancelFrame(id) {
    if (!id) return;
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(id);
    else window.clearTimeout(id);
  }
  function startSidebarDrag(e, row) {
    if (!e.target || !e.target.closest || !e.target.closest(".sidebar-order-grip")) {
      e.preventDefault();
      return;
    }
    const id = row.dataset.view;
    sidebarDragId = id;
    // Seed the pointer from the gesture so the auto-scroll loop's first tick
    // tests a real position, not the (0, 0) initial value.
    sidebarDragX = e.clientX || 0;
    sidebarDragY = e.clientY || 0;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
    // Dim one frame late: the browser snapshots the drag image as dragstart
    // returns, so a class added here would dim the image itself.
    sidebarRequestFrame(() => {
      if (sidebarDragId === id) row.classList.add("dragging");
    });
    document.addEventListener("dragover", trackSidebarDrag, true);
    document.addEventListener("drop", guardSidebarDrop, true);
    startSidebarAutoScroll();
  }
  function trackSidebarDrag(e) {
    sidebarDragX = e.clientX;
    sidebarDragY = e.clientY;
    e.preventDefault();
  }
  function guardSidebarDrop(e) {
    e.preventDefault();
  }
  function dragOverSidebarRow(e, row) {
    if (!sidebarDragId) return;
    if (row.dataset.view === sidebarDragId) {
      clearSidebarDropMarks();
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    markSidebarDrop(row, e.clientY);
  }
  function markSidebarDrop(row, clientY) {
    if (!row || row.dataset.view === sidebarDragId) {
      clearSidebarDropMarks();
      return;
    }
    const rect = row.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    clearSidebarDropMarks();
    row.classList.add(after ? "drop-after" : "drop-before");
  }
  function dropSidebarRow(e, row) {
    e.preventDefault();
    const id = sidebarDragId;
    const before = row.classList.contains("drop-before");
    clearSidebarDropMarks();
    if (!id || id === row.dataset.view) {
      endSidebarDrag();
      return;
    }
    moveSidebarViewTo(id, row.dataset.view, before);
    endSidebarDrag();
  }
  function endSidebarDrag() {
    sidebarDragId = null;
    clearSidebarDropMarks();
    if (sidebarOrderListEl) {
      sidebarOrderListEl.querySelectorAll(".sidebar-order-row.dragging")
        .forEach(row => row.classList.remove("dragging"));
    }
    stopSidebarAutoScroll();
    document.removeEventListener("dragover", trackSidebarDrag, true);
    document.removeEventListener("drop", guardSidebarDrop, true);
  }
  function startSidebarAutoScroll() {
    stopSidebarAutoScroll();
    const step = () => {
      sidebarDragFrame = 0;
      if (!sidebarDragId || !settingsSectionsEl) return;
      const rect = settingsSectionsEl.getBoundingClientRect();
      let dir = 0;
      if (sidebarDragY < rect.top + SIDEBAR_DRAG_SCROLL_BAND_PX) dir = -1;
      else if (sidebarDragY > rect.bottom - SIDEBAR_DRAG_SCROLL_BAND_PX) dir = 1;
      if (dir) {
        settingsSectionsEl.scrollTop += dir * SIDEBAR_DRAG_SCROLL_STEP_PX;
        refreshSidebarDropAtPointer();
      }
      sidebarDragFrame = sidebarRequestFrame(step);
    };
    sidebarDragFrame = sidebarRequestFrame(step);
  }
  function stopSidebarAutoScroll() {
    sidebarCancelFrame(sidebarDragFrame);
    sidebarDragFrame = 0;
  }
  function refreshSidebarDropAtPointer() {
    if (typeof document.elementFromPoint !== "function") return;
    const el = document.elementFromPoint(sidebarDragX, sidebarDragY);
    const row = (el && el.closest) ? el.closest(".sidebar-order-row") : null;
    if (row && sidebarOrderListEl && sidebarOrderListEl.contains(row)) {
      markSidebarDrop(row, sidebarDragY);
    } else {
      clearSidebarDropMarks();
    }
  }
  function clearSidebarDropMarks() {
    if (!sidebarOrderListEl) return;
    sidebarOrderListEl.querySelectorAll(".drop-before, .drop-after")
      .forEach(row => row.classList.remove("drop-before", "drop-after"));
  }
  function moveSidebarViewTo(viewId, targetId, before) {
    const items = (NB.activity && NB.activity.barItems) ? NB.activity.barItems() : [];
    const from = items.findIndex(item => item.id === viewId);
    if (from < 0 || items.findIndex(item => item.id === targetId) < 0) return;
    const previous = items.map(item => item.id);
    const ids = previous.slice();
    ids.splice(from, 1);
    let target = ids.indexOf(targetId);
    if (!before) target += 1;
    ids.splice(target, 0, viewId);
    if (ids.join(",") === previous.join(",")) return;
    if (NB.app && NB.app.setSidebarOrder) NB.app.setSidebarOrder(ids);
    renderSidebarOrder();
    focusSidebarOrderToggle(viewId);
    announceSidebarMove(viewId, ids.indexOf(viewId), ids.length);
  }
  function focusSidebarOrderToggle(viewId) {
    if (!sidebarOrderListEl) return;
    const row = sidebarOrderListEl.querySelector(
      '.sidebar-order-row[data-view="' + viewId + '"]');
    const toggle = row && row.querySelector(".sidebar-order-toggle");
    if (toggle) toggle.focus({ preventScroll: true });
  }
  function toggleSidebarHidden(viewId) {
    const items = (NB.activity && NB.activity.barItems) ? NB.activity.barItems() : [];
    const item = items.find(entry => entry.id === viewId);
    if (!item) return;
    const hidden = items.filter(entry => entry.hidden).map(entry => entry.id);
    const next = item.hidden
      ? hidden.filter(id => id !== viewId)
      : hidden.concat(viewId);
    if (NB.app && NB.app.setSidebarHidden) NB.app.setSidebarHidden(next);
    renderSidebarOrder();
    focusSidebarOrderToggle(viewId);
    if (sidebarOrderStatusEl) {
      sidebarOrderStatusEl.textContent =
        item.label + (item.hidden ? " shown." : " hidden.");
    }
  }
  function announceSidebarMove(viewId, index, total) {
    if (!sidebarOrderStatusEl) return;
    const items = (NB.activity && NB.activity.barItems) ? NB.activity.barItems() : [];
    const item = items.find(entry => entry.id === viewId);
    const label = (item && item.label) || viewId;
    sidebarOrderStatusEl.textContent =
      label + " moved to position " + (index + 1) + " of " + total + ".";
  }
  // A config load can change the order or the hidden set while the modal is
  // open. Re-render only when the list actually differs, so an ordinary save
  // does not steal focus mid-move.
  NB.evt.on("config:changed", () => {
    if (!isOpen() || !sidebarOrderListEl || !NB.activity || !NB.activity.barItems) return;
    const items = NB.activity.barItems();
    const shownOrder = Array.from(sidebarOrderListEl.children)
      .map(row => row.dataset.view).join(",");
    const shownHidden = Array.from(sidebarOrderListEl.children)
      .filter(row => row.classList.contains("is-hidden"))
      .map(row => row.dataset.view).join(",");
    const nowOrder = items.map(item => item.id).join(",");
    const nowHidden = items.filter(item => item.hidden)
      .map(item => item.id).join(",");
    if (shownOrder !== nowOrder || shownHidden !== nowHidden) renderSidebarOrder();
  });

  // One row at a time can be capturing. We arm the shortcuts module's
  // capture, swap the row's binding cell + button into a "press a key"
  // state, and disarm on keypress (which fires the callback) or when
  // the user clicks the now-"Cancel" button.
  function beginCapture(action, row) {
    if (!NB.shortcuts) return;
    if (capturingAction && capturingAction !== action) {
      // Cancel any in-flight capture on another row.
      cancelCapture();
    }
    capturingAction = action;
    const bindingEl = row.querySelector(".shortcut-binding");
    const changeBtn = row.querySelector(".shortcut-change");
    const resetBtn = row.querySelector(".shortcut-reset");
    bindingEl.textContent = "Press a key… (Esc to cancel)";
    bindingEl.classList.add("shortcut-binding-capturing");
    changeBtn.textContent = "Cancel";
    changeBtn.onclick = (e) => { e.preventDefault(); cancelCapture(); };
    resetBtn.hidden = true;
    NB.shortcuts.captureNext((chord) => {
      // chord === null means Esc (cancel); otherwise the new binding.
      capturingAction = null;
      if (chord === null) {
        renderShortcuts();
        return;
      }
      NB.shortcuts.setBinding(action, chord);
      renderShortcuts();
    });
  }
  function cancelCapture() {
    if (!capturingAction) return;
    // Fire the capture callback with null to disarm the module. We
    // dispatch a no-op key (Escape) would also work, but going
    // through the module's API is cleaner: we can't directly clear
    // captureCb, so we ask the module to cancel by sending Esc.
    // Easier: just re-render (the row's binding/button reset) and
    // the next keydown will be handled normally -- but captureCb
    // is still armed. So we MUST disarm it. The cleanest way is to
    // call captureNext(null)... but captureNext(cb) sets it. The
    // module doesn't expose a cancel. Workaround: dispatch a
    // synthetic Escape on the document, which the capture branch
    // handles (calls cb(null)).
    document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));
    capturingAction = null;
  }

  if (shortcutsResetAllBtn) {
    shortcutsResetAllBtn.addEventListener("click", () => {
      cancelCapture();
      NB.shortcuts.resetAll();
      renderShortcuts();
    });
  }

  /* Watch toggle: live, but `enable()` is async and may show a
   * showDirectoryPicker modal the user can cancel. We optimistically
   * let `enable()` decide the actual state, then re-render the
   * toggle label + status from the live `isActive()` so the UI
   * matches reality (cancelled picker -> still "off", button still
   * reads "Enable"). */
  if (watchToggleBtn) {
    watchToggleBtn.addEventListener("click", async () => {
      if (NB.watcher && NB.watcher.isActive()) {
        NB.watcher.disable();
      } else {
        try { await NB.watcher.enable(); }
        catch (e) { alert("File watching failed: " + e.message); }
      }
      // Persist the resulting on/off state so the choice survives reload.
      // A cancelled picker leaves the watcher inactive and is saved as off.
      if (NB.app && NB.app.setWatchEnabled) {
        NB.app.setWatchEnabled(!!(NB.watcher && NB.watcher.isActive()));
      }
      refreshWatchStatus();
    });
  }

  function refreshWatchStatus() {
    if (!NB.watcher) {
      watchStatusEl.textContent = "Unavailable";
      watchStatusEl.classList.remove("watch-on", "watch-off");
      watchToggleBtn.textContent = "Enable";
      watchToggleBtn.disabled = true;
      return;
    }
    const active = NB.watcher.isActive();
    watchStatusEl.textContent = NB.watcher.describe();
    // Color-code the status so the user can never be unsure whether
    // external change detection is on. Both the native observer and
    // the polling fallback count as "on" (green); only the truly
    // off state gets the warning color.
    watchStatusEl.classList.toggle("watch-on",  active);
    watchStatusEl.classList.toggle("watch-off", !active);
    // "Enable" / "Disable" stays the same shape as before -- the user
    // can always turn detection on or off. The only difference vs.
    // the old opt-in model is that it now starts ON by default.
    watchToggleBtn.textContent = active ? "Disable" : "Enable";
    watchToggleBtn.disabled = false;
  }

  /* Sync the VIM-mode checkbox from the live cfg. */
  function syncVimToggle() {
    if (!vimToggleEl) return;
    if (NB.app && NB.app.getCfg) {
      vimToggleEl.checked = !!NB.app.getCfg().vimMode;
    }
  }

  /* Sync the autosave checkbox + delay from the live cfg. */
  function syncAutosaveToggle() {
    if (!autosaveToggleEl) return;
    if (NB.app && NB.app.getAutosave) {
      autosaveToggleEl.checked = NB.app.getAutosave();
      if (autosaveDelayEl) {
        autosaveDelayEl.value = NB.app.getAutosaveDelay();
        autosaveDelayEl.disabled = !autosaveToggleEl.checked;
      }
    }
  }

  /* Sync the hide-top-bar and hide-tab-bar checkboxes + site-title field from
   * the live cfg. */
  function syncAppearanceText() {
    if (NB.app && NB.app.getCfg) {
      const cfg = NB.app.getCfg();
      if (hideTopbarEl) hideTopbarEl.checked = !!cfg.hideTopbar;
      if (hideTabbarEl) hideTabbarEl.checked = !!cfg.hideTabBar;
      if (graphParticlesEl) graphParticlesEl.checked = !!(NB.graph && NB.graph.getParticleField && NB.graph.getParticleField());
      if (siteTitleEl) siteTitleEl.value = cfg.siteTitle || "Notebook";
    }
  }

  /* True when this browser can paint the misspelling underline at all. */
  function hasHighlightApi() {
    return !!(window.CSS && CSS.highlights &&
      typeof window.Highlight === "function");
  }

  /* Sync the Spelling switch and its note. The note names the degraded
   * state, and the switch is disabled where the feature cannot run: the
   * app never removes the browser's spellcheck without replacing it. */
  function syncSpellcheck() {
    if (!spellcheckToggleEl) return;
    const supported = hasHighlightApi();
    const failed = !!(NB.spellcheck && NB.spellcheck.state() === "failed");
    const on = (NB.app && NB.app.getSpellcheck) ? NB.app.getSpellcheck() : true;
    spellcheckToggleEl.checked = on;
    spellcheckToggleEl.disabled = !supported;
    if (!spellcheckNoteEl) return;
    if (!supported) {
      spellcheckNoteEl.textContent = SPELL_UNSUPPORTED_NOTE;
      spellcheckNoteEl.classList.remove("settings-note--warn");
      spellcheckNoteEl.hidden = false;
      return;
    }
    if (failed) {
      spellcheckNoteEl.textContent = SPELL_FAILED_NOTE;
      spellcheckNoteEl.classList.add("settings-note--warn");
      spellcheckNoteEl.hidden = false;
      return;
    }
    spellcheckNoteEl.textContent = "";
    spellcheckNoteEl.classList.remove("settings-note--warn");
    spellcheckNoteEl.hidden = true;
  }

  /* Fill the Personal words textarea from config. `force` is the open path;
   * a config:changed only refills when there is no unsaved edit. */
  function syncSpellcheckWords(force) {
    if (!spellcheckWordsEl) return;
    if (spellcheckWordsDirty && !force) return;
    const words = (NB.app && NB.app.getSpellcheckWords)
      ? NB.app.getSpellcheckWords() : [];
    spellcheckWordsEl.value = words.join("\n");
    spellcheckWordsDirty = false;
  }

  /* Save the list: one word per line. Rejected lines are named, never
   * dropped silently (docs/ui/spellcheck.md §3, row 20). */
  function saveSpellcheckWords() {
    if (!spellcheckWordsEl || !spellcheckWordsStatusEl || !NB.app) return;
    if (!NB.app.normalizeSpellcheckWords || !NB.app.setSpellcheckWords) return;
    const lines = spellcheckWordsEl.value.split(/\r?\n/)
      .map((line) => line.trim()).filter(Boolean);
    const ignored = lines.filter(
      (line) => NB.app.normalizeSpellcheckWords([line]).length === 0);
    const kept = NB.app.setSpellcheckWords(lines) || [];
    spellcheckWordsDirty = false;
    const parts = [];
    if (ignored.length) {
      const names = ignored.slice(0, 3).join(", ");
      const more = ignored.length > 3
        ? ", +" + (ignored.length - 3) + " more" : "";
      parts.push(ignored.length + " ignored: " + names + more);
    }
    if (kept.length === SPELL_WORDS_CAP) {
      parts.push("older words were dropped (the list is capped at " +
        SPELL_WORDS_CAP.toLocaleString() + ")");
    }
    let msg = "Saved " + kept.length + " word" + (kept.length === 1 ? "" : "s");
    if (parts.length) msg += "; " + parts.join("; ");
    else if (!kept.length) msg += " (the list is empty)";
    spellcheckWordsStatusEl.textContent = msg + ".";
    spellcheckWordsStatusEl.classList.toggle("ok", parts.length === 0);
    spellcheckWordsStatusEl.classList.toggle("error", parts.length !== 0);
    spellcheckWordsStatusEl.hidden = false;
  }

  /* VIM toggle: live, same model as the radios. The actual work
   * (attaching the global keydown listener + tagging the three
   * windows) is in NB.vimnav.setEnabled; we just flip the cfg +
   * call it. */
  if (vimToggleEl) {
    vimToggleEl.addEventListener("change", () => {
      const on = vimToggleEl.checked;
      if (NB.app && NB.app.setVimMode) NB.app.setVimMode(on);
    });
  }

  /* Autosave toggle + delay: live. hybrid.js reads cfg.autosave and
   * cfg.autosaveDelay through NB.app on each arm, so persisting the
   * values is enough. */
  if (autosaveToggleEl) {
    autosaveToggleEl.addEventListener("change", () => {
      if (NB.app && NB.app.setAutosave) NB.app.setAutosave(autosaveToggleEl.checked);
      syncAutosaveToggle();
    });
  }
  if (autosaveDelayEl) {
    autosaveDelayEl.addEventListener("change", () => {
      if (NB.app && NB.app.setAutosaveDelay) NB.app.setAutosaveDelay(autosaveDelayEl.value);
      autosaveDelayEl.value = NB.app.getAutosaveDelay();
    });
  }

  /* Hide top bar: live, same model as the radios. */
  if (hideTopbarEl) {
    hideTopbarEl.addEventListener("change", () => {
      if (NB.app && NB.app.setHideTopbar) NB.app.setHideTopbar(hideTopbarEl.checked);
    });
  }

  /* Hide tab bar: live. The attribute goes on #tab-bar, and the rail's
   * outline twin follows it in CSS. */
  if (hideTabbarEl) {
    hideTabbarEl.addEventListener("change", () => {
      if (NB.app && NB.app.setHideTabBar) NB.app.setHideTabBar(hideTabbarEl.checked);
    });
  }

  /* Graph background particles: live. Toggles the ambient drift field
   * in the graph view and persists via NB.app's debounced config path. */
  if (graphParticlesEl) {
    graphParticlesEl.addEventListener("change", () => {
      if (NB.graph && NB.graph.setParticleField) NB.graph.setParticleField(graphParticlesEl.checked);
      if (NB.app && NB.app.setGraphParticles) NB.app.setGraphParticles(graphParticlesEl.checked);
    });
  }

  /* Site title: live on input (debounced persist via NB.app.setSiteTitle). */
  if (siteTitleEl) {
    siteTitleEl.addEventListener("input", () => {
      if (NB.app && NB.app.setSiteTitle) NB.app.setSiteTitle(siteTitleEl.value);
    });
  }

  /* Spellcheck: live. Hybrid reads the switch on every routing decision, so
   * persisting it is enough; the note tracks the load state. */
  if (spellcheckToggleEl) {
    spellcheckToggleEl.addEventListener("change", () => {
      if (NB.app && NB.app.setSpellcheck) {
        NB.app.setSpellcheck(spellcheckToggleEl.checked);
      }
      syncSpellcheck();
    });
  }
  NB.evt.on("spellcheck:state", () => {
    if (isOpen()) syncSpellcheck();
  });
  NB.evt.on("config:changed", () => {
    if (isOpen()) syncSpellcheck();
    if (isOpen()) syncSpellcheckWords(false);
  });

  /* Personal words: an explicit Save, like the VIM script, because a line
   * can be rejected and the user must see which one. Typing marks the
   * textarea dirty so a remote config change cannot overwrite it. */
  if (spellcheckWordsEl) {
    spellcheckWordsEl.addEventListener("input", () => {
      spellcheckWordsDirty = true;
    });
  }
  if (spellcheckWordsSaveEl) {
    spellcheckWordsSaveEl.addEventListener("click", saveSpellcheckWords);
  }

  /* VIM initial script (vimrc). The textarea holds the user's
   * custom bindings; Save parses + applies them. We keep this
   * explicit (Save button + status line) instead of the live-
   * on-edit model used for the radios because the parser can
   * report line-level errors that the user needs to see, and
   * a partial / half-typed line shouldn't be applied mid-keystroke.
   * On success we apply via NB.cmEditor.applyVimrc (which goes
   * through cm-bridge.compileVimrc) so the user gets the same
   * result here as at boot. On failure the previous good
   * config is left in place and the status line shows which
   * line(s) broke. */
  function showVimrcStatus(kind, text) {
    if (!vimrcStatus) return;
    vimrcStatus.hidden = false;
    vimrcStatus.className = "settings-vimrc-status " + (kind || "");
    vimrcStatus.textContent = text;
  }
  function syncVimrc() {
    if (!vimrcEl) return;
    vimrcEl.value = NB.app && NB.app.getVimrc ? NB.app.getVimrc() : "";
    // Don't auto-show a status on every open: only after a save
    // (or if a previous open's save error is still on screen).
  }
  if (vimrcSaveEl) {
    vimrcSaveEl.addEventListener("click", () => {
      if (!vimrcEl) return;
      const text = vimrcEl.value;
      // Try to apply first. If the parser returns ok:false, we
      // surface the errors and DO NOT persist -- the user's
      // last-known-good config stays in cfg + active in the
      // editor. This matches the "Show error, keep last good
      // config" choice.
      let result = null;
      try {
        if (NB.cmEditor && NB.cmEditor.applyVimrc) {
          result = NB.cmEditor.applyVimrc(text);
        }
      } catch (e) {
        showVimrcStatus("error", "Save failed: " + (e.message || e));
        return;
      }
      if (!result || !result.ok) {
        const errs = (result && result.errors) || [];
        const first = errs[0];
        const msg = first
          ? `Line ${first.line}: ${first.message}` +
            (errs.length > 1 ? ` (+${errs.length - 1} more)` : "")
          : "Save failed: unknown error";
        showVimrcStatus("error", msg);
        return;
      }
      // Success: persist the new vimrc.
      if (NB.app && NB.app.setVimrc) NB.app.setVimrc(text);
      const n = result.count;
      showVimrcStatus("ok",
        n === 0
          ? "Saved (0 bindings; the editor is unchanged)"
          : `Saved (${n} binding${n === 1 ? "" : "s"} applied)`);
    });
  }

  async function loadInfo() {
    try {
      const info = await NB.api.getInfo();
      dataDirEl.textContent   = info.data_dir   || "(unknown)";
      configDirEl.textContent = info.config_dir || "(unknown)";
      infoLoaded = true;
    } catch (e) {
      dataDirEl.textContent   = "(failed to load)";
      configDirEl.textContent = "(failed to load)";
    }
  }

  // Close: × button, footer Close, Esc key, dim-backdrop click.
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (closeFooterBtn) closeFooterBtn.addEventListener("click", close);
  overlayEl.addEventListener("click", (e) => {
    // click on the dim backdrop (not the modal) closes
    if (e.target === overlayEl) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen()) return;
    // Esc cancels a drag gesture. Clean up here as well as on dragend so the
    // modal stays open even if the browser does not deliver dragend.
    if (sidebarDragId) {
      endSidebarDrag();
      return;
    }
    close();
  });

  /* --- Passwords section -------------------------------------------- */
  // The section reflects the current auth state. It's admin-only: when
  // the logged-in user is not an admin, the inputs are disabled and a
  // help line asks them to sign in as admin. The current auth status is
  // fetched fresh each time the modal opens, so the UI stays in sync if
  // passwords were changed in another tab.
  let authState = null;     // last /api/auth response
  function setAuthError(msg) {
    if (!authErrorEl) return;
    authErrorEl.textContent = msg || "";
    authErrorEl.hidden = !msg;
  }
  function isAdmin() {
    return !!(authState && authState.enabled && authState.role === "admin");
  }
  // Enable the "Save" button on the admin "set" form when new and
  // confirm are both non-empty and match.
  function refreshAdminSetSaveEnabled() {
    if (!adminNewEl || !adminConfirmEl || !adminSaveBtn) return;
    const newPw = adminNewEl.value;
    const confirm = adminConfirmEl.value;
    const canEdit = isAdmin() || !authState || !authState.enabled;
    adminSaveBtn.disabled = !canEdit || newPw.length === 0 || newPw !== confirm;
  }
  // Enable the "Save" button on the admin "change" form when current
  // is non-empty, new is non-empty, and new matches confirm.
  function refreshAdminChangeSaveEnabled() {
    if (!adminCurrentEl || !adminNew2El || !adminConfirm2El || !adminSave2Btn) return;
    const cur = adminCurrentEl.value;
    const newPw = adminNew2El.value;
    const confirm = adminConfirm2El.value;
    adminSave2Btn.disabled =
      isAdmin() === false
      || cur.length === 0
      || newPw.length === 0
      || newPw !== confirm;
  }
  // Render the admin section for the current auth state. When no
  // admin password is configured, show the inline "Set" form (new +
  // confirm). When one exists, show the status + a "Change admin
  // password" button; clicking it reveals the 3-field "change" form
  // (current + new + confirm). The "change" form is collapsed on
  // open() and on successful save so the user lands in a clean state.
  function refreshAuthSection() {
    if (!authHelpEl) return;
    setAuthError("");
    const canEdit = isAdmin();
    const hasAdmin = !!(authState && authState.enabled);
    if (!hasAdmin) {
      // No admin password configured. Anyone can set the initial one.
      authHelpEl.textContent = "Set an admin password to require a password for writing.";
      adminStatusValueEl.textContent = "Not set";
      adminSetBlock.hidden = false;
      adminChangeBlock.hidden = true;
      if (adminNewEl) { adminNewEl.disabled = false; adminNewEl.value = ""; }
      if (adminConfirmEl) { adminConfirmEl.disabled = false; adminConfirmEl.value = ""; }
       refreshAdminSetSaveEnabled();
       // No admin password: hide the removal button + form.
       if (adminRemoveBtn) adminRemoveBtn.hidden = true;
       if (adminRemoveBlock) adminRemoveBlock.hidden = true;
       if (adminRemoveCurrentEl) { adminRemoveCurrentEl.disabled = true; adminRemoveCurrentEl.value = ""; }
     } else {
      // Admin password already configured. The change form is always
      // shown (no toggle button): admins see it directly, non-admins
      // see it disabled. Only admins may submit.
       authHelpEl.textContent = canEdit
         ? "Change the admin password, or remove it to disable auth."
         : "Sign in as admin to change passwords.";
       adminStatusValueEl.textContent = "Set";
       adminSetBlock.hidden = true;
       // The change form is always shown when the admin password is set:
       // admins can use it, non-admins see it disabled and cleared.
       adminChangeBlock.hidden = false;
       // Clear sensitive fields when the user can't edit so a stale
       // current/new password isn't sitting in the DOM.
       if (!canEdit) {
         if (adminCurrentEl) adminCurrentEl.value = "";
         if (adminNew2El) adminNew2El.value = "";
         if (adminConfirm2El) adminConfirm2El.value = "";
       }
       if (adminCurrentEl) adminCurrentEl.disabled = !canEdit;
       if (adminNew2El) adminNew2El.disabled = !canEdit;
       if (adminConfirm2El) adminConfirm2El.disabled = !canEdit;
       refreshAdminChangeSaveEnabled();
       // Removal button + form: only visible to admins when the admin
       // password is set. The form starts collapsed; clicking the
       // button reveals it.
       if (adminRemoveBtn) adminRemoveBtn.hidden = !canEdit;
       if (adminRemoveBlock) adminRemoveBlock.hidden = true;
       if (adminRemoveCurrentEl) {
         adminRemoveCurrentEl.disabled = !canEdit;
         adminRemoveCurrentEl.value = "";
       }
        refreshAdminRemoveEnabled();
     }
     // Viewer section: admins can toggle + set; others see the toggle
    // disabled and the field hidden.
    viewerToggleEl.checked = !!(authState && authState.hasViewer);
    viewerToggleEl.disabled = !canEdit;
    const viewerVisible = canEdit || (authState && authState.hasViewer);
    viewerRowEl.hidden = !viewerVisible;
    viewerConfirmRowEl.hidden = !canEdit;
    viewerActionsEl.hidden = !canEdit;
    viewerStatusValueEl.textContent = (authState && authState.hasViewer)
      ? "Set (clear it via the toggle, or set a new one)"
      : "Not set";
    refreshViewerSaveEnabled();
    viewerRemoveBtn.hidden = !(authState && authState.hasViewer);
    viewerRemoveBtn.disabled = !canEdit;
   }
   // Enable the admin "remove" confirm button when the current password
   // field is non-empty (and the user is an admin).
   function refreshAdminRemoveEnabled() {
     if (!adminRemoveCurrentEl || !adminRemoveConfirmBtn) return;
     const canEdit = isAdmin();
     adminRemoveConfirmBtn.disabled = !canEdit || adminRemoveCurrentEl.value.length === 0;
   }
   // Enable the viewer "Save" button when new + confirm are both
  // non-empty and match.
  function refreshViewerSaveEnabled() {
    if (!viewerPwEl || !viewerConfirmEl || !viewerSaveBtn) return;
    const canEdit = isAdmin();
    const newPw = viewerPwEl.value;
    const confirm = viewerConfirmEl.value;
    viewerSaveBtn.disabled = !canEdit || newPw.length === 0 || newPw !== confirm;
  }
  async function refreshAuthState() {
    try { authState = await NB.api.getAuthStatus(); }
    catch (e) { authState = null; }
    refreshAuthSection();
    renderTokens();
    renderAiProviders();
  }
  // --- admin "set" form: live + new + confirm ---
  if (adminNewEl) adminNewEl.addEventListener("input", refreshAdminSetSaveEnabled);
  if (adminConfirmEl) adminConfirmEl.addEventListener("input", refreshAdminSetSaveEnabled);
  if (adminSaveBtn) {
    adminSaveBtn.addEventListener("click", async () => {
      const newPw = adminNewEl.value;
      if (!newPw || newPw !== adminConfirmEl.value) {
        setAuthError("New password and confirmation must match");
        return;
      }
      adminSaveBtn.disabled = true;
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(newPw, null, null);
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to save");
        adminSaveBtn.disabled = false;
      }
    });
  }
  // --- admin "change" form: current + new + confirm ---
  // Enter on any of the three fields submits the form.
  if (adminCurrentEl) adminCurrentEl.addEventListener("input", refreshAdminChangeSaveEnabled);
  if (adminNew2El) adminNew2El.addEventListener("input", refreshAdminChangeSaveEnabled);
  if (adminConfirm2El) adminConfirm2El.addEventListener("input", refreshAdminChangeSaveEnabled);
  if (adminCancelBtn) {
    adminCancelBtn.addEventListener("click", () => {
      if (adminCurrentEl) adminCurrentEl.value = "";
      if (adminNew2El) adminNew2El.value = "";
      if (adminConfirm2El) adminConfirm2El.value = "";
      refreshAdminChangeSaveEnabled();
      setAuthError("");
    });
  }
  if (adminSave2Btn) {
    adminSave2Btn.addEventListener("click", async () => {
      const cur = adminCurrentEl.value;
      const newPw = adminNew2El.value;
      if (newPw !== adminConfirm2El.value) {
        setAuthError("New password and confirmation must match");
        return;
      }
      adminSave2Btn.disabled = true;
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(newPw, cur, null);
        // Page reloads on success; clear sensitive fields just in case.
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to change password");
        adminSave2Btn.disabled = false;
      }
    });
   }

   // --- admin "remove" (disable auth): current password + confirm ---
   // The button toggles the removal form. The confirm button sends
   // admin_password:"" + admin_current_password to clear the admin
   // hash (and the viewer hash, since auth is being disabled).
   if (adminRemoveBtn) {
     adminRemoveBtn.addEventListener("click", () => {
       if (adminRemoveBlock) adminRemoveBlock.hidden = false;
       if (adminRemoveCurrentEl) { adminRemoveCurrentEl.disabled = false; adminRemoveCurrentEl.value = ""; adminRemoveCurrentEl.focus(); }
       refreshAdminRemoveEnabled();
     });
   }
   if (adminRemoveCurrentEl) {
     adminRemoveCurrentEl.addEventListener("input", refreshAdminRemoveEnabled);
     adminRemoveCurrentEl.addEventListener("keydown", (e) => {
       if (e.key === "Enter" && !adminRemoveConfirmBtn.disabled) {
         e.preventDefault();
         adminRemoveConfirmBtn.click();
       }
     });
   }
   if (adminRemoveConfirmBtn) {
     adminRemoveConfirmBtn.addEventListener("click", async () => {
       const cur = adminRemoveCurrentEl.value;
       if (!cur) {
         setAuthError("Current admin password is required to disable auth");
         return;
       }
       const ok = window.confirm(
         "Disable auth?\n\n" +
         "This removes the admin password and turns off the password gate.\n" +
         "Anyone with the URL will be able to read and edit the notebook.\n" +
         "The viewer password is also removed.\n\n" +
         "Are you sure?"
       );
       if (!ok) return;
       adminRemoveConfirmBtn.disabled = true;
       setAuthError("");
       try {
         await NB.api.saveAuthPasswords("", cur, null);
         window.location.reload();
       } catch (e) {
         setAuthError(e.message || "Failed to disable auth");
         adminRemoveConfirmBtn.disabled = false;
       }
     });
   }

   // --- viewer password: new + confirm ---
  if (viewerPwEl) {
    viewerPwEl.addEventListener("input", refreshViewerSaveEnabled);
    viewerPwEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !viewerSaveBtn.disabled) {
        e.preventDefault();
        viewerSaveBtn.click();
      }
    });
  }
  if (viewerConfirmEl) {
    viewerConfirmEl.addEventListener("input", refreshViewerSaveEnabled);
    viewerConfirmEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !viewerSaveBtn.disabled) {
        e.preventDefault();
        viewerSaveBtn.click();
      }
    });
  }
  if (viewerSaveBtn) {
    viewerSaveBtn.addEventListener("click", async () => {
      const newPw = viewerPwEl.value;
      if (!newPw || newPw !== viewerConfirmEl.value) {
        setAuthError("Viewer password and confirmation must match");
        return;
      }
      viewerSaveBtn.disabled = true;
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(null, null, newPw);
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to save");
        viewerSaveBtn.disabled = false;
      }
    });
  }
  // Viewer toggle:
  //   unchecked -> checked: reveal the viewer fields (new + confirm)
  //     so the user can type a new password. The toggle is a UI
  //     reveal only; we do NOT save on toggle. The user still has to
  //     type and click Save. (Toggling on with no password is a
  //     no-op; reads stay open. This avoids accidentally requiring a
  //     password for reads without actually setting one.)
  //   checked -> unchecked: confirm + clear the viewer password.
  if (viewerToggleEl) {
    viewerToggleEl.addEventListener("change", async () => {
      if (viewerToggleEl.checked) {
        if (viewerPwEl) viewerPwEl.value = "";
        if (viewerConfirmEl) viewerConfirmEl.value = "";
        refreshViewerSaveEnabled();
        if (viewerPwEl) viewerPwEl.focus();
        return;
      }
      // Uncheck path: clear the viewer password, but only if one is set.
      if (!authState || !authState.hasViewer) {
        await refreshAuthState();
        return;
      }
      const ok = window.confirm(
        "Remove the viewer password?\n\n" +
        "Reads will no longer require a password. " +
        "Anyone with the URL will be able to read the notebook. " +
        "Writes still require the admin password.");
      if (!ok) {
        viewerToggleEl.checked = true;
        return;
      }
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(null, null, "");
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to clear viewer password");
        viewerToggleEl.checked = true;
      }
    });
  }

  /* --- API tokens section --------------------------------------------- */
  // Named bearer credentials for agents/scripts. Admin-only, same gate
  // as the passwords section (isAdmin()). The list is fetched fresh on
  // every modal open; the create response is the only time the server
  // returns the full token, so the issued box is the user's one chance
  // to copy it. Revoking asks for confirmation and re-renders.
  const tokensHelpEl        = document.getElementById("settings-tokens-help");
  const tokensCountEl       = document.getElementById("settings-tokens-count");
  const tokensListEl        = document.getElementById("settings-tokens-list");
  const tokensNameEl        = document.getElementById("settings-tokens-name");
  const tokensRoleEl        = document.getElementById("settings-tokens-role");
  const tokensCreateBtn     = document.getElementById("settings-tokens-create");
  const tokensIssuedEl      = document.getElementById("settings-tokens-issued");
  const tokensIssuedValueEl = document.getElementById("settings-tokens-issued-value");
  const tokensErrorEl       = document.getElementById("settings-tokens-error");

  function setTokensError(msg) {
    if (!tokensErrorEl) return;
    tokensErrorEl.textContent = msg || "";
    tokensErrorEl.hidden = !msg;
  }

  function refreshTokensControls() {
    if (!tokensNameEl || !tokensRoleEl || !tokensCreateBtn) return;
    const canEdit = isAdmin();
    tokensNameEl.disabled = !canEdit;
    tokensRoleEl.disabled = !canEdit;
    // Create stays disabled until a name is typed (and the user may edit).
    tokensCreateBtn.disabled = !canEdit || tokensNameEl.value.trim().length === 0;
    if (tokensHelpEl) {
      tokensHelpEl.textContent = canEdit
        ? "Bearer tokens let agents and scripts call the API without a browser session. See the agent guide at /agent.md."
        : "Sign in as admin to manage API tokens.";
    }
  }

  function buildTokenRow(tok) {
    const row = document.createElement("div");
    row.className = "settings-row settings-token-row";
    row.dataset.name = tok.name;
    row.innerHTML =
      '<span class="settings-label"></span>' +
      '<span class="settings-token-meta">' +
        '<code class="settings-token-role"></code>' +
        '<span class="settings-token-created"></span>' +
        '<button type="button" class="settings-action settings-token-revoke">Revoke</button>' +
      '</span>';
    row.querySelector(".settings-label").textContent = tok.name;
    row.querySelector(".settings-token-role").textContent = tok.role;
    row.querySelector(".settings-token-created").textContent = tok.created
      ? new Date(tok.created * 1000).toISOString().slice(0, 10)
      : "";
    const revokeBtn = row.querySelector(".settings-token-revoke");
    revokeBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        "Revoke token \"" + tok.name + "\"?\n\n" +
        "Any agent or script using it will stop working immediately.");
      if (!ok) return;
      revokeBtn.disabled = true;
      setTokensError("");
      try {
        await NB.api.deleteAuthToken(tok.name);
        await renderTokens();
      } catch (e) {
        revokeBtn.disabled = false;
        setTokensError(e.message || "Failed to revoke token");
      }
    });
    return row;
  }

  async function renderTokens() {
    if (!tokensListEl || !tokensCountEl) return;
    setTokensError("");
    // A previously issued token must not linger into a fresh open: the
    // list refresh means we're re-entering the section.
    if (tokensIssuedEl) tokensIssuedEl.hidden = true;
    if (!isAdmin()) {
      // Non-admins (or auth-off visitors) get no listing at all: the
      // endpoint would 401/403 anyway.
      tokensCountEl.textContent = "—";
      tokensListEl.textContent = "";
      refreshTokensControls();
      return;
    }
    try {
      const data = await NB.api.listAuthTokens();
      const tokens = (data && data.tokens) || [];
      tokensCountEl.textContent = String(tokens.length);
      tokensListEl.innerHTML = "";
      for (const tok of tokens) {
        tokensListEl.appendChild(buildTokenRow(tok));
      }
    } catch (e) {
      tokensCountEl.textContent = "—";
      tokensListEl.textContent = "";
      setTokensError(e.message || "Failed to load tokens");
    }
    refreshTokensControls();
  }

  if (tokensNameEl) {
    tokensNameEl.addEventListener("input", refreshTokensControls);
    tokensNameEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !tokensCreateBtn.disabled) {
        e.preventDefault();
        tokensCreateBtn.click();
      }
    });
  }
  if (tokensCreateBtn) {
    tokensCreateBtn.addEventListener("click", async () => {
      const name = tokensNameEl.value.trim();
      const role = tokensRoleEl.value;
      if (!name) { setTokensError("Token name is required"); return; }
      tokensCreateBtn.disabled = true;
      setTokensError("");
      try {
        const resp = await NB.api.createAuthToken(name, role);
        // Show the full token exactly once.
        tokensIssuedValueEl.textContent = resp.token;
        tokensIssuedEl.hidden = false;
        tokensNameEl.value = "";
        await renderTokens();
        // renderTokens hid the issued box when re-rendering; show it
        // after so the user still sees the one-time secret.
        tokensIssuedEl.hidden = false;
      } catch (e) {
        setTokensError(e.message || "Failed to create token");
        refreshTokensControls();
      }
    });
  }

  /* --- AI providers section -------------------------------------------- */
  // OpenAI-compatible endpoint profiles for the side-panel assistant.
  // Admin-only like passwords/tokens: the endpoints + models list comes
  // from GET /api/ai/config, keys are write-only (a saved profile is
  // updated by sending a blank key + replaceSecret, which carries the
  // stored key over server-side). The whole list is replaced on save,
  // so edits remove rows from a working copy, then one POST commits.
  const aiCountEl  = document.getElementById("settings-ai-count");
  const aiListEl   = document.getElementById("settings-ai-list");
  const aiNameEl   = document.getElementById("settings-ai-name");
  const aiUrlEl    = document.getElementById("settings-ai-url");
  const aiModelEl  = document.getElementById("settings-ai-model");
  const aiKeyEl    = document.getElementById("settings-ai-key");
  const aiPromptEl = document.getElementById("settings-ai-custom-prompt");
  const aiPromptSaveBtn = document.getElementById("settings-ai-prompt-save");
  const aiPromptStatusEl = document.getElementById("settings-ai-prompt-status");
  const aiSearxngEl = document.getElementById("settings-ai-searxng");
  const aiSearxngSaveBtn = document.getElementById("settings-ai-searxng-save");
  const aiSearxngStatusEl = document.getElementById("settings-ai-searxng-status");
  const aiAddBtn   = document.getElementById("settings-ai-add");
  const aiSaveAsBtn = document.getElementById("settings-ai-saveas");
  const aiCancelBtn = document.getElementById("settings-ai-cancel");
  const aiFormTitle = document.getElementById("settings-ai-form-title");
  const aiHelpEl   = document.getElementById("settings-ai-help");
  const aiErrorEl  = document.getElementById("settings-ai-error");

  let aiProviders = [];      // working copy while the modal is open
  let aiDefaultName = "";
  // The ACP profiles, mirrored from the last GET/POST response: every stored
  // profile, in file order, each flagged `available` (the agent executable
  // is installed) and `editable` (the browser owns it). Kept OUT of
  // aiProviders -- that array is the OpenAI half of every save. Only the
  // browser-owned ones are posted back, as the "acp" list.
  let aiAcpProfiles = [];
  // True once a GET/POST response actually carried the ACP list. Until then
  // the empty array above means "unknown", not "none", and a save must omit
  // the field instead of posting an empty list (which deletes every
  // browser-owned profile).
  let aiAcpLoaded = false;
  // The server's read-only PATH probe (cfg.acpAgents): which known ACP agent
  // CLIs are installed. Only an `available` entry can be added, and the list
  // is itself never part of a save payload.
  let aiAcpAgents = [];
  // The panel hides every known agent the server reports except these three
  // and any agent actually installed on the host (a.available). The probe
  // still lists all of them; this is a display filter only.
  const CORE_ACP_AGENT_KEYS = ["opencode", "claude", "codex"];
  function isAcpAgentShown(a) {
    if (!a) return false;
    return CORE_ACP_AGENT_KEYS.indexOf(a.key) !== -1 || a.available === true;
  }
  // Server-side limits for an ACP profile (app.py ACP_MAX_NAME_LEN /
  // ACP_MAX_MODEL_LEN), mirrored so the browser refuses before the POST.
  const ACP_NAME_MAX = 60;
  const ACP_MODEL_MAX = 200;
  // Global custom prompt: snapshot at modal open + dirty flag for the
  // prompt's own Save button (independent from provider add/edit).
  let aiPromptSaved = "";
  let ai_prompt_inflight = false;
  // SearXNG instance URL (global, like the custom prompt): snapshot at
  // modal open + its own Save button.
  let aiSearxngSaved = "";
  let ai_searxng_inflight = false;
  // Edit mode: name of the provider being edited ("" = add-new form).
  let aiEditingName = "";

  function setAiError(msg) {
    if (!aiErrorEl) return;
    aiErrorEl.textContent = msg || "";
    aiErrorEl.hidden = !msg;
  }

  function refreshAiControls() {
    if (!aiNameEl || !aiAddBtn) return;
    const canEdit = isAdmin();
    [aiNameEl, aiUrlEl, aiModelEl, aiKeyEl, aiPromptEl, aiPromptSaveBtn,
     aiSearxngEl, aiSearxngSaveBtn]
      .forEach(el => { if (el) el.disabled = !canEdit; });
    aiAddBtn.disabled = !canEdit ||
      !aiNameEl.value.trim() || !aiUrlEl.value.trim();
    if (aiFormTitle) {
      aiFormTitle.textContent = aiEditingName
        ? ("Edit provider: " + aiEditingName) : "Add a provider";
    }
    if (aiAddBtn) aiAddBtn.textContent = aiEditingName ? "Save changes" : "Add provider";
    if (aiSaveAsBtn) {
      aiSaveAsBtn.hidden = !aiEditingName;
      aiSaveAsBtn.disabled = !canEdit ||
        !aiNameEl.value.trim() || !aiUrlEl.value.trim();
    }
    if (aiCancelBtn) aiCancelBtn.hidden = !aiEditingName;
    if (aiPromptSaveBtn) {
      // Prompt Save only when admin + text differs from the last snapshot.
      aiPromptSaveBtn.disabled = !canEdit ||
        (aiPromptEl && aiPromptEl.value === aiPromptSaved);
    }
    if (aiSearxngSaveBtn) {
      // Search URL Save only when admin + value differs from the snapshot.
      aiSearxngSaveBtn.disabled = !canEdit ||
        (aiSearxngEl && aiSearxngEl.value === aiSearxngSaved);
    }
    if (aiHelpEl) {
      aiHelpEl.textContent = canEdit
        ? "Providers for the AI assistant in the left activity bar (✨). Any OpenAI-compatible /v1/chat/completions endpoint works. API keys are stored server-side and never sent to the browser."
        : "Sign in as admin to configure AI providers.";
    }
  }

  function buildAiRow(s) {
    const row = document.createElement("div");
    row.className = "settings-row settings-ai-row";
    row.dataset.name = s.name;

    const label = document.createElement("span");
    label.className = "settings-label";
    label.textContent = s.name;

    const meta = document.createElement("span");
    meta.className = "settings-token-meta";

    const defaultTag = document.createElement(s.name === aiDefaultName
      ? "span" : "button");
    if (s.name === aiDefaultName) {
      // The active default is a static accent tag, not a disabled button.
      defaultTag.className = "stg-tag stg-tag--accent";
      defaultTag.textContent = "Default";
    } else {
      defaultTag.type = "button";
      defaultTag.className = "settings-action settings-ai-default";
      defaultTag.textContent = "Make default";
      defaultTag.addEventListener("click", async () => {
        aiDefaultName = s.name;
        await commitAiProviders("Default provider set to " + s.name);
      });
    }

    const model = document.createElement("code");
    model.className = "settings-token-role";
    model.textContent = s.model || s.baseUrl || "(no model)";

    const keyNote = document.createElement("span");
    keyNote.className = "settings-token-created";
    keyNote.textContent = s.hasKey ? "key stored" : "no key";

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "settings-action settings-ai-test";
    testBtn.textContent = "Test";
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      const original = testBtn.textContent;
      testBtn.textContent = "…";
      try {
        const r = await NB.api.aiProbe(s.name);
        testBtn.textContent = r.ok ? "reachable" : "unreachable";
      } catch (e) {
        testBtn.textContent = "error";
      }
      setTimeout(() => { testBtn.textContent = original; testBtn.disabled = false; },
                 2000);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "settings-action settings-ai-edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => beginAiEdit(s.name));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "settings-action settings-ai-remove";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        "Remove provider \"" + s.name + "\" from the AI settings?");
      if (!ok) return;
      if (aiEditingName === s.name) cancelAiEdit();
      aiProviders = aiProviders.filter(p => p.name !== s.name);
      if (aiDefaultName === s.name) aiDefaultName = "";
      await commitAiProviders("Provider " + s.name + " removed");
    });

    meta.append(defaultTag, model, keyNote, testBtn, editBtn, removeBtn);
    row.append(label, meta);
    return row;
  }

  /* --- Edit flow ------------------------------------------------------ */
  // Edit reuses the Add form: the row's values (including the custom
  // prompt; the key stays blank with "keep stored key" semantics) are
  // loaded in, and Save commits as an update. Renaming works: the commit
  // sends replaceSecretFor=<old name> server-side, which carries the
  // stored key over even though the name changed.
  function beginAiEdit(name) {
    const p = aiProviders.find(x => x.name === name);
    if (!p) return;
    aiEditingName = name;
    aiNameEl.value = p.name;
    aiUrlEl.value = p.baseUrl || "";
    document.getElementById("settings-ai-model").value = p.model || "";
    aiKeyEl.value = "";
    aiKeyEl.placeholder = "Stored — leave blank to keep";
    // The global prompt is NOT part of the provider form: it stays as-is
    // in its own control (settings-ai-custom-prompt) while editing.
    if (aiListEl) aiListEl.classList.add("ai-editing");
    Array.from(aiListEl ? aiListEl.children : [])
      .forEach(row => row.classList.toggle("editing",
        row.dataset.name === name));
    refreshAiControls();
    if (aiNameEl) aiNameEl.focus();
  }

  function cancelAiEdit() {
    aiEditingName = "";
    aiNameEl.value = "";
    aiUrlEl.value = "";
    aiKeyEl.value = "";
    aiKeyEl.placeholder = "Empty = keep stored key (when editing)";
    if (aiListEl) {
      aiListEl.classList.remove("ai-editing");
      Array.from(aiListEl.children).forEach(row =>
        row.classList.remove("editing"));
    }
    refreshAiControls();
  }

  async function commitAiProviders(okMsg) {
    setAiError("");
    try {
      // When editing existing rows over the wire, carry stored keys: a row
      // we didn't touch keeps hasKey via replaceSecret + blank apiKey.
      // A renamed profile carries its key via replaceSecretFor=<old name>.
      // The GLOBAL prompt rides along (server preserves it when the
      // payload omits it, but we always send the current snapshot so a
      // prompt save + provider save can't clobber each other mid-flight).
      const payload = aiProviders.map(p => ({
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model || "",
        apiKey: p.apiKey || "",
        replaceSecret: p.hasKey === true,
        replaceSecretFor: p.replaceSecretFor || undefined,
      }));
      const cfg = await NB.api.aiSaveConfig(
        payload, aiDefaultName, aiPromptEl ? aiPromptEl.value : undefined,
        undefined, aiAcpPayload());
      aiProviders = (cfg && cfg.servers) || [];
      aiDefaultName = (cfg && cfg.default) || "";
      aiAcpProfiles = (cfg && cfg.acps) ||
        (cfg && cfg.acp ? [cfg.acp] : []);
      aiAcpLoaded = true;
      aiAcpAgents = (cfg && cfg.acpAgents) || [];
      if (cfg && typeof cfg.customPrompt === "string") {
        aiPromptSaved = cfg.customPrompt;
        if (aiPromptEl) aiPromptEl.value = aiPromptSaved;
      }
      renderAiList();
      refreshAiControls();
      if (okMsg) setAiError("");   // okMsg path shows nothing (no error UI)
      NB.ai && NB.ai.loadAiConfig && NB.ai.loadAiConfig();
      return true;
    } catch (e) {
      setAiError(e.message || "Failed to save AI providers");
      return false;
    }
  }

  /* Save ONLY the global prompt: one POST with the stored provider list
   * (keys ride server-side) + the new prompt text. Independent from the
   * provider form so editing a URL never touches the prompt and vice
   * versa. */
  async function saveAiPrompt() {
    if (ai_prompt_inflight || !aiPromptEl) return;
    ai_prompt_inflight = true;
    if (aiPromptSaveBtn) { aiPromptSaveBtn.disabled = true; aiPromptSaveBtn.textContent = "Saving…"; }
    try {
      const payload = aiProviders.map(p => ({
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model || "",
        apiKey: p.apiKey || "",
        replaceSecret: p.hasKey === true,
      }));
      const cfg = await NB.api.aiSaveConfig(
        payload, aiDefaultName, aiPromptEl.value, undefined,
        aiAcpPayload());
      aiPromptSaved = (cfg && cfg.customPrompt) || aiPromptEl.value;
      if (aiPromptStatusEl) {
        aiPromptStatusEl.textContent = "Saved";
        aiPromptStatusEl.hidden = false;
        setTimeout(() => { aiPromptStatusEl.hidden = true; }, 2000);
      }
      NB.ai && NB.ai.loadAiConfig && NB.ai.loadAiConfig();
    } catch (e) {
      // The panel-wide error area carries a refusal the status line is too
      // small for, e.g. the server's loopback_required message.
      setAiError(e.message || "Failed to save the assistant instructions");
      if (aiPromptStatusEl) {
        aiPromptStatusEl.textContent = e.message || "Save failed";
        aiPromptStatusEl.hidden = false;
      }
    } finally {
      ai_prompt_inflight = false;
      if (aiPromptSaveBtn) aiPromptSaveBtn.textContent = "Save prompt";
      refreshAiControls();
    }
  }

  /* Save ONLY the SearXNG instance URL: one POST with the stored provider
   * list (keys ride server-side) + the new URL. Independent from the
   * provider form and the custom prompt. */
  async function saveAiSearxng() {
    if (ai_searxng_inflight || !aiSearxngEl) return;
    ai_searxng_inflight = true;
    if (aiSearxngSaveBtn) { aiSearxngSaveBtn.disabled = true; aiSearxngSaveBtn.textContent = "Saving…"; }
    try {
      const payload = aiProviders.map(p => ({
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.model || "",
        apiKey: p.apiKey || "",
        replaceSecret: p.hasKey === true,
      }));
      const cfg = await NB.api.aiSaveConfig(
        payload, aiDefaultName, aiPromptEl ? aiPromptEl.value : undefined,
        aiSearxngEl.value, aiAcpPayload());
      aiSearxngSaved = (cfg && typeof cfg.searxngUrl === "string")
        ? cfg.searxngUrl : aiSearxngEl.value;
      if (aiSearxngStatusEl) {
        aiSearxngStatusEl.textContent = "Saved";
        aiSearxngStatusEl.hidden = false;
        setTimeout(() => { aiSearxngStatusEl.hidden = true; }, 2000);
      }
    } catch (e) {
      setAiError(e.message || "Failed to save the search URL");
      if (aiSearxngStatusEl) {
        aiSearxngStatusEl.textContent = e.message || "Save failed";
        aiSearxngStatusEl.hidden = false;
      }
    } finally {
      ai_searxng_inflight = false;
      if (aiSearxngSaveBtn) aiSearxngSaveBtn.textContent = "Save search URL";
      refreshAiControls();
    }
  }

  /* ACP agent profiles: the browser owns name/agent/model of an
   * "agent"-keyed profile; a hand-written "command" profile (editable:false)
   * belongs to config/ai.json and is never posted back. Every save sends the
   * complete browser-owned list -- the server deletes a profile missing from
   * it, preserving the hand-owned ones regardless. */

  function buildAcpPanelHead() {
    const head = document.createElement("div");
    head.className = "settings-ai-acp-head";

    const title = document.createElement("span");
    title.className = "settings-ai-acp-title";
    title.textContent = "ACP agents";

    head.append(title);
    return head;
  }

  /* The model the browser may post for one profile. The server fills the
   * display label ("ACP") in when no model is stored; posting that back
   * would turn it into a real model id, so hasModel decides. */
  function acpModelOf(p) {
    return p && p.hasModel && typeof p.model === "string" ? p.model : "";
  }

  /* True when the browser may post this profile: an agent-keyed profile the
   * server marks editable. A profile whose agent key the server no longer
   * recognises has no valid key to send, so it is left out too. */
  function acpBrowserOwned(p) {
    return !!p && !!p.name && p.editable !== false && !!p.agent;
  }

  /* The "acp" half of every config POST: name/agent/model of each
   * browser-owned profile, in list order. No per-profile `default` -- the
   * top-level default names the active provider. */
  function aiAcpPayload() {
    if (!aiAcpLoaded) return undefined;
    return aiAcpProfiles.filter(acpBrowserOwned).map(p => ({
      name: p.name,
      agent: p.agent,
      model: acpModelOf(p),
    }));
  }

  /* Commit a working-copy change to the ACP list; on failure put the list
   * (and the default, when the change touched it) back and re-render, so the
   * panel never shows a state the server refused. */
  async function commitAiAcp(okMsg, restore) {
    const ok = await commitAiProviders(okMsg);
    if (!ok && restore) {
      restore();
      renderAiList();
    }
    return ok;
  }

  /* One row per shown ACP agent: name, a dot + word state, the allowlist
   * key, and (adapter-missing only) the server's fix hint. `available`
   * means the executable was found on the server's PATH; `adapterMissing`
   * means the wrapping CLI is installed but its ACP adapter binary is not,
   * so the agent cannot run yet. Only the three core agents and any agent
   * actually installed are listed (isAcpAgentShown); the rest of the probe
   * is hidden as noise. Absent/empty fields are skipped. */
  function buildAcpAgentLines(agents) {
    const box = document.createElement("div");
    box.className = "settings-ai-acp-agents";
    for (const a of agents) {
      if (!isAcpAgentShown(a)) continue;
      const label = (a && (a.label || a.key)) || "";
      if (!label) continue;
      const line = document.createElement("div");
      line.className = "settings-ai-acp-agent";
      line.dataset.acpKey = (a && a.key) || "";

      const nameEl = document.createElement("span");
      nameEl.className = "settings-ai-acp-agent-name";
      nameEl.textContent = label;

      const statusEl = document.createElement("span");
      statusEl.className = "settings-ai-acp-agent-status stg-status";
      if (a.available) {
        statusEl.classList.add("stg-status--ok");
        statusEl.textContent = "Installed";
        line.dataset.state = "installed";
      } else if (a.adapterMissing) {
        statusEl.classList.add("stg-status--warn");
        statusEl.textContent = "Adapter missing";
        line.dataset.state = "adapter-missing";
      } else {
        statusEl.textContent = "Not installed";
        line.dataset.state = "not-installed";
      }

      line.append(nameEl, statusEl);

      const keyEl = document.createElement("code");
      keyEl.className = "settings-ai-acp-key";
      keyEl.textContent = (a && a.key) || "";
      line.appendChild(keyEl);

      if (a.adapterMissing && a.hint) {
        const hint = document.createElement("span");
        hint.className = "settings-ai-acp-hint";
        hint.textContent = a.hint;
        line.appendChild(hint);
      }

      // An agent any configured profile selects gets an accent rail.
      if (aiAcpProfiles.some(p => p && p.agent && p.agent === a.key)) {
        line.dataset.selected = "true";
      }
      box.appendChild(line);
    }
    return box;
  }

  /* One ACP profile row: name on the left; on the right the Default tag or
   * a "Make default" action, the agent model as an inline field, a status
   * tag when the agent is not installed or the profile is server-local, and
   * Remove for a browser-owned profile. Uses .settings-ai-acp-profile, not
   * .settings-ai-row, so it is never counted as an OpenAI provider row.
   * `default` is the resolved top-level default, so "Make default" sets that
   * name and never writes a per-profile flag. */
  function buildAiAcpProfile(profile) {
    const row = document.createElement("div");
    row.className = "settings-row settings-ai-acp-profile";
    row.dataset.acpName = profile.name;
    row.dataset.acpAgent = profile.agent || "";

    const label = document.createElement("span");
    label.className = "settings-label";
    label.textContent = profile.name;

    const meta = document.createElement("span");
    meta.className = "settings-token-meta";

    if (profile.default) {
      // The active default is a static accent tag, not a disabled button.
      const defTag = document.createElement("span");
      defTag.className = "stg-tag stg-tag--accent";
      defTag.textContent = "Default";
      meta.appendChild(defTag);
    } else {
      const defBtn = document.createElement("button");
      defBtn.type = "button";
      defBtn.className = "settings-action settings-ai-default";
      defBtn.textContent = "Make default";
      defBtn.addEventListener("click", async () => {
        const prevDefault = aiDefaultName;
        aiDefaultName = profile.name;
        await commitAiAcp("Default provider set to " + profile.name, () => {
          aiDefaultName = prevDefault;
        });
      });
      meta.appendChild(defBtn);
    }

    // The model is the only field the browser edits inline: a change
    // commits the whole list, exactly like a provider row's Edit form.
    const model = document.createElement("input");
    model.type = "text";
    model.className = "auth-input settings-ai-acp-model";
    model.maxLength = ACP_MODEL_MAX;
    model.autocomplete = "off";
    model.value = acpModelOf(profile);
    model.placeholder = profile.hasModel ? "model" : (profile.model || "ACP");
    model.setAttribute("aria-label", "Model for " + profile.name);
    // A server-local profile's fields belong to config/ai.json; the input
    // only reports the stored model. readOnly (not disabled) keeps the value
    // readable, selectable and in the tab order.
    model.readOnly = profile.editable === false;
    model.disabled = !isAdmin();
    model.addEventListener("change", async () => {
      const next = model.value.trim();
      if (next === acpModelOf(profile)) return;
      const snapshot = aiAcpProfiles.map(p => Object.assign({}, p));
      const idx = aiAcpProfiles.findIndex(p => p && p.name === profile.name);
      if (idx === -1) return;
      aiAcpProfiles[idx] = Object.assign({}, aiAcpProfiles[idx],
        { model: next, hasModel: next.length > 0 });
      await commitAiAcp("", () => {
        aiAcpProfiles = snapshot;
      });
    });
    meta.appendChild(model);

    if (profile.available === false) {
      const tag = document.createElement("span");
      tag.className = "stg-tag stg-tag--danger settings-ai-acp-tag";
      tag.dataset.state = "unavailable";
      tag.textContent = "not installed";
      meta.appendChild(tag);
    }
    if (profile.editable === false) {
      const tag = document.createElement("span");
      tag.className = "stg-tag settings-ai-acp-tag";
      tag.dataset.state = "server-local";
      tag.textContent = "server-local";
      meta.appendChild(tag);
    }

    if (profile.editable !== false) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "settings-action settings-ai-remove settings-ai-acp-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        const ok = window.confirm(
          "Remove agent profile \"" + profile.name + "\"?");
        if (!ok) return;
        const prevDefault = aiDefaultName;
        const snapshot = aiAcpProfiles.slice();
        aiAcpProfiles = aiAcpProfiles.filter(
          p => !p || p.name !== profile.name);
        if (aiDefaultName === profile.name) aiDefaultName = "";
        await commitAiAcp("Agent profile " + profile.name + " removed", () => {
          aiAcpProfiles = snapshot;
          aiDefaultName = prevDefault;
        });
      });
      meta.appendChild(removeBtn);
    }

    row.append(label, meta);
    return row;
  }

  /* The add form: a select of the agents the server can launch right now,
   * a profile name defaulted from the agent label, and the add button. An
   * agent a profile already names is not offered again. */
  function buildAcpAddForm() {
    const box = document.createElement("div");
    box.className = "settings-ai-acp-add";

    const title = document.createElement("div");
    title.className = "settings-form-title";
    title.textContent = "Add agent";

    const agentRow = document.createElement("div");
    agentRow.className = "settings-row";
    const selectId = "settings-ai-acp-agent-select";
    const agentLabel = document.createElement("label");
    agentLabel.className = "settings-label";
    agentLabel.htmlFor = selectId;
    agentLabel.textContent = "Agent";
    const select = document.createElement("select");
    select.id = selectId;
    select.className = "auth-input settings-ai-acp-agent-select";
    const used = new Set(aiAcpProfiles
      .filter(p => p && p.agent).map(p => p.agent));
    for (const a of aiAcpAgents) {
      if (!a || a.available !== true || used.has(a.key)) continue;
      const opt = document.createElement("option");
      opt.value = a.key;
      opt.textContent = a.label || a.key;
      select.appendChild(opt);
    }
    agentRow.append(agentLabel, select);

    const nameRow = document.createElement("div");
    nameRow.className = "settings-row";
    const nameId = "settings-ai-acp-profile-name";
    const nameLabel = document.createElement("label");
    nameLabel.className = "settings-label";
    nameLabel.htmlFor = nameId;
    nameLabel.textContent = "Profile name";
    const nameInput = document.createElement("input");
    nameInput.id = nameId;
    nameInput.type = "text";
    nameInput.className = "auth-input settings-ai-acp-name";
    nameInput.maxLength = ACP_NAME_MAX;
    nameInput.autocomplete = "off";
    nameInput.placeholder = "e.g. opencode-local";
    nameRow.append(nameLabel, nameInput);

    const actions = document.createElement("div");
    actions.className = "settings-form-actions";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "settings-action settings-action--primary settings-ai-acp-add-btn";
    addBtn.textContent = "Add agent";
    actions.appendChild(addBtn);

    const labelOf = (key) => {
      const a = aiAcpAgents.find(x => x && x.key === key);
      return (a && (a.label || a.key)) || key;
    };
    // The name follows the chosen agent until the user types their own.
    let nameIsAuto = true;
    nameInput.addEventListener("input", () => { nameIsAuto = false; });
    select.addEventListener("change", () => {
      if (nameIsAuto) nameInput.value = labelOf(select.value);
      refreshAcpAddControls();
    });

    function refreshAcpAddControls() {
      const canEdit = isAdmin();
      select.disabled = !canEdit;
      nameInput.disabled = !canEdit;
      addBtn.disabled = !canEdit || !select.value ||
        !nameInput.value.trim();
    }
    nameInput.addEventListener("input", refreshAcpAddControls);
    if (nameIsAuto && select.value) nameInput.value = labelOf(select.value);
    refreshAcpAddControls();

    addBtn.addEventListener("click", async () => {
      const key = select.value;
      const name = nameInput.value.trim();
      if (!key) return;
      if (!name) { setAiError("A profile name is required"); return; }
      if (aiProviders.some(p => p.name === name) ||
          aiAcpProfiles.some(p => p && p.name === name)) {
        setAiError("A provider named \"" + name + "\" already exists");
        return;
      }
      const snapshot = aiAcpProfiles.slice();
      aiAcpProfiles = aiAcpProfiles.concat([{
        name, agent: key, model: "", hasModel: false,
        available: true, editable: true,
      }]);
      addBtn.disabled = true;
      const ok = await commitAiAcp("", () => {
        aiAcpProfiles = snapshot;
      });
      // A successful commit re-renders the whole list (which drops this
      // form along with the agent it offered).
      if (!ok) {
        addBtn.disabled = false;
        refreshAcpAddControls();
      }
    });

    box.append(title, agentRow, nameRow, actions);
    return box;
  }

  /* ACP panel: head + help, one row per stored profile, the add form while
   * an unclaimed launchable agent remains, and the read-only detected-agent
   * status list. Rendered from aiAcpProfiles, never pushed into
   * aiProviders: a provider save carries the two lists separately. */
  function buildAiAcpSection(profiles, agents) {
    const row = document.createElement("div");
    row.className = "settings-ai-acp-row";

    row.appendChild(buildAcpPanelHead());

    const help = document.createElement("p");
    help.className = "settings-help";
    help.append(document.createTextNode(
      "Local coding agents the assistant can drive over the Agent Client " +
      "Protocol. A profile whose agent is not installed cannot be picked " +
      "until it is installed on the server. A hand-written profile with its " +
      "own \"command\" is edited in "));
    const cfgCode = document.createElement("code");
    cfgCode.textContent = "config/ai.json";
    help.append(cfgCode, document.createTextNode(" on the server, not here."));
    row.appendChild(help);

    for (const profile of profiles) row.appendChild(buildAiAcpProfile(profile));

    // The add form only offers a launchable agent no profile has claimed.
    const used = new Set(profiles
      .filter(p => p.agent).map(p => p.agent));
    if ((agents || []).some(a => a && a.available === true && !used.has(a.key))) {
      row.appendChild(buildAcpAddForm());
    }

    // "Detected agents" is only shown when at least one line actually
    // renders (an entry with no label/key is skipped): no orphan heading.
    const lines = buildAcpAgentLines(agents || []);
    if (lines.childElementCount) {
      const sub = document.createElement("span");
      sub.className = "settings-ai-acp-title";
      sub.textContent = "Detected agents";
      row.append(sub, lines);
    }
    return row;
  }

  function renderAiList() {
    if (!aiListEl || !aiCountEl) return;
    aiCountEl.textContent = String(aiProviders.length);
    aiListEl.innerHTML = "";
    for (const p of aiProviders) aiListEl.appendChild(buildAiRow(p));
    const profiles = aiAcpProfiles.filter(p => p && p.name);
    // With no profile the panel still explains itself when the server can
    // launch an agent (the add form) or has something to report about the
    // probe. With nothing detected and nothing stored it stays silent.
    if (profiles.length || aiAcpAgents.some(
        a => isAcpAgentShown(a) && (a.available || a.adapterMissing))) {
      aiListEl.appendChild(buildAiAcpSection(profiles, aiAcpAgents));
    }
  }

  async function renderAiProviders() {
    if (!aiListEl || !aiCountEl) return;
    setAiError("");
    if (!isAdmin()) {
      aiCountEl.textContent = "—";
      aiListEl.textContent = "";
      aiAcpProfiles = [];
      aiAcpLoaded = false;
      aiAcpAgents = [];
      refreshAiControls();
      return;
    }
    try {
      const cfg = await NB.api.aiGetConfig();
      aiProviders = (cfg && cfg.servers) || [];
      aiDefaultName = (cfg && cfg.default) || "";
      aiAcpProfiles = (cfg && cfg.acps) ||
        (cfg && cfg.acp ? [cfg.acp] : []);
      aiAcpLoaded = true;
      aiAcpAgents = (cfg && cfg.acpAgents) || [];
      aiPromptSaved = (cfg && cfg.customPrompt) || "";
      if (aiPromptEl) aiPromptEl.value = aiPromptSaved;
      aiSearxngSaved = (cfg && typeof cfg.searxngUrl === "string")
        ? cfg.searxngUrl : "";
      if (aiSearxngEl) aiSearxngEl.value = aiSearxngSaved;
      renderAiList();
    } catch (e) {
      aiCountEl.textContent = "—";
      aiListEl.textContent = "";
      // The stored list is unknown now: whatever is in memory may be stale,
      // so a save must omit the ACP field rather than post a list that would
      // delete a profile added elsewhere.
      aiAcpLoaded = false;
      setAiError(e.message || "Failed to load AI providers");
    }
    refreshAiControls();
  }

  let ai_add_inflight = false;
  if (aiNameEl) {
    aiNameEl.addEventListener("input", refreshAiControls);
    aiUrlEl && aiUrlEl.addEventListener("input", refreshAiControls);
    aiNameEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !aiAddBtn.disabled) {
        e.preventDefault();
        aiAddBtn.click();
      }
    });
  }
  if (aiCancelBtn) {
    aiCancelBtn.addEventListener("click", cancelAiEdit);
  }
  // "Save as new": duplicate the current form values into a brand-new
  // provider (only shown while editing). The original row is left
  // untouched; the new row carries the key only if one was typed.
  if (aiSaveAsBtn) {
    aiSaveAsBtn.addEventListener("click", async () => {
      if (ai_add_inflight) return;
      const name = aiNameEl.value.trim();
      const baseUrl = aiUrlEl.value.trim();
      const model = document.getElementById("settings-ai-model").value.trim();
      const apiKey = aiKeyEl.value;
      if (!name || !baseUrl) return;
      if (aiProviders.some(p => p.name === name)) {
        setAiError("A provider named \"" + name + "\" already exists");
        return;
      }
      ai_add_inflight = true;
      aiSaveAsBtn.disabled = true;
      aiProviders.push({
        name, baseUrl, model, apiKey,
        hasKey: apiKey.length > 0,
      });
      if (!aiDefaultName) aiDefaultName = name;
      const ok = await commitAiProviders();
      if (ok) {
        cancelAiEdit();
      } else {
        aiProviders = aiProviders.filter(p => p.name !== name);
        renderAiList();
      }
      ai_add_inflight = false;
      refreshAiControls();
    });
  }
  // Global prompt: its own Save button + dirty tracking (independent of
  // the provider form). Ctrl/Cmd+Enter saves from the textarea.
  if (aiPromptEl) {
    aiPromptEl.addEventListener("input", refreshAiControls);
    aiPromptEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (aiPromptSaveBtn && !aiPromptSaveBtn.disabled) saveAiPrompt();
      }
    });
  }
  if (aiPromptSaveBtn) {
    aiPromptSaveBtn.addEventListener("click", saveAiPrompt);
  }
  if (aiSearxngEl) {
    aiSearxngEl.addEventListener("input", refreshAiControls);
    aiSearxngEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (aiSearxngSaveBtn && !aiSearxngSaveBtn.disabled) saveAiSearxng();
      }
    });
  }
  if (aiSearxngSaveBtn) {
    aiSearxngSaveBtn.addEventListener("click", saveAiSearxng);
  }
  if (aiAddBtn) {
    aiAddBtn.addEventListener("click", async () => {
      if (ai_add_inflight) return;
      const baseUrl = aiUrlEl.value.trim();
      const model = document.getElementById("settings-ai-model").value.trim();
      const apiKey = aiKeyEl.value;
      if (aiEditingName) {
        // ---- EDIT existing provider (name/url/model/key only; the
        // global prompt is a separate control) ----
        const oldName = aiEditingName;
        const newName = aiNameEl.value.trim();
        if (!newName || !baseUrl) return;
        if (newName !== oldName &&
            aiProviders.some(p => p.name === newName)) {
          setAiError("A provider named \"" + newName + "\" already exists");
          return;
        }
        ai_add_inflight = true;
        aiAddBtn.disabled = true;
        const idx = aiProviders.findIndex(p => p.name === oldName);
        const updated = {
          name: newName, baseUrl, model,
          apiKey,                       // blank => keep stored key
          hasKey: (aiProviders[idx] && aiProviders[idx].hasKey) ||
                  apiKey.length > 0,
          // Rename: tell the server which stored profile the blank key
          // should carry over from.
          replaceSecretFor: newName !== oldName ? oldName : undefined,
        };
        aiProviders.splice(idx, 1, updated);
        if (aiDefaultName === oldName) aiDefaultName = newName;
        const ok = await commitAiProviders();
        ai_add_inflight = false;
        if (ok) {
          cancelAiEdit();
        } else {
          // Roll back the optimistic splice on failure.
          aiProviders.splice(idx, 1,
            aiProviders[idx] && oldName !== newName
              ? { name: oldName } : updated);
          const snap = aiProviders.find(p => p.name === newName || p.name === oldName);
          if (snap) delete snap.replaceSecretFor;
          renderAiList();
          refreshAiControls();
        }
        return;
      }
      // ---- ADD new provider ----
      const name = aiNameEl.value.trim();
      if (!name || !baseUrl) return;
      if (aiProviders.some(p => p.name === name)) {
        setAiError("A provider named \"" + name + "\" already exists");
        return;
      }
      ai_add_inflight = true;
      aiAddBtn.disabled = true;
      // New rows need their key in this same payload (there is no stored
      // one to carry over -- replaceSecret must be false for them).
      aiProviders.push({
        name, baseUrl, model, apiKey,
        hasKey: apiKey.length > 0,
      });
      if (!aiDefaultName) aiDefaultName = name;
      const ok = await commitAiProviders();
      if (ok) {
        aiNameEl.value = "";
        document.getElementById("settings-ai-url").value = "";
        aiKeyEl.value = "";
        setAiError("");
      } else {
        // Roll the optimistic row back so the list matches the server.
        aiProviders = aiProviders.filter(p => p.name !== name);
        renderAiList();
      }
      ai_add_inflight = false;
      refreshAiControls();
    });
  }
  // Global prompt textarea: keep the Save button state live.
  if (aiPromptEl) {
    aiPromptEl.addEventListener("input", refreshAiControls);
    aiPromptEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (aiPromptSaveBtn && !aiPromptSaveBtn.disabled) saveAiPrompt();
      }
    });
  }

  /* Allow other modules to refresh the modal (e.g. when the watcher state
   * changes while the modal is already open). */
  function onOpen(fn) { onOpenListeners.push(fn); }

  NB.settings = { open, close, isOpen, refreshWatchStatus, onOpen };
})();