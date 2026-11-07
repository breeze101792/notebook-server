/* edit-window.js -- the shared history engine for the three hybrid edit
 * windows (table editor, Mermaid designer, Graphviz / WaveDrom designer).
 *
 * One shell contract: the header carries no history, the footer carries no
 * history; the bar's pinned pair (#<prefix>-undo / -redo) is the only
 * surface. A window attaches once and gets either:
 *
 *   stack mode    snapshot() / restore(value) -- the engine owns the stack;
 *                 restore may return false or a Promise.
 *   delegate mode undo() / redo() / canUndo() / canRedo() -- the body owns
 *                 the stack; the caller syncs after each mutation.
 *
 * The module never touches a note: history here is window-local, and Apply
 * stays one note-level undo step whatever the window did.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const HISTORY_LIMIT = 100;        // snapshots, including the opening one
  const HISTORY_COALESCE_MS = 350;  // a typing burst is one step
  const HISTORY_MAX_CHARS = 4 * 1024 * 1024; // cap large tables by total size

  function isPromise(value) {
    return !!value && typeof value.then === "function";
  }

  function failureMessage(err) {
    if (!err) return "The saved state could not be restored";
    const text = String(err.message || err).split(/\r?\n/)[0].slice(0, 300);
    return text || "The saved state could not be restored";
  }

  /* The one copy of the "native undo owns this target" guard. Table cells
   * are not covered: committing a cell kills native undo there, so the
   * table window claims the chord everywhere. */
  function isEditable(e) {
    const target = e && e.target;
    if (!target || !target.tagName) return false;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" || target.isContentEditable) {
      return true;
    }
    return !!(target.closest &&
      target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function attach(opts) {
    opts = opts || {};
    const prefix = opts.prefix;
    const stackMode = typeof opts.snapshot === "function" &&
      typeof opts.restore === "function";

    const stack = [];
    let index = -1;
    let lastAt = 0;
    let lastKind = null;
    let restoring = false;
    let chars = 0;
    const maxChars = Number(opts.maxChars) > 0
      ? Number(opts.maxChars) : HISTORY_MAX_CHARS;

    const isOpen = typeof opts.isOpen === "function" ? opts.isOpen : () => true;
    const enabled = typeof opts.enabled === "function" ? opts.enabled : () => true;
    const ownsKey = typeof opts.ownsKey === "function" ? opts.ownsKey : () => true;

    function byId(id) { return document.getElementById(id); }
    function undoButton() { return byId(prefix + "-undo"); }
    function redoButton() { return byId(prefix + "-redo"); }

    const actionsEl = opts.overlay && opts.overlay.querySelector
      ? opts.overlay.querySelector(".edit-bar-actions") : null;

    // A fade marks that the bar scrolls; the class is toggled from here so
    // CSS never has to detect overflow.
    function syncOverflow() {
      if (!actionsEl) return;
      actionsEl.classList.toggle("is-scrollable",
        actionsEl.scrollWidth > actionsEl.clientWidth + 1);
    }

    function live() {
      try { return !!enabled(); } catch (_) { return false; }
    }

    function canUndo() {
      if (stackMode) return index > 0;
      if (typeof opts.canUndo !== "function") return false;
      try { return !!opts.canUndo(); } catch (_) { return false; }
    }

    function canRedo() {
      if (stackMode) return index >= 0 && index < stack.length - 1;
      if (typeof opts.canRedo !== "function") return false;
      try { return !!opts.canRedo(); } catch (_) { return false; }
    }

    function report(msg) {
      if (typeof opts.onError !== "function") return;
      try { opts.onError(msg); } catch (_) { /* a failing reporter is not fatal */ }
    }

    function sync() {
      const on = live();
      const undo = undoButton();
      const redo = redoButton();
      if (undo) undo.disabled = !on || !canUndo();
      if (redo) redo.disabled = !on || !canRedo();
      syncOverflow();
    }

    function sizeOf(value) {
      return typeof value === "string" ? value.length : 0;
    }

    // Trim from the oldest end until the total fits. Never drop the entry the
    // user is standing on, so one huge snapshot is kept rather than leaving
    // index pointing past the end.
    function trimChars() {
      while (chars > maxChars && stack.length > 1 && index > 0) {
        chars -= sizeOf(stack[0]);
        stack.shift();
        index -= 1;
      }
    }

    function capture(kind) {
      if (!stackMode) return;
      if (!isOpen() || !live() || restoring) return;
      let snap;
      try { snap = opts.snapshot(); } catch (err) { report(failureMessage(err)); return; }
      const now = Date.now();
      if (!stack.length) {
        stack.push(snap);
        chars = sizeOf(snap);
        index = 0;
        lastKind = kind || "text";
        lastAt = now;
        sync();
        return;
      }
      // insertPlainText's execCommand also fires onChange, and a no-op
      // paste/clear/fill or a repeated identical sort would otherwise add
      // a dead step.
      if (snap === stack[index]) { sync(); return; }
      const coalesce = kind === "text" && lastKind === "text" &&
        index === stack.length - 1 && now - lastAt <= HISTORY_COALESCE_MS;
      if (coalesce) {
        chars += sizeOf(snap) - sizeOf(stack[index]);
        stack[index] = snap;
      } else {
        stack.length = index + 1;   // a new step drops the redo tail
        chars = 0;
        for (let i = 0; i < stack.length; i++) chars += sizeOf(stack[i]);
        stack.push(snap);
        chars += sizeOf(snap);
        if (stack.length > HISTORY_LIMIT) {
          chars -= sizeOf(stack[0]);
          stack.shift();
        }
        index = stack.length - 1;
      }
      trimChars();
      lastKind = kind || "text";
      lastAt = now;
      sync();
    }

    function reset() {
      restoring = false;
      lastKind = null;
      lastAt = 0;
      chars = 0;
      if (stackMode) {
        stack.length = 0;
        index = -1;
        try {
          const seed = opts.snapshot();
          stack.push(seed);
          chars = sizeOf(seed);
          index = 0;
        } catch (err) {
          report(failureMessage(err));
        }
      }
      sync();
    }

    function clear() {
      stack.length = 0;
      index = -1;
      lastKind = null;
      lastAt = 0;
      chars = 0;
      restoring = false;
      sync();
    }

    // Ends the current typing window without adding a step. Hosts call this
    // at a cell/field boundary so the next burst starts its own entry.
    function breakCoalesce() {
      lastKind = null;
      lastAt = 0;
    }

    async function afterRestore() {
      if (typeof opts.afterRestore !== "function") return;
      try {
        const result = opts.afterRestore();
        if (isPromise(result)) await result;
      } catch (err) {
        // The model is already restored; a repaint failure is reported but
        // never rolled back (that would leave the body and the index apart).
        report(failureMessage(err));
      }
    }

    async function step(delta) {
      if (restoring) return;
      if (!live()) return;
      // A step breaks the typing window: text typed after undo/redo must not
      // rewrite the entry that was just restored.
      lastKind = null;
      lastAt = 0;

      if (!stackMode) {
        if (delta < 0 ? !canUndo() : !canRedo()) return;
        restoring = true;
        try {
          if (delta < 0) opts.undo();
          else opts.redo();
        } catch (err) {
          restoring = false;
          sync();
          report(failureMessage(err));
          return;
        }
        sync();
        await afterRestore();
        restoring = false;
        sync();
        return;
      }

      const next = index + delta;
      if (next < 0 || next >= stack.length) return;
      const previous = index;
      const value = stack[next];
      index = next;
      restoring = true;
      let result;
      try {
        result = opts.restore(value);
        if (isPromise(result)) result = await result;
      } catch (err) {
        index = previous;
        restoring = false;
        sync();
        report(failureMessage(err));
        return;
      }
      if (result === false) {
        index = previous;
        restoring = false;
        sync();
        report("The saved state could not be restored");
        return;
      }
      sync();
      await afterRestore();
      restoring = false;
      sync();
    }

    function undo() { return step(-1); }
    function redo() { return step(1); }

    // The bar pair is the only history surface. The module wires it once
    // and keeps `disabled` in sync; windows no longer attach their own.
    const undoEl = undoButton();
    const redoEl = redoButton();
    if (undoEl) undoEl.addEventListener("click", function () { undo(); });
    if (redoEl) redoEl.addEventListener("click", function () { redo(); });

    function info() {
      return {
        mode: stackMode ? "stack" : "delegate",
        depth: stack.length,
        index: index,
        canUndo: canUndo(),
        canRedo: canRedo(),
      };
    }

    // One document-level chord listener per window. The window still owns
    // Esc and its own keys; only Ctrl/Cmd+Z / Ctrl/Cmd+Y are taken here.
    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = (e.key || "").toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (!ownsKey(e)) return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    });

    window.addEventListener("resize", syncOverflow);
    if (actionsEl && typeof ResizeObserver === "function") {
      new ResizeObserver(syncOverflow).observe(actionsEl);
    }

    sync();

    return {
      undo: undo,
      redo: redo,
      capture: capture,
      reset: reset,
      clear: clear,
      breakCoalesce: breakCoalesce,
      sync: sync,
      isRestoring: function () { return restoring; },
      info: info,
    };
  }

  NB.editWindow = {
    attach: attach,
    isEditable: isEditable,
  };
})();
