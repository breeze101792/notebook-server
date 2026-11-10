/* tabs.js -- top-bar file tabs. Owns the ordered set of open files and the
 * active file; coordinates with viewer.js (per-file content cache) and
 * persists the open set + active file to config.
 *
 * Open/switch/close a tab -> viewer activates/renders the cached content.
 * A tab switch always exits edit mode: a clean file exits silently, a
 * dirty one prompts to save first, and Cancel aborts the switch.
 *
 * Tabs are drag-reorderable. Pinned tabs live in a fixed left group: they
 * carry a pin marker, have no close button, and are skipped by the bulk-close
 * actions (close others / right / left) in the tab right-click menu. Every
 * tab renders at the same bounded width (see --tab-min/--tab-max-width).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const barEl = document.getElementById("tab-bar");
  // Unpinned tabs render into #tab-list, the inner scroller. Pinned tabs
  // render into #tab-pinned, its fixed sibling, so they stay visible while
  // the rest scroll. Each falls back to the other (and to the bar) so a stale
  // cached index.html (pre-split) degrades instead of throwing at module load.
  const listEl = document.getElementById("tab-list") || barEl;
  const pinEl = document.getElementById("tab-pinned") || listEl;
  pinEl.setAttribute("role", "tablist");
  pinEl.setAttribute("aria-label", "Pinned files");
  listEl.setAttribute("role", "tablist");
  listEl.setAttribute("aria-label", "Open files");
  // The outline toggle (#outline-toggle) is a sibling of both regions, at the
  // fixed right edge, so an overflowing tab can never overlap it. Drag/click
  // events bubble from either region up to #tab-bar, where the delegated
  // handlers live.
  const ordered = [];          // [path] in display order (pinned tabs first)
  const openSet = new Set();   // path membership
  const pinned = new Set();    // pinned paths (always a contiguous prefix of `ordered`)
  let activePath = null;

  /* Sessions: a named set of unpinned tabs plus its own active tab. The
   * active session IS the live view above (`ordered` minus pins, `activePath`);
   * only the inactive sessions are stored. `sessionNames` and `sessionOrder`
   * are metadata and never hold paths, so a path is owned by exactly one of
   * `pinned`, the live strip, or one stored record. Spec:
   * docs/architecture/sessions.md. */
  const SESSION_MAX_COUNT = 20;        // sessions per workspace
  const SESSION_NAME_MAX = 40;         // characters, after trimming
  const SESSION_FILES_MAX = 40;        // unpinned tabs per session
  const SESSION_DEFAULT_ID = "main";
  const SESSION_DEFAULT_NAME = "Main";
  const SESSION_ID_PREFIX = "s-";
  const SESSION_FULL_MESSAGE =
    "This session is full — close a tab or open a new session.";
  const SESSION_LIMIT_MESSAGE = SESSION_MAX_COUNT + " sessions is the limit. Delete one first.";

  let sessionOrder = [];               // ids, display order
  const sessionNames = new Map();      // id -> display name
  const storedSessions = new Map();    // id -> { openFiles: [path], activeFile }
  let activeSessionId = "";
  let sessionToken = 0;                // guards an in-flight swapTo
  let sessionSeq = 0;                  // id generator counter

  /* Special tabs: pseudo-paths that render in the tab bar like file tabs
   * but show a non-file view (graph, search) in the content area instead
   * of a rendered note. A special tab's id starts with "§" so it never
   * collides with a real file path (paths are relative + can't start
   * with § on any sane filesystem). Each special tab registers a
   * { id, icon, label, onActivate, onClose } factory; tabs.js owns the
   * tab bar lifecycle (open/activate/close/reorder) and delegates the
   * content-area swap to onActivate/onClose. */
  const specialTabs = new Map();   // id -> { icon, label, onActivate(id), onClose(id) }
  function isSpecial(path) { return typeof path === "string" && path.startsWith("§"); }
  function isSpecialOpen(path) { return openSet.has(path); }

  // Drag-and-drop reorder state. We track the dragged path here instead of
  // in dataTransfer so the same code works in jsdom (which has no real DnD).
  let draggingPath = null;

  // Tab width freeze: a Map<path, px> while the pointer is inside the tab
  // bar, null otherwise. Closing a tab re-renders the strip, and the
  // equal-width flex rule would immediately re-equalize every remaining
  // tab, sliding the next close button out from under the cursor. Freezing
  // the measured widths keeps the strip put until the pointer leaves.
  let frozenWidths = null;

  // Release re-equalization. RELEASE_CLASS scopes the keyframes; the two
  // custom-property names carry each tab's start/end width; RELEASE_ANIM
  // matches the keyframes name so the animationend handler ignores any other
  // future .tab animation. Timing lives in CSS (--tab-release-duration); the
  // fallback timer guards a dropped animationend.
  const RELEASE_CLASS = "nb-tab-equalizing";
  const RELEASE_ANIM = "nb-tab-equalize";
  const TAB_FROM_VAR = "--nb-tab-from";
  const TAB_TO_VAR = "--nb-tab-to";
  const TAB_RELEASE_FALLBACK_MS = 280;   // >= CSS duration; timer backstop
  const TAB_RELEASE_MAX_TABS = 24;       // above this, re-equalize instantly
  const WIDTH_EPSILON = 0.5;             // px; smaller deltas are invisible
  let releaseTimer = null;

  // Ghost close slot. Closing a tab leaves an inert copy of its box that
  // collapses (flex-basis -> 0) and fades at once -- the visible close motion,
  // playing the moment the tab is closed, like Firefox. The surviving tabs
  // keep their frozen widths and slide left as it shrinks; when the pointer
  // leaves the bar they re-equalize. The entry is DATA because render()
  // rebuilds every tab node; `startedAt` lets a rebuilt node resume
  // mid-collapse via a negative animation-delay (the active-tab case, where
  // activate() re-renders).
  const GHOST_CLASS = "ghost";
  const GHOST_FILL_CLASS = "tab-ghost-fill";
  const GHOST_FROM_VAR = "--nb-tab-ghost-from";
  const TAB_GHOST_FALLBACK_MS = 280;   // >= close duration; per-ghost backstop
  const ghosts = [];                   // { path, label, width, index, startedAt, node, timer }

  // Wheel-to-horizontal scroll. Browsers map a wheel delta onto the axis it
  // names, so a plain vertical wheel over a strip that scrolls only on X is
  // ignored: an overflowing bar could only be scrolled with shift+wheel or a
  // trackpad's horizontal axis. onTabWheel translates the delta onto
  // scrollLeft instead. The deltaMode constants are the WheelEvent values for
  // a line-based wheel (Firefox) and a page-based one; a line-based delta
  // counts lines, not px, and a page-based delta counts viewport widths.
  const WHEEL_DELTA_LINE = 1;
  const WHEEL_DELTA_PAGE = 2;
  const WHEEL_LINE_PX = 16;

  function baseName(p) { const i = p.lastIndexOf("/"); return i < 0 ? p : p.slice(i + 1); }
  function isPinned(path) { return pinned.has(path); }
  function pinnedCount() { return pinned.size; }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* Resolve the .tab element an event is firing on (handles text-node targets). */
  function targetTab(e) {
    let n = e.target;
    if (n && n.nodeType === 3) n = n.parentElement;   // text node -> its element
    return n && n.closest ? n.closest(".tab") : null;
  }

  /* The real tabs across both regions, excluding ghost close slots. Every
   * width measurement, pin, or release over .tab must use this: a ghost's
   * width is not a tab width. Bar-scoped, so it returns tabs in `ordered`
   * order (pinned region first). */
  function realTabs() {
    return Array.from(barEl.querySelectorAll(".tab:not(." + GHOST_CLASS + ")"));
  }

  /* Re-segment `ordered` so pinned paths form a contiguous prefix, preserving
   * relative order within each group. */
  function segment() {
    const p = ordered.filter(x => pinned.has(x));
    const u = ordered.filter(x => !pinned.has(x));
    ordered.length = 0;
    ordered.push(...p, ...u);
  }

  /* --- sessions: the model ------------------------------------------- */
  /* A name is trimmed and capped; empty names are rejected, never stored. */
  function cleanSessionName(raw) {
    return String(raw == null ? "" : raw).trim().slice(0, SESSION_NAME_MAX);
  }

  /* Case-insensitive collision test against every other session. */
  function nameTaken(name, exceptId) {
    const n = name.toLowerCase();
    for (const id of sessionOrder) {
      if (id === exceptId) continue;
      if ((sessionNames.get(id) || "").toLowerCase() === n) return true;
    }
    return false;
  }

  /* `{ok, code, name}`; `code` is "name_empty", "name_duplicate" or "" (ok).
   * A too-long paste is truncated before validation, never rejected. The
   * dialog (sessions.js) maps these codes onto its inline errors. */
  function validateSessionName(raw, exceptId) {
    const name = cleanSessionName(raw);
    if (!name) return { ok: false, code: "name_empty" };
    if (nameTaken(name, exceptId)) return { ok: false, code: "name_duplicate" };
    return { ok: true, code: "", name };
  }

  function generateSessionId(taken) {
    let id;
    do {
      sessionSeq++;
      id = SESSION_ID_PREFIX + Date.now().toString(36) + "-" + sessionSeq.toString(36);
    } while (taken(id));
    return id;
  }

  function notify(msg) {
    if (NB.app && NB.app.notify) NB.app.notify(msg);
  }

  function treeHasPath(tree, path) {
    for (const node of tree) {
      if (node.path === path) return true;
      if (node.children && treeHasPath(node.children, path)) return true;
    }
    return false;
  }

  /* The tree may have changed since normalisation (a file removed between
   * the fetch and restore). A missing path is dropped; the session stays. */
  function liveTreeAllows(path) {
    if (typeof path !== "string" || !path) return false;
    if (isSpecial(path)) return specialTabs.has(path);
    const tree = (NB.sidebar && NB.sidebar.getTree) ? NB.sidebar.getTree() : null;
    if (!tree || !tree.length) return true;   // nothing to check against
    return treeHasPath(tree, path);
  }

  function unpinnedCount() { return ordered.filter(p => !pinned.has(p)).length; }

  /* Rule 4 of normalisation: a stored activeFile survives while it is in the
   * session or pinned; otherwise the first session file, else nothing. */
  function fixSessionActive(rec, pinSet) {
    const files = rec.openFiles || [];
    if (rec.activeFile &&
        (files.indexOf(rec.activeFile) >= 0 || pinSet.has(rec.activeFile))) return;
    rec.activeFile = files[0] || null;
  }

  /* Drop one path from a stored record and repair its activeFile. */
  function removeStoredFile(rec, path) {
    const i = (rec.openFiles || []).indexOf(path);
    if (i >= 0) rec.openFiles.splice(i, 1);
    if (rec.activeFile === path) rec.activeFile = rec.openFiles[0] || null;
  }

  /* Live view <- a stored record (or an empty session). The pins keep their
   * displayed order: `ordered`'s prefix, not the Set's insertion order,
   * because drag-reorder changes the strip and not the Set. The record is
   * consumed: storedSessions never holds the active session. */
  function installSession(id) {
    const rec = storedSessions.get(id) || { openFiles: [], activeFile: null };
    storedSessions.delete(id);
    const pinOrder = ordered.filter(p => pinned.has(p));
    ordered.length = 0;
    openSet.clear();
    for (const p of pinOrder) { ordered.push(p); openSet.add(p); }
    for (const p of rec.openFiles) {
      if (!pinned.has(p) && !openSet.has(p)) { ordered.push(p); openSet.add(p); }
    }
    activePath = (rec.activeFile && openSet.has(rec.activeFile))
      ? rec.activeFile
      : (rec.openFiles.find(p => openSet.has(p)) || ordered[0] || null);
  }

  /* Live view -> the outgoing session's record. An empty session stores an
   * explicit empty record so it is not confused with a missing one. */
  function storeOutgoing() {
    if (!activeSessionId) return;
    storedSessions.set(activeSessionId, {
      openFiles: ordered.filter(p => !pinned.has(p)),
      activeFile: activePath,
    });
  }

  /* The persisted shape: the live view for the active id, stored records for
   * the rest, in session order. `dirty`/`count` are UI-only, never persisted. */
  function snapshot() {
    const live = { openFiles: ordered.filter(p => !pinned.has(p)), activeFile: activePath };
    return sessionOrder.map(id => {
      const rec = (id === activeSessionId)
        ? live
        : (storedSessions.get(id) || { openFiles: [], activeFile: null });
      return {
        id,
        name: sessionNames.get(id) || id,
        openFiles: (rec.openFiles || []).slice(),
        activeFile: rec.activeFile || null,
      };
    });
  }

  function getSessionList() {
    const live = { openFiles: ordered.filter(p => !pinned.has(p)), activeFile: activePath };
    const hybridDirty = !!(NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive() &&
                           NB.hybrid.isDirty && NB.hybrid.isDirty());
    return sessionOrder.map(id => {
      const rec = (id === activeSessionId)
        ? live
        : (storedSessions.get(id) || { openFiles: [], activeFile: null });
      const files = rec.openFiles || [];
      const dirty = files.some(p => !isSpecial(p) &&
                                     NB.viewer && NB.viewer.isDirty && NB.viewer.isDirty(p)) ||
                    (id === activeSessionId && hybridDirty);
      return { id, name: sessionNames.get(id) || id, count: files.length, dirty };
    });
  }

  function getActiveSessionId() { return activeSessionId; }

  /* True when a stored (inactive) session still lists this path. The live
   * active session is checked separately. `exceptId` skips the record a
   * caller has already removed from the model. */
  function hasStoredPath(path, exceptId) {
    for (const [id, rec] of storedSessions) {
      if (id === exceptId) continue;
      if ((rec.openFiles || []).indexOf(path) >= 0) return true;
    }
    return false;
  }

  /* Repair a hand-edited or legacy `sessions` block. Never throws; returns
   * the known shape plus `migrated` (true only for the first boot after the
   * upgrade, when `sessions` was absent). Rules: docs/architecture/
   * sessions.md §4. */
  function normaliseSessions(raw, known) {
    raw = raw || {};
    const allows = (typeof known === "function") ? known : () => true;
    const rawOpen = Array.isArray(raw.openFiles) ? raw.openFiles : [];
    const rawPins = Array.isArray(raw.pinnedFiles) ? raw.pinnedFiles : [];

    // Rule 9, computed first: rule 4 needs the pinned set to accept a pinned
    // activeFile, and rule 5 removes every pin from every session. The strip
    // order comes from the openFiles mirror (its pinned prefix), then any
    // saved pin the mirror did not carry.
    const pinnedFiles = [];
    const pinSeen = new Set();
    for (const p of rawOpen) {
      if (rawPins.indexOf(p) < 0) continue;
      if (!allows(p) || pinSeen.has(p)) continue;
      pinSeen.add(p);
      pinnedFiles.push(p);
    }
    for (const p of rawPins) {
      if (!allows(p) || pinSeen.has(p)) continue;
      pinSeen.add(p);
      pinnedFiles.push(p);
    }

    // Rule 1: no non-empty sessions array -> migrate the legacy tab list.
    let migrated = false;
    let entries = Array.isArray(raw.sessions)
      ? raw.sessions.filter(s => s && typeof s === "object")
      : [];
    if (!Array.isArray(raw.sessions) || !raw.sessions.length) {
      entries = [{
        id: SESSION_DEFAULT_ID,
        name: SESSION_DEFAULT_NAME,
        openFiles: rawOpen.slice(),
        activeFile: raw.activeFile || null,
      }];
      migrated = true;
    }

    // Rule 2: usable ids, duplicates regenerated. An array of unusable
    // entries repairs to one empty session rather than to zero.
    const sessions = [];
    const usedIds = new Set();
    for (const entry of entries) {
      let id = (typeof entry.id === "string") ? entry.id.trim() : "";
      if (id && usedIds.has(id)) id = "";
      if (!id) id = generateSessionId(cand => usedIds.has(cand));
      usedIds.add(id);
      sessions.push({
        id,
        name: entry.name,
        openFiles: Array.isArray(entry.openFiles) ? entry.openFiles : [],
        activeFile: entry.activeFile || null,
      });
    }
    if (!sessions.length) {
      sessions.push({
        id: SESSION_DEFAULT_ID, name: SESSION_DEFAULT_NAME,
        openFiles: [], activeFile: null,
      });
      usedIds.add(SESSION_DEFAULT_ID);
    }

    // Rule 3: unique names, " 2", " 3", … appended to a duplicate.
    const usedNames = new Set();
    sessions.forEach((s, i) => {
      const base = cleanSessionName(s.name) || ("Session " + (i + 1));
      let name = base;
      let n = 1;
      while (usedNames.has(name.toLowerCase())) {
        n++;
        const suffix = " " + n;
        name = base.slice(0, SESSION_NAME_MAX - suffix.length) + suffix;
      }
      usedNames.add(name.toLowerCase());
      s.name = name;
    });

    // Rule 4: known strings only, deduped, order preserved, capped at 40.
    sessions.forEach(s => {
      const files = [];
      for (const p of s.openFiles) {
        if (typeof p !== "string" || !p) continue;
        if (!allows(p) || files.indexOf(p) >= 0) continue;
        if (files.length >= SESSION_FILES_MAX) continue;
        files.push(p);
      }
      s.openFiles = files;
      fixSessionActive(s, pinSeen);
    });

    // Rule 5: pinned wins — no pin belongs to a session.
    sessions.forEach(s => {
      s.openFiles = s.openFiles.filter(p => !pinSeen.has(p));
      fixSessionActive(s, pinSeen);
    });

    // No cross-session dedupe: the same note may be open in several sessions.
    // Each session's own list is already deduped in rule 4.

    // Rule 7: a known active id, else the first session.
    const storedActive = (typeof raw.activeSessionId === "string") ? raw.activeSessionId : "";
    const activeId = sessions.some(s => s.id === storedActive)
      ? storedActive : sessions[0].id;

    // Rule 8: cap at 20, keeping the active session even when it is past the
    // cap (append it and drop the last non-active entry).
    let kept = sessions;
    if (sessions.length > SESSION_MAX_COUNT) {
      const ai = sessions.findIndex(s => s.id === activeId);
      kept = (ai >= SESSION_MAX_COUNT)
        ? sessions.slice(0, SESSION_MAX_COUNT - 1).concat([sessions[ai]])
        : sessions.slice(0, SESSION_MAX_COUNT);
    }

    return {
      sessions: kept.map(s => ({
        id: s.id, name: s.name,
        openFiles: s.openFiles.slice(), activeFile: s.activeFile || null,
      })),
      activeSessionId: activeId,
      pinnedFiles,
      migrated,
    };
  }

  /* --- render the tab bar -------------------------------------------- */
  /* Equal-width layout lives in CSS (flex: 1 1 var(--tab-width)). While the
   * pointer is inside the bar, `frozenWidths` pins each tab to the width it
   * had before the re-render, so closing a tab does not re-equalize and
   * shift its neighbors out from under the cursor. A tab opened while frozen
   * has no prior width; it captures its natural width on the next capture. */
  function captureFrozenWidths() {
    if (!frozenWidths) return;
    realTabs().forEach(tab => {
      const w = tab.getBoundingClientRect().width;
      if (w > 0) frozenWidths.set(tab.dataset.path, w);
    });
  }

  function applyFrozenWidths() {
    if (!frozenWidths) return;
    realTabs().forEach(tab => {
      const w = frozenWidths.get(tab.dataset.path);
      if (w == null) return;
      tab.style.flex = "0 0 " + w + "px";
      tab.style.width = w + "px";
    });
  }

  /* Pre-close reflow capture: measure every tab's current width, keyed by
   * path, BEFORE the strip rebuilds, so a close can replay the re-equalize
   * from those widths. Keying by path is what survives the render() rebuild.
   * Null when there is nothing to animate: while frozen the freeze owns the
   * strip and mouseleave's release is the motion (animating here would slide
   * close buttons under the cursor); no measurable tab means hidden/jsdom.
   * `skipPath` (the closing tab) is not captured -- it is gone after the
   * rebuild. Same w > 0 filter as captureFrozenWidths. */
  function captureCloseReflow(skipPath) {
    if (frozenWidths) return null;
    const from = new Map();
    realTabs().forEach(tab => {
      if (tab.dataset.path === skipPath) return;
      const w = tab.getBoundingClientRect().width;
      if (w > 0) from.set(tab.dataset.path, w);
    });
    return from.size ? from : null;
  }

  /* True when the user has asked the OS for reduced motion. Mirrors the
   * guard graph.js uses (graph.js:104-107). */
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) { return false; }
  }

  /* Drop the inline freeze pins on the given tabs. */
  function clearPins(tabs) {
    tabs.forEach(t => { t.style.flex = ""; t.style.width = ""; });
  }

  /* End or cancel the release animation. Idempotent: called by the fallback
   * timer, by animationend, and to cancel on re-entry or mid-flight render. */
  function stopRelease() {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    barEl.classList.remove(RELEASE_CLASS);
    realTabs().forEach(t => {
      t.style.removeProperty(TAB_FROM_VAR);
      t.style.removeProperty(TAB_TO_VAR);
    });
  }

  /* Shared re-equalize animation -- the strip's one motion, driven by the
   * nb-tab-equalize keyframes. Both the release path (unfreezeWidths) and the
   * close path (close) feed it a Map<path, px> captured before the DOM
   * change. The caller must have already put the strip in its final resting
   * layout; the "to" widths are measured live here, and that read flushes the
   * layout so no explicit reflow is needed. Skips without side effects on
   * reduced motion, an active drag, an oversized strip, an empty/absent map,
   * or when no tab's delta clears WIDTH_EPSILON. A map path with no node is
   * ignored; a node with no entry holds still (its measured width is its own
   * from), the same rule the freeze gives a tab opened mid-freeze. */
  function animateReflow(fromWidths) {
    stopRelease();
    const tabs = realTabs();
    if (!tabs.length || !fromWidths) return;
    if (prefersReducedMotion() || draggingPath ||
        tabs.length > TAB_RELEASE_MAX_TABS) return;

    const end = tabs.map(t => t.getBoundingClientRect().width);
    const start = tabs.map((t, i) => {
      const w = fromWidths.get(t.dataset.path);
      return typeof w === "number" ? w : end[i];
    });
    if (!tabs.some((_, i) => Math.abs(start[i] - end[i]) > WIDTH_EPSILON)) return;

    tabs.forEach((t, i) => {
      t.style.setProperty(TAB_FROM_VAR, start[i] + "px");
      t.style.setProperty(TAB_TO_VAR, end[i] + "px");
    });
    barEl.classList.add(RELEASE_CLASS);
    releaseTimer = setTimeout(stopRelease, TAB_RELEASE_FALLBACK_MS);
  }

  /* Release the freeze. Measure the pinned ("from") widths first, drop the
   * pins synchronously so the strip rests at the equal-width layout at once,
   * then play the shared reflow animation. Reduced motion and a no-delta
   * strip fall out of animateReflow's gates (instant release). */
  function unfreezeWidths() {
    if (!frozenWidths) return;
    const from = new Map();
    realTabs().forEach(tab => {
      const w = tab.getBoundingClientRect().width;
      if (w > 0) from.set(tab.dataset.path, w);
    });
    frozenWidths = null;
    clearPins(realTabs());
    if (ghosts.length) {
      // Ghost slots are collapsing on their own (they free their space as they
      // shrink), so the survivors are already sliding into place. Nothing to
      // re-equalize here.
      return;
    }
    animateReflow(from.size ? from : null);
  }

  /* --- ghost close slot ---------------------------------------------- */
  /* Record a ghost for a tab closed while the strip is frozen. Measured
   * BEFORE dropTab replaces the nodes; the entry is data, and render()
   * materializes the node on every strip rebuild so it survives. */
  function addGhost(path, idx) {
    const node = barEl.querySelector('.tab[data-path="' + cssEscape(path) + '"]');
    const width = node ? node.getBoundingClientRect().width : 0;
    const label = isSpecial(path)
      ? ((specialTabs.get(path) || {}).label || path)
      : baseName(path);
    // Record the region while `pinned` still holds the path (dropTab runs
    // next); a ghost belongs to the same region its tab came from.
    ghosts.push({ path, label, width, index: idx, pinned: pinned.has(path),
                  startedAt: 0, node: null, timer: null });
  }

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  /* Show the pinned region only while it holds a pinned tab or a pinned ghost
   * is still playing its close. Called after any change to `pinned` or
   * `ghosts`. Skipped when the region fell back to the scroller (stale
   * index.html): hiding it would hide every tab. */
  function syncPinnedRegion() {
    if (pinEl === listEl) return;
    const hasPinnedGhost = ghosts.some(g => g.pinned);
    pinEl.hidden = pinned.size === 0 && !hasPinnedGhost;
  }

  /* Drop one ghost entry + its node. Idempotent. */
  function removeGhost(g) {
    if (g.timer) { clearTimeout(g.timer); g.timer = null; }
    if (g.node && g.node.parentNode) g.node.parentNode.removeChild(g.node);
    g.node = null;
    const i = ghosts.indexOf(g);
    if (i >= 0) ghosts.splice(i, 1);
    if (g.pinned) syncPinnedRegion();   // the last pinned ghost may have held it open
  }

  /* Materialize one node per ghost entry, in its recorded slot among the real
   * tabs, and start its collapse. render() calls this AFTER the real tabs are
   * appended. The CSS keyframes shrink the node's flex-basis to 0 and fade it
   * (see .tab.ghost), so the tab visibly closes the moment it is dropped, and
   * the survivors slide left as its box gives up the space. A rebuild
   * mid-collapse (the active-tab activate() render) resumes via a negative
   * animation-delay instead of restarting. Inert: no handlers, not draggable. */
  function materializeGhosts() {
    if (!ghosts.length) return;
    const now = nowMs();
    const realNodes = realTabs();
    ghosts.forEach(g => {
      const node = document.createElement("div");
      node.className = "tab " + GHOST_CLASS;
      node.style.flex = "0 0 " + g.width + "px";
      node.style.width = g.width + "px";
      node.style.setProperty(GHOST_FROM_VAR, g.width + "px");
      const fill = document.createElement("span");
      fill.className = GHOST_FILL_CLASS;
      fill.textContent = g.label;
      node.appendChild(fill);
      if (!g.startedAt) g.startedAt = now;
      const elapsed = now - g.startedAt;
      if (elapsed > 0) node.style.animationDelay = "-" + elapsed + "ms";
      if (!g.timer) g.timer = setTimeout(function () { removeGhost(g); }, TAB_GHOST_FALLBACK_MS);
      // Insert into the ghost's own region. The recorded ordered-index anchor
      // must be a child of that region; when it is not (a segment boundary, or
      // a reorder since the close), fall back to the region's end.
      const region = g.pinned ? pinEl : listEl;
      let anchor = realNodes[g.index] || null;
      if (anchor && anchor.parentElement !== region) anchor = null;
      region.insertBefore(node, anchor);
      g.node = node;
    });
  }

  /* Drop all ghost entries + their nodes. Called by clearAll (auth lock, etc.)
   * so no stale slot outlives a full clear; idempotent. */
  function finishGhosts() {
    ghosts.slice().forEach(removeGhost);
  }

  function setRoving(tab) {
    [pinEl, listEl].forEach((region) => {
      region.querySelectorAll(".tab").forEach((t) => { t.tabIndex = t === tab ? 0 : -1; });
    });
  }

  function render() {
    stopRelease();               // an in-flight settle belongs to the old nodes
    captureFrozenWidths();       // measure before the old tab nodes are dropped
    const savedScroll = listEl.scrollLeft;
    const savedPinnedScroll = pinEl === listEl ? 0 : pinEl.scrollLeft;
    pinEl.innerHTML = "";
    listEl.innerHTML = "";
    ordered.forEach(path => {
      const tab = document.createElement("div");
      tab.className = "tab" + (path === activePath ? " active" : "");
      if (pinned.has(path)) tab.classList.add("pinned");
      if (isSpecial(path)) tab.classList.add("special");
      // Special tabs are never dirty; file tabs consult the viewer.
      if (!isSpecial(path) && NB.viewer.isDirty(path)) tab.classList.add("dirty");
      tab.dataset.path = path;
      tab.title = isSpecial(path) ? (specialTabs.get(path) || {}).label || path : path;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", path === activePath ? "true" : "false");
      tab.tabIndex = path === activePath ? 0 : -1;
      tab.draggable = true;

      let tabName = isSpecial(path) ? ((specialTabs.get(path) || {}).label || path) : baseName(path);
      if (pinned.has(path)) tabName += ", pinned";
      if (!isSpecial(path) && NB.viewer.isDirty(path)) tabName += ", unsaved changes";
      if (!isSpecial(path) && conflictSet.has(path)) tabName += ", changed on disk";
      tab.setAttribute("aria-label", tabName);

      if (pinned.has(path)) {
        const pin = document.createElement("span");
        pin.className = "tab-pin";
        pin.textContent = "📌";
        pin.title = "Pinned";
        tab.appendChild(pin);
      }

      const label = document.createElement("span");
      label.className = "tab-label";
      if (isSpecial(path)) {
        const spec = specialTabs.get(path) || {};
        if (spec.icon) {
          const icon = document.createElement("span");
          icon.className = "tab-special-icon";
          icon.textContent = spec.icon;
          label.appendChild(icon);
        }
        const text = document.createElement("span");
        text.textContent = spec.label || path;
        label.appendChild(text);
      } else {
        label.textContent = baseName(path);
      }
      if (!isSpecial(path) && conflictSet.has(path)) {
        const badge = document.createElement("span");
        badge.className = "tab-conflict";
        badge.textContent = "↻";
        badge.title = "Disk has a newer version of this file (your edits are kept locally).";
        label.appendChild(badge);
      }
      tab.appendChild(label);

      // Pinned tabs have no close button (unpin first). Middle-click also
      // refuses to close a pinned tab.
      if (!pinned.has(path)) {
        const closeBtn = document.createElement("button");
        closeBtn.className = "tab-close";
        closeBtn.textContent = "×";
        closeBtn.title = "Close (middle-click also closes)";
        closeBtn.tabIndex = -1;
        closeBtn.setAttribute("aria-hidden", "true");
        closeBtn.setAttribute("aria-label", "Close " + tabName);
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(path); });
        tab.appendChild(closeBtn);
      }

      tab.addEventListener("click", () => activate(path));
      tab.addEventListener("focus", () => setRoving(tab));
      tab.addEventListener("keydown", (e) => {
        const region = tab.parentElement;
        const tabs = Array.from(region.querySelectorAll(".tab"));
        const i = tabs.indexOf(tab);
        let next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === "Home") next = tabs[0];
        else if (e.key === "End") next = tabs[tabs.length - 1];
        else if (e.key === "Delete") { e.preventDefault(); close(path); return; }
        if (next) {
          e.preventDefault();
          setRoving(next);
          next.focus();
          activate(next.dataset.path);
        }
      });
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1 && !pinned.has(path)) { e.preventDefault(); close(path); }
      });
      tab.addEventListener("contextmenu", (e) => { e.preventDefault(); openMenu(path, e); });
      (pinned.has(path) ? pinEl : listEl).appendChild(tab);
    });
    // The pinned region takes no space while nothing is pinned. A pinned ghost
    // still needs the region visible to play its close, so it counts as
    // occupied.
    syncPinnedRegion();
    materializeGhosts();         // ghost slots hold a closed tab's position
    [pinEl, listEl].forEach((region) => {
      if (region === pinEl && pinEl.hidden) return;
      const tabs = region.querySelectorAll(".tab");
      if (tabs.length && !region.querySelector('.tab[tabindex="0"]')) tabs[0].tabIndex = 0;
    });
    applyFrozenWidths();
    listEl.scrollLeft = savedScroll;
    if (pinEl !== listEl) pinEl.scrollLeft = savedPinnedScroll;
  }

  /* Reveal the active unpinned tab only enough to bring it fully inside the
   * strip. Called from activate(), never from render(), so a watcher tick or
   * a pin toggle cannot yank the user's scroll position. Re-activating the
   * already-active tab still reveals it, because its tab may have been
   * scrolled out of view. */
  function revealActiveTab() {
    if (!activePath || pinned.has(activePath)) return;
    const tab = listEl.querySelector('.tab[data-path="' + cssEscape(activePath) + '"]');
    if (!tab || !listEl.clientWidth) return;
    const strip = listEl.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < strip.left) listEl.scrollLeft -= strip.left - box.left;
    else if (box.right > strip.right) listEl.scrollLeft += box.right - strip.right;
  }

  function emitChanged() {
    NB.evt.emit("tabs:changed", {
      openFiles: ordered.slice(),
      activeFile: activePath,
      pinnedFiles: ordered.filter(p => pinned.has(p)),
      sessions: snapshot(),
      activeSessionId,
    });
  }

  /* Remove a path from the active strip (no re-activate). The viewer cache,
   * draft and watcher baseline survive while another session or a pin still
   * holds the path: the same note may be open in several sessions. */
  function dropTab(path) {
    const elsewhere = hasStoredPath(path);
    const idx = ordered.indexOf(path);
    if (idx >= 0) ordered.splice(idx, 1);
    openSet.delete(path);
    pinned.delete(path);
    if (frozenWidths) frozenWidths.delete(path);   // drop the stale width pin
    if (elsewhere) return;
    conflictSet.delete(path);                      // a closed path has no badge
    if (isSpecial(path)) {
      const spec = specialTabs.get(path);
      if (spec && spec.onClose) { try { spec.onClose(path); } catch (e) { console.error(e); } }
    } else {
      NB.viewer.close(path);
    }
  }
  function pickNeighbor(idx) {
    return ordered[idx] || ordered[idx - 1] || ordered[0] || null;
  }

  /* --- session swap -------------------------------------------------- */
  /* The only way the live view becomes another session. Both activation
   * tokens are bumped first so an in-flight tab activation cannot install a
   * file that no longer belongs to the strip, and so a pending viewer fetch
   * seeds the cache without touching the DOM or emitting file:open. The
   * commit's boolean is checked: a failed hybrid save leaves hybrid active,
   * and switching anyway would serialize the next keystroke to the old
   * path. Mutate before emitting so app.js snapshots a consistent state. */
  async function swapTo(id) {
    if (id === activeSessionId) return true;
    if (sessionOrder.indexOf(id) < 0) return false;
    const token = ++sessionToken;
    const stale = () => token !== sessionToken;

    activateToken++;
    if (NB.viewer && NB.viewer.cancelActivation) NB.viewer.cancelActivation();

    const ok = (NB.viewer && NB.viewer.commitForTabSwitch)
      ? await NB.viewer.commitForTabSwitch() : true;
    // The target may have been deleted while the commit was in flight, and a
    // later pick wins over this one.
    if (!ok || stale() || sessionOrder.indexOf(id) < 0) return false;

    storeOutgoing();
    activeSessionId = id;
    installSession(id);
    finishGhosts();               // no ghost from the old strip survives
    frozenWidths = null;          // the new strip measures itself

    render();
    emitChanged();
    if (!ordered.length) {
      if (NB.viewer && NB.viewer.showSessionEmpty) NB.viewer.showSessionEmpty();
      return true;
    }
    await activate(activePath);
    return true;
  }

  /* --- open / activate / close --------------------------------------- */
  /* Guards activate() against overlapping async activations: two rapid
   * tab clicks can both be awaiting viewer.activate (an uncached file
   * fetch); whichever resolves LAST must not be allowed to flip
   * activePath back to the stale, earlier click's file. Each activate
   * bumps the token; a call that resumes with a stale token abandons
   * the switch and leaves the display to the newer call. */
  let activateToken = 0;
  async function activate(path) {
    if (!openSet.has(path)) return;
    const token = ++activateToken;
    const isStale = () => token !== activateToken;
    // A tab switch always exits edit mode (hybrid or plain editor). A
    // dirty file prompts to save; on Cancel, stay on the current tab in
    // edit mode. On OK, save then exit edit mode and proceed.
    if (path !== activePath && NB.viewer && NB.viewer.commitForTabSwitch) {
      const ok = await NB.viewer.commitForTabSwitch();
      if (!ok || isStale()) return;
    }
    // Special tabs don't go through viewer.activate; they own their
    // own content-area container. The viewer hides itself + welcome so
    // the special view's container is the only visible sibling in
    // #edit-split. onActivate receives the id so the view can show /
    // refresh itself.
    if (isSpecial(path)) {
      const spec = specialTabs.get(path);
      // Tell the viewer to step aside (hide #viewer + #welcome + #cm-host).
      if (NB.viewer && NB.viewer.showSpecial) NB.viewer.showSpecial();
      activePath = path;
      render();
      revealActiveTab();
      emitChanged();
      if (spec && spec.onActivate) { try { spec.onActivate(path); } catch (e) { console.error(e); } }
      return;
    }
    // Switching FROM a special tab TO a file: the special tab's container
    // is still visible; showViewer (called below) restores #viewer. The
    // special tab's onClose hides its container when it sees the file:open
    // event or its own onActivate(false) -- simpler: each special view
    // listens for "file:open" to hide itself, so we just emit it below.
    try {
      await NB.viewer.activate(path);
      if (isStale()) return;   // a newer click took over mid-fetch
      if (!openSet.has(path)) {
        NB.viewer.close(path);
        if (ordered.length) activate(ordered[0]);
        else NB.viewer.showSessionEmpty();
        return;
      }
      activePath = path;
      render();
      revealActiveTab();
      emitChanged();
    } catch (e) {
      if (isStale()) return;
      const idx = ordered.indexOf(path);
      dropTab(path);
      const next = pickNeighbor(idx);
      if (next) { await activate(next); }
      else { activePath = null; NB.viewer.showSessionEmpty(); render(); emitChanged(); }
    }
  }

  async function open(path, opts) {
    opts = opts || {};
    const doActivate = opts.activate !== false;
    // Open in the ACTIVE session, even when another session already has the
    // same note: a path may be open in several sessions, and clicking a file
    // must never yank the user to another session.
    if (!openSet.has(path)) {
      if (unpinnedCount() >= SESSION_FILES_MAX) {
        notify(SESSION_FULL_MESSAGE);
        return false;
      }
      openSet.add(path);
      ordered.push(path);
    }
    if (doActivate) { await activate(path); }
    else { render(); emitChanged(); }
    return true;
  }

  function close(path, opts) {
    opts = opts || {};
    if (!openSet.has(path)) return;
    // Hybrid (WYSIWYG) edits live in the contentEditable DOM, not the
    // viewer cache, so viewer.isDirty() can't see them. Hybrid always
    // edits the ACTIVE tab's file (enter() grabs viewer.getPath()), so
    // when that tab is being closed, fold hybrid's dirty flag into the
    // confirm and exit hybrid mode -- otherwise the edits vanish with
    // no prompt and the hybrid listeners + contenteditable attribute
    // leak onto whatever file opens next.
    const hybridEditing = (activePath === path && NB.hybrid &&
                            NB.hybrid.isActive && NB.hybrid.isActive());
    // Confirm before discarding unsaved edits (skipped for force-close on
    // delete, and for special tabs which have no edit state).
    if (!opts.force && !isSpecial(path) &&
        (NB.viewer.isDirty(path) ||
         (hybridEditing && NB.hybrid.isDirty && NB.hybrid.isDirty()))) {
      if (!confirm('Close "' + baseName(path) + '"? Unsaved changes will be lost.')) return;
    }
    if (hybridEditing) {
      // Discard-mode exit. The user already confirmed (or this is a
      // force close); exit unwires the listeners + contenteditable
      // synchronously. exit's trailing re-activate sees the tab still
      // open and re-renders this file in preview mode, then the close
      // proceeds below as usual.
      NB.hybrid.exit(false);
    }
    const idx = ordered.indexOf(path);
    const wasActive = (activePath === path);
    // Capture the survivors' pre-close widths for the reflow animation. After
    // the confirms (a cancelled close arms nothing) and before dropTab (the
    // old nodes are the "from" widths). Skipped for an active-tab close:
    // activate(next) lands a second render() that would kill the animation, so
    // that path stays instant. captureCloseReflow self-returns null when frozen.
    // A ghost close (pointer inside the bar, motion allowed) also skips the
    // reflow: the ghost holds the slot, so there is nothing to slide yet.
    const ghostClose = frozenWidths !== null && !prefersReducedMotion();
    const reflow = (wasActive || ghostClose) ? null : captureCloseReflow(path);
    if (ghostClose) addGhost(path, idx);   // measure the node before dropTab
    dropTab(path);

    if (wasActive) {
      const next = pickNeighbor(idx);
      activePath = null;
      // The ghost is DATA, so it survives the activate(next) render below.
      render();            // immediately drop the closed tab + clear active
      emitChanged();
      if (next) { activate(next); }   // async: load + re-render neighbor
      else { NB.viewer.showSessionEmpty(); }
    } else {
      render();
      if (!ghostClose) animateReflow(reflow);
      emitChanged();
    }
  }

  /* Re-key every member of a Set whose path is `from` or below it. */
  function rekeyMembers(set, remap) {
    for (const p of Array.from(set)) {
      const mapped = remap(p);
      if (mapped === null) continue;
      set.delete(p);
      set.add(mapped);
    }
  }

  function rename(from, to) {
    if (from === to) return;
    const prefix = from + "/";
    const remap = (p) => p === from
      ? to
      : (p.startsWith(prefix) ? to + p.slice(from.length) : null);
    // Every pair that must reach viewer.rename, live or only stored: a file
    // that exists only in an inactive session still carries its cache entry,
    // draft and watcher baseline.
    const pairs = [];
    const seenPairs = new Set();
    const notePair = (p) => {
      const mapped = remap(p);
      if (mapped === null) return;
      const key = p + "\n" + mapped;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      pairs.push({ from: p, to: mapped });
    };
    // A folder move re-keys every open note under it, preserving order.
    let liveChanged = false;
    for (let i = 0; i < ordered.length; i++) {
      const mapped = remap(ordered[i]);
      if (mapped === null) continue;
      notePair(ordered[i]);
      ordered[i] = mapped;
      liveChanged = true;
    }
    // Re-key every stored session's tab list and its active tab. Without this
    // a rename in a hidden session leaves an orphan tab in the record.
    for (const rec of storedSessions.values()) {
      const files = rec.openFiles || [];
      for (let i = 0; i < files.length; i++) {
        const mapped = remap(files[i]);
        if (mapped === null) continue;
        notePair(files[i]);
        files[i] = mapped;
      }
      if (rec.activeFile) {
        const mapped = remap(rec.activeFile);
        if (mapped !== null) { notePair(rec.activeFile); rec.activeFile = mapped; }
      }
    }
    if (!pairs.length) return;
    // A conflict flag can outlive the live strip: closing one occurrence keeps
    // it while another session still holds the path, so re-key it whether or
    // not the live strip changed (a no-op when nothing matches).
    rekeyMembers(conflictSet, remap);
    if (liveChanged) {
      rekeyMembers(openSet, remap);
      rekeyMembers(pinned, remap);
      // Carry the frozen width across the re-key so a rename while the pointer
      // is in the bar does not re-equalize the renamed tab alone.
      if (frozenWidths) {
        const widths = [];
        for (const [p, w] of frozenWidths) {
          const mapped = remap(p);
          if (mapped !== null) widths.push([mapped, w]);
        }
        for (const [p] of Array.from(frozenWidths)) {
          if (remap(p) !== null) frozenWidths.delete(p);
        }
        for (const [p, w] of widths) frozenWidths.set(p, w);
      }
      const mappedActive = activePath ? remap(activePath) : null;
      if (mappedActive !== null) activePath = mappedActive;
    }
    for (const pair of pairs) NB.viewer.rename(pair.from, pair.to);
    render();
    emitChanged();
  }

  /* --- pin / unpin --------------------------------------------------- */
  function togglePin(path) {
    if (!openSet.has(path)) return;
    const i = ordered.indexOf(path);
    if (i < 0) return;
    if (pinned.has(path)) {
      pinned.delete(path);
      ordered.splice(i, 1);
      ordered.splice(pinnedCount(), 0, path);     // start of unpinned section
    } else {
      pinned.add(path);
      // Pinning is what makes a tab shared: it leaves every session's own
      // list, and a session that had it active falls back to its neighbour.
      for (const rec of storedSessions.values()) removeStoredFile(rec, path);
      ordered.splice(i, 1);
      ordered.splice(pinnedCount() - 1, 0, path); // end of pinned section
    }
    render();
    emitChanged();
  }

  /* --- session operations -------------------------------------------- */
  /* Every mutation ends in render() + emitChanged(): that is what marks the
   * state dirty for app.js (persistConfig -> scheduleWorkspaceState). */
  function closeStoredPath(path) {
    // Another session or the active strip may still hold the same note; then
    // its cache entry, draft and watcher baseline must stay.
    if (openSet.has(path) || pinned.has(path) || hasStoredPath(path)) return;
    // A closed path keeps no conflict badge (same rule as dropTab).
    conflictSet.delete(path);
    if (isSpecial(path)) {
      const spec = specialTabs.get(path);
      if (spec && spec.onClose) { try { spec.onClose(path); } catch (e) { console.error(e); } }
    } else {
      NB.viewer.close(path);   // also forgets the watcher baseline
    }
  }

  async function createSession(name) {
    const check = validateSessionName(name, null);
    if (!check.ok) return check;
    if (sessionOrder.length >= SESSION_MAX_COUNT) {
      return { ok: false, code: "limit", message: SESSION_LIMIT_MESSAGE };
    }
    const id = generateSessionId(cand => sessionOrder.indexOf(cand) >= 0);
    sessionOrder.push(id);
    sessionNames.set(id, check.name);
    storedSessions.set(id, { openFiles: [], activeFile: null });
    await swapTo(id);        // the header + switches to the new session
    return { ok: true, code: "", id, name: check.name };
  }

  /* Create from the tab menu's "New session…": the tab moves into the new
   * session and the source stays active (requirements AC28). */
  async function createSessionFromTab(path, name) {
    const check = validateSessionName(name, null);
    if (!check.ok) return check;
    if (sessionOrder.length >= SESSION_MAX_COUNT) {
      return { ok: false, code: "limit", message: SESSION_LIMIT_MESSAGE };
    }
    if (pinned.has(path) || !openSet.has(path)) return { ok: false, code: "missing" };
    const id = generateSessionId(cand => sessionOrder.indexOf(cand) >= 0);
    sessionOrder.push(id);
    sessionNames.set(id, check.name);
    storedSessions.set(id, { openFiles: [], activeFile: null });
    await moveToSession(path, id);
    return { ok: true, code: "", id, name: check.name };
  }

  function moveSession(id, delta) {
    const i = sessionOrder.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= sessionOrder.length) return false;
    sessionOrder.splice(i, 1);
    sessionOrder.splice(j, 0, id);
    render();
    emitChanged();
    return true;
  }

  function renameSession(id, name) {
    if (sessionOrder.indexOf(id) < 0) return { ok: false, code: "missing" };
    const check = validateSessionName(name, id);
    if (!check.ok) return check;
    sessionNames.set(id, check.name);
    render();
    emitChanged();
    return { ok: true, code: "", name: check.name };
  }

  async function deleteSession(id) {
    if (sessionOrder.length === 1) return false;
    const idx = sessionOrder.indexOf(id);
    if (idx < 0) return false;
    // Invalidate any swap already targeting this row, including the stored
    // branch below, which has no await of its own.
    const token = ++sessionToken;
    if (id !== activeSessionId) {
      // A stored session is the only path that closes cached files the user
      // cannot see. Remove the record first, then close only the paths no
      // other session or pin still holds.
      const rec = storedSessions.get(id);
      storedSessions.delete(id);
      sessionNames.delete(id);
      sessionOrder.splice(idx, 1);
      if (rec) (rec.openFiles || []).forEach(closeStoredPath);
      render();
      emitChanged();
      return true;
    }
    // Active session: stop every in-flight activation and honour a failed
    // hybrid commit before anything is dropped.
    activateToken++;
    if (NB.viewer && NB.viewer.cancelActivation) NB.viewer.cancelActivation();
    const ok = await NB.viewer.commitForTabSwitch();
    if (!ok || token !== sessionToken) return false;
    ordered.filter(p => !pinned.has(p)).forEach(p => dropTab(p));  // no prompts
    storedSessions.delete(id);
    sessionNames.delete(id);
    sessionOrder.splice(idx, 1);
    const nextId = sessionOrder[idx - 1] || sessionOrder[idx] || sessionOrder[0];
    activeSessionId = nextId;
    installSession(nextId);      // no outgoing record to save
    finishGhosts();
    frozenWidths = null;
    render();
    emitChanged();
    if (activePath) await activate(activePath);
    else NB.viewer.showSessionEmpty();
    return true;
  }

  async function moveToSession(path, id) {
    if (id === activeSessionId) return false;
    if (sessionOrder.indexOf(id) < 0) return false;
    if (!openSet.has(path) || pinned.has(path)) return false;
    // The moved tab may be the active one and in edit mode. Stash/exit before
    // the strip changes, so a failed hybrid save leaves everything where it is
    // (the buffer then travels with the file, as the cache entry does).
    if (path === activePath && NB.viewer && NB.viewer.commitForTabSwitch) {
      const ok = await NB.viewer.commitForTabSwitch();
      if (!ok) return false;
      // Re-check after the await: a concurrent close or switch wins.
      if (!openSet.has(path) || pinned.has(path)) return false;
      if (id === activeSessionId || sessionOrder.indexOf(id) < 0) return false;
    }
    const rec = storedSessions.get(id) || { openFiles: [], activeFile: null };
    const files = rec.openFiles || (rec.openFiles = []);
    // The target may already have the note; then this is just a removal from
    // the source, not an add, and the cap does not apply.
    const present = files.indexOf(path) >= 0;
    if (!present && files.length >= SESSION_FILES_MAX) {
      notify(SESSION_FULL_MESSAGE);
      return false;
    }
    // Not a close: the viewer cache entry and any stashed draft stay with the
    // file, so both travel to the target session.
    const idx = ordered.indexOf(path);
    ordered.splice(idx, 1);
    openSet.delete(path);
    if (frozenWidths) frozenWidths.delete(path);
    if (!present) {
      const wasEmpty = files.length === 0;
      files.push(path);
      if (wasEmpty) rec.activeFile = path;
      storedSessions.set(id, rec);
    }

    if (activePath !== path) {
      render();
      emitChanged();
      return true;
    }
    // The source's active tab left it: activate the neighbour, else the
    // source stays active and renders its own empty state.
    activePath = null;
    const next = pickNeighbor(idx);
    render();
    emitChanged();
    if (next) await activate(next);
    else if (NB.viewer && NB.viewer.showSessionEmpty) NB.viewer.showSessionEmpty();
    return true;
  }

  /* --- drag-and-drop reorder ----------------------------------------- */
  function onDragStart(e) {
    if (e.target.closest && e.target.closest(".tab-close")) { e.preventDefault(); return; }
    const tab = targetTab(e);
    if (!tab || !tab.dataset.path) return;
    draggingPath = tab.dataset.path;
    tab.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", draggingPath); } catch (_) {}
    }
  }

  function onDragOver(e) {
    if (!draggingPath) return;
    const tab = targetTab(e);
    if (!tab) return;                       // over empty bar area -> handled on drop
    e.preventDefault();                     // allow a drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    const rect = tab.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    tab.classList.add(before ? "drop-before" : "drop-after");
  }

  function onDrop(e) {
    if (!draggingPath) return;
    e.preventDefault();
    const tab = targetTab(e);
    let targetPath = null, before = true;
    if (tab && tab.dataset.path) {
      targetPath = tab.dataset.path;
      const rect = tab.getBoundingClientRect();
      before = e.clientX < rect.left + rect.width / 2;
    }
    dropOnto(draggingPath, targetPath, before);
    clearDragging();
  }

  /* Reorder `path` to land before/after `targetPath` (or at the end when
   * targetPath is null, i.e. dropped on empty bar area). Clamps to the
   * dragged tab's segment so a pinned tab stays in the pinned block and an
   * unpinned tab stays after it. */
  function dropOnto(path, targetPath, before) {
    if (!path || path === targetPath) { render(); return; }
    const di = ordered.indexOf(path);
    if (di < 0) return;
    ordered.splice(di, 1);
    let ti;
    if (targetPath == null) {
      ti = ordered.length;
    } else {
      ti = ordered.indexOf(targetPath);
      if (ti < 0) { ordered.splice(di, 0, path); return; }   // target vanished -> abort
      if (!before) ti += 1;
    }
    if (pinned.has(path)) ti = Math.max(0, Math.min(ti, pinnedCount() - 1));
    else                  ti = Math.max(pinnedCount(), Math.min(ti, ordered.length));
    ordered.splice(ti, 0, path);
    render();
    emitChanged();
  }

  function clearDropMarks() {
    barEl.querySelectorAll(".drop-before,.drop-after")
      .forEach(t => t.classList.remove("drop-before", "drop-after"));
  }
  function clearDragging() {
    draggingPath = null;
    barEl.querySelectorAll(".dragging").forEach(t => t.classList.remove("dragging"));
    clearDropMarks();
  }

  barEl.addEventListener("dragstart", onDragStart);
  barEl.addEventListener("dragover", onDragOver);
  barEl.addEventListener("drop", onDrop);
  barEl.addEventListener("dragend", clearDragging);   // also covers Esc / window-leave

  /* End the release as soon as the last tab finishes. Accept events that name
   * the release keyframes; also accept an unnamed synthetic event, since a
   * real browser always sets animationName but the jsdom harness dispatches a
   * plain Event. Other named animations are ignored. */
  barEl.addEventListener("animationend", (e) => {
    if (!e.animationName || e.animationName === RELEASE_ANIM) stopRelease();
  });

  /* --- width freeze while the pointer is inside the bar -------------- */
  /* While the pointer is anywhere in the tab bar, pin every tab to its
   * current width so closing one does not re-equalize the strip and move the
   * next close button out from under the cursor. Released when the pointer
   * leaves the bar (mouseleave fires only on exit from the bar, unlike
   * mouseout), so the tabs re-equalize once the user is done. */
  barEl.addEventListener("mouseenter", () => {
    if (frozenWidths) return;
    // Measure before cancelling: if a release is mid-flight this captures the
    // tabs' current animated widths, so re-entry freezes there instead of
    // snapping to the final equal width.
    frozenWidths = new Map();
    captureFrozenWidths();
    stopRelease();
    applyFrozenWidths();
  });
  barEl.addEventListener("mouseleave", unfreezeWidths);

  /* True while tab widths are pinned (pointer inside the bar). Exposed for
   * the DOM harness, which drives pointer events without a real hit-test. */
  function isWidthFrozen() { return frozenWidths !== null; }

  /* True while the release re-equalization is playing. Exposed for the DOM
   * harness alongside isWidthFrozen. */
  function isReleasing() { return barEl.classList.contains(RELEASE_CLASS); }

  /* Number of ghost close slots currently tracked. Exposed for the DOM
   * harness, which cannot see the fade in jsdom. */
  function ghostCount() { return ghosts.length; }
  function isGhosting() { return ghosts.length > 0; }

  /* --- wheel scrolling of the two tab regions ------------------------ */
  /* The pinned region and the strip both scroll on X only, so a vertical
   * wheel over them must be translated onto their scrollLeft. Only when the
   * region under the pointer actually overflows; otherwise the event is left
   * to the browser. A ctrl+wheel (pinch-zoom) is left alone too, so zoom over
   * the bar still reaches the page. */
  function onTabWheel(e) {
    if (e.ctrlKey) return;
    const start = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
    const region = start && start.closest ? start.closest(".tab-list, .tab-pinned") : null;
    if (!region || region.scrollWidth <= region.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!delta) return;
    e.preventDefault();
    let px = delta;
    if (e.deltaMode === WHEEL_DELTA_LINE) px *= WHEEL_LINE_PX;
    else if (e.deltaMode === WHEEL_DELTA_PAGE) px *= region.clientWidth;
    // "instant" overrides the CSS scroll-behavior: smooth, so each wheel notch
    // tracks the wheel instead of starting a fresh smooth animation from the
    // strip's current position.
    region.scrollBy({ left: px, behavior: "instant" });
  }
  barEl.addEventListener("wheel", onTabWheel, { passive: false });

  /* --- bulk close (close others / right / left) ---------------------- */
  /* `paths` is already filtered to exclude pinned tabs. Confirms once if any
   * of the targets is dirty, then force-closes them. */
  function closeMany(paths) {
    if (!paths.length) return;
    const dirty = paths.filter(p => NB.viewer.isDirty(p));
    if (dirty.length) {
      const names = dirty.map(baseName).join(", ");
      if (!confirm("Close " + paths.length + " tab(s)? Unsaved changes in: " + names)) return;
    }
    // snapshot: close() splices `ordered` mid-iteration
    paths.slice().forEach(p => close(p, { force: true }));
  }

  // Close every open tab without prompting (used when the session
  // expires or the notebook is locked: we drop all paths so the tab
  // bar doesn't keep showing files the user can no longer read).
  function clearAll() {
    // Drop hybrid mode too if it's on: its contentEditable + listeners
    // target the file being dropped, and the auth-lock flow wipes the
    // viewer right after -- leaving hybrid on would re-edit stale DOM.
    if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) {
      NB.hybrid.exit(false);
    }
    // Clear the stored sessions first so dropTab() closes every live path
    // (it skips a path another session still holds). A stored special tab's
    // module is stopped here; viewer.clear() below drops the file caches.
    for (const rec of storedSessions.values()) {
      for (const p of rec.openFiles || []) {
        if (!isSpecial(p)) continue;
        const spec = specialTabs.get(p);
        if (spec && spec.onClose) { try { spec.onClose(p); } catch (e) { console.error(e); } }
      }
      rec.openFiles = [];
      rec.activeFile = null;
    }
    ordered.slice().forEach(p => dropTab(p));
    activePath = null;
    finishGhosts();   // no stale slots survive a full clear (auth lock, etc.)
    if (NB.viewer && NB.viewer.clear) NB.viewer.clear();
    render();
    emitChanged();
  }

  function closeOthers(path) {
    closeMany(ordered.filter(p => p !== path && !pinned.has(p)));
  }
  function closeRight(path) {
    const i = ordered.indexOf(path);
    if (i < 0) return;
    closeMany(ordered.slice(i + 1).filter(p => !pinned.has(p)));
  }
  function closeLeft(path) {
    const i = ordered.indexOf(path);
    if (i < 0) return;
    closeMany(ordered.slice(0, i).filter(p => !pinned.has(p)));
  }

  /* --- tab context menu --------------------------------------------- */
  /* The "Move to session" submenu: every other session by name in creation
   * order, then New session… after a separator. A pinned tab is already in
   * every session, so it gets no item; a viewer may switch, not move. Built
   * only when sessions.js is present, so an older cached shell still works. */
  function sessionMenuItems(path) {
    if (!NB.sessions || pinned.has(path)) return null;
    const items = getSessionList()
      .filter(s => s.id !== activeSessionId)
      .map(s => ({ label: s.name, handler: () => NB.sessions.moveTo(path, s.id) }));
    // The separator belongs to the list; with no other session the submenu is
    // just New session… and a leading rule would be noise.
    if (items.length) items.push({ separator: true });
    items.push({ label: "New session…", handler: () => NB.sessions.newFromTab(path) });
    const item = { label: "Move to session", submenu: items };
    if (NB.pageRole && NB.pageRole() !== "admin") {
      item.disabled = true;
      item.title = "Read-only: sessions can’t be changed.";
    }
    return item;
  }

  /* Categories, canonical order: Organize (Pin/Unpin, Export…, file ops,
   * bookmark) | View (Show in file sidebar) | Terminal (close variants,
   * Delete). A tab creates no files, so there is no Open or Create group. */
  function tabMenuItems(path) {
    const i = ordered.indexOf(path);
    const others = ordered.filter(p => p !== path && !pinned.has(p));
    const right  = ordered.slice(i + 1).filter(p => !pinned.has(p));
    const left   = ordered.slice(0, i).filter(p => !pinned.has(p));
    const bookmarked = !!(NB.sidebar && NB.sidebar.getBookmarks &&
      NB.sidebar.getBookmarks().includes(path));
    const moveItem = sessionMenuItems(path);
    return [
      { label: pinned.has(path) ? "Unpin" : "Pin", handler: () => togglePin(path) },
      ...(moveItem ? [moveItem] : []),
      { label: "Export…", handler: () => { if (NB.export && NB.export.open) NB.export.open(path); } },
      { label: "Rename / Move…", handler: () => sidebarOp("renameFile", path) },
      { label: "Copy…", handler: () => sidebarOp("copyFile", path) },
      { label: "Copy path", handler: () => NB.app.copyPath(path) },
      { label: "Copy link", handler: () => NB.app.copyLink(path) },
      { label: bookmarked ? "Remove bookmark" : "Add bookmark",
        handler: () => sidebarOp("toggleBookmark", path) },
      { separator: true },
      { label: "Show in file sidebar",
        handler: () => { if (NB.sidebar && NB.sidebar.revealFile) NB.sidebar.revealFile(path); } },
      { separator: true },
      { label: "Close", danger: true, handler: () => close(path) },
      { label: "Close others", disabled: !others.length,
        title: "No other closable tabs", handler: () => closeOthers(path) },
      { label: "Close to the right", disabled: !right.length,
        title: "No closable tabs to the right", handler: () => closeRight(path) },
      { label: "Close to the left", disabled: !left.length,
        title: "No closable tabs to the left", handler: () => closeLeft(path) },
      { label: "Delete", danger: true, handler: () => sidebarOp("deleteFile", path) },
    ];
  }

  function sidebarOp(name, path) {
    if (NB.sidebar && typeof NB.sidebar[name] === "function") NB.sidebar[name](path);
  }

  function openMenu(path, e) {
    NB.menu.open({
      owner: "tabs", x: e.clientX, y: e.clientY, scope: barEl,
      items: tabMenuItems(path), focusFirst: true,
    });
  }

  /* --- restore on boot ----------------------------------------------- */
  /* openFiles/activeFile/pinnedFiles come from config. We populate the tab
   * bar without fetching; only the active file is loaded eagerly (others
   * fetch lazily on first activation). `fallback` is used when nothing is
   * open yet — and only on the first boot after the upgrade, so an empty
   * session stays empty afterwards.
   *
   * `sessionState` is normaliseSessions()' output. Without it the four
   * positional arguments behave exactly as before and one "Main" session is
   * seeded, so a phone rotating into the desktop shell still has a model. */
  async function restore(openFiles, activeFile, fallback, pinnedFiles, sessionState) {
    if (sessionState) {
      installSessionState(sessionState);
      if (!ordered.length) {
        if (fallback) { await open(fallback); return; }
        render();
        emitChanged();
        NB.viewer.showSessionEmpty();
        return;
      }
      render();
      if (activePath) await activate(activePath);
      else NB.viewer.showSessionEmpty();
      return;
    }

    sessionOrder = [SESSION_DEFAULT_ID];
    sessionNames.clear();
    sessionNames.set(SESSION_DEFAULT_ID, SESSION_DEFAULT_NAME);
    storedSessions.clear();
    activeSessionId = SESSION_DEFAULT_ID;

    (openFiles || []).forEach(p => {
      // A saved special tab whose module no longer registers (e.g. a
      // retired §search) would show a blank content area. Drop it.
      if (isSpecial(p) && !specialTabs.has(p)) return;
      if (!openSet.has(p)) { openSet.add(p); ordered.push(p); }
    });
    (pinnedFiles || []).forEach(p => { if (openSet.has(p)) pinned.add(p); });
    segment();     // enforce pinned-first invariant

    if (!ordered.length) {
      if (fallback) { await open(fallback); return; }
      NB.viewer.clear(); render(); emitChanged();
      return;
    }
    let startActive = (activeFile && openSet.has(activeFile)) ? activeFile : ordered[0];
    render();
    await activate(startActive);
  }

  /* Seed the model and the live view from normaliseSessions()' output. The
   * tree may have changed since normalisation, so each session is filtered
   * again: a vanished path is dropped, never the session. */
  function installSessionState(state) {
    ordered.length = 0;
    openSet.clear();
    pinned.clear();
    storedSessions.clear();
    sessionNames.clear();
    sessionOrder = [];

    for (const p of (state.pinnedFiles || [])) {
      if (!liveTreeAllows(p) || pinned.has(p)) continue;
      pinned.add(p);
      ordered.push(p);
      openSet.add(p);
    }

    const records = [];
    for (const s of (state.sessions || [])) {
      const files = (s.openFiles || []).filter(liveTreeAllows);
      const rec = { openFiles: files, activeFile: s.activeFile || null };
      if (rec.activeFile && !liveTreeAllows(rec.activeFile) && !pinned.has(rec.activeFile)) {
        rec.activeFile = files[0] || null;
      }
      sessionOrder.push(s.id);
      sessionNames.set(s.id, s.name);
      records.push([s.id, rec]);
    }

    if (!sessionOrder.length) {
      sessionOrder = [SESSION_DEFAULT_ID];
      sessionNames.set(SESSION_DEFAULT_ID, SESSION_DEFAULT_NAME);
      records.push([SESSION_DEFAULT_ID, { openFiles: [], activeFile: null }]);
    }
    for (const [id, rec] of records) storedSessions.set(id, rec);

    activeSessionId = sessionOrder.indexOf(state.activeSessionId) >= 0
      ? state.activeSessionId : sessionOrder[0];
    installSession(activeSessionId);
  }

  function getActive() { return activePath; }
  function getOpen() { return ordered.slice(); }
  function isOpen(path) { return openSet.has(path); }

  // Cycle to the previous / next tab. No-op if there's only one
  // (or zero) tab. Returns the new active path, or null.
  async function prev() {
    if (ordered.length < 2) return activePath;
    const i = ordered.indexOf(activePath);
    const ni = (i <= 0) ? ordered.length - 1 : i - 1;
    await activate(ordered[ni]);
    return ordered[ni];
  }
  async function next() {
    if (ordered.length < 2) return activePath;
    const i = ordered.indexOf(activePath);
    const ni = (i < 0 || i === ordered.length - 1) ? 0 : i + 1;
    await activate(ordered[ni]);
    return ordered[ni];
  }

  NB.tabs = {
    /* Model limits, exported so the Sessions view's cap and name validation
     * cannot drift from the model's. */
    limits: {
      maxSessions: SESSION_MAX_COUNT,
      nameMax: SESSION_NAME_MAX,
      filesMax: SESSION_FILES_MAX,
    },
    open, close, activate, rename, restore, getActive, getOpen, isOpen, render,
    togglePin, isPinned, closeOthers, closeRight, closeLeft, prev, next, clearAll,
    /* True while the pointer is inside the tab bar and tab widths are pinned.
     * Exposed so the DOM harness can assert the freeze/release behavior. */
    isWidthFrozen,
    isReleasing,
    /* Ghost close slots (an inert placeholder holding a closed tab's space
     * while the pointer is in the bar). Exposed so the DOM harness can assert
     * the ghost lifecycle. */
    isGhosting,
    ghostCount,
    /* Sessions. The active session is the live view above; these expose the
     * model and the operations the Sessions view and the tab menu drive. */
    normaliseSessions,
    getSessionList,
    getActiveSessionId,
    snapshot,
    swapTo,
    createSession,
    createSessionFromTab,
    moveSession,
    renameSession,
    deleteSession,
    moveToSession,
    /* Register a special tab type. `def` = { id, icon, label, onActivate, onClose }.
     * id must start with "§". onActivate(id) is called when the tab becomes
     * active; onClose(id) when it's closed. Re-registering the same id
     * replaces the definition (used by hot reload / test reset). */
    registerSpecial(def) {
      if (!def || !def.id || !def.id.startsWith("§")) return;
      specialTabs.set(def.id, def);
    },
    /* Open a special tab (by id) and activate it. If it's already open in
     * another session, switch there first, so a special tab follows the same
     * one-owner rule as a file tab. */
    async openSpecial(id) {
      if (!specialTabs.has(id)) return;
      // Like a file: open in the active session, never switch to a session
      // that already has it. A special tab may exist in several sessions.
      if (!openSet.has(id)) {
        if (unpinnedCount() >= SESSION_FILES_MAX) {
          notify(SESSION_FULL_MESSAGE);
          return;
        }
        openSet.add(id);
        ordered.push(id);
      }
      await activate(id);
    },
    isSpecial,
  };

  /* --- keep the bar in sync with viewer-driven changes --------------- */
  // Dirty dot while typing: toggle just the affected tab's class.
  NB.evt.on("viewer:dirty-changed", ({ path, dirty }) => {
    const el = barEl.querySelector('.tab[data-path="' + cssEscape(path) + '"]');
    if (el) el.classList.toggle("dirty", !!dirty);
  });

  // A file deleted from disk closes its tab (and, for a dir, any tab under it),
  // in every session. A hidden session's cache entry and draft go with it.
  NB.evt.on("file:deleted", (path) => {
    const prefix = path + "/";
    const matches = (p) => p === path || p.startsWith(prefix);
    ordered.filter(matches).forEach(p => close(p, { force: true }));

    let storedChanged = false;
    for (const rec of storedSessions.values()) {
      const dropped = (rec.openFiles || []).filter(matches);
      if (!dropped.length) continue;
      rec.openFiles = rec.openFiles.filter(p => !matches(p));
      dropped.forEach(closeStoredPath);
      if (rec.activeFile && matches(rec.activeFile)) {
        rec.activeFile = rec.openFiles[0] || null;
      }
      storedChanged = true;
    }
    if (storedChanged) emitChanged();
  });

  /* Re-key a tab when its file is moved/renamed; unsaved edits travel. */
  NB.evt.on("file:moved", ({ from, to }) => rename(from, to));

  // External disk change with unsaved local edits -> mark the tab as a
  // conflict. The badge is cleared on the next reload, save, or re-key.
  const conflictSet = new Set();
  NB.evt.on("viewer:conflict", ({ path, conflict }) => {
    if (conflict) conflictSet.add(path);
    else conflictSet.delete(path);
    render();
  });
  // A close or rename that drops the path from the open set also drops
  // its conflict flag (otherwise the badge would reappear on re-open).
  NB.evt.on("tabs:changed", () => {
    ordered.forEach(p => { if (!openSet.has(p)) conflictSet.delete(p); });
  });
  // When the notebook is locked (auth required, session gone), drop
  // every open tab so the bar doesn't keep showing files the user
  // is no longer authorized to read. The viewer / tree / search
  // content is wiped by auth.js on the same event. Names, ids, order and the
  // active id survive, so re-entering the workspace shows the same named,
  // empty places.
  NB.evt.on("auth:locked", () => {
    sessionToken++;   // a swap in flight must not install anything
    let clearedStored = false;
    for (const rec of storedSessions.values()) {
      if ((rec.openFiles || []).length || rec.activeFile) clearedStored = true;
      rec.openFiles = [];
      rec.activeFile = null;
    }
    const hadLive = ordered.length > 0;
    clearAll();
    if (!hadLive) {
      // clearAll no-ops without a live tab, but the lock invalidates every
      // buffer, including the stored sessions' cached drafts.
      if (NB.viewer && NB.viewer.clear) NB.viewer.clear();
      if (clearedStored) { render(); emitChanged(); }
    }
  });
})();