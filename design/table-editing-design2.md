# Table-editing overlay — collision fix (design 2)

Status: handoff-ready, corrected. Supersedes the geometry in
`design/table-editing-design.md`.
Mockup: `design/table-editing-mockup2.html` (open it offline; it has a
"current (buggy)" toggle and a live overlap counter).
Scope: the `.nb-table-overlay` drawn by `static/js/table-edit.js` in hybrid mode.

---

## 0. TL;DR

The overlay placed three independent control families with a **fixed offset
from a table edge** and no shared budget, so several controls resolved to the
same pixel slot. The fix is one rule:

> **Grips own the margins (left gutter, top strip). Insert/delete own the
> roomy sides (right rail, bottom strip). Exactly one row pair and one column
> pair exist, revealed for the line under the pointer.**

Concretely: remove the per-row and per-column `+`/`−` buttons, the row `+`
from the left gutter, and the trailing append `+`. Replace them with a
vertical `+ / −` pair in the right rail (active row) and a horizontal `+ / −`
pair under the table (active column). Per-row and per-column drag grips stay,
and collapse to the active line when rows/columns are too dense to fit a
24 px handle per line.

This removes every overlap by construction (no two controls share a slot);
no z-order tricks are involved.

---

## 1. Root-cause analysis

All numbers are derived from the current constants:

```
GRIP_SIZE   = 24
GUTTER_X    = 28
COL_OVERLAP = 12
ADD_GAP     = 6
```

and the pane geometry: `#viewer-content` has `padding: 16px 40px 200px`, so
the table's left edge is 40 px from the pane's left edge, and a `+`/`−` button
is 24 px wide.

### 1.1 Left gutter — exact 100 % overlap (must fix)

The row grip is placed at `left = rowLeft − GUTTER_X`, and the row `+` is
placed at `left = tableLeft − GUTTER_X` — **the same constant, the same y**
(`rowCenterY − 12`). Because `border-collapse: collapse` and the cells span
the row box, `rowLeft === tableLeft`, so the two 24×24 buttons occupy the
identical rectangle: **576 px² of overlap, 100 %**.

There is no room to separate them horizontally. The pane gives only 40 px left
of the table. One slot fits:

- grip at `tableLeft − 28` spans absolute `x = 12 … 36` (inside the pane),
- a second control at `tableLeft − 52` spans absolute `x = −12 … 12`
  → **clipped by `#viewer`** (which is `overflow: hidden`).

Two 24 px buttons plus a gap need 52 px; only ~40 px exist. The left gutter
can carry **at most one control column**. The `+` must leave the left gutter.

### 1.2 Top strip — always-colliding append, width-dependent grip/plus (must fix)

Three controls share the strip at `y = headerTop − 12`:

| Pair | Gap between boxes | Overlap |
| --- | --- | --- |
| column `+` of cell *k* vs trailing append `+` | append starts at `lastRight + 6`; the last cell's `+` spans to `lastRight + 18` | **12 px, always** |
| column grip of cell *k+1* vs column `+` of cell *k* | `30 − 0.5·W` (uniform width W) | **> 0 whenever W < 60 px** |
| column `+` of cell *k* vs column grip of cell *k* | `W/2 − 18` | only if W < 36 px |

So a run of cells narrower than 60 px produces a picket-fence of overlaps, and
the append button **always** collides with the last column's `+` regardless of
width. At W = 48 px the overlap is 6 px per adjacent pair; at W = 40 px it is
10 px. The strip cannot host a grip **and** a `+` **and** an append per column.

### 1.3 Bottom strip — adjacent `−` touch under 24 px columns; scrollbar risk (must fix)

Column `−` is centered per column at `cellCenterX − 12`. Adjacent buttons are
one cell width apart, so two 24 px buttons **touch when W < 24 px** and overlap
when W < 24. A 20 px column gives 4 px of overlap. Additionally, hybrid mode
sets `#viewer-content { overflow-x: auto }`, so the horizontal scrollbar is
drawn over the bottom of the scroll container; a bottom strip that lands there
is painted under the scrollbar.

### 1.4 Secondary: per-row / per-column grips collide when lines are dense

Not in the report, but the same class of bug and the same demo cases expose it:

- rows: grip centers are `rowHeight` apart → two 24 px grips **overlap when
  `rowHeight < 24`** (a 22 px row overlaps its neighbour by 2 px).
- columns: col grip centers are `(W_k + W_{k+1})/2` apart → overlap when
  `W_k + W_{k+1} < 48`.

The fix must cover this or the "narrow/dense" requirement is unmet.

---

## 2. Corrective principle

Assign each control family to the side of the table that has room for it, and
make the expensive family **single-instance**.

| Family | Side | Budget | Why this side |
| --- | --- | --- | --- |
| Row drag grip | **left gutter** | 40 px pane padding → fits one 24 px control | reorder is per-row; the gutter is the conventional handle lane |
| Row `+` / `−` | **right rail** (vertical pair) | 40 px pane padding + slack; 24 px wide | needs 2 buttons; only a *vertical* pair fits 40 px |
| Column drag grip | **top strip** | ~16–20 px padding + 12 px cell overlap | conventional column-handle lane |
| Column `+` / `−` | **bottom strip** (horizontal pair) | below the table, ~200 px padding | needs 2 buttons side by side; the bottom is the roomy side |

Two consequences keep it collision-free:

1. **Only grips are per-line.** With the density fallback (§4) their centers
   are always ≥ 24 px apart.
2. **Each pair is one instance**, so it cannot self-collide; only a
   cross-axis corner clash is possible, and that is resolved by a single
   nudge rule (§3.4).

Semantics are preserved: `+` inserts, `−` deletes, one click each, per row and
per column. The **physical positions** change from the user's original ask
(row `+` left / `−` right; column `+` top / `−` bottom) because those positions
are geometrically impossible without overlap. The brief explicitly permits the
re-arrangement provided the one-click semantics survive.

---

## 3. Corrected layout spec

### 3.1 Constants

| Constant | Old | New | Rationale |
| --- | --- | --- | --- |
| `GRIP_SIZE` | 24 | **24** | unchanged; a11y minimum hit target |
| `GUTTER_X` | 28 | **28** | unchanged; `rowLeft − 28` spans x 12…36 in a 40 px pane gutter |
| `COL_OVERLAP` | 12 | **12** | unchanged; half the grip straddles the header top |
| `BTN_SIZE` | — | **24** | `+`/`−` hit target (was implicitly 24 in CSS) |
| `PAIR_GAP` | — | **4** | gap inside a pair |
| `ROW_PAIR_GAP` | — | **6** | gap between the table's right edge and the row rail |
| `COL_PAIR_GAP` | — | **6** | gap between the table's bottom edge and the column pair |
| `EDGE_SAFE` | — | **8** | minimum distance a control keeps from a `#viewer` edge |
| `DENSE_PITCH` | — | **24** | below this line pitch, collapse per-line grips to the active line |
| `SCROLLBAR_SAFE` | — | **22** | extra bottom reserve when `#viewer-content` has a horizontal scrollbar |
| `ADD_GAP` | 6 | **removed** | replaced by `ROW_PAIR_GAP` / `COL_PAIR_GAP` |

Derived sizes: `PAIR_W = 2·BTN_SIZE + PAIR_GAP = 52`, and for the vertical
row rail `PAIR_H = 52`.

Coordinate space (unchanged): positions are relative to `#viewer`'s border
box. Let

```
V = { left: 0, top: 0,
      right:  viewerEl.clientWidth,
      bottom: viewerEl.clientHeight }
clamp(v, lo, hi) = Math.max(lo, Math.min(v, hi))
```

Every `placeAt(node, {left, top})` call below passes these computed values.

### 3.2 Placement math, control by control

All rects are `getBoundingClientRect()` of the **row / cell**, converted to
overlay space (`rect.left − host.left`, `rect.top − host.top`) — never the
block-level `<table>` rect.

This matters: `.markdown-body table { display: block; max-width: 100% }` makes
the `<table>` box **full width**, while the cells inside an anonymous inner
table shrink to their content. So `tableRect.right` is the pane's right edge
even for a 300 px-wide table; anchoring the right rail to it would strand the
rail far from the table. Define the **table content box** from the cells:

```
contentLeft   = min(cellRect.left)   over header cells
contentRight  = max(cellRect.right)  over header cells
contentTop    = headerRect.top
contentBottom = max(rowRect.bottom)  over all rows
```

Use `contentRight` / `contentBottom` below, never `tableRect`.

**1. Row drag grip** (one per body row, or active row only when dense)

```
left = rowRect.left − GUTTER_X
top  = rowRect.top + rowRect.height / 2 − GRIP_SIZE / 2
```

Header row (index 0): rendered, `aria-disabled="true"`, `pointer-events: none`
— unchanged. Single body row: disabled — unchanged.

**2. Column drag grip** (one per header cell, or active column only when dense)

```
left = cellRect.left + cellRect.width / 2 − GRIP_SIZE / 2
top  = headerRect.top − COL_OVERLAP
```

Single column: disabled — unchanged.

**3. Row `+ / −` pair** (right rail; active **body** row only)

Wrapper `.nb-pair.is-row`, `flex-direction: column`, `gap: PAIR_GAP`.
Children: `+` (insert below), then `−` (delete).

```
pairW = BTN_SIZE            // 24 (rail width)
pairH = 2·BTN_SIZE + PAIR_GAP   // 52

left = clamp(contentRight + ROW_PAIR_GAP,
             V.left + EDGE_SAFE,
             V.right − EDGE_SAFE − pairW)
top  = clamp(rowRect.top + rowRect.height / 2 − pairH / 2,
             V.top + EDGE_SAFE,
             V.bottom − EDGE_SAFE − pairH)
```

The pair is **vertically centered on the active row** but clamped into the
pane, so a dense 22 px row still gets a clear 52 px rail beside it. Because
the rail sits over the pane's right padding, it never covers cell text.

**4. Column `+ / −` pair** (bottom strip; active column only)

Wrapper `.nb-pair.is-col`, `flex-direction: row`, `gap: PAIR_GAP`.
Children: `+` (insert right), then `−` (delete).

```
pairW = 2·BTN_SIZE + PAIR_GAP   // 52
pairH = BTN_SIZE                // 24

left = clamp(cellRect.left + cellRect.width / 2 − pairW / 2,
             V.left + EDGE_SAFE,
             V.right − EDGE_SAFE − pairW)
top  = contentBottom + COL_PAIR_GAP
top  = clamp(top, V.top + EDGE_SAFE,
             V.bottom − EDGE_SAFE − pairH − scrollbarReserve())
// corner de-conflict (§3.4)
if (intersects(colPair, rowPair)) top = rowPair.bottom + PAIR_GAP
top  = clamp(top, V.top + EDGE_SAFE,
             V.bottom − EDGE_SAFE − pairH − scrollbarReserve())
```

```
scrollbarReserve() = (viewerContentEl.scrollWidth > viewerContentEl.clientWidth)
                     ? SCROLLBAR_SAFE : 0
```

**Removed:** the per-body-row `+` (left gutter), the per-body-row `−` (right
edge), the per-header-cell `+` (top strip), the per-header-cell `−` (bottom
strip), and the trailing append `nb-add-col-end` button. Append is now the
last column's `+` ("insert right of the active column") when the active column
is the last one.

**Header:** grip only. No pair — a Markdown table cannot gain a row above the
header or lose the header row.

### 3.3 Diagram

```
                 top strip: column grips only  (y = headerTop − COL_OVERLAP)
                 ┌───────────┐   ┌──────────────┐   ┌─────────────┐
                 │    ⋮⋮     │   │     ⋮⋮       │   │     ⋮⋮      │
                 └───────────┘   └──────────────┘   └─────────────┘
  left gutter     ┌───────────┬──────────────┬─────────────┐
  (row grips)     │ Header A  │  Header B    │  Header C   │
      ┌──────┐    ├───────────┼──────────────┼─────────────┤     ┌──────┐
      │  ⋮⋮  │    │  a1       │  b1          │  c1         │     │  +   │
      └──────┘    ├───────────┼──────────────┼─────────────┤     ├──────┤
      ┌──────┐    │  a2       │  b2          │  c2         │     │  −   │
      │  ⋮⋮  │    ├───────────┼──────────────┼─────────────┤     └──────┘
      └──────┘    │  a3       │  b3          │  c3         │    row pair
      ┌──────┐    └───────────┴──────────────┴─────────────┘   (right rail,
      │  ⋮⋮  │                                                   active row)
      └──────┘              ▲
                            │ active column
                     ┌──────────────┐
                     │   +   │  −   │   column pair (bottom strip, active col)
                     └──────────────┘
```

- The active row and active column are the ones under the pointer (or the
  caret, on focus). Only their pair is drawn.
- Row grips are per body row; column grips are per column. The header grip is
  the first one on the left, drawn disabled.
- The trailing `+` past the last column is gone; the last column's pair covers
  append.

### 3.4 Cross-axis clash (the only case z-order could hide)

The row rail (right) and the column pair (bottom) can meet in the
bottom-right corner when the active row is near the bottom **and** the active
column is near the right. They are resolved **geometrically, not by
z-index**:

1. place the row pair first;
2. if the column pair's rect intersects it, set
   `colPair.top = rowPair.bottom + PAIR_GAP` and re-clamp.

The pane reserves 200 px of bottom padding, so moving the column pair down is
free. If clamping pins both into the same corner, the column pair wins the
lower row (it is the more specific target) and the row pair is already clear of
it by the nudge.

### 3.5 Stacking

```
.markdown-body                     (in-flow)
.nb-table-overlay                  z-index: 6      (unchanged)
  .nb-row-grip / .nb-col-grip      z-index: 1
  .nb-pair                         z-index: 1
  .nb-drop-line / .nb-drag-ghost   z-index: 2      (drag-time only)
  .nb-drag-proxy                   z-index: 2
.context-menu                      z-index: 1000   (unchanged)
```

No control overlaps another by construction, so z-index is used only to keep
drag indicators above controls. Do not add per-button z-indexes; if you find
yourself needing one, a placement rule is wrong.

---

## 4. Narrow columns and dense rows — one strategy

**Chosen: collapse per-line grips to the active line.** The `+`/`−` pairs are
already single-instance, so density only affects grips.

```
minBodyRowHeight = min(row.getBoundingClientRect().height) over body rows
minColumnWidth   = min(cell.getBoundingClientRect().width) over header cells

denseRows = minBodyRowHeight < DENSE_PITCH          // 24
denseCols = minColumnWidth   < DENSE_PITCH          // 24

row grips:    render all body rows; if denseRows, render only the active row's
column grips: render all columns;  if denseCols, render only the active column's
```

Why this and not the alternatives:

- **It is the only option that works at both extremes.** A 22 px row cannot
  host a 24 px handle per row (2 px overlap) and a 20 px column cannot host a
  24 px handle per column (4 px overlap). There is no arithmetic that fits a
  24 px target into a 22 px pitch.
- **The fallback changes the number of grips, never the target size.** Hit
  targets stay 24 px, so the a11y requirement is untouched. Shrinking the
  button (the other way to fit) would violate it.
- **It matches the pairs.** Once insert/delete already follow the pointer,
  making the reorder grip follow the pointer too is consistent: "point at the
  line you mean; its controls appear."
- **It is a pure function of two measured values**, trivial to test and to
  reason about. A per-adjacent-pair rule (`W_k + W_{k+1} < 48`) would show more
  grips in mixed tables but is harder to state and to test; the conservative
  `min < 24` rule is sufficient and always safe.

The threshold is `DENSE_PITCH = 24` because that is exactly `GRIP_SIZE`: at a
pitch of 24 the two grips touch (0 px overlap) and above 24 they clear.

> Note: `min < 24` is sufficient but not necessary for columns. Two 20 px
> columns with a 100 px neighbour do not actually collide, yet the rule
> collapses the grip set. That is a deliberate trade: safe and simple over
> maximal. If a future case makes it feel coarse, upgrade to the per-adjacent
> test without changing any other rule.

The demo's **wide 8-column table** exercises `denseRows` (22 px rows → a single
row grip on the hovered row); the **dense-column demo** exercises `denseCols`.

---

## 5. Visual specification

All values come from the existing tokens in `static/css/style.css`. **No new
tokens, colors, sizes or radii.**

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
| `--danger-soft` | `rgba(255,107,107,.15)` | `rgba(192,57,43,.12)` |

### 5.1 States

| Element | Idle | Hover | Active / pressed | Focus-visible | Disabled |
| --- | --- | --- | --- | --- | --- |
| `.nb-row-grip`, `.nb-col-grip` | transparent bg, transparent border, `--fg-muted` glyph | `--accent-soft` bg, `--border` border, `--fg` glyph | `--accent` bg, `--bg` glyph, `cursor: grabbing` | 2 px `--accent` outline, offset 1 | `opacity: .35`, `pointer-events: none`, `cursor: default` |
| `.nb-add-btn` (`+`) | `--bg-elev` bg, `--border` border, `--fg-muted` glyph | `--accent-soft` bg, `--border` border, `--accent` glyph | `--accent` bg, `--bg` glyph | same outline | same |
| `.nb-del-btn` (`−`) | `--bg-elev` bg, `--border` border, `--fg-muted` glyph | `--danger-soft` bg, `--border` border, `--danger` glyph | `--danger` bg, `--bg` glyph | same outline | same |

Sizing rhythm: every control is **24×24, radius 4 px**. Inside a pair the gap
is `PAIR_GAP = 4 px` (`ROW_PAIR_GAP`/`COL_PAIR_GAP` are edge offsets, not
intra-pair gaps). Glyph: `+`/`−` at `font-size: .9rem; font-weight: 600;
line-height: 1`; grips are a 10×10 dot-grid SVG with `fill: currentColor`,
rotated 90° for columns.

**Why the pair buttons are filled and the grips are not:** a filled surface
separates the two control *families* at a glance — ghost grips reorder,
solid buttons act. The pair is a deliberate click target, so it should read as
one. The grips are passive handles and stay quiet.

### 5.2 Contrast (WCAG 2.1, computed)

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--fg-muted` glyph on `--bg-elev` (dark) | 4.26:1 | passes 3:1 for non-text/icon |
| `--fg-muted` glyph on `--bg-elev` (light) | 5.13:1 | passes |
| `--accent` glyph on `--bg-elev` (dark / light) | 5.39:1 / 4.93:1 | passes |
| `--danger` glyph on `--bg-elev` (dark / light) | 5.07:1 / 4.68:1 | passes |
| `--bg` glyph on `--accent` fill (dark / light) | 6.60:1 / 5.72:1 | passes |
| `--bg` glyph on `--danger` fill (dark / light) | 6.20:1 / 5.44:1 | passes |
| `--fg-muted` glyph on `--bg` (dark / light) | 5.21:1 / 5.96:1 | passes |

The pressed state uses `--bg` as the glyph colour (dark glyph on the dark
theme's light accent, light glyph on the light theme's dark accent) rather than
`white`, which would fail on the light accent.

### 5.3 Both themes

Everything resolves through tokens, so the light theme needs **no extra rules**.
`--danger-soft` already exists in both themes and is used only on `−` hover.

---

## 6. Interaction notes

### 6.1 Reveal and hide

- **Reveal** the overlay (grips + the active line's pair) when the pointer
  enters a table or focus is inside one. Delegated listeners on
  `#viewer-content`, unchanged.
- **Hide** after a **120 ms grace** timer when the pointer leaves the table
  *and* the pointer is not over the overlay; cancel the timer if the pointer
  enters the overlay. Unchanged; still load-bearing because grips and the right
  rail live outside the table's box.
- **Scroll** of `#viewer-content` hides the overlay (positions are rect-based
  and would drift); the next pointer move re-reveals it. Unchanged.
- **Resize** hides. Unchanged.

### 6.2 Which line's pair is shown

- **Pointer path:** on `pointermove` over the table, compute
  `activeRow` = body row whose y-range contains the pointer,
  `activeCol` = header cell whose x-range contains the pointer.
- **Focus path:** on `focusin`, derive the line from the caret's cell.
- **Lock:** once the pointer is over a control (grip or pair) or a drag is in
  progress, do **not** recompute `activeRow`/`activeCol`. This is the
  hover-intent guard: moving from a cell onto its `+` must not re-target the
  pair to a neighbouring row.

### 6.3 Recommendation on when `+`/`−` appear

**Yes — the pair is revealed only for the row/column under the pointer**, and
locked while the pointer is on the pair. This is the single most important
hover-intent decision:

- Showing every row's pair at once is the original bug (no room).
- Showing only the hovered row's pair makes the target unambiguous and lets
  the control sit at the row's actual position rather than in a detached rail.
- The lock prevents "the pair flickers to the next row" when the user moves
  diagonally toward it.

### 6.4 Clicking a pair

- Do not move the caret before the mutation; `+` inserts, `−` deletes, one
  click. Caret lands in the new cell (insert) or the remaining cell at the same
  index (delete) — existing `focusCellOf` behaviour.
- `−` on the last body row and on the last column is `aria-disabled`, as today.
- A completed insert/delete calls `onContentChange()` once and re-renders the
  overlay from the refresh path.

### 6.5 Keyboard and touch

Unchanged: the context menu and the `Alt+Arrow` chords remain the keyboard and
touch paths. The `+`/`−` pairs are an additional mouse affordance, not a
replacement.

---

## 7. Implementation notes for the coding agent

### 7.1 Constants (`static/js/table-edit.js`)

```js
const GRIP_SIZE      = 24;   // unchanged
const GUTTER_X       = 28;   // unchanged
const COL_OVERLAP    = 12;   // unchanged
const BTN_SIZE       = 24;   // NEW: + / - hit target
const PAIR_GAP       = 4;    // NEW: gap between the two buttons of a pair
const ROW_PAIR_GAP   = 6;    // NEW: table right edge -> row rail
const COL_PAIR_GAP   = 6;    // NEW: table bottom edge -> column pair
const EDGE_SAFE      = 8;    // NEW: min distance from a #viewer edge
const DENSE_PITCH    = 24;   // NEW: below this line pitch, active line only
const SCROLLBAR_SAFE = 22;   // NEW: extra bottom reserve with a h-scrollbar
// DELETE: ADD_GAP
```

### 7.2 `renderGrips()` rewrite

Replace the four `+`/`−` blocks and the append block with two pair builders.
Structure:

```
1. measure: bodyRows, header, per-row heights, per-cell widths
2. denseRows / denseCols from DENSE_PITCH
3. activeRow / activeCol from the current pointer/caret line (default 0)
4. row grips   (all body rows, or active only when denseRows) + disabled header
5. col grips   (all columns,  or active only when denseCols)
6. placeRowPair(activeRow)   // no-op when there is no body row
7. placeColPair(activeCol)   // no-op when there is no header cell
8. clearOverlayDynamic-safe: keep .nb-drop-line/.nb-drag-proxy/.nb-drag-ghost
```

New builder sketch:

```js
function placePair(kind /* "row" | "col" */, left, top, buttons) {
  const pair = el("div", "nb-pair is-" + kind);
  buttons.forEach((b) => pair.appendChild(b));
  placeAt(pair, { left, top });
  overlay.appendChild(pair);
}
```

`placeAt(node, rect)` is **unchanged** and still takes `{ left, top }`
(already in overlay space). Compute the numbers with `clamp(...)` as in §3.2.
Do the row pair first, then nudge the column pair if it intersects
(`rectsIntersect(rowPairEl, colPairEl)` reading `getBoundingClientRect()`).

### 7.3 CSS delta (`static/css/style.css`, the §5 block)

- Keep `.nb-row-grip`, `.nb-col-grip` as absolute 24×24 controls.
- Change `.nb-add-btn` / `.nb-del-btn` from `position: absolute` to **static
  flex children** of a pair; keep size, radius, glyph and hover rules. Add the
  `--bg-elev` / `--border` resting surface specified in §5.1.
- Add:

```css
.nb-pair {
  position: absolute;   /* placed via placeAt */
  display: flex;
  gap: 4px;             /* PAIR_GAP */
  z-index: 1;
  pointer-events: none; /* only the buttons opt in */
}
.nb-pair.is-row { flex-direction: column; }  /* right rail */
.nb-pair.is-col { flex-direction: row; }     /* bottom strip */
.nb-pair > .nb-add-btn,
.nb-pair > .nb-del-btn { position: static; pointer-events: auto; }
```

- No new tokens. No light-theme block.

### 7.4 Tests to add (`tests/dom/test_dom.js`)

jsdom returns zeroed rects, so the harness stubs `getBoundingClientRect`.
Extend it with a **deterministic geometry stub** for a table and assert:

1. **Non-overlap (the regression test):** for a narrow table (3 cols,
   widths 60/150/90) and a dense table (8 cols, 78 px, 22 px rows), compute
   every overlay `button` rect and assert **no pair intersects**. This is the
   test that would have caught the bug.
2. **Exactly one pair per axis:** at most one `.nb-pair.is-row` and one
   `.nb-pair.is-col` exist; both count 2 buttons.
3. **No control in the removed slots:** there is no `+` at `rowLeft − GUTTER_X`
   and no append button past the last column (assert the button count equals
   `bodyRows + columns + 4` after the dense fallback).
4. **Density fallback:** with `rowHeight = 22`, only one row grip is rendered;
   with `minColumnWidth = 20`, only one column grip.
5. **Disabled states:** header grip, single-row, single-column, last-body-row
   `−`, last-column `−` carry `aria-disabled="true"`.
6. **Clamp:** with a table flush to the right edge, the row rail's right edge
   is `≤ viewerWidth − EDGE_SAFE`.
7. **Corner nudge:** with the active row last and active column last, the
   column pair does not intersect the row pair.
8. **Scroll hides** the overlay and the next pointer move re-reveals it
   (existing assertion, keep passing).

Also assert the **old** geometry *does* collide, as a documented regression
guard, so the fix cannot silently revert.

### 7.5 File plan

| File | Change |
| --- | --- |
| `static/js/table-edit.js` | Constants; `renderGrips()` split into grips + two pair builders; active-line tracking + lock; corner nudge. |
| `static/css/style.css` | `.nb-pair` rules; `+`/`−` become static flex children with a `--bg-elev` surface. |
| `tests/dom/test_dom.js` | The eight assertions above. |
| `design/table-editing-design2.md` | This spec. |
| `design/table-editing-mockup2.html` | The corrected mockup. |

No changes to `hybrid.js` helpers (`insertRow`/`deleteRow`/`insertCol`/
`deleteCol`/`moveRow`/`moveCol`) — the same functions are called, only from
different buttons. No serialization surface changes: the overlay stays a child
of `#viewer`, outside `#viewer-content`.

---

## 8. Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Keep per-row `+`/`−` in the left/right gutters | Two 24 px controls need 52 px; the left gutter is 40 px. Provably impossible (measured, `#viewer` clips the overflow). |
| Keep `+` left and stack `−` under it in the gutter | On a 22 px row the stack crosses the next row's grip; the gutter is a single 24 px column and cannot host a second control without collision. |
| Keep per-column `+`/`−` in the top strip | Grip + `+` overlap for any column narrower than 60 px, and the append always collides. Three controls per column cannot fit a 24 px strip. |
| Put insert/delete inside the cells | Extra DOM inside the `contentEditable`; reaches turndown and undo snapshots. The architecture forbids it. |
| Shrink `+`/`−` below 24 px to fit | Violates the 24 px hit-target requirement. |
| A 2×2 control cluster floating at the active cell's corner | Moves controls off their target, still needs corner de-confliction, and duplicates the rail/bottom-strip idea with more state. |
| A horizontal `+`/`−` pair in the right rail | 52 px wide; a full-width table leaves 40 px of right padding, so it clamps over the last cells. A vertical pair is the only rail that fits. |
| A single row `+` only, delete via the context menu | The brief requires one-click delete per row. |
| Always-active-only grips (no per-line grips ever) | Loses the "grab any row directly" affordance on normal 30 px tables where there is room. The density fallback keeps both behaviours. |
| Per-adjacent-pair density test (`W_k + W_{k+1} < 48`) | More precise but harder to state and test; the conservative `min < 24` rule is always safe. Documented as a future upgrade. |
| Solve the corner clash with z-index | Hiding a collision is not fixing it; the user still cannot click the buried control. Resolve geometrically. |
| Put the column pair above the header as a pair | Only ~16–20 px of room above the header; a 52 px-wide pair still collides with neighbours on narrow columns. |

---

## 9. Ranked change list

### Must-fix

1. Remove the row `+` from the left gutter — it exactly overlaps the row grip.
2. Move the row `+`/`−` into one vertical pair in the right rail, active row only.
3. Remove the per-column `+` from the top strip — it overlaps the next column's grip below 60 px.
4. Remove the trailing append `+` — it overlaps the last column's `+` by 12 px always.
5. Move the column `+`/`−` into one horizontal pair below the table, active column only.
6. Add `DENSE_PITCH` and collapse per-line grips to the active line when dense.
7. Clamp pair positions to `EDGE_SAFE` inside `#viewer` and nudge the column pair clear of the row pair.
8. Add the non-overlap geometry test for the narrow and dense cases.

### Nice-to-have

9. Reserve `SCROLLBAR_SAFE` for the bottom pair when a horizontal scrollbar is present.
10. Lock `activeRow`/`activeCol` while the pointer is over a control (hover-intent hardening).
11. Filled `+`/`−` surface vs ghost grips, so the two control families read apart.
12. Add `DENSE_PITCH` values to the mockup's readout so reviewers can see the mode.

### Explicitly out of scope

13. Column width persistence — still rejected (see `table-editing-design.md` §10).
14. Per-adjacent-pair density precision — documented as a future upgrade.
