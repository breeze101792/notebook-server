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
  const menuEl = document.getElementById("tab-context-menu");
  // The outline toggle (#outline-toggle) is a sibling of both regions, at the
  // fixed right edge, so an overflowing tab can never overlap it. Drag/click
  // events bubble from either region up to #tab-bar, where the delegated
  // handlers live.
  const ordered = [];          // [path] in display order (pinned tabs first)
  const openSet = new Set();   // path membership
  const pinned = new Set();    // pinned paths (always a contiguous prefix of `ordered`)
  let activePath = null;

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

  function render() {
    stopRelease();               // an in-flight settle belongs to the old nodes
    captureFrozenWidths();       // measure before the old tab nodes are dropped
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
      tab.draggable = true;

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
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); close(path); });
        tab.appendChild(closeBtn);
      }

      tab.addEventListener("click", () => activate(path));
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
    applyFrozenWidths();
  }

  function emitChanged() {
    NB.evt.emit("tabs:changed", {
      openFiles: ordered.slice(),
      activeFile: activePath,
      pinnedFiles: [...pinned],
    });
  }

  /* Remove a path from the open set + cache (no re-activate). */
  function dropTab(path) {
    const idx = ordered.indexOf(path);
    if (idx >= 0) ordered.splice(idx, 1);
    openSet.delete(path);
    pinned.delete(path);
    if (frozenWidths) frozenWidths.delete(path);   // drop the stale width pin
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
        else NB.viewer.clear();
        return;
      }
      activePath = path;
      render();
      emitChanged();
    } catch (e) {
      if (isStale()) return;
      const idx = ordered.indexOf(path);
      dropTab(path);
      const next = pickNeighbor(idx);
      if (next) { await activate(next); }
      else { activePath = null; NB.viewer.clear(); render(); emitChanged(); }
    }
  }

  async function open(path, opts) {
    opts = opts || {};
    const doActivate = opts.activate !== false;
    if (!openSet.has(path)) { openSet.add(path); ordered.push(path); }
    if (doActivate) { await activate(path); }
    else { render(); emitChanged(); }
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
      else { NB.viewer.clear(); }
    } else {
      render();
      if (!ghostClose) animateReflow(reflow);
      emitChanged();
    }
  }

  function rename(from, to) {
    if (!openSet.has(from) || from === to) return;
    const idx = ordered.indexOf(from);
    ordered[idx] = to;
    openSet.delete(from); openSet.add(to);
    if (pinned.has(from)) { pinned.delete(from); pinned.add(to); }
    // Carry the frozen width across the re-key so a rename while the pointer
    // is in the bar does not re-equalize the renamed tab alone.
    if (frozenWidths && frozenWidths.has(from)) {
      frozenWidths.set(to, frozenWidths.get(from));
      frozenWidths.delete(from);
    }
    NB.viewer.rename(from, to);
    if (activePath === from) activePath = to;
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
      ordered.splice(i, 1);
      ordered.splice(pinnedCount() - 1, 0, path); // end of pinned section
    }
    render();
    emitChanged();
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
    if (!ordered.length) return;
    // Drop hybrid mode too if it's on: its contentEditable + listeners
    // target the file being dropped, and the auth-lock flow wipes the
    // viewer right after -- leaving hybrid on would re-edit stale DOM.
    if (NB.hybrid && NB.hybrid.isActive && NB.hybrid.isActive()) {
      NB.hybrid.exit(false);
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
  let menuPath = null;

  function openMenu(path, e) {
    menuPath = path;
    menuEl.innerHTML = "";

    const i = ordered.indexOf(path);
    const others = ordered.filter(p => p !== path && !pinned.has(p));
    const right  = ordered.slice(i + 1).filter(p => !pinned.has(p));
    const left   = ordered.slice(0, i).filter(p => !pinned.has(p));

    addMenuItem(pinned.has(path) ? "Unpin" : "Pin", () => togglePin(path));
    addMenuItem("Show in file sidebar", () => {
      if (NB.sidebar && NB.sidebar.revealFile) NB.sidebar.revealFile(path);
    });
    addMenuItem("Export…", () => {
      if (NB.export && NB.export.open) NB.export.open(path);
    });
    menuEl.appendChild(document.createElement("hr"));
    addMenuItem("Close", () => close(path), { danger: true });
    addMenuItem("Close others", () => closeOthers(path), { disabled: !others.length });
    addMenuItem("Close to the right", () => closeRight(path), { disabled: !right.length });
    addMenuItem("Close to the left", () => closeLeft(path), { disabled: !left.length });

    menuEl.hidden = false;
    positionMenu(e);
  }

  function addMenuItem(label, handler, opts) {
    opts = opts || {};
    const btn = document.createElement("button");
    btn.textContent = label;
    if (opts.danger) btn.classList.add("danger");
    if (opts.disabled) btn.disabled = true;
    btn.addEventListener("click", () => { hideMenu(); handler(); });
    menuEl.appendChild(btn);
  }

  function positionMenu(e) {
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - menuEl.offsetHeight - 10);
    menuEl.style.left = x + "px";
    menuEl.style.top = y + "px";
  }

  function hideMenu() { menuEl.hidden = true; menuPath = null; }
  document.addEventListener("click", hideMenu);
  document.addEventListener("contextmenu", (e) => {
    // a right-click that didn't start on a tab closes any open tab menu
    if (!barEl.contains(e.target)) hideMenu();
  });

  /* --- restore on boot ----------------------------------------------- */
  /* openFiles/activeFile/pinnedFiles come from config. We populate the tab
   * bar without fetching; only the active file is loaded eagerly (others
   * fetch lazily on first activation). `fallback` is used when nothing is
   * open yet. */
  async function restore(openFiles, activeFile, fallback, pinnedFiles) {
    (openFiles || []).forEach(p => {
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
    /* Register a special tab type. `def` = { id, icon, label, onActivate, onClose }.
     * id must start with "§". onActivate(id) is called when the tab becomes
     * active; onClose(id) when it's closed. Re-registering the same id
     * replaces the definition (used by hot reload / test reset). */
    registerSpecial(def) {
      if (!def || !def.id || !def.id.startsWith("§")) return;
      specialTabs.set(def.id, def);
    },
    /* Open a special tab (by id) and activate it. If it's already open,
     * just activate it (no duplicate). */
    async openSpecial(id) {
      if (!specialTabs.has(id)) return;
      if (!openSet.has(id)) { openSet.add(id); ordered.push(id); }
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

  // A file deleted from disk closes its tab (and, for a dir, any tab under it).
  NB.evt.on("file:deleted", (path) => {
    const prefix = path + "/";
    ordered.filter(p => p === path || p.startsWith(prefix))
      .forEach(p => close(p, { force: true }));
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
  function _dropTab(path) { conflictSet.delete(path); }
  // Wrap the existing dropTab so we don't lose the original. Simpler: the
  // existing dropTab already deletes from the open set; clear conflicts
  // at the same spot by hooking the close() path through an event.
  NB.evt.on("tabs:changed", () => {
    ordered.forEach(p => { if (!openSet.has(p)) conflictSet.delete(p); });
  });
  // When the notebook is locked (auth required, session gone), drop
  // every open tab so the bar doesn't keep showing files the user
  // is no longer authorized to read. The viewer / tree / search
  // content is wiped by auth.js on the same event.
  NB.evt.on("auth:locked", () => { clearAll(); });
})();