# Table edit window — product definition

**Status:** Product definition for review. No visual or technical design chosen here.
**Date:** 2026-10-31 · **Owner:** `product-designer` · **Scope:** hybrid (WYSIWYG) edit mode only.
Related: `docs/architecture/hybrid-editing.md` (G3/G3b — tables edit through a table tool and write GFM), `docs/product/hybrid-shortcuts.md`, `docs/architecture/table-select.md`.

## 1. Goal and audience

The owner is editing their own note in hybrid mode and wants to change a table's structure and contents without typing pipe characters. The existing affordances (drag grips, the Table context menu, direct cell typing) each do one thing; there is no single place to restructure a table. This window is that place: one modal, one Apply, one clean GFM table written back. Audience: the single notebook owner in an admin session on desktop or tablet; touch users use the overlay button.

## 2. Scope

**In scope:** both entry points, the grid, the toolbar operations (row and column move, insert, delete, add, alignment, sort, transpose, delete table), pointer drag reordering, Apply/Cancel, merged-cell refusal, keyboard access.
**Out of scope (fixed):** formulas; number formatting; CSV import; column resize; more than one editor at a time; persistence of editor state across close or reload. Multi-cell range selection and range paste moved in scope; see `docs/product/table-editor-selection.md`, which supersedes those two entries and amends AC4, AC5, AC6 and AC12.
**MVP line:** everything in §3–§6 works and AC1–AC18 pass. Nothing else.

## 3. Entry points (hybrid only)

- **Context menu:** the hybrid right-click menu shows **Edit table…** as a top-level item when the click lands inside a table, targeting that table. There is no Table submenu and no row/column item: hybrid mode edits cell text only.
- **Overlay control:** `table-edit.js` places a small **Edit table** control (accessible name "Edit table", 24px hit target) in the active table's left gutter, centred on the header row and outside the table's content box, so it covers neither the table nor the line above it.

Both open the modal titled **Edit table**, bound to that table. Preview mode has no entry point; with no active table, nothing opens.

## 4. Functional flows

**Open.** Capture the table's header row, body rows, per-column alignment, and cell content. The grid is spreadsheet-like: row 0 is the header row, visually distinct; body rows follow. Cells show rendered inline formatting (bold/italic/code/links), not Markdown source.

**Cell editing.** Click a cell to put the caret in it. With a cell focused but not in text-edit mode, a printable key starts editing with the caret at the end of the existing content; it never wipes the cell. Tab / Shift+Tab commit the cell and move focus one column right / left, stopping at the row edge (no wrap). Enter commits and moves down one row, stopping at the last row. Arrow keys move between cells only when not editing text; they never move the caret of a cell being edited. Esc always cancels the whole window.

**Toolbar.** Rows: move the focused body row up or down, insert a row above or below it, add an empty body row at the end, delete the focused body row. Columns: move the focused column left or right, insert a column left or right, add an empty left-aligned column at the right, delete the focused column. The header row is fixed: never moved, inserted above, deleted, or duplicated. Move row is disabled on the header and at the first/last body row; Delete row is disabled when it would remove the last body row; Delete column is disabled when it would remove the last column. Every disabled action names its cause in a tooltip and in the status line. The toolbar also deletes the whole table (one undo step).

**Drag.** Each body row carries a grip in its left padding and each header cell a grip in its top padding; dragging one reorders the working grid with a drop marker on the landing edge. Drag is the pointer path; the Move buttons are the keyboard path. Nothing reaches the note until Apply.

**Alignment.** A column control cycles the focused column left → center → right → left. Serialization: left `:--`, center `:-:`, right `--:`. A plain `---` in the source reads as left; an edited table writes the editor's alignment state, so a plain-left column becomes `:--` once the table is edited.

**Sort.** Choose a column and ascending or descending. Only body rows move; the header stays row 0. Sort is stable: equal keys keep their current relative order. A cell is numeric when its trimmed text parses as a finite number; two numeric cells compare numerically, any other pair compares as text with locale-aware collation. Empty cells sort last in both directions. Sort rewrites the working grid only; nothing reaches the note until Apply.

**Transpose.** Pinned semantics (standard matrix transpose, the Excel behavior): `new[r][c] = old[c][r]`. The old first column becomes the new header row, and the old header row becomes the new first column (its first cell is the new header's first cell). All column alignment resets to left. Transposing twice restores the content but not the alignment.

**Apply.** Replace the source table with one equivalent GFM table: same header, body rows, order, alignment, and cell inline formatting. The note is marked dirty and the replacement is exactly one undo step; bytes outside the table are unchanged. If nothing changed, Apply closes the window, writes nothing, leaves the note clean, and adds no undo entry.

**Cancel.** Discard every working change and close. Esc, the close control, and the Cancel button do the same: no write, no dirty mark, no undo entry.

**Merged cells.** When `tableHasSpans()` is true the table cannot be represented in GFM. Both entry points still open the modal, but it shows a clear notice ("This table has merged cells and cannot be edited here") and refuses to edit: grid and toolbar disabled, Apply absent or disabled, only Cancel closes. No write is possible.

## 5. Edge cases

- Empty cell: shown empty, kept in place, never dropped, serialized empty; a whitespace-only cell counts as empty. Empty cells sort last in both directions.
- A cell containing `|` serializes escaped (`\|`) and stays one cell on reload.
- A newline typed or pasted into a cell becomes a space (GFM has no in-row break).
- Ragged rows are padded with empty cells to the widest row on open; an untouched table is never rewritten (AC11), so the padding is written only if it is edited.
- A header-only source table (zero body rows) is legal: the grid shows the header and no body rows; Add row can add the first, and Delete row stays disabled at one.
- Unsupported inline HTML (spans, colours, styles) is flattened to text on write; it is never emitted as HTML.
- Large tables scroll inside the modal; text wraps. No column resize.
- If the note is reloaded or the table disappears while open, the window closes and discards without writing.
- Sort on a column whose keys are all equal changes nothing.

## 6. Constraints

- Reuse the app's `.settings-overlay > .settings-modal` pattern: modal semantics, free-floating/draggable behaviour, and the shared window geometry from `windows.js`. Geometry is window chrome, not persisted editor state.
- Writes go through the existing hybrid write path; the modal never writes Markdown itself. Apply flushes any pending typing snapshot first so the replacement is one undo step. The editor never invents HTML in the note (hybrid invariant G4).
- Numeric parsing is an assumption: optional sign, decimal point, optional exponent, no thousands separators or units. Marked as an assumption to confirm.

## 7. Acceptance criteria

1. **AC1** In hybrid mode, right-clicking inside a table shows a top-level Edit table… item and no row/column items; activating it opens a modal titled "Edit table" bound to that table. Preview mode shows no entry point.
2. **AC2** The active table's overlay shows one control named "Edit table" in the left gutter, outside the table's content box; clicking it opens the same modal for that table.
3. **AC3** The grid shows one visually distinct header row and one row per body row, with the same cell count per row and the same cell text as the source.
4. **AC4** Clicking a cell places the caret in it; typing changes only that cell.
5. **AC5** Tab / Shift+Tab commit the cell and move focus one column right / left, stopping at the row edge; Enter commits and moves down one row, stopping at the last; arrow keys move between cells only when the cell is not in text-edit mode.
6. **AC6** Add row appends an empty body row; Delete row removes the focused body row and is disabled for the header and the last body row; Add column appends an empty left-aligned column; Delete column removes the focused column and is disabled for the last column. Move row/column moves the focused body row/column one slot and is disabled on the header and at the edge; Insert row/column places a new empty row/column at the focused position, never above the header. Dragging a row or column grip reorders the working grid to the marked boundary. Each disabled action names its cause.
7. **AC7** Repeated use of the alignment control cycles the focused column left → center → right → left; the applied table serializes `:--`, `:-:`, `--:`.
8. **AC8** Sorting a chosen column ascending or descending reorders body rows only, is stable, compares numeric cells numerically and other pairs as text, and puts empty cells last in both directions; the header stays first.
9. **AC9** Transpose applies standard matrix transpose (`new[r][c] = old[c][r]`): the old first column becomes the new header row and the old header row becomes the new first column, and every column alignment resets to left.
10. **AC10** Apply replaces exactly the source table with one GFM table, leaves all bytes outside it unchanged, marks the note dirty, and one undo restores the previous table with its inline formatting; a second undo does not re-apply.
11. **AC11** Apply with no change closes the window, writes nothing, leaves the note clean, and adds no undo entry.
12. **AC12** Cancel and Esc close the window, write nothing, leave the table unchanged, and do not clear an existing dirty mark.
13. **AC13** For a table with merged cells, the modal opens refused with the merged-cells notice, disabled grid and toolbar, no working Apply, and only Cancel available; no write occurs.
14. **AC14** Opening moves focus into the modal; Tab from the last focusable control wraps to the first and Shift+Tab from the first wraps to the last; focus never leaves the modal; closing returns focus to the table or entry point.
15. **AC15** Bold, italic, inline code, and links in an untouched cell survive Apply as equivalent GFM; editing around them does not corrupt them; unsupported inline HTML is flattened to text and never written as HTML.
16. **AC16** Empty cells remain cells in their positions after Apply and sort last in both directions.
17. **AC17** Every toolbar and dialog control is reachable by Tab, activatable by Enter or Space, and has an accessible name.
18. **AC18** The window is a labelled modal dialog (title "Edit table") and follows the app's existing modal focus and close conventions.
