/* watcher.js -- detect external file changes (e.g. edits made in another
 * app) for files the editor already has cached. Uses the File System
 * Observer API (Chrome/Edge 133+) for push-style notifications when the
 * user has granted a handle on the notebook/ folder; falls back to a 5s
 * conditional-GET poll against /api/file?ifModifiedSince= on browsers
 * that don't have it.
 *
 * The polling fallback starts automatically on app load so external
 * changes are detected by default; pollOnce() is a no-op until the
 * viewer has at least one open file in its cache, so the cost is
 * effectively zero for users who never open anything. The native
 * observer is still opt-in -- enabling it asks for folder access via
 * showDirectoryPicker(), which only fires from a user gesture, so
 * upgrading to native mode is a one-click action in Settings. */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const POLL_MS = 5000;
  const SELF_SAVE_WINDOW_MS = 1500;     // ignore our own writes within this window

  // path -> last seen mtime
  const knownMtime = new Map();
  // path -> until-ts: changes within this window are our own save's echo
  const selfSaveUntil = new Map();

  // Native observer state
  let observer = null;
  let watching = false;                  // true iff an observer is active
  let pollTimer = null;                  // active when native isn't available
  let watchedRoot = null;                // user-visible label, for the UI button

  /* --- public API ----------------------------------------------------- */

  const watcher = {
    /* Set the mtime baseline for a file we just loaded ourselves. Skips
     * the next "change" we see for this file so opening doesn't trigger
     * a phantom reload. */
    noteOpened(path, mtime) {
      if (mtime == null) return;
      knownMtime.set(path, mtime);
    },

    /* Forget a file we no longer care about (closed tab, dropped cache). */
    forget(path) { knownMtime.delete(path); selfSaveUntil.delete(path); },

    /* True if the native observer is active. */
    isWatching() { return watching; },

    /* True if any change-detection mechanism is running (native observer
     * or polling fallback). Use this to decide the on/off label. */
    isActive() { return watching || !!pollTimer; },

    /* Coarse state for the UI: "off" | "polling" | "watching".
     * "polling" is the auto-started fallback that ships enabled;
     * "watching" is the native observer the user opted into. */
    state() {
      if (watching) return "watching";
      if (pollTimer) return "polling";
      return "off";
    },

    /* UI label: "Watching <folder>" / "Polling (5s)" / "Watching off". */
    describe() {
      if (watching) return "Watching " + (watchedRoot || "folder");
      if (pollTimer) return "Polling (5s)";
      return "Watching off";
    },

    /* User clicked the toggle (in Settings). Try the native observer
     * first (which prompts for folder access); if the browser doesn't
     * support it, or the user cancels, fall back to polling so the
     * toggle still does something. */
    async enable() {
      if (watching || pollTimer) return;
      if (window.FileSystemObserver && window.showDirectoryPicker) {
        try {
          const handle = await window.showDirectoryPicker({ mode: "read" });
          await startObserver(handle);
          return;
        } catch (e) {
          // User cancelled the picker, or revoked permission. Fall
          // through to the polling fallback so the click wasn't wasted.
          if (e && e.name === "AbortError") return;
        }
      }
      startPolling_();
    },

    /* Start just the polling fallback -- no permission prompt, no
     * native observer. This is the auto-started default at app load.
     * A no-op if anything is already running. */
    startPolling() {
      if (watching || pollTimer) return;
      startPolling_();
    },

    disable() {
      if (observer) { try { observer.disconnect(); } catch (_) {} observer = null; }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      watching = false;
      watchedRoot = null;
    },

    /* Called by viewer.save() so the observer can swallow the echo. */
    noteSelfSave(path) { selfSaveUntil.set(path, Date.now() + SELF_SAVE_WINDOW_MS); },
  };

  /* --- native observer ------------------------------------------------ */
  async function startObserver(handle) {
    // Walk the handle we were granted and pre-seed mtimes for any file we
    // already have cached. We don't recursively walk the whole tree --
    // the observer fires for any change inside, and we only care about
    // paths in `knownMtime`.
    observer = new FileSystemObserver((records) => {
      for (const r of records) {
        handleExternalRecord(r);
      }
    });
    await observer.observe(handle, { recursive: true });
    watching = true;
    watchedRoot = handle.name || "folder";
  }

  function handleExternalRecord(r) {
    if (!r || r.type === "errored" || r.type === "unknown") return;
    // FileSystemObserver gives us a FileSystemHandle and a path inside it.
    // The path is an array of names from the watched root; join it.
    const rel = (r.changedHandle && relativePathOf(r.changedHandle, r.relativePathComponents))
             || (Array.isArray(r.relativePathComponents)
                  ? r.relativePathComponents.join("/")
                  : null);
    if (!rel) return;
    // Only react to .md files (the rest of the app ignores non-md anyway).
    if (!rel.toLowerCase().endsWith(".md")) return;
    if (r.type === "disappeared") {
      // The viewer's tabs.js already listens for the explicit file:deleted
      // event from the sidebar; we don't want to double-fire here.
      return;
    }
    notifyChange(rel);
  }

  function relativePathOf(handle, components) {
    if (Array.isArray(components) && components.length) return components.join("/");
    return handle && handle.name;
  }

  /* --- polling fallback ---------------------------------------------- */
  function startPolling_() {
    pollTimer = setInterval(pollOnce, POLL_MS);
    watching = false;
    watchedRoot = null;
    // first tick immediately so the UI feels alive
    pollOnce();
  }

  async function pollOnce() {
    if (!knownMtime.size) return;
    // Re-fetch the tree so we also notice newly appeared files; we
    // don't act on those here (the sidebar will pick them up on its own
    // refresh), but we seed mtimes for any that overlap the cache.
    for (const [path, mtime] of knownMtime) {
      // No baseline mtime (never opened cleanly, or a response came
      // back without one) -- we'd treat every poll as a "change" and
      // thrash the cache. Skip until noteOpened() seeds a real value.
      if (mtime == null) continue;
      try {
        const r = await fetch("/api/file?path=" + encodeURIComponent(path) +
                              "&ifModifiedSince=" + mtime,
                              { method: "GET" });
        if (r.status === 304) continue;
        if (!r.ok) { knownMtime.delete(path); continue; }
        const data = await r.json();
        if (data.mtime != null) knownMtime.set(path, data.mtime);
        if (isSelfSave(path)) continue;
        notifyChange(path, data);
      } catch (e) { /* network blip; try again next tick */ }
    }
  }

  /* --- shared notify path -------------------------------------------- */
  function notifyChange(path, freshData) {
    if (isSelfSave(path)) return;
    NB.evt.emit("file:external-change", { path, data: freshData || null });
  }

  function isSelfSave(path) {
    const until = selfSaveUntil.get(path);
    if (!until) return false;
    if (Date.now() > until) { selfSaveUntil.delete(path); return false; }
    return true;
  }

  /* --- stop polling when the tab is hidden --------------------------- */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && observer) {
      try { observer.disconnect(); } catch (_) {}
    }
  });

  NB.watcher = watcher;

  /* --- auto-start the polling fallback --------------------------------
   * External file-change detection is on by default: every 5s we
   * re-check any file in the viewer's cache via a conditional GET.
   * pollOnce() is a cheap no-op until the viewer has opened at least
   * one file (knownMtime is empty), so this costs nothing for users
   * who never open a note. Users who want push-style native
   * notifications (no polling, no network) can grant folder access
   * via the "Enable" button in Settings -- that upgrades them to
   * the FileSystemObserver path and tears down the poller. */
  watcher.startPolling();
})();