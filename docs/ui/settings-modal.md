# Settings modal — seven tabs

Status: Current spec — shipped surface, codified.

Reference mockup: [`settings-modal-mockup.html`](settings-modal-mockup.html) — dark and light
boards: General, Appearance, Workspaces (two rows), Shortcuts (with a row capturing), Security as
admin, Security API tokens, Security as viewer, AI with two providers and the ACP panel, AI with no
providers (empty list), About, the validation-error board, the control-state strip, the 390 phone
settings sheet, and the measured 292 px desktop modal at 390.

**Prerequisite.** [`foundations.md`](foundations.md) §11.1 and [`controls.md`](controls.md) §3.3 step 1 must land before any rule below; until then a token rule falls back to the shipped literal.

**Normative source.** The modal chrome — overlay, box, header, drag, maximize, focus containment — is owned by [`edit-window.md`](edit-window.md) §5. This document owns the Settings content. The layout is shipped; the controls are unified with the control layer. The applied control deltas are listed in §10.3. It reads [`foundations.md`](foundations.md) for every token and
[`controls.md`](controls.md) for control anatomy, states, focus and ARIA. Where this document and
`static/css/style.css` differ, the stylesheet wins; §10 records every drift and §12 holds the
proposals that would change the look. The auth overlay, the workspace and session dialogs, the
export dialog and the lightboxes are **not** designed here — `dialogs.md` and `lightboxes.md` own
them, and §13 names the boundary.

Abbreviations: `style.css` = `static/css/style.css`; `index.html` = `templates/index.html`;
`settings.js` = `static/js/settings.js`. Every claim cites `file:line`.

**What this pass changes.** The layout, tab order, copy and modal geometry stay as shipped. The
controls are unified with the control layer: 36 px fields on `--border-strong`, 30 px buttons on
`--border-strong` with a halo primary hover, `--opacity-disabled`, `--dur-1` switches and chips,
and a 2 px focus offset. Those deltas are applied and listed in §10.3. Missing ARIA and keyboard
behaviour are added. What still changes the layout is in §12 and is not applied.

---

## 1. Anatomy

### 1.1 Diagram

```
#settings-overlay            fixed, inset 0, --overlay-scrim, z --z-modal
└── .settings-modal          fixed, centred, --surface-panel, 1 px --border, --radius-lg,
    │                        --shadow-modal, flex column, overflow hidden, 96vw/92vh clamp
    ├── .settings-header     ≈55 px: [h2 "Settings"] … [Maximize] [Close ×]
    │                        padding 14 18, 1 px bottom --border, cursor: move
    ├── .settings-body       flex row, flex 1, min-width 0, min-height 0
    │   ├── .settings-nav        180 px fixed, --surface-page, right border,
    │   │   │                    padding 8 6, gap 2, scrolls
    │   │   └── .settings-nav-item × 7   role=tab, 34 px, --radius-sm
    │   └── .settings-sections   flex 1, padding 4 18 18, the only desktop scroller
    │       └── .settings-section  14 px block padding, 1 px bottom --border
    │           ├── h3 / .settings-form-title      group headings
    │           ├── .settings-help / .settings-note / .settings-hint
    │           ├── .settings-row   [.settings-label 132 px] [control]
    │           ├── .settings-row-column   label above a full-width field
    │           ├── lists: .ws-list, .shortcuts-list, .settings-*-row
    │           └── .settings-form-actions   right-aligned buttons
    └── .settings-footer     ≈57 px: [Close], right-aligned, 1 px top --border
        └── .resize-grip      18 × 18, bottom-right, injected by windows.js
```

Source: `index.html:711-1234`; box and parts `style.css:1801-1927`, `:2257-2265`; grip
`style.css:1846-1867`; maximise `style.css:1872-1887`.

### 1.2 Geometry

| Part | Value | Source |
|---|---|---|
| Overlay | `position: fixed; inset: 0`; `--overlay-scrim` (`rgba(0,0,0,.5)`); `--z-modal` 2000; `min-width/height: 0` | `style.css:1369-1383` |
| Overlay closed | `[hidden] { display: none }` re-asserted because the rule is `display`-independent | `style.css:1387` |
| Modal width | `min(var(--settings-modal-width, 75vw), 96vw)` | `style.css:1824` |
| Modal height | `min(var(--settings-modal-height, 80vh), 92vh)` | `style.css:1825` |
| Size presets | width `compact 60vw / medium 75vw / wide 90vw`; height `compact 80vh / medium 85vh / wide 90vh` | `app.js:289-303` |
| Size defaults | `settingsModalWidth: "medium"`, `settingsModalHeight: "medium"` | `app.js:119-124` |
| Modal face | `--surface-panel`; `1px --border`; `--radius-lg` (12); `--shadow-modal` | `style.css:1828-1831` |
| Modal layout | `display: flex; flex-direction: column; overflow: hidden` | `style.css:1832-1837` |
| Header | `padding: 14px 18px`; 1 px bottom `--border`; `flex-shrink: 0`; `cursor: move` | `style.css:1897-1904`, `:1841-1843` |
| Header title | `1.14rem`, weight 600, tracking `.3px`, margin 0 | `style.css:1905-1910` |
| Header actions | `.settings-header-actions` flex, gap 2 px | `style.css:1913` |
| Body | flex row; `flex: 1 1 auto`; `min-width: 0`; `min-height: 0`; no padding | `style.css:1921-1927` |
| Nav column | `flex: 0 0 180px`; right border; `--surface-page`; `padding: 8px 6px`; gap 2 px; scrolls | `style.css:1931-1940` |
| Sections column | `flex: 1 1 auto`; `overflow-y: auto`; `padding: 4px 18px 18px` | `style.css:1984-1989` |
| Section | `padding: 14px 0`; 1 px bottom `--border`; last child none | `style.css:1990-1994` |
| Footer | `justify-content: flex-end`; gap 8 px; `padding: 12px 18px`; top border; `--surface-panel` | `style.css:2257-2265` |
| Resize grip | 18 × 18 at `right: 2px; bottom: 2px`; local `z-index: 5` (no global meaning, foundations §6.1); 10 × 10 corner mark | `style.css:1846-1867` |
| Maximised | `settings-modal--max`: `inset 0`, 100vw × 100vh, radius 0, grip hidden | `style.css:1877-1887` |

Measured at 1280 × 800 with the default presets: modal **960 × 680**, nav **180**, sections column
**779**, content width **743** (779 minus 18 px padding each side and the 1 px seam).

### 1.3 Scroll ownership

| Region | Scrolls? | Why | Source |
|---|---|---|---|
| Modal box | no — `overflow: hidden` | keeps the rounded corners and the fixed header/footer | `style.css:1837` |
| Header, footer | no | `flex-shrink: 0` | `style.css:1903`, `:2264` |
| Nav column | yes — `overflow-y: auto` | a short viewport must still reach About | `style.css:1938` |
| Sections column | yes — `overflow-y: auto` | the one body scroller; a tall tab scrolls inside the fixed box | `style.css:1986` |
| Section | no | content flows inside the column | `style.css:1990-1995` |

The modal is a free-floating window: `windows.js` adds drag, resize and maximise, and persists
geometry per overlay in `localStorage` under `nb:windowGeometry` (`windows.js:12-16`, `:52-68`,
`:109-136`). Drag is ignored on a maximised modal and on header buttons (`windows.js:143-149`).
That behaviour is part of this surface and stays.

### 1.4 The shared-class rule

`.settings-overlay`, `.settings-modal`, `.settings-row`, `.settings-label`,
`.settings-action`, `.settings-form-title`, `.settings-note`, `.settings-hint` and
`.settings-sections` are **global** classes. The Auth, Export, Table-editor and Designer modals use
them too (`style.css:2272-2347`, `:5751-5760`, `:8591`). Settings-only overrides are therefore
written `#settings-overlay …` or `:where(body > .settings-overlay > .settings-modal) …`.

Do not edit a global base rule to restyle Settings. The archived handoff records the regression
this prevents — the Designer's Apply button is `class="settings-action settings-action--primary"`
(`docs/archive/design/settings-modal.md:68-92`). The scoped `#settings-overlay` blocks win where
they exist: for example `#settings-overlay .settings-label` sets the 132 px gutter while the global
`.settings-label` keeps 130 px for the other dialogs (`style.css:1478-1481` vs `:2017-2021`).

---

## 2. Navigation

### 2.1 The seven tabs

| # | Tab | `data-tab` | Icon (shipped) | Section id | Present when |
|---|---|---|---|---|---|
| 1 | General | `general` | `⚙` | `settings-section-general` | always |
| 2 | Workspaces | `workspaces` | `📚` | `settings-section-workspaces` | `boot.workspace_id` is set — the nav item and the section are both server-rendered under `{% if boot.workspace_id %}` |
| 3 | Appearance | `appearance` | `🎨` | `settings-section-appearance` | always |
| 4 | Shortcuts | `shortcuts` | `⌨` | `settings-section-shortcuts` | always |
| 5 | Security | `security` | `🔒` | `settings-section-security` | always |
| 6 | AI | `ai` | `✨` | `settings-section-ai` | always |
| 7 | About | `about` | `ℹ` | `settings-section-about` | always |

Source: `index.html:722-732` (nav), `:735`, `:796`, `:811`, `:897`, `:1000`, `:1139`, `:1214`
(sections); the Workspaces conditional is `index.html:724-726` and `:792-808`. The DOM test harness
has no workspace, so it asserts the six-tab order and count (`tests/dom/test_dom.js:25640-25656`).

Order is fixed. A new tab appends after About; it does not reorder the set. The nav is rendered
server-side and never rebuilt by JS — `settings.js` only toggles classes and `hidden`
(`settings.js:118-132`).

**Icon column.** Each label is preceded by `<span class="nav-icon" aria-hidden="true">` so every
label starts at the same x. The span is `min-width: 1.4em`, centred, `flex: 0 0 auto`
(`style.css:1961-1967`; markup `index.html:723-731`). Icons are emoji today; see §12 P1.

### 2.2 Item states

| State | Face | Text | Border/bar | Source |
|---|---|---|---|---|
| Rest | transparent | `--text-muted` | none | `style.css:1941-1956` |
| Hover | `--accent-soft` | `--text-primary` | none | `style.css:1968-1971` |
| Active | `--accent-soft` | `--accent`, weight 600 | `inset 2px 0 0 --accent` | `style.css:1972-1976`, `:1735-1740` |
| Focus-visible | unchanged | unchanged | `--focus-ring` at `var(--focus-offset)` 2 px | unified |

Geometry: `padding: 7px 12px`, gap `8px`, `--radius-sm`, `--text-ui-lg` (`.93rem`), one line,
`white-space: nowrap` (`style.css:1941-1956`). Height is ≈34 px, above the 24 px fine-pointer floor
(foundations §10.4).

The active row carries `aria-selected="true"` and `.active`; every other row carries
`aria-selected="false"` (`settings.js:121-125`). The inset bar comes from the older unscoped rule,
which out-specifies the newer `:where()` block — both agree, so the bar ships (`style.css:1735-1740`
vs `:1972-1976`).

### 2.3 Opening state

`open()` always shows the **previous** tab (`activeTab`, initialised `"general"`), re-syncs the
radios, switches, textareas and status lines, and starts on General the first time
(`settings.js:112`, `:181-206`). It does not reset the tab when reopened in one session —
`showTab(activeTab)` preserves where the user was. The comment says "always start on the General
tab"; the code starts on the last tab. That is shipped and harmless; §12 P9 notes the comment.

Opening also runs `refreshAuthState()`, which fetches `/api/auth` and then renders Security, tokens
and AI (`settings.js:706-712`).

### 2.4 Keyboard

Shipped: every nav item is a native `<button role="tab">`, so Tab reaches each one, Enter and Space
activate, and clicking calls `showTab` (`settings.js:130-132`). There are no arrow keys, no roving
tabindex, and no `id`/`aria-labelledby` pair between tab and panel. The target ARIA contract is in
§8; the visual result is unchanged.

---

## 3. Rows and forms

### 3.1 Row grammar

| Part | Value | Source |
|---|---|---|
| `.settings-row` | flex, `align-items: center`, gap `12px`, `padding: 6px 0`, `min-width: 0` | `style.css:1474-1477`, `:2005-2016` |
| `.settings-label` | `flex: 0 0 132px`, `--text-ui-lg` (`.93rem`), `--text-muted` | `style.css:1478-1481` |
| Control | `flex: 1 1 auto`, `min-width: 0` | `style.css:1482-1485`, `:2124` |
| Row value text | `--text-ui-lg`, `--text-primary` | `style.css:2093` |
| Column row | `flex-direction: column; align-items: stretch; gap: 0`; label margin-bottom 4 px | `style.css:1486-1491` |
| Form actions | flex, `justify-content: flex-end`, gap `8px`, `padding: 6px 0` | `style.css:1492-1495`, `:2026-2031` |
| Row rhythm | consecutive rows 6 px apart top and bottom, no rule between them | `style.css:1476` |
| Group heading | see §3.2 | |

A row whose label is not a form label is a `<span class="settings-label">` (Status, Native
observer, Data folder). A row that owns an input uses `<label for>`. Both use the same 132 px
gutter, so the controls line up down the tab (`index.html:737-767`, `:1216-1223`).

### 3.2 Headings and secondary text

| Role | Size | Weight | Other | Source |
|---|---|---|---|---|
| Section heading (`h3`) | `.76rem` | 600 | uppercase, tracking `.8px`, `--text-muted`, margin `0 0 8px` | `style.css:1452-1458` |
| Group title (`.settings-form-title`) | `.74rem` | 600 | uppercase, tracking `.7px`, `--text-muted`, `margin: 24px 0 8px`, `padding-top: 16px`, 1 px top `--border` | `style.css:1459-1466` |
| Help (`.settings-help`) | `.86rem`, line-height 1.5 | 400 | `--text-muted`, `margin: 0 0 10px` | `style.css:1469`, `:2004` |
| Note (`.settings-note`) | `.86rem` | 400 | `--text-muted`, `margin-top: 4px` | `style.css:1470`, `:2032-2036` |
| Hint (`.settings-hint`) | `.78rem` | 400 | `--text-muted` | `style.css:1471` |
| Subheading (`.settings-subheading`) | `.76rem` | 600 | takes the section-heading look; also used for the second and third Shortcuts groups | `style.css:1452-1458`; markup `index.html:915`, `:986` |

The section's own `h3` is the tab name (General, Appearance, …) and repeats the nav label. The
group titles split a long tab into "Interface", "Modal size", "Wallpaper" (Appearance) and "Add a
provider", "Assistant instructions", "Web search" (AI).

Two competing rules set `.settings-help` and the section `h3`: the `#settings-overlay` rules set the
size, the unscoped rules set the margin (`.settings-help`) or are overridden entirely (`h3`). The
result is the one described above (`style.css:1452-1471` vs `:1996-2004`).

### 3.3 Fields

One look for `input[type=text|number|password]`, `textarea` and `select` inside Settings.

| Property | Value | Source |
|---|---|---|
| Face | `--surface-well` (`--code-bg`) | `style.css:1511` |
| Text | `--text-primary`; placeholder `--text-muted` | `style.css:1511` |
| Border | `1px --border-strong` | unified; shipped `--border` |
| Radius | `--radius-sm` (6) | `style.css:1512` |
| Padding | `var(--space-1) var(--space-2)` (4/8) | unified |
| Type | `--text-ui` (.86rem), `font-family: inherit` | unified |
| Sizing | `flex: 1 1 auto`, `min-width: 0`, `max-width: none` | `style.css:1515` |
| Focus | border `--accent` + `0 0 0 3px --accent-soft`; `outline: none` because the border is the replacement | `style.css:1517-1523` |
| Disabled | `opacity: var(--opacity-disabled)`, `cursor: not-allowed` | unified |
| Height | `var(--control-h-lg)` 36; number input stays content-sized | unified |
| Number input | `flex: 0 0 90px`, right-aligned | `style.css:1527-1530` |
| Textarea | `resize: vertical`, `width: 100%`; a textarea that also carries `.settings-auth-input` is capped at 260 px | `style.css:1531-1535`, `:2337-2339` |
| Auth-shaped field | `.auth-input` in Settings still takes this look; `.settings-auth-input` caps it at 260 px | `style.css:1506-1516`, `:2337-2340` |
| Vimrc | mono `ui-monospace…`, `.86rem`, line-height 1.45, `padding: 8px 10px` | `style.css:2052-2065`, `:1531-1534` |
| About path | `.settings-mono`: mono `.86rem`, `--surface-raised` face, `padding: 3px 8px`, radius 4, `word-break: break-all`, selectable | `style.css:2115-2123` |

A field is never sized by its content. The number field and the 260 px cap on password fields are
the two exceptions, both deliberate.

### 3.4 Buttons

| Variant | Face | Text | Border | Source |
|---|---|---|---|---|
| Base (`.settings-action`) | `--surface-raised` | `--text-primary` | `1px --border` | `style.css:1538-1544` |
| Primary (`--primary`) | `--accent` | `--text-on-accent` | `--accent`, weight 600 | `style.css:1556-1559` |
| Ghost (Test, Edit, Change…, Reset, Rename, Remove) | transparent | `--text-muted` (Edit is `--accent`) | transparent | `style.css:1563-1571`, `:8158-8161` |
| Danger (Remove provider, Revoke, Disable auth) | transparent | `--danger` | transparent | `style.css:1578-1583`, `:8165` |

| State | Delta | Source |
|---|---|---|
| Rest | as above; height `--control-h-md` 30; `padding: 0 var(--space-3)`; `--text-ui`; line-height `--lh-flat`; `white-space: nowrap` | unified |
| Hover | `--accent-soft` face + `--accent` border (ghost: `--accent` text; danger: `--danger-soft` face + `--danger` border) | `style.css:1545-1547`, `:1572-1577`, `:1584-1588` |
| Primary hover | face unchanged, 3 px `--accent-soft` halo; no filter | unified |
| Focus-visible | `--focus-ring` at `var(--focus-offset)` | unified |
| Disabled | `opacity: var(--opacity-disabled)`, `cursor: not-allowed`, face reset to raised + `--border`, hover does nothing | unified |
| Busy | only in the AI tab: label becomes `Saving…`, button disabled | `settings.js:1292`, `:1328` |

The unified height is `--control-h-md` 30; the shipped content-driven height was 31.6 (6 + 6 padding, a 17.6 line box, 2 border). The focus ring is drawn
inside the 1 px offset, so it never clips against a row.

`Make default` is **not** a ghost button: it is `class="settings-action settings-ai-default"` with no
ghost rule, so it renders as a normal bordered secondary button inside the provider row
(`settings.js:1148`; no `.settings-ai-default` rule exists in `style.css`).

### 3.5 Switches

Every `input[type=checkbox]` inside `#settings-overlay` is a switch. The native element keeps its
id, label association and keyboard toggle.

| Property | Value | Source |
|---|---|---|
| Track | 36 × 20, `--radius-pill`, `--border-strong` when off, `--accent` when on | unified |
| Knob | 16 px circle, `--switch-knob` (`--fg` dark / `--accent-fg` light), 2 px inset | `style.css:1600-1607`, `:1430`, `:1439` |
| On | `translateX(16px)` | `style.css:1607` |
| Position | `margin: 0 0 0 auto` — pushed to the row's right edge | `style.css:1595` |
| Motion | `--dur-1` background and transform; `none` under reduced motion | unified |
| Focus | `--focus-ring` at offset **2** px | `style.css:1608-1610` |
| Disabled | `opacity: var(--opacity-disabled)`, `cursor: not-allowed` | unified |

The switch is the control for Autosave, VIM mode, Hide top bar, Graph background particles, Require
a password to read (`index.html:761`, `:778`, `:833`, `:837`, `:1080`). There is one shape and one
size across all five.

### 3.6 Radio chips

Eight groups share one appearance, named explicitly in the CSS so the Export modal's own
`-options` class is not caught (`style.css:1617-1622`). The groups are theme, font size, settings
modal width, settings modal height, wallpaper, wallpaper scroll, wallpaper colour, wallpaper
intensity (`index.html:816-889`).

| State | Face | Border | Text | Source |
|---|---|---|---|---|
| Rest | `--surface-raised` | `1px --border-strong` | `--text-muted`, `--text-ui` | unified |
| Hover | unchanged | `--accent` | `--text-primary` | `style.css:1636-1641` |
| Checked | `--accent-soft` | `--accent` | `--accent`, weight 600 | `style.css:1643-1653` |
| Focus-visible (on the label) | unchanged | unchanged | unchanged, `--focus-ring` at `var(--focus-offset)` | unified |
| Disabled | group inherits `opacity: .55` where a whole group is disabled — none ships today | — | — | — |

Shape: pill, `padding: var(--space-1) var(--space-3)` (4/12), gap `var(--space-1)`, group gap `var(--space-2)`, group wraps; motion `--dur-1`.
The native radio is visually hidden but focusable (`style.css:1660-1665`). Arrow keys move within a
group natively because the inputs share a `name`.

### 3.7 Save behaviour

| Tab / control | Model | What it writes | Source |
|---|---|---|---|
| Site title | live on `input`, debounced | `siteTitle` | `settings.js:490-494`, `app.js:521-526` |
| Autosave + delay | live on `change` | `autosave`, `autosaveDelay` (clamped 1–300) | `settings.js:460-471` |
| VIM mode | live on `change` | `vimMode` | `settings.js:450-455` |
| Watch toggle | live on click, after the picker resolves | `watchEnabled` | `settings.js:376-391` |
| Hide top bar, particles | live on `change` | `hideTopbar`, `graphParticles` | `settings.js:474-487` |
| Theme, font size | live on `change` | `theme`, `fontSize` | `settings.js:228-233` |
| Modal width/height | live on `change` | `settingsModalWidth/Height` → `--settings-modal-width/height` on `:root` | `settings.js:234-239`, `app.js:304-313` |
| Wallpaper ×4 | live on `change` | `wallpaper`, `wallpaperScroll`, `wallpaperColor`, `wallpaperIntensity` | `settings.js:240-251` |
| VIM initial script | **explicit** Save | parsed first; on success `vimrc` | `settings.js:519-555` |
| Shortcut rows | live; capture writes on the next key | `shortcuts` | `settings.js:288-311`, `:332-341` |
| Admin / viewer passwords | **explicit** Save, then page reload | `/api/auth/passwords` | `settings.js:716-852` |
| API tokens | explicit Create / Revoke | `/api/auth/tokens` | `settings.js:1005-1027`, `:948-962` |
| AI providers | explicit Add / Save changes / Save as new / Remove | `/api/ai/config` | `settings.js:1246-1283`, `:1701-1777` |
| Assistant instructions | explicit Save (own button) | `customPrompt` | `settings.js:1289-1320` |
| SearXNG URL | explicit Save (own button) | `searxngUrl` | `settings.js:1325-1357` |
| Workspace switch | click a row → page reload | server session | `workspaces.js:860`, note `index.html:806` |
| About | read-only | — | `settings.js:557-567` |

Live settings persist through one debounced writer: 250 ms after the last change, one POST of the
whole blob (`app.js:521-526`, `:576-621`). There is **no** global Apply, Save or Cancel; the footer
holds one Close button and says so in the markup comment (`index.html:1227-1232`).

### 3.8 Disabled and read-only

| State | Treatment | Example |
|---|---|---|
| Disabled field | `opacity: var(--opacity-disabled)`, `cursor: not-allowed` | the autosave delay while autosave is off (`settings.js:431`) |
| Disabled button | `opacity: var(--opacity-disabled)`, face reset, hover inert | Save until passwords match (`settings.js:597-616`) |
| Disabled row action | `disabled` + a `title` naming the reason | Workspaces Remove for the default or the active workspace (`workspaces.js:877-885`) |
| Read-only block | `--surface-raised` face, `1px --border`, `--radius-md`, a `Read-only` tag; no editable field | the ACP panel (`style.css:1744-1759`) |
| Missing value | em dash `—` | token and provider counts before a fetch, or when not admin (`settings.js:976`, `:1600`) |
| Unknown value | `…`, then `(failed to load)` | About folders (`index.html:1218`, `:1222`; `settings.js:560-566`) |

Disabled never means hidden. The control stays in place, keeps its name, and states why in `title`
or in the adjacent note.

---

## 4. Each tab

Controls are listed in shipped document order. "Writes" names the config key or endpoint.

### 4.1 General

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `Site` | — |
| 2 | Row: label `Site title` + text input | placeholder `Notebook` | `maxlength="60"`, `spellcheck="false"`; live, debounced → `siteTitle` |
| 3 | `h3` | `File watching` | — |
| 4 | Help paragraph | "Get notified when files in your notebook are changed by another program (vim, a sync tool, a different browser tab, etc.). Detection runs by default using a 5-second poll. Click *Enable* below to upgrade to the native folder observer, which is push-based and uses no network -- the browser will ask for permission to read your notebook folder." | `em` on "Enable" |
| 5 | Row: label `Status` + value | `Watching <folder>` / `Polling (5s)` / `Watching off` | 8 px dot before the word; dot and text both `--ok` when on, `--warn` when off; `Unavailable` when `NB.watcher` is absent and the button is disabled |
| 6 | Row: label `Native observer` + button | `Enable` / `Disable` | Clicking enables or disables; a cancelled folder picker leaves it off; live → `watchEnabled` |
| 7 | Row: label `Autosave (WYSIWYG)` + switch | switch, checked by default | live → `autosave` |
| 8 | Row: label `Autosave delay (s)` + number | `5` | `min=1 max=300 step=1`; right-aligned, 90 px; disabled while autosave is off; live → `autosaveDelay` |
| 9 | `h3` | `Keyboard` | — |
| 10 | Help paragraph | "Enable VIM-style keybindings. When on, the sidebar, outline, and editor act as three vim \"windows\" (Ctrl+W to cycle). Inside the editor itself, CodeMirror 6's vim mode gives you full VIM (normal/insert, motions, text objects, `:w` to save, `:q` to exit, etc.). Press `?` from the shell for the full keymap." | two inline `<code>` and one `<kbd>` |
| 11 | Row: label `VIM mode` + switch | unchecked by default | live → `vimMode` |
| 12 | Column row: label `VIM initial script`, textarea, actions | placeholder: "# One binding per line. Examples: / # nmap j gj / # imap jj <Esc> / # unmap <leader>w" (four lines) | 8 rows, mono; Save (primary) + status line, below the textarea |
| 13 | Status line | `Saved (0 bindings; the editor is unchanged)` · `Saved (N binding(s) applied)` · `Line N: <message> (+K more)` · `Save failed: <message>` | Success is `--ok`; a parse or IO error is `--warn`; the status is hidden until a save; a failed parse keeps the last good config |

Sources: `index.html:735-790`; `settings.js:393-414`, `:424-434`, `:436-444`, `:507-555`;
`watcher.js:81-86`; `style.css:1691-1713`, `:1729-1731`.

The VIM script is deliberately explicit: the parser reports line-level errors and a half-typed line
must not be applied mid-keystroke (`settings.js:496-506`).

### 4.2 Workspaces

Present only when a workspace exists (§2.1). Server copy at `index.html:796-808`.

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `Workspaces` | — |
| 2 | Help paragraph | "Each workspace is a folder of notes on this machine. Add one per project; the server remembers which one you are in for this session." | — |
| 3 | List `#settings-workspace-list` | one row per workspace | `role="list"`, rows `role="listitem"`; anatomy in §5.1 |
| 4 | Add row (admin only) | `+ Add workspace…` | Full width, transparent face, **dashed** border, `--text-muted`, hover `--accent`; opens the add dialog (`dialogs.md`) |
| 5 | Note | "Switching reloads the page. Removing a workspace never deletes its notes." | `--text-muted`, `.86rem` |

The Add button is server-gated on `ws_role == 'admin'` (`index.html:801-805`); the row actions are
gated on `canManage` in JS (`workspaces.js:128-132`, `:865-890`). A viewer sees the list and no
actions. The list is filled from `NB.settings.onOpen` (`workspaces.js:1065-1068`), so it is current
on every open.

Clicking a row's name switches workspace and reloads (`workspaces.js:859-861`). The active row is
not clickable (`workspaces.js:859`). A missing folder renders the row as a disabled switch with a
`Not found` badge and a `Folder not found: <path>` title (`workspaces.js:829-832`, `:847-849`).

### 4.3 Appearance

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `Appearance` | — |
| 2 | Group title | `Interface` | — |
| 3 | Row: `Theme` + 3 chips | `Auto` `Dark` `Light` | live → `theme`; `Auto` follows the system |
| 4 | Row: `Font size` + 4 chips | `S` `M` `L` `XL` | live → `fontSize`; sets `--font-scale` 0.9 / 1 / 1.15 / 1.3 |
| 5 | Row: `Hide top bar` + switch | off | live → `hideTopbar`; the topbar collapses to 0 px |
| 6 | Row: `Graph background particles` + switch | off | live → `graphParticles` |
| 7 | Group title | `Modal size` | — |
| 8 | Row: `Settings modal width` + 3 chips | `Compact` `Medium` `Wide` | live → `settingsModalWidth` (60/75/90 vw) |
| 9 | Row: `Settings modal height` + 3 chips | `Compact` `Medium` `Wide` | live → `settingsModalHeight` (80/85/90 vh) |
| 10 | Group title | `Wallpaper` | — |
| 11 | Row: `Wallpaper` + 3 chips | `None` `Lines` `Grid` | live → `wallpaper` |
| 12 | Row: `Wallpaper scroll` + 2 chips | `Scroll with content` `Fixed in viewport` | live → `wallpaperScroll` |
| 13 | Row: `Wallpaper color` + 5 chips | `Neutral` `Blue` `Green` `Purple` `Amber` | live → `wallpaperColor` |
| 14 | Row: `Wallpaper intensity` + 3 chips | `Subtle` `Medium` `Bold` | live → `wallpaperIntensity` |

Sources: `index.html:811-890`; `settings.js:134-158` (radio sync), `:228-251` (live writers);
`app.js:36-56` (defaults), `:259-273` (scales), `:315-356` (wallpaper).

The two "Modal size" rows resize the modal the user is standing in. That is intentional: the
preset is written to `:root` immediately (`app.js:304-313`).

### 4.4 Shortcuts

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `Shortcuts` | — |
| 2 | Help paragraph | "Customize the app's keyboard shortcuts. These bindings are active when VIM mode is off; VIM's own keymap is documented in the `?` :help overlay and is configured separately under VIM mode." | — |
| 3 | List `#settings-shortcuts-list` | 9 configurable rows | `role="list"`; rendered on every open (`settings.js:288-311`) |
| 4 | Row | label · `<kbd>` binding · `Change…` · `Reset` | `Reset` hidden while the binding equals its default |
| 5 | Capturing row | binding cell reads `Press a key… (Esc to cancel)`, button reads `Cancel` | accent border + `--accent-soft` face + a pulsing halo; one row at a time; Esc cancels |
| 6 | Footer row | `Reset all to defaults` | Right-aligned after a top rule; no label column |
| 7 | Subheading | `Hybrid editor (WYSIWYG) shortcuts` | — |
| 8 | Help paragraph | "Available while editing in hybrid mode. These bindings are fixed (not remappable) and only act on text inside the editor." | — |
| 9 | Static list | 13 reference rows | dashed border, transparent face, no buttons; `Mod+…` localised to `Ctrl+…` / `Cmd+…` on render |
| 10 | Subheading | `Live markdown syntax` | — |
| 11 | Help paragraph | "In hybrid mode, typing these at the start of a line renders immediately: `#`–`######` headings, `-` / `*` / `+` bullets, `1.` / `1)` ordered list, `>` quote, `[ ]` / `[x]` task item, and `**bold**` / `*italic*` / `_italic_` / `~~strike~~` / `` `code` `` / `[[wikilink]]` inline pairs." | — |

Sources: `index.html:897-997`; `settings.js:263-368`; `style.css:2171-2253`; `shortcuts.js:286`
(order), `:50-60` (defaults). The 9 actions are Save current file, Open search, Previous tab, Next tab, Toggle edit mode,
Toggle hybrid (WYSIWYG) mode, Cycle sidebar / editor / outline, Toggle top bar, Open Settings, with bindings `Ctrl+S`, `/`,
`Alt+H`, `Alt+L`, `Ctrl+E`, `Ctrl+Shift+E`, `Ctrl+W`, `Ctrl+Shift+T`, `Ctrl+Comma` on this platform
(`tests/dom/test_dom.js:25740-25776`).

The VIM keymap is deliberately not in this list. VIM's bindings live under General → VIM mode and
the `?` overlay (`index.html:892-896`).

### 4.5 Security

The section is admin-only in effect: fields enable on `isAdmin()` (`settings.js:592-594`), except
the initial admin "set" form which is open when no admin password exists (`settings.js:601`,
`:628-640`). Copy and visibility change with the auth state; §6 tabulates all three.

**Passwords**

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `Passwords` | — |
| 2 | Help `#settings-auth-help` | no admin: "Set an admin password to require a password for writing." · admin: "Change the admin password, or remove it to disable auth." · viewer: "Sign in as admin to change passwords." | rewritten on every state render |
| 3 | Note | `Admin password: Not set` / `Admin password: Set` | label fixed, value in a child span |
| 4 | Set form (no admin password): `New password`, `Confirm new password` | placeholders `At least 6 characters`, `Type the new password again` | password fields, `autocomplete="new-password"`; Save disabled until both are non-empty and equal; Save sends, then reloads; a failure keeps the form and shows the error |
| 5 | Change form (admin password set): `Current password`, `New password`, `Confirm new password` | placeholders `Enter the current password`, `At least 6 characters`, `Type the new password again` | three fields; Save enabled only when all three are filled and new equals confirm; `Cancel` clears the three fields and the error |
| 6 | Remove form (hidden until revealed): `Current password` + `Disable auth` | placeholder `Enter the current admin password` | `Disable auth` enabled only with a non-empty current password; opening it needs `window.confirm` with the four-line destructive warning; success clears both hashes and reloads |
| 7 | Reveal button | `Remove admin password` | Visible only to an admin with a password set; reveals row 6 and focuses it |
| 8 | Note | `Viewer password: Not set` / `Viewer password: Set (clear it via the toggle, or set a new one)` | label fixed, value in a child span |
| 9 | Row: `Require a password to read` + switch | unchecked | Admin only; toggling **on** only reveals the two fields (no write); toggling **off** confirms, then clears the viewer password and reloads |
| 10 | Rows: `Viewer password`, `Confirm viewer password` | placeholders `Enter new password`, `Type the viewer password again` | Shown when the user can edit or a viewer password exists; hidden from a viewer with no viewer password |
| 11 | Actions: `Remove`, `Save` | — | `Remove` only when a viewer password exists, admin only; `Save` enabled only when both fields match and are non-empty |
| 12 | Error block `#settings-auth-error` | e.g. `New password and confirmation must match`, `Current admin password is required to disable auth`, server message | `role="alert"`, `--danger`, hidden when empty, reserved 18 px line |

**API tokens**

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 13 | `h3` | `API tokens` | — |
| 14 | Help `#settings-tokens-help` | admin: "Bearer tokens let agents and scripts call the API without a browser session. See the agent guide at /agent.md." · otherwise: "Sign in as admin to manage API tokens." | The markup ships "See the agent guide." as a `target="_blank"` link, but the first render replaces the whole string with plain text (`settings.js:924-928`), so the live state is plain text and the link is lost — P17 |
| 15 | Note | `API tokens: <count>` | Count is `—` when not admin or the fetch failed |
| 16 | List `#settings-tokens-list` | one row per token | §5.3 |
| 17 | Row: `New token name` + text | placeholder `e.g. opencode` | Enter creates when the button is enabled |
| 18 | Row: `Role` + select | `viewer — read only`, `admin — read + write` | native select; default `viewer` |
| 19 | Action | `Create token` (primary) | Disabled until a name is typed and the user is admin |
| 20 | Issued block (hidden until create) | "Token created — copy it now, it will not be shown again:" + the token in `.settings-mono` | Shown once per successful create; the server never returns it again |
| 21 | Error block `#settings-tokens-error` | `Token name is required`, `Failed to revoke token`, server message | `role="alert"` |

Sources: `index.html:1000-1132`; `settings.js:592-1075` (passwords), `:895-1027` (tokens);
`style.css:1590-1615` (switch), `:1691-1725` (status, tag), `:2337-2347` (field cap, error).

### 4.6 AI

Admin-only in effect, same gate (`settings.js:1092-1126`). The tab is one page in five groups.

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `AI assistant` | — |
| 2 | Help `#settings-ai-help` | admin: "Providers for the AI assistant in the left activity bar (✨). Any OpenAI-compatible /v1/chat/completions endpoint works. API keys are stored server-side and never sent to the browser." · otherwise: "Sign in as admin to configure AI providers." | The markup copy (three sentences, with `openai-compatible local servers, etc.`) is replaced on first render |
| 3 | Note | `Providers: <count>` | `—` when not admin or the fetch failed |
| 4 | List `#settings-ai-list` | provider rows, then the ACP panel | §5.4, §5.5 |
| 5 | Group title `#settings-ai-form-title` | `Add a provider` · `Edit provider: <name>` | Changes with the edit state |
| 6 | Row: `Profile name` + text | placeholder `e.g. openai or ollama-lan` | Required for Add/Save; duplicate names rejected with an error |
| 7 | Row: `Base URL` + text | placeholder `https://api.openai.com  (a trailing /v1 is optional)` | Required; the server strips a trailing `/` and `/v1` |
| 8 | Row: `Model` + text | placeholder `e.g. gpt-4o-mini or llama3` | Optional |
| 9 | Row: `API key` + password | placeholder `Empty = keep stored key (when editing)`; in edit mode `Stored — leave blank to keep` | Write-only; a blank key with `replaceSecret` keeps the stored one |
| 10 | Actions | `Cancel` (edit only) · `Save as new` (edit only) · `Add provider` / `Save changes` (primary) | Primary disabled until name and URL are filled; enter in the name field submits |
| 11 | Group title | `Assistant instructions` | — |
| 12 | Column row: `Assistant instructions (all providers)` + textarea + hint | placeholder "Extra instructions for the AI assistant, e.g. “Always answer in Traditional Chinese. Prefer concise bullet points.“" · hint "Appended to the assistant's instructions regardless of provider. The built-in tool rules always win." | 4 rows; the 260 px `.settings-auth-input` cap applies, so it is a narrow box inside a full-width column; Ctrl/Cmd+Enter saves (P16) |
| 13 | Actions | status hint + `Save prompt` (primary) | Save enabled only when the text differs from the last saved value; busy label `Saving…`; status `Saved` for 2 s or the error message |
| 14 | Group title | `Web search` | — |
| 15 | Column row: `SearXNG instance URL` + text + hint | placeholder `https://searxng.example.com  (optional; blank = built-in fallback)` · hint "Lets the assistant search the web. Leave blank to use the built-in fallback (queries leave this machine)." | Admin only; Ctrl/Cmd+Enter saves |
| 16 | Actions | status hint + `Save search URL` (primary) | Same dirty rule and busy/status behaviour as row 13 |
| 17 | Error block `#settings-ai-error` | `A provider named "x" already exists`, `Failed to load AI providers`, server message | `role="alert"` |

Sources: `index.html:1139-1211`; `settings.js:1036-1090` (refs, error), `:1092-1126` (control and
help state), `:1628-1778` (add/edit/save); `style.css:1469-1471`, `:1506-1535`.

The ACP block is read-only and lives **inside** the list, above the add form, on purpose: it is the
read-only member of the same provider set the assistant picker shows
(`settings.js:1504-1540`; `docs/archive/design/settings-modal.md:218-234`).

### 4.7 About

| # | Element | Copy | State and behaviour |
|---|---|---|---|
| 1 | `h3` | `About` | — |
| 2 | Row: `Data folder` + code | `…` → the active root, or `(failed to load)` | Fetched once per session on first open (`settings.js:557-567`); the value wraps inside the modal, never widens it |
| 3 | Row: `Config folder` + code | `…` → the config folder, or `(failed to load)` | as above |

Sources: `index.html:1214-1224`; `settings.js:106-107`, `:196`, `:557-567`. `GET /api/info` returns
`data_dir`, `config_dir` and `workspace` (`app.py:1566-1578`).

---

## 5. Lists

Four lists share one idea — a row is a card on `--surface-raised`, the name is 600 weight, the
metadata is muted — but they are not one component. Do not merge them.

### 5.1 Workspaces

```
┌──────────────────────────────────────────────────────────────────────┐
│ [✓]  Lab notebook   [Active] [Default]          Rename   Remove      │
│      /home/shaun/notes                                               │
└──────────────────────────────────────────────────────────────────────┘
```

| Part | Value | Source |
|---|---|---|
| List | flex column, gap 6 px, `margin: 2px 0 10px` | `style.css:8094` |
| Row | flex, `align-items: center`, gap 10 px, `padding: 8px 10px`, `1px --border`, `--radius-md`, `--surface-raised` | `style.css:8095-8103` |
| Active row | `inset 2px 0 0 --accent` | `style.css:8104` |
| Main control | a `<button>` filling the row, `margin: -4px -6px`, `padding: 4px 6px`, radius 6; hover `--accent-soft`; focus ring inset 1 px | `style.css:8105-8124` |
| Check column | 14 px, `✓` on the active row, `--accent` | `style.css:8129`; `workspaces.js:834-837` |
| Name line | flex, gap 8 px, `.95rem`, weight 600; the name ellipsizes | `style.css:8131-8132` |
| Path line | mono, `.8rem`, line-height 1.45, `--text-muted`, `overflow-wrap: anywhere` | `style.css:8133-8139` |
| Actions | flex, gap 2 px; `Rename`, `Remove` ghost; `Remove` danger | `style.css:8140`, `:8158-8168` |
| Badges | outline pills, `1px`, `padding: 1px 7px`, `.72rem`, weight 600: `Active` accent, `Default` `--border`/muted, `Not found` `--warn` | `style.css:8144-8150`; `workspaces.js:62-66` |
| Add row | full width, transparent, dashed 1 px, muted; hover accent | `style.css:8151-8153` |

**States.** Active + default (one row can be both). Missing folder: main button disabled, name and
badges muted, `Not found` badge, title `Folder not found: <path>`. `Remove` is disabled for the
default workspace (`The default workspace can't be removed.`) and for the active one (`Switch to
another workspace before removing this one.`) — `workspaces.js:68-70`, `:877-885`.

**Empty state.** There is none, and none is needed: the default workspace always exists
(`docs/contracts/configuration.md:357-360`). If the fetch fails the list is empty and no message is
shown; §7 and §12 P7 cover it.

**Errors.** Add/rename errors belong to the add dialog (`dialogs.md`), not this list. Remove failure
raises the shared toast (`workspaces.js:920-922`).

### 5.2 Shortcuts

| Part | Value | Source |
|---|---|---|
| List | flex column, gap 6 px, `margin: 4px 0 14px` | `style.css:2171-2176` |
| Row | flex, space-between, gap 12 px, `padding: 10px 12px`, `1px --border`, `--radius-md`, `--surface-raised` | `style.css:2177-2186` |
| Label | `flex: 1 1 auto`, `.95rem`, `--text-primary`, ellipsis | `style.css:2187-2192` |
| Binding | `<kbd>`: mono `.9rem`, `padding: 3px 8px`, 1 px border with a 2 px bottom edge, radius 4, `--surface-page` face, `min-width: 70px`, centred | `style.css:2199-2212` |
| Actions | `Change…` ghost; `Reset` ghost, hidden at the default | `style.css:1563-1577`, `:2240-2244` |
| Capturing | binding takes `--accent` border + `--accent-soft` face and `animation: shortcut-capture-pulse 1.4s`; button reads `Cancel` | `style.css:2213-2223`; `settings.js:324-331` |
| Static row | `padding: 6px 12px`, transparent, **dashed** border; no actions; `min-width: 0` on the kbd | `style.css:2232-2239` |
| Footer | top rule, `padding-top: 12px`, right-aligned; the empty label column is hidden | `style.css:2245-2253` |

**States.** At the default the row shows `Change…` only. A rebind makes `Reset` appear
(`settings.js:301`). During capture the row is the only one capturing: starting a second capture
cancels the first (`settings.js:319-322`). Esc cancels; any other key is captured, including
modifiers-only chords as the module decides (`shortcuts.js`).

**Empty state.** None — the list is generated from a fixed 9-action table (`shortcuts.js:286`).

### 5.3 API tokens

| Part | Value | Source |
|---|---|---|
| Row | `.settings-row.settings-token-row`: flex, gap 8 px, `padding: 8px 12px`, `1px --border`, `--radius-md`, `--surface-raised`, `margin: 0 0 6px` | `style.css:1668-1674` |
| Name | `settings-label` overridden: `flex: 1 1 auto`, `--text-primary`, weight 600, ellipsis | `style.css:1675-1680` |
| Meta | inline flex, gap 6 px, wraps: role in `<code>`, created date, `Revoke` | `style.css:1681-1684` |
| Role, date | `.78rem`, `--text-muted` | `style.css:1685-1688` |
| Action | `Revoke` danger ghost | `style.css:1578-1588`; `settings.js:940` |
| Issued secret | `.settings-mono` under the create row | `index.html:1127-1130`; `style.css:2115-2123` |

**Add.** Type a name, pick a role, Create. The name clears; the list refreshes; the issued box shows
the full token. `renderTokens()` hides the issued box first, then the handler re-shows it after the
refresh so the secret survives the render (`settings.js:1014-1021`).

**Remove.** `window.confirm` names the token and warns that agents stop working; success re-renders
(`settings.js:948-962`).

**Empty.** Count `0`, no rows, no message. The create form is right below, so the next action is
visible without a sentence.

**Errors.** `#settings-tokens-error` keeps the form and the list; Create re-enables
(`settings.js:1022-1025`).

### 5.4 AI providers

```
┌──────────────────────────────────────────────────────────────────────────┐
│ openai          [Default]  gpt-4o-mini  key stored   Test  Edit  Remove  │
└──────────────────────────────────────────────────────────────────────────┘
│ ollama-lan      [Make default]  llama3  no key       Test  Edit  Remove  │
```

| Part | Value | Source |
|---|---|---|
| Row | `.settings-row.settings-ai-row`, same card as a token row | `style.css:1668-1674` |
| Name | 600, `--text-primary`, ellipsis | `style.css:1675-1680` |
| Meta | `defaultTag`, model `<code>`, key note, `Test`, `Edit`, `Remove` | `settings.js:1137-1202` |
| Default | static `stg-tag stg-tag--accent` reading `Default`; otherwise a `Make default` **secondary** button | `settings.js:1140-1154`; `style.css:1721-1723` |
| Model | `.settings-token-role` (mono, `.78rem`, muted); falls back to the base URL, then `(no model)` | `settings.js:1156-1158` |
| Key note | `key stored` / `no key` | `settings.js:1160-1162` |
| Test | ghost; label swaps to `…`, then `reachable` / `unreachable` / `error`, and back after 2 s | `settings.js:1164-1180` |
| Edit | ghost, `--accent` text; loads the row into the form and focuses the name field | `style.css:1564-1571`; `settings.js:1213-1230` |
| Remove | danger ghost; confirm, then commit | `settings.js:1188-1200` |

**Edit mode.** The group title becomes `Edit provider: <name>`, the primary reads `Save changes`,
`Cancel` and `Save as new` appear, and the edited row keeps a visual link to the form only through
the title (no row highlight ships — `ai-editing`/`editing` classes are set but no rule styles them;
`settings.js:1224-1227`). Renaming carries the stored key over through `replaceSecretFor`
(`settings.js:1726-1729`).

**Empty.** Count `0`, no rows; the add form follows directly. If ACP agents are detected but no
profile is configured, the read-only info panel appears in the list instead of a bare count
(`settings.js:1585-1593`).

**Errors.** `#settings-ai-error` above the form actions; the optimistic row is rolled back
(`settings.js:1279-1282`, `:1764-1774`).

### 5.5 ACP panel (read-only)

| Part | Value | Source |
|---|---|---|
| Box | `.settings-ai-acp-row` / `-info`: `--surface-raised`, `1px --border`, `--radius-md`, `padding: 12px`, `margin: 6px 0 8px` | `style.css:1744-1751` |
| Head | title `ACP agents` (`.74rem` 600 uppercase, tracking `.7px`, muted) + `Read-only` tag | `style.css:1752-1759`; `settings.js:1361-1381` |
| Read-only tag | `.stg-tag` with a lock glyph and the word `Read-only`; `title="Configured by editing config/acp.json on the server"` | `settings.js:1372-1377`; `style.css:1714-1720` |
| Help | "Local coding agents the assistant can drive over the Agent Client Protocol. `config/acp.json` may hold several profiles and is edited on the server (not editable here)." | `settings.js:1516-1526` |
| Profile block | name 600; `Default` tag or `Make default`; meta `allowlist key <code>` or the explicit-command sentence; optional `agent model <code>` | `style.css:1760-1773`; `settings.js:1447-1502` |
| Agent line | name 600; status dot + word; the allowlist key in mono, right-aligned; an optional warn hint on its own full-width line | `style.css:1774-1798`; `settings.js:1390-1441` |
| Selected agent | `--accent-soft` face + `inset 2px 0 0 --accent` | `style.css:1783-1786` |
| Statuses | `Installed` (`--ok`), `Adapter missing` (`--warn`), `Not installed` (muted, no dot colour) — always a word plus a dot | `settings.js:1405-1418`; `style.css:1691-1713` |

`Make default` here posts `default: <profile name>` to `ai.json`; it never writes `config/acp.json`
(`docs/contracts/configuration.md:550-563`). `command`, `args`, `env`, `cwd`, `timeout` never reach
the browser (`docs/contracts/configuration.md:546-549`).

### 5.6 List rules shared by all four

1. A row is `--surface-raised` with a `1px --border`; it is not a menu row and has no hover fill on
   the card itself. Only the row's inner button takes `--accent-soft` (workspaces) or the row's
   ghost actions take it (tokens, AI, shortcuts).
2. The name is the accessible name of the row's action, not an `aria-label` elsewhere.
3. Metadata is always words, not colour alone. Status is dot + word (controls §2.6, foundations
   §3.4).
4. Counts sit in a note above the list (`API tokens: 3`, `Providers: 2`), not in the heading.
5. An empty list has no illustration and no invented copy. The next action (create, add) is directly
   below it.

---

## 6. Authentication states

Three states matter: **no auth** (no admin password), **admin** (signed in as admin), **viewer**
(signed in with the viewer password). `isAdmin()` is `authState.enabled && authState.role ===
"admin"` (`settings.js:592-594`); the initial admin form adds `|| !authState.enabled`
(`settings.js:601`).

| Surface | No auth | Admin | Viewer |
|---|---|---|---|
| General | fully live | fully live | live in the session; the write is refused by the server (§6.1) |
| Appearance | fully live | fully live | as above |
| Workspaces list | visible, no actions | visible, Rename/Remove/Add | visible, no actions |
| Shortcuts | fully live | fully live | live in the session; the write is refused |
| Security → help copy | "Set an admin password to require a password for writing." | "Change the admin password, or remove it to disable auth." | "Sign in as admin to change passwords." |
| Security → admin set form | **enabled** (anyone may set the first password) | hidden (a password exists) | hidden |
| Security → admin change form | hidden | enabled | visible but **disabled**, fields cleared |
| Security → `Remove admin password` | hidden | visible | hidden |
| Security → viewer toggle and rows | disabled; rows hidden | enabled | disabled; the password row still shows when a viewer password exists, with no confirm and no action — P14 |
| Security → viewer `Save`, `Remove` | hidden (actions hidden when not admin) | enabled per the match rule | hidden |
| API tokens help | "Sign in as admin to manage API tokens." | "Bearer tokens let agents and scripts call the API … See the agent guide at /agent.md." | same as no auth |
| API tokens list, count, name, role, Create | `—`, empty, all disabled | listed, enabled | `—`, empty, all disabled |
| AI help | "Sign in as admin to configure AI providers." | the provider sentence | same as no auth |
| AI list, count, form, prompt, SearXNG, saves | `—`, empty, all disabled | listed, enabled | `—`, empty, all disabled |
| About | read-only | read-only | read-only |

Sources: `settings.js:628-689` (Security), `:917-929` (tokens), `:1092-1126` (AI),
`:1596-1626` (AI fetch gate), `:966-979` (tokens fetch gate); `workspaces.js:128-132`,
`index.html:801-805`.

### 6.1 Two documented consequences

1. **On an open server, tokens and AI are disabled.** `isAdmin()` is false when auth is off, so the
   Security token controls and the whole AI tab are read-only, while `POST /api/config` and the AI
   routes accept a loopback peer. The DOM suite asserts this exact state
   (`tests/dom/test_dom.js:26797-26811`: "auth off -> name input + create disabled", "help asks to
   sign in as admin"), so it is shipped behaviour, not an accident. Changing it needs a test change;
   §12 P10 records it as a proposal, not a fix.
2. **A viewer's Appearance and General changes apply but do not persist.** `NB.app.setTheme` and
   friends write `cfg` and POST through `persistConfig`, which has no role guard on desktop
   (`app.js:521-526`, `:576-621`); `POST /api/config` is `@admin_required` (`app.py:1588-1591`), so
   the write 403s and the app logs a warning (`app.js:598`). The control stays enabled and the
   change shows in the session. This is recorded, not changed: disabling the controls would be a
   visible behaviour change and §12 P11 is the proposal.

### 6.2 The auth fetch

If `GET /api/auth` fails, `authState` becomes `null` (`settings.js:706-709`). The renderer then
treats the install as "no admin password": the initial set form is enabled and viewer controls are
disabled. That is a fail-open shape for the password UI and is recorded as exception **E7**. The
target is the same render with the form disabled and a visible line naming the failed status fetch;
no visual value changes, only the `disabled` state and one sentence.

---

## 7. States

| State | Trigger | What the surface shows | Copy |
|---|---|---|---|
| Opening | `NB.settings.open()` | previous tab, radios and switches synced from `cfg`, About `…`, counts from the last render, focus on Close with a forced ring | — |
| Loading config | first open, fetch in flight | About folders `…`; token and AI counts `0` until the response; Security renders "Not set" for a moment | `…` |
| Config fetch failed | `/api/info` rejects | About folders replaced | `(failed to load)` |
| Provider/token fetch failed | `/api/ai/config` or `/api/auth/tokens` rejects | count `—`, list empty, error line shown | API's message, else `Failed to load AI providers` / `Failed to load tokens` |
| Saving (explicit) | a Save/Create/Revoke click | button disabled; AI prompt and SearXNG read `Saving…`; auth and tokens do not relabel | `Saving…` |
| Saved | response resolves | vimrc status line; prompt and SearXNG status `Saved` for 2 s; passwords and viewer reload the page; live radios change silently | `Saved`, `Saved (N binding(s) applied)` |
| Validation error | mismatch, empty required value, duplicate name | `.auth-error` or the AI/token error block; the form and its values stay; the button re-enables when the cause clears | `New password and confirmation must match`, `Token name is required`, `A provider named "x" already exists` |
| Parse error (vimrc) | non-zero parser result | status line under the textarea, last good config kept | `Line N: <message> (+K more)` |
| No workspace | `boot.workspace_id` absent | no Workspaces nav item and no section | — |
| Closed | Esc, backdrop, ×, footer Close | overlay `hidden`; focus returns to the opener | — |

Sources: `settings.js:181-219` (open/close), `:557-567` (About), `:706-712` (auth fetch),
`:966-994`, `:1596-1626` (list fetches), `:1289-1357` (AI saves), `:507-555` (vimrc);
`NB.dialog` containment `dialog.js:75-119`.

There is no spinner anywhere in Settings. Every fetch is a local server round trip and the surface
shows its last known value while it resolves.

---

## 8. Keyboard and ARIA

### 8.1 The dialog

| Contract | Shipped | Source |
|---|---|---|
| Role | `role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1"` on `.settings-modal` | `index.html:712` |
| Accessible name | `#settings-title` = `Settings` | `index.html:714` |
| Containment | `NB.dialog.open()` inerts every other body child, wraps Tab at both ends, and watches for later body children | `dialog.js:75-108` |
| Initial focus | `#settings-close`, with `.stg-initial-focus` painting the ring after a mouse-open | `settings.js:164-179`, `:199-204`; `style.css:1445-1449` |
| Tab wrap | last control → first, first → last; the dialog node counts as both ends | `dialog.js:58-73` |
| Return focus | to the opener (the rail Settings button), or the declared fallback | `dialog.js:117-118`; `settings.js:200-203` |
| Esc | closes the modal | `settings.js:576-578` |
| Nested dialog | the workspace dialog stops Esc so one press closes one layer | `workspaces.js:1086-1091` |
| Backdrop | a click whose target is the overlay closes | `settings.js:572-575` |
| Background | inert, so pointer and AT cannot reach it; the browser test asserts 40 Tab presses stay inside | `tests/browser/test_auth_export_browser.js:286-380` |

### 8.2 The nav

Shipped: `role="tablist"` with `aria-label="Settings sections"`; each item `role="tab"` with
`aria-selected` and `aria-controls` (`index.html:722-732`); activation moves focus nowhere, because
the clicked button already has it.

The target adds, with no visual change:

| Addition | Value |
|---|---|
| Orientation | `aria-orientation="vertical"` on the tablist |
| Ids | each tab gets `id="settings-tab-<name>"` |
| Panels | each section gets `role="tabpanel"`, `aria-labelledby="settings-tab-<name>"`, `tabindex="0"` only if it has no focusable child (all seven do, so no tabindex) |
| Roving tabindex | exactly one tab has `tabindex="0"`; the rest `-1` |
| Keys | `ArrowDown`/`ArrowUp` move and activate, wrapping; `Home`/`End` first/last; `Enter`/`Space` native |
| Hidden | the inactive sections keep `hidden`, which removes them from the tree |

`aria-controls` already points at the right section id, so the roving model needs no markup change
beyond ids. This is exception **E1**.

### 8.3 Rows and lists

| Surface | Contract | Shipped? |
|---|---|---|
| Workspaces list | `role="list"` + rows `role="listitem"`; the row's main control is a native button | yes — `index.html:800`, `workspaces.js:818` |
| Workspaces active row | `aria-current="page"` | yes — `workspaces.js:828` |
| Shortcuts list | `role="list"` + rows `role="listitem"` | yes — `index.html:904`, `settings.js:269` |
| Shortcuts static list | `role="list"` + rows `role="listitem"` | yes — `index.html:920-924` |
| API tokens list | no role; rows are `div`s | **no** → E2: list `role="list"`, rows `role="listitem"` |
| AI provider list | no role, and it also hosts the ACP panel | **no** → E2: a `role="list"` **inner** host for provider rows only, so the ACP panel stays outside it |
| Switch | native checkbox + `<label for>`; no `role="switch"` | yes — controls §2.7, `settings.js`/markup |
| Status lines | `.settings-watch-status`, `.settings-vimrc-status`, prompt/SearXNG/TEST labels | **no** `role="status"` → E3 |
| Errors | `.auth-error` blocks are `role="alert"` | yes — `index.html:1096`, `:1131`, `:1210` |
| Live count notes | `API tokens: N`, `Providers: N` | no live region; the list change is the signal → keep |
| Read-only ACP tag | text, not a control | yes — `settings.js:1372-1377` |

### 8.4 Focus order

DOM order, no positive `tabindex`:

1. Header: `Maximize`, `Close`.
2. Nav: seven tabs.
3. The active section's controls, top to bottom.
4. Footer: `Close`.

Because inactive sections are `hidden`, their controls are not in the order. The sections column is
the scroller, so focusing a control below the fold scrolls the column, not the page.

### 8.5 Targets

| Control | Box | Floor |
|---|---|---|
| Nav item | 33.5 px tall | 24 fine ✓ |
| Button | 30 px | 24 fine ✓ |
| Field | 36 px | 24 fine ✓ |
| Switch | 36 × 20 | **20 < 24** — the `<label>` extends the hit to the row; proposal P4 keeps the box |
| Radio chip | ≈26 px tall | 24 fine ✓ |
| Ghost row action | `padding: 4px 10px`, ≈25 px | 24 fine ✓ |
| Close icon button | ≈26 px | 24 fine ✓ |
| Resize grip | 18 × 18 | Pointer-only affordance; the modal can also be resized by dragging saved geometry. Recorded, not enlarged (P12) |

The whole surface is desktop-only in practice (§9), so the 44 px coarse floor applies to the phone
sheet only.

---

## 9. Responsive and phone

### 9.1 Desktop and narrow desktop

| Viewport | What happens | Source |
|---|---|---|
| ≥ 1024 | As designed. Medium preset = 75 vw × 85 vh, clamped at 96 vw / 92 vh | `style.css:1824-1827` |
| 861–1023, fine pointer | The desktop shell stays. The modal is still 75 vw; the 180 px nav is unchanged, so the sections column shrinks. No refinement rule exists | measured; `style.css` has no `.settings-*` media query |
| ≤ 860, or coarse ≤ 1023 | Phone shell. `#activity-settings-btn` is hidden, so the modal has no chrome opener | `style.css:7199-7204`; `shell-frame.md` §3.1 |

At 1024 the medium modal is 768 px wide, the nav 180, the sections 587. Two columns of radio chips
still fit; the workspace row's actions get tight but do not wrap (the row does not wrap).

### 9.2 The modal at 390 (measured, not reachable)

At a 390 px viewport the initial size is `min(75vw, 96vw)` = **292.5 px**. The nav keeps 180 px, so
the sections column is **112 px** minus its padding — unusable. There is no media query that
changes this. The modal cannot be opened from the phone chrome (the rail Settings action is hidden),
but a keyboard shortcut, a restored session, or a programmatic call would open a 292 px box.

Do not "fix" this by shrinking the nav to a strip without moving the layout behind a design: at
112 px no field, row or list fits. The nav strip is proposal **P2**, and the sheet is the shipped
phone surface.

### 9.3 The phone settings sheet

`#mobile-settings` is a bottom sheet, not this modal. It exists as an empty host in the markup and
`mobile.js` builds it on every open (`index.html:1784-1785`; `mobile.js:655-745`).

| Part | Value | Source |
|---|---|---|
| Box | fixed, left/right 0, bottom `var(--m-kb, 0px)`, `--z-sheet` 600, `--surface-panel`, top border, top radius 16 | `style.css:7593-7609` |
| Height | `max-height: min(72dvh, 560px)`, content-sized | `style.css:7602` |
| Motion | `transform .22s cubic-bezier(.2,.8,.2,1)` + delayed visibility; `none` under reduced motion | `style.css:7611-7618`, `:7764-7770` |
| Open | `body.settings-open`; closed via `hidden` | `style.css:7614-7621` |
| Grabber | 36 × 4, radius 2, `--border`, centred, 8 px from the top | `style.css:7622-7629` |
| Header | 52 px; title `Settings` at 16 px 600; close 44 × 44, `aria-label="Close settings"` | `style.css:7631-7652`; `mobile.js:663-674` |
| Body | `padding: 0 16px 8px`, scrolls, `overscroll-behavior: contain` | `style.css:7691-7696` |
| Row | flex, gap 12, `min-height: 52px`, 1 px bottom border, wraps | `style.css:7697-7704` |
| Label | `15px`, flex 1 | `style.css:7705` |
| Segmented control | inline flex, 1 px border, radius 8, clipped; each button 44 high, `13px`, `--accent` fill + `--text-on-accent` when on | `style.css:7707-7724` |
| Note | `12px`, muted, `margin: 10px 0 14px` | `style.css:7725` |
| Server row | mono `12px/1.4`, muted, dot + `host · Online / Offline` | `style.css:7726-7736`; `mobile.js:711-723` |
| Sign out | full width, 44 high, transparent, `--danger` border and text; only when auth is enabled | `style.css:7737-7742`, `:7679-7689`; `mobile.js:731-742` |

Contents, in order: **Theme** (Auto / Dark / Light), **Text size** (S / M / L / XL), **Server**
(origin · Online/Offline), the note "Theme and text size are saved on this server and apply to every
device.", then Sign out when auth is on. No AI, tokens, workspaces, graph, export or admin controls.
The DOM suite asserts exactly that (`tests/dom/test_dom.js:40743-40791`).

A viewer sees `Admin only` in place of each segmented control (`mobile.js:648-653`, `:685-709`), and
the sign-out control is present because signing out is not a write.

### 9.4 What the phone does not offer

| Missing on phone | Consequence |
|---|---|
| Workspaces tab | switch workspaces from the topbar chip / Home |
| Security, tokens, AI, About | admin surfaces are desktop-only |
| Modal width/height presets | the sheet is one size |
| Shortcuts | keyboard-only surface; the phone has no hardware keyboard path |

These are deliberate. §13 forbids adding them.

---

## 10. Tokens and CSS target

### 10.1 Reuse first

Every value in this surface already maps to a foundation token. The substitution table is the whole
migration; there is no new geometry.

**Foundation deltas, not silent substitutions.** Adopting the tokens also adopts the palette
changes in foundations §3.6/§5.4: dark `--fg-muted` `#9799a4`, light `--ok` `#16703f`, light
`--warn` `#8a5a0b`, and the light `--shadow-modal` alpha `.22`. They change the light theme; they
are listed here so the pass does not claim otherwise.

| Shipped literal | Token | Where | Same pixels? |
|---|---|---|---|
| `rgba(0,0,0,.5)` | `--overlay-scrim` (`--scrim`) | `style.css:1372` | yes |
| `z-index: 2000` | `--z-modal` | `:1373` | yes |
| `12px` radius | `--radius-lg` | `:1830` | yes |
| `0 20px 60px rgba(0,0,0,.5)` | `--shadow-modal` | `:1831` | dark yes; light changes to `.22` (foundation delta) |
| `rgba(0,0,0,.5)` on `--bg-panel` | no shadow change; header/footer keep `--surface-panel` | `:1902`, `:2263` | yes |
| `6px` radius | `--radius-sm` | `:1512`, `:1540`, `:1948` | yes |
| `8px` radius | `--radius-md` | `:1672`, `:1748`, `:2184` | yes |
| `999px` | `--radius-pill` | `:1597`, `:1631`, `:1717` | yes |
| `2px` focus offset on the switch | `--focus-offset` | `:1609` | yes |
| `1px` focus offset elsewhere | no token (`--focus-offset` is 2) | `:1448`, `:1549`, `:1658`, `:1979` | — exception E4 |
| `.15s` switch motion | `--dur-1` (120 ms) | `:1598`, `:1604` | no (30 ms shorter) — proposal P5 |
| `.12s` chip motion | `--dur-1` | `:1634` | yes |
| `--stg-space-1..6` = 4/6/8/12/16/24 | `--space-1`, none, `--space-2`, `--space-3`, `--space-4`, `--space-6` | `:1396-1401` | 4/8/12/16/24 yes; 6 px keeps its own name (E5) |
| `132px` label gutter | no token; keep component-local `--stg-label-w` | `:1409` | yes |
| `180px` nav column | no token; keep component-local `--stg-nav-w` | `:1932` | yes |
| `--stg-field-pad-y/x` 6/10 | no token; keep | `:1412-1413` | yes |
| `--stg-btn-pad-y/x` 6/14 | no token; keep | `:1414-1415` | yes |
| `.93rem`, `.86rem`, `.8rem`, `.78rem`, `.76rem`, `.74rem`, `.72rem`, `.68rem` | `--text-ui-lg`, `--text-ui`, `--text-sm` (.8), no token (.78), no token (.76), no token (.74), `--text-xs` (.72), no token (.68) | throughout | partial — see E6 |
| `#9799a4` / `#5d6470` override of `--fg-muted` | already the foundation value in both themes | `:1421`, `:1436` | yes — the override is a no-op |
| `--stg-ok: var(--ok)`, `--stg-warn: var(--warn)` | identical alias | `:1425-1426`, `:1437-1438` | yes — delete |
| `--stg-switch-knob` | `--switch-knob` (controls §1.2) | `:1430`, `:1439` | yes |
| `--stg-focus-ring` | `--focus-ring` | `:1433` | yes, but offset differs (E4) |

**Rule.** A token that is an exact duplicate of a foundation token is deleted and its uses read the
foundation token. A value with no token stays component-local with a `--stg-` name, which is the
sanctioned component tier (`foundations.md` §2.1). No alias is added back into a base token
(`foundations.md` §2.5).

### 10.2 Where the shipped values sit against the foundation

| Foundation requirement | Shipped | Verdict |
|---|---|---|
| Input border 3:1 → `--border-strong` | `1px --border` (1.27:1 light, 1.39:1 dark on panel) | fixed by E11 |
| Switch track 3:1 → `--border-strong` | `--border` when off | fixed by the unified block |
| Text on accent → `--text-on-accent` | primary uses `--accent-fg` already | passes |
| Focus ring 2 px accent | 2 px accent at offset 1 | unified to `--focus-offset` 2 |
| Disabled opacity `--opacity-disabled` (.45) | `.5` buttons, `.55` fields, `.5` switch | fixed by the unified block |
| Field height `--control-h-lg` 36 | 29 | fixed by the unified block |
| Button height `--control-h-md` 30 | 31.6 | normalised to 30 by the unified block |
| No `filter: brightness()` as a state | primary hover `brightness(1.06)` | fixed: halo, no filter |
| No emoji chrome | seven nav glyphs + the lock in the read-only tag | fails — proposal P1 |
| 4 px spacing grid | 6 px row padding, 6 px group gap, 10 px field padding | fields and buttons snap; row padding stays 6 (E5) |
| Reduced motion twin for every transition | switches yes; chips yes; **capture pulse no** | fails — exception E8 |

The control rows are applied by the unified block. What remains is P1 (nav icons), P2 (nav strip at 390) and the layout proposals.

### 10.3 Exceptions — applied by this pass

Each is an accessibility or consistency fix. None changes a resting pixel; E7 adds a failure-state sentence.

| # | Exception | Why | Target |
|---|---|---|---|
| **E1** | Nav is a tablist without roving tabindex, arrows, ids, or tabpanels | Every tab is a Tab stop and a screen reader cannot tie tab to panel | §8.2: orientation, ids, `role="tabpanel"`, `aria-labelledby`, roving tabindex, arrows, Home/End |
| **E2** | Token and AI lists have no list semantics | Rows are announced as unrelated groups | `role="list"` + `role="listitem"`; the AI list's provider rows get their own inner list so the ACP panel stays outside |
| **E3** | Status lines are silent | A Save result and a watch state change are not announced | `role="status"` on `#settings-watch-status`, `#settings-vimrc-status`, `#settings-ai-prompt-status`, `#settings-ai-searxng-status`; the provider Test label is the button text, so it gets `aria-live="polite"` and keeps `role="button"`, or a sibling status span |
| **E4** | Focus offset is 1 px here, 2 px everywhere else | The ring is drawn inside the control and reads as a border on a 30 px button | Keep 1 px (it is the shipped look) and record it; do **not** raise it to `--focus-offset` |
| **E5** | Two spacing half-steps survive: 6 px and 10 px | The `--stg-*` rhythm predates the 4 px grid; snapping changes the look | Keep; no new work may copy them (`foundations.md` §5.1) |
| **E6** | Five type sizes have no token (`.78`, `.76`, `.74`, `.68`, and `.9rem` on buttons) | Splitting them out would change sizes | Keep; any new text uses the scale |
| **E7** | A failed `/api/auth` leaves the initial admin form enabled | Fail-open password UI | Keep the same render but disable the form and show "Could not read the auth state. Reopen Settings to retry." in `#settings-auth-help` — a failure-state line, not a resting one |
| **E8** | The shortcut capture pulse and the chip-label colour transitions have no reduced-motion twin | Foundations §7.3 is mandatory; the eight chip groups transition background/border/colour at `.12s` (`style.css:1634`) | `@media (prefers-reduced-motion: reduce) { .shortcut-binding-capturing { animation: none; } #settings-overlay :is(.theme-options, .font-size-options, .wallpaper-color-options, .wallpaper-intensity-options) label { transition: none; } }` — the accent border and wash carry the state |
| **E9** | `touch-action: none` sits on the whole modal box | Blocks touch scrolling of the sections column on a coarse-pointer tablet | Move it to `.resize-grip` and `.settings-header`, as controls §9 C6 already requires |
| **E10** | The phone sheet has no trap, no inert background, no return focus | It is `role="dialog" aria-modal="true"` but behaves as a plain panel | `NB.dialog.open/close` around `openSettings`; focus already moves to Close (`mobile.js:752-756`). Exempt `.toast` from the inert list and keep `#mobile-scrim` clickable, or include the scrim in the dialog node set |

E7 changes one sentence and one disabled state; E8 and E9 change no resting pixels; E10 changes
behaviour only. The rest are semantics.

### 10.4 Rules, in landing order

Each step is one commit and ships alone. `style.css` line numbers name the rule being edited.

```css
/* 1. Overlay: tokenise, no value change. style.css:1369-1387 */
:where(body) > .settings-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  z-index: var(--z-modal);
  min-width: 0;
  min-height: 0;
}
:where(body) > .settings-overlay[hidden] { display: none; }

/* 2. Modal box. style.css:1801-1840 */
:where(body > .settings-overlay) > .settings-modal {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(var(--settings-modal-width, 75vw), 96vw);
  height: min(var(--settings-modal-height, 80vh), 92vh);
  max-width: 96vw;
  max-height: 92vh;
  background: var(--surface-panel);
  border: var(--stroke-1) solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* E9: touch-action moved off the box */
}

/* 3. Parts. style.css:1897-1927, :1931-1940, :1984-1994, :2257-2265 */
.settings-header { padding: 14px 18px; border-bottom: var(--stroke-1) solid var(--border); flex-shrink: 0; }
.settings-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
.settings-nav { --stg-nav-w: 180px; flex: 0 0 var(--stg-nav-w); padding: var(--stg-space-3) var(--stg-space-2); gap: var(--space-hair); }
.settings-sections { padding: var(--stg-space-1) 18px 18px; }
.settings-section { padding: 14px 0; border-bottom: var(--stroke-1) solid var(--border); }
.settings-footer { padding: 12px 18px; border-top: var(--stroke-1) solid var(--border); background: var(--surface-panel); }

/* 4. Delete the duplicate tokens: style.css:1421, :1436, :1425-1426, :1433, :1437-1438.
      Keep --stg-space-*, --stg-label-w, --stg-nav-w, --stg-field-pad-*, --stg-btn-pad-*. */

/* 5. Rows, fields, buttons, chips, switches: read the foundation names.
      No declaration changes value. style.css:1474-1665, :1668-1688. */

/* 6. Controls: the 1 px focus offset is kept (E4). */
#settings-overlay .settings-modal :focus-visible,
#settings-overlay .settings-modal .stg-initial-focus {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

/* 7. E8: the missing reduced-motion twin. */
@media (prefers-reduced-motion: reduce) {
  #settings-overlay .shortcut-binding-capturing { animation: none; }
  #settings-overlay :is(.theme-options, .font-size-options,
    .wallpaper-color-options, .wallpaper-intensity-options) label { transition: none; }
}

/* 8. E9: the touch-action home. */
:where(body > .settings-overlay) > .settings-modal .resize-grip,
:where(body > .settings-overlay) > .settings-modal .settings-header {
  touch-action: none;
}

/* 11. E11: a field is a control; its boundary clears 3:1. */
#settings-overlay .settings-text-input,
#settings-overlay select,
#settings-overlay textarea,
#settings-overlay .auth-input { border-color: var(--border-strong); }

/* 12. Unified control layer: one field, one button, one switch, one chip. */
#settings-overlay .settings-text-input,
#settings-overlay select,
#settings-overlay .auth-input {
  height: var(--control-h-lg);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-ui);
}
#settings-overlay .settings-action {
  height: var(--control-h-md);
  padding: 0 var(--space-3);
  font-size: var(--text-ui);
  line-height: var(--lh-flat);
  border-color: var(--border-strong);
}
#settings-overlay .settings-action--primary:hover:not(:disabled) {
  box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft);
  filter: none;
}
#settings-overlay .settings-action:disabled { opacity: var(--opacity-disabled); }
#settings-overlay input[type="checkbox"] {
  border: var(--stroke-1) solid var(--border-strong);
  background: var(--surface-well);
  transition: background var(--dur-1) var(--ease-out);
}
#settings-overlay input[type="checkbox"]::after {
  top: 1px; left: 1px;
  transition: transform var(--dur-1) var(--ease-out);
}
#settings-overlay input[type="checkbox"]:checked {
  background: var(--accent);
  border-color: var(--accent);
}
#settings-overlay input[type="checkbox"]:checked::after { transform: translateX(16px); }
#settings-overlay input[type="checkbox"]:disabled { opacity: var(--opacity-disabled); }
#settings-overlay .settings-nav-item { min-height: var(--control-h-md); font-size: var(--text-ui); }
```

Steps 4–6 are mechanical: `--bg-panel` → `--surface-panel`, `--bg-elev` → `--surface-raised`,
`--code-bg` → `--surface-well`, `--fg` → `--text-primary`, `--fg-muted` → `--text-muted`,
`--accent-fg` → `--text-on-accent`, `6px` radius → `--radius-sm`, `8px` radius → `--radius-md`,
`999px` → `--radius-pill`, `1px` border → `var(--stroke-1)`.

Do not restructure the file. Do not merge the eight radio groups into one class. Do not move the
`#settings-overlay` block into the global base rules.

### 10.5 The mockup's token rule

`settings-modal-mockup.html` copies the foundation blocks verbatim and adds only component-local
`--stg-*` numbers that already exist in the stylesheet. It declares no alias of its own and no token
that references itself. Dark boards sit inside `.theme-dark`, light boards inside `.theme-light`,
and the primitive block is on `:root` once.

---

## 11. Acceptance criteria

Each is testable and names its file and check. `style.css` = `static/css/style.css`.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | The overlay and box keep their shipped geometry | `style.css` | The overlay is `--overlay-scrim` at `--z-modal`; the modal is 75 vw × 85 vh at the defaults, clamped at 96 vw / 92 vh, `--radius-lg`, `--shadow-modal`, `--surface-panel` |
| **AC2** | The nav has seven tabs in shipped order, with Workspaces conditional | `index.html` | With a workspace: General, Workspaces, Appearance, Shortcuts, Security, AI, About. Without: six, in order. Every `data-tab` has a section id and back (`tests/dom/test_dom.js:25640-25656`) |
| **AC3** | The nav is a real tablist | `index.html`, `settings.js`, `style.css` | `aria-orientation="vertical"`; ids on tabs; `role="tabpanel"` + `aria-labelledby` on sections; one `tabindex="0"`; arrows move and activate; Home/End |
| **AC4** | General writes live and the delay follows autosave | `settings.js` | Typing a title persists `siteTitle` after 250 ms; toggling Autosave off disables the delay field; toggling VIM persists `vimMode` |
| **AC5** | The watch row reports state as dot + word and one button | `settings.js`, `style.css` | Copy is `Watching …` / `Polling (5s)` / `Watching off`; classes `watch-on`/`watch-off`; button `Enable`/`Disable`; `Unavailable` + disabled when `NB.watcher` is absent |
| **AC6** | The VIM script is explicit and keeps the last good config | `settings.js` | Save applies, then persists; a parse error shows `Line N: …` in `--warn`, the textarea keeps the text, `cfg.vimrc` is unchanged; success shows `Saved (N binding(s) applied)` |
| **AC7** | Appearance has eight chip groups and two switches, all live | `index.html`, `settings.js` | Theme, font size, modal width, modal height, wallpaper, scroll, colour, intensity; Hide top bar, particles. Each change updates `cfg` and `:root` immediately |
| **AC8** | Workspaces rows carry the shipped anatomy and gates | `workspaces.js`, `style.css` | Check mark, name, `Active`/`Default`/`Not found` badges, mono path, `Rename`/`Remove`; Add only for an admin; Remove disabled with its title for default and active; switching reloads |
| **AC9** | Shortcuts shows 9 configurable rows, 13 static rows, and reset | `settings.js`, `index.html` | `Reset` hidden at default; capture shows `Press a key… (Esc to cancel)` and `Cancel`; `Reset all to defaults` present; static bindings localised (`tests/dom/test_dom.js:25732-25811`) |
| **AC10** | Security adapts to admin set / change / remove and viewer set | `settings.js` | Set form when no admin password; change form when set; Remove reveal needs a current password and a confirm; each success reloads the page; errors appear in `#settings-auth-error` (`tests/browser/test_auth_export_browser.js:388-648`) |
| **AC11** | A viewer sees the read-only Security state | `settings.js` | Fields disabled and cleared; `Remove admin password` and viewer actions hidden; help reads "Sign in as admin to change passwords." |
| **AC12** | Tokens are one-time, revocable, and gated | `settings.js` | Count `0`, issued box on create, `Revoke` after confirm, error keeps the form; list has `role="list"` with `role="listitem"` rows; auth off → count `—`, name and Create disabled, help asks to sign in (`tests/dom/test_dom.js:26797-26812`) |
| **AC13** | AI providers add, edit, rename, save-as-new, remove, test | `settings.js` | Primary reads `Add provider` / `Save changes`; `Cancel` and `Save as new` only in edit; `Default` tag or `Make default`; key note `key stored`/`no key`; duplicate name error; provider rows are a `role="list"` that excludes the ACP panel |
| **AC14** | The ACP panel is read-only and never enters a save payload | `settings.js`, `style.css` | `Read-only` tag, profile blocks and agent lines with dot + word; `Make default` posts only the default name; `aiProviders` never holds an ACP entry (`tests/dom/test_dom.js:33137-33320`) |
| **AC15** | Prompt and SearXNG save independently | `settings.js` | Each button enabled only when the value differs; busy `Saving…`; status `Saved` for 2 s; Ctrl/Cmd+Enter saves; a provider save does not clobber either |
| **AC16** | About reports the two folders and survives a failure | `settings.js` | Paths render in mono; a failure reads `(failed to load)`; a long path wraps instead of widening the modal |
| **AC17** | Keyboard and containment match the dialog contract | `dialog.js`, `settings.js` | Initial focus Close; Tab wraps; 40 Tab presses stay inside; Esc closes; a nested workspace dialog closes alone; backdrop click closes; focus returns to `#activity-settings-btn` (`tests/browser/test_auth_export_browser.js:286-380`) |
| **AC18** | The phone sheet is the shipped one | `mobile.js`, `style.css` | Theme and text size segmented, server row, note, Sign out only with auth; no AI/token/admin controls; every control 44 px; `Admin only` for a viewer (`tests/dom/test_dom.js:40743-40791`) |
| **AC19** | Reduced motion removes the switch motion and the capture pulse | `style.css` | With reduce emulated, no switch or chip animates and the capturing row keeps its accent border and wash |
| **AC20** | No new colour literal outside the token blocks | `style.css` | The diff adds hex nowhere; the removed `--stg-*` duplicates are gone and the remaining `--stg-*` names are numbers |
| **AC21** | The mockup is self-contained | `settings-modal-mockup.html` | Opening it offline shows dark and light boards, the phone sheet, and every state named in §1, with zero network requests |
| **AC22** | E10: the sheet is contained | `mobile.js` | Opening the sheet inerts the background, Tab wraps inside it, and closing returns focus to the control that opened it |
| **AC23** | E7 and E9 hold | `settings.js`, `style.css` | A rejected `/api/auth` leaves the initial form disabled with the named line in `#settings-auth-help`; `touch-action: none` appears only on `.settings-header` and `.resize-grip`, and the sections column touch-scrolls |
| **AC24** | The control layer is unified | `style.css` | A field is `--control-h-lg` 36 high with `--border-strong` and `--text-ui`; a button is `--control-h-md` 30 with `--border-strong`; a switch off-track is `--border-strong`; every disabled control is `--opacity-disabled`; focus is `--focus-ring` at `--focus-offset`; the primary hover is a 3 px `--accent-soft` halo with no `filter`; a chip is `var(--space-1) var(--space-3)` with `--text-ui` |

---

## 12. Proposals, not applied

Visual or behaviour changes that would make this surface better and are **not** part of this pass.
Each names what it would touch.

| # | Proposal | Why | Cost / risk |
|---|---|---|---|
| **P1** | Replace the seven nav emoji and the lock in the read-only tag with `nb-icon-*` sprite glyphs on the 16 grid | Foundations P6 and §9.3 forbid emoji as chrome; the nav is the last emoji control set in the app | Touches `index.html:723-731` and `settings.js:1374-1377`; needs six new symbols; five DOM tests read the nav label text, so the labels stay and only the `.nav-icon` content changes |
| **P2** | Below 1024 (or at ≤860) turn the nav into a horizontal scrolling strip above the sections, and give the modal a `min(560px, 96vw)` floor | At 390 the measured modal is 292 px with a 112 px content column (§9.2) | New refinement query scoped to `.settings-modal`; the strip duplicates the active-bar idea from the file tabs; must not become a second mode switch |
| **P3** | *(applied)* field height 36, button height 30 | The 29 px field is below the 36 px field token | Visible: 7 px of field height |
| **P4** | Grow the switch hit to 24 px without changing the 36 × 20 track, using padding on the label | The 20 px box is under the 24 px fine-pointer floor | No visual change if the label already spans the row; needs a measurement per row |
| **P5** | Primary hover: 3 px `--accent-soft` halo instead of `filter: brightness(1.06)`; switch motion `--dur-1` | Foundations §11.4 forbids the filter; the halo is shipped elsewhere (`.ai-send`, `.ai-input-row`) | Slight hover-colour change; one line |
| **P6** | One disabled opacity `--opacity-disabled` (.45) for buttons, fields and switches | Three values ship: .5, .55, .5 | Visible only in the disabled state |
| **P7** | Add an explicit empty/error state under the Workspaces list and the token/AI lists | A failed list fetch currently renders nothing; the count is the only clue | New copy, one line each; must not fire when the list is legitimately empty |
| **P8** | Make the section heading and the nav label one thing (drop the repeated `h3`, or make it a description) | Seven tabs repeat their own name at the top of the panel | Removes 7 headings; changes the top rhythm of every tab |
| **P9** | Fix the `open()` comment: it says "always start on General", the code keeps the last tab | A future reader will "fix" the code to match the comment | Comment only |
| **P10** | Gate tokens and AI on `NB.auth.canWrite()` instead of `isAdmin()`, so an open (auth-off) server can configure them | The server allows loopback admin writes when auth is off, but the UI disables both surfaces; this is the only way to configure AI on an open server | Breaks `tests/dom/test_dom.js:26797-26811` deliberately; needs a copy change ("Sign in as admin" is wrong when auth is off) |
| **P11** | Tell a viewer that Appearance/General changes are session-only, or disable them | `POST /api/config` is admin-only; a viewer's change applies and 403s silently (§6.1) | One status line or a disabled state; either is visible |
| **P12** | Enlarge the resize grip to 24 × 24 and keep the 10 px mark | 18 × 18 is below the fine-pointer floor | Visible corner change; the grip is pointer-only today |
| **P13** | Show the active tab as a `tabpanel` heading and drop `.settings-section`'s `border-bottom` on the last section (already none) — i.e. one visible seam only | Two seams show when a tab is short: the section rule and the footer rule | Cosmetic |
| **P14** | Hide the `Viewer password` row from a viewer, or disable it | The shipped render shows the row (because a viewer password exists) while the confirm row and the actions are hidden, leaving an editable field with no way to submit (`settings.js:679-690`) | The row disappears for a non-admin; one line of render logic |
| **P15** | Move `#settings-auth-error` under the password group that raised it, or keep one error per group | The single shared block sits at the end of the Passwords section, so an admin mismatch is announced beside the viewer toggle, not beside the admin fields (markup `index.html:1096`) | One block per group or one anchor that names the group; no visual change beyond position |
| **P16** | Let the assistant-instructions textarea use the column width (drop `.settings-auth-input` from it, or raise its `max-width`) | The 260 px field cap leaves a four-line prompt in a 260 px box inside a 740 px column | Visible; one class change on the textarea |
| **P17** | Keep the `agent guide` link and rewrite only the sentence around it | The live render replaces the help paragraph's children with `textContent`, so the shipped `target="_blank"` link disappears on the first open (`settings.js:924-928`; markup `index.html:1104-1107`) | Restores one link; the rest of the paragraph is unchanged |

P2 and P3 are the two that matter for correctness. The rest are finish.

---

## 13. What not to build

| Rejected | Reason |
|---|---|
| A global Apply / Save / Cancel footer | Settings are live by design; the footer's one job is Close (`index.html:1227-1232`). §3.7 |
| A second scrim, or a nested overlay for a tab | `.settings-overlay` is the only backdrop; the workspace dialog uses `--z-dialog` above it (`style.css:8175`, foundations §6.2 rule 2) |
| A new tab, or a reorder of the seven | The order is asserted (`tests/dom/test_dom.js:25654-25656`); a new surface appends after About |
| A custom select for Role or any other select | Native select is the contract (controls §2.5); the wallpaper's five options fit a native popup |
| A custom tooltip for the disabled Remove buttons | The `title` carries the reason; controls §2.10 forbids a tooltip component |
| Drag-to-reorder tabs, or a settings search field | Neither is asked for; the nav is seven rows and every tab is one click |
| Editing `config/acp.json` from the UI | The file chooses a command to execute; it stays server-side and read-only (`docs/contracts/configuration.md:435-445`; §5.5) |
| Revealing an API key after it is stored | The server never returns it; only `hasKey` (`docs/contracts/configuration.md:422-429`) |
| Re-showing an issued token after the list refreshes | It is shown once per create, by design (§5.3) |
| A toast for every live toggle | The control is the feedback; the write is debounced and silent (§3.7) |
| AI, tokens, workspaces or admin controls on the phone sheet | The sheet is deliberately four rows plus Sign out (§9.3; `tests/dom/test_dom.js:40752-40756`) |
| A second mode switch, or a new breakpoint | Foundations §8.2; P2 must reuse 860/1024 if it ever lands |
| Auto-applying a half-typed VIM script | The parser reports line errors; explicit Save keeps the last good config (§4.1) |
| A filled danger button (Remove / Revoke / Disable auth) | White on `--danger` is 2.78:1 and there is no `--text-on-danger` (controls §4) |
| Renaming `#settings-overlay`, `.settings-modal` or any shared class | Four other dialogs depend on them (§1.4) |
| A second `role="dialog"` inside the modal for a tab panel | Tabs are a tablist; only the whole modal is a dialog |
| An entrance animation on the modal | Foundations §7.4: nothing on first paint animates |

---

## Appendix — measurement log

| Claim | Measured |
|---|---|
| Default modal size at 1280 × 800 | 960 × 680 (75 vw × 85 vh) |
| Nav column | 180 px fixed |
| Sections column at 1280 | 779 px (960 − 180 − 1 seam) |
| Content width | 743 px (779 − 36 padding) |
| Row label gutter | 132 px + 12 px gap |
| Button height | 31.6 px (6 + 6 padding, 17.6 line box, 2 border) |
| Field height | 29 px (6 + 6 padding, 15 line box, 2 border) |
| Nav item height | 33.5 px (7 + 7 padding, 19.5 line box) |
| Switch box | 36 × 20, knob 16, travel 16 |
| Header height | 55 px (26.2 px control + 28 padding) |
| Footer height | 57 px (31.6 px button + 24 padding) |
| Modal at 390 | 292.5 px wide; sections column 112 px |
| Phone sheet | 100 % wide, `min(72dvh, 560px)` tall, header 52, rows ≥52, close 44 |
| Contrast, muted text on raised | 4.96 dark / 5.13 light (foundations §3.2) |
| Contrast, field border on well | 1.39 dark / 1.27 light — below 3:1 (proposal P3) |
