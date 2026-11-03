# Sessions — design handoff

Status: implemented. The design shipped in `static/js/tabs.js`,
`static/js/sessions.js`, `static/js/viewer.js`, `static/js/app.js`,
`static/js/activity.js`, `static/js/menu.js`, `templates/index.html`,
`static/css/style.css`, and the workspace-state changes in `app.py`.
Appendix A is the CSS as shipped.

**Revision 2.** The tab-bar chip and its popover were rejected. Sessions are now
a side-panel view beside Explorer, Pinned, Bookmarks, Recent, Search and AI —
the app's established pattern. The tab bar returns to exactly its shipped three
children (`#tab-pinned`, `#tab-list`, `#outline-toggle`) and gains nothing. The
`Move to session` tab-menu item, the New / Rename dialog, the delete confirm,
the session model, its limits and its migration are unchanged.

Reference mockup: [`sessions-mockup.html`](sessions-mockup.html) — the whole
shell with the Sessions view open, the row menu, the ⋯ at rest, the tab menu
with `Move to session ▸` open, both dialogs, 240 / 360 px panels, a long name,
the only-session state with Delete disabled, the 20-session state with the
header `+` disabled, the rail close-up, and the phone note. Theme toggle in the
page header, plus a light-theme board.

**Normative source.** §3 (tokens), §4 (components), §5 (copy), §7 (keyboard) and
Appendix A (CSS) are the single source of truth. The mockup illustrates them;
where the two differ, this document wins, and where this document differs from
`static/css/style.css`, the stylesheet wins for anything already shipped.

Read [`workspaces.md`](workspaces.md) §4.3 first: the dialog shell and its
validation are the workspace name dialog's, unchanged.

---

## 1. What ships

One feature, five surfaces, no other UI touched:

| # | Surface | Lives in | Built with |
|---|---|---|---|
| 1 | Sessions view | `#sessions-view.side-panel-view[data-view="sessions"]` in `#side-panel` | static host, populated by `sessions.js` at load (the `bookmarks.js` pattern) |
| 2 | Rail icon | `activity.js` registration, after Explorer | the shipped `register()` block; **no mount function** |
| 3 | `Move to session` item + submenu | `tabs.js` `tabMenuItems()` | `NB.menu` submenu |
| 4 | New / Rename dialog | body-level overlay | `NB.dialog`, `.settings-modal.auth-modal` |
| 5 | Delete confirm | `sessions.js` | `window.confirm`, the app's native dialog |

The tab strip, the pinned region, the outline toggle, the tab menu's other
items, the six existing views and the phone drawer are **not** redesigned. The
strip's children are exactly the three it ships with today.

### 1.1 Decisions a reviewer should sanity-check

**D1 — The session control is a view, not strip chrome.** The chip and its
popover are deleted, not hidden. A view is the pattern the app already repeats
seven times: a static host, a `.panel-header`, a scrolling list, a row context
menu. It has room at 240 px for the name, the count, the dot and a per-row
action; the 34 px strip has room for none of them without becoming a second
toolbar. Switching is one rail click away, and the view's state survives every
switch because the host stays in the DOM.

**D2 — Built at load, never lazily.** `sessions.js` builds the header and the
list once at module load, exactly as `bookmarks.js` does (`buildView()` then
`renderAll()`). The host ships empty in `index.html`; `activity.js` only toggles
`[hidden]`; the registration has no `mount`. Consequences, all intended:

- a boot into `activeView: "sessions"` paints a populated view on the first
  frame, with no mount and no flash of empty panel;
- the list state (scroll position) survives every view switch;
- there is one render path, not a "mounted" path and a "rebuilt" path;
- the rows are re-rendered on `tabs:changed` and on `viewer:dirty-changed`
  whether or not the view is visible. At most 20 rows, so the cost is a few
  hundred nodes and no measurement.

**D3 — Rail order and icon.** The view icons read, top to bottom: Explorer,
**Sessions**, Pinned folders, Bookmarks, Recent files, Search, AI Assistant —
the registration order, which is the render order. The icon is `🗂`
(U+1F5C2, card index dividers) in the same 36 px `.activity-btn` /
`.activity-icon` box as the rest.

Why `🗂`: dividers are *several labelled sets*, which is the model; it is
distinct at 1.15rem from Explorer's single folder `📁`, Pinned's `📌` and
Bookmarks' `🔖`; it keeps the folder-family metaphor the rejected chip used
without reusing an existing rail glyph; and it is a text glyph, so this feature
adds no sprite or SVG asset. It is not `📑` (a tabbed page), which reads as one
tab strip rather than a set of them, and sits too close to `🔖` in the same
corner of the emoji font.

**D4 — A row is two buttons, not one.** A `<button>` cannot contain the `⋯`
button. The row is therefore a wrapper containing the session button and the
actions button, in that DOM order:

```html
<div class="session-row-wrap">
  <button class="bookmark-row session-row" aria-current="true" title="{name}">
    <span class="session-name">{name}</span>
    <span class="session-dot" aria-hidden="true"></span>
    <span class="sr-only">, unsaved changes</span>
    <span class="session-count">{n}<span class="sr-only"> tabs</span></span>
  </button>
  <button class="session-more" aria-label="{name} actions"
          title="{name} actions" aria-haspopup="menu" aria-expanded="false">⋯</button>
</div>
```

The alternative — one button with a nested non-button span carrying
`role="button"` — would need Enter/Space handling, a second focus ring and a
second tab stop anyway, while losing native button semantics. The cost of the
chosen shape is two tab stops per row, which D13 accepts.

**D5 — The active row reads selected, but not by colour alone.** `aria-current`
is `"true"` on the session button (a row in a list, not a page and not a radio).
The look reuses the bookmarks selected treatment's **fill** (`--accent-soft`)
and adds the tree's 2 px inset accent edge plus 600 weight.

The name stays `--fg`. `.bookmark-row.selected` colours the name `--accent`,
which is 4.39:1 on `--accent-soft` in the dark theme — under 4.5:1 for 14 px
text. The shipped bookmark rows inherit that pair; this feature does not copy
it, and does not change the bookmark rule. Fill + edge + weight is three cues
and none of them is hue alone.

**D6 — The count is always present, including `0`.** The count is the number of
**unpinned** tabs in that session; the shared pinned region is never counted.
Zero is a valid session and is drawn as `0`, never hidden and never styled as
an error. The dot sits **before** the count so a dirty row's digits stay in the
same column as a clean row's, and the count is tabular with a 2ch floor.

**D7 — The `⋯` is visible at rest.** A hover-only control cannot be reached by
the keyboard (it would have to appear on focus, which is possible but makes the
row's second tab stop invisible until it is found), and a 240 px row has no room
for a hidden affordance the user must discover. It is muted at rest, takes
`--fg` plus the accent-soft fill on hover, and has an inset focus ring.

**D8 — The row menu holds Rename and Delete only.** `New session…` does **not**
belong in a row's menu: the header `+` is the single, always-visible create
action, and a row menu acts on its row. There is no `Switch` item either — the
row button is the switch. The menu is `NB.menu`'s shipped 170 px box.

**D9 — Delete works on every row, active or not.** The view lists every
session, so restricting Delete to the active one made cleaning up a stale set a
two-step "switch to it, then delete it" — the first step changes what the
editor shows for no reason. The confirm names the session, says its tabs close,
and adds the unsaved-edits sentence only when that session has a dirty file.

This matches `docs/requirements/features/sessions.md` AC18 and AC21 as revised
for the side-panel view: every row carries the menu, and deleting the active
session lands on the previous session, else the next. The model, the limit and
the pinned-set rule are unchanged. The native confirm is unchanged.

**D10 — No drag-reorder in v1.** Sessions are listed in creation order and that
order is the session order; the row is not `draggable`, there are no drop marks
and no handle. Bookmarks offer drag because their list has no other action; here
the row is a switch button with a second button on it, and reordering sessions is
not a stated goal (`requirements` §4.2(8) makes order stable). Adding it means
solving drag on a row that is also a control, which is a feature of its own.

**D11 — The footnote is pinned to the bottom of the view.** "Pinned tabs are
shared by every session." explains a property of the model, not of a scroll
position, and at 20 sessions it must not scroll out of sight. It sits below the
scrolling list as a `flex: 0 0 auto` band with a top border.

**D12 — The phone hides the rail icon and the view; the boot fallback is
Explorer.** The view is desktop-only: the phone has one reader, no tab bar and
never reads or writes desktop sessions. The icon and host are hidden by the same
phone rule that already hides AI's (`style.css:7220-7221`), and `app.js` forces
a saved `activeView` of `"sessions"` to `"explorer"` beside its existing
`"ai" → "explorer"` guard. Naming the fallback: **Explorer**. The view is still
built at load on a phone — it is a hidden DOM subtree and keeps `sessions.js`
free of a mode branch.

**D13 — Native buttons, no roving tabindex.** The list is a set of independent
commands, not a single-select listbox or a tree: each row switches, and each
row's `⋯` opens a menu for that row. Tab therefore walks `row → ⋯ → row → ⋯`.
A roving-tabindex listbox would suppress the native buttons and would have to
re-invent Enter/Space, the focus ring and the two controls per row. Twenty rows
is 40 stops, which is the accepted cost; sessions are usually a handful.

**D14 — The active session is visible only while this view is open.** Accepted.
The strip already shows that session's tabs, and no strip-level command acts on
"the current session" except `Move to session`, which names its *target*. A
second indicator on the rail, the strip or the topbar would duplicate a fact the
view states and add chrome to a bar that was just cleared of it.

**D15 — The header `+` uses `aria-disabled`, not native `disabled`.** At the
20-session cap and for a viewer the action is unavailable, but the reason must
remain reachable: an `aria-disabled` button keeps its tab stop, its `title` and
its `aria-describedby` note, and the click is a no-op in `sessions.js`. A native
`disabled` button is skipped by Tab, so a keyboard user would find a greyed `+`
with no way to ask why. The row menu's Delete keeps `NB.menu`'s native
`disabled`, because the menu already skips disabled items.

---

## 2. Placement

### 2.1 Markup — `templates/index.html`

One host, inserted after `#sidebar` and before `#pinned-view` (the rail order
puts Sessions second):

```html
<!-- Sessions view: one row per session. sessions.js builds the header + list
     at load (the bookmarks.js pattern); the host stays in the DOM so scroll and
     row state survive view switches. Desktop-only: the phone query hides this
     host and its rail icon. -->
<div id="sessions-view" class="side-panel-view" data-view="sessions"
     {% if boot.active_view != 'sessions' %}hidden{% endif %}></div>
```

The tab bar is **not** edited. Its children remain:

```html
<div id="tab-bar" class="tab-bar">
  <div id="tab-pinned" class="tab-pinned" hidden></div>
  <div id="tab-list" class="tab-list"></div>
  <button id="outline-toggle" class="icon-btn outline-toggle" …>≣</button>
</div>
```

No chip, no popover placeholder, no extra wrapper. `tabs.js`'s `.tab` queries
and drag code see exactly what they saw before.

The script tag sits beside `bookmarks.js` (after `activity.js`, so
`NB.activity.makeCollapseBtn` exists when the view is built):

```html
<script src="/static/js/sessions.js" defer></script>
```

### 2.2 Activity registration — `static/js/activity.js`

Inside the existing `register()` block, after Explorer and before Pinned, with
no mount function:

```js
// Sessions: the host (#sessions-view) ships empty; sessions.js populates its
// header + list at load, so mount is not needed. Only [hidden] toggles here.
register({
  id: "sessions",
  icon: "🗂",
  label: "Sessions",
});
```

`register()` de-dupes by id and `renderBar()` draws the icons in registration
order, so this one call fixes both the rail position and the label. The button
gets `data-view="sessions"` from `renderBar()`, which is what the phone rule
matches.

### 2.3 Boot allowlist — `app.py`

`_ACTIVE_VIEWS` gains `"sessions"`:

```python
_ACTIVE_VIEWS = ("explorer", "sessions", "pinned", "bookmarks", "recent",
                 "search", "ai")
```

`tests/test_app.py::test_active_view_allowlist_matches_registry_and_dom` compares
this tuple against the `register({ id: … })` ids in `activity.js` **and** the
`data-view` hosts in `index.html`. All three must change together, or the test
fails. This is the cross-file guard working as designed, not an obstacle.

### 2.4 What the view is not allowed to do

- It is not a second tab strip. It never renders another session's tab labels,
  only a count and a dot.
- It does not own switching through a roving keymap. The rows are buttons.
- It does not write the workspace state itself; it calls the same persistence
  path `tabs.js` uses, and a viewer's actions never call it.
- It does not open a second instance. There is one `#sessions-view`; the phone
  hides it, the desktop shows it, and nothing is remounted.

---

## 3. Tokens

### 3.1 Reused, no change

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-panel` | `#22232a` | `#f6f7f9` | the panel, the header, the footnote band |
| `--bg-elev` | `#2a2b34` | `#eceef2` | the row menu |
| `--fg` | `#e6e6ea` | `#1f2330` | session names, the active row's count, menu labels |
| `--fg-muted` | `#8b8d98` | `#5d6470` | the header `+`, the `⋯` at rest, the panel title |
| `--accent` | `#7c9cff` | `#2f5fd0` | active edge, dirty dot, focus rings |
| `--accent-soft` | 18 % | 12 % | row hover, the active row's fill, menu hover |
| `--border` | `#383a45` | `#d8dde4` | the footnote rule, the row menu edge |
| `--danger` | `#ff6b6b` | `#c0392b` | the Delete label, its ring |
| `--ws-fg-muted` | `#9799a4` | `#5d6470` | counts, footnote, disabled labels |
| `--code-bg` | `#14151a` | `#f0f2f5` | the dialog's input |
| `--accent-fg` | `#14151a` | `#ffffff` | the dialog's primary label |

### 3.2 New, scoped

```css
/* none */
```

No session-specific token is introduced. The view is `.panel-header` plus
`.bookmarks-list` plus `.bookmark-row`; the new pieces (`.session-add`,
`.session-more`, `.session-dot`, `.session-count`, `.session-foot`) are
declarations on shipped tokens. A new colour would need two theme values with
no failing pair to justify it.

### 3.3 Contrast

Measured on the pairs the view actually paints. Text is 4.5:1; the dot and
rings are 3:1.

| Pair | Ratio | Verdict |
|---|---|---|
| `--fg` on `--bg-panel` (dark / light) | 12.6 / 14.6 | passes |
| `--fg-muted` on `--bg-panel` (dark / light) — `+`, `⋯`, title | 4.74 / 5.56 | passes |
| `--fg-muted` on `--accent-soft` over the panel (dark) — `⋯` hover | 3.46 | **fails — the hover flips the glyph to `--fg` (9.19)** |
| `--ws-fg-muted` on `--bg-panel` (dark / light) — count, footnote | 5.52 / 5.56 | passes |
| `--fg` on `--accent-soft` over the panel (dark / light) — active name | 9.19 / 12.39 | passes |
| `--accent` on `--bg-panel` (dark / light) — edge, ring | 6.00 / 5.34 | passes (non-text) |
| `--accent` on the active fill (dark / light) — dirty dot | 4.39 / 4.53 | passes 3:1 (non-text) |
| `--ws-fg-muted` on the active fill (dark) — count | 4.03 | **fails — the active row's count uses `--fg`** |
| `--danger` on `--bg-elev` (dark / light) — Delete at rest | 5.07 / 4.68 | passes |
| `--danger` on the menu hover fill (dark / light) | 3.73 / 3.99 | **fails — Appendix A replaces the fill with a ring** |
| `--ws-fg-muted` on `--bg-elev` (dark / light) — disabled label | 4.96 / 5.13 | passes |
| `--fg` on `--accent-soft` over the panel (light/dark) — menu hover label | 11.49 / 8.31 | passes |

Two shipped defects are exposed by this view and fixed additively in Appendix A:

- **Disabled menu items** use `--fg-muted` on `--bg-elev` (4.26:1 in light). The
  only-session Delete is disabled, so it takes `--ws-fg-muted` instead.
- **Danger menu items** fill with `--accent-soft` on hover, putting `--danger`
  at 3.99 / 3.73. The hover becomes a 1 px `--danger` ring on the row's face,
  the same treatment revision 1 gave the popover's danger row. This is the one
  rule that changes how already-shipped menus look, and it changes a failing
  state in every danger item, not just this one.

---

## 4. Components

### 4.1 View header

The shipped `.panel-header`: 8 px 12 px padding, 1 px bottom border,
`.79rem` uppercase title, right-aligned `.panel-header-actions` with a 2 px gap.

```html
<div class="panel-header">
  <span class="panel-title">Sessions</span>
  <div class="panel-header-actions">
    <button type="button" class="session-add" title="New session"
            aria-label="New session">+</button>
    <!-- NB.activity.makeCollapseBtn() appended here, as bookmarks.js does -->
  </div>
</div>
```

| Control | Spec |
|---|---|
| `+` | 18 × 18 px, `padding:0 3px`, 4 px radius, `--fg-muted`, `1.07rem`/1. Hover: `--fg` on `--accent-soft`. Focus: 2 px `--accent`, offset 1 px |
| `+` at 20 sessions | `aria-disabled="true"`, `title="20 sessions is the limit. Delete one first."`, `aria-describedby="sessions-cap-note"`; no dialog opens; `opacity:.72`; still focusable (D15) |
| `+` as a viewer | `aria-disabled="true"`, `title="Read-only: sessions can’t be changed."`; same look |
| collapse `‹` | `NB.activity.makeCollapseBtn()`, unchanged. It is the second action, after the `+`, exactly as Bookmarks orders its `★` then `‹` |

The `.sr-only` note:

```html
<span id="sessions-cap-note" class="sr-only">20 sessions is the limit. Delete one first.</span>
```

The header title is the only "you are here" for the view; the rail button's
`aria-pressed` is the other, and both are shipped behaviour.

### 4.2 Row

```
224 px  ┌──────────────────────────────────────┐
        │ ▏ Deep work                      3  ⋯ │   ← 27 px tall
        └──────────────────────────────────────┘
          └────── .session-row (202) ──────┘  └20┘
```

Markup is D4's. One wrapper per session, in session order. The wrapper is a
plain block in `.bookmarks-list`; it is not a control and carries no role.

| Space | 240 px panel (default) | 360 px panel | 140 px panel (resize floor) |
|---|---|---|---|
| list content (240 − 8 margin − 8 padding) | 224 | 344 | 124 |
| `⋯` + 2 px gap | 22 | 22 | 22 |
| row outer | 202 | 322 | 102 |
| row inner (minus 6 px + 6 px padding) | 190 | 310 | 90 |
| name, clean (minus 12 px count, 4 px gap) | 174 | 294 | 74 |
| name, dirty (minus the 8 px dot and its 4 px gap) | 162 | 282 | 62 |

The name is the only flexible child. `min-width:0` plus
`overflow:hidden; text-overflow:ellipsis; white-space:nowrap` makes it yield
first; the count, dot and `⋯` never shrink. Nothing wraps at any width.

Row height is 27 px: `.bookmark-row`'s 3 px top/bottom padding plus a 21 px line
box. The `⋯` is 20 × 20 and centred, so it does not set the height.

### 4.3 Row states

| State | Treatment |
|---|---|
| default | face transparent, name `--fg`, count `--ws-fg-muted`, `⋯` `--fg-muted` |
| hover (row) | `--accent-soft` face, name unchanged |
| hover (`⋯`) | accent-soft face, glyph `--fg` |
| active (`aria-current="true"`) | `--accent-soft` face, 2 px inset `--accent` edge, name `--fg` 600, count `--fg` 400 |
| active + dirty | the same face; the 8 px dot is `--accent` (4.39:1 on the fill, above the 3:1 non-text floor) |
| focus-visible (row or `⋯`) | 2 px `--accent`, `outline-offset:-2px`, so it cannot spill past the 4 px list padding |
| long name | ellipsised; `title` on the session button carries the full name |
| 0 tabs | count `0`; everything else identical. No empty row, no dimming |
| only session | identical; the row's Delete item is the only thing that changes |
| viewer | identical. Switching writes nothing and is allowed |
| dirty | 8 px `--accent` dot before the count, plus `, unsaved changes` in the accessible name |
| busy | none. Switching is instant and local |

### 4.4 Count and dot

- `.session-count`: `.76rem`, `font-variant-numeric: tabular-nums`,
  `min-width:2ch`, right-aligned, `--ws-fg-muted`; `--fg` on the active row.
  Always rendered, including `0`.
- `.session-dot`: 8 × 8 px, 50 % radius, `--accent`, `aria-hidden="true"`.
  Its meaning is the adjacent `.sr-only` text inside the session button, not
  the dot itself.
- The count is the session's unpinned tabs. Pinned tabs are shared and are not
  in any count. A session's dot is on when any file in that session has unsaved
  changes, computed by the same predicate `tabs.js` uses (`NB.viewer.isDirty`
  plus the hybrid editor's dirty flag). The dot and the visible `.tab.dirty`
  therefore cannot disagree.

### 4.5 `⋯` actions button

- 20 × 20 px, 4 px radius, `⋯` (U+22EF), `--fg-muted` at rest.
- `aria-label="{name} actions"`, `title="{name} actions"`,
  `aria-haspopup="menu"`, `aria-expanded` toggled by the menu's open/close.
- It is a sibling of the row button, not a child (D4).
- Click opens the row menu at `rect.left`, `rect.bottom + 2`; right-click
  anywhere on the wrapper opens it at the pointer.
- It is in the tab order after its row.

### 4.6 Row context menu

`NB.menu.open({ owner: "sessions", x, y, scope: wrapper, items, focusFirst: true })`.

| Item | Behaviour |
|---|---|
| `Rename…` | opens the dialog in rename mode for that row; `focusFirst` lands here |
| `Delete…` (`danger: true`) | native confirm; see §9.4 |
| Delete, one session | `disabled: true`, `title: "The only session can’t be deleted."` — native `disabled`, skipped by `NB.menu`'s arrow walk |
| viewer (both items) | `disabled: true`, `title: "Read-only: sessions can’t be changed."` |

No separator: two items do not need one. `scope` is the row wrapper, so a
right-click on the row it belongs to does not close and reopen the menu.

`NB.menu` positions and clamps the 170 px box; in a 240 px panel it necessarily
overhangs into the editor. That is the shipped context-menu behaviour and is
accepted.

**One addition to `menu.js`:** `open()` gains an optional `onClose(reason)`,
called by the single close dispatcher with `"esc"`, `"outside"` or `"pick"`.
`sessions.js` uses it for two things: clear `aria-expanded` on the `⋯` (all
reasons) and return focus to that `⋯` when the reason is `"esc"`. Without it,
Escape hides the focused menu item and focus falls to `<body>` — the shipped
context-menu gap. The other two reasons move no focus, so no menu steals it.

### 4.7 Footnote

```html
<p class="sessions-foot">Pinned tabs are shared by every session.</p>
```

`flex: 0 0 auto`, `padding: 8px 12px`, 1 px top `--border`, `.76rem`/1.35,
`--ws-fg-muted` on `--bg-panel` (5.52 / 5.56). It is outside the scrolling list,
below it in the view's column (D11). It is visible text, not a tooltip.

### 4.8 Tab menu — `Move to session`

Unchanged from revision 1. `tabs.js` `tabMenuItems()` gains one entry in the
Organize group, directly after Pin/Unpin:

```js
{ label: "Move to session", submenu: [
  ...otherSessions.map(s => ({ label: s.name, handler: () => sessions.moveTo(path, s.id) })),
  { separator: true },
  { label: "New session…", handler: () => sessions.newFromTab(path) },
] }
```

| Rule | Reason |
|---|---|
| the submenu lists every session **except the active one** | the tab is already there; a no-op row is a lie |
| `New session…` is always last, after the separator | the submenu is never empty, so the parent is never disabled for want of children |
| the parent is not `danger` | it is a move, not a destruction |
| a pinned tab gets **no item at all** | a pinned tab is already in every session; the row is not built |
| the parent **is** disabled for a viewer | a viewer may switch, not move. `buildSubmenu()` must honour `item.disabled` and `item.title`; it currently ignores both |
| no session names are truncated in JS | the flyout sizes to its longest name and clips at 260 px |

### 4.9 New / Rename dialog

Unchanged from revision 1 except the trigger description.

**Shell:** `#session-dialog`, `.settings-overlay` with the standard
`rgba(0,0,0,.5)` scrim, `.settings-modal.auth-modal` at 420 px, the same shell
as Add/Rename workspace.

**Triggers:** New opens from the header `+`, and from the tab menu's
`New session…`. Rename opens from a row's `⋯` menu. There is no other path.

**One field:**

| Field | Notes |
|---|---|
| Name | `<input type="text" maxlength="40" autocomplete="off" spellcheck="false">`. New: empty, placeholder `Deep work`. Rename: prefilled with the current name and pre-selected. |
| Help | New: “A session is a named set of open tabs. Pinned tabs stay in every session.” Rename: “Rename only changes the label. Its tabs stay open.” |
| Error | `.auth-error` (`role="alert"`, `--danger`, `.89rem`, 18 px reserved height so the buttons do not jump) |

**States:** initial (new / rename), invalid, submitting (`aria-busy`, disabled
submit, `Creating…` / `Saving…`), write failure (the server sentence in the same
line; the dialog stays open). The geometry is the shipped `.auth-modal`; the
label column is narrowed from 130 px to 92 px, scoped to `#session-dialog`,
because this dialog has one short label and a 40-character value.

`fallbackFocus` is the opener: the header `+`, or the row's `⋯`. Both persist
while the dialog is open, so `dialog.js`'s `usable()` check finds them.

### 4.10 The three limit states

| State | What changes |
|---|---|
| one session | Delete is disabled in that row's menu with its `title`. Everything else is normal: the session switches, renames, and counts |
| 20 sessions | the header `+` is `aria-disabled`, titled and described; no row changes. The list scrolls |
| viewer | `+` and both row-menu items are disabled with the read-only reason; rows still switch |

There is **no empty state**: a workspace always has at least one session
(requirements §4.2(1)), and a session with zero tabs is a normal row.

---

## 5. Copy

| Slot | String |
|---|---|
| header `+`, accessible name | `New session` |
| header `+`, title | `New session` |
| header `+`, at 20 | `title="20 sessions is the limit. Delete one first."`; described by `20 sessions is the limit. Delete one first.` |
| header `+`, viewer | `title="Read-only: sessions can’t be changed."` |
| row, title | `{name}` (the full name, for an ellipsised label) |
| row, screen readers | `{name}`, `{n} tabs` (`1 tab` when n = 1), `, unsaved changes` |
| row `⋯` | `{name} actions` |
| row menu | `Rename…` · `Delete…` |
| Delete, only session | `title="The only session can’t be deleted."` |
| footnote | `Pinned tabs are shared by every session.` |
| tab menu item | `Move to session` |
| tab menu, last child | `New session…` |
| dialog title | `New session` / `Rename session` |
| dialog help | `A session is a named set of open tabs. Pinned tabs stay in every session.` / `Rename only changes the label. Its tabs stay open.` |
| dialog label, placeholder | `Name`, `Deep work` |
| dialog buttons | `Cancel`, `Create session` (busy `Creating…`), `Save` (busy `Saving…`) |
| dialog error, empty | `Give the session a name.` |
| dialog error, duplicate | `A session called “{name}” already exists.` |
| dialog error, too long | `Session names are limited to 40 characters.` |

### 5.1 Delete confirm

`window.confirm`, one `\n` per line, curly quotes. Four variants:

| Case | Copy |
|---|---|
| active, n ≥ 2, clean | `Delete “{name}”?\nIts {n} open tabs will close. You’ll switch to “{next}”.` |
| active, n = 1, clean | `Delete “{name}”?\nIts open tab will close. You’ll switch to “{next}”.` |
| active, n = 0 | `Delete “{name}”?\nIt has no open tabs. You’ll switch to “{next}”.` |
| inactive, n ≥ 2, clean | `Delete “{name}”?\nIts {n} open tabs will close.` |
| inactive, n = 1, clean | `Delete “{name}”?\nIts open tab will close.` |
| inactive, n = 0 | `Delete “{name}”?\nIt has no open tabs.` |

Any of the above appends one more line **only when that session is dirty**:

```
\nUnsaved edits in its files will be lost.
```

`{next}` is the session the app will switch to after deleting the active one:
the previous session in the list, else the following one (requirements AC21).
An inactive delete does not switch, so it carries no switch sentence. The
confirm's OK / Cancel labels are the browser's.

The ellipsis is U+2026, not three periods. The apostrophe in `You’ll` and the
quotes around names are curly, as in the workspace copy.

---

## 6. Validation and messages

Sessions are client state, but the list is per workspace, so a duplicate can
arrive from a second tab. The dialog maps exactly three conditions, all on the
Name field:

| Condition | Message | Field state |
|---|---|---|
| empty or whitespace-only (`trim()`) | `Give the session a name.` | `aria-invalid`, danger border |
| duplicate, compared case-insensitively after `trim()` | `A session called “{name}” already exists.` | `aria-invalid`, danger border |
| over 40 characters | `Session names are limited to 40 characters.` | `aria-invalid`, danger border |

The 40-character cap is enforced twice: `maxlength="40"` and a paste longer than
40 truncated before validation. The first two are the only errors a user can
reach by typing. A failed submit keeps the dialog open and puts focus back in
the field. Clear the message and `aria-invalid` as soon as the field is edited;
never on blur.

A failed write is one line in the same `.auth-error` in the server's sentence,
with the dialog open. No field is at fault, so none is marked.

The create and rename paths keep the requirements' limits: 1-40 trimmed
characters, unique under case folding, 20 sessions, 40 unpinned tabs per
session. The view owns none of those numbers in its own right; it disables the
`+` at 20 and shows counts.

---

## 7. Keyboard and ARIA

### 7.1 The view

| Where | Key | Action |
|---|---|---|
| header `+` | `Enter`, `Space` | open New |
| `⋯` | `Enter`, `Space` | open that row's menu; focus lands on `Rename…` |
| session row | `Enter`, `Space` | switch to that session (native button activation; no key handler) |
| any row | right-click | open that row's menu at the pointer |
| list | `Tab` / `Shift+Tab` | next / previous row, then its `⋯` |

There is no roving tabindex and no arrow-key navigation in the list (D13).

| Element | ARIA |
|---|---|
| session button | native `<button type="button">`; `aria-current="true"` on the active one, absent on the others |
| count | visible digits plus an `.sr-only` unit (` tabs` / ` tab`), so the row reads “Deep work, 3 tabs” |
| dot | `aria-hidden="true"`; `, unsaved changes` is in the session button's text |
| `⋯` | `aria-label="{name} actions"`, `aria-haspopup="menu"`, `aria-expanded` |
| header `+` | `aria-label="New session"`; `aria-disabled` + `aria-describedby` when unavailable |
| list container | none. It is a group of buttons, not a listbox, menu or tree; the panel header names the view |
| footnote | a `<p>` outside the list, visible text |

`aria-current="true"` is deliberately not `"page"` (this is not navigation
between pages) and not `aria-selected` (there is no listbox; a selection role
would promise a selection model the view does not have).

### 7.2 The row menu

`NB.menu` owns ArrowUp/Down (skipping disabled items), ArrowRight/Left inside a
submenu, Enter/Space, Escape, click-outside and the focus trap-free close.
Sessions adds only the `onClose(reason)` hook (§4.6):

| Close reason | Focus |
|---|---|
| `esc` | back to the `⋯` that opened it |
| `pick` | the item's handler decides (dialog, confirm, or focus rule below) |
| `outside` | focus stays where the user clicked; nothing is pulled back |

### 7.3 Where focus lands after each action

| Action | New active session | Focus goes to | Why |
|---|---|---|---|
| switch | that row | the row that was clicked (native button focus) | the row is the control; do not move focus twice |
| create, from `+` | the new, empty session, appended last | the new row's session button, scrolled into view (`block:"nearest"`) | the new row is the confirmation |
| create, from the tab submenu | **unchanged** — the source stays active, and activates a neighbour if it lost its active tab | the tab strip, by the existing move path | the tab left this strip; the view may not even be open |
| rename, success | unchanged | the renamed row's session button | the row is the renamed thing |
| rename, cancel | unchanged | the `⋯` that opened the menu | the opener survives the closed menu |
| delete, confirmed | if the deleted row was active: the neighbour (previous, else next). If not: unchanged | the neighbour row's session button | the list did not jump; the neighbour is where the deleted row was |
| delete, cancelled | unchanged | the same row's `⋯` | the row is still there |
| menu `Esc` | unchanged | the row's `⋯` | §7.2 |

Two rules make this safe:

- **Focus is only moved when the view is visible.** A session created from the
  tab submenu, or renamed/deleted while the user is in another view, moves no
  focus; the tab path keeps its shipped focus rule.
- **A re-render preserves focus.** `render()` rebuilds the rows from scratch
  (the bookmarks pattern). Before clearing the list it records
  `{sessionId, control}` when `document.activeElement` is a `.session-row` or
  `.session-more` inside the list; after the rebuild it focuses the same
  control on the same session if that session still exists. Without this, the
  `tabs:changed` emitted by a switch would destroy the row the user just
  activated and drop focus to `<body>`.

### 7.4 Dialog

`NB.dialog` owns Tab wrapping, the inert background and returning focus.
`sessions.js` owns: `Esc` → cancel (on the overlay, with `stopPropagation()` so
one press does not also close anything underneath), `Enter` in the field →
submit, click on the scrim → cancel, and `aria-busy` plus a disabled submit
while the write is in flight. On success the view applies §7.3; on cancel the
opener is the fallback.

---

## 8. Responsive

| State | View | Notes |
|---|---|---|
| desktop, 240 px (default) | full row: name, count, dot, `⋯` | the design width; §4.2's numbers |
| desktop, 360 px | the same row, longer names | no layout change; the name gains room |
| desktop, 140 px (resize floor, `app.js` clamps at 140) | the same row, name ~62-74 px, ellipsised | count, dot and `⋯` hold; nothing wraps |
| desktop, panel collapsed | not rendered (`#side-panel.collapsed` hides views) | restored by the rail icon; unchanged |
| phone ≤ 860 px, or coarse pointer ≤ 1023 px | **hidden**: rail button and host | the same rule that hides AI; no phone surface |
| saved `activeView: "sessions"` on a phone | boots into **Explorer** | `app.js` forces it beside the existing `"ai"` guard |
| a phone that rotates to desktop | the view is built and populated, never shown while phone | the host was built at load; nothing remounts |

No new breakpoint, no container query, no compact row. The panel is resizable,
so the row is designed to survive 140-360 px with one rule set; only the name
flexes.

---

## 9. Behaviour

### 9.1 Switching

Instant, no reload, no fetch on the visible path. The strip re-renders from the
target session's tabs and paints its stored active tab; the previously active
session keeps its own tab set, order and active tab. No busy state and no
confirm — unsaved buffers live with their files, and a switch stashes them as
drafts. Clicking the already-active row does nothing.

### 9.2 Creating

`+` → dialog → on success the session is appended last, becomes active, and its
strip shows the pinned region plus no unpinned tabs. The dialog closes; focus
goes to the new row (§7.3). At 20 the `+` is `aria-disabled` and opens nothing.

From the tab submenu the same dialog runs, the tab moves into the new session,
and the active session does **not** change (requirements AC28). If the moved tab
was the source's active tab, the source activates its neighbour, exactly as
Close does.

### 9.3 Renaming

`⋯` → `Rename…` → the same dialog, prefilled and pre-selected → on success the
row's name and its title update without a reload. The session's id, order, tabs,
active tab and drafts are untouched. The list re-renders; focus returns to the
renamed row.

### 9.4 Deleting, on any row

`⋯` → `Delete…` → the native confirm (§5.1). Cancel changes nothing and returns
focus to the row's `⋯`. OK:

- the session's unpinned tabs close; pinned tabs are untouched;
- if it was the active session, the previous session in the list becomes
  active, else the following one (AC21), and the strip and content re-render;
- if it was not active, the active session does not change and the editor does
  not re-render;
- the list re-renders and focus lands on the neighbour's row (§7.3).

Deleting the only session is impossible: the item is disabled. There is no
styled confirm; `window.confirm` is the app's native dialog, as for workspace
Remove.

### 9.5 Moving a tab

`Move to session` → a target name: the tab leaves the active strip and joins the
target's list at the end. If the target already lists the note, no second tab is
added; the source copy is simply removed. It is not a close: the viewer cache
entry and any stashed draft stay with the file. The view does not switch. If the
tab was the active one in the active session, the session's active tab moves to
the neighbour, as Close already does; if the source is now empty, it stays active
and renders its empty state. A pinned tab cannot be moved: no item is built.

### 9.6 The dirty dot

On when any file open in that session has unsaved changes, computed by the same
predicate the tab dot uses. Recomputed on every row render, including the
renders caused by `viewer:dirty-changed` (a save that empties the last dirty
buffer clears it) and by `tabs:changed`. The list re-renders even when hidden,
so opening the view never shows a stale dot.

### 9.7 Empty sessions and the empty list

An empty session is a normal row with `0`. It stays listed, switchable, and
renders the strip's own empty state: pinned tabs if any, otherwise the welcome
page. It is not removed for being empty. There is no empty-list state, because a
workspace always has at least one session.

### 9.8 Order

Creation order is the session order, top to bottom. There is no drag handle, no
`draggable`, and no drop marker in v1 (D10). The order is stable across
reloads; renaming does not move a row, and deleting leaves the survivors in
place.

### 9.9 Phone

The view is not part of the phone shell. The phone has one reader, no tab bar,
and never reads or writes desktop sessions; the rail icon and the host are
hidden by the phone query. A saved desktop `activeView` of `"sessions"` cannot
leave the drawer blank because `app.js` forces Explorer at boot (§8). Nothing in
`sessions.js` branches on the mode: the view is built, populated and simply
never shown.

---

## 10. Accessibility checklist

- [x] Contrast: every text pair in §3.3 passes 4.5:1 in both themes, and every
      non-text pair passes 3:1. The two failing shipped pairs this view exposes
      (disabled menu label, danger menu hover) are fixed additively.
- [x] The active row is not distinguished by hue alone: fill, 2 px accent edge
      and 600 weight.
- [x] Every row is a native button; Enter and Space switch without a handler.
- [x] The `⋯` is visible at rest and in the tab order, so it needs no hover or
      pointer.
- [x] The menu is `role="menu"`, its items are native buttons, and the opened
      item receives focus (`focusFirst`).
- [x] `Esc` returns focus to the `⋯`; a pick moves focus to the new row, the
      renamed row, or the neighbour after a delete.
- [x] A re-render preserves focus on the same control on the same session (§7.3).
- [x] The count is announced with its unit; the dot is `aria-hidden` and the
      unsaved state is in the button's text.
- [x] The only-session Delete is disabled, not a tab stop in the arrow walk, and
      carries its reason on `title`.
- [x] The 20-session `+` keeps a tab stop, `aria-disabled` and a described
      reason, so a keyboard user can learn why it does nothing.
- [x] A viewer can still switch; every structural action is muted and says why.
- [x] The header `+` and the `⋯` each have a 2 px `--accent` focus ring, inset or
      outset where the container allows; none is clipped.
- [x] The footnote is visible text, outside the list, so it is not announced as
      a control.
- [x] No keyboard shortcut is added in v1, so nothing collides with the editor.

---

## 11. Implementation map

| File | Change |
|---|---|
| `templates/index.html` | `#sessions-view` host after `#sidebar` and before `#pinned-view`; `sessions.js` script beside `bookmarks.js`. **The tab bar is not touched.** |
| `static/js/activity.js` | one `register({ id: "sessions", icon: "🗂", label: "Sessions" })` after Explorer; no mount |
| `app.py` | `_ACTIVE_VIEWS` gains `"sessions"` (the cross-file test compares it with the registry and the `data-view` hosts) |
| `static/js/sessions.js` | new module: build the view at load, render rows, own the row menu and dialog, run create / rename / delete on any row, expose `moveTo` and `newFromTab` to `tabs.js` |
| `static/js/tabs.js` | `tabMenuItems()` gains `Move to session` (Organize, after Pin/Unpin), built only for unpinned tabs; the move primitive |
| `static/js/menu.js` | `buildSubmenu()` honours `item.disabled` and `item.title`; `open({…, onClose})` with the three close reasons |
| `static/js/app.js` | the phone guard covers `"sessions"` as well as `"ai"` |
| `static/css/style.css` | one appended block (Appendix A) — no existing declaration edited |
| `static/sw.js` | cache-name bump beside the existing one |

`sessions.js` internals a maintainer will look for:

| Name | Role |
|---|---|
| `buildView()` | runs once at load: header (`Sessions`, `+`, collapse) + `#sessions-list.bookmarks-list.sessions-list` + the footnote |
| `render()` | one row per session from the model; preserves focus (§7.3); called at load, on `tabs:changed`, on `viewer:dirty-changed`, and after every mutation |
| `openMenu(id, x, y, trigger)` | builds `Rename…` / `Delete…` with the disabled cases, opens `NB.menu`, tracks `aria-expanded` |
| `openNew()` / `openRename(id)` | the one dialog in its two modes |
| `remove(id)` | the confirm, the neighbour, the persistence call |
| `activeId()` | the session the strip is showing |
| `moveTo(path, id)` | removes from the active session, appends to `id` |
| `newFromTab(path)` | the dialog from the tab submenu, then moves that tab in |
| `isWritable()` | `NB.pageRole() !== "viewer"` |

The row shape the renderer needs:

```js
{ id: "…", name: "Deep work", count: 3, dirty: true, active: true }
```

`count` is unpinned tabs only. `dirty` is true when any of those files has
unsaved changes. `active` drives `aria-current="true"`, never a separate class.

The list lives in the per-workspace state beside the tabs and pins
(`sessions` and `activeSessionId`; `requirements/features/sessions.md` §2, §8).
The migration is the requirements' (§5.4): no `sessions` key → one session
named `Main`, no dialog, no reload. The limits are the requirements' (§4.4):
20 sessions, 40 characters, 40 unpinned tabs. This document adds no storage
shape and no limit of its own.

---

## 12. Appendix A — CSS as shipped

Appended to the end of `static/css/style.css`, after the workspace block. No
existing declaration is edited. The added context-menu rules are additive
overrides of shipped states that this view would otherwise expose as failing
contrast (§3.3) or as an unreachable disabled flyout; they are the only rules
that change how already-shipped menus look.

**What this block depends on.** `.panel-header`, `.panel-title`,
`.panel-header-actions`, `.bookmarks-list`, `.bookmark-row`, `.collapse-btn`,
`.sr-only` and the `#nb-menu` shell are shipped and unchanged. The view adds no
rule for its host or its list: it reuses both.

```css
/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* A named set of unpinned tabs plus its own active tab, per workspace.*/
/* The control is a side-panel view beside Explorer, Pinned and        */
/* Bookmarks. The tab bar is untouched: #tab-pinned, #tab-list and     */
/* #outline-toggle are its only children.                              */
/* Spec: docs/ui/sessions.md.                                          */
/* ------------------------------------------------------------------ */

/* The header +. Same 18 px box as .bookmarks-add, but its own class: the
 * bookmark button is the ★ toggle, and its phone rule is scoped to
 * #bookmarks-view. Keeps its tab stop when unavailable so the reason is
 * reachable (sessions.md D15). */
.session-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--fg-muted);
  font: inherit;
  font-size: 1.07rem;
  line-height: 1;
  cursor: pointer;
}
.session-add:hover { color: var(--fg); background: var(--accent-soft); }
.session-add:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.session-add[aria-disabled="true"] {
  color: var(--ws-fg-muted);
  cursor: default;
  opacity: .72;
}
.session-add[aria-disabled="true"]:hover { background: none; }

/* One row = wrapper + two buttons. The row is a <button> so Enter and
 * Space switch it natively; a button cannot contain the ⋯ button, so the
 * two are siblings and the wrapper keeps them on one line. */
.session-row-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

/* The row reuses .bookmark-row (flex, 3px 6px padding, 4 px radius, hover,
 * nowrap) and resets the button chrome .bookmark-row never needed as a div. */
.session-row {
  flex: 1 1 auto;
  min-width: 0;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.session-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* The active session: the bookmarks selected fill, the tree's 2 px accent
 * edge, and weight. The name stays --fg: --accent on --accent-soft is
 * 4.39:1 in the dark theme, under 4.5:1 for 14 px text (the shipped
 * bookmark-selected pair). Three cues, none of them hue alone. */
.session-row[aria-current="true"] {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
  font-weight: 600;
}
.session-row[aria-current="true"]:hover { background: var(--accent-soft); }

.session-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The same 8 px accent dot as .tab.dirty, so a session row and its visible
 * dirty tab never disagree. Presentational: the row's accessible name
 * carries ", unsaved changes". */
.session-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

/* Unpinned tab count. Tabular digits and a 2ch floor keep the column steady
 * from 0 to 40. --ws-fg-muted, not --fg-muted (4.26:1 on the light panel).
 * On the active row it takes --fg: --ws-fg-muted on --accent-soft is
 * 4.03:1 in the dark theme. */
.session-count {
  flex: 0 0 auto;
  min-width: 2ch;
  text-align: right;
  font-size: .76rem;
  font-variant-numeric: tabular-nums;
  color: var(--ws-fg-muted);
}
.session-row[aria-current="true"] .session-count {
  color: var(--fg);
  font-weight: 400;
}

/* Per-row actions. Visible at rest: a keyboard user must be able to reach
 * it without a pointer, and a hover-only control cannot be tabbed to. */
.session-more {
  flex: 0 0 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 4px;
  color: var(--fg-muted);
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
.session-more:hover { color: var(--fg); background: var(--accent-soft); }
.session-more:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* The model in one line, pinned to the view's bottom. It explains the shared
 * pinned region, which is true at any scroll position, and must not scroll
 * out of sight at 20 sessions. */
.sessions-foot {
  flex: 0 0 auto;
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  color: var(--ws-fg-muted);
  font-size: .76rem;
  line-height: 1.35;
}

/* ---- Move to session flyout ------------------------------------- */
/* The shipped flyout shrink-to-fits inside its parent's 170 px, so a
 * session name longer than the 150 px minimum wraps onto two lines. Size
 * it to its longest name and clip at 260 px (about 30 characters) rather
 * than wrap. Applies to every submenu; the existing labels are short. */
body > #nb-menu .submenu > .context-menu { width: max-content; max-width: 260px; }
body > #nb-menu .submenu > .context-menu button {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* A disabled parent (the read-only "Move to session") must not reveal a
 * flyout the user cannot act on. */
body > #nb-menu .submenu[disabled] > .context-menu { display: none; }

/* ---- two shipped context-menu states this view exposes --------- */
/* Additive overrides, later in the file than the shipped rules. */
/* A disabled item must stay above 4.5:1 on the light --bg-elev. */
body > #nb-menu button:disabled { color: var(--ws-fg-muted); }
/* --danger on the accent-soft hover fill is 3.99:1 light and 3.73:1 dark.
 * The ring keeps the face (4.68 / 5.07) and marks the target. */
body > #nb-menu button.danger:hover {
  background: none;
  box-shadow: inset 0 0 0 1px var(--danger);
}

/* ---- dialog: one short label ------------------------------------ */
#session-dialog .settings-label { flex: 0 0 92px; }

/* ---- phone: the view does not exist ----------------------------- */
/* Same rule and same treatment as the AI view (style.css:7220-7221). This
 * block is a second copy of the phone query because Appendix A is appended
 * after the shipped one; no existing block is edited. The host is hidden
 * too, so a saved activeView cannot paint an empty drawer. */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  .activity-btn[data-view="sessions"],
  #side-panel .side-panel-view[data-view="sessions"] { display: none; }
}
```

`sessions-list` is a class hook with no declarations: the list's whole
appearance comes from `.bookmarks-list`. It exists so tests and the mockup can
name the node without restyling it.

`sessions.js` must not add a `z-index` of its own: the menu's `1000` comes with
`#nb-menu`, and the dialog sits at the modal band (`2000`) with the rest.

---

## 13. What to review

1. **The tab bar is untouched.** Three children, no chip, no placeholder, no
   wrapper. Check `tabs.js`'s `.tab` queries and drag code see the same nodes
   as before.
2. **The host is populated at load.** `#sessions-view` is empty in the template
   and full after `sessions.js` runs; `activity.js` has no mount for it; the
   list survives every switch. Check a boot with `activeView: "sessions"`.
3. **The rail order** is Explorer, Sessions, Pinned, Bookmarks, Recent, Search,
   AI, and the icon is `🗂` inside `.activity-icon`.
4. **The two-button row.** The `⋯` is not inside the session button; the row
   switches on Enter/Space; both focus rings are visible; the `⋯` is a tab stop.
5. **The active row** uses fill + edge + weight and keeps `--fg`; confirm the
   deviation from `.bookmark-row.selected` is contrast, not taste.
6. **Delete on any row** with the right confirm variant, and the disabled case
   on one session.
7. **The three limit states** — one session, 20 sessions, viewer — each says why
   in a `title` and, for the `+`, in a described-by note.
8. **The phone** hides both the icon and the host, and a saved `"sessions"`
   boots to Explorer.
9. **Focus after every action** (§7.3), including the re-render that a switch
   triggers — the focused row must survive it.
10. **Persistence and migration are the requirements doc's**, not this one's.
    The one product-doc conflict is Delete-on-any-row (D9); AC18/AC21/AC23 must
    be reworded.

---

## 14. Do not

- Do not add the chip, the popover, or any other child to `#tab-bar`. The strip
  is exactly three children.
- Do not render the session list lazily on first activation. It is built at
  load, like bookmarks, and activity.js only toggles `[hidden]`.
- Do not put a `mount` function on the sessions registration.
- Do not add an active-session indicator to the strip, the topbar, the rail or
  the panel header. The view is the indicator while it is open (D14).
- Do not nest the `⋯` inside the session button, and do not replace the session
  button with a `div role="button"`.
- Do not colour the active row's name `--accent` on `--accent-soft`; it fails
  4.5:1 in dark. Do not colour its count `--ws-fg-muted`; it fails in dark.
- Do not hide the `⋯` until hover or focus.
- Do not add `New session…` or `Switch` to the row menu.
- Do not add drag-to-reorder, a drop marker, or a handle in v1.
- Do not restyle the delete confirm; it is `window.confirm`.
- Do not add a keyboard shortcut in v1.
- Do not design a phone surface. Hide the icon and the host, and fall back to
  Explorer.
- Do not introduce a session colour token. `--fg`, `--ws-fg-muted`, `--accent`
  and `--danger` cover every string.
