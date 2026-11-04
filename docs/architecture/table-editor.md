# Table editor modal (hybrid mode) — implementation blueprint

Status: implemented (`static/js/table-editor.js`). The original blueprint: a
modal spreadsheet-style editor for one GFM table in hybrid (WYSIWYG) mode.
One new file (`static/js/table-editor.js`) plus small edits. No frameworks,
no new deps.

```mermaid
flow LR
  A[table-edit.js<br/>overlay ▦ button] --> M[NB.tableEditor.open table]
  B[hybrid.js Table submenu<br/>Edit as spreadsheet...] --> M
  M --> S[snapshot model<br/>cells html+align, pad ragged]
  S --> G[#table-editor-grid<br/>contenteditable cells]
  G -->|Apply| R[rebuild table DOM]
  R --> F[flushPendingSnapshot]
  F --> W[replaceWith in #viewer-content]
  W --> C[onContentChange]
  G -->|Cancel / Esc / no-op Apply| X[close, nothing written]
```

## 1. Module and public surface

`static/js/table-editor.js`, IIFE, `NB.tableEditor`:

- `open(table)` → `true` when the modal opened, including the merged-cell
  refusal (the modal is shown read-only). Returns `false` when it cannot open:
  not in hybrid (`NB.hybrid.isActive()`), the table is not in
  `#viewer-content`, or it has no rows.
- Model verbs behind the toolbar and the drag path: `moveRowTo(from, dest)`,
  `moveColTo(from, dest)`, `insertRowAt(index)`, `insertColAt(index)`, and
  `_deleteTable()`. They are exported for the DOM suite, which has no layout
  engine and cannot drive a real pointer drag.
- `isBlocked()` — true while an opened table is in the merged-cell read-only
  state.
- `close()` — Cancel semantics: discard the model, hide the overlay,
  `NB.dialog.close`. Idempotent.
- `isOpen()` — the guards/dialog pattern (`mermaid-designer.js`).
- Test hooks: `getState()` (the live model, §2), `rebuildTable()` (the built
  `<table>` before any apply, so jsdom can assert structure without mutating),
  `_apply()`, `_cancel()`, and `overlayEl()`.

Callers deref `NB.tableEditor` lazily inside handlers (the `designMod` pattern,
`hybrid.js`), so load order cannot break either side.

## 2. Data model

Snapshot taken in `open()` from the live table (post-`flattenTheads` shape:
rows directly in one `<tbody>`, row 0 = header):

```js
state = {
  cols: maxRowCellCount,          // rows may be ragged (pasted HTML)
  rows: [ { cells: [ { html, align } ] } ],   // row 0 = header
  changed: false,                 // set by any grid mutation
}
```

- `html` = `cell.innerHTML` **verbatim** — bold/links/code/checkboxes survive
  Apply untouched because the rebuilt cell holds the same nodes-as-HTML the
  live surface holds. Round-trip behavior is then identical to editing the
  cell in place; `normalizeTablesForGfm` (`hybrid.js`) keeps handling
  in-cell `<br>` exactly as the main surface does.
- `align` = the cell's `align` attribute or `null`, stored **per cell**. The
  model keeps the source spelling; `rebuildTable()` writes the editor's
  alignment state instead, so a column whose delimiter was a plain `---`
  (read as left) is written `:--` once the table is edited (product AC7).
  The no-op check compares a source-faithful build
  (`rebuildTable({canonicalAlign:false})`), so an untouched table and an
  add-then-delete cycle are never rewritten. `cycleColAlign` marks every
  cell of a column (`hybrid.js`), and so does the modal's align action.
- Ragged rows: padded at snapshot time with `{html:"", align:null}`
  so the grid is rectangular. Padding alone never sets `changed` — a no-op
  Apply writes nothing (invariant I3). The first *real* edit normalizes the
  ragged shape as a side effect; document this in the module header.
- Empty cells keep `""`. Cells created *inside the modal* (add row/column)
  get `"&nbsp;"` — the `insertRow`/`insertCol` convention (`hybrid.js`),
  so a caret fits when the user later edits them on the live surface.

## 3. Modal markup and containment

**Static in `templates/index.html`**, after `#export-overlay` (id
`table-editor-overlay`, class `settings-overlay`, direct body child), inner
`.settings-modal.table-editor-modal[role="dialog"][aria-modal]` with
`.settings-header` (h2 + ×), `.settings-body` (toolbar + `#table-editor-grid`
scroll host), `.settings-footer` (Cancel, Apply). Static, not module-built,
because: all five existing modals are static; `windows.js` wires at boot and
persists geometry per overlay id; and the keyboard guards in `shortcuts.js`,
`vimnav.js`, `table-select.js` match `body > .settings-overlay:not([hidden])`
(`shortcuts.js`) — the class buys drag/resize, Esc-guards, and focus
containment for free. Only the **grid** is rebuilt per open by the module.

- Open: `overlay.hidden = false; NB.dialog.open(overlay, { fallbackFocus:
  first header cell })` — dialog.js inerts every other body child, including
  `#viewer`, so the contenteditable surface cannot be touched while the modal
  is up. `fallbackFocus` matters on the context-menu path, where the invoker
  (the dying menu item) is unusable at close time (`dialog.js`).
- Close: `overlay.hidden = true; NB.dialog.close(overlay)` — focus returns to
  the ▦ overlay button (its node survives). Own Esc/backdrop/× wiring, per
  the dialog.js contract.

## 4. Grid

CSS grid of `contenteditable="true"` cell divs (browser-native rich editing —
no new rich-text code). Cell `innerHTML` = model `html`. Per-cell keydown:
`Enter` → commit + focus the cell below; `Tab` → next cell (wrap); everything
else native. Any `input` event sets `changed` and writes the cell's
`innerHTML` back into the model. Header row cells are editable like body
cells (GFM headers are data).

Toolbar (buttons over `#table-editor-grid`), grouped: **Rows** move up /
move down, insert above / below, add at the end, delete; **Columns** the same
four verbs left/right; **align cycle** (order left→center→right, mirroring
`cycleColAlign`); **sort**; **transpose**; **delete table**. Move and insert
are model splices (`moveRowTo`, `insertRowAt`); the header is pinned at index
0, so move-up and insert-above are refused there with a stated cause. Delete
table is the apply path with the node removed instead of replaced.

**Drag reordering.** `renderGrid()` appends a `.te-row-grip` to each body
row's first cell and a `.te-col-grip` to every header cell, as siblings of
`.te-cell-text` (never inside it), so the model never sees them. A pointer
drag reads the cell under the pointer with `elementFromPoint`, marks the
landing edge (`.is-drop-before/after/left/right`) and splices once on
pointerup. The grips are `aria-hidden` and out of the tab order: the Move
buttons are the accessible path.

## 5. Apply path (ordering is load-bearing)

```
apply():
  if (!viewerContentEl.contains(original)) return close();      // target moved (watcher refresh)
  const t = rebuildTable();               // cloneNode(false) of original + one <tbody> + rows
  if (!state.changed ||
      sameTable(rebuildTable({canonicalAlign: false}), original))
    return close();                       // no-op / add-then-delete: nothing written
  NB.hybrid.flushPendingSnapshot();       // pre-edit state = its own undo step (moveRow rule, hybrid.js)
  original.replaceWith(t);
  NB.hybrid.onContentChange();            // dirty + autosave + the one debounced snapshot
  close();
```

`rebuildTable()`: shallow-clone the original table (keeps its attributes),
append **one `<tbody>`** with all rows as direct children (the live
post-`flattenTheads` shape, `hybrid.js`). The element is chosen by row
position — row 0 is `th`, every body row is `td` — because GFM always treats
the first row as the header; no per-cell tag is stored. `align` is emitted from
the editor's alignment state (`:--` for a header cell whose source column was
plain, §2). Never emit `thead` — `normalizeTablesForGfm`
rebuilds it in the clone at save time. One undo step: flush-before-mutate is
the established contract (`moveRow`, `mermaid-designer.js`); `undo()`
flushes the pending timer first (`hybrid.js`), so Ctrl+Z is correct even
inside the 400 ms coalesce window.

## 5b. Selection and clipboard

The model keeps two corners: `anchorRow/anchorCol` (fixed) and
`activeRow/activeCol` (the focus, which owns the ring and the DOM focus). The
rectangle is their bounding box; `isMulti()` is true when it exceeds one cell.
Every existing verb keeps addressing the focus cell.

- **Paint** — `paintSelection()` toggles `.is-selected`, the four
  `.is-sel-*` edge classes, and `aria-selected` on every cell. The grid carries
  `aria-multiselectable` only in the editable state; cells carry
  `aria-rowindex`/`aria-colindex` (1-based, header = 1). The blocked state has
  none of these and no ring.
- **Pointer** — `pointerdown` on a cell records a press (row, col, point,
  modifier); `pointermove` past `DRAG_SLOP` retargets the focus through
  `elementFromPoint`; `pointerup` on the same cell starts text edit at the
  release point, anywhere else keeps the range. Shift keeps the anchor. A touch
  press waits `LONG_PRESS_MS` before it paints; a short tap edits.
- **Keyboard** (navigate mode only) — Shift+arrows/Home/End extend, bare arrows
  collapse then move, Ctrl+A / Ctrl+Space / Shift+Space select grid/column/row,
  Delete/Backspace clear, Esc collapses a range before the overlay's Esc
  cancels, F2 toggles out of text edit.
- **Clipboard** — native `copy`/`cut`/`paste` events on the grid carry
  `text/plain` TSV and a sanitized `text/html` table; `sanitizeInline()` reduces
  pasted HTML to `strong/b`, `em/i`, `code`, `a[href]`, unwraps block markup and
  drops script/style with their text. `parseClipboard()` prefers an HTML table,
  then TSV, then a single line. `pasteBlock()` writes once, grows rows at the
  bottom and columns at the right only, broadcasts a 1 × 1 block over the whole
  target, never tiles a larger block, and marks `changed` only when a cell's
  HTML actually differs.
- **Selection-aware delete** — Delete row/column remove every body row or
  column the rectangle touches, refuse at the one-row/one-column minimum, and
  report the count. Structural verbs collapse the range; clipboard verbs keep
  it (`finishStructure(true)`).
- **Fill** — `paintSelection()` also places one `.te-fill-handle` in the
  last selected cell. Dragging it (`fill` state) extends the rectangle down or
  right to the cell under the pointer, previews the target with
  `.is-fill-preview`, and on release calls `fillRect(src, target)`. `fillRect`
  grows the grid at the bottom/right, then per column (or row) continues the
  source with `extendSeries`: an even numeric run keeps its step and the source's
  decimal places (`1,2,3,4` → `5,6,7`), anything else repeats the block
  cyclically. Ctrl/Cmd+D calls the same function with the selection's first row
  as the source. One pass, one repaint, `changed` only when a cell's HTML
  differs. Escape and pointercancel drop the drag.
- **Toolbar** — a `.te-clip-group` (Cut, Copy, Paste, Clear) between Columns and
  Alignment. The async clipboard is used when available; otherwise Copy writes
  text only and Paste says "Press Ctrl+V to paste". In the blocked state the
  four stay focusable, `aria-disabled`, and explain the refusal in the status
  line.

## 6. Transpose and sort

- **Transpose**: `new[r][c] = old[c][r]` over the padded rectangle — old
  column 0 (header cell + body cells) becomes the new header row; the new
  row 0 is emitted as `th` because GFM pins the first row as the header.
  Per-column alignment is destroyed by construction, so reset
  every `align` to `null` and say so in the toolbar title.
- **Sort**: `<select>` of columns (label `Col N — <header text>`), direction
  toggle asc/desc, applied on change. Sorts **body rows only** (rows 1..n),
  header untouched. Comparator: trim `textContent` of the cell's html; if both
  sides `Number()`-parse → numeric compare, else `localeCompare`; tie-break on
  original index (explicit stability — never rely on engine sort stability).

## 7. Spans

One helper decides: `NB.hybrid.tableHasSpans` (`hybrid.js`). Both entry
points stay live for a merged-cell table so the refusal is discoverable: the
Table submenu item is enabled, the ▦ control is rendered, and `open()` takes
the table into the read-only blocked state (notice strip, disabled toolbar, no
Apply, focus on Cancel) instead of returning `false`. Reordering is still
refused, so `table-edit.js` keeps its merged-cell note ("Merged cells:
reordering is unavailable; Edit table opens read-only") and renders no grips
or +/- pairs for spans. `open()` returns `false` only when it cannot open at
all: not in hybrid, the table is not in `#viewer-content`, or it has no rows.

## 8. Integration edits, in order

1. New `static/js/table-editor.js`.
2. `templates/index.html`: modal markup after `#export-overlay` — the toolbar
   carries Rows, Columns, a `.te-clip-group` (Cut, Copy, Paste, Clear),
   Alignment, Sort, and the Table group — and `<script
   src="/static/js/table-editor.js" defer>` immediately after `table-select.js`
   (after `hybrid.js`; runtime-lazy derefs, exact slot not load-bearing).
3. `static/css/style.css`: `.te-*` grid/toolbar styles (reuse
   `.settings-action` chrome), the modal grips and drop markers, the selection
   wash and edge classes (`.is-selected`, `.is-sel-top/bottom/left/right`, the
   `--te-sel-fill` token per theme); the hybrid grip/pair/note rules are deleted
   (`.nb-drop-line`, `.nb-drag-ghost` and `.nb-drag-proxy` stay — `list-edit.js`
   shares them).
4. `static/js/table-edit.js`: `render()` places one `nb-te-open` button in
   the table's left gutter, centred on the header row, clamped inside
   `#viewer`; the module keeps only hover/focus tracking, reveal and hide.
   The grips, the +/- pairs, the drag state machine and the merged-cell note
   are gone — structural work lives in the modal. It is rendered for
   merged-cell tables too (§7).
5. `static/js/hybrid.js`: in the context-menu builder, where the Table
   submenu used to be pushed:
   `{ label: "Edit table…", handler: () => NB.tableEditor && NB.tableEditor.open(table) }`,
   shown when the click lands inside a table and never disabled: spans open
   the refusal state (§7). `buildTableItems()` and the Table submenu are
   deleted; the `table-*` edit-bar acts and the Alt+Arrow chords keep using
   `moveRowBySelection`/`moveColBySelection` and stay.
   Do not touch `onContentChange`/`flushPendingSnapshot` — they are already
   exported (`hybrid.js`).
6. `static/sw.js`: add `/static/js/table-editor.js` to `PRECACHE`, bump
   `CACHE` v17→v18 with the customary comment line.
7. `CLAUDE.md` module list: add the one-line responsibility entry.
8. Tests (§9). `table-view.js` is **not** touched: preview-only, torn down at
   `hybrid:will-enter`, and the rebuilt table is a fresh node so no stale
   `nb:tableView` session can attach.

## 9. Test seams

- jsdom (`tests/dom/test_dom.js`, extend the `== table ==` block; drive
  `NB.tableEditor` directly like `NB.tableEdit`, no fetch stub needed):
  snapshot padding of ragged rows; per-cell edit updates `getState()`; align
  cycle / sort / transpose / move / insert / delete-table via the toolbar and
  `rebuildTable()` structure asserts; **Apply = one undo step** (undo restores
  the original `outerHTML`, exactly one history entry added); **no-op Apply**
  leaves `NB.hybrid.isDirty()` false and the DOM node identical; Cancel writes
  nothing; spans refusal on `open()`. The pointer drag cannot run here
  (`elementFromPoint` and cell geometry are missing), so the model verbs
  `moveRowTo`/`moveColTo`/`insertRowAt`/`insertColAt` carry the assertions;
  pointer painting is driven through `_select(r0,c0,r1,c1)` and the exported
  `selectionPayload()`/`pasteBlock()`/`clearSelection()`/`_fill()`; `elementFromPoint`
  is missing in jsdom, so the handle drag itself is browser-only.
- Wiring guard (the `check()` pattern at `test_dom.js`): index.html
  loads `table-editor.js`; sw.js PRECACHE includes it.
- Chromium (`tests/browser/test_table_editor_browser.js`, new file —
  `run_all.js` picks up every suite): real caret typing in a cell; focus
  return to the ▦ button after Cancel and to the header cell after the
  context-menu path; Esc/backdrop/× cancel; Apply → save round-trips through
  `domToMarkdown` to the expected GFM; Ctrl+Z single-step; a real pointer drag
  of a row grip and a column grip (drop marker, reordered grid); the modal
  drags and resizes (windows.js wiring).

## 10. Risks

- **Turndown round-trip**: verbatim cell HTML is what the live surface already
  serializes; the one extra path is sort/transpose *moving* html between
  cells — same class of mutation as `moveRow`/`moveCol`, already proven. A
  nested `<table>` inside a cell does not round-trip (GFM can't) — accepted,
  identical to the live surface, not new.
- **Contenteditable interaction while open**: impossible by construction —
  `NB.dialog` inerts every other body child. Requires the overlay to be a
  direct body child (it is).
- **Edit race**: the watcher can re-render `#viewer-content` under an open
  modal (`refreshFromContent`), detaching the original table. Apply and Cancel
  re-check `viewerContentEl.contains(original)` and bail to `close()` — the
  designer's `resolveTarget` rule (`mermaid-designer.js`).
- **Focus return**: overlay-button path is safe (node persists); menu path
  needs `fallbackFocus` or focus dies on body.
- **Undo snapshot ordering**: flush *before* `replaceWith`, never after; an
  immediate extra `pushSnapshot` would make the apply two steps.
- **Ragged normalization**: first edited Apply silently pads ragged rows —
  one sentence in the module header, no prompt.