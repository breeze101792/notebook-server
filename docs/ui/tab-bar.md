# File tab strip — `#tab-bar`

Status: Current spec — pre-implementation.
Scope: `#tab-bar` and its children (`#tab-pinned`, `#tab-list`, `#outline-toggle`), the `.tab`
element and its slots, drag and drop, the width freeze/release, the ghost close, overflow
scrolling, keyboard, and the tab context menu. Note content, the editor, the session model
([`sessions.md`](sessions.md)), the workspace picker, and the outline pane's contents are out of
scope.

Reference mockup: [`tab-bar-mockup.html`](tab-bar-mockup.html) — dark and light, eleven boards:
bar states (zero, one, only pinned), five mixed tabs, pinned region, overflow, tab anatomy, state
row, drag, ghost mid-close, the menu, the 861 boundary, and the 390 phone.

**Normative source.** This document is the single source of truth for the strip's structure,
geometry, states and behaviour. It reads [`foundations.md`](foundations.md) for every token and
[`controls.md`](controls.md) §2.8 for the two-tablist ARIA model, and it does not redefine
either. The shipped machinery records — [`tab-equalization.md`](../archive/architecture-design/tab-equalization.md)
and [`tab-close-animation.md`](../archive/architecture-design/tab-close-animation.md) — stay normative
for the freeze/release and the ghost; §6 restates their contracts and adds nothing to them.
`NB.menu` (`static/js/menu.js`) stays normative for the menu box; §5.5 owns only the tab's item
list. Where this document and `static/css/style.css` differ today, the stylesheet wins for
anything already shipped, and §11 records every difference rather than resolving it silently.

Every claim about current code cites `file:line`. Measurements marked *(measured)* were computed
from the shipped rules; measurements marked *(recorded)* come from a real-browser run in the
cited document.

---

## 1. Structure

### 1.1 The three children

`templates/index.html:280-293`, in this order, and nothing else:

| # | Child | Class | Owner | Role |
|---|---|---|---|---|
| 1 | `#tab-pinned` | `.tab-pinned` | `tabs.js` `render()` (`static/js/tabs.js:703`), visibility by `syncPinnedRegion()` (`:578`) | Pinned tabs. Fixed at the left, `flex: 0 0 auto`, capped at half the bar, scrolls internally past the cap (`style.css:535-546`). `hidden` while empty (`:550`). |
| 2 | `#tab-list` | `.tab-list` | `tabs.js` `render()` (`:703`) | The active session's unpinned tabs. The strip's main scroller: `flex: 1 1 auto; min-width: 0; overflow-x: auto` (`style.css:506-528`). |
| 3 | `#outline-toggle` | `.icon-btn.outline-toggle` | `app.js:757` (click), `tabs.js` never touches it | An icon button that toggles the right outline pane. Not a tab. |

The bar itself (`.tab-bar`, `style.css:473-499`) is `display: flex; align-items: flex-end;
gap: 2px; flex: 0 0 auto; height: 34px; padding: 0 6px; background: var(--bg-panel);
border-bottom: 1px solid var(--border); overflow: hidden`. It never scrolls and never wraps.

### 1.2 Why the outline toggle is a sibling

Three reasons, all of them load-bearing:

1. **It must survive overflow.** `#tab-list` is the scroller (`overflow-x: auto`). Anything inside
   it can be scrolled away or covered by a tab. As a sibling, the toggle sits outside the scroll
   box, so no tab can overlap it (`templates/index.html:290-292` states exactly this).
2. **It is not a tab.** It does not select the viewer's content; it resizes a column. A tablist
   may only contain tabs, so the toggle cannot live in either region.
3. **The bar's structure is frozen.** `sessions.md` records that the strip gains no child beyond
   these three (`docs/archive/ui/sessions.md:82`, `:1468`). Wrapping the two regions in a new container to
   make one tablist would add a child and break that record.

### 1.3 The two-tablist model, and why the bar is not one tablist

`#tab-pinned` and `#tab-list` each carry `role="tablist"` with `aria-label="Pinned files"` and
`aria-label="Open files"`. The bar does not carry `role="tablist"`.

The bar cannot, for three mechanical reasons:

- A tablist's owned elements must be tabs (or presentational wrappers). `#outline-toggle` is a
  button, and it is inside `#tab-bar`.
- Two tablists cannot nest. Putting one tablist around both regions would make each region's
  scroller a presentational child of a tablist, and the pinned region's `hidden` toggle would no
  longer remove only its own tabs.
- The regions behave differently: one equalizes and scrolls, the other is content-sized and
  capped. Exposing them as one list would hide that from assistive technology.

Naming them separately is also what makes the strip usable by ear: "Pinned files, tab 1 of 2",
then "Open files, tab 1 of 5". A `hidden` region is removed from the accessibility tree, so an
empty pinned region contributes no tablist and no Tab stop.

The cost of two tablists is that the arrow-key walk must cross the boundary by hand. §5.6 sets
that rule.

---

## 2. Tab anatomy

### 2.1 Slots

Left to right, each optional except the label:

| Slot | Element | Size | Token | Shown when |
|---|---|---|---|---|
| Pin marker | `<svg class="icon tab-pin">` → `#nb-icon-pin` | 14 × 14 | `--icon-sm` | The tab is pinned |
| Conflict | `<svg class="icon tab-conflict">` → `#nb-icon-conflict` | 14 × 14 | `--icon-sm` | The file changed on disk while the tab holds unsaved edits |
| Dirty | `.tab-label::before` | 8 × 8 dot | `--space-2`, `--radius-circle` | The tab has unsaved edits |
| Label | `<span class="tab-label">` | flexes, ellipsis | `--text-ui-lg` | Always |
| Close | `<button class="tab-close" aria-hidden="true">` → `#nb-icon-close` | 24 × 24 hit, 16 glyph | `--control-h-sm`, `--icon-md` | The tab is not pinned; pointer-only |

The tab's own gap is `--space-1` (4) between flex children; the dot carries
`margin-right: var(--space-1)`. Slot order is fixed: pin, conflict, dot + label, close. State
marks lead the name so that a long name's ellipsis can never eat them — today the `↻` sits inside
the clipped label (`tabs.js:678-684`) and disappears when the name is long.

The label is the only slot that truncates: `min-width: 0; overflow: hidden; white-space: nowrap;
text-overflow: ellipsis` (`style.css:1201-1206` + the tab's `white-space` at `:1194`). A truncated
label never grows the tab; the full path is the tab's `title` (`tabs.js:651`).

### 2.2 Geometry

| Property | Value | Token | Source |
|---|---|---|---|
| Bar height | 34 at 1.0, `calc(34px * var(--font-scale))` | `--tab-h` | `style.css:494`, named in `foundations.md` §8.1; scaling keeps the tab inside the bar at XL |
| Bar padding | 0 4 | `--space-1` | today `0 6px` (`:495`); 6 is a pre-grid half-step, snapped to a rung (`foundations.md` §5.1) |
| Gap between tabs, and between the three children | 2 | `--space-hair` | `:476`, `:509`, `:538` |
| Tab width | `flex: 1 1 170px`, rail 120…220 | `--tab-width`, `--tab-min-width`, `--tab-max-width` | `:1177`, `:1185-1187` |
| Pinned tab width | content, floor 120, no ceiling | `--tab-min-width` | `:557`; see §3.2 |
| Tab height | 28.52 at 1.0 *(measured)* | — | 4 + 4 + 1 border + a 19.52 line box (.93rem at 1.5). At XL the line box grows to 25.39, so the bar scales with it |
| Tab padding | 4 / 4 / 4 / 12 | `--space-1` … `--space-1` `--space-3` | today `5px 6px 5px 12px` (`:1188`) |
| Tab radius | 6 6 0 0 | `--radius-sm` | `:1192` |
| Tab border | 1 px, bottom none | `--stroke-1` | `:1190-1191` |
| Tab type | 13.02 px / 1.5, weight 400 | `--text-ui-lg` | today `.89rem` (`:1195`) |
| Close hit | 24 × 24, radius 4 | `--control-h-sm`, `--radius-xs` | today ~15 × 16 (`:1218-1227`) |
| Outline toggle | 30 × 30, radius 6 | `--control-h-md`, `--radius-sm` | today ~26 × 26 (`:563-567`, overridden by `:1345`) |

Two arithmetic consequences, both intended:

- **28, not 30.** Snapping the 5 px vertical padding to `--space-1` and the `.89rem` type up to
  `--text-ui-lg` lands the tab at 28.5 px inside the 34 px bar. `controls.md` already calls the
  tab ≈28 (`controls.md:108`). The 5.5 px of headroom above the tab is the room the focus ring does
  not use; it is quiet.
- **The close button does not grow the tab.** A 24 px box inside a 19.5 px line would push the tab
  to 33 px. `margin-block: calc(-1 * var(--space-1))` keeps the flex line's cross-size at 16 px, so
  the tab stays 28.5 and the box overhangs 2.2 px into the 4 px padding. The hit area is 24 × 24;
  the visible face is unchanged (`controls.md` §5 touch rule 1: a small visual box grows its hit
  without growing the box).

The active tab sits 1 px above the bar's bottom border, and `#tab-list`'s `overflow-x: auto` clips
the content box vertically, so a tab cannot overlap that hairline to "join" the page. At
`--border`'s 1.24:1 the break is invisible; do not chase it with a negative margin, which the
scroller would clip.

### 2.3 Pinned against unpinned

| | Pin marker | Close | Width | Region | Bulk close |
|---|---|---|---|---|---|
| Unpinned | — | yes | equalized, 120…220 | `#tab-list` | targeted |
| Pinned | `#nb-icon-pin`, `--text-muted` | **no** (`tabs.js:689`) | `max(120, content)` | `#tab-pinned` | skipped (`tabs.js:1380-1392`) |

A pinned tab closes through the tab menu's `Close` (`tabs.js:1441`) or the keyboard `Delete`
(§5.6), not through a `×`. That is the shipped model: pin means "keep", and there is no `×` to
mis-click. Middle-click refuses a pinned tab (`tabs.js:700`).

### 2.4 State marks

| State | Visual | Token | Text |
|---|---|---|---|
| Active | face `--surface-page`; border `--accent`; label `--text-primary` | `--surface-page`, `--accent` | — |
| Inactive | face `--surface-raised`; border `--border`; label `--text-muted` | `--surface-raised`, `--border` | — |
| Dirty | face `--accent-soft` (inactive only) + 8 px accent dot before the label; label `--text-primary` | `--accent-soft`, `--accent` | "unsaved changes" in the accessible name |
| Conflict | 14 px `↻` sprite before the label, `--warn` | `--warn` (5.65 dark / 4.34 light on the dirty face) | "changed on disk" |
| Pinned | pin sprite, `--text-muted` | `--text-muted` | "pinned" |
| Special | italic label, module icon (`tabs.js:664-674`); no dirty, no conflict | `--text-muted` | the label |

Dirty and active coexist: **active wins the face and the border**, dirty keeps the dot. Today
`.tab.dirty` is declared after `.tab.active` (`style.css:1200` vs `:1207`) and repaints the active
tab's face with the wash, which breaks the active tab's page join. §9 flips the order.

### 2.5 States this strip does not have

| Named state | Verdict |
|---|---|
| **Read-only** | No per-tab mark. A read-only viewer (`NB.pageRole()` at `tabs.js:1409`) can still open, switch and close tabs; the restriction is on editing and on session moves, not on which file is shown. The only tab-level consequence is that `Move to session` is disabled (`sessions.md`). Do not paint a lock. |
| **Missing file** | No such state exists and this spec does not invent one. A file deleted on disk keeps its tab and its cached content; `viewer:conflict` fires for a *newer version*, not for a deletion (`static/js/viewer.js:1256`, `:1263`). A failed load is the viewer's error state, not the tab's. Do not add a `!`, a strike-through, or a red face. |
| **Ghost** | Not a tab. An inert copy of a closed tab's box; §6.1. |

---

## 3. Width and overflow

### 3.1 The equal-width algorithm

Let `W` be `#tab-list`'s client width, `n` the unpinned tab count, `g` the 2 px gap. Each unpinned
tab is

```
clamp(120px, (W − g·(n−1)) / n, 220px)
```

because `flex: 1 1 170px` distributes the free space from an equal basis and the rails clamp the
result (`style.css:1185-1187`). Three regimes, and no fourth:

| Regime | Condition | Result |
|---|---|---|
| Grow | `(W − g(n−1))/n` > 170 | Every tab shares the space up to 220. One tab is 220, not the full width. |
| Shrink | between 120 and 170 | Every tab shrinks together. Five tabs in an 840 px strip are 166.4 px each *(measured)*. |
| Overflow | < 120 | Every tab is 120 and the strip scrolls. Thirteen tabs are 13 × 120 + 12 × 2 = 1584 px *(measured; matches the recorded `scrollWidth` of 1584 in `tab-equalization.md` §11.1)*. |

The strip's available width is `bar content − pinned region − 30 (toggle) − one gap` when
nothing is pinned. At an 880 px bar that is 840; at 353 px (an 861 px viewport with the default
240 + 220 panes) it is 313, so **two** tabs fit and a third overflows. At exactly 860 the phone
shell applies and the bar is hidden; 861 is the last desktop pixel.

### 3.2 Pinned tabs are content-sized

`.tab-pinned .tab { flex: 0 0 auto; max-width: none }` (`style.css:557`). The region is
content-sized, so there is no free space to distribute; a pinned tab renders at its content width
and lifts the 220 px ceiling, so a long name shows in full *(recorded: 331 px,
`tab-equalization.md` §11.1)*.

One correction to that record: the shared `min-width: 120px` still applies, so a pinned tab is
`max(120, content)`, not purely content. A short pinned name is 120 px. The mockup's pinned board
uses 120 / 138 / 164.

The region is capped at `max-width: 50%` and scrolls internally past the cap (`:540-542`), so a
long pinned set can neither squeeze the scroller out nor push the toggle off the edge. The
percentage resolves against the bar's **content** box, so the cap is 436 px in an 880 px bar
(50 % of 872), not 440.

### 3.3 Freeze and release

Shipped; restated because it is the strip's most fragile contract
([`tab-equalization.md`](../archive/architecture-design/tab-equalization.md) §2, §6).

| Moment | What happens |
|---|---|
| `mouseenter` on the bar | Every real tab, both regions, gets inline `flex: 0 0 <w>px; width: <w>px` keyed by `dataset.path` (`tabs.js:438-452`, `:1287-1296`). A close no longer moves the next close button. |
| `render()` while frozen | Re-applies the pins after the rebuild (`tabs.js:710`). Widths never change mid-session. |
| `mouseleave` | Pins are cleared **synchronously**; if any width changed by more than 0.5 px, the bar takes `.nb-tab-equalizing` for 180 ms and each tab animates `flex-basis` from `--nb-tab-from` to `--nb-tab-to` (`tabs.js:536-552`, `style.css:1250-1258`). |
| Instant release | Reduced motion, an active drag, more than 24 tabs, a sub-epsilon delta, or a ghost still on screen (`tabs.js:514-522`, `:545-550`). |

The release is the only survivor motion. An open or close with the pointer outside the bar is
instant except for the pointer-outside close, which replays the settle from the captured
pre-close widths.

### 3.4 Scroll ownership

Two scrollers, one always and one only past the cap:

| Region | Scrolls | When |
|---|---|---|
| `#tab-bar` | never | `overflow: hidden` (`style.css:498`) |
| `#tab-list` | always when content exceeds width | `overflow-x: auto` (`:513`) |
| `#tab-pinned` | only past the 50 % cap | `overflow-x: auto` (`:542`) |

Both scrollbars are hidden (`:520-521`, `:544`; the WebKit rules at `:1176` and `:547`).

- **Preserve.** `render()` reads both regions' `scrollLeft` before clearing and writes both back
  after `applyFrozenWidths()` (`tabs.js:639-640`, `:711-712`), so a dirty marker, a conflict badge,
  a watcher tick, a pin or a reorder never yanks the strip.
- **Reveal.** `activate()` only: it clamps `#tab-list.scrollLeft` against the tab's and the strip's
  rects, moving the minimum (`tabs.js:720-728`). Never `scrollIntoView()` — that would also move
  the window and every scrollable ancestor. A pinned active tab and a zero-width strip are no-ops.
- **Wheel.** A wheel over either region is translated onto that region's `scrollLeft` only while
  it overflows; `deltaMode` 1 is scaled by 16, mode 2 by the client width; `ctrl+wheel` is left
  to the browser; `behavior: "instant"` overrides `scroll-behavior: smooth` so each notch tracks
  the wheel (`tabs.js:1318-1334`).
- **Smooth.** `scroll-behavior: smooth` on `#tab-list` (`:522`) gives the reveal a slide;
  `auto` under reduced motion (`:524-526`).

### 3.5 Why there is no chevron and no fade

The reveal removes the failure they would fix: after every activation the active tab is whole and
the active border is visible. A right-edge fade would dim the tab it had just revealed; a chevron
would take 48 px of a 34 px row whose content is the tabs; and a gradient surface is forbidden by
foundations §11.4. The strip keeps its hidden scrollbar and its wheel.

### 3.6 Phone

`#tab-bar { display: none }` under the only mode switch, `(max-width: 860px), ((pointer: coarse)
and (max-width: 1023px))` (`style.css:6975`, `:7085`). The DOM stays; every width, reveal and
scroll path no-ops at zero width. §8 covers what replaces tab switching.

---

## 4. States matrix

Rows are tab states; a cell gives the visual delta and the token that produces it.

`raised` = `--surface-raised`, `wash` = `--accent-soft`, `page` = `--surface-page`,
`ring` = `var(--focus-ring)`, `ring-in` = the same at `var(--focus-offset-inset)`,
`drag` = `--opacity-drag`.

| State | Class / attribute | Face | Border | Label | Mark |
|---|---|---|---|---|---|
| Rest | `.tab` | `raised` | `--border` | `--text-muted` | — |
| Hover | `:hover` | `wash` | `--border-strong` | `--text-primary` | — |
| Active | `.active`, `aria-selected="true"` | `page` | `--accent` | `--text-primary` | — |
| Active + hover | both | `page` | `--accent` | `--text-primary` | — |
| Dirty (inactive) | `.dirty` | `wash` | `--border` (hover: `--border-strong`) | `--text-primary` | 8 px dot `--accent` |
| Dirty + active | both | `page` | `--accent` | `--text-primary` | 8 px dot `--accent` |
| Conflict | `.tab-conflict` present | inherits | inherits | inherits | 14 px `--warn` |
| Pinned | `.pinned` | inherits | inherits | inherits | 14 px pin, `--text-muted`; no close |
| Special | `.special` | inherits | inherits | italic, `--text-muted` | module icon |
| Dragging | `.dragging` | — | — | — | `opacity: drag` |
| Drop target | `.drop-before` / `.drop-after` | — | — | — | inset 2 px `--accent` |
| Focus-visible | `:focus-visible` | — | — | — | `ring-in` |
| Ghost | `.tab.ghost` | `raised` fill | `--border` | `--text-muted` | none; inert |

Bar states:

| State | What is on screen |
|---|---|
| Zero tabs | A 34 px `--surface-panel` band, its bottom hairline, and the outline toggle. The pinned region is `hidden` (`tabs.js:581`), so it takes no gap. |
| One tab | One 220 px tab at the left, the rest of the strip empty. |
| Only pinned | The pinned region holds everything and still caps at 50 %; `#tab-list` is empty and `flex: 1 1 auto` absorbs the space. |
| Overflowing | `#tab-list` scrolled; the last visible tab is cut at the clip edge; no scrollbar, no fade, no chevron. |
| Pinned at the cap | The pinned region is 50 % and scrolls internally; the list keeps the rest. |
| Phone | The bar is `display: none`. |

---

## 5. Interaction

### 5.1 Pointer

| Gesture | Result | Source |
|---|---|---|
| Click | `activate(path)` — switch the viewer, exit edit mode (dirty tabs stash a draft instead of prompting), reveal | `tabs.js:698`, `:810` |
| Click a close `×` | `close(path)`; `stopPropagation` so it does not also activate | `tabs.js:694` |
| Middle-click, unpinned | `close(path)` | `tabs.js:699-701` |
| Middle-click, pinned | Nothing. The handler refuses it, like bulk close | `tabs.js:700` |
| Right-click | Open the tab menu at the pointer | `tabs.js:702`, `:1456` |
| Double-click | No handler. Two `click`s run `activate()` twice; the second is a no-op that re-reveals. Not given a meaning | verified: no `dblclick` listener in `tabs.js` |
| Drag | Reorder; §5.2 | `tabs.js:1196-1273` |

Middle-click should also suppress the browser's middle-click autoscroll, which starts on
`mousedown` and is not stopped by `preventDefault` on `auxclick`. Add
`tab.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); })`.

### 5.2 Drag reorder

- The dragged tab takes `.dragging` (`tabs.js:1201`). Drag state is a module variable
  (`draggingPath`), not `dataTransfer`, so jsdom can drive it (`:83-85`).
- The tab under the pointer takes `.drop-before` when the pointer is in its left half,
  `.drop-after` in its right half (`tabs.js:1208-1222`).
- The indicator is an **inset** 2 px accent stripe. Today's outer `box-shadow` (`style.css:1239-1240`)
  is clipped by the region's `overflow-x: auto` at the first and last tab, and collides with a
  neighbour in the 2 px gap; an inset stripe paints inside the tab and can never clip.
- Drop clamps to the dragged tab's segment: a pinned tab stays in the pinned block, an unpinned
  tab stays after it (`tabs.js:1251-1252`). Dropping on empty bar area appends (`:1238`).
- Drop on itself re-renders and changes nothing (`tabs.js:1239`).
- `dragend` clears everything, including on `Esc` (`tabs.js:1271`).
- The release animation is gated off during a drag (`tabs.js:514`), so a drop settles instantly.
- **A drag is never the only way.** `Pin`/`Unpin` and the session moves are menu items; order is
  not the only thing a tab's position means. Reordering has no menu equivalent — accepted,
  because it has no semantic effect beyond cosmetics (foundations §10.5 rule 4 is about
  *actions*; order is a preference, and it persists only in `openFiles`).

### 5.3 Pin and unpin

`togglePin(path)` (`tabs.js:1023-1044`): pinning inserts the path at the end of the pinned
segment, unpinning inserts it at the start of the unpinned segment, then `render()` + `emitChanged()`.
Pinning removes the path from every stored session (`tabs.js:1035`) — a pinned tab is shared.
There is no confirmation and none is needed: the file is still open.

### 5.4 Close paths

| Path | Confirmation | Animation |
|---|---|---|
| `×`, middle-click, menu `Close`, `Delete` | A dirty tab prompts (or stashes, in the app's current flow) | Ghost if the pointer is inside the bar and motion is allowed (§6.1); otherwise the survivor reflow |
| Menu `Close others` / `right` / `left` | One `confirm` listing the dirty names, only when one is dirty (`tabs.js:1339-1347`) | Per tab |
| `clearAll()` (auth lock) | none | No ghost; `finishGhosts()` (`tabs.js:1374`) |

Bulk close skips pinned tabs and disables its item when the filtered set is empty
(`tabs.js:1380-1392`, `:1443-1452`). There is no **Close all**: `clearAll()` exists but it is the
auth-lock path (`tabs.js:1353`), not a user command, and adding a menu item that drops every tab
without a confirm would be the most destructive control in the chrome.

### 5.5 The context menu

`NB.menu` owns the box, the placement, the viewport clamp, and the keyboard
(`static/js/menu.js`; `docs/ui/controls.md` §2.9). The tab supplies this flat list
(`tabs.js:1419-1454`), in this order, with `<hr>` at each separator:

| Group | Item | Enabled when | Note |
|---|---|---|---|
| Organize | `Pin` / `Unpin` | always | Label flips on `pinned.has(path)` |
| | `Move to session` ▸ | always | **Owned by [`sessions.md`](sessions.md).** Every other session by name, then `New session…`; disabled for a pinned tab and for a read-only role (`tabs.js:1399-1413`) |
| | `Export…` | always | |
| | `Rename / Move…` | always | Sidebar façade |
| | `Copy…` | always | Sidebar façade |
| | `Copy path` | always | |
| | `Copy link` | always | |
| | `Add bookmark` / `Remove bookmark` | always | Label flips |
| — | | | |
| View | `Show in file sidebar` | always | Expands the tree and highlights the row |
| — | | | |
| Terminal | `Close` | always | `danger` |
| | `Close others` | there is an unpinned tab other than this one | `disabled` + `title` reason |
| | `Close to the right` | there is an unpinned tab to the right | `disabled` + `title` reason |
| | `Close to the left` | there is an unpinned tab to the left | `disabled` + `title` reason |
| | `Delete` | always | `danger`; deletes the file, not just the tab |

Rules:

- `focusFirst: true` (`tabs.js:1459`): the menu takes focus on open.
- On `Esc` the menu closes with reason `"esc"` (`menu.js:196`); pass an `onClose` that returns focus
  to the tab. `NB.menu` does not restore focus itself, and a closed menu leaves focus on a hidden
  button.
- A keyboard-opened `contextmenu` may report `clientX/Y` of 0; when both are 0, anchor the menu at
  the tab's rect's bottom-left instead of the pointer.
- The tab menu inherits the shared item geometry and, when controls.md step 11 lands, `role="menuitem"`
  on every row. This document does not fork the menu.
- Fourteen items is long. It is the shipped set; trimming it is a product change, not a design one.

### 5.6 Keyboard

Today the strip has no keyboard model at all: the `.tab` node is a `div` with no role, no
`tabindex` and no key handler (`tabs.js:644`), so the only Tab stops in the strip are the per-tab
close buttons (`:690`). This section adds the model; `controls.md` §2.8 owns the ARIA shape.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Enter or leave each visible region once. One roving stop per region (§7). |
| `ArrowRight` / `ArrowLeft` | Move to the next/previous tab **inside the focused region** and select it. Stops at the ends — no wrap and no crossing. `controls.md` §2.8 owns this rule; `Tab` moves between the regions. |
| `Home` / `End` | First / last tab **of the focused region**. |
| `Enter` / `Space` | Activate the focused tab. No-op when already active except re-reveal; `Space` must `preventDefault` so the page does not scroll. |
| `Delete` | Close the focused tab, pinned or not. Focus moves to the neighbour `pickNeighbor()` chooses (`tabs.js:759`); when the region empties, to the other region's tab; when the strip empties, to `#welcome`, which is the visible empty state (`viewer.js:704-705`). |
| `Shift+F10` / the Menu key | Opens the tab menu: the browser fires `contextmenu` on the focused element, and the handler at `tabs.js:702` already covers it once the tab is focusable. |
| `Ctrl+W` / `Cmd+W` | **Not bound.** The browser owns it and it cannot be intercepted. |

Auto-activation on arrow is deliberate: `activate()` calls `revealActiveTab()`, so arrowing to a
tab scrolled out of view brings it into view, which is the behaviour a keyboard user needs from
the same key. The cost is that a held arrow key can start viewer fetches; `activateToken` makes
every superseded activation abort (`tabs.js:812-813`).

---

## 6. Close animation and equalization

### 6.1 The ghost

[`tab-close-animation.md`](../archive/architecture-design/tab-close-animation.md) is the record;
nothing here changes it. The rules, restated because they constrain the visual spec:

- A ghost is created **only** when the pointer is inside the bar and reduced motion is off:
  `ghostClose = frozenWidths !== null && !prefersReducedMotion()` (`tabs.js:920`).
- It is an inert `<div class="tab ghost">` holding one `<span class="tab-ghost-fill">` with the
  closed tab's label. No pin, no dot, no conflict glyph, no close button (`tabs.js:606-623`).
- It plays `nb-tab-ghost-close`: `flex-basis` from `var(--nb-tab-ghost-from)` to `0`, opacity `1`
  to `0`, over `--tab-close-duration` `--tab-close-ease`, `forwards` (`style.css:1294-1297`).
- It is removed by a flat 280 ms timer, not by `animationend` (`tabs.js:618`).
- Survivors keep their frozen widths and slide left as the ghost's basis shrinks.
- A render mid-collapse rebuilds the node and resumes it with a negative `animation-delay`
  (`tabs.js:617`).
- `.tab.ghost` must never be driven by the release keyframes (`style.css:1299`).
- A pinned tab's ghost renders into `#tab-pinned` and keeps the region visible until it retires
  (`tabs.js:591`, `:581`).

The ghost's fill uses the tab's target geometry (padding, radius, border, type) so the collapsing
box is a convincing copy of the tab that left.

### 6.2 What the tests read

These are text assertions; the values are frozen even though the tokens have twins.

| Assertion | Literal | Test |
|---|---|---|
| `.tab-bar` declares `--tab-release-duration: 180ms` | 180 ms = `--dur-2` | `tests/dom/test_dom.js:6484` |
| `.tab-bar` declares `--tab-release-ease: ease-out` | = `--ease-out` | `:6487` |
| `.tab-bar.nb-tab-equalizing .tab` animation shorthand | — | `:6502` |
| Same rule `animation: none` under reduced motion | — | `:6506` |
| `.tab-bar` declares `--tab-close-duration: 100ms` | 100 ms = `--dur-0` | `:7034` |
| `.tab-bar` declares `--tab-close-ease: ease-out` | = `--ease-out` | `:7037` |
| `.tab.ghost { pointer-events: none }` | — | `:7040` |
| `.tab.ghost` animation shorthand, `forwards` | — | `:7042` |
| `@keyframes nb-tab-ghost-close` from/to | — | `:7050-7058` |

The four `--tab-*` declarations stay as literals on `.tab-bar` with a comment noting the token
each equals. Rewriting them to `var(--dur-2)` would fail four assertions.

### 6.3 Reduced motion

| Motion | Reduced |
|---|---|
| Release re-equalize | `animation: none` (`style.css:1259-1261`) and JS never adds the class (`tabs.js:514`) |
| Ghost | Not created (`tabs.js:920`); CSS forces `animation: none; opacity: 0` as a second line (`style.css:1305-1308`) |
| Reveal scroll | `scroll-behavior: auto` (`style.css:524-526`) |

Both branches leave the strip in its final state, never half-applied.

### 6.4 What is never animated

Tab widths while dragging (only frozen widths and a ghost animate, foundations §7.4); the strip's
scroll position outside the reveal; the bar's height; the active border colour; anything on first
paint. No entrance animation, no hover transition on `.tab` — a tab's hover is instant, like every
other row in the app.

---

## 7. ARIA and focus

### 7.1 Roles

| Element | Attributes |
|---|---|
| `#tab-pinned` | `role="tablist"`, `aria-label="Pinned files"`, `aria-orientation="horizontal"`; `hidden` while empty, which removes it from the tree |
| `#tab-list` | `role="tablist"`, `aria-label="Open files"`, `aria-orientation="horizontal"` |
| `.tab` | `role="tab"`, `aria-selected="true"` on the active tab and `"false"` on the rest, `tabindex="0"` on the region's roving stop and `"-1"` on the rest, `aria-label` = the accessible name (§7.2) |
| `.tab-close` | A native `<button type="button">`, `aria-label="Close {name}"`, `tabindex="-1"`, `aria-hidden="true"`. It is the pointer path; `Delete` and the tab menu are the accessible paths. A focusable interactive inside `role="tab"` is invalid ARIA, so the close is removed from the accessibility tree rather than announced as a nested control |
| `#viewer` | `role="tabpanel"`, `aria-label` = the active file's name, written by `render()` |

No `aria-controls`. The panel is shared: every tab feeds the same `#viewer`, and a special tab's
content is a different container altogether (`tabs.js:826-849`), so `aria-controls="viewer"` on all
tabs would be true for files and false for `§graph`. `aria-selected` plus a named panel carries
the relationship without the lie. `controls.md` §6.2's generic tablist row lists `aria-controls`;
this is the one surface where it is omitted, and §11 records it.

### 7.2 Accessible names

The name is the label plus zero or more state phrases, in this fixed order, joined by `", "`:

```
{basename}[, pinned][, unsaved changes][, changed on disk]
```

Always written, so a test can compare one string. The visible glyphs are `aria-hidden="true"` —
the name carries the state, not the picture (foundations §3.4: status is never colour alone).
The close button's `aria-label` uses the bare name, without state phrases.

The tab's `title` stays the full path (`tabs.js:651`), which disambiguates two open `index.md`
files. Keep the close button's shipped `title="Close (middle-click also closes)"` and add the
`aria-label`; the tooltip is a hint, not the name.

### 7.3 Roving tabindex across two lists

Each visible region has exactly one `tabindex="0"`:

1. the last tab to receive focus in that region, if it is still open;
2. otherwise the active tab, if it is in that region;
3. otherwise the region's first tab.

The selected tab and the roving stop are independent. When the active file is unpinned, the
pinned region has **no** `aria-selected="true"` tab — a tablist with no selection is legal, and
pretending otherwise would announce a pinned file as current. `controls.md` AC4's wording ("the
active tab in each") cannot hold in that case; §11 records it.

### 7.4 Focus ring

| Element | Ring |
|---|---|
| `.tab` | `var(--focus-ring)` at `var(--focus-offset-inset)` (−2). The strip clips vertically and neighbours are 2 px apart, so an outset ring would be cut on the first tab and collide with the next. |
| `.outline-toggle` | `var(--focus-ring)` at `var(--focus-offset)` (+2). It is outside the scroller. |

Both are `:focus-visible` only; a pointer click draws neither. The tab ring is a second accent line
inside the active tab's own accent border; that is deliberate — the state and the focus are two
different facts.

### 7.5 Announce-on-close

No live region is added to the bar: the bar has exactly three children (sessions.md:1468), and a
toast on every close would be noise for a pointer user who watched it happen.

The announcement is the focus move. `Delete` lands focus on the neighbour tab, so assistive
technology announces "b.md, tab, 2 of 4, selected" — the new state, not the departure. Closing the
last tab of a region moves focus to the other region's roving stop; closing the last tab of the
strip moves focus to `#viewer` (`tabindex="-1"`), which announces the empty state. That is the
whole contract; do not add a `role="status"` child to the bar.

---

## 8. Phone

`#tab-bar` is `display: none` under the mode switch (`style.css:7085`); `#outline-toggle` is
hidden separately (`:7020`) because it only exists for the desktop outline pane. The DOM stays,
`tabs.js` keeps running, and every strip path no-ops at zero width (`tabs.js:722-723`).

What replaces tab switching:

| Job | On the phone |
|---|---|
| Name the current file | `#mobile-title` in the topbar shows the active file's base name (`static/js/mobile.js:150-158`, `:853`). It is a 44 px button, `aria-label="Note {name} — browse notes"`. |
| Switch file | Tapping the title opens the drawer, which lists the files (`static/js/mobile.js:1143-1149`). One file is open at a time in practice; the tab set still exists underneath. |
| Close the current file | The topbar `⋯` menu (`#mobile-more`), not a tab. |
| Pin, reorder, bulk close | Not offered. The strip's whole feature set is desktop-only, by `mobile-shell.md` §3.4. |

Do not add a mobile tab strip, a swipe-between-tabs gesture, or a "recent files" chip row to
approximate it. The phone has one title and one drawer, and that is the model.

---

## 9. Tokens and CSS target

### 9.1 Proposed additions

Two, and no more.

| Token | Value | Where | Why it cannot reuse an existing token |
|---|---|---|---|
| `--opacity-drag` | `.4` | Primitives block | Five shipped rules dim a dragged row at `.4` (`style.css:1238`, `:1323`, `:2888`, `:2983`, `:1362`). `--opacity-disabled` (.45) means "unavailable", which a dragged tab is not. One name for one idea. |
| `--tab-h` | `34px` | `.tab-bar` (component-local) | `foundations.md` §8.1 names it as the bar height; today it exists only as a literal (`style.css:494`). Component-local because `.tab-bar` is its only consumer. |

Not added: `--tab-close-hit` (`--control-h-sm`), `--tab-focus-offset` (`--focus-offset-inset`),
a dirty-dot size (`--space-2`), a tab radius (`--radius-sm`), an accent-on-wash colour (there is no
such state), or a second opacity for the ghost (the ghost fades through its keyframes).

`--tab-min-width`, `--tab-width`, `--tab-max-width`, `--tab-release-*` and `--tab-close-*` stay
component-local on `.tab-bar`, the `--stg-*` model (`foundations.md` §2.1).

### 9.2 The CSS, in this order

Replace the rules in place; keep the tab section together. Every literal in the strip becomes a
token except the four animation ones the tests read.

```css
.tab-bar {
  --tab-h: calc(34px * var(--font-scale));  /* foundations §8.1; scales with the tab type */
  --tab-min-width: 120px;
  --tab-width: 170px;
  --tab-max-width: 220px;
  /* These four stay literals: tests/dom/test_dom.js:6484, :6487, :7034, :7037
   * assert the values. They equal --dur-2/--ease-out/--dur-0/--ease-out. */
  --tab-release-duration: 180ms;
  --tab-release-ease: ease-out;
  --tab-close-duration: 100ms;
  --tab-close-ease: ease-out;

  display: flex;
  align-items: flex-end;
  gap: var(--space-hair);
  flex: 0 0 auto;
  height: var(--tab-h);
  padding: 0 var(--space-1);
  background: var(--surface-panel);
  border-bottom: var(--stroke-1) solid var(--border);
  overflow: hidden;
}

.tab-list   { gap: var(--space-hair); }   /* the rest of :506-528 is unchanged */
.tab-pinned { gap: var(--space-hair); }   /* the rest of :535-546 is unchanged */

:where(#tab-bar) .tab {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 1 1 var(--tab-width, 170px);
  min-width: var(--tab-min-width, 120px);
  max-width: var(--tab-max-width, 220px);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  background: var(--surface-raised);
  border: var(--stroke-1) solid var(--border);
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
  white-space: nowrap;
  font-size: var(--text-ui-lg);
  color: var(--text-muted);
  user-select: none;
}
:where(#tab-bar) .tab:hover {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
/* Dirty before active: the active face and border always win. */
:where(#tab-bar) .tab.dirty {
  background: var(--accent-soft);
  color: var(--text-primary);          /* was --text-muted: 3.65/4.37 on the wash */
}
:where(#tab-bar) .tab.dirty .tab-label::before {
  content: "";
  display: inline-block;
  width: var(--space-2);
  height: var(--space-2);
  margin-right: var(--space-1);
  border-radius: var(--radius-circle);
  background: var(--accent);
  vertical-align: middle;
}
:where(#tab-bar) .tab.active {
  background: var(--surface-page);
  color: var(--text-primary);
  border-color: var(--accent);
}
:where(#tab-bar) .tab .tab-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
:where(#tab-bar) .tab .tab-close {
  display: grid;
  place-items: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  margin-block: calc(-1 * var(--space-1));  /* keeps the tab 28 px tall */
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  cursor: pointer;
}
:where(#tab-bar) .tab .tab-close:hover {
  color: var(--danger);
  background: var(--accent-soft);
}
:where(#tab-bar) .tab .tab-close .icon { width: var(--icon-md); height: var(--icon-md); }

:where(#tab-bar) .tab .tab-pin { width: var(--icon-sm); height: var(--icon-sm); }
:where(#tab-bar) .tab.pinned { padding-right: var(--space-2); }
:where(#tab-bar) .tab .tab-conflict { width: var(--icon-sm); height: var(--icon-sm); color: var(--warn); }

:where(#tab-bar) .tab.dragging { opacity: var(--opacity-drag); }
:where(#tab-bar) .tab.drop-before { box-shadow: inset var(--stroke-2) 0 0 0 var(--accent); }
:where(#tab-bar) .tab.drop-after  { box-shadow: inset calc(-1 * var(--stroke-2)) 0 0 0 var(--accent); }

:where(#tab-bar) .tab:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}
.tab-bar .outline-toggle:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}

.tab-bar .outline-toggle {
  display: grid;
  place-items: center;
  align-self: center;
  flex: 0 0 auto;
  width: var(--control-h-md);
  height: var(--control-h-md);
  padding: 0;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.tab-bar .outline-toggle:hover { color: var(--text-primary); background: var(--accent-soft); }
.tab-bar .outline-toggle[aria-pressed="true"] { color: var(--accent); background: var(--accent-soft); }
```

The ghost block keeps its shape. Only the fill's geometry changes:

```css
.tab-ghost-fill {
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  gap: var(--space-1);
  border: var(--stroke-1) solid var(--border);
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: var(--surface-raised);
  font-size: var(--text-ui-lg);
  color: var(--text-muted);
}
```

`.tab.ghost`, `@keyframes nb-tab-ghost-close`, `@keyframes nb-tab-equalize` and
`.tab-bar.nb-tab-equalizing .tab` are untouched.

`.outline-toggle` is scoped `.tab-bar .outline-toggle` on purpose: today the bare
`.outline-toggle` rule at `:563` is *earlier* than `.icon-btn` at `:1345` and loses to it on equal
specificity, so its `font-size` and `padding` are dead. The compound selector makes the rule win
and keeps the intent readable.

### 9.3 Markup and JS deltas

| File | Change |
|---|---|
| `templates/index.html:293` | The toggle's text glyph `≣` becomes `<svg class="icon"><use href="#nb-icon-outline"/></svg>`; add `aria-pressed="false"`. Add three symbols after the existing ones (`:51-109`): `nb-icon-close`, `nb-icon-conflict`, `nb-icon-outline`; reuse the existing `nb-icon-pin`. |
| `static/js/tabs.js:644-702` | `role="tab"`, `aria-selected`, `tabindex`, `aria-label`; the pin and conflict spans become `<svg class="icon …">`; the conflict node moves out of `.tab-label` to the tab's flex row; each close button gets `aria-label` and `tabindex="-1"`; a `mousedown` guard for middle-click. |
| `static/js/tabs.js` | The roving-stop state, the key handler (§5.6), `onClose` focus return on the menu, the 0,0 anchor fallback. |
| `static/js/app.js:751-760` | `applyOutlineState()` also sets `aria-pressed` on `#outline-toggle` and swaps its `title` between "Show outline" and "Hide outline". |
| `static/css/style.css` | §9.2, in place. |

### 9.4 Order

One commit, not seven. The CSS alone cannot pass AC3–AC8, and the JS alone would render roles
over the old faces. Within the commit:

1. CSS first, because every JS change below assumes the new geometry and the focus rule.
2. Sprite symbols, then the markup swap; the old text glyphs are removed in the same edit.
3. `tabs.js` roles, names, roving stop and key handler.
4. `app.js` outline-toggle state.
5. Run `node tests/dom/test_dom.js`; the tab, pinned-region and animation blocks must stay green
   (AC13, AC14, AC16). Then the `core` and `mobile` browser suites (AC16, AC21).

---

## 10. Acceptance criteria

Each is testable and names the file and the observable result. `style.css` is
`static/css/style.css`.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | The bar has exactly three element children, in order: `#tab-pinned`, `#tab-list`, `#outline-toggle` | `templates/index.html`, `static/js/tabs.js` | `#tab-bar.children.length === 3`; the toggle is not a descendant of `#tab-list`; a zero-tab bar still renders the toggle |
| **AC2** | Two valid tablists, no third | `static/js/tabs.js` | `#tab-pinned` and `#tab-list` each have `role="tablist"` and a distinct `aria-label`; `#tab-bar` has no `role`; when nothing is pinned, `#tab-pinned` has `hidden` and no focusable child |
| **AC3** | One roving stop per visible region | `static/js/tabs.js` | Exactly one `.tab` in each visible region has `tabindex="0"`; the active one has `aria-selected="true"`; with the active file unpinned the pinned region has no tab with `aria-selected="true"` |
| **AC4** | Arrow keys move and select inside a region | `static/js/tabs.js` | `ArrowRight` on the last tab of a region stays there; `Tab` moves to the other region; `Home`/`End` stay inside the region; the ends do not wrap |
| **AC5** | `Delete` closes and moves focus | `static/js/tabs.js` | `Delete` on a focused tab closes it; focus lands on `pickNeighbor()`'s tab; closing a region's last tab moves focus into the other region; closing the strip's last tab moves focus to `#welcome` |
| **AC6** | Close buttons are pointer-only and not announced | `static/js/tabs.js` | Every `.tab-close` has `tabindex="-1"` and `aria-hidden="true"`; its hit box is 24 × 24; `style.css` gives it `--control-h-sm`; `Delete` and the tab menu close the tab from the keyboard |
| **AC7** | Every state is in the accessible name | `static/js/tabs.js` | A pinned dirty conflicting tab's `aria-label` is `"{name}, pinned, unsaved changes, changed on disk"`; every glyph inside a tab is `aria-hidden="true"` |
| **AC8** | Both controls draw a focus ring | `style.css` | `.tab:focus-visible` uses `var(--focus-ring)` at `var(--focus-offset-inset)`; `.outline-toggle:focus-visible` uses the 2 px offset; tabbing the strip never lands on an unstyled control |
| **AC9** | The dirty label clears the text floor | `style.css` | A dirty inactive tab's label colour is `--text-primary`; measured 8.31:1 dark / 11.49:1 light on `--accent-soft` (was 3.65 / 4.37) |
| **AC10** | Hover is perceivable as a control state | `style.css` | `.tab:hover` border is `--border-strong`; measured 3.62:1 dark / 3.36:1 light on `--surface-raised` |
| **AC11** | The active tab keeps its face and border in every combination | `style.css` | In source order `.tab.dirty` precedes `.tab.active`; a tab with both classes renders `--surface-page` and an `--accent` border |
| **AC12** | The tab's numbers come from tokens | `style.css` | No `5px`, `6px`, `10px`, `11px`, `.89rem` or `16px` remains as a property value in the tab, bar, ghost-fill and toggle rules; the only remaining literals are the token declarations (`--tab-h`, the width rails, the four animation values) |
| **AC13** | The animation literals survive | `style.css` | `tests/dom/test_dom.js` green at `:6484`, `:6487`, `:6502`, `:6506`, `:7034`, `:7037`, `:7040`, `:7042`, `:7050-7058` |
| **AC14** | Geometry is unchanged where it is contractual | `style.css` | `.tab-pinned` keeps `flex: 0 0 auto`, `max-width: 50%`, `overflow-x: auto`; `.tab-pinned .tab` keeps `flex: 0 0 auto`; `.tab-pinned[hidden]` is `display: none` — the `== tab pin + region ==` and `== tab pinned region ==` blocks in `tests/dom/test_dom.js` stay green |
| **AC15** | No tab is taller than the bar at any font scale | the mockup, `style.css` | At 1.0 the tab is ≈28.5 px in a 34 px bar; at 1.3 it is ≈34.4 in a 44.2 px bar; the toggle is 30 × 30 and `align-self: center` |
| **AC16** | The strip still scrolls, reveals and preserves | `static/js/tabs.js` | `tests/browser/test_core_ui_browser.js` "tab strip scroll" stays green; the wheel tests in `tests/dom/test_dom.js` still see `scrollBy({left, behavior:"instant"})` |
| **AC17** | No emoji and no text glyph in the bar | `templates/index.html`, `static/js/tabs.js`, `static/js/graph.js` | The §11.3 glyph grep (`foundations.md`) finds no `📌`, `↻`, `≣`, `×` in the tab code path and no `🕸` in the special-tab registration |
| **AC18** | The drag indicator cannot clip | `style.css` | `.drop-before` / `.drop-after` are `inset` box-shadows; `tests/dom/test_dom.js`'s drag block stays green |
| **AC19** | The menu is keyboard reachable and returns focus | `static/js/tabs.js` | `Shift+F10` on a focused tab opens `#nb-menu`; `Esc` closes it and focus is back on that tab |
| **AC20** | Reduced motion leaves no mid-state | `style.css`, `static/js/tabs.js` | With reduce emulated: no equalizing class, no ghost, no smooth scroll |
| **AC21** | The phone is unchanged | `style.css` | `#tab-bar` is `display: none` under the mode switch; `tests/browser/test_mobile_browser.js:269` and `:303-305` still read `tabDisplay === "none"` |
| **AC22** | The mockup is self-contained | `tab-bar-mockup.html` | Opens offline in both themes with zero network requests |

---

## 11. Conflicts, and what not to build

### 11.1 Conflicts found

Twelve entries where a design record disagrees with the shipped CSS, or two records disagree.
Each is recorded with a position; none is silently resolved.

| # | Conflict | Evidence | Position |
|---|---|---|---|
| **C1** | `controls.md` §6.1.7 promises "one Tab stop per visible region". Today the `.tab` is a `div` with no `tabindex`, so the strip's only Tab stops are one per close button — ten open tabs are ten stops and no way to select one. | `static/js/tabs.js:644`; `controls.md:944` | §5.6 and §7.3 add the roving stop and remove the close stop. This is the strip's largest change. |
| **C2** | `foundations.md` §9.3 requires `📌`, `↻`, `≣`, `×` to be sprite symbols. The strip still ships all four. | `tabs.js:657`, `:681`, `:692`; `index.html:293`; `foundations.md:592-597` | AC17 replaces all four. This is the strip's share of foundations AC8. |
| **C3** | A resting tab's boundary is `--border`, which measures **1.24:1** dark / **1.18:1** light against `--surface-raised`; the face delta to `--surface-panel` is 1.11 / 1.08. Foundations §3.5 requires 3:1 for a control boundary. | `style.css:1190`; `foundations.md:182-192` | **Recorded, not fixed.** A tab is one of a row of like controls: the boundary between neighbours is a separator (§3.5 exempts separators), and the state information is carried by the active tab's accent border (5.39 / 4.93) and by hover's `--border-strong` (AC10). Raising every tab's outline to 3:1 would put a hard box around each of six tabs and fight P1. If a reviewer overrules this, the change is one declaration and must be decided globally (the Settings segmented container has the same problem). |
| **C4** | `.tab.dirty` is declared after `.tab.active` and sets `background: --accent-soft; border-color: --accent`, so a dirty active tab loses the page face it is supposed to join, and two tabs can carry an accent border. | `style.css:1200` vs `:1207` | §9.2 puts `.dirty` before `.active` and drops the dirty border. Active always wins. |
| **C5** | A dirty inactive tab's label is `--text-muted` on `--accent-soft`: **3.65:1** dark / **4.37:1** light, under the 4.5 text floor. | `style.css:1196`, `:1207` | Fixed: `--text-primary` on the dirty face (8.31 / 11.49), the same remedy `sessions.md`/`controls.md` apply to a selected row. |
| **C6** | `.tab-conflict` paints `--danger`; `controls.md` §4 says the tab's conflict glyph is `--warn`. | `style.css:1315`; `controls.md:861` | Follow `controls.md`: `--warn` (5.65 / 4.34 on the wash; an icon needs 3:1). A newer file version is a caution, not an error. |
| **C7** | `frontend.md` §7 and `controls.md` §5 call `#tab-list` "the only part of the row that scrolls", but `.tab-pinned` is also `overflow-x: auto` and the wheel handler scrolls it. | `docs/architecture/frontend.md:391`; `style.css:542`; `tabs.js:1318-1334`; the DOM test "wheel over the pinned region scrolls it" | Two scrollers: `#tab-list` always when it overflows, `#tab-pinned` only past the 50 % cap. The **bar** never scrolls. §3.4 states it that way. |
| **C8** | "Pinned tabs rest at their natural width" (`tab-equalization.md` §2.4) omits that the shared `min-width: 120px` still applies, so a short pinned name is 120 px, not its content width. | `style.css:557` leaves `min-width` in force; `tab-equalization.md:164-173` | §3.2 states `max(120, content)`. No CSS change: the rail is wanted, so a pinned strip does not become a row of tiny stubs. |
| **C9** | `#outline-toggle`'s `aria-label` says "Toggle outline pane", its `title` says "Show outline", and neither changes when the pane is collapsed. It has no `aria-pressed` or `aria-expanded`. Its `.outline-toggle` rule (`:563`) also loses to `.icon-btn` (`:1345`) on equal specificity, so its `font-size` and `padding` are dead. | `index.html:293`; `app.js:757-762`; `style.css:563`, `:1345` | Fixed: one stable name, `aria-pressed` mirroring `outlineCollapsed`, a swapping `title`, and the compound selector in §9.2. |
| **C10** | `context-menus.md` still names a `#tab-context-menu` host in `tabs.js`; the menu is `NB.menu`'s shared `#nb-menu`. | `docs/architecture/context-menus.md:41`; `tabs.js:1456-1460` | Stale record, no code change. §5.5 references `NB.menu`. |
| **C11** | `controls.md` §2.2 lists `.tab-close` as a 24 px `sm` icon button; the shipped box is ≈15 × 16 with a 16 px text `×`. | `controls.md:206`; `style.css:1218-1227` | Follow `controls.md`; the hit grows to 24 × 24 without growing the tab (§2.2). |
| **C12** | `controls.md` §6.2 requires `aria-controls` on a tab; this strip omits it because a special tab feeds a different container. | `controls.md` §6.2; `tabs.js:826-849` | Omitted here, recorded. The panel is named and `aria-selected` carries the relationship; `aria-controls="viewer"` would be false for `§graph`. |

Two smaller findings, not conflicts:

- `tabs.js:649` asks `NB.viewer.isDirty(path)` during `render()`, and `render()` runs on every
  watcher tick; a dirty marker is a full rebuild. Out of scope, but it is why the scroll
  preservation matters so much.
- A special tab's icon is a module emoji (`graph.js:172` `icon: "🕸"`), rendered into
  `.tab-special-icon` (`style.css:5014`). It is chrome, not content, so it moves to the rail's
  icon channel in the same change that converts the rail (foundations §9.3, AC17).

### 11.2 What not to build

| Rejected | Reason |
|---|---|
| A third tablist, or a wrapper around the two regions | A tablist may contain only tabs; the bar has exactly three children (sessions.md:1468) and the toggle is one of them. §1.3 |
| A `role="tablist"` on `#tab-bar` | Same reasons, plus it would swallow the toggle. |
| `aria-controls` on every tab pointing at `#viewer` | False for special tabs, and it adds nothing over `aria-selected` plus a named panel. §7.1 |
| A live region inside the bar | No fourth child. Focus movement already announces the new tab. §7.5 |
| A toast on every close | Noise for a pointer user who watched the tab go. §7.5 |
| Edge fade, scroll chevrons, or a visible scrollbar | The reveal removes the failure; a fade dims the tab just revealed; a chevron costs 48 px of a 34 px row; gradients are forbidden (foundations §11.4). §3.5 |
| A second scroll container for the pinned region beyond its cap | It already scrolls internally; the bar must not. |
| `scrollIntoView()` for the reveal | It also scrolls the window and every ancestor. §3.4 |
| Wrapping tab arrows | Crossing the region boundary is more useful and the two rules conflict. §5.6 |
| `Ctrl+W` | The browser owns it. §5.6 |
| Double-click to close or pin | No shipped handler, no user model for it, and it collides with the second `click`'s `activate()`. §5.1 |
| A read-only lock badge, a missing-file badge, or a red dirty face | Those states do not exist on a tab. §2.5 |
| A per-tab close `×` on a pinned tab | Pin means keep; the menu and `Delete` close it. §2.3 |
| Animating widths while dragging, or animating the ghost's survivors | foundations §7.4; the freeze exists to stop exactly that. §6.4 |
| A custom tooltip for the truncated label | `title` already carries the full path; no custom tooltip component exists (controls.md §2.10). |
| Rewriting `--tab-*` to `var(--dur-*)` | Four DOM assertions read the literals. §6.2 |
