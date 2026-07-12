/* editbar.js -- formatting toolbar that appears under the tab bar in edit
 * mode. Wraps the active selection (or inserts a placeholder) with the
 * appropriate Markdown syntax. All actions mutate the textarea value
 * directly; the existing viewer input-listener then picks up the change
 * and refreshes the dirty/Save state.
 *
 * Design notes:
 *   - "Wrap" actions (bold/italic/strike/code/link) use a sensible
 *     placeholder if no text is selected, so the user can keep typing.
 *   - "Line" actions (h1-h6, ul, ol, task, quote, codeblock, hr) operate
 *     on every line in the selection; if no selection, on the current
 *     line. Each is idempotent: clicking H1 again on an H1 line removes
 *     the prefix.
 *   - The button bar is in the DOM at boot but hidden; viewer.js calls
 *     editbar.show()/hide() when entering/leaving edit mode.
 *   - We listen for clicks on the bar (delegated) and for Ctrl/Cmd+B/I
 *     inside the textarea. Other Ctrl shortcuts (S, Z, Y) are handled by
 *     the existing app.js / textarea defaults.
 *   - Overflow menu ("more") toggles a small popup with the less-common
 *     actions (hr, table, h5/h6, clear formatting).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const bar        = document.getElementById("edit-bar");
  const editor     = document.getElementById("raw-editor");
  const overflowBtn = bar.querySelector(".eb-overflow-btn");
  const overflowMenu = bar.querySelector(".eb-menu");

  /* --- selection helpers -------------------------------------------- */

  /* Get the current selection in the textarea, as { start, end, text }.
   * start/end are 0-based character offsets in editor.value. */
  function sel() {
    return { start: editor.selectionStart, end: editor.selectionEnd,
             text: editor.value.slice(editor.selectionStart, editor.selectionEnd) };
  }

  /* Replace editor.value with `text` and restore focus + selection.
   * `select` is one of:
   *   "new"     -- select the inserted text (default for wrap actions)
   *   "caret"   -- put the cursor right after the inserted text
   *   "offset:N -- position the cursor N chars after the start
   *   null/undefined -- leave the selection where the textarea puts it
   * The "new" selection lets the user immediately retype the placeholder.
   */
  function setValue(text, select) {
    editor.focus();
    // setRangeText handles the value + selection update atomically and
    // fires an input event when the value actually changes.
    const before = editor.value;
    if (select === "new" || select === "caret") {
      // use the lower-level write path so we can control the selection
      editor.value = text;
      // We don't know where the changed region is without doing it
      // ourselves. Caller can pass offsets via select="offset:N" instead.
    } else if (typeof select === "string" && select.startsWith("offset:")) {
      const offset = parseInt(select.slice(7), 10) || 0;
      editor.value = text;
      const pos = Math.min(text.length, offset);
      editor.setSelectionRange(pos, pos);
    } else {
      editor.value = text;
    }
    if (editor.value !== before) {
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /* Wrap-or-insert. If text is selected, wraps it; otherwise inserts a
   * placeholder and selects it. The marker (e.g. "**") is added on both
   * sides. */
  function wrap(marker, placeholder) {
    const { start, end, text } = sel();
    const ph = text || (placeholder || marker);
    const insert = marker + ph + marker;
    editor.focus();
    editor.setRangeText(insert, start, end, "select");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* Line-prefix action (h1/h2/.../quote/ul/ol/task). Operates on every
   * line touched by the selection, or the current line if no selection.
   * Idempotent: clicking the same heading twice removes the prefix. */
  function lineAction(prefix, detectRegex) {
    const { start, end } = sel();
    const value = editor.value;
    // Expand to whole lines.
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = value.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");

    // Detect "all lines already have this prefix" -> strip instead.
    const allHave = lines.every(l => detectRegex.test(l));
    const newLines = allHave
      ? lines.map(l => l.replace(detectRegex, ""))
      : lines.map(l => prefix + l);

    const newBlock = newLines.join("\n");
    editor.focus();
    editor.setRangeText(newBlock, lineStart, lineEnd, "select");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* --- actions ------------------------------------------------------ */

  const PLACEHOLDER = {
    bold: "bold text", italic: "italic text", strike: "strikethrough",
    code: "code", link: "link text", image: "alt text",
  };

  const actions = {
    bold:   () => wrap("**", PLACEHOLDER.bold),
    italic: () => wrap("*",  PLACEHOLDER.italic),
    strike: () => wrap("~~", PLACEHOLDER.strike),
    code:   () => wrap("`",  PLACEHOLDER.code),

    h1: () => lineAction("# ",       /^#+\s/),
    h2: () => lineAction("## ",      /^#+\s/),
    h3: () => lineAction("### ",     /^#+\s/),
    h4: () => lineAction("#### ",    /^#+\s/),
    h5: () => lineAction("##### ",   /^#+\s/),
    h6: () => lineAction("###### ",  /^#+\s/),

    ul:    () => lineAction("- ",     /^[-*]\s/),
    ol:    () => lineAction("1. ",    /^\d+\.\s/),
    task:  () => lineAction("- [ ] ", /^[-*]\s+\[[ x]\]\s/i),
    quote: () => lineAction("> ",     /^>\s/),

    /* Inline code/link/image: ask the user for the URL/alt as needed. */
    link() {
      const { start, end, text } = sel();
      const label = text || PLACEHOLDER.link;
      const url = prompt("Link URL:", "https://");
      if (url === null) return;          // user cancelled
      const insert = "[" + label + "](" + url + ")";
      editor.focus();
      editor.setRangeText(insert, start, end, "select");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },
    image() {
      const { start, end, text } = sel();
      const alt = text || PLACEHOLDER.image;
      const url = prompt("Image URL:", "https://");
      if (url === null) return;
      const insert = "![" + alt + "](" + url + ")";
      editor.focus();
      editor.setRangeText(insert, start, end, "select");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },

    /* Fenced code block: act on the current line / selection. */
    codeblock() {
      const { start, end, text } = sel();
      const body = text || "code";
      const insert = "```\n" + body + "\n```";
      editor.focus();
      editor.setRangeText(insert, start, end, "select");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },

    /* Horizontal rule on its own line. */
    hr() {
      const { start, end } = sel();
      const value = editor.value;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      // Insert a blank line + --- + newline, then position the cursor on
      // the middle line.
      const before = value.slice(0, lineStart);
      const after  = value.slice(lineStart);
      const sep = (after.startsWith("\n") || before.endsWith("\n") || before === "") ? "" : "\n";
      const insert = sep + "\n---\n";
      editor.focus();
      // setRangeText's 4th arg is the selection mode (start/end/select/preserve);
      // we want the cursor right after the inserted text, so use "end".
      editor.setRangeText(insert, lineStart, lineStart, "end");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },

    /* Tiny GFM table with a 2-col header the user can edit. */
    table() {
      const { start, end } = sel();
      const insert =
        "\n| Column 1 | Column 2 |\n" +
        "| --- | --- |\n" +
        "| cell | cell |\n";
      editor.focus();
      editor.setRangeText(insert, start, end, "end");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },

    /* Undo / Redo: the textarea has its own native history. */
    undo: () => { editor.focus(); document.execCommand && document.execCommand("undo"); },
    redo: () => { editor.focus(); document.execCommand && document.execCommand("redo"); },

    /* Strip leading markdown formatting from every selected line:
     *   - heading prefixes (#, ##, ...)
     *   - list markers (-, *, 1., - [ ])
     *   - quote markers (>)
     * Inline emphasis (bold/italic/etc) is intentionally left alone --
     * stripping ** from "**hello** world" turns the rest into literal
     * asterisks, which is more surprising than useful. */
    clear() {
      const { start, end } = sel();
      const value = editor.value;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = value.indexOf("\n", end);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const block = value.slice(lineStart, lineEnd);
      const stripped = block.split("\n").map(l =>
        l.replace(/^\s{0,3}#{1,6}\s+/, "")      // heading
         .replace(/^\s{0,3}>\s?/, "")            // blockquote
         .replace(/^\s{0,3}([-*+]|\d+\.)\s+/, "") // list
         .replace(/^\s{0,3}([-*+])\s+\[[ x]\]\s+/i, "") // task
      ).join("\n");
      editor.focus();
      editor.setRangeText(stripped, lineStart, lineEnd, "select");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },

    /* The overflow trigger: show/hide the popup menu. */
    more: () => {
      overflowMenu.hidden = !overflowMenu.hidden;
    },
  };

  /* --- visibility / wiring ---------------------------------------- */

  /* Show / hide the bar. Called by viewer.js. */
  function show() { bar.hidden = false; }
  function hide() { bar.hidden = true; overflowMenu.hidden = true; }

  /* Delegated click handler on the bar. We don't listen for individual
   * buttons because the overflow menu can contain the same data-act
   * (e.g. h5/h6/clear/hr/table all live there). */
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const fn = actions[act];
    if (fn) fn();
    // Close the overflow menu after any action that lives inside it.
    if (btn.closest(".eb-menu")) overflowMenu.hidden = true;
  });

  /* Click outside the overflow menu closes it. */
  document.addEventListener("click", (e) => {
    if (overflowMenu.hidden) return;
    if (e.target.closest(".eb-overflow")) return;
    overflowMenu.hidden = true;
  });

  /* Ctrl/Cmd+B and Ctrl/Cmd+I inside the textarea. */
  editor.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); actions.bold(); }
    else if (k === "i") { e.preventDefault(); actions.italic(); }
  });

  NB.editbar = { show, hide };
})();
