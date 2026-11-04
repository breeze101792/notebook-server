# Table Editor (hybrid mode)

Status: shipped (table editor), design record. Handoff for the modal
spreadsheet editor defined in `docs/product/table-editor.md` and
`docs/architecture/table-editor.md`; the modal is `static/js/table-editor.js`
with its markup in `templates/index.html`. Mockup: `docs/design/table-editor.html`.
Every value is an existing app token except the `--te-*` values in §8; no new
font, dependency, colour family, or animation.

## 1. Scope

| | |
| --- | --- |
| Trigger | Two entries, both hybrid-only: the right-click menu's top-level **Edit table…** item (shown only inside a table), and the active table's overlay **Edit table** control in the left gutter. |
| Binds to | the table under the caret, or the table whose overlay control was used. |
| Apply | replaces that table with one GFM table, as **one** undo step; if nothing changed it writes nothing and adds no undo entry. |
| Cancel | discards the working copy. Header `×`, Esc, and footer Cancel are one action; none of them writes. |
| Selection | A rectangular range with copy/cut/paste/clear, designed in [`table-editor-selection.md`](table-editor-selection.md). |
| Excluded | formulas, CSV import, column resize, state persistence, rich-text beyond inline bold/italic/code/link. |
| Merged cells | `colspan`/`rowspan` cannot be expressed in GFM → **blocked state** (§6). |

## 2. Shell

`#table-editor-overlay` reuses the app shell:
`.settings-overlay > .settings-modal.table-editor-modal[role="dialog"][aria-modal="true"]`
→ `.settings-header` (h2 "Edit table" + `.icon-btn` ×) → `.te-body` →
`.settings-footer`. `NB.dialog.open()` owns containment and focus restore (the
opener regains focus on close); `NB.windows` supplies drag/resize/maximize.

| Property | Value |
| --- | --- |
| Default size | `min(960px, 94vw)` × `min(640px, 88vh)` |
| Chrome | inherited: 12px radius, `--border`, `0 20px 60px rgba(0,0,0,.5)` |
| Zones | header · toolbar · `.te-scroll` (the only scroller) · footer |
| Footer | `.te-status` (left, `margin-right:auto`) · `.te-hint` "Esc cancels" (hidden ≤520px) · Cancel · Apply (`.settings-action--primary`) |

`.te-body { display:flex; flex-direction:column; flex:1 1 auto; min-height:0 }`.
The toolbar sits above the scroller, so it never scrolls and needs no `position:
sticky`; the table's header row is the sticky one.

## 3. Grid

Real `<table id="table-editor-grid" class="te-grid" role="grid">`: row 0 is
`<thead>`/`<th>` (`role="columnheader"`), body rows are `<td>`
(`role="gridcell"`). A cell holds its **rendered inline HTML** (`strong`, `em`,
`code`, `a`) in `.te-cell-text`, never Markdown source; links inside cells never
navigate (a click activates the cell). Ragged rows are padded with empty cells.

| Part | Spec |
| --- | --- |
| Cell box | padding 6px 10px; 1px `--border` right + bottom, outer border on the table |
| Width | table fills the pane (`min-width:100%`); column min 140px, text wraps at 380px (`pre-wrap`), so a wide table scrolls rather than squashes |
| Header row | `--bg-elev`, 600 weight, `--fg`, sticky `top:0`, `z-index:2`, always visible |
| Body rows | transparent; even rows `--bg` (the app's zebra, inverted for a panel surface) |
| Row hover | `tr:hover` cells → `--bg-elev` |
| Active cell | `--accent-soft` fill + `inset 0 0 0 2px --accent`; the ring sits inside the cell and never overlaps a neighbour |
| Editing cell | the cell **is** the edit surface: `.te-cell-text` becomes `contenteditable` in place, same box, `caret-color: --accent`; nothing overlays, so the column cannot jump |
| Empty cell | `.te-cell-text:empty::after { content:"·"; opacity:.45 }` — display only, never serialized |
| Row grip | a 10×20 dotted handle in the first cell's left padding, `.65` opacity while its row is hovered, `cursor: grab` |
| Column grip | a 16×10 handle rotated 90° in each header cell's top padding, visible while that cell is hovered |
| Drop marker | the landing edge gets a 2px `--accent` inset line: `inset 0 2px` (before), `inset 0 -2px` (after), `inset 2px 0` (left), `inset -2px 0` (right) |
| Scrolling | `.te-scroll { overflow:auto; overscroll-behavior:contain }`; a cell move calls `scrollIntoView({block:"nearest", inline:"nearest"})` |

## 4. Toolbar

One row of 28px-high controls, `flex-wrap: wrap`, groups split by a 1px × 18px
`--border` rule. Icon-only: 16px SVG (`aria-hidden`) + `aria-label` + `title`.

| Group | Controls |
| --- | --- |
| Row ops | Move up · Move down · Insert above · Insert below · Add at the end · Delete row |
| Column ops | Move left · Move right · Insert left · Insert right · Add at the end · Delete column |
| Data ops | Cycle column alignment · **Sort** label + column `<select>` + direction toggle · Transpose (pushed right by `.te-spacer`) · Delete table (danger) |

Inside a group, Move and Insert sit above a narrow `.te-gap`; the plain + / − glyphs stay the append/delete pair.

States: default `--fg-muted`; hover `--accent-soft` + `--fg`; focus-visible 2px
`--accent` at 1px offset; `aria-pressed` `--accent-soft`/`--accent`; destructive
hover `--danger-soft`/`--danger`, as `.te-tool.is-danger`. Alignment cycles the focused
column left → centre → right (`:--` / `:-:` / `--:`) and the button glyph shows
the current value. Apply and Cancel are always enabled in the editable state.

| Control | Disabled when | Reason |
| --- | --- | --- |
| Move row up | focused row is the header, or it is the first body row | "The header row can't be moved." / "This is already the first body row." |
| Move row down | focused row is the header, or it is the last body row | "The header row can't be moved." / "This is already the last body row." |
| Insert row above | focused row is the header | "No row can be inserted above the header." |
| Delete row | focused row is the header, or it is the last body row | "The header row can't be deleted." / "A table needs at least one body row." |
| Move column left / right | the first / the last column | "This is already the first column." / "This is already the last column." |
| Delete column | one column left | "A table needs at least one column." |
| Sort column / direction | fewer than 2 body rows | "Nothing to sort." |
| Transpose, Delete table | never | — |

Disabled uses `aria-disabled="true"`, **not** `disabled`: it stays focusable,
`title` gives the reason, `aria-describedby` points at the status line, and
activating it writes the reason there. Visual: opacity .4, hover suppressed.

## 5. Sort

No second modal and no per-header menu — the header is an editable cell, so
per-cell chrome would fight editing. The toolbar owns it: pick a column in the
compact `<select>` ("Sort by…", then one entry per column labelled with its
header text, falling back to "Column N"); the `↑`/`↓` toggle flips the direction.
Picking sorts immediately in the current direction (ascending first); the toggle
re-sorts the same column.

A cell is numeric when its trimmed text parses as a finite number; two numeric
cells compare numerically, any other pair compares as text with
`Intl.Collator(undefined, {numeric:true, sensitivity:"base"})`. Empty cells sort
last either way; the sort is explicit-stable. Only body rows move. The sorted
header gets `aria-sort` plus a `--accent` caret drawn by CSS (`data-sort`),
never part of the value. Rebuild the options on column add, delete, or rename.

## 6. Transpose and the blocked state

**Move and drag.** Move row/column is a button and a grip; both splice the
working model and never touch the note before Apply. A drag marks the edge it
will land on and commits on pointerup; Escape and pointercancel drop it. The
grips are pointer-only (`aria-hidden`, no tab stop) so the toolbar stays the
single accessible path.

**Transpose** runs immediately, no confirmation: content-wise it is its own
inverse, and Cancel drops the session. The old header row becomes the first body
row and the old first column becomes the new header row; **every column
alignment resets to left** (say so in the button title). Announce "Transposed:
4 columns × 3 rows".

**Blocked state** (merged cells). The modal still opens, bound to the table, so
the user can see what they tried to edit:

- A notice strip under the header, above the disabled toolbar, `role="status"`:
  warn glyph, title "This table has merged cells and cannot be edited here",
  copy "GFM can't represent merged cells. Edit the Markdown source instead."
- The toolbar is rendered with every control `aria-disabled="true"`.
- The grid renders read-only: `aria-readonly="true"`, no cell `tabindex`, no
  active ring, `cursor: default`.
- The footer has **Cancel only** — no Apply, no working write path.
- Focus moves to Cancel on open, so the refusal is announced once.

## 7. Keyboard and focus

Two states: **navigate** (cell focused, ring visible, not editable) and **edit**
(`.te-cell-text` is contenteditable and holds the caret). Opening focuses cell
(0,0) in navigate mode.

| Key | Navigate | Edit |
| --- | --- | --- |
| Click | — | activates on `mousedown` and edits, caret where clicked |
| Arrows | move one cell, clamped at the edges | move the caret (native) |
| Tab / Shift+Tab | move right / left, no edit, stopping at the row edge; at the grid's last cell Tab leaves to Cancel, at the first Shift+Tab leaves to the toolbar | commit, move right / left; the new cell is in navigate |
| Enter | start editing, caret at the end of the value | commit, move down, stopping at the last row |
| F2 | start editing, caret at the end | — |
| Printable char | starts editing at the **end** of the existing value and inserts the char — it never wipes the cell | types at the caret |
| Esc | Cancel the modal | Cancel the modal |
| Blur (toolbar click) | — | commits |

Esc is always Cancel, even mid-typing: there is no per-cell revert, because
Cancel drops the session and Apply lands as one undoable edit. Roving tabindex:
cells `-1`, active cell `0`.

## 8. Tokens and classes

```css
#table-editor-overlay {
  --te-space-1: 4px; --te-space-2: 6px; --te-space-3: 8px;
  --te-space-4: 12px; --te-space-5: 16px;
  --te-radius: 6px; --te-tool: 28px;
  --te-focus-ring: 2px solid var(--accent);
  --te-cell-min-w: 140px; --te-cell-max-w: 380px;
  --te-row-hover: var(--bg-elev);
  --fg-muted: #9799a4;      /* 4.26:1 -> >4.5:1 on --bg-elev, as in Settings */
}
body[data-theme="light"] #table-editor-overlay {
  --fg-muted: #5d6470;
}
```

`.te-body` · `.te-toolbar` · `.te-group` · `.te-sep` · `.te-spacer` · `.te-tool`
(+`.is-danger`) · `.te-sort-label` · `.te-sort-col` · `.te-scroll` · `.te-grid` ·
`.te-cell` (+`.is-active`) · `.te-cell-text`
(`[contenteditable]`) · `.te-status` · `.te-hint` · `.te-notice-strip`, all
under `.table-editor-modal`.

## 9. Accessibility and responsive

- `role="grid"` + `aria-label`, `aria-rowcount`/`aria-colcount`, `aria-readonly`
  in the blocked state, `aria-sort` on the sorted header, `aria-pressed` on the
  direction toggle.
- `.te-status` is the one polite live region: moves ("Row 2 of 5 · Column 3 of
  4"), adds/deletes, sort results, and every refused action.
- Never colour-only: active = 2px ring, sorted = `aria-sort` + caret, disabled =
  opacity + `aria-disabled` + a spoken reason.
- ≥ ~940px viewport: one toolbar row (the clipboard group costs 127px; the
  toolbar needs about 880px of modal width). 861–~940px: Transpose and Delete
  table alone on row 2; below ~860px Sort joins them, then Alignment, then the
  clipboard group leads row 2, and under ~500px Rows and Columns keep row 1.
  See [`table-editor-selection.md`](table-editor-selection.md) §8.
- ≥861px: 960×640. 521–860px: `min(94vw, 720px)`. ≤520px:
  fills the viewport, toolbar wraps to two rows (sort on its own line). Padding
  stays 12–14px; only `.te-scroll` scrolls. No motion.

## 10. Avoid

Column resizing, column hover highlighting, a
transpose confirmation, a second dialog for sort, zebra-striped headers, a sticky
first column, persisting the empty-cell dot, editing cells as Markdown source,
and any colour outside §8.
