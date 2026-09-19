# Table editing in hybrid (WYSIWYG) mode — design

Status: handoff-ready design, not implemented.
Scope: `#viewer-content` while it is `contenteditable` (hybrid mode,
`static/js/hybrid.js`). Preview mode and the CodeMirror edit mode are unchanged.
Mockup: `design/table-editing-mockup.html`.

## 0. TL;DR for the implementing agent

- Add **one overlay layer** to the `#viewer` shell (not to `#viewer-content`).
  It is `pointer-events: none`; only the grip buttons inside it take pointers.
- On **table hover / focus-within**, draw 24×24 grips in the overlay: a row grip
  in the left gutter per body row, a column grip above each header cell.
- Drag rows and columns with **Pointer Events** (`pointerdown` + `setPointerCapture`),
  not HTML5 DnD. Draw the drop indicator in the overlay.
- Perform the move by **moving the existing `<tr>` / `<td>`/`<th>` nodes** (never
  clone), then call `onContentChange()`.
- **Never** add DOM inside `<table>` and never put a class/attribute on a table
  node during a drag. That keeps `domToMarkdown()` (turndown GFM) and hybrid's
  innerHTML undo snapshots completely untouched.
- The **header row is pinned at index 0** and never moves (GFM requirement).
- **Column widths are not persisted** — do not ship a fake resize. Use column
  **alignment** (`align`, which does round-trip) instead.

---

## 1. Product framing

notebook-server is a single-user, keyboard-and-mouse Markdown notebook. Hybrid
mode is "the whole rendered note is a word processor": tables are the one place
where structural editing matters and where today's only path is a nested
right-click submenu (`.context-menu` → Table) plus the edit-bar `▦` dropdown.

The design goal is **reordering** (the user's #1 ask), delivered through the
fewest new surfaces. This is a power-user notebook, not a spreadsheet: no
selection rectangles, no fill handle, no formula bar, no floating table toolbar.
The context menu stays and is the fallback for touch and for every action not on
a grip.

---

## 2. Constraints that drive the design (verified in this codebase)

| Fact | Consequence |
| --- | --- |
| `flattenTheads()` in `hybrid.js` moves every `<thead>` row into the first `<tbody>` on `enter()`. The header is **row 0** of `tbody`. | A "header row" is a DOM fact, not a section. |
| turndown's `turndown-plugin-gfm` only converts a `<table>` when `isHeadingRow(rows[0])`; otherwise the whole table is `keep()`-ed as **raw HTML**. | The first row must remain all-`<th>` and stay first. Moving it away silently changes the saved format. **Pin it.** |
| `align="left\|center\|right"` on `<th>/<td>` round-trips to `:--` / `:-:` / `--:`. | Alignment is the only persistable per-column property. Use it. |
| `domToMarkdown()` clones `#viewer-content` and strips only `.code-copy-btn`; hybrid's undo stores `#viewer-content.innerHTML`. | Anything added inside `#viewer-content` leaks into **saved markdown and every undo snapshot**. Put the overlay in `#viewer`. |
| The project recently fixed Firefox caret-navigation bugs inside tables by removing inner scrollers (`#viewer-content.hybrid-editing table { overflow: visible }`). | Do not add children inside `<table>`: extra nodes can become atomic/scrollable caret traps in Firefox. An out-of-tree overlay cannot. |
| `.markdown-body table { display: block; max-width: 100%; }` with the overflow removed in hybrid mode. | The `<table>` box may be wider than its columns. Position grips from **cell/row rects**, not the table's block rect. |
| `#viewer` is `position: relative; overflow: hidden` and has a single child, `#viewer-content` (the scroller). | `#viewer` is the correct containing block for a fixed overlay. |
| Code-block affordances (`.code-copy-btn`, `.hybrid-lang-pill`) reveal on `:hover` / `:focus-within` and are `user-select: none`. | Grips should follow the same reveal pattern. |
| `onContentChange()` is the single hook that marks dirty, shows Save, schedules autosave (`2000 ms`) and a DOM snapshot (`400 ms` coalesce). | Every mutation must call it; move it once per completed move. |

---

## 3. Interaction model

### 3.1 When grips appear

Grips appear for **the table under the pointer**, or for **the table that contains
focus** (`:focus-within`), and disappear when the pointer and focus both leave.
They are never "always on" — a note with three tables must not show six rails at
rest.

```
table mouseenter / focus-within  ->  show grips for that table
table mouseleave / focusout      ->  hide after a 120 ms grace timer
                                       (cancelled if the pointer enters the
                                       overlay, i.e. moved onto a grip)
```

The grace timer exists because the row grip sits in the gutter **outside** the
table's box; without it, moving from the row onto its grip counts as leaving the
table and the grips vanish under the cursor.

Reveal is driven by two delegated listeners on `#viewer-content`
(`mouseover`/`mouseout` with `e.target.closest("table")`, and `focusin`/`focusout`),
not per-table listeners — tables are created/destroyed constantly by hybrid edits.

### 3.2 How grips avoid interfering with typing

- The overlay is a child of `#viewer`, **outside the `contenteditable` subtree**.
  The caret engine never sees it; Firefox's table caret walking is unchanged.
- `pointer-events: none` on the layer; `pointer-events: auto` only on grip buttons.
- `pointerdown` on a grip calls `preventDefault()` and does **not** call
  `viewerContentEl.focus()`, so clicking a grip neither moves the caret nor
  starts a text selection.
- `user-select: none` on every grip and on the drag proxy.
- Row grips sit in the left gutter (over `#viewer-content`'s 40 px horizontal
  padding and the cell's own 6 px padding), column grips sit in the strip above
  the header row (over the header cell's top padding). Neither covers cell text
  at rest.

### 3.3 State machine

| State | Trigger | Visual |
| --- | --- | --- |
| `idle` | pointer/focus outside any table | overlay empty |
| `revealed` | hover or focus-within | grips visible, muted |
| `grip-hover` | pointer over a grip | grip fills `--accent-soft`, glyph `--fg` |
| `dragging-row` | pointerdown on a row grip | source row lifted (overlay ghost), drag proxy chip, horizontal drop line |
| `dragging-col` | pointerdown on a column grip | drag proxy chip, vertical drop line |
| `dropped` | pointerup on a valid target | one `onContentChange()`; overlay recomputes position |
| `cancelled` | Escape / `pointercancel` / drop outside | no mutation, no dirty |

Keyboard move (`§7`) jumps straight to `dropped`.

---

## 4. Row move

### 4.1 Affordance

- One `.nb-row-grip` per row, vertically centered on the row, in the left gutter:
  `x = rowRect.left - 28`, `y = rowRect.top + rowRect.height / 2 - 12`.
- 24×24 px hit target (`min-height: 24px` per accessibility requirement).
- Icon: six dots (2 columns × 3 rows), inline SVG, `fill: currentColor`.
- `cursor: grab`; `cursor: grabbing` while dragging.

```
row 0 (header)  ->  aria-disabled="true", opacity .35, cursor: default,
                    title="Header row is fixed (Markdown tables always put the
                    header first)"
row k (body)    ->  aria-label="Move row k", title="Drag to move row"
```

The header grip is **shown but disabled**. Showing it keeps the left gutter
visually regular and teaches the constraint; hiding it makes the missing handle
look like a bug.

### 4.2 Drag interaction

1. `pointerdown` on a body row grip → `setPointerCapture`; record `srcRow`,
   `tbody`, `table`. `body.classList.add("nb-table-drag")` (sets `cursor:
   grabbing`, disables `user-select` on `#viewer-content`). `preventDefault()`.
2. `pointermove` (rAF-throttled) → compute the insertion boundary (§4.3), draw
   the drop line, and move the `.nb-drag-proxy` chip near the cursor.
3. `pointerup` → if the boundary is a real change, `moveRow()` (§4.5); else
   cancel. Always remove classes/indicator and recompute grip positions.
4. `Escape` / `pointercancel` → cancel, no mutation, no `onContentChange()`.

### 4.3 Insertion boundary algorithm

```
// rows[0] is the header; it is never a boundary target.
let before = null;                       // element to insert before, or null = append
for (const row of tbody.rows) {
  if (row === headerRow) continue;       // cannot drop above the header
  const r = row.getBoundingClientRect();
  if (pointerY < r.top + r.height / 2) { before = row; break; }
}
// no-op guards: dropping onto its own position or the position it already
// occupies must not mark the note dirty.
if (before === srcRow || before === srcRow.nextElementSibling) return cancel;
tbody.insertBefore(srcRow, before);      // null appends
```

### 4.4 Drop indicator styling

- A 2 px `--accent` line, `box-shadow: 0 0 0 1px var(--accent-soft)` for
  visibility on both themes, `border-radius: 1px`, spanning from the union of
  cell rects' left edge to their right edge at boundary `y - 1`.
- Drawn in the overlay as `.nb-drop-line.is-row`. **Not** a DOM node in the table.
- The lifted source row is drawn as a translucent ghost rectangle in the overlay
  (`background: var(--accent-soft)`), so the table DOM is never touched mid-drag.
  This matters because hybrid's undo snapshots `innerHTML`; a transient class on a
  `<tr>` would be captured if a snapshot landed mid-drag.
- Optional, restrained: a 1 px dashed `--accent` rectangle around the whole table
  while a drag from it is active, also overlay-drawn. Helps scope the drop on
  large tables; safe to omit in v1.

### 4.5 Row move DOM mutation

```js
function moveRow(tbody, srcRow, before) {
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();      // clear BEFORE detaching: detached nodes in
                                       // a live Range glitch the caret in both engines
  flushPendingSnapshot();              // make the move its own undo step (see §9)
  tbody.insertBefore(srcRow, before);  // move the node; never clone
  onContentChange();
  focusRow(srcRow);                    // optional: caret to the moved row's first cell
}
```

Moving the node preserves everything that must travel with the row: `th`/`td`,
`align`, inline formatting, task checkboxes, wiki-links.

### 4.6 Edge cases

| Case | Behaviour |
| --- | --- |
| Header row | Grip shown, disabled. Never draggable, never a boundary. Drop above header forbidden by the loop in §4.3. |
| Table with only a header + 1 body row | Row grips disabled (`tbody.rows.length - 1 <= 1`); nothing to reorder. |
| Drag the last remaining body row | Covered by the previous line. A table can never lose all rows here (we do not delete on drag). |
| Drop outside the table | Cancel; no mutation. |
| Drop a row **into another table** | Not supported (v1). Drags are scoped to the source table; `pointerup` outside it is a cancel. |
| Drop a row **out of the table** (to become a paragraph) | Not supported (v1). Use the context menu's Delete row + typing. Keeps the model small and lossless. |
| Ragged rows (a body row with a different cell count than the header) | Allowed; the whole `<tr>` moves. GFM will normalise the rectangle on the next render (pre-existing behaviour, not introduced here). No warning. |
| `colspan`/`rowspan` present | Reordering is **disabled for that table** and a toast reads "This table has merged cells; reordering is disabled." See §6. |
| Table inside a blockquote or list | Overlay math is rect-based, so it works. The row grip may overlap the blockquote border or list marker; clamp `x` to `>= viewerRect.left + 4`. |
| RTL | Markdown cannot express `dir`, so RTL notes are not a supported input in this app. Positions are rect-derived (not left/right-assumed) and row grips stay on the physical left; if a future feature adds RTL, mirror the gutter on `direction: rtl`. |

---

## 5. Column move

### 5.1 Affordance

- One `.nb-col-grip` per column, horizontally centered over the column's header
  cell: `x = headerCellRect.left + headerCellRect.width / 2 - 12`,
  `y = headerRowRect.top - 12` (so 12 px overlaps the header cell's top padding,
  12 px sits in the margin above the table).
- Top placement, not bottom: standard for table editors, and it keeps the column
  grips clear of the row gutter and of the caret when editing the last row.
- 24×24 px, same six-dot SVG rotated 90° (3 columns × 2 rows of dots).
- `cursor: grab`. Single-column table → disabled.

### 5.2 Drag interaction

Same contract as rows, with Pointer Events and a vertical drop line
(`.nb-drop-line.is-col`, 2 px `--accent`, spanning the union of cell rects' top to
bottom at boundary `x - 1`). The drag proxy chip shows "Column N".

### 5.3 Insertion boundary and move

```
// boundary t in 0..n (n = column count); convert to a destination index:
const dest = (t > srcIndex) ? t - 1 : t;
if (dest === srcIndex) return cancel;

for (const row of table.rows) {
  const cells = Array.from(row.cells);
  if (srcIndex >= cells.length) continue;      // ragged row: skip
  const cell = cells[srcIndex];
  const ref  = (srcIndex < dest) ? (cells[dest + 1] || null)
                                 : (cells[dest] || null);
  row.insertBefore(cell, ref);
}
onContentChange();
```

The reference index is computed on the **original** `cells` array, before the node
is detached; `insertBefore` removes `cell` from its old position itself.

### 5.4 Edge cases

| Case | Behaviour |
| --- | --- |
| Single column | Column grip disabled. |
| Header vs body columns | There are none: a GFM column spans every row. The move applies to header and body alike, which is what "move the column" means. |
| The `th`/`td` tag difference | Preserved automatically: we move the actual cell node, so header stays `th` and body stays `td`. |
| `align` attribute | Travels with the cell, so column alignment follows the column. This is the desired behaviour and the reason to move nodes, not rebuild cells. |
| Ragged rows | A row missing that index is skipped; rows with a trailing extra cell are unaffected. |
| `colspan`/`rowspan` | Same disable rule as rows (§6). |
| Move a column across the table edge | Clamped to `dest ∈ [0, n-1]`; a drop past the last boundary means `dest = n-1`. |

---

## 6. Merged cells (`colspan` / `rowspan`) — reject, do not normalise

marked never emits spans and GFM cannot represent them, so any span in the live
DOM came from pasted HTML or a browser table-editing quirk. Two options were
considered:

- **Normalise** (strip spans, keep the content in the first cell). Rejected: it
  silently destroys content and changes the user's table behind their back.
- **Reject** (disable drag and resize for that table, keep the context menu and
  typing available, surface a toast). Chosen: honest, lossless, and the smallest
  code path.

Detection: `table.querySelector("td[colspan],th[colspan],td[rowspan],th[rowspan]")`
checked once when grips are revealed. The grips render disabled with
`title="Merged cells: drag reordering is unavailable"`.

---

## 7. Keyboard alternatives

Every mouse action has a keyboard path. The **context menu is the canonical path**,
exactly as the brief asks; direct chords are a convenience.

### 7.1 Context menu (primary, and the touch fallback)

Add four items to the existing Table submenu in `buildTableMenu()`
(`hybrid.js`), above the insert/delete group:

```
Move row up            Alt+↑
Move row down          Alt+↓
Move column left       Alt+Shift+←
Move column right      Alt+Shift+→
```

and the same four in the edit-bar `.eb-table-menu`. They reuse
`getRowFromSelection()` / `getCellFromSelection()`, which already resolve the
caret's table, and call the same `moveRow` / `moveCol`.

**Accessibility fix required:** `openMenu()` currently does not move focus into
the menu. Add: on open, `menuEl` gets `role="menu"`, the first enabled item is
focused, and ↑/↓/Enter/Escape walk/activate/dismiss. Without this the context menu
is not a keyboard path at all, and the Shift+F10 / Menu-key route (which browsers
turn into a `contextmenu` event) lands on nothing. This is the single most
important a11y change in the whole design.

### 7.2 Direct chords (convenience)

| Action | Chord | Rationale |
| --- | --- | --- |
| Move row up / down | `Alt+↑` / `Alt+↓` | No app conflict; no useful native meaning in `contenteditable`. |
| Move column left / right | `Alt+Shift+←` / `Alt+Shift+→` | `Alt+←/→` is browser Back/Forward and is already handled in `viewer.js`; `Alt+Shift+Arrow` is free. |
| Cancel a drag | `Escape` | — |

All four fire **only when the caret is inside a table**. Register them in the
existing `onEnterKey` handler in `hybrid.js` (the one dispatcher that already
owns `Ctrl/Cmd` chords in hybrid mode), `preventDefault()` on match, and let the
event pass through otherwise. `Alt+↑/↓` must not be allowed to reach the browser
while the caret is in a table.

### 7.3 Focus after a keyboard move

Focus/caret must follow the moved item: after Move row up/down, put the caret in
the moved row's first cell; after Move column left/right, in the moved column's
header cell. Otherwise the user presses the chord again and moves a different row.
This is mandatory, not polish.

### 7.4 Focus visibility

Grips are real `<button>` elements. `.nb-row-grip:focus-visible,
.nb-col-grip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }`
— the same treatment as `.settings-nav-item:focus-visible`. Grips carry
`tabindex="0"`; the context menu remains the primary route because the overlay
sits after `#viewer-content` in the tab order.

---

## 8. Visual specification

### 8.1 Tokens

Only the existing tokens are used. No new colors, sizes or radii are introduced.

| Token | Dark | Light |
| --- | --- | --- |
| `--bg` | `#1a1b1f` | `#ffffff` |
| `--bg-panel` | `#22232a` | `#f6f7f9` |
| `--bg-elev` | `#2a2b34` | `#eceef2` |
| `--fg` | `#e6e6ea` | `#1f2330` |
| `--fg-muted` | `#8b8d98` | `#5d6470` |
| `--accent` | `#7c9cff` | `#2f5fd0` |
| `--accent-soft` | `rgba(124,156,255,.18)` | `rgba(47,95,208,.12)` |
| `--border` | `#383a45` | `#d8dde4` |
| `--danger` | `#ff6b6b` | `#c0392b` |

### 8.2 Overlay layer

```css
/* The overlay is a sibling of #viewer-content inside #viewer, so it is
 * outside the contenteditable subtree and outside turndown's clone. */
.nb-table-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;      /* the layer never eats a click */
  z-index: 6;                /* below .context-menu (1000) */
}
.nb-table-overlay[hidden] { display: none; }
```

`#viewer` is already `position: relative; overflow: hidden`, so no layout change
is needed and the overlay is clipped to the editor viewport.

### 8.3 Grips

```css
.nb-row-grip,
.nb-col-grip {
  position: absolute;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  cursor: grab;
  user-select: none;
  pointer-events: auto;      /* the only interactive part of the overlay */
  z-index: 1;
}
.nb-row-grip:hover,
.nb-col-grip:hover {
  background: var(--accent-soft);
  border-color: var(--border);
  color: var(--fg);
}
.nb-row-grip:active,
.nb-col-grip:active {
  cursor: grabbing;
  background: var(--accent);
  color: var(--bg);          /* dark glyph on light accent, light glyph on dark
                                accent -> >=5:1 on both themes */
}
.nb-row-grip:focus-visible,
.nb-col-grip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.nb-row-grip[aria-disabled="true"],
.nb-col-grip[aria-disabled="true"] {
  opacity: .35;
  cursor: default;
  pointer-events: none;
}
.nb-col-grip .nb-grip-icon { transform: rotate(90deg); }
.nb-grip-icon { fill: currentColor; }
```

Contrast check (WCAG 2.1 relative-luminance, computed):

- `--fg-muted` on `--bg` — 5.2:1 dark, 6.0:1 light. Passes 4.5:1 for the
  glyph, and comfortably clears the 3:1 that a UI control boundary needs.
- Active state `--bg` glyph on `--accent` fill — 6.6:1 dark (`#1a1b1f` on
  `#7c9cff`), 5.7:1 light (`#ffffff` on `#2f5fd0`). Both pass.
- Deliberately **not** `white` for the dark-theme active glyph: white on
  `#7c9cff` is only 2.6:1. Using the theme's own `--bg` keeps the glyph dark on
  the dark theme's light accent and light on the light theme's dark accent, so
  one rule passes in both.

### 8.4 Drop indicators

```css
.nb-drop-line {
  position: absolute;
  background: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-soft);   /* keeps the line readable over
                                                 the alternating row fills */
  border-radius: 1px;
  pointer-events: none;
}
.nb-drop-line.is-row { height: 2px; }
.nb-drop-line.is-col { width: 2px; }

/* Overlay-only "lifted" row ghost — no class ever lands on the <tr>. */
.nb-drag-ghost {
  position: absolute;
  background: var(--accent-soft);
  border-radius: 2px;
  pointer-events: none;
}
```

### 8.5 Drag proxy chip

```css
.nb-drag-proxy {
  position: absolute;
  padding: 3px 8px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .8rem;
  background: var(--bg-elev);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .35);   /* matches .eb-menu / .toast */
  pointer-events: none;
  z-index: 2;
}
```

### 8.6 Drag-scoped cursor / selection guards

```css
body.nb-table-drag { cursor: grabbing; }
body.nb-table-drag #viewer-content { user-select: none; }
```

`body` classes are outside `#viewer-content`, so neither turndown nor the undo
snapshot sees them.

### 8.7 Both themes

All of the above resolve through tokens, so the light theme needs **no extra
rules**. Two notes:

- `--accent-soft` on light (`rgba(47,95,208,.12)`) is a faint blue; the drop
  line's `box-shadow` ring uses it over a white/`#f6f7f9` body and still reads
  because the core line is the saturated `--accent`.
- The drag proxy's `rgba(0,0,0,.35)` shadow is the same value the app already
  uses for `.edit-bar .eb-menu`, `.context-menu` and `.toast` on both themes.

---

## 9. Implementation notes for the coding agent

### 9.1 Event model: Pointer Events, not HTML5 DnD

Use `pointerdown` / `pointermove` / `pointerup` / `pointercancel` with
`setPointerCapture`. Reasons, specific to this app:

1. **`contenteditable` integration.** HTML5 DnD drags from a non-draggable overlay
   are awkward, and making a `<tr>` `draggable` hijacks text selection inside its
   cells. Pointer Events leave the editing behaviour untouched.
2. **Own visual control.** `dragstart` gives an unstylable browser ghost and no
   reliable coordinates; we need our own drop line, ghost and proxy. The app
   already drives its lightbox pan with mousedown/mousemove drags, so this is the
   established pattern.
3. **Identical in Firefox and Chromium.** HTML5 DnD drag images, `dragenter`
   timing and `dataTransfer` rules differ between the two; Pointer Events do not.
4. **Cancel semantics.** `pointercancel` + `Escape` map cleanly onto the state
   machine; DnD's `dragend` reasoning is messier.

`touch-action: none` on the grips so a touch drag is not interpreted as a scroll;
touch remains secondary and the context menu is its fallback.

### 9.2 Where the code lives

Add a new module `static/js/table-edit.js` (IIFE extending `window.NB`, same shape
as every other module) and register it in `templates/index.html` right after
`hybrid.js`, plus its `sw.js` `PRECACHE` entry. `hybrid.js` already owns the
table mutation helpers (`insertRow`, `deleteRow`, `insertCol`, `deleteCol`,
`toggleHeaderRow`); move `moveRow` / `moveCol` next to them and expose them on
`NB.hybrid` so `table-edit.js` (mouse) and the context menu (keyboard) share one
implementation. `table-edit.js` owns the overlay, hit-testing and the pointer
state machine only.

Wiring:

```
NB.evt.on("hybrid:entered", () => overlay.enable());
NB.evt.on("hybrid:exited",  () => overlay.disable());   // remove listeners, hide
```

Both events already exist.

### 9.3 Positioning

The overlay is fixed in `#viewer` while `#viewer-content` scrolls, so positions
must be recomputed:

- On reveal and on every `pointermove` over the hovered table (rAF-throttled).
- On `scroll` of `#viewer-content`: **hide** the overlay (cheapest correct
  behaviour; re-shown on the next mouse move). This avoids drift entirely.
- On `window` `resize`: hide.
- After a drop: recompute once.

Coordinates are always `rect.left - viewerRect.left`, `rect.top - viewerRect.top`
using `getBoundingClientRect()` of the **rows/cells**, never the block-level
`<table>` (see §2).

Because `domToMarkdown()` never sees the overlay and hybrid's snapshot takes
`viewerContentEl.innerHTML`, **no clone-stripping or snapshot-exclusion code is
needed**. If you deviate and put the overlay inside `#viewer-content`, you must
add both — so don't.

### 9.4 What to call after each change

Every completed move calls `onContentChange()` exactly once. It already:

- sets `dirty`, reveals the Save button, adds the `.unsaved` badge,
- emits `viewer:dirty-changed`,
- schedules autosave (debounced 2000 ms → `domToMarkdown()` + write),
- schedules a DOM snapshot (400 ms coalesce).

For a structural move, flush the pending typing snapshot first so the move is one
atomic undo step rather than being coalesced into the preceding keystrokes. Both
`pushSnapshot()` and `historyTimer` are module-private to `hybrid.js`; add a small
internal helper and call it from `moveRow`/`moveCol`:

```js
function flushPendingSnapshot() {
  if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; pushSnapshot(); }
}
```

This is the same pattern `undo()` already uses. Then mutate, then
`onContentChange()` (which schedules the post-move snapshot).

Do **not** use `document.execCommand("insertHTML")` for moves: it re-serialises
markup, can normalise the table, and is the source of the two-blocks-for-one
bug already documented in `insertEmptyBlock()`. Direct DOM moves are lossless and
hybrid's own history covers undo.

### 9.5 Undo integration

- The overlay lives outside `#viewer-content`, so snapshots and `Ctrl+Z` never
  capture grips or indicators.
- A completed move is one snapshot; `Ctrl+Z` restores the previous order and
  `Ctrl+Y`/`Ctrl+Shift+Z` re-applies it.
- While a drag is in progress, `Ctrl+Z` must **cancel the drag** (remove
  listeners/classes/indicator) and must not run `undo()`. Add that branch to the
  drag-state key handler.
- Because we clear the selection before mutating, a restored snapshot relocates
  the caret via hybrid's existing block-index mechanism; no extra work.

### 9.6 Accessibility checklist

- [ ] Grips are `<button type="button">` with `aria-label` ("Move row 3",
      "Move column 2") and `title`.
- [ ] Disabled header / merged / single-column grips carry `aria-disabled="true"`.
- [ ] 24×24 px hit targets.
- [ ] `:focus-visible` outline using `--accent`.
- [ ] Context menu: `role="menu"`, focus first item on open, ↑/↓/Enter/Escape.
- [ ] Keyboard move restores focus to the moved row/column (§7.3).
- [ ] Drop line is decorative; the outcome is announced via the existing dirty
      state (and optionally a toast "Moved row 3 to position 5"). Use a polite
      `aria-live` region if a toast is added.
- [ ] `Escape` cancels a drag.

---

## 10. Column resize — recommendation: do not ship it

**Verdict: reject for now.**

Markdown cannot store a column width. Any width the user drags can only live in
the live DOM, and it resets the moment they exit hybrid mode, reload, or open
the note elsewhere. A resize control that silently discards its result is worse
than no control: the user believes they have fixed a cramped table and the next
load proves otherwise.

It would also require putting inline `style`/`width` on `<th>/<td>`, i.e. one-off
presentation state inside the content that this codebase deliberately keeps out
of the notebook DOM, and it would have to be scrubbed before `domToMarkdown()`
to avoid leaking. That is exactly the kind of hidden serialisation path the
project avoids.

What Markdown **can** persist is column **alignment**. Spend the column affordance
on that instead (§11, item 6): add Left / Center / Right to the Table submenu and
to the column grip's click menu. It round-trips as `:--` / `:-:` / `--:` and makes
wide tables readable for real.

If the user later insists on resize despite this, the only honest framing is a
toolbar command "Set column width (session only)" that applies a CSS custom
property (`--nb-col-w-<i>` on the table) and is understood to be a preview, never
a saved property. It is documented here for completeness, not recommended.

---

## 11. Ranked recommendations

### Must-have (Phase 1 — the reordering the user asked for)

1. **Overlay infrastructure** (`#viewer` layer, hover/focus reveal, rect
   positioning). *Foundation; zero serialization or caret risk.*
2. **Row drag-reorder** with drop line and node-move mutation. *Reordering rows
   is the most common structural edit; highest value per line of code.*
3. **Column drag-reorder** with drop line and per-row cell move. *Same conceptual
   value; preserves `align` and `th`/`td` for free.*
4. **Keyboard + context-menu Move items**, plus focus management in the hybrid
   context menu. *Accessibility requirement; reuses the existing surface instead
   of inventing a new one.*
5. **Correctness guards**: header pinned, merged-cell tables disabled, single
   row/column disabled, selection cleared before mutation, Escape cancel.
   *Without these the feature corrupts GFM output or the caret.*

### Nice-to-have (Phase 2)

6. **Column alignment (Left/Center/Right)** in the Table submenu and the column
   grip menu. *The only column property Markdown persists; directly improves
   reading cramped tables.*
7. **Drag proxy chip** showing the row/column label. *Confidence aid on long
   tables; small and self-contained.*
8. **Overlay-drawn lifted-row ghost + table outline** during a drag. *Polish that
   keeps the table DOM untouched.*
9. **`body.nb-table-drag` cursor/selection guard** and a polite live-region
   announcement of the result. *Robustness and a11y polish.*
10. **Touch long-press to enter drag** (with the context menu as fallback).
    *Secondary per the brief.*

### Phase 3 / deferred

11. **Transient column resize** — documented §10, **rejected**.
12. **Promote a body row to header by dragging it to the top** (converting its
    cells to `th`) — a real feature, but it surprises the user by retagging cells;
    defer until the pinned-header model has been used in anger.

---

## 12. Considered and rejected

| Idea | Why rejected |
| --- | --- |
| HTML5 Drag & Drop API | Poor `contenteditable` integration, unstylable ghost, cross-browser `dataTransfer`/`dragenter` differences; Pointer Events already used by the lightbox. |
| Always-visible grips in hybrid mode | Six rails for three tables; the app is restrained and hover/focus reveal matches `.code-copy-btn`. |
| A persistent `<div class="table-wrap">` around each table | Extra DOM not in the source; must be stripped before turndown; drifts from what marked re-renders. Transient/out-of-tree only. |
| Grips as `::before`/`::after` on `<th>/<td>` | Pseudo-elements on editable cells can surface in turndown content and interfere with the caret; the project just fixed Firefox table caret bugs and will not add table children. |
| Row/column handles inside cells | A `<button>` inside a `<td>` reaches turndown's default rules and can leak its label text into the saved cell. |
| Movable header row | The first row must stay all-`<th>` or turndown emits the whole table as raw HTML. Pinned. |
| Cross-table row/column moves | Doubles the state machine (ragged destination, cell-count mismatch) for a rare action; use copy/paste. |
| Merge/split cells | GFM cannot represent spans; the existing context menu has no such command either. |
| Column width persistence | Markdown cannot store it; a resetting control misleads. Use alignment instead. |
| Drag-to-resize row heights | Same storage problem as column widths. |
| A floating table toolbar attached to the table | The edit bar and context menu already carry every command; a third surface duplicates and clutters the note. |
| Spreadsheet affordances (fill handle, selection rectangle, formula bar, multi-select) | This is a Markdown notebook, not a spreadsheet. |
| Replacing the context-menu Table submenu | It stays as the fallback for touch and for keyboard, and is the model the new commands join. |

---

## 13. File plan

| File | Change |
| --- | --- |
| `static/js/table-edit.js` | **New.** Overlay, hit-testing, pointer state machine, grip rendering. |
| `static/js/hybrid.js` | Add `moveRow`/`moveCol`/`flushPendingSnapshot`; extend `buildTableMenu()`; add focus management to `openMenu()`; add the four `Alt+…` branches to `onEnterKey`; expose the move helpers on `NB.hybrid`. |
| `static/css/style.css` | Append the §8 rules (overlay, grips, indicators, proxy, drag guard). No new tokens. |
| `templates/index.html` | Add `<script src="/static/js/table-edit.js" defer>` after `hybrid.js`; add the four Move items to `.eb-table-menu`. |
| `static/sw.js` | Add `/static/js/table-edit.js` to `PRECACHE`. |
| `tests/dom/test_dom.js` | Extend: header stays row 0 after a row move; column move preserves `align` and cell tags; move marks dirty once; merged cells disable grips; context menu lists the Move items. |
