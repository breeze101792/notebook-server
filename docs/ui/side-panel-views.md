# Side-panel views — Explorer, Pinned, Bookmarks, Recent

Status: Current spec — pre-implementation.

Reference mockup: [`side-panel-views-mockup.html`](side-panel-views-mockup.html) — dark and light boards: Explorer with
pinned folders and the tree, Explorer in Bookmarks mode, the three top-section modes, Pinned,
Bookmarks, Recent (filtered and focused), the four empty states plus the error block, the 140 px
floor, the phone drawer, the row-state strip, the row menus, and the row-anatomy diagram.

**Normative source.** This document owns the inside of four side-panel views: Explorer, Pinned,
Bookmarks and Recent. It reads [`foundations.md`](foundations.md) for every token,
[`controls.md`](controls.md) for control anatomy, states, focus and ARIA, and
[`shell-frame.md`](shell-frame.md) for the frame that hosts them. Sessions
([`sessions.md`](sessions.md)) is a current spec in this set. Search (`search-view.md`) and AI
(`ai-panel.md`) are written beside this document. The shell frame, the tab strip, the topbar and
the rail are not redesigned here.

Where this document and `static/css/style.css` differ, this document is the target and §9 says
how the stylesheet gets there. Where it and a shipped document differ, §11 records the conflict
and names the side that changes. Every claim about current code cites `file:line`.

---

## 1. Shared view contract

### 1.1 Host

All four views are one `.side-panel-view` host each, siblings inside `#side-panel`, selected by
`data-view` (`templates/index.html:226-262`). One is visible; the rest carry `[hidden]`.

| Rule | Value | Source |
|---|---|---|
| Box | `flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden` | `style.css:296-303` |
| Mount | Explorer ships rendered. Bookmarks builds at load (`bookmarks.js:450-452`). Pinned and Recent mount on first activation (`activity.js:1331-1354`). | measured |
| Keep-alive | Never unmounted. `[hidden]` swaps visibility only, so scroll, expansion, selection and filter text survive every switch. | `activity.js:64-71`, `:182-195` |
| Width | The frame's `--side-panel-width`: 240 default, `--shell-pane-min` 140, `--side-panel-max` 480. The view is the panel minus its 1 px right border. | `shell-frame.md` §1.2, §4.3; `style.css:284-293` |
| Order | Explorer, Sessions, Pinned, Bookmarks, Recent, Search, AI | `templates/index.html:226-272` |
| Failure | A throwing `mount()` is caught and logged; the frame owns the error line. | `activity.js:189-194`; `shell-frame.md` §4.7 |

### 1.2 Header

One pattern, one node per view (shell-frame §4.2). This document adds the per-view content only.

| View | Title | Count | Actions, left to right | Collapse |
|---|---|---|---|---|
| Explorer | `Files` | — | top-section toggle, refresh | `#sidebar-collapse` |
| Pinned | `Pinned` | pin count | — | `makeCollapseBtn()` |
| Bookmarks | `Bookmarks` | bookmark count | add (★) | `makeCollapseBtn()` |
| Recent | `Recent` | — | — | `makeCollapseBtn()` |

- Title element becomes `<h2 class="panel-title">` inside each view's existing header node
  (shell-frame §4.2, AC11). Each view converts its own title in its own pass; the node and its
  selector stay put, so the browser test at `test_core_ui_browser.js:1763` keeps resolving.
- The header is 34 px, `padding: 0 var(--space-3)`, actions `sm` (24 × 24), gap `--space-hair`;
  shell-frame §4.2 owns those numbers.
- Explorer already has two actions before the collapse control, the maximum shell-frame §4.2
  allows (`templates/index.html:229-233`).
- The count is controls §2.6's count badge: `--radius-pill`, `--stroke-1` in `--border`,
  `padding: 1px var(--space-2)`, `--text-2xs` 600, `--text-muted`,
  `font-variant-numeric: tabular-nums`, `min-width: 2ch`, `text-align: right`, no fill. It sits
  inside `.panel-heading` (`style.css:8247-8253`) beside the title and never shrinks.
- Counts are row counts, never live regions. The numeral is visible; the unit is
  `.sr-only` (" pinned folders", " bookmarks").
- Explorer's header carries no count: the tree's visible row count changes with every expand.

### 1.3 Scroll ownership

The view scrolls; the panel never does (`style.css:289`). Each view owns exactly one primary
scroller, and Explorer owns a second, bounded one for its top section.

| Region | Scroller | Cap | Source |
|---|---|---|---|
| `#file-tree` | yes | none | `style.css:386-391` |
| `#pinned-folders` (inline) | yes | 30 vh | `style.css:2850-2857` |
| `#explorer-bookmarks` (inline) | yes | 30 vh | `style.css:2896-2903` |
| `.pinned-view-list` | yes | none | `style.css:2917-2924` |
| `.bookmarks-list` | yes | none | `style.css:2952-2959` |
| `.recent-list` | yes | none | `style.css:3824-3830` |

Rules:

1. Every scroller insets `var(--space-2)` on the resize edge so the 8 px handle never covers
   the scrollbar (`#file-tree { margin-right: 8px }`, `style.css:390`). The phone has no handle,
   so the inset is 0 there (§7).
2. Every scroller also reserves its scrollbar width (`scrollbar-gutter: stable`) so adding one
   row does not shift every name 8–10 px inside a 240 px pane.
3. The inline top section and the tree are two scrollers inside one view. That is deliberate:
   the cap keeps a long pin list from pushing the tree off screen. Only one top section is ever
   visible, so the view has at most two scrollers.
4. The filter strip in Recent is `flex: 0 0 auto` and does not scroll; the list below it does
   (`style.css:3813-3830`).

### 1.4 Content geometry

| Part | Value | Derived from |
|---|---|---|
| List inset | `padding: 0 var(--space-1) var(--space-1)` | 4 px each side |
| Row inset | `padding: var(--space-1) var(--space-2)` | 8 px each side, so text starts at 12 px |
| Tree indent | `--tree-indent` 18 px per level, with the continuous guide strokes | controls §2.16; shipped `style.css:2806-2837` |
| List gap | Tree and Pinned: 0 (the guide strokes must join). Bookmarks and Recent: `--space-hair` | `style.css:2801` |
| Scrollbar | `scrollbar-gutter: stable` | new |

At the 140 px floor the row's inner width is 107 px (140 − 1 border − 8 handle − 8 list inset
− 16 row inset). A name is the only flexible child; everything else is `flex: 0 0 auto`.

### 1.5 Empty, loading, error

One block for four views. Existing class names stay, so no test selector moves
(`tests/dom/test_dom.js:20715`, `:23343`, `:22657`).

| State | Copy | Role | Action |
|---|---|---|---|
| Explorer empty | `No files yet. Right-click here to create one.` | `role="status"` | desktop: right-click is the action, no button. Phone: `No notes yet.` plus Capture (§7) |
| Explorer loading | `Loading files…` | `role="status"` on the tree, `aria-busy="true"` | none |
| Explorer error | `Couldn’t load files.` | `role="alert"` | `Retry` (button, `sm`) |
| Pinned empty | `No pinned folders. Pin one from a folder’s menu.` | `role="status"` | none |
| Bookmarks empty | `No bookmarks yet. Bookmark a note from the file tree.` | `role="status"` | none |
| Recent, no history | `No recent notes yet.` | `role="status"` | none |
| Recent, no match | `No recent files match.` | `role="status"` | none |

Geometry: `padding: var(--space-6) var(--space-4)`, maximum measure
`calc(60 * var(--space-2))` (480 px), `--text-ui`, `--text-muted`, no italics. Error text takes
`--danger`; the Retry button is controls §2.1 `sm`, secondary.

The block is a **sibling of the list scroller**, not a child of it. `role="status"` and
`role="alert"` are not permitted children of `role="tree"` or `role="listbox"`, so the shipped
placement inside `#file-tree` (`sidebar.js:97-101`), `.pinned-view-list` (`:626-629`) and
`.recent-list` (`activity.js:364-368`) moves out. It sits in the view, directly above the
scroller, and the scroller is hidden while the block shows.

The inline Explorer top sections have **no** empty state: when the active mode's list is empty
the host is `[hidden]` (`sidebar.js:554-556`; `bookmarks.js:138-141`). The header glyph is the
only indicator. Two shipped tests pin this behaviour
(`tests/dom/test_dom.js:20622-20629`, `:20637-20640`).

Loading and error exist only in Explorer, the one view that fetches. Pinned, Bookmarks and Recent
read in-memory state and render synchronously; a failed write is app-level feedback and is out
of scope.

### 1.6 Preserved state and focus entry

| What | Survives a view switch | Survives a reload |
|---|---|---|
| Tree collapse set | yes (`collapsed`, `sidebar.js:47`) | no — the first fetch collapses everything (`:1350-1357`) |
| Tree scroll, selection | yes | selection re-derives from the open file (`:1673-1683`) |
| Pinned expansion | yes (`pinExpanded`, `:57`) | no |
| Recent filter text | yes (host stays mounted, `activity.js:315-318`) | no |
| Bookmarks order | yes | yes (`cfg.bookmarks`; `bookmarks.js:238-240`) |
| Row focus | no; `[hidden]` removes it | no |

Focus entry:

1. Activating a view from the rail does **not** move focus into the panel.
2. `Tab` enters the visible view after its header actions, in DOM order.
3. Recent focuses its filter on first mount only (`activity.js:430-432`). Every other view
   leaves focus on the rail.
4. Returning from a row menu puts focus back on the control that opened it (§8.4).

---

## 2. Explorer

### 2.1 Anatomy

```
#sidebar[data-view="explorer"]                     .side-panel-view
├── .panel-header                       34 px
│   ├── .panel-title            "Files"
│   └── .panel-header-actions
│       ├── #explorer-top-toggle   24
│       ├── #sidebar-refresh       24
│       └── #sidebar-collapse      24
├── #pinned-folders.pinned-folders      hidden unless mode=pinned and non-empty; cap 30vh
├── #explorer-bookmarks.explorer-bookmarks  hidden unless mode=bookmarks and non-empty; cap 30vh
└── #file-tree.tree                     flex 1; the scroller
```

The two inline hosts are siblings of the tree, not children of it
(`templates/index.html:235-237`). `#sidebar-expand` at `:238` is retired by shell-frame §4.5 and
is not part of this design.

### 2.2 Header actions

| Control | Glyph | Size | Name (`aria-label` = `title`) | State |
|---|---|---|---|---|
| `#explorer-top-toggle` | current mode: `nb-icon-pin`, `nb-icon-bookmark`, `nb-icon-section-none` | 24 | `Top section: {current}. Click to show {next}.` | cycles; no `aria-pressed` |
| `#sidebar-refresh` | `nb-icon-refresh` | 24 | `Reload file tree from disk` | `aria-busy` while fetching; the glyph rotates once |
| `#sidebar-collapse` | `nb-icon-chevron-left` | 24 | `Collapse panel` (phone: `Close panel`) | owned by the frame |

- The toggle's string is shipped and tested (`sidebar.js:520-528`;
  `tests/dom/test_dom.js:20593-20597`). Only the glyph changes.
- The refresh button regains the standard icon-button hover. The glyph rotates on its own; the
  box does not spin (`style.css:354-381`).
- `#sidebar-collapse` has a `title` but no `aria-label` today (`templates/index.html:232`).
  The frame's pattern requires one (`shell-frame.md` §4.2).

### 2.3 Top-section modes

| Mode | `data-mode` | Glyph | Inline block | Stored |
|---|---|---|---|---|
| Pinned folders | `pinned` (default) | `nb-icon-pin` | `#pinned-folders` | `cfg.explorerTop` |
| Bookmarks | `bookmarks` | `nb-icon-bookmark` | `#explorer-bookmarks` | same |
| None | `none` | `nb-icon-section-none` | neither | same |

Cycle: pinned → bookmarks → none → pinned (`sidebar.js:514-518`). An unknown stored value falls
back to `pinned` (`:501-503`, `:507-510`). Persistence is `app.js:1365-1374`; the default is
`app.js:106`.

Rules:

1. Exactly one inline host can be visible; the other is `[hidden]` (`sidebar.js:530-538`).
2. A mode with an empty list shows nothing above the tree. No hint, no placeholder (§1.5).
3. The button's glyph is the current mode, not the next one. The label states both, because a
   glyph alone cannot name a tri-state.
4. The button is a cycle, not a menu. Three states and one click are cheaper than a menu with
   three items, and the mode is a preference, not a command.

### 2.4 Inline pinned block

- Header: `.pinned-header` with `.pinned-title` `Pinned` — `--text-xs`, tracking
  `--tracking-label`, uppercase, `--text-muted`, `padding: 0 var(--space-2) var(--space-1)`
  (`sidebar.js:557-563`; `style.css:2859-2870`).
- Rows: pin roots at tree geometry (24 px), each expandable in place. Expansion is the Pinned
  section's own set (`pinExpanded`, `sidebar.js:57`), never the tree's.
- A root row shows the folder icon (open/closed), the base name, the full path in `title`
  (`:645-649`), and the unpin control.
- Children are `.pin-child` rows drawn with the tree's guide cells (`:691-731`). Files open; a
  folder expands.
- Cap 30 vh; scrolls internally (§1.3).
- The pin row's right-hand control is the same hover action as the Pinned view's: `Unpin folder`, not a pressed toggle. The row exists because the folder is pinned, so a lit pin would decorate every row; the state is the row itself.
- Nothing here is a drop target for tree drags. Pins reorder only within the pin list (§2.10).

### 2.5 Inline bookmarks block

- Header: same `.pinned-header` with the title `Bookmarks` (`bookmarks.js:94-104`,
  `:119-128`).
- Rows are the Bookmarks view's rows, same renderer and same order (`bookmarks.js:14-15`,
  `:165-167`). Row height is therefore the list-row 30 px, not the tree's 24.
- The host is `[hidden]` while the list is empty (`:138-141`).
- Drag-reorder inside the inline list mutates the one shared order (`:269-336`).

### 2.6 Tree geometry — as shipped today

The Explorer tree keeps the app's current visual design: CSS-drawn guide strokes, 18 px cells,
`3px 6px` rows, accent wash. The user rejected a 24 px / neutral-hover restyle on 2026-11-09.
This pass adds ARIA, keyboard and real buttons; it does not redraw a row.

| Property | Value | Source |
|---|---|---|
| Row | `padding: 3px 6px`, gap 4, radius 4, ≈22 high | `style.css:2770-2779` |
| Icon | 16, `flex: 0 0 16` | `:2791` |
| Guide | `--tree-indent` 18 per ancestor level + one corner cell | `:2806-2809`; the token holds the same 18 |
| Guide strokes | `1px --border`, `top/bottom: -3px`, continuous across rows | `:2813-2837` |
| Root rows | flat: no guide cell | `sidebar.js:126-131` |
| Name | inherits body size, one line, ellipsis | `:2792` |
| Container | `padding: 6px 4px` | `:2770` |
| Empty | moved to a sibling of the scroller, same padding and copy | §1.5 |
| Hover | `--accent-soft` (shipped) | `:2780` |
| Active file | `--accent-soft`, `--accent` text, 600 (shipped) | `:2781` |
| Multi-selected | `--accent-soft`, `--fg` text, 400, inset 2 px `--accent` | `:2785-2790` |

The active-file treatment measures 4.39:1 on `--accent-soft` in the dark theme, under the
4.5 text floor. That is a known, accepted exception: the user prefers this look, and
`aria-selected` now carries the state for assistive tech. Do not "fix" the colour in this
pass; record it if the tree is ever redesigned.

The guide overlap is fragile: changing the row's vertical padding without changing the
`-3px` stroke ends breaks the line between rows. Keep both numbers in sync if the row is ever
touched.

### 2.7 Expansion, selection and the active file

**Expansion.** A folder row toggles on click; its subtree's wrapper gets `display: none`
(`sidebar.js:241-255`, `:204-205`; `style.css:2840`). Collapsing a folder also collapses every
folder under it (`sidebar.js:258-265`). The first load collapses every folder (`:1350-1357`).
`Collapse all folders` is the menu equivalent (`:270-283`, `:1041`).

**Active file.** One path is the open note (`selectedPath`, `sidebar.js:80`). Its row carries
`.selected` and `aria-selected="true"` (`:229`, `:417-428`).

**Multi-selection.** Ctrl/Cmd-click toggles, Shift-click extends over visible rows
(`sidebar.js:325-409`). Selected paths carry `.multi-selected`; a right-click inside a
multi-selection offers one item, `Move {n} items to…` (`:1048-1074`). The phone has no
multi-selection (`:390-402`), and a mode flip drops it (`:1692-1700`).

**Visual states** — the tree keeps the shipped look; the three list views share the new one:

| State | Explorer tree (unchanged) | Pinned / Bookmarks / Recent lists |
|---|---|---|
| Rest | transparent, `--fg` | transparent, `--text-primary` |
| Hover | `--accent-soft` | `--surface-raised` |
| Active file | `--accent-soft`, `--accent` text, 600 | `--accent-soft`, `--text-primary`, 600, inset 2 px `--accent` |
| Multi-selected | `--accent-soft`, `--fg` text, 400, inset 2 px `--accent` | same as active |
| Focus-visible | ring at `--focus-offset-inset` | ring at `--focus-offset-inset` |
| Dragging | `opacity: var(--opacity-drag)` | `opacity: var(--opacity-drag)` |

The tree's active row is the one place where `--accent` text stays on `--accent-soft`; see
§2.6 for the accepted-contrast note. The rows of Pinned, Bookmarks and Recent are new code and
follow the list-row base in controls §2.16.

### 2.8 Row actions

Files carry a bookmark toggle; folders carry a pin toggle. Both are pointer affordances with a
keyboard equivalent in the row menu.

| Control | Markup | Glyph | Name | State |
|---|---|---|---|---|
| Bookmark toggle, file row | `<button class="tree-star" tabindex="-1" aria-pressed>` | `★` on, `☆` off | `Remove bookmark {name}` / `Add bookmark {name}` | on: `--accent-soft` face + `--accent` glyph |
| Pin toggle, folder row | `<button class="tree-pin" tabindex="-1" aria-pressed>` | sprite `nb-icon-pin` | `Unpin folder {name}` / `Pin folder {name}` | same |
| Row menu, phone only | `<button class="tree-more" aria-haspopup="menu" aria-expanded>` | `⋯` | `{name} actions` | 44 × 44, always visible |

- Size: 24 × 24 each. A 24 px hit is taller than the 16 px content line, so each takes
  `margin-block: calc(-1 * var(--space-1))`; it grows into the row's padding and the row keeps
  its 24 px height (controls §5). The pin glyph is `--icon-sm` 14; the star is text at
  `--text-sm`. On phone they are removed (§7).
- Visibility: `display: none` at rest; shown on row hover, or while `aria-pressed="true"`
  (`style.css:2999-3031`).
- `tabindex="-1"`: the tree has one Tab stop (the roving row), not three per row. This is the
  tree's deliberate exception to "every control is a Tab stop"; the row menu is the keyboard
  path for every row action, and `Shift+F10` / the Menu key opens it from the focused row.
- The star stays a text glyph (`★` / `☆`). Foundations §9.3 does not list it for replacement,
  and three shipped tests assert the characters (`tests/dom/test_dom.js:22669`, `:22679`,
  `:22685`). The pin is already a sprite symbol (`sidebar.js:19`, `:177`).
- The shipped paint classes stay: `.is-bookmarked` on the star and `.is-pinned` on the pin. They
  are set from the same flag as `aria-pressed`, exactly like Sessions' `is-active`
  (`sessions.md` D19). A shipped test reads `.tree-pin.is-pinned`
  (`tests/dom/test_dom.js:23063`); the class is paint, `aria-pressed` is the state.
- `--warn` is not the on-colour. It is the caution role (`foundations.md` §3.4); a bookmark is
  not a warning. Today both stars and pins use it (`style.css:2992`, `:3012`, `:3029`).
- On-state colour is `--accent` on `--accent-soft`: a glyph needs 3:1, and the pair measures
  4.39 dark / 4.53 light.

### 2.9 Context menus

`NB.menu` owns behaviour and appearance; this document owns the item lists. Every list is a
plain descriptor array (`docs/architecture/context-menus.md:165-176`). Anchoring, clamping,
`Esc`, arrow walking and focus return are the module's (`:233-255`).

**Tree file row** (`sidebar.js:986-1009`, `:1038-1046`):

`Open` · — · `New file…` · `New folder…` · — · `Export…` · `Rename / Move…` · `Copy…` ·
`Copy path` · `Copy link` · `Add bookmark` / `Remove bookmark` · — · `Collapse all folders`
(only when the tree has a folder) · — · `Delete` (danger)

**Tree folder row** (`sidebar.js:1016-1033`):

`New file…` · `New folder…` · — · `Rename / Move…` · `Copy…` · `Pin folder` / `Unpin folder`
· — · `Collapse all folders` · — · `Delete` (danger)

**Empty tree area** (`sidebar.js:1110-1123`): `New file…` · `New folder…` · — ·
`Collapse all folders`

**Multi-selection** (`sidebar.js:1054-1066`): `Move {n} items to…` only.

**Phone row** (`sidebar.js:1079-1105`): `Open` · `Copy link` · `Copy path`. Read-only; no create,
rename, delete, pin or bookmark.

**Row-menu keyboard invocation.** On the focused tree row, `Shift+F10` or the Menu key opens the
same row menu anchored to the row's rect. Today only hybrid content offers that
(`docs/architecture/context-menus.md:243-251`); the tree does not, and the row actions are not
reachable without a pointer.

### 2.10 Drag

Tree drag-move is shipped and stays (`sidebar.js:1467-1597`):

| Gesture | Result |
|---|---|
| Drag a row onto a folder | move inside |
| Drag a row onto a file | move beside, into the same parent (`:1403-1414`) |
| Drag onto empty tree area | move to the root |
| Drag a multi-selection | every top-level selected path moves (`:1481-1486`, `:1580-1583`) |
| Folder onto itself or a descendant | refused before the API call (`:1552-1559`) |

Visuals: source `opacity: var(--opacity-drag)`; insert mark `inset ±var(--stroke-2) 0 0
var(--accent)`; folder target an accent outline; empty-area target the same dashed outline
(`style.css:2888-2892`).

A drag is never the only way to move a file: the row menus carry `Rename / Move…` and
`Move {n} items to…` (foundations §10.5 rule 4).

### 2.11 Empty, loading, error, no workspace

| State | What the view shows |
|---|---|
| Empty tree | The §1.5 block, with the right-click sentence. The top section is whatever the mode left visible. |
| First load | The tree area holds `Loading files…` and `aria-busy="true"` until the first fetch resolves. No spinner; the wait is one request and usually under 300 ms. |
| Refresh | The tree stays on screen. Only the header button reports busy: `aria-busy="true"`, one glyph rotation. Nothing reflows. |
| Fetch failure | The previous tree stays if there is one; an error block with `Retry` is appended above it. `role="alert"`. Today the failure is only `console.error` (`sidebar.js:1376`). |
| No workspace / unreadable root | The same error block; the workspace picker owns the missing-folder signal (`shell-frame.md` §2.3 rule 6; `workspaces.md`). |
| Collapsed panel | Nothing renders; the view is `display: none` at width 0 (`style.css:444-452`). |

`Retry` re-runs `refresh()`; it does not reload the page.

### 2.12 Keyboard

| Where | Key | Action |
|---|---|---|
| Header | `Tab` | toggle → refresh → collapse, then into the view |
| Tree row | `Tab` | one stop for the whole tree (roving `tabindex`) |
| Tree row | `ArrowDown` / `ArrowUp` | next / previous visible row (vimnav stays the owner, controls §2.16) |
| Tree row | `ArrowRight` / `ArrowLeft` | expand / collapse; `ArrowLeft` on a file goes to its parent |
| Tree row | `Enter` | open a leaf |
| Tree row | `Space` | toggle a folder |
| Tree row | `Shift+F10` / Menu | open the row menu |
| Row menu | `Esc` | close and return focus to the row |
| Tree | `Esc` | clear the multi-selection (`sidebar.js:438-448`) |

---

## 3. Pinned

### 3.1 Model and host

An ordered array of folder paths, persisted as `cfg.pinnedFolders`; the in-memory list is
`pinnedFolders` (`sidebar.js:48-57`, `:455-495`). The view is `#pinned-view`, mounted lazily
(`activity.js:1331-1340`; `sidebar.js:592-620`). The inline Explorer section renders the same
rows from the same state (`sidebar.js:571-587`).

The model is unchanged by this document: add and remove via the folder row's pin toggle or menu,
order by the drag rules plus the menu items in §3.3.

### 3.2 Anatomy

```
#pinned-view
├── .panel-header
│   ├── .panel-heading
│   │   ├── .panel-title          "Pinned"
│   │   └── .panel-count          {n}
│   └── .panel-header-actions
│       └── .collapse-btn
└── .pinned-view-list             role=tree, scroller
```

| Property | Value | Today |
|---|---|---|
| Row | Tree geometry: 24 px, `--radius-xs`, gap `--space-1` | `style.css:2873-2883` |
| List | `padding: 0 var(--space-1) var(--space-1)`, `margin-right: var(--space-2)` | `padding: 0 4px 6px` (`:2922`), `margin-right: 8px` (`:2923`) |
| Root row | guide-free; folder icon, base name, path in `title`, unpin control | `sidebar.js:638-668` |
| Child row | tree guide cells, folder or file, 24 px | `:691-731` |
| Expansion | per-pin, independent of the tree | `:672-676` |
| Empty | §1.5 block, `.pinned-view-empty` | `style.css:2925-2930` |

The header holds no add control. A pin is created where the folder is: a tree folder row's pin
toggle, or that row's menu. The empty state says so.

### 3.3 Row actions, ordering and states

| Action | Where | Rule |
|---|---|---|
| Expand / collapse | click the row | toggles `pinExpanded` and re-renders both pin surfaces (`sidebar.js:672-676`) |
| Unpin | hover-revealed pin button in the row; `Unpin folder` in the row menu | `:650-660`, `:744` |
| Collapse all | row menu, or the empty-area menu | `:743`, `:756-768` |

The unpin control is an **action**, not a toggle: the row is in the Pinned list, so a pressed
pin would decorate every row. 24 × 24, glyph `--icon-sm`, `--text-muted`, shown on row hover,
`aria-label="Unpin folder {name}"`.

Ordering: array order, top to bottom. Drag reorder is shipped (`sidebar.js:785-874`); the row
menu gains the keyboard and non-pointer equivalent:

`Move up` / `Move down` — inserted after `Unpin folder`, before the separator; disabled at the
first and last row. Foundations §10.5 rule 4 requires a menu equivalent for every drag.

States: rest, hover `--surface-raised`, active-file row per §2.7, focus inset, dragging
`--opacity-drag`. A pin root is never "active"; only a child file can be the open note
(`sidebar.js:712`, `:1673-1683`). On phone the whole list is read-only (§7).

Copy:

| Slot | String |
|---|---|
| Header count | `{n}` + `.sr-only` ` pinned folders` / ` pinned folder` |
| Empty | `No pinned folders. Pin one from a folder’s menu.` |
| Menu items | `Expand` / `Collapse`, `Collapse all pinned folders`, `Unpin folder`, `Move up`, `Move down`, then the folder tail from §3.3: `New file…`, `New folder…`, `Rename / Move…`, `Copy…`, `Collapse all folders`, `Delete…` (`sidebar.js:736-746`) |

### 3.4 Keyboard

| Where | Key | Action |
|---|---|---|
| Rows | `Tab` | one stop for the whole list (roving `tabindex`) |
| Rows | `ArrowDown` / `ArrowUp`, `Home` / `End` | move the tree cursor between visible rows |
| Folder row | `ArrowRight` / `ArrowLeft`, `Space` | expand / collapse |
| File row | `Enter` | open the note |
| Any row | `Shift+F10` / Menu | open the row menu; `Esc` returns focus to the row |
| Any row | `Tab` after the row | leaves the list; unpin controls are `tabindex="-1"` |

The arrow model is the Explorer tree's, not a second one: one roving tabindex, one key handler
(controls §2.16).

---

## 4. Bookmarks

### 4.1 Model and host

An ordered array of file paths, persisted as `cfg.bookmarks`; the in-memory list is `bookmarks`
(`bookmarks.js:24-27`). `toggle()` appends on add and splices on remove (`:211-224`). The
activity view and the inline Explorer section share one renderer and one order (`:38-40`,
`:109-117`). The view header and list are built at load (`:53-88`, `:450-452`).

### 4.2 Anatomy

```
#bookmarks-view
├── .panel-header
│   ├── .panel-heading
│   │   ├── .panel-title          "Bookmarks"
│   │   └── .panel-count          {n}
│   └── .panel-header-actions
│       ├── #bookmarks-add        24, ☆
│       └── .collapse-btn
└── #bookmarks-list.bookmarks-list    scroller
    └── .bookmark-row-wrap            layout only
        └── button.bookmark-row       click, focus, aria-current
            ├── .bookmark-pin         ★ marker, aria-hidden
            └── .bookmark-name
```

| Property | Value | Today |
|---|---|---|
| Row | list row: 30 px, `--radius-sm`, `padding: var(--space-1) var(--space-2)`, gap `--space-2` | div, ≈21 px, radius 4 (`style.css:2971-2980`) |
| Marker | `--icon-sm` 14, `--text-muted`, `★`, `aria-hidden="true"` | 14 px, 11 px text, `--warn` (`:2992`) |
| Name | `--text-ui`, one line, ellipsis, `title` = full path | `.bookmark-name` (`:2993`; `bookmarks.js:183-184`) |
| List | `padding: 0 var(--space-1) var(--space-1)`, gap `--space-hair`, `margin-right: var(--space-2)` | `0 4px 6px` (`:2957`) |
| Empty | §1.5 block, `.bookmarks-empty` | `:2960-2965` |

The wrapper exists so the row button does not nest inside another control. It carries **only**
layout. The `.bookmark-row` button itself carries `draggable`, `data-path` and the `contextmenu`
listener, because `bookmarks.js:272-308` starts a drag from `e.target.closest(".bookmark-row")`
and reads `row.dataset.path`; if the wrapper owned either, a real `dragstart` would fire on an
element the handler rejects. This keeps every shipped drag and path assertion green.

### 4.3 Add, remove and ordering

| Action | Control | Rule |
|---|---|---|
| Add | `#bookmarks-add` in the header | Adds the **active file**; hidden when no file is open or it is already listed (`bookmarks.js:66-77`, `:229-233`) |
| Add | `★` on a tree file row | Same `toggle()` (§2.8) |
| Add | `Add bookmark` in the tree row menu | Same (`sidebar.js:1003-1007`) |
| Remove | `Remove bookmark` in the row menu | `bookmarks.js:373` |
| Remove | `★` on the tree row | `sidebar.js:216-227` |
| Reorder | drag within either list | `bookmarks.js:265-336` |

Ordering: insertion order; a new bookmark is appended (`bookmarks.js:218`). Drag reorder is
shipped. The row menu gains `Move up` / `Move down` after `Remove bookmark`, disabled at the
ends — foundations §10.5 rule 4.

The header add button shows `☆` (outline) for an add action; the list marker is the filled `★`.
Today the button shows the filled star (`bookmarks.js:23`, `:72`), which reads as a state rather
than an action.

Copy:

| Slot | String |
|---|---|
| Header count | `{n}` + `.sr-only` ` bookmarks` / ` bookmark` |
| Add, name | `Bookmark the active file` |
| Empty, desktop | `No bookmarks yet. Bookmark a note from the file tree.` |
| Empty, phone | `No bookmarks yet. Add them from a desktop browser.` (`bookmarks.js:86`; `mobile-shell.md` §4.6) |
| Menu items | `Open`, `Export…`, `Rename / Move…`, `Copy…`, `Copy path`, `Copy link`, `Remove bookmark`, `Move up`, `Move down`, `Show in file sidebar`, `Delete` |

### 4.4 States

| State | Treatment |
|---|---|
| Rest | transparent, name `--text-primary` |
| Hover | row `--surface-raised` (`bookmarks.js` marks nothing; CSS only) |
| Active file | `--accent-soft` face, name `--text-primary` 600, 2 px inset accent bar, `aria-current="true"` |
| Focus-visible | inset ring on the row button |
| Dragging | `--opacity-drag` on the wrapper; insert mark 2 px accent at the edge |
| Long list | list scrolls; the header count does not change |
| Phone | read-only; no add, no drag, no menu (§7) |
| Viewer | identical; bookmarking writes workspace state, and a viewer's writes are refused by the server (`app.js:530`) |

`aria-current` is `"true"`, not `"page"` — the same value Sessions uses for a row in a list
(`sessions.md` §7.1).

### 4.5 Keyboard

| Where | Key | Action |
|---|---|---|
| Rows | `Tab` / `Shift+Tab` | next / previous row, then the header's add and collapse controls in DOM order |
| Row | `Enter` / `Space` | open the note (native button) |
| Any row | `Shift+F10` / Menu | open the row menu at the row's rect; `Esc` returns focus to the row |
| Any row | drag | reorder; `Move up` / `Move down` is the keyboard equivalent |

---

## 5. Recent

### 5.1 Model and host

`cfg.recentFiles` is `string[]`, most-recent first, capped at 20
(`app.js:55`, `:629-631`). It is re-keyed on rename and move (`app.js:655-672`). There is no
timestamp in the model. The view reads it on every render and mounts lazily
(`activity.js:320-433`).

### 5.2 Anatomy

```
#recent-view
├── .panel-header
│   ├── .panel-title              "Recent"
│   └── .panel-header-actions
│       └── .collapse-btn
├── .recent-strip                 fixed
│   └── .field-wrap
│       ├── input.recent-filter
│       └── button.recent-clear   24, only when non-empty
└── .recent-list                  role=listbox, scroller
    └── .recent-row               role=option
        ├── .recent-name
        └── .recent-dir
```

| Property | Value | Today |
|---|---|---|
| Strip | `padding: var(--space-2) var(--space-3)`, no border | input margins only (`style.css:3815`) |
| Field | `--control-h-lg` 36, `--surface-well`, `1px --border-strong`, `--radius-sm`, `--text-ui`, placeholder `--text-muted` | 32 px, `--bg` face, `--border` (`:3813-3822`) |
| Field focus | accent border + 3 px `--accent-soft` halo, no outline (controls §2.4) | accent border only (`:3823`) |
| Clear | 24 × 24 icon button inset `--space-1` from the right; field reserves `--control-h-body`; native cancel suppressed | none for Recent; `.search-panel-input` suppresses its own WebKit cancel, `.recent-filter` does not |
| Row | list row 30 px, `--radius-sm`, `padding: var(--space-1) var(--space-2)`, gap `--space-2` | ≈26 px, radius 4, padding 5 × 8 (`:3831-3841`) |
| Name | `--text-ui` 500, ellipsis | `--text-ui` 500 (`:3844`) |
| Meta | directory, `--font-mono`, `--text-xs`, `--text-muted`, right-aligned, `max-width: 40%`, ellipsis | `.78rem` sans, 40 % (`:3845-3852`) |
| List | `padding: 0 var(--space-1) var(--space-1)`, `margin-right: var(--space-2)` | `0 6px 8px` (`:3828`) |
| Empty | §1.5 block, `.recent-empty` | `:3853-3858` |

The directory is metadata, not a second name: mono at `--text-xs` distinguishes it from the
file name and matches foundations §4.1 ("Mono is used for code, paths, and origin strings").
A root-level file has no directory; the meta span is omitted, not rendered empty.

### 5.3 Metadata and ordering

| Fact | Shown | Source |
|---|---|---|
| File name | yes, leading | `activity.js:377-378` |
| Directory | yes, trailing, mono | `activity.js:379-381` |
| Last-opened time | **no** | the model stores paths only (`app.js:55`, `:629-631`) |
| Recency | implied by order: first row is the most recent | `app.js:629` |
| Cap | 20 | `app.js:629` |

A time column needs `recentFiles` to become objects with a timestamp, a migration for the stored
array, and a formatter. That is a data-contract change, not a view change; it is recorded in
§11 and not built here.

### 5.4 Filter and keyboard

The filter is a subsequence match over the whole path, case-insensitive (`activity.js:343-359`).
An empty query lists everything.

| Key | Where | Action |
|---|---|---|
| `ArrowDown` / `ArrowUp` | field | move the cursor, clamped at both ends |
| `Enter` | field | open the cursor row |
| `Esc` | field | clear a non-empty filter; when empty, close the drawer on a phone and do nothing on desktop |
| `Tab` | field | leaves the view; the list is not a second tab stop |

ARIA: the field is a combobox that owns the list.

| Element | Attributes |
|---|---|
| `input.recent-filter` | `role="combobox"`, `aria-expanded="true"`, `aria-controls="recent-list"`, `aria-autocomplete="list"`, `aria-activedescendant="{cursor row id}"`, `aria-label="Filter recent files"` |
| `.recent-list` | `role="listbox"`, `id="recent-list"`, `aria-label="Recent files"` |
| `.recent-row` | `role="option"`, stable `id="recent-option-{i}"`, `aria-selected="true"` on the cursor only |

Today the field has no accessible name (a placeholder only, `activity.js:331-335`), each row is
a bare `div`, and nothing exposes the cursor (`:372-392`). The cursor class stays `.selected`
because a shipped test reads it (`tests/dom/test_dom.js:20695`).

One consequence of the listbox shape: a row is not a native button. That is the same exception
the Search results take; `controls.md` §2.16 now names Search and Recent as the two listbox
views. It keeps the field as the only Tab stop in the view.

### 5.5 Empty, cleared and phone states

| State | Copy | Note |
|---|---|---|
| No history at all | `No recent notes yet.` | shown only when `recentFiles` is empty |
| Filter matches nothing | `No recent files match.` | the query stays in the field |
| Filter cleared | full list returns; the cursor resets to the first row | `activity.js:401` |
| Cursor at a row, list re-renders | cursor keeps its index if it still exists, else resets to the first row | today the reset runs after the list is drawn, so one render has no cursor (`activity.js:374`, `:391`) |
| Phone | same list, 44 px rows, 44 px / 16 px field | §7 |

Today one string covers both empty cases (`activity.js:367`), so an empty history is reported as
a failed filter.

---

## 6. State matrix

`—` means the state cannot occur for that view.

| View | Empty | Loading | Error | No workspace | One row | Long list | Narrow panel (140) | Phone |
|---|---|---|---|---|---|---|---|---|
| **Explorer** | §1.5 block; top section hidden | `Loading files…` + `aria-busy` on first fetch | error block + `Retry`; previous tree kept | same error block (`Couldn’t load files.`) | normal | tree scrolls; gutter stable | title ellipsizes; 3 actions still fit; name truncates | drawer; 44 px rows; `…` menu; star/pin removed |
| **Pinned** | `.pinned-view-empty` block | — | — | empty block (list is per workspace) | one pin row; count `1` | list scrolls | title ellipsizes; count kept | drawer; 44 px; read-only |
| **Bookmarks** | `.bookmarks-empty` block | — | — | empty block | one row; add hidden if it is the active file | list scrolls | title ellipsizes; count + add + collapse fit | drawer; 44 px; read-only; add hidden |
| **Recent** | two copies, §5.5 | — | — | empty block (`No recent notes yet.`) | one row, cursor on it | max 20 rows; list scrolls | name truncates, meta hides first | drawer; 44 px rows; 44 px / 16 px field |

Narrow-panel arithmetic at 140: header padding 24, three 24 px actions plus 4 px of gaps = 76,
leaving 39 px for the title; the count yields nothing and the title ellipsizes. Row: 107 px
inside the row, minus 16 px icon and 8 px gap, leaves 83 for the name before row actions.

---

## 7. Phone

Owned by `docs/archive/design/mobile-shell.md` §4.3–§4.6 and `shell-frame.md` §6. This section states
only what the four views do inside the drawer.

| Item | Phone behaviour | Source |
|---|---|---|
| Host | `#side-panel` becomes a fixed drawer, `min(86vw, 340px)`, z 410, scrim z 400 | `style.css:7207-7249` |
| Header | 52 px, `padding: 0 4px 0 16px`; collapse control becomes `×`, `aria-label="Close panel"` | `style.css:7251-7263`; `mobile.js:851-865` |
| Touch sizes | Every row, header action, field 44 px minimum | `style.css:7300-7347`; controls §5 |
| Rows | 44 px, `--radius-md` 8, gap `--space-1`, name `15px` fixed | `style.css:7301-7310` |
| Tree | star and pin removed (`display: none`); `…` 44 × 44, always visible | `style.css:7317-7337` |
| Explorer empty | `No notes yet.` plus a Capture action when the role can write | `mobile-shell.md` §4.4 |
| Inline top section | still available via the header toggle; same 30 vh cap | measured |
| Bookmarks add | hidden | `style.css:7338` |
| Bookmarks / Pinned | read-only: no add, remove, reorder, or context menu | `bookmarks.js:190`, `:212`; `style.css:7317-7320` |
| Recent field | 44 px high, 16 px fixed type — below 16 px iOS zooms the viewport on focus | foundations §4.4; the shipped phone rule sets a 44 px min-height but leaves the 14 px type (§11 C5) |
| Resize | no handle; scroll edges inset 0 | `style.css:7236`, `:7298` |
| Drawer focus | lands on the view's close button after 220 ms; Recent must land on its field instead | `mobile.js:332-342`, `:353`; `activity.js:432` |
| Close | scrim, `×`, `Esc`, back; focus returns to the opener (`#mobile-title`, or `#mobile-more` from Home) | `shell-frame.md` §6.2; `mobile.js:242-248` |

What is removed on the phone, in one list: the resize handle, drag and drop, multi-selection,
every context menu, the tree star and pin, the bookmarks add button, and all editing of pins and
bookmarks. The phone shows and navigates; it does not curate.

Phone copy deltas:

| Slot | Phone string |
|---|---|
| Explorer empty | `No notes yet.` |
| Pinned empty | `No pinned folders. Pin folders on a desktop.` |
| Bookmarks empty | `No bookmarks yet. Add them from a desktop browser.` |
| Recent empty | `No recent notes yet.` / `No recent files match.` |

The Pinned and Bookmarks strings name the desktop because the phone offers no way to change
either list. That is honest, not a second feature.

---

## 8. ARIA and keyboard

### 8.1 Roles

| Element | Role / attributes | Note |
|---|---|---|
| `#file-tree` | `role="tree"`, `aria-label="Files"`, `aria-multiselectable="true"` | controls §2.16 |
| Tree row | `role="treeitem"`, `aria-level`, `aria-expanded` on folders, `aria-selected` on the active row, `tabindex` roving | exactly one row `tabindex="0"` |
| `.pinned-view-list` | `role="tree"`, `aria-label="Pinned folders"`, no `aria-multiselectable` | same row contract |
| Pin row / child | `role="treeitem"`, `aria-level`, `aria-expanded`, `aria-selected` on a child file | roots are level 1 |
| `.bookmarks-list` | no role | a group of buttons, like Sessions (`sessions.md` §7.1) |
| Bookmark button | native `<button type="button">`, `aria-current="true"` on the active file | one Tab stop per row |
| `.recent-filter` | combobox (§5.4) | owns the list |
| `.recent-list` | `role="listbox"` | options are not Tab stops |
| Row actions | `aria-label`; `aria-pressed` on the tree's two toggles; `tabindex="-1"`; the pin rows' unpin is an action with no pressed state | menu is the keyboard path |
| Header actions | native buttons, `aria-label` + `title` | `aria-busy` on refresh |
| Count chip | plain text + `.sr-only` unit | not a live region |
| Empty / error | `role="status"` / `role="alert"` | one line |

The tree contract is foundations AC9 and controls AC3; this document adds the second tree
(Pinned) and the list roles, and changes nothing about vimnav's ownership of the arrow keys.

### 8.2 Tab order

Per view: header actions in order, then the view body.

| View | Tab stops in the body |
|---|---|
| Explorer | one tree row (roving); row actions are `-1` |
| Pinned | one pin row (roving); unpin controls are `-1` |
| Bookmarks | one stop per row button |
| Recent | the filter field; the list is reached by arrows |

No positive `tabindex` anywhere (foundations §10.5 rule 1).

### 8.3 Focus rings

| Control | Offset | Why |
|---|---|---|
| Header actions | `var(--focus-offset)` | room around them |
| Tree, pin, bookmark and recent rows, row actions, phone `…` | `var(--focus-offset-inset)` | inside a scroller |
| Recent field | none; accent border + 3 px halo is the visible replacement | controls §2.4 |

### 8.4 Menu focus

`NB.menu` owns the walk (`menu.js:188-230`). Each of the four views returns focus to its opener
for `"esc"` and to the row for a picked action that keeps the row (Sessions' `onClose` hook is
the model, `sessions.md` §4.6). For a phone row menu, sidebar.js already watches `[hidden]` and
refocuses the `…` button (`sidebar.js:1094-1104`); the same behaviour is the target on desktop.

---

## 9. Tokens and CSS target

### 9.1 What `controls.md` already owns — do not restate

| Covered there | Section |
|---|---|
| Icon button box, glyph, hover, pressed, focus, tooltip | §2.2 |
| Text and search input, clear affordance, focus idiom | §2.4 |
| Badge geometry | §2.6 |
| Menu box, item, hover, danger, focus, keyboard | §2.9 |
| Empty / loading / error content | §2.15 |
| Tree and list row bases, ARIA and roving tabindex | §2.16 |
| The control and row focus rules | §3.1 |
| No hover-only action on touch | §5, AC24 |

This document supplies only the per-view numbers, the item lists, the per-view copy and the
phone deltas.

### 9.2 Token

| Token | Value | Why it cannot use an existing token |
|---|---|---|
| `--tree-indent` | `18px` | One guide cell. Named in controls §2.16, written as a literal in the shipped rules (`style.css:2806-2809`). Neither `--space-*` nor `--control-h-*` names the role. Primitives block; theme-independent. |

This token is declared in the foundations primitives block; the table records why. This document
does not declare it again.

Shell-local, declared on `#sidebar`, in the `--te-*` model:

```
--explorer-top-max: 30vh
```

It is a ratio of the viewport, used by exactly two rules (`style.css:2854`, `:2900`), and it is
not a spacing step. No global token.

No colour token is added. Every colour below is `--surface-raised`, `--accent-soft`, `--accent`,
`--text-primary`, `--text-muted`, `--border`, `--border-strong`, `--danger`, `--surface-well`.

### 9.3 Rules, in landing order

Each step is one commit and shippable alone.

**Edit in place, never append.** The row and header rules replace the existing declarations at the cited lines. The phone block at `style.css:6975-7400` comes after every desktop rule in the file; a rule appended at the end would override the phone overrides. The new phone deltas go inside that block, after the rules they refine.

| # | Rule / change | Where | Effect |
|---|---|---|---|
| 1 | `--tree-indent` on the existing guide cell; list-row geometry for Pinned, Bookmarks and Recent. The Explorer row is untouched | `style.css:2806-2809`, `:2873-2893`, `:2971-2993`, `:3831-3858` | the current tree look is preserved; 30 px list rows, neutral list hover |
| 2 | Explorer header: sprite glyphs, 24 px boxes, the busy state, the missing `aria-label` | `index.html:230-233`; `sidebar.js:520-528`, `:1599-1615`; `style.css:354-381` | one header action idiom |
| 3 | Tree actions become buttons with `aria-pressed`, a focus ring and an accent on-state | `sidebar.js:173-235`; `style.css:2999-3031` | keyboard-safe, no `--warn` |
| 4 | Explorer states: loading line, error block + Retry, `aria-busy` | `sidebar.js:95-107`, `:1347-1377`; `style.css:2841` | a failed fetch is visible |
| 5 | Pinned: count, 24 px rows, unpin on hover, `Move up`/`Move down`, the section title on `--text-xs` + `--tracking-label` | `sidebar.js:592-768`; `style.css:2859-2870`, `:2917-2930` | one list, two paths to reorder |
| 6 | Bookmarks: wrapper + button row, count, `☆` add, `Move up`/`Move down`, neutral hover | `bookmarks.js:53-88`, `:170-194`, `:364-391`; `style.css:2941-2991` | native activation, drag intact |
| 7 | Recent: field, strip, clear, combobox/listbox, mono meta, split empty copy | `activity.js:320-433`; `style.css:3813-3858` | one field idiom, one keyboard model |
| 8 | Shared empty/error block rule and `scrollbar-gutter: stable` | `style.css` (grouped `:where()` rule) | one geometry; no row shift |
| 9 | Phone: 44 px targets, 16 px Recent field, 0 edge inset, no hover-gated action | `style.css:7288-7347` | meets controls §5 |
| 10 | Reduced motion: the refresh rotation and its colour transition | `style.css` | foundations §7.3 |

Exact additions. `.is-bookmarked` and `.is-pinned` are kept as paint aliases beside
`aria-pressed`; the CSS below keys off `aria-pressed`, and the JS sets both from one flag.

```css
/* 0 — the guide cell reads the foundation token; no local declaration */
.tree-guide .tcell { width: var(--tree-indent); }

/* 0b — header count, in the shipped .panel-heading (style.css:8247) */
.panel-count {
  flex: 0 0 auto;
  min-width: 2ch;
  padding: 1px var(--space-2);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font-size: var(--text-2xs);
  font-weight: var(--fw-semibold);
  text-align: right;
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

/* 1 — list-row geometry. Explorer keeps its shipped rule (style.css:2770-2792). */
.pin-row, .pin-child {
  min-height: var(--control-h-sm);
  padding: var(--space-1) var(--space-2);
  gap: var(--space-1);
  border-radius: var(--radius-xs);
}
.bookmark-row, .recent-row {
  min-height: var(--control-h-md);
  padding: var(--space-1) var(--space-2);
  gap: var(--space-2);
  border-radius: var(--radius-sm);
}
.pin-row:hover, .pin-child:hover,
.bookmark-row-wrap:hover .bookmark-row, .recent-row:hover {
  background: var(--surface-raised);
}
.pin-row.selected, .pin-child.selected,
.bookmark-row.selected, .recent-row.selected {
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: var(--fw-semibold);
  box-shadow: inset var(--stroke-2) 0 0 var(--accent);
}
.tree-row.multi-selected {
  background: var(--surface-raised);
  color: var(--text-primary);
  font-weight: var(--fw-regular);
  box-shadow: inset var(--stroke-2) 0 0 var(--accent);
}

/* 2 — scrollers */
#file-tree, .pinned-view-list, .bookmarks-list, .recent-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0 var(--space-1) var(--space-1);
  margin-right: var(--space-2);
  scrollbar-gutter: stable;
}
.bookmarks-list, .recent-list { display: flex; flex-direction: column; gap: var(--space-hair); }
.explorer-bookmarks .bookmarks-list { flex: 0 0 auto; overflow: visible; }
.bookmark-row-wrap { flex: 0 0 auto; }
/* The row is a native button now, so the UA box and type are reset. */
.bookmark-row {
  width: 100%;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* 3 — tree actions */
.tree-star, .tree-pin {
  display: none;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  align-items: center;
  justify-content: center;
  margin-left: auto;
  margin-block: calc(-1 * var(--space-1));
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
}
.tree-row:hover .tree-star, .tree-row:hover .tree-pin,
.pin-row:hover .tree-pin, .pin-child:hover .tree-pin,
.tree-star[aria-pressed="true"], .tree-pin[aria-pressed="true"] { display: inline-flex; }
.tree-star[aria-pressed="true"], .tree-pin[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--accent);
}
.tree-star:hover, .tree-pin:hover { background: var(--accent-soft); color: var(--text-primary); }

/* 4 — refresh */
#sidebar-refresh { transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); }
#sidebar-refresh:hover { background: var(--accent-soft); }
#sidebar-refresh.spinning .refresh-glyph {
  animation: sidebar-refresh-spin var(--dur-4) var(--ease-out) 1;
}
@media (prefers-reduced-motion: reduce) {
  #sidebar-refresh { transition: none; }
  #sidebar-refresh.spinning .refresh-glyph { animation: none; }
}

/* 5 — shared content state */
:where(.tree-empty, .pinned-view-empty, .bookmarks-empty, .recent-empty, .view-state) {
  padding: var(--space-6) var(--space-4);
  max-width: calc(60 * var(--space-2));
  color: var(--text-muted);
  font-size: var(--text-ui);
  font-style: normal;
}
.view-error { color: var(--danger); }

/* 6 — top section cap */
#sidebar { --explorer-top-max: 30vh; }
.pinned-folders, .explorer-bookmarks { max-height: var(--explorer-top-max); }

/* 7 — Recent */
.recent-strip { position: relative; flex: 0 0 auto; padding: var(--space-2) var(--space-3); }
.recent-filter {
  height: var(--control-h-lg);
  width: 100%;
  padding: 0 var(--control-h-body) 0 var(--space-3);
  background: var(--surface-well);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: var(--fw-regular) var(--text-ui)/var(--lh-normal) var(--font-ui);
}
.recent-filter::placeholder { color: var(--text-muted); }
.recent-filter::-webkit-search-cancel-button,
.recent-filter::-webkit-search-decoration { -webkit-appearance: none; appearance: none; }
.recent-clear {
  position: absolute;
  right: var(--space-1);
  top: 50%;
  translate: 0 -50%;
  width: var(--control-h-sm);
  height: var(--control-h-sm);
  display: grid;
  place-items: center;
}
.recent-filter:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
}
.recent-dir {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 0 0 auto;
}
.recent-row { justify-content: space-between; }
.recent-name { flex: 1 1 auto; min-width: 0; }

/* 8 — phone deltas, inside the existing mode query at style.css:6975 */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  #file-tree, .pinned-view-list, .bookmarks-list, .recent-list { margin-right: 0; }
  .recent-filter { height: var(--control-h-touch); font-size: 16px; padding-right: calc(var(--control-h-touch) + var(--space-2)); }
  .recent-clear { width: var(--control-h-touch); height: var(--control-h-touch); }
  .bookmark-row, .recent-row, .pin-row, .pin-child { min-height: var(--control-h-touch); }
}
```

The old `.recent-filter { margin: 8px 10px }` is deleted; `.recent-strip` owns the spacing.
The shipped `#sidebar-refresh:hover { background: none }` (`style.css:361`) is deleted with it.

Do not add a `:focus-visible` ring to `.recent-filter`; the border and halo are the visible
replacement (controls §2.4, foundations §10.2 rule 2).

### 9.4 JS changes, named

| Change | File | Why |
|---|---|---|
| Top toggle renders `<svg><use>` and keeps `data-mode`, `title`, `aria-label` | `sidebar.js:520-528` | foundations §9.3; `tests/dom/test_dom.js:20603` must move from `textContent` to the `<use>` href |
| Star/pin become `<button>` with `aria-pressed`, `tabindex="-1"` | `sidebar.js:173-235` | §2.8 |
| `Shift+F10` / Menu opens the row menu on the focused tree row, pin row, pin child and bookmark row | `sidebar.js` (new row key handler); `bookmarks.js` (row handler) | §2.9, §3.4, §4.5 |
| Loading line, error block, Retry, `aria-busy` on refresh; clear `.spinning`/`aria-busy` when the refresh promise settles, not only on `animationend` (never fires under reduced motion) | `sidebar.js:95-107`, `:1347-1377`, `:1599-1615` | §2.11 |
| `Move up` / `Move down` items, disabled at the ends | `sidebar.js:736-751`; `bookmarks.js:364-379` | foundations §10.5 rule 4 |
| Pinned count in the header | `sidebar.js:592-620` | §3.2 |
| Bookmarks: layout wrapper + button row (`draggable`, `data-path` and `contextmenu` stay on the button), count, `☆` add | `bookmarks.js:53-88`, `:170-194`, `:272-308` | §4.2 |
| Recent: strip, clear, combobox/listbox ids, two empty copies, cursor clamp | `activity.js:320-433` | §5 |
| Phone: `focusDrawer()` treats Recent like Search | `mobile.js:332-342` | §7 |

Tests that change with the same commit:

| Test | Assertion | Why |
|---|---|---|
| `tests/dom/test_dom.js:20603` | the top toggle's `textContent` is `🔖` | the glyph becomes a sprite `<use>` |
| `tests/dom/test_dom.js:22669`, `:22679`, `:22685` | `.tree-star` text is `☆` / `★` | unchanged — the star stays a character; listed so the next editor does not "fix" it |
| `tests/dom/test_dom.js:23063` | the tree row has `.tree-pin.is-pinned` | unchanged — the class stays as a paint alias beside `aria-pressed` |
| `tests/dom/test_dom.js:20715` | `.recent-empty` exists for a no-match query | unchanged |

No framework, no build step, no new dependency.

---

## 10. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | Every header owned by this document is 34 px, with a title, optional count, at most two actions and the collapse control last | `templates/index.html`, `bookmarks.js`, `sidebar.js`, `activity.js` | The Explorer, Pinned, Bookmarks and Recent headers measure 34 px; Explorer has exactly two actions before collapse; Pinned and Bookmarks carry a numeral count |
| **AC2** | The tree keeps its shipped geometry; list rows are 30 px | `style.css` | `#file-tree .tree-row` measures ≈22 with `3px 6px` padding and its guide strokes meet; `.bookmark-row` and `.recent-row` measure 30 at 240 px |
| **AC3** | The tree visuals are unchanged; list hover is neutral | `style.css` | In `#file-tree` hover and selection paint `--accent-soft` and the guide is unbroken; hovering a Pinned, Bookmarks or Recent row paints `--surface-raised` |
| **AC4** | The tree exposes structure and one Tab stop | `sidebar.js` | `#file-tree` is `role="tree"`; exactly one row has `tabindex="0"`; folders carry `aria-expanded`; the active row carries `aria-selected="true"`; `Enter` opens a leaf |
| **AC5** | Row actions are real buttons with state and a keyboard path | `sidebar.js`, `style.css` | In a tree row, `.tree-star` and `.tree-pin` are `<button type="button" tabindex="-1" aria-pressed>`; the star reads `★` when pressed and `☆` when not; `Shift+F10` on a row opens its menu |
| **AC6** | The Explorer's top-section toggle has three states, one glyph each, and hides an empty section | `sidebar.js`, `index.html` | `data-mode` cycles `pinned`→`bookmarks`→`none`; the glyph is a sprite `<use>`; an empty list leaves its host `[hidden]`; the label names the current mode and the next |
| **AC7** | Explorer reports loading and failure | `sidebar.js` | A pending first fetch shows `Loading files…` with `aria-busy`; a rejected fetch shows a `role="alert"` block with `Retry`, and the previous tree stays; Retry re-fetches without a reload |
| **AC8** | Pinned is one tree with a count and two reorder paths | `sidebar.js` | `.pinned-view-list` is `role="tree"`; the header shows the pin count; a row's menu offers `Move up`/`Move down`, disabled at the ends; drag still reorders |
| **AC9** | Bookmarks rows are native buttons that still drag | `bookmarks.js` | Each row is a `<button class="bookmark-row">` with `draggable` and `data-path`, inside a layout-only `.bookmark-row-wrap`; `aria-current="true"` is on the active file; the header shows the count; the menu offers `Move up`/`Move down` |
| **AC10** | Recent is one labelled combobox over one listbox | `activity.js` | The field has `aria-label`, `role="combobox"`, `aria-controls` and `aria-activedescendant`; rows are `role="option"`; `ArrowDown`/`ArrowUp` move the cursor, `Enter` opens it; the clear button appears only when the field is non-empty |
| **AC11** | Recent names both empty cases | `activity.js` | Empty history reads `No recent notes yet.`; a filter with no match reads `No recent files match.`; both keep the query |
| **AC12** | Recent shows path metadata only, and the order is the recency | `activity.js` | Each row shows the base name and, where there is one, the mono directory; rows are most-recent-first; no time is rendered |
| **AC13** | One empty/error block geometry | `style.css` | `.tree-empty`, `.pinned-view-empty`, `.bookmarks-empty`, `.recent-empty` and `.view-state` share padding, measure, size and colour; no italics |
| **AC14** | No new colour, one global token, one shell-local | `style.css` | The diff adds no hex outside the token blocks; `--tree-indent` is declared once in the foundations primitives block and used by the guide and both trees; `--explorer-top-max` stays inside `#sidebar` |
| **AC15** | The phone drawer is 44 px and read-only | `style.css`, `bookmarks.js`, `sidebar.js` | At 390 every row, header action and the Recent field measure ≥44; `.recent-filter` computes to `16px`; the star/pin and the bookmarks add button are not rendered; `…` is visible on every tree row |
| **AC16** | Opening Recent on a phone lands focus in the filter | `mobile.js` | After the drawer opens on Recent, `document.activeElement` is `.recent-filter`, not the close button |
| **AC17** | Reduced motion stops the refresh rotation and its colour transition | `style.css` | With reduce emulated, `#sidebar-refresh.spinning .refresh-glyph` has `animation: none` and the button has `transition: none` |
| **AC18** | The mockup is self-contained | `side-panel-views-mockup.html` | Opening it offline shows every board with zero network requests |

---

## 11. Conflicts and what not to build

### 11.1 Conflicts found

| # | Conflict | Evidence | This document's position |
|---|---|---|---|
| **C1** | Controls' target rows are 24 px (tree) and 30 px (list); the shipped rows are ≈22 and ≈21–26. | `controls.md` §2.16; `style.css:2771-2779`, `:2971-2980`, `:3831-3841` | The target heights apply to all four views. |
| **C2** | Controls' target hover is `--surface-raised`; the shipped tree, bookmark and recent rows wash with `--accent-soft`, so hover and selection look the same. | `controls.md` §2.16, §3.4; `style.css:2780`, `:2885`, `:2981`, `:3842` | Neutral hover; accent wash only for selection and the cursor. Sessions already does this (`sessions.md` D17). |
| **C3** | Bookmark and pin "on" states use `--warn` (amber), whose role is caution/unsaved. | `style.css:2992`, `:3012`, `:3029`; foundations §3.4 | Accent-wash face + `--accent` glyph on a pressed toggle; the bookmark row's marker is `--text-muted`. |
| **C4** | The active row paints `--accent` text on `--accent-soft`, 4.39:1 in the dark theme — under the 4.5:1 text floor at 11 px. | `style.css:2781`, `:2887`, `:2982`; `sessions.md` §3.3 | `--text-primary` + 600 + a 2 px inset accent bar. Sessions' reasoning, applied to the four views. |
| **C5** | `.recent-filter` is 32 px, `--border`, page background, no label, no clear control; the phone block never resizes it, so it stays below 16 px and iOS zooms on focus. | `style.css:3813-3823`; `controls.md` §2.4, §5; `activity.js:331-335` | 36 px / 44 px, `--surface-well`, `--border-strong`, a label, a 24 px clear button; 16 px fixed on phone. |
| **C6** | Bookmarks and pins reorder by drag only. | `bookmarks.js:265-336`; `sidebar.js:785-874`; foundations §10.5 rule 4 | `Move up` / `Move down` in each row menu; drag stays. |
| **C7** | The tree star and pin are hover-gated `span`s with a `title` and no role, no focus, no pressed state. | `sidebar.js:173-235`; `style.css:2999-3031`; `controls.md` §2.16 | Buttons with `aria-pressed`; `tabindex="-1"`; the row menu is the keyboard path. |
| **C8** | The refresh glyph spins for 500 ms and has no reduced-motion twin; foundations caps motion at 400 ms. | `style.css:375-381`; foundations §7.1, §7.3 | `--dur-4` 380 ms; `animation: none` under reduced motion; `aria-busy` carries the state. |
| **C9** | `#sidebar-collapse` carries a `title` but no `aria-label`; the frame's header pattern requires both. | `templates/index.html:232`; `shell-frame.md` §4.2 | Add `aria-label="Collapse panel"`; `mobile.js` already rewrites both on a phone (`:857-865`). |
| **C10** | The Explorer top-section glyphs are emoji `📌` / `🔖` / `▭`. | `sidebar.js:24-28`; `index.html:230`; foundations §9.3 | Sprite symbols; `nb-icon-section-none` is a new symbol for the "none" state. |
| **C11** | Recent's one empty string reports an empty history as a failed filter. | `activity.js:364-368` | Two strings (§5.5); the class name and the existing test hold. |
| **C12** | A failed tree fetch is only `console.error`; the pane stays blank with no way to retry. | `sidebar.js:1347-1377` | Error block + Retry, with the previous tree kept. |
| **C13** | The drawer's `focusDrawer()` focuses the last `.collapse-btn` 220 ms after opening; Recent's mount focuses its filter at 0 ms, so the click into Recent loses focus. | `mobile.js:332-342`, `:353`; `activity.js:430-432` | Recent is treated like Search: focus the field. |
| **C14** | `mobile-shell.md` §4.6 gives the bookmark row's selected state accent text on an accent wash — the same 4.39:1 pair as C4 — and says the row meta is `--fg-muted` sans; §4.4 asks for a chevron the tree does not have. | `docs/archive/design/mobile-shell.md` §4.4, §4.6; `style.css:7311-7315` | Selected uses `--text-primary` + the bar; meta is mono; the folder icon flip stays instead of a chevron. Update those two sections. |
| **C15** | The brief asks for Recent time metadata; the model stores paths only. | `app.js:55`, `:629-631` | No time column. Adding one needs a model migration (§5.3). |
| **C16** | Controls §2.15 centres an empty block; a side-panel list's empty line belongs where its first row would be. | `controls.md` §2.15 | Top-aligned inside the list area, same block geometry, same tokens. Recorded, not hidden. |
| **C17** | The Sessions view owns a global `.panel-heading` and a view-named `.session-total`; Pinned and Bookmarks need the same count. | `style.css:8247-8269`; `sessions.md` D16 | Add `.panel-count` using controls §2.6 count-badge geometry and leave Sessions untouched. A later edit may alias `.session-total` to it. |
| **C18** | The bookmark header add shows the filled `★`, the same glyph the list uses for a state. | `bookmarks.js:23`, `:72`; `style.css:2992` | The add action shows `☆`; the list marker stays filled. |
| **C19** | Bookmarks and Pinned are read-only on the phone, yet Pinned stays in the phone rail. | `bookmarks.js:190`, `:212`; `style.css:7317-7320`; `shell-frame.md` §6.1, C5 | Accepted. The views navigate; curation is desktop-only. The copy says so. |
| **C20** | `tests/dom/test_dom.js:20603` asserts the top toggle's glyph as text. | same | The test moves to the `<use>` href when the glyph becomes a sprite. |

### 11.2 What not to build

| Rejected | Reason |
|---|---|
| An inline empty hint in the Explorer's top section | It would make the section taller than an empty list and two shipped tests pin the hidden behaviour (`tests/dom/test_dom.js:20628`, `:20640`). The header glyph is the indicator. |
| A second "add folder" control in the Pinned header | A pin is created where the folder is. A picker would duplicate the tree, need a new dialog, and break the one-create-action rule. |
| A separate Pinned row design | A pinned folder is a folder; it uses the tree's row, icon and guide. Only the unpin affordance differs. |
| Bookmarks as cards, or a per-row border | Twenty 1 px boxes in a 240 px pane is the weight Sessions rejected (`sessions.md` §0.2). |
| A Recent timestamp column without a model | The data does not exist; a client-side "time seen" would reset on reload and disagree across devices. |
| Roving tabindex in the Bookmarks list | There is one button per row and no second control; Tab is cheap and native (`sessions.md` D13 reasoning). |
| Row actions as Tab stops in the tree | Three extra stops per row, most invisible at rest. The menu is the keyboard path. |
| A custom tooltip for truncated names | The full path is in `title`; controls §2.10 has no tooltip component. |
| A second mode switch, breakpoint or container query | Foundations §8.2; the 140 px case is solved by ellipsis and flex order. |
| A phone edit mode for pins and bookmarks | The shipped decision is read-only (C19); changing it is a requirements change, not a visual one. |
| Drag-only reorder | Foundations §10.5 rule 4; §3.3 and §4.3 add the menu pair. |

### 11.3 Unsettled

1. **Keyboard multi-select.** Ctrl/Shift-click selects several tree rows, but no key chord does.
   `aria-multiselectable="true"` therefore advertises a model that a screen-reader user cannot
   operate. `Ctrl+Space` to toggle the focused row and `Shift+Arrow` to extend are the obvious
   additions; they need a decision on vimnav's arrow ownership (`static/js/vimnav.js:289-297`).
2. **Whether Pinned and Bookmarks should be editable on a phone.** This document keeps the
   shipped read-only rule. Making them editable needs a touch reorder model and a menu, and is a
   requirements question.
3. **Whether the count chips earn their space.** They are included because the brief names a
   count and the header has one unused fact to give. The 140 px floor is the place to check it
   on a device.
4. **The star's future.** It stays a character (§2.8) to match the tests and because foundations
   §9.3 does not list it. A later icon pass may move it to the sprite and delete the text.
5. **The exact `--explorer-top-max` value.** 30 vh is shipped. It is one number on one device
   question: whether the tree still shows three rows when the top section is full.
