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

  const overlay = () => document.getElementById("auth-overlay");
  const input   = () => document.getElementById("auth-password");
  const submit  = () => document.getElementById("auth-submit");
  const errEl   = () => document.getElementById("auth-error");
  const logoutBtn = () => document.getElementById("logout-btn");

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
      const vc = document.getElementById("viewer-content");
      if (vc) { vc.textContent = ""; vc.innerHTML = ""; }
      // File tree (sidebar): the list of notes/folders.
      const ft = document.getElementById("file-tree");
      if (ft) ft.innerHTML = "";
      // Search results list.
      const sl = document.getElementById("search-list");
      if (sl) sl.innerHTML = "";
      // Search summary text.
      const ss = document.getElementById("search-summary");
      if (ss) ss.textContent = "";
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
    const o = overlay();
    if (!o) return;        // template missing -- nothing we can show
    o.hidden = false;
    lock();
    // Focus + clear after the unlock/un-hide so the input is ready.
    setTimeout(() => { try { input().focus(); } catch (e) {} }, 0);
    if (input()) input().value = "";
    if (errEl()) errEl().textContent = "";
  }

  function hideModal() {
    const o = overlay();
    if (o) o.hidden = true;
    unlock();
  }

  function showError(msg) {
    if (errEl()) errEl().textContent = msg || "";
  }

  async function tryLogin() {
    const pw = input() && input().value;
    if (!pw) { showError("Enter the password."); return; }
    submit().disabled = true;
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
      submit().disabled = false;
    }
  }

  async function tryLogout() {
    try { await NB.api.logout(); } catch (e) { /* ignore */ }
    // After logout, the next gated call will 401, but we want the modal
    // right now -- show it directly and don't wait.
    showModal();
  }

  function wire() {
    const s = submit();
    if (s) s.addEventListener("click", (e) => { e.preventDefault(); tryLogin(); });
    const i = input();
    if (i) i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); tryLogin(); }
    });
    const lb = logoutBtn();
    if (lb) lb.addEventListener("click", tryLogout);

    // api.js fires "auth:required" on any 401. Show the modal again
    // (no-op if it's already up) so a stale tab re-prompts.
    NB.evt.on("auth:required", () => { showModal(); });
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
    if (status && status.enabled) {
      // Auth is on. If a role is already in the session, the logout
      // button is meaningful; if not, the login modal needs to come up.
      if (status.role) {
        const lb = logoutBtn();
        if (lb) lb.hidden = false;
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
  };

  document.addEventListener("DOMContentLoaded", boot);
})();
