# Table editor — selection and clipboard

Status: shipped (table editor selection and clipboard), design record. Handoff
for `docs/product/table-editor-selection.md`, against the modal in
`docs/design/table-editor.md`. Mockup: `docs/design/table-editor.html`
(`te-title-1` live, 3 × 3 selected; `te-title-3` blocked). One new value,
`--te-sel-fill` (§2); everything else is an existing token or a dimension already
in `table-editor.md` §3.

## 1. Scope

| | |
| --- | --- |
| Adds | the selection rectangle, its edge treatment, the clipboard toolbar group, the range strings in `.te-status`, and the pointer, touch and keyboard appearance of both. |
| Changes | nothing in the shell, the footer order, the sixteen existing controls, or `.te-tool`. |
| Amends | `table-editor.md` §9, "521–860px: toolbar on one row" — see §8. |
| Out | persistence, aggregates, auto-scroll, fill handles, a second scroller. |

## 2. The one new value

```css
#table-editor-overlay { --te-sel-fill: rgba(124, 156, 255, .10); }
body[data-theme="light"] #table-editor-overlay { --te-sel-fill: rgba(47, 95, 208, .08); }
```

One step lighter than `--accent-soft` (`.18` dark, `.12` light), which stays the
active cell's fill, so the active cell always out-reads the range. Both
declarations live beside `--te-row-hover` in the token block. Everything else
already exists: `--accent` for the 1px edge, `--bg-elev` for a selected header,
`--fg-muted` for a disabled control and the status line.

## 3. Selection rectangle

No new wrapper: `.is-selected` on every cell in the rectangle, edge classes on
the cells outside it.

| Part | Spec |
| --- | --- |
| Fill | `.te-cell.is-selected` → `background-image: linear-gradient(var(--te-sel-fill), var(--te-sel-fill))`. A gradient, **not** a `background-color`, so the row's zebra (`--bg`) and the header's `--bg-elev` show through and banding survives inside a range. |
| Outer edge | 1px `--accent`, four optional inset shadows. `.is-sel-top` / `-bottom` / `-left` / `-right` set `--te-sel-t: 1px` / `--te-sel-b: -1px` / `--te-sel-l: 1px` / `--te-sel-r: -1px`. A corner cell carries two, a 1 × 1 selection all four. The line sits over the cell's own `--border`, which is what gives the rectangle a crisp outside edge. |
| Under the ring | The fill-and-edge rule is `:not(.is-active)`. The active cell keeps its `--accent-soft` fill and 2px ring, which replaces the 1px edge on its two outside edges by construction — never by source order. |
| Selected header | Same wash, same edge. It composites over `--bg-elev`, so a selected header cell reads one step brighter than a selected body cell while both read as one rectangle. No second colour, no header-only treatment. |
| Zebra and hover | Both survive under the translucent wash, in both themes. Row hover sits one step above whatever is beneath it and never displaces the wash (the selection rule out-ranks `tbody tr:hover .te-cell`). Column hover is *replaced*, not stacked: both are `background-image`, and the selection rule comes later. |
| While painting | Nothing new. The press cell already carries the active ring; each cell the pointer crosses gains `.is-selected` on the next frame. No dashed preview, no ghost cell. |
| Long-press, before threshold | Nothing at all. A cue at press would flash on every tap, and a cue that grows needs motion, which is banned. The threshold is the first visual event: the pressed cell becomes a 1 × 1 selection. |

`.te-status` is not written while a drag is live; it announces once, on pointerup.

## 3b. Fill handle

One 8 × 8px square on the last selected cell's bottom-right corner, 1px inside
the cell box so a scroller clip cannot shave it.

| Property | Spec |
| --- | --- |
| Size and shape | `8px × 8px`, `border-radius: 2px`, 1px `--bg-panel` border so it reads over the wash and the zebra |
| Fill | `--accent`, `z-index: 4`, `cursor: crosshair`, `touch-action: none` |
| Position | `right: -1px; bottom: -1px` inside `.te-cell`, which is already `position: relative` |
| Visibility | Always while the selection exists in the editable state; none in the blocked state, none while a cell is being edited |
| Preview | the target cells take the same wash and 1px edge as the selection (`.is-fill-preview`), so the drag reads as the rectangle growing, not as a second colour |
| Release | the rectangle stays as the selection; the handle moves to its new corner |
| No new state | no dashed outline, no tooltip, no counter chip; the status line reports the result after release |

The handle is pointer-only (`aria-hidden`, no tab stop). Ctrl/Cmd+D is the
keyboard path for the same operation, so nothing is gesture-only.

## 4. Clipboard group

A fifth `.te-group` between **Columns** and **Column alignment**, followed by the
usual `.te-sep`. Left to right: **Cut · Copy · Paste · Clear**. All four are
`.te-tool`, 28 × 28, with a 16px SVG on the existing grid — `fill: none`,
`stroke-width: 1.4`, `stroke-linecap: round`, `aria-hidden`, `aria-label` and
`title` on the button.

| Control | Glyph | `aria-label` / `title` |
| --- | --- | --- |
| Cut | two eyelets, two crossing blades | "Cut" |
| Copy | two offset sheets | "Copy" |
| Paste | board with a clip tab | "Paste" |
| Clear | eraser over a floor line — never "formatting only", that command does not exist | "Clear contents" |

| State | Spec |
| --- | --- |
| Default | `--fg-muted`, transparent (existing `.te-tool`) |
| Hover | `--accent-soft` + `--fg` (existing) |
| Pressed | `:active` → `--accent-soft` + `--accent`. No `aria-pressed`: these are momentary, not toggles |
| Focus-visible | 2px `--accent` at 1px offset (existing `.te-tool`) |
| Disabled | `aria-disabled="true"`, opacity `.4`, `title` carries the reason, `aria-describedby` points at the status line, hover suppressed, still focusable; activating it writes the reason there |

All four stay enabled in the editable state, including on a single cell: a
disabled state that needs a content scan of the range on every selection change
buys nothing.

**Paste is never disabled for lack of clipboard access.** It stays enabled and
answers — with the block, with "Press Ctrl+V to paste", or with the refusal. A
dead button with no message strands the only user who cannot use the chord. The
one disabled Paste is the merged-cell state (§6).

## 5. Status line

One string at a time in `.te-status`, the single polite live region.

| Event | String |
| --- | --- |
| Range | `3 × 3 selected, rows 2–4, columns 1–3` |
| Copy / Cut | `Copied 3 × 3` · `Cut 3 × 3` |
| Paste, block | `Pasted 2 × 3` |
| Paste, 1 × 1 into a range | `Pasted 1 cell into 9 cells` |
| Clear | `Cleared 3 × 3` |
| Delete rows / columns | `Deleted 3 rows` |
| Paste fallback | `Press Ctrl+V to paste` |

Rows and columns are 1-based with the header row at 1, matching `aria-rowindex`.
The `N × M` prefix is the part that never truncates. Narrow widths truncate the
**tail** — one nowrap line, ellipsis, buttons never shrink:

```css
.table-editor-modal .te-status { min-width: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.table-editor-modal .te-footer > .settings-action { flex: 0 0 auto; }
```

At 480px the range string loses `columns 1–3` first, then `rows 2–4`; what is left
is `3 × 3 selected`. The operation strings are 26 characters at most and survive to
360px. Truncation is visual only: the live region is read from the full text.

## 6. Blocked (merged-cell) state

As `table-editor.md` §6, plus: the clipboard group renders in place with all four
`aria-disabled="true"` and `title="Clipboard is unavailable: this table has merged
cells."`, separator included, so the silhouette is unchanged. No cell carries
`.is-selected` or `.is-active`, so no wash, edge or ring appears. Activating a
clipboard button writes that reason to `.te-status`, which otherwise keeps
"Merged cells — editing disabled".

## 7. Focus and keyboard

- The grid's focus indicator stays the active cell's 2px inset ring. No second
  ring round the grid: the rectangle plus the ring already show that focus is
  inside the grid and which corner moves. In a range the ring sits on the focus
  corner, so Shift+Arrow reads as the ring walking and the rectangle growing.
- Focus after paste is the written rectangle's top-left, which then owns the ring.
- Tab reaches the group in DOM order — four stops between the six Columns
  controls and the one Alignment control — activating on Enter or Space. In the
  blocked state those four stops stay focusable and inert, like the rest.

## 8. Responsive

Measured in Chromium on the mockup: Rows 184 · Columns 184 · Clipboard 118 ·
Alignment 28 · Sort 196 · Table 58 = 768px, plus 92px of gaps and separators and
24px of toolbar padding — **about 880px of modal width needed**. The clipboard
group costs 127px of that, separator included.

| Width | Rows | What wraps |
| --- | --- | --- |
| ≥ ~940px viewport (modal at its full 960 above 1022px) | one | nothing: ~20px spare at 960, ~80px at 1022 and up |
| 861–~940px | two | Transpose + Delete table alone on row 2 |
| ~626–860px | two | Sort joins them on row 2 |
| ~590–625px | two | Alignment also drops to row 2 |
| ~500–589px | two | the Clipboard group leads row 2, after Rows and Columns |
| ≤ ~490px | three, four by ~370px | row 1 keeps Rows and Columns only |

Without the new group the same toolbar needs 745px of modal width and one row
survives to ~820px, so the 861–940 band is the change this feature makes and
`table-editor.md` §9 needs amending. If a real render overflows at 960, trim
`.te-sort-col` min-width to 120px; nothing else moves. A separator can land at
the end of a wrapped row — it still marks the boundary it was drawn for, so no
rule hides it. `.te-scroll` stays the only scroller: the group is one flex item
and never adds a scrollbar of its own.

## 9. Classes, rules, markup

New: `.te-clip-group` (on the `.te-group` element) · `.is-selected` ·
`.is-sel-top` · `.is-sel-bottom` · `.is-sel-left` · `.is-sel-right`. Place these
blocks between `.te-cell.is-col-hover` and `.te-cell.is-active`.

```css
.table-editor-modal .te-grid .te-cell.is-selected:not(.is-active) {
  background-image: linear-gradient(var(--te-sel-fill), var(--te-sel-fill));
  box-shadow:
    inset 0 var(--te-sel-t, 0px) 0 0 var(--accent),
    inset 0 var(--te-sel-b, 0px) 0 0 var(--accent),
    inset var(--te-sel-l, 0px) 0 0 0 var(--accent),
    inset var(--te-sel-r, 0px) 0 0 0 var(--accent);
}
.table-editor-modal .te-cell.is-sel-top   { --te-sel-t: 1px; }
.table-editor-modal .te-cell.is-sel-bottom { --te-sel-b: -1px; }
.table-editor-modal .te-cell.is-sel-left  { --te-sel-l: 1px; }
.table-editor-modal .te-cell.is-sel-right { --te-sel-r: -1px; }
.table-editor-modal .te-clip-group .te-tool:active
  { background: var(--accent-soft); color: var(--accent); }
.table-editor-modal .te-clip-group .te-tool[aria-disabled="true"]:active
  { background: transparent; color: var(--fg-muted); }
```

The `:not(.is-active)` keeps the layering correct regardless of source order.

```html
<div class="te-sep" aria-hidden="true"></div>
<div class="te-group te-clip-group" role="group" aria-label="Clipboard">
  <button class="te-tool" type="button" title="Cut" aria-label="Cut">…</button>
  <button class="te-tool" type="button" title="Copy" aria-label="Copy">…</button>
  <button class="te-tool" type="button" title="Paste" aria-label="Paste">…</button>
  <button class="te-tool" type="button" title="Clear contents"
          aria-label="Clear contents">…</button>
</div>
```

Every cell still needs `aria-selected`, `aria-rowindex` and `aria-colindex` as
product §8 requires; the mockup marks only the true side of `aria-selected`.

## 10. Avoid

A second highlight colour, an opaque selection fill, a dashed or animated
rectangle, an outline outside the cell box, a "painting" ghost cell, a
pre-long-press cue, `disabled` instead of `aria-disabled`, a disabled Paste
outside the merged-cell state, a second scroller, a fifth icon size.
