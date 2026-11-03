# Sessions — design handoff

Status: implemented. The feature shipped in `static/js/tabs.js`,
`static/js/sessions.js`, `static/js/viewer.js`, `static/js/app.js`,
`static/js/activity.js`, `static/js/menu.js`, `templates/index.html`,
`static/css/style.css`, and the workspace-state changes in `app.py`.
**Revision 3's visual delta is applied**: A.1/A.2 replaced the view-chrome CSS
and §11's four `sessions.js` DOM edits are in. Appendix A is the CSS as shipped.

**Revision 3 — the look only.** The Sessions view is redrawn as **marker
rows**: 30 px rows, a neutral hover, an accent-tinted active row with a short
accent marker, the count in quiet tabular digits, and a header that carries the
session total. Nothing else moves: the model, the feature set, the rail icon,
the tab bar, the tab menu, both dialogs, the row menu, the phone rule and every
behaviour are revision 2's. §0 says what changed and why and what was rejected.
Appendix A.1 marks the CSS delta; A.2 is the replacement block; A.3 is the part
of the shipped block that stays.

**Revision 2 (standing).** The tab-bar chip and its popover were rejected.
Sessions are a side-panel view beside Explorer, Pinned, Bookmarks, Recent,
Search and AI — the app's established pattern. The tab bar returns to exactly
its shipped three children (`#tab-pinned`, `#tab-list`, `#outline-toggle`) and
gains nothing. The `Move to session` tab-menu item, the model, its limits, its
migration and the name dialog are unchanged.

Reference mockup: [`sessions-mockup.html`](sessions-mockup.html) — a before/after
board; the whole shell at 240 px and at 360 px; the row states; the 140 px floor;
the `⋯` at rest, row-hover, button-hover, focus and open; the row menu
overhanging the panel; the New session dialog over the shell; the only-session,
20-session and viewer states; a long name, an empty session and a dirty row;
the light theme; the row anatomy and sizes table; and the activity-bar
close-up. Theme toggle in the page header.

**Normative source.** §0.3 (the direction), §3 (tokens), §4 (components), §5
(copy), §7 (keyboard and ARIA), §8 (responsive) and Appendix A (CSS) are the
single source of truth. The mockup illustrates them; where the two differ, this
document wins, and where this document differs from `static/css/style.css`, the
stylesheet wins for anything already shipped.

Read [`workspaces.md`](workspaces.md) §4.3 first: the dialog shell and its
validation are the workspace name dialog's, unchanged.

---

## 0. Revision 3 — the visual direction

### 0.1 What changed, and why

| Surface | Revision 2 (shipped) | Revision 3 | Why |
|---|---|---|---|
| Header | plain title, 18 px `+`, ghost `‹` | title + **session total** chip, 24 px `+`, 24 px `‹` | The view lists a finite set; the total is the one fact the header can add without repeating a row. 24 px is the WCAG 2.2 target minimum and matches the `⋯`. |
| Rows | 27 px, 4 px radius, 1 px gap, bookmark styling | **30 px, 6 px radius, 2 px gap** | Air is the difference between "list of items" and "settings list". 20 rows still scroll. |
| Hover | `--accent-soft` wash on every row | **neutral `--bg-elev`** | An accent wash under the pointer made the list feel permanently selected. Now hover is neutral and **only the active row is tinted**. |
| Active | full-height 2 px inset edge + tint + 600 | **14 px rounded marker** + tint + 600 | The marker is a position cue, not a hue cue, and echoes the activity bar's 2 px indicator. It stops the whole row edge from reading as a border. |
| `⋯` | 20 px, muted at rest, accent fill on hover | **24 px**, muted at rest, `--fg` on the active row, `--fg` + accent face while open | Target size; contrast on the active face; an open menu now shows where it came from. |
| Footnote | plain 12 px paragraph | **pin glyph + one sentence** | Reads as a note about the model, not as a caption clipped to the pane. |
| List and row CSS | reused `.bookmarks-list` / `.bookmark-row` | own `.sessions-list` / `.session-row` | A session is not a bookmark. Inheriting meant fighting five shipped rules (padding, gap, hover, selected colour) and re-deciding them one at a time. |

### 0.2 The direction, and the two rejected

**Chosen: marker rows**, with a card's air taken without its box — 30 px rows,
2 px gaps, a 6 px radius, no per-row border.

| Direction | Shape | Verdict |
|---|---|---|
| **1 · Cards** | each session a bordered, filled card at 10 px radius, 8 px gaps, a count pill, `⋯` at the card's top-right, a `＋ New session` row at the bottom | **Rejected.** At 20 sessions it is ~950 px of cards inside a 620 px panel. At the 140 px floor a card has no room for an inset face plus a pill. Twenty 1 px borders is exactly the boxed, settings-like weight this revision removes, and the bottom create row duplicates the header `+`, which D8 keeps as the single create action. |
| **2 · Marker rows** | 30 px rows, a left marker, neutral hover, accent-tinted active row, bare count, `⋯` at rest | **Chosen.** Survives 140 px, stays scannable at 20, and gets its hierarchy from three cheap cues instead of a box per row. |
| **3 · Grouped list** | an "Active" card at the top, the other sessions as a muted list below | **Rejected.** It either draws the active session twice or removes it from the list it belongs to, and it teaches two visual grammars for one list. The active row is already the strongest thing on screen. |

The blend is deliberate: the card direction's **air and radius** stay; its face,
border and count pill do not. The grouped list's **hierarchy** is already carried
by tint + marker + weight, so it needs no second group.

### 0.3 What did not change

- **The model.** Sessions, ids, names, order, the pinned set, the active
  session, persistence, the migration and the limits are untouched. The header
  total is `sessions.length`; it is not stored.
- **The feature set.** Switch, New, Rename, Delete, `Move to session`, the
  confirm, the 20-session cap, the 40-character cap, the viewer role.
- **The rail icon.** `🗂`, second slot, 36 px box, unchanged.
- **The tab bar.** Exactly `#tab-pinned`, `#tab-list`, `#outline-toggle`.
- **The phone.** The view and its rail icon stay hidden; the boot fallback is
  Explorer.
- **Keyboard and ARIA.** Two buttons per row, native activation, no roving
  tabindex, no new shortcut, `aria-current`, `aria-expanded`, the menu's
  Esc→`⋯` focus return.

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
`.activity-icon` box as the rest. Revision 3 does not touch it.

**D4 — A row is two buttons, not one.** A `<button>` cannot contain the `⋯`
button. The row is therefore a wrapper containing the session button and the
actions button, in that DOM order:

```html
<div class="session-row-wrap is-active" data-session-id="…">
  <button class="session-row" aria-current="true" title="{name}">
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
chosen shape is two tab stops per row, which D13 accepts. `is-active` is paint
only and mirrors `sessions.active`; `aria-current` remains the semantic truth
(D19).

**D5 — The active row reads selected, but not by colour alone.** `aria-current`
is `"true"` on the session button (a row in a list, not a page and not a radio).
The look is `--accent-soft` fill, a 14 px rounded `--accent` marker at the row's
left edge, and 600 weight — three cues, one of them positional.

The name stays `--fg`. `.bookmark-row.selected` colours the name `--accent`,
which is 4.39:1 on `--accent-soft` in the dark theme — under 4.5:1 for 14 px
text. The shipped bookmark rows inherit that pair; this feature does not copy
it, and does not change the bookmark rule.

**D6 — The count is always present, including `0`.** The count is the number of
**unpinned** tabs in that session; the shared pinned region is never counted.
Zero is a valid session and is drawn as `0`, never hidden and never styled as
an error. The dot sits **before** the count and the count is right-aligned with
a 2ch floor, so a dirty row's digits keep the same right edge as a clean row's.

**D7 — The `⋯` is visible at rest.** A hover-only control cannot be reached by
the keyboard without a reveal-on-focus trick, and a 240 px row has no room for
an affordance the user must discover. It is muted at rest, brightens with its
row, takes `--fg` plus the accent-soft face on hover or while its menu is open,
and has an inset focus ring. Revision 3 keeps this rule and adds the open state.

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
the row is a switch button with a second button on it, and reordering sessions
is not a stated goal (`requirements` §4.2(8) makes order stable). Revision 3's
2 px gap is not a drag hint: there is still no handle and no `draggable`.

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

**D16 — The header carries the session total.** The view exists to show a set;
the header saying how large the set is costs one 18 px chip and no row. It is a
plain count of rows — `sessions.length` — so it cannot disagree with the list.
It is **not** a badge: it has no accent fill and no semantic status. At the
20-session cap it reads `20`; the disabled `+` and its described reason carry the
limit.

**D17 — Hover is neutral; selection is blue.** Revision 2 used
`--accent-soft` for both, so a moving pointer repainted the accent and the
selected row was only one among several blue rows. Revision 3 uses
`--bg-elev` for hover (the app's card/tab elevation step) and keeps
`--accent-soft` for the active row only. The result: at most one tinted row is
visible at any time.

**D18 — The view owns its list and row CSS.** `.bookmarks-list` supplies
`padding: 0 4px 6px` and `gap: 1px`; `.bookmark-row` supplies 3 px padding, a
4 px radius, a 21 px line box and an accent hover, and `.bookmark-row.selected`
colours the name `--accent`. Overriding four of those in a later block, for a
row that is not a bookmark, leaves two rule sets fighting over one element.
Revision 3 drops both classes from this view (they stay untouched on the
bookmarks view) and gives the sessions list and row complete rules. The class
names the shipped browser tests select — `.session-row-wrap`, `.session-row`,
`.session-count`, `.session-more`, `.session-dot` — are all kept.

**D19 — `is-active` is paint only.** The active row's `⋯` must be `--fg`
because `--fg-muted` on `--accent-soft` is 3.46:1 in dark, and a glyph is text
(§3.3). CSS cannot select the `⋯` from a sibling's `aria-current` without
`:has()`, which the rest of the app does not use. `buildRow()` therefore sets
`wrap.classList.toggle("is-active", s.active)` from the same flag that sets
`aria-current`. The class never replaces `aria-current`, is never read by the
keyboard or by a test as a state, and is never set from a click handler.

**D20 — The 140 px floor is handled by a container query, not a media query.**
The panel's width comes from `--side-panel-width`, which a viewport media query
cannot see. `.side-panel-view[data-view="sessions"]` therefore becomes an
inline-size container, and one `@container (max-width: 176px)` block tightens
the header and removes the total from the line. This is the only new CSS
mechanism; it changes no markup. The total is visually hidden with the
`.sr-only` recipe rather than `display: none`, so it stays in the accessibility
tree.

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
- It does not become a card list. There is no per-row border, face or shadow
  (§0.2).

---

## 3. Tokens

### 3.1 Reused, no change

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-panel` | `#22232a` | `#f6f7f9` | the panel, the header, the hint band |
| `--bg-elev` | `#2a2b34` | `#eceef2` | the row hover face, the row menu |
| `--fg` | `#e6e6ea` | `#1f2330` | session names, the active count, the `⋯` on hover / open / active, menu labels |
| `--fg-muted` | `#8b8d98` | `#5d6470` | the title, the total chip, the `⋯` at rest, the hint's pin |
| `--accent` | `#7c9cff` | `#2f5fd0` | the active marker, the dirty dot, focus rings |
| `--accent-soft` | 18 % | 12 % | the active row face, the `⋯` hover/open face, menu hover |
| `--border` | `#383a45` | `#d8dde4` | the total chip's border, the hint rule, the menu edge |
| `--danger` | `#ff6b6b` | `#c0392b` | the Delete label, its ring |
| `--ws-fg-muted` | `#9799a4` | `#5d6470` | counts, the hint, disabled controls and labels |
| `--code-bg` | `#14151a` | `#f0f2f5` | the dialog's input |
| `--accent-fg` | `#14151a` | `#ffffff` | the dialog's primary label |

### 3.2 New, scoped

```css
/* none */
```

The view introduces no session token. The new pieces — `.panel-heading`,
`.session-total`, `.session-add`, `.session-row-wrap`, `.session-row`,
`.session-name`, `.session-dot`, `.session-count`, `.session-more`,
`.sessions-foot`, `.sessions-foot-pin` — are declarations on shipped tokens. A
new colour would need two theme values with no failing pair to justify it.

### 3.3 Contrast

Measured on the pairs the view actually paints, with the alpha of `--accent-soft`
composited over the surface behind it. Text is 4.5:1; the marker, dot and rings
are 3:1.

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| `--fg` on `--bg-panel` | 12.57 | 14.61 | passes |
| `--fg-muted` on `--bg-panel` — title, total, `⋯` at rest | 4.74 | 5.56 | passes |
| `--ws-fg-muted` on `--bg-panel` — count, hint | 5.52 | 5.56 | passes |
| `--fg` on `--accent-soft` — active name and count | 9.19 | 12.39 | passes |
| `--fg` on `--bg-elev` — name and `⋯` on a hovered row | 11.30 | 13.48 | passes |
| `--ws-fg-muted` on `--bg-elev` — count on a hovered row | 4.96 | 5.13 | passes |
| `--accent` on `--bg-panel` — marker, focus ring | 6.00 | 5.34 | passes (non-text) |
| `--accent` on `--accent-soft` — dirty dot on the active row | 4.39 | 4.53 | passes 3:1 (non-text) |
| `--fg-muted` on `--accent-soft` — **not used** | 3.46 | 4.72 | **fails 4.5:1 in dark — this is why the active row's `⋯` takes `--fg`, and why `is-active` exists (D19)** |
| `--danger` on `--bg-elev` — Delete at rest | 5.07 | 4.68 | passes |
| `--ws-fg-muted` on `--bg-elev` — disabled menu label | 4.96 | 5.13 | passes |
| `--border` on `--bg-panel` — total chip border | 1.39 | 1.27 | decorative only; it never carries state |

Two shipped defects exposed by this view were fixed additively in revision 2 and
are unchanged:

- **Disabled menu items** use `--fg-muted` on `--bg-elev` (4.26:1 in light). The
  only-session Delete is disabled, so it takes `--ws-fg-muted` instead.
- **Danger menu items** fill with `--accent-soft` on hover, putting `--danger`
  at 3.99 / 3.73. The hover becomes a 1 px `--danger` ring on the row's face.

---

## 4. Components

### 4.1 View header

The shipped `.panel-header` (8 × 12 padding, `.79rem` uppercase title, a 1 px
bottom border), retuned for this view to 7 × 10 so two 24 px controls set the
height:

```html
<div class="panel-header">
  <div class="panel-heading">
    <span class="panel-title">Sessions</span>
    <span class="session-total"><span class="session-total-n">4</span><span class="sr-only"> sessions</span></span>
  </div>
  <div class="panel-header-actions">
    <button type="button" class="session-add" title="New session"
            aria-label="New session">+</button>
    <!-- NB.activity.makeCollapseBtn() appended here, as bookmarks.js does -->
  </div>
</div>
```

| Control | Spec |
|---|---|
| header | `padding: 7px 10px`; height 38 px = 24 px control + 14; the shipped `.panel-header` gap 6 and bottom border |
| `.panel-heading` | `display:flex; align-items:center; gap:6px; min-width:0`. Two children, so the shipped `space-between` still puts the actions at the right edge |
| title | `.panel-title` at `.79rem`, 400, `.8px` tracking, uppercase, `--fg-muted`; `min-width:0` so it ellipsises before the actions move |
| total chip | 18 px tall, `min-width:20px`, `padding:0 5px`, 1 px `--border`, 5 px radius, `.72rem`/600, `--fg-muted`, `font-variant-numeric: tabular-nums`. It shows `sessions.length`, updated in `render()`; its screen-reader text is ` sessions` |
| `+` | 24 × 24, 5 px radius, `--fg-muted`, glyph `1.05rem`/1. Hover: `--fg` on `--accent-soft`. Focus: 2 px `--accent`, offset 1 px. Transition `background` and `color` `.12s ease` |
| `+` at 20 sessions | `aria-disabled="true"`, `title="20 sessions is the limit. Delete one first."`, `aria-describedby="sessions-cap-note"`; no dialog opens; `--ws-fg-muted`, `opacity:.72`; still focusable (D15) |
| `+` as a viewer | `aria-disabled="true"`, `title="Read-only: sessions can’t be changed."`; same look |
| collapse `‹` | `NB.activity.makeCollapseBtn()`, unchanged markup; scoped to 24 × 24, 5 px radius, so it shares the `+` box. Second action, after the `+` |

The `.sr-only` note:

```html
<span id="sessions-cap-note" class="sr-only">20 sessions is the limit. Delete one first.</span>
```

The header title is the only "you are here" for the view; the rail button's
`aria-pressed` is the other, and both are shipped behaviour. The total is not a
state indicator: it is the row count (D16).

### 4.2 Row geometry

```
219 px  ┌────────────────────────────────────────┐
        │ ▎ Deep work                    3    ⋯  │   30 px tall, 6 px radius
        └────────────────────────────────────────┘
          └── .session-row (193) ──┘    └ 24 ┘
```

Markup is D4's. One wrapper per session, in session order. The wrapper is a
plain flex line in `.sessions-list`; it is not a control and carries no role. The
list is `display:flex; flex-direction:column; gap:2px`, so the wrapper carries
`flex:0 0 auto` — otherwise twenty rows would shrink instead of scroll.

The panel's 240 px width includes its 1 px right border, so the view gets
239 px; the list then loses the 8 px handle gutter and 12 px of inset.

| Space | 240 px panel (default) | 360 px panel | 140 px panel (resize floor) |
|---|---|---|---|
| list content (panel − 1 border − 8 handle − 12 inset) | 219 | 339 | 119 |
| `⋯` + 2 px gap | 26 | 26 | 26 |
| row outer | 193 | 313 | 93 |
| row inner (minus 10 px + 6 px padding) | 177 | 297 | 77 |
| name, clean (minus 6 px gap, 2ch count) | 158 | 278 | 58 |
| name, dirty (minus the 8 px dot and its 4 px gap) | 146 | 266 | 46 |

The name is the only flexible child. `min-width:0` plus
`overflow:hidden; text-overflow:ellipsis; white-space:nowrap` makes it yield
first; the count, dot and `⋯` never shrink. Nothing wraps at any width.

Row height is a 30 px `min-height` around a ~17 px line box (`.9rem` at
`line-height: 1.35`), with 3 px of padding and the flex line centred in what is
left. The `⋯` is 24 × 24 and centred, so it fits inside the 30 px without
setting it. When a list overflows at 20 sessions the platform scrollbar
takes its width from the content; the name yields again, and nothing overflows
horizontally.

### 4.3 Row states

| State | Treatment |
|---|---|
| default | face transparent, name `--fg`, count `--ws-fg-muted`, `⋯` `--fg-muted` |
| hover (row **or** its `⋯`) | face `--bg-elev`, name unchanged, `⋯` `--fg` |
| hover (`⋯` itself) | `--accent-soft` face, glyph `--fg` |
| active (`aria-current="true"`) | `--accent-soft` face, 14 px `--accent` marker at the left edge, name 600, count `--fg` 400, `⋯` `--fg` |
| active + menu open | the same face; the `⋯` keeps `--accent-soft` and `--fg` |
| focus-visible (row or `⋯`) | 2 px `--accent`, `outline-offset:-2px`, so it cannot spill past the 6 px list inset |
| long name | ellipsised; `title` on the session button carries the full name |
| 0 tabs | count `0`; everything else identical. No empty row, no dimming |
| only session | identical; the row's Delete item is the only thing that changes |
| viewer | identical. Switching writes nothing and is allowed |
| dirty | 8 px `--accent` dot before the count, plus `, unsaved changes` in the accessible name |
| busy | none. Switching is instant and local |

The marker is a `::before` on the row button: `position:absolute; left:0;
top:50%; width:2px; height:14px; margin-top:-7px; border-radius:0 1px 1px 0;
background:var(--accent)`. It is 14 px tall, so it never meets the 6 px rounded
corners.

### 4.4 Count and dot

- `.session-count`: `.76rem`, `font-variant-numeric: tabular-nums`,
  `min-width:2ch`, right-aligned, `--ws-fg-muted`; `--fg` on the active row.
  Always rendered, including `0`.
- `.session-dot`: 8 × 8 px, 50 % radius, `--accent`, `margin-right:4px`,
  `aria-hidden="true"`. Its meaning is the adjacent `.sr-only` text inside the
  session button, not the dot itself.
- The count is the session's unpinned tabs. Pinned tabs are shared and are not
  in any count. A session's dot is on when any file in that session has unsaved
  changes, computed by the same predicate `tabs.js` uses (`NB.viewer.isDirty`
  plus the hybrid editor's dirty flag). The dot and the visible `.tab.dirty`
  therefore cannot disagree.
- **No count pill.** A pill reads as an unread badge, and twenty of them turn the
  list into a column of chips. The count is information; the row's right edge is
  a stable column of digits instead.

### 4.5 `⋯` actions button

- 24 × 24 px, 5 px radius, `⋯` (U+22EF), `1rem`/1, `--fg-muted` at rest.
- `margin` is none; the wrapper's 2 px gap separates it from the row.
- `aria-label="{name} actions"`, `title="{name} actions"`,
  `aria-haspopup="menu"`, `aria-expanded` toggled by the menu's open/close.
- Brightens to `--fg` when its row is hovered, on its own hover, while its menu
  is open, and on the active row (D19).
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
accepted; the mockup shows the overhang against an editor.

**One addition to `menu.js`:** `open()` gains an optional `onClose(reason)`,
called by the single close dispatcher with `"esc"`, `"outside"` or `"pick"`.
`sessions.js` uses it for two things: clear `aria-expanded` on the `⋯` (all
reasons) and return focus to that `⋯` when the reason is `"esc"`. Without it,
Escape hides the focused menu item and focus falls to `<body>` — the shipped
context-menu gap. The other two reasons move no focus, so no menu steals it.

### 4.7 Pinned hint

```html
<p class="sessions-foot">
  <span class="sessions-foot-pin" aria-hidden="true">📌</span>
  <span>Pinned tabs are shared by every session.</span>
</p>
```

`flex: 0 0 auto`, `display:flex`, `align-items:flex-start`, `gap:8px`,
`padding: 9px 12px 10px`, a 1 px top `--border`, `.76rem`/1.45, `--ws-fg-muted`
on `--bg-panel` (5.52 / 5.56). The pin is `.72rem` `--fg-muted` and `aria-hidden`;
it repeats the tab bar's pin glyph so the sentence has a subject at a glance.
The hint is outside the scrolling list, below it in the view's column (D11),
and it wraps at 240 and 140 like any paragraph — it is the one text in the view
allowed to.

### 4.8 Tab menu — `Move to session`

Unchanged from revision 2. `tabs.js` `tabMenuItems()` gains one entry in the
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

Unchanged from revision 2. Revision 3 does not touch it.

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

### 4.10 The limit and role states

| State | What changes |
|---|---|
| one session | Delete is disabled in that row's menu with its `title`. Everything else is normal: the session switches, renames, and counts. The total reads `1` |
| 20 sessions | the header `+` is `aria-disabled`, titled and described; the total reads `20`; no row changes; the list scrolls |
| viewer | `+` and both row-menu items are disabled with the read-only reason; rows still switch; the total still counts |

There is **no empty state**: a workspace always has at least one session
(requirements §4.2(1)), and a session with zero tabs is a normal row.

---

## 5. Copy

| Slot | String |
|---|---|
| header total, screen readers | `{n}` + ` sessions` (no visible unit; the title names the set) |
| header `+`, accessible name | `New session` |
| header `+`, title | `New session` |
| header `+`, at 20 | `title="20 sessions is the limit. Delete one first."`; described by `20 sessions is the limit. Delete one first.` |
| header `+`, viewer | `title="Read-only: sessions can’t be changed."` |
| row, title | `{name}` (the full name, for an ellipsised label) |
| row, screen readers | `{name}`, `{n} tabs` (`1 tab` when n = 1), `, unsaved changes` |
| row `⋯` | `{name} actions` |
| row menu | `Rename…` · `Delete…` |
| Delete, only session | `title="The only session can’t be deleted."` |
| pinned hint | `Pinned tabs are shared by every session.` |
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
| header total | static text; digits plus an `.sr-only` ` sessions`. Not a control, not a live region |
| pinned hint pin | `aria-hidden="true"`; the sentence follows as text |
| list container | none. It is a group of buttons, not a listbox, menu or tree; the panel header names the view |
| hint | a `<p>` outside the list, visible text |

`aria-current="true"` is deliberately not `"page"` (this is not navigation
between pages) and not `aria-selected` (there is no listbox; a selection role
would promise a selection model the view does not have). The wrapper's
`is-active` class is paint only and carries no ARIA (D19).

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
| desktop, 140 px (resize floor, `app.js` clamps at 140) | the same row, name ~46-58 px, ellipsised; header total visually hidden | the header tightens to 7 × 8 with a 4 px gap; the title still fits beside the two 24 px actions; nothing wraps |
| between 177 and 240 px | the same as 240, narrower | no threshold beyond the one container query |
| desktop, panel collapsed | not rendered (`#side-panel.collapsed` hides views) | restored by the rail icon; unchanged |
| phone ≤ 860 px, or coarse pointer ≤ 1023 px | **hidden**: rail button and host | the same rule that hides AI; no phone surface |
| saved `activeView: "sessions"` on a phone | boots into **Explorer** | `app.js` forces it beside the existing `"ai"` guard |
| a phone that rotates to desktop | the view is built and populated, never shown while phone | the host was built at load; nothing remounts |

The panel's width is `--side-panel-width`, not the viewport, so the floor is
handled by **one container query** on the view host (D20):

- `.side-panel-view[data-view="sessions"] { container-type: inline-size; }`
- `@container (max-width: 176px)` — header padding 7 × 8 with a 4 px gap, and
  the total visually hidden with the `.sr-only` recipe, so it stays in the
  accessibility tree.

No compact row, no second breakpoint, no layout change at 360. The row is
designed to survive 140-360 px with one rule set; only the name flexes, and the
hint wraps.

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
strip shows the pinned region plus no unpinned tabs. The total increments, the
dialog closes, and focus goes to the new row (§7.3). At 20 the `+` is
`aria-disabled` and opens nothing; the total reads `20`.

From the tab submenu the same dialog runs, the tab moves into the new session,
and the active session does **not** change (requirements AC28). If the moved tab
was the source's active tab, the source activates its neighbour, exactly as
Close does.

### 9.3 Renaming

`⋯` → `Rename…` → the same dialog, prefilled and pre-selected → on success the
row's name and its title update without a reload. The session's id, order, tabs,
active tab and drafts are untouched. The list re-renders; focus returns to the
renamed row. The total does not change.

### 9.4 Deleting, on any row

`⋯` → `Delete…` → the native confirm (§5.1). Cancel changes nothing and returns
focus to the row's `⋯`. OK:

- the session's unpinned tabs close; pinned tabs are untouched;
- if it was the active session, the previous session in the list becomes
  active, else the following one (AC21), and the strip and content re-render;
- if it was not active, the active session does not change and the editor does
  not re-render;
- the list re-renders, the total decrements, and focus lands on the neighbour's
  row (§7.3).

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
place. The 2 px gap is spacing, not a drop slot.

### 9.9 Phone

The view is not part of the phone shell. The phone has one reader, no tab bar,
and never reads or writes desktop sessions; the rail icon and the host are
hidden by the phone query. A saved desktop `activeView` of `"sessions"` cannot
leave the drawer blank because `app.js` forces Explorer at boot (§8). Nothing in
`sessions.js` branches on the mode: the view is built, populated and simply
never shown.

---

## 10. Accessibility checklist

- [x] Contrast: every text pair in §3.3 passes 4.5:1 in both themes; the marker,
      dot and rings pass 3:1. The one pair that does not (`--fg-muted` on
      `--accent-soft`, 3.46 dark) is never used for text: the active row's `⋯`
      takes `--fg` through `is-active`.
- [x] The active row is not distinguished by hue alone: face, 14 px marker and
      600 weight, one of them positional.
- [x] Every row is a native button; Enter and Space switch without a handler.
- [x] The `⋯` is visible at rest and in the tab order, so it needs no hover or
      pointer, and is 24 × 24 (WCAG 2.2 target size).
- [x] The header's two controls are 24 × 24 with a 2 px gap and a visible focus
      ring; the `+` keeps its tab stop when unavailable.
- [x] The menu is `role="menu"`, its items are native buttons, and the opened
      item receives focus (`focusFirst`).
- [x] `Esc` returns focus to the `⋯`; a pick moves focus to the new row, the
      renamed row, or the neighbour after a delete.
- [x] A re-render preserves focus on the same control on the same session (§7.3).
- [x] The count is announced with its unit; the header total carries its unit
      too; the dot and the hint's pin are `aria-hidden` and the unsaved state is
      in the button's text.
- [x] The only-session Delete is disabled, not a tab stop in the arrow walk, and
      carries its reason on `title`.
- [x] The 20-session `+` keeps a tab stop, `aria-disabled` and a described
      reason, so a keyboard user can learn why it does nothing.
- [x] A viewer can still switch; every structural action is muted and says why.
- [x] Every focus ring is a 2 px `--accent`, inset or outset where the container
      allows; none is clipped.
- [x] The hint is visible text, outside the list, so it is not announced as a
      control.
- [x] No keyboard shortcut is added, so nothing collides with the editor.
- [x] No information is removed at 140 px: the total is visually hidden only.

---

## 11. Implementation map

Revision 3 is a CSS-and-build change plus four small DOM edits in
`sessions.js`. No other file changes; everything in this table that is not
listed is revision 2's, already shipped.

| File | Change |
|---|---|
| `static/css/style.css` | Replace the view-chrome section of the appended Sessions block with A.2, and keep A.3 unchanged. No existing declaration outside the block is edited. |
| `static/js/sessions.js` | The four DOM edits below. No model, event, persistence or focus-rule change. |
| `templates/index.html` | Unchanged from revision 2: the `#sessions-view` host and the script tag. |
| `static/js/activity.js` | Unchanged: one `register({ id: "sessions", icon: "🗂", label: "Sessions" })`, no mount. |
| `app.py` | Unchanged: `_ACTIVE_VIEWS` already contains `"sessions"`. |
| `static/js/tabs.js` | Unchanged: the `Move to session` item and the session operations. |
| `static/js/menu.js` | Unchanged: `onClose(reason)` and the submenu `disabled`/`title` support. |
| `static/js/app.js` | Unchanged: the phone guard. |
| `static/sw.js` | Cache-name bump beside the existing one, as for every CSS change. |

The `sessions.js` DOM edits, all in `buildView()` / `buildRow()` / `render()`:

1. **Header heading.** Wrap the title and a new total in
   `<div class="panel-heading">…</div>`:

   ```js
   const heading = document.createElement("div");
   heading.className = "panel-heading";
   heading.appendChild(title);
   totalEl = document.createElement("span");
   totalEl.className = "session-total";
   totalNumEl = document.createElement("span");
   totalNumEl.className = "session-total-n";
   totalEl.appendChild(totalNumEl);
   const totalUnit = document.createElement("span");
   totalUnit.className = "sr-only";
   totalUnit.textContent = " sessions";
   totalEl.appendChild(totalUnit);
   heading.appendChild(totalEl);
   header.appendChild(heading);        // before .panel-header-actions
   ```

2. **Total value.** In `render()` (beside `updateAddBtn()`), set
   `totalNumEl.textContent = String(sessions.length);`. `refresh()` already
   re-renders whenever the row signature changes, and the row count is part of
   that signature.

3. **Class list.** The list becomes `class="sessions-list"` (drop
   `bookmarks-list`); the row button becomes `class="session-row"` (drop
   `bookmark-row`). Keep `id="sessions-list"`, the wrapper's
   `data-session-id`, and every `session-*` class the browser tests select.

4. **Active paint flag and hint glyph.** In `buildRow()`:
   `wrap.classList.toggle("is-active", s.active);` beside the `aria-current`
   line (D19). In `buildView()`, build the hint as a flex pair:

   ```js
   const pin = document.createElement("span");
   pin.className = "sessions-foot-pin";
   pin.setAttribute("aria-hidden", "true");
   pin.textContent = "📌";
   foot.appendChild(pin);
   const hint = document.createElement("span");
   hint.textContent = FOOT_TEXT;
   foot.appendChild(hint);
   ```

**Test surface.** `tests/browser/test_core_ui_browser.js` selects
`#sessions-list .session-row-wrap`, `.session-row`, `.session-count`,
`.session-more`, `.session-dot` and `#sessions-view .session-add`; all are kept.
Nothing selects `.bookmark-row` or `.bookmarks-list` inside this view. If a new
test asserts the old classes, the test is wrong, not the design.

`sessions.js` internals a maintainer will look for:

| Name | Role |
|---|---|
| `buildView()` | runs once at load: heading + total, `+`, collapse, `#sessions-list.sessions-list`, the pinned hint |
| `render()` | one row per session from the model; updates the total; preserves focus (§7.3); called at load, on `tabs:changed`, on `viewer:dirty-changed`, and after every mutation |
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
unsaved changes. `active` drives both `aria-current="true"` and the wrapper's
`is-active` class, from the same flag (D19).

The list lives in the per-workspace state beside the tabs and pins
(`sessions` and `activeSessionId`; `requirements/features/sessions.md` §2, §8).
The migration is the requirements' (§5.4): no `sessions` key → one session
named `Main`, no dialog, no reload. The limits are the requirements' (§4.4):
20 sessions, 40 characters, 40 unpinned tabs. This document adds no storage
shape and no limit of its own.

---

## 12. Appendix A — CSS

Three parts: what the revision-3 delta touches, the replacement block, and the
part of the shipped block that stays. The block is appended to the end of
`static/css/style.css`, after the workspace block; no existing declaration
outside it is edited.

### A.1 The delta, exactly

Inside the appended `/* Sessions */` block, the shipped rules from
`/* The header +. …` down to and including `.sessions-foot { … }` are
**replaced** by A.2. That is:

| Shipped rule | Disposition |
|---|---|
| `.session-add` and its three state rules | replaced (24 px, transition) |
| `.session-row-wrap` | replaced (`flex:0 0 auto`) |
| `.session-row` | replaced (30 px, 6 px radius, 10 px left pad, transition) |
| `.session-row:focus-visible` | replaced (6 px radius, same ring) |
| `.session-row[aria-current="true"]` and its `:hover` companion | replaced (tint + weight; the hover rule is removed) |
| `.session-row[aria-current="true"]` inset edge | replaced by the `::before` marker |
| `.session-name` | replaced (adds `margin-right:6px`) |
| `.session-dot` | replaced (adds `margin-right:4px`) |
| `.session-count` | kept (the declaration is unchanged) |
| `.session-row[aria-current="true"] .session-count` | kept verbatim |
| `.session-more` and its two state rules | replaced (24 px, open state) |
| `.sessions-foot` | replaced (flex, pin, 9/12/10 padding) |
| `.sessions-foot-pin` | **new** |
| `.panel-heading`, `.session-total` | **new** |
| the view's size container and the `@container` block | **new** |

Everything from `/* ---- Move to session flyout` to the end of the block is
**unchanged** and is reproduced in A.3 so a clean-room build has the whole
block in one place.

### A.2 The replacement view block

```css
/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* A named set of unpinned tabs plus its own active tab, per workspace.*/
/* The control is a side-panel view beside Explorer, Pinned and        */
/* Bookmarks. The tab bar is untouched: #tab-pinned, #tab-list and     */
/* #outline-toggle are its only children.                              */
/* Spec: docs/ui/sessions.md revision 3 — marker rows.                 */
/* ------------------------------------------------------------------ */

/* ---- header ------------------------------------------------------- */
/* The host is a size container so the header can shed the total at the
 * 140 px floor: the panel width is --side-panel-width, which no viewport
 * media query can see (D20). */
.side-panel-view[data-view="sessions"] { container-type: inline-size; }
.side-panel-view[data-view="sessions"] > .panel-header { padding: 7px 10px; }

/* Title + total. The total is a chip, not a notification badge: it
 * counts rows, it does not ask for attention (D16). */
.panel-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.panel-heading > .panel-title { min-width: 0; }
.session-total {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--fg-muted);
  font-size: .72rem;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* The header +. A 24 px box: the WCAG 2.2 target minimum, and 4 px
 * wider than the shipped 18 px +. Keeps its tab stop when unavailable
 * so the reason is reachable (D15). */
.session-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 5px;
  color: var(--fg-muted);
  font: inherit;
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.session-add:hover { color: var(--fg); background: var(--accent-soft); }
.session-add:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.session-add[aria-disabled="true"] { color: var(--ws-fg-muted); opacity: .72; cursor: default; }
.session-add[aria-disabled="true"]:hover { color: var(--ws-fg-muted); background: none; }

/* The collapse chevron takes the same 24 px box, so the two header
 * actions share one rhythm. */
.side-panel-view[data-view="sessions"] .collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 5px;
}

/* ---- list --------------------------------------------------------- */
.sessions-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-right: 8px;          /* the resize handle lives on that edge */
  padding: 6px 6px 10px;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ---- row ---------------------------------------------------------- */
/* One row = wrapper + two buttons. The wrapper only groups them; the
 * row is a <button> so Enter and Space switch it natively, and the ⋯ is
 * a sibling because a button cannot contain a button (D4). */
.session-row-wrap {
  flex: 0 0 auto;             /* rows must not shrink before the list scrolls */
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.session-row {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 3px 6px 3px 10px;
  background: none;
  border: 0;
  border-radius: 6px;
  color: var(--fg);
  font: inherit;
  font-size: .9rem;
  line-height: 1.35;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background .12s ease;
}
/* The whole strip reacts: pointing at the ⋯ warms the row it acts on.
 * Hover is neutral; only the active row is tinted (D17). */
.side-panel-view[data-view="sessions"] .session-row-wrap:hover .session-row:not([aria-current="true"]) {
  background: var(--bg-elev);
}
/* Active: tinted face + a 14 px accent marker + 600. The marker is the
 * same 2 px indicator the activity bar uses, and being 14 px tall it
 * never meets the row's 6 px corners. Three cues, one positional. */
.session-row[aria-current="true"] { background: var(--accent-soft); font-weight: 600; }
.session-row[aria-current="true"]::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 14px;
  margin-top: -7px;
  border-radius: 0 1px 1px 0;
  background: var(--accent);
}
.session-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* The name is the only flexible child: it yields first, and the count,
 * dot and ⋯ never shrink. */
.session-name {
  flex: 1 1 auto;
  min-width: 0;
  margin-right: 6px;
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
  margin-right: 4px;
  border-radius: 50%;
  background: var(--accent);
}
/* Unpinned tab count. Tabular and 2ch-floored so 0..40 holds one column;
 * right-aligned, so a dirty dot never shifts the digits. --ws-fg-muted,
 * not --fg-muted (4.26:1 on the light panel). On the active row it takes
 * --fg: --ws-fg-muted on --accent-soft is 4.03:1 in dark. */
.session-count {
  flex: 0 0 auto;
  min-width: 2ch;
  text-align: right;
  font-size: .76rem;
  font-variant-numeric: tabular-nums;
  color: var(--ws-fg-muted);
}
.session-row[aria-current="true"] .session-count { color: var(--fg); font-weight: 400; }

/* ---- ⋯ actions button --------------------------------------------- */
/* Visible at rest: a keyboard user must be able to reach it without a
 * pointer. --fg-muted on --accent-soft is 3.46:1 in dark, under 4.5:1
 * for a text glyph, so the active row's ⋯ takes --fg. is-active mirrors
 * aria-current for paint only; it never replaces it (D19). */
.session-more {
  flex: 0 0 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 5px;
  color: var(--fg-muted);
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.side-panel-view[data-view="sessions"] .session-row-wrap.is-active .session-more { color: var(--fg); }
.side-panel-view[data-view="sessions"] .session-row-wrap:hover .session-more { color: var(--fg); }
.session-more:hover,
.session-more[aria-expanded="true"] { color: var(--fg); background: var(--accent-soft); }
.session-more:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* ---- pinned hint -------------------------------------------------- */
/* The model in one line, pinned below the scroller: it explains the
 * shared pinned region, which is true at any scroll position, and must
 * not scroll out of sight at 20 sessions (D11). */
.sessions-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 9px 12px 10px;
  border-top: 1px solid var(--border);
  color: var(--ws-fg-muted);
  font-size: .76rem;
  line-height: 1.45;
}
.sessions-foot-pin {
  flex: 0 0 auto;
  font-size: .72rem;
  line-height: 1.5;
  color: var(--fg-muted);
}

/* ---- 140 px floor ------------------------------------------------- */
/* The total leaves the line but stays in the accessibility tree. */
@container (max-width: 176px) {
  .side-panel-view[data-view="sessions"] > .panel-header { padding: 7px 8px; gap: 4px; }
  .session-total {
    position: absolute;
    min-width: 0;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
}
```

### A.3 The unchanged remainder

Reproduced from the shipped block, byte for byte. Do not re-add it if it is
already on disk.

```css
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
   switches on Enter/Space; both focus rings are visible; the `⋯` is a 24 px
   tab stop.
5. **The active row** uses fill + marker + weight and keeps `--fg`; confirm the
   deviation from `.bookmark-row.selected` is contrast, not taste.
6. **Hover is neutral and only the active row is tinted.** Point at a row, then
   at its `⋯`, then at a different row.
7. **The header total** equals the row count at 1, 20 and after a delete; its
   `.sr-only` unit is present; it disappears at 140 px but is still announced.
8. **The 140 px floor.** Drag the panel to the floor: the title keeps its
   letters, the total leaves the line, no row wraps or clips the `⋯`.
9. **Delete on any row** with the right confirm variant, and the disabled case
   on one session.
10. **The three limit states** — one session, 20 sessions, viewer — each says
    why in a `title` and, for the `+`, in a described-by note.
11. **The phone** hides both the icon and the host, and a saved `"sessions"`
    boots to Explorer.
12. **Focus after every action** (§7.3), including the re-render that a switch
    triggers — the focused row must survive it.
13. **Persistence and migration are the requirements doc's**, not this one's.
    The one product-doc conflict is Delete-on-any-row (D9); AC18/AC21/AC23 must
    be reworded.

---

## 14. Do not

- Do not add the chip, the popover, or any other child to `#tab-bar`. The strip
  is exactly three children.
- Do not give a session row a card face, a per-row border, a shadow or an 8 px
  gap. The air is in the 30 px height and the 2 px gap; the box is the thing
  this revision removed.
- Do not use `--accent-soft` for hover. Hover is `--bg-elev`; only the active
  row is tinted (D17).
- Do not put the per-row count in a pill or badge. It is information, not an
  unread total (§4.4).
- Do not hide the `⋯` until hover or focus. Do not shrink it below 24 px.
- Do not colour the active row's name `--accent` on `--accent-soft`; it fails
  4.5:1 in dark. Do not colour its count `--ws-fg-muted`; it fails in dark.
- Do not set `is-active` from anything but the `active` flag that sets
  `aria-current`, and do not use it as a state hook for tests or behaviour.
- Do not drop the header total's `.sr-only` unit, and do not `display:none` it
  at 140 px.
- Do not use a viewport media query to respond to the panel width. The one
  container query is the mechanism (D20).
- Do not nest the `⋯` inside the session button, and do not replace the session
  button with a `div role="button"`.
- Do not add `New session…` or `Switch` to the row menu.
- Do not add drag-to-reorder, a drop marker, or a handle in v1.
- Do not restyle the delete confirm; it is `window.confirm`.
- Do not add a keyboard shortcut in v1.
- Do not design a phone surface. Hide the icon and the host, and fall back to
  Explorer.
- Do not introduce a session colour token. `--fg`, `--ws-fg-muted`, `--accent`,
  `--bg-elev` and `--danger` cover every surface.
