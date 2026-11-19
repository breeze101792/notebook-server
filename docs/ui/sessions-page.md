# Sessions page — the `§sessions` content page

Status: Current spec — pre-implementation (new surface).

Reference mockup: [`sessions-page-mockup.html`](sessions-page-mockup.html) — the shell at 1280, the page
at its two real tracks (740 → two columns, 960 → three), the selection with its chip, a two-tab drag
onto a marked card, read-only, dark and light.

**Normative source.** This document owns the `§sessions` content page: entry, host, header, the
selection chip, the grid, cards, tab rows, selecting tabs, the drag that moves one or many tabs
between sessions, the row menu, the click that opens a tab, and the page's states, keyboard and
ARIA. It does not own the session model, persistence or the `moveSessionTabs` call order — those are
[`../architecture/sessions.md`](../architecture/sessions.md) §7 and `static/js/tabs.js`. It does not
own the Sessions side-panel view ([`sessions.md`](sessions.md)), the tab strip
([`tab-bar.md`](tab-bar.md)), the special-tab mechanism or the reader ([`reader.md`](reader.md)).
Every claim cites `file:line`.

**Prerequisite.** `NB.tabs.moveSessionTabs(targetId, items)`, specified in
[`../architecture/sessions.md`](../architecture/sessions.md) §7. Every pixel reads base and
component tokens that already ship; no token is added.

---

## 1. What this page is

A tab can only be moved to another session through the tab context menu (`Move to session`); that
path exists for the **active** session's tabs, one tab at a time (`tabs.js:1543-1558`), and it names
sessions without showing what they hold. Nothing in the app shows the tabs of a session that is not
on screen: the Sessions view lists names and counts only (`sessions.js:384-395`).

This page is the missing view: every session as a card, every card listing its own tabs, a selection
across cards, and a drag from one card to another that moves the whole selection. It is a content
page, not a side panel — the tab bar, the edit bar state and both side panels stay, exactly as with
`§graph` ([`graph-view.md`](graph-view.md) §1).

It owns exactly three gestures: **select tabs**, **move tabs**, **open a tab**. It does not create,
rename, delete or reorder sessions.

---

## 2. Entry and placement

| Thing | Rule | Source |
|---|---|---|
| Entry control | `#sessions-page-btn.session-page-btn` in the Sessions **view header**, after the `+` and **before** the collapse control | `sessions.js:162-172` |
| Shape | 24 × 24, radius 5, `--text-muted`, the `.session-add` box beside it | `sessions.js:162-167`; `style.css:8271-8292` |
| Glyph | `#nb-icon-page-grid`, new: four rounded rects in a 2 × 2 box inside the 16 box | sprite, `index.html:103-119` |
| Label | `aria-label="Open the sessions page"`, same `title` | — |
| Action | `NB.tabs.openSpecial("§sessions")` — opens in the active session, or focuses it when already open there | `tabs.js:2008-2021` |
| At the cap | the active session at 40 unpinned tabs: the shipped full-session notice, and no page | `tabs.js:2009-2019` |
| Tab | a special tab, id `§sessions`, icon `#nb-icon-session`, label `Sessions` | `index.html:103-109`; `tabs.js:2001-2004` |
| Host | `#sessions-page.sessions-page.special-tab-view`, a sibling of `#graph-view` inside `#edit-split`, `hidden` in the template: after `#graph-view`'s close at line 801 and before the `</div>` at line 802 | `index.html:645-801`, `:802` |
| Shown | `NB.viewer.showSpecial()` hides the viewer, welcome and editor, then the tab's `onActivate` unhides the host | `viewer.js:648-662` |
| Hidden | `viewer.js` hides every `.special-tab-view` when a file, the welcome screen or another special tab shows | `viewer.js:639-642` |
| Persistence | none of its own: `§sessions` is a path in a session's `openFiles`, like `§graph` | `tabs.js:270-283` |
| Phone | no phone surface: the entry follows the graph button's hiding rule (§12.2); the phone restores the shared tabs but hides a `§sessions` tab that is active | `style.css:8077-8079` (the graph precedent); `app.js:1528-1545` |

The button is inserted **before** the collapse control, which is the frame's second-action slot
([`shell-frame.md`](shell-frame.md) §4.2) and also what keeps
`tests/browser/test_mobile_browser.js:526` finding the collapse as `.panel-header .collapse-btn:last-child`.
The rail keeps its eight views: this page adds no view, so the activity-bar order and the phone rail
are untouched.

`#sessions-page` ships in `templates/index.html` **and** in the jsdom harness fixture
(`tests/dom/test_dom.js:390`), or the harness's shell differs from the template.

---

## 3. Header

`.sessions-page-header` is one row: the title left, the summary and the selection chip right. There
are no tools; the page is live from the model and has nothing to refresh.

| Part | Value |
|---|---|
| Height | `min-height: 47px`, one line (the graph header's height, so the two pages agree) |
| Padding | `var(--space-2) var(--space-4)` |
| Face | `--surface-panel`, 1 px `--border` bottom |
| Title | `<h1 class="sessions-page-title" tabindex="-1">Sessions</h1>`, `--text-lg`, `--fw-heading`, `--text-primary`, `margin: 0`; `tabindex="-1"` because it is the page's focus fallback when the last row disappears |
| Summary | `<span class="sessions-page-summary">3 sessions · 9 tabs</span>`, `--text-sm`, `--text-muted`, tabular, `margin-left: auto` |
| Selection chip | `<span class="sessions-page-selection">3 tabs selected <button class="sessions-page-clear">×</button></span>`, hidden until two rows are selected; `--text-sm`, `--accent`; the clear button is a 24 × 24 icon button, `aria-label="Clear selection"` |

**The summary counts entries, not files.** `9 tabs` is the sum of every session's `openFiles`
length; a note open in two sessions counts twice, because the page is about tab entries. Singular
forms are `1 session` and `1 tab`. The chip's text is `1 tab selected` / `3 tabs selected`.

The title is the app's first content-page `<h1>`: `§graph` has no page title, and
[`reader.md`](reader.md) §9 records the reader's missing landmark as a gap (P6,
`reader.md:344-345`); this page adds the heading it can. No landmark is added: `#layout` is the
app's `<main>` (`index.html:359`).

---

## 4. Grid and cards

| Part | Value |
|---|---|
| Scroller | `.sessions-page-body`, `flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; padding: var(--space-4)` |
| Grid | `.sessions-page-grid`, `display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); align-items: start` |
| Card | `.session-card`, `display: flex; flex-direction: column; min-width: 0; background: var(--surface-panel); border: 1px solid var(--border); border-radius: var(--radius-md)` |
| Order | `sessionOrder`, the same order the Sessions view shows | `tabs.js:270-283` |

**Columns follow the editor track, not the viewport.** The grid is `auto-fill` at a 280 minimum, so
the card count is a function of the pane's width. The default shell spends 48 on the rail, 240 on the
panel and 220 on the outline (`style.css:20-28`), so at 1280 the track is 772 and the usable grid 740
→ **two** columns; with the outline collapsed the track is 992 and the grid 960 → **three**; with
both collapsed 1232 / 1200 → **four**; at 900 with both panels open the track is 392 and the grid 360
→ **one**. The page never fixes a column count.

Every session renders a card, including an empty one: an empty card is the drop target that makes
"move into this session" reachable. A card never shrinks its rows to fit; the page scrolls.

Sessions are **not** reordered here. Card order follows the model and the side panel's drag,
`Move up` and `Move down` own it (`sessions.md` §3, §4).

---

## 5. Card header

| Part | Value |
|---|---|
| Row | `.session-card-header`, `display: flex; align-items: center; gap: var(--space-2); min-height: var(--control-h-md); padding: 0 var(--space-2) 0 var(--space-3); border-bottom: 1px solid var(--border)` |
| Title element | `<h2 class="session-card-title" id="…">` holding the name and the accessible phrases |
| Name | `.session-card-name`, `--text-ui`, `--fw-semibold`, `--text-primary`, one line, ellipsis, `title` = the full name |
| Count | `.session-card-count`, `--text-sm`, `--text-muted`, tabular, `4 tabs` / `1 tab`; unpinned only. Carries `data-count-text` so a drag can restore it |
| Dirty | `.session-card-dot`, 8 px `--accent` dot, `aria-hidden`, a sibling **after** the `<h2>` so state trails identity; the `<h2>` carries `, unsaved changes` as `.sr-only` |
| Current | `.session-card.is-current`: 1 px `--accent` border and an `--accent-soft` header face; the `<h2>` carries `, current session` as `.sr-only` |

The count excludes pinned tabs for the same reason every other count does: pins are shared and
belong to no session ([`sessions.md`](sessions.md) §6).

The card has **no left accent bar**. On a card whose height is a header plus N rows, a bar sized to
the header reads as a row marker and competes with the row's own current marker; the border and the
tinted header are the card's only current signal, one signal per surface.

The header is **not** a control. It names the card and carries its state; the actions are the tab
rows below it (proposal P2 records the alternative).

The card header's 600 weight is deliberate: it is a heading, not a list row, so §2.1's "400
everywhere" applies to the rows inside the card and to no other line.

---

## 6. Tab rows

One row is a wrapper plus one button, so the wrapper can be the drag source without making a button
its own drag handle (the Sessions row's shape, `sessions.js:439-453`).

```html
<li class="session-card-tab-wrap" draggable="true" data-path="notes/a.md" data-session-id="main">
  <button type="button" class="session-card-tab" title="notes/a.md"
          aria-label="a.md, unsaved changes">
    <span class="session-card-mark is-empty" aria-hidden="true"></span>
    <span class="session-card-tab-name">a.md</span>
    <span class="session-card-state" aria-hidden="true"><span class="session-card-dot"></span></span>
  </button>
</li>
```

### 6.1 Columns

Every row is the same three boxes, so every name shares one left edge and every state one right
edge — the row contract's reserved-column rule ([`guidelines.md`](guidelines.md) §2.1):

| Column | Element | Width | Content | When it does not apply |
|---|---|---|---|---|
| Mark | `.session-card-mark` | 14 | a special tab's module sprite — `#nb-icon-graph` for `§graph`, `#nb-icon-session` for `§sessions` | empty, `visibility: hidden` |
| Label | `.session-card-tab-name` | flexes, ellipsis | the base name, or a special tab's `label` | — |
| State | `.session-card-state` | 14 | the 8 px `--accent` dot when dirty; the `#nb-icon-conflict` glyph, `--warn`, when the disk copy is newer | empty, `visibility: hidden` |

There is **no close column**: a card row is a select, drag and open target, not a close control.
Closing stays where it ships — the strip's `×` and the Tabs view's row (`tabs-view.md` §4.1).

A pinned tab never appears: `openFiles` excludes pins in every session, and the page's footer says
so (§10).

### 6.2 Geometry and states

| Property | Value |
|---|---|
| Row height | `min-height: var(--control-h-md)` (30), the Tabs view's row, so the two surfaces that list a session's tabs agree (`tabs-view.md` E2) |
| Padding | `3px 6px 3px 8px` |
| Radius | `--radius-xs` |
| Gap | `var(--space-1)` between the mark and the name |
| Rest | transparent; `--text-primary`; `--text-body` / `--lh-normal`; weight 400 |
| Hover | `--accent-soft` |
| Focus | `--focus-ring` at `--focus-offset-inset` |
| Current | the active session's active tab: `--accent-soft` and a 2 × 14 `--accent` bar at the left edge; `aria-current="true"`. The current row is the page's own `§sessions` tab, which is honest |
| Selected | `--accent-soft` face and a 1 px inset `--accent` ring; the accessible name ends `, selected`. Selection and current coexist: the ring and the bar are different marks |
| Special | the module sprite in the mark column; the name is the registered `label`, `--text-muted`, italic |
| Dirty | the state column shows the dot; the name carries `, unsaved changes` |
| Conflict | the state column shows the conflict glyph instead of the dot; the name carries `, changed on disk` |
| Dragging | the wrapper dims to `--opacity-drag` |
| Long name | ellipsis; `title` = the full path (a special tab's label) |

A session's `activeFile` marks nothing on a card that is not the current session. The only
"active" signal on this page is the live one, the strip's active tab.

No checkbox is added to a row. Selection is a face and a phrase, the way pin and dirty already are.

---

## 7. Selecting tabs

The selection is per page and spans cards. Its key is `{sessionId, path}`, not the path: the same
note may be open in two sessions, and those are two tabs (`../architecture/sessions.md` §2).

| Gesture | Result |
|---|---|
| Click a row | **selects that row and nothing else**; never opens. It is the file-manager gesture: one click, one selection, and the first click of a double click. A row that is already the sole selection stays selected |
| Double-click | opens the tab (§9). The two clicks that precede it only leave that row selected |
| `Cmd`+click (macOS) / `Ctrl`+click | toggles that row; never opens; sets the anchor. On macOS `Ctrl`+click is the system's secondary click and opens the row menu instead — the page does not fight the platform |
| `Shift`+click | selects the range in that card, from the anchor to the clicked row, in the card's strip order; never opens. With no anchor in that card it selects just the clicked row; a click in another card re-anchors instead of ranging |
| `Space` on a focused row | toggles that row; handled on `keydown` and prevented there, so the browser never synthesises the click; never opens |
| A click outside every row | empty space, a card header, the footer or the page background: clears the selection; never opens |
| The chip's `×` | clears the selection (the chip exists only at two or more) |
| Row menu (`Shift+F10`, Menu key, right-click) | acts on the row, or on the selection when the row is selected |
| Any re-render | keys whose `{sessionId, path}` no longer exists are pruned |
| A successful move | the moved keys leave the selection |
| A refused move | the carried keys stay selected, so the user can retry elsewhere |

The chip appears at **two or more** selected rows and shows `N tabs selected`; a single selection is
the row's face alone, so a click does not raise a chip. Its clear button is the pointer path and
`Space` on a selected row is the keyboard path; a click outside every row clears too. Clearing from
the chip moves focus to the last cleared row, else the page's `<h1>`: a clear must never drop focus
to `<body>`.

**A viewer cannot select.** Selection leads only to a move, and a viewer cannot move; refusing the
selection keeps the chip out of a read-only page (AC13).

`Ctrl+A` (select every tab on the page) and a marquee are not built (proposals P6, P7).

---

## 8. Moving tabs

One gesture, one model call, one outcome.

| Rule | Behaviour |
|---|---|
| Source | `.session-card-tab-wrap` is `draggable` for an admin; a viewer's wrappers are not draggable and the grid never calls `preventDefault` on `dragover` |
| Carried set | if the dragged row is selected, the whole selection; otherwise that row alone. An unselected-row drag leaves the selection untouched, so a refused drop never costs a selection |
| Payload | `text/plain` = the first carried path, plus the carried `{sourceId, path}` list held in the module while the drag lives |
| Target | any `.session-card`; the card under the pointer receives the drop, wherever inside it the pointer is |
| Target mark | exactly one card, the one under the pointer: `.session-card.is-drop-target` takes an `--accent` border and a 1 px inset accent ring, and its count text is swapped for `Move here` — no node is inserted and no number is computed, so the card cannot change height and the label cannot lie |
| No mark | on a card whose session already holds **every** carried path: the collapsed batch would be empty, so the drop is a no-op. A card holding only *some* of them is still marked — that drop removes the other copies |
| Mark handoff | a `dragover` on another card clears the previous mark first; one `dropCardId` in the module, never a set |
| Drop | `NB.tabs.moveSessionTabs(targetSessionId, carried)`, then every mark clears and the moved keys leave the selection. The drop never switches sessions |
| Suppressed click | the click that follows a drop is swallowed, so a move never also opens the tab |
| All-or-nothing | the batch is refused whole when the target cannot take every new entry; nothing moves and the carried keys stay selected |
| Refusal copy | the shipped `This session is full — close a tab or open a new session.` (`tabs.js:50-51`) |
| Duplicates | a carried path the target already holds is a removal from its source only — no duplicate row, no capacity cost; two cards carrying the same path collapse to one entry in the target |
| Vanished tab | a carried tab closed elsewhere before the drop fails the model's validation; the refresh prunes its row, which is the visible outcome (proposal P9 asks for a toast) |
| Re-render mid-drag | the view clears its drag state **before** it rebuilds: a re-render detaches the source node, so `dragend` never arrives and a drop would resolve against cards the user never saw |
| Leaving | `dragend`, or a `dragover` that lands outside every card, clears the mark |
| Coarse pointer | HTML5 drag is pointer-only; on touch the row menu is the move path |

**The menu is the other half of the gesture.** `Shift+F10`, the Menu key, or a right-click on a row
opens `NB.menu` at that row with one item, `Move to session ▸`, whose submenu lists every session
**except the one that already holds every carried path** — a single row's own session, for a one-row
menu; for a selection spanning cards, a card's session is listed when it holds only some of the
carried paths, because that move pulls the other copies in. It moves the row, or the selection when
the row is selected. With one session the submenu would be empty, so the parent is disabled with
`There is only one session.` (`NB.menu` honours `disabled` and `title` on a parent,
`menu.js:113-146`). A viewer's item is disabled with `Read-only: sessions can’t be changed.`; a target
without room for the batch is disabled with the full-session sentence. `Esc` closes it and returns
focus to the row. A move from the menu focuses the moved row at its **new** key `{targetId, path}`;
`NB.menu` closes before the handler runs (`menu.js:120`), so the page carries that key as a
pending focus target across the rebuild. This is the keyboard and touch path the drag cannot serve.

**The page's own tab is a tab.** Dragging the `§sessions` row onto another card moves the page's tab
to that session; the source session activates its neighbour and the page leaves the pane. That is
the rule the strip and the tab menu already follow, and it is not special-cased.

---

## 9. Opening a tab

| Step | Rule |
|---|---|
| Double-click, `Enter` | activate the row. A single click never activates (it selects that row, §7) |
| Other session | `await NB.tabs.swapTo(sessionId)`; a `false` return (a failed hybrid commit, a cancelled confirm) leaves the page and the focus on the row |
| Then | `await NB.tabs.activate(path)`; the tab becomes active and the page is replaced by that tab. A `swapTo` that succeeded has already replaced the page, so the activation result is not surfaced — and `swapTo` also returns `false` when another surface switched sessions first (`tabs.js:863`), which likewise leaves the page |
| Same session | `activate(path)` only; no swap |
| In flight | one jump at a time: a second activation while a swap is pending is ignored |
| Not open | a tab that is no longer open activates nothing and returns silently (`tabs.js:893`); the next `tabs:changed` prunes its row |
| Focus | the page is replaced by the tab it opened, so a jump never restores focus into the page |

A jump is the same act the strip performs, so it obeys the same guards (`tabs.js:893-913`).

---

## 10. States

| State | What shows |
|---|---|
| Ready | one card per session, in model order; the summary counts sessions and tab entries |
| One session | one card; nothing else changes |
| Empty session | the card, its header count `0 tabs`, and `.session-card-empty` reading `No tabs`; the card is still a drop target |
| Empty page | impossible: at least one session exists (`tabs.js:373-380`) |
| 20 sessions | the grid grows and the page scrolls; no cap notice here — the Sessions view owns the cap |
| 40-tab card | the card grows; a drop onto it is refused with the shipped message |
| Selection active | the ringed rows; at two or more, the chip and its count; the live region carries the sentence |
| Dirty | the card header shows the dot; the row shows its own dot |
| Conflict | the row's state column shows the conflict glyph; the card header does not change |
| Current session | the accent border and the tinted header |
| Read-only (viewer) | every card renders; no selection, no drag; the menu's move item is disabled; the footer drops its drag sentence |
| Entry at the cap | the full-session notice, no page: the active session is at 40 unpinned tabs (`tabs.js:2009-2019`) |
| Locked | the page's own tab closes with every other tab, so the page leaves with the shell (`tabs.js:2124-2140`) |
| Phone | no page: the entry is hidden and the phone restores no tabs (`app.js:1528-1545`) |
| Coarse pointer at ≥1024 | the page is reachable; rows 44 high for a tap-that-jumps; a drag does not exist, so the row menu is the move path where the platform fires `contextmenu` |
| Footer | `Drag a tab onto another session to move it. Pinned tabs are shared and are not listed here.`; a viewer reads only the second sentence |

**Accepted limit.** An outdated cached shell that boots with `§sessions` in the state drops the
unregistered id and publishes the removal, exactly as it would for `§graph`
(`tabs.js:213-219`). The `sw.js` cache bump is the mitigation; there is no second one.

---

## 11. Keyboard and ARIA

| Element | Contract |
|---|---|
| Page | `<h1 tabindex="-1">` title (the focus fallback); no landmark (the app's `<main>` holds it) |
| Chip | `<span>` with text and a native clear button; not a live region |
| Live region | `.sessions-page-live`, `role="status"`, `.sr-only`, announces `1 tab selected` / `3 tabs selected` / `Selection cleared` |
| Card | `<section class="session-card" aria-labelledby="sp-card-<i>">`; the `<h2>` names the card: `Work 4 tabs[, unsaved changes][, current session]` |
| List | `<ul class="session-card-list">`, one `<li>` per tab; no `role="listbox"`, no `role="tablist"` — the strip is the tab widget (`tab-bar.md` §7.1) |
| Row | native `<button type="button">`; accessible name `{name}[, selected][, unsaved changes][, changed on disk]`; `aria-current="true"` only on the active tab of the active session |
| Keys | `Enter` opens; `Space` toggles selection (the native click is prevented); `Shift+F10` or the Menu key opens the row menu; `Esc` closes it and returns focus to the row. With a pointer, a click selects, a double click opens, a click outside every row clears (§7) |
| Tab order | the clear button (when visible) → rows in DOM order. Worst case 20 × 40 = 800 stops; that is the list contract, and the Tabs view has the same exposure. The strip's roving tabindex exists because a strip is one composite widget, not because a list should be one |
| Row menu | `role="menu"`, one roving stop, submenu for the sessions; disabled items keep their reason in `title` |
| Re-render | focus is restored by `{sessionId, path}` only when focus was already inside the page; the scroll position is kept |

**Re-render rules.** `tabs:changed` refreshes through a signature compare (`ids`, `names`,
`openFiles` order, `activeFile`, `activeSessionId`, `activePath`); a `viewer:dirty-changed` or
`viewer:conflict` event patches only the rows carrying that path **and** recomputes those rows'
card dot from the whole session — no rebuild, so a keystroke in another tab cannot make this page
stutter (the Tabs view's per-path guard, `tabs-view.js:632-653`). A rebuild clears the drag state
first (§8), then restores focus when the page had it — by `{sessionId, path}`, or to the pending
menu-move key (§8) — and otherwise leaves focus where the user put it; `scrollTop` is kept.
When a focused row disappears and no successor key exists, focus falls to the page's `<h1>`, never to
`<body>`.

---

## 12. Tokens and the CSS target

### 12.1 Reuse

No token is added. Every value is a base, primitive or existing component token. One sprite symbol
is added — `#nb-icon-page-grid`, four rounded rects in a 2 × 2 box, stroke 1.3, `fill: none`, in the
same 16 box as `#nb-icon-session`: the Sessions view's glyph (two landscape bars) marks the set, the
page's glyph marks the cards that set is shown as.

### 12.2 Target rules

```css
/* --- §sessions page (docs/ui/sessions-page.md) ----------------------- */
.sessions-page {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-page);
}
.sessions-page[hidden] { display: none; }

.sessions-page-header {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-height: 47px;
  padding: var(--space-2) var(--space-4);
  background: var(--surface-panel);
  border-bottom: var(--stroke-1) solid var(--border);
}
.sessions-page-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--fw-heading);
  line-height: var(--lh-tight);
  color: var(--text-primary);
}
.sessions-page-summary {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.sessions-page-selection {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--accent);
  font-size: var(--text-sm);
}
.sessions-page-selection[hidden] { display: none; }
.sessions-page-clear {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border-radius: var(--radius-sm);
  color: var(--accent);
}
.sessions-page-clear:hover { background: var(--accent-soft); }
.sessions-page-clear:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}

.sessions-page-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-4);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}
.sessions-page-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
  align-items: start;
}

.session-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-panel);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-md);
}
.session-card.is-current { border-color: var(--accent); }
.session-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-2) 0 var(--space-3);
  border-bottom: var(--stroke-1) solid var(--border);
}
.session-card.is-current .session-card-header { background: var(--accent-soft); }
.session-card-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  min-width: 0;
  flex: 1 1 auto;
}
.session-card-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-ui);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.session-card-count {
  flex: 0 0 auto;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.session-card-dot {
  display: block;
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-circle);
  background: var(--accent);
}

.session-card-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  margin: 0;
  padding: var(--space-1);
  list-style: none;
}
.session-card-tab-wrap { display: flex; min-width: 0; }
.session-card-tab {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-h-md);
  padding: 3px 6px 3px 8px;
  background: none;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-body);
  line-height: var(--lh-normal);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.session-card-tab:hover { background: var(--accent-soft); }
.session-card-tab[aria-current="true"] { background: var(--accent-soft); }
.session-card-tab[aria-current="true"]::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  width: var(--stroke-2);
  height: var(--icon-sm);
  margin-top: calc(-1 * var(--icon-sm) / 2);
  border-radius: 0 1px 1px 0;
  background: var(--accent);
}
.session-card-tab.is-selected {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 var(--stroke-1) var(--accent);
}
.session-card-tab:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}
.session-card-mark,
.session-card-state {
  flex: 0 0 var(--icon-sm);
  display: grid;
  place-items: center;
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.session-card-mark { color: var(--text-muted); }
.session-card-mark svg,
.session-card-state svg { display: block; width: var(--icon-sm); height: var(--icon-sm); }
.session-card-state svg { color: var(--warn); }
.session-card-mark.is-empty,
.session-card-state.is-empty { visibility: hidden; }
.session-card-tab-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.session-card-tab-wrap.is-special .session-card-tab-name { color: var(--text-muted); font-style: italic; }
.session-card-tab-wrap.is-dragging { opacity: var(--opacity-drag); }

.session-card.is-drop-target {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 var(--stroke-1) var(--accent);
}
.session-card.is-drop-target .session-card-count {
  color: var(--accent);
  font-weight: var(--fw-semibold);
}
.session-card-empty {
  margin: 0;
  padding: 6px var(--space-3) 10px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-style: italic;
}

.sessions-page-foot {
  flex: 0 0 auto;
  padding: 9px var(--space-4) 10px;
  border-top: var(--stroke-1) solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--lh-snug);
}

/* The Sessions view header: the page button is the .session-add box. */
.session-page-btn {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  border-radius: 5px;
  color: var(--text-muted);
}
.session-page-btn:hover { color: var(--text-primary); background: var(--accent-soft); }
.session-page-btn:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}

/* Phone: no page (no entry, no restore). A page already open when the window
 * narrows keeps the same grid, which auto-fills to one column. */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  #sessions-page-btn { display: none; }
}
/* Coarse pointer, tablet and up: a tap jumps, so the target grows; no drag
 * exists. 44 is a number because --m-hit is declared inside the phone query
 * only (style.css:7851), and the shipped tablet rule does the same
 * (style.css:5408-5419). */
@media (pointer: coarse) and (min-width: 1024px) {
  .session-card-tab { min-height: 44px; padding: 0 var(--space-2) 0 var(--space-3); }
  .sessions-page-clear { width: 44px; height: 44px; }
}
```

### 12.3 Geometry

Header 47; page padding 16; grid gap 16, card minimum 280; card radius 8; card header 30; row 30
(coarse 44); mark 14; state 14; dot 8; current bar 2 × 14; selected ring 1; drop ring 1; chip clear
24 (coarse 44).

### 12.4 JS surface

| File | Change |
|---|---|
| `templates/index.html` | `#sessions-page` between lines 801 and 802; `#nb-icon-page-grid` in the sprite; `<script src="/static/js/sessions-page.js" defer>` after `tabs-view.js` (line 2094) |
| `static/js/sessions-page.js` **(new)** | Registers `§sessions`; builds the header, grid, cards and footer once; the signature refresh and the per-path patch; the selection model, chip and live region; drag source and drop targets; the row menu; the jump |
| `static/js/sessions.js` | `#sessions-page-btn` after the `+` in `.panel-header-actions`; click opens `§sessions` |
| `static/js/tabs.js` | `moveSessionTabs(targetId, items)` exported; `moveSessionTab` is its one-item wrapper; `moveToSession` keeps its signature |
| `static/js/viewer.js` | nothing: `.special-tab-view` is already generic |
| `static/sw.js` | precache `sessions-page.js`; bump `CACHE` (`sw.js:57`, `:64-120`) |
| `package.json` | the `test:browser:sessions-page` script for the new suite |
| `tests/browser/run_all.js` | the `sessions-page` suite entry (`run_all.js:16-31`) |
| `static/css/style.css` | §12.2 |

Registration runs at load, not on `DOMContentLoaded`: `sessions-page.js` loads after `tabs.js`
(`index.html:2094`), unlike `graph.js`, which loads before it and must defer (`graph.js:198-207`).

---

## 13. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | The Sessions header button opens one `§sessions` tab and the page replaces the reader | `sessions.js`, `sessions-page.js`, `tabs.js` | `.session-add`, then `#sessions-page-btn`, then the collapse; one tab; the strip and both panels stay; a second click focuses the same tab; at the 40-tab cap the shipped notice appears and no page opens |
| **AC2** | Header: `<h1>Sessions</h1>`, `N sessions · M tabs`, and a hidden-until-used selection chip | `sessions-page.js` | Text and plural forms; the chip `hidden` while nothing is selected; the summary is not a live region |
| **AC3** | One card per session, in `sessionOrder`, each naming its session, count and state | `sessions-page.js` | Card count equals `snapshot().length`; order equals the Sessions view's; `4 tabs`; the dirty dot; `aria-labelledby` resolves |
| **AC4** | A card lists that session's unpinned tabs in strip order; an empty card says `No tabs`; no pinned tab appears | `sessions-page.js`, `tabs.js` | Row paths equal `snapshot()[i].openFiles`; `0 tabs` + `No tabs`; a pinned path appears nowhere |
| **AC5** | The current session is marked, and its active tab is `aria-current="true"` | `sessions-page.js`, `style.css` | `.is-current` on that card; one `aria-current` row across the page |
| **AC6** | A double click switches to that session and activates that tab | `sessions-page.js` | A single click clears the selection and opens nothing; the double click that follows opens; same session activates only; another session's double click swaps then activates; a `swapTo` returning false leaves the page and the focus |
| **AC7** | Selection: a click selects only that row, `Cmd`/`Ctrl`+click toggles, `Shift`+click ranges inside one card, `Space` toggles, the chip's `×` and a click outside every row clear, and a viewer cannot select | `sessions-page.js` | One selected row after a click, no chip; a range spans only that card; the click leaves the reader on the page; a `Shift`+click in another card re-anchors; a click on the body or the footer empties it; `Space` neither opens nor lets the browser synthesise a click; as a viewer `Space` and the modifiers change nothing |
| **AC8** | Selection is visible and announced | `sessions-page.js`, `style.css` | `.is-selected` face and ring; `, selected` in the name; the live region says `1 tab selected`, `3 tabs selected` and `Selection cleared`; the chip appears at two rows and not at one; the chip's clear focuses the last cleared row, never `<body>` |
| **AC9** | An admin drags one tab onto another card and it moves | `sessions-page.js`, `tabs.js` | The source loses the row, the target gains it, `snapshot()` agrees, no switch; one state write for the move, plus the neighbour activation's own change when the moved tab was the live active one |
| **AC10** | An admin drags a multi-card selection onto one card and every tab moves, once | `sessions-page.js`, `tabs.js` | All rows move; one state write for the batch (a neighbour activation after it may emit its own change); the moved keys leave the selection |
| **AC11** | Duplicates collapse, and a target holding only some carried paths is still a real target | `tabs.js`, `sessions-page.js` | A path carried from two cards lands once and costs no capacity; every other occurrence leaves its source; that target is marked; a target holding **every** carried path is not marked and the drop is a no-op |
| **AC12** | A batch is refused whole when the target has no room | `tabs.js` | 40 unpinned on the target; the shipped sentence; nothing moves; the carried keys stay selected |
| **AC13** | A viewer cannot select, drag or move | `sessions-page.js` | Every wrapper has `draggable === false`; `dragover` is not prevented; no chip, no ring; the menu's `Move to session` is disabled with its reason |
| **AC14** | A re-render abandons a drag and leaves no stale state | `sessions-page.js` | A `tabs:changed` mid-drag clears `.is-dragging`, `.is-drop-target` and the count swap; a following drop is a no-op; a strip drag over the grid is not mistaken for one |
| **AC15** | A re-render never steals focus or scroll, and a dirty bit patches only its rows and their card dot | `sessions-page.js` | A remote `tabs:changed` with focus outside the page leaves it; focus on a row returns to it; `scrollTop` survives; a `viewer:dirty-changed` touches only rows of that path and recomputes that card's dot |
| **AC16** | The grid fills the editor track, not a fixed count | `style.css` | Two columns at 1280 with both panels open, three with the outline collapsed, one at 900 with both open |
| **AC17** | The row menu moves the tab or the selection and is keyboard-operable | `sessions-page.js` | `Shift+F10` opens at the row; the submenu omits only the session holding every carried path; a full target is disabled with its reason; a move lands and focuses the moved row; `Esc` returns focus |
| **AC18** | Locked and phone states are what §10 says | `sessions-page.js`, `style.css`, `tabs.js` | After `auth:locked` the page is gone with its tab; the entry is hidden at the phone breakpoints; a coarse pointer gets 44 px rows and no drag |
| **AC19** | The mockup is self-contained | `sessions-page-mockup.html` | Opens offline, dark and light, zero network requests |

### 13.1 Shipped tests this change must update

| Test | Asserts | Change |
|---|---|---|
| `tests/dom/test_dom.js:390` (harness fixture) | the shell beside `#graph-view` | add `#sessions-page` with the same markup as the template |
| `tests/dom/test_dom.js:2532-2548` | the module load list | add `sessions-page.js` after `tabs-view.js` |
| `tests/dom/test_dom.js:44742-44790` (sessions block) | the Sessions header builds, rows, menus | the header now has a second action; add the page block beside it |
| `tests/browser/test_core_ui_browser.js:1761-1766` | header title, `.session-add`, footer | unchanged selectors; the new suite asserts the button |
| `tests/browser/test_mobile_browser.js:526` | `.panel-header .collapse-btn:last-child` | unchanged **because** the page button is inserted before the collapse; a reorder breaks this test |
| `tests/browser/run_all.js:16-31` | the suite list | register `sessions-page` |

A new suite, `tests/browser/test_sessions_page_browser.js` (`npm run test:browser:sessions-page`),
covers AC1, AC3–AC12, AC14–AC17 with real drag events; `npm test` covers the model, the selection
model and the DOM.

---

## 14. Exceptions

| # | Change | Why | Delta |
|---|---|---|---|
| E1 | The page has an `<h1>`; the card header is an `<h2>` naming the card | `§graph` has no page title, and `reader.md` §9 records the reader's missing landmark as a gap (P6) | none |
| E2 | Card rows are 30 high (`--control-h-md`), not the row contract's 27 | They list the same thing the Tabs view lists; the two surfaces must not drift (`tabs-view.md` E2) | +3 px per row |
| E3 | The Sessions view header gains one action (2 before collapse) | The page needs a door; the frame's cap is 2 | +24 px of header |
| E4 | No phone surface; the entry hides at the phone breakpoints | Touch has no drag or range selection, and the phone strip is not shown; `§graph` sets the same precedent | none |
| E5 | A row context menu on a content page | The drag has no keyboard or touch path; the Sessions view solved the same problem with its row menu (`sessions.md` §4) | one menu, one item |

---

## 15. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P2 | Clicking a card header switches to that session | One click instead of two to reach a session | A second navigation path and a focus question mid-drag |
| P3 | A phone path: a long-press sheet with `Move to session ▸` | The page and its drag are desktop-only | Touch gesture plus a sheet |
| P4 | A `New session…` control in the page header | An empty card is a drop target a user may want to create | A second create control next to the panel's `+` |
| P5 | Collapse a card to its header | 20 sessions with 40 tabs each is a long page | Card state to persist, and a second disclosure model |
| P6 | `Ctrl+A` selects every tab on the page | Faster than `Shift`+click per card | One more shortcut that competes with a browser binding |
| P7 | A marquee selection over the cards | One drag selects many | A hit-test surface and a second drag model |
| P8 | The footer states the selection count too | Would duplicate the chip | More copy for one fact |
| P9 | A toast when a carried tab vanished before the drop | The prune is the only feedback today | One message on a rare race |

---

## 16. What not to build

- A second Sessions list, a session manager, or session create/rename/delete/reorder on this page.
- Tabs grouped by *file type*, by workspace, or by anything but session.
- A close control, a bulk close, or a "close session" action on a card row.
- Note previews or thumbnails inside a card: the cards list names and state, nothing else.
- A colour or glyph per session: `sessions.md` P3 keeps that unbuilt.
- Checkboxes in rows, or a checkbox column. Selection is a face and an accessible phrase.
- Dragging a whole card, or reordering sessions here.
- `role="tablist"` / `role="tab"` / `role="listbox"` on the grid; the strip is the tab widget.
- A second tab menu. The strip's menu is the tab menu (`tab-bar.md` §5.5); this page's row menu has
  one item and moves tabs between sessions.
- A phone layout. The page is desktop-only, like `§graph`.
