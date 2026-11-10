# Edit window — the shared chrome for the table editor, Mermaid and DOT/WaveDrom

Status: Current spec — pre-implementation (codifies the shipped shell).

Reference mockup: [`edit-window-mockup.html`](edit-window-mockup.html) — dark and light:
the empty shell, the table editor, the Mermaid designer, maximized, 720, the 390 phone
pair, applying, error, blocked, and the focus / disabled-history detail. Every board uses
the shipped numbers except the two marked exceptions.

**Normative source.** This document owns the shared chrome only: the overlay, the modal
box, the header, the action bar, the body slot, the footer, window geometry, and the
keyboard contract. It reads [`foundations.md`](foundations.md) for tokens and
[`controls.md`](controls.md) for control anatomy. It does not design a body: the table
grid is [`table-editor.md`](table-editor.md); the designer sidebar, canvas and inspector
are [`diagram-designers.md`](diagram-designers.md). Those two documents own every control
inside the body and the per-window contents of the bar's actions slot. This document
fixes the slot they fill.

**The shipped look is the target.** The user likes the current window. This document
codifies it exactly and does not redesign it. §10.4 lists the applied exceptions (focus
rings and the 44 px phone tools); each is an accessibility fix, not a redesign. The pass also
inherits two foundation-level deltas — the light modal shadow (`--shadow-modal`) and the light
`--warn` value — recorded in §3.6 and §5.4 of the foundations. Everything else that would
change a pixel is in §12, proposals only.

Source material, not current specs: [`../archive/ui/edit-window.md`](../archive/ui/edit-window.md)
(the previous measured spec), [`../archive/ui/edit-window-guide.md`](../archive/ui/edit-window-guide.md)
(the previous build guide), and [`../archive/ui/edit-window-mockup.html`](../archive/ui/edit-window-mockup.html).
Where they disagree with the shipped code, this document wins. The three known
disagreements are recorded in §9.4.

Every claim about current code cites `file:line`.

---

## 1. Anatomy

### 1.1 One shell, three bodies

```
┌──────────────────────────────────────────────────────────────────────┐
│  backdrop: --overlay-scrim, full viewport, never scrolls             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ title  badge?                              [maximize] [close]   │  │ 65
│  ├────────────────────────────────────────────────────────────────┤  │
│  │ [undo] [redo] │ window actions — one scrolling line ──────────▶ │  │ 57
│  ├────────────────────────────────────────────────────────────────┤  │
│  │                                                                │  │
│  │  body slot — table grid, or sidebar / canvas / inspector       │  │ rest
│  │                                                                │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │ status                          hint?      Cancel      Apply    │  │ 69
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Markup order is fixed: `header → .edit-bar → body → .edit-footer`. The bar is a sibling
of the body, never inside it. The body slot is the only shell region that scrolls; an
inner body pane may have its own scroller. The header, bar and footer are
`flex-shrink: 0` (`style.css:8599`, `:1903`, `:2264`).

| Region | Size | Surface | Rule | Owner |
|---|---|---|---|---|
| Backdrop | viewport, `inset: 0` | `--overlay-scrim` (`rgba(0,0,0,.5)`) | `style.css:1369-1387` | this document |
| Modal box | `min(1320px, 96vw) × min(85vh, 92vh)` | `--surface-panel` | `style.css:1801-1840`, `:5812-5817`, `:6171-6176` | this document |
| Header | 65 | `--surface-panel` | `style.css:8549-8586` | this document |
| Action bar | 57 | `--surface-raised` | `style.css:8591-8674` | this document; contents per body doc |
| Body slot | `1fr`, `min-height: 0` | per window | `style.css:1914-1927` | `table-editor.md`, `diagram-designers.md` |
| Footer | 69 | `--surface-panel` | `style.css:8726-8748` | this document |

The three modal variants are `.table-editor-modal` (`style.css:5812`), `.designer-modal`
for Mermaid (`:6171`), and the same `.designer-modal` for DOT/WaveDrom inside
`#dw-designer-overlay` (`templates/index.html:1642`).

### 1.2 DOM order and class map

```html
<div id="<overlay>" class="settings-overlay" hidden>
  <div class="settings-modal <variant>" role="dialog" aria-modal="true"
       aria-labelledby="<prefix>-title" tabindex="-1">
    <div class="settings-header edit-header">
      <div class="designer-heading edit-heading">
        <h2 id="<prefix>-title">…</h2>
        <span class="designer-type edit-badge" id="<prefix>-type">…</span>
      </div>
      <!-- windows.js inserts this wrapper at boot -->
      <div class="settings-header-actions">
        <button class="icon-btn win-max" type="button" aria-pressed="false">…</button>
        <button id="<prefix>-close" class="icon-btn" type="button">×</button>
      </div>
    </div>
    <div class="edit-bar">
      <div class="edit-bar-history" role="group" aria-label="History">…</div>
      <div class="edit-bar-actions">…</div>
    </div>
    <div class="settings-body <variant>-body">… body …</div>
    <div class="settings-footer edit-footer <variant>-footer">…</div>
  </div>
</div>
```

The markup source is `templates/_edit_window.html:13-61`; the three calls are
`templates/index.html:1324-1455` (table), `:1467-1631` (Mermaid), `:1644-1762`
(DOT/WaveDrom).

The prefixes are `table-editor`, `designer` and `dw` (`docs/archive/ui/edit-window-guide.md:75-81`).
No new prefix may reuse one of them.

### 1.3 What the shell owns, and what it does not

| The shell owns | The body docs own |
|---|---|
| Backdrop, modal box, radius, shadow, z-band | The grid, cells, selection, editing |
| Header title, badge slot, maximize, close, drag | The designer sidebar, canvas, inspector, selection |
| History pair, seam, scrolling actions slot, fade | Which window actions exist and what each does |
| Status line, hint slot, Cancel, Apply, footer wrap | Validation, serialization, dirty detection, body state copy |
| Default and saved geometry, resize, maximize, focus trap | A body's internal scrolling and keyboard model |

---

## 2. Header

### 2.1 Geometry

The row is exactly 65 px: 10 top + 44 control + 10 bottom + 1 bottom border
(`--edit-head-h: 65px`, `--edit-head-pad-x: 18px`, `--edit-head-gap: 10px`,
`style.css:8529-8531`, `:8549-8553`). It is `display: flex; align-items: center;
justify-content: space-between`, with a bottom `1px --border` inherited from
`.settings-header` (`style.css:1897-1904`).

The header never reflows and never wraps. Its fixed cost is 136 px: 18 + 18 padding,
10 gap, and two 44 px controls with a 2 px gap (`style.css:8581-8586`, `:1913`). At the
320 px minimum window width the heading still has 184 px.

| Part | Value | Source |
|---|---|---|
| Height | 65 (`--edit-head-h`) | `style.css:8529` |
| Padding | `10px 18px` | `:8551` |
| Gap | `var(--edit-head-gap)` 10 | `:8550` |
| Heading | `flex: 1 1 auto; min-width: 0; overflow: hidden` | `:8554-8561` |
| Control | 44 × 44, radius 6 | `:8581-8586` |
| Actions cluster | flex, gap 2, `flex-shrink: 0` | `:1913` |

### 2.2 Title and badge

`#<prefix>-title` is an `<h2>`: `1.14rem`, weight 600, tracking `.3px`, one line,
ellipsis (`style.css:8562-8572`). The heading is baseline-aligned so the badge sits on
the text baseline, not centred against the 44 px controls (`:8558-8560`).

The badge is a `.designer-type.edit-badge` outline pill: `.72rem`, uppercase, tracking
`.6px`, `--text-muted`, `--surface-raised` face, `1px --border`, `--radius-pill`,
`2px 9px` padding (`style.css:6179-6185`). In the header it is capped at 120 px
(`--edit-badge-max`, `:8544`, `:8573-8579`). It ellipsizes; `:empty { display: none }`
collapses it with no reserved slot (`:8580`).

| Window | Badge text | Set by |
|---|---|---|
| Table | `Table` | server template, `templates/index.html:1324` |
| Mermaid | the diagram type id, e.g. `flowchart` (uppercased by CSS) | `mermaid-designer.js:3653`, empty in the template (`:1467`) |
| DOT / WaveDrom | the block type, e.g. `Graphviz` / `WaveDrom` | the language module, empty in the template (`:1644`) |

The badge reports a fact, never a state; it is not focusable and carries no `role`
(controls §2.6).

### 2.3 Maximize, close, and which is last

`windows.js` injects exactly one `.win-max` button into every `.settings-modal` header
with a button (`windows.js:109-136`). It finds the **last** button in the header, wraps
it in `.settings-header-actions` if it is not already wrapped, and inserts the maximize
button **before** it (`windows.js:122-135`). Therefore:

1. **Close is the final `<button>` in `_edit_window.html` and stays there**
   (`templates/_edit_window.html:19`). A new header control goes before close, or the
   wrapper and the insertion order break.
2. The rendered cluster is `[maximize][close]` (`tests/dom/test_dom.js:27371-27404`).
3. The header's direct children remain exactly `[heading, actions]`; the max button is
   never a bare sibling next to the title (`tests/dom/test_dom.js:27399-27403`).

| Control | Glyph | Box | Accessible name | State |
|---|---|---|---|---|
| Maximize | two 15 × 15 SVGs, expand / contract corners (`windows.js:30-40`) | 44 × 44, radius 6 | `Maximize`; `Restore` while pressed | `aria-pressed` false / true (`windows.js:87-95`) |
| Close | text `×`, 1.35 rem | 44 × 44, radius 6 | `Close` + `title="Close"` | never disabled |

Both are `.icon-btn`: transparent, `--text-muted`, hover `--fg` on `--accent-soft`
(`style.css:1345-1355`). Only the maximize glyph swaps, by CSS on
`[aria-pressed="true"]` (`style.css:1872-1876`). The close button is the last control
because `Esc`, Cancel and a backdrop click all end in the same place; the rightmost
control is the conventional, unambiguous exit.

### 2.4 Drag and double-click

| Gesture | Behaviour | Source |
|---|---|---|
| Press the header (not a button, left button only) | Convert the centred box to explicit inline `left/top/width/height`, `transform: none`; drag | `windows.js:143-174` |
| Move | Clamp `left/top` to 12 px from every viewport edge | `:170-171` |
| Release | Save `{left, top, w, h}` for this overlay; clear the drag state | `:175-182` |
| Double-click the header | Toggle maximize; a double-click whose target is a button is ignored | `:188-193` |
| While dragging | `body.modal-dragging`: `user-select: none`, header cursor `grabbing` | `:183-185`, `style.css:1889-1896` |
| While maximized | Drag is ignored; a press does nothing | `windows.js:144-146` |
| Cursor at rest | `move` on the header | `style.css:1841-1843` |

The drag starts anywhere in the header except a `<button>` — including the title and the
badge. The badge is inside `.edit-heading`, so pressing it also drags.

### 2.5 Header states

| State | Look | Source |
|---|---|---|
| Rest | transparent, `--text-muted` glyph | `style.css:1345-1354` |
| Hover | `--fg` glyph, `--accent-soft` face | `:1355` |
| Focus-visible | **missing today**; §10.4 X1 adds the bar's ring, 2 px accent at offset 1 | `:1345` has none; `:8672` is the bar idiom |
| Disabled | `.4` opacity, no hover; the header has no disabled control today | `:1359-1365` |
| Maximized | `aria-pressed="true"`, contract glyph, label `Restore` | `windows.js:87-95`, `style.css:1875-1876` |
| Drag | header cursor `grabbing`, no text selection | `style.css:1889-1896` |

---

## 3. Action bar

### 3.1 Two slots, one line

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [undo][redo][seam] │ [window actions ………………………………………… fade ─▶]      │
└──────────────────────────────────────────────────────────────────────────┘
        pinned left                         flex: 1 1 auto, scrolls
```

The shipped order is **history first, then actions** (`templates/_edit_window.html:24-48`).
The history group is pinned at the left; the seam is its last child; the actions slot
takes the rest and scrolls. This is the DOM order and what the browser tests read
(`tests/browser/test_table_editor_browser.js:198-226`). The CSS comment at
`style.css:8588` says "the left slot scrolls; the history pair stays pinned", which is
stale: the left slot is the history pair. §9.4 records it.

Bar geometry: 57 px = 6 top + 44 line + 6 bottom + 1 bottom border
(`--edit-bar-h`, `--edit-bar-pad-y`, `style.css:8535-8537`, `:8591-8601`). Background
`--surface-raised`, bottom border only; the header already supplies the top edge
(`:8597-8598`).

| Part | Value | Source |
|---|---|---|
| History group | `flex: 0 0 auto`, gap 8 | `:8642-8647` |
| History button | 44 × 44, radius 6 | `:8654-8670` |
| Undo/redo glyph | 17 × 17, stroke 1.5, `currentColor` | `_edit_window.html:28-43` |
| Seam | 1 × 24, `--border`, `aria-hidden` | `style.css:8648-8653`, `:8534` |
| Actions slot | `flex: 1 1 auto; min-width: 0` | `:8602-8605` |
| Slot padding | block 6 / inline 3, negative margins to match | `:8609-8613` |
| Tool / chip | 32 × 32 / 32 high; table phone tools 44 (X2) | `:8539`, `:8677-8693`, `:8719-8723` |
| Group gap | 2 | `:8629-8634` |
| Separator | 1 × 20, `--border`, 8 each side (table `.te-sep` 6) | `:8635-8641`, `:5839-5845` |
| Cluster gap | 8 | `:8538`, `:8594` |

### 3.2 History group and seam

`.edit-bar-history` is `role="group"` with `aria-label="History"`
(`_edit_window.html:25`). It holds `#<prefix>-undo`, `#<prefix>-redo`, then the seam
(`:26-45`). The buttons are native `<button type="button">`, icon-only, with
`aria-label` and `title` carrying the chord: `Undo (Ctrl+Z)` and
`Redo (Ctrl+Shift+Z or Ctrl+Y)` (`:26-43`). They start with the native `disabled`
attribute (`:27`, `:37`), so a dead button leaves the tab order.

The seam separates *the document's history* from *this window's actions*
(`style.css:8648-8653`). It is 1 × 24, one step taller than a group separator (20), and
is `aria-hidden`. The history group never scrolls and never moves.

### 3.3 Window actions

The actions slot holds only window-scoped actions. A window supplies one
`.edit-bar-toolbar` with `role="toolbar"` and its own `aria-label`; each group is
`role="group"` with an `aria-label` (`_edit_window.html:47`; Mermaid
`templates/index.html:1469`; DOT/WaveDrom `:1646`). The slot itself carries no role
(`style.css:8602`), so the toolbar landmark is the inner element, not the scroller.

| Window | Inner toolbar | Groups | Content owner |
|---|---|---|---|
| Table | `.te-toolbar` reparented into the slot | six: Rows, Columns, Clipboard, Alignment, Sort, Table | `table-editor.md` |
| Mermaid | `.edit-bar-toolbar` | Canvas mode; Add and chart | `diagram-designers.md` |
| DOT / WaveDrom | `.edit-bar-toolbar` | Build: Add, Chart, Source | `diagram-designers.md` |

The shell fixes only the slot's geometry and behaviour: 32 px items by default, 2 px
inside a group, 8 px between clusters, a 20 px separator, one line. The table's
`.te-tool` is 28 px in its old body rule and 32 px when it sits in the bar
(`style.css:5846-5851`, `:8719-8722`); the shell uses the bar value. The sort select is
32 px high in the bar (`:8723`). The one exception is the table's own phone toolbar:
at ≤520 its tools and sort grow to 44 px (table-editor.md §10.5 E1, X2). The designers
keep 32. The table's `.te-sep` keeps its 6 px side margin; the shell's
`.edit-bar-sep` uses 8 (`:5839-5845`, `:8635-8641`).

Chips are 32 px high, transparent, `0 10px` padding, `.8rem`, radius 6; pressed is
`--accent-soft` face + `--accent` text + a 1 px inset accent ring (`style.css:8677-8703`).
No chip is a placeholder; each one focuses or opens something in the body.

### 3.4 One line, overflow, and the fade

The bar never wraps and never grows a second row. `.edit-bar-actions` is
`overflow-x: auto; overflow-y: hidden`, `white-space: nowrap`, scrollbar hidden, and
every child is `flex: 0 0 auto` (`style.css:8602-8618`). A second row would move the body
down 40 px in the middle of an edit; a scroll costs nothing.

| Rule | Value | Source |
|---|---|---|
| Overflow | horizontal scroll only | `style.css:8607-8608` |
| Scrollbar | hidden (`scrollbar-width: none`, `::-webkit-scrollbar`) | `:8615-8617` |
| Ring slack | 6 px block padding, −6 margin; 3 px inline, −3 margin | `:8609-8613` |
| Fade trigger | `.is-scrollable` when `scrollWidth > clientWidth + 1` | `edit-window.js:76-80` |
| Fade shape | mask gradient, opaque to `100% − 22px`, transparent at the edge | `style.css:8619-8622` |
| Re-check | window `resize` + `ResizeObserver` on the slot | `edit-window.js:310-313` |

The fade is a mask, not a gradient painted over the bar; it works in both themes. It is
not a control: there is no `…` button, no popover and no second row. Keyboard focus on a
hidden tool scrolls it into view natively because the slot is a scroll container.

Measured: the table needs about 950–975 px of toolbar; the slot has about 1092 px at a
1280 px viewport, so it fits and the fade is off. At 1000 and 900 it overflows and the
class is on (`tests/browser/test_table_editor_browser.js:237-292`).

### 3.5 What belongs here, and what does not

| Belongs in the bar | Belongs in the footer | Belongs in the header |
|---|---|---|
| Undo / redo | Status | Title, badge |
| Window actions that change the body's model | Cancel | Maximize, close |
| The table's sort control (a window action) | Apply | — |
| A chip that focuses a body section | The one hint | — |

Never: Apply or Cancel in the bar; history in the header, footer or a sidebar; a title in
the bar; a second toolbar in the body; a `+` reservation or an inert control.

### 3.6 Empty

A window whose actions slot is empty renders no placeholder: the bar keeps its 57 px,
the history pair stays at the left, and `.edit-bar-actions` is a zero-content flex
remainder. The bar does not depend on the slot (archive guide §3.2, still true). The
empty shell board in the mockup shows this.

### 3.7 Focus

Bar buttons, chips and table tools draw `2px solid var(--accent)` at `outline-offset: 1px`
(`style.css:8672`, `:8696`, `:5861-5864`). The slot's 6 px vertical slack exists so the
ring is never clipped. A ring is never removed, and a focused item that sits outside the
visible run scrolls into view.

---

## 4. Footer

### 4.1 Order and geometry

```
[status ………………………………………………………][hint?]  [Cancel]  [Apply]
```

Fixed order: status, optional hint, Cancel, Apply (`templates/_edit_window.html:51-61`).
Apply is last, at the right edge, because it is the commit action. The footer is
`justify-content: flex-end` with the status taking `margin-right: auto`
(`style.css:2257-2265`, `:8731-8733`).

Height is 69 px: 12 top + 44 action + 12 bottom + 1 top border
(`--edit-foot-h`, `--edit-foot-pad-x`, `--edit-foot-gap`, `style.css:8541-8543`,
`:8726-8730`). Actions are 44 high with `0 16px` padding
(`:8741-8748`); the base `.settings-action` supplies the 6 px radius, the raised face,
the border and the `.93rem` label (`:2145-2153`). Apply adds the accent fill,
`--text-on-accent` and weight 600 (`:6549`).

### 4.2 Status line

`#<prefix>-status` is a `<span role="status" aria-live="polite" aria-atomic="true">`
(`_edit_window.html:53-54`). It is the shell's only live region. The blocked-table
notice is a second, static `role="status"` (table-editor.md §3.6); P14 proposes one
announcement. Body-owned live regions (the designer loading message, the inspector head,
the apply alert) are out of this document; the apply alert and the footer status carry the
same sentence, recorded as P13. The status is pushed
left, `flex: 0 1 auto`, `min-width: 0`, one line with ellipsis, `.82rem` / 1.3,
`--text-muted` (`style.css:8731-8740`). The designer adds `.ok` (`--designer-ok`) and `.error` (`--designer-warn`), declared
per theme at `:6545-6547` / `:6156-6161`.

| Window | Ready copy | Dirty | Applying | Failure |
|---|---|---|---|---|
| Table | `Header row · Column 1 of 4`; a range gives `3 × 4 selected, rows 2–4, columns 1–3` | unchanged (selection summary) | not reachable: Apply is synchronous | the history error message, muted |
| Mermaid / DOT | `Ready` | `Unsaved changes` | `Applying…` | `Couldn’t apply — invalid <badge> source`, `.error`, plus a body alert |

Copy comes from `table-editor.js:1894-1912` and `designer-shell.js:26-29`, `:142-146`,
`:461`, `:564`, `:576`, `:585`, `:599`.

The status is never colour alone: it is a full sentence. `.error` uses `--warn` today,
not `--danger`; §12 P4 proposes the change and does not apply it.

### 4.3 Hint

Only the table has a hint: `.te-hint`, text `Esc cancels`, `aria-hidden="true"`
(`templates/index.html:1455`; `style.css:6093-6098`). It is `.78rem`, muted, 8 px left of
Cancel, and hidden at ≤520 px (`:6130`). The designers have no hint; their Cancel carries
the same shortcut via `aria-keyshortcuts` (`_edit_window.html:57`).

A hint repeats a shortcut; it never carries a fact needed to act, and never becomes a
second status region.

### 4.4 Cancel

`#<prefix>-cancel` is a secondary action in every window. It carries
`aria-keyshortcuts="Escape"` (`_edit_window.html:56-57`).

| Window | Behaviour on Cancel |
|---|---|
| Table | Close without writing; no confirm (`table-editor.js:1994-1998`) |
| Mermaid / DOT | If the body reports unsaved changes, `window.confirm` asks to discard; a cancel in the confirm keeps the window open (`designer-shell.js:493-498`) |

Cancel is never disabled at rest. During applying the designers disable it
(`designer-shell.js:573`); the shell re-enables it on every failure path.

### 4.5 Apply

`#<prefix>-apply` is the primary action (`settings-action--primary`). The shell owns its
position and size; the body owns when it is enabled and what it commits.

| Window | Enabled when | Click order |
|---|---|---|
| Table | Always, unless the table is blocked (then hidden **and** disabled) | rebuild → compare with the opening table → flush the editor's pending snapshot → replace the table on the note → rebind the overlay edit control → `onContentChange` → close → caret to the table (`table-editor.js:1967-1992`) |
| Mermaid / DOT | `stateName === "ready" && !applying && !blocked` | set applying → inert the sidebar and inspector → disable Apply and Cancel → sync history → status `Applying…` → serialize → render the candidate into a detached host → replace the fence → render the note card → `onContentChange` → close (`designer-shell.js:561-637`) |

A clean open still shows Apply enabled. The designers' no-op branch sets
`No changes to apply` and closes without writing (`designer-shell.js:563-567`); the table
closes silently when the rebuilt table is identical (`table-editor.js:1979-1982`). A
failed validation or render leaves the window open, restores Apply and Cancel, writes the
error status, shows the body alert, and returns focus to the first inspector field or the
canvas (`designer-shell.js:578-604`, `:551-559`).

The blocked table hides Apply entirely (`table-editor.js:2002-2011`). The designers keep
Apply visible and disabled (`designer-shell.js:162-169`); a hidden control would make the
footer jump.

### 4.6 What Apply does not do

1. It does not write each window history step to the note. One Apply is one note-level
   undo step, whatever the window did (`edit-window.js:13-14`).
2. It does not write before validating. The designers render the candidate into a
   detached host first (`designer-shell.js:591-604`).
3. It does not close on failure, and it does not discard the model.
4. It does not run while blocked, applying, or not ready.
5. It does not persist window geometry; `windows.js` owns that separately.
6. It does not ask to discard. In the designers, Cancel, Close and Esc own the dirty
guard; the table does not guard.
7. It does not keep the window's history; close clears it (`designer-shell.js:516`,
   `table-editor.js:2099`).
8. It does not change the note when nothing changed.

### 4.7 Wrap at 720

At `max-width: 720px` the footer wraps: `row-gap: 6px`; the status takes a full row
(`flex: 1 1 100%`, no auto margin, `white-space: normal`); Cancel and Apply stay on the
next row, right-aligned (`style.css:8751-8754`). Height becomes about 90 px, not 69. The
window's body loses that height; nothing else moves.

At ≤520 the table hint is hidden; the designers never had one. The footer still wraps.

---

## 5. Window geometry

### 5.1 Default box

All three windows are free-floating fixed-position boxes centred with `left/top: 50%`
and `translate(-50%, -50%)` (`style.css:1819-1822`).

| Window | Width | Height | Max | Source |
|---|---|---|---|---|
| Table | `min(--designer-modal-w, 96vw)` = 1320 at ≥1375 | `min(--designer-modal-h, 92vh)` = 85vh | `min(96vw, viewport−24) × min(92vh, viewport−24)` | `style.css:5812-5817`; tokens `:67-68`, `:124-125` |
| Mermaid / DOT | same | same | same | `style.css:6171-6176` |

`--designer-modal-w: 1320px` and `--designer-modal-h: 85vh` are declared in both theme
blocks (`style.css:67-68`, `:124-125`). The table editor deliberately reads the designer
tokens so the two families cannot drift; the archive's `--table-editor-*` names never
shipped.

The Settings width/height preference (`--settings-modal-width/height`, set on `:root` by
`app.js:307-312`) does **not** resize these three windows: the later `.table-editor-modal`
and `.designer-modal` rules win at equal specificity. Only Settings, Export, Auth and
`:help` follow that preference.

### 5.2 Free drag

| Property | Value | Source |
|---|---|---|
| Grab area | the header, minus buttons | `windows.js:143-149` |
| Button | left only | `:149` |
| Edge margin | 12 px on all sides | `windows.js:23`, `:170-171` |
| Geometry | inline `left/top/width/height`, `transform: none` | `:152-159` |
| Save | on pointer up, `{left, top, w, h}` | `:175-182` |
| Maximized | ignored | `:144-146` |

The first press freezes the centred box into explicit pixels, so the drag math is
straight. A press that does not move still saves the box; that is why any header click
turns the window into a persisted explicit size. §12 P11 proposes saving only after
movement; it is not applied.

### 5.3 Resize

`windows.js` appends one `.resize-grip` to every modal (`windows.js:77-84`). It is the
bottom-right corner only; there is no edge or top-left resize.

| Property | Value | Source |
|---|---|---|
| Box | 18 × 18, `right: 2px; bottom: 2px`, z 5 | `style.css:1846-1855` |
| Corner | `border-radius: 0 0 10px 0` | `:1854` |
| Mark | 10 × 10 L bracket, 2 px `--fg-muted`, opacity `.55`, inset 4 | `:1856-1867` |
| Cursor | `nwse-resize` | `:1852` |
| Minimum | 320 × 240 | `windows.js:21-22` |
| Maximum in JS | viewport − 24 | `:68-69` |
| Maximum rendered | `min(96vw, viewport − 24)` × `min(92vh, viewport − 24)`, from the modal's `max-*` rules and the JS clamp | `style.css:1826-1827`; `windows.js:68-69` |
| Save | on pointer up | `windows.js:215-222` |
| Maximized | ignored, and the grip is hidden | `windows.js:198-201`, `style.css:1887` |

The effective maximum is the smaller of the CSS and JS limits. A resize can therefore
make a window **wider than the 1320 default** — up to 96vw on a wide screen — although
the default is capped at 1320. On a narrow screen the JS clamp (`viewport − 24`) is
smaller than 96vw; at 390 the widest saved window is 366.

The grip is pointer-only: a `div` with a `title`, no `tabindex`, no role
(`windows.js:79-83`). §12 P10 proposes a keyboard path; it is not applied.

### 5.4 Maximize and restore

Maximize is transient and never persisted (`windows.js:25-28`).

| Property | Value | Source |
|---|---|---|
| Class | `.settings-modal--max` | `windows.js:28`, `style.css:1877` |
| Geometry | `left/top 0`, `width/height 100vw/100vh`, `transform: none`, radius 0, `!important` | `style.css:1877-1886` |
| Max | `100vw × 100vh` | `:1883-1884` |
| Grip | hidden | `:1887` |
| Drag / resize | ignored | `windows.js:144-146`, `:198-201` |
| Toggle | click the maximize button, or double-click the header away from a button | `windows.js:120`, `:190-193` |
| Label | `Maximize` → `Restore`; `aria-pressed` false → true | `:87-95` |
| Reset | any `hidden` attribute change on the overlay resets it | `:246-256` |

Because the class uses `!important`, it wins over the inline saved geometry. Esc closes
the window; it does not restore a maximized window first. Closing resets the class, so
the next open is back to the saved or default box.

### 5.5 Persistence

| Property | Value | Source |
|---|---|---|
| Storage | `localStorage["nb:windowGeometry"]` | `windows.js:20` |
| Shape | `{ "<overlay-id>": { left, top, w, h } }` | `:55-58`, `:180` |
| Written | drag end, resize end | `:180`, `:220` |
| Read | at wiring, and 150 ms after a window resize | `:238`, `:272-281` |
| Clamp on read | `left/top` are clamped against the 320 × 240 minimum only (`windows.js:66-67`); the saved `w/h` are not clamped to the viewport, and the resize handler has no viewport maximum (`:210-211`). A restored or resized window can extend off-screen. P15 records the fix | `:60-75`, `:210-211` |
| Applied as | inline pixels + `transform: none` | `:70-74` |
| Maximize | not stored; reset on close | `:25-28`, `:250-255` |

Keys are the overlay ids: `table-editor-overlay`, `designer-overlay`,
`dw-designer-overlay` (`templates/index.html:1321`, `:1464`, `:1641`). A missing entry
leaves the CSS-centred default. There is no reset-geometry control; §12 P9 proposes one.

Any later open of the same overlay reuses the saved box. A window saved at 1600 × 900
opens at `min(1600, 96vw, viewport−24)` on a smaller screen, because both the JS clamp
and the CSS max apply; the JS writes the clamped pixel size, the CSS caps it at 92vh.

### 5.6 Zoom and small screens

Geometry is px, not rem. Browser zoom changes the viewport, not the window's saved
pixels; `--font-scale` changes text only. At 200 % zoom the viewport narrows, the phone
shell takes over below 861, and the window follows the 96vw/92vh clamps. The body is the
only scroller, so no chrome row grows and no page scrollbar appears.

At `--font-scale: 1.3` the header title ellipsizes, the badge truncates, the status
ellipsizes and the bar scrolls. The 65 / 57 / 69 rows do not grow; the 44 / 32 controls
have fixed px boxes.

---

## 6. History contract

### 6.1 One surface, two controller kinds

History lives only in the bar's pinned pair. A window attaches once through
`NB.editWindow.attach()` (`edit-window.js:48-66`).

| Window | Mode | Controller | Why |
|---|---|---|---|
| Table | stack | `snapshot()` / `restore()` (`table-editor.js:2119-2129`) | Restore rebuilds the grid and the cell model |
| DOT / WaveDrom | stack | the language controller (`designer-shell.js:104-125`) | Restore repaints the preview |
| Mermaid | delegate | Visimer `undo()` / `redo()` (`mermaid-designer.js:381-399`) | Visimer already owns a stack; a second would diverge |

Never run two stacks.

### 6.2 Enablement

| Rule | Detail |
|---|---|
| Enabled source | `enabled()` **and** the controller's `canUndo()` / `canRedo()` (`edit-window.js:82-110`) |
| Attribute | native `disabled`, never `aria-disabled` (`:107-108`) |
| Dead buttons | leave the tab order; the pair never hides |
| Clean open | both dead |
| Applying | both dead (designers) (`:104-108`; `designer-shell.js:574`) |
| Blocked / read-only | both dead (table and designers) |

### 6.3 Chords and ownership

| Surface | `Mod+Z` | `Mod+Shift+Z` / `Mod+Y` |
|---|---|---|
| Table, every target | window | window |
| Designer fields, selects, contenteditable | native | native |
| Mermaid canvas | Visimer | `Ctrl+Y` window; `Ctrl+Shift+Z` Visimer |
| Any other target | window | window |

The engine listens on the document while the window is open (`edit-window.js:297-308`).
`ownsKey` decides who gets the chord; `isEditable()` is the single copy of the
"native undo owns this target" guard (`:37-46`). The table claims it everywhere because
committing a cell kills native undo; the Mermaid canvas keeps the vendor's chords except
`Ctrl+Y`.

`Mod` formats as `Ctrl` on Windows/Linux and `Cmd` on macOS; the label in the button is
the only place the chord is named (`_edit_window.html:27`, `:36-37`).

### 6.4 Coalescing and caps

| Rule | Value | Source |
|---|---|---|
| Coalescing window | 350 ms | `edit-window.js:21` |
| Coalesces | text edits only, and only at the top of the stack | `:146-150` |
| Never coalesces | structural steps | `:146` |
| Break | `breakCoalesce()` at a cell/field boundary; undo and redo reset it | `:199-204` |
| Identical snapshot | ignored | `:145` |
| Redo tail | dropped by a new step | `:152` |
| Cap | 100 snapshots including the opening one | `:20`, `:157-161` |
| Size cap | 4 M characters total | `:22`, `:112-125` |
| Eviction | oldest first; never the current entry | `:119-124` |
| Seed | `reset()` on open, after mount | `:169-187` |
| Clear | on close | `:189-197` |
| Restore | repaints, syncs Apply and status, never captures itself | `:206-273` |

### 6.5 What is not undoable

- Apply, Cancel, Close, Esc, maximize, drag and resize.
- Window geometry and the transient maximized class.
- The status text.
- Selection and scroll. A designer may clear a stale selection after a restore
  (`mermaid-designer.js:392-399`); that is a consequence of a step, not a step.
- Any note edit made before the window opened. Apply is one note-level step against the
  note's own history.

---

## 7. States

### 7.1 State matrix

| State | Header | Bar | Footer | Body |
|---|---|---|---|---|
| **Ready — table** | title + `Table` | history dead; actions live | status = selection summary; Apply enabled | grid, first cell focused |
| **Ready — designer** | title + type | history dead; actions per body state | `Ready`; Apply enabled | mounted, canvas focused |
| **Dirty** | unchanged | undo live | designer `Unsaved changes`; table keeps the summary | model changed |
| **Applying** (designers) | unchanged | history dead | `Applying…`; Apply + Cancel disabled | sidebar/inspector inert; body spinner or frozen preview |
| **Error** (designers) | unchanged | history back | `.error` copy; Apply enabled | alert card; focus to first inspector field or canvas |
| **Blocked** (table) | unchanged | tools `aria-disabled`; history dead | notice copy; Apply **hidden**; Cancel focused | notice strip + read-only grid |
| **Read-only** (DW designer) | unchanged | actions that cannot write disabled | Apply disabled | `Read-only diagram` state |
| **No selection** | unchanged | unchanged | unchanged | inspector `Nothing selected` |
| **Empty** | badge collapsed | actions slot empty | status empty | body-owned |
| **Maximized** | restore glyph | unchanged | unchanged | fills the viewport; grip hidden |

### 7.2 The states in words

**Ready.** The window opens at its saved or default box. The bar shows both history
buttons dead. The table's Apply is enabled even on a clean open; the designers' Apply
becomes enabled once the model is ready. The table focuses the first cell; the designers
focus the canvas (`table-editor.js:2041-2050`, `designer-shell.js:463`).

**Applying.** Designers only. Apply and Cancel are disabled, the history pair goes dead,
the sidebar and inspector are `inert`, and the status reads `Applying…`
(`designer-shell.js:570-576`). The header ×, the backdrop and Esc are also inert: all three
call `close()`, which returns early while applying (`designer-shell.js:495`). The controls
stay visible and look live. P16 proposes disabling them or allowing a cancel. The table's
apply is synchronous, so it has no applying state.

**Error.** A failed serialize or render leaves the window open with the model intact,
re-enables Apply and Cancel, writes the `.error` status and shows the body alert
(`designer-shell.js:578-604`). The table writes a history failure into its muted status
(`table-editor.js:2119-2129`).

**Blocked.** A table with merged cells opens read-only: a notice strip directly under the
bar (owned by `table-editor.md`), Apply hidden and disabled, `aria-readonly="true"` on the
grid, tools `aria-disabled`, the status message, and focus on Cancel
(`table-editor.js:2002-2011`, `:2044-2047`). The shell's part is the absent Apply and the
focus target.

**Read-only.** The DOT/WaveDrom window can open a block with no editable model; the body
shows `Read-only diagram` with a path to the source editor, and Apply is disabled
(`templates/index.html:1719-1725`, `designer-shell.js:420-429`). The Mermaid designer routes a
non-editable type to its error state instead (`diagram-designers.md` §5.4), so this row is
DW-only. The shell is unchanged.

**No selection.** A designer with nothing selected keeps the inspector header
`Nothing selected`; no shell control changes (`templates/index.html:1621`).

**Empty.** Three empty slots are legal and must not collapse the layout: an empty badge
(`display: none`), an empty actions slot (no placeholder), an empty status (zero width,
still `margin-right: auto`). See §2.2, §3.6, §4.2.

---

## 8. Keyboard and ARIA

### 8.1 Roles and attributes

| Element | Contract | Source |
|---|---|---|
| Overlay | no role; `[hidden]` when closed | `style.css:1387` |
| Modal | `role="dialog" aria-modal="true" aria-labelledby="<prefix>-title"`; `tabindex="-1"` (table in markup; designers added by `dialog.js`) | `templates/index.html:1322-1323`, `:1465-1466`, `:1642-1643`; `dialog.js:102-106` |
| Header | no landmark; `<h2>` names the dialog | `_edit_window.html:16` |
| Maximize | `<button>`, dynamic `aria-label` + `title`, `aria-pressed` | `windows.js:113-120`, `:87-95` |
| Close | `<button>`, `aria-label="Close"`, `title="Close"` | `_edit_window.html:19` |
| Bar | no role on the scroller; inner `role="toolbar"` with a name | `style.css:8602`; `index.html:1326`, `:1469`, `:1646` |
| Group | `role="group"` with a name | `index.html:1327`, `:1470`, `:1647` |
| History | `role="group" aria-label="History"`; buttons named with chords | `_edit_window.html:25-44` |
| Seam, separators, hint | `aria-hidden="true"` | `:45`; `:55` |
| Status | `role="status" aria-live="polite" aria-atomic="true"` | `:53-54` |
| Cancel | `aria-keyshortcuts="Escape"` | `:57` |
| Grip | a `div` with `title`, no role, no tab stop | `windows.js:79-83` |

The table modal already has `tabindex="-1"` in markup. The designer and DOT modals do
not, but `NB.dialog.open()` adds it when the container is the initial focus target
(`dialog.js:102-106`); the behaviour is the same.

### 8.2 Focus order

DOM order, no positive `tabindex`:

`[maximize] → [close] → [undo] → [redo] → bar actions → body → Cancel → Apply`

Undo/redo are skipped while disabled. The bar's controls are in DOM order; a focused
control scrolls into view. The maximize button is first because `windows.js` inserts it
before close and the header precedes the bar; the browser test's "first" edge is
therefore not close (`tests/browser/test_table_editor_browser.js:295-298`).

Initial focus is body-owned: the table's first cell (`table-editor.js:2048`), Cancel when
blocked (`:2046`), and the designers' canvas (`designer-shell.js:463`, `:317-321`). The
dialog container is the fallback target for the trap (`dialog.js:62-72`).

### 8.3 Containment and return

`NB.dialog.open()` makes every other direct body child `inert`, wraps `Tab` and
`Shift+Tab` at both ends (the container counts as an end), and moves initial focus
(`dialog.js:46-107`). `NB.dialog.close()` clears the flags and returns focus to the
invoker if it is still usable, else to the `fallbackFocus`
(`dialog.js:110-119`, `:25-32`).

| Window | Fallback / return |
|---|---|
| Table | The overlay entry button if it still exists; otherwise the first cell via a collapsed range. Apply always lands in the cell so `Ctrl+Z` reaches the hybrid dispatcher (`table-editor.js:2080-2092`, `:2063-2075`) |
| Mermaid / DOT | The rendered block, not a context-menu row that close destroys (`designer-shell.js:478-483`, `:323-334`) |

The close paths never intentionally leave focus on `<body>`. A closing animation does not
exist, so focus returns immediately.

### 8.4 Esc

`Esc` closes the topmost layer, then the window. The body may consume the first press.

| Window | Order |
|---|---|
| Table | clear an in-progress fill → collapse a multi-selection → cancel the window (`table-editor.js:583-596`, `:506-514`) |
| Mermaid / DOT | close the compact sheet → close the window; the dirty guard may keep it open (`designer-shell.js:665-674`, `:493-498`) |

The backdrop does the same: clicking the overlay closes the window. The table calls
`cancel()` (`table-editor.js:2131-2133`); the designers call `close(false)` and therefore
ask to discard when dirty (`designer-shell.js:717-718`, `:493-498`). Esc is the only exit
that works from anywhere in the window without a pointer.

### 8.5 Enter

`Enter` never commits the window. The shell binds no Enter handler; there is no
`aria-keyshortcuts` for Apply. Inside the body, Enter does its native job: the table
starts or commits a cell edit (`table-editor.js:500-505`), a designer field submits its
own add form, and a textarea inserts a newline. Apply is pointer or keyboard-activated
only when focus is on the Apply button.

### 8.6 Ring

| Control | Ring today | Target |
|---|---|---|
| Bar button, chip, table tool | 2 px accent, offset 1 (`style.css:8672`, `:8696`, `:5861`) | unchanged |
| Header maximize / close | **none** | X1: the same 2 px accent at offset 1 |
| Footer Cancel / Apply | **none** in an edit window; Settings has a scoped rule (`:1548`) | X1: the same 2 px accent at offset 1 |
| Grip | none; not focusable | proposal P10 |

The bar's 6 px vertical slack keeps the ring inside the 57 px row. The header has 10 px
and the footer 12 px, so offset 1 is not clipped.

### 8.7 Screen-reader story

A reader hears the dialog name from the `<h2>`, then the toolbar groups by name, then the
body. The history buttons announce the chord in the accessible name. The footer's status
is the shell's polite live region; body-owned regions may also speak (loading, selection,
the apply alert, the blocked notice), but no two should repeat each other. The apply alert
and the footer status are one known duplicate (P13); the blocked notice and the footer are
the other (P14). The badge is text, not a control. The fade is not announced and is not a
control.

---

## 9. Responsive

### 9.1 Width table

| Width | Window | Bar | Footer | Body |
|---|---|---|---|---|
| ≥ 1375 | 1320 × 85vh | one line; table slot fits | one row 69 | table grid or wide designer |
| 1280 | 1228.8 wide | one line; table slot fits | one row | table grid or wide designer |
| 1000 | 960 wide | table slot overflows; fade on | one row | table grid |
| 861 | 826.6 wide | slot overflows; fade on | one row | desktop shell; designer already compact (≤960) |
| 720 | 691.2 wide | slot overflows; fade on | **wraps**: status own row, then Cancel/Apply; ~90 | table grid; designers compact |
| 520 | table 520 × 100vh, radius 0 (no saved box; §9.5); designers 499.2 × 85vh, radius 12 | slot overflows | wrapped | table grid; designer compact |
| 390 | table 390 × 100vh (no saved box; §9.5); designers 374.4 × 85vh | slot overflows; 44 history; 44 table tools (X2), 32 designer tools | wrapped; table hint hidden | table grid; designer compact |

At ≤860 the app is the phone shell (`style.css:6975`), but the modal keeps its own
width-based rules. The overlay covers the phone topbar and rail; the window sits above
them at z 2000 (`:1369-1373`).

### 9.2 What collapses, and what does not

- **Header**: never. The title ellipsizes; the two 44 px controls stay.
- **Bar**: never wraps. The actions scroll; the history pair stays.
- **Footer**: wraps at 720 only; the actions stay 44.
- **Body**: the only region that gives up height.
- **Designer body**: becomes a horizontal build strip at ≤960 (scoped families) or ≤720
  (unscoped) and the inspector becomes a bottom sheet — body-owned
  (`style.css:6560-6610`, `:6615-6632`, `:6923-6940`). The chrome above and below does not
  change.
- **Table body**: the grid scrolls; the notice strip sits above it (table-owned).

### 9.3 The phone presentation

At ≤520 the **table** becomes full screen: `100vw × 100vh`, `max-*` 100vw/vh, radius 0
(`style.css:6122-6129`), and the `Esc cancels` hint is hidden (`:6130`). The table's bar
tools and sort also grow to 44 px at this width (X2, table-editor.md §10.5 E1); the
designers keep 32. The 65 / 57 / footer rows remain; the footer wraps because the phone
is also ≤720.

The **designers do not** go full screen. They remain a centred 96vw × 85vh rounded
dialog with a 12 px radius. There is no 520 rule for `.designer-modal`. This contradicts
the brief's "edit windows go full-screen at 520"; the code is the truth. §12 P2 proposes
either matching the table or making the difference explicit.

At 390 the table is 390 × 100vh when no saved box exists; the designers are 374.4 wide
by 85vh. The maximize button
still gives either window the full viewport in one press.

### 9.4 Known deviations from the archive

| Archive claim | Shipped truth | Where |
|---|---|---|
| History on the left, actions on the right | Yes, but the **markup** puts history first and the CSS comment at `style.css:8588` still says the left slot scrolls | `_edit_window.html:24-48`; `style.css:8588` |
| All edit windows go full screen at ≤520 | Only the table does; the designers stay rounded at 96vw | `style.css:6122-6131`; no designer 520 rule |
| The table slot needs 973 px and fits at 1280 | About 950–975 px; it fits at 1280 and fades at 1000 / 900 | `tests/browser/test_table_editor_browser.js:237-292`; table-editor.md §4.1 |

### 9.5 The 520 cascade caveat

Saved geometry is inline and wins over the non-important `100vw/100vh` rule. A table
editor that has ever been dragged or resized opens at its saved pixel width (clamped to
the viewport) on a phone, **not** full screen. The full-screen rule is effective only
when no saved geometry exists. §12 P1 proposes the fix; the current document describes
the condition rather than claiming unconditional full screen.

A related detail: a header press that does not move still writes geometry on pointer up
(`windows.js:175-182`), so a single click can create the saved box that defeats the 520
rule.

---

## 10. Tokens and CSS target

### 10.1 Tokens

The shell already declares its component tokens on the three overlays
(`style.css:8526-8545`). They are numbers, not aliases; no foundation token is
redefined.

| Need | Token | Value | Reuse |
|---|---|---|---|
| Header row | `--edit-head-h` | 65px | component (10 + 44 + 10 + 1) |
| Header padding-x | `--edit-head-pad-x` | 18px | component |
| Header gap | `--edit-head-gap` | 10px | component |
| 44 px control | `--edit-icon` | 44px | equals `--control-h-touch` |
| Control gap | `--edit-icon-gap` | 2px | equals `--space-hair` |
| Seam | `--edit-seam-h` | 24px | equals `--space-6` |
| Bar row | `--edit-bar-h` | 57px | component (6 + 44 + 6 + 1) |
| Bar padding | `--edit-bar-pad-x/y` | 12 / 6 | component |
| Cluster gap | `--edit-bar-gap` | 8px | equals `--space-2` |
| Tool / chip | `--edit-bar-tool` | 32px | equals `--control-h-body` |
| Group separator | `--edit-bar-sep-h` | 20px | component |
| Footer row | `--edit-foot-h` | 69px | component (12 + 44 + 12 + 1) |
| Footer padding-x | `--edit-foot-pad-x` | 18px | component |
| Footer gap | `--edit-foot-gap` | 8px | equals `--space-2` |
| Badge cap | `--edit-badge-max` | 120px | component |
| Box width | `--designer-modal-w` | 1320px | component, both themes |
| Box height | `--designer-modal-h` | 85vh | component, both themes |
| Scrim | `--overlay-scrim` | rgba(0,0,0,.5) | foundation |
| Modal shadow | `--shadow-modal` | 0 20px 60px … | foundation |
| Overlay z | `--z-modal` | 2000 | foundation |
| Radius | `--radius-lg` / `--radius-sm` | 12 / 6 | foundation |
| Focus | `--focus-ring` | 2px solid `--accent` | foundation |
| Muted text | `--text-muted` | — | foundation |
| Raised face | `--surface-raised` | — | foundation |

The 44 / 32 / 24 / 8 values are pixel-identical to foundations §5 and §10 tokens. The
component names stay declared because the shell reads one family; using the foundation
names in new declarations is equally correct.

### 10.2 Rules, in landing order

The shipped rules are the target. Keep this order; do not reorder the existing
declarations. The only spelling change is the base tier to the semantic tier, which
resolves to the same value in both themes (foundations §2.3).

**1. Component tokens, on the three overlays** (`style.css:8526-8545`):

```css
#table-editor-overlay,
#designer-overlay,
#dw-designer-overlay {
  --edit-head-h: 65px;
  --edit-head-pad-x: 18px;
  --edit-head-gap: 10px;
  --edit-icon: 44px;
  --edit-icon-gap: 2px;
  --edit-seam-h: 24px;
  --edit-bar-h: 57px;
  --edit-bar-pad-x: 12px;
  --edit-bar-pad-y: 6px;
  --edit-bar-gap: 8px;
  --edit-bar-tool: 32px;
  --edit-bar-sep-h: 20px;
  --edit-foot-h: 69px;
  --edit-foot-pad-x: 18px;
  --edit-foot-gap: 8px;
  --edit-badge-max: 120px;
}
```

**2. Backdrop and box** (`style.css:1369-1387`, `:1801-1840`):

```css
:where(body) > .settings-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  z-index: var(--z-modal);
  min-width: 0;
  min-height: 0;
}
:where(body) > .settings-overlay[hidden] { display: none; }

:where(body > .settings-overlay) > .settings-modal {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  flex: 0 0 auto;
  width: min(var(--settings-modal-width, 75vw), 96vw);
  height: min(var(--settings-modal-height, 80vh), 92vh);
  max-width: 96vw;
  max-height: 92vh;
  background: var(--surface-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: none;
}

.table-editor-modal {
  width: min(var(--designer-modal-w), 96vw);
  height: min(var(--designer-modal-h), 92vh);
  max-width: 96vw;
  max-height: 92vh;
}
.designer-modal {
  width: min(var(--designer-modal-w), 96vw);
  height: min(var(--designer-modal-h), 92vh);
  max-width: 96vw;
  max-height: 92vh;
  container-type: inline-size;
  container-name: designer;
}
```

**3. Maximize and grip** (`style.css:1841-1887`):

```css
:where(body > .settings-overlay > .settings-modal) .settings-header { cursor: move; }

:where(body > .settings-overlay) > .settings-modal .resize-grip {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  z-index: 5;
  border-radius: 0 0 10px 0;
}
:where(body > .settings-overlay) > .settings-modal .resize-grip::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 10px;
  height: 10px;
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
  opacity: .55;
  border-bottom-right-radius: 2px;
}

:where(body > .settings-overlay) > .settings-modal .win-max { display: inline-flex; align-items: center; padding: 4px 6px; }
:where(body > .settings-overlay) > .settings-modal .win-max svg { display: block; }
:where(body > .settings-overlay) > .settings-modal .win-max .win-max-restore { display: none; }
:where(body > .settings-overlay) > .settings-modal .win-max[aria-pressed="true"] .win-max-icon { display: none; }
:where(body > .settings-overlay) > .settings-modal .win-max[aria-pressed="true"] .win-max-restore { display: block; }

:where(body > .settings-overlay > .settings-modal).settings-modal--max {
  left: 0 !important;
  top: 0 !important;
  transform: none !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: 100vw !important;
  max-height: 100vh !important;
  border-radius: 0;
}
:where(body > .settings-overlay > .settings-modal).settings-modal--max .resize-grip { display: none; }

.modal-dragging,
.modal-resizing { user-select: none !important; }
.modal-dragging .settings-header,
.modal-resizing .settings-header { cursor: grabbing; }
```

**4. Header** (`style.css:1897-1913`, `:8549-8586`):

```css
:where(body > .settings-overlay > .settings-modal) .settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.edit-header { gap: var(--edit-head-gap); padding: 10px var(--edit-head-pad-x); min-height: var(--edit-head-h); }
.edit-heading { flex: 1 1 auto; min-width: 0; overflow: hidden; display: flex; align-items: baseline; gap: 10px; }
.edit-heading h2 {
  flex: 0 1 auto; min-width: 0; margin: 0;
  font-size: 1.14rem; font-weight: 600; letter-spacing: .3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.edit-badge { flex: 0 0 auto; max-width: var(--edit-badge-max); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.edit-badge:empty { display: none; }
.edit-header .icon-btn { width: var(--edit-icon); height: var(--edit-icon); font-size: 1.35rem; border-radius: var(--radius-sm); }
:where(body > .settings-overlay > .settings-modal) .settings-header-actions {
  display: flex; align-items: center; gap: var(--edit-icon-gap); flex-shrink: 0;
}
```

**5. Bar** (`style.css:8591-8674`):

```css
.settings-modal .edit-bar {
  display: flex; align-items: center; gap: var(--edit-bar-gap);
  min-height: var(--edit-bar-h);
  padding: var(--edit-bar-pad-y) var(--edit-bar-pad-x);
  background: var(--surface-raised);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto; min-width: 0;
}
.edit-bar-history { flex: 0 0 auto; display: flex; align-items: center; gap: var(--edit-bar-gap); }
.edit-bar-seam { flex: 0 0 auto; width: 1px; height: var(--edit-seam-h); background: var(--border); }
.edit-bar-actions {
  flex: 1 1 auto; min-width: 0; display: flex; gap: var(--edit-bar-gap);
  overflow-x: auto; overflow-y: hidden;
  padding-block: 6px; margin-block: -6px;
  padding-inline: 3px; margin-inline: -3px;
  white-space: nowrap; scrollbar-width: none;
}
.edit-bar-actions::-webkit-scrollbar { display: none; }
.edit-bar-actions > * { flex: 0 0 auto; }
.edit-bar-actions.is-scrollable {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
}
.edit-bar-toolbar { display: flex; align-items: center; gap: var(--edit-bar-gap); min-width: 0; }
.edit-bar-group { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.edit-bar-sep { flex: 0 0 auto; width: 1px; height: var(--edit-bar-sep-h); background: var(--border); margin: 0 var(--edit-bar-gap); }
.edit-bar-btn {
  appearance: none; background: none; border: 0; padding: 0;
  width: var(--edit-icon); height: var(--edit-icon);
  border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-muted); font: inherit; line-height: 1; cursor: pointer; flex: 0 0 auto;
}
.edit-bar-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--accent-soft); }
.edit-bar-btn:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
.edit-bar-btn:disabled { opacity: .4; cursor: not-allowed; }
.edit-bar-btn svg { display: block; }
```

`.edit-chip`, `.te-toolbar` in the bar, `.te-tool` and `.te-sort-col` keep their shipped
rules at `style.css:8677-8703` and `:8707-8723`. Do not raise the 32 px size on desktop;
the table's phone toolbar is the one 44 px exception (X2).

**6. Footer** (`style.css:2257-2265`, `:8726-8748`):

```css
:where(body > .settings-overlay > .settings-modal) .settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--edit-foot-gap);
  padding: 12px var(--edit-foot-pad-x);
  border-top: 1px solid var(--border);
  background: var(--surface-panel);
  flex-shrink: 0;
  align-items: center;
  min-height: var(--edit-foot-h);
}
.edit-footer > [role="status"] {
  margin-right: auto; flex: 0 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: .82rem; line-height: 1.3;
}
.edit-footer .settings-action {
  min-height: 44px; padding: 0 16px;
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto;
}
```

**7. Media** (`style.css:8751-8754`, `:6122-6131`):

```css
@media (max-width: 720px) {
  .edit-footer { flex-wrap: wrap; row-gap: 6px; }
  .edit-footer > [role="status"] { flex: 1 1 100%; margin: 0; white-space: normal; }
}
@media (max-width: 520px) {
  .table-editor-modal {
    width: 100vw; height: 100vh;
    max-width: 100vw; max-height: 100vh;
    border-radius: 0;
  }
  .table-editor-modal .te-hint { display: none; }
}
```

**8. Exceptions X1–X2** at the end of the shell block — see §10.4.

### 10.3 Rules that must not move

- Header, bar and footer heights: 65 / 57 / 69.
- The bar is a sibling of the body, never a child.
- History before actions in the DOM; seam last inside the history group.
- Close last in the header; maximize injected before it.
- Apply last in the footer; status pushed left.
- The 32 px bar tools on desktop and the 44 px chrome controls; X2 is the table's
  phone-only exception.
- The fade, not a menu and not a second row.
- The 12 px radius, `--shadow-modal`, `--z-modal`.
- Maximize as a transient class that ignores drag/resize and resets on close.

### 10.4 Exceptions applied

Two additions. X1 changes a pixel only while a control has keyboard focus. X2 changes
the table's phone bar only; desktop is untouched.

| # | Exception | Why | Implementation | Tests |
|---|---|---|---|---|
| **X1** | Header maximize/close and footer Cancel/Apply draw the bar's focus ring | These controls are Tab stops with no visible ring today (`style.css:1345-1355`, `:2145`; the only `.settings-action` ring is scoped to Settings, `:1548`) | `outline: var(--focus-ring); outline-offset: 1px;` on `.edit-header .icon-btn:focus-visible, .edit-footer .settings-action:focus-visible`, appended to the shell block | New DOM/browser check; no existing test asserts no ring |
| **X2** | At ≤520 the table's bar tools and sort select are 44 px | Shipped 32 px is below the 44 px coarse-pointer floor (foundations §10.4). Adopted from table-editor.md §10.5 E1; the table owns the toolbar | `.table-editor-modal .edit-bar .te-tool { width: var(--control-h-touch); height: var(--control-h-touch); }` and `.te-sort-col { height: var(--control-h-touch); }` inside the ≤520 query. The bar stays 57 = 6 + 44 + 6 + 1. The designers keep 32 | New browser check at 390; table-editor.md draws it on its phone board |

The bar's 1 px ring offset is kept for now; §12 P5 proposes moving the whole shell to the
foundation's 2 px offset. The table's 44 px phone rule is a table-owned exception; a
future window that wants 44 px at ≤520 adds its own scoped rule, not a higher default.

---

## 11. Acceptance criteria

| # | Criterion | Where | Observable |
|---|---|---|---|
| **AC1** | The shell is one anatomy and the three heights are exact | `static/css/style.css`, `templates/_edit_window.html` | At 1280 an open edit window measures header 65, bar 57, footer 69; DOM order is header → `.edit-bar` → body → `.edit-footer`; the bar is not inside the body. `tests/browser/test_table_editor_browser.js:198-226` |
| **AC2** | The header ends `[maximize][close]`; close is last | `_edit_window.html`, `windows.js` | Header direct children are `[heading, .settings-header-actions]`; the cluster is `[.win-max, #<prefix>-close]` in that order. `tests/dom/test_dom.js:27371-27404` |
| **AC3** | A new header control never lands after close | `_edit_window.html` | Close remains the final `<button>` in `edit_header()`; the maximize injection still finds it |
| **AC4** | The bar is one line and the fade tracks overflow | `style.css`, `edit-window.js` | At 1280 the table slot fits and `.is-scrollable` is off; at 1000 and 900 it is on; no second row at any width. `tests/browser/test_table_editor_browser.js:237-292` |
| **AC5** | History is one pinned pair with a seam, before the actions | `_edit_window.html`, `style.css` | `.edit-bar-history` is the first bar child, holds undo, redo and the seam; both buttons are native-disabled on open; the seam is `aria-hidden`. `tests/browser/test_designer_browser.js:228-266` |
| **AC6** | The footer order and live region are exact | `_edit_window.html` | Buttons are `Cancel, Apply` in DOM order; the footer is the window's live status; the blocked notice is a second static `role="status"` (P14); the table has the `Esc cancels` hint, the designers do not. `tests/browser/test_dw_designer_browser.js:348-366` |
| **AC7** | Footer wrap at 720 | `style.css` | At 720 the status is a full row and Cancel/Apply sit on the next row; the footer is ~90 high; at 721 it is one row. |
| **AC8** | The default box is 1320 × 85vh, capped at 96vw × 92vh | `style.css` | At 1400 the window is 1320 wide; at 1000 it is 960; the designers are the same. |
| **AC9** | Drag and resize persist | `windows.js` | Drag the header +60/+50: inline left/top move by that; resize +60/+50: width/height grow; `nb:windowGeometry[<overlay-id>]` holds `{left,top,w,h}`; min 320 × 240. `tests/dom/test_dom.js:27265-27303`. Off-screen clamping is P15, not today |
| **AC10** | Maximize is transient and ignores gestures | `windows.js`, `style.css` | Click adds `.settings-modal--max`, label `Restore`, `aria-pressed="true"`, grip hidden; drag/resize do not change geometry; closing resets. `tests/dom/test_dom.js:27310-27560` |
| **AC11** | History is dead on open, live after a change, and coalesces text | `edit-window.js`, the three controllers | Both buttons disabled at open; one change enables Undo; 350 ms of text edits is one step; structural edits never coalesce; apply clears on close. `tests/browser/test_designer_browser.js:264-300`; new table test for the coalescing boundary |
| **AC12** | Apply commits once, or not at all | the three controllers | Designers: no-op reports `No changes to apply` and closes without writing; applying disables Apply and Cancel and writes `Applying…`; a failure keeps the window open with `.error`; success writes one note-level step. Table: unchanged table closes without writing. `tests/browser/test_designer_browser.js:205-215`; `tests/browser/test_table_editor_browser.js:408-466` |
| **AC13** | Keyboard containment, Esc and Enter | `dialog.js`, the three controllers | Tab and Shift+Tab wrap at both ends; background is inert; Esc closes (after the body's layers); Enter never applies; focus returns to the overlay entry button when it survives, else the table cell, and to the block for the designers. `tests/browser/test_table_editor_browser.js:295-356`; `tests/browser/test_designer_browser.js:416` |
| **AC14** | The two exceptions land | `style.css` | Header and footer controls show the 2 px accent ring on `:focus-visible`; at 390 the table's bar tools and sort measure 44 and the bar still measures 57; the designers' bar measures 32. New DOM/browser checks in `tests/dom/test_dom.js` and `tests/browser/test_table_editor_browser.js` |
| **AC15** | Responsive truth | `style.css` | At 861 the table slot fades; at 720 the footer wraps; at 520 the table is full screen **only without saved inline geometry**, and the designers are 96vw × 85vh; at 390 the same, with the hint hidden and the table's 44 px tools (X2). New browser measurements |
| **AC16** | The mockup is self-contained and covers the twelve boards, in dark and light | `docs/ui/edit-window-mockup.html` | Opening it offline makes zero network requests; the empty shell, the table, the designer, maximized, 720, the 390 pair, applying, error, blocked, the focus detail and the light board are present; the theme toggle re-scopes every board. |

---

## 12. Proposals, not applied

Each row changes something visible or adds an interaction. None is part of this pass.

| # | Proposal | Current | Why | Visual delta |
|---|---|---|---|---|
| **P16** | Disable the header ×, backdrop and Esc during applying, or allow cancel | They look live but `close()` returns early | Visible state only |
| **P15** | Clamp the restored `w/h` to the viewport and clamp every resize to the viewport, keeping a 12 px edge | `windows.js:60-75`, `:210-211` | A saved or resized window can open or grow with its close control off-screen | Behaviour only |
| **P1** | Make the table's 520 full-screen rule win over saved geometry (clear inline size/position at the breakpoint, or add `!important` to the 100vw/vh rule) | Inline saved width/height wins; a previously dragged table stays a 12 px-margined box on a phone | The intended phone presentation is full screen; the cascade silently defeats it | Phone only, for windows with saved geometry |
| **P2** | Decide the designers' phone presentation: full screen at ≤520 like the table, or keep the rounded 96vw × 85vh dialog and document it | Table full screen, designers rounded | The brief assumes one rule; the code has two | Phone only |
| **P3** | Use `100dvh` instead of `100vh` for the maximize class and the table full-screen rule | `100vh` | Mobile browser chrome overlays the bottom of a `100vh` box | Phone only; the box follows the visible viewport |
| **P4** | Error status uses `--danger` (`designer-status.error`) | `--warn` | Error is not a warning; both clear contrast. Colour is already paired with a full sentence | Amber → red on error only |
| **P5** | Unify the shell's focus offset on `var(--focus-offset)` 2 | Bar/chips/tools use 1; X1 uses 1 | One ring geometry in the window; foundations §10.2 default is 2 | 1 px further out on every bar ring |
| **P6** | Unify disabled opacity on `--opacity-disabled` .45 | History .4, footer .5, chips .45 | One disabled look; controls D5 | ±.05 on some controls |
| **P7** | Replace the close `×` text with the `nb-icon-close` sprite at `--icon-md` | Text glyph at 1.35 rem | Foundations §9.3: chrome glyphs are SVG; the text glyph changes shape with the font | The × gains a 16-grid drawing |
| **P8** | Replace the primary hover `filter: brightness(1.06)` with the 3 px `--accent-soft` halo | `filter` (`style.css:6550`) | Foundations §11.4 forbids brightness as a state; the halo already exists (`:5489`) | Hover only |
| **P9** | Add a reset-geometry control (e.g. a footer or header menu item) | No way back to the default box except clearing localStorage | A saved 96vw box is hard to undo by dragging | Adds one control |
| **P10** | Give the grip a keyboard path (`role="separator"`, `tabindex="0"`, arrows 8 / Shift 32, Enter reset) | Pointer only | Foundations §10.5 rule 4: no action only as a drag. Maximize covers "bigger"; it does not cover free size | Adds a tab stop and a focus ring |
| **P11** | Save geometry only after the pointer moved more than 3 px | A click on the header saves the centred box | A click should not freeze the window size | None until a header click |
| **P12** | Header title uses `--text-lg` (1.15 rem) and drops the `.3px` tracking | 1.14 rem, `.3px` | One type token; the `.3px` is a brand-local value | Sub-pixel text change |
| **P13** | Announce an apply failure once: either keep the body `role="alert"` and make the footer status visual-only for that sentence, or keep the footer status live and drop the body card's `role="alert"` | Both announce the same sentence | A screen reader may say it twice | None (semantic) |
| **P14** | Announce the blocked table's message once: keep the footer status and make the notice a static description (drop `role="status"`), or keep the notice live and silence the footer for that message | The footer and the notice both use `role="status"` with the same sentence (`templates/index.html:1443`, `table-editor.js:2045`; table-editor.md §3.6 keeps the second) | A screen reader may say it twice | None (semantic) |

---

## 13. What not to build

1. A fourth tool surface. The bar is the only window-action home.
2. A second bar row, a `…` overflow menu, or a popover for the actions slot.
3. History in the header, the footer, a sidebar section, or a second pair.
4. Apply or Cancel in the bar or the header.
5. A title, a breadcrumb, or a `+` reservation in the bar.
6. A fixed badge slot; the badge collapses when empty.
7. A per-window breakpoint. Reuse 960 / 720 / 520; the designer's compact body is a
   refinement, not a second shell.
8. 44 px bar tools on desktop. The table's 20 tools only fit at 32 there; the table's
   phone toolbar is the one 44 px exception (X2).
9. A custom tooltip for the icon buttons; `aria-label` + `title` is the contract.
10. A second maximize implementation, a per-window max class, or a persisted maximized
    state.
11. A new z-band, shadow, radius, or accent for the window.
12. A drag handle strip, a title-bar icon, or a window menu; the header is the drag
    surface.
13. A second backdrop handler; the overlay click delegates to the window's one close path.
14. A second live region beyond the blocked notice, a second status line, or colour-only
    state.
15. A per-step note write. One Apply is one note-level undo step.
