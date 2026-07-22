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
  const closeBtn  = document.getElementById("settings-close");
  const closeFooterBtn = document.getElementById("settings-close-btn");
  const navItems = Array.from(overlayEl.querySelectorAll(".settings-nav-item"));
  const sectionEls = Array.from(overlayEl.querySelectorAll(".settings-section[data-section]"));
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
  const vimToggleEl = document.getElementById("settings-vim-toggle");
  const vimrcEl     = document.getElementById("settings-vimrc");
  const vimrcSaveEl = document.getElementById("settings-vimrc-save");
  const vimrcStatus = document.getElementById("settings-vimrc-status");
  const dataDirEl   = document.getElementById("settings-data-dir");
  const configDirEl = document.getElementById("settings-config-dir");

  // Shortcuts section handles. The rows themselves are rendered into
  // #settings-shortcuts-list by renderShortcuts() (the action list
  // and defaults come from NB.shortcuts). `capturingAction` is the
  // id of the action currently in capture mode, or null.
  const shortcutsListEl  = document.getElementById("settings-shortcuts-list");
  const shortcutsResetAllBtn = document.getElementById("settings-shortcuts-reset-all");
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
    }
    for (const el of sectionEls) {
      el.hidden = (el.dataset.section !== name);
    }
  }
  for (const item of navItems) {
    item.addEventListener("click", () => showTab(item.dataset.tab));
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
    syncVimrc();
    refreshWatchStatus();
    refreshAuthState();
    renderShortcuts();
    if (!infoLoaded) loadInfo();
    overlayEl.hidden = false;
    onOpenListeners.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function close() {
    overlayEl.hidden = true;
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
    if (r.checked) NB.app.setFontSize(r.value);
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
  }

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
      const info = await fetch("/api/info").then(r => r.json());
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
    if (e.key === "Escape" && isOpen()) close();
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
    } else {
      // Admin password already configured. The change form is always
      // shown (no toggle button): admins see it directly, non-admins
      // see it disabled. Only admins may submit.
      authHelpEl.textContent = canEdit
        ? "Change the admin password, or toggle the read-only role below."
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

  /* Allow other modules to refresh the modal (e.g. when the watcher state
   * changes while the modal is already open). */
  function onOpen(fn) { onOpenListeners.push(fn); }

  NB.settings = { open, close, isOpen, refreshWatchStatus, onOpen };
})();