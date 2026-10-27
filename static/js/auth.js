/* auth.js -- password gate UI.
 *
 * On DOMContentLoaded, asks the server whether auth is enabled and whether
 * a session is already set. If enabled and there's no session, the login
 * modal is shown and the rest of the UI stays locked (visually dimmed via
 * a body class) until the user logs in.
 *
 * When the user logs in, we reload the page: the rest of the app is
 * simpler if it boots once with a known-good session than if it has to
 * react to the session appearing partway through boot.
 *
 * api.js fires "auth:required" whenever any gated request comes back 401;
 * we listen for that and pop the modal back up. /api/auth and /api/login
 * are themselves not gated, so a 401 from those would be a server bug.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  // Captured once at load: this script runs after the markup is parsed, and
  // a lazy getElementById could otherwise find a note element with the same
  // id earlier in document order.
  const overlayEl = document.getElementById("auth-overlay");
  const inputEl = document.getElementById("auth-password");
  const submitEl = document.getElementById("auth-submit");
  const errorEl = document.getElementById("auth-error");
  const logoutEl = document.getElementById("logout-btn");
  const viewerContentEl = document.getElementById("viewer-content");
  const fileTreeEl = document.getElementById("file-tree");
  const searchListEl = document.getElementById("search-list");
  const searchSummaryEl = document.getElementById("search-summary");

  // Raw /api/auth response from boot: {enabled, hasAdmin, hasViewer, role}.
  // Kept so synchronous callers (the hybrid context menu builds its items
  // without a fetch) can read the role. null until the fetch resolves.
  let authStatus = null;

  function lock()  {
    document.body.classList.add("auth-locked");
    // Wipe sensitive content from the DOM. The 401 that triggered
    // this lock means the server refused to send us the data, so we
    // must not leave a previously-loaded copy visible. This catches
    // the case where the notebook was loaded before auth was enabled
    // (or before the session expired) and the new gating kicks in
    // mid-session: the stale render goes away, and the auth modal
    // covers the now-blank panes. After login we reload the page, so
    // fresh data is fetched with a known-good session.
    clearSensitiveContent();
  }
  function unlock() { document.body.classList.remove("auth-locked"); }

  // Remove rendered notebook content, file tree, and search results.
  // The auth modal + body.auth-locked (with a CSS blur on the content
  // regions) handle the visual side; this function is the data side.
  function clearSensitiveContent() {
    try {
      // Viewer pane: the rendered markdown for the active file. Clear
      // text content and innerHTML so a previously-cached file body
      // isn't sitting in the DOM.
      if (viewerContentEl) { viewerContentEl.textContent = ""; viewerContentEl.innerHTML = ""; }
      // File tree (sidebar): the list of notes/folders.
      if (fileTreeEl) fileTreeEl.innerHTML = "";
      // Search results list.
      if (searchListEl) searchListEl.innerHTML = "";
      // Search summary text.
      if (searchSummaryEl) searchSummaryEl.textContent = "";
      // Tabs: leave the tab bar itself (the layout) but clear open
      // files by telling the tabs module to clear its state, so the
      // bar doesn't list paths the user is no longer authorized to
      // see. Best-effort -- the tabs module owns this.
      if (window.NB && NB.evt && NB.evt.emit) {
        try { NB.evt.emit("auth:locked"); } catch (_) {}
      }
    } catch (_) { /* best-effort: lock must not throw */ }
  }

  function showModal() {
    if (!overlayEl) return;        // template missing -- nothing we can show
    overlayEl.hidden = false;
    lock();
    if (NB.dialog) {
      NB.dialog.open(overlayEl, { initialFocus: inputEl });
    } else {
      // Focus after the unlock/un-hide so the input is ready.
      setTimeout(() => { try { inputEl.focus(); } catch (e) {} }, 0);
    }
    if (inputEl) inputEl.value = "";
    if (errorEl) errorEl.textContent = "";
  }

  function hideModal() {
    if (overlayEl) overlayEl.hidden = true;
    if (NB.dialog) NB.dialog.close(overlayEl);
    unlock();
  }

  function showError(msg) {
    if (errorEl) errorEl.textContent = msg || "";
  }

  async function tryLogin() {
    const pw = inputEl && inputEl.value;
    if (!pw) { showError("Enter the password."); return; }
    if (submitEl) submitEl.disabled = true;
    showError("");
    try {
      await NB.api.login(pw);
      // Reload so every module boots with a known-good session -- simpler
      // than threading the role through every startup path.
      window.location.reload();
    } catch (e) {
      // 401 -> "Invalid password"; 429 -> "Too many attempts"; anything
      // else -> the raw error text.
      showError(e.message || "Login failed");
    } finally {
      if (submitEl) submitEl.disabled = false;
    }
  }

  async function tryLogout() {
    try { await NB.api.logout(); } catch (e) { /* ignore */ }
    // Explicit sign-out clears device-local phone state. A 401/lock must
    // not do this (the draft is recoverable after signing in).
    if (NB.mobile && NB.mobile.onSignOut) NB.mobile.onSignOut();
    try {
      localStorage.removeItem("nb:captureDraft");
      localStorage.removeItem("nb:mobileResume");
    } catch (e) { /* storage unavailable */ }
    // The session is gone; drop the cached role so a synchronous caller
    // (the designer menu gate) stops treating us as an admin.
    if (authStatus) authStatus = Object.assign({}, authStatus, { role: null });
    // Signed out: the logout control is meaningless until the next login.
    if (logoutEl) logoutEl.hidden = true;
    // After logout, the next gated call will 401, but we want the modal
    // right now -- show it directly and don't wait.
    showModal();
  }

  function wire() {
    if (submitEl) submitEl.addEventListener("click", (e) => { e.preventDefault(); tryLogin(); });
    if (inputEl) inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); tryLogin(); }
    });
    if (logoutEl) logoutEl.addEventListener("click", tryLogout);

    // api.js fires "auth:required" on any 401. Show the modal again
    // (no-op if it's already up) so a stale tab re-prompts.
    NB.evt.on("auth:required", () => {
      // A 401 means the cached role is no longer trustworthy. Drop it so
      // synchronous gates (canWrite) stop allowing writes, and let the
      // phone shell close its write surfaces.
      if (authStatus) authStatus = Object.assign({}, authStatus, { role: null });
      if (overlayEl && !overlayEl.hidden) {
        // The modal is already up (a poll every few seconds also 401s
        // while signed out). Still wipe the stale note/tree (the security
        // contract of a 401), but do NOT re-run showModal(): that would
        // clear the password being typed and any error message.
        lock();
        return;
      }
      showModal();
      if (NB.mobile && NB.mobile.onAuthRequired) NB.mobile.onAuthRequired();
    });
  }

  let booted = false;
  async function boot() {
    if (booted) return;   // idempotent: wire() would otherwise add duplicate listeners
    booted = true;
    wire();
    let status;
    try {
      status = await NB.api.getAuthStatus();
    } catch (e) {
      // Server unreachable -- nothing useful to show, leave the rest of
      // the app to surface its own error.
      return;
    }
    authStatus = status;
    NB.evt.emit("auth:status", status);
    if (status && status.enabled) {
      // Auth is on. If a role is already in the session, the logout
      // button is meaningful; if not, the login modal needs to come up.
      if (status.role) {
        if (logoutEl) logoutEl.hidden = false;
      } else {
        showModal();
      }
    }
  }

  // Expose a few hooks for tests + the rare case a module wants to know.
  NB.auth = {
    showModal,
    hideModal,
    isLocked: () => document.body.classList.contains("auth-locked"),
    logout:   tryLogout,
    // Raw boot status (null until /api/auth resolves), plus the one
    // predicate the designer's menu gate needs: writes are allowed when
    // auth is off or the signed-in role is admin.
    status:   () => authStatus,
    isAdmin:  () => !!(authStatus && authStatus.enabled && authStatus.role === "admin"),
    // Writes are allowed when auth is off, or when the signed-in session is
    // an admin. Unlike isAdmin(), this is true on an open server.
    // Default-deny until /api/auth resolves: no capture/draft UI may
    // appear for a role that has not been established yet.
    canWrite: () => {
      const s = authStatus;
      return !!s && (!s.enabled || s.role === "admin");
    },
  };

  // Boot immediately, NOT on DOMContentLoaded. The scripts sit at the end
  // of <body>, so the auth overlay + inputs are already parsed by the time
  // this tiny module runs. Waiting for DOMContentLoaded would delay the
  // login prompt until every synchronous script has executed -- including
  // the multi-MB viz/codemirror bundles -- which can take 10-20s on a slow
  // LAN or machine. Prompting right away lets the user sign in while the
  // heavy bundles finish loading in the background.
  boot();
})();
