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
  const themeRadios = Array.from(overlayEl.querySelectorAll('input[name="theme"]'));
  const watchStatusEl = document.getElementById("settings-watch-status");
  const watchToggleBtn = document.getElementById("settings-watch-toggle");
  const dataDirEl   = document.getElementById("settings-data-dir");
  const configDirEl = document.getElementById("settings-config-dir");

  let infoLoaded = false;
  let onOpenListeners = [];

  function open() {
    // Sync the modal to live state every time it opens (so the user sees
    // the current theme, watch status, and dir info even if they change
    // elsewhere).
    const cfg = NB.app.getCfg();
    themeRadios.forEach(r => { r.checked = (r.value === (cfg.theme || "auto")); });
    refreshWatchStatus();
    if (!infoLoaded) loadInfo();
    overlayEl.hidden = false;
    onOpenListeners.forEach(fn => { try { fn(); } catch (e) {} });
  }
  function close() { overlayEl.hidden = true; }
  function isOpen() { return !overlayEl.hidden; }

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

  // theme radio -> write to cfg + persist
  themeRadios.forEach(r => r.addEventListener("change", () => {
    if (!r.checked) return;
    NB.app.setTheme(r.value);
  }));

  // watch toggle
  watchToggleBtn.addEventListener("click", async () => {
    watchToggleBtn.disabled = true;
    try {
      if (NB.watcher.isActive()) NB.watcher.disable();
      else await NB.watcher.enable();
    } catch (e) { alert("File watching failed: " + e.message); }
    refreshWatchStatus();
  });

  // close
  closeBtn.addEventListener("click", close);
  overlayEl.addEventListener("click", (e) => {
    // click on the dim backdrop (not the modal) closes
    if (e.target === overlayEl) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });

  /* Allow other modules to refresh the modal (e.g. when the watcher state
   * changes while the modal is already open). */
  function onOpen(fn) { onOpenListeners.push(fn); }

  NB.settings = { open, close, isOpen, refreshWatchStatus, onOpen };
})();