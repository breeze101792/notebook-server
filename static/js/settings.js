/* settings.js -- the settings modal. Opened by the ⚙ button in the top
 * bar; closed by the × button, the Esc key, or clicking the dim overlay.
 *
 * State is read from / written to the rest of the app via small hooks on
 * NB.app and NB.watcher. We never reach into their internals.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const overlayEl = document.getElementById("settings-overlay");
  const modalEl   = overlayEl.querySelector(".settings-modal");
  const closeBtn  = document.getElementById("settings-close");
  const applyBtn  = document.getElementById("settings-apply");
  const saveBtn   = document.getElementById("settings-save");
  const cancelBtn = document.getElementById("settings-cancel");
  const themeRadios = Array.from(overlayEl.querySelectorAll('input[name="theme"]'));
  const fontSizeRadios = Array.from(overlayEl.querySelectorAll('input[name="fontSize"]'));
  const watchStatusEl = document.getElementById("settings-watch-status");
  const watchToggleBtn = document.getElementById("settings-watch-toggle");
  const dataDirEl   = document.getElementById("settings-data-dir");
  const configDirEl = document.getElementById("settings-config-dir");

  // Passwords section handles
  const authHelpEl       = document.getElementById("settings-auth-help");
  const adminPwEl        = document.getElementById("settings-auth-admin-pw");
  const adminStatusEl    = document.getElementById("settings-auth-admin-status");
  const adminSaveBtn     = document.getElementById("settings-auth-admin-save");
  const viewerToggleEl   = document.getElementById("settings-auth-viewer-toggle");
  const viewerRowEl      = document.getElementById("settings-auth-viewer-row");
  const viewerActionsEl  = document.getElementById("settings-auth-viewer-actions");
  const viewerPwEl       = document.getElementById("settings-auth-viewer-pw");
  const viewerStatusEl   = document.getElementById("settings-auth-viewer-status");
  const viewerSaveBtn    = document.getElementById("settings-auth-viewer-save");
  const viewerRemoveBtn  = document.getElementById("settings-auth-viewer-remove");
  const authErrorEl      = document.getElementById("settings-auth-error");

  let infoLoaded = false;
  let onOpenListeners = [];

  /* --- draft-then-commit lifecycle ----------------------------------
   * The modal holds a `draft` of pending changes for the three
   * "live" settings (theme, fontSize, watchEnabled). Editing the
   * radios or the watch toggle only mutates the draft; the live
   * state (cfg / DOM / watcher) is only updated when the user
   * clicks Apply or Save. Cancel reverts the draft and the live
   * state. The × button (and Esc / backdrop) act as Cancel if the
   * draft is dirty, otherwise they just close.
   *
   * The Passwords section is deliberately not part of this flow:
   * it owns its own per-section Save/Remove buttons that reload
   * the page on success, so we don't have to coordinate the
   * reload with the modal's draft state. */
  let draft = null;       // { theme, fontSize, watchEnabled } when modal open
  let original = null;    // snapshot at open() time, used by Cancel/Apply

  function isDirty() {
    if (!draft || !original) return false;
    return draft.theme !== original.theme
        || draft.fontSize !== original.fontSize
        || draft.watchEnabled !== original.watchEnabled;
  }

  function refreshFooter() {
    // Buttons stay enabled the entire time the modal is open. Apply/Save
    // are no-ops when the draft is clean, and Cancel just closes. Visually
    // we don't grey them out — the user always has an exit.
  }

  function renderWatchToggle() {
    if (!watchToggleBtn) return;
    if (!draft || !original) return;  // modal closed; nothing to render
    // Show the *pending* state when the user has flipped the toggle but
    // hasn't applied it yet; show the live state otherwise.
    const pending = draft.watchEnabled;
    const target = pending ? "Disable" : "Enable";
    watchToggleBtn.textContent = target;
  }

  function open() {
    // Sync the modal to live state every time it opens (so the user sees
    // the current theme, watch status, and dir info even if they change
    // elsewhere). The radios and watch toggle show the live values; the
    // user can then draft a change and click Apply/Save to commit.
    const cfg = NB.app.getCfg();
    const liveWatch = (NB.watcher && NB.watcher.isActive()) || false;
    original = {
      theme: cfg.theme || "auto",
      fontSize: (NB.app.getFontSize && NB.app.getFontSize()) || "medium",
      watchEnabled: liveWatch,
    };
    draft = { ...original };
    themeRadios.forEach(r => { r.checked = (r.value === draft.theme); });
    fontSizeRadios.forEach(r => { r.checked = (r.value === draft.fontSize); });
    refreshWatchStatus();
    renderWatchToggle();
    refreshFooter();
    refreshAuthState();
    if (!infoLoaded) loadInfo();
    overlayEl.hidden = false;
    onOpenListeners.forEach(fn => { try { fn(); } catch (e) {} });
  }

  function close() {
    // Header × button: dynamic. If there are pending changes, treat it
    // as Cancel (revert + close). Otherwise just dismiss.
    if (isDirty()) return cancel();
    overlayEl.hidden = true;
    draft = null;
    original = null;
  }

  function isOpen() { return !overlayEl.hidden; }

  /* Apply the current draft to live state + persist. Updates `original`
   * to the post-apply state so a subsequent close() / Cancel is a no-op
   * (the draft equals the live state). Watcher `enable()` is async and
   * may surface a directory picker the user can cancel -- in that case
   * the actual state stays off, and we re-snapshot to reflect reality. */
  async function applyDraft() {
    if (!draft || !original) return;
    // Theme
    if (draft.theme !== original.theme) {
      NB.app.setTheme(draft.theme);
    }
    // Font size
    if (draft.fontSize !== original.fontSize) {
      NB.app.setFontSize(draft.fontSize);
    }
    // Watch
    if (draft.watchEnabled !== original.watchEnabled) {
      try {
        if (draft.watchEnabled) await NB.watcher.enable();
        else NB.watcher.disable();
      } catch (e) { alert("File watching failed: " + e.message); }
    }
    // Re-snapshot from live state. The watch flag in particular may
    // differ from the draft if the user cancelled the directory picker.
    const liveWatch = (NB.watcher && NB.watcher.isActive()) || false;
    original = {
      theme: NB.app.getCfg().theme || "auto",
      fontSize: (NB.app.getFontSize && NB.app.getFontSize()) || "medium",
      watchEnabled: liveWatch,
    };
    draft = { ...original };
    refreshWatchStatus();
    renderWatchToggle();
    refreshFooter();
  }

  function cancel() {
    if (!draft || !original) {
      overlayEl.hidden = true;
      return;
    }
    // Revert any live state that diverged from `original`. The theme and
    // font-size are always re-applied (cheap); the watch is only touched
    // if its pending state would have changed the actual state.
    if (draft.theme !== original.theme) {
      NB.app.setTheme(original.theme);
    }
    if (draft.fontSize !== original.fontSize) {
      NB.app.setFontSize(original.fontSize);
    }
    if (draft.watchEnabled !== original.watchEnabled) {
      // The pending state never made it live, so revert means: ensure
      // the live state matches `original.watchEnabled`. (If the user
      // toggled the radio and then cancelled, the live state may still
      // be off -- the `original` snapshot is what we want to restore.)
      if (original.watchEnabled) {
        if (NB.watcher && !NB.watcher.isActive()) {
          // Best-effort re-enable; the user can cancel the picker and
          // the modal will already be closed at that point.
          try { NB.watcher.enable(); } catch (e) {}
        }
      } else {
        if (NB.watcher && NB.watcher.isActive()) NB.watcher.disable();
      }
    }
    overlayEl.hidden = true;
    draft = null;
    original = null;
  }

  async function applyAndClose() {
    await applyDraft();
    overlayEl.hidden = true;
    draft = null;
    original = null;
  }

  function refreshWatchStatus() {
    if (!NB.watcher) {
      watchStatusEl.textContent = "Unavailable";
      watchToggleBtn.textContent = "Enable";
      watchToggleBtn.disabled = true;
      return;
    }
    const active = NB.watcher.isActive();
    watchStatusEl.textContent = NB.watcher.describe();
    watchToggleBtn.textContent = active ? "Disable" : "Enable";
    watchToggleBtn.disabled = false;
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

  // theme radio -> mutate the draft. The live cfg/DOM only changes
  // when the user clicks Apply or Save.
  themeRadios.forEach(r => r.addEventListener("change", () => {
    if (!r.checked || !draft) return;
    draft.theme = r.value;
    refreshFooter();
  }));

  // font size radio -> mutate the draft. Same pattern as theme.
  fontSizeRadios.forEach(r => r.addEventListener("change", () => {
    if (!r.checked || !draft) return;
    draft.fontSize = r.value;
    refreshFooter();
  }));

  // Watch toggle: flip the draft's watchEnabled and re-render the
  // toggle's label to show the *pending* state. The actual enable/
  // disable is deferred to Apply / Save.
  watchToggleBtn.addEventListener("click", () => {
    if (!draft) return;
    draft.watchEnabled = !draft.watchEnabled;
    renderWatchToggle();
    refreshFooter();
  });

  // Footer buttons. Apply and Save both commit the draft and close the
  // modal — closing immediately is the most reliable way for the user to
  // see the result of a font-size or theme change, since the modal in
  // front of the dimmed UI makes subtle changes hard to notice. Both
  // buttons stay available so the user can pick whichever verb they
  // prefer; Cancel reverts and closes.
  if (applyBtn) applyBtn.addEventListener("click", () => { applyAndClose(); });
  if (saveBtn)  saveBtn.addEventListener("click", () => { applyAndClose(); });
  if (cancelBtn) cancelBtn.addEventListener("click", () => { cancel(); });

  // close (×) and Esc / backdrop all go through close(), which behaves
  // dynamically: Cancel if dirty, plain close otherwise.
  closeBtn.addEventListener("click", close);
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
  function refreshAuthSection() {
    if (!authHelpEl) return;
    setAuthError("");
    const canEdit = isAdmin();
    if (!authState || !authState.enabled) {
      // Auth not configured. Anyone can set the first admin password.
      authHelpEl.textContent = "Set an admin password to require a password for writing.";
      adminStatusEl.textContent = "Not set";
      adminPwEl.disabled = false;
      adminSaveBtn.disabled = !adminPwEl.value;
      viewerToggleEl.checked = false;
      viewerToggleEl.disabled = true;
      viewerRowEl.hidden = true;
      viewerActionsEl.hidden = true;
      viewerPwEl.value = "";
      viewerSaveBtn.disabled = true;
    } else {
      authHelpEl.textContent = canEdit
        ? "Change the admin password, or toggle the read-only role below."
        : "Sign in as admin to change passwords.";
      adminStatusEl.textContent = "Set (enter a new value to change)";
      adminPwEl.disabled = !canEdit;
      adminSaveBtn.disabled = !canEdit || !adminPwEl.value;
      viewerToggleEl.checked = !!authState.hasViewer;
      viewerToggleEl.disabled = !canEdit;
      // Show the viewer row whenever the toggle is on OR the user is
      // admin (admins can set a viewer even from the off state).
      viewerRowEl.hidden = !canEdit;
      viewerActionsEl.hidden = !canEdit;
      viewerStatusEl.textContent = authState.hasViewer
        ? "Set (enter a new value to change)"
        : "Not set";
      viewerSaveBtn.disabled = !viewerPwEl.value;
      viewerRemoveBtn.hidden = !authState.hasViewer;
      viewerRemoveBtn.disabled = !canEdit;
    }
  }
  async function refreshAuthState() {
    try { authState = await NB.api.getAuthStatus(); }
    catch (e) { authState = null; }
    refreshAuthSection();
  }

  // admin password input -> Save enable
  if (adminPwEl) {
    adminPwEl.addEventListener("input", () => {
      adminSaveBtn.disabled = adminPwEl.value.length === 0
        || (authState && authState.enabled && !isAdmin());
    });
  }
  if (adminSaveBtn) {
    adminSaveBtn.addEventListener("click", async () => {
      const pw = adminPwEl.value;
      if (!pw) return;
      adminSaveBtn.disabled = true;
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(pw, null);
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to save");
        adminSaveBtn.disabled = false;
      }
    });
  }
  // viewer password input -> Save enable + listen for Enter
  if (viewerPwEl) {
    viewerPwEl.addEventListener("input", () => {
      viewerSaveBtn.disabled = viewerPwEl.value.length === 0;
    });
    viewerPwEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !viewerSaveBtn.disabled) {
        e.preventDefault();
        viewerSaveBtn.click();
      }
    });
  }
  if (viewerSaveBtn) {
    viewerSaveBtn.addEventListener("click", async () => {
      const pw = viewerPwEl.value;
      if (!pw) return;
      viewerSaveBtn.disabled = true;
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(null, pw);
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to save");
        viewerSaveBtn.disabled = false;
      }
    });
  }
  // Viewer toggle:
  //   unchecked -> checked: reveal the viewer password field, let user
  //     type a new one and click Save (we don't auto-save on toggle so
  //     the user can decide the password).
  //   checked -> unchecked: confirm + clear the viewer password.
  if (viewerToggleEl) {
    viewerToggleEl.addEventListener("change", async () => {
      if (viewerToggleEl.checked) {
        // Reveal the field so the user can type a new viewer password.
        // We do NOT save yet -- the user still has to type and click
        // Save. (Toggling on with no password is a no-op; reads stay
        // open. This avoids accidentally requiring a password for
        // reads without actually setting one.)
        viewerRowEl.hidden = false;
        viewerActionsEl.hidden = false;
        viewerStatusEl.textContent = "Not set";
        viewerSaveBtn.disabled = !viewerPwEl.value;
        viewerRemoveBtn.hidden = true;
        viewerPwEl.focus();
        return;
      }
      // Uncheck path: clear the viewer password, but only if one is set.
      if (!authState || !authState.hasViewer) {
        // Nothing to clear; the UI shouldn't really have allowed this,
        // but if it does, just sync the state.
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
        await NB.api.saveAuthPasswords(null, "");
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to clear viewer password");
        viewerToggleEl.checked = true;
      }
    });
  }
  if (viewerRemoveBtn) {
    viewerRemoveBtn.addEventListener("click", async () => {
      if (!authState || !authState.hasViewer) return;
      const ok = window.confirm(
        "Remove the viewer password?\n\n" +
        "Reads will no longer require a password. " +
        "Writes still require the admin password.");
      if (!ok) return;
      setAuthError("");
      try {
        await NB.api.saveAuthPasswords(null, "");
        window.location.reload();
      } catch (e) {
        setAuthError(e.message || "Failed to clear viewer password");
      }
    });
  }

  /* Allow other modules to refresh the modal (e.g. when the watcher state
   * changes while the modal is already open). */
  function onOpen(fn) { onOpenListeners.push(fn); }

  NB.settings = { open, close, isOpen, refreshWatchStatus, onOpen };
})();