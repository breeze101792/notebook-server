# Table edit window — selection and clipboard — product definition

**Status:** shipped (table edit window — selection and clipboard; in-modal undo/redo in the shared action bar).
**Date:** 2026-11-01, amended 2026-11-07 (shared edit-window shell) · **Owner:** `product-designer` · **Scope:** the hybrid (WYSIWYG) "Edit table" modal only.
Related: `docs/product/table-editor.md` (the modal; AC1–AC18 and AC45–AC46 remain in force), `docs/design/table-editor.md`, `docs/architecture/table-editor.md`.

## 1. Goal and audience

The owner edits their own note in hybrid mode. The table modal can change one cell at a time, but moving a block of values in or out means retyping it. This feature adds a rectangular cell selection, copy, cut, paste, clear, and delete of the selected rows or columns, so a block of data moves between this table, another table, and a spreadsheet without retyping.

Audience: the single notebook owner in an admin session, on desktop with a pointer and keyboard, or on tablet by touch. Same person, same modal, same one-table-per-window rule as the parent document.

## 2. Scope

**In scope:** a rectangular range selection; mouse, keyboard and touch ways to make and extend it; copy, cut, paste, clear contents; delete of the selected rows or columns; the clipboard formats and their shapes; how paste grows the grid; announcement of the range and of every operation.

**Out of scope (fixed):**

- formulas, number formatting, column resize, merged cells, per-cell colour or style, conditional formatting;
- paste that tiles a multi-cell block to fill a larger selection;
- named fill commands beyond Ctrl/Cmd+D (fill right has no chord);
- aggregates in the status line (no sum, count, or average);
- dragging a multi-row selection to move it;
- selection across two tables, or two tables in one modal;
- persistence of a selection across close, reload, or reopening the modal;
- CSV parsing, comma-separated paste, and any delimiter guessing;
- grid virtualization;
- auto-scroll while a drag is held at the viewport edge (Shift+click after scrolling reaches the far corner);
- PageUp / PageDown, Ctrl+Home / Ctrl+End.

**Supersedes:** `table-editor.md` §2 lists "multi-cell range selection" and "clipboard range paste" as out of scope. This document brings both in, plus the fill handle. CSV import stays out.

**Amends** these parent criteria, and only these:

- AC4 — a press that stays in one cell still places the caret; a press that moves to another cell paints a range instead.
- AC5 — a bare arrow still moves one cell; a Shift+arrow extends the range.
- AC6 — Delete row and Delete column act on every row or column the selection touches.
- AC12 — Esc first collapses a live multi-cell selection; with no multi-cell selection it still cancels the window.

In AC6, AC7 and AC8, "the focused cell" means the active cell defined in §3.1.

**MVP line:** §3–§11 work and AC19–AC44 pass. Nothing else.

## 3. Functional flows

### 3.1 Selection model

A selection is a rectangle of cells. It is stored as two corners:

- **anchor** — the corner that does not move while the range is extended;
- **focus** — the corner that moves. The focus cell is the **active cell**: it carries the existing active ring and the DOM focus, and every existing toolbar verb that says "the focused cell" uses it.

The rectangle is the bounding box of the two corners. A selection of one cell is the normal state; the window opens that way at cell (0,0). Row 0 (the header row) can be inside a selection like any other row.

### 3.2 Mouse

| Gesture | Result |
| --- | --- |
| Press a cell, release on the same cell | Collapses any range to that cell and enters text edit, caret at the release point (AC4 unchanged) |
| Press a cell, move onto another cell, release | The rectangle between the press cell and the release cell is selected. No text edit. |
| Shift+press a cell, release | The range extends from the existing anchor to that cell |
| Shift+press a cell, drag, release | The range extends continuously from the existing anchor |
| Press inside the cell currently being edited, drag outside it | Native text selection inside that cell only. To start a range from that cell, leave text edit first (F2, Tab or Enter). |
| Press on a row or column grip | Reorder drag, unchanged. No range. |

The pointer path never enters text edit while it paints. The existing `.te-cell` press handler gains one decision: move-and-release paints, press-and-release edits.

### 3.3 Keyboard

All of these act only when the grid has focus and no cell is in text edit.

| Key | Result |
| --- | --- |
| Arrow | Collapse the range to the active cell, then move one cell, clamped at the edges |
| Shift+Arrow | Extend the focus corner one cell, clamped. The anchor does not move |
| Home / End | Move the active cell to the first / last column of its row |
| Shift+Home / Shift+End | Extend the focus corner to the first / last column of the focus row |
| Ctrl/Cmd+A | Select the whole grid, header row included |
| Ctrl/Cmd+Space | Select the whole column of the active cell, header cell included |
| Shift+Space | Select the whole row of the active cell, header row included |
| F2 | Enter text edit on the active cell (unchanged) |
| F2 while editing | Commit and leave text edit, active cell unchanged |
| Esc | Collapse a multi-cell range to the active cell; otherwise cancel the window (AC12 as amended) |
| Delete / Backspace | Clear the contents of every cell in the range (§3.7) |

Inside text edit, every one of these keys keeps its native text meaning, and the grid selection cannot change. Ctrl+A selects the cell's text. Shift+Space types a space. Shift+Arrow extends the text selection.

F2-as-toggle is the only way to leave text edit without moving the active cell. It exists so a pointer user can stop editing and then drag a range from that same cell.

### 3.4 Touch

| Gesture | Result |
| --- | --- |
| Tap | Same as a mouse press and release: text edit at the tap point |
| Long-press, then drag | Paint a range from the pressed cell. Release keeps it. |
| Long-press, release without moving | Select that single cell, set the anchor, no text edit |
| Tap outside an existing range | Collapse to that cell and edit |

The long-press threshold is the platform convention, about half a second, held as one named constant. Moving the pointer beyond a small slop before the threshold cancels the long-press and leaves the gesture as a normal tap.

A tap-to-extend gesture (tap one corner, tap the far corner) is rejected: it makes every second tap ambiguous with "start editing here". To change a range on touch, drag again.

### 3.5 Coexistence with text editing

- The grid has two states, as today: **navigate** (cell focused, not editable) and **edit** (the cell's `.te-cell-text` is contenteditable and holds the caret).
- A press on a different cell while a cell is being edited commits the edit, then starts the new gesture.
- A press inside the edited cell belongs to that cell.
- Selection gestures (drag, Shift+click, Shift+arrow, Ctrl+A, Space chords) never start text edit.
- A text-edit gesture (press and release in one cell, Enter, F2, a printable character) collapses the range to that cell before editing it. The range is not kept behind the caret.

### 3.6 Copy

Copy takes the selection rectangle and writes two clipboard flavours, `text/plain` and `text/html`, as specified in §4. Copy changes nothing in the grid and leaves the selection as it was. Focus stays on the active cell.

### 3.7 Cut, clear, delete

- **Cut** copies the rectangle, then empties every cell in it. The rectangle stays selected and the active cell stays. The clipboard write happens immediately and is not transactional: Cancel restores the grid, never the clipboard.
- **Clear contents** empties every cell in the rectangle. It does not touch the clipboard and does not change the selection. Reachable by Delete, by Backspace, and by a toolbar button.
- An emptied cell is a real empty cell: it serializes as empty and sorts last, exactly as an empty cell does today.
- Emptied means content gone, inline formatting gone with it. There is no "clear formatting only".
- **Delete rows / Delete columns** is the one extra operation, described in §3.8.

An operation that changes no cell content leaves the working copy unchanged (AC11 still finds a no-op Apply).

### 3.8 Delete the selected rows or columns

The existing toolbar Delete row and Delete column buttons become selection-aware:

- Delete row removes every body row the selection touches. Row 0 is never removed; if the rectangle includes row 0, only its body rows count.
- Delete column removes every column the selection touches.
- A single-row or single-column selection behaves exactly as today.
- Disabled with a stated cause, as today, when the action would leave zero body rows or zero columns.
- One activation is one grid mutation, announced with the count ("Deleted 3 rows").

This is the only extra operation. Rejected as well: fill down and fill right as named commands (pasting one cell into a range fills it, §4.4), applying sort or alignment to a sub-range, and merging selected cells.

### 3.9 Fill

The selection shows one **fill handle**: an 8px square on the bottom-right
corner of its last cell. Dragging it extends the block along one axis — down or
right, never up or left and never shrinking the grid.

- **Source.** The rectangle selected when the drag starts. Only cells outside
  it are written.
- **Target.** The rectangle extended to the row (down) or column (right) under
  the pointer. When the pointer is past the selection in both directions, the
  axis it moved further along wins; the other dimension keeps the source width.
  A pointer inside or up/left of the selection gives no target and nothing is
  filled.
- **Series.** When the source holds two or more cells along the fill axis whose
  values all parse as numbers and whose consecutive differences are equal, the
  step is continued: `1, 2, 3, 4` filled three cells gives `5, 6, 7`. The number
  format follows the source's decimal places. Any other source repeats its cells
  in order, cyclically — text, mixed values, one number, or an uneven step.
- **One mutation.** The whole target is written in one pass, then the grid is
  repainted once. The extended block stays selected with the source's top-left
  cell active, and the status line reports `Filled 3 cells`.
- **Ctrl/Cmd+D** fills the selection down from its first row, using the same
  series and repeat rules. It is the keyboard path for the same operation.
- **Escape** during the drag cancels it and leaves the selection as it was.
- All of it acts on the working copy: Apply writes one table, Cancel discards.

### 3.10 Structural operations and the selection

Insert, add, delete, move, sort, transpose and delete-table change the grid's shape. After any of them the range collapses to the active cell, clamped into the new grid, and the status line reports that cell. Cell-content operations (copy, cut, paste, clear) keep the rectangle.

### 3.11 Apply and Cancel

Every selection and clipboard operation acts on the working copy only. Apply writes one GFM table as one note-level undo step. Cancel discards. The modal has its own history (`docs/product/table-editor.md` AC45–AC46): Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y walk the working copy and never reach the note underneath.

### 3.12 Merged-cell refusal state

§7.

## 4. Clipboard contract

### 4.1 What Copy emits

For a rectangle of `h` rows and `w` columns:

- `text/plain` — `h` lines separated by `\n`, `w` fields per line separated by `\t`, no trailing newline. A field is the cell's visible text with any tab, newline, or carriage return replaced by one space. Other whitespace is kept as is. There is no quoting and no escaping: a cell can never contain a tab or a newline once pasted, so the format stays unambiguous.
- `text/html` — one `<table>`, one `<tr>` per row, one `<th>` or `<td>` per cell, no attributes. When the rectangle includes grid row 0, its first copied row is emitted as `<thead><tr><th>`; every other row is `<tbody><tr><td>`. Cell content is the cell's rendered inline HTML (`strong`, `em`, `code`, `a`), with newlines replaced by spaces. No classes, styles, ids, or scripts.
- No other flavours.

### 4.2 What Paste accepts

The grid inspects the payload in this order and stops at the first match:

1. `text/html` containing a `<table>` — the first table only. Each `<tr>` is a row; each `th` or `td` is one cell. `colspan` and `rowspan` are ignored: a spanned cell occupies one position, nothing is duplicated or shifted. Content keeps `strong`, `em`, `code`, `a` and drops everything else to its text; `br` and block boundaries become one space; script and style elements are dropped with their text; a nested table becomes its text. Empty rows at the end are dropped.
2. `text/plain` containing a tab or a newline — TSV. CRLF and CR become LF; one trailing empty line is dropped; rows split on `\n`, fields on `\t`. Rows shorter than the widest row are padded with empty cells. A payload that is a single empty string is a 1 × 1 empty block, which clears the target.
3. `text/plain` with no tab and no newline — a 1 × 1 block.
4. `text/html` with no table — reduce to text and continue at 2 or 3.

If nothing usable is present, the status line says so and nothing changes.

### 4.3 Paste while a cell is being edited

- A single-cell plain-text payload inserts at the caret, with tabs, newlines and other whitespace runs collapsed to one space. This is today's behaviour and stays.
- Any other payload (table, TSV, multi-line text) commits the in-progress edit and then places the block with its top-left at that cell.

### 4.4 How Paste shapes the grid

Let the target be the selection, or the active cell when there is no multi-cell range. Its top-left is `(r0, c0)`; the grid is `R` rows by `C` columns; the block is `h` rows by `w` columns.

- **1 × 1 block into a multi-cell target** — write that value into every cell of the target. This is the fill operation; no separate command exists.
- **Any other block** — write it once with its top-left at `(r0, c0)`. Cells of the target outside the block are unchanged. A multi-cell block is never repeated to fill a larger target.
- **Grow** — if `r0 + h > R`, append body rows at the bottom until the block fits. If `c0 + w > C`, append columns at the right until the block fits; appended columns extend the header row with empty header cells. New cells follow the existing Add row and Add column convention.
- **Never shrink** — paste removes no row and no column, so the one-body-row and one-column minimums cannot be violated by paste, cut or clear.
- **Afterwards** the selection is the written rectangle: the block's `h × w` for a block, the whole target for a 1 × 1 fill. The active cell is its top-left, the grid keeps focus, and the status line reports the size.

### 4.5 Formatting on paste

Pasted HTML keeps inline bold, italic, code and links. Everything else — block markup, headings, lists, colours, font styles, spans, nested tables — is flattened to text before it reaches the model. Pasted plain text is plain. A written cell's previous content and formatting are replaced, not merged. The note still never receives HTML.

## 5. Grid mutation rules

- The header row stays row 0. Paste and clear may change a header cell's content, the same way typing in it does today. No operation inserts, removes or moves row 0.
- The grid always keeps at least one body row and one column. Clipboard operations never remove either. Only Delete row and Delete column remove, and both refuse at the minimum, as today.
- Every mutation is in the working copy. Apply is one undo step; Cancel discards; nothing reaches the note before Apply.
- The status line is the one place that explains a refused operation and reports a completed one.
- One activation is one mutation and one render of the grid, not one per cell.

## 6. Edge cases

- A drag or Shift+arrow past the last row or column clamps at the edge.
- A selection that includes row 0 and a paste that grows the grid gains empty header cells at the right; the header stays row 0.
- A paste whose anchor is not column 0 grows only as many columns as the block needs to fit.
- A paste of a 2 × 2 block into a 5 × 5 selection writes 4 cells and leaves 21 untouched; the selection becomes the 2 × 2 block.
- A paste of one empty cell into a range empties the range.
- An empty clipboard, or a clipboard with no text and no table, changes nothing and says so.
- A copy of an empty cell writes an empty field; pasting it back is a 1 × 1 empty block.
- A cell text containing a tab or a newline cannot exist in the grid, because cell paste always collapses whitespace; Copy therefore never has to quote.
- Copy of a range that includes row 0 emits `<th>` in HTML; copy of a range that starts at row 1 emits `<td>` throughout.
- Copying the whole grid and pasting it back into the same selection writes identical content, so the working copy stays unchanged and Apply writes nothing (AC11).
- Clear or paste that writes identical content does not mark the working copy changed.
- A structural operation during a live range collapses the range, as in §3.9.
- Closing and reopening the modal shows no range; the window opens on cell (0,0).
- Reopening after Cancel shows the original table.
- The native browser context menu stays available on the grid. Its Paste fires the grid's paste path; its Copy copies the DOM text selection, which is empty in navigate mode, so it copies nothing. The toolbar buttons are the intended path.
- A pointer press that starts on the scrollbar scrolls; it paints nothing.
- IME composition inside a cell is unaffected; the selection gestures are inert while editing.
- A pasted block too large to allocate leaves the grid and the working copy byte-identical and says so.

## 7. Merged-cell refusal state

A table with merged cells opens read-only, as today. In that state:

- there is no selection model: no `aria-multiselectable`, no `aria-selected` on any cell, no active ring, no cell in the tab order;
- drag, Shift+click, Shift+arrow, Ctrl+A, the Space chords, Delete and Backspace do nothing;
- the clipboard controls (Cut, Copy, Paste, Clear) are `aria-disabled` with the merged-cells reason, and Delete row / Delete column keep their existing disabled state;
- the grid's paste handler does nothing;
- only Cancel closes, and no write is possible.

## 8. Accessibility

- **Grid** — `role="grid"`, `aria-label`, `aria-rowcount`, `aria-colcount` as today, plus `aria-multiselectable="true"` in the editable state only.
- **Cells** — every cell carries `aria-selected="true"` or `"false"`, `aria-rowindex` and `aria-colindex`, both 1-based with the header row at 1. Its accessible name stays its content; an empty cell has no name, and its position comes from the row and column indices and the status line.
- **Status line** — `.te-status` stays the single polite live region and announces, in this order of events: the range ("3 × 3 selected, rows 2–4, columns 1–3"), a single-cell position in today's wording, copy ("Copied 3 × 3"), cut, paste ("Pasted 2 × 2", "Pasted 1 cell into 9 cells"), clear ("Cleared 3 × 3"), delete ("Deleted 3 rows"), every refusal with its cause, and the paste-button fallback hint.
- **Toolbar** — a clipboard group with Cut, Copy, Paste and Clear. Each has an accessible name, is reachable by Tab, activates on Enter or Space, and when unavailable uses `aria-disabled="true"`, a `title` reason and the existing `aria-describedby` to the status line. The group is the pointer and touch path; it is never the only path.
- **Keyboard-only completion** — with the grid focused and a range selected, Ctrl/Cmd+C, Ctrl/Cmd+X and Ctrl/Cmd+V work through the browser's native clipboard events, which need no permission and no secure context. A keyboard-only user never needs the toolbar.
- **Focus after paste** — the grid, at the written rectangle's top-left, in navigate mode, with the pasted rectangle selected and announced.
- **Focus after copy, cut, clear** — unchanged, on the active cell.
- **Not colour alone** — the range is marked by a visible fill plus an outline on its outer edge, in the existing accent tokens. The active cell keeps its existing ring. The header row inside a range is marked the same way. No second highlight colour is introduced.
- **No motion** — nothing animates; the app's reduced-motion handling is unaffected.

## 9. Size and performance

- There is no fixed row or column cap. A table in a single-user Markdown note is bounded by the note and by the tab's memory, not by an editor limit.
- Copy builds one string per flavour from the rectangle in one pass.
- Paste builds the whole result first, then swaps it in as one mutation. A copy that would double the grid is not refused; a copy the browser cannot allocate is refused whole.
- A whole-grid selection is legal and is announced with its size.
- Virtualization is rejected: it buys nothing at note scale and costs the in-place contenteditable cell.
- Auto-scroll during a drag is rejected (§2). Shift+click reaches cells outside the viewport.

## 10. Constraints

- One modal, one table, one owner. No selection survives close or reload.
- The grid stays a real `<table>` of cells with `.te-cell-text` inside each cell. No new rendering model.
- Serialization is untouched: Apply still writes one GFM table through the existing hybrid write path. Pasted HTML is sanitized to the inline subset before it reaches the model, so the note never receives HTML.
- Reuse the existing modal shell, toolbar pattern, status line, focus handling, and colour tokens. No new dependency, font, or colour family.
- The keyboard clipboard path uses native `copy`, `cut` and `paste` events. The toolbar Copy and Paste use the async clipboard API when the context is secure and the user grants access; otherwise they degrade — Copy writes `text/plain` only and says so, Paste announces "Press Ctrl+V to paste" and changes nothing.
- Touch long-press is the platform convention, about half a second, one named constant, cancelled by movement beyond a small slop.
- Text in a cell in navigate mode is not selectable by the browser, so a drag paints the range instead of selecting cell text. Text in edit mode selects natively.
- The long-press threshold, the fill handle size, and the two paste-degradation
  messages are the only new user-visible constants; each is a named value in one
  place.

## 11. Acceptance criteria

AC1–AC18 of `docs/product/table-editor.md` remain in force, with the four amendments in §2. New criteria:

1. **AC19** A press on a cell in navigate mode followed by a release on another cell selects the rectangle between them, enters no text edit, leaves the DOM focus on the release cell, sets `aria-selected="true"` on every cell inside the rectangle and `"false"` on every cell outside it, and writes "N × M selected, rows a–b, columns c–d" to the status line.
2. **AC20** A press and release inside one cell collapses any range to that cell and enters text edit with the caret at the release point. A press inside the cell already being edited keeps native text selection and paints no range.
3. **AC21** Shift+press extends from the existing anchor to the pressed cell; Shift+press followed by a drag extends continuously from that anchor; a plain drag re-anchors at the press cell.
4. **AC22** With a range selected and no cell being edited, Shift+Arrow extends the focus corner one cell and clamps at the grid edge, Home and End move the active cell to the first and last column of its row, and Shift+Home and Shift+End extend to those columns; a bare Arrow collapses the range to the active cell before moving.
5. **AC23** With the grid focused and no cell being edited, Ctrl/Cmd+A selects the whole grid, Ctrl/Cmd+Space selects the active column including its header cell, and Shift+Space selects the active row including the header row; none of them starts a text edit.
6. **AC24** While a cell is in text edit, Ctrl/Cmd+A selects that cell's text, Shift+Space inserts a space, Shift+Arrow extends the text selection, and no grid range changes.
7. **AC25** On touch, a tap enters text edit; a long-press followed by a drag paints a range and keeps it on release; a long-press released without movement selects one cell and enters no text edit.
8. **AC26** Esc with a multi-cell range selected and no cell being edited collapses the range to the single active cell and leaves the window open and the table untouched; Esc with no multi-cell range cancels the window; Esc while a cell is being edited cancels the window.
9. **AC27** Copy on a 3-column by 2-row range writes `text/plain` with three tab-separated fields on each of two lines and no trailing newline, and `text/html` with one `<table>` whose rows carry the same cells with their inline `strong`, `em`, `code` and `a` markup; when the range includes grid row 0 the first HTML row is `<th>` inside `<thead>`.
10. **AC28** Cut writes the same clipboard data as Copy and empties every cell in the range; the range stays selected; Cancel after Cut restores the original table and the clipboard still holds the cut block.
11. **AC29** Delete, Backspace, and the toolbar Clear empty every cell in the range, remove no row and no column, leave the range selected, and mark the working copy changed only when at least one cell had content.
12. **AC30** Pasting a single-cell plain-text value with a multi-cell range selected writes that value into every cell of the range and leaves the range selected.
13. **AC31** Pasting a 2 × 3 block with its top-left at the selection's top-left into a grid with one free row and no free column appends one body row at the bottom, appends one column at the right, writes the block, removes nothing, selects the pasted 2 × 3 rectangle, focuses its top-left, and announces "Pasted 2 × 3".
14. **AC32** Pasting a 1 × 2 block into a 3 × 3 selection writes the two cells at the selection's top-left, leaves the other seven cells byte-identical, and selects the written 1 × 2 rectangle.
15. **AC33** Paste accepts an HTML table, TSV text, and single-line text; a multi-line payload with no tabs pastes as one column; `colspan` and `rowspan` in pasted HTML are ignored; pasted inline bold, italic, code and links survive into the model while block markup, colours, styles, scripts and nested tables are flattened to text; no HTML element outside the inline subset reaches the model or the note.
16. **AC34** With a cell in text edit, pasting plain text with no tab and no newline inserts it at the caret with whitespace runs collapsed to one space; pasting a table or a multi-line payload commits the edit and places the block with its top-left at that cell.
17. **AC35** Delete row with a 3-row selection removes all three body rows and keeps row 0; Delete column with a 2-column selection removes both columns; both are disabled with a stated cause when the action would leave zero body rows or zero columns; a single-cell selection behaves exactly as before.
18. **AC36** Insert, add, delete, move, sort, transpose and delete-table collapse the selection to the active cell, clamped into the new grid; copy, cut, paste and clear keep the rectangle.
19. **AC37** Copy, cut, paste, clear and delete change only the working copy; Apply still writes exactly one GFM table in one undo step; Cancel restores the table and the grid; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y inside the modal walk the modal's own history and do not change the note; an operation that writes identical content does not mark the working copy changed.
20. **AC38** In the merged-cell refusal state the grid has no `aria-multiselectable` and no `aria-selected` cell, the clipboard controls are `aria-disabled` with the merged-cells reason, no selection gesture or key changes anything, and only Cancel closes the window.
21. **AC39** In the editable state the grid has `aria-multiselectable="true"`, every cell has `aria-selected`, `aria-rowindex` and `aria-colindex`, the clipboard group's four controls are reachable by Tab and activate by Enter or Space with an accessible name, a keyboard-only user can select, copy and paste with the grid focused, focus after paste is on the written rectangle's top-left, and the status line announces every range change and every operation result.
22. **AC40** A 10 × 3 block pasted into an empty 1 × 1 grid produces exactly 10 rows and 3 columns, applies in one mutation, and one Apply writes one table with the pasted content; no fixed row or column limit exists in the code path; a paste that fails to allocate leaves the grid and the working copy unchanged and reports the refusal.

23. **AC41** Selecting `1, 2, 3, 4` in one column and dragging the fill handle three cells down writes `5, 6, 7`, leaves the four source cells byte-identical, selects the extended block with the source's top-left active, and announces "Filled 3 cells".
24. **AC42** A source whose values are not an even numeric run (text, one number, mixed values, or an uneven step) repeats its cells in order across the target; a fill whose target is empty or inside the selection writes nothing and announces "Nothing to fill".
25. **AC43** While the handle drags, the target cells are marked before release; releasing writes the block; Escape and pointercancel drop the drag with the grid and the selection unchanged; dragging up or left fills nothing and grows nothing.
26. **AC44** Ctrl/Cmd+D with a multi-row selection fills every row below the first from the first row, using the same series and repeat rules, and marks the working copy changed only when a cell's content differs.

## 12. Open questions

None. Every decision above is made from the request and the parent documents. Two items are assumptions, marked for confirmation after implementation, not blockers:

- The long-press threshold follows the platform convention (about half a second). If the owner finds touch selection unreliable, this constant is the one knob.
- The toolbar paste degrades to a hint when the async clipboard is unavailable. If the owner wants the toolbar Paste button to work without the keyboard, it needs a different paste mechanism, which is a separate decision.
