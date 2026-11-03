# Workspace picker — design handoff

Status: implemented. The design shipped in `static/js/workspaces.js`,
`static/css/style.css`, `templates/index.html`, and the workspace routes in
`app.py`. §12 records where the shipped CSS differs from the mockup.

The placement changed after the first revision: the control is now **one
control with two mounts** — a chip in the topbar and a glyph on the activity
bar — instead of a full-width bar at the top of the side panel. §2 is the
placement rule, §1.1 records why, and §12 lists the CSS that was removed.
[`workspace-placement-mockup.html`](workspace-placement-mockup.html) is kept as
the decision record for the comparison that produced this rule; it is not
updated by later changes and the app does not follow every board in it.

Reference mockup: [`workspaces-mockup.html`](workspaces-mockup.html) — topbar
chip with the picker open, rail glyph with the topbar hidden, mount states,
Settings → Workspaces, the add dialog with an inline error, and the phone.
Theme toggle in the page header.

**Normative source.** §3 (tokens), §4 (components), §5 (copy), §7 (keyboard)
and Appendix A (CSS) are the single source of truth. The mockup illustrates
them; where the two differ, this document wins, and where this document differs
from `static/css/style.css`, the stylesheet wins.

---

## 1. What ships

One feature, four surfaces, no other UI touched:

| # | Surface | Lives in | Built with |
|---|---|---|---|
| 1 | Workspace control (two mounts) | chip: `#topbar`, after `#brand`; glyph: `#activity-bar`, above the views | static markup, server-rendered name |
| 2 | Picker popover | one node, moved to `document.body` at init | own popover, `role="menu"`, `position: fixed` |
| 3 | Add / Rename dialog | body-level overlay | `NB.dialog` for containment |
| 4 | Settings → Workspaces | new nav section | `NB.settings.onOpen` + a render function |

The Explorer tree, the pinned/bookmark sections, the panel headers, the activity
bar's view icons and the mobile drawer are **not** redesigned. The topbar gains
a 1 px divider and the chip; the activity bar gains one glyph.

### 1.1 Decisions a reviewer should sanity-check

**D1 — One control, two mounts, exactly one visible at a time.** The chip
(`#workspace-switch` inside `#workspace-bar`) sits in the topbar and is the
control whenever the topbar is on screen, because there is room there for the
name. The glyph (`#workspace-rail-btn`) sits at the top of the activity bar and
is the control only while the topbar is hidden — the state the app reaches with
`hideTopbar`, where the topbar's contents do not exist and the rail is the only
chrome left. The switch is CSS-only (`#workspace-rail-btn { display:none }` →
`body.topbar-hidden #workspace-rail-btn { display:flex }`), so a saved
`hideTopbar` paints the correct mount on the first frame with no script.

Both mounts are the same control: one popover, one expanded state mirrored onto
both, one busy state mirrored onto both. There is no second implementation to
keep in step, and no state where neither mount is reachable.

**D1a — The side-panel bar (shipped in the first revision, now removed) had
three faults.**

- It lived inside the panel, so collapsing the panel removed the only workspace
  control. The old block worked around that with
  `#side-panel.collapsed #workspace-bar { display:none }` plus a phone override
  that put it back — two rules that contradict each other and still leave the
  desktop collapsed state with no control.
- It was a panel surface, not a shell surface: it shared a column with the file
  tree, so it moved with the view and disappeared with the drawer.
- On the phone it added a 52 px row of chrome above the file list, inside a
  drawer that the user closes; the topbar is the phone chrome that is always
  there, so the workspace belongs there.

**D1b — The tab-strip chip was considered and rejected as unhostable on the
phone.** `.tab-bar` is `display: none` under the phone query
(`style.css:7102`), so a control hosted there has no phone mount at all, and the
phone would need a second mount anyway. Two further faults: `.tab-bar` sets
`overflow: hidden` and its tabs are flex-equalised, so a chip inside it is
either clipped or measured as one more tab; and the tab strip is per-note-set
editor chrome, while the workspace is the root the whole page is scoped to.

Rejected: a chip in the tab strip, a bar in the side-panel footer (bottom of the
panel: furthest from the name it acts on, and it still disappears with the
panel), and a chip in the activity bar above the views (no room for a name at
48 px, which is why the second mount is icon-only and only used when the topbar
is gone).

**D2 — The picker is its own popover, not `NB.menu`.** `NB.menu`
(`static/js/menu.js`) renders flat `{label, kbd, disabled, danger, submenu}`
buttons at a fixed viewport point. Three requirements do not fit that shape:

- the active row carries `aria-current="page"` and a check column, so the row
  needs structure, not a label string;
- the unavailable row states *why* in a second line ("Folder not found"), which
  a 170 px context menu with a `title` cannot show;
- the popover is placed against whichever of the two mounts opened it (below a
  topbar chip, beside a rail glyph), flips on overflow, and is re-placed on
  resize. `NB.menu` has one anchoring rule.

`workspaces.js` therefore follows `menu.js`'s *idioms* — one `hidden` popover,
a document click listener to close, Esc and arrow keys handled on the popover —
roughly 70 lines. Everything that *is* a modal still uses `NB.dialog`.

**D3 — Rows are navigation, not a radio group.** The active row uses
`role="menuitem"` + `aria-current="page"`, not `menuitemradio` + `aria-checked`.
Picking a workspace loads a different page; announcing "current page" is the
truth and "checked, 3 of 3" is not. The check glyph is presentational and is
hidden from assistive tech.

**D4 — Settings gets its own nav section, not a General subsection.** General
is a list of preferences (title, watching, autosave, VIM) and is already the
longest section. Workspaces is a *managed entity list* with per-row actions,
like Security (credentials) and AI (providers), which are already their own
tabs. It also grows with the number of roots, so it needs its own scrolling
pane, and `data-tab="workspaces"` gives a stable target for deep links and
tests.

**D5 — One dialog serves Add and Rename.** Same fields, same validation, same
containment. Rename hides the Folder row and replaces it with the read-only
path. Two dialogs would duplicate the error mapping in §6.

**D6 — Adding does not switch.** The dialog registers the workspace and closes;
the picker reopens with the new row focused. Switching is always an explicit
pick, because switching reloads the page and throws away the current tab set.
Auto-switching would turn "add" into a navigation the user did not ask for.

**D7 — Two text-only tokens are added.** `--fg-muted` is 4.26:1 and `--warn` is
2.7:1 on `--bg-elev` in the light theme. The picker popover (rows, the "Folder
not found" line) sits on `--bg-elev`, and the Settings rows need the same. §3.3
adds `--ws-fg-muted` and `--ws-warn` with exactly the values `#settings-overlay`
already raises locally (`--fg-muted: #9799a4` / `#5d6470`, `--stg-warn: #8a5a0b`).

---

## 2. Placement

The whole block is gated twice in `templates/index.html`: the outer
`{% if boot.workspace_id %}` decides whether the page has workspaces at all, and
`ws_interactive` (`{% if ws_interactive %}`) decides whether this session may see
the control. `ws_interactive` is false for an unauthenticated visitor while auth
is on, and the template then renders **no divider, no wrapper, no chip, no rail
glyph** — not an inert control. That matters beyond cosmetics: `api.js`
`pageRole()` treats a `#workspace-bar` that carries `data-workspaces` as the
marker of a full-access install whenever `<html data-role>` is empty — which is
exactly the auth-off shell (`static/js/api.js:19-34`). An inert wrapper rendered
for an unauthenticated visitor would therefore be read as a workspace shell if it
carried the list.

### 2.1 Mount 1 — chip, `templates/index.html:119-140`, inside `#topbar`

```html
<header id="topbar">
  <button type="button" id="brand" class="brand" …>{{ boot.site_title }}</button>
  {% if boot.workspace_id %}
    {% set ws_role = (boot.role if boot.role is defined else 'admin') or ('admin' if boot.workspaces else '') %}
    {% set ws_interactive = ws_role == 'admin' or ws_role == 'viewer' %}
    {% if ws_interactive %}
    <span class="topbar-divider" aria-hidden="true"></span>
    <div id="workspace-bar"{% if boot.workspaces %} data-workspaces="…"{% endif %}>
      <button type="button" id="workspace-switch" class="workspace-switch"
              aria-haspopup="menu" aria-expanded="false"
              aria-controls="workspace-menu"
              title="{{ ws_name }}{% if ws_path %} — {{ ws_path }}{% endif %}">
        <svg class="workspace-glyph" aria-hidden="true" focusable="false"><use href="#nb-icon-workspace"/></svg>
        <span class="sr-only">Workspace: </span>
        <span class="workspace-name">{{ ws_name }}</span>
        <span class="workspace-caret" aria-hidden="true">▾</span>
      </button>

      <!-- Rows are rendered by workspaces.js on open. The container is
           hidden and is moved to <body> at init. -->
      <div id="workspace-menu" class="workspace-menu" hidden>
        <div class="ws-menu-list" id="workspace-menu-list" role="menu"
             aria-labelledby="workspace-switch"></div>
        <p class="ws-foot">Switching reloads the page.</p>
      </div>
    </div>
    {% endif %}
  {% endif %}
  <div class="topbar-spacer"></div>
  …
```

Order is fixed: brand, divider, chip, spacer, actions. `#brand` and the chip are
the two left-hand items; `.topbar-spacer` pushes the actions right, so the chip
never drifts. `#workspace-bar` stays the node that carries `data-workspaces` and
that the popover is measured from; the popover inside it is a first-paint
placeholder only.

The divider exists because the chip is a bordered control immediately beside the
brand's text; without the rule the two read as one compound control.

### 2.2 Mount 2 — glyph, `templates/index.html:160-175`, inside `#activity-bar`

```html
<nav id="activity-bar" class="activity-bar" aria-label="Activity bar">
  {% if ws_interactive %}
  <button id="workspace-rail-btn" class="activity-btn activity-action activity-pin" type="button"
          aria-haspopup="menu" aria-expanded="false" aria-controls="workspace-menu"
          title="{{ ws_name }}{% if ws_path %} — {{ ws_path }}{% endif %}"
          aria-label="Workspace: {{ ws_name }}">
    <svg class="workspace-glyph" aria-hidden="true" focusable="false"><use href="#nb-icon-workspace"/></svg>
  </button>
  {% endif %}
  <!-- View icons are injected here by activity.js (NB.activity.register). -->
  <div class="activity-bar-spacer"></div>
  <button id="activity-graph-btn" …>🕸</button>
  …
```

The button carries `.activity-pin` because `activity.js` inserts the
`.activity-bar-views` container after it (`static/js/activity.js:97`), so the
glyph keeps the first slot however many views are registered. It is above
`.activity-bar-spacer` and therefore above the bottom-pinned actions.

### 2.3 Popover — one node, `document.body`, `position: fixed`

`#workspace-menu` is server-rendered inside the chip and **moved** (appended, not
cloned — ids and the `aria-controls` relationship survive) to `document.body`
at module init (`static/js/workspaces.js:116-121`). Three reasons one body child
is the right shape:

- `#activity-bar` is `overflow: hidden` (`style.css:239`), so a popover that is a
  child of the rail mount is clipped at 48 px;
- `#app` is `overflow: hidden` too (`style.css:154`), so the popover must sit
  outside it as well;
- one node serves both mounts. A popover per mount would need two copies of the
  row markup and two id sets.

`position: fixed` plus coordinates written by `placeMenu()` are the consequence:
the popover is not inside either mount, so it cannot be positioned by an
`absolute` percentage of a parent. §4.3 covers the geometry.

> The module header in `workspaces.js` also names `.tab-bar` as a clipping
> ancestor. That is a leftover from the rejected tab-strip option; the shipped
> chip is in `#topbar`, which does not clip. The rail and `#app` are the real
> reasons.

### 2.4 Dialog — body child, beside `#auth-overlay`

Body-level, like `#auth-overlay` and `#settings-overlay`, so `NB.dialog`'s
"inert every other body child" rule (`static/js/dialog.js:92`) works. Markup is
unchanged from the first revision (`templates/index.html:584-620`):

```html
<div id="workspace-dialog" class="settings-overlay" hidden>
  <div class="settings-modal auth-modal" role="dialog" aria-modal="true"
       aria-labelledby="ws-dialog-title" aria-describedby="ws-dialog-help" tabindex="-1">
    <div class="settings-header">
      <h2 id="ws-dialog-title">Add workspace</h2>
      <button id="ws-dialog-close" class="icon-btn" type="button" title="Close" aria-label="Close">×</button>
    </div>
    <form class="settings-body auth-form" id="ws-form" novalidate>
      <p class="auth-help" id="ws-dialog-help">Point at a folder of Markdown notes on this machine. Nothing is copied or moved.</p>

      <div class="settings-row">
        <label class="settings-label" for="ws-name">Name</label>
        <input id="ws-name" class="settings-text-input" type="text" maxlength="60"
               autocomplete="off" spellcheck="false" placeholder="Work journal">
      </div>

      <div class="settings-row" id="ws-path-row">
        <label class="settings-label" for="ws-path">Folder</label>
        <input id="ws-path" class="settings-text-input" type="text"
               aria-describedby="ws-resolved ws-error"
               autocomplete="off" spellcheck="false" placeholder="/home/you/notes">
      </div>

      <div class="settings-row" id="ws-resolved-row" hidden>
        <span class="settings-label">Will open</span>
        <span class="ws-resolved-path" id="ws-resolved"></span>
      </div>

      <div class="auth-error" id="ws-error" role="alert"></div>

      <div class="settings-form-actions">
        <button class="settings-action" type="button" id="ws-cancel">Cancel</button>
        <button class="settings-action settings-action--primary" type="submit" id="ws-submit">Add workspace</button>
      </div>
    </form>
  </div>
</div>
```

`auth-modal` (420 px wide, height auto) is reused as-is: it is exactly the
two-field, one-error-line shape this needs, and it already sizes to content.

### 2.5 Settings — new nav item and section

Nav item, after General (`templates/index.html:650`):

```html
<button class="settings-nav-item" role="tab" data-tab="workspaces"
        aria-selected="false" aria-controls="settings-section-workspaces">
  <span class="nav-icon" aria-hidden="true">📚</span>Workspaces</button>
```

Section, after `#settings-section-general` closes (`templates/index.html:721`):

```html
<section class="settings-section" data-section="workspaces" id="settings-section-workspaces" hidden>
  <h3>Workspaces</h3>
  <p class="settings-help">Each workspace is a folder of notes on this machine. Add one per project;
    the server remembers which one you are in for this session.</p>
  <div id="settings-workspace-list" class="ws-list" role="list"></div>
  <div class="settings-row ws-add-row">
    <button class="settings-action ws-add" type="button" id="settings-workspace-add">+ Add workspace…</button>
  </div>
  <p class="settings-note">Switching reloads the page. Removing a workspace never deletes its notes.</p>
</section>
```

`settings.js` needs no change: `navItems` and `sectionEls` are queried at load,
so a seventh tab works as soon as it is in the markup. The list fills from
`NB.settings.onOpen`.

### 2.6 Script

`<script src="/static/js/workspaces.js" defer></script>`
(`templates/index.html:1905`). It reads `NB.settings` at load, and `settings.js`
is already parsed by then.

The sprite symbol `#nb-icon-workspace` (`templates/index.html:91-95`) is shared by
both mounts, drawn in `currentColor`:

```html
<symbol id="nb-icon-workspace" viewBox="0 0 16 16">
  <rect x="2.4" y="4.4" width="9.4" height="9.2" rx="1.8" fill="none"
        stroke="currentColor" stroke-width="1.3"/>
  <path d="M5 3.2h6.4a1.6 1.6 0 0 1 1.6 1.6v6.4" fill="none"
        stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
</symbol>
```

Two stacked cards, not a folder: the sidebar is full of folder icons and the
workspace is the container *of* folders. `currentColor` lets it follow
`--fg-muted` → `--fg` → `--ws-warn` without new colours.

---

## 3. Tokens

### 3.1 Reused, no change

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--bg-panel` | `#22232a` | `#f6f7f9` | topbar and activity bar background behind the mounts |
| `--bg-elev` | `#2a2b34` | `#eceef2` | chip face, popover, settings row |
| `--fg` | `#e6e6ea` | `#1f2330` | chip name, popover row labels |
| `--fg-muted` | `#8b8d98` | `#5d6470` | glyph, caret, dialog labels |
| `--accent` | `#7c9cff` | `#2f5fd0` | check, active row text, focus ring, chip open border |
| `--accent-soft` | `rgba(124,156,255,.18)` | `rgba(47,95,208,.12)` | hover and open fill |
| `--border` | `#383a45` | `#d8dde4` | divider, chip edge, popover edge, row edge |
| `--danger` / `--danger-soft` | `#ff6b6b` / 15 % | `#c0392b` / 12 % | Remove (hover), inline error |
| `--code-bg` | `#14151a` | `#f0f2f5` | dialog inputs, resolved-path chip |
| `--accent-fg` | `#14151a` | `#ffffff` | primary button label |

The chip takes `--bg-elev` background, `1px solid var(--border)` and `6px`
radius from the shared `#topbar button` rule; it owns only its height, padding
and font size (§4.1).

Radii, shadows and the popover look are copied from the context menu: `8px`
radius, `0 8px 24px rgba(0,0,0,.35)`. The modal is the existing
`.settings-modal` (`12px`, `0 20px 60px rgba(0,0,0,.5)`).

Spacing inside the modal uses the existing `#settings-overlay` scale
(`--stg-space-1…6`, `--stg-radius-sm/md`, `--stg-focus-ring`). The dialog is
outside `#settings-overlay`, so it repeats `2px solid var(--accent)` literally —
it is the same ring.

### 3.2 New, scoped to `.workspace-menu`

```css
.workspace-menu {
  --ws-row-h: 32px;                    /* picker row; 44px on the phone */
  --ws-pop-width: 300px;               /* phone: min(320px, 100vw - 16px) */
}
```

The tokens live on the popover, not on `#workspace-bar`: the popover is moved to
`<body>` and stops inheriting from either mount. The chip needs no local tokens;
its sizes are literals in the mount rules because they are the topbar's, not the
popover's.

### 3.3 New, theme tokens (two declarations per theme block)

```css
:root                    { --ws-fg-muted: #9799a4; --ws-warn: #f3b454; }
body[data-theme="light"] { --ws-fg-muted: #5d6470; --ws-warn: #8a5a0b; }
```

| Pair | Ratio | Verdict |
|---|---|---|
| `--ws-fg-muted` on `--bg-elev` (dark) | 4.9:1 | passes AA for 13 px text |
| `--ws-fg-muted` on `--bg-elev` (light) | 5.1:1 | passes |
| `--ws-warn` on `--bg-elev` (dark) | 7.7:1 | passes |
| `--ws-warn` on `--bg-elev` (light) | 5.1:1 | passes |
| `--accent` on `--bg-elev` (dark) | 5.4:1 | passes (active row name, Active badge) |
| `--accent` on `--bg-elev` (light) | 4.93:1 | passes, with no headroom |
| `--fg-muted` on `--bg-panel` (dark) | 4.7:1 | passes (glyph on both mounts, dialog labels) |

`--fg-muted` on `--bg-elev` is the only failing pair (4.26:1) and is not used
there. Icons are non-text and only need 3:1, but the caret and glyph sit on
`--bg-elev` (chip) or `--bg-panel` (rail) at ≥4.7:1 anyway.

Two consequences of the 4.93:1 light-theme `--accent` row:

- **Badges are outline pills, never filled.** `--accent` text on an
  `--accent-soft` fill is 4.18:1 in the light theme. All three badges are
  `transparent` + 1 px border + coloured text, so the label always sits on
  `--bg-elev`.
- **The current picker row does not fill on hover.** Same wash, same 4.18:1.
  It already reads as current (check + accent), so it needs no hover feedback;
  picking it simply closes the menu.

---

## 4. Components

Both mounts are one control. The tables below are per mount; §4.3 is the shared
popover.

### 4.1 Mount 1 — topbar chip

**Anatomy:** `#workspace-bar` wrapper (`display:flex`, `flex: 0 1 auto`,
`min-width: 0`, `max-width: 240px`) holding one button. Button: 28 px tall,
`0 8px` padding, 6 px gap, 12 px glyph · name · caret, `.84rem` 600, `6px`
radius. Preceded by `.topbar-divider` (1 × 16 px, `--border`, `align-self:
center`). The topbar's own `gap: 12px` supplies the space on both sides of the
divider, so the visual gap brand→divider→chip is 12 px + 1 px + 12 px.

| State | Treatment |
|---|---|
| default | face `--bg-elev`, 1 px `--border`, glyph + caret `--fg-muted`, name `--fg` |
| hover | `#topbar button:hover`: face `--accent-soft`, border `--accent` (inherited, not overridden) |
| open (`aria-expanded="true"`) | `--accent-soft` face + `--accent` border; glyph → `--fg`; caret rotates 180° (120 ms, none under `prefers-reduced-motion`) |
| focus-visible | `2px solid var(--accent)`, `outline-offset: 1px` — outset, which is safe because the topbar does not clip |
| busy (`aria-disabled="true"`) | no authored change; `pickerBusy` refuses to reopen and the rows are inert. The popover states the wait (`aria-busy` on the list) |
| active folder missing | `.is-missing`: glyph `--ws-warn`, a `⚠` (`.8rem`, `--ws-warn`) inserted before the caret, `title` = "{name} — folder not found: {path}". The chip stays usable; the picker is the way out |
| long name | `.workspace-name` ellipsizes (`overflow:hidden` + `text-overflow:ellipsis` + `nowrap`); the wrapper's 240 px cap leaves ~180 px for the name. `title` carries the full name and path |
| viewer (session role `viewer`) | identical chrome; the popover simply has no Add row (§4.3) |
| unauthenticated | nothing is rendered — no wrapper, no chip (§2) |
| no workspace on the page | nothing is rendered (outer `boot.workspace_id` gate) |

The chip's height is fixed at 28 px so it sits inside the 46 px topbar without
stretching to the row height; the topbar's other buttons are padding-sized, so a
stretched chip would read as a bar.

### 4.2 Mount 2 — activity-bar glyph

**Anatomy:** an `.activity-btn` (36 × 36, 6 px radius) carrying `.activity-pin`
and `.activity-action`, holding an 18 px glyph. No name, no caret: the rail is
48 px wide and the topbar is the mount that carries the name. Accessible name
`Workspace: {name}`; `title` "{name} — {path}".

| State | Treatment |
|---|---|
| default | `display: none` — the chip is the control while the topbar is on |
| topbar hidden (`body.topbar-hidden`) | `display: flex`; glyph `--fg-muted` on `--bg-panel`; hover `--accent-soft` face + `--fg` glyph (`.activity-btn:hover`) |
| open (`aria-expanded="true"`) | `--accent-soft` face, `--fg` glyph |
| focus-visible | **no authored rule.** It inherits the browser's default button ring, like every other `.activity-btn`. Accepted as a known gap (§10) |
| busy (`aria-disabled="true"`) | no authored change; `pickerBusy` refuses to reopen |
| active folder missing | `.is-missing`: glyph `--ws-warn`; no `⚠` (there is no room for one), so the reason lives in `title` and in the popover's second line |
| phone | `display: none` under the phone query, even with the topbar hidden — the phone forces the topbar visible (§8) |

One glyph for both mounts is deliberate: the same control at two addresses, not
two features.

### 4.3 Popover — geometry, then rows

**Box:** `position: fixed`, `width: 300px` (`--ws-pop-width`),
`max-height: min(70vh, 420px)`, `overflow-y: auto`, 4 px padding,
`--bg-elev`, 1 px `--border`, 8 px radius, `0 8px 24px rgba(0,0,0,.35)`,
`z-index: 200`. Defaults are `top: 0; left: 0`; `left` and `top` are written as
pixel values before the popover is painted.

**Placement** (`placeMenu()`, `static/js/workspaces.js:402-425`), with
`POP_GAP = 6` and `POP_MARGIN = 8`:

| Case | Rule |
|---|---|
| opened from the chip | `left = chip.left`, `top = chip.bottom + 6` — below, left edges aligned |
| opened from the rail glyph | `left = rail.right + 6`, `top = rail.top` — to the right, tops aligned |
| rail glyph, right overflow (`left + width > vw - 8`) | `left = rail.left - width - 6` — flips to the left of the rail |
| bottom overflow (`top + height > vh - 8`), either mount | `top = mount.top - height - 6` — flips above and clears the mount |
| after the flip | `left` clamped to `[8, vw - width - 8]`, `top` to `[8, vh - height - 8]` |

Order matters: the width and height are read after the rows are rendered, so the
flip test uses the real height — a six-row list flips where a one-row list does
not. The chip mount never flips sideways; on a narrow viewport the clamp slides
it left so it stays 8 px inside the right edge. The rail's left-flip branch is
unreachable as shipped: it needs `rail.right + 6 + 300 > vw - 8`, i.e. a viewport
under ~354 px, and every width that narrow is in the phone query, which hides the
rail glyph. It is kept in the code; this document records it as unreachable
rather than claiming it runs.

**Behaviour:**

| Event | Result |
|---|---|
| open | rows rendered, then `placeMenu()`, then focus on the current row (or the first usable one) |
| window resize | re-placed against the mount that opened it |
| page scroll (capture, any scroller) | closed, focus not moved. Scrolling the popover's own list does not close it |
| click outside both mounts and the popover | closed, focus not moved |
| focus leaves both mounts and the popover | closed, focus not moved (checked on a `setTimeout(0)` so a transient re-render does not count) |
| `Esc` | closed, focus returns to the mount that opened it |
| pick the active row | closed, focus returns to the mount |

The popover is measured against `getBoundingClientRect()` of the mount, so it
follows the mount through layout changes only when it is placed — hence the
resize hook and the close-on-scroll rule. The `z-index: 200` band sits above the
topbar (`100`) and the phone bottom rail (`150`), below the phone scrim (`400`),
the phone drawer (`410`) and every modal (`2000`).

**Rows:** `display:flex; gap:8px; min-height:32px; padding:6px 8px; radius:5px`.
A 14 px check column, then the name. Only rows that need a second line get one.

| Row | Markup | Look |
|---|---|---|
| active | `role="menuitem"` + `aria-current="page"` | ✓ in `--accent`, name `--accent` 600; no hover fill (picking it just closes the menu) |
| normal | `role="menuitem"` | name `--fg`, hover `--accent-soft` |
| unavailable | `role="menuitem"` + `aria-disabled="true"` + `tabindex="-1"` | name `--ws-fg-muted`, second line "Folder not found" `--ws-warn`, `⚠` right-aligned `--ws-warn`, no hover fill, `cursor: default`, `title` carries the path |
| add | `role="menuitem"`, rendered only for `admin` | `+` in `--accent` in the check column, "Add workspace…" |
| separator | `<hr class="ws-sep" role="separator">` | 1 px `--border`, 4px 2px margins, only when the add row follows |
| footnote | `<p class="ws-foot">` **outside** the `role="menu"` node | "Switching reloads the page." `.76rem` `--ws-fg-muted` |

The footnote is a sibling of the menu, not a child: a `<p>` is not a permitted
child of `role="menu"`. It is the visible half of "this is a navigation"; the
`aria-current="page"` is the other half.

Disabled rows are *not* focusable through the roving tabindex and are skipped
by arrow keys, so keyboard users never land on a dead row; the reason is in the
visible second line for everyone else.

### 4.4 Settings → Workspaces

**Row** (`div.ws-row`, `role="listitem"`): `--bg-elev`, 1 px `--border`, 8 px
radius, `8px 10px` padding, `10px` gap. Left: a `.ws-row-main` button holding a
14 px check column plus a name line (`.95rem` 600, optional badges) and a path
line (`.8rem` mono, `--ws-fg-muted`, `overflow-wrap:anywhere`). Right:
`Rename` and `Remove`.

The main button has `padding:4px 6px; margin:-4px -6px` so its hover fill stops
just inside the card edge instead of bleeding to it.

```html
<div class="ws-row is-active" role="listitem">
  <button type="button" class="ws-row-main" aria-current="page">
    <span class="ws-row-check" aria-hidden="true">✓</span>
    <span class="ws-row-text">
      <span class="ws-row-name"><span class="ws-row-label">Notes</span>
        <span class="ws-badge">Active</span>
        <span class="ws-badge ws-badge--default">Default</span></span>
      <span class="ws-row-path">/home/shaun/projects/notebook</span>
    </span>
  </button>
  <div class="ws-row-actions">
    <button class="settings-action ws-btn" type="button">Rename</button>
    <button class="settings-action ws-btn ws-btn--danger" type="button" disabled
            title="The default workspace can't be removed.">Remove</button>
  </div>
</div>
```

The current row is **not** `disabled`: `aria-current="page"` plus a no-op click
keeps it in the tab order and lets a screen reader announce "current page".
Only the missing-folder row is `disabled`.

| State | Treatment |
|---|---|
| active | `inset 2px 0 0 var(--accent)` on the card (the app's existing "you are here" idiom — `.tree-row.multi-selected`, the mobile row marker), ✓ in `--accent`, `aria-current="page"` on the button. Clicking does nothing and shows no hover fill |
| default | "Default" badge: transparent, 1 px `--border`, `--fg-muted` text |
| both | "Active" + "Default" side by side — they are separate facts |
| missing folder | "Not found" badge: transparent, 1 px `--ws-warn`, `--ws-warn` text; the switch button is `disabled` with `title="Folder not found: {path}"`. `Remove` stays enabled so a dead entry can be cleaned up |
| Remove on the default | button present but `disabled`, `title="The default workspace can't be removed."` — the app's `.settings-action:disabled` (opacity .5, not-allowed) reads as unavailable while the label stays legible |
| Remove on the active | `disabled`, `title="Switch to another workspace before removing this one."` (the default reason wins when both apply) |
| viewer | the list renders; `Rename`, `Remove` and the Add row are not built at all (`canManage` gate), and `#settings-workspace-add` is `disabled` + `hidden` |
| Rename / Remove | ghost buttons: the same five declarations as `.shortcut-change` and `.settings-ai-remove`; danger variant hovers to `--danger-soft` |

Every badge is the same outline pill (`.72rem`, 600, `1px 7px`, 999 px radius);
only the colour changes: `--accent` (Active), `--border` + `--fg-muted`
(Default), `--ws-warn` (Not found). Filled pills were rejected — see §3.3.

**Add row:** full-width, dashed, `.settings-action` with `.ws-add`; `+` and
"+ Add workspace…" mirror the picker's last row.

**Note** under the list: `.settings-note`, "Switching reloads the page.
Removing a workspace never deletes its notes."

### 4.5 Add / Rename dialog

**Shell:** `#workspace-dialog` (`.settings-overlay`, the standard scrim
`rgba(0,0,0,.5)`), `.settings-modal.auth-modal` at 420 px. Header reuses
`.settings-header`; body reuses `.settings-body.auth-form`.

**Fields**

| Field | Notes |
|---|---|
| Name | `<input type="text" maxlength="60">`, autofocus target. In rename mode it is prefilled and pre-selected. In add mode, while the name is untouched and the path has a value, it is filled with the folder's basename (`/home/you/work` → `work`) — typing in it stops the suggestion |
| Folder | raw text, absolute path expected. A relative path or `~` is only caught on submit by the "absolute path" message — do not try to expand `~` in the browser, the home directory is the server's. The row is hidden in rename mode |
| Will open | read-only echo of the path the server will use: `<span class="settings-label">Will open</span>` + a `--code-bg` chip in `.8rem` mono, `overflow-wrap:anywhere`. Hidden until the field parses as absolute. Rename mode shows the workspace's current path here permanently |
| Error | `.auth-error` (`role="alert"`, `--danger`, `.89rem`, 18 px reserved height so the buttons do not jump) |

**States**

| State | Treatment |
|---|---|
| initial | title "Add workspace", submit "Add workspace" primary, focus in Name |
| invalid | the offending field gets `aria-invalid="true"` + `aria-describedby="ws-error"`, a `--danger` border, and a `--danger-soft` focus halo; one message in the error line |
| submitting | `<form aria-busy="true">`, submit disabled, label "Adding…" / "Saving…" |
| server unreachable | error line: "Could not add the workspace: {message}." |
| rename | title "Rename workspace", Folder row hidden, resolved row always shown, submit "Save" |

Containment is `NB.dialog.open(overlay, { initialFocus: nameInput, fallbackFocus: visibleTrigger() })`.
`fallbackFocus` is the mount the user can actually see: the usual opener is a row
inside the popover, which is hidden before the dialog opens, so `dialog.js`'s
`usable()` check fails and falls through — that is the exact case its comment
describes (`static/js/dialog.js:25-32`). Returning to the hidden chip while the
topbar is hidden would drop focus on the body.

---

## 5. Copy

| Slot | String |
|---|---|
| chip tooltip | `{name} — {path}` · missing: `{name} — folder not found: {path}` |
| rail tooltip | the same two strings |
| chip, screen readers | accessible name `Workspace: {name}` (the `.sr-only` "Workspace: " prefix inside the button) |
| rail, screen readers | `aria-label="Workspace: {name}"` |
| popover, missing row | `Folder not found` |
| popover, add row | `Add workspace…` |
| popover, footnote | `Switching reloads the page.` |
| dialog title | `Add workspace` / `Rename workspace` |
| dialog help (add) | `Point at a folder of Markdown notes on this machine. Nothing is copied or moved.` |
| dialog help (rename) | `Rename only changes the label. The folder stays where it is.` |
| dialog labels | `Name`, `Folder`, `Will open` |
| dialog buttons | `Cancel`, `Add workspace` (busy `Adding…`), `Save` (busy `Saving…`) |
| settings heading | `Workspaces` |
| settings help | `Each workspace is a folder of notes on this machine. Add one per project; the server remembers which one you are in for this session.` |
| settings note | `Switching reloads the page. Removing a workspace never deletes its notes.` |
| settings badges | `Active`, `Default`, `Not found` |
| settings actions | `Rename`, `Remove`, `+ Add workspace…` |
| remove confirm | `Remove “{name}” from the workspace list?` / `Its folder and notes stay on disk.` |

The ellipsis in “Add workspace…” is U+2026, not three periods. Quotes in
messages are curly. The app already mixes straight and curly; use curly here,
as the strings above do.

---

## 6. Server errors → field → message

The server names each condition in a stable `code` on the error body:
`{"error": "...", "code": "..."}`. `workspaces.js` keys its field and message
mapping on the code (`ERROR_FIELD_BY_CODE`); prose matching is only the
fallback for an older server. One message at a time, in `#ws-error`, prefixed
by nothing — the sentence carries the reason. The field named in column 2 gets
`aria-invalid`.

| `code` | Server condition | Field | Message |
|---|---|---|---|
| `name_empty` | name empty | Name | `Give the workspace a name.` |
| `name_too_long` | name over 60 characters | Name | The server sentence, normalised to end with a period: `Workspace names are limited to 60 characters.` |
| `name_duplicate` | name already used, compared case-insensitively | Name | `A workspace called “{name}” already exists.` |
| `path_not_absolute` | path not absolute (the client checks this too) | Folder | `Use an absolute path, like /home/you/notes.` |
| `path_missing` | path does not exist | Folder | `That folder doesn’t exist.` |
| `path_not_directory` | path is a file | Folder | `That path is a file, not a folder.` |
| `path_overlap` | path overlaps another workspace | Folder | `This folder overlaps “{other}” ({path}). Workspaces can’t contain one another.` |
| `path_inside_install` | path is inside the install tree, or contains the install/config tree | Folder | Inside: `That folder is inside the server’s install folder. Pick a folder outside it.` Contains: `That folder overlaps the server’s install or config folder. Pick another folder.` |
| `path_unreadable` | no permission to read | Folder | `That folder can’t be read. Check its permissions.` |
| `bad_body`, `too_many`, `state_too_large`, `default_not_removable`, `not_admin`, `loopback_required`, `unknown_workspace`, `write_failed` | a condition no field owns | none | `Could not add the workspace: {message}.` (rename: `Could not rename the workspace: …`) |
| unknown code or no code | anything else | Folder (prose fallback) | `Could not add the workspace: {message}.` (rename: `Could not rename the workspace: …`) |

`path_inside_install` covers two different faults, which is why the client
picks the sentence from the prose (`install or config` versus `install`).
Overlap means either direction: the new path inside an existing root, or an
existing root inside the new path. Say which one by naming the workspace and
its path, as above, rather than describing the containment.

Clearing: clear `aria-invalid` and the message as soon as the user edits the
field that owns it. Do not clear on a keystroke in the *other* field.

---

## 7. Keyboard and ARIA

### 7.1 Mounts and picker

| Where | Key | Action |
|---|---|---|
| either mount | `Enter`, `Space` | open; focus the current row, or the first usable row if the current one is unavailable |
| either mount | `ArrowDown` | open; focus the first row |
| either mount | `ArrowUp` | open; focus the last row |
| popover | `ArrowDown` / `ArrowUp` | next / previous usable row, wrapping, skipping disabled rows |
| popover | `Home` / `End` | first / last usable row |
| popover | `Enter` / `Space` | activate the row |
| popover | `Esc` | close; focus returns to the mount that opened it |
| popover | `Tab` / `Shift+Tab` | close (via the deferred focus-out check), then focus moves on — no trap, it is a menu, not a dialog |
| popover | click outside | close; focus is not moved |

- Both mounts: `aria-haspopup="menu"`, `aria-controls="workspace-menu"`, and
  `aria-expanded` **mirrored onto both** by `setExpanded()`, so the state is
  honest whichever mount is on screen. `aria-expanded` on the hidden mount is
  harmless.
- `setExpanded()` writes only onto elements that carry `aria-haspopup`, so the
  pair cannot drift.
- `visibleTrigger()` returns the first mount with a layout box
  (`getClientRects().length`), falling back to the chip. It chooses the mount
  that opens, receives the returned focus, and is used as `fallbackFocus` for the
  dialog.
- Popover: `role="menu"`, `aria-labelledby="workspace-switch"`. The reference is
  always the chip; the chip's text is the workspace name, so the menu's computed
  name is right from either mount, and a `display:none` labelledby target still
  resolves for naming.
- Roving tabindex: exactly one row has `tabindex="0"` while open; every other
  row and the disabled row have `tabindex="-1"`.
- The popover is rebuilt on open, then focus is set once — never on every
  keystroke, or the arrow keys would restart from the top. A refresh re-renders
  by row key so focus survives.
- Busy: `aria-busy="true"` on `#workspace-menu-list`, `aria-disabled="true"` on
  both mounts and every row, all rows `tabindex="-1"`. `aria-disabled` is not
  behaviour — `pickerBusy` is; the attribute is for the announcement.

### 7.2 Dialog

`NB.dialog.open` owns Tab wrapping, the inert background and returning focus
(`static/js/dialog.js`). `workspaces.js` owns:

- `Esc` → cancel (add `keydown` on the overlay, as `auth.js` does), with
  `stopPropagation()` so one press does not also close the Settings modal
  underneath;
- `Enter` in any field → submit (native form submit; call `preventDefault`);
- click on the scrim → cancel;
- `aria-busy` + disabled submit while the request is in flight.

On close it re-establishes the Settings modal's containment when that modal is
open, because `NB.dialog` is single-owner and opening this dialog took it over.

### 7.3 Settings

`role="list"` / `role="listitem"` on the rows; the switch button carries
`aria-current="page"` when active; `disabled` + `title` on a missing folder.
Tab order per row: main, Rename, Remove. Nothing custom.

---

## 8. Responsive

| State | Chip | Rail glyph | Popover |
|---|---|---|---|
| desktop, topbar on | visible, 28 px, wrapper capped at 240 px; name ellipsizes | `display: none` | 300 px, below-left of the chip, 6 px gap |
| desktop, topbar off (`hideTopbar` or Mod+Shift+T) | `display: none` with `#topbar`; `--topbar-h` collapses to 0 | `display: flex`, 18 px glyph, first slot in the rail | 300 px, right of the glyph, tops aligned, 6 px gap; flips above on bottom overflow |
| side panel collapsed | unchanged — the chip is in the topbar | unchanged | unchanged |
| narrow desktop window | wrapper shrinks (`flex: 0 1 auto`, `min-width: 0`); the name clips to the glyph and caret | unchanged | clamped to 8 px inside the viewport |
| phone ≤860 px (or coarse pointer ≤1023 px) | 44 × 44 icon-only button; `.workspace-name` clipped to a 1 px sr-only box (still in the a11y tree); caret and divider hidden; glyph 20 px | `display: none` | `min(320px, calc(100vw - 16px))`; rows 44 px; footnote `.8rem` |
| login shell | not rendered | not rendered | — |

The phone query is `@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px))` — the second arm carries a phone in landscape.

Phone specifics, verified in the stylesheet (`mobile.js` only namespaces its `localStorage` keys and appends the drawer's status footer):

- **The topbar is forced visible on the phone**: `body.topbar-hidden #topbar { display: flex }` inside the phone query (`style.css:7032`), with `--topbar-h` restored. So the chip is the phone's only workspace control, and the rail glyph is hidden by an explicit rule even when `body.topbar-hidden` is set.
- `#brand` is `display: none` on the phone (`style.css:7034`), so the chip is the **leftmost** topbar item; the divider is hidden because there is nothing to its left to separate it from.
- The name is clipped with the `.sr-only` recipe rather than `display:none`, so the button keeps its accessible name. This is why the phone chip is not merely an icon with an `aria-label`: the same markup serves both, and only the visual box changes.
- **The drawer no longer has a workspace row.** `#side-panel` becomes the drawer (`position: fixed`, `min(86vw, 340px)`, `z-index: 410`, `style.css:7224-7248`); the workspace is not in it. Its first row is the view's own `.panel-header`, as before the feature existed.
- The phone drawer's scrim (`400`) and drawer (`410`) paint over the popover (`200`), and the drawer covers the topbar, so the chip is behind it. With the drawer open the picker is not usable; it becomes usable again when the drawer closes. Accepted: the drawer is transient and the chip is permanent, and the two are never needed at the same moment.

---

## 9. Behaviour

### 9.1 Switching

`POST` the chosen id, then `location.reload()`. While the request is in flight
both mounts carry `aria-disabled="true"`, the list carries `aria-busy="true"`,
and every row is non-interactive; the reload follows immediately on success.

If a draft or an unsaved buffer exists (the `#draft-bar` state in `viewer.js`),
confirm first with the app's existing discard prompt — a reload throws the draft
away, and the picker must not be the one place that loses work silently.

### 9.2 Adding

Submit → server validates → on success: close the dialog, re-render the picker,
reopen it from `visibleTrigger()`, focus the new row. No switch (D6). Opened
from Settings, the picker is not reopened and the user stays where they are. On
failure: keep the dialog, show the message from §6, focus the named field.

### 9.3 Renaming

Same dialog in rename mode. `PATCH` the name; **both mounts** update without a
reload (`updateMounts()` writes the chip name, the chip `title`, the rail
`title` and the rail `aria-label`), and the Settings list re-renders with focus
returned to the renamed row. Names are unique, so the duplicate error applies
here too.

### 9.4 Removing

"Remove" → `window.confirm` with the copy in §5 (the app already uses
`window.confirm` for the designer's discard prompt) → `DELETE` → re-render the
list and the popover. The row is gone; no reload, because the removed workspace
is never the active one (§4.4).

### 9.5 A folder that vanished mid-session

The popover's row and the Settings row flip to the unavailable state on the next
list fetch; the chip shows `.is-missing`, the rail glyph turns `--ws-warn`.
Nothing else changes: the server serves an empty tree for that root and 404s for
files that are gone, and the existing empty/error surfaces handle that. The user
can switch away or remove the entry; both work from the unavailable state.

### 9.6 Per-workspace state

Open tabs, the active file, recent files, pins, bookmarks, and pinned folders
follow the workspace root. On a workspace page they live under
`workspaceState.<id>` in `config/config.json`, and the client writes them
through `POST /api/workspace-state` (admin only). The whole-blob
`POST /api/config` still carries the complete `workspaceState` map so one
workspace's save cannot drop another's.

A pre-workspace config is migrated **once at server startup**, not by
`GET /api/config`: the read never writes a server-owned file. `POST
/api/config` also folds any stray legacy top-level keys under
`workspaceState.default`, so a client that has not been reloaded cannot strand
them. Table-view and phone resume/draft state use namespaced `localStorage`
keys; the default workspace keeps the legacy key names. See
[`../contracts/configuration.md`](../contracts/configuration.md#per-workspace-state).

---

## 10. Accessibility checklist

- [x] Contrast: every text pair in §3.3 passes 4.5:1; icons pass 3:1.
- [x] Chip focus ring: 2 px `--accent`, `1px` outset (the topbar does not clip, so no inset is needed).
- [ ] Rail glyph focus ring: **not authored.** `.activity-btn` has no
      `:focus-visible` rule anywhere in the app, so the glyph gets the browser's
      default ring. Visible and keyboard-reachable, but it is not the 2 px accent
      ring the rest of the feature uses. Fixing it means styling every activity
      button, which is out of scope for this change.
- [x] Keyboard: both mounts and the whole popover are reachable and operable from
      the keyboard; no handler requires hover or a right-click.
- [x] The hidden mount is not a tab stop (`display: none`), so Tab never lands on
      an invisible control.
- [x] `aria-expanded` is mirrored onto both mounts; `aria-disabled` and the busy
      flag likewise.
- [x] The disabled row is not a tab stop and is announced as disabled, with its
      reason visible as text.
- [x] `aria-current="page"` rather than a checked state, because picking
      navigates.
- [x] Focus returns to the mount that opened the popover, and to whichever mount
      is visible after the dialog.
- [x] The phone keeps the name in the accessibility tree (sr-only clip), so the
      icon-only chip still announces `Workspace: {name}`.
- [x] The dialog is `aria-modal` with a real label and a description, and its
      error is a live region.
- [x] The reload hint is visible text, not a tooltip.
- [x] `prefers-reduced-motion`: the caret rotation is the only animation and it
      is dropped.

---

## 11. Implementation map

| File | Change |
|---|---|
| `templates/index.html` | `#nb-icon-workspace` in the sprite (line 91); `.topbar-divider` + `#workspace-bar` + `#workspace-switch` + `#workspace-menu` inside `#topbar` after `#brand` (lines 119-140); `#workspace-rail-btn` at the top of `#activity-bar` (lines 166-172); `#workspace-dialog` beside `#auth-overlay` (lines 584-620); the Workspaces nav item (line 650) and section (line 721); the `workspaces.js` script tag (line 1905) |
| `static/css/style.css` | `--ws-fg-muted` / `--ws-warn` in `:root` (85-86) and `body[data-theme="light"]` (129-130); `#brand` ellipsis guards (172-187); one appended feature block (lines 7821-8089, Appendix A) — no other existing rule changes |
| `static/js/workspaces.js` | new module: move the popover to `<body>`, keep both mounts in step, place the popover, fetch + render the popover and the Settings list, the dialog in both modes, the switch/rename/remove calls |
| `static/js/activity.js` | none of its own; it inserts `.activity-bar-views` after `.activity-pin` (line 97), which is what keeps the glyph first |
| `static/js/api.js` | `pageRole()` reads `#workspace-bar[data-workspaces]` as the "full-access install" marker (19-34) |
| `static/js/settings.js`, `static/js/mobile.js` | none for the picker; `mobile.js` only namespaces its `localStorage` keys per workspace |
| `static/sw.js` | cache name `notebook-v21` |
| `app.py` | the routes; `boot_state()` supplies `workspace_id`, `workspace_name`, `workspace_path`, `workspaces`, and `role` |

`workspaces.js` internals a maintainer will look for:

| Name | Role |
|---|---|
| `enabled` | false when the page has no `#workspace-bar` / `#workspace-switch` / `#workspace-menu` — every entry point then no-ops (login shell, old server) |
| `triggers()` | `[switchBtn, railBtn]`, or `[switchBtn]` when the rail mount is absent |
| `visibleTrigger()` | the first mount with layout boxes; falls back to the chip |
| `setExpanded()`, `setPickerBusy()` | mirror `aria-expanded` / `aria-disabled` onto both mounts |
| `placeMenu(trigger)` | writes `left` / `top` for the popover; `POP_GAP = 6`, `POP_MARGIN = 8` |
| `openPicker(trigger, focusMode)`, `closePicker(returnFocus)` | the popover lifecycle |
| `isInside(node)` | containment across the two mounts and the body-level popover, by identity (they share no ancestor) |
| `updateMounts()` | keeps the chip name, chip `title`, rail `title`, rail `aria-label` and both `.is-missing` flags in step |

Per-workspace fields the renderer needs:

```js
{ id: "…", name: "Notes", path: "/home/shaun/projects/notebook",
  is_default: true, available: true }
```

plus `active` for the session's current workspace id. `available` is what
drives the disabled row; do not let the client guess by probing the path.

`workspaces.js` public surface:

```js
NB.workspaces = { openPicker, closePicker, openAdd, openRename, refresh, list };
```

---

## 12. Appendix A — CSS as shipped

The feature is one block appended at the end of `static/css/style.css`
(lines 7821-8089), plus the two token declarations in each theme block (§3.3),
plus the `#brand` guards. Appending is deliberate: `#settings-overlay .ws-btn`
has to beat `#settings-overlay .settings-action`, and later-in-file is the only
way to do that without raising specificity or editing existing rules.

**What this appendix is.** The block below is **copied verbatim** from
`static/css/style.css` for the mounts, the popover shell and the phone query. It
**omits** the picker-row, Settings and dialog rules that follow the popover shell
in the file (`.ws-item` … `.ws-resolved-path`): those are byte-identical to the
previous revision of this appendix and are described normatively in §4.3-§4.5.
The file's section banner above the block is reproduced because it
carries the pointer back to this document.

`workspaces-mockup.html` differs from the stylesheet in two deliberate ways, both
stated in its own header: it uses `.ws-bar` for the wrapper (the app's
`#workspace-bar` id repeats once per app window in that page) and it positions the
popover with `absolute` inside each mount, because the real node is `fixed` on
`<body>` and carries coordinates only at runtime.

**Existing rules that were edited** (the only ones):

| Rule | Change |
|---|---|
| `:root` | two declarations added at the end: `--ws-fg-muted`, `--ws-warn` |
| `body[data-theme="light"]` | the same two declarations, light values |
| `#brand` | `min-width: 0`, `max-width: 40%`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap` added; the one-line rule was reformatted to a block |
| `#topbar` | **not edited.** The chip is a flex child of the existing rule, which already supplies `display:flex`, `align-items:center`, `gap:12px` and `padding:0 12px` |

The brand guards cannot fully work: `app.js` `applySiteTitle()` writes
`brand.textContent` (`static/js/app.js:390-400`), which leaves the title as an
anonymous flex item next to the icon, and `text-overflow` on a flex container
does not reach an anonymous item. The brand therefore **hard-clips** at 40 % with
no `…`. The guards still do their main job — a long site title can no longer push
the chip and the actions off the row.

```css
/* ------------------------------------------------------------------ */
/* Workspace picker                                                    */
/* One control with two mounts -- a chip in the topbar and a glyph on   */
/* the activity bar -- plus its popover, the Settings list, and the     */
/* add/rename dialog. The picker rows keep the normative block from     */
/* docs/ui/workspaces.md Appendix A; the mounts are the placement       */
/* design in docs/ui/workspace-placement-mockup.html (boards A and C).  */
/* ------------------------------------------------------------------ */

/* The chip's wrapper: the trigger the popover is measured from, and the
 * node api.js reads data-workspaces from. It is a topbar flex child, so
 * it may shrink but never push the actions off the row. Tokens live on
 * the popover below, not here: the popover is moved to <body> and would
 * not inherit them. */
#workspace-bar {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 240px;
}

/* The 1 px rule that separates the brand from the chip. */
.topbar-divider {
  flex: 0 0 1px;
  align-self: center;
  width: 1px;
  height: 16px;
  background: var(--border);
}

/* Chip: the shared #topbar button chrome (--bg-elev, --border, 6 px
 * radius, hover) with a fixed 28 px height so it sits inside the 46 px
 * topbar without stretching, and reads as a control beside the brand. */
#topbar .workspace-switch {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  height: 28px;
  padding: 0 8px;
  font-size: .84rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
#topbar .workspace-switch[aria-expanded="true"] {
  background: var(--accent-soft);
  border-color: var(--accent);
}
#topbar .workspace-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#topbar .workspace-glyph { width: 12px; height: 12px; flex: 0 0 12px; }

/* The rail mount: hidden while the topbar is on, because the chip is then
 * the control. CSS-only, so a saved hideTopbar paints the glyph on the
 * first frame with no script. */
#workspace-rail-btn { display: none; }
body.topbar-hidden #workspace-rail-btn { display: flex; }
#workspace-rail-btn .workspace-glyph { width: 18px; height: 18px; }
#workspace-rail-btn[aria-expanded="true"] { background: var(--accent-soft); color: var(--fg); }
#workspace-rail-btn:hover .workspace-glyph,
#workspace-rail-btn[aria-expanded="true"] .workspace-glyph { color: var(--fg); }
#workspace-rail-btn.is-missing .workspace-glyph { color: var(--ws-warn); }

/* The glyph, name and caret are shared by the chip; the caret only exists
 * on the chip, the rail mount is icon-only. */
.workspace-glyph { width: 16px; height: 16px; flex: 0 0 16px; color: var(--fg-muted); }
.workspace-switch:hover .workspace-glyph,
.workspace-switch[aria-expanded="true"] .workspace-glyph { color: var(--fg); }
.workspace-switch.is-missing .workspace-glyph { color: var(--ws-warn); }

.workspace-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-warn { flex: 0 0 auto; color: var(--ws-warn); font-size: .8rem; line-height: 1; }
.workspace-caret {
  flex: 0 0 auto; color: var(--fg-muted); font-size: .72rem; line-height: 1;
  transition: transform .12s ease;
}
.workspace-switch[aria-expanded="true"] .workspace-caret { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .workspace-caret { transition: none; } }

/* The popover: one node shared by both mounts, appended to <body> at boot
 * because #activity-bar (overflow: hidden) and .tab-bar would clip a child.
 * position: fixed plus left/top set by workspaces.js from whichever trigger
 * opened it; the tokens live here because the node does not inherit from
 * either mount. */
.workspace-menu {
  --ws-row-h: 32px;
  --ws-pop-width: 300px;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 200;          /* above the phone rail (150), below the modals */
  width: var(--ws-pop-width);
  max-height: min(70vh, 420px);
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
}
.workspace-menu[hidden] { display: none; }
.ws-menu-list { display: flex; flex-direction: column; }

/* … picker rows, Settings list and dialog rules follow, unchanged … */

/* ---- phone: same declarations as §8 ------------------------------- */
@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px)) {
  /* The topbar is forced visible here, so the chip is the only mount and
   * the rail glyph is gone. The chip becomes a 44 px icon button: the
   * name is clipped the way .sr-only clips it (not display:none) so the
   * control keeps its accessible name. */
  #topbar .topbar-divider { display: none; }
  #workspace-bar { flex: 0 0 auto; }
  #topbar .workspace-switch {
    width: var(--m-hit);
    height: var(--m-hit);
    padding: 0;
    gap: 0;
    justify-content: center;
  }
  #topbar .workspace-glyph { width: 20px; height: 20px; flex: 0 0 20px; }
  #topbar .workspace-switch .workspace-name {
    position: absolute;
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
  #topbar .workspace-switch .workspace-caret { display: none; }
  #activity-bar #workspace-rail-btn { display: none; }
  .workspace-menu { --ws-pop-width: min(320px, calc(100vw - 16px)); }
  .ws-item { min-height: var(--m-hit); font-size: .95rem; }
  .ws-foot { font-size: .8rem; }
}
```

And the `#brand` rule as it now stands (`style.css:172-187`):

```css
#brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  letter-spacing: .3px;
  opacity: .9;
  font-size: .93rem;
  /* A long site title must clip rather than push the workspace chip and
     the actions off the row. */
  min-width: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### 12.1 CSS that no longer exists

Removed with the side-panel bar. None of these has a replacement rule; a reviewer
diffing against the previous revision should expect them to be gone:

| Old rule / declaration | Why it is gone |
|---|---|
| `#side-panel.collapsed #workspace-bar { display: none; }` | the chip is not in the panel, so there is nothing to hide with it |
| `#side-panel.collapsed #workspace-bar { display: block; }` (phone) | same; the phone hides the rail glyph instead |
| `#workspace-bar { --ws-bar-h: 36px; --ws-row-h; --ws-pop-radius; position: relative; flex: 0 0 auto; background; border-bottom; z-index: 25; }` | the wrapper is now a borderless flex item in the topbar; the tokens moved to `.workspace-menu`; the topbar owns the background |
| `.workspace-switch { width: 100%; height: var(--ws-bar-h); padding: 0 8px 0 12px; background: none; border: 0; border-radius: 0; font-size: .89rem; }` | the chip inherits `#topbar button` chrome; only `#topbar .workspace-switch` exists now |
| `.workspace-switch:hover, .workspace-switch[aria-expanded="true"] { background: var(--accent-soft); }` | hover comes from `#topbar button:hover`; the open state adds the accent border |
| `.workspace-switch:disabled`, `.workspace-switch:disabled:hover`, `.workspace-switch:disabled:hover .workspace-glyph` | the unauthenticated shell renders no control at all, so there is no disabled chip to style |
| `.workspace-switch:focus-visible { outline-offset: -2px; }` | the inset ring existed because `#side-panel` clips; the topbar does not, so the chip uses `1px` outset |
| `.workspace-menu { position: absolute; top: calc(100% - 1px); left: 8px; width: calc(100% - 16px); max-width: 320px; border-radius: var(--ws-pop-radius); }` | fixed positioning, a fixed 300 px width and a literal 8 px radius (§4.3) |
| `#workspace-bar` as the popover's containing block | the popover is on `<body>` |

## 13. What to review

1. **The two-mount rule** — one control, `display: none` on whichever mount is
   wrong for the current chrome, `aria-expanded` and `aria-disabled` mirrored,
   one popover on `<body>`. Check that no state leaves both mounts hidden on a
   page that has a workspace.
2. **`aria-current="page"` instead of `aria-checked`** — the switch is a
   navigation; check the semantics against the copy ("Switching reloads the
   page.").
3. **The disabled row carries its reason in visible text**, not only a tooltip.
4. **`--ws-fg-muted` / `--ws-warn`** — the only new colours, both copied from
   `#settings-overlay`, both justified by a failing contrast pair.
5. **Add does not switch**, and switching confirms if a draft would be lost.
6. **Nothing outside the four surfaces moved** — no `.panel-header`, tree,
   activity-bar view icon, drawer or tab-strip restyle in the diff. The only
   existing rules touched are the two theme blocks and `#brand`.

## 14. Do not

- Do not restyle `.panel-header`, the tree rows, the activity-bar view icons or
  the drawer.
- Do not put a workspace control in `#side-panel` or `.tab-bar`; the panel
  collapses and the tab strip does not exist on the phone (D1a, D1b).
- Do not give the rail glyph its own popover or its own row renderer; both
  mounts share `#workspace-menu`.
- Do not use `NB.menu` for the popover, or `menuitemradio` for the rows.
- Do not put the reload hint in a `title`; it is the sentence that makes the
  switch read as navigation.
- Do not add a framework, a preprocessor, a web font or a new icon set. The
  glyph is one `<symbol>` in the existing sprite, drawn in `currentColor`.
- Do not render a workspace path in the popover rows; the popover is 300 px and
  paths are in Settings, where they have room.
- Do not auto-switch after adding, and do not reload after rename or remove.
- Do not claim the brand's site title ellipsizes. It clips (§12).
