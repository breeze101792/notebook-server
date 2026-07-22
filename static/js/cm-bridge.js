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
  // The vim extension lives in a Compartment so Settings → "VIM mode"
  // can turn ALL of vim (shell keymap AND the editor's vim) on/off at
  // runtime. `vimOn` mirrors cfg.vimMode; ensureView() also seeds it
  // from NB.app so a view created before any setVimMode() call still
  // starts in the right state.
  let vimCompartment = null;
  let vimOn = false;

  function getCm() {
    if (!window.CM6) {
      throw new Error("cm-bridge: CM6 bundle not loaded");
    }
    return window.CM6;
  }

  /* Visual-line cursor fix (@replit/codemirror-vim).
   *
   * Stock behavior: pressing V renders the selection with the head
   * pinned at end-of-line (makeCmSelection 'line' mode), so the fat
   * cursor teleports to the last character of the line even though
   * vim.sel keeps the entry column internally. That jump is what the
   * user sees as "shift+v moves the cursor to the last word".
   *
   * The fix wraps the CM5 adapter's setSelections: whenever vim is in
   * visual-LINE mode and the call is the plugin's linewise *render*
   * (single range, anchor at line start / head at line end, lines
   * matching vim.sel), we put the head back at vim.sel.head's column
   * so the cursor stays where the user put it. Linewise OPERATORS
   * (yank/delete) pass a range whose head is the NEXT line's column 0,
   * which fails the render-shape check, so dd-style operations on the
   * visual selection are unaffected (verified: Vy pastes the full
   * line, Vd deletes the full line). If the entry column is 0 the
   * rewrite would collapse the range (losing the line highlight), so
   * we keep the plugin's render in that case. */
  function patchVisualLineCursor(cm5) {
    if (cm5.__vlCursorPatched) return;   // idempotent
    cm5.__vlCursorPatched = true;
    const orig = cm5.setSelections.bind(cm5);
    cm5.setSelections = function (ranges, primIndex) {
      const vim = cm5.state && cm5.state.vim;
      if (vim && vim.visualMode && vim.visualLine && vim.sel &&
          ranges && ranges.length === 1) {
        const r = ranges[0];
        if (r.head.line === vim.sel.head.line &&
            r.anchor.line === vim.sel.anchor.line) {
          const headTxt = cm5.getLine(r.head.line) || "";
          const anchorTxt = cm5.getLine(r.anchor.line) || "";
          const fwd = r.anchor.ch === 0 && r.head.ch === headTxt.length;
          const bwd = r.head.ch === 0 && r.anchor.ch === anchorTxt.length &&
                      headTxt.length > 0;
          const wantCh = Math.max(0, Math.min(vim.sel.head.ch, headTxt.length));
          const collapses =
            r.anchor.line === r.head.line && r.anchor.ch === wantCh;
          if ((fwd || bwd) && !collapses && wantCh !== r.head.ch) {
            ranges = [{ anchor: r.anchor, head: { line: r.head.line, ch: wantCh } }];
          }
        }
      }
      return orig(ranges, primIndex);
    };
  }

  function ensureView() {
    if (view) return view;
    const cm = getCm();
    const host = document.getElementById("cm-host");
    if (!host) throw new Error("cm-bridge: #cm-host not in DOM");
    // Seed the vim compartment from the live cfg (in case setVimMode
    // hasn't been called yet this session).
    vimOn = !!(NB.app && NB.app.getVimMode && NB.app.getVimMode());
    vimCompartment = new cm.Compartment();
    const startState = cm.EditorState.create({
      doc: "",
      extensions: [
        // basicSetup provides line numbers, history, foldGutter, etc.
        // We strip a few that don't fit (drawSelection is fine but
        // search panel is opt-in; we expose our own shortcut).
        cm.basicSetup,
        cm.markdown(),
        // Wrap long lines instead of overflowing horizontally. This
        // is a markdown notebook -- prose lines are long and wrapping
        // is what the preview does too, so the two panes stay
        // visually consistent.
        cm.EditorView.lineWrapping,
        // Vim keymap -- only when VIM mode is on (Settings → "VIM
        // mode"). Off means the editor is a plain CM6 instance. The
        // Compartment lets setVimMode() flip this live.
        vimCompartment.of(vimOn ? cm.vim() : []),
        // Use the high-priority Prec.high for our
        // own bindings so they win over the vim keymap (otherwise
        // `Mod-b` would insert "b" in insert mode if vim's bindings
        // didn't already claim it -- they do, but we want to be
        // explicit about the bold/italic on `Mod-b`/`Mod-i`).
        cm.Prec.high(cm.keymap.of([
          // Bold / italic are app-level toolbar actions, so we bind
          // them at Prec.high over the vim keymap (Mod-b / Mod-i
          // aren't vim bindings, but we keep the explicit priority so
          // they can't drift later). Escape is NOT bound here -- it's
          // a VIM key (insert -> normal mode). Exiting edit mode is
          // Ctrl+E, handled in the shell (vimnav.js).
          { key: "Mod-b", run: () => { if (NB.editbar && NB.editbar.actions) NB.editbar.actions.bold(); return true; } },
          { key: "Mod-i", run: () => { if (NB.editbar && NB.editbar.actions) NB.editbar.actions.italic(); return true; } },
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
    // Apply the user's vimrc (cfg.vimrc) now that the vim plugin
    // is live. Reading from cfg at view-creation time means a
    // boot-time vimrc is applied before the first keystroke. The
    // Settings modal re-applies on save so edits to the vimrc take
    // effect immediately without recreating the view.
    if (NB.app && NB.app.getCfg) {
      const cfg = NB.app.getCfg();
      if (cfg && typeof cfg.vimrc === "string" && cfg.vimrc.length > 0) {
        try { compileVimrc(cfg.vimrc); }
        catch (_) { /* compile errors are surfaced via applyVimrc, not here */ }
      }
    }
    // Keep the cursor at its column in visual-line mode (see the long
    // comment on patchVisualLineCursor). getCM returns null when the
    // vim plugin isn't active, so only patch when vim is on.
    if (vimOn) patchVimAdapter();
    return view;
  }

  /* Patch the live CM5 adapter (if the vim plugin is active) with the
   * visual-line cursor fix. Safe to call repeatedly. */
  function patchVimAdapter() {
    if (!view) return;
    const cm5 = getCm().getCM(view);
    if (cm5) patchVisualLineCursor(cm5);
  }

  /* --- custom VIM initial script (vimrc) --------------------------- */
  /* The vendored @replit/codemirror-vim exposes a small vimscript-
   * shaped API: Vim.map / Vim.unmap / Vim.defineEx. The user's
   * "initial script" (a Settings-modal textarea persisted as
   * cfg.vimrc) is parsed here line-by-line and compiled into calls
   * against that API. We support the common subset of the vimrc
   * mapping commands (map / nmap / imap / vmap / noremap + the
   * nnoremap/inoremap/vnoremap variants / unmap + the nunmap/iunmap/
   * vunmap variants) -- enough for "remap j to gj", "map <leader>w
   * :w<CR>", and similar everyday tweaks. Ex-command definitions
   * (`:command`) are intentionally not exposed: the browser host has
   * no general-purpose vimscript engine, so a custom :foo command
   * would have nowhere to dispatch to. The parser is permissive on
   * comments and blank lines so users can annotate their config. */
  //
  // Map-command table. Each entry: [parser-token, vim-mode-arg-to-Vim.map].
  // The `noremap` variants use the same backing call as `map` because
  // the lib's Vim.map is already non-recursive (Vim.map = Vim.noremap
  // in this plugin's API). Documenting both names keeps the user's
  // muscle memory intact.
  const MAP_CMDS = {
    map:      "normal",
    nmap:     "normal",
    noremap:  "normal",
    nnoremap: "normal",
    imap:     "insert",
    inoremap: "insert",
    vmap:     "visual",
    vnoremap: "visual",
  };
  const UNMAP_CMDS = {
    unmap:  null,   // null = all modes
    nunmap: "normal",
    iunmap: "insert",
    vunmap: "visual",
  };

  /* compileVimrc(text) -> { ok, count, errors }
   *   Parses the user's vimrc and applies each line. Idempotent in
   *   the sense that it can be called repeatedly with the same text
   *   (the lib's map/unmap are no-ops on a duplicate lhs). Returns
   *   a count of bindings applied + any per-line errors so the
   *   Settings modal can surface them inline. */
  function compileVimrc(text) {
    const result = { ok: true, count: 0, errors: [] };
    if (text == null || text === "") return result;
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // Strip comments (# or ") and trim. Real vim also recognises
      // `"` as a comment introducer; supporting both means a user
      // can paste an example from either a shell-script or a vim
      // tutorial without translating it.
      const raw = lines[i];
      const stripped = raw.replace(/(?:#|").*$/, "").trim();
      if (stripped === "") continue;
      const parts = stripped.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      try {
        if (MAP_CMDS.hasOwnProperty(cmd)) {
          // map / nmap / imap / vmap / noremap / nnoremap /
          // inoremap / vnoremap: <lhs> <rhs>
          if (parts.length < 3) {
            throw new Error("expected <lhs> <rhs>");
          }
          const lhs = parts[1];
          const rhs = parts.slice(2).join(" ");
          const mode = MAP_CMDS[cmd];
          getCm().Vim.map(lhs, rhs, mode);
          result.count++;
        } else if (UNMAP_CMDS.hasOwnProperty(cmd)) {
          // unmap / nunmap / iunmap / vunmap: <lhs>
          if (parts.length < 2) {
            throw new Error("expected <lhs>");
          }
          const lhs = parts[1];
          const mode = UNMAP_CMDS[cmd];   // may be null (= all modes)
          getCm().Vim.unmap(lhs, mode);
          // unmap doesn't add a binding, but we count it as a
          // "handled line" so the success metric reflects that the
          // user provided a complete, parseable script.
          result.count++;
        } else {
          throw new Error(`unknown command: ${parts[0]}`);
        }
      } catch (e) {
        result.ok = false;
        // Use the line number the user sees (1-based). We point
        // at the original line text too so the error message is
        // self-contained when the modal renders it.
        result.errors.push({
          line: i + 1,
          text: raw,
          message: (e && e.message) || String(e),
        });
      }
    }
    return result;
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
    /** Enable/disable the editor's vim keymap (Settings → "VIM mode").
     *  When the view doesn't exist yet the flag is stored and applied
     *  at creation; otherwise the vim Compartment is reconfigured live
     *  (toggling vim on mid-edit drops the user into normal mode, off
     *  restores the plain CM6 keymap). */
    setVimMode(on) {
      vimOn = !!on;
      if (view && vimCompartment) {
        const cm = getCm();
        view.dispatch({
          effects: vimCompartment.reconfigure(vimOn ? cm.vim() : []),
        });
        // The vim plugin (and its CM5 adapter) is (re)created by the
        // reconfigure above, so (re)apply the visual-line cursor fix
        // and re-apply the user's vimrc (the new plugin instance
        // starts with no user bindings).
        if (vimOn) {
          patchVimAdapter();
          if (NB.app && NB.app.getCfg) {
            const cfg = NB.app.getCfg();
            if (cfg && typeof cfg.vimrc === "string" && cfg.vimrc.length > 0) {
              try { compileVimrc(cfg.vimrc); }
              catch (_) { /* see applyVimrc */ }
            }
          }
        }
      }
    },
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
    /** Parse + apply a user-supplied vimrc. Returns
     *  { ok, count, errors } so the caller can show the result. */
    applyVimrc(text) { return compileVimrc(text); },
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
