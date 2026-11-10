# Shell frame — topbar, activity rail, side panel, outline, phone conversion

Status: Current spec — pre-implementation.

Reference mockup: [`shell-frame-mockup.html`](shell-frame-mockup.html) — dark and light, the six
shell states (1280 expanded, panel collapsed, outline collapsed, topbar hidden, 861 boundary,
390 phone with the drawer open), plus the control-state strip for focus, hover and the resize
handle at rest / hover / drag.

**Normative source.** This document owns the frame: `#topbar`, `#activity-bar`, the `#side-panel`
frame, the `#outline-pane` frame, the desktop grid, and the phone conversion. It reads
[`foundations.md`](foundations.md) for every token and [`controls.md`](controls.md) for control
anatomy, states, focus and ARIA. It does **not** design the inside of a view: Explorer, Sessions,
Pinned, Bookmarks, Recent, Search and AI content are later documents. The workspace picker and
session picker internals are described by the archived records
[`workspaces.md`](../archive/ui/workspaces.md), [`topbar-session.md`](../archive/ui/topbar-session.md)
and [`sessions.md`](sessions.md) — source material, not current specs. This document
only places their two topbar mounts and their rail mounts. The phone behaviours are described
by `docs/archive/design/mobile-shell.md`; §6 reconciles them and §12 records every disagreement.

Where this document and `static/css/style.css` differ today, this document is the target and §9
says how the stylesheet gets there. Where this document and a shipped surface doc differ, §12
records the conflict and names which side changes. Every claim about current code cites
`file:line`.

---

## 1. The grid

### 1.1 Anatomy

```
#app  (100dvh, flex column)
├── #topbar                        46 px   --topbar-h, 0 when hidden
└── #layout  (grid, minmax(0,1fr) row)
    ├── #activity-bar              48 px   fixed, never resizes
    ├── #side-panel                240 px  the primary resizable pane
    │   ├── .panel-header          36 px   frame owns it
    │   ├── .side-panel-view       flex    view host; view owns its scroller
    │   └── .resize-handle         8 px    overlays the inner edge
    ├── #editor-pane               1fr     absorbs every change, min 0
    │   ├── #tab-bar               34 px   hosts #outline-toggle
    │   ├── #edit-bar              content-driven; 63 at 772, 119 at 861
    │   └── reader                 1fr
    └── #outline-pane              220 px  resizable on its left edge
        ├── .panel-header          36 px
        └── #outline               flex    the scroller
```

Current grid: `grid-template-columns: var(--activity-bar-width) var(--side-panel-width) 1fr
var(--outline-width)` (`style.css:215-227`). The activity bar and the outline never resize in
that rule; the side panel does. A second resize handle is installed on the outline
(`app.js:811-812`), so **two** columns resize.

### 1.2 Column contract

| Column | Token | Default | Minimum | Maximum | Resizes? | Saved key |
|---|---|---|---|---|---|---|
| Activity rail | `--activity-bar-width` | 48 | 48 | 48 | no | — |
| Side panel | `--side-panel-width` | 240 | `--shell-pane-min` 140 | `min(--side-panel-max 480, 60 % of the budget)` | pointer, keyboard | `sidebarWidth` |
| Editor | — | 1fr | 0 | — | absorbs every change | — |
| Outline | `--outline-width` | 220 | `--shell-pane-min` 140 | `min(--outline-max 520, budget − panel track)` | pointer, keyboard | `outlineWidth` |
| Topbar | `--topbar-h` | 46 | 0 | 46 | no | `hideTopbar` |

**The pane budget.** The reader must keep 352 px on desktop; below that the phone shell takes
over (`docs/archive/design/mobile-shell.md` §2.2 measures the failure at 390 px). The two panes share one
budget and never spend the reader's floor:

```
--shell-pane-budget = 100vw − var(--activity-bar-width) − var(--shell-reader-min)
panel cap   = min(--side-panel-max 480, 60 % of the budget)
outline cap = min(--outline-max 520, budget − panel track)
```

The outline takes whatever the panel leaves, up to 520. The panel keeps its 60 % ceiling so a
wide outline cannot starve it. Nothing is reallocated beyond that: at 861 with the panel at 277,
the outline caps at 184; at 861 with the panel at 140, the outline can take 321. At 1280 with
both at their caps the reader keeps 400. The 140 px floors never collide with the caps in
desktop mode, because the budget reaches the floor pair only near the phone switch.

The absolute 480 px panel cap is new. The shipped half-viewport maximum allowed 640 at 1280 —
which leaves a 392 px reader — and 1280 px on a 2560 screen. A navigation panel does not need to
grow with the monitor.

The current JS clamps the panel to half the viewport and the outline to a flat 520 during a drag
only (`app.js:819-821`, `:860`); a saved width is never re-clamped when the window narrows. The
`clamp()` in §9 fixes both, and `endDrag` starts persisting the requested width rather than the
rendered one (`app.js:839-842`), so a clamped drag does not overwrite the user's large-screen
width.

### 1.3 Saved keys

| Key | Type | Default | Written when | Read at |
|---|---|---|---|---|
| `sidebarWidth` | number (px) | 240 | drag end, expand | boot inline style `templates/index.html:2`; `app.js:486-493` |
| `sidebarCollapsed` | bool | false | collapse, expand | same |
| `outlineWidth` | number (px) | 220 | drag end | boot inline style; `app.js:495-503` |
| `outlineCollapsed` | bool | false | header `›`, tab-bar toggle | same |
| `hideTopbar` | bool | false | Settings checkbox (`settings.js:474-477`), Mod+Shift+T (`app.js:786`) | `templates/index.html:42`, `app.js:393` |
| `activeView` | string | `explorer` | every activation (`app.js:742-745`) | server render; `activity.js` adopts it |

`activeView` is not geometry, but the collapsed-but-active state in §4.6 depends on it: the rail
keeps the saved view lit while the panel is at zero width.

### 1.4 State matrix

| State | Topbar | Rail | Side panel | Outline | Editor | Set by |
|---|---|---|---|---|---|---|
| Expanded | 46 | 48 | 240 or dragged | 220 or dragged | rest | default |
| Panel collapsed | 46 | 48 | **0**, children hidden | unchanged | wider | rail icon toggle, header `‹` |
| Outline collapsed | 46 | 48 | unchanged | **0**, children hidden | wider | header `›`, `#outline-toggle` |
| Both collapsed | 46 | 48 | 0 | 0 | full width | both above |
| Topbar hidden | **0**, not rendered | 48, workspace mount appears | unchanged | unchanged | 46 px taller | Settings, Mod+Shift+T |
| Phone | 52 + top inset | bottom bar 56 + bottom inset | drawer, 0 when closed | **removed** | single column | media query |
| Auth locked | 46, dimmed to .25 | blurred | blurred | blurred | blurred | `body.auth-locked` |
| No view | 46 | 48 | header + empty line | unchanged | unchanged | mount failure or no registration |

---

## 2. Topbar

### 2.1 Anatomy

```
#topbar  46 px, padding 0 12, gap 12, --surface-panel, 1 px --border
┌──────────────────────────────────────────────────────────────────────────┐
│ [mark Field Notes] │ [▦ Lab notebook ▾] │ [▤ Bench tests ▾]   ···  [✎] [✎] │
└──────────────────────────────────────────────────────────────────────────┘
  identity             context                                  actions
```

| Zone | Members | Rule |
|---|---|---|
| Identity | `#brand` | Always present. Yields width first. Never moves. |
| Context | `#workspace-bar` chip, `#session-bar` chip, one divider before each | Picker mounts only. Absent with no workspace, no session, or an unauthenticated visitor. |
| Actions | `#hybrid-toggle`, `#edit-toggle` on desktop; `#back-btn`, `#mobile-title`, `#hybrid-toggle`, `#mobile-capture`, `#mobile-more` on phone | Right-aligned. Never shrink, never wrap, never enter a menu. |

`.topbar-spacer` is the flexible gap between context and actions (`style.css:190`). It never
holds a control.

Spacing:

| Part | Value | Today |
|---|---|---|
| Height | `--topbar-h` 46 | same (`style.css:164`) |
| Padding | `0 var(--space-3)` | `0 12px` (`:165`) |
| Zone gap | `var(--space-3)` | `gap: 12px` (`:163`) |
| Action gap | `var(--space-1)` | `gap: 6px` (`:189`) |
| Divider | 1 × `var(--space-4)`, `--border` | 1 × 16 (`:7854-7862`) |
| Bottom border | `var(--stroke-1) var(--border)` | same (`:167`) |
| Surface | `--surface-panel` | same (`:166`) |

### 2.2 Brand

A button whose visible text is the site title and whose click reloads content from disk
(`templates/index.html:112`).

| Property | Value | Note |
|---|---|---|
| Type | `--text-ui-lg`, `--fw-bold`, tracking `.3px` | `.3px` stays local (foundations §4.2) |
| Colour | `--text-primary` | Drops the current `opacity: .9` (`style.css:178`), which dims text for no state |
| Box | transparent, no border, padding `var(--space-1)` | keeps the hit ≥24 |
| Mark | `--icon-md` 16 | current `1.1em` (`:186`) |
| Gap | `var(--space-1)` | 6 → 4 |
| Max width | 40 % of the bar | same (`:183`) |
| Shrink | `flex: 0 4 auto` — yields four times faster than a chip | new; makes the priority explicit |
| Floor | mark + gap + padding = 28 px | the mark alone survives |
| Overflow | the **text** ellipsizes, the mark never clips | requires a `<span class="brand-text">`; an `inline-flex` button cannot ellipsize a bare text node, which is the shipped hard-clip (`topbar-session.md:462`) |
| Accessible name | the visible title, plus a hidden ` — reload content from disk` | replaces `aria-label="Reload content from disk"` (`:112`), which hides the visible word and breaks controls §2.1 |
| Hover | underline on the text, `text-decoration-color: --text-muted` | no face, no colour change: the brand is not a link |
| Focus | ring, offset 2 | |

### 2.3 Chip mounts

Both chips are secondary buttons at `--control-h-md` (30), `--radius-sm`, `--surface-raised`,
`1px --border-strong`, `0 var(--space-2)` padding, `--text-ui` 600, glyph `--icon-sm`.
Their internals stay owned by `workspaces.md` and `topbar-session.md`.

| Picker | Topbar mount | Rail mount | Exactly one visible |
|---|---|---|---|
| Workspace | `#workspace-bar` → `#workspace-switch` (`index.html:130-150`) | `#workspace-rail-btn` (`:198-203`) | desktop: yes. The rail mount is `display:none` and only `body.topbar-hidden` shows it (`style.css:7887-7889`). |
| Session | `#session-bar` → `#session-switch` (`:157-171`) | none, deliberately | topbar only; it disappears with the bar (`topbar-session.md:52`) |

Rules:

1. The divider lives inside the chip's own wrapper or immediately before it, so hiding the chip
   hides the divider. The workspace divider is a sibling of `#workspace-bar` inside the same
   server gate; the session divider is inside `#session-bar` (`index.html:158`).
2. The phone hides both dividers and forces the topbar visible (`style.css:8198`, `:7015`), so
   the chip is the phone's only workspace control.
3. A chip with no name (session model absent, workspace absent) is not rendered. Never render an
   empty trigger or a stray divider (`topbar-session.md:414`, `workspaces.md:139`).
4. A long name ellipsizes; `title` carries the full name and, for the workspace, the path. Both
   triggers cap at 240 px (`workspaces.md`; `style.css:7944`); the workspace wrapper also caps at
   240 (`:7850`). Moving the cap off the trigger would break
   `tests/browser/test_core_ui_browser.js:2173`, so it stays.
5. The chip's accessible name starts with `Workspace: ` / `Session: ` from the hidden prefix
   already in the markup (`index.html:137`, `:163`).
6. A missing workspace folder keeps the chip usable and marks the glyph `--warn`; the rail mount
   has no room for the word, so the reason lives in `title` and the popover
   (`workspaces.md:437-440`).

### 2.4 Actions

| Order | Control | Desktop | Phone | Visible when | Disabled / hidden |
|---|---|---|---|---|---|
| 1 | `#back-btn` | **hidden** | shown | phone only | disabled with no history: `--text-muted` at `--opacity-disabled`, `cursor: default` |
| 2 | `#mobile-title` | hidden | shown, flex 1 | phone | — |
| 3 | `#hybrid-toggle` | shown | shown | a note is open **and** the role can write (`hybrid.js:9060-9061`) | hidden otherwise; `aria-pressed` reflects the mode |
| 4 | `#mobile-capture` | hidden | shown | phone, role can write (`mobile.js:844-849`) | hidden for a viewer |
| 5 | `#mobile-more` | hidden | shown | phone | — |
| 6 | `#edit-toggle` | shown | hidden | role can write | hidden for a viewer |

Desktop icon buttons are icon buttons (controls §2.2, md): 30 × 30, transparent, `--icon-md`
glyph at `--text-muted`, hover `--accent-soft` face and `--text-primary` glyph, radius
`--radius-sm`. Glyphs: `nb-icon-pencil` for WYSIWYG and `nb-icon-code` (`</>`) for source edit —
two pencils side by side would be one control too many. They are **not** bordered boxes. Today `#topbar button` paints every one of them
as a raised bordered button (`style.css:192-202`), which puts four boxes beside two chips; the
target keeps that rule as the chips' face and overrides `.icon-btn` inside the topbar.

`#back-btn` moves to phone-only. On desktop the tab strip and browser history already navigate,
and a permanently disabled arrow is chrome with no job (`index.html:176`).

`#edit-toggle` is hidden for a viewer, by the same `canWrite` gate `#hybrid-toggle` uses. Today
it stays visible and clickable for a read-only role (`viewer.js:958-964` has no role guard).

### 2.5 Narrow desktop

The bar never overflows and never wraps. The order of loss is fixed:

| Width | What happens |
|---|---|
| ≥ 1180 | Everything at natural width. |
| 980 | Chip names sit at or under their 240 px caps; nothing clips. Component refinements elsewhere (graph summary) do not touch the shell. |
| 861–980 | The brand ellipsizes first (`flex-shrink: 4`), then the session chip (`3`), then the workspace chip (`2`). The two name spans reach 0 before their glyphs do; `.topbar-actions` is `flex: 0 0 auto`, so the actions never shrink. |
| 861 (last desktop pixel) | Brand is at its 28 px floor. Both chips are glyph + caret (~52 px each). Actions keep 64 px. Total ≈ 270 px, so the bar still has slack. |

Nothing moves into a `⋯` menu. The two chips *are* menus, and the action set is two icons; a
third menu would add a layer to reach a control that is already visible at 861.

### 2.6 Topbar hidden

`body.topbar-hidden` sets `--topbar-h: 0` and hides the bar (`style.css:170-171`). The layout
loses 46 px of chrome and gains it as reader height.

| Thing | Behaviour |
|---|---|
| Brand, both chips, both actions | Not rendered. No substitute in the topbar. |
| Workspace picker | Moves to the rail's first slot (`#workspace-rail-btn`, `workspaces.md` §4.2). CSS-only, correct on the first frame. |
| Session picker | Not available. The Sessions rail icon is the second door to the same list (`topbar-session.md:52`). |
| Edit entry | `#edit-toggle` and `#hybrid-toggle` are lost with the bar. `Mod+E` and `Mod+Shift+E` still work for a writer. |
| Recovery | **New:** a bottom-pinned rail action `#topbar-show-btn` appears only while the bar is hidden. `aria-label="Show top bar"`, `title="Show top bar (Ctrl/Cmd+Shift+T)"`, arrow keys reach it like any rail button. Clicking it clears `hideTopbar` and persists. |
| Phone | The phone forces the bar visible and restores `--topbar-h`; `#topbar-show-btn` is hidden (`style.css:7015-7016`). |

The show-topbar action is the mirror of the workspace mount: an identity mount at the top when
the bar is gone, a chrome mount at the bottom. Without it the only pointer path back is
Settings → General → Hide top bar (`templates/index.html:832`), which is two layers deep for a
control that hid itself.

### 2.7 Phone topbar

52 px + top inset, `gap: var(--space-1)`, padding `0 var(--space-1)` plus side insets
(`style.css:6994-7000`).

| Order | Control | Size | Note |
|---|---|---|---|
| 1 | workspace chip | 44 × 44, glyph `--icon-xl` | name clipped to `.sr-only`; caret hidden (`style.css:8198-8222`) |
| 2 | `#back-btn` | 44 × 44 | |
| 3 | `#mobile-title` | 44 high, flex 1, min 0 | note basename at 16 px / 600, ellipsis; opens the drawer (`mobile.js:150-159`, `:1134-1139`) |
| 4 | `#hybrid-toggle` | 44 × 44 | writable note only |
| 5 | `#mobile-capture` | 44 × 44 | writable role only |
| 6 | `#mobile-more` | 44 × 44 | opens the note menu |

The chip leads. It keeps the same position it has on desktop, so the control does not move when
the shell flips; back sits next to the title it acts on. `mobile-shell.md` §4.1 predates the
workspace chip and lists back first; §12 C4 records the update.

### 2.8 Auth locked

`body.auth-locked` dims `#app` to .25 and blurs the rail, panel, editor and outline by 6 px,
while the topbar and the auth overlay stay at full opacity and full pointer access
(`style.css:2324-2332`). The phone dims the topbar and hides its per-note actions
(`:7075-7080`). The auth dialog is the only focusable layer (`NB.dialog`). Nothing about the
frame changes; do not add a second lock treatment.

---

## 3. Activity rail

### 3.1 Order

| # | Slot | Id / data-view | Glyph symbol | Mounted | Phone |
|---|---|---|---|---|---|
| 1 | top, pinned | `#workspace-rail-btn` | `nb-icon-workspace` | topbar hidden only | hidden |
| 2 | views | `explorer` | `nb-icon-files` | eager, server-rendered host | shown |
| 3 | views | `sessions` | `nb-icon-sessions` | host ships, filled by `sessions.js` | **hidden** (`style.css:8515-8516`) |
| 4 | views | `pinned` | `nb-icon-pin` | lazy on first activation | shown |
| 5 | views | `bookmarks` | `nb-icon-bookmark` | host ships, filled by `bookmarks.js` | shown |
| 6 | views | `recent` | `nb-icon-clock` | lazy | shown |
| 7 | views | `search` | `nb-icon-search` | lazy | shown |
| 8 | views | `ai` | `nb-icon-sparkle` | lazy | **hidden** (`:7189-7196`) |
| — | spacer | `.activity-bar-spacer` | — | — | hidden (`:7189`) |
| 9 | bottom | `#topbar-show-btn` | `nb-icon-topbar` | topbar hidden only | hidden |
| 10 | bottom | `#activity-graph-btn` | `nb-icon-graph` | action | hidden |
| 11 | bottom | `#logout-btn` | `nb-icon-logout` | auth on | hidden |
| 12 | bottom | `#activity-settings-btn` | `nb-icon-gear` | action | hidden |

View order is registration order in `static/js/activity.js:1317-1360`, and `renderBar()` renders
into `.activity-bar-views` after the pin (`activity.js:96-112`). The static actions live in the
markup (`templates/index.html:198-212`). The seven views are the set; a new view appends.

The split is structural, not visual: **views** select a panel and carry an active state;
**actions** fire once and never take `aria-pressed`. `.activity-action.active::before` is already
suppressed (`style.css:279`).

### 3.2 Geometry

| Property | Desktop | Phone |
|---|---|---|
| Column | `--activity-bar-width` 48, `--surface-panel`, right border | full width, `height: calc(var(--m-rail-h) + env(safe-area-inset-bottom))`, top border |
| Button | 36 × 36 (`--control-h-lg`), radius `--radius-sm` | `flex: 1 1 0`, height 56, min-width 44, radius 0 |
| Gap | `var(--space-hair)` 2 | 0 |
| Padding | `var(--space-2) 0` | insets only |
| Glyph | `--icon-lg` 17, `--text-muted`, `currentColor` | `--icon-xl` 22 |
| Hover / pressed | `--accent-soft` face, `--text-primary` glyph | `:active` `--accent-soft`, no hover |
| Active | `--accent-soft` face, `--text-primary` glyph, plus a 2 px `--accent` bar | same, bar moves to the top edge |
| Disabled | none — no view is disabled | none |

Active indicator, desktop: `position:absolute; left: calc(-1 * (var(--activity-bar-width) -
var(--control-h-lg)) / 2); top: var(--space-1); bottom: var(--space-1); width: var(--stroke-2);
border-radius: var(--stroke-1); background: var(--accent)`. The left offset is the button's own
gutter (6 px), derived rather than written. Today `left: -6px; top: 6px; bottom: 6px`
(`style.css:262-270`).

Phone: `left: 24%; right: 24%; top: 0; height: var(--stroke-2)` (`:7191-7198`).

### 3.3 Click behaviour

| State | Desktop click on the active view | Desktop click on another view | Phone |
|---|---|---|---|
| Result | Collapse the panel to 0; keep the view selected | Expand if collapsed, show the view | Open the drawer; tapping the active icon closes it |

`activate(id, true)` owns this (`activity.js:143-206`). On the phone it never touches
`sidebarCollapsed` or the width var (`:151-176`). Clicking a *different* view while collapsed
expands the panel and switches in one press (`:185-190`).

### 3.4 Keyboard model

| Key | Where | Effect |
|---|---|---|
| `Tab` / `Shift+Tab` | rail | Moves through the rail buttons in DOM order. Every button is a Tab stop, including actions. |
| `ArrowDown` / `ArrowUp` | rail | Move focus to the next / previous rail button, wrapping at the ends. New. |
| `Home` / `End` | rail | First / last rail button. New. |
| `Enter` / `Space` | rail | Activate. Native button behaviour. |

No roving tabindex. The rail is a list of independent controls, not one composite: two of them
open menus, two are one-shot actions, and seven select a view. Arrows are an accelerator, not a
second tab stop model, so there is no state to keep in sync and no existing test changes. If the
rail ever passes ~12 items, roving tabindex becomes the next step.

### 3.5 Tooltip

`aria-label` plus native `title` on every icon-only button, per controls §2.10. No custom
tooltip. `title` may restate the label; it may not be the only name, and it may not carry a fact
the user must have to act.

### 3.6 Badge

There is none today. A badge **may** exist only as a count of pending items in a view (an
unread AI reply, say). When one is added it follows controls §2.6: `--text-2xs` numeral,
`--radius-pill`, no fill, `--accent` or `--danger` text, positioned inside the 36/44 box without
shifting the glyph, and the count is repeated in the button's accessible name. Colour alone is
never the signal. No badge may be attached to an action.

### 3.7 Empty and locked rail

- No view registered: the views container is empty, the spacer takes the space, and the panel
  collapses to 0. The frame's no-view state (§4.7) still renders if a host exists.
- Unauthenticated with auth on: the server renders no workspace mount (`templates/index.html:113-123`);
  `activity.js` still registers and injects the seven view buttons (`:1319-1368`), and the
  auth-locked CSS disables the app. The doc's target is a rail with no view buttons in that
  state; it is a JS gate, not a server one.
- Viewer: identical chrome; capture is absent, edit is hidden.

---

## 4. Side-panel frame

### 4.1 Anatomy

```
#side-panel   width var(--side-panel-width), --surface-panel, right border, position:relative
┌──────────────────────────────────────────┬─┐
│ .panel-header   36 px, z 20              │ │
│   h2#panel-title        .panel-header-   │ │  ← 8 px resize strip,
│                          actions         │ │    bar 2 px, z 10
├──────────────────────────────────────────┤ │
│ .side-panel-view   flex 1, min-height 0   │ │
│   ┌ the view's own header? no ─────────┐ │ │
│   │ view body; the view owns its       │ │ │
│   │ scroller (.tree, .list, …)         │ │ │
│   └────────────────────────────────────┘ │ │
└──────────────────────────────────────────┴─┘
```

### 4.2 Header

One header **pattern**, one node per view. Today every view builds its own
(`activity.js:322-328`, `:447-453`, `bookmarks.js:58-79`, `sessions.js:132-162`, `ai.js:2252-2284`,
`sidebar.js:597-603`) — seven copies of one 36 px strip. The target keeps a node inside each view,
because the DOM tests and the phone drawer select `#<view> .panel-header .collapse-btn` and
`#<view> .panel-title` (`tests/dom/test_dom.js:20391`, `:20405`, `:20439`, `:23341`, `:34279`;
`mobile.js:339-341`, `:857`). Promoting one node to the frame would break eight selectors and the
drawer close path for no visual gain.

What changes is the markup inside each node: same title element class, same collapse control,
same order. A view may add up to two actions before the collapse control.

| Part | Value |
|---|---|
| Height | `min-height: var(--control-h-lg)` 36, one line, no vertical padding |
| Padding | `0 var(--space-3)` |
| Gap | `var(--space-2)` between title and actions; `var(--space-hair)` between actions |
| Surface | `--surface-panel`, 1 px bottom `--border` |
| Title | `<h2 class="panel-title">` with `margin: 0; font-weight: var(--fw-regular); line-height: var(--lh-tight)`; `--text-xs`, `--tracking-label`, `--text-muted`, ellipsis, `white-space: nowrap`. The reset is required: an `<h2>` without it inherits the UA 1.5 em bold block and blows the 36 px header |
| Actions | icon buttons, sm (24 × 24), glyph `--icon-md` |
| Collapse control | last action, glyph `nb-icon-chevron-left`, `aria-label="Collapse panel"`, `title="Collapse panel"` |
| Stacking | `position: relative; z-index: 20` so header buttons win over the 8 px resize strip at `z-index: 10` (local stack, foundations §6.1) |

The node stays inside the view. A view that wants a second line (Sessions' totals) puts it in
its own body, below the header.

### 4.3 View host

| Rule | Contract |
|---|---|
| Mount | First activation only. `mount(host)` is called once (`activity.js:64-71`). |
| Keep-alive | Never unmounted. `[hidden]` swaps visibility; scroll, selection and filter text survive. |
| Order | One host per view, `data-view="<id>"`, all siblings, exactly one without `[hidden]` (`templates/index.html:226-272`). |
| Size | `flex: 1 1 auto; min-height: 0; min-width: 0; overflow: hidden` (`style.css:293-300`). |
| Scroll | The **view** scrolls, never the panel. `#file-tree` and its siblings carry `overflow:auto`. The frame's `overflow: hidden` (`:290`) is the guarantee. |
| Handle inset | Each view's scroller insets `var(--space-2)` on the resize edge so the strip never covers the scrollbar (`#file-tree { margin-right: 8px }`, `:391`; `#outline { margin-left: 8px }`, `:396`). |
| Failure | A `mount()` throw is caught and logged (`activity.js:189-194`). The frame then shows the error line in §4.7. |

### 4.4 Resize

| Trigger | Behaviour |
|---|---|
| Pointer | Drag the 8 px strip on the inner edge. Live width follows the pointer. Minimum `--shell-pane-min` 140; maximum per §1.2. |
| Double-click | Reset to the default (240 panel, 220 outline) and persist. New. |
| Keyboard | Focus the separator (Tab). `ArrowLeft` / `ArrowRight` move 8 px (`--space-2`); `Shift` moves 32 px (`--space-7`); `Home` / `End` jump to min / max; `Enter` resets. New. |
| Persist | On pointer up and on every keyboard step, debounced 250 ms (`persistConfig`, `app.js:838-843`). The **requested** width is saved, not the clamped rendered width. |
| Collapsed | The strip is `display:none` (`style.css:451-452`) and not focusable. |
| Phone | No strip (`style.css:7237`). The drawer is a fixed width. |
| Cursor | `col-resize` on the strip, forced on `body.resizing` for the whole drag (`:418-421`). |

The strip is a separator, not a button: 8 px wide with a 2 px bar centred (`:403-416`). Rest bar
transparent, hover `--border-strong` (a 3:1 affordance, not the 1.39:1 `--border` used today),
drag `--accent`. Bar colour transitions at `--dur-1`; there is no transition while `.dragging`.

### 4.5 Collapse and expand

| Affordance | Where | State |
|---|---|---|
| Rail icon toggle | `#activity-bar` | Always. Clicking the active view collapses; any view click expands. |
| Header `‹` | panel header, last action | Expanded only. Desktop collapse. |
| Header `×` | same node, phone drawer | Closes the drawer. |
| `#outline-toggle` | `#tab-bar` right edge | Outline only. |
| `.expand-btn` strip | inside `#sidebar`, `:437-448` | **Retired.** The collapsed width is 0, so the strip has no area. The rail icon is the re-expand affordance (`templates/index.html:274-276`). Remove the element and its CSS when the panel next changes. |

Collapse is a width of 0 plus `[hidden]` on the children (`style.css:444-452`), not a second mini
panel. There is no hover-to-peek and no drag-to-open.

### 4.6 Collapsed but a view active

The active view id is kept, so the rail icon stays lit and re-expanding returns to the same
view (`activity.js:206-212`). The active view button carries `aria-pressed="true"` ("this view is
selected") and `aria-expanded` ("the panel is open"). When the panel is at 0 its children are
`display:none`, so the view host leaves the accessibility tree; the rail remains the control and
the button reports the collapsed state.

### 4.7 Empty, loading and error

| State | Trigger | Panel renders | Copy |
|---|---|---|---|
| View mounted | normal | header + host | — |
| No view selected | `activeId` null, no host visible | header, title "Panel" | "No view selected." one line, `--text-ui`, `--text-muted`, `role="status"` |
| Mount failed | `mount()` threw | header + inline error | "This view failed to load." + **Retry** (`sm`), `role="alert"`. Retry calls `mount(host)` again; it does not reload the page. |
| Loading | — | none | View mounts are synchronous. Search and AI own their loading states (controls §2.15). The frame never shows a spinner. |
| No file open | — | **out of scope** | The reader's welcome state owns it (`#welcome`). The frame does not change. |
| Collapsed | width 0 | nothing | — |

---

## 5. Outline pane

### 5.1 Anatomy

```
#outline-pane  width var(--outline-width), --surface-panel, left border, position:relative
┌─┬────────────────────────────────────────┐
│ │ .panel-header  36 px                   │
│ │   h2 "Outline"            [›]          │
│ ├────────────────────────────────────────┤
│ │ nav#outline[aria-label="Outline"]      │
│ │   4 px accent bar on the active row    │
│ │   H1 ─────────────────────────         │
│ │     H2 ───────────────────────         │
│ │       H3 ─────────────────────         │
└─┴────────────────────────────────────────┘
```

The 8 px resize strip sits on the **left** edge, so the list insets `margin-left:
var(--space-2)` (`style.css:392-397`).

### 5.2 Header

Same component as §4.2. Title "Outline", `--text-xs`, `--tracking-label`, `--text-muted`, one
action: `#outline-collapse`, glyph `nb-icon-chevron-right`, `aria-label="Collapse outline"`,
`title="Collapse outline (right arrow)"`. Today the button has a `title` but no `aria-label`
(`templates/index.html:592`).

### 5.3 List

| Property | Value | Today |
|---|---|---|
| Landmark | `<nav id="outline" aria-label="Outline">` | a bare `<div>` (`index.html:594`) |
| Structure | one flat `<ul>`; one `<li class="outline-item" data-level>` per heading | same (`outline.js:32-53`) |
| Indent | `12 px` per level above 1 (`--space-3`), applied as `padding-left` on the `<a>` | inline `(level-1)*12` (`outline.js:41`) |
| Row | `padding: var(--space-1) var(--space-2)`, `border-left: var(--stroke-2) solid transparent`, radius `0 var(--radius-xs) var(--radius-xs) 0` | `3px 8px`, 2 px, `0 4px 4px 0` (`:3107-3116`) |
| Type | `--text-ui`, `--text-muted`, one line, ellipsis | `.89rem` (`:3115`) |
| Hover | `--text-primary` on `--accent-soft` | same |
| Active | `--accent` text, `--fw-semibold`, `--accent-soft` face, `border-left-color: --accent`, `aria-current="location"` | `.active` class only (`:3120-3125`) |
| Container | `padding: var(--space-2) var(--space-1)`, scrolls | `8px 6px` (`:3105`) |
| Focus | inset ring, offset `--focus-offset-inset` (the list clips) | none |

The list is flat with per-level indent, not nested `<ul>`s. A screen reader gets a list of
in-page links in document order, which is what the outline is.

### 5.4 Active tracking

`computeActive()` picks the last heading whose top is above `scroller top + --topbar-h + 8 + 2`
and marks it (`outline.js:135-152`). On a change it removes the old class, adds the new one, and
scrolls the item into view with `block: "nearest"` (`:57-73`).

Rules:

1. The marker follows scroll only. Clicking a heading does not set the marker directly; the
   resulting scroll does.
2. Scroll-into-view must never move focus. `scrollIntoView` on the outline item only scrolls the
   outline scroller.
3. `aria-current="location"` changes with the class. Nothing else is announced; the outline is
   not a live region.
4. Vim's separate cursor (`.vim-cursor`) stays a visual cursor only and never becomes
   `aria-current` (`outline.js:77-121`).

### 5.5 Empty

`<div class="outline-empty">No headings</div>` at `var(--space-4) var(--space-3)`, `--text-ui`,
`--text-muted` (`outline.js:26-29`, `style.css:3126`). No illustration, no action.

### 5.6 Collapse and phone

- `#outline-collapse` in the header collapses to 0 and persists `outlineCollapsed`.
- `#outline-toggle` in the tab bar toggles the same state (`app.js:749-758`), and its `title` /
  `aria-label` and pressed state must follow. Today it has a static `aria-label="Toggle outline
  pane"` and no `aria-pressed` (`index.html:293`).
- No expand strip. The tab-bar toggle is always visible while the editor is.
- The phone removes the pane and the toggle (`style.css:7085`, `:7021`). There is no outline
  sheet; the phone reader is linear and has no tab bar.

---

## 6. Phone conversion

Owned by `docs/archive/design/mobile-shell.md`. This section states the frame's part and records the
deltas.

### 6.1 What changes

| Zone | Desktop | Phone | Source |
|---|---|---|---|
| Shell structure | 4-column grid | one column, `#layout { display:block }` | `style.css:7082-7086` |
| Topbar | 46, brand + chips + actions | 52 + top inset, chip + back + title + 3 actions | §2.7 |
| Rail | 48 left column, 36 buttons | 56 bottom bar + inset, 5 view buttons, top indicator | `:7165-7198` |
| Side panel | 240 column beside the 48 rail | off-canvas drawer `min(86vw, 340px)`, z 410 | `:7220-7242` |
| Scrim | none | `#mobile-scrim`, `--m-scrim` .45, z 400 | `:7238-7242` |
| Outline | 220 right column | removed | `:7085` |
| Tab bar | 34 | removed (DOM kept) | `:7085` |
| Edit bar | 57, wraps | 52 strip, horizontal scroll, Save/Done sticky | `:7089-7114` |
| Topbar-hidden | bar gone, rail mount appears | bar forced visible, `--topbar-h` restored | `:7015-7016` |
| Resize strips | 8 px | none | `:7237` |
| Expand strip | retired | retired | — |

Hidden but never removed: `#brand`, `.topbar-spacer`, `#edit-toggle`, `#outline-toggle`,
`#explorer-top-toggle`, `#tab-bar`, `#outline-pane`, `.activity-bar-spacer`, the graph / settings
/ logout actions, the AI rail view and host, and the Sessions rail view and host
(`style.css:7017-7021`, `:7189-7196`, `:8515-8516`).

### 6.2 Drawer

| Part | Value |
|---|---|
| Box | `position: fixed`, top 0 bottom 0 left 0, `width: min(86vw, 340px)`, `--surface-panel`, right border, safe-area padding |
| Motion | `transform var(--dur-3) var(--ease-standard)`, `visibility 0s linear var(--dur-3)` on close; reduced motion none (`style.css:7222-7233`) |
| Open | `body.drawer-open` + a history entry; scrim fades at `--dur-2` |
| Header | frame header at 52 px, title = active view, close `×` 44 (`:7250-7256`) |
| Footer | `#mobile-drawer-status` 44, origin (mono) + dot + word |
| Width exception | the Search view opens the drawer at 100 % (`:7236`) |
| Close | scrim tap, `×`, `Esc`, browser/hardware back, opening a leaf (`mobile.js:302-326`, `:1158-1166`) |

The drawer is **modal**: the scrim covers the topbar and the rail (z 400 over 100/150), so
nothing behind it is reachable by pointer. The keyboard must match. Target contract:

- On open: `role="dialog"`, `aria-modal="true"`, `aria-label` equal to the active view's title on `#side-panel` (each view keeps its own title node, so there is no single `panel-title` id to reference);
  focus moves to the first control (the Search field when the drawer view is Search, otherwise
  the header close button — as `focusDrawer()` already does, `mobile.js:332-342`).
- `Tab` / `Shift+Tab` wrap inside the drawer, using `NB.dialog`'s loop rather than a second
  implementation (`dialog.js:53-75`).
- The background frames (`#topbar`, `#editor-pane`, `#activity-bar`) are `inert` while it is
  open. Do not inert `#mobile-scrim`: it owns the tap-to-close.
- On close: remove the flags and return focus to the opener (`#mobile-title`, or `#mobile-more`
  when opened from Home — `focusOpener`, `mobile.js:240-248`).

Today the drawer has no role, no trap and no inert background (`mobile.js:344-354`); only
`visibility:hidden` on close keeps it out of the tab order.

### 6.3 Back

One rule, already shipped: the top layer closes first, then the viewer's visit stack, then
browser history (`mobile.js:317-330`). Layers in order: menu → drawer / capture / settings / edit
→ history. `Esc` uses the same path (`:1158-1166`). The shell adds nothing.

### 6.4 Orientation

One phone shell, both orientations: 52 topbar and 56 rail. The CSS has no orientation override
(`--m-topbar-h` / `--m-rail-h` are set once, `style.css:6979-6980`). `mobile-shell.md` §3.1
tabulates a 48 px topbar and rail in landscape, which the code never implemented; §12 C6
resolves it in favour of the single height.

---

## 7. Keyboard and ARIA

### 7.1 Focus order

DOM order, no positive `tabindex` (foundations §10.5):

`#topbar` (brand, chips, actions) → `#activity-bar` → panel header → active view → `#tab-bar`
→ `#edit-bar` → reader → `#outline-pane` → body-level layers.

The skip from the topbar to the rail crosses the panel because the panel is after the rail in
the DOM (`templates/index.html:192`, `:222`). That is shipped and stays.

### 7.2 Roles and attributes

| Element | Role / attribute | Key | Note |
|---|---|---|---|
| `#topbar` | `<header>` | — | |
| `#brand` | `<button type="button">`, visible name + hidden action | `Enter` | remove the `aria-label` that hides the title |
| chips | `<button aria-haspopup="menu" aria-expanded aria-controls>` | `Enter`, `Esc` | shipped and correct |
| `#activity-bar` | `<nav aria-label="Activity bar">` | arrows, `Home`, `End` | §3.4 |
| view buttons | `<button aria-pressed aria-expanded>` | `Enter` / `Space` | `aria-pressed` = this view is selected; `aria-expanded` = the panel is open. Both live on the same button |
| action buttons | `<button aria-label title>` | `Enter` / `Space` | never `aria-pressed` |
| `#side-panel` | `<aside aria-label="Side panel">` | — | the label is stable; each view keeps its own `.panel-title` node |
| `#outline-pane` | `<aside aria-label="Outline">` | — | |
| panel header | `<h2 class="panel-title">` + `.panel-header-actions` | — | one pattern per view, not one shared node |
| panel resize strip | `role="separator" aria-orientation="vertical" aria-valuenow aria-valuemin aria-valuemax tabindex="0" aria-label="Resize side panel"` | arrows, `Home`, `End`, `Enter` | `ArrowRight` grows the panel; `aria-valuetext` in px |
| outline resize strip | same, `aria-label="Resize outline"` | arrows, `Home`, `End`, `Enter` | `ArrowLeft` grows the outline; the values are the outline width |
| `#outline` | `<nav aria-label="Outline">` + `<ul>` | `Tab`, `Enter` | |
| outline active link | `aria-current="location"` | `Enter` | |
| `#outline-toggle` | `<button aria-pressed>` + one stable name "Outline" | `Enter` | pressed = pane open; owned by `tab-bar.md` §9.3 |
| drawer (open) | `#side-panel[role="dialog"][aria-modal="true"]` | trap `Tab` | §6.2 |
| scrim | `#mobile-scrim` no role, `hidden` when shut | — | pointer only |
| topbar actions | icon buttons: `aria-label` + `title`; `aria-pressed` on `#hybrid-toggle` | native | |

### 7.3 Ring placement

| Control | Offset | Why |
|---|---|---|
| Topbar buttons, chips, brand, rail buttons, header actions | `var(--focus-offset)` 2 | room around them |
| Outline links | `var(--focus-offset-inset)` −2 | the list scrolls and clips |
| Resize separator | `var(--focus-offset-inset)` −2 | an 8 px strip; an outset ring would draw over the pane edge |
| View buttons inside a drawer | inset | same as outline |

---

## 8. Responsive

| Query | Today | Target |
|---|---|---|
| `(max-width: 980px)` `:4944` | graph summary truncates | unchanged; shell untouched |
| `(max-width: 860px), ((pointer: coarse) and (max-width: 1023px))` `:6975` | mode switch to the phone shell | unchanged. The only mode switch. |
| `(max-width: 820px)` `:4952` | graph header wraps | unchanged |
| `(max-width: 720px)` `:4956` | graph depth hidden, designer compact, edit footer wraps | unchanged; inside the phone shell |
| `(max-width: 520px)` `:4972` | graph stacks, table editor full screen | unchanged |
| 861–950 | outline can be dragged to 520 and starve the reader | outline clamps to 40 % of the budget, so the reader keeps 352 |
| 861 (exact) | the bar can overflow with two long chip names | brand ellipsizes first (§2.5); no overflow |
| ≤ 860 | phone | phone |

The panel's 140 px floor is a hard floor in both CSS and JS. At 140 the header title ellipsizes
but the three actions (76 px) and the padding (24 px) still fit; the header must never wrap.

At 200 % zoom the shell does not produce horizontal scrolling on `body`: the zoom narrows the
viewport, the clamps shrink the panes, and below 860 the phone shell takes over
(foundations §10.6).

---

## 9. Tokens and CSS target

### 9.1 Token additions

These five are now declared in foundations Appendix A; this table records why each exists. Each
is a number, not a colour, so none needs a second theme declaration.

| Token | Value | Why it cannot use an existing token |
|---|---|---|
| `--shell-reader-min` | `352px` | The measured desktop reader floor (`mobile-shell.md` §2.2). No spacing token expresses "the width below which the reader fails"; `--space-*` stops at 48. |
| `--shell-pane-min` | `140px` | The pane floor, today a JS literal (`app.js:860`). Used by both the CSS clamp and the keyboard step. |
| `--side-panel-max` | `480px` | The panel's absolute cap. The shipped cap is half the viewport (`app.js:819-820`), which grows without bound on a wide monitor. |
| `--outline-max` | `520px` | The outline cap, today a JS literal (`app.js:821`). |
| `--icon-xl` | `22px` | Phone chrome glyphs are 20–22 px today (`style.css:7042`, `:7186`); the 14/16/17 ladder is desktop-only and cannot carry a 56 px rail. |

Shell-local variables declared on `#layout`, in the `--te-*` model, not global tokens:

```
--shell-pane-budget
--shell-panel-track
--shell-outline-track
```

### 9.2 Rules, in landing order

Each step is one commit and shippable alone; a stopped pass leaves the shell consistent.

| # | Rule / change | Where | Effect |
|---|---|---|---|
| 1 | Land the foundation token block (it already contains the five values this doc uses) | `style.css` primitives block | no visual change except the tokenisation |
| 2 | `#layout` tracks: budget + `clamp()` + `:has()` for the two collapsed states | replaces `style.css:215-227` | panes clamp to the reader floor; collapsed is 0 |
| 3 | `#topbar`: tokenise padding, gap, border; `.brand-text`; brand `flex-shrink: 4` with a 28 px floor; chips `3` / `2`; `.topbar-actions { flex: 0 0 auto }`; remove `opacity`; `#topbar .icon-btn` transparent 30 × 30; hide `#back-btn` outside the phone query; hide `#edit-toggle` for a non-writer | `style.css:160-213`; `templates/index.html:112` | the bar loses four boxes, gains a stable shrink order |
| 4 | Chips: height `--control-h-md`, `--border-strong`, `--text-ui`, glyph `--icon-sm`, gap `--space-1`; both wrappers stay capped at 240 | `style.css:7845-7882`, `:7987-8006` | controls meet the 3:1 boundary floor |
| 5 | `#activity-bar`: `--icon-lg`, derived indicator, `--space-*` padding; add `#topbar-show-btn` and its two visibility rules; add the sprite symbols | `style.css:231-279`; `templates/index.html:192-212`, sprite `:51-109` | one glyph size, one recovery path |
| 6 | Panel frame: unify the markup inside each view's existing `.panel-header` node; add the no-view and mount-error rows; retire `.expand-btn` | `activity.js`, `bookmarks.js`, `sessions.js`, `ai.js`, `sidebar.js`, `index.html:222-277`, `style.css:329-356`, `:437-452` | one header pattern, existing selectors and the drawer close preserved |
| 7 | Resize: `role="separator"` + valuenow + keys + double-click reset + hover `--border-strong` + focus ring; persist the requested width | `app.js:815-875`; `style.css:403-421` | both panes resize from the keyboard; no clipped persist |
| 8 | Outline: `nav` landmark, `aria-current="location"`, `--text-*` and `--space-*` rows, `aria-label` on the collapse button, `aria-pressed` on `#outline-toggle` | `outline.js:24-73`; `index.html:293`, `:589-594`; `style.css:3101-3126` | one ARIA story, tokens on every value |
| 9 | Phone: order and hides, `--icon-xl` glyphs, drawer role/trap/inert, scrim token, remove the landscape claim | `style.css:6975-7260`; `mobile.js:332-360` | the drawer is modal in fact and in the tree |
| 10 | Reduced motion: each new bar-colour and drawer transition lands with its twin in the same commit, not after | `style.css` | foundations §7.3 |

Step 2's rule, exactly:

```css
#layout {
  --shell-pane-budget: calc(100vw - var(--activity-bar-width) - var(--shell-reader-min));
  --shell-panel-track: clamp(var(--shell-pane-min), var(--side-panel-width),
    min(var(--side-panel-max), calc(.6 * var(--shell-pane-budget))));
  --shell-outline-track: clamp(var(--shell-pane-min), var(--outline-width),
    min(var(--outline-max), calc(var(--shell-pane-budget) - var(--shell-panel-track))));
  grid-template-columns: var(--activity-bar-width) var(--shell-panel-track)
    minmax(0, 1fr) var(--shell-outline-track);
}
#layout:has(#side-panel.collapsed) { --shell-panel-track: 0px; }
#layout:has(#outline-pane.collapsed) { --shell-outline-track: 0px; }
```

`#layout` already declares the row as `minmax(0, 1fr)` (`style.css:225`); only the column list
changes. The two `:has()` rules make the class on the aside the source of the collapsed track, so
a saved width of 240 does not survive as a 140 px clamp when the pane is collapsed. JS keeps
writing its current `0` (the DOM tests read `--side-panel-width` directly); the two agree.

### 9.3 JS changes, named

| Change | File | Why |
|---|---|---|
| Arrow / Home / End focus movement on the rail | `activity.js`, `renderBar()` | §3.4 |
| Persist the requested width: `cfg.sidebarWidth + sign*dx`, not the rendered `startW + dx` (`app.js:848`, `:860`) | `app.js:839-843` | a drag at the clamp must not overwrite the saved width |
| Read `--shell-pane-min` / `--outline-max` for the drag clamp | `app.js:819-821`, `:860` | CSS and JS must agree |
| `aria-valuenow` on every drag step; keyboard steps | `app.js:845-866` | separator contract |
| Mount-failure row + Retry | `activity.js:189-194` | §4.7 |
| Drawer `role` / `aria-modal` / trap / inert / return focus | `mobile.js:332-360`; `dialog.js` helper | §6.2 |
| `aria-pressed` on `#hybrid-toggle` | `hybrid.js`; `app.js` for the outline toggle (`:757-762`) | state is visual today |
| `#topbar-show-btn` click → `setHideTopbar(false)` + persist; visible only under `body.topbar-hidden` | `app.js:1281`; new listener | AC9 |
| Viewer gate: hide `#edit-toggle`, and make `Mod+E` / `Mod+Shift+E` no-ops for a viewer | `viewer.js:958-964`; `shortcuts.js:58-59` | AC18 |

Tests that must change with the same commit, because they assert the current glyphs:

| Test | Assertion | Why it changes |
|---|---|---|
| `tests/dom/test_dom.js:34563` | the brand title follows the `<img>` directly | the title moves into `.brand-text` |
| `tests/dom/test_dom.js:7090`, `:7105`, `:7168` | `#edit-toggle` text is `📝` | the glyph becomes `nb-icon-code` |
| `tests/dom/test_dom.js:20603` | the Explorer header's `.collapse-btn` toggles the top section | the node and class stay; only its markup standardizes, so no change is expected once the header stays per view |

The per-view header and the session cap are preserved precisely because
`tests/dom/test_dom.js:20391`, `:20405`, `:20439`, `:23341-23342`, `:34279`,
`tests/browser/test_core_ui_browser.js:1763`, `:2173` and
`tests/browser/test_ai_blocks_browser.js:544` select the current nodes.

No framework, no build step, no new dependency.

---

## 10. Acceptance criteria

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | The desktop grid is 48 / side / editor / outline | `style.css` | At 1280 the four columns measure 48, 240, 772, 220. No column has a literal px in the template. |
| **AC2** | Neither pane can starve the reader | `style.css` | At 861, with the panel at its floor and the outline at its remaining budget, the editor measures 352 and `body` does not scroll horizontally. With the panel at 277 and the outline at 184 the editor is also 352. |
| **AC3** | Collapse is zero width and reversible | `style.css`, `app.js` | Collapsed `#side-panel` measures 0 and has no focusable child; re-clicking the rail icon restores the saved width. |
| **AC4** | Both panes resize from the pointer and the keyboard | `app.js`, `style.css` | Each strip has `role="separator"`, `tabindex="0"`, `aria-valuenow` and its own label. On the side panel `ArrowRight` adds 8 px and `ArrowLeft` removes it; on the outline the directions reverse. `Home`/`End` hit min/max; double-click and `Enter` reset. |
| **AC5** | A clamped width does not overwrite the saved width | `app.js` | Set the panel to 420 px at 1920, narrow to 1000 where the cap is 360: it renders at 360 and `sidebarWidth` stays 420; widening back restores 420. |
| **AC6** | The topbar never overflows | `style.css`, `index.html` | At 861 with XL font scale and 60-character workspace and session names, the brand shrinks first and ellipsizes to its 28 px floor, then each chip name ellipsizes while its glyph and caret stay visible, the actions keep their box, and `#topbar.scrollWidth === clientWidth`. |
| **AC7** | The brand is a text button with a full name | `index.html` | The visible title still reads in the accessible name; the hidden suffix names the reload; `title` carries the full title when clipped. |
| **AC8** | Exactly one picker mount is visible | `style.css` | Desktop: the chip renders, the rail glyph does not. `body.topbar-hidden`: the reverse. Phone: the chip only, rail glyph none. |
| **AC9** | Hiding the topbar has a visible way back | `index.html`, `style.css` | With `hideTopbar` on, `#topbar-show-btn` is visible in the rail's bottom group; clicking it restores the bar and persists `hideTopbar: false`. The phone hides it. |
| **AC10** | The rail is one ordered, keyboard-operable list | `activity.js` | Seven view buttons in registration order, then the bottom actions; `ArrowDown` wraps from the last view to the first; exactly one view carries `aria-pressed="true"`. |
| **AC11** | Every side-panel view uses one header pattern | `activity.js`, `templates/index.html` | Each view keeps its own `.panel-header` node (so the existing per-view selectors and the phone drawer close still resolve), and all seven use the same markup: title, optional actions, 36 px. |
| **AC12** | A failed mount is visible and retryable | `activity.js` | A `mount` that throws leaves the header plus a `role="alert"` line and a Retry button; Retry re-invokes `mount` without a page load. |
| **AC13** | The outline marks the current heading for assistive tech | `outline.js` | Scrolling the reader moves `aria-current="location"` to exactly one link and scrolls it into view; focus does not move. |
| **AC14** | The outline toggle reports its state | `index.html`, `app.js` | `#outline-toggle` has `aria-pressed`, which flips with the pane; its `aria-label` does not promise the wrong action. |
| **AC15** | The phone drawer is modal | `mobile.js`, `style.css` | With the drawer open `#side-panel` has `role="dialog"` and `aria-modal="true"`; `Tab` from the last control lands on the first; the topbar, rail and editor are `inert`; closing returns focus to the opener. |
| **AC16** | The phone rail has five view icons | `style.css` | At 390 the bottom bar shows Explorer, Pinned, Bookmarks, Recent, Search. Sessions, AI, graph, settings and logout are not view buttons. |
| **AC17** | Every phone topbar target is 44 px | `style.css` | The workspace chip, back, `#hybrid-toggle`, capture and more each measure 44 × 44; the title takes the remainder and ellipsizes. `#edit-toggle` is not shown on a phone. |
| **AC18** | A viewer sees no write entry and no write shortcut | `viewer.js`, `app.js`, `mobile.js`, `shortcuts.js` | With `role="viewer"`, `#edit-toggle` and `#mobile-capture` are hidden, `#hybrid-toggle` stays hidden, and `Mod+E` / `Mod+Shift+E` do not enter an editor. |
| **AC19** | Every visible shell control draws the ring | `style.css` | Tabbing at 1280 and at 390 never lands on an unstyled control. At 1280 that includes brand, chips, rail, header actions, separator, outline links and the outline toggle; at 390 the outline controls are not rendered. |
| **AC20** | No new colour literal; shell geometry is tokenised | `style.css` | The diff adds hex only inside the token blocks; heights, paddings, gaps, radii and widths read a token or one of the three named shell-local variables. The only bare numbers are the clamp ratios (`.6`, `.4`), `0`, and `100vw`. |
| **AC21** | Reduced motion removes the new transitions | `style.css` | With reduce emulated, the drawer and the resize bar switch state instantly and completely. |
| **AC22** | The mockup is self-contained | `shell-frame-mockup.html` | Opening it offline shows both themes and every board with zero network requests. |

---

## 11. What not to build

| Rejected | Reason |
|---|---|
| A floating "restore top bar" bar over the reader | Chrome would overlay prose, which P1 forbids. The rail is the frame's one persistent surface; the action belongs there (§2.6). |
| A hover-to-peek collapsed panel | A second width state with a timer, a pointer path and a keyboard equivalent, to avoid one click. The rail icon already expands. |
| A 4–8 px "collapsed strip" with a chevron | It is the shipped `.expand-btn` (`style.css:437`), which has no area at width 0 and duplicates the rail. Retired, not redesigned (§4.5). |
| Roving tabindex across the whole rail | The rail mixes menus, one-shot actions and view selection; one Tab stop plus arrows would hide the actions from the Tab order. Arrows as an accelerator is enough (§3.4). |
| An unread count badge on the AI icon now | There is no count to show, and a badge with no model is decoration. Allowed later under §3.6. |
| A custom tooltip for rail icons | Needs a z-band above `--z-popover`, a timer, a touch path and a migration of ~40 `title` attributes (controls §2.10). |
| Moving topbar actions into a `⋯` menu at narrow widths | Nothing overflows once the brand can ellipsize; a menu would add a layer to reach two visible icons (§2.5). |
| Auto-hiding the topbar on scroll | A state the user did not ask for, with no pointer path back, and it fights `hideTopbar`. |
| An outline sheet on the phone | The phone reader is one linear column with no tab bar; a TOC sheet is a second navigation layer beside the drawer (`mobile-shell.md` §3.4). |
| A second breakpoint for "narrow desktop" | Foundations §8.2 rule 4 closes the set. The clamps and the shrink order handle 861–1180 without one. |
| A filled or accent workspace/session chip | The chips are secondary buttons; the accent is reserved for the active rail item, the primary action and links (P1). |
| A drag-only resize | Foundations §10.5 rule 4. The separator takes the keyboard contract (§4.4). |

---

## 12. Conflicts found

| # | Conflict | Evidence | This document's position |
|---|---|---|---|
| **C1** | The shipped caps are half the viewport for the panel and a flat 520 px for the outline; neither leaves a guaranteed reader width. | `app.js:819-821`, `:860`; `foundations.md` §8.1 | Replaced by the shared budget and the 480 / 520 absolute caps (`foundations.md` now lists both). |
| **C2** | `workspaces.md` §4.1 fixes the chip at 28 px and gives it `--border`; controls §2.1 makes a secondary button 30 px with `--border-strong`. | `workspaces.md:439-441`, `:430`; `controls.md` §2.1; `style.css:7871` | 30 px and `--border-strong`. The 2 px growth fits the 46 px bar and the boundary clears 3:1. Update `workspaces.md` §4.1. |
| **C3** | The chip's name is `.84rem`, which is off the type scale. | `topbar-session.md:146`; `style.css:7869` | `--text-ui` (`.86rem`). The difference is invisible; the scale stays closed. |
| **C4** | `mobile-shell.md` §4.1 orders the phone bar back → title → edit → capture → more; the workspace chip leads in the DOM and in the shipped phone rule. | `docs/archive/design/mobile-shell.md` §4.1; `style.css:8198-8208`; `workspaces.md:762` | The chip leads, then back. The chip must not move between shells; back sits next to the title it acts on. Update `mobile-shell.md` §4.1. |
| **C5** | `mobile-shell.md` §4.2 says four rail icons (Files, Bookmarks, Recent, Search); the shipped phone rail has five, because Pinned is registered and not hidden. | `mobile-shell.md` §4.2; `activity.js:1327-1352`; `style.css:7189-7196` | Five. Pinned is a first-class view and the Explorer's inline pinned section is user-configurable, so hiding the view would make pins unreachable on a phone set to Bookmarks or None. AI stays hidden. Update `mobile-shell.md` §4.2. |
| **C6** | `mobile-shell.md` §3.1 gives landscape a 48 px topbar and rail, a 70 vw/320 drawer and a 24 px gutter; the CSS has one 52/56 pair, `min(86vw, 340px)` and a 20 px gutter, and no orientation rule. | `mobile-shell.md` §3.1; `style.css:6979-6980`, `:7212`, `:6981` | One shell in both orientations: 52/56, the shipped drawer width, the shipped gutter. A 48 px topbar leaves 2 px around a 44 px target. Update `mobile-shell.md` §3.1. |
| **C7** | `mobile-shell.md` §4.2 names the Files icon `🗂`; `🗂` is the Sessions icon in the shipped registry, and Files is `📁`. | `mobile-shell.md` §4.2; `activity.js:1319`, `:1327` | Each view keeps its own symbol. Sessions never renders on a phone, so the collision cannot be seen. Symbols move to the sprite (foundations §9.3). |
| **C8** | The brand is a button styled as text; without a rule it reads as a link. | `style.css:208`; `controls.md` §2.1 | The brand is not the link variant: it keeps `--text-primary` and takes only the transparent box. Recorded in `controls.md` §2.1. |
| **C9** | `sessions.md` D12 hides the Sessions view on the phone and says the boot fallback is Explorer; `topbar-session.md` still says "the 🗂 rail icon opens Sessions" in the hidden-topbar row. | `sessions.md:210-217`; `topbar-session.md:415` | Both are true in their own state: the rail icon exists on desktop with the topbar hidden, and not on a phone. No change. |
| **C10** | The resize handle hover paints `--border` at 1.39:1 dark / 1.27:1 light, under the 3:1 UI floor. | `style.css:415`; foundations §10.1 | Hover uses `--border-strong`. The rest state stays transparent. |
| **C11** | `#topbar button` paints every action as a bordered raised button, including `.icon-btn`, and controls §2.2 classes `.icon-btn` as an icon button. | `style.css:192-202`; `controls.md` §2.2 | The shared rule stays the chips' face; `.icon-btn` inside the topbar is transparent. Nothing else uses `#topbar button` with a visible box. |
| **C12** | The brand's `aria-label` overrides the visible site title, which controls §2.1 forbids. | `templates/index.html:112`; `controls.md` §2.1 | The visible title is the name; a hidden suffix names the reload action (§2.2). |
| **C13** | A saved pane width is never re-clamped when the window narrows; the drag clamp runs only during a drag. | `app.js:486-503`, `:860` | CSS `clamp()` is authoritative at every width; JS persists the requested value. |
| **C14** | `mobile-shell.md` §4.3 says the drawer's focus returns to `#mobile-title`; `openDrawer()` is also called from Home, where the opener is `#mobile-more`. | `mobile-shell.md` §4.3; `mobile.js:240-248` | Keep `focusOpener(kind)`: title for a note, more for Home. `mobile-shell.md` gets the second case named. |

---

## 13. Unsettled

1. **Drawer containment implementation.** The behaviour is pinned (§6.2). Whether it reuses
   `NB.dialog`'s Tab loop with an explicit `inert` list or becomes a small `NB.layer` helper is
   an engineering choice. `NB.dialog.open()` cannot take the drawer as-is because it inerts every
   *body* child and the drawer lives inside `#app` (`dialog.js:37-44`).
2. **The panel header API.** `register({ title, headerActions })` is the shape this document
   assumes. Views with a second header line (Sessions totals) must move it into the body. Which
   of the seven current headers keeps a custom action set is a per-view question and belongs to
   the view docs.
3. **The exact `--icon-xl` value.** 22 matches today's rail; the topbar glyphs are 20. One value
   for touch chrome is the decision; 20 versus 22 is a visual check on a device, not a spec
   question. The mockup draws 22 in both places.
