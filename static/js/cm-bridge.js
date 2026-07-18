/* cm-bridge.js -- thin wrapper around CodeMirror 6.
 *
 * Why a bridge: the rest of the app shouldn't need to know about CM6
 * internals. The bridge exposes a small, stable surface
 * (`NB.cmEditor.getValue / setValue / getSelection / setSelection /
 * replaceSelection / focus / blur / onChange`) so editbar.js,
 * viewer.js, and tests can talk to the editor without depending on
 * @codemirror/* directly.
 *
 * View creation is **lazy**: the view is created on the first
 * `ensureView()` call. We don't create it on boot because (a) CM6
 * does layout work the user doesn't see, and (b) tests can mount
 * and tear it down between scenarios.
 *
 * The bridge also wires the editor's ex-commands (`:w` save, `:q`
 * exit, `:wq` save+exit) and the high-priority keymap (`Mod-b`,
 * `Mod-i` for bold/italic, `Escape` to exit edit mode) so the rest
 * of the app just calls NB.editbar.bold() / italic() and the rest
 * of the CM6 pipeline takes care of it.
 *
 * CM6 is loaded from /static/vendor/codemirror.bundle.js, which
 * exposes `window.CM6` with the named exports we use.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  let view = null;
  const onChangeHandlers = [];

  function getCm() {
    if (!window.CM6) {
      throw new Error("cm-bridge: CM6 bundle not loaded");
    }
    return window.CM6;
  }

  function ensureView() {
    if (view) return view;
    const cm = getCm();
    const host = document.getElementById("cm-host");
    if (!host) throw new Error("cm-bridge: #cm-host not in DOM");
    const startState = cm.EditorState.create({
      doc: "",
      extensions: [
        // basicSetup provides line numbers, history, foldGutter, etc.
        // We strip a few that don't fit (drawSelection is fine but
        // search panel is opt-in; we expose our own shortcut).
        cm.basicSetup,
        cm.markdown(),
        // Vim keymap. Use the high-priority Prec.high for our
        // own bindings so they win over the vim keymap (otherwise
        // `Mod-b` would insert "b" in insert mode if vim's bindings
        // didn't already claim it -- they do, but we want to be
        // explicit about the bold/italic on `Mod-b`/`Mod-i`).
        cm.vim(),
        cm.Prec.high(cm.keymap.of([
          { key: "Mod-b", run: () => { if (NB.editbar && NB.editbar.actions) NB.editbar.actions.bold(); return true; } },
          { key: "Mod-i", run: () => { if (NB.editbar && NB.editbar.actions) NB.editbar.actions.italic(); return true; } },
          { key: "Escape", run: () => { if (NB.viewer) NB.viewer.closeEdit(); return true; } },
        ])),
        // updateListener fires on every doc change; route to the
        // onChange handlers. viewer.js hooks this for dirty tracking
        // + live preview, just like the textarea's `input` event.
        cm.EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeHandlers.forEach((fn) => fn());
        }),
      ],
    });
    view = new cm.EditorView({ state: startState, parent: host });
    // Register ex-commands (vim's : line). Idempotent.
    try {
      cm.Vim.defineEx("write", "w", () => { if (NB.viewer) NB.viewer.save(); });
      cm.Vim.defineEx("quit", "q", () => { if (NB.viewer) NB.viewer.closeEdit(); });
      cm.Vim.defineEx("wq", "wq", async () => {
        if (NB.viewer) {
          await NB.viewer.save();
          NB.viewer.closeEdit();
        }
      });
    } catch (_) { /* already registered -- fine */ }
    return view;
  }

  /* Public API. All read-only methods are safe to call when the
   * view hasn't been created yet (they return empty values). The
   * write methods create the view on demand. */
  NB.cmEditor = {
    /** Return the current document as a string. */
    getValue() {
      if (!view) return "";
      return view.state.doc.toString();
    },
    /** Replace the entire document with `text`. */
    setValue(text) {
      const v = ensureView();
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: String(text || "") },
      });
    },
    /** Return the current primary selection: { from, to, text }. */
    getSelection() {
      if (!view) return { from: 0, to: 0, text: "" };
      const s = view.state.selection.main;
      return {
        from: s.from,
        to: s.to,
        text: view.state.doc.sliceString(s.from, s.to),
      };
    },
    /** Set the primary selection and focus. */
    setSelection(from, to) {
      const v = ensureView();
      v.dispatch({ selection: { anchor: from, head: to } });
      v.focus();
    },
    /** Replace the current selection with `text`. `mode`:
     *   "select" -- select the inserted text (default)
     *   "caret"  -- put the cursor right after the inserted text
     *   "end"    -- like caret but selection extends to the
     *               original end (rare; for hr/table inserts)
     *   null     -- leave the selection alone
     */
    replaceSelection(text, mode) {
      const v = ensureView();
      const { from, to } = v.state.selection.main;
      const insert = String(text || "");
      let sel;
      if (mode === "caret") {
        sel = { anchor: from + insert.length };
      } else if (mode === "end") {
        sel = { anchor: from, head: from + insert.length };
      } else if (mode === "select") {
        sel = { anchor: from, head: from + insert.length };
      } else {
        sel = undefined;
      }
      v.dispatch({ changes: { from, to, insert }, selection: sel });
      v.focus();
    },
    /** Register a change handler. Called once per transaction. */
    onChange(fn) { onChangeHandlers.push(fn); },
    /** Focus the editor. Creates the view on first call. */
    focus() { ensureView().focus(); },
    /** Blur the editor. */
    blur() { if (view) view.contentDOM.blur(); },
    /** Whether the editor has focus. */
    hasFocus() { return !!view && view.hasFocus; },
    /** Return the underlying view (for tests + scroll listeners). */
    view() { return view; },
    /** Return the editor's scroll container (the .cm-scroller el). */
    scrollDOM() { return view ? view.scrollDOM : null; },
    /** Test-only: tear down and re-create. Resets the host element
     *  + the onChange registry. The next access will re-create. */
    _reset() {
      const host = document.getElementById("cm-host");
      if (host) host.innerHTML = "";
      view = null;
      onChangeHandlers.length = 0;
    },
  };
})();
