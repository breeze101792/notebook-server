/* vimnav.js -- shell-level VIM keymap for the Markdown notebook app.
 *
 * Two layers of VIM in this app:
 *   1. App shell (this module): sidebar / editor / outline act as
 *      three vim "windows". Ctrl+W cycles focus. j/k/gg/G navigate
 *      within the active window. Ctrl+E enters/exits edit mode.
 *      Alt+H/L cycle to the previous/next tab. o/r/d mutate the
 *      file tree. / focuses the search box.
 *   2. Editor textarea (CodeMirror 6 + @replit/codemirror-vim):
 *      real VIM inside the raw editor (dd/dw/cw/:/etc.). The bridge
 *      (cm-bridge.js) registers the high-priority Ctrl+B / Ctrl+I
 *      bindings (bold/italic over the vim keymap); everything else
 *      is CM6's vim keymap, including Esc (insert -> normal mode)
 *      and `/` (search within the note).
 *
 * The two layers hand off cleanly: when CodeMirror has focus, this
 * module only handles the global modifier bindings (Ctrl+E exit
 * edit, Alt+H/L switch tabs, Ctrl+S save, Ctrl+/ disable VIM,
 * Ctrl+W cycle window). Esc and `/` are NOT intercepted while CM
 * has focus -- they belong to the VIM keymap. Otherwise (anywhere
 * else in the app), this module is the sole owner of the keymap.
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
  // Set on Esc keydown when CM has focus; consumed on the matching
  // keyup. See onKeyUp for why.
  let pendingEscRestore = false;

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
   * has focus, CM6's vim keymap owns all keys (Esc, i, a, o, :, etc.).
   * The only app-level keys that still work are the global Ctrl+?
   * bindings handled in handleKey above (Ctrl+E to exit edit, Ctrl+H/L
   * to switch tabs, etc.). */
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
  // Cycle to prev / next tab. If we're in edit mode with unsaved
  // changes, prompt the user to save first; a failed save aborts
  // the cycle (stays in edit mode). Clean edit sessions just exit
  // edit mode and switch.
  async function cycleTabWithCommit(direction) {
    if (!NB.tabs) return;
    if (NB.viewer && NB.viewer.commitForTabSwitch) {
      const ok = await NB.viewer.commitForTabSwitch();
      if (!ok) return;
    }
    if (direction === "prev" && NB.tabs.prev) await NB.tabs.prev();
    else if (direction === "next" && NB.tabs.next) await NB.tabs.next();
  }

  /* --- keymap ----------------------------------------------------- */
  /* For each active window, the keymap is a flat object:
   *   key (in our normalized form, lowercase letter) -> handler.
   * Modifier keys (Ctrl/Alt/Meta) we own are handled separately. */
  function isOwnerModifier(e) {
    if (e.altKey) {
      // Alt+H / Alt+L cycle to the previous / next tab. We claim
      // these so the browser's Alt+Left/Right (browser back/forward)
      // doesn't fire instead -- the user said they don't want to
      // break browser shortcuts, so we use Alt (which the browser
      // mostly ignores) rather than Ctrl (which the browser uses
      // for many things).
      const k = e.key.toLowerCase();
      return ["h", "l"].includes(k);
    }
    if (e.metaKey) return true;     // we own Cmd on Mac
    if (e.ctrlKey) {
      // We own Ctrl+W (cycle window), Ctrl+E (toggle edit), Ctrl+S
      // (save), Ctrl+/ (disable VIM). Ctrl+H/L are NOT ours -- many
      // browsers use Ctrl+L for the address bar. The tab cycle is
      // Alt+H/L instead.
      const k = e.key.toLowerCase();
      return ["w", "e", "s", "/"].includes(k);
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
    // --- global app-level bindings (work in any focus context, including
    // when CodeMirror has focus in edit mode) ---
    // These are app-level actions the user expects to work no matter
    // which sub-editor is focused. We process them before the CM / input
    // early returns below.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "h") {
        // Previous tab. Wraps. If we're in edit mode with unsaved
        // changes, prompt to save / discard first.
        e.preventDefault();
        cycleTabWithCommit("prev");
        return;
      }
      if (k === "l") {
        // Next tab. Wraps. Same dirty-check as Alt+H.
        e.preventDefault();
        cycleTabWithCommit("next");
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "e") {
        e.preventDefault();
        const v = NB.viewer;
        if (!v) return;
        const cmHost = document.getElementById("cm-host");
        const inEdit = cmHost && !cmHost.hidden;
        if (inEdit) { if (v.closeEdit) v.closeEdit(); }
        else { if (v.startEdit) v.startEdit(); }
        return;
      }
      if (k === "s") {
        e.preventDefault();
        if (NB.viewer) NB.viewer.save();
        return;
      }
      if (k === "/") {
        e.preventDefault();
        setEnabled(false);
        return;
      }
      if (k === "w") {
        e.preventDefault();
        cycleWindow();
        return;
      }
    }
    if (cmHasFocus()) {
      // CodeMirror has focus -- in edit mode. CM6's vim keymap owns
      // all keys now (Esc switches insert->normal mode, i/a/o enter
      // insert, :w saves, etc.). The only app-level keys are handled
      // in the global Ctrl+? block above (Ctrl+E to exit edit, Ctrl+H/L
      // to switch tabs).
      //
      // We also stash "had focus at keydown" for the keyup handler
      // below -- see onKeyUp for why.
      pendingEscRestore = (e.key === "Escape");
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
    // (Ctrl+W/S/E// and Alt+H/L are handled above, before the
    // cmHasFocus early return, so they work even when the editor is
    // focused.)
    if (e.key === "Escape") {
      // Shell-level Esc: close help if open, else clear chord, else
      // no-op (CM6's Esc is its own thing).
      chord = null;
      if (ourHelpIsOpen()) closeHelp();
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

    // `/` in preview mode (not in an input, not in CM edit mode) is
    // VIM-style search: focus the search input. CM6's vim keymap owns
    // `/` in edit mode, so this is only reached when cmHasFocus() is
    // false (the cmHasFocus early return above caught that case).
    // The search input is an <input> so inEditable() returns true and
    // yields to it on subsequent keystrokes.
    if (k === "/") {
      const searchInput = document.getElementById("search-input");
      if (searchInput) { searchInput.focus(); searchInput.select(); }
      return;
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
    // (i / e used to enter edit mode; that's now Ctrl+E in the shell,
    // so Esc stays free for VIM's mode switch. See isOwnerModifier +
    // the Ctrl+E branch in handleKey.)
    if (k === "j" || k === "ArrowDown") { scrollEditor("down"); return; }
    if (k === "k" || k === "ArrowUp")   { scrollEditor("up"); return; }
    if (k === "G")                      { editorJump("bottom"); return; }
    if (k === "h") {
      // h in the editor window: scroll half-page up (vim's H/L would
      // be top/bottom of screen; Ctrl+H/L are reserved for tab nav).
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
            <tr><th><kbd>Ctrl</kbd>+<kbd>E</kbd></th><td>Toggle edit mode (focus the editor / return to preview)</td></tr>
            <tr><th><kbd>Alt</kbd>+<kbd>H</kbd> / <kbd>Alt</kbd>+<kbd>L</kbd></th><td>Previous / next tab (prompts to save if dirty in edit mode)</td></tr>
            <tr><th><kbd>Esc</kbd></th><td>Close this help, blur any input (in edit mode, Esc is VIM's insert → normal switch and stays in edit mode)</td></tr>
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
            <tr><th><kbd>Ctrl</kbd>+<kbd>E</kbd></th><td>Enter edit mode (full VIM via CodeMirror)</td></tr>
            <tr><th><kbd>/</kbd></th><td>Focus the search box (VIM-style search)</td></tr>
            <tr><th><kbd>t</kbd></th><td>New note</td></tr>
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
  function onKeyUp(e) {
    if (!enabled) return;
    // Esc on a contentEditable element has a browser-default side
    // effect: the editor blurs on keyup. CM6 still receives the
    // keydown and switches insert->normal mode, but the contentDOM
    // loses focus before the next keystroke (j/k) so the shell
    // keymap takes over -- j scrolls the page instead of moving
    // the cursor in CM6's normal mode. The user reported this as:
    // "i lose focus on vim window" / "i don't even use keyboard to
    // control it". We re-focus CM on the Esc keyup when CM had
    // focus at keydown time. (Keyup fires AFTER the browser's
    // default blur, so we put focus back here.)
    if (e.key === "Escape" && pendingEscRestore && NB.cmEditor) {
      pendingEscRestore = false;
      // Guard: only restore if we're still in edit mode (cm-host
      // is shown). If the user pressed Ctrl+E to exit edit mode
      // in the meantime, we shouldn't yank focus back into CM.
      const cmHost = document.getElementById("cm-host");
      if (cmHost && !cmHost.hidden) {
        NB.cmEditor.focus();
      }
    }
  }
  function attach() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
  }
  function detach() {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
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
