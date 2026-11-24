# Activity-bar order — drag reorder and per-view visibility

Status: Current spec — shipped control. This document describes the code, it does not propose it.

Mockup: [`settings-modal-mockup.html`](settings-modal-mockup.html) — §2 shows the group at rest inside
Appearance; §2c its default, hidden, drag-active and per-state boards.

Surface: Settings → Appearance → **Activity bar**, between *Graph background particles* and
*Modal size*. Markup `index.html:986-994`; rows `settings.js:369-414`; styles `style.css:2531-2617`.

Normative sources: [`settings-modal.md`](settings-modal.md) §4.3 owns the tab, §3.7 the save model;
[`foundations.md`](foundations.md) owns every token; [`controls.md`](controls.md) owns control states
and ARIA. The bar's own rendering is `shell-frame.md` §3.1. This file owns the reorder and
visibility control only.

Prerequisite: none of its own. Every token it reads is already in `:root`.

Abbreviations: `style.css` = `static/css/style.css`; `settings.js` = `static/js/settings.js`;
`activity.js` = `static/js/activity.js`; `index.html` = `templates/index.html`.

---

## 1. Model

The group holds three independent settings over one list of nine rows.

| Setting | Input | Writes | Source |
|---|---|---|---|
| Order | pointer drag on the grip | `sidebarOrder` | `settings.js:424-550` |
| Visibility | the row's `Hide` / `Unhide` button | `sidebarHidden` | `settings.js:558-573` |
| Side | the row's `Left \| Right` segmented control | `sidebarSide` | [`secondary-sidebar.md`](secondary-sidebar.md) §8 |

Rules:

1. **Drag is the only way to reorder.** There is no arrow button and no keyboard reorder. Each row
   carries two controls — the visibility toggle and the side control — and neither moves it.
2. **The grip is the only drag source.** The card, the label and the buttons are not draggable
   (`settings.js:425-428`). Drag is a pointer gesture on one 24 × 24 box per row.
3. **The list always shows all nine views**, in bar order, hidden or not. It is the only place a
   hidden view can be restored, so it is never filtered.
4. Both paths are live: reorder the bar, persist, re-render the list, restore focus, announce. There
   is no Apply, no Cancel and no undo.
5. A hidden view keeps its position in the saved order. Hiding it and unhiding it puts it back where
   it was; hiding never re-numbers the rest (`activity.js:111-122`, `:134-136`).
6. A view's side is independent of its position and of its visibility. Reordering never changes a
   side, and hiding never changes one.

**The honest keyboard statement.** Reordering has no keyboard path at all. `draggable` adds no role,
no tab stop and no key handler, and nothing here replaces it. The keyboard-operable controls are
the visibility toggle and the two side buttons. A keyboard user can hide, unhide, and move a view
between rails, and cannot reorder. That is the shipped contract, stated once here so no later
document claims otherwise.

---

## 2. Anatomy

```
#settings-sidebar-order        role=list, gap 8, no inner scroll, 9 rows
├── .sidebar-order-row        40 px card, --surface-raised, 1 px --border, radius 8
│   ├── .sidebar-order-grip   24 × 24, #nb-icon-grip 14 px, --text-muted, cursor grab
│   ├── .sidebar-order-icon   14 × 14, the view's own bar icon, --text-muted
│   ├── .sidebar-order-label  flex 1, .93rem, --text-primary, one line, ellipsis
│   └── .sidebar-order-actions
│       ├── .sidebar-order-side    Left | Right, 30 px segmented control
│       └── .sidebar-order-toggle  Hide  (30 px tall, min-width 60)
└── × 9   Explorer, Sessions, Pinned folders, Bookmarks, Recent files, Search, Tabs,
         AI Assistant, Outline

.sidebar-order-row.is-hidden  --surface-panel face, --text-muted label, icon unchanged, Unhide
```

| Part | Value | Token |
|---|---|---|
| List | flex column, gap 8, `margin: 4px 0 16px`, `role="list"`, `aria-label="Activity bar order"`, `aria-describedby` the help paragraph | `--space-2`, `--space-1`, `--space-4` |
| Row height | **40** = 4 + 4 padding + 30 control + 2 border | `--space-1`, `--control-h-md` |
| Row pitch | **48** = 40 + 8 gap; nine rows and eight gaps measure **424** | `--space-2` |
| Row face | `--surface-raised`, 1 px `--border`, radius 8, `position: relative`, no hover fill | `--stroke-1`, `--border`, `--radius-md` |
| Row padding | `4px 12px`, `align-items: center`, gap 12 | `--space-1`, `--space-3` |
| Grip box | 24 × 24, glyph 14 × 14, centred | `--control-h-sm`, `--icon-sm` |
| Grip glyph | six 2 px round dots, 2 columns × 3 rows, `currentColor`, 16 grid | `#nb-icon-grip` |
| View icon | 14 × 14 box, the same symbol the activity bar draws for that view, `currentColor` from `--text-muted`, `aria-hidden="true"` | `--icon-sm`, `--text-muted`; `nb-icon-explorer` / `session` / `pin` / `bookmark` / `clock` / `search` / `ai` |
| Label | `.93rem`, weight 400, `--text-primary`, `nowrap`, ellipsis | `--text-ui-lg` |
| Toggle | `.settings-action` face at 30 high; `min-width` 60; `padding: 0 8`; label `Hide` / `Unhide` | `--control-h-md`, `--space-2` |
| Actions gap | 2 (one button today; the span stays for the slot) | `--space-hair` |
| Hidden row | face `--surface-panel`, label `--text-muted`; border, radius and height unchanged | `--surface-panel`, `--text-muted` |
| Insertion line | 2 px `--accent`, drawn 4 px off the row, centred in the 8 px gap | `--stroke-2`, `--accent` |

The row is a card, not a labelled settings row: no 132 px gutter, no hover fill, matching the four
list rules in `settings-modal.md` §5.6.

**Height delta against the arrow era.** The row used to hold two 34 px arrows and measured 44 px with
a 6 px gap, list 344. It is now 40 px with an 8 px gap, list **328** — 16 px shorter, because the
6 px padding and the 6 px gap were the last half-steps in this component (foundations §5.1). The view
icon adds no height and no pitch: it is 14 px inside a row whose tallest child is the 30 px toggle, and
the 12 px flex gap absorbs it. The label starts 26 px further right than in the grip-and-label era.

---

## 3. States

| State | Trigger | Row | Grip | Toggle |
|---|---|---|---|---|
| Rest | — | `--surface-raised`, 1 px `--border` | `--text-muted`, `cursor: grab` | `Hide` on the `.settings-action` face |
| Hidden | `sidebarHidden` contains the view | `--surface-panel`, label `--text-muted`, icon unchanged, same border and height | `--text-muted`, still `cursor: grab` | `Unhide` on the `.settings-action` face |
| Grip hover | pointer over the grip | unchanged | `--text-primary` | unchanged |
| Grip pressed | pointer down on the grip | unchanged | `--accent`, `cursor: grabbing` | unchanged |
| Toggle hover | pointer over the button | unchanged | unchanged | `--accent-soft` face, `--accent` border |
| Toggle focus-visible | Tab | unchanged | unchanged | `--focus-ring`, offset **1** (exception E4) |
| Dragging (source) | `dragstart` on the grip | `opacity: var(--opacity-disabled)`, added one frame late | unchanged, muted by the row's opacity | inert for the gesture |
| Drop target, before | pointer over the upper half of row *B* | 2 px `--accent` line above *B* | unchanged | unchanged |
| Drop target, after | pointer over the lower half of row *B* | 2 px `--accent` line below *B* | unchanged | unchanged |
| Drop target, self | pointer over the dragged row | no line | — | — |

Notes:

- **A hidden row is not dimmed.** Face and label carry the state, so the `Unhide` button keeps full
  contrast and stays a normal 30 px target. `--opacity-disabled` is reserved for the disabled state
  and for the drag source.
- **The view icon is `--text-muted` in both states.** It is muted at rest, so hiding changes the face
  and the label and leaves the icon exactly as it was; there is no `.is-hidden .sidebar-order-icon`
  rule. The icon still identifies the row — which matters most precisely when the view is out of the
  bar — so it is kept, never removed or dimmed further.
- **The face shift is small in the light theme**: `--surface-panel` `#f6f7f9` against
  `--surface-raised` `#eceef2` is about 3 % of luminance, and in the modal the hidden face equals the
  body behind it, so the card reads as outlined and flat rather than filled. The muted label
  (`--text-muted`, 5.56:1 on that face) and the word `Unhide` are what actually carry the state; the
  face reinforces it. Do not remove either of the two strong signals expecting the face to do the
  work.
- A hidden row keeps `1 px --border`. On the modal's `--surface-panel` face the hairline is the only
  boundary, which is correct for a decorative edge (foundations §3.5) and reads as "flat, out of the
  bar" next to a raised card.
- Hidden is not the same as absent: the row is still a list item, still draggable, and still counted
  by `aria-posinset`.
- The card's boundary stays `--border`, never `--border-strong`: the card is not clickable and the
  button carries its own border.
- `aria-grabbed` and `aria-dropeffect` are deprecated in ARIA 1.1 and removed from 1.2. They are not
  used.

---

## 4. The drop indicator: a 2 px line in the gap

Chosen over a gap placeholder and over a ghost:

1. **It is an existing primitive.** Foundations §5.3 names `--stroke-2` for "drag insertion line".
   The file tree (`style.css:1551-1553`) and the tab strip already mark a drop with a 2 px accent bar.
2. **It never moves layout.** A gap placeholder reflows the list on every `dragover`, so the row under
   the pointer slides away and the marks flicker. A line leaves every row where it is.
3. **It does not compete with the drag image.** The browser already follows the pointer with a copy of
   the card; a ghost is a second image saying something else.

The line spans the row width, sits 4 px off the row it belongs to (centred in the 8 px gap), is drawn
by `::before` / `::after` with `pointer-events: none`, takes no layout space, and only one row carries
a mark at a time (`style.css:2599-2612`). Hidden rows are ordinary drop targets: their face changes
nothing about the mark.

---

## 5. Drag lifecycle

Shipped behaviour, in order.

| Event | What happens |
|---|---|
| Pointer down on anything but the grip | `dragstart` is cancelled (`settings.js:425-428`). No drag, no state change. |
| Pointer down on the grip | The browser arms a drag. |
| `dragstart` | `sidebarDragId` = the row's view id; `effectAllowed = "move"`; `setData("text/plain", id)`; seed the pointer position; `.dragging` added **one frame later** (`requestAnimationFrame`, `settings.js:415-423`, `:439-443`) so the drag image is captured at full opacity; capture-phase `dragover` and `drop` listeners installed on `document`; auto-scroll loop started. |
| `dragover` anywhere | The document listener records the pointer position and `preventDefault()`s, so no browser default (navigation, text drop) can run (`settings.js:448-455`). |
| `dragover` a row | If the row is not the source: `dropEffect = "move"`, `preventDefault()`, clear every mark, then mark before or after by the row's vertical midpoint (`settings.js:456-475`). |
| `dragover` the source row | Marks cleared; no mark on itself. |
| `dragleave` a row | Marks clear only when the pointer leaves that row's subtree, not on every child crossing. |
| Drop on a row | Clear marks, move the view, persist, re-render, focus the moved row's toggle, announce, then clean up (`settings.js:476-498`). |
| Drop in the resolved same position | Nothing: no re-render, no write, no focus change, no announcement (`settings.js:545`). Dropping *after* the row above the source resolves to the same index and counts here. |
| Drop outside the list | No write, no announcement, focus unchanged, marks cleared by `dragend`. |
| `Esc` during a drag | Cancels the gesture. The Settings key handler runs `endSidebarDrag()` and returns before `close()`, so the modal stays open whatever the browser does with `dragend` (`settings.js:863-872`). |
| `dragend` | The one cleanup: `sidebarDragId = null`, every mark removed, `.dragging` removed, auto-scroll stopped, the two document listeners removed (`settings.js:488-498`). |

**Auto-scroll.** The list has no scroller of its own; `.settings-sections` is the only scrollport, and
the group sits low in a tab taller than the modal.

- Inside the top or bottom 32 px band of the column, scroll by 8 px per animation frame (about
  480 px/s) in the direction of the band (`SIDEBAR_DRAG_SCROLL_BAND_PX` 32,
  `SIDEBAR_DRAG_SCROLL_STEP_PX` 8; `settings.js:77-80`, `:499-515`).
- Each tick re-hit-tests the row under the pointer with `elementFromPoint` and re-marks it, so the mark
  tracks the list while it scrolls (`settings.js:520-529`).
- Stops on `dragend`, on `Esc`, and when the pointer leaves the band.
- No `scroll-behavior: smooth` (foundations §7.4); the per-frame step is the movement.
- The page never scrolls: the sections column is the only body scroller (`settings-modal.md` §1.3).

---

## 6. Hide and unhide

One button per row, reading `Hide` when the view is in the bar and `Unhide` when it is not.

| Step | What happens | Source |
|---|---|---|
| Click, Enter or Space on the toggle | `toggleSidebarHidden(viewId)` reads the live `hidden` set, adds or removes the id, and calls `NB.app.setSidebarHidden(next)` | `settings.js:558-566` |
| Persist | `sidebarHidden` is normalised (unknown ids dropped, duplicates collapsed) and written through the debounced config save | `app.js:1705-1719`; `app.py:1514-1521` |
| Bar | `NB.activity.setHidden()` re-renders the strip; a hidden view's icon is simply not built, so the workspace pin and the settings button keep their slots | `activity.js:138-147`, `:170-211` |
| Active view | Hiding the active view activates the first **visible** view without toggling the panel. If no view is left visible, the panel collapses; on phone the drawer closes | `activity.js:149-169` |
| List | The whole list is re-rendered; the row returns with `is-hidden` and `Unhide`, still in its saved position | `settings.js:369-414` |
| Focus | That row's toggle, `focus({preventScroll: true})` | `settings.js:551-557` |
| Announcement | `<View> hidden.` or `<View> shown.`, from the state *before* the write | `settings.js:569-572` |

Consequences worth stating:

- Hiding does not delete an order. `sidebarHidden` and `sidebarOrder` are separate keys; unhide puts the
  view back at its saved index, not at the end.
- Hiding does not delete a side either. `sidebarSide` keeps the view's entry while it is hidden, so
  unhiding restores the icon on the rail it came from.
- Hiding every view leaves no icon in the strip and no open panel. The Settings list still shows all
  nine rows, so the state is recoverable from here. With two rails, "every view" means every view on
  that rail: hiding the last right-homed view empties the right side (rail and panel), and leaves the
  left untouched ([`secondary-sidebar.md`](secondary-sidebar.md) §7.5).
- The bar re-renders immediately; the write is debounced with every other live setting (§3.7 of
  `settings-modal.md`).
- Hiding the active view does not close Settings: the modal is inert over the shell, and the panel
  change happens behind it.

### 6.1 Side

The segmented control writes `sidebarSide` and takes effect immediately: the view's host moves to the
other panel, both rails re-render, and the moved view stays selected on its new side only when it was
the source side's active view. The panel the view left keeps its own state; a side change never opens
or closes a panel unless the source side is left with nothing visible, in which case it collapses.
Full semantics: [`secondary-sidebar.md`](secondary-sidebar.md) §7.3.

| Aspect | Rule |
|---|---|
| Options | Two `<button>`s in one 30 px pill, `role="group"` with `aria-label="<view> side"`, each `aria-pressed` |
| Selected | `--accent-soft` face, `--accent` text; the unselected option is transparent on `--text-muted` |
| Hover | `--accent-soft` face on the option under the pointer |
| Focus | the standard ring at `--focus-offset` |
| Persist | `NB.app.setSidebarSide(id, side)` → `persistConfig(["sidebarSide"])`; the phone writes nothing |
| Announcement | `<View> moved to the <left\|right> rail, position <n> of <m>` where n/m count that rail's visible rows |

---

## 7. Keyboard, focus, screen readers

| Requirement | Contract |
|---|---|
| Reorder by keyboard | **None.** There is no key, no focus target and no menu for reordering. The drag is pointer-only and this document does not pretend otherwise. |
| Visibility by keyboard | The toggle is a native `<button>`: Tab reaches it, Enter and Space activate it. One stop per row, nine in the list. |
| Hidden view activation | Refused. A hidden view cannot be brought forward by an icon click, a shortcut, the phone drawer or boot; callers fall back to the first visible view (`activity.js:233-238`, `:348`). |
| Row focus | Rows carry no `tabindex` and are not stops (`settings.js:374-380`). |
| Accessible name of the toggle | `aria-label` and `title` are `Hide <view>` / `Unhide <view>`; the visible word alone would be ambiguous once nine rows share it (`settings.js:407-408`). |
| Position information | Each row carries `aria-posinset` (1-based) and `aria-setsize="9"`, plus `aria-label` naming its side, so the row reads "Bookmarks, 4 of 9, left rail" (`settings.js:379-380`). |
| Grip | `aria-hidden="true"` on the grip span and its SVG. It is a pointer affordance with no keyboard meaning. |
| Instructions | The help paragraph carries `id="settings-sidebar-order-help"`; the list points at it with `aria-describedby`, so entering the list reads the rule once (`index.html:987-993`). |
| Live region | `<p class="sr-only" id="settings-sidebar-order-status" role="status">` directly after the list (`.sr-only`, `style.css:4772-4781`). Its text is replaced, never appended. |
| Announcement — reorder | `<View> moved to position <n> of 9.` after every completed drag (`settings.js:574-581`). |
| Announcement — side | `<View> moved to the <left\|right> rail, position <n> of <m>.` after a side change, where n/m count that rail's visible rows. |
| Announcement — visibility | `<View> hidden.` / `<View> shown.` (`settings.js:569-572`). |
| Silent cases | A no-op drop, a cancelled drag, and a drag that ends outside the list say nothing, because nothing changed. |
| Focus after a drag | The moved row's toggle, `preventScroll` (`settings.js:547-548`, `:551-557`). Programmatic focus after a pointer gesture does not match `:focus-visible`, so no ring is painted; the next Tab continues from the button. |
| Focus after Hide or Unhide | The same row's toggle, so repeated toggling is keyboard-only (`settings.js:568`). |
| Focus after a cancelled drag | Unchanged; the list was not re-rendered. |
| Focus ring | `--focus-ring` at offset **1** px, the Settings-wide value (E4). |

The cost of the shipped model is stated plainly: a keyboard or screen-reader user keeps full control
of visibility and reads every result, but cannot change the order. A pointer is required.

---

## 8. Motion

| Property | Value |
|---|---|
| Grip colour on hover and active | `color var(--dur-1) var(--ease-out)` |
| Source row dim | **none** — it must snap, and the drag image is taken in the same tick |
| Insertion line | none — an indicator that fades in is an indicator that is late |
| Hidden row | none — the face and the label colour change in one frame |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { .sidebar-order-grip { transition: none; } }` (`style.css:2614-2616`) |

No transform, no scale, no lift, no shadow on the dragged row. The browser's drag image is the
movement; anything the page adds fights it.

---

## 9. Targets

| Control | Box | Floor |
|---|---|---|
| Grip | 24 × 24 | 24 fine-pointer floor — met |
| Toggle | 60 × 30 (min-width 60) | 24 fine-pointer floor — met |
| Row (drop zone) | 40 × full width | — |
| Auto-scroll band | 32 deep, full width | — |

The coarse-pointer 44 px floor (foundations §10.4) is not met, because the toggle is a
`.settings-action` button and every Settings button is 30. That is a control-layer gap, not this
control's; raising this one alone would make it the only 44 px button in the modal. Drag on a coarse
pointer is not a reliable path: the grip is 24 px and HTML5 drag needs a long press, and the arrows
that used to give touch users a way through are gone — a touch user can hide and unhide, and cannot
reorder (proposal P1). The phone settings sheet has no order list at all
(`settings-modal.md` §9.3).

---

## 10. Copy

| Where | Text |
|---|---|
| Help paragraph | `Icons on the left rail and the right rail. Drag a row by its handle to reorder it, Left or Right to choose its rail, and Hide to remove a view. Unhide restores it.` |
| Toggle, view visible | `Hide`; `aria-label` / `title`: `Hide <view>` |
| Toggle, view hidden | `Unhide`; `aria-label` / `title`: `Unhide <view>` |
| Side control | `Left`, `Right`; group `aria-label`: `<view> side` |
| Live region — move | `<View> moved to position <n> of 9.` |
| Live region — hide | `<View> hidden.` |
| Live region — unhide | `<View> shown.` |
| List `aria-label` | `Activity bar order` |

"Handle" is the user-facing word for the grip. Do not say "grip" in copy, and do not say "delete" —
a hidden view is still in the list and still in the order.

---

## 11. Token and class mapping

One row as shipped (`settings.js:369-414` builds this):

```html
<div class="sidebar-order-row" role="listitem" data-view="bookmarks"
     aria-posinset="4" aria-setsize="9">
  <span class="sidebar-order-grip" draggable="true" aria-hidden="true">
    <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-grip"/></svg>
  </span>
  <span class="sidebar-order-icon" aria-hidden="true">
    <svg aria-hidden="true" focusable="false"><use href="#nb-icon-bookmark"/></svg>
  </span>
  <span class="sidebar-order-label">Bookmarks</span>
  <span class="sidebar-order-actions">
    <span class="sidebar-order-side" role="group" aria-label="Bookmarks side">
      <button class="sidebar-order-side-opt" type="button" aria-pressed="true">Left</button>
      <button class="sidebar-order-side-opt" type="button" aria-pressed="false">Right</button>
    </span>
    <button class="settings-action sidebar-order-toggle" type="button"
            aria-label="Hide Bookmarks" title="Hide Bookmarks">Hide</button>
  </span>
</div>
```

A hidden row is the same markup with `class="sidebar-order-row is-hidden"`, label `--text-muted` from
CSS, and `Unhide` / `Unhide Bookmarks` on the button. The icon span is unchanged in both states.

The icon span copies whatever `NB.activity.barItems()` reports for that view (`settings.js:398-408`):
when the id begins with `nb-icon-` the span holds an `<svg><use href="#…">`; otherwise it holds the
glyph as text, which is the fallback for a view registered with a text icon. Both are `aria-hidden`,
so the label remains the row's only name.

| Shipped | Rule |
|---|---|
| list gap 8, margin `4px 0 16px` | `--space-2`, `--space-1` / `--space-4` |
| row padding `4px 12px`, gap 12 | `--space-1` / `--space-3` |
| row face `--surface-raised`, `1px --border`, radius 8 | `--stroke-1`, `--radius-md` |
| grip 24 × 24, glyph `--icon-sm` | `--control-h-sm` |
| view icon 14 × 14, `--text-muted` | `--icon-sm` |
| label `.93rem` `--text-primary` | `--text-ui-lg` |
| toggle `min-width: calc(--control-h-md * 2)`, `padding: 0 8` | `--control-h-md`, `--space-2` |
| hidden row face `--surface-panel`, label `--text-muted` | same tokens |
| `.dragging` `opacity: var(--opacity-disabled)` | applied one frame late |
| drop bar 2 px `--accent`, 4 px off the row | `--stroke-2`, `--space-1` |

The block is the shipped one (`style.css:2531-2617`); the only lines that matter to an implementer
are the two hidden-row rules:

```css
#settings-overlay .sidebar-order-toggle {
  min-width: calc(var(--control-h-md) * 2);
  padding: 0 var(--space-2);
}
.sidebar-order-row.is-hidden {
  background: var(--surface-panel);
}
.sidebar-order-row.is-hidden .sidebar-order-label {
  color: var(--text-muted);
}
```

No new token, no new literal: the toggle reuses `.settings-action` for height, face, border, hover,
focus and disabled, and the hidden row reuses two semantic colours.

---

## 12. Conflicts — resolved, and what is left

The earlier spec in this file described an arrow-button control. The shipped code moved to a
visibility toggle, and every conflict recorded then is now settled:

| # | Was | Shipped resolution |
|---|---|---|
| C1 | The whole row was the drag source | Grip-only: `dragstart` is cancelled unless the target is inside `.sidebar-order-grip` (`settings.js:425-428`) |
| C2 | `.dragging` set inside `dragstart` dimmed the drag image | Set in `requestAnimationFrame` (`settings.js:439-443`) |
| C3 | Esc closed the modal mid-drag | The key handler ends the drag and returns before `close()` (`settings.js:863-872`) |
| C4 | The insertion line was inset inside the target card | A 2 px bar on `::before` / `::after`, 4 px off the row, in the 8 px gap (`style.css:2599-2612`) |
| C5 | No announcement, no position | `role="status"` region plus `aria-posinset` / `aria-setsize` (`settings.js:379-380`, `:569-581`) |
| C6 | A drop focused a `tabindex="-1"` row | Focus goes to the moved row's toggle (`settings.js:547-548`) |
| C7 | No auto-scroll while dragging | 32 px band, 8 px per frame, re-hit-tested each tick (`settings.js:499-529`) |
| C8 | A no-op drop still wrote config | The resolved order is compared before the write (`settings.js:545`) |
| C9 | The grip was the text glyph `⋮⋮` | `#nb-icon-grip` in a 24 × 24 box (`settings.js:389-396`) |
| C10 | `cursor: grab` on the whole card | Grip only |
| C11 | 6 px padding, 6 px gap, 34 px arrows | Grid-snapped: 4 / 8, one 30 px toggle |

No open conflicts remain. The two stale comments were rewritten in the same change: the CSS block
now names the Hide/Unhide toggle, and `renderSidebarOrder`'s comment names the visibility control
instead of the old arrows. Everything else in the brief and the code agrees, including both config
keys embedded as `data-sidebar-order` / `data-sidebar-hidden` (`index.html:334-335`).

---

## 13. Exceptions

| # | Change | Why | Shipped → target |
|---|---|---|---|
| **E1** | Row padding 6 → 4, gap 6 → 8, arrows 34 → one 30 toggle | Foundations §5.1: a component being edited snaps to the 4 px grid | row **44 → 40**, pitch 50 → 48, list **344 → 328** (−16 px) |
| **E2** | The grip is a 14 px sprite in a 24 × 24 box | `⋮⋮` metrics move with the font and `--font-scale`; chrome is an SVG on the 16 grid (foundations P6) | text glyph → `#nb-icon-grip`; no height change |
| **E3** | The drop mark is a 2 px bar 4 px off the row | An inset line reads as the target card's own border | inside the card → in the gap; no layout space |
| **E4** | Live region, `aria-posinset` / `aria-setsize`, `aria-describedby` | Reorder has no keyboard path, so every result must be announced | no ARIA → §7; no pixel change |
| **E5** | The second control becomes a visibility toggle | Two arrows for order and no way to remove a view; the bar had no hide affordance outside this list | two 34 px arrows → one `Hide` / `Unhide` button; row height unchanged at 40 |

---

## 14. Proposals — not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| **P1** | A keyboard reorder: `Alt` + `↑` / `↓` on a focused row, or a row menu with `Move up` / `Move down` | Reordering is pointer-only today, and the two users who need it have no route at all | A second control per row or a nested menu; the row is one 40 px card and already carries a grip and a button |
| **P2** | Raise the toggle to 44 px on a coarse pointer | foundations §10.4 asks for 44 on touch | It would be the only 44 px button in the modal; a control-layer decision, not this control's (§9) |
| **P3** | A count beside the group title, `2 hidden` | Nine rows with three settings are easy to lose track of | One line of copy and a render hook; no layout change |
| **P4** | Fade the drop line in, or lift the dragged card | Perceived smoothness | Motion on an indicator delays the indicator; the drag image already supplies the movement (§8) |

---

## 15. Acceptance criteria

| # | Criterion | Files | Observable |
|---|---|---|---|
| **AC1** | Only the handle drags | `settings.js` | `draggable` is true on `.sidebar-order-grip` and absent on `.sidebar-order-row`; a drag from the label or button is cancelled |
| **AC2** | The drag image is not dimmed | `settings.js` | The source row is at full opacity in the frame `dragstart` runs and dims on the next frame |
| **AC3** | One drop mark, in the gap | `style.css` | Exactly one row carries `drop-before` or `drop-after`; the mark is a 2 px `--accent` bar 4 px off that row |
| **AC4** | A no-op drop writes nothing | `settings.js`, `app.js` | A drop on the source row, or directly after the previous row, leaves `sidebarOrder` untouched, posts nothing and announces nothing |
| **AC5** | A drop outside changes nothing | `settings.js` | Releasing over the modal body or outside the window leaves the order and the focus unchanged and clears every mark |
| **AC6** | Esc cancels and keeps the modal | `settings.js` | Esc during a drag ends the gesture and leaves Settings open |
| **AC7** | Auto-scroll | `settings.js` | Dragging into the 32 px band at either edge of `.settings-sections` scrolls that column and keeps the mark under the pointer |
| **AC8** | A move is announced and focused | `settings.js` | The region reads `<View> moved to position <n> of 9.` and focus lands on the moved row's toggle |
| **AC9** | Hide removes the icon and keeps the row | `settings.js`, `activity.js` | The icon leaves `#activity-bar`; the row stays in place with `is-hidden` and `Unhide`; `sidebarHidden` gains the id |
| **AC10** | Unhide restores the icon at its saved position | `settings.js`, `activity.js` | The icon returns between its neighbours, not at the end; `sidebarHidden` loses the id |
| **AC11** | Visibility is announced and focused | `settings.js` | `<View> hidden.` / `<View> shown.`; focus stays on that row's toggle |
| **AC12** | Hiding the active view is safe | `activity.js` | The panel switches to the first visible view; hiding every view collapses the panel and closes the phone drawer |
| **AC13** | The list is the only control, and it is honest | `settings.js`, `index.html` | No `.sidebar-order-move` exists; each row has exactly the visibility toggle and the side control; the help paragraph and this document both say reorder is drag-only |
| **AC14** | Tokens only | `style.css` | The block adds no hex, no px radius, no raw duration |
| **AC15** | Each row shows the view's own icon | `settings.js`, `index.html` | A 14 × 14 `.sidebar-order-icon` sits between the grip and the label, `aria-hidden`, on `--text-muted`, drawing the same `nb-icon-*` symbol as that view's activity-bar button; it survives Hide and Unhide unchanged; a view with a text icon falls back to the glyph (`tests/dom/test_dom.js:27566-27571`) |
| **AC16** | Every row states its side | `settings.js` | The segmented control shows `Left` or `Right` selected; no row is blank; a view with no `sidebarSide` entry shows its registration default (Outline: Right, all others: Left) |
| **AC17** | A side change is live and reversible | `settings.js`, `activity.js` | Clicking `Right` on a left row moves the view's icon to `#activity-bar-right` and its host into `#aux-panel` without a reload; clicking `Left` moves both back; `sidebarSide` is posted each time |
| **AC18** | The side control is keyboard-operable and announced | `settings.js` | Each option is a native button, Tab reaches both, Enter/Space selects, `aria-pressed` follows; the status region reads `<View> moved to the <left\|right> rail, position <n> of <m>` |
| **AC19** | A side change never alters the other side's panel state | `settings.js`, `activity.js` | Moving a background view leaves both panels' collapsed flags and active views unchanged |

---

## 16. What not to build

| Rejected | Reason |
|---|---|
| `↑` / `↓` buttons beside the toggle | Two controls per 40 px card for a pointer-first gesture; the toggle is the one keyboard action (§1) |
| A hidden-view list separate from the order list | Hiding must preserve the position, so both states belong in one ordered list (§6) |
| Drag onto the bar, or drag the icon to hide it | The bar is a 48 px strip of icon buttons; hiding and ordering happen in one place (§6) |
| Filtering hidden rows out of the list | They could never be unhidden (§1 rule 3) |
| A gap placeholder or a floating ghost for the drop | Reflows under the pointer, or duplicates the drag image (§4) |
| Dimming or striking through a hidden row | Face and label already carry it; a fade would cost the `Unhide` button its contrast (§3) |
| `aria-grabbed` / `aria-dropeffect` | Deprecated and removed from ARIA 1.2 (§3) |
| A `role="listbox"` sortable widget | Would replace nine native buttons with a composite widget for one list (§7) |
| A nested scroll container around the list | 424 px does not justify a second scrollport; the sections column owns scrolling (§5) |
| Claiming a keyboard reorder in any doc or tooltip | There is none (§1) |
