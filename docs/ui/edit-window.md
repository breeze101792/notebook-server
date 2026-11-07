# Edit window — one action bar for all three editors

Status: **shipped**. This is the measured spec. Build procedure:
[`edit-window-guide.md`](edit-window-guide.md).

Visual reference: [`edit-window-mockup.html`](edit-window-mockup.html) — double-click; no
server, no assets. **Look, not markup or measurement.** Its class names (`.edit-bar-left`,
`.edit-bar-more`, `.win-history`, `.edit-bar-slot`) and Layout / Width / Theme controls
predate the shipped shell; §2–§5 here are authoritative. It intentionally differs in
three places:

| Mockup | Shipped |
| --- | --- |
| A dashed `+` slot after the history pair | Not rendered; the future-action slot is a design reservation only (§4). |
| An `…` button when the slot overflows | No menu, no popover; a right-edge mask fade on `.edit-bar-actions.is-scrollable` (§5). |
| Fixed 1280 / 720 stages in a 1320 × 768 box | `width: min(1320px, 96vw); height: min(85vh, 92vh)`; ≤ 520 px is full viewport. |

The windows are the table editor (`#table-editor-overlay`), the Mermaid designer
(`#designer-overlay`) and the Graphviz / WaveDrom designer (`#dw-designer-overlay`).
One shell, one bar, three contents: **window actions left, document history right.**

## 1. The shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ title  badge?                                    max  close          │  header 65
├──────────────────────────────────────────────────────────────────────┤
│ window actions — one scrolling line ────────────── │ undo redo        │  bar 57
├──────────────────────────────────────────────────────────────────────┤
│ table: flush grid     designers: sidebar 236 / canvas / inspector 296 │
├──────────────────────────────────────────────────────────────────────┤
│ status                                    Cancel    Apply            │  footer 69
└──────────────────────────────────────────────────────────────────────┘
```

Three fixed rows and one body. Header, bar and footer are the same components in all
three windows; only the bar's scrolling slot and the body's interior differ.

## 2. The bar

| Token | Value | Derivation |
| ----- | ----- | ---------- |
| `--edit-bar-h` | `57px` | 44 line + 6 + 6 padding + 1 border |
| `--edit-bar-pad-x` | `12px` | |
| `--edit-bar-pad-y` | `6px` | |
| `--edit-bar-gap` | `8px` | between clusters |
| `--edit-bar-tool` | `32px` | the slot's icon / chip height |
| `--edit-bar-sep-h` | `20px` | group separator height |
| background | `--bg-elev` | one step off the header's `--bg-panel` |
| border | `1px solid --border` **bottom only** | the header's edge is the top one |

- **One row, no wrap.** `.edit-bar-actions` takes `flex: 1 1 auto; min-width: 0`,
  `.edit-bar-history` is `flex: 0 0 auto`; the bar never grows a second line and never
  moves its right edge.
- **Separators:** `.edit-bar-sep` / `.te-sep`, `1 × 20px`, `--border`, `8px` margin either
  side, between groups. Inside the table's Rows and Columns groups, `.te-gap` is a 4 px
  spacer, not a rule.
- **Control sizes:** icon tools and chips are `32px` tall — the family's body-control
  size, and the reason 20 tools fit. The history pair is `44px` — it is chrome. Both sit
  on the same 44 px line, so the bar has one height in every window.
- **Focus:** `2px solid var(--accent)`, `outline-offset: 1px`, on every bar control. The
  slot has 6 px of vertical slack, so a ring is never clipped.
- **No animation**, no icon swap, no transition.

## 3. The slot — one contract, three contents

| Window | Slot contents | Grouping |
| ------ | ------------- | -------- |
| Edit table | `.te-toolbar`: Rows (6) · Columns (6) · Clipboard (4) · Alignment (1) · Sort (label + select + toggle) · Table (2) | Six `.te-group`s, 1 × 20 px separators |
| Mermaid | `Select` `Connect` (icon toggles, `aria-pressed`, disabled until ready) · `Add` `Chart` (chips) | Two `.edit-bar-group`s, one separator |
| WaveDrom / Graphviz | `Add` `Chart` `Source` (chips, `data-compact`) | One `.edit-bar-group` |

Contract, same for all three:

1. **Window-scoped actions only.** No Cancel/Apply, no Undo/Redo, no title.
2. **A scrolling slot, not a landmark.** `.edit-bar-actions` carries no role of its own;
   the inner `.edit-bar-toolbar` carries `role="toolbar"` and its own `aria-label`
   ("Table tools", "Diagram actions", "Timing actions"), and each group is `role="group"`
   + `aria-label`.
3. **One line.** Items are `flex: 0 0 auto`; nothing wraps. Overflow scrolls (§5), never
   a second row.
4. **Every item has a name** — text, or `aria-label` plus `title` for icons.
   Toggle/mode buttons use `aria-pressed`; destructive tools take `.is-danger`.
5. **A chip focuses, never copies.** It scrolls to and focuses the matching sidebar
   section; the form stays in the sidebar.
6. **The slot may be empty** in a future window; the bar does not depend on it.

Mermaid `Add` is disabled while the sidebar is hidden, `Chart` while the chart section is
also hidden (ER, gantt, line-item). The table's tools use `aria-disabled` for contextual
no-ops; the history pair uses native `disabled`.

## 4. Right cluster — seam and history

- **History pair:** `.edit-bar-history`, `role="group" aria-label="History"`, holding the
  seam then two `.edit-bar-btn`. Each is `44 × 44`, icon-only, with `aria-label` + `title`
  carrying the chord (`Undo (Ctrl+Z)`, `Redo (Ctrl+Shift+Z or Ctrl+Y)`), formatted like
  `shortcuts.js:38` (`Mod` → `Ctrl` / `Cmd`). Ids are unchanged and ride along:
  `table-editor-undo/redo`, `designer-undo/redo`, `dw-undo/redo`. `disabled` is the native
  attribute (the button leaves the tab order), never `aria-disabled`.
- **Seam:** `.edit-bar-seam`, `aria-hidden="true"`, `1 × 24px`, `--border`, first child of
  `.edit-bar-history`. It separates *this window's actions* from *the document's history*.
- **No reserved element is rendered.** The `+` slot is a design reservation only: a future
  per-window action becomes a real control after the history pair. Nothing inert ships.
- **States shown:** table = both dead (clean open); Mermaid = Undo live / Redo dead;
  WaveDrom = both live. Same in every window.

Markup:

```html
<div class="edit-bar">
  <div class="edit-bar-actions">
    <div class="edit-bar-toolbar" role="toolbar" aria-label="Table tools"> … groups … </div>
  </div>
  <div class="edit-bar-history" role="group" aria-label="History">
    <span class="edit-bar-seam" aria-hidden="true"></span>
    <button class="edit-bar-btn" id="table-editor-undo" aria-label="Undo (Ctrl+Z)" disabled>…</button>
    <button class="edit-bar-btn" id="table-editor-redo" aria-label="Redo (Ctrl+Shift+Z or Ctrl+Y)" disabled>…</button>
  </div>
</div>
```

The table's `.te-toolbar` is the inner toolbar; the designers' `.edit-bar-toolbar` is the
same shape. One style block covers all three.

## 5. Width

| Width | Chrome | Body |
| ----- | ------ | ---- |
| 1280 | header 65, bar 57, footer 69 | `min(1320px, 96vw) × min(85vh, 92vh)`; table slot needs 973 px of its ~1090 px and fits on one line |
| 720 | same three heights; **the slot scrolls**, history pair pinned and visible; footer wraps status to its own row (90 px) | designers compact (≤ 960: Mermaid sidebar becomes a horizontal strip, DW sidebar hidden and reached through the sheet); table grid scrolls |
| ≤ 520 | unchanged | table modal goes full screen; the `Esc cancels` hint is hidden |

- **Overflow, not wrap.** `.edit-bar-actions { overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none }`. A second row would push the body down 40 px and move the grid
  mid-edit; a scroll costs nothing, and keyboard focus on a hidden tool scrolls it into
  view natively.
- **The affordance is a fade.** `.edit-bar-actions.is-scrollable` applies a
  `linear-gradient` mask that fades the last 22 px. The shared history module toggles it
  from `scrollWidth > clientWidth + 1` on window resize and through a `ResizeObserver`.
  No popover, no ellipsis button, no second row.
- Measured at 720: table slot `505 px` visible / `973 px` content; designers `545 / 545`.
- The header never reflows. Its fixed cost is `136 px` (36 padding + 10 gap + 90
  controls), so at 720 the heading still gets `584 px` and titles do not truncate.

## 6. What moved, what stays

**Moved into the bar**

1. The table's whole tool row: 20 icon tools, six groups and the sort field. The 48 px
   `.te-toolbar` strip is gone from the body; its markup was reparented unchanged.
2. Mermaid's `Select` / `Connect` mode tools left the sidebar; `Add` / `Chart` are new
   chips that scroll to and focus the sidebar section.
3. WaveDrom / Graphviz's `Edit source instead` ghost button became the `Source` chip,
   which opens the inline source editor at every width. `Add` / `Chart` open the compact
   sheet on compact and scroll/focus the section on desktop. The old `.dw-compact-nav`
   strip is deleted.
4. History: out of the designers' sidebars and out of the header.

**Stays exactly where it was**

1. Mermaid sidebar: Add form (Node/Edge tabs, Label, Shape, Add node) and Chart (direction
   TB/LR, Autonumber messages switch). The source path survives only in the error and
   read-only states, not as a sidebar button.
2. WaveDrom sidebar: Add form, Chart switch. Both inspectors. The table's notice strip
   (merged-cell refusal), now directly under the bar.
3. Footer: `[status][Cancel][Apply]`, 44 px actions. The table alone adds `.te-hint`
   `Esc cancels` — a deliberate exception, hidden at ≤ 520 px. The designers have no hint.
   Cancel carries `aria-keyshortcuts="Escape"`.
4. The header: title + type badge, then `[maximize][close]`. No seam, no history.

**Do not duplicate.** A chip focuses the matching sidebar section; it does not copy its
form into the bar.

## 7. Why one bar beats three tool surfaces

Before the change the same kind of action lived in three places: the table's strip inside
its body, the designers' sidebar sections, and WaveDrom's strip. That is three places to
look, three places to add the next action, and no answer at all to "where does this
window's Undo go?"

One bar gives every window the same anatomy — actions on the left, history on the right,
same height, same padding, same seam — so a user learns the shape once. It also gives the
code one component and one place for the next action, instead of a fourth surface when
the next feature lands. The cost is honest: 57 px of body height in the two designers, and
the table's 20 tools at 32 px instead of the 44 px chrome size, so they fit one line.

## 8. Where the table does not fit the shared bar

The table has 20 icon tools plus a sort field where the designers have three or four.
At 32 px the slot needs 973 px and fits the ~1090 px available at a 1280 px viewport.
At 44 px it would need ~1215 px and would **not** fit at 1280 either — so the slot cannot
use the 44 px chrome size; only the history pair does. Below ~1150 px viewport width the
slot scrolls and the right edge fades. The sort `<select>` is the one item that cannot
collapse to an icon; at 720 it sits inside the scrolling run, not pinned. The destructive
tools (delete row / column / table) can scroll out of view at 720; the block menu still
carries its own delete.

## 9. Implementation notes

- **Tokens:** the `--edit-bar-*` block lives in the shared selector list on
  `#table-editor-overlay`, `#designer-overlay`, `#dw-designer-overlay`; no one-off values.
- **Header:** `.settings-header.edit-header` holds `.edit-heading` (h2 + `.edit-badge`)
  and the close button. `windows.js:109-136` inserts `.win-max` and wraps it with the last
  button in `.settings-header-actions`, so **Close stays last** and there is no seam.
- **Markup order:** `header → .edit-bar → body → .edit-footer`. The bar is a sibling of the
  body, not inside it, so the table's grid starts at `--designer-canvas-bg` with no strip.
- **Reparent, do not rewrite:** the table's `.te-toolbar` children live in
  `.edit-bar-actions`; `.te-group`, `.te-sep`, `.te-tool`, `.te-sort-col` and every handler
  are unchanged. Only the wrapper and its size rules changed.
- **Kept ids:** `table-editor-undo/redo/cancel/apply/status/close`,
  `designer-undo/redo/cancel/apply/status/close`, `dw-undo/redo/cancel/apply/status/close`.
  Only the undo/redo nodes moved; their listeners did not.
- **Kept hooks:** `.te-footer` and `.te-toolbar` stay on the table footer and toolbar
  (`table-editor.js:403-412` walks out of the grid into them); `[role="status"]` styling
  stays on `.edit-footer > [role="status"]`.
- **Scroll affordance:** `edit-window.js` toggles `.is-scrollable` on `.edit-bar-actions`
  from `scrollWidth > clientWidth + 1`, on `resize` and through a `ResizeObserver`; the
  class shows the mask. No JS is needed for the scrolling itself.
- **Accessibility:** 44 px targets on the history pair and footer; 32 px in the slot (above
  the 24 px minimum). Focus ring 2 px accent, offset 1. `--fg-muted` on `--bg-elev` is
  4.6:1 dark / 5.4:1 light; a disabled icon at `opacity: .4` is exempt from contrast but
  must stay distinguishable from live. The bar is not a landmark; the header and footer
  keep theirs.

## 10. Using the mockup

- **Edit bar** — the default: three windows side by side, same box, three history states,
  three footers, pins 1–7 marking the bar, the seam, the overflow and what stayed. Ignore
  its `+` slot, its `…` button and its fixed 1280 / 720 stage widths (header note).
- **Header history** — the previous variant: history in the header, no bar for the
  designers, the table keeps its own 48 px strip. Not shipped.
- **Current** — the pre-change Mermaid chrome (sidebar History, 28 px window controls,
  32 px footer actions) plus the pre-change table footer. Contrast only; not shipped.
- **Width** drives all three at once: 1280 (bar on one line) and 720 (slot scrolls, footer
  wraps, designers compact). The three layouts are mockup constructs; the app ships one —
  the bar.
