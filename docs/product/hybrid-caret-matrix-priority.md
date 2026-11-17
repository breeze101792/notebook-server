# Hybrid caret matrix — severity and must-fix decisions

Status: decision layer for the caret/operation matrix. Owner: `product-designer`.
Applies to: [hybrid-editing.md](../architecture/hybrid-editing.md) §3–§7,
[hybrid-block-marker-backspace.md](hybrid-block-marker-backspace.md),
[hybrid-mode.md](../ui/hybrid-mode.md).

The matrix runner produces pass/fail rows against §4. This file answers the next
question for each failure: **is it a must-fix or an accepted limitation?** It
does not restate §4; it names the must-pass subset, ranks a failure by what the
owner loses, and resolves the places where the three docs disagree.

**How to use it.** For a failing row: (1) assign a severity by §1; (2) check
whether that cell is in the must-pass set for its construct in §2; (3) look up
the failure class in §3 for the verdict. A row the contract does not define is
`BLOCKED`, not a failure.

## 1. Severity model

| # | Name | What the owner loses | One-line test | Blocks? |
|---|---|---|---|---|
| **P0** | File corruption | Words are gone, words changed, or the document that reloads is not the document on screen (a cell moves column, code lines merge, text is resurrected). | Save, reload from disk, compare the text and the block content against what was on screen. Did any word vanish or change, or did any block's content change? | **Everything.** One P0 fails the matrix and stops all other hybrid work, including P1 fixes, until it is fixed. |
| **P1** | Contamination or structure loss, words intact | The `.md` holds something the owner did not type (a tag, chrome, a sentinel, an extra newline), or a block lost its type (marker, list type, language, numbering) with every word still present. | Do the saved bytes contain anything not typed, or a block whose type differs from before the edit, with all words present? | Sign-off: hybrid is not "done" at any P1. Does not block a P0 fix. |
| **P2** | Caret / focus dead-end | The caret lands nowhere or in the wrong block, one press does nothing, a second press is needed, focus leaves the editor. No file change. | After the action, is the caret inside the block where typing is expected, and does the next keystroke land there? | No. |
| **P3** | Cosmetic | Chrome flash, caret x position, an invisible selection on an `<hr>`, wording. | Does anything on disk, or the caret's destination, change? | No. |

Rules that decide the hard cases:

- **Classify by the worst reachable outcome, on the plainest repro, in the file.**
  A DOM artefact that cannot reach the file is P2 or P3, not P1.
- **A row with no stated expected result is `BLOCKED`.** Send it to the owner as
  an open decision (§6 of the contract) and score nothing. Do not invent an
  expectation to fill the row.
- **Canonicalizing a block the owner touched is not a defect at any severity**
  (`*`→`-`, setext→ATX, `---`→`* * *`, indented→fenced). The contract decides it
  (§6 Q4, §7).
- **Changing bytes in a block the owner did not touch is P1 minimum**, even
  spelling only, because the splice contract promises those bytes (§1.3 I2,
  §5.5). Exception: the documented fail-closed fallback in §3 row 16.
- **A dead caret is P2 only when a click recovers it.** If typing goes nowhere
  at all (focus outside `#viewer-content`), it is **P2-must-fix-now**: it stops
  all writing, so it is treated as blocking that construct.

## 2. Must-pass set per construct

Cell notation: `pos op → required result`. `—` means no requirement beyond
I1 (no words lost) and I2 (no format lost unintentionally). Every row is the
minimum the matrix must assert; §4 holds the full catalog with its citations.
"Worst" is the severity of the worst realistic failure of that row.

| Construct (§4.x) | Must pass | Worst | What the owner sees when it fails |
|---|---|---|---|
| Paragraph (§4.1) | `S ⌫` merge, both texts kept, paragraph kept · `S G` no conversion mid-line · `M C` in place · `E ↵` one block, one blank line, no `<br>` · `E ⇧↵` one empty block after · `E ⌦` merge forward, no word lost · `B C` the typed char survives (may land in the neighbour, §3 row 13) · `∅ ↵` one empty block · `∅ D` blank line, no stray marker | P0 | Words disappear at a join, or one keypress leaves a growing gap of blank lines. |
| ATX h1–h6 (§4.2) | `S ⌫` first content char intact · `S C #no-space` stays literal (`\#`) · `T ⌫` marker peels to `<p>`, caret at the first char, neighbours untouched · `T C` inserts before the first word · `M C` in place; a block trigger does not retype an existing heading · `E C` appends · `E ↵` one block after, `##` never mid-line · `E ⌦` merge forward · `B C/↵` does not retype the heading · `∅ C` lands in the heading and keeps its level (real engine, Q12) · `∅ ⌫/⌦` peel to an empty `<p>` · `∅` untouched empty heading saves `###` | P0 | The title saved as `## Titlebody`, or a typed letter appearing in the paragraph below. |
| Setext (§4.3) | no edit → byte-identical · `T/M C` → ATX, text kept · `E ⇧↵` `<p>` after · `S/B ⌫` native merge, no word lost | P1 | The title becomes a paragraph with `=====` printed under it. |
| Bullet `- * +` (§4.4) | `S ⌫` merge/outdent keeps the item text; siblings keep their type · `T ⌫` item → `<p>`, list splits around it · `M C` · `Tab`/`⇧Tab` one level · `E ↵` new item below · `E ⇧↵` `<p>` after the whole list · `E ⌦` before a 2+ item list refused, first item keeps `-` · `∅ ↵` empty item outdents to a paragraph · `∅ ⌫/⌦` line removed, list stays one list, undo restores · `D` → `-` | P0 | Two bullets collapse into one, a list turns into paragraphs, or a bare `-` line is left behind. |
| Ordered `1.` `1)` (§4.5) | all bullet rows, plus `E ↵` new item · `T ⌫` split keeps the trailing items' displayed numbers (`start`) · `∅ G 1. ` → `1.` · `∅ G 2. ` renumbers by position · `D` → `1.` | P1 | Item 3 saved as `1.`, so the list renumbers itself on reload. |
| Nested list (§4.6) | `Tab`/`⇧Tab` one level · `T ⌫` nested item → paragraph with its children hoisted after it, not deleted · `M ⇧↵` `<p>` after the outer list · `∅ ↵` splits without orphaning a child list · `D` → `-` at its indent | P0 | Sub-items vanish with the parent, or surface as top-level bullets. |
| Task list (§4.7) | `T ⌫` checkbox + class gone, text kept, never `- [ ] - item` · `M/E ↵` new sibling with its own checkbox, text split at the caret · `E ⌦` next item's text joins, its checkbox drops · `S ⌫/⌦` checkbox never stranded in the text · `∅ ⌫/⌦` empty `<p>`, no `- [ ]` · `D` → `- [ ] ` (ruling R3) · click toggles `[x]`/`[ ]`, caret stays · `E ⇧↵` `<p>` after the list | P0 | A bare `[ ]` sitting in the prose, or the checkbox landing on the merged words. |
| Blockquote `>` (§4.8) | `T ⌫` only the caret's line lifts, quote splits around it · `M C` · `E ↵` a new `>` line · `E ⇧↵` `<p>` after the quote · `∅ ↵` exits the quote · `∅` an emptied quote keeps `>` (Q7) · nested `> >` preserved untouched | P1 | The whole quote unquotes, or the quote vanishes and the `>` line is lost. |
| Fenced code (§4.9) | `T/M/E` every key edits source text only; `↵` = one `\n` inside the code · `Tab` two spaces · no block or inline rule fires inside · `E ⇧↵` `<p>` after, fence bytes unchanged · `∅ D` writes no blank fence · `∅ ⌫/⌦` removes the emptied block, undoable · `S ⌫` on a non-empty fence does not delete the fence · a body edit keeps the language | P0 | Two code lines merged, a `#` escaped as `\#`, or a widened fence closing early so later lines save as prose. |
| Indented code (§4.10) | no edit → byte-identical · `M/E C` → fenced block, body byte-equal · `E ⇧↵` `<p>` after, code unchanged | P0 | The body re-indents or loses blank lines, or the block becomes prose. |
| Horizontal rule (§4.11) | click never changes the note and never throws · `S(after) ⌫` and `E(before) ⌦` remove the rule, neighbours kept · `S(after) ⌦` and `E(before) ⌫` keep it · `B C/↵` opens a line on the caret's side, rule intact · `D` only-block → empty note · a user blank run beside it survives | P0 | A click writes to the file, or Delete beside the rule removes a paragraph. |
| Table (§4.12, §4.12.1) | `cell M/E C` edits the cell · `cell ↵` refused with a notice, no newline in the row · `cell E ⇧↵` `<p>` after the table · `cell S/T ⌫/⌦` inside one cell stays native · a key at a cell edge never merges cells or drops a row/column/header · `D` an emptied cell keeps its column (`\|  \|`) · a pipe in a cell is escaped (Q20) · an edited table is GFM with the same cell count | P0 | The table gains a column, or a row's cells shift one right on reload. |
| Blank-line runs (§4.13) | `⌫/⌦` on a blank line removes that line only; both neighbours keep type and bytes · a structural edit elsewhere leaves the run's count unchanged · a trailing run preserved | P1 | A heading below loses its `##`, or a deliberate four-line gap collapses to one. |
| HTML comment / raw HTML (§4.14) | untouched → byte-identical (comment, `<div>`, a one-element raw `<table>`) · an edit inside or beside keeps the tags and attributes · no `contenteditable`, `data-hybrid-*`, `hljs-*`, pill, or sentinel in the file · an unmarked (pasted/engine) element is unwrapped, never written · an inline comment survives an edit in the same paragraph | P1 | `<kbd>Ctrl</kbd>` becomes plain `Ctrl`, or `contenteditable="true"` appears in the note. P0 when an attribute value (a URL, a size) disappears with the tag. |
| Special fences mermaid, wavedrom, math/katex, dot/graphviz, html-live, **svg** (§4.15) | rendered block is atomic: the caret skips it, block rules are refused, arrows do not enter · click → source, blur/Esc → re-render · edited source writes the same fence name (`katex`→`math`, `graphviz`→`dot`) · untouched → byte-identical · `⇧↵` `<p>` after · a paste into the source stays text | P0 | Hundreds of lines of SVG written into the note, or the diagram reloading as a plain code block. |
| Inline (§4.16) | `M C` keeps a bold/italic/code run and its neighbours' text · live rules fire for `**b**`, `_i_`, `~~s~~`, `` `c` ``, `[[x]]`, `+ `, `1) ` · a literal `#`, `*`, `_`, `[`, `1.` is escaped on save · `F` across blocks refused, unchanged · `X` across blocks leaves no half-open run · `*` typed mid-word does not start emphasis | P1 | Literal `**` in the file around text that looked bold, or bold silently unwrapped. |

Two constructs the matrix must not skip because a doc omits them:

- **`svg`** is a registered plugin fence (`blocks.js` registry, `markdown.md`
  `svg`) but §4.15's opening list names five fences plus plain `html`. Same
  contract as the other five (ruling R7).
- **ATX `∅ C`** must run in a real engine. §7 lists the empty-heading caret as
  out of scope while Q12 and §4.2.1 specify and ship it (ruling R8).

## 3. Decision table

| # | Failure class (example row) | Verdict | Why one line |
|---|---|---|---|
| 1 | Text lost or changed at a merge (`4.2-S-⌫`, `4.8-E-⌦`, a blank-line delete that pulls a block in) | **Must-fix now** | I1 with no acceptable form: silent and unrecoverable from the editor. |
| 2 | `⌫` at T merges instead of peeling the marker (`4.2-T-⌫`, `4.4-T-⌫`) | **Must-fix now** | This is the shipped marker spec §3–4; a merge destroys intent and costs an undo. |
| 3 | `⌦` at E pulls the next block's marker into this block (`p` + `## h` → `p## h`) (`4.2-E-⌦`, `4.5-E-⌦`) | **Must-fix now** | The marker becomes literal text and the heading below loses its type (§5.2 rule 2). |
| 4 | `⌦` at E before a 2+ item list restyles or deletes the first item's type (`4.4-E-⌦`) | **Must-fix now** | The guarded case (§5.2 rule 3); one press restyles the rest of the list. |
| 5 | Merge keeps both texts but the merged block changes type unexpectedly (two headings, an item becomes a paragraph) (`4.2-S-⌫`) | **Fix if cheap** | Text is safe and the type is one click to restore; the native engine owns it (§5.2). |
| 6 | `⌦` at a cell edge merges or drops cells (`4.12.1`) | **Must-fix now** | Same P0 class as row 18: the row re-associates on reload. |
| 7 | A tag, chrome, sentinel, ZWS, or `` ```undefined `` reaches the `.md` (`4.14`, `4.9`, `4.6`) | **Must-fix now** | G4/I4/I8 is half the feature's goal; `undefined` also breaks the block on reload. |
| 8 | One `Enter` produces two or more newlines or a `<br>` (`4.1-E-↵`, `4.4-E-↵`) | **Must-fix now** | I9/G4b, the owner's reported symptom; it compounds with every press. |
| 9 | An idle action (focus, click, save, exit) adds a blank line (`4.13`) | **Must-fix now** | The same invariant, and the file drifts with no user action at all. |
| 10 | `↵` inside a table cell writes a newline and splits the row (Q8) | **Must-fix now** | P0 by row 18's rule; the refusal already exists. |
| 11 | Caret lands outside the block or nowhere after a merge/peel; typing goes nowhere | **Must-fix now** (P2) | A dead caret stops all writing, so it is blocking for that construct. |
| 12 | Caret lands one char or one block off, or a second press is needed | **Fix if cheap**, else document | Recoverable by a click or arrow; the cost is annoyance. |
| 13 | Typing at B prepends into the following block (Q3) (`4.2-B-C`) | **Fix if cheap**, else document | Text is kept but lands inside a heading; workaround: click into the block. |
| 14 | Undo restores a different tree (wrong text, type, or block count) (all `U` rows) | **Must-fix now** | I7; undo is the only recovery path, so a wrong undo removes the safety net. |
| 15 | A no-op exit or save writes the file (I3) | **Must-fix now** | Cheapest invariant to hold; the owner judges the editor by file bytes. |
| 16 | An untouched neighbour's bytes change on a structural edit, including a lost definition line, comment, or blank run (`4.13`, `4.14`, refdef rows) | **Must-fix now** | I2/Q1; the defect list already proves each of these is reachable. |
| 17 | An untouched neighbour only canonicalizes spelling (`*`→`-`, setext→ATX, `---`→`* * *`, indented→fenced) on a structural edit | **Fix if cheap** | Renders identically; the harm is file churn. |
| 18 | Table cell content moves a column, a row/header disappears, or a cell pipe splits the row (`4.12`) | **Must-fix now** | P0: the reload associates data with the wrong header, and prose reading will not reveal it. |
| 19 | An emptied formatted block loses its marker (`###`→blank, `-`→blank, `>` gone) (`4.2-∅-D`, `4.4-∅-D`, `4.8`) | **Must-fix now** | Structure loss with no user signal; it is how a note loses its outline. |
| 20 | An ordered list renumbers after a split (a middle item removed, others shift) (`4.5-T-⌫`) | **Must-fix now** | The product spec §6 requires `start` preservation; the file's list is silently rewritten. |
| 21 | A task checkbox is stranded in the text, duplicated onto merged words, or deleted with the text (`4.7`) | **Must-fix now** | Every variant writes `[ ]` into prose or breaks the marker model the owner clicked. |
| 22 | A body edit drops or changes a fence's language (` ```python` → ` ``` `) (`4.9`) | **Fix if cheap** | Highlight lost, text safe, one click to restore; churn only. |
| 23 | A plugin fence changes name or rendered output reaches the file (`4.15`) | **Must-fix now** | The block stops rendering on reload, and the source of truth is replaced by a render. |
| 24 | Authored raw HTML is unwrapped on an edit (V2/V3), or an attribute (URL, size) disappears (`4.14`) | **Must-fix now** | Silent, in the owner's own markup, and not recoverable from the `.md`. |
| 25 | Cross-block inline format partially applies instead of refusing (`F` rows, Q11) | **Must-fix now** | The refusal ships; a partial `<strong>` spanning blocks moves block content into an inline node. |
| 26 | A rendered plugin block is entered by the caret or a block rule fires inside it (`4.15`) | **Must-fix now** | It writes junk into the fence source, i.e. it corrupts the diagram's code. |
| 27 | Clicking a rule or a rendered block mutates the note (`4.11`, `4.15`) | **Must-fix now** | A read-only gesture writing bytes destroys the no-op trust the splice model rests on. |
| 28 | Rich-HTML paste outside a list writes tags (`P-html`, Q9) | **Must-fix now** | G4; a paste must never add HTML the owner did not have. |
| 29 | Multi-line Markdown paste becomes one block with `<br>` instead of blocks (`P-md`) | **Document**, until Q9's general path ships | Words kept, structure different; workaround: `Enter` at the line breaks. |
| 30 | Two byte-different blocks with equal content: the wrong twin's bytes are kept (C2 class) | **Fix if cheap** | Only spelling differs; the content is identical. |
| 31 | Touched-block canonicalization: setext→ATX, `*`→`-`, `---`→`* * *`, indented→fenced, `1)`→`1.` (Q4) | **Non-goal** | Decided by the contract; the file stays valid and renders the same. |
| 32 | Whole-file re-serialization because a raw token renders 0 or 2+ elements (§5.5, Q22) | **Document** | Fails closed by design, no loss; workaround: one raw element per block. |
| 33 | A rebuild after a mismatch resets undo (`4.7`/§5.7) | **Document** | The rebuild is the safety net; the notice says the view changed. |

## 4. Accepted limitations

Phrased for the owner. Nothing here is a bug report; each is the contract or a
decided trade-off.

| You will see | Workaround |
|---|---|
| Merging at a block edge can leave the merged block with the neighbour's type (native merge, Q2/§5.2). | Peel the marker first (Backspace at T), then merge. |
| A character typed at a gap between two blocks can land in the next block, sometimes inside a heading (Q3). | Click into the block first. |
| The block you edit can change its spelling on save: setext→`#`, `*`→`-`, `---`→`* * *`, indented code→a fence, `1)`→`1.` (Q4). Untouched blocks keep their bytes. | Edit one block at a time when the bytes matter. |
| Delete/Backspace at a table cell edge can join cells (Q8). | Select the cell text, or use the table tool for structure. |
| Multi-line pasted Markdown lands as one block with line breaks, not new blocks (Q9, general path). List paste is already list-aware. | Paste, then `Enter` at each break. |
| The context-menu Copy flattens lines and drops markers; a selected rule carries no text (Q14). | Use `Ctrl/Cmd+C`. |
| A caption / `colgroup` / `tfoot` table is rebuilt: the caption becomes the paragraph above it, footer rows become body rows, widths are dropped (Q24). | Keep captions out of tables. |
| A list drag can make sibling items render as "loose" after reload, because tight/loose is a whole-list Markdown property (§4.7.2). | Accept, or re-edit the list. |
| Two raw HTML blocks in one token disable byte-preserving saves; the first save re-serializes the whole note, once (§5.5/Q22). | One raw element per block. |
| Internal line breaks in a multi-line raw HTML block nested in a quote or list collapse to spaces, and the block rebuilds (§5.7). | Keep nested raw HTML single-line. |
| After "Saved — the view was rebuilt from the file", undo cannot go back past the rebuild (§5.7, Q23). | The file is the truth; reopen to re-edit. |
| An empty line you create may not survive a reload; Markdown cannot represent an empty paragraph (marker spec §6). | Use a blank line between blocks only where Markdown already allows it. |
| Undo is 100 steps, and fast typing coalesces into one step (§1.4). | Save before a large edit. |
| Footnotes and definition lists have no live trigger; arbitrary Office/web HTML pastes as text; no multi-cursor, track changes, or margin comments (§7). | Type the Markdown, or use source mode. |
| The phone has no source mode and no right-click menu; drag-reorder and the chord table are desktop-only (`hybrid-mode.md` §9, phone surface). | Use the edit bar, which carries the same actions. |
| No auto-scroll while dragging a list item past the viewport edge (§4.7.2 non-goals). | Drop, scroll, drag again. |
| Export, PDF, source mode, and the AI patch path are outside hybrid and are not covered by this matrix (§1.1). | Their own specs. |

## 5. Top-10 acceptance criteria

Ready to paste into a test file. Each names the matrix rows it protects. Native
rows (`real engine`) must run in Chromium.

**AC-H1 (P0, rows `4.1-*`, `4.2-S-⌫`, `4.2-E-⌦`, `4.4-E-⌦`, `4.8-E-⌦`).**
Given `alpha\n\n## Title\n\nbody\n`, when Backspace is pressed at T of the
heading and, separately, Delete at E of the heading, then both texts are present
in the saved note, no `##` appears mid-line, `alpha` and `body` keep their
bytes, and no block other than the merged one changed.

**AC-H2 (P0, row `4.12`).**
Given `| a | b |\n| --- | --- |\n| x\|y | z |\n`, when `!` is typed in the
`x\|y` cell and the note is saved, then the file has the same 3 rows and 2
columns, the pipe carries an odd backslash run, and the reload shows `x|y!` in
that cell and `z` in the next.

**AC-H3 (P0, row `4.9`).**
Given a `python` fence whose body is `# not a heading\nx = 1\n`, when `x = 1`
is edited to `x = 2` and saved, then every other body line is byte-identical,
the file contains no `\#`, the fence still opens ` ```python `, and the block
still renders as code.

**AC-H4 (P1, rows `4.1-E-↵`, `4.4-E-↵`, `4.8-E-↵`, I9).**
Given `alpha beta\n`, when Enter is pressed between `alpha ` and `beta`, then
the saved file is `alpha\n\nbeta\n` — exactly one blank line, never `\n\n\n`,
never a `<br>`. The same press at the end of `- a` yields exactly one new list
line, and inside `> q` exactly one new `>` line.

**AC-H5 (P1, rows `4.2-∅-D`, `4.4-∅-D`, `4.5-∅-D`, `4.7`, `4.8`, Q7).**
Given `###\n\n-\n\n1.\n\n>\n\n- [ ] \n`, when hybrid is entered and saved with
no edit, then the bytes are identical; when each block's text is deleted in
turn and saved, then the marker remains (`###`, `-`, `1.`, `>`, `- [ ] `), no
marker duplicates, and no neighbouring block changes.

**AC-H6 (P1, rows `4.14`, `4.9`, `4.15`, I4/I8).**
Given any must-pass operation in §2, when the note is saved, then
`domToMarkdown()` outside fences contains none of `<div> <span> <p> <br>
<table> <thead> <tbody> <tr> <td> <th> <ul> <ol> <li> <h1>-<h6> <strong> <em>
<blockquote> <hr>`, and contains no `contenteditable`, no `data-hybrid`,
no `hljs`, no zero-width space, and no sentinel nonce.

**AC-H7 (P1, rows `4.3`, `4.9`, `4.10`, `4.13`, `4.14`, `5.5`).**
Given
`Title\n=====\n\n* star a\n\n<!-- c -->\n\n[id]: url\n\n    indented\n`, when
one edit (text, Enter, or Delete) is made in the heading and the note saved,
then `* star a`, `<!-- c -->`, `[id]: url`, and `    indented` are byte-identical.

**AC-H8 (P1, row I3).**
Given hybrid entered with no edit, when Close/exit is used, then zero
`POST /api/file` is issued and the on-disk bytes do not change. Given the same
session after one edit followed by `Ctrl+Z`, when it exits, then again zero
POST is issued and the bytes equal the pre-edit file.

**AC-H9 (P2, rows `4.2-T-⌫`, `4.4-T-⌫`, `4.7-T-⌫`, `4.8-T-⌫`, real engine).**
Given a heading, a bullet, a task item, and a quote line, when Backspace is
pressed at T of each, then the block becomes a `<p>` with the same text, the
caret is inside it at the first character, and typing `X` inserts `X` at that
position — not in the neighbour, not nowhere.

**AC-H10 (P1, rows `4.4-T-⌫`, `4.4-E-⌦`, `U` rows, `4.5-T-⌫`).**
Given `- a\n- b\n- c` with the caret at `b`, when Backspace is pressed, then `b`
is a paragraph between two bullets. When `Ctrl+Z` follows, then the DOM and the
saved bytes equal the pre-edit source exactly. Given `intro\n\n- a\n- b\n` with
the caret at E of `intro`, when Delete is pressed, then the key is prevented,
the list keeps both items and its type, a save writes nothing, and one undo
restores the exact bytes.

## 6. Scope fence

The matrix is finite at the constructs in §2 × the positions and operations §3
defines for each. Rows without a defined operation are not failures — there is
nothing to assert. The following are deliberately outside it.

| Not covered | Covered instead by |
|---|---|
| IME / composition (Enter, Backspace, or a trigger during composition) | `hybrid-editing.md` §4.2 conditions; `../testing/hybrid-regression-checklist.md` §7.3 and L1–L3; jsdom `isComposing` guards |
| Phone gestures, on-screen keyboard, hardware back, sticky Save/Done | [hybrid-mode.md](../ui/hybrid-mode.md) §9; [mobile.md](mobile.md); `test_mobile_browser.js` |
| List-drag geometry: grip reveal, indent rails, drop line, ghost, touch targets | §4.7.2; `test_hybrid_browser.js` drag block |
| Table editor modal: add/remove/move row and column, alignment, header toggle, sort | [table-editor.md](table-editor.md); `test_table_editor_browser.js`. This matrix asserts cell text and the shape on save only. |
| Visual design: chip geometry, tokens, contrast, focus ring, hover faces | [hybrid-mode.md](../ui/hybrid-mode.md) §2–§5, §10 |
| Shortcut chords and their Settings display | [hybrid-shortcuts.md](hybrid-shortcuts.md) §12 |
| Save, conflict, autosave, draft, watcher, tab switch | [hybrid-mode.md](../ui/hybrid-mode.md) §6; regression checklist area B |
| Source mode (CM6), preview, export/PDF, the AI `/api/edit` path | `hybrid-editing.md` §1.1; their own suites |
| Browser engines other than Chromium | Native rows are engine-specific; only Chromium is gated (§8.2). Do not score Firefox/Safari differences. |
| Timing: autosave interval, coalescing, save latency, large-note cost | §5.7 "Cost" (measured, not asserted), §1.4 constants. The matrix asserts bytes, not waits. |
| Accessibility semantics: `aria-pressed`, `aria-live`, names, reduced motion | [hybrid-mode.md](../ui/hybrid-mode.md) §10.4, E2/E3/E4/E8/E9/E10 |
| Multi-select drag, cross-list merge, non-list block drag, auto-scroll | §4.7.2 non-goals, §7 |
| Arbitrary rich-HTML paste fidelity, footnotes, definition lists, multi-cursor, track changes | §7 non-goals |
| Undo depth and coalescing beyond "one action, one step" | §1.4 (`HISTORY_LIMIT`, `HISTORY_COALESCE_MS`) |

## 7. Rulings on contradictions (owner to confirm)

The contract wins for behaviour; the marker spec wins where the contract marks a
cell "unspecified"; the shipped UI doc wins for what is on screen. Each row below
is a place where the docs do not yet agree and the matrix needs one answer.

| # | Conflict | Ruling (the matrix asserts this) | Why |
|---|---|---|---|
| **R1** | §4.1 row `E ⇧↵` targets `one\ntwo`, while Q15 and §5.1 say Shift+Enter inserts a new top-level `<p>` after the block. | **Q15 wins:** the saved file is `one\n\n`. `§4.1`'s cell is stale. | Q15 is a decided owner decision and §4.13 already states `one\n\n`; a single `\n` does not make a new block in Markdown. |
| **R2** | §4.1 rows `E ↵` / `E ⇧↵` say "one break" and show `one\ntwo`, while I9/Q16 say one `Enter` is one break and §4.13 shows `one\n\n`. | **One `Enter` adds at most one blank line**: exactly two consecutive `\n` where one was, never three, never a `<br>`. This is the only byte-level reading that is both "one break" and a new block. | Markdown separates blocks with a blank line; §4.1's target would not create the block the row requires. |
| **R3** | §4.7 marks `D` on a task item "✳ verify — an item holding a checkbox is not empty, so deleting text leaves the checkbox and `[ ]`", while the marker spec §8 rank 10 says an empty task becomes an empty paragraph. | **`D` on a task item writes `- [ ] `** (checkbox is a marker, not content). Only Backspace at T or Delete removes it (marker spec §3). | The checkbox is the block marker by the owner's own model (`hybrid-block-marker-backspace.md` §2); `D` deletes content, not markers. |
| **R4** | `hybrid-mode.md` §6.2 says autosave's default quiet period is 5 s (60 s cap), while `hybrid-editing.md` §1.4 names `AUTOSAVE_MS` = 2000. | **No timing assertion in the matrix.** Save rows assert bytes and POST counts, driven by an explicit save. | The two docs disagree about a constant; the matrix must not encode either wait. Owner to confirm which value is current. |
| **R5** | `hybrid-mode.md` §9 conflict C2: the phone surface says list grips are desktop-only, the code and §4.7.2 put them on touch. | **Shipped UI wins:** grips are present on the phone. The architecture's "Phone surface (v2)" sentence is the one to correct. | The UI doc codifies shipped behaviour and `list-edit.js` has no phone gate. |
| **R6** | §7 non-goals says "fixing the empty-heading caret bug" is out of scope, while Q12 and §4.2.1 specify it as implemented. | **In scope and must pass** (`4.2-∅-C`, real engine). §7's bullet is stale. | Q12 is decided, implemented, and verified in Chromium; an empty heading that cannot accept text is a caret dead-end. |
| **R7** | §4.15/§1.1 name five special fences (mermaid, wavedrom, math/katex, dot/graphviz, html-live) plus plain `html`, but the registry has **six**, including `svg`. | **`svg` is in the matrix** with the same atomic + round-trip rows as the other five. | `blocks.js` registers `svg` and `markdown.md` documents its round-trip; omitting it leaves a shipped block untested. |
| **R8** | §4.1 and §4.4 still mark `+ `, `1) `, `_italic_`, `[[ ]]` as "✳ to be added", and §4.13 marks the blank-run row "collapses until Q1". | **Q5 and Q1 win:** these are implemented and must pass now. The ✳ marks are stale. | Both questions are decided and the code shipped; a stale mark would let a regression pass as "not yet". |
| **R9** | The contract's §3 says the marker is `#`, bullet, number, `>`, `[ ]`; the marker spec §3.3 says S is reachable and unclaimed for a task item, and recommends Delete-at-S as a follow-up. | **Backspace at S of a task item is native and accepted** (no marker claim); Delete at S is a **non-goal for this matrix** until the owner adds it. | The shipped spec deliberately leaves S unclaimed, and a follow-up is not a current requirement. |
