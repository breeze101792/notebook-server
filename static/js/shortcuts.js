/* shortcuts.js -- configurable keyboard shortcuts for the app shell.
 *
 * This module owns the app-level keybindings that are active when
 * VIM mode is OFF. When VIM mode is on, vimnav.js takes over the
 * keyboard (it binds Ctrl+S save, Ctrl+E toggle edit, etc.) and the
 * user customizes those via the :help overlay -- deliberately, the
 * VIM keymap is not configurable here. (See Settings -> VIM mode
 * and the :help overlay for VIM's own bindings.)
 *
 * The four actions exposed today:
 *   save         Ctrl/Cmd+S   -- save the current file
 *   openSearch   Ctrl/Cmd+F   -- focus the search box
 *   toggleEdit   Ctrl/Cmd+E   -- enter / leave edit mode
 *   openSettings Ctrl/Cmd+,   -- open the Settings modal
 *
 * Bindings are stored in cfg.shortcuts as {action: chordString}, where
 * a chord string is a "+"-joined list of modifiers + a key, e.g.
 * "Mod+S", "Ctrl+Shift+P", "F5", "Slash", "Comma". "Mod" is Cmd on
 * macOS and Ctrl elsewhere, so the same stored binding works on both
 * platforms without a migration. An empty string or null means the
 * action has no binding.
 *
 * Public surface (NB.shortcuts):
 *   install(handlers)    -- install the document keydown listener
 *     with a map of action -> handler. Call once at boot. Re-invoking
 *     replaces the handler map (used by tests).
 *   setBinding(a, s)     -- update cfg.shortcuts[a] and persist; the
 *     live listener picks it up on the next keydown.
 *   getBinding(a)        -- current stored chord (or "").
 *   resetBinding(a)      -- restore a single action's default.
 *   resetAll()           -- restore every action's default.
 *   format(chord)        -- render a chord for display
 *     ("Mod+S" -> "Ctrl+S" on Linux/Win, "Cmd+S" on mac).
 *   captureNext(cb)      -- arm a one-shot capture: the next keydown
 *     anywhere is reported to cb(chordString, keyEvent) and
 *     suppressed. Esc cancels. Used by the Settings "Change" flow.
 *   getDefaults() / getActionLabels() / getActionOrder()  -- for the
 *     Settings UI to render the rows.
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const DEFAULTS = {
    save:         "Mod+S",
    // / is the canonical "open search" chord. The dispatcher guards
    // modifierless chords (see `bareChordWouldSteal`) so a bare "/"
    // doesn't fire while the user is typing in an input -- the
    // same intuition vim's own / follows in the shell keymap.
    openSearch:   "/",
    tabPrev:      "Alt+H",
    tabNext:      "Alt+L",
    toggleEdit:   "Mod+E",
    openSettings: "Mod+comma",
  };
  const ACTION_LABELS = {
    save:         "Save current file",
    openSearch:   "Open search",
    tabPrev:      "Previous tab",
    tabNext:      "Next tab",
    toggleEdit:   "Toggle edit mode",
    openSettings: "Open Settings",
  };

  // Cmd-vs-Ctrl detection: we'd rather not store platform in the
  // chord. Mac: metaKey is the primary modifier; elsewhere ctrlKey.
  function isMac() {
    const p = (navigator.platform || "").toLowerCase();
    if (p.includes("mac")) return true;
    if (navigator.userAgentData && navigator.userAgentData.platform) {
      return /mac/i.test(navigator.userAgentData.platform);
    }
    return /mac/i.test(navigator.userAgent || "");
  }

  /* --- chord <-> event ----------------------------------------------- */
  // Turn a KeyboardEvent into a normalized chord string. We always
  // emit "Mod" for the platform's primary modifier (Cmd on Mac, Ctrl
  // elsewhere) so a stored "Mod+S" matches the user's Ctrl+S on
  // Linux AND Cmd+S on macOS without a per-platform config.
  //
  // Modifier order is fixed (Ctrl, Mod, Alt, Shift, key). The "key"
  // part comes from e.code first (layout-independent: a French AZERTY
  // user pressing the same physical key as the US QWERTY "Q" gets
  // the right binding) with a fallback to e.key.
  function eventToChord(e) {
    const parts = [];
    const mac = isMac();
    if (e.ctrlKey) parts.push("Ctrl");
    if (mac ? e.metaKey : e.ctrlKey) parts.push("Mod");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    const key = keyName(e);
    if (!key) return null;
    parts.push(key);
    return parts.join("+");
  }

  // Canonicalize a chord for storage. Collapses the common case
  // where both "Ctrl" and "Mod" appear (e.g. Linux Ctrl+H ->
  // "Ctrl+Mod+h"): "Mod" already represents the platform's primary
  // modifier, so keeping "Ctrl" alongside is redundant. Storing
  // "Mod+H" makes the display ("Ctrl+H" / "Cmd+H") and the stored
  // form agree on every platform. On Mac, "Ctrl" and "Mod" are
  // physically distinct (Ctrl vs Cmd), so a captured Ctrl+Cmd is
  // left as-is -- rare combo, the user can tell from the binding
  // display that both modifiers are involved. The key half is
  // uppercased when it's a single letter, so the stored form
  // ("Mod+H") matches what format() renders.
  function canonicalize(chord) {
    if (!chord) return chord;
    const parts = chord.split("+");
    let out;
    if (parts.includes("Mod") && parts.includes("Ctrl")) {
      out = parts.filter(p => p.toLowerCase() !== "ctrl");
    } else {
      out = parts.slice();
    }
    // Uppercase the key half (last element) if it's a single letter.
    const key = out[out.length - 1];
    if (key && key.length === 1 && /[a-z]/.test(key)) {
      out[out.length - 1] = key.toUpperCase();
    }
    return out.join("+");
  }

  // Resolve the "key" half of a chord. Returns a canonical name
  // like "s", "5", "f5", "slash", "comma", "escape", "arrowup" -- or
  // null for keys we don't bind (modifiers alone, dead keys, etc.).
  function keyName(e) {
    const code = e.code || "";
    let m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1].toLowerCase();
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    m = /^Numpad(\d)$/.exec(code);
    if (m) return "numpad" + m[1];
    m = /^F(\d{1,2})$/.exec(code);
    if (m) return "f" + m[1];
    const named = {
      Slash: "slash", Period: "period", Comma: "comma",
      Semicolon: "semicolon", Quote: "quote", Backquote: "backquote",
      BracketLeft: "bracketleft", BracketRight: "bracketright",
      Backslash: "backslash", Minus: "minus", Equal: "equal",
      Backspace: "backspace", Tab: "tab", Enter: "enter",
      NumpadEnter: "enter", NumpadAdd: "plus", NumpadSubtract: "minus",
      Escape: "escape", Space: "space",
      ArrowLeft: "arrowleft", ArrowRight: "arrowright",
      ArrowUp: "arrowup", ArrowDown: "arrowdown",
      Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown",
      Insert: "insert", Delete: "delete",
    };
    if (named[code]) return named[code];
    const k = e.key || "";
    if (k.length === 1) return k.toLowerCase();
    const kk = k.toLowerCase();
    if (kk === "escape" || kk === "enter" || kk === "tab" || kk === "backspace") return kk;
    return null;
  }

  // Normalize a key string the same way keyName() does for events.
  // Accepts either a single raw character (e.g. ",") or a canonical
  // name (e.g. "comma") and returns the canonical name. Used when
  // matching a stored chord, so a chord stored as "Mod+," (the raw
  // character) matches a Comma key the same as "Mod+comma" does.
  const CHAR_TO_NAME = {
    "/":"slash", ".":"period", ",":"comma", ";":"semicolon",
    "'":"quote", "`":"backquote", "[":"bracketleft", "]":"bracketright",
    "\\":"backslash", "-":"minus", "=":"equal",
  };
  function normalizeKeyName(s) {
    if (!s) return null;
    if (s.length === 1) {
      const c = s.toLowerCase();
      if (CHAR_TO_NAME[c]) return CHAR_TO_NAME[c];
      return c;
    }
    return s.toLowerCase();
  }

  // Does this event match this chord? The stored chord uses "Mod"
  // for the platform's primary modifier; we translate at match time.
  function matches(chord, e) {
    if (!chord) return false;
    const mac = isMac();
    const want = chord.split("+");
    const wantMods = new Set();
    let wantKey = null;
    for (const p of want) {
      const low = p.toLowerCase();
      if (low === "ctrl" || low === "mod" || low === "alt" || low === "shift") {
        wantMods.add(low);
      } else {
        wantKey = normalizeKeyName(p);
      }
    }
    const wantMeta  = wantMods.has("mod")   ? (mac ? e.metaKey : e.ctrlKey) : true;
    const wantCtrl  = wantMods.has("ctrl")  ? e.ctrlKey : true;
    const wantAlt   = wantMods.has("alt")   ? e.altKey  : true;
    const wantShift = wantMods.has("shift") ? e.shiftKey : true;
    // Reject extra "primary" modifiers: e.g. Meta on Linux when the
    // chord is "Mod+S", or Ctrl when the chord is "Mod+S" on Mac.
    const primaryExtra = mac
      ? (e.ctrlKey && !wantMods.has("ctrl"))
      : (e.metaKey && !wantMods.has("mod"));
    if (primaryExtra) return false;
    if (!(wantMeta && wantCtrl && wantAlt && wantShift)) return false;
    // If the chord requires a modifier, the event must carry at
    // least one (so "Mod+S" doesn't match a bare "s").
    if (wantMods.size > 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      return false;
    }
    const gotKey = keyName(e);
    return !!wantKey && !!gotKey && wantKey === gotKey;
  }

  // Pretty-print a chord for the UI: "Mod+S" -> "Ctrl+S" / "Cmd+S".
  function format(chord) {
    if (!chord) return "—";
    const mac = isMac();
    return chord.split("+").map((p, i, arr) => {
      const low = p.toLowerCase();
      const last = i === arr.length - 1;
      if (low === "mod") return last ? "" : (mac ? "Cmd" : "Ctrl");
      if (low === "ctrl") return "Ctrl";
      if (low === "alt") return mac ? "Opt" : "Alt";
      if (low === "shift") return "Shift";
      if (p.length === 1) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).filter(Boolean).join("+");
  }

  /* --- install + dispatch ------------------------------------------- */
  let handlers = {};
  let installed = false;
  // captureNext: when set, the next keydown reports to the callback
  // and is suppressed. Esc during capture cancels. Capture runs even
  // when a modal is up or vim is on -- it's how Settings "Change"
  // picks up a new key while the user sits in the modal.
  let captureCb = null;

  function modalIsOpen() {
    return !!document.querySelector(
      ".settings-overlay:not([hidden]), #auth-overlay:not([hidden])");
  }

  function onKeyDown(e) {
    if (captureCb) {
      const cb = captureCb;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        captureCb = null;
        try { cb(null, e); } catch (_) {}
        return;
      }
      const chord = canonicalize(eventToChord(e));
      if (chord) {
        e.preventDefault();
        e.stopPropagation();
        captureCb = null;
        try { cb(chord, e); } catch (_) {}
        return;
      }
      // Unrecognized (e.g. a bare modifier) -- keep capture armed.
      return;
    }
    // Find the first configured action whose chord matches this
    // event. "First match wins" is the collision policy.
    const cfg = (window.NB && NB.app && NB.app.getCfg) ? NB.app.getCfg() : null;
    const overrides = (cfg && cfg.shortcuts) || {};
    const order = ["save", "openSearch", "tabPrev", "tabNext", "toggleEdit", "openSettings"];
    let matchAction = null;
    let matchChord = null;
    for (const action of order) {
      const chord = Object.prototype.hasOwnProperty.call(overrides, action)
        ? overrides[action]
        : DEFAULTS[action];
      if (!chord) continue;
      if (matches(chord, e)) {
        matchAction = action;
        matchChord = chord;
        break;
      }
    }
    // Not one of our chords -- let the browser handle it. This is
    // deliberate: we only preventDefault on keys the app claims,
    // so things like Ctrl+L (focus address bar) and Ctrl+F (find)
    // keep working as long as the user hasn't rebound them.
    if (!matchAction) return;
    // Typing guard: a modifierless chord in a text input is the user
    // typing, not invoking a shortcut. Don't claim (no preventDefault)
    // and don't fire -- the keystroke passes through to the input.
    // Same intuition vim's own / follows in the shell keymap.
    if (chordHasNoModifiers(matchChord) && typingTargetHasFocus()) return;
    // Claim the chord for the app. preventDefault tells the browser
    // "we handle this key", which is important even when we don't
    // run the handler below (vim mode on, or a modal is up): in
    // those cases the keyboard is owned by vimnav or the modal,
    // but the browser should still not act on the chord (e.g. so
    // Ctrl+, with vim on doesn't get consumed by a browser default
    // or by a future Chrome update that adds a Ctrl+, binding).
    e.preventDefault();
    // Only fire the handler when the app is actually driving the
    // keyboard. With vim on, vimnav owns the keys (and has already
    // preventDefaulted its own chords); with a modal up, the modal
    // owns the keys. Either way, our handler shouldn't run.
    if (modalIsOpen()) return;
    if (window.NB && NB.vimnav && NB.vimnav.isEnabled && NB.vimnav.isEnabled()) return;
    const fn = handlers[matchAction];
    if (fn) {
      try { fn(e); } catch (err) { console.error("shortcut handler error", err); }
    }
  }

  // A chord is "modifierless" when it has no Ctrl/Mod/Alt/Shift --
  // just a bare key. These are the only chords that can collide
  // with typing into a text field, so the dispatcher yields on them
  // when a typing target has focus.
  function chordHasNoModifiers(chord) {
    if (!chord) return false;
    for (const p of chord.split("+")) {
      const low = p.toLowerCase();
      if (low === "ctrl" || low === "mod" || low === "alt" || low === "shift") return false;
    }
    return true;
  }
  function typingTargetHasFocus() {
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    if (a.isContentEditable) return true;
    const tag = a.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function install(map) {
    handlers = map || {};
    if (!installed) {
      document.addEventListener("keydown", onKeyDown, true);
      installed = true;
    }
  }

  function captureNext(cb) { captureCb = cb; }

  /* --- cfg helpers ------------------------------------------------- */
  function getBinding(action) {
    if (!DEFAULTS[action]) return "";
    const cfg = (window.NB && NB.app && NB.app.getCfg) ? NB.app.getCfg() : null;
    const overrides = (cfg && cfg.shortcuts) || {};
    return Object.prototype.hasOwnProperty.call(overrides, action)
      ? (overrides[action] || "")
      : DEFAULTS[action];
  }

  function setBinding(action, chord) {
    if (!DEFAULTS[action]) return;
    const cfg = (window.NB && NB.app && NB.app.getCfg) ? NB.app.getCfg() : null;
    if (!cfg) return;
    cfg.shortcuts = cfg.shortcuts || { ...DEFAULTS };
    cfg.shortcuts[action] = (chord && String(chord)) || "";
    if (window.NB.app.setShortcuts) NB.app.setShortcuts(cfg.shortcuts);
  }

  function resetBinding(action) { setBinding(action, DEFAULTS[action]); }

  function resetAll() {
    if (window.NB && NB.app && NB.app.setShortcuts) {
      NB.app.setShortcuts({ ...DEFAULTS });
    } else {
      const cfg = NB.app && NB.app.getCfg && NB.app.getCfg();
      if (cfg) cfg.shortcuts = { ...DEFAULTS };
    }
  }

  function getDefaults() { return { ...DEFAULTS }; }
  function getActionLabels() { return { ...ACTION_LABELS }; }
  function getActionOrder() { return Object.keys(DEFAULTS); }

  NB.shortcuts = {
    install, captureNext,
    getBinding, setBinding, resetBinding, resetAll,
    getDefaults, getActionLabels, getActionOrder,
    format, matches, eventToChord,
  };
})();
