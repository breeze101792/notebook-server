/* editbar.js -- formatting toolbar that appears under the tab bar in
 * edit mode. Wraps the active selection (or inserts a placeholder)
 * with the appropriate Markdown syntax.
 *
 * Implementation note: the underlying editor is now CodeMirror 6
 * (see cm-bridge.js). This module talks to it through the
 * `NB.cmEditor` API and never reads/writes the underlying <textarea>
 * directly. CM6's selection is { from, to } (char offsets into the
 * document); we read it once per action and dispatch a single
 * transaction per write.
 *
 * Public surface (NB.editbar.show/hide, same data-act keys on the
 * buttons) is unchanged from the textarea era, so the rest of the
 * app doesn't need to know about the swap.
 *
 * Design notes:
 *   - "Wrap" actions (bold/italic/strike/code/link) use a sensible
 *     placeholder if no text is selected, so the user can keep typing.
 *   - "Line" actions (h1-h6, ul, ol, task, quote, codeblock, hr) operate
 *     on every line in the selection; if no selection, on the current
 *     line. Each is idempotent: clicking H1 again on an H1 line removes
 *     the prefix.
 *   - Undo/Redo use the cm-bridge's view().state.facets or, more
 *     directly, the @codemirror/commands `undo`/`redo` helpers
 *     (CM6.history is on the state, so we go through the global CM6
 *     namespace).
 */
(function () {
  "use strict";
  window.NB = window.NB || {};

  const bar         = document.getElementById("edit-bar");
  const overflowBtn = bar.querySelector(".eb-overflow-btn");
  const overflowMenu = bar.querySelector(".eb-menu");
  const tableMenu   = bar.querySelector(".eb-table-menu");

  /* Get the current selection as { start, end, text, value }. The
   * `start`/`end` fields are char offsets into the document
   * (matches the old textarea's `selectionStart`/`End` shape so the
   * action code below is symmetric). */
  function sel() {
    const s = NB.cmEditor.getSelection();
    return {
      start: s.from,
      end: s.to,
      text: s.text,
      value: NB.cmEditor.getValue(),
    };
  }

  /* Wrap the selection with `marker` on each side, or insert a
   * placeholder if no text is selected. */
  function wrap(marker, placeholder) {
    const { start, end, text } = sel();
    const ph = text || (placeholder || marker);
    const insert = marker + ph + marker;
    NB.cmEditor.replaceSelection(insert, "select");
  }

  /* Replace the whole-line block the selection covers. Returns the
   * range the new block occupies so the caller can re-select it. */
  function replaceLines(newLines) {
    const { start, end, value } = sel();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = value.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const newBlock = newLines(block.split("\n")).join("\n");
    // CM6 has no direct "replace range" helper; setValue dispatches a
    // full doc change. The editbar acts one click at a time, so the
    // cost is fine.
    const newDoc = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    NB.cmEditor.setValue(newDoc);
    NB.cmEditor.setSelection(lineStart, lineStart + newBlock.length);
  }

  /* Line-prefix action: operates on every line touched by the
   * selection, or the current line if no selection. Idempotent:
   * clicking the same heading twice removes the prefix. */
  function lineAction(prefix, detectRegex) {
    replaceLines(lines =>
      lines.every(l => detectRegex.test(l))
        ? lines.map(l => l.replace(detectRegex, ""))
        : lines.map(l => prefix + l));
  }

  /* The source-mode mirror of hybrid's per-item list model (see
   * setListItemType in hybrid.js). Each list button acts on the line the
   * caret is in, matching Word and Google Docs:
   *
   *   - pressing the line's own type (no checkbox) removes the marker;
   *   - pressing Task on a task line removes the marker;
   *   - otherwise the line is given the pressed type, converting between
   *     bullet/number and dropping any checkbox.
   *
   * Over a multi-line selection, if EVERY touched line is already
   * exactly the pressed type the whole block is unlisted; otherwise
   * every list line is set to the pressed type. Blank lines are left
   * alone.
   *
   * A leading "> " quote prefix is preserved, so a quoted list keeps its
   * quote (in hybrid a quoted list is a list inside a blockquote; the
   * two modes agree).
   *
   *   kind: "bullet" | "number" | "task" */
  const LIST_LINE_RE = /^(\s*)(?:>\s+)?([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/;
  const BLANK_LINE_RE = /^\s*$/;
  const QUOTE_PREFIX_RE = /^(\s*>\s+)/;

  function parseListLine(line) {
    const m = LIST_LINE_RE.exec(line);
    if (!m) return null;
    return {
      indent: m[1],
      marker: m[2],
      number: /^\d/.test(m[2]),
      checkbox: m[3] !== undefined,
      text: m[4],
      quote: QUOTE_PREFIX_RE.test(line),
    };
  }

  function isListKind(parsed, kind) {
    if (!parsed) return false;
    if (kind === "task") return parsed.checkbox;
    // A bullet/number line with a checkbox is a TASK, not that list
    // type, so pressing the plain type strips the checkbox instead of
    // toggling the line out of the list.
    if (kind === "number") return parsed.number && !parsed.checkbox;
    return !parsed.number && !parsed.checkbox;
  }

  /* Give a line the pressed type. The caller has already handled the
   * toggle-off case, so a line that already matches is left alone. A
   * leading quote prefix is preserved. */
  function setListLine(line, kind) {
    if (BLANK_LINE_RE.test(line)) return line;
    const q = QUOTE_PREFIX_RE.test(line) ? "> " : "";
    const p = parseListLine(line);
    if (!p) {
      // Not a list line: give it the pressed type.
      if (kind === "task") return line.replace(/^(\s*>?\s*)/, "$1- [ ] ");
      return q + (kind === "number" ? "1. " : "- ") + line;
    }
    if (kind === "task") {
      const marker = p.number ? p.marker : "-";
      return q + marker + " [ ] " + p.text;
    }
    if (kind === "number") return q + "1. " + p.text;
    return q + "- " + p.text;
  }

  /* The source-mode Quote button: "> " prefix on every touched line, or
   * strip it when the whole touched block is already quoted. This keeps a
   * quoted list as "> - item" (one quote, one list) and un-quotes it back
   * to "- item", matching hybrid's blockquote toggle. */
  function quoteAction() {
    replaceLines(lines => {
      const touched = lines.filter(l => !BLANK_LINE_RE.test(l));
      const allQuoted = touched.length > 0 &&
        touched.every(l => QUOTE_PREFIX_RE.test(l));
      if (allQuoted) return lines.map(l => l.replace(QUOTE_PREFIX_RE, ""));
      return lines.map(l =>
        BLANK_LINE_RE.test(l) || QUOTE_PREFIX_RE.test(l) ? l : "> " + l);
    });
  }

  function listAction(kind) {
    replaceLines(lines => {
      const touched = lines.filter(l => !BLANK_LINE_RE.test(l));
      // Toggle the block out of the list only when every non-blank line
      // is already exactly the pressed type.
      const allMatch = touched.length > 0 &&
        touched.every(l => isListKind(parseListLine(l), kind));
      return lines.map(l => {
        const p = parseListLine(l);
        if (allMatch) return p ? (p.quote ? "> " : "") + p.text : l;
        // In a mixed block, a line that already has the type keeps it;
        // only the others are set.
        if (isListKind(p, kind)) return l;
        return setListLine(l, kind);
      });
    });
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

    ul:    () => listAction("bullet"),
    ol:    () => listAction("number"),
    task:  () => listAction("task"),
    quote: () => quoteAction(),

    /* Inline link: ask the user for the URL, then wrap. */
    link() {
      const { start, end, text } = sel();
      const label = text || PLACEHOLDER.link;
      const url = prompt("Link URL:", "https://");
      if (url === null) return;
      const insert = "[" + label + "](" + url + ")";
      NB.cmEditor.setSelection(start, end);   // ensure selection
      NB.cmEditor.replaceSelection(insert, "select");
    },
    image() {
      const { start, end, text } = sel();
      const alt = text || PLACEHOLDER.image;
      const url = prompt("Image URL:", "https://");
      if (url === null) return;
      const insert = "![" + alt + "](" + url + ")";
      NB.cmEditor.setSelection(start, end);
      NB.cmEditor.replaceSelection(insert, "select");
    },

    /* Fenced code block: act on the current line / selection. */
    codeblock() {
      const { start, end, text } = sel();
      const body = text || "code";
      const insert = "```\n" + body + "\n```";
      NB.cmEditor.setSelection(start, end);
      NB.cmEditor.replaceSelection(insert, "select");
    },

    /* Horizontal rule on its own line. */
    hr() {
      const { start, value } = sel();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const before = value.slice(0, lineStart);
      const after  = value.slice(lineStart);
      const sep = (after.startsWith("\n") || before.endsWith("\n") || before === "") ? "" : "\n";
      const insert = sep + "\n---\n";
      const newDoc = before + insert + after;
      NB.cmEditor.setValue(newDoc);
      // Place cursor right after the inserted rule.
      const cursor = before.length + insert.length;
      NB.cmEditor.setSelection(cursor, cursor);
    },

    /* Tiny GFM table with a 2-col header the user can edit. */
    table() {
      const { start, end, value } = sel();
      const insert =
        "\n| Column 1 | Column 2 |\n" +
        "| --- | --- |\n" +
        "| cell | cell |\n";
      // Insert at the end of the current selection.
      const newDoc = value.slice(0, end) + insert + value.slice(end);
      NB.cmEditor.setValue(newDoc);
      // Place cursor right after the inserted table.
      const cursor = end + insert.length;
      NB.cmEditor.setSelection(cursor, cursor);
    },

    /* Undo / Redo: CM6 has its own history (in basicSetup). We
     * dispatch via @codemirror/commands' undo/redo. The simplest
     * way: call the CM6 helpers on the view. */
    undo() {
      const v = NB.cmEditor.view();
      if (v && window.CM6) {
        window.CM6.undo(v);
        v.focus();
      }
    },
    redo() {
      const v = NB.cmEditor.view();
      if (v && window.CM6) {
        window.CM6.redo(v);
        v.focus();
      }
    },

    /* Strip leading markdown formatting from every selected line. */
    clear() {
      const { start, end, value } = sel();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = value.indexOf("\n", end);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const block = value.slice(lineStart, lineEnd);
      const stripped = block.split("\n").map(l =>
        l.replace(/^\s{0,3}#{1,6}\s+/, "")
         .replace(/^\s{0,3}>\s?/, "")
         .replace(/^\s{0,3}([-*+]|\d+\.)\s+/, "")
         .replace(/^\s{0,3}([-*+])\s+\[[ x]\]\s+/i, "")
      ).join("\n");
      const newDoc = value.slice(0, lineStart) + stripped + value.slice(lineEnd);
      NB.cmEditor.setValue(newDoc);
      NB.cmEditor.setSelection(lineStart, lineStart + stripped.length);
    },

    /* The overflow trigger. */
    more() {
      overflowMenu.hidden = !overflowMenu.hidden;
    },

    /* Table actions dropdown trigger. */
    "table-menu"() {
      tableMenu.hidden = !tableMenu.hidden;
    },

    /* --- table operations (markdown source) ---------------------- */

    /* Find the markdown table block that contains the cursor, and
     * return { start, end, lines, rowIdx, colIdx } where lines is the
     * array of raw table lines and rowIdx/colIdx locate the cursor's
     * cell. Returns null if the cursor isn't inside a table. */
    _tableAt() {
      const { start, value } = sel();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const lineEndIdx = value.indexOf("\n", start);
      const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
      const curLine = value.slice(lineStart, lineEnd);
      if (!/^\s*\|.*\|/.test(curLine)) return null;
      // Walk up to find the first table line.
      let headerStart = lineStart;
      while (headerStart > 0) {
        const p = value.lastIndexOf("\n", headerStart - 1);
        const prevLine = value.slice(p + 1, headerStart);
        if (!/^\s*\|.*\|/.test(prevLine)) break;
        headerStart = p + 1;
      }
      // Walk down to find the last table line.
      let tableEnd = lineEnd;
      let nextStart = lineEndIdx === -1 ? value.length : lineEndIdx + 1;
      while (nextStart < value.length) {
        const n = value.indexOf("\n", nextStart);
        const nextLine = value.slice(nextStart, n === -1 ? value.length : n);
        if (!/^\s*\|.*\|/.test(nextLine)) break;
        tableEnd = n === -1 ? value.length : n;
        nextStart = n + 1;
      }
      const block = value.slice(headerStart, tableEnd);
      const lines = block.split("\n");
      const rowIdx = lines.findIndex((l) => {
        const ls = value.lastIndexOf("\n", start - 1) + 1;
        return value.slice(ls, ls + l.length) === l;
      });
      // Column index: count pipes before the cursor on the current line.
      const before = value.slice(lineStart, start);
      const colIdx = Math.max(0, (before.match(/\|/g) || []).length - 1);
      return { start: headerStart, end: tableEnd, lines, rowIdx, colIdx };
    },

    /* Split a table line into its cells (trimmed, without leading/trailing |). */
    _splitCells(line) {
      const s = line.trim();
      const inner = s.replace(/^\|/, "").replace(/\|$/, "");
      return inner.split("|").map((c) => c.trim());
    },

    /* Rebuild a table line from cells, preserving the original
     * leading/trailing pipe style. */
    _joinCells(cells, original) {
      const lead = /^\s*\|/.test(original) ? "|" : "";
      const trail = /\|\s*$/.test(original) ? "|" : "";
      return lead + cells.join(" | ") + trail;
    },

    /* Rewrite the table block under the cursor with new lines. */
    _rewriteTable(newLines) {
      const t = actions._tableAt();
      if (!t) return;
      const { start, end, value } = sel();
      const newBlock = newLines.join("\n");
      const newDoc = value.slice(0, start) + newBlock + value.slice(end);
      NB.cmEditor.setValue(newDoc);
      NB.cmEditor.setSelection(start, start + newBlock.length);
    },

    "table-row-above"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.slice();
      const idx = t.rowIdx;
      if (idx <= 0) return; // can't insert above the header
      const cells = actions._splitCells(lines[idx]);
      lines.splice(idx, 0, actions._joinCells(cells.map(() => "cell"), lines[idx]));
      actions._rewriteTable(lines);
    },
    "table-row-below"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.slice();
      const idx = t.rowIdx;
      if (idx <= 0) return;
      const cells = actions._splitCells(lines[idx]);
      lines.splice(idx + 1, 0, actions._joinCells(cells.map(() => "cell"), lines[idx]));
      actions._rewriteTable(lines);
    },
    "table-row-delete"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.slice();
      const idx = t.rowIdx;
      if (idx <= 0) return; // don't delete the header
      if (lines.length <= 2) return; // only header + one row left
      lines.splice(idx, 1);
      actions._rewriteTable(lines);
    },
    "table-col-left"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.map((line, i) => {
        if (i === 1) return line; // separator row unchanged
        const cells = actions._splitCells(line);
        cells.splice(t.colIdx, 0, "cell");
        return actions._joinCells(cells, line);
      });
      actions._rewriteTable(lines);
    },
    "table-col-right"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.map((line, i) => {
        if (i === 1) return line;
        const cells = actions._splitCells(line);
        cells.splice(t.colIdx + 1, 0, "cell");
        return actions._joinCells(cells, line);
      });
      actions._rewriteTable(lines);
    },
    "table-col-delete"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.map((line, i) => {
        if (i === 1) return line;
        const cells = actions._splitCells(line);
        if (cells.length <= 1) return line;
        cells.splice(t.colIdx, 1);
        return actions._joinCells(cells, line);
      });
      actions._rewriteTable(lines);
    },
    "table-header"() {
      const t = actions._tableAt();
      if (!t) return;
      const lines = t.lines.slice();
      // Toggle: if the separator row exists, remove it (header becomes body);
      // otherwise insert one after the first row.
      const sepIdx = lines.findIndex((l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-"));
      if (sepIdx !== -1) {
        lines.splice(sepIdx, 1);
      } else {
        const cells = actions._splitCells(lines[0]);
        lines.splice(1, 0, "| " + cells.map(() => "---").join(" | ") + " |");
      }
      actions._rewriteTable(lines);
    },
    "table-delete"() {
      const t = actions._tableAt();
      if (!t) return;
      const { start, end, value } = sel();
      const newDoc = value.slice(0, start) + value.slice(end);
      NB.cmEditor.setValue(newDoc);
      NB.cmEditor.setSelection(start, start);
    },
  };

  /* --- visibility / wiring ---------------------------------------- */

  function show() { bar.hidden = false; }
  function hide() { bar.hidden = true; overflowMenu.hidden = true; if (tableMenu) tableMenu.hidden = true; }

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const fn = actions[act];
    if (fn) fn();
    if (btn.closest(".eb-menu")) overflowMenu.hidden = true;
    if (btn.closest(".eb-table-menu")) tableMenu.hidden = true;
  });

  document.addEventListener("click", (e) => {
    if (overflowMenu.hidden) return;
    if (e.target.closest(".eb-overflow")) return;
    overflowMenu.hidden = true;
  });

  /* The Ctrl/Cmd+B and Ctrl/Cmd+I keyboard shortcuts are bound
   * via cm-bridge.js's Prec.high keymap on the CM view (so they
   * work even when the vim keymap is active). We don't need a
   * keydown listener here anymore. */

  NB.editbar = { show, hide, actions };
})();
