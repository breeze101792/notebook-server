# Secondary sidebar — two rails, two panels, outline as a view

Status: Current spec — pre-implementation. This supersedes the single-rail model in
[`shell-frame.md`](shell-frame.md) §1, §3, §5, the outline rows of §7.1-§7.2 and the
outline/toggle parts of §9.2-§9.3, and the outline-toggle contract in [`tab-bar.md`](tab-bar.md)
§1.2 and §8.

Mockup: [`secondary-sidebar-mockup.html`](secondary-sidebar-mockup.html) — the ten boards listed
in §14. Illustrative; this document is normative.

**Normative source.** This document owns: the five-column grid, the second activity rail, the
auxiliary panel frame, the per-view side model, the Outline as a side-panel view, and the
phone rule for a view homed right. It reads [`foundations.md`](foundations.md) for every token,
[`typography.md`](typography.md) for every type role, [`controls.md`](controls.md) for control
anatomy and ARIA, and [`guidelines.md`](guidelines.md) for the document rules. It does not design
the inside of any view; [`side-panel-views.md`](side-panel-views.md), [`sessions.md`](sessions.md),
[`tabs-view.md`](tabs-view.md), [`search-view.md`](search-view.md), [`ai-panel.md`](ai-panel.md)
and [`outline`](#5-the-outline-view) below own their contents. Config keys are registered in
[`../contracts/configuration.md`](../contracts/configuration.md).

**Prerequisite.** None. The new rail reuses `--activity-bar-width` and the existing rail button
face; no token is added.

Abbreviations: `style.css` = `static/css/style.css`; `activity.js` = `static/js/activity.js`;
`app.js` = `static/js/app.js`; `settings.js` = `static/js/settings.js`; `outline.js` =
`static/js/outline.js`; `index.html` = `templates/index.html`.

---

## 1. The decision

The left activity rail and its panel are duplicated on the right, with independent state, and a
view can be assigned to either side. The Outline stops being a fixed pane and becomes a registered
view, homed right by default.

| Was | Is |
|---|---|
| One rail (`#activity-bar`) with eight view icons plus four action buttons | Two rails. The left keeps the actions; the right carries view icons only |
| One panel (`#side-panel`) hosting the active view, plus a fixed `#outline-pane` | Two panels (`#side-panel`, `#aux-panel`), each hosting its own active view. Both may be open |
| Outline is a pane, not a view; toggled from the tab bar and a rail twin | Outline is a normal `.side-panel-view[data-view="outline"]`; its rail icon is its only toggle |
| A view's side is fixed at build time | `sidebarSide` assigns it; changed live in Settings → Appearance |
| Phone: eight views in a drawer, no outline | Phone: sides ignored, all views in the drawer, outline has no phone surface |

The requirement, as stated by the user: *the same left sidebar on the right side; choose which icon
goes right or left; the outline is part of the right sidebar.* The rest of this document is the
consequence of those three sentences, not new scope. The side is chosen in Settings (§8); no
drag-between-rails gesture is offered, and §13 records that as a proposal, not a gap.

---

## 2. The model

### 2.1 Sides

A **side** is `"left"` or `"right"`. Each side owns exactly one rail and one panel:

| Side | Rail | Panel | Rail holds | Width token | Collapse key |
|---|---|---|---|---|---|
| Left | `#activity-bar` | `#side-panel` | view icons + workspace, graph, log out, settings, More (phone) | `--side-panel-width` | `sidebarCollapsed` |
| Right | `#activity-bar-right` | `#aux-panel` | view icons only | `--aux-panel-width` | `auxPanelCollapsed` |

No control exists twice in the document. The left rail's action buttons are not mirrored: the
settings button, the workspace mount, the graph button and the log-out button all resolve through
`document.getElementById` and a duplicate would silently bind the second copy to a dead handler
(`app.js:1306`, `graph.js:178`, `auth.js:27`, `workspaces.js:22`).

### 2.2 View home

Every registered view has a **home side**. The home is resolved in this order:

1. the saved `sidebarSide[viewId]`, when present and valid;
2. the `side` passed to `NB.activity.register({ side })`, when present;
3. `"left"`.

Only the Outline registers with a default of `"right"` (`activity.js:1581` becomes
`register({ id: "outline", side: "right", … })`). Every other built-in view keeps the default.

The saved map wins over the registration default, so a view that a later release registers
right-homed still boots left for a user who moved it left. A view the map does not name uses the
registration default — that is why the store is a map and not a list: a list cannot distinguish
"the user put it left" from "this view did not exist when the list was written".

### 2.3 State per side

Each side owns four pieces of state, and no piece is shared:

| State | Left | Right |
|---|---|---|
| Active view id | `activeId.left` | `activeId.right` |
| Mounted view set | `mounted.left` | `mounted.right` |
| Collapsed flag | `.collapsed` on `#side-panel` | `.collapsed` on `#aux-panel` |
| Panel width | `--side-panel-width` | `--aux-panel-width` |

A side with no visible view is **empty**: its panel paints nothing and its rail is hidden (right)
or action-only (left — the left rail never disappears because Settings lives there).

### 2.4 One host per view, moved not rebuilt

Exactly one DOM element carries `data-view="<id>"` in the whole document. It is a child of the
panel its side names, or of `#side-panel` while the shell is in phone mode (§9.3).

Changing a view's side **moves the existing node** with `appendChild`. It never re-creates it:
`sidebar.js`, `bookmarks.js`, `sessions.js`, `tabs-view.js` and `outline.js` hold element
references captured at load (`sidebar.js:10`, `outline.js:8-9`), and those references must stay
valid. Moving a node keeps its state (open folders, filter text, scroll position is lost — accepted,
see §13).

---

## 3. Grid and geometry

### 3.1 Anatomy

```
#app  (100dvh, flex column)
├── #topbar                        46 px
└── #layout  (grid, minmax(0,1fr) row)
    ├── #activity-bar              48 px   left rail, never resizes
    ├── #side-panel                 240 px  left panel, resizable on its right edge
    │   ├── .panel-header          34 px
    │   └── .side-panel-view       flex    the active left view
    ├── #editor-pane               1fr     absorbs every change, min 0
    │   ├── #tab-bar               34 px   no outline toggle (§7)
    │   ├── #edit-bar              content-driven
    │   └── reader                 1fr
    ├── #aux-panel                  240 px  right panel, resizable on its left edge
    │   ├── .panel-header          34 px
    │   └── .side-panel-view       flex    the active right view (Outline by default)
    └── #activity-bar-right        48 px   right rail, view icons only
```

### 3.2 Column contract

| Column | Token | Default | Minimum | Maximum | Resizes? | Saved key |
|---|---|---|---|---|---|---|
| Left rail | `--activity-bar-width` | 48 | 48 | 48 | no | — |
| Left panel | `--side-panel-width` | 240 | `--shell-pane-min` 140 | `min(--side-panel-max 480, 45 % of the budget)` | pointer, keyboard | `sidebarWidth` |
| Editor | — | 1fr | `--shell-reader-min` 352 | — | absorbs every change | — |
| Right panel | `--aux-panel-width` | 240 | `--shell-pane-min` 140 | `min(--aux-panel-max 480, 45 % of the budget)` | pointer, keyboard | `auxPanelWidth` |
| Right rail | `--activity-bar-width` | 48 | 48 | 48 | no | — |
| Topbar | `--topbar-h` | 46 | 0 | 46 | no | `hideTopbar` |

### 3.3 The pane budget

The reader keeps 352 px on desktop; below that the phone shell takes over. Both panels now spend
one budget, and the budget subtracts both rails:

```
--shell-pane-budget = 100vw − 2 × var(--activity-bar-width) − var(--shell-reader-min)
panel cap           = min(--side-panel-max 480, 45 % of the budget)
aux cap             = min(--aux-panel-max 480, 45 % of the budget)
```

The 45 % share — not 60 % — is what makes "both panels open" fit. At 1280 the budget is 832, each
cap 374, so two panels dragged to their caps leave 435 px of reader (and the 240 px defaults
leave 704). At 861 the budget is 413, each cap 185: two panels at the cap leave 395 of reader,
and two 140 px floors leave 485. At 1600 both caps are 480 and the reader keeps 544. No state
spends the reader's floor; the 861 case is the tightest and still keeps 43 px of headroom.

The current formula subtracts one rail and gives the left panel 60 % (`style.css:404-410`); it must
be replaced, not extended.

### 3.4 State matrix

| State | Left rail | Left panel | Right panel | Right rail | Editor |
|---|---|---|---|---|---|
| Both open | 48 | 240 or dragged | 240 or dragged | 48 | rest |
| Left collapsed | 48 | **0**, children hidden | unchanged | 48 | wider |
| Right collapsed | 48 | unchanged | **0**, children hidden | 48 | wider |
| Both collapsed | 48 | 0 | 0 | 48 | full width |
| No views homed right | 48 | unchanged | **0** | **0**, hidden | wider by 48 |
| No view on a side | 48 | header + empty line, or 0 | same | same | unchanged |
| Phone | bottom bar 56 | drawer, 0 when closed | **removed** | **removed** | single column |
| Auth locked | blurred | blurred | blurred | blurred | blurred |

---

## 4. The right rail

### 4.1 Anatomy

`#activity-bar-right` is a `<nav aria-label="Right activity bar">` with the same box as `#activity-bar`: 48 px, `--surface-panel`,
a 1 px `--border` on its **left** edge, 8 px vertical padding, 2 px gap, `align-items: center`,
`overflow: hidden`. Its content is one `.activity-bar-views` container. No spacer is needed — the
rail holds no bottom-pinned actions — but the spacer element is kept so the markup and the CSS
stay symmetric (`.activity-bar-spacer` is `flex: 1 1 auto` and has no visual effect alone). The
panel it controls is `<aside id="aux-panel" aria-label="Right side panel">`.

### 4.2 Icon buttons

Identical to the left rail: 36 × 36, radius 6, `--text-muted`, hover `--accent-soft` + `--text`,
`aria-pressed` on the active icon. Two mirrored values:

| Property | Left rail (`style.css:459-468`) | Right rail |
|---|---|---|
| Active indicator | `left: -6px`, 2 px wide, `--accent` | `right: -6px`, 2 px wide, `--accent` |
| Tooltip side | browser default | browser default |

A right-rail icon is the only toggle for a right-homed view. Clicking the active icon collapses
`#aux-panel`; clicking any other icon activates that view and expands the panel if collapsed
(§7.1).

### 4.3 Order, hidden views, empty state

- Order: the saved `sidebarOrder`, filtered to the views homed on this side. One global order key
  covers both rails; a rail shows the subsequence it owns.
- Hidden views (`sidebarHidden`) take no icon on either rail and keep their home side. A hidden
  view's row in Settings still shows its side.
- Empty right side: when no *visible* view is homed right, `#activity-bar-right` and `#aux-panel`
  take 0 px. Implemented as `#layout[data-right-empty="true"] { --shell-aux-track: 0px;
  --aux-rail-track: 0px }` (a data attribute on `#layout`, written by `activity.js`, is cheaper and
  clearer than a `:has()` chain). The attribute is **derived**, recomputed from the visible-view
  set on every `register()`, `setSide()`, `setHidden()` and `applyLayout()`, and never toggled in
  isolation: a stale `true` would hide a view that was just moved or unhidden. The left rail never
  takes this state.

### 4.4 Phone

The right rail is `display: none` under the mode switch (`style.css:8316`), like `#outline-pane`
is today (`:8429-8431`). It never appears in the bottom bar, the More sheet, or the drawer.

---

## 5. The outline view

### 5.1 Identity

```
<div id="outline-view" class="side-panel-view" data-view="outline" [hidden]>
  <div class="panel-header">
    <span class="panel-title">Outline</span>
    <button class="collapse-btn" data-collapse-view="outline"
            title="Collapse outline" aria-label="Collapse outline">
      <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-chevron-right"/></svg>
    </button>
  </div>
  <div id="outline" class="outline"></div>
</div>
```

- Icon: `nb-icon-outline` (`index.html:185`), unchanged.
- Label: `"Outline"`. Rail tooltip and `aria-label`: `"Outline"`.
- Registration: `register({ id: "outline", icon: "nb-icon-outline", label: "Outline", side: "right",
  mount: function () {} })`. The host ships populated by the template, so mount is a no-op — the
  Explorer pattern (`activity.js:1526-1531`).
- `outline.js` is unchanged. It resolves `#outline` once (`outline.js:9`); the node survives a side
  change because §2.4 moves rather than rebuilds. `build()`, the scroll spy and the VIM cursor all
  keep working when the host is hidden, which is what the collapsed pane already does.

### 5.2 What the pane had that the view does not

| Pane behaviour | Now |
|---|---|
| `#outline-collapse` in its own header | Same button, `data-collapse-view="outline"`, collapses `#aux-panel` |
| `#outline-toggle` in the tab bar | **Removed.** The right-rail icon is the only toggle |
| `#outline-rail-btn` on the left rail, shown while the tab strip is hidden | **Removed** |
| `.collapsed` on `#outline-pane` | `.collapsed` on `#aux-panel` |
| Outline-only resize handle capped at 520 | Panel handle capped at `--aux-panel-max` 480 (§3.2) |

Removing both toggles is the user's decision: the outline lives in the right sidebar, so its rail
icon is its control. The tab strip gains the control's width plus the 8 px gap it used to reserve
(`tab-bar.md` §1.2 is amended accordingly).

### 5.3 Visibility, not existence

The outline is now hidden or shown like any view: `[hidden]` when another right-side view is
active, `.collapsed` on the panel when the panel is closed. Both are ordinary view states; no code
reads "is the outline open" any more. The VIM window targets `#outline-view` (§10.4) and the
scroll spy keeps its current permissive behaviour of writing to a hidden list.

---

## 6. Config

### 6.1 New and changed keys

| Key | Type | Default | Written when | Read at |
|---|---|---|---|---|
| `sidebarSide` | object `{viewId: "left" \| "right"}` | `{}` (every view takes its registration default) | Settings row control | server boot map; `activity.js` `setSide` |
| `activeViewLeft` | string \| null | `"explorer"` | every activation on the left | server render; `activity.js` adopts it |
| `activeViewRight` | string \| null | `"outline"` | every activation on the right | same |
| `auxPanelWidth` | number (px) | 240 | aux drag end | boot inline `--aux-panel-width`; `app.js` |
| `auxPanelCollapsed` | bool | false | aux collapse/expand | same |
| `activeView` | string | `"explorer"` | **legacy, read once** as the left fallback | server + `app.js` boot |
| `outlineWidth` | number | — | **legacy, read once** for `auxPanelWidth` | server + `app.js` boot |
| `outlineCollapsed` | bool | — | **legacy, read once** for `auxPanelCollapsed` | server + `app.js` boot |

`sidebarOrder` keeps its meaning: one global order over both rails.

**The one default-side table.** The registration default lives in one place per language and the
two are tested against each other:

| Where | Shape |
|---|---|
| `activity.js` | `register({ id, side })`; `side` defaults `"left"`, only the Outline passes `"right"` |
| `app.py` | `_VIEW_SIDES = {"outline": "right"}` beside `_ACTIVE_VIEWS`; every other id defaults `"left"` |
| Test | `tests/test_app.py` parses the `side:` values out of `activity.js` and asserts they equal `_VIEW_SIDES`, the way it already parses `_ACTIVE_VIEWS` from `app.py` |

A view registered with `side: "right"` but absent from `_VIEW_SIDES` is a test failure, not a
silent first-paint mismatch.

### 6.2 Validation (server is authoritative)

`app.py` gains `"outline"` in `_ACTIVE_VIEWS` (`app.py:1408`) and validates:

| Field | Rule |
|---|---|
| `sidebarSide` | must be a JSON object; keys not in `_ACTIVE_VIEWS` are dropped; values other than `"left"`/`"right"` are dropped; the result is emitted as `sidebar_side` |
| `activeViewLeft` | must be a view id homed left and not hidden; otherwise **the first visible left view in rail order**, otherwise `null` |
| `activeViewRight` | the same against the views homed right |
| `auxPanelWidth` | clamped to `[_MIN_PANE_WIDTH, _MAX_PANE_WIDTH]` like `sidebarWidth` (`app.py:1555-1562`) |
| `auxPanelCollapsed` | coerced to bool; `outlineCollapsed` is the fallback when the key is absent |

A hidden view cannot be a side's active view: the panel would paint a view whose icon is absent.
That is the existing `activeView` rule (`app.py:1590-1597`) applied once per side.

"Rail order" is `_ordered_views(cfg)`: `sidebarOrder` first, unknown and missing ids after it in
`_ACTIVE_VIEWS` order — the same rule `activity.js` `orderedViews()` applies (`activity.js:120-131`).
The current server fallback walks `_ACTIVE_VIEWS` alone (`app.py:1594-1597`); it must walk the
ordered list, or the first paint and the client disagree whenever a saved order exists.

### 6.3 Migration

- `activeView` → `activeViewLeft` when `activeViewLeft` is absent. The right side takes
  `"outline"`.
- `outlineWidth` → `auxPanelWidth`; `outlineCollapsed` → `auxPanelCollapsed`. The fallback runs in
  **both** places that read geometry — `boot_state()` for the first paint and `applyConfig()` on
  the client — so there is no frame where the server paints one width and the client applies
  another.
- **The legacy keys must leave `DEFAULTS` in the same change.** Today `app.js:83, :92, :94` lists
  `activeView`, `outlineWidth` and `outlineCollapsed`, `applyConfig` rebuilds `cfg` from
  `{...DEFAULTS, ...c}` (`app.js:537`), boot rewrites `cfg.activeView` (`app.js:1566`), the
  activation listener rewrites it again (`app.js:1255-1258`), and the failed-fetch path re-seeds
  `cfg.outlineWidth` (`app.js:1530`). While any one of those stays, every save re-posts the old
  keys and §11 AC11 cannot pass. The required edits are: remove the three from `DEFAULTS`, replace
  the `cfg.activeView` writers with `activeViewLeft`, and write `auxPanelWidth` in `endDrag`.
- With `DEFAULTS` clean, `applyConfig` migrates once (`cfg.auxPanelWidth = c.auxPanelWidth ??
  c.outlineWidth ?? 240`, same for the flag and the left active view), then deletes `outlineWidth`,
  `outlineCollapsed` and `activeView` from the loaded object, and the next whole-blob POST drops
  them from the file. The fallback stays for one release, then is removed. A phone write is a keyed
  read-merge-write (`app.js:1074-1085`) and cannot retire the keys; only a desktop save does.
- **Accepted one-time hazard:** a tab still running the previous scripts posts a `cfg` that has
  none of the new keys and, on the whole-blob path, drops them. It lasts until that tab reloads;
  the asset version bump reloads it on the next navigation. Named so nobody debugs it as a config
  regression.
- No `config.json` in this repo carries `sidebarSide` or the new keys today; `config/config.json`
  carries `outlineCollapsed`, `outlineWidth`, `activeView`, `sidebarOrder`, `sidebarHidden`.

### 6.4 First paint

`boot_state()` returns `sidebar_side`, `active_view_left`, `active_view_right`,
`aux_panel_width`, `aux_panel_collapsed` in addition to the existing chrome. The template writes:

- `--side-panel-width`, `--aux-panel-width` inline on `<html>` (`index.html:2`);
- `data-sidebar-side="{{ boot.sidebar_side | tojson | forceescape }}"` on `#layout` — the
  `forceescape` is load-bearing, exactly as it is for `data-workspaces` (`templates/index.html:369-370`):
  a bare `tojson` emits `"`, which closes the attribute and leaves `activity.js`'s `JSON.parse`
  throwing inside the first `register()`, which aborts every later registration and leaves both
  rails empty;
- `data-sidebar-order` and `data-sidebar-hidden` on each rail (same values; the client filters);
- `hidden` on every view host except each side's active view.

`activity.js` reads the side map at module load, before `register()` runs, so a view's first icon
lands on the right rail without waiting for `GET /api/config`.

---

## 7. Interactions

### 7.1 Activating a view

`activate(id, toggle)` resolves the view's home side and operates on that side only.

| Input | Result |
|---|---|
| Icon on the inactive view, panel open | that side's previous view hides, the new one shows; the other side is untouched |
| Icon on the inactive view, panel collapsed | the panel expands, the view shows |
| Icon on the active view, panel open | that side's panel collapses; the icon stays lit |
| Icon on the active view, panel collapsed | the panel expands |
| Activation that is not a user click (`toggle=false`) | never expands a collapsed panel — the existing boot rule (`activity.js:317-322`) |

`activity:changed` carries `{ id, side }`; `app.js` writes `activeViewLeft` or `activeViewRight`.

### 7.2 Collapsing and expanding

`collapse(side)` and `expand(side)`. A view's own header button collapses its host side.

The button must not capture its side when it is built. `bookmarks.js:78`, `sessions.js:191`,
`tabs-view.js:123` and `ai.js` build their headers at module load, not inside `mount(host)`, and
none of them re-renders on a side change — a captured side would leave an `‹` chevron and a
left-panel collapse in the right panel forever.

| Rule | Detail |
|---|---|
| Identity | Every header button carries `data-collapse-view="<id>"`: set by `makeCollapseBtn(id)`, and written directly in the static template for Explorer and the outline |
| Click | One delegated listener per panel (installed once by `activity.js`) reads the attribute and calls `collapse(sideOf(id))` — the side is resolved at click time |
| Glyph and title | `activity.js` refreshes every `[data-collapse-view]` glyph (`‹` left, `›` right) and its title (`Collapse files`, `Collapse outline`,…) on `register()`, `setSide()` and `applyLayout()`. `makeCollapseBtn(id)` draws the right glyph for the current side when it builds the button |
| Static headers | Explorer's chevron keeps its markup and gains the attribute; its `app.js` handler (`app.js:1231-1239`) is deleted with the rest of the per-id collapse code |
| Phone | `mobile.js:1046-1057` keeps rewriting every drawer button to `nb-icon-chevron-left`; the drawer has one panel, so that stays correct |

Events carry the side: `activity:collapsed {side}`, `activity:expanded {side}`. `app.js` writes
`sidebarCollapsed` or `auxPanelCollapsed` respectively.

### 7.3 Changing a view's side

In Settings → Appearance → Activity bar, each row has a `Left | Right` segmented control (§8).
Flipping it takes effect immediately:

1. the host node moves to the destination panel (`appendChild`, §2.4);
2. both rails re-render from the new map;
3. the destination panel's collapsed state is **not** changed;
4. the source side keeps its active view if it was not the moved one; if it was, the source side
   activates its first visible view, or becomes empty and collapses (§7.5);
5. the moved view is the destination side's active view if it was the source side's active view,
   and the destination side is expanded. Otherwise it stays in the background;
6. `sidebarSide` is persisted with an explicit key list;
7. every header chevron inside the moved host takes its new glyph and title (§7.2).

Focus and any popup inside the moved host are not preserved; a popup is closed. The view's own
data (filter text, scroll, selection) survives except the scroll offset.

### 7.4 Hiding a view

`sidebarHidden` is unchanged: a hidden view loses its icon on whichever rail it lives and keeps
its side and its order position. Consequence with two sides: hiding the last visible view on the
right empties the right side (rail and panel at 0), and does not touch the left. Hiding every view
on the left leaves the left rail with its action buttons and collapses the left panel — today's
behaviour, kept because Settings must remain reachable. Hiding the **Outline** is the one new
dead end: the right side empties, both its rail and panel take 0 px, and the only way back is
Settings → Unhide. There is no shortcut and no tab-bar control any more (§5.2).

### 7.5 An emptied side

`reconcileHiddenActive(side)` runs per side:

- active view hidden and another visible view exists on that side → activate the first visible one
  (in rail order);
- none left → `activeId[side] = null`, hide that side's hosts, collapse that side's panel; on the
  right, set `data-right-empty="true"` so the rail also takes 0.

### 7.6 Shortcuts

| Shortcut | Today | Now |
|---|---|---|
| `/` (Open search) | activates Search in the left panel, expands it (`activity.js:384-397`) | activates Search on its home side and expands that side |
| `Ctrl/Cmd+W` window cycle | sidebar → editor → outline (`vimnav.js:93-97`) | left panel → editor → right panel; the outline window is `#outline-view` |
| Settings → toggle outline | `#outline-toggle` | none; no keyboard shortcut is added |

### 7.7 What "active view" means to callers

`getActive(side)` returns that side's active id or `null`. `getActive()` with no argument returns
the **last activated** id on either side, which is what the phone drawer and the Settings
announcer need. A view is *visible* when its side's panel is not collapsed and that side's active
id is that view: `isViewVisible(id)`.

Callers that compared `getActive() === "search"` / `"recent"` for "is my panel on screen"
(`activity.js:624-628`, `:1352`, `:1506-1512`) switch to `isViewVisible(<id>)`. This is the only
behavioural correction: with two panels, "active" no longer means "on screen".

`panelVisible()` (`activity.js:1349-1362`) is exactly that comparison and is rewritten, not
renamed. `sidebar.js:1017-1040` (`revealFile`, "Show in file sidebar") calls
`activate("explorer", false)` and then `expand()`, whose argument becomes
`sideOf("explorer")`; with a stale no-argument `expand()` it would expand the wrong panel and
"Show in file sidebar" would stop revealing.

### 7.8 Boot

Boot is per side, and the client must not compare a raw config value against a validated paint.
The existing single-side path (`app.js:1478-1566`) does exactly that.

| Step | Rule |
|---|---|
| 1. Snapshot | `shellPanelState()` reads, per side: the panel's `--…-width`, its `.collapsed` class, and the host that is not `[hidden]`. It also reads `data-sidebar-side`, `data-sidebar-order`, `data-sidebar-hidden`. |
| 2. Adopt | `adoptShellView(side)` activates the side's visible host, or the first visible view on that side in rail order, or nothing. `shellViewId(side)` queries that side's panel only. |
| 3. Reconcile | On a successful `GET /api/config`, each side is resolved independently with the **same** rules as §6.2 — home matches the side, not hidden, else the first visible view in rail order, else `null` — and applied only if that side's `getActive(side)` still equals the shell-painted value (the user has not switched since). A raw id that fails validation is discarded, never passed to `activate()`. |
| 4. Persist | `cfg.activeViewLeft` / `activeViewRight` mirror the adopted values. Boot no longer writes `cfg.activeView` (§6.3). |
| 5. Failure | A failed fetch restores both sides from the snapshot, not `DEFAULTS`. |

`resolveBootView` becomes per side or takes the side as a parameter; `applySidebarState` and
`applyOutlineState` split into `applySidebarState` and `applyAuxState`. `activity:changed` writes
the matching per-side key.

---

## 8. Settings → Appearance → Activity bar

The group keeps one list, one grip, one `Hide` / `Unhide` button per row, and gains one control per
row: a two-option `Left | Right` segmented control (the `controls.md` chip face, 30 px,
`--surface-raised`, `--border-strong`, `--radius-pill`, selected option `--accent-soft` with
`--accent` text and `aria-pressed="true"`).

| Aspect | Rule |
|---|---|
| Rows | Nine, in `sidebarOrder`: Explorer, Sessions, Pinned folders, Bookmarks, Recent files, Search, Tabs, AI Assistant, Outline |
| Row anatomy | grip · icon · label · `Left \| Right` · `Hide` (row height 40, pitch 48 — `activity-bar-order.md` §2 with one added control) |
| Selection | reflects `sidebarSide[id]` or the registration default; never blank |
| Change | applies on click, persists immediately, no Apply |
| Keyboard | each option is a real `<button>` with `aria-pressed`; Tab reaches both; Space/Enter selects |
| Announcement | `"<label> moved to the left rail, position N of M"` / `"… right rail …"`, where N/M count that rail's visible rows in rail order. Replaces the current whole-list "position N of M" (`settings.js:604-616`), which no longer describes either rail |
| Hidden rows | show the side control; a hidden view keeps its side |
| Help text | `"Icons on the left rail and the right rail. The right rail appears only when a view is assigned to it."` |

The drag grip stays the only reorder path and now reorders the **global** `sidebarOrder`. Dropping
a row between two rows of different sides moves it in the global order only; its side is unchanged.
Dragging **between rails** is not a reorder gesture — it is not implemented (see §13).

---

## 9. Phone and tablet

The phone breakpoint is `max-width: 860px`, or a coarse pointer at `max-width: 1023px`
(`style.css:8316`). Sides are a desktop concept.

1. `#activity-bar-right` and `#aux-panel` are `display: none`.
2. `applyLayout("phone")` moves every view host, whatever its home, into `#side-panel`, so the
   drawer can show it. `applyLayout("desktop")` moves each host back to its side's panel. This runs
   at boot and on every `mobile:mode` change.
3. The move also reconciles the drawer: every host except the one `getActive()` names is set
   `hidden`, and `activeId` collapses to that single value. Without this step a live desktop→phone
   flip (rotation, a coarse pointer appearing) leaves the left active view and the right active
   view both visible in the drawer, stacked, until the user picks a view. `#mobile-drawer-status`
   is not a `.side-panel-view`; `applyLayout` re-appends it last after moving hosts
   (`mobile.js:1014-1030` appends it into `#side-panel`).
4. `#side-panel` keeps today's drawer behaviour unchanged (`style.css:8560-8589`): left-anchored,
   scrim, one visible host, `role="dialog"` while open.
5. `activate("outline")` is **refused on the phone**, not merely absent from the rail, so a saved
   right active view or a shortcut cannot open a host the phone has no surface for. Same rule as
   `PHONE_OFF_VIEWS` (`activity.js:47`), enforced in `activate()`.
6. `"outline"` joins `PHONE_OFF_VIEWS` (`activity.js:47`) and `PHONE_HIDDEN_VIEWS`
   (`app.js:37`): the outline has no phone surface, as today, and cannot steal a rail slot or open
   an empty drawer. The phone rail therefore still shows six slots and the More sheet still carries
   one row.
7. `sidebarSide` is not editable from the phone: a keyed write is required, and the phone's config
   write path is a read-merge-write that only the desktop may use for layout keys — the phone
   writes nothing for a side change and the control is not rendered there. **Assumption:** the
   phone Settings sheet keeps its existing scope (it does not show the activity-bar group today;
   it must not start).

---

## 10. Implementation map

### 10.1 `templates/_side_panels.html` (new)

One include, rendered **twice** with disjoint inputs:

```
{% with side="left",  views=boot.views_left,  active=boot.active_view_left  %}{% include "_side_panels.html" %}{% endwith %}
{% with side="right", views=boot.views_right, active=boot.active_view_right %}{% include "_side_panels.html" %}{% endwith %}
```

The include loops over `views` and renders each host exactly once, with its body selected by id.
Only the Explorer body is large (header, pinned section, bookmarks section, `#file-tree`,
`#sidebar-expand`) and it moves verbatim into the include; the other seven bodies plus the outline
body are one element each.

Invariants the include must hold:

| Invariant | Why |
|---|---|
| Every `_ACTIVE_VIEWS` id appears exactly once across both invocations | duplicates break every `getElementById` consumer |
| The two `views` lists are disjoint and their union is `_ACTIVE_VIEWS` | same |
| Each host carries `hidden` unless it is its side's `active` | first paint |
| Hosts inside a panel are in `sidebarOrder` | rail order and panel order agree |

The existing parity guard (`tests/test_app.py:436-451`) is **not** enough for the first invariant:
it compares `set(...)` of the ids and reads `templates/index.html` for `data-view=`, which will
hold none once the hosts move. It must read the rendered page (or the include) and **count** each
id, asserting exactly one, and it must assert that each host sits inside the panel its saved side
names. The same test currently has `assert_only_view` ("exactly one host visible", `:99-105`,
nine call sites) which becomes "exactly one host visible per panel".

### 10.2 `activity.js`

| PROVIDES (changed or new) | Behaviour |
|---|---|
| `register({ id, icon, label, side?, mount? })` | adds the view; `side` defaults `"left"`; `renderBar()` on both rails |
| `setSide(id, side)` | moves the host (`appendChild`), updates the map, re-renders both rails, refreshes the moved host's chevron, runs §7.3, returns the applied side |
| `sideOf(id)` | the resolved home side, `null` for an unknown id |
| `activate(id, toggle)` | routes by `sideOf`; hides only that side's hosts; events carry `{id, side}` |
| `collapse(side)` / `expand(side)` | per side; emit with the side |
| `getActive(side?)` | side id, or the last-activated id when called with no argument |
| `isViewVisible(id)` | panel open and that side's active id is `id` |
| `applyLayout(mode)` | `"phone"`: all hosts into `#side-panel`, one visible; `"desktop"`: each into its side's panel |
| `barItems()` | each item gains `side` |
| `makeCollapseBtn(id)` | a `data-collapse-view` button with the glyph for the current side |
| `refreshCollapseButtons()` | re-glyphs and re-titles every `[data-collapse-view]`; called by `register`, `setSide`, `applyLayout` |

Five existing functions carry the single-panel assumption and are **not optional** in the change
list. Each resolves its side through `sideOf(id)`:

| Function | Today | Required |
|---|---|---|
| `hostEl(id)` | searches `#side-panel` only (`activity.js:259-262`) | searches the host's side panel |
| `syncActiveClass()` | queries `#activity-bar` only (`:248-257`) | queries both rails |
| `hideAllAndCollapse()` | hides only `panelEl`'s hosts (`:194-196`) | per side, with §7.5's empty-right rule |
| `shellViewId()` / `adoptShellView()` | query `panelEl` (`:403-409`) | per side (§7.8) |
| the phone branch of `activate()` | hides only `#side-panel`'s hosts (`:292-296`) | unchanged logic, but only after `applyLayout("phone")` has moved every host there |

Skipping any of the first four produces: a right-homed view whose `mount()` never runs (an empty
AI, Search, Recent or Pinned host), no `aria-pressed` on the right rail, a phone drawer that hides
half the document, or a boot that adopts the wrong side.

`register` must not place a host: hosts ship in the template. `register` only draws icons and
resolves the boot view.

The module keeps one `barOrder`, one `hiddenViews`, and one `sideMap`; the per-side state of §2.3
is a pair of records, not two copies of the module.

### 10.3 `app.js`

| Change | Where |
|---|---|
| `DEFAULTS`: **remove** `activeView`, `outlineWidth`, `outlineCollapsed`; add `sidebarSide: {}`, `activeViewLeft: "explorer"`, `activeViewRight: "outline"`, `auxPanelWidth: 240`, `auxPanelCollapsed: false` | `app.js:78-95` |
| `applyAuxState()` replaces `applyOutlineState()`; `syncOutlineButtons()` and `toggleOutline()` are deleted | `app.js:639-672` |
| `applyConfig` normalises `sidebarSide`, re-homes only the differences, applies the §6.3 migration and deletes the legacy keys | `app.js:563-620` |
| Event wiring: `activity:changed` → `activeViewLeft\|Right`; `activity:collapsed\|expanded` → the matching bool; **delete** the `#sidebar-collapse` handler (`:1231-1239`), the `#outline-collapse` handler (`:1260-1264`) and the `#outline-toggle` / `#outline-rail-btn` handlers (`:1271-1274`) | `app.js:1220-1290` |
| `setupResize("aux-panel", "--aux-panel-width", "left", { max: auxMax })`, and `endDrag` writes `cfg.auxPanelWidth`; the left panel's max becomes `panelMax` | `app.js:1320-1380` |
| `shellPanelState()` reads both panels and both active views | `app.js:1478-1494` |
| Boot resolves and activates each side separately (§7.8); no `cfg.activeView` writer | `app.js:1500-1566` |
| `getAuxPanelWidth()` added beside `getSidePanelWidth()` | `app.js:1783-1788` |
| `PHONE_HIDDEN_VIEWS` gains `"outline"` | `app.js:37` |

The two maxima are the same function the CSS uses, or the handle runs past the track's clamp:

```
budget   = window.innerWidth − 2 * 48 − 352
panelMax = min(480, 0.45 * budget)
auxMax   = min(480, 0.45 * budget)
```

`setupResize`'s default max is 520 (`app.js:1334`) and the left panel's is `innerWidth / 2`
(`app.js:1324`); both are larger than the new caps and must be replaced. **Null guards:** the
deleted handlers are reached through bare `getElementById(...).addEventListener` (`app.js:1231`,
`:1260`, `:1271`), so they must be removed in the same commit as their template nodes — a template
without `#outline-collapse` plus a surviving line throws inside `wire()` and stops every later
binding, including Settings, shortcuts and both resize handles. `sidebar.js:1038`'s no-argument
`expand()` becomes `expand(sideOf("explorer"))`.

### 10.4 `vimnav.js`

The window cycle becomes positional, because two panels can sit on either side of the editor:

| Window | Element | Keys |
|---|---|---|
| Left panel | `#side-panel` | the tree keys when Explorer is its active view, otherwise no view-specific keys |
| Editor | `#editor-pane` | unchanged |
| Right panel | `#aux-panel` | the outline keys when `#outline-view` is its active view, otherwise no view-specific keys |

`setEnabled()` tags those three elements instead of `#sidebar`, `#editor-pane`, `#outline-pane`
(`vimnav.js:452-458`); `data-vim-window` keeps the names `sidebar`, `editor`, `outline` so the
state machine and its tests change as little as possible. `dispatchOutline` still targets
`#outline .outline-item` (`vimnav.js:272-315`), guarded by `isViewVisible("outline")`. The shortcut
label "Cycle sidebar / editor / outline" (`shortcuts.js:17`, `:81`) becomes "Cycle left panel /
editor / right panel".

With Explorer homed right, the tree keys no longer work in the left panel — that is the cost of a
positional cycle and it is stated here rather than discovered. The focused element is a panel, not
a view, so a panel showing an unusual view simply has fewer keys, which is what the editor window
already does.

The focus ring rule in `static/css/vimnav.css:21-24` swaps `#sidebar`/`#outline-pane` for
`#side-panel`/`#aux-panel`.

### 10.5 `style.css`

Order of landing, so each step is visible on its own:

1. `#layout`: five tracks, the §3.3 budget, `clamp()` caps, `#aux-panel` and `#activity-bar-right`
   zeroing rules for `.collapsed` and `data-right-empty`.
2. `#activity-bar-right`: the §4.1 box, the mirrored active indicator.
3. `#aux-panel`: the `#side-panel` box mirrored (left border, left-edge handle inset).
4. Host rules: `:where(#side-panel, #aux-panel) .side-panel-view` and its `[hidden]` rule
   (`style.css:497-505`), plus the phone rule at `:8642` — without this every hidden host in the
   right panel paints.
5. `#outline-pane`'s list rules (`:520-529` box, `:604-609` scroller) rescope to `#outline-view`;
   **keep** the `#side-panel.collapsed` child rules (`:664-671`) and duplicate them for
   `#aux-panel.collapsed` — a `.collapsed` panel must hide its header, hosts and resize handle, or
   it keeps a focusable chevron and a focusable separator at zero width, contradicting
   `shell-frame.md` AC3. The `#outline { margin-left: 8px }` inset moves to the aux panel's handle
   inset.
6. Tab bar: delete `.tab-bar .outline-toggle` (`:780-785`, `:10599-10605`) and its phone rule
   (`:8360`).
7. Phone block: hide `#activity-bar-right`, `#aux-panel`; extend `display: block` (`:8427`) and the
   reduced-motion list (`:9220-9227`).
8. Delete the `:has(#outline-pane…)` rules (`:425`, `:9362`, `:9697`).

### 10.6 `settings.js`

The row builder (`settings.js:389-449`) gains the segment; `toggleSidebarHidden` is unchanged;
a new `setSidebarSide(id, side)` calls `NB.app.setSidebarSide`, which persists with
`persistConfig(["sidebarSide"])`. The announcer (`:604-616`) is rewritten to name the rail.

---

## 11. Acceptance criteria

| ID | Criterion | Proof |
|---|---|---|
| AC1 | `#layout` has five tracks in the order left rail, left panel, editor, right panel, right rail, and every track has a non-zero width when both panels are open | browser: `test_mobile_browser.js` grid test, extended |
| AC2 | On first paint with an outline homed right, `#layout` contains `#outline-view` inside `#aux-panel`, visible, and no `#outline-pane` anywhere | `app.py` boot test on rendered HTML |
| AC3 | Every view id in `_ACTIVE_VIEWS` appears **exactly once** as `data-view` in the rendered page, and each appears inside the panel its saved side names; `_VIEW_SIDES` equals the `side:` values parsed from `activity.js` | counting test over the rendered HTML, `tests/test_app.py` |
| AC4 | The right rail contains only view icons: no `#activity-settings-btn`, `#workspace-rail-btn`, `#activity-graph-btn`, `#logout-btn`, `#activity-more-btn` | new test, `tests/test_app.py` |
| AC5 | Clicking a right-rail icon activates its view in `#aux-panel` and leaves `#side-panel`'s active view and width unchanged | browser, new |
| AC6 | Clicking the active right-rail icon collapses `#aux-panel` to 0 width and keeps the icon `aria-pressed="true"`; clicking again expands it to `auxPanelWidth` | browser, new |
| AC7 | A view's own header chevron collapses the panel that hosts it, with the glyph pointing away from the panel edge — including after the view is moved to the other side without a reload | browser, new; `test_dom.js` collapse tests updated |
| AC8 | Changing a row's side in Settings moves its host into the other panel without a reload, keeps its mounted state, and posts `sidebarSide` | browser, new |
| AC9 | Assigning the active view away from a side activates that side's first visible view **in rail order**; when none is left the side collapses and, on the right, the rail hides | browser, new |
| AC10 | `activeViewLeft` and `activeViewRight` are persisted separately and restored on reload, each side landing on its saved view | `test_dom.js` persistence tests updated |
| AC11 | An old config with `outlineCollapsed: true` boots with `#aux-panel` collapsed, and the first desktop save writes `auxPanelCollapsed` without `outlineCollapsed` (requires §6.3's removal from `DEFAULTS` and both writers) | `tests/test_app.py` + `test_dom.js` |
| AC12 | With both panels dragged to their caps at 1280, the reader keeps at least 352 px (measures 435) | browser, new |
| AC13 | At 861 with both panels at their caps, the reader keeps at least 352 px (measures 395); with both at 140 the reader measures 485 | browser, new |
| AC14 | With no visible view homed right, `#activity-bar-right` and `#aux-panel` are both 0 width; the left rail keeps its action buttons; moving or unhiding a view clears the state immediately | browser, new |
| AC15 | Hiding the last right-homed view collapses the right side and leaves the left untouched | `test_dom.js`, new |
| AC16 | On the phone, a view homed right opens in the drawer, no right rail or right panel is rendered, and a live desktop→phone flip leaves exactly one host visible in the drawer | `test_mobile_browser.js`, extended |
| AC17 | The Outline has no phone surface: it is absent from the phone rail and from the More sheet, and `activate("outline")` is refused on the phone | `test_mobile_browser.js`, extended |
| AC18 | The tab bar has no `#outline-toggle` and `.tab-list` reaches the bar's right edge | `test_dom.js` sibling test replaced |
| AC19 | Settings lists nine rows; each row's segmented control reflects and writes the view's side, is keyboard-operable, and announces the rail and position | `test_dom.js` order tests extended |
| AC20 | `isViewVisible("search")` is false while Search is active on a collapsed side, and `/` expands that side before focusing the input | `test_dom.js`, new |
| AC21 | A failed config fetch restores both sides from the shell paint, and a successful one never activates a raw id that fails §6.2's per-side rules | `test_dom.js` boot tests, new |
| AC22 | Hiding the Outline in Settings empties the right side (rail and panel at 0) and the only way back is Settings → Unhide | `test_dom.js`, new |

---

## 12. Tests that must change

| File:line | Why it breaks |
|---|---|
| `tests/browser/test_mobile_browser.js:214-246` | asserts a four-column grid and a strict left-to-right width order |
| `tests/browser/test_mobile_browser.js:252-267` | asserts eight rail views and zero off-rail views |
| `tests/browser/test_mobile_browser.js:310-390` | asserts `#outline-pane` display and geometry |
| `tests/browser/test_tabs_view_browser.js:333-396`, `:436`, `:453` | clicks `#outline-rail-btn`, asserts the outline geometry |
| `tests/browser/test_sessions_page_browser.js:167-168`, `:318-326` | `#outline-pane`, `#outline-collapse`, `#outline-toggle` |
| `tests/browser/test_typography_browser.js:778` | scopes the audit to `#outline-pane` |
| `tests/browser/test_core_ui_browser.js:1805` | uses `getActive()` as "this view is already open"; with two sides that means "last activated anywhere", so the guard must be `isViewVisible("sessions")` (§7.7) |
| `tests/static/test_typography.js:94` | asserts `.tab-bar .outline-toggle` font size |
| `tests/dom/test_dom.js:318-354`, `:546-550` | the fixture shell markup |
| `tests/dom/test_dom.js:7117-7123` | the outline toggle must be a child of `#tab-bar` |
| `tests/dom/test_dom.js:24379-24430` | collapse/expand and `--outline-width` |
| `tests/dom/test_dom.js:40145-40196` | first-paint regexes for the data attributes |
| `tests/dom/test_dom.js:40239-40298` | registry must equal the template hosts — `outline` joins both, and the count must be one each |
| `tests/dom/test_dom.js:46292-46317` | the phone write keeps `outlineWidth` |
| `tests/dom/test_dom.js:51005-51034` | hideTabBar reveals `#outline-rail-btn` |
| `tests/test_app.py:99-105`, `:350-420` | `assert_only_view` — becomes "exactly one visible host per panel" |
| `tests/test_app.py:114-140` | boot paint assertions for `#outline-pane` |
| `tests/test_app.py:182-192`, `:233-274` | `boot_state` keys: `outline_width`, `active_view`; per-side keys replace them |
| `tests/test_app.py:424-450` | `_ACTIVE_VIEWS` / registry / host parity — must read the rendered page and count |

New tests cover AC3-AC6, AC9, AC12-AC17, AC19-AC22.

---

## 13. Exceptions and proposals

### Exceptions (applied)

| Item | Old | New | Delta |
|---|---|---|---|
| Right-side pane width default | 220 (`outlineWidth`) | 240 (`auxPanelWidth`) | +20 px; the pane is now a panel that hosts any view |
| Tab bar right edge | 34 px icon button + `--space-2` gap | none | tab list gains ≈32 px |
| Left panel max | `min(480, 60 % of budget)` | `min(480, 45 % of budget)` | −15 points of budget; required so two panels fit (§3.3) |
| Rail column | 1 × 48 | 2 × 48 | editor loses 48 px when a right-homed view exists |
| A view's header chevron | always `‹`, always collapses left | glyph and target follow the host side | none at rest on the left |

### Proposals (not applied)

| Proposal | Why it is out |
|---|---|
| Drag an icon between rails in Settings | the segmented control covers the requirement; a cross-rail drag needs a second drop model and a rail-order rule per side |
| "Move to other side" in the rail icon's context menu | no context menu exists on rail icons |
| Independent width per view | one width per panel is the existing contract; per-view widths multiply state by nine |
| Remembering which view was on a side across a side change | a view has one home; its previous side is not a second state |
| A third rail | no requirement |

---

## 14. Mockup boards

`secondary-sidebar-mockup.html` draws, dark and light where it matters: (A) both panels open at
1280, (B) the same light, (C) right panel collapsed, (D) left panel collapsed, (E) both collapsed,
(F) Explorer homed right and Search left, (G) no views homed right, (H) the 861 boundary, (I) the
390 phone, (J) the Settings rows with the side control at rest, Right selected, hover and focus.

---

## 15. What not to build

- No third rail, no floating panel, no detachable panel.
- No side control for the workspace, graph, settings or log-out actions: they are not views.
- No right rail on the phone, and no phone editing of `sidebarSide`.
- No per-view width, and no independent width for a view moved to the other side.
- No new icon glyph. The right rail, the outline view and the side control reuse existing symbols.
- No change to `sidebarOrder` semantics: it stays one global order.
