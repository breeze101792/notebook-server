# Top bar — the session picker

> **Archived.** Frozen design record, kept for history. Not a current spec. See [`../README.md`](../README.md).


Status: **shipped**, design record. This revision replaces the earlier top-bar
label. Built in `templates/index.html`, `static/css/style.css`,
`static/js/sessions.js`, `static/sw.js`, `tests/test_app.py`,
`tests/dom/test_dom.js`, `tests/browser/test_core_ui_browser.js` and
`tests/browser/test_mobile_browser.js`.

Reference mockup: [`topbar-session-mockup.html`](topbar-session-mockup.html) — the
picker open in the shell, the trigger states, the popover measured, the viewer
and cap states, twenty sessions, the narrow desktop, the hidden bar and the
phone, the light theme, and the rejected alternatives.

**Normative source.** §2 (placement, markup, CSS, JS), §3 (tokens), §4 (states),
§5 (keyboard and ARIA), §6 (responsive) and §8 (acceptance criteria). The mockup
illustrates them; where the two differ, this document wins.

This supersedes the sentence in [`sessions.md`](sessions.md) §1.1 D14 that said a
second indicator would duplicate a fact, and it reverses this file's earlier
decision to ship the name as a plain label. The rail, the strip, the view and the
tab bar are untouched. The Sessions view keeps create, rename and delete; the
picker adds a second door for switching.

---

## 1. Decision

**The active session's name in the top bar is a picker.** It is a button with the
workspace chip's chrome, opening an attached popover that lists every session and
an admin-only `New session…` row.

Why a control now: the request changed. The bar already says which session you
are in; the moment that name is what you want to change, the shortest path is the
name itself. The Sessions view keeps the management actions — the picker is a
switch surface, not a second management surface.

Why the workspace chip's chrome: two pickers in one bar must not invent two
faces. Both are 28 px high with a 6 px inner gap, capped at 240 px, with the same
caret, hover, focus ring and expanded face. The `1 × 16 px` divider still
separates the two scopes.

Why attached, not at the pointer: the popover opens in the same place every time,
under the name that opened it, so the same list looks the same each time. The
caret is the promise that the list belongs to the button.

Why the client fills it: `tabs.js` owns the session model and its normalisation
(`tabs.js:291-416`). A server-rendered name would duplicate those rules and could
disagree with the model for one frame after a legacy-state migration. The bar
ships hidden and `sessions.js` unhides it in the same `tabs:changed` render that
paints the restored tab strip.

Why no rail mount: with the top bar hidden, the Sessions panel is still one click
away on the rail, and it switches with the same model. The workspace picker needs
a rail mount because switching workspaces would otherwise be unreachable. The
session list already has a door; a third mount would duplicate it. See §6.

Why `New session…` lives here: the workspace picker carries `Add workspace…`, so
a picker with no way to add is a dead end. The row calls the existing
`#session-dialog` through `NB.sessions.openCreate`; there is no second form.
Rename and delete stay in the panel: they are management actions, and one of them
is destructive.

---

## 2. Placement and markup

### 2.1 `templates/index.html` — the glyph

The sprite already ships `#nb-icon-session`
(`index.html:101-106`). Two stacked bars read as a *set*; the workspace glyph's
two overlapping cards deliberately do not repeat. No glyph change.

### 2.2 `templates/index.html` — the bar

Inside the existing `{% if ws_interactive %}` block, directly after
`#workspace-bar`'s closing `</div>` (`index.html:149`) and before that block's
`{% endif %}` (`index.html:164`). It therefore renders only when the workspace
chip does — the full-access and viewer shells, never the unauthenticated locked
shell.

```html
<!-- The active session: a picker, the same shape as the workspace chip.
     It ships hidden and sessions.js fills it, because the client owns the
     model's normalisation. The menu is empty here; sessions.js builds the
     rows and moves the node to <body>, the workspace menu's pattern.
     The `topbar-` prefix is load-bearing: `.session-name` already names the
     Sessions row label (style.css:8287). -->
<div id="session-bar" class="topbar-session" hidden>
  <span class="topbar-divider" aria-hidden="true"></span>
  <button type="button" id="session-switch" class="session-switch"
          aria-haspopup="menu" aria-expanded="false"
          aria-controls="session-menu" title="">
    <svg class="topbar-session-glyph" aria-hidden="true" focusable="false"><use href="#nb-icon-session"/></svg>
    <span class="sr-only">Session: </span>
    <span class="topbar-session-name" id="topbar-session-name"></span>
    <span class="topbar-session-caret" aria-hidden="true">▾</span>
  </button>
  <div id="session-menu" class="session-menu" hidden>
    <div id="session-menu-list" class="session-menu-list" role="menu"
         aria-labelledby="session-switch"></div>
  </div>
</div>
```

`#topbar-session-name` is **not** `session-name` — that id belongs to the New /
Rename dialog's input (`index.html:674`, `sessions.js:25`).

The mockup draws the trigger inside a `.session-switch-wrap` so a still page can
position the popover with `position: absolute`. The app ships the button directly
in `#session-bar`; `sessions.js` moves `#session-menu` to `<body>` at boot and
positions it `fixed`. The wrapper is a drawing aid, not production markup.

The tab strip, the spacer, the actions and `#brand` are not edited.

### 2.3 `static/css/style.css` — the rules

Replace the comment at `style.css:7919-7925` (it states the old "context, not a
control" decision), the shipped `.topbar-session-chip` rules and the muted
`.topbar-session-name` rule (`style.css:7936-7948`) with the button rules, placed
before the popover block; keep `.topbar-session` and its `[hidden]` rule
(`style.css:7926-7935`). The chip is the model:

```css
/* The session trigger copies the workspace chip: two pickers in one bar
 * must not invent two faces. The 240 px cap is the chip's own, so the two
 * names yield at the same rate when the bar is tight. */
#topbar .session-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 240px;
  height: 28px;
  padding: 0 8px;
  font-size: .84rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
#topbar .session-switch[aria-expanded="true"] {
  background: var(--accent-soft);
  border-color: var(--accent);
}
#topbar .session-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#topbar .topbar-session-glyph { width: 12px; height: 12px; flex: 0 0 12px; }

.topbar-session-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .84rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--fg);
}
.topbar-session-caret {
  flex: 0 0 auto;
  color: var(--fg-muted);
  font-size: .72rem;
  line-height: 1;
  transition: transform .12s ease;
}
.session-switch[aria-expanded="true"] .topbar-session-caret { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .topbar-session-caret { transition: none; } }
```

The shared `#topbar button` rule (`style.css:192-202`) supplies the face —
background, border, radius and colour — exactly as it does for the workspace
chip; this block only sets the geometry. `.topbar-session` keeps its shell
(`display:flex; align-items:center; gap:12px; flex:0 1 auto; min-width:0`) and
`[hidden] { display:none }`.

The popover mirrors `.workspace-menu` (`style.css:7950-8002`) with session-scoped
names. The tokens live on the node because it is moved to `<body>` and does not
inherit from the topbar:

```css
.session-menu {
  --session-row-h: 32px;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 200;          /* above the phone rail (150), below the modals */
  width: 300px;
  max-height: min(70vh, 420px);
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
}
.session-menu[hidden] { display: none; }
.session-menu-list { display: flex; flex-direction: column; }

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--session-row-h);
  padding: 6px 8px;
  background: none;
  border: 0;
  border-radius: 5px;
  color: var(--fg);
  font: inherit;
  font-size: .93rem;
  text-align: left;
  cursor: pointer;
}
.session-item:hover { background: var(--accent-soft); }
.session-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.session-check { flex: 0 0 14px; width: 14px; text-align: center; font-size: .8rem; line-height: 1; color: var(--accent); }
.session-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-item-dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.session-item-count {
  flex: 0 0 auto;
  min-width: 2ch;
  text-align: right;
  font-size: .76rem;
  font-variant-numeric: tabular-nums;
  color: var(--ws-fg-muted);
}
.session-item[aria-current="true"] { color: var(--accent); font-weight: 600; }
.session-item[aria-current="true"]:hover { background: none; }
.session-item[aria-current="true"] .session-item-count { color: var(--accent); font-weight: 400; }
.session-menu-sep { border: 0; border-top: 1px solid var(--border); margin: 4px 2px; }
```

The phone query keeps its shipped line (`style.css:8112`):

```css
  /* Sessions are desktop-only (sessions.md D12); the phone names the note. */
  #session-bar { display: none; }
```

### 2.4 `static/js/sessions.js` — the picker

The module already owns the view, the rows, the dialog and the refresh wiring.
The picker is one more output of the same `refresh()`; there is no second
listener and no new event.

**Refs** (replace `topbarLabel`, `sessions.js:93-100`):

```js
  const topbar = {
    bar: document.getElementById("session-bar"),
    trigger: document.getElementById("session-switch"),
    name: document.getElementById("topbar-session-name"),
    menu: document.getElementById("session-menu"),
    list: document.getElementById("session-menu-list"),
  };
  // The popover is moved to <body>, the workspace menu's pattern: it is
  // positioned fixed and must not ride inside the bar's hidden subtree
  // (workspaces.js:117-122).
  if (topbar.menu && topbar.menu.parentNode !== document.body) {
    document.body.appendChild(topbar.menu);
  }
```

The existing early return (`sessions.js:73`) stays: a cached shell without
`#sessions-view` gets no view and no picker, and `#session-bar` stays hidden.
Every topbar use is guarded the same way.

**Constants** (named, no literals in the logic): `POP_GAP = 6`, `POP_MARGIN = 8`,
`ROW_SELECTOR = ".session-item"`, `ACTION_NEW = "new"`, `NEW_LABEL = "New session…"`,
`CHECK = "✓"`, `PLUS = "+"`. The session and name limits are already
`MAX_SESSIONS` / `NAME_MAX` from `NB.tabs.limits` (`sessions.js:35-37`).

**Render the trigger** (`renderTopbar()`, called from `refresh()` before the
signature guard, replacing `renderTopbarLabel`, `sessions.js:204-216`):

- active row from `sessions`, found by `activeId`;
- `name.textContent = active.name` only when it differs;
- `trigger.title = "Session: " + active.name` only when it differs;
- `bar.hidden = false`;
- no active session: `bar.hidden = true` and `closeMenu(false)`.

**Rows** (`renderMenu()`), in `getSessionList()` order:

- `<button type="button" class="session-item" role="menuitem" tabindex="-1"
  data-session-id="{id}">`;
- `.session-check` (`aria-hidden`), `✓` when active, empty otherwise;
- `.session-item-name` — the name; `title="{name}"`, so a name that
  truncates inside the 300 px popover is still readable;
- dirty: `.session-item-dot` (`aria-hidden`) plus a `.sr-only`
  `", unsaved changes"`, the panel row's exact pattern (`sessions.js:291-300`);
- `.session-item-count` — the unpinned count plus a `.sr-only` `" tab"` / `" tabs"`;
- `aria-current="true"` on the active row (the panel's marker, `sessions.js:283`);
- click → `pick(id)`.

**The New row**: after the last session, when `isWritable()` and
`sessions.length < MAX_SESSIONS`, append a `<hr class="session-menu-sep"
role="separator">` then a row with `data-action="new"`, `+` in the check column,
and `New session…`. Click → `closeMenu(true)` then `openCreate(topbar.trigger)`.
A viewer and the 20-session cap get neither the row nor the separator.

**Open / close** — the workspace picker's mechanics minus the rail mount, the
async refresh and the busy state (`workspaces.js:398-456, 986-1064`):

- trigger click toggles;
- `ArrowDown` / `ArrowUp` on the trigger open and focus the first / last row;
- a trigger click opens on the active row; the menu scrolls it into view;
- `Escape` closes and returns focus to the trigger;
- `ArrowUp` / `ArrowDown` / `Home` / `End` move the roving tabindex; `Enter` /
  `Space` pick through the native button;
- an outside click, a deferred focusout when focus leaves both the popover and
  the trigger, and a scroll behind the popover close it without moving focus;
- a resize re-places the popover; if the trigger is no longer visible
  (`getClientRects().length === 0` — the phone query or a hidden top bar), the
  popover closes instead of anchoring to a hidden button;
- opening calls `NB.menu.close()` first, so the row context menu never stacks;
- `placeMenu()` measures the trigger, sets `left` / `top` 6 px below, flips above
  when the bottom would overflow, and clamps to an 8 px viewport margin. One
  mount, so no rail branch.

**Re-render while open**: `refresh()` keeps its current signature guard. When the
menu is open and the signature (id / name / count / dirty / active) changed,
`renderMenu()` rebuilds the rows, restores focus by session id (or `ACTION_NEW`)
and scrolls the kept row back into view, so a pending activation can change a
count under the user's hands without dropping the keyboard to `<body>` or the
list to the top.

**Pick**:

```js
  function pick(id) {
    closeMenu(true);                 // focus returns to the trigger
    settle(NB.tabs.swapTo(id));      // a refused commit changes nothing
  }
```

The `tabs:changed` that a successful swap emits repaints the trigger and the
menu's check through the same `refresh()`. A refused swap returns `false` and
emits no `tabs:changed` (`tabs.js:760-789`), so the name stays truthful; the menu
is closed and no message is shown. The Sessions panel behaves the same way
(`sessions.js:369-375`), and the save prompt or the editor already explains the
refusal.

**Create**: `openCreate` (`sessions.js:377-380`) takes one optional argument:

```js
  function openCreate(openerEl) {
    if (!isWritable() || sessions.length >= MAX_SESSIONS) return;
    openDialog(MODE_CREATE, null, { opener: openerEl || addBtn });
  }
```

The panel's `+` still calls `openCreate()`; the picker passes the trigger, so the
dialog's `fallbackFocus` returns the keyboard to the chip rather than the hidden
panel button (`sessions.js:532-535`).

---

## 3. Tokens

No new token. Reused, unchanged from `style.css:4-87`:

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-panel` | `#22232a` | `#f6f7f9` | the bar behind the trigger |
| `--bg-elev` | `#2a2b34` | `#eceef2` | the trigger face and the popover |
| `--fg` | `#e6e6ea` | `#1f2330` | the trigger name; inactive row names |
| `--fg-muted` | `#8b8d98` | `#5d6470` | the glyph, the caret |
| `--border` | `#383a45` | `#d8dde4` | the divider, the popover edge, the separator |
| `--accent` | `#7c9cff` | `#2f5fd0` | the expanded edge, the focus ring, the check, the active text and count |
| `--accent-soft` | `rgba(124,156,255,.18)` | `rgba(47,95,208,.12)` | hover, expanded face |
| `--ws-fg-muted` | `#9799a4` | `#5d6470` | the inactive row count |

Contrast, measured on the pairs the picker actually paints:

| Pair | Dark | Light | Verdict |
|---|---|---|---|
| `--fg` on `--bg-elev` — trigger name | 11.30 | 13.48 | passes 4.5:1 |
| `--fg-muted` on `--bg-panel` — glyph | 4.74 | 5.56 | decorative and `aria-hidden`; above 3:1 |
| `--fg-muted` on `--bg-elev` — caret | 4.26 | 5.13 | non-text shape; above 3:1 |
| `--fg` on `--bg-elev` — inactive row | 11.30 | 13.48 | passes 4.5:1 |
| `--ws-fg-muted` on `--bg-elev` — inactive count | 4.96 | 5.13 | passes 4.5:1 |
| `--accent` on `--bg-elev` — active row, check, count | 5.39 | 4.93 | passes 4.5:1 |

The hierarchy is now **two controls**, not a control and its context. The
workspace name and the session name share the same size, weight and colour; the
divider is the only thing that says the session lives inside the workspace. The
old one-step-quieter treatment is gone because the element's job changed.

The active row uses colour, weight and a check — three cues and no tinted face.
Tinting would paint a face that cannot hover, which reads as pressed. Its count
takes `--accent` because there is no tint under it; the panel's count takes
`--fg` only because its active row is tinted.

---

## 4. States

| Case | What the trigger and the popover show |
|---|---|
| first paint | `#session-bar` is `hidden`; the model is empty at module load, so the first `refresh()` hides it. It fills on the first `tabs:changed`, the same emit that paints the restored strip |
| open | the trigger takes `aria-expanded="true"`, the caret rotates, the rows are rebuilt; the active row gets the roving tabindex and is scrolled into view |
| switch session | the new name in the trigger, the check on the new row, in the same `tabs:changed` render that repaints the panel |
| rename the active session | the new name, without a reload |
| rename an inactive session | unchanged |
| create a session | the new name (creating makes it active), the check moves; the dialog returns focus to the trigger |
| delete the active session | the neighbour the app switched to |
| delete an inactive session | unchanged |
| 40-character name | ellipsised at the 240 px cap; `title="Session: {full name}"` |
| zero tabs | the name and a `0` count; the count is not the trigger's business |
| unsaved edits | the row carries the 8 px dot plus `, unsaved changes`; the trigger carries no dot |
| viewer | the same picker; no `New session…` row and no separator; switching is allowed |
| 20 sessions | the list scrolls inside 420 px; the New row and its separator are absent |
| one session | one checked row, then the New row |
| no active session | `#session-bar` is hidden; no empty trigger and no stray divider |
| top bar hidden | gone with the bar; the `🗂` rail icon still opens Sessions, which switches with the same model |
| phone / coarse pointer | `display:none` with the Sessions view; the phone's `#mobile-title` names the note |
| no workspace chip | the bar is not rendered at all (it lives inside `ws_interactive`) |
| missing model (`NB.tabs` absent) | hidden; the trigger never shows an empty name |
| a refused swap | the menu closes, the name does not change, no message is shown; the save prompt or the editor already explains it |
| resize with the trigger invisible | the popover closes; it is never re-anchored to a hidden button |

There is no loading, error or busy state: the trigger reads client state that is
already in memory, and the menu has nothing to fetch.

---

## 5. Keyboard and ARIA

- **Trigger.** A `<button>` with `aria-haspopup="menu"`, `aria-expanded` and
  `aria-controls="session-menu"`. Its accessible name is `Session: {name}` — the
  `.sr-only` prefix, then the name. The glyph and the caret are `aria-hidden`, so
  the caret never becomes part of the name. The `title` is the full
  `Session: {name}`, which is what an ellipsised 40-character name needs.
- **Menu.** `role="menu"`, `aria-labelledby="session-switch"`. Every row is a
  `<button role="menuitem">`. The active row carries `aria-current="true"`; it is
  a switch, not navigation, so it is not `"page"`.
- **Roving tabindex.** One row has `tabIndex = 0`, the rest `-1`; focusin moves
  it. The roving row is the menu's Tab stop, and a later Tab starts from the row
  the user left.
- **Keys.** On the trigger, `Enter` / `Space` open it and `ArrowDown` /
  `ArrowUp` open on the first / last row. Inside, `ArrowDown` / `ArrowUp` /
  `Home` / `End` walk the rows and `Enter` / `Space` pick the focused row;
  `Escape` closes and returns focus to the trigger; `Tab` leaves and the deferred
  focusout closes without stealing focus back.
- **No focus trap.** The menu is not modal. Clicking outside closes it; the click
  lands where it landed.
- **One popover at a time.** Opening calls `NB.menu.close()`, and the workspace
  picker's document-level close handler closes that menu when the click lands on
  this trigger. The reverse is true for the workspace picker.
- **Row text.** The check, the dot and the caret are `aria-hidden`; the dirty
  state and the tab unit are `.sr-only`, so a row reads
  `Deep work, 2 tabs` and `Reading, unsaved changes, 4 tabs`.
- **No live region.** A switch is confirmed by the trigger name and the checked
  row; announcing it again would be a second confirmation for one action.

---

## 6. Responsive

| Width / state | Behaviour |
|---|---|
| desktop ≥ 861 px | the trigger caps at 240 px and never wraps. A long brand, workspace and session share the shortfall; the two names ellipsise and `#brand` hard-clips (its `inline-flex` box cannot `text-overflow` — a shipped quirk this feature does not change). Nothing overflows |
| the same bar, menu open | 300 px popover, 6 px below the trigger's left edge; flips above on overflow and clamps 8 px from the edges |
| 20 sessions | `max-height: min(70vh, 420px)`, the list scrolls; the trigger and the bar do not move |
| ≤ 860 px, or coarse pointer ≤ 1023 px | `#session-bar` is `display:none`; the phone shell has no sessions. An open popover closes as soon as the trigger stops rendering |
| top bar hidden | not rendered with the bar. The rail's `🗂` opens the Sessions view, which is the second door to the same list |
| narrow desktop at 861 px with the menu open | the popover still fits at 300 px; only the names shorten |

The Hide top bar toggle is reached through Settings, whose click closes the
popover before the bar goes; the width crossing is covered by the resize guard.
There is no session mount on the rail. The workspace has one because switching
workspaces would otherwise be unreachable with the bar hidden; the session list
is reachable through the Sessions view, so nothing becomes unreachable when the
picker goes with the bar.

---

## 7. Copy

| Slot | String |
|---|---|
| accessible name | `Session: {name}` |
| `title` | `Session: {name}` |
| row `title` | `{name}` |
| New row | `New session…` |
| empty | none — the element is hidden |
| dirty row | `, unsaved changes` (`.sr-only`) |
| count | `{n} tab` / `{n} tabs`, the unit `.sr-only` |
| separator | none |

No other user-facing sentence, unit or count.

---

## 8. Acceptance criteria

Paint claims are checked in a real browser, not in jsdom: the harness loads
`style.css` as text and applies no cascade.

| # | Criterion |
|---|---|
| AC1 | With the shell loaded and a session, `#session-bar` is visible; `#session-switch` reads `Session: {active name}` and its `title` is the full string. |
| AC2 | The **served** shell contains `#session-switch` as a `button` with `aria-haspopup="menu"`, `aria-expanded="false"` and `aria-controls="session-menu"`, an empty `#topbar-session-name`, and a hidden `#session-menu`; it renders after `#workspace-bar`, before the spacer, inside the workspace block — and not at all for an unauthenticated visitor while auth is on. |
| AC3 | Clicking the trigger opens the menu with one row per session in creation order; the active row has `aria-current="true"` and a `✓`; counts and the dirty dot match the Sessions panel. |
| AC4 | Picking a row switches the session; the trigger name and the check update without a reload; focus returns to the trigger. |
| AC5 | `Escape` closes the menu and returns focus to the trigger. |
| AC6 | A click outside and a scroll behind the popover close it without moving focus. |
| AC7 | Renaming the active session updates the trigger and the row; renaming an inactive one leaves them unchanged. |
| AC8 | Deleting the active session names the neighbour the app switched to; deleting an inactive one changes only the rows. |
| AC9 | A 40-character name ellipsises at the 240 px cap; the trigger's `title` carries the full string. |
| AC10 | A viewer can open and pick; the menu has no `New session…` row and no separator. |
| AC11 | At 20 sessions the menu has no New row, the list scrolls inside 420 px, and the active row stays visible. |
| AC12 | `New session…` closes the menu, opens `#session-dialog` with focus in the name field, and the trigger is its fallback focus. |
| AC13 | With `hideTopbar` on, no trigger is visible. Under the phone query the trigger is not visible and the Sessions view stays hidden. |
| AC14 | The trigger's accessible name is `Session: {name}`, the menu is labelled by the trigger, the check/caret/dot are `aria-hidden`, and one row has `tabIndex = 0`. |
| AC15 | An open menu closes when the trigger stops rendering (window narrowed under 861 px, or the top bar hidden); opening this picker closes an open workspace picker; opening it closes `NB.menu`. |
| AC16 | Dark and light both render the trigger name, the inactive count and the active row at ≥ 4.5:1 against `--bg-elev`; the caret is ≥ 3:1. |
| AC17 | The bar never overflows: at 861 px the brand, the workspace name and the session name clip or ellipsise, and the actions keep their width. |

---

## 9. Verification

| Check | Where |
|---|---|
| AC2 | `tests/test_app.py`: rename `test_index_renders_the_session_label_hidden_after_the_chip` (`test_app.py:112`) to `test_index_renders_the_session_picker_hidden_after_the_chip` and assert the button, `aria-haspopup`, `aria-controls`, the empty name span, the hidden menu, and the chip < bar < spacer order. Keep `test_index_paints_defaults_until_authenticated` (`test_app.py:230`) and its `assertNotIn('id="session-bar"', anon_html)`. |
| AC1, AC3–AC8, AC11, AC14 | `tests/dom/test_dom.js`: update the harness shell (`test_dom.js:191-199`), the `tbChip` selectors and the "no tab stop" check (`test_dom.js:40935-40994`), which this feature inverts. Then drive `swapTo`, `renameSession`, `deleteSession`, `openCreate` and the keyboard paths, and read the trigger, the rows and `document.activeElement`. |
| AC9 | the same block keeps the whole text and `title`; the browser suite proves the ellipsis (`scrollWidth > clientWidth`). |
| AC10, AC12, AC15 | the browser suite (`tests/browser/test_core_ui_browser.js:1739+`): a viewer run, the New row → dialog focus, the narrow-viewport close, and one-popover-at-a-time. The DOM harness has no workspace chip, so it cannot prove the cross-picker case. |
| AC13 | the browser suite and `tests/browser/test_mobile_browser.js`: hide the bar, then assert the trigger is not visible; the phone viewport has no session UI. |
| AC16 | the browser suite: computed colours in both themes, checked against the table in §3. |
| AC17 | the browser suite: at 861 px, `#topbar` `scrollWidth <= clientWidth`, and every left-hand name is clipped or ellipsised. |

**Release step.** `static/sw.js` precaches `/`, `style.css` and `sessions.js`
(`sw.js:44-79`). Bump `CACHE` (`sw.js:38`, currently `notebook-v24`) to the next
version with a one-line history comment, or an installed worker keeps the old
shell and never gets the picker. Verify with `node --check static/sw.js` and one
offline reload after the worker activates.

No backend endpoint, config key or boot value changes.

---

## 10. What this does not do

- It does not change the session model, its limits, its order, its storage or
  its normalisation.
- It does not add rename or delete to the picker. Those stay in the Sessions
  view, with its confirm and its row menu.
- It does not add a session mount to the rail, and it does not change the
  workspace picker's mounts.
- It does not add a shared popover module or change `NB.menu`. The two pickers
  differ in mounts, row model, fetch and busy state; the shared part is small
  enough to copy, and the workspace picker is shipped and browser-tested. Extract
  at the third attached picker, not the second — record that here when it
  happens.
- It does not touch the tab strip, the Sessions panel, the tab menu or the
  dialogs beyond `openCreate`'s optional opener.
- It does not move the workspace chip, the brand, the spacer or the actions.
- It does not render the name server-side, and it does not add a session to the
  phone shell.
