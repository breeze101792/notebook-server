# Table editor — the `Edit table` window

Status: Current spec — pre-implementation (codifies the shipped window).

Scope: the content of `#table-editor-overlay` — its two entry points, grid, headers,
cells, active cell, rectangular selection, fill handle, clipboard, toolbar, merged-cell
blocked state, in-window history, Apply / Cancel, keyboard, phone layout. The shared
window chrome — header, action bar frame, footer frame, focus containment, drag,
resize, maximize — is **not** redesigned here. It is owned by
[`edit-window.md`](edit-window.md) and its markup is `templates/_edit_window.html`
(`static/css/style.css:8519-8754`).
Rendered tables in the reader, and the reader's own rectangle selection, are owned by
[`content-blocks.md`](content-blocks.md) §3.

Reference mockup: [`table-editor-mockup.html`](table-editor-mockup.html) — dark and light,
the default grid, an editing cell, a selection with its fill handle, clipboard feedback,
the sort control, an aligned column, the merged-cell refusal, an empty and a one-cell
table, the Apply frame, an error message, the 720 window and the 390 phone.

**Normative source.** This document is the single source of truth for the window's
content. It reads [`foundations.md`](foundations.md) for every token and
[`controls.md`](controls.md) for control anatomy, states and ARIA, and
[`edit-window.md`](edit-window.md) for the shared chrome. The archived records — the
[table-editor record](../archive/design/table-editor.md), the
[selection record](../archive/design/table-editor-selection.md) and the
[edit-window record](../archive/ui/edit-window.md) — are source material, not current
specs. Where they and this document disagree, this document wins.

**The shipped look is the target.** The user likes the current window. This document
codifies it exactly: grid, headers, cells, toolbar, selection wash, fill handle, notice
and footer. §10.5 lists the four applied exceptions — one phone target size, one preview
wash repair, and two semantic fixes. They are fixes, not a restyle. The pass inherits the
foundation light `--warn` value. Anything else that would change a pixel is in §12,
proposals only.

Every claim about current code cites `file:line`.

---

## 1. Entry and open state

### 1.1 The two entries

Both entries exist only in hybrid (WYSIWYG) mode. Preview mode has no table editor.

| # | Entry | Condition | Code |
|---|---|---|---|
| 1 | Context menu item **Edit table…** | The right-click lands inside a `<table>` inside `#viewer-content`. A top-level item, not a submenu. Never disabled, including for a merged-cell table. | `static/js/hybrid.js:8855-8861` |
| 2 | Overlay button **Edit table** | The pointer is over a table, or focus is inside it, while hybrid is active. One button for the active table. | `static/js/table-edit.js:78-94`, `:104-121`, `:161-171`; `static/css/style.css:817-841` |

The overlay button is a 24 × 24 icon button in the table's left gutter, centred on the
header row, outside the table's content box. Its glyph is a 14 px 16-grid table icon
(`table-edit.js:35-38`). Geometry:

| Part | Value | Source |
|---|---|---|
| Box | 24 × 24, `--radius-xs` (4), 1 px `--border`, `--surface-raised`, `--text-muted` | `style.css:817-831` |
| Position | right edge 4 px left of the table; vertically centred on the header; at least 8 px from the pane edge | `table-edit.js:20-23`, `:77-83` |
| Reveal | on table hover or focus-in; hides 120 ms after the pointer or focus leaves | `table-edit.js:23`, `:104-157` |
| Hide now | any scroll of `#viewer-scroll`, any window resize | `table-edit.js:169-170` |
| Hover | `--accent-soft` face, `--accent` text and border | `style.css:832-836` |
| Focus | 2 px `--accent` ring at 1 px offset | `style.css:837-840` |
| Accessible name | `Edit table` (`aria-label` and `title`) | `table-edit.js:86-87` |

A merged-cell table still gets the button (`table-edit.js:72-88` has no span gate), so
the refusal in §5 is discoverable from the pointer path. The button lives in a layer
inside `#viewer` but outside the `#viewer-content` subtree, so it never enters a save, an
export or an undo snapshot (`table-edit.js:10-14`; `style.css:758-771`).

### 1.2 What is read

`open(table)` refuses when the module is not in hybrid, the table is not inside
`#viewer-content`, or the table has no rows (`table-editor.js:2013-2018`). Otherwise it
snapshots the live table:

| Model field | Read from | Rule |
|---|---|---|
| `cols` | the widest row's `cells.length` | at least 1; ragged rows are padded with empty cells (`table-editor.js:149-170`) |
| `rows` | every `<tr>`, row 0 first | row 0 is the header; the grid renders it as `<th>` and every later row as `<td>` (`table-editor.js:211-249`) |
| `html` | `cell.innerHTML` verbatim | rendered inline HTML, never Markdown; bold, italic, code and links survive Apply (`table-editor.js:159-161`) |
| `align` | the cell's `align` attribute, per cell | `null` reads as left (`table-editor.js:161-162`, `:1472-1475`) |
| `changed` | false on open | set by every model mutation |

The live table is the post-`flattenTheads` shape: rows are direct children of one
`<tbody>` and row 0 is the header (`docs/architecture/table-editor.md` §2).

### 1.3 Open sequence and first focus

The order is load-bearing:

1. `setBlocked(hasSpans)` shows or hides the notice, hides Apply in the blocked state,
   sets `aria-readonly`, and syncs the history buttons (`table-editor.js:2002-2011`).
2. `hist.reset()` seeds the history **after** the model and the sort state are reset, so
   a reopened window cannot carry the previous table's marker (`table-editor.js:2023-2034`).
3. The overlay is unhidden, `renderGrid()`, `rebuildSortOptions("")` and `syncToolbar()`
   run (`table-editor.js:2036-2039`).
4. `NB.dialog.open(overlayEl, { fallbackFocus: firstCell })` inerts the rest of the page
   and installs the focus trap (`table-editor.js:2041-2042`; `controls.md` §2.11).
5. Editable table: `focusCell(0, 0)` then `updateStatus()` — focus is the header's first
   cell, which owns the 2 px ring (`table-editor.js:2048-2049`). Blocked table: focus is
   the footer's **Cancel** (`table-editor.js:2044-2046`).

So the first status line is `Header row · Column 1 of N`; the blocked status is
`This table has merged cells and cannot be edited here.` (`table-editor.js:1894-1908`,
`:2044-2046`).

---

## 2. Grid

### 2.1 Element and roles

| Part | Markup | Source |
|---|---|---|
| Grid | real `<table id="table-editor-grid" class="te-grid" role="grid" aria-label="Table cells">` | `templates/index.html:1451-1452` |
| Row | `<tr role="row">` | `table-editor.js:212-214` |
| Header cell | `<th class="te-cell" role="columnheader" scope="col">` | `table-editor.js:216-226` |
| Body cell | `<td class="te-cell" role="gridcell">` | `table-editor.js:216-229` |
| Cell text | `<span class="te-cell-text">` holding the cell's rendered HTML | `table-editor.js:238-241` |
| Grid counts | `aria-rowcount` and `aria-colcount`; `aria-multiselectable="true"` only when editable; `aria-readonly` reflects the blocked state | `table-editor.js:180-188` |

Roving focus: exactly the active cell has `tabindex="0"`; every other cell has `-1`
(`table-editor.js:230-232`, `:259-267`). In the blocked state every cell is `-1`.

### 2.2 Cell geometry

| Property | Shipped value | Source |
|---|---|---|
| Column minimum | 140 px per cell, border-box | `style.css:5926-5928` |
| Cell padding | 6 px block, 10 px inline | `style.css:5929` |
| Cell rules | 1 px `--border` right and bottom; the first cell in a row adds the left edge; the header adds the top edge | `style.css:5930-5931`, `:5939`, `:5947` |
| Type | `.93rem` / 1.35, weight 400, `--text-primary` | `style.css:5932-5935` |
| Alignment | left by default; `[align="center"]` and `[align="right"]` follow the model | `style.css:5934`, `:5940-5941` |
| Text measure | max-width 380 px, `white-space: pre-wrap`, `overflow-wrap: anywhere` | `style.css:5959-5964` |
| Row height | ≈ 31 px (6 + 6 + a 17.55 px line box + the 1 px bottom rule); the header is ≈ 32 px because it also carries the top rule | computed from `style.css:5929-5932`, `:5947` |
| Empty cell | a CSS `·` at `--text-muted`, opacity .45; display only, never serialized | `style.css:5965-5969` |
| Active cell | `--accent-soft` fill + `inset 0 0 0 2px --accent`, `z-index: 1`; a header cell is `z-index: 3` | `style.css:5953-5958` |
| Cell focus | the active cell's 2 px inset ring **is** the focus indicator; `outline: none` is paired with it | `style.css:5952-5956`; `foundations.md` §10.2 rule 2 |

The table is `border-collapse: separate; border-spacing: 0; min-width: 100%`
(`style.css:5921-5925`), so it fills the pane and its columns share the extra width.
A cell's own text stops growing at 380 px; a wider column keeps the whitespace.

### 2.3 Header row and zebra

| Row | Fill | Source |
|---|---|---|
| Header | `--surface-raised`, weight 600, sticky `top: 0`, `z-index: 2` | `style.css:5942-5949` |
| Body, odd | transparent over `--surface-panel` | `style.css:5926-5938`, `:5918` |
| Body, even | `--surface-page` | `style.css:5950` |
| Row hover | every cell in the row becomes `--surface-raised` | `style.css:5951` |
| Active cell | `--accent-soft`, which out-ranks zebra and hover | `style.css:5953-5958` |

The zebra is inverted relative to the reader's table: the window is a panel surface, so
the even body row drops to the page colour. Do not "fix" it to the reader's `--bg-panel`
zebra; that is a different surface (`content-blocks.md` §3.1).

### 2.4 Active cell, selection, editing

The active cell is the focus corner of the selection. It always has the ring and the DOM
focus; a single-cell selection is the normal state (`table-editor.js:90-129`,
`docs/product/table-editor-selection.md` §3.1). Clicking a cell that is not being edited
moves the active cell and paints the single-cell selection; press-and-release in one cell
then enters text edit (`table-editor.js:1239-1325`).

Editing turns the existing `.te-cell-text` span into `contenteditable="true"` in place.
There is no overlay editor, no second box and no column jump (`table-editor.js:340-367`;
`style.css:6029-6033`). The caret is `--accent`; the cell keeps its box. Commit happens on
blur, on a press in another cell, on `Tab`, on `Enter`, on `F2`, and before any structural
verb (`table-editor.js:326-338`, `:429-474`, `:1239-1246`).

The cell shows rendered inline HTML (`strong`, `em`, `code`, `a`), never Markdown source.
Links inside a cell never navigate: `.te-cell a { pointer-events: none }`, and a click
activates the cell (`style.css:6078`).

### 2.5 Row and column grips

The grips are the pointer path for reordering. The Move buttons are the keyboard path.

| Part | Value | Source |
|---|---|---|
| Row grip | one per body row, in the first cell's left padding: 10 × 20, a six-dot 8 × 12 SVG | `table-editor.js:193-203`, `:35-40`; `style.css:6053-6059` |
| Column grip | one per header cell, in its top padding: 16 × 10, the same dots rotated 90° | `table-editor.js:193-203`; `style.css:6060-6067` |
| Position | absolute; row `left: 1px; top: 50%`; column `top: 1px; left: 50%` | `style.css:6053-6066` |
| Reveal | opacity 0; `.65` on row hover for the row grip, on header-cell hover for the column grip; `1` while pressed | `style.css:6049`, `:6068-6071` |
| Cursor | `grab`, then `grabbing` | `style.css:6050`, `:6070-6071` |
| Semantics | `aria-hidden="true"`, no tab stop, pointer-only | `table-editor.js:198` |
| Model safety | appended to the cell as a sibling of `.te-cell-text`, never inside it | `table-editor.js:238-245` |

A drag starts on `pointerdown` on a grip, commits any open edit, records `{ axis, from, pos }`,
and captures the pointer (`table-editor.js:1225-1237`). Moving over a cell reads it with
`elementFromPoint`, computes the insertion index from the pointer's half of the target cell,
and paints the landing edge (`:1290-1306`). `pointerup` clears the marks, adjusts the index
for a downward move, calls `moveRowTo` / `moveColTo`, and reports `Moved the row` or
`Moved the column` (`:1327-1340`). `pointercancel` drops the drag with the grid unchanged
(`:1342-1348`).

| Drop mark | Where | Source |
|---|---|---|
| `tr.is-drop-before` | 2 px inset accent on the top edge of every cell in the row | `style.css:6074` |
| `tr.is-drop-after` | 2 px inset accent on the bottom edge | `style.css:6075` |
| `.is-drop-left` / `.is-drop-right` | 2 px inset accent on the left / right edge of every cell in the column | `style.css:6076-6077` |

A grip drag is pointer-only. `Esc` is not wired to it: with a multi-cell selection the
grid's capture handler collapses the range and the drag continues; otherwise the overlay's
`Esc` cancels the window, which discards the drag as part of Cancel. `pointercancel` drops
just the drag. §12 P12 proposes making `Esc` drop the gesture first.

### 2.6 Scrolling

`.te-scroll` is the only scroller: `overflow: auto`, `overscroll-behavior: contain`,
`--surface-panel`, padding `0 16px 12px` (`style.css:5913-5920`). The toolbar sits above
it in the shared bar; it may scroll horizontally there, but never with the body. The
header row is the sticky element. A cell move
calls `scrollIntoView({ block: "nearest", inline: "nearest" })` (`table-editor.js:311-315`).

The grid can scroll both ways. A 4-column table needs at least 4 × 140 = 560 px of grid
plus the 32 px pane padding, so it pans inside the 358 px phone measure.

---

## 3. Selection and clipboard

### 3.1 The rectangle

The selection is two corners: the **anchor** (fixed during an extension) and the
**focus** (the active cell). The rectangle is their bounding box, header row included
(`table-editor.js:103-129`; `docs/architecture/table-editor.md` §5b).

| Part | Shipped value | Source |
|---|---|---|
| Wash | `background-image: linear-gradient(--te-sel-fill, --te-sel-fill)` — translucent, so the zebra and the header fill survive under it | `style.css:5982-5989` |
| `--te-sel-fill` dark | `rgba(124, 156, 255, .10)` | `style.css:75` |
| `--te-sel-fill` light | `rgba(47, 95, 208, .08)` | `style.css:128` |
| Outer edge | 1 px `--accent` on each side of the rectangle; the four `.is-sel-*` classes set the inset shadow direction | `style.css:5984-5993` |
| Active cell inside a range | keeps `--accent-soft` + the 2 px ring; the selection rule is `:not(.is-active)` so the ring replaces the 1 px edge on its outside sides | `style.css:5982`, `:5953-5958` |
| Selected header | same wash, same edge, composited over `--surface-raised` | `style.css:5982`, `:5946` |
| Zebra and hover | both stay visible under the wash | `style.css:5950-5951`, `:5982` |
| Announcement | one string in `.te-status`, written on pointer-up, not during a drag | `table-editor.js:1319-1324`, `:1894-1908` |

The 1 px edge is drawn on every outside cell, not as one outline around the rectangle.
Internal grid lines stay visible. That is shipped; §12 P8 records the outline-only
alternative and does not apply it.

### 3.2 Pointer and touch

| Gesture | Result | Source |
|---|---|---|
| Press one cell, release on another | Rectangle between press and release; no text edit | `table-editor.js:1239-1325` |
| Press and release in one cell | Collapse to that cell and enter text edit at the release point | `table-editor.js:1319-1321` |
| Shift + press | Extend from the existing anchor | `table-editor.js:1248-1251` |
| Press inside the cell being edited | Native text selection in that cell only | `table-editor.js:1243-1244` |
| Drag a row or column grip | Reorder; no rectangle | `table-editor.js:1225-1237` |
| Touch tap | Text edit at the tap point | `table-editor.js:1314-1317` |
| Touch press held 500 ms, then move | Paint a range; a short move before the threshold does nothing | `table-editor.js:32`, `:1260-1267`, `:1277` |
| Touch long-press, release without moving | **Text edit** at the press point. The press already selected the cell; the release then enters edit. Product AC25 expects a select-only outcome; the shipped handler does not implement it. §12 P9 records the difference. | `table-editor.js:1314-1321` |

A live drag announces once on release; the status line is not rewritten per cell
(`table-editor.js:375`, `:1319-1324`). No auto-scroll at the pane edge; Shift+click after
scrolling reaches the far corner (`docs/product/table-editor-selection.md` §2).

### 3.3 Keyboard

All of these act only with the grid focused and no cell in text edit (`table-editor.js:429-581`).

| Key | Result |
|---|---|
| Arrow | Collapse the range to the active cell, then move one cell; clamped at the edges |
| Shift + Arrow | Extend the focus corner one cell; the anchor stays |
| Home / End | First / last column of the focus row |
| Shift + Home / End | Extend to that column |
| Ctrl/Cmd + A | Whole grid, header included |
| Ctrl/Cmd + Space | Whole active column, header included |
| Shift + Space | Whole active row (the header row only when the active cell is in it) |
| F2 | Enter text edit on the active cell |
| F2 while editing | Commit, leave text edit, same cell |
| Esc | Collapse a multi-cell range; with no range, cancel the window (in text edit, cancel) |
| Delete / Backspace | Clear every cell in the range |
| Ctrl/Cmd + D | Fill down from the selection's first row |
| Tab / Shift+Tab | One cell right / left; stops at the row edge, never wraps to the next row |
| Enter | Start editing; in edit mode, commit and move down one row (stop at the last) |
| Printable character | Start editing at the end of the value and insert the character; never wipe the cell |
| IME `Process` / keyCode 229 | Enter edit mode without cancelling the composition |

Inside text edit every key keeps its native meaning, including `Ctrl+A` (cell text),
`Shift+Space` (a space) and `Shift+Arrow` (text selection). The grid's range cannot change
while a cell is being edited (`table-editor.js:437-474`).

Tab at the **last cell of the grid** leaves to the first focusable footer control
(Cancel). Shift+Tab at cell (0,0) leaves to the last toolbar control. At any other row
edge Tab is swallowed, so focus never jumps rows (`table-editor.js:400-427`, `:486-498`).

### 3.4 Fill handle

One 8 × 8 square on the bottom-right corner of the selection's last cell. It is inside
the cell box at `right: -1px; bottom: -1px`, so a scroller clip cannot shave it.

| Property | Value | Source |
|---|---|---|
| Box | 8 × 8, `--radius-xs` (2 px here via `border-radius: 2px`), 1 px `--surface-panel` border, `--accent` fill | `style.css:5997-6009` |
| Stack | `z-index: 4`, above cells and the active ring | `style.css:6008` |
| Cursor | `crosshair`, `touch-action: none` | `style.css:6006-6007` |
| Visibility | whenever a selection exists in the editable state, **including while a cell is being edited**; never in the blocked state | `table-editor.js:134-145`, `:340-367` |
| Preview | target cells get `.is-fill-preview` — the same wash and 1 px edge | `style.css:6010-6019` |
| Release | the extended block stays selected with the source's top-left active; the handle moves to the new corner | `table-editor.js:1161-1174`, `:1077-1081` |
| Pointercancel | drops the drag; the grid and selection are unchanged | `table-editor.js:1342-1348` |
| Escape | drops the drag when the source is a single cell. With a multi-cell source the grid's capture handler collapses the range first and stops the event, so the overlay never sees the key and the drag continues. §12 P11 records the difference. | `table-editor.js:506-514`, `:583-596` |

The handle is `aria-hidden` and has no tab stop. `Ctrl/Cmd+D` is the keyboard path for
the same operation (`table-editor.js:1089-1099`). A source of two or more numbers with an
even step continues the series and keeps the source's decimal places; anything else
repeats the block cyclically (`table-editor.js:995-1031`). A fill grows the grid at the
bottom or the right when the target passes the edge; it never shrinks it
(`table-editor.js:1042-1050`).

The shipped handler does not remove the handle while a cell is in text edit: `startEdit`
repaints the selection, which places the handle, and no later step hides it
(`table-editor.js:347-355`, `:134-145`). The archive's "none while a cell is being edited"
is not implemented; §12 P10 proposes the hide, and the editing board draws the shipped
state.

### 3.5 Clipboard contract

Copy and cut write two flavours; paste reads them in order.

| Direction | Format | Content |
|---|---|---|
| Write | `text/plain` | rows separated by `\n`, cells by `\t`, no trailing newline; each field is the rendered text with tabs, newlines and carriage returns replaced by one space | `table-editor.js:740-764`, `:681-683` |
| Write | `text/html` | one `<table>`; row 0 of the rectangle as `<thead><tr><th>` when included, other rows as `<tbody><tr><td>`; inline `strong`, `em`, `code`, `a` kept; no classes, styles or scripts | `table-editor.js:747-762`, `:651-679` |
| Read | `text/html` with a `<table>` | the first table; each `tr` a row, each `th`/`td` a cell; `colspan`/`rowspan` ignored; content reduced to the inline subset; empty trailing rows dropped | `table-editor.js:693-706`, `:727-738` |
| Read | `text/plain` with a tab or newline | TSV; CRLF and CR become LF; one trailing empty line dropped; short rows padded | `table-editor.js:708-719` |
| Read | `text/plain` with no tab or newline | a 1 × 1 block | `table-editor.js:710-712` |

Paste rules:

- A 1 × 1 block into a multi-cell target fills every cell of the target and keeps the
  target selected (`table-editor.js:781-811`).
- Any larger block writes once with its top-left at the selection's top-left; the rest of
  the target is untouched. It never tiles (`table-editor.js:793-802`).
- The grid grows only at the bottom and the right; appended columns get empty header
  cells with `align: "left"` (`table-editor.js:785-791`).
- Paste never removes a row or a column (`table-editor.js:772-814`).
- Pasted HTML is sanitised before it reaches the model, so the note never receives HTML
  (`table-editor.js:642-679`; `docs/architecture/table-editor.md` §5b).
- Pasting plain text into a cell that is being edited inserts at the caret and collapses
  whitespace runs to one space; any block payload commits the edit first
  (`table-editor.js:910-933`).
- A native drop is routed through the plain-text path, so block markup cannot enter the
  model (`table-editor.js:938-958`).

### 3.6 Status strings

`.te-status` is the one polite live region that changes during editing (`role="status"`,
`aria-live="polite"`, `aria-atomic="true"`; `templates/_edit_window.html:53-54`). The
merged-cell notice is a second, static `role="status"` (`templates/index.html:1443`); it is
announced when it appears and is not rewritten. One string at a time in the footer.

| Event | String |
|---|---|
| Single cell, header | `Header row · Column 3 of 4` |
| Single cell, body | `Row 2 of 4 · Column 3 of 4` |
| Range | `3 × 3 selected, rows 2–4, columns 1–3` |
| Copy | `Copied 3 × 3` · `Copied 1 cell` |
| Copy fallback | `Copied 3 × 3 as text` · `Press Ctrl+C to copy` |
| Cut | `Cut 3 × 3` · `Cut 1 cell` |
| Paste | `Pasted 2 × 3` · `Pasted 1 cell into 9 cells` |
| Paste refused | `Nothing to paste` · `Press Ctrl+V to paste` |
| Clear | `Cleared 3 × 3` · `Nothing to clear` |
| Delete rows / columns | `Deleted 3 rows` · `Deleted 2 columns` |
| Fill | `Filled 6 cells` · `Nothing to fill` |
| Fill with one row selected | `Select the source row and the rows to fill.` |
| Sort | `Sorted by Temp (°C), ascending` |
| Alignment | `Column 3 aligned center` |
| Transpose | `Transposed: <newCols> columns × <newRows> rows` (a 4 × 4 grid stays 4 × 4) |
| Move | `Moved the row` · `Moved the row up` · `Moved the column left` |
| Insert / add | `Inserted a row` · `Added a row` · `Inserted a column` · `Added a column` |
| Delete table | status is cleared before the window closes |
| Blocked | `This table has merged cells and cannot be edited here.` |
| Blocked clipboard | `Clipboard is unavailable: this table has merged cells.` |
| History restore failure | `The saved state could not be restored` |

Sources: `table-editor.js:766-768`, `:809-811`, `:829`, `:845-856`, `:885-908`,
`:1042-1086`, `:1577-1737`, `:1755-1770`, `:1846-1849`, `:1894-1913`, `:1967-1992`.
Rows and columns are 1-based with the header at 1, matching `aria-rowindex`.

Above 720 the line is one nowrap line with a tail ellipsis; Cancel and Apply never shrink
(`style.css:6083-6092`). At and below 720 the footer wraps and the status takes a full row
with `white-space: normal` (`style.css:8751-8754`), so it wraps rather than ellipsizing. A
long range is truncated only on the wide window; the live region reads the full text either
way.

### 3.7 Structural operations and the selection

Insert, add, delete, move, sort, transpose and delete-table collapse the range to the
active cell, clamped into the new grid. Copy, cut, paste and clear keep the rectangle
(`table-editor.js:1506-1513`, `:1721-1737`, `:1862-1890`; `docs/product/table-editor-selection.md`
§3.10). Delete row and Delete column act on every body row or column the rectangle
touches (`table-editor.js:1648-1719`).

---

## 4. Toolbar

### 4.1 Anatomy and geometry

The toolbar is `#table-editor-toolbar`, a `role="toolbar"` labelled **Table tools**, and it
lives in the shared action bar's scrolling actions slot (`templates/index.html:1325-1441`;
`templates/_edit_window.html:23-49`). It is **not** inside the body. The earlier standalone
`.te-toolbar` rule is superseded by the bar rule; the effective values are:

| Property | Value | Source |
|---|---|---|
| Bar height | 57 px; padding 6 px 12 px; `--surface-raised`; 1 px bottom seam | `style.css:8591-8601` |
| Bar slot | flex, gap 8 px, one horizontal scroller, no scrollbar, right-edge mask only while it overflows | `style.css:8602-8622` |
| Toolbar | one row, no wrap, gap 4 px, no own surface, no own padding | `style.css:8707-8718` |
| Group | inline flex, gap 2 px; `role="group"` with an `aria-label` | `style.css:5838`; `index.html:1327`, `:1357`, `:1387`, `:1408`, `:1417`, `:1430` |
| Separator | 1 px × 20 px `--border`, 6 px margin each side; `aria-hidden` | `style.css:5839-5845`; `index.html:1355`, `:1385`, `:1406`, `:1415`, `:1428` |
| Tool | 32 × 32 in the bar (the 28 px base is overridden), 1 px transparent border, `--radius-sm`, transparent, `--text-muted` | `style.css:5846-5859`, `:8719-8722` |
| Icon | 16 × 16, `currentColor`, stroke 1.4 | `style.css:5881`; `index.html:1330` and every tool |
| Hover | `--accent-soft` face, `--text-primary` glyph | `style.css:5860` |
| Pressed (`aria-pressed`) | `--accent-soft` face, `--accent` glyph | `style.css:5869-5872` |
| Focus | 2 px `--accent` at 1 px offset | `style.css:5861-5864` |
| Disabled | `aria-disabled="true"`, opacity .4, no hover response, still focusable | `style.css:5873-5880` |
| Destructive hover | `--danger-soft` face, `--danger` glyph | `style.css:5865-5868` |

The toolbar needs roughly 950 px at 32 px tools plus the pinned history pair; it fits the
1229 px modal at a 1280 viewport and scrolls with the mask below about 1150 px
(`docs/architecture/table-editor.md` §10; `style.css:8619-8622`).

### 4.2 Shipped order

Left to right, with the exact ids:

| # | Group (`aria-label`) | Controls, in order | Icons |
|---|---|---|---|
| 1 | Rows | `te-move-row-up`, `te-move-row-down`, 4 px gap, `te-insert-row-above`, `te-insert-row-below`, `te-add-row`, `te-delete-row` (danger) | arrow up to a floor, arrow down from a ceiling, insert above, insert below, add at end, delete |
| 2 | Columns | `te-move-col-left`, `te-move-col-right`, 4 px gap, `te-insert-col-left`, `te-insert-col-right`, `te-add-col`, `te-delete-col` (danger) | the same six rotated |
| 3 | Clipboard | `te-cut`, `te-copy`, `te-paste`, `te-clear` | scissors, two sheets, board with clip, eraser over a floor line |
| 4 | Column alignment | `te-align-col` | three text lines: long, short, long |
| 5 | Sort | `te-sort-col` `<select>`, `te-sort-dir` | placeholder `Sort by…`, one option per column; direction arrow |
| 6 | Table | `te-transpose`, `te-delete-table` (danger) | two crossing arrows, bin |

Markup: `templates/index.html:1326-1440`. The five separators are between the groups, not
inside them.

The labels are the accessible names. Every icon-only tool has `aria-label` and `title`
with the same words (`controls.md` §2.2). In order: Move row up · Move row down · Insert
row above · Insert row below · Add row at the end · Delete row; Move column left · Move
column right · Insert column left · Insert column right · Add column at the right · Delete
column; Cut · Copy · Paste · Clear contents; Cycle column alignment; Sort by column ·
Sort ascending / Sort descending; Transpose table · Delete table. The visible `Sort` word
is a separate `.te-sort-label` at `.76rem`; the select's own accessible name is **Sort by
column** (`index.html:1418-1421`; `style.css:5883-5888`).

### 4.3 Enablement

Disabled tools use `aria-disabled="true"`, not `disabled`: they stay Tab stops, keep their
`title`, gain `aria-describedby` pointing at the status line, and activating one writes
the same cause into the status line (`table-editor.js:1390-1405`; `style.css:5873-5880`).
The title is not the accessible name, and the described status holds the position rather
than the reason at rest; exception E3 (§10.5) appends the reason to `aria-label` while the
control is disabled and restores the base name on enable.

| Control | Disabled when | Reason string |
|---|---|---|
| Move row up | active row is the header, or the first body row | `The header row can't be moved.` / `This is already the first body row.` |
| Move row down | active row is the header, or the last body row | `The header row can't be moved.` / `This is already the last body row.` |
| Insert row above | active row is the header | `No row can be inserted above the header.` |
| Delete row | active row is the header, or the table has one body row | `The header row can't be deleted.` / `A table needs at least one body row.` |
| Move column left / right | first / last column | `This is already the first column.` / `This is already the last column.` |
| Delete column | one column left | `A table needs at least one column.` |
| Sort select and direction | fewer than two body rows | `Nothing to sort.` |
| Insert left / right, insert below, Add row / column, Align, Transpose, Delete table, Cut / Copy / Paste / Clear | never in the editable state | — |

Sources: `table-editor.js:1352-1388`, `:1407-1470`.

Two shipped nuances to preserve:

1. Delete row / Delete column enablement is computed from the **active cell**, not the
   whole selection. A multi-row selection that would empty the body keeps the button
   enabled and refuses on activation, writing the same cause (`table-editor.js:1352-1362`,
   `:1662-1683`). §12 P6 proposes aligning the two.
2. With no sort column chosen the direction button is still enabled (when two body rows
   exist) and flips only its own pressed state; it does not reorder anything
   (`table-editor.js:1852-1860`). §12 P6 also covers this.

### 4.4 Sort

The Sort group has a compact native `<select>` and one direction toggle. Picking a
column sorts immediately in the current direction; Ascending is the initial direction
(`index.html:1419-1425`; `table-editor.js:2185-2190`).

| Part | Value | Source |
|---|---|---|
| Select | height 32 in the bar, min-width 132, max-width 190, `--surface-raised`, 1 px `--border`, `--radius-sm`, `.82rem` | `style.css:5889-5901`, `:8723` |
| Select focus | border `--accent` + 3 px `--accent-soft` halo; `outline: none` is the visible replacement | `style.css:5902-5905` |
| Select disabled | opacity .4, default cursor | `style.css:5906-5910` |
| Options | `Sort by…`, then one per column labelled with the header text or `Column N` | `table-editor.js:1477-1495` |
| Direction glyph | one up arrow; it does not rotate | `index.html:1424` |
| Direction state | `aria-pressed="true"` = ascending, `false` = descending; name and title change to `Sort ascending` / `Sort descending` | `table-editor.js:1453-1463` |
| Sorted header | `aria-sort="ascending"` / `"descending"` + `data-sort`; the cell text gains ` ↑` / ` ↓` in `--accent`, weight 600 | `table-editor.js:234-237`; `style.css:5970-5977` |

Sort compares body rows only, keeps the header at row 0, is explicitly stable (ties keep
source order), compares two numeric cells numerically and other pairs with a
numeric-aware `Intl.Collator`, and partitions empty cells last in both directions
(`table-editor.js:1806-1850`). One sort is one history step. A repeated identical sort
adds no step.

The select's popup is the platform's, not app chrome. Do not build a custom listbox:
`controls.md` §2.5 records the reason (type-ahead, Home/End, the platform picker).

### 4.5 Alignment

One button cycles the **active column** left → center → right → left
(`table-editor.js:1790-1796`). It writes the same `align` on every cell of the column,
header included, and on Apply serialises `:--`, `:-:`, `--:`
(`docs/product/table-editor.md` §4). A plain `---` in the source reads as left; an edited
table writes `:--` for a plain-left column (`table-editor.js:1938-1965`).

The visible glyph never changes. The current value is carried by the button's `title` —
`Cycle column alignment (center)` — and by the status line (`table-editor.js:1464-1469`,
`:1795`). The accessible name stays `Cycle column alignment`; exception E4 (§10.5) adds the
current value to it. §12 P3 proposes a visible state.

### 4.6 Transpose

Transpose runs immediately, with no confirmation. `new[r][c] = old[c][r]`: the old first
column becomes the new header row, the old header row becomes the new first column, and
every `align` resets to `null` (left). The active cell becomes (0,0), the selection
collapses, and the sort marker clears (`table-editor.js:1862-1890`). Its title says
`Transpose table (resets column alignment)`. The status is
`Transposed: <newCols> columns × <newRows> rows`. It is one history step; Cancel discards
it. Transposing twice restores the content but not the alignment.

### 4.7 Delete table

`te-delete-table` is danger-styled and never disabled in the editable state. It removes
the table from the note immediately — no confirmation — flushes the pending snapshot,
calls `onContentChange`, hides the overlay button, closes the window, and lands the caret
on the neighbouring block (`table-editor.js:1755-1784`). It is one note-level undo step;
the window's own history is discarded with the close. The title says
`Delete table (one undo step)`.

---

## 5. Blocked and error states

### 5.1 Merged cells (read-only)

`NB.hybrid.tableHasSpans(table)` selects the blocked state (`table-editor.js:2022`).
GFM cannot represent `colspan` / `rowspan`, so the table opens read-only. It still opens,
so the refusal is discoverable.

| Part | State | Source |
|---|---|---|
| Notice strip | visible above the grid, below the bar: a `⚠` glyph, a title line and a second line. `role="status"` | `index.html:1443-1449`; `style.css:6100-6120` |
| Notice box | `--surface-raised`, 1 px bottom `--border`, padding 10 px 14 px, gap 8 px, glyph `--warn` at 1rem | `style.css:6100-6113` |
| Title line | `This table has merged cells and cannot be edited here.` at `.85rem`, `--text-primary` | `index.html:1446`; `style.css:6115` |
| Second line | `GFM can't represent merged cells. Edit the Markdown source instead.` at `.8rem`, `--text-muted`, 2 px below | `index.html:1447`; `style.css:6116-6120` |
| Toolbar | every `.te-tool` `aria-disabled="true"`, `title` = base + ` (editing disabled)`; every clipboard tool takes `Clipboard is unavailable: this table has merged cells.`; the select is `disabled` | `table-editor.js:1412-1428`, `:646-647` |
| Grid | `aria-readonly="true"`, no `aria-multiselectable`, no cell `tabindex`, no `aria-selected`, no active ring, no selection, no fill handle, `cursor: default` | `table-editor.js:185-187`, `:220-232`; `style.css:6079` |
| Footer | **Cancel only**: Apply is `hidden` and `disabled`; the hint stays | `table-editor.js:2005-2008`; `index.html:1455` |
| Focus | Cancel | `table-editor.js:2044-2046` |
| Status | `This table has merged cells and cannot be edited here.` | `table-editor.js:2045` |
| Exit | Cancel, Esc, the close control, the backdrop. No write. | `table-editor.js:1994-1998`, `:2077-2100` |

The grid still renders the table's content. `snapshotTable` pads a spanned row to the
widest row, so the blocked grid can show the spanned text in one cell and empty cells
after it (`table-editor.js:149-170`). That is the snapshot shape, not a merge.

### 5.2 Malformed and ragged tables

| Case | Behaviour | Source |
|---|---|---|
| Ragged rows | padded with empty cells for display; padding alone never sets `changed`; an untouched Apply writes nothing | `table-editor.js:149-170`, `:1979-1981` |
| Zero rows | `open()` returns `false`; no window | `table-editor.js:2018` |
| Not inside `#viewer-content` | `open()` returns `false` | `table-editor.js:2017` |
| Not in hybrid | `open()` returns `false` | `table-editor.js:2015` |
| Unsupported inline HTML | flattened to text on write; never emitted as HTML | `table-editor.js:651-679`; `docs/product/table-editor.md` §5 |
| Nested table in a cell | does not round-trip; accepted, identical to the live surface | `docs/architecture/table-editor.md` §10 |
| Table detached while open | Apply and Delete table close without writing | `table-editor.js:1969-1971`, `:1757-1760` |
| Sort with all-equal keys | reorders nothing; still records the sorted column and one step | `table-editor.js:1813-1850` |

### 5.3 Applying

There is **no applying state**. Apply is synchronous: the table is replaced, the write is
scheduled, and the window is hidden in the same task. There is no spinner, no
`aria-busy`, no disabled Apply and no "Applying…" label. The mockup's Apply board shows the
last frame for that reason.

### 5.4 Failure

| Failure | Shipped surface | Source |
|---|---|---|
| History restore cannot run (a pointer gesture is live, or the snapshot does not parse) | status text `The saved state could not be restored`; the index is reverted | `edit-window.js:262-267`; `table-editor.js:1540-1568` |
| Paste has nothing usable | status text `Nothing to paste` | `table-editor.js:877`, `:930` |
| Clipboard read denied / no async clipboard | status text `Press Ctrl+V to paste`; nothing changes | `table-editor.js:879-882` |
| Clipboard write denied / text-only fallback | status text `Copied N × M as text` or `Press Ctrl+C to copy` | `table-editor.js:848-856` |
| Autosave fails after Apply | **outside this window**: the app's draft bar / save status owns it; the window is already closed | `docs/architecture/table-editor.md` §5 |

The status line has one appearance for every message: `.82rem` / 1.3, `--text-muted`, no
icon, no `role="alert"`. A failure therefore reads like a position message. §12 P4 proposes an
error treatment; it is not applied here.

### 5.5 Read-only is the blocked state

There is no second read-only mode. A viewer never reaches this window (hybrid is
writer-only). "Read-only" in this document always means §5.1.

---

## 6. History

### 6.1 Stack and limits

The window's history is modal-local and never touches the note. It is the shared
`NB.editWindow` stack (`static/js/edit-window.js`) attached once in `wire()` with
`ownsKey: () => true` (`table-editor.js:2119-2128`).

| Property | Value | Source |
|---|---|---|
| Mode | `stack` — the table module snapshots, the shared module owns the index | `edit-window.js:48-58`; `table-editor.js:2208-2211` |
| Limit | 100 snapshots including the opening one; past the cap the oldest is evicted, so the opening state can be lost | `edit-window.js:20`, `:157-161` |
| Size cap | 4 M UTF-16 code units of snapshot text | `edit-window.js:22`, `:119-125` |
| Coalesce window | 350 ms | `edit-window.js:21`, `:146-150` |
| Opening seed | the pristine model, after the active-cell, selection and sort resets | `table-editor.js:2032-2034` |
| Snapshot contents | `cols`, `rows`, `changed`, `sortedCol`, `sortedDir` | `table-editor.js:1530-1538` |
| Lifecycle | reset on open; cleared on close (Cancel, Esc, ×, backdrop, Apply) | `table-editor.js:2034`, `:2099` |

The snapshot stores `changed` deliberately: undoing to the opening state restores
`changed:false`, so Apply's no-op short-circuit still holds for a ragged source table
(`table-editor.js:1979-1981`; `docs/architecture/table-editor.md` §5c).

### 6.2 What coalesces

| Kind | Actions | Source |
|---|---|---|
| `text` — one step per burst | typing in a cell (`onGridInput`), the printable-character branch of `startEdit`, `insertPlainText` | `table-editor.js:357-362`, `:612-622`, `:960-987` |
| `structural` — one step each | paste, clear, fill, insert row, move row, insert column, move column, delete row, delete column, align, sort, transpose | `table-editor.js:265`, `:812`, `:830`, `:1085`, `:1587`, `:1603`, `:1620`, `:1638`, `:1682`, `:1718`, `:1796`, `:1849`, `:1889` |

Two adjacent text bursts in the same cell merge only when the new step is `text`, the
previous was `text`, the index is the top, and 350 ms have not passed. `commitEdit()`
calls `breakCoalesce()`, so typing in a second cell always starts a new entry
(`table-editor.js:326-338`; `edit-window.js:199-204`). A snapshot identical to the current
one is dropped, so a no-op paste / clear / fill / repeated sort adds no dead step
(`edit-window.js:142-145`).

### 6.3 What is not undoable

- The selection, the anchor, the active cell and the caret.
- A bare direction change with no sort column chosen (no capture; only `aria-pressed`
  changes).
- Hover, focus, the notice strip, and the blocked / editable state.
- Opening and closing the window; Cancel and the blocked refusal.
- The clipboard itself: Cut is not transactional on the clipboard, only on the grid.
- Delete table, because it closes the window; its undo is the note-level one.
- Apply, because it also closes; its undo is the note-level one.

### 6.4 Buttons and chords

Undo and Redo are the first two controls in the shared bar, 44 × 44 `.edit-bar-btn`s with
17 px glyphs, pinned left of the scrolling toolbar (`templates/_edit_window.html:25-46`;
`style.css:8642-8674`). A clean open leaves both `disabled`; the first model change
enables Undo; Undo enables Redo (`edit-window.js:103-110`).

| Chord | Effect | Source |
|---|---|---|
| `Ctrl/Cmd + Z` | Undo one step | `edit-window.js:297-308` |
| `Ctrl/Cmd + Shift + Z` | Redo one step | same |
| `Ctrl/Cmd + Y` | Redo one step | same |

The chord is modal in every target, including a cell in text edit and the sort select,
because `commitEdit()` kills native cell undo (`table-editor.js:2124`). `Esc` stays in the
window's own handler (`table-editor.js:583-596`).

### 6.5 Restore

`restoreSnapshot` refuses while a pointer gesture owns the grid (`fill || press || drag`),
commits any open edit, parses the snapshot, restores `state`, `sortedCol`, `sortedDir` and
`changed`, repaints the grid and the sort options, and re-enters the same cell if it was
being edited, caret at the end (`table-editor.js:1540-1568`). A failure returns `false`,
reverts the index, and writes `The saved state could not be restored`
(`edit-window.js:262-267`). Focus lands on the active cell; the buttons do not take focus.

---

## 7. Apply and Cancel

### 7.1 Apply — the exact order

Apply is the footer's primary action, always enabled in the editable state
(`templates/_edit_window.html:58-59`). In order:

1. **Guard the model.** No state, or blocked → close with a table focus and write nothing
   (`table-editor.js:1968`).
2. **Guard the target.** `originalTable` must still be inside `#viewer-content`; a watcher
   refresh can replace the content under an open window. If it moved, close with a table
   focus and write nothing (`table-editor.js:1969-1971`).
3. **Build the replacement** from the model: a shallow clone of the original table, one
   `<tbody>`, row 0 as `<th>`, every later row as `<td>`, alignment written from the
   editor state (`table-editor.js:1945-1965`). Nothing is in the DOM yet.
4. **No-op check.** If `state.changed` is false, or a source-faithful build equals the
   original, close with a table focus; no DOM change, no dirty mark, no undo entry
   (`table-editor.js:1979-1981`, `:1917-1936`).
5. **Flush the pending snapshot**, so the pre-edit state is its own undo step
   (`table-editor.js:1984`).
6. **Replace the table in the DOM** — `original.replaceWith(built)` (`table-editor.js:1985`).
7. **Rebind** `originalTable` to the new node and tell `table-edit.js` to point at it, so
   the gutter button reopens the live table (`table-editor.js:1986-1989`).
8. **Mark the note dirty and schedule the write** — `NB.hybrid.onContentChange()` runs the
   dirty flag, autosave and the one debounced snapshot (`table-editor.js:1990`;
   `docs/architecture/table-editor.md` §5). The markdown write is asynchronous; the
   window does not wait for it.
9. **Close** with `{ focusTable: true }` (`table-editor.js:1991`): commit any open edit,
   hide the overlay, `NB.dialog.close`, focus `#viewer-content` and put a collapsed range
   in the new table's first cell, then clear the model, the grid, the status and the
   history (`table-editor.js:2077-2100`, `:2063-2075`).

So the observable order is **DOM table update → note dirty / write scheduled → window
hidden → focus in the note**. The markdown itself is produced by the hybrid write path,
never by this window; the window never invents HTML in the note
(`docs/product/table-editor.md` §6).

Apply is exactly one note-level undo step: the replacement follows the flushed snapshot.
A second undo does not re-apply the edit (`docs/architecture/table-editor.md` §5;
`tests/dom/test_dom.js:12539-12550`).

### 7.2 Cancel

Cancel, Esc, the header × and a backdrop click are one action: `cancel()` → `close()`.
It discards the working copy, writes nothing, does not clear an existing dirty mark, and
adds no undo entry (`table-editor.js:1994-1998`, `:2077-2100`, `:2130-2137`).
`close()` clears the history and the status. Focus returns to the overlay button when it
still exists; on the context-menu path, where the invoker is already hidden, it lands in
`#viewer-content` at the table's first cell (`table-editor.js:2080-2092`, `:2063-2075`).

### 7.3 Delete table

Its order is separate because it has no replacement:

1. Commit any edit. 2. Take the next sibling, else the previous sibling, as the focus
landing. 3. Flush the pending snapshot. 4. Remove the table. 5. Clear `originalTable`.
6. `onContentChange()`. 7. Hide the gutter button. 8. Close. 9. Put the caret at the start
of the neighbouring block. 10. Clear the status (`table-editor.js:1755-1784`).

It is one note-level undo step. No confirmation is shown.

### 7.4 Footer order

Status (left, `margin-right: auto`), hint `Esc cancels` (hidden at ≤ 520), **Cancel**,
**Apply** (primary). DOM order is Cancel then Apply; both are 44 px high in the footer
(`templates/_edit_window.html:51-60`; `style.css:8726-8748`). At ≤ 720 the status takes
its own row and the hint and buttons wrap below it (`style.css:8751-8754`). The hint is
`aria-hidden`; `Esc` is already in the keyboard contract.

---

## 8. Keyboard and ARIA

### 8.1 Focus order

Inside the dialog, DOM order: header maximize → close → Undo → Redo → toolbar tools →
sort select → the active grid cell → the footer hint (not focusable) → Cancel → Apply.
`NB.dialog` wraps Tab at both ends and makes every other body child inert (`controls.md`
§2.11). No positive `tabindex` anywhere.

The grid is one Tab stop: the active cell has `tabindex="0"` and every other cell `-1`
(`table-editor.js:230-232`). Tab inside the grid is handled by the window, not left to the
browser, so focus never jumps rows (`table-editor.js:420-427`).

### 8.2 Grid semantics

| Element | Attributes | Source |
|---|---|---|
| Grid | `role="grid"`, `aria-label="Table cells"`, `aria-rowcount`, `aria-colcount`, `aria-readonly`, `aria-multiselectable="true"` when editable | `table-editor.js:180-188` |
| Row | `role="row"` | `table-editor.js:212-213` |
| Header cell | `role="columnheader"`, `scope="col"`, `aria-rowindex="1"`, `aria-colindex` | `table-editor.js:220-226` |
| Body cell | `role="gridcell"`, `aria-rowindex`, `aria-colindex`, `aria-selected="true"` or `"false"` | `table-editor.js:220-229`, `:122` |
| Sorted header | `aria-sort="ascending"` / `"descending"` | `table-editor.js:234-237` |
| Active cell | the focused element; its 2 px inset ring is the focus indicator | `style.css:5953-5958` |

The cell's accessible name is its content. An empty cell has no name; its position comes
from `aria-rowindex` / `aria-colindex` and the status line
(`docs/product/table-editor-selection.md` §8). The selection is announced by the status
region, not by a live region per cell.

### 8.3 What is announced

`.te-status` is the polite live region that carries every change, `aria-live="polite"`,
`aria-atomic="true"` (`templates/_edit_window.html:53-54`). The blocked notice is a second,
static `role="status"`; the footer status repeats its sentence so the refusal is announced
reliably. It announces, in order of events: the single-cell
position, the range size and bounds, copy / cut / paste / clear / fill / delete counts,
the sort result, the alignment result, the transpose size, every refusal with its cause,
and the paste fallback. It is never written per cell during a drag (`table-editor.js:375`).

### 8.4 Focus trap and exit

`NB.dialog.open` owns Tab wrapping. The window adds one explicit escape at each grid
edge: Tab at the grid's final cell lands on Cancel (the first focusable footer control);
Shift+Tab at cell (0,0) lands on the last toolbar control
(`table-editor.js:400-412`; `tests/browser/test_table_editor_browser.js:323-373`).

`Esc` is two handlers. The grid's capture handler runs first: with a multi-cell range and no
cell in text edit it collapses the range to the active cell and stops the event
(`table-editor.js:506-514`). The overlay's bubble handler then either cancels a live fill or
cancels the window (`:583-596`). So a plain multi-cell range collapses and keeps the window
open; a single-cell fill is cancelled; a fill whose source is multi-cell is not, because the
capture handler stops the event first — §12 P11 records it. A pointercancel drops a drag with
the grid unchanged (`:1342-1348`).

### 8.5 The toolbar contract

`role="toolbar"` with `aria-label="Table tools"`; each group `role="group"` with its own
label; separators `aria-hidden`; every control a native `<button type="button">` with an
accessible name; the select a native `<select>` (`index.html:1326-1440`). Arrow keys are
not bound inside the toolbar; Tab walks the tools in DOM order (`controls.md` §2.3).
A tool that scrolls out of view is scrolled into view by focus automatically; the bar's
mask is the only overflow cue (`style.css:8619-8622`).

---

## 9. Responsive and phone

### 9.1 Widths

The window uses the shared box: `width: min(1320px, 96vw)`, `height: min(85vh, 92vh)`,
`--radius-lg`, `--surface-panel`, `--shadow-modal`
(`style.css:5812-5817`, `:1819-1834`). At ≤ 520 it is full-screen with radius 0
(`style.css:6122-6131`).

| Viewport | Window | Bar | Footer | Grid |
|---|---|---|---|---|
| 1280 | 1229 × 0.85 vh | Fits the ~950 px toolbar; no mask | One row | 4 columns share the pane width |
| 861 | 827 | Scrolls; right-edge mask | One row | Same; 4 columns fit at 561 px minimum |
| 720 | 691 | Scrolls; mask | Wrapped: status row, then hint / Cancel / Apply | 4 columns fit (561 px) |
| 520 | full screen | Scrolls; mask | Wrapped; hint hidden | Grid pans if wider than 358 px |
| 390 | full screen | Scrolls; mask | Wrapped; hint hidden | Grid pans; 4 columns are 561 px |

No new breakpoint. The only queries are the mode switch at 860 / 1023, the footer wrap
at 720 and the full-screen rule at 520 (`foundations.md` §8.2; `style.css:8751`,
`:6122`).

### 9.2 720

At 720 the window is 96 vw (691 px). The bar keeps the pinned Undo/Redo pair and scrolls
the toolbar behind the same 22 px right-edge mask (`style.css:8602-8622`). The footer
wraps: the status gets the full first row and is allowed to wrap
(`white-space: normal`), then the hint and the two 44 px actions sit below it
(`style.css:8751-8754`). The hint stays until 520.

### 9.3 520 and 390

At ≤ 520 the window fills the viewport, square corners, and the footer hint is removed
(`style.css:6122-6131`). It is still a dialog with the same trap. The toolbar scrolls
inside the bar; Undo and Redo stay pinned.

Caveat: a saved inline geometry wins over the 100 vw/vh rule. A table that has ever been
dragged or resized opens at its saved pixel size on a phone; `edit-window.md` P1 records the
fix. AC19 tests a fresh window.

The grid pans horizontally inside `.te-scroll`; the header scrolls with it (no sticky
first column). The footer status is on its own row and ellipsises its tail
(`style.css:6083-6091`).

### 9.4 Targets

| Control | Desktop | Phone |
|---|---|---|
| Header close, maximize | 44 × 44 | 44 × 44 |
| Undo / Redo | 44 × 44 | 44 × 44 |
| Toolbar tool | 32 × 32 | **44 × 44** (exception E1, §10.5) |
| Sort select | 32 high | **44 high** (E1) |
| Cancel / Apply | 44 high | 44 high |
| Fill handle | 8 × 8 visual | 8 × 8 visual (see P7) |
| Grid cell | ≥ 140 × ≈ 31 | cell-sized touch target |

The 44 px floor is `--control-h-touch` (`foundations.md` §10.4). E1 is the one visual
addition in this pass.

### 9.5 The grid inside the phone

`.te-scroll` keeps its 16 px side padding; the grid keeps its 140 px column minimum, so a
4-column table is 561 px wide inside a 358 px measure and pans. The header row stays
sticky vertically. A cell's text still wraps at 380 px, which is wider than the phone;
the cell grows vertically instead.

---

## 10. Tokens and CSS target

### 10.1 Reuse first

Every rule below reads a foundation token where one exists. The shipped stylesheet
currently uses the base names; the mapping is one-way and fixed.

| Shipped | Foundation role |
|---|---|
| `--bg` | `--surface-page` |
| `--bg-panel` | `--surface-panel` |
| `--bg-elev` | `--surface-raised` |
| `--code-bg` | `--surface-well` |
| `--fg` | `--text-primary` |
| `--fg-muted` | `--text-muted` |
| `--accent-fg` | `--text-on-accent` |
| `--accent`, `--accent-soft`, `--border`, `--border-strong`, `--warn`, `--danger`, `--ok` | read directly; they are already role names |

The scoped override `--fg-muted: var(--te-fg-muted)` (`style.css:5810`) and the two
`--te-fg-muted` values (`:72`, `:127`) become `--text-muted`. The values already agree:
`#9799a4` dark, `#5d6470` light (`style.css:9`, `:110`). No pixel changes.

`--te-row-hover: var(--bg-elev)` (`:5806`) becomes `--surface-raised` directly.
`--te-radius: 6px` (`:5802`) becomes `--radius-sm`.
`--te-focus-ring: 2px solid var(--accent)` (`:5807`) becomes `--focus-ring`.

### 10.2 Component tokens that stay

These are off the foundation ladder and are named rather than written inline. Each holds
a literal; none aliases another token.

| Token | Value | Shipped source | Use |
|---|---|---|---|
| `--te-cell-min` | `140px` | `style.css:5804` | column minimum |
| `--te-cell-text-max` | `380px` | `style.css:5805` | text measure |
| `--te-cell-pad-block` | `6px` | `style.css:5929` | cell padding, block |
| `--te-cell-pad-inline` | `10px` | `style.css:5929` | cell padding, inline |
| `--te-sep-height` | `20px` | `style.css:5841` | separator height |
| `--te-sep-margin` | `6px` | `style.css:5843` | separator margin |
| `--te-sort-min` | `132px` | `style.css:5891` | select minimum |
| `--te-sort-max` | `190px` | `style.css:5892` | select maximum |
| `--te-sort-label-size` | `.76rem` | `style.css:5885` | visible `Sort` word |
| `--te-sort-size` | `.82rem` | `style.css:5899` | select text |
| `--te-status-size` | `.82rem` | `style.css:8738` | footer status text |
| `--te-status-line` | `1.3` | `style.css:8739` | footer status line |
| `--te-hint-size` | `.78rem` | `style.css:6096` | `Esc cancels` |
| `--te-notice-size` | `.85rem` | `style.css:6115` | notice title |
| `--te-notice-pad-block` | `10px` | `style.css:6104` | notice padding |
| `--te-notice-pad-inline` | `14px` | `style.css:6104` | notice padding |
| `--te-fill-handle` | `8px` | `style.css:6001-6002` | handle box |
| `--te-fill-radius` | `2px` | `style.css:6005` | handle radius |
| `--te-fill-offset` | `-1px` | `style.css:5999-6000` | handle inset |
| `--te-row-grip-w` | `10px` | `style.css:6056` | row grip |
| `--te-row-grip-h` | `20px` | `style.css:6057` | row grip |
| `--te-col-grip-w` | `16px` | `style.css:6063` | column grip |
| `--te-col-grip-h` | `10px` | `style.css:6064` | column grip |
| `--te-grip-opacity` | `.65` | `style.css:6069` | grip reveal |
| `--te-disabled-opacity` | `.4` | `style.css:5874`, `:5908` | disabled tool / select |
| `--te-empty-opacity` | `.45` | `style.css:5968` | empty-cell dot |
| `--te-sel-fill` | dark `rgba(124,156,255,.10)`; light `rgba(47,95,208,.08)` | `style.css:75`, `:128` | range wash and fill preview |

`--te-space-1` (4), `--te-space-3` (8), `--te-space-4` (12) and `--te-space-5` (16) are
`--space-1`, `--space-2`, `--space-3` and `--space-4`. `--te-space-2` (6) is the
separator and select padding above, not a general rung. `--te-tool` (28) is not used
inside this window: the bar overrides `.te-tool` to `--control-h-body` (32)
(`style.css:8707-8723`).

### 10.3 Target rules, in place order

Keep the shipped order. The first `.te-toolbar` block is superseded by the bar block; it
can be deleted when the next change touches this component, with no visual delta.

```css
#table-editor-overlay {
  --te-cell-min: 140px;
  --te-cell-text-max: 380px;
  --te-cell-pad-block: 6px;
  --te-cell-pad-inline: 10px;
  --te-sep-height: 20px;
  --te-sep-margin: 6px;
  --te-sort-min: 132px;
  --te-sort-max: 190px;
  --te-sort-label-size: .76rem;
  --te-sort-size: .82rem;
  --te-status-size: .82rem;
  --te-status-line: 1.3;
  --te-hint-size: .78rem;
  --te-notice-size: .85rem;
  --te-notice-pad-block: 10px;
  --te-notice-pad-inline: 14px;
  --te-fill-handle: 8px;
  --te-fill-radius: 2px;
  --te-fill-offset: -1px;
  --te-row-grip-w: 10px;
  --te-row-grip-h: 20px;
  --te-col-grip-w: 16px;
  --te-col-grip-h: 10px;
  --te-grip-opacity: .65;
  --te-disabled-opacity: .4;
  --te-empty-opacity: .45;
  --te-sel-fill: rgba(124, 156, 255, .10);
}
body[data-theme="light"] #table-editor-overlay {
  --te-sel-fill: rgba(47, 95, 208, .08);
}

.table-editor-modal {
  width: min(1320px, 96vw);
  height: min(85vh, 92vh);
  max-width: 96vw;
  max-height: 92vh;
}
.table-editor-modal .te-body {
  display: flex; flex-direction: column;
  flex: 1 1 auto; min-height: 0; min-width: 0; padding: 0;
}

/* Toolbar: effective values once reparented into the shared bar. */
.edit-bar .te-toolbar {
  display: flex; align-items: center; flex-wrap: nowrap;
  gap: var(--space-1); min-height: 0; padding: 0;
  border: 0; background: transparent; flex: 0 0 auto;
}
.edit-bar .te-toolbar > * { flex: 0 0 auto; }
.edit-bar .te-tool { width: var(--control-h-body); height: var(--control-h-body); }
.edit-bar .te-sort-col { height: var(--control-h-body); }

.table-editor-modal .te-group { display: inline-flex; align-items: center; gap: var(--space-hair); }
.table-editor-modal .te-sep {
  width: var(--stroke-1); height: var(--te-sep-height);
  background: var(--border); margin: 0 var(--te-sep-margin); flex: 0 0 auto;
}
.table-editor-modal .te-tool {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--control-h-body); height: var(--control-h-body);
  padding: 0; border: var(--stroke-1) solid transparent;
  border-radius: var(--radius-sm); background: transparent;
  color: var(--text-muted); font-family: inherit; cursor: pointer;
}
.table-editor-modal .te-tool:hover { background: var(--accent-soft); color: var(--text-primary); }
.table-editor-modal .te-tool:focus-visible { outline: var(--focus-ring); outline-offset: var(--stroke-1); }
.table-editor-modal .te-tool.is-danger:hover { background: var(--danger-soft); color: var(--danger); }
.table-editor-modal .te-tool[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.table-editor-modal .te-tool[aria-disabled="true"] {
  opacity: var(--te-disabled-opacity); cursor: default;
}
.table-editor-modal .te-tool[aria-disabled="true"]:hover { background: transparent; color: var(--text-muted); }
.table-editor-modal .te-tool svg { width: var(--icon-md); height: var(--icon-md); display: block; }

.table-editor-modal .te-sort-label {
  margin: 0 var(--space-1) 0 var(--te-sep-margin);
  font-size: var(--te-sort-label-size); color: var(--text-muted); white-space: nowrap;
}
.table-editor-modal .te-sort-col {
  height: var(--control-h-body);
  min-width: var(--te-sort-min); max-width: var(--te-sort-max);
  padding: 0 var(--te-sep-margin); background: var(--surface-raised);
  color: var(--text-primary); border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-sm); font-family: inherit; font-size: var(--te-sort-size);
  outline: none;
}
.table-editor-modal .te-sort-col:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
.table-editor-modal .te-sort-col[aria-disabled="true"],
.table-editor-modal .te-sort-col[disabled] {
  opacity: var(--te-disabled-opacity); cursor: default;
}

/* Grid. */
.table-editor-modal .te-scroll {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  overscroll-behavior: contain; background: var(--surface-panel);
  padding: 0 var(--space-4) var(--space-3);
}
.table-editor-modal .te-grid {
  border-collapse: separate; border-spacing: 0; min-width: 100%;
}
.table-editor-modal .te-cell {
  position: relative; min-width: var(--te-cell-min);
  padding: var(--te-cell-pad-block) var(--te-cell-pad-inline);
  border-right: var(--stroke-1) solid var(--border);
  border-bottom: var(--stroke-1) solid var(--border);
  font-size: var(--text-ui-lg); line-height: var(--lh-snug); text-align: left;
  font-weight: var(--fw-regular); background: transparent; cursor: cell;
}
.table-editor-modal .te-cell:first-child { border-left: var(--stroke-1) solid var(--border); }
.table-editor-modal .te-cell[align="center"] { text-align: center; }
.table-editor-modal .te-cell[align="right"] { text-align: right; }
.table-editor-modal thead .te-cell {
  position: sticky; top: 0; z-index: 2;
  background: var(--surface-raised); border-top: var(--stroke-1) solid var(--border);
  font-weight: var(--fw-semibold);
}
.table-editor-modal tbody tr:nth-child(even) .te-cell { background: var(--surface-page); }
.table-editor-modal tbody tr:hover .te-cell { background: var(--surface-raised); }
.table-editor-modal .te-cell:focus { outline: none; }
.table-editor-modal .te-grid .te-cell.is-active {
  background-color: var(--accent-soft);
  box-shadow: inset 0 0 0 var(--stroke-2) var(--accent);
  z-index: 1;
}
.table-editor-modal thead .te-cell.is-active { z-index: 3; }
.table-editor-modal .te-cell-text {
  display: block; max-width: var(--te-cell-text-max);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.table-editor-modal .te-cell-text:empty::after {
  content: "\00b7"; color: var(--text-muted); opacity: var(--te-empty-opacity);
}
.table-editor-modal .te-cell[data-sort] .te-cell-text::after {
  content: " \2191"; color: var(--accent); font-weight: var(--fw-semibold);
}
.table-editor-modal .te-cell[data-sort="desc"] .te-cell-text::after { content: " \2193"; }

/* Selection wash and edge. */
.table-editor-modal .te-grid .te-cell.is-selected:not(.is-active) {
  background-image: linear-gradient(var(--te-sel-fill), var(--te-sel-fill));
  box-shadow:
    inset 0 var(--te-sel-t, 0px) 0 0 var(--accent),
    inset 0 var(--te-sel-b, 0px) 0 0 var(--accent),
    inset var(--te-sel-l, 0px) 0 0 0 var(--accent),
    inset var(--te-sel-r, 0px) 0 0 0 var(--accent);
}
.table-editor-modal .te-cell.is-sel-top { --te-sel-t: var(--stroke-1); }
.table-editor-modal .te-cell.is-sel-bottom { --te-sel-b: calc(-1 * var(--stroke-1)); }
.table-editor-modal .te-cell.is-sel-left { --te-sel-l: var(--stroke-1); }
.table-editor-modal .te-cell.is-sel-right { --te-sel-r: calc(-1 * var(--stroke-1)); }

/* Fill handle and preview. The .te-grid keeps the preview wash above the
 * even-row zebra; without it a preview cell on an even row shows only its
 * 1px edge. Exception E2. */
.table-editor-modal .te-fill-handle {
  position: absolute;
  right: var(--te-fill-offset); bottom: var(--te-fill-offset);
  width: var(--te-fill-handle); height: var(--te-fill-handle);
  background: var(--accent);
  border: var(--stroke-1) solid var(--surface-panel);
  border-radius: var(--te-fill-radius);
  cursor: crosshair; touch-action: none; z-index: 4;
}
.table-editor-modal .te-grid .te-cell.is-fill-preview {
  background-image: linear-gradient(var(--te-sel-fill), var(--te-sel-fill));
}
.table-editor-modal .te-grid .te-cell.is-fill-preview:not(.is-selected) {
  box-shadow:
    inset 0 var(--te-sel-t, 0px) 0 0 var(--accent),
    inset 0 var(--te-sel-b, 0px) 0 0 var(--accent),
    inset var(--te-sel-l, 0px) 0 0 0 var(--accent),
    inset var(--te-sel-r, 0px) 0 0 0 var(--accent);
}
.table-editor-modal .te-clip-group .te-tool:active { background: var(--accent-soft); color: var(--accent); }
.table-editor-modal .te-clip-group .te-tool[aria-disabled="true"]:active {
  background: transparent; color: var(--text-muted);
}

.table-editor-modal .te-cell-text[contenteditable="true"] {
  outline: none; cursor: text; caret-color: var(--accent);
}

/* Grips and drop marks. */
.table-editor-modal .te-gap { width: var(--space-1); flex: 0 0 auto; }
.table-editor-modal .te-row-grip,
.table-editor-modal .te-col-grip {
  position: absolute; display: flex; align-items: center; justify-content: center;
  padding: 0; color: var(--text-muted); opacity: 0; cursor: grab; touch-action: none;
}
.table-editor-modal .te-row-grip {
  left: var(--stroke-1); top: 50%;
  width: var(--te-row-grip-w); height: var(--te-row-grip-h);
  transform: translateY(-50%);
}
.table-editor-modal .te-col-grip {
  top: var(--stroke-1); left: 50%;
  width: var(--te-col-grip-w); height: var(--te-col-grip-h);
  transform: translateX(-50%);
}
.table-editor-modal .te-col-grip svg { transform: rotate(90deg); }
.table-editor-modal tr:hover .te-row-grip,
.table-editor-modal thead .te-cell:hover .te-col-grip { opacity: var(--te-grip-opacity); }
.table-editor-modal .te-row-grip:active,
.table-editor-modal .te-col-grip:active { cursor: grabbing; opacity: 1; }
.table-editor-modal tr.is-drop-before > .te-cell { box-shadow: inset 0 var(--stroke-2) 0 var(--accent); }
.table-editor-modal tr.is-drop-after > .te-cell { box-shadow: inset 0 calc(-1 * var(--stroke-2)) 0 var(--accent); }
.table-editor-modal .te-cell.is-drop-left { box-shadow: inset var(--stroke-2) 0 0 var(--accent); }
.table-editor-modal .te-cell.is-drop-right { box-shadow: inset calc(-1 * var(--stroke-2)) 0 0 var(--accent); }
.table-editor-modal .te-cell a { color: var(--accent); pointer-events: none; }
.table-editor-modal .te-grid[aria-readonly="true"] .te-cell { cursor: default; }

/* Footer, status, hint. */
.table-editor-modal .te-footer { align-items: center; }
.table-editor-modal .te-status {
  margin-right: auto; min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--te-status-size); line-height: var(--te-status-line);
  color: var(--text-muted);
}
.table-editor-modal .te-footer > .settings-action { flex: 0 0 auto; }
.table-editor-modal .te-hint {
  margin-left: var(--space-3); color: var(--text-muted); font-size: var(--te-hint-size);
}

/* Merged-cell refusal strip. */
.table-editor-modal .te-notice-strip {
  display: flex; gap: var(--space-2); align-items: flex-start;
  padding: var(--te-notice-pad-block) var(--te-notice-pad-inline); flex: 0 0 auto;
  background: var(--surface-raised); border-bottom: var(--stroke-1) solid var(--border);
}
.table-editor-modal .te-notice-glyph {
  font-size: var(--text-body); line-height: var(--lh-snug); color: var(--warn);
}
.table-editor-modal .te-notice-strip[hidden] { display: none; }
.table-editor-modal .te-notice-strip p {
  margin: 0; font-size: var(--te-notice-size); color: var(--text-primary);
}
.table-editor-modal .te-notice-strip p + p {
  margin-top: var(--space-hair); font-size: var(--text-sm); color: var(--text-muted);
}

@media (max-width: 520px) {
  .table-editor-modal {
    width: 100vw; height: 100vh;
    max-width: 100vw; max-height: 100vh; border-radius: 0;
  }
  .table-editor-modal .te-hint { display: none; }
  /* Exception E1: the phone floor. The three-class selector beats the
   * shared bar's two-class .edit-bar .te-tool rule, which is later in the
   * stylesheet. */
  .table-editor-modal .edit-bar .te-tool {
    width: var(--control-h-touch); height: var(--control-h-touch);
  }
  .table-editor-modal .edit-bar .te-sort-col { height: var(--control-h-touch); }
}
```

The 6 px / 10 px values are the shipped rhythm; they are named as component tokens in
§10.2, not added as new spacing rungs (`foundations.md` §5.1). The 8 px handle, its 2 px
radius and its −1 px inset are the component's own numbers, named in the same table.

### 10.4 Values re-measured for this pass

| Anchor | Verified value | Source |
|---|---|---|
| Window markup | `#table-editor-overlay` after `#export-overlay`, static, `.settings-overlay` | `templates/index.html:1321-1457` |
| Header / bar / footer | 65 / 57 / 69 px; 44 px controls | `style.css:8529-8544` |
| Default box | `min(1320px, 96vw)` × `min(85vh, 92vh)` | `style.css:5812-5817` |
| Tool size in the window | **32 px**, not the 28 px base | `style.css:8719-8722` |
| Toolbar layout | one row, no wrap, scrolls; mask only while overflowing | `style.css:8602-8622`, `:8707-8723` |
| Cell | min 140, padding 6 / 10, `.93rem` / 1.35, 1 px rules | `style.css:5926-5938` |
| Text measure | 380 px | `style.css:5961` |
| Row height | ≈ 31 px body, ≈ 32 px header | computed from `:5929-5947` |
| Wash | `.10` dark / `.08` light | `style.css:75`, `:128` |
| Active cell | `--accent-soft` + 2 px inset accent | `style.css:5953-5958` |
| Fill handle | 8 × 8, 2 px radius, `z-index: 4` | `style.css:5997-6009` |
| Status type | `.82rem` / 1.3 — the shared footer rule wins over `.te-status`'s `.8rem` | `style.css:6083-6091`, `:8731-8740` |
| Phone | full screen at ≤ 520; 44 px actions; the toolbar was 32 px | `style.css:6122-6131`, `:8741-8748` |
| Toolbar width | ≈ 950 px at 32 px tools | `docs/architecture/table-editor.md` §10 |

### 10.5 Exceptions — the only additions

E1 is visual; E2 is a visual consistency repair. E3 and E4 are semantic only: no pixel
changes. None changes the desktop rest state.

**E1 — phone toolbar and select targets are 44 px.** Shipped: `.te-tool` is 32 × 32 and
the select 32 high at every width (`style.css:8719-8723`); the phone rule at `:6122-6131`
changes only the box and the hint. Foundations §10.4 sets 44 px for a coarse pointer.
At ≤ 520 only, the tool and select become `--control-h-touch` (44). The bar is 57 px, so
44 + the 12 px block padding still fits; the tools scroll more. This is the one rest-state visual
delta in the pass. It is drawn on the phone board. The phone rule must use
`.table-editor-modal .edit-bar .te-tool` (three classes), because `.edit-bar .te-tool`
(two classes) is later in the stylesheet at `:8719-8722` and would otherwise win the
source-order tie.

**E2 — the fill-preview wash survives the even-row zebra.** Shipped: the preview rule is
`.table-editor-modal .te-cell.is-fill-preview` (three class selectors, `style.css:6010-6012`),
while the zebra is `tbody tr:nth-child(even) .te-cell` (three classes plus two type
selectors, `style.css:5950`). The zebra wins the `background` shorthand, so a preview cell
on an even row shows its 1 px edge but not its wash. The selection rule does not have the
bug because it includes `.te-grid` (`:5982`). The target adds `.te-grid` to the preview
selector (`§10.3`), which restores the intended wash on every target cell. The delta is
visible only during a fill drag on an even row; nothing changes at rest.

**E3 — a disabled tool's reason is in its accessible name.** Shipped: `setDisabled` writes
the reason into `title` and points `aria-describedby` at the status line, which holds the
active cell's position at rest (`table-editor.js:1390-1405`). A screen reader hears
`Move row up, dimmed` and the position, not the cause. The target appends the reason to
`aria-label` while the control is disabled — `Move row up. The header row can't be moved.` —
and restores the base name on enable. The blocked branch does the same with
`(editing disabled)` and the merged-cell clipboard reason (`:1412-1428`). Native tooltips
are unchanged, and the visible output does not move.

**E4 — the alignment button's accessible name carries its current value.** Shipped:
`syncToolbar` writes `title = "Cycle column alignment (" + cur + ")"` but leaves
`aria-label` at the static base (`table-editor.js:1464-1469`). The target sets both. The
visible glyph, size and position are untouched; this is the semantic half of §12 P3.

### 10.6 What to avoid

- A second selection colour, an opaque fill, a dashed rectangle, a ghost preview cell.
- A second scroller, or making the toolbar sticky inside the body.
- A custom sort listbox or a second sort dialog.
- Column resize, a sticky first column, zebra-striped headers.
- `filter: brightness()` as a state; a new shadow, radius, spacing rung or z-index.
- A native `disabled` on a toolbar tool in the editable state; it would lose the reason
  and the tab stop.
- Emoji as chrome; the notice's `⚠` is the last one and is P1.

---

## 11. Acceptance criteria

Each is testable and names the file and the observable result.

| # | Criterion | Where | Observable |
|---|---|---|---|
| AC1 | Two entries open the same window; preview has none | `hybrid.js`, `table-edit.js` | A right-click inside a table shows `Edit table…`; a table hover/focus shows the 24 px gutter button; both open the modal titled **Edit table**. In preview, neither exists. `tests/dom/test_dom.js:12422-12431`; `tests/browser/test_table_editor_browser.js:173-196` |
| AC2 | Opening focuses cell (0,0); a blocked table focuses Cancel | `table-editor.js` | The first header cell has the 2 px ring and `tabindex="0"`; the status is `Header row · Column 1 of N`. A merged table focuses `#table-editor-cancel`. `tests/browser/test_table_editor_browser.js:196` |
| AC3 | The grid shows one header row and one row per body row, same text | `table-editor.js` | `aria-rowcount` / `aria-colcount` match; the header is `<th role="columnheader" scope="col">`; body cells are `<td role="gridcell">`. `tests/dom/test_dom.js:12355-12360` |
| AC4 | Cell geometry is the shipped grid | `style.css` | A cell measures min 140 px, padding 6/10, 1 px right/bottom rules; the header is sticky, `--surface-raised`, 600; even body rows are `--surface-page`. Check the computed styles in a browser; jsdom has no layout. |
| AC5 | Navigate and edit keys follow §3.3 and §8 | `table-editor.js` | Arrow moves; Shift+Arrow extends; Tab stops at the row edge; Enter edits/commits down; F2 toggles; a printable key starts at the end; Esc collapses first, then cancels. `tests/dom/test_dom.js:11930-12190`; `tests/browser/test_table_editor_browser.js:323-430` |
| AC6 | A drag paints a rectangle, announces once, and keeps the active ring | `table-editor.js` | 2 × 2 drag gives `.is-selected` on four cells, `aria-selected` on all cells, the active cell still `.is-active`, status `2 × 2 selected, rows 2–3, columns 1–2`. `tests/browser/test_table_editor_browser.js:592-611` |
| AC7 | Copy writes TSV + HTML; paste grows down/right only | `table-editor.js` | `text/plain` has tabs and no trailing newline; `text/html` has `<thead><th>` when row 0 is included; a block pastes once; the grid grows only at the bottom/right. `tests/browser/test_table_editor_browser.js:641-670`; `tests/dom/test_dom.js:11700-11730` |
| AC8 | Fill handle continues an even numeric run and repeats anything else | `table-editor.js` | `1,2,3,4` filled three down gives `5,6,7`; text repeats cyclically; the extended block stays selected; status `Filled N cells`. `tests/browser/test_table_editor_browser.js:687-730`; `tests/dom/test_dom.js:11760-11800` |
| AC9 | The toolbar is the six groups in shipped order inside the bar | `index.html` | Rows, Columns, Clipboard, Column alignment, Sort, Table; 20 tools and the select; the toolbar is a child of `.edit-bar-actions`, not `.te-body`. `tests/dom/test_dom.js:12341-12349` |
| AC10 | Disabled tools keep focus, name the cause (E3), and write it on activation | `table-editor.js` | `aria-disabled="true"`, the reason in `aria-label` and `title`, `aria-describedby` to the status, hover suppressed; clicking Move up on the header writes `The header row can't be moved.` `tests/dom/test_dom.js:11531`, `:11555` |
| AC11 | Sort is body-only, stable, numeric-aware, empty-last, and marks the header | `table-editor.js` | Header stays row 0; `aria-sort` + `data-sort` on the sorted header; equal keys keep order; empty cells last both ways. `tests/dom/test_dom.js:11430-11520` |
| AC12 | Alignment cycles left → center → right; the current value is exposed (E4) | `table-editor.js` | Three activations return to left; every cell of the column carries the new `align`; the button's `aria-label` and `title` name the current value; Apply writes `:--`, `:-:`, `--:`. `tests/dom/test_dom.js:12220-12270` |
| AC13 | Transpose resets alignment; Delete table is one note step | `table-editor.js` | `new[r][c] = old[c][r]`; status `Transposed: N columns × M rows`; Delete table removes the node, closes, and one note undo restores it. `tests/dom/test_dom.js:12564-12570` |
| AC14 | A merged-cell table opens refused and writes nothing | `table-editor.js`, `style.css` | Notice visible; every tool `aria-disabled`; clipboard reason; grid `aria-readonly`; no cell tab stop, no selection; Apply hidden + disabled; Cancel closes. `tests/dom/test_dom.js:11824-11840`; `tests/browser/test_table_editor_browser.js:59-60` |
| AC15 | History is stack, 100 / 4 M / 350 ms; one step per action | `edit-window.js`, `table-editor.js` | Clean open has both buttons disabled; the first character enables Undo; a typing burst is one step; a structural verb is one step; a duplicate snapshot adds none; undo to the opening state makes Apply a no-op while that snapshot is still in the 100-step stack; past the cap the oldest is gone. `tests/dom/test_dom.js:12734+`, `:13361-13385`; `tests/browser/test_table_editor_browser.js:67-83` |
| AC16 | Apply follows §7.1 exactly | `table-editor.js` | DOM replace, then `onContentChange`, then close and table focus; one note undo restores the previous table and a second does not re-apply. `tests/browser/test_table_editor_browser.js:413-433`; `tests/dom/test_dom.js:12539-12550` |
| AC17 | Cancel writes nothing and keeps an existing dirty mark | `table-editor.js` | Cancel / Esc / × / backdrop all close; the source node and the markdown are unchanged; a dirty note stays dirty. `tests/dom/test_dom.js:12515` |
| AC18 | Roles, names and the live region are complete | `index.html`, `table-editor.js` | `role="grid"` + label + counts; header cells `columnheader`; body cells `gridcell`; `aria-selected` on every cell; status `role="status" aria-live="polite" aria-atomic="true"`; every control has a name. `tests/dom/test_dom.js:12305-12350` |
| AC19 | Responsive: 1280 fits, 861–1000 scrolls with the fade, 720 wraps the footer, a fresh 520 window is full screen, phone tools are 44 | `style.css` | The fade class matches `scrollWidth > clientWidth`; at 720 the status is on its own row; fresh at 520 the hint is hidden; at 390 every tool is 44 × 44. `tests/browser/test_table_editor_browser.js:246-292`; manual at 390 |
| AC20 | No new colour, font, dependency, build step or breakpoint | `style.css`, `templates` | The diff adds no hex outside the two `--te-sel-fill` theme values; the only new query is the existing 520 block; the page opens offline. `docs/ui/table-editor-mockup.html` |
| AC21 | The mockup is self-contained and shows every board in §9 | `docs/ui/table-editor-mockup.html` | Opening it offline shows the dark boards and the light repeats with zero network requests |

---

## 12. Proposals, not applied

Visual changes. None is part of the target; each would need its own pass and its own
test update.

| # | Proposal | Why | Cost / risk |
|---|---|---|---|
| P1 | Replace the notice's `⚠` with a 16-grid sprite symbol (`nb-icon-warning`) | Foundations §9.3: chrome glyphs are SVG, not characters. The word is already the message, so the glyph is decorative. | Visual only; the notice text and role stay. Needs a new symbol in `templates/index.html:51-109`. |
| P2 | Rotate the sort direction glyph 180° when descending, or swap to a down arrow | The shipped button always shows an up arrow; its title says `Sort descending` in that state (`index.html:1424`; `table-editor.js:1456-1459`). An up arrow labelled descending is contradictory. | Visual; one transform rule + a `data-dir` attribute. Keep one glyph so the icon box never changes. |
| P3 | Give the alignment button a visible state (three glyph variants or a small letter) | The archived design promised "the button glyph shows the current value"; the shipped glyph is fixed and only the title/status carry it (`table-editor.js:1464-1469`). E4 already puts the value in the accessible name. | Visual; three 16-grid variants or a `data-align` transform. No model change. |
| P4 | Give failure messages an error treatment: `--danger` text and a warn icon, or a second assertive live region | `The saved state could not be restored` currently looks identical to `Row 2 of 4` (`style.css:6083-6091`, `:8731-8740`). Status is never colour alone, so keep the word too. | Visual + ARIA; do not recolour ordinary position messages. |
| P5 | On the phone, raise the cell text to 16 px while editing | iOS zooms the viewport when a contenteditable under 16 px receives focus (`foundations.md` §4.4; `style.css:5932`). | Visual; the phone grid grows. It changes every cell's line height and the reading of the table. |
| P6 | Make Delete row / Delete column and the direction toggle's enablement match the action | The buttons are enabled from the active cell only; a multi-row selection that would empty the body refuses on click (`table-editor.js:1352-1382`, `:1662-1719`). The direction toggle is enabled with no column chosen (`:1852-1860`). | Behavioural, no pixel; needs the enablement predicates to read the selection and the select value. Update the tests that assert the current disabled set. |
| P7 | Give the fill handle a larger transparent hit area on touch | The handle is 8 × 8 and is the only fill path on touch; `Ctrl+D` has no touch equivalent (`style.css:5997-6009`; `table-editor.js:1213-1223`). | No visual change if the hit area is a pseudo-element; risk of stealing taps from the neighbour cell. Needs a real-device check. |
| P8 | Draw the selection as one outline around the rectangle instead of a 1 px edge on every cell | The shipped 1 px edge on every outside cell keeps the internal grid lines visible (`style.css:5984-5993`). An outline-only rectangle would read calmer. | Visual; rejected for now because the user likes the current wash. |
| P9 | Make a long-press released without movement leave the cell selected and not enter text edit | Product AC25 asks for that; the shipped release path treats any press-and-release in one cell as an edit, including a held press (`table-editor.js:1314-1321`). | Behavioural, no pixel; one branch in `onGridPointerUp` keyed on `p.started`. Needs a touch test. |
| P10 | Hide the fill handle while a cell is in text edit | The handle is placed by `paintSelection`, which `startEdit` calls, and is never removed until commit (`table-editor.js:347-355`, `:134-145`). It sits on the corner of the cell being typed in. The archive promised it would be hidden. | Visual; one predicate in `updateFillHandle` (`!editing`). No model change. |
| P11 | Let Escape cancel a live fill drag even when the source is multi-cell | The grid's capture keydown collapses a multi-cell range and stops the event before the overlay's Escape handler runs; `fill` is left set and the pointer capture keeps the drag alive (`table-editor.js:506-514`, `:583-596`). | Behavioural, no pixel; check `fill` before the collapse branch, or move the fill cancel to the capture handler. Needs a pointer test. |
| P12 | Let Escape drop a grip drag before it collapses a range or closes the window | The overlay's Escape branch knows `fill`, not `drag`; with a single-cell selection it closes the window, and with a multi-cell selection the grid's capture handler collapses the range first (`table-editor.js:506-514`, `:583-596`). The archive promised Escape would drop the drag. | Behavioural, no pixel; add `drag` beside `fill` in both handlers and clear the drop marks. Needs a pointer test. |

---

## 13. What not to build

- **No column resize, no row height control, no freeze panes, no sticky first column.**
  The grid is a table, not a spreadsheet.
- **No formulas, number formatting, aggregates, CSV import or delimiter guessing.**
  The model is cell HTML; a formula engine is a different product
  (`docs/product/table-editor-selection.md` §2).
- **No second table in one window, no multi-table selection, no persistence of the
  window, the selection or the history.**
- **No second sort UI.** One native select and one direction toggle; no per-header menu,
  no second dialog, no custom listbox.
- **No confirmation on Transpose or Delete table.** Cancel and the note-level undo are
  the safety net.
- **No drag-to-move a multi-cell selection; no auto-scroll at the pane edge.** Shift+click
  after scrolling is the reach.
- **No paste tiling.** A multi-cell block is written once, never repeated to fill a larger
  target; only a 1 × 1 block broadcasts.
- **No merge or unmerge.** GFM cannot express spans; the blocked state is the answer.
- **No rich text beyond the inline subset** (`strong`, `em`, `code`, `a`). Block markup,
  colours, styles, scripts and nested tables are flattened to text.
- **No second scroller, no sticky toolbar inside the body, no wrap on the toolbar.** The
  bar scrolls with a mask; the body scrolls; nothing else does.
- **No new colour, font, shadow, radius, spacing rung, z-index, breakpoint or dependency.**
- **No custom tooltip.** `aria-label` + native `title` are the contract.
- **No toast per operation.** The status line is the one live region.
- **No emoji in the toolbar.** The notice's `⚠` is P1, not a precedent.
- **No `disabled` on a toolbar tool in the editable state.** It must stay focusable and
  explain itself.
