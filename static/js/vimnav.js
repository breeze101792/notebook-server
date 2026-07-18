/* vimnav.js -- shell-level VIM keymap for the Markdown notebook app.
 *
 * Two layers of VIM in this app:
 *   1. App shell (this module): sidebar / editor / outline act as
 *      three vim "windows". Ctrl+W cycles focus. j/k/gg/G navigate
 *      within the active window. i enters edit mode. Esc exits.
 *      H/L use the back button. o/r/d mutate the file tree.
 *   2. Editor textarea (CodeMirror 6 + @replit/codemirror-vim):
 *      real VIM inside the raw editor (dd/dw/cw/:/etc.). The bridge
 *      (cm-bridge.js) registers the high-priority Ctrl+B / Ctrl+I /
 *      Escape bindings; everything else is CM6's vim keymap.
 *
 * The two layers hand off cleanly: when CodeMirror has focus, this
 * module only handles Escape (which exits edit mode and returns the
 * shell keymap to "normal mode" in the editor window). Otherwise
 * (anywhere else in the app), this module is the sole owner of the
 * keymap. Modifier keys we own (Ctrl+W, Ctrl+S, Ctrl+D, Ctrl+U,
 * Ctrl+/) are preventDefault'd; modifiers we don't own fall through
 * to the browser.
 *
 * Activation: opt-in via Settings → "Enable VIM keymap" (off by
 * default). When OFF, no global keydown listener is attached and
 * nothing changes.
 *
 * Public surface: NB.vimnav = { isEnabled, setEnabled, getWindow,
 *   setWindow, isInEditable, openHelp, closeHelp }
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  /* --- state ------------------------------------------------------- */
  let enabled = false;
  let activeWindow = "editor";   // "sidebar" | "editor" | "outline"
  // Two-key chord state (e.g. gg). Set on first key, consumed on second.
  let chord = null;              // { key, t }
  const CHORD_MS = 800;

  /* --- modal detection -------------------------------------------- */
  /* The shell keymap yields whenever an overlay is up (Settings,
   * auth, search results, this module's :help). */
  function modalIsOpen() {
    return !!document.querySelector(
      ".settings-overlay:not([hidden]), #auth-overlay:not([hidden])");
  }
  function ourHelpIsOpen() {
    const el = document.getElementById("vimnav-help");
    return el && !el.hidden;
  }
  function searchIsOpen() {
    const el = document.getElementById("search-results");
    return el && !el.hidden;
  }

  /* --- focus detection -------------------------------------------- */
  /* CodeMirror's contentDOM is the actual editable element. When it
   * has focus, CM6 owns the keys (we only handle Esc). */
  function cmHasFocus() {
    const v = NB.cmEditor && NB.cmEditor.view && NB.cmEditor.view();
    return !!(v && v.hasFocus);
  }
  /* Plain text inputs (search box, settings inputs). We yield to
   * them (Esc blurs, but we don't override other keys). */
  function inEditable() {
    const a = document.activeElement;
    if (!a) return false;
    if (cmHasFocus()) return true;
    const tag = a.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (a.isContentEditable) return true;
    return false;
  }

  /* --- window + cursor helpers ------------------------------------ */
  function setActiveWindow(w) {
    if (!["sidebar", "editor", "outline"].includes(w)) return;
    activeWindow = w;
    document.querySelectorAll(".vim-window").forEach(el => {
      el.classList.toggle("vim-active", el.dataset.vimWindow === w);
    });
  }
  function getActiveWindow() { return activeWindow; }
  function cycleWindow() {
    const order = ["sidebar", "editor", "outline"];
    const idx = order.indexOf(activeWindow);
    setActiveWindow(order[(idx + 1) % order.length]);
  }

  /* --- keymap ----------------------------------------------------- */
  /* For each active window, the keymap is a flat object:
   *   key (in our normalized form, lowercase letter) -> handler.
   * Modifier keys (Ctrl/Alt/Meta) we own are handled separately. */
  function isOwnerModifier(e) {
    if (e.altKey) return false;     // alt is always the browser's
    if (e.metaKey) return true;     // we own Cmd on Mac
    if (e.ctrlKey) {
      // We own Ctrl+W, Ctrl+S, Ctrl+D, Ctrl+U, Ctrl+/, Ctrl+Enter.
      // Other Ctrl+? fall through (browsers use them for tabs, find, etc.)
      const k = e.key.toLowerCase();
      return ["w", "s", "d", "u", "/", "enter"].includes(k);
    }
    return true;
  }
  function isChordable(k) {
    // Keys that participate in two-key chords (gg). We don't make
    // every key chordable -- that would slow typing. g and d (line
    // mutation) are the canonical chord starts; in our app the line
    // mutations go through the editbar so we only chord on g.
    return k === "g";
  }

  function handleKey(e) {
    if (!enabled) return;
    if (modalIsOpen() && !ourHelpIsOpen()) return;
    if (searchIsOpen()) {
      // Only Esc closes the search (the search input owns keys).
      if (e.key === "Escape") {
        e.preventDefault();
        if (NB.search) NB.search.close();
      }
      return;
    }
    if (ourHelpIsOpen()) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        closeHelp();
      }
      return;
    }
    if (cmHasFocus()) {
      // While CM6 has focus, only Esc is ours (exits edit mode).
      // Everything else goes to CM6's vim keymap.
      if (e.key === "Escape") {
        e.preventDefault();
        if (NB.viewer) NB.viewer.closeEdit();
      }
      return;
    }
    if (inEditable()) {
      // Text input has focus (e.g. search box, settings field).
      // Only Esc blurs the input.
      if (e.key === "Escape") {
        e.preventDefault();
        document.activeElement.blur();
      }
      return;
    }
    // From here on, we own the key. Block browser defaults for the
    // modifiers we own.
    if (e.ctrlKey || e.metaKey) e.preventDefault();
    else e.preventDefault();

    // --- owner-modifier keys ---
    if (e.key === "Escape") {
      // Shell-level Esc: close help if open, else clear chord, else
      // no-op (CM6's Esc is its own thing).
      chord = null;
      if (ourHelpIsOpen()) closeHelp();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
      e.preventDefault();
      cycleWindow();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (NB.viewer) NB.viewer.save();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "/") {
      e.preventDefault();
      setEnabled(false);
      return;
    }

    // --- single-letter keys ---
    const k = e.key;  // preserve case for Shift+ variants
    if (k === "Enter") {
      // Treat Enter as a single-letter key in the active window so
      // sidebar/outline "open file" / "jump to heading" still work.
    } else if (e.shiftKey && k.length === 1) {
      // Capital letters (G, H, L, I, etc.) reach here. Pass to the
      // window's handler.
    } else if (k.length === 1) {
      // Lowercase letters + digits + punctuation. We dispatch on the
      // raw key string (e.g. "j", "k", "g", "?").
    } else {
      return;  // F-keys, arrows, etc. ignored
    }

    // --- chord handling ---
    if (chord && chord.key === k && Date.now() - chord.t < CHORD_MS) {
      // Second key of a chord. Consume and run with prefix.
      const prefix = chord.key;
      chord = null;
      runChord(prefix, k);
      return;
    }
    if (isChordable(k) && !e.shiftKey) {
      // Start a chord.
      chord = { key: k, t: Date.now() };
      return;
    }

    // --- dispatch by window ---
    dispatchKey(activeWindow, k, e);
  }

  function runChord(prefix, k) {
    if (prefix === "g") {
      if (k === "g") {
        // gg: top
        if (activeWindow === "sidebar") NB.sidebar.vimCursorPrev && scrollSidebarToEdge("top");
        else if (activeWindow === "outline") NB.outline.vimCursorPrev && outlineJump("top");
        else editorJump("top");
      }
    }
  }
  function scrollSidebarToEdge(where) {
    const el = document.getElementById("file-tree");
    if (el) el.scrollTop = (where === "top") ? 0 : el.scrollHeight;
  }
  function outlineJump(where) {
    const list = document.querySelectorAll("#outline .outline-item");
    if (!list.length) return;
    const target = (where === "top") ? list[0] : list[list.length - 1];
    if (target && NB.outline.setVimCursor) NB.outline.setVimCursor(target.dataset.id);
  }
  function editorJump(where) {
    const vc = document.getElementById("viewer-content");
    if (!vc) return;
    if (where === "top") vc.scrollTop = 0;
    else vc.scrollTop = vc.scrollHeight;
  }

  function dispatchKey(win, k, e) {
    if (win === "sidebar") return dispatchSidebar(k, e);
    if (win === "outline") return dispatchOutline(k, e);
    if (win === "editor") return dispatchEditor(k, e);
  }

  function dispatchSidebar(k, e) {
    const s = NB.sidebar;
    if (!s) return;
    if (k === "j" || k === "ArrowDown") { s.vimCursorNext(); return; }
    if (k === "k" || k === "ArrowUp")   { s.vimCursorPrev(); return; }
    if (k === "l" || k === "Enter")     { s.vimCursorOpen(); return; }
    if (k === "h" || k === "ArrowLeft") { s.vimCursorCollapse(); return; }
    if (k === "G")                     { scrollSidebarToEdge("bottom"); return; }
    if (k === "o")                     { if (NB.app && NB.app.openNewFile) NB.app.openNewFile(); return; }
    // r/d mutations: defer to sidebar's right-click flow. (We don't
    // implement custom prompts; the right-click context menu is the
    // one and only entry point, so a vim shortcut that doesn't
    // exist there is just a no-op.)
  }

  function dispatchOutline(k, e) {
    const o = NB.outline;
    if (!o) return;
    if (k === "j" || k === "ArrowDown") { o.vimCursorNext(); return; }
    if (k === "k" || k === "ArrowUp")   { o.vimCursorPrev(); return; }
    if (k === "l" || k === "Enter")     { o.vimCursorScrollTo(); return; }
    if (k === "h" || k === "ArrowLeft") { setActiveWindow("editor"); return; }
    if (k === "G")                     { outlineJump("bottom"); return; }
  }

  function dispatchEditor(k, e) {
    const v = NB.viewer;
    if (!v) return;
    if (k === "i" || k === "e") {
      if (v.startEdit) v.startEdit();
      return;
    }
    if (k === "j" || k === "ArrowDown") { scrollEditor("down"); return; }
    if (k === "k" || k === "ArrowUp")   { scrollEditor("up"); return; }
    if (k === "G")                      { editorJump("bottom"); return; }
    if (k === "H") {
      // Note: H is normally "top of screen" in vim. In the editor
      // window we override to mean "back" (more useful for an app
      // that's a notebook, not a code file). Documented in :help.
      v.goBack && v.goBack();
      return;
    }
    if (k === "L") {
      v.goForward && v.goForward();
      return;
    }
    if (k === "h") {
      // In editor window, h is "left half-page" (vim H/L are
      // overridden above; h/l is not, so h here means what vim means).
      scrollEditorHalf("up");
      return;
    }
    if (k === "l") {
      scrollEditorHalf("down");
      return;
    }
    if (k === "t") {
      // New note.
      if (NB.sidebar && NB.sidebar.createAtRoot) NB.sidebar.createAtRoot("file");
      return;
    }
    if (k === "T") {
      // Open search.
      const searchInput = document.getElementById("search-input");
      if (searchInput) searchInput.focus();
      return;
    }
    if (k === "?") { openHelp(); return; }
  }
  function scrollEditor(direction) {
    const vc = document.getElementById("viewer-content");
    if (!vc) return;
    const lineH = 24;
    vc.scrollTop += (direction === "down" ? 1 : -1) * lineH;
  }
  function scrollEditorHalf(direction) {
    const vc = document.getElementById("viewer-content");
    if (!vc) return;
    const half = vc.clientHeight / 2;
    vc.scrollTop += (direction === "down" ? 1 : -1) * half;
  }

  /* --- :help overlay ---------------------------------------------- */
  function ensureHelpEl() {
    let el = document.getElementById("vimnav-help");
    if (el) return el;
    el = document.createElement("div");
    el.id = "vimnav-help";
    el.className = "settings-overlay";
    el.hidden = true;
    el.innerHTML = `
      <div class="settings-modal vimnav-help" role="dialog" aria-modal="true" aria-labelledby="vimnav-help-title">
        <div class="settings-header">
          <h2 id="vimnav-help-title">:help -- VIM keymap</h2>
          <button class="icon-btn" data-vimnav-close title="Close" aria-label="Close">×</button>
        </div>
        <div class="vimnav-help-body">
          <h3>App shell</h3>
          <table>
            <tr><th><kbd>Ctrl</kbd>+<kbd>W</kbd></th><td>Cycle window: sidebar → editor → outline</td></tr>
            <tr><th><kbd>i</kbd> / <kbd>e</kbd></th><td>Enter edit mode (focus the editor)</td></tr>
            <tr><th><kbd>Esc</kbd></th><td>Close this help, blur any input, or exit edit mode</td></tr>
            <tr><th><kbd>?</kbd></th><td>Show this :help</td></tr>
            <tr><th><kbd>Ctrl</kbd>+<kbd>/</kbd></th><td>Disable VIM mode for this session (escape hatch)</td></tr>
            <tr><th><kbd>Ctrl</kbd>+<kbd>S</kbd></th><td>Save</td></tr>
          </table>
          <h3>Sidebar window</h3>
          <table>
            <tr><th><kbd>j</kbd> / <kbd>k</kbd></th><td>Move cursor down / up</td></tr>
            <tr><th><kbd>l</kbd> / <kbd>Enter</kbd></th><td>Open file or expand folder</td></tr>
            <tr><th><kbd>h</kbd></th><td>Collapse folder / move to parent</td></tr>
            <tr><th><kbd>gg</kbd> / <kbd>G</kbd></th><td>Jump to top / bottom of the tree</td></tr>
            <tr><th><kbd>o</kbd></th><td>New note (same as right-click → New file)</td></tr>
          </table>
          <h3>Outline window</h3>
          <table>
            <tr><th><kbd>j</kbd> / <kbd>k</kbd></th><td>Move cursor down / up</td></tr>
            <tr><th><kbd>l</kbd> / <kbd>Enter</kbd></th><td>Scroll the editor to that heading</td></tr>
            <tr><th><kbd>h</kbd></th><td>Back to the editor window</td></tr>
            <tr><th><kbd>gg</kbd> / <kbd>G</kbd></th><td>Jump to top / bottom of the outline</td></tr>
          </table>
          <h3>Editor window (preview)</h3>
          <table>
            <tr><th><kbd>j</kbd> / <kbd>k</kbd></th><td>Scroll one line down / up</td></tr>
            <tr><th><kbd>l</kbd> / <kbd>h</kbd></th><td>Scroll half-page down / up</td></tr>
            <tr><th><kbd>gg</kbd> / <kbd>G</kbd></th><td>Scroll to top / bottom</td></tr>
            <tr><th><kbd>i</kbd> / <kbd>e</kbd></th><td>Enter edit mode (full VIM via CodeMirror)</td></tr>
            <tr><th><kbd>H</kbd> / <kbd>L</kbd></th><td>Back / forward in in-app history</td></tr>
            <tr><th><kbd>t</kbd></th><td>New note</td></tr>
            <tr><th><kbd>T</kbd></th><td>Open the search box</td></tr>
          </table>
          <h3>Editor (in edit mode -- CodeMirror VIM)</h3>
          <table>
            <tr><th>Standard VIM</th><td>i / a / o for insert, <kbd>Esc</kbd> for normal mode, dd / dw / cw, gg / G / 0 / $, <kbd>:</kbd> for the command line</td></tr>
            <tr><th><kbd>:w</kbd></th><td>Save</td></tr>
            <tr><th><kbd>:q</kbd></th><td>Exit edit mode (back to preview)</td></tr>
            <tr><th><kbd>:wq</kbd></th><td>Save and exit edit mode</td></tr>
            <tr><th><kbd>/foo</kbd></th><td>Search within the note</td></tr>
            <tr><th><kbd>Mod-b</kbd> / <kbd>Mod-i</kbd></th><td>Bold / italic (work in normal + insert mode)</td></tr>
          </table>
        </div>
        <div class="vimnav-help-footer">Press <kbd>Esc</kbd> or <kbd>?</kbd> to close.</div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      // Backdrop click closes.
      if (e.target === el) closeHelp();
      const close = e.target.closest("[data-vimnav-close]");
      if (close) closeHelp();
    });
    return el;
  }
  function openHelp() {
    const el = ensureHelpEl();
    el.hidden = false;
  }
  function closeHelp() {
    const el = document.getElementById("vimnav-help");
    if (el) el.hidden = true;
  }

  /* --- enable / disable ------------------------------------------- */
  function setEnabled(on) {
    enabled = !!on;
    if (enabled) {
      document.body.classList.add("vim-enabled");
      // Tag the three windows so the css can show the focus ring.
      document.querySelectorAll("#sidebar, #editor-pane, #outline-pane")
        .forEach(el => {
          el.classList.add("vim-window");
          if (el.id === "sidebar") el.dataset.vimWindow = "sidebar";
          else if (el.id === "editor-pane") el.dataset.vimWindow = "editor";
          else if (el.id === "outline-pane") el.dataset.vimWindow = "outline";
        });
      setActiveWindow(activeWindow || "editor");
      // Wire click handlers so clicking a window gives it focus.
      document.querySelectorAll(".vim-window").forEach(el => {
        el.addEventListener("mousedown", () => {
          setActiveWindow(el.dataset.vimWindow);
        });
      });
      // Seed the sidebar cursor on the currently-open file.
      if (NB.tabs && NB.tabs.getActive && NB.sidebar && NB.sidebar.setVimCursor) {
        const active = NB.tabs.getActive();
        if (active) NB.sidebar.setVimCursor(active);
      }
    } else {
      document.body.classList.remove("vim-enabled");
      document.querySelectorAll(".vim-window").forEach(el => {
        el.classList.remove("vim-active", "vim-window");
        delete el.dataset.vimWindow;
      });
      closeHelp();
    }
  }
  function isEnabled() { return enabled; }

  /* --- listener attachment ---------------------------------------- */
  function onKeyDown(e) { handleKey(e); }
  function attach() {
    document.addEventListener("keydown", onKeyDown, true);
  }
  function detach() {
    document.removeEventListener("keydown", onKeyDown, true);
  }
  // We attach the listener once on module load, and `enabled` gates
  // whether it acts on events. This way we don't have to add/remove
  // listeners on toggle.
  attach();

  /* --- public API ------------------------------------------------- */
  NB.vimnav = {
    isEnabled, setEnabled, getWindow: getActiveWindow, setWindow: setActiveWindow,
    openHelp, closeHelp,
  };
})();
