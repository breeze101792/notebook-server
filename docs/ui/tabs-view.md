# Tabs view — the open files as a side-panel list

Status: Current spec — pre-implementation (new view).

Reference mockup: [`tabs-view-mockup.html`](tabs-view-mockup.html) — normal at 240, row anatomy, the
state strip, empty, the 140 floor, the phone drawer, and the shell with the top strip hidden and the
rail's outline twin, dark and light.

**Normative source.** This document owns the `tabs` activity view: host, header, rows, states, the
menu entry point, empty state, keyboard and ARIA, and the phone use of the same view. It does not own
the tab model, persistence, switching or dirty state — those are
[`../architecture/sessions.md`](../architecture/sessions.md) and `static/js/tabs.js`. It does not own
the tab context menu ([`tab-bar.md`](tab-bar.md) §5.5), the frame
([`shell-frame.md`](shell-frame.md)), the shared view conventions
([`side-panel-views.md`](side-panel-views.md)), or the row contract
([`guidelines.md`](guidelines.md) §2.1). Every claim cites `file:line`.

**Prerequisite.** None. The view uses base tokens only (§9.1); it needs four small `NB.tabs`
exports (§9.3).

---

## 1. Why this view exists

Two jobs the shell cannot do today:

| Job | Today | With this view |
|---|---|---|
| See every open file at once, by name | The 34 px strip hides all but the visible tabs past overflow (`tab-bar.md` §3.1), and hides entirely on a phone (§3.6). | A vertical list in the panel: every open file, pinned and unpinned, with state. |
| Reach the open set on a phone | No surface at all: one title and one drawer (`mobile-shell.md` §3, §14). | The same view in the drawer (`mobile-shell.md` §4). |

It also makes `#tab-bar` removable (§10): once the list exists, a user who wants the 34 px back can
hide the strip without losing the open set.

---

## 2. Placement

| Thing | Rule | Source |
|---|---|---|
| Activity view | `tabs`; one rail entry on both shells — an icon on desktop, a More row on the phone until promoted — placed by the saved bar order | `activity.js:95-131` |
| Registration | `tabs` registers **last**, after `ai`. With an empty `sidebarOrder` it is therefore the eighth view; with a saved order it is appended after the named entries, exactly like every other view added later | `app.js:84`, `activity.js:119-131`; [`activity-bar-order.md`](activity-bar-order.md) §1 |
| Promotion | The user moves it up in Settings → Appearance → Activity bar, or drags the rail; it then keeps that slot on both shells | `activity-bar-order.md` §3 |
| Host | `#tabs-view`, a `.side-panel-view`, ships empty **after `#ai-view`**, so the template's `data-view` order matches the registration order (a shipped test asserts equality) | `templates/index.html:442`; `tests/dom/test_dom.js:37669` |
| Build at load | `tabs-view.js` builds the header and list at load, the `sessions.js` pattern: the host stays in the DOM, `[hidden]` swaps visibility, so scroll and row state survive every view switch | `sessions.js:1-16`; `activity.js:96` |
| Scope | the **active session's** unpinned tabs, plus the shared pinned set | `tabs.js:33-36`, `:243-256` |
| Count | every row in the list, pinned included | §3 |

No migration writes a default slot: a user who never opened the Activity-bar list sees Tabs eighth,
and a user with a saved order sees it appended. The phone's rail is the first six views of that order,
so in the default order Tabs is a **More** row until it is promoted (`mobile-more-sheet.md` §1.2).

A path may be open in several sessions; the list never merges them. Switching session changes the
list through `tabs:changed` (`tabs.js:808-817`).

---

## 3. Header, footer, empty block

| Part | Value | Source |
|---|---|---|
| Header | `.panel-header`, 34 px, padding `0 12px`, gap 8 | `shell-frame.md` §4.2 |
| Title | `Tabs`, `.72rem` 400, uppercase, tracking `.08em`, `--text-muted` | `side-panel-views.md` §1.2 |
| Count | the `.session-total` chip reused verbatim (`.72rem` 600, `--fg-muted`, tabular, `min-width: 20px`), with `.tabs-total` as the hook the floor rule and the tests address; the unit lives inside it as `.sr-only` (` open files`), so the chip reads `5 open files` and paints `5` | `sessions.js:150`; `style.css:9260-9275` |
| Actions | collapse only, `makeCollapseBtn()` | `activity.js:428-439` |
| Footer | `class="sessions-foot tabs-foot"` — the Sessions footer geometry, not a copy of it: `padding: 9px 12px 10px`, `border-top`, `--text-sm`, 8 px gap, a pin sprite at `1em` + the pinned model. `.tabs-foot` is a hook only | `style.css:9439-9457` |
| Empty | `.tabs-empty`, a **sibling of the list**, not inside it | `side-panel-views.md` §1.5 |

There is no add action: a file opens from Explorer, Search, Recent or a bookmark. There is no
**Close all** — `tab-bar.md` §5.4 records why that control does not exist, and this view does not
reintroduce it.

The chip counts every row shown, pinned included, because every one of those rows is on screen. A
session row counts unpinned tabs only because pinned tabs are not in that row's list
(`sessions.md` §3); the two counts answer different questions and are not meant to agree.

The footer is unconditional: it explains why two rows appear in every session, and it is the only
place that states the pinned model on this surface.

At the 140 px floor the chip leaves the line and stays in the accessibility tree, the container rule
the Sessions header uses (`style.css:9460-9475`).

---

## 4. Rows

One row is a wrapper plus two sibling buttons: a button cannot contain a button (`sessions.md` §3).

### 4.1 Columns, left to right

Every row is the **same skeleton**. A column is never dropped because its mark does not apply: it
stays, empty and hidden. That is what puts every label on one left edge and every close box on one
right edge, and it is the rule the Explorer's icon column already follows (`side-panel-views.md`
§2.1: the tree reserves a glyph slot per row).

| Column | Element | Width | Present | Content | When it does not apply |
|---|---|---|---|---|
| Mark | `.tab-item-mark` | 14 | always | the pin sprite (`#nb-icon-pin`, `--text-muted`) if pinned; otherwise the special tab's module sprite | empty, `visibility: hidden` |
| Label | `.tab-item-name` | flexes, ellipsis | always | the base name, or a special tab's label | — |
| State | `.tab-item-state` | 14 | always | the 8 px `--accent` dot if the file has unsaved edits; the `#nb-icon-conflict` sprite (`--warn`) if the disk copy is newer — see below | empty, `visibility: hidden` |
| Close | `.tab-item-close` (unpinned) or `.tab-item-gap` (pinned) | 24 | always | the close button, unpinned | an inert 24 px box, pinned |

Order is fixed. Marks lead the name so a long name's ellipsis can never eat them. The label is the
only flexible child; it truncates, and the full path is the row's `title`.

**Identity leads, state trails.** The mark column says *what the row is* (pinned, special) and sits
before the name. The state column says *what the row is doing* (unsaved, changed on disk) and sits
after it, next to the close. That split is deliberate: a dirty mark must never push the name to the
right, and an unsaved edit is not an identity.

**Reserved, not inserted.** A hidden mark or state keeps its box: `visibility: hidden`, never
`display: none` and never omission. A pinned row reserves the close column with `.tab-item-gap` — an
empty span, not a disabled button, so nothing extra is announced. Without the reserved boxes a
pinned row's label would start 14 px right of an unpinned row's and a pinned row's name would run
24 px past every other name's truncation point; the list would read as a ragged column instead of a
table.

**One state column, not two.** A conflict (a newer disk copy) can only exist while edits are held, so
it always implies unsaved changes: the column shows the conflict sprite instead of the dot, and the
accessible name still says `, unsaved changes, changed on disk`. Two glyphs in a 14 px slot would
have cost a second column for a state that never occurs alone.

**One mark column, one glyph.** A pinned special tab (legal: `togglePin` has no special guard) shows
the **pin**; the module sprite is not drawn in the same column. The italic label still marks it as
special. Two glyph columns would cost 18 px of a 140 px panel to say one thing twice.

**Names.** A file row's name is its base name. A special tab's name is its registered `label`
(`Graph`), never the pseudo-path — the same rule the strip applies (`tabs.js:675`, `:731`). Pinned
rows have no close button, exactly like the strip (`tab-bar.md` §2.3); a pinned row closes through
the menu in §5, after unpinning or via its `Close` item.

### 4.2 Geometry

| Property | Value | Token | Source |
|---|---|---|---|
| Row height | 30 at 1.0, follows `--font-scale` | `--control-h-md` | `sessions.md` §10.2; §13 E1 |
| Row padding | `3px 6px 3px 10px` | `--space-1`, `--space-3` | `style.css:9323` |
| Row radius | 4 | `--radius-xs` | `guidelines.md` §2.1 |
| Wrapper gap | 2 | `--space-hair` | `style.css:9314` |
| Mark column | 14 × 14 | `--icon-sm` | §4.1 |
| State column | 14 × 14 box with the 8 × 8 dot centred in it (3 px either side, no gap) | `--icon-sm`, `--space-2` | §4.1 |
| Close column | 24 × 24, radius 4 | `--control-h-sm`, `--radius-xs` | `style.css:9398-9408` |
| List gap / padding | 2; `6px 6px 10px`, right inset 8 for the resize handle | `--space-hair`, `--space-2` | `sessions.md` §10.2 |
| List scrolling | `scrollbar-gutter: stable` | — | `side-panel-views.md` §1.3 rule 2 |

The view is the panel's width: 240 default, 140 floor, 480 cap (`shell-frame.md` §1.2). The list is
the scroller; header, footer and empty block stay fixed.

### 4.3 Row states

| State | Face | Text | Mark |
|---|---|---|---|
| Rest | transparent | `--text-primary` | — |
| Hover | `--surface-raised` | `--text-primary` | — |
| Current (the active file) | `--accent-soft` | `--text-primary`, weight 400 | 2 × 14 px `--accent` marker at the left edge |
| Dirty | as above | as above | the state column shows the 8 px `--accent` dot, right of the name |
| Conflict | as above | as above | the state column shows the 14 px `--warn` glyph instead of the dot |
| Pinned | as above | as above | the mark column shows the pin, `--text-muted`; the close column is the inert `.tab-item-gap` |
| Special | as above | `--text-muted`, italic | the module sprite; never dirty, never conflicted (`tabs.js:60-70`) |
| Focus-visible | — | — | `--focus-ring` at `--focus-offset-inset` |

Source for the faces: `guidelines.md` §2.1 and `style.css:9338-9356`. Current and dirty coexist: the
wash and marker stay and the dot is kept. Weight never changes — selection is a face and a marker.

A row whose file was deleted closes through the shipped `file:deleted` handler; there is no
missing-file state to draw (`tab-bar.md` §2.5). A restored path that no longer exists on disk keeps
its row, because the tab keeps its cached content — also the strip's rule (`tab-bar.md` §2.5).

### 4.4 Row actions

| Gesture | Result |
|---|---|
| Click, `Enter`, `Space` | Activate the file (or the special tab) and reveal it in the reader |
| Click the close `×` | Close; a dirty file keeps the shipped confirm or draft stash path (`tabs.js:977-1031`) |
| Middle-click, unpinned | Close, and suppress the browser's autoscroll on `mousedown` (`tab-bar.md` §5.1) |
| Right-click, `Shift+F10`, Menu key | Open the tab context menu at the row (§5) |

Activating an already-current row is a no-op beyond re-revealing it.

---

### 4.5 Reorder

Order is the strip's `ordered` array, so a drag moves one fact (`tabs.js:33-36`). The contract is the
Sessions one plus the tab model's two rules:

| Rule | Behaviour |
|---|---|
| Pointer | A row's wrapper is `draggable`; the pointer's half of the target row picks before or after; the empty area below the list means last; `dragend`, or leaving the list, clears every mark |
| Drop mark | a 2 px `--accent` line on the target row's top or bottom edge; the list takes a 1 px dashed `--accent` outline while the empty area is the target |
| Segment clamp | a pinned row stays inside the pinned block, an unpinned row stays after it (`tabs.js:1386-1387`) |
| No switch | a drop never activates a tab; the active file is unchanged |
| Re-render | any `tabs:changed` mid-drag abandons the drag: the source node is detached, and a drop would resolve against rows the user never saw |
| Close button | a press on the close button never starts a drag — refused on `mousedown` and again on `dragstart`, because the browser retargets `dragstart` at the draggable wrapper |
| Viewer | no drag: the wrapper is not draggable and `dragstart` is refused (`NB.pageRole() === "admin"`, `sessions.js:1161`) |
| Persistence | the order is the tab order: it is written with the rest of the tab state and reaches other browsers like any tab change (`tabs.js:808-817`) |
| Phone | HTML5 drag is pointer-only; touch cannot reorder. Same as Sessions and the strip (§8) |

The model entry point is `NB.tabs.moveTab(path, targetPath, before)` — the strip's own `dropOnto`,
exported rather than reimplemented, so the two surfaces cannot clamp differently. A drop with no
target (the empty area) passes `null` and lands last.

---

## 5. The tab menu

The menu is the strip's, unchanged (`tab-bar.md` §5.5): pin, move to session, export, rename, copy,
copy path, copy link, bookmark, show in sidebar, close, close others, close to the right, close to
the left, delete. This view supplies the anchor and the row; it does not fork the item list.

Two rules are the view's, because it merges two regions the strip draws separately:

1. **Bulk closes are unpinned-only.** `closeRight` is `ordered.slice(i + 1).filter(p => !pinned.has(p))`
   (`tabs.js:1513-1520`). On a merged list, right-clicking the first pinned row would offer
   `Close to the right` while the rows visibly to its right are pinned and would survive. On a
   **pinned** row the three bulk items are `disabled` with the title `Pinned tabs are closed one at
   a time.` On an unpinned row they behave exactly as in the strip.
2. **The row advertises the menu.** `aria-haspopup="menu"` on the row button, `aria-expanded` only
   while that row's menu is open — on the surface that replaces the strip, the menu is the only path
   to pin, move, export and the bulk closes, so it must be announced.

The menu closes on `Esc` (reason `"esc"`, focus returns to the row), an outside click, or a second
right-click, per `NB.menu` (`menu.js:184-196`).

---

## 6. Empty, failure and lock

| State | What shows |
|---|---|
| No tabs | `.tabs-empty` below the header: `No files are open. Open one in Explorer.` — `--text-sm`, `--text-muted`, italic, padding `10px 12px` (`.bookmarks-empty`'s shape, `style.css:3340-3345`) |
| Empty pinned set | Nothing: the list simply starts at the first unpinned row. There is no "Pinned" heading to leave empty |
| Load failure | None. The view reads the model; it fetches nothing, so it has no error state |
| Auth locked | The tab model clears on `auth:locked` (`tabs.js:2028-2050`), so the list empties with the shell |
| Drag | Admin only; see §4.5 |

---

## 7. Keyboard, ARIA and focus

The panel list is a list of files, not a tab widget. `role="tablist"` stays where the strip is the
control (`tab-bar.md` §7.1); the panel follows every other side-panel list: native buttons with
`aria-current` (`sessions.md` §8).

| Element | Contract |
|---|---|
| View | no landmark; the panel provides it |
| Row | native `<button type="button">`; `aria-current="true"` on the active file; `aria-haspopup="menu"`; accessible name `{name}[, pinned][, unsaved changes][, changed on disk]`, the strip's phrase order (`tab-bar.md` §7.2), where `{name}` is the base name or a special tab's label |
| Close | native button, `aria-label="Close {name}"` — the base name or label, **without** state phrases, per `tab-bar.md:520`. The shipped strip currently appends them (`tabs.js:675`, `:748`); the strip is the surface that changes, not this one |
| Tab order | header collapse → rows in DOM order, each followed by its close button; a pinned row has one stop |
| Menu | `Shift+F10` or the Menu key on a focused row; `Esc` returns focus to the row |
| Announce-on-close | the focus move, not a live region: closing moves focus to the next row, else the previous, else the collapse control |

**Re-render and focus.** `tabs:changed` fires for every change, including remote syncs
(`tabs.js:808-817`). A re-render must not steal focus:

- it records a restore target **only when `document.activeElement` is already inside the view**, and
  restores that same control — the row or that row's close button — by path, the `sessions.js:421-440`
  guard;
- with focus elsewhere (the reader, the editor, the panel header) it re-renders silently.

No `Delete` binding and no roving tabindex: two stops per row is the shipped cost of a list that
carries a close control, and it matches Sessions. The strip's roving tabindex exists because a strip
is one composite widget; a list is not.

---

## 8. Phone

The view is hosted in the drawer (`mobile-shell.md` §4). Nothing is built twice.

| Part | Rule |
|---|---|
| Rail | not in the default six; a **More** row until promoted (`activity.js:148-162`, `mobile-more-sheet.md` §1.2) |
| Header | the drawer header: 52 high, a 44 px close (`mobile-shell.md` §4) |
| Rows | 44 high, padding `0 8px 0 12px`, close 44 × 44, `--m-hit` |
| Activate | a tap opens the note and closes the drawer — `NB.mobile.closeDrawer()` after the activation resolves, the `sessions.js:821` pattern; without it an empty file would leave the drawer up |
| Menu | long-press is not a thing here; the row's menu is reached on desktop only, so pin and bulk close stay desktop-only, as they already are (`tab-bar.md` §8) |
| Reorder | not reachable: HTML5 drag needs a pointer. The order stays shared, so a change made on desktop shows here on the next render (§4.5) |
| Title | `#mobile-title` still names the active file; the view is the list, not the title |

---

## 9. Tokens, CSS and the JS surface

### 9.1 Reuse

No token is added. Every value resolves to a base, primitive or existing component token, and every
glyph is an existing sprite symbol except one: `#nb-icon-tabs`, a **portrait sheet with three text
rules** in the same 16-box style as `#nb-icon-session` (`templates/index.html:103-108`). Sessions keeps
the two landscape bars ("a named set of tabs"), so the rail reads set-versus-notes. It is framed, not
ragged, so it can never read as `#nb-icon-outline`, and it is not the Workspace's offset cards.

### 9.2 Target rules

```css
/* The host is a size container so the header can shed the count at the 140 px
 * floor, the Sessions pattern: the panel width is --side-panel-width, which no
 * viewport query can see. */
.side-panel-view[data-view="tabs"] { container-type: inline-size; }

.tabs-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-hair);
  margin-right: var(--space-2);
  padding: 6px 6px 10px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}
/* The empty state hides the scroller; its display:flex must not beat [hidden]. */
.tabs-list[hidden] { display: none; }

.tab-item-wrap {
  flex: 0 0 auto;              /* rows must not shrink before the list scrolls */
  display: flex;
  align-items: center;
  gap: var(--space-hair);
  min-width: 0;
}

/* Drag-to-reorder marks (4.5), the Sessions view's shapes on this anatomy. */
.tab-item-wrap.dragging { opacity: var(--opacity-drag); }
.tab-item-wrap.drop-before .tab-item {
  box-shadow: 0 calc(-1 * var(--stroke-2)) 0 0 var(--accent);
}
.tab-item-wrap.drop-after .tab-item {
  box-shadow: 0 var(--stroke-2) 0 0 var(--accent);
}
.tabs-list.drop-empty { outline: 1px dashed var(--accent); outline-offset: -3px; }

.tab-item {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  min-height: var(--control-h-md);
  padding: 3px 6px 3px 10px;
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
.side-panel-view[data-view="tabs"] .tab-item-wrap:hover .tab-item:not([aria-current="true"]) {
  background: var(--surface-raised);
}
.tab-item[aria-current="true"] { background: var(--accent-soft); }
.tab-item[aria-current="true"]::before {
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
.tab-item:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }

/* Reserved columns (4.1): an idle mark or state hides but keeps its box. */
.tab-item-mark {
  flex: 0 0 var(--icon-sm);
  display: grid;
  place-items: center;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--text-muted);
}
.tab-item-mark svg { display: block; width: var(--icon-sm); height: var(--icon-sm); }
.tab-item-mark.is-empty { visibility: hidden; }
/* A special tab registered with a text glyph rather than an nb-icon symbol. */
.tab-item-mark-text { font-size: var(--icon-sm); line-height: 1; }

/* State trails the label: one column for dirty and for conflict, because a
 * conflict only exists on an unsaved file. */
.tab-item-state {
  flex: 0 0 var(--icon-sm);
  display: grid;
  place-items: center;
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.tab-item-state.is-empty { visibility: hidden; }
.tab-item-dot {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-circle);
  background: var(--accent);
}
.tab-item-state svg {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--warn);
}

/* A pinned row's close column: the same 24 px box, no button, nothing announced. */
.tab-item-gap {
  flex: 0 0 var(--control-h-sm);
  width: var(--control-h-sm);
  height: var(--control-h-sm);
}
.tab-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tab-item-wrap.is-special .tab-item-name { color: var(--text-muted); font-style: italic; }
.tab-item-close {
  flex: 0 0 var(--control-h-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  padding: 0;
  background: none;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  cursor: pointer;
}
.side-panel-view[data-view="tabs"] .tab-item-wrap:hover .tab-item-close { color: var(--text-primary); }
.tab-item-close:hover { color: var(--danger); background: var(--accent-soft); }
.tab-item-close:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }

.tabs-empty {
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-style: italic;
}

/* The footer reuses .sessions-foot; .tabs-foot is a hook. The pin follows the
 * span's font size, so no literal is introduced. */
.tab-foot-pin svg { display: block; width: 1em; height: 1em; }

/* 140 px floor: the count leaves the line, stays in the tree (sessions.md §10.2). */
@container (max-width: 176px) {
  .side-panel-view[data-view="tabs"] > .panel-header { padding: 7px 8px; gap: 4px; }
  .side-panel-view[data-view="tabs"] .tabs-total {
    position: absolute;
    min-width: 0;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
}

/* phone: the drawer is the host; every target reaches the 44 px floor */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  .tab-item { min-height: var(--m-hit); padding: 0 var(--space-2) 0 var(--space-3); }
  .tab-item-close { flex: 0 0 var(--m-hit); width: var(--m-hit); height: var(--m-hit); border-radius: var(--radius-md); }
  /* The pinned row's gap takes the close button's box, or its label would
   * truncate 20 px earlier than an unpinned row's (4.1). */
  .tab-item-gap { flex: 0 0 var(--m-hit); width: var(--m-hit); height: var(--m-hit); }
  .tabs-list { padding: var(--space-2) var(--space-2) var(--space-3); margin-right: 0; }
  .tabs-empty { padding: 16px 12px; }
}
```

The header, count badge and footer are the shared `side-panel-views.md` §1.2 / `sessions.md` §10.2
rules; this view names its own class (`.tabs-total`, `.tabs-foot`) and adds no header geometry.

### 9.3 JS surface

| File | Change |
|---|---|
| `templates/index.html` | `#tabs-view` host after `#ai-view` (last view); `#nb-icon-tabs` symbol in the sprite; `hidden` on `#tab-bar` when the saved config hides it (§10) |
| `static/js/tabs-view.js` (new) | Header, list, rows, empty block, the three event subscriptions, menu anchor, focus restore, drag-to-reorder (§4.5), phone drawer close |
| `static/js/activity.js` | `register({ id: "tabs", icon: "nb-icon-tabs", label: "Tabs" })` as the last registration |
| `static/js/tabs.js` | Export `getSpecial(id)`, `isConflicted(path)`, `openTabMenu(path, { x, y, anchor, host })`, and `moveTab(path, targetPath, before)` (the strip's own `dropOnto`, aliased) |
| `static/js/mobile.js` | Nothing. `NB.mobile.closeDrawer()` is called from `tabs-view.js`, the `sessions.js:821` pattern |
| `static/css/style.css` | §9.2 |

`openTabMenu` is the existing `openMenu` (`tabs.js:1456`) with the menu's `scope` set to the invoking
host, so a second visible surface does not let one menu suppress the other's reopen
(`menu.js:184-186`).

---

## 10. Hiding the top strip

The strip may be hidden; that is the second reason this view exists.

| Part | Rule | Owner |
|---|---|---|
| Saved key | `hideTabBar`, boolean, default `false`, beside `hideTopbar` | [`shell-frame.md`](shell-frame.md) §1.3 |
| Paint | `hidden` on `#tab-bar` plus `.tab-bar[hidden] { display: none }`. The bar's height is measured by no script, so nothing else moves and the reader gains 34 px | [`tab-bar.md`](tab-bar.md) §8.1 |
| Boot | the server renders the attribute (`{% if boot.tabbar_hidden %} hidden{% endif %}`) from a new `boot_state()` key beside `topbar_hidden` (`app.py:1547`), so the first frame is correct without touching `<body>`. That keeps the shipped boot-template assertion at `tests/dom/test_dom.js:37550` green | [`shell-frame.md`](shell-frame.md) §1.3 |
| Toggle | `app.js` sets and removes the attribute and persists; `body:has(#tab-bar[hidden])` is the only selector that needs to know, and `:has()` is already shipped (`style.css:424`) | `app.js` |
| Settings | Appearance row `Hide tab bar`, under `Hide top bar` (`settings-modal.md` §4.3) | settings-modal |
| Shortcut | `Mod+Shift+B`, action `toggleTabbar`; `Mod+B` is bold in hybrid mode | `shortcuts.js:49-63` |
| Outline | not a strip control any more: the outline is a side-panel view in the right panel and its rail icon is its only toggle ([`secondary-sidebar.md`](secondary-sidebar.md) §5) | [`shell-frame.md`](shell-frame.md) §5 |

**The cost, recorded.** With the strip hidden and the Tabs view not showing, the desktop shell has
no chrome-level name for the open file: the reader renders the note's own title, `#viewer`'s name is
its `aria-label` only (`tab-bar.md` §7.1), and `document.title` is the site title. The phone solved
this with `#mobile-title` (`mobile-shell.md` §2); desktop has no equivalent, and this document does
not add one. Hiding the strip is therefore a trade the user makes knowingly, and the Tabs view is the
recommended companion state.

With both bars hidden the rail keeps every door: views, Settings, and the outline twin.

---

## 11. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | The view registers last and its rail icon appears in the saved order on both shells | `activity.js`, `settings.js` | Eight views on a fresh config, Tabs eighth; promoting it in Settings moves the icon on both shells |
| **AC2** | Header: title, count, collapse; footer and empty block are siblings of the list | `tabs-view.js` | `Tabs`, a chip equal to the row count, the chevron; footer always; `.tabs-empty` outside the scroller |
| **AC3** | Every open file of the active session is one row, pinned first | `tabs-view.js`, `tabs.js` | Row count equals `getOpen().length`; the pinned prefix matches `isPinned()` |
| **AC4** | Row slots and states match §4 | `tabs-view.js`, `style.css` | Mark, dot, label, conflict, close in that order; `aria-current="true"`; dirty keeps weight 400; a special row is italic muted with its sprite |
| **AC4a** | Every label starts on one edge and every trailing box ends on one | `tabs-view.js`, `style.css` | Measured across a pinned, a dirty, a conflicted, an idle, a special and an unpinned row: `.tab-item-name` left edges differ by 0 px and its truncation point is the same; the state and close/gap boxes share one width and one right edge; a hidden mark or state still occupies its box |
| **AC5** | A pinned row has no close button and advertises the menu | `tabs-view.js` | No `.tab-item-close`; name ends in `, pinned`; `aria-haspopup="menu"`; the three bulk items are disabled with their title |
| **AC6** | Activate, close, middle-click and the menu work from a row | `tabs-view.js` | Click activates; `×` closes without activating; middle-click closes an unpinned row; `Shift+F10` opens `#nb-menu` anchored at the row; `Esc` returns focus to it |
| **AC7** | Every state is in the accessible name, and a special tab is named by its label | `tabs-view.js` | `note.md, pinned, unsaved changes, changed on disk`; `Graph`, never `§graph`; the close is `Close Graph`, without phrases; every glyph `aria-hidden="true"` |
| **AC8** | A re-render never steals focus and restores the same control | `tabs-view.js` | Remote `tabs:changed` while focus is in the reader leaves focus there; with focus on a close button, focus returns to that close button |
| **AC9** | Empty state is one line outside the scroller | `tabs-view.js`, `style.css` | `No files are open. Open one in Explorer.`; the list is empty; the footer stays |
| **AC10** | 140 px keeps the name and the close | `style.css` | Name ellipsizes; pin, dot and close keep their boxes; the count is visually hidden and still announced |
| **AC11** | On a phone the view opens in the drawer and a tap opens the note and closes the drawer | `mobile.js`, `tabs-view.js` | From More or a promoted rail slot; the file shows behind the drawer, drawer closed |
| **AC12** | On a phone every control reaches 44 px | `style.css` | Row ≥44, close 44 × 44, drawer close 44 × 44 |
| **AC13** | Hiding the strip leaves every door reachable and paints on the first frame | `app.py`, `index.html`, `app.js`, `style.css` | The attribute is server-rendered; `#tab-bar` is not displayed; the rail's outline twin appears and toggles the pane; `Mod+Shift+B` and the Settings row toggle it and persist |
| **AC14** | The mockup is self-contained | `tabs-view-mockup.html` | Opens offline, dark and light, zero network requests |
| **AC15** | An admin can drag a row before or after another, or to the end, and the order persists | `tabs-view.js`, `tabs.js` | A drop before/after another row reorders the model and the DOM; an empty-area drop appends; the order reaches the next state write; the active file is unchanged |
| **AC16** | A drag never crosses the pinned boundary | `tabs-view.js`, `tabs.js` | An unpinned row dropped on a pinned row lands at index 1; a pinned row dropped past the block stays inside it |
| **AC17** | A viewer cannot drag | `tabs-view.js` | Every `.tab-item-wrap` has `draggable === false`; a `dragstart` leaves the order and the marks untouched |
| **AC18** | A re-render abandons a drag | `tabs-view.js` | `tabs:changed` mid-drag clears `.dragging`, `.drop-before`, `.drop-after`, `.drop-empty`; a following `drop` is a no-op |

### 11.1 Shipped tests this change must update

The view is a new registration and a new host, so these assertions change; they are listed rather
than claimed green:

| Test | Asserts | Change |
|---|---|---|
| `tests/dom/test_dom.js:37663` | `views()` is exactly the seven ids | `tabs` appended; the template `data-view` list matches |
| `tests/dom/test_dom.js:28396`, `:28428` | bar order string, and `Unhide` restoring it | `tabs` appended |
| `tests/browser/test_mobile_browser.js:228-232` | desktop rail carries every view; `railViews() === 7` | eight views, `railViews() === 8` |
| `tests/browser/test_mobile_browser.js:371-377` | phone rail is six views + More | unchanged slots; Tabs must now be the More sheet's Views row |
| `tests/browser/test_mobile_browser.js:678-682` | More sheet rows `Demo\|Settings` | `Tabs` joins the Views group |
| `tests/dom/test_dom.js:27771` | 9 shortcut rows | 10, plus the labels list at `:27757` |

Everything else stays green by construction: `#tab-bar` keeps three children, its geometry and its
animations (no `display` change while `hideTabBar` is off); `#layout` keeps four columns, so
`test_mobile_browser.js:180-215` is untouched; and the boot template is unchanged because §10 uses an
attribute on `#tab-bar`, not a `<body>` class.

---

## 12. Exceptions

| # | Change | Why | Delta |
|---|---|---|---|
| E1 | New view: `#tabs-view`, rail icon, one sprite symbol | The open set has no all-files surface, and the phone has none at all | +1 view host, +1 rail icon, +1 sprite |
| E2 | Row height 30 via `--control-h-md`, not the 27 of `guidelines.md` §2.1 | It sits beside the Sessions list, which ships 30 (`sessions.md` §10.2); the two must not drift. The row contract's 27 is a global question, not this view's | +3 px per row |
| E3 | The strip can be hidden, with a rail twin for the outline toggle | The 34 px row is the space the view frees | −34 px of editor height; +1 rail button while hidden |
| E4 | Row `aria-current`, native buttons, no roving tabindex | The panel is a list, not a tab widget; it matches Sessions and avoids a second selection model | none |
| E5 | Bulk-close items disabled on a pinned row | The strip's bulk closes are region-scoped; the merged list has no region boundary to draw | none |
| E6 | Phone rows → 44, close → 44 | Coarse-pointer floor (`foundations.md` §10.4) | row +14, close +20 |

---

## 13. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | ~~Drag reorder in the list~~ — **applied** as §4.5 | Order was editable only in the strip, so hiding the strip removed reordering | shipped: `NB.tabs.moveTab`, the segment clamp, the re-render abort, the close-button refusal |
| P2 | `Move up` / `Move down` in the row menu | The keyboard and phone path for P1 | Two menu items the strip does not have |
| P3 | The active file's name in the topbar when the strip is hidden | §10's recorded cost | A new topbar mount |
| P4 | A per-row second line with the folder | Two open `index.md` files are indistinguishable by base name | Row height, and `guidelines.md` §2.1 forbids a second line |
| P5 | `Ctrl+W`-style close on the focused row | Faster than Tab to the close | The browser owns `Ctrl+W`; a custom chord would be a second keyboard model |

---

## 14. What not to build

- A second tab list. The phone hosts this view in the drawer; there is no tabs sheet, no swipe
  gesture, and no chip row.
- `role="tablist"`/`role="tab"` in the panel. The strip is the tab widget; the panel is a list.
- A hover-only close button, or a close button that is skipped by the keyboard.
- **Close all**, or any bulk close the strip's menu does not already offer.
- A per-row "Move to session". That is the tab menu's job (`sessions.md` §4).
- A second empty-state design, a second row height, or a new colour for a state that already has one.
- A `Delete` key binding. The close button is the keyboard path.
- A "recently closed" section. The Recent view answers "what did I touch last".
- A migration that writes `tabs` into every saved bar order. Placement is the user's setting.
