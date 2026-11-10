# Foundations — design tokens and principles

Status: current spec — foundation. This document defines the token layer that every
later screen design references. Nothing here is implemented yet except the values
copied from `static/css/style.css`.

Reference mockup: [`foundations-mockup.html`](foundations-mockup.html) — dark and light
side by side: colour, type, space, shape, elevation, icons, focus, motion, breakpoints.

**Normative source.** This document is the single source of truth for tokens: names,
values, and rules. The mockup illustrates it. Where the mockup and this document
differ, this document wins. Where this document and `static/css/style.css` differ
today, the stylesheet wins — this document describes the target, and §11 says how the
stylesheet gets there.

Every claim about current code cites `file:line`.

---

## 1. Principles

Six rules. Each one names the decision it forces later.

| # | Rule | Decision it forces |
|---|---|---|
| P1 | **The note is the page; chrome is a frame.** Chrome never competes with prose. | Three chrome surfaces only (§3). No shadow on resting chrome (§5). Separation is one hairline. |
| P2 | **Keyboard is the primary input.** Every chrome control is reachable and visible when focused. | One focus-ring token, mandatory (§10). Tree rows become focusable (§9, AC9). |
| P3 | **Dense, never cramped.** Desktop shows a lot at 14 px; touch gets its own sizes. | 4 px spacing scale, 24 px desktop target floor, 44 px on coarse (§5, §10). |
| P4 | **Two themes, one shape.** Themes change colour and shadow alpha only. | No theme-specific geometry. Every colour is a token in §3. No `filter: brightness()` for state. |
| P5 | **No build step, no new dependency.** The browser is the compiler. | Custom properties in `style.css`, icons as an inline `<symbol>` sprite (§9). No preprocessor, no web font. |
| P6 | **Emoji are content, not chrome.** | A chrome glyph is an SVG on the 16 grid. Emoji stay in prose and the picker (§9). |

P1 rules out a second accent colour, gradients as surfaces, and drop shadows on the
topbar, panels, and tabs. P4 rules out `--shadow-dark` / `--shadow-light` duplicates
of the same geometry. P6 rules out `📝` as an edit button (templates/index.html:181).

---

## 2. Token architecture

### 2.1 Three tiers

| Tier | What it holds | Example | Where it lives |
|---|---|---|---|
| **Base** | Raw values. One name per colour. Names are historical and frozen. | `--bg-elev: #2a2b34` | `:root` at `static/css/style.css:4-87`, light at `:89-131` |
| **Semantic** | Role names that alias a base token. What the colour *means*. | `--surface-raised: var(--bg-elev)` | Appended to the same two theme blocks (§11) |
| **Component / primitive** | Numbers both components and layout consume: space, radius, stroke, shadow, z, motion, control size. | `--radius-md: 8px` | A separate `:root` block after `static/css/style.css:131` |

Component-local overrides already exist and stay: `--stg-*`
(`style.css:1393-1440`), `--designer-*` (`6139-6145`), `--dw-*` (`6164-6166`),
`--te-*` (`72-75`), `--ws-*` (`85-86`). They are the model for the component tier,
not a replacement for it.

### 2.2 Naming rule

```
--<tier><category>-<role>[-<state>]
```

- Base: no prefix, historical name. `--fg`, `--bg-elev`.
- Semantic: `surface-`, `text-`, `focus-`, `overlay-`, `selection-`. `accent`,
  `accent-soft`, `danger`, `danger-soft`, `ok`, `warn`, `border`, and `border-strong`
  are already role names and keep their historical spelling. Role first, never a value:
  `--text-muted`, not `--grey-400`.
- Component/primitive: a family prefix shared by everything that uses it —
  `space-`, `radius-`, `stroke-`, `shadow-`, `z-`, `dur-`, `ease-`, `control-`,
  `icon-`. `--z-popover`, not `--menu-z`.

Kebab-case, lower-case, no abbreviations except `bg`, `fg`, `md`, `sm`, `xs`,
`dur`, `z`.

### 2.3 How the tiers layer

```
:root                       base colours, dark
  └ semantic aliases        role names → base
      └ component primitives  numbers
body[data-theme="light"]    base colours, light
  └ semantic aliases        same names, same aliasing
```

A component reads the highest tier that expresses its intent: `--surface-raised`
(semantic) or `--radius-md` (primitive). `--accent`, `--accent-soft`, `--danger`,
`--ok`, `--warn`, `--border`, and `--border-strong` are already role names, so they are
read directly; there is no second alias for them.

### 2.4 Why the semantic aliases repeat per theme

`var()` inside a custom property is substituted where the property is **declared**,
not where it is used. A `--text-muted: var(--fg-muted)` written only in `:root` would
freeze the dark value on `html`; the light override on `body` could never reach it.

So every semantic alias is declared once in `:root` and once in
`body[data-theme="light"]`. Same name, same target, two theme blocks. This is the
one place duplication is correct. It is also why `--focus-ring` is declared per
theme rather than once in the primitives block: it embeds a colour.

### 2.5 Legacy tokens

Nothing is renamed. Every legacy name stays defined forever. New code must not add a
new use of a legacy token.

| Legacy token | Line | Superseded by | Action |
|---|---|---|---|
| `--sidebar-width` | `style.css:19` | `--side-panel-width` (`:28`) | Keep as an alias. No new use. |
| `--outline-active` | `:13`, `:98` | `--accent` | Keep. It is an exact duplicate. |
| `--te-fg-muted` | `:72`, `:127` | `--text-muted` | Keep. Redundant once `--fg-muted` passes on `--bg-elev` (§3.6). |
| `--ws-fg-muted` | `:85`, `:129` | `--text-muted` | Keep. Light value already equals `--fg-muted`. |
| `--ws-warn` | `:86`, `:130` | `--warn` | Keep. Becomes identical to the new light `--warn`. |
| `--stg-*` overrides | `:1421-1438` | `--text-muted`, `--ok`, `--warn` | Keep scoped. Redundant after §3.6. |
| `--m-hit` | `:6978` | `--control-h-touch` | Keep. Phone arm only. |
| `--m-radius` | `:6983` | `--radius-md` | Keep at 10 px; phone fields are deliberately rounder. |
| `--m-scrim` | `:6985` | `--overlay-scrim` | Keep at .45; the desktop scrim is .5. |

The reverse is not true: semantic and primitive tokens are never aliased back into a
base token.

---

## 3. Colour

Two themes, one table. Every hex below is the complete palette. No other colour may
be introduced for UI chrome.

Ratios are WCAG 2.x against the surface named in the row. Text needs 4.5:1, UI
graphics 3:1. Measured, not estimated.

### 3.1 Surfaces

| Token | Dark | Light | Role |
|---|---|---|---|
| `--surface-page` (`--bg`) | `#1a1b1f` | `#ffffff` | Reader, page, the well behind everything |
| `--surface-panel` (`--bg-panel`) | `#22232a` | `#f6f7f9` | Topbar, activity bar, side panel, outline, tab bar, drawer |
| `--surface-raised` (`--bg-elev`) | `#2a2b34` | `#eceef2` | Tabs, menus, popovers, toolbars, table cells |
| `--surface-well` (`--code-bg`) | `#14151a` | `#f0f2f5` | Code blocks, inputs, read-only fields |

Canvas surfaces keep their own tokens and are exempt: `--graph-bg`
(`style.css:59`, `:119`) and `--designer-canvas-bg` (`:64`, `:121`). They are
drawing surfaces, not UI.

### 3.2 Text

| Token | Dark | Light | Dark: page / panel / raised | Light: page / panel / raised |
|---|---|---|---|---|
| `--text-primary` (`--fg`) | `#e6e6ea` | `#1f2330` | 13.82 / 12.57 / 11.30 | 15.66 / 14.61 / 13.48 |
| `--text-muted` (`--fg-muted`) | `#9799a4` | `#5d6470` | 6.07 / 5.52 / 4.96 | 5.96 / 5.56 / 5.13 |
| `--text-on-accent` (`--accent-fg`) | `#14151a` | `#ffffff` | 6.99 on `--accent` | 5.72 on `--accent` |

`--text-muted` must clear 4.5:1 on `--surface-raised`, because it is used on menu and
cell backgrounds. It does in both themes. This is the fix in §3.6.

### 3.3 Accent and focus

| Token | Dark | Light | Role | Ratio on panel |
|---|---|---|---|---|
| `--accent` | `#7c9cff` | `#2f5fd0` | Link, primary fill, active border, focus ring | 6.00 / 5.34 |
| `--accent-soft` | `rgba(124,156,255,.18)` | `rgba(47,95,208,.12)` | Hover and selected wash | — |
| `--text-on-accent` | `#14151a` | `#ffffff` | Label on an `--accent` fill | 6.99 / 5.72 |
| `--focus-ring-color` | `var(--accent)` | `var(--accent)` | 2 px ring | 6.00 / 5.34 |

The accent clears 3:1 on every surface in both themes, so the ring is visible on
page, panel, raised, and well.

### 3.4 Status

Status is never colour alone. A dot, an icon, or a word accompanies it.

| Token | Dark | Light | Dark ratios page / raised | Light ratios page / raised | Use |
|---|---|---|---|---|---|
| `--danger` | `#ff6b6b` | `#c0392b` | 6.20 / 5.07 | 5.44 / 4.68 | Error text, destructive icon |
| `--danger-soft` | `rgba(255,107,107,.15)` | `rgba(192,57,43,.12)` | — | — | Delete hover fill, error surface |
| `--ok` | `#5fd49a` | `#16703f` | 9.32 / 7.61 | 6.13 / 5.28 | Online dot, saved state |
| `--warn` | `#f3b454` | `#8a5a0b` | 9.40 / 7.68 | 5.92 / 5.10 | Watch off, unsaved, caution |

Both light values are safe as text and as graphics. The old light `#2faa66`
(2.97) and `#c9831d` (3.11) failed both floors.

### 3.5 Lines, overlay, selection

| Token | Dark | Light | Role |
|---|---|---|---|
| `--border` | `#383a45` | `#d8dde4` | Decorative hairline only: pane seams, separators, table rules. Never the only boundary of a control. |
| `--border-strong` | `#7b8194` | `#78828f` | Boundary of an interactive control: input outline, switch track, unchecked box. New controls use this name; there is no alias. |
| `--overlay-scrim` (`--scrim`) | `rgba(0,0,0,.5)` | `rgba(0,0,0,.5)` | Modal and sheet backdrop |
| `--selection-bg` (`--selection`) | `rgba(124,156,255,.28)` | `rgba(47,95,208,.16)` | `::selection` background |
| `--selection-text` | `var(--fg)` | `var(--fg)` | `::selection` foreground |

`--border` on `--surface-panel` measures 1.39:1 dark, 1.27:1 light. That is correct
for a separator and wrong for a control. Hence the second line token.

`--border-strong` measures 4.03 / 3.62 on panel / raised in dark, and 3.64 / 3.36 in
light. Both clear 3:1.

No `::selection` rule exists today (`grep ::selection static/css/style.css` returns
nothing), so the browser default is in force. The token block adds the rule; it does
not change an existing one.

### 3.6 Changes to existing values

Three token values change, and eight call sites are corrected in the same pass. Each is
a contrast failure.

| Theme | Token / rule | Now | New | Measured |
|---|---|---|---|---|
| Dark | `--fg-muted` `style.css:9` | `#8b8d98` | `#9799a4` | 4.26 → 4.96 on `--bg-elev` |
| Light | `--ok` `style.css:102` | `#2faa66` | `#16703f` | 2.97 → 6.13 on `--bg` |
| Light | `--warn` `style.css:103` | `#c9831d` | `#8a5a0b` | 3.11 → 5.92 on `--bg` |

Eight chrome rules paint `#fff` on an `--accent` fill. White on the dark accent
`#7c9cff` measures 2.61:1; `--text-on-accent` is `#14151a` there and measures 6.99:1.
These are visible failures today, not migration side-effects: they must be corrected
in the same change, and the label colour then changes from white to `--text-on-accent`.

| Rule | Line | Surface |
|---|---|---|
| `#topbar button.primary` | `style.css:203` | Topbar primary |
| `#edit-bar .eb:active` | `:604` | Toolbar pressed |
| `#edit-bar .eb-primary:hover` | `:1174` | Toolbar primary |
| `.auth-submit` | `:2310` | Sign-in button |
| `#edit-toggle.editing` | `:2655` | Topbar edit toggle |
| `#preview-btn.editing` | `:2662` | Edit-bar preview |
| `#hybrid-toggle.active` | `:2687` | Topbar WYSIWYG toggle |
| `.ai-btn.ai-apply` | `:5421`, hover `:5424` | AI apply |

The content rule `.search-highlight` (`:3778`) also paints white on accent. It is note
content, so it is out of this scope; record it and fix it with the reader pass.

Note on the stylesheet comment at `style.css:82-86`: it attributes the 4.26:1 muted
figure to the light theme. The light value `#5d6470` actually measures 5.13:1 on
`--bg-elev`; 4.26 is the **dark** value. The light `--ws-fg-muted` is therefore a
no-op, and the real dark failure was never raised outside workspace surfaces. The
comment should be corrected in the same change.

Everything else in §3 keeps its current hex.

---

## 4. Typography

### 4.1 Stacks

| Token | Value | Source |
|---|---|---|
| `--font-ui` | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | `style.css:146` |
| `--font-prose` | `var(--font-ui)` | same; prose is UI type at reading size |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `style.css:1141` |

No web font. No second sans. Mono is used for code, paths, and origin strings.

### 4.2 Scale

`--font-scale` multiplies the root size: `html { font-size: calc(14px * var(--font-scale)) }`
(`style.css:138`). S/M/L/XL map to 0.9 / 1 / **1.15** / 1.3 (`style.css:29-36`).
Every rem value in the table scales with it; px values do not.

| Token | Value | px @1.0 | px @1.3 | Weight | Line | Tracking | Use |
|---|---|---|---|---|---|---|---|
| `--text-2xs` | `9px` | 9 | 9 | 600 | 1.2 | .04em | Count badges only. Fixed. |
| `--text-xs` | `.72rem` | 10.1 | 13.1 | 400–600 | 1.2 | .08em uppercase | Code-fence label, panel section labels |
| `--text-sm` | `.8rem` | 11.2 | 14.6 | 400 | 1.35 | 0 | Meta, hints, toolbar labels, tree rows |
| `--text-ui` | `.86rem` | 12.0 | 15.6 | 400–500 | 1.4 | 0 | Dense chrome, menu items, fields |
| `--text-ui-lg` | `.93rem` | 13.0 | 16.9 | 400–600 | 1.4 | 0 | Topbar buttons, tabs, primary chrome text |
| `--text-body` | `1rem` | 14 | 18.2 | 400 | 1.5 | 0 | Base UI and desktop prose |
| `--text-lg` | `1.15rem` | 16.1 | 20.9 | 600 | 1.25 | 0 | Dialog titles, h4, edit-bar headings |

Weights: `--fw-regular: 400`, `--fw-medium: 500`, `--fw-semibold: 600`,
`--fw-heading: 650`, `--fw-bold: 700`. Rendered prose headings already use 650
(`style.css:3146`), so the scale must contain it. The brand uses 700
(`style.css:176`), dialog titles 600, search results 500.

Line heights: `--lh-tight: 1.2`, `--lh-snug: 1.35`, `--lh-normal: 1.5`,
`--lh-prose: 1.65`, `--lh-flat: 1`.

Tracking: `--tracking-label: .08em` for uppercase labels. Everything else 0. The
brand's `.3px` (`style.css:177`) stays local to the brand.

### 4.3 Chrome vs prose

| Context | Size | Source |
|---|---|---|
| Chrome (topbar, tabs, panels, menus) | `.72`–`.93rem` | dominant sizes in `style.css` |
| Desktop prose | `1rem` / 1.5 | `body` rule, `style.css:146` |
| Phone prose | `calc(16px * var(--font-scale))` / 1.65 | `style.css:7438` |
| Prose headings | `1.7 / 1.4 / 1.2 / 1.05 em`, weight 650 | `style.css:7440-7443` |
| Phone title | `16px` / 1.25, weight 600 | `style.css:7057` |
| Field on touch | `16px` fixed | `style.css:7381`, `:7402` |

### 4.4 What stays px

Three sizes are fixed and never scale:

| Size | Why | Source |
|---|---|---|
| 9 px | Badge numeral; unreadable at 1.3× if it grew | `--text-2xs` |
| 16 px | Field and phone title; below 16 px iOS zooms the viewport on focus | `style.css:7381` |
| 8–11 px | Decorative glyphs inside diagrams and the designer | convention stated at `style.css:33-35` |

The 11 px tab pin is retired: the pin becomes a 14 px sprite (`--icon-sm`), so the
font-size exception no longer has a subject. Everything else is rem. A new
`font-size` in px is a defect unless it is one of these three.

---

## 5. Space, shape, elevation

### 5.1 Spacing

4 px grid. `--space-N` where N is a multiple of 4.

| Token | Value | Typical use |
|---|---|---|
| `--space-hair` | `2px` | Gap between icon buttons inside one group; the only sub-rung |
| `--space-1` | `4px` | Icon-to-label gap, dense padding |
| `--space-2` | `8px` | Control padding, menu item gap |
| `--space-3` | `12px` | Panel padding, button padding-x |
| `--space-4` | `16px` | Section padding, dialog body padding |
| `--space-5` | `20px` | Reader gutter on phone (`--m-gutter`) |
| `--space-6` | `24px` | Dialog header, roomy separation |
| `--space-7` | `32px` | Page-level blocks |
| `--space-8` | `48px` | Rail height, large separation |

Measured use in the stylesheet: 8 px ×131, 4 px ×101, 6 px ×95, 10 px ×68,
12 px ×53. Six and ten are half-steps that predate the grid. They stay where they
are; they are not allowed in new work, and a component being edited snaps them to
the nearest rung.

### 5.2 Radii

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | `4px` | Tree rows, small chips, table cells |
| `--radius-sm` | `6px` | Buttons, tabs, menus, inputs, toolbar buttons |
| `--radius-md` | `8px` | Panels, popovers, cards, code blocks |
| `--radius-lg` | `12px` | Large cards, dialogs |
| `--radius-xl` | `16px` | Bottom sheets, full dialogs |
| `--radius-pill` | `999px` | Status chips, segmented controls |
| `--radius-circle` | `50%` | Dots, avatars |

Current distribution: 8 px ×37, 4 px ×37, 6 px ×33, 5 px ×12, 2 px ×6, 999 px ×15.
The 5 px group is a rounding slip between 4 and 6; it becomes 4 on the next edit of
each component. `--m-radius: 10px` (`style.css:6983`) stays: phone fields are
deliberately rounder.

### 5.3 Strokes

| Token | Value | Use |
|---|---|---|
| `--stroke-1` | `1px` | Every hairline, every control outline |
| `--stroke-2` | `2px` | Focus ring, active indicator, drag insertion line |
| `--stroke-3` | `3px` | Selected row inset bar |

Current active indicator is 2 px (`style.css:262`), selected row inset is 2–3 px
(`:1739`, phone spec). Both fit.

### 5.4 Shadows

Five levels, each tied to a z-band. Dark values match the existing literals in the
stylesheet or the drawer spec (`docs/archive/design/mobile-shell.md` §4.3).
Light values lower the alpha; no theme-scoped shadow exists in the stylesheet today,
so the light column is a new decision, not a precedent.

| Token | Dark | Light | Belongs to |
|---|---|---|---|
| `--shadow-pop` | `0 6px 24px rgba(0,0,0,.35)` | `0 6px 24px rgba(0,0,0,.16)` | Anchored popovers and menus: `--z-anchored`, `--z-popover` |
| `--shadow-float` | `0 8px 24px rgba(0,0,0,.35)` | `0 8px 24px rgba(0,0,0,.18)` | Transient chips inside content: `--z-inline`, graph chips |
| `--shadow-sheet` | `0 12px 40px rgba(0,0,0,.45)` | `0 12px 40px rgba(0,0,0,.2)` | Drawer and bottom sheet: `--z-drawer`, `--z-sheet` |
| `--shadow-modal` | `0 20px 60px rgba(0,0,0,.5)` | `0 20px 60px rgba(0,0,0,.22)` | Modals and dialogs: `--z-modal`, `--z-dialog` |
| `--shadow-toast` | `0 4px 12px rgba(0,0,0,.3)` | `0 4px 12px rgba(0,0,0,.14)` | Toast: `--z-toast` |

Rules:

1. Content and the chrome band carry **no** shadow. A 1 px border separates them.
2. Shadow rises with the band. A surface never uses a shadow from a lower band.
3. A light-theme shadow differs only in alpha. Geometry is identical.
4. Inset rings and state rings are `box-shadow` accents, not elevation. They use
   `--accent-soft` and are allowed at any band.

---

## 6. Z-index bands

The stylesheet has 27 distinct values: 15 local stacks (0–20) and 12 shell bands
(80–3000).

### 6.1 Local stacks (1–20)

| Token | Value | Members |
|---|---|---|
| — | `0` | Static content |
| — | `1` | `.hybrid-lang-pill` `:3386`, `.diff-hunk` `:5373`, `.te-cell` `:5956`, `.dw-slice-band` `:6727` |
| `--z-inline` | `2` | `.expand-btn` `:449`, `.nb-drag-proxy` `:811`, `.code-copy-btn` `:3365`, `.te-cell.is-active` `:5945`, `.designer-empty` `:6459`, phone `#edit-bar .eb-actions` `:7127` |
| — | `3` | `.te-cell.is-active` `:5958`, `.designer-state` `:6430`, `.dw-compact-sheet` `:6884` |
| — | `4` | `.te-fill-handle` `:6008` |
| — | `5` | `.settings-modal .resize-grip` `:1853`, `.graph-view-header` `:4432`, `.designer-alert` `:6414` |
| — | `6` | `.nb-table-overlay` `:768`, `.nb-list-overlay` `:855` |
| — | `7` | `.nb-tv-overlay` `:923` |
| — | `8` | `.nb-tv-pop` `:998` |
| — | `10` | `.mermaid-lightbox-controls` `:3690` |
| — | `12` / `14` / `16` / `18` | `.graph-view-hint` `:4726`, `.graph-view-chip` `:4758`, `.graph-view-toast` `:4816`, `.graph-view-state` `:4840` |
| — | `20` | `.panel-header` `:343` |

Rule: values 1–18 have **no global meaning**. They order siblings inside one
positioned ancestor. Never compare one component's local value against another's.
The 12/14/16/18 run is a single stack inside the graph view and stays as it is.

### 6.2 Shell bands (80–3000)

| Token | Value | Members |
|---|---|---|
| `--z-draft` | `80` | `#draft-bar` `:7796` |
| `--z-chrome` | `100` | `#topbar` in phone mode `:7012`. The edit-bar dropdowns at `:622` and `:683` also use 100; they resolve in the **root** stacking context because `#editor-pane` has no `isolation` or `transform`, so on migration they take `--z-popover`, not `--z-inline` |
| `--z-state` | `120` | `#mobile-state` `:7555` |
| `--z-rail` | `150` | `#activity-bar` in phone mode `:7175` |
| `--z-anchored` | `200` | `.session-menu` `:7992`, `.workspace-menu` `:8050` |
| `--z-scrim` | `400` | `#mobile-scrim` `:7241` |
| `--z-drawer` | `410` | `#side-panel` in phone mode `:7220` |
| `--z-sheet` | `600` | `#capture-sheet` and `#mobile-settings` `:7593-7599` |
| `--z-popover` | `1000` | `body > #nb-menu .context-menu` `:3040` |
| `--z-modal` | `2000` | `.settings-overlay` `:1373`, `.mermaid-lightbox-overlay` `:3666` |
| `--z-dialog` | `2100` | `#workspace-dialog` `:8175` |
| `--z-toast` | `3000` | `.toast` `:3791` |

Rules:

1. A new floating surface takes an existing band, or the stack is redesigned. No
   new value.
2. A dialog opened from a modal uses `--z-dialog`; `#workspace-dialog` exists because
   both would otherwise sit at 2000 (`style.css:8173-8175`).
3. Toast outranks everything, including a modal. It never takes focus.
4. The mobile drawer must outrank the rail: a row menu opens from inside the drawer
   and uses `--z-popover`, which outranks `--z-drawer`.

---

## 7. Motion

### 7.1 Durations

| Token | Value | Source | Use |
|---|---|---|---|
| `--dur-0` | `100ms` | `--tab-close-duration`, `style.css:491` | Tab ghost collapse |
| `--dur-1` | `120ms` | `.12s` ×34, first at `:257` | Hover, focus, colour, chevron rotate |
| `--dur-2` | `180ms` | `--tab-release-duration` `:487`, `.18s` `:4830` | Tab re-equalize, toast in |
| `--dur-3` | `220ms` | `220ms` at `:7223`; `.22s` at `:7611` | Drawer slide, sheet slide |
| `--dur-4` | `380ms` | `.38s` `:4743` | Large reveal (graph hint), the ceiling |

Nothing exceeds 400 ms. The existing `--tab-*` variables stay declared as literals
(`180ms` at `:487`, `100ms` at `:491`). They must **not** be rewritten to
`var(--dur-2)` / `var(--dur-0)`: `tests/dom/test_dom.js:6481` and `:7031` assert the
literal declarations. Add a comment that they equal the tokens.

### 7.2 Easing

| Token | Value | Source |
|---|---|---|
| `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | drawer and sheet, `style.css:7223`, `:7611` |
| `--ease-out` | `ease-out` | tab animation, `style.css:487-492` |
| `--ease-linear` | `linear` | spinners and continuous loops only |

No bounce, no spring, no custom curve beyond these three.

### 7.3 Reduced motion

Contract: every transition or animation added from now on has a matching
`@media (prefers-reduced-motion: reduce)` rule. State changes become instant and
complete; nothing is hidden or left half-applied. Existing blocks: `style.css:524`,
`1259`, `1304`, `1612`, `4389`, `4996`, `6381`, `6456`, `7764`, `7919`, `7983`.

Spinners keep moving but slow down rather than stop (`:6456` sets 1.6 s), because a
stopped spinner reads as a hung request.

### 7.4 What may never animate

| Never | Why |
|---|---|
| Reader text layout, font size, or line height | Reflow during typing or resizing is disorienting |
| Scroll position of `#viewer-scroll` | `scroll-behavior: smooth` is already disabled under reduced motion (`:524`) |
| `--side-panel-width` while dragging the resize handle | The handle must track the pointer exactly |
| Tab widths while dragging | Only frozen widths and the ghost animate (`:1243-1260`) |
| Z-order or stacking changes | Panels must snap between bands |
| First paint | No entrance animation on the shell |

---

## 8. Layout and breakpoints

### 8.1 Desktop metrics

| Metric | Value | Source |
|---|---|---|
| `--topbar-h` | `46px` | `style.css:29` |
| `--activity-bar-width` | `48px` | `:23` |
| `--side-panel-width` | `240px` | `:28` |
| `--outline-width` | `220px` | `:20` |
| `--tab-h` | `34px` at 1.0, `calc(34px * var(--font-scale))` | `.tab-bar` height, `:494`; component-local on `.tab-bar` so the tab stays inside it at XL |
| `--edit-bar-h` | `57px` | `:8535` |
| `--viewer-pad-x` | `40px` | `#viewer-content`, `:2398` |
| `--viewer-tail` | `48px` | `:2396` |

Rows with a source line are already declared. `--tab-h` and `--viewer-pad-x` name
literals that exist only as values today. The grid is `activity | side panel | editor | outline`
(`style.css:215-227`). The activity bar never resizes. Both the side panel and the outline pane
resize (`app.js:811-812`) and both collapse to zero width. The side panel floors at 140 px;
today it caps at half the viewport, and the target is `--side-panel-max` 480 or 60 % of the
pane budget. The outline caps at 520 px, or whatever the panel leaves. The reader needs 352 px
(`mobile-shell.md` §2.2).

Phone overrides: `--topbar-h` 52 → `calc(52px + inset)` (`:6991`), rail 56
(`:6980`), hit 44 (`:6978`), gutter 20 (`:6981`), reader max 680 (`:6982`).
`--ui-mode` is `desktop` by default (`:6966`) and `phone` inside the query
(`:6977`); JS reads that token rather than repeating the query.

### 8.2 Breakpoints

| Query | Line | Kind | Effect |
|---|---|---|---|
| `(max-width: 860px), ((pointer: coarse) and (max-width: 1023px))` | `:6975`, `:8193`, `:8514` | **Mode switch** | Phone shell: single column, drawer, rail, topbar 52, 16 px prose |
| `(pointer: coarse) and (min-width: 1024px)` | `:4982` | Refinement | Graph controls grow to 44 px on a tablet |
| `(max-width: 980px)` | `:4944` | Refinement | Graph summary truncates |
| `(max-width: 960px)` | `:6560`, `:6923` | Refinement | Diagram designers go compact (sidebar becomes a strip) |
| `(max-width: 820px)` | `:4952` | Refinement | Graph header wraps |
| `(max-width: 720px)` | `:4956`, `:6615`, `:8751` | Refinement | Graph depth hidden, designer compact, edit footer wraps |
| `(max-width: 520px)` | `:4972`, `:6122` | Refinement | Graph header stacks; table editor goes full-screen |

Rules:

1. **860 / 1023 is the only mode switch.** Below it the app is a phone shell; above
   it the app is a desktop shell. No component may introduce a second mode switch.
2. Every other query is a **refinement** and must be scoped to its component
   (`.graph-view-*`, `.designer-*`, `.edit-footer`, `.table-editor-modal`). It may
   reflow that component and nothing else.
3. Widths are the viewport, not the container. Three container queries exist because the
   side panel resizes independently: two in Search (`:4360`, `:4368`) stack its filters, and
   one in Sessions (`:8463`) collapses the total at the 140 px floor. They are refinements
   of one view each, not a second layout system; no new container-query layout may be added
   while the shells are viewport-driven.
4. A new refinement breakpoint must match a value in this table. The set is closed.

---

## 9. Iconography

### 9.1 Drawing rule

| Property | Value |
|---|---|
| Grid | `viewBox="0 0 16 16"` |
| Live area | 1–15 px; the 0.5 px margin keeps a 1.5 px stroke from clipping |
| Stroke | `1.5`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"` |
| Colour | `currentColor` on every chrome glyph |
| Size | `--icon-sm: 14px`, `--icon-md: 16px`, `--icon-lg: 17px` |
| Accessible name | On the button (`aria-label`), never on the SVG |
| SVG attributes | `aria-hidden="true" focusable="false"` |

Existing sprite symbols use 1.0–1.3 stroke (`templates/index.html:54-107`). They are
grandfathered; redraw at 1.5 when the symbol next changes. New symbols are 1.5.

Sizes come from the stylesheet: 14 px at `style.css:5212`, 13–14 px at `:3032`
and `:4604`, 16 px at `:5881`, 17 px at `:4985` for coarse pointers.

File-type symbols (`nb-icon-folder`, `-file`, `-readme`, `-license`, `-roadmap`,
`-claude`) keep their fills. They identify a file, not a control. Every other symbol is
monochrome `currentColor`.

### 9.2 Sprite pattern

One hidden `<svg class="icon-sprite">` with `<defs>` and `<symbol id="nb-icon-*">`
lives at `templates/index.html:51-109`; `.icon-sprite` is
`position:absolute; width:0; height:0; overflow:hidden` (`style.css:2769`). A caller is:

```html
<button type="button" class="icon-btn" aria-label="Reload">
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <use href="#nb-icon-refresh"/>
  </svg>
</button>
```

The primitives block carries the size rule, because an outer `<svg>` without width and
height renders at 300 × 150:

```css
.icon { width: var(--icon-md); height: var(--icon-md); display: block; }
```

New symbols go in the same sprite, after the existing ones, prefixed `nb-icon-`.

### 9.3 Chrome glyph policy

Chrome glyphs are replaced by sprite symbols. Content emoji stay.

| Replace (chrome) | Where now |
|---|---|
| `←` back, `✎` hybrid, `📝` edit | `templates/index.html:176`, `:178`, `:181` |
| `🕸` graph, `⚙` settings, `⎋` logout | `:210`, `:212`, `:211`; settings nav `:723-731` |
| `📌` pin, `↻` refresh, `‹` `›` collapse/expand | `:230`, `:231`, `:232`, `:238` |
| `≣` outline, `⋯` more, `＋` capture | `:293`, `:180`, `:179` |
| `↶` `↷` undo/redo, `☑` task, `☰` list, `🔗` link, `🖼` image, `😀` emoji | `:296-326` |
| `⚠` warning, `👁` preview-only | `:1444`, `:1585`, `:1710`, `:1597` |
| Rail view icons `🗂` `📌` `🔖` `🕒` `🔍` `📁` `✨` | `static/js/activity.js:1321-1363` |
| `×` close | `:715` and others |

| Keep (content) | Where |
|---|---|
| Emoji in notes and rendered Markdown | `#viewer-content` |
| The emoji picker catalogue | `static/js/editbar.js:40-76` |
| `📓` in the welcome card | `templates/index.html:402` — it is illustration, not a control |
| `H1`–`H6`, `B`, `I`, `S`, `{}`, `──` | `templates/index.html:299-338` — typographic labels, not glyphs |

`⚙` inside help prose (`templates/index.html:416`) is content: it names the button
the user will press. Leave it.

### 9.4 Fallback for a glyph with no drawing

When a chrome glyph has no symbol yet:

1. Keep the character, wrapped in `<span class="glyph-fallback" aria-hidden="true">`,
   at the icon size and `currentColor`.
2. Keep the `aria-label`. The character is never the accessible name.
3. Never substitute a different emoji.
4. Add the symbol to the sprite in the same change that touches that control. The
   fallback is a staging state, not a shipped style.

---

## 10. Accessibility baseline

### 10.1 Contrast floors

| Kind | Floor | Where it is checked |
|---|---|---|
| Text | 4.5:1 | Every row in §3.2 and §3.4 |
| UI component boundary, icon, focus ring | 3:1 | §3.3, §3.5 |
| Decorative separator | none | `--border` |

Worst passing values today: light `--danger` on `--bg-elev` 4.68, dark
`--fg-muted` on `--bg-elev` 4.96 (after §3.6), light `--border-strong` on
`--bg-elev` 3.36.

### 10.2 Focus

| Token | Value |
|---|---|
| `--focus-ring` | `2px solid var(--accent)` |
| `--focus-offset` | `2px` |
| `--focus-offset-inset` | `-2px` |

Rules:

1. `:focus-visible` only. A pointer click does not draw the ring.
2. `outline: none` is allowed only when a visible replacement is set in the same
   rule. Current examples: `style.css:3823`, `:3928` (border becomes `--accent`),
   `:5473` (row ring at `:5455`), `:5952` (cell ring at `:5955`).
3. The ring is never removed to make a component look cleaner.
4. Offset 2 px outward by default. Use `-2px` for a row inside a scroller whose
   neighbours would clip the ring.

### 10.3 Coverage gaps in the current stylesheet

These controls draw no focus ring today:

| Control | Rule | Reachable by Tab? |
|---|---|---|
| `.icon-btn` — back, edit, more, outline toggle | `:1345` | Yes, no ring. Only the Settings modal has a catch-all (`:1445`) |
| `#topbar button` | `:192` | Yes, no ring |
| `.collapse-btn` — panel header buttons | `:423` | Yes, no ring |
| `.activity-btn` — rail views | `:242` | Yes, no ring. The comment at `:7890-7892` confirms it |
| `.tab` and `.tab-close` | `:1177`, `:1218` | **No** — `.tab` is a `div` with no `tabindex` (`tabs.js:644`); only the close buttons are Tab stops, and they have no ring |
| `.tree-row` | rendered as a `div` in `static/js/sidebar.js:137-140` | **Not Tab-reachable** — no `role`, no `tabindex`, no `aria-expanded`. Vim-style keys (`j`/`k`/arrows/`Enter`) work through `static/js/vimnav.js:289-297` and `sidebar.js:889-906`; a screen reader cannot see the rows |
| `.eb` edit-bar buttons | markup `templates/index.html:296` | Yes, no ring. The newer `.edit-bar-btn` has one (`:8672`) |

The tree is the serious one: the file list is operable from the keyboard through the
vimnav window model, but it is invisible to assistive technology. AC9 is about Tab
entry and ARIA, not about inventing navigation that already exists.

### 10.4 Target sizes

| Pointer | Floor | Source |
|---|---|---|
| Fine (desktop) | `24 × 24` | `--control-h-sm`; matches `.nb-te-open` and `.nb-tv-toggle` at `style.css:817`, `:940` |
| Coarse (touch) | `44 × 44` | `--control-h-touch` = `--m-hit` (`:6978`) |

Known gap: `--m-hit` is declared inside the phone mode query (`:6975-6978`), which stops
at 1023 px. A coarse pointer at 1024 px and up — iPad landscape — gets the desktop
shell with 24–36 px controls; the only coarse rule above 1023 px grows graph controls
(`:4982`). The floor therefore applies to the phone shell only today. Closing the tablet
case needs a `(pointer: coarse)` refinement that re-sizes the shell control set; it is
AC13, not part of the additive landing.

Known undersized today: `.tree-row` ≈22 px, `.collapse-btn` ≈22 px, `.tab-close`
≈22 px. Each is fixed when its component is next touched; a global pass is a
separate task.

### 10.5 Keyboard rules

1. Tab order follows DOM order. No positive `tabindex`.
2. `Esc` closes the topmost layer: menu → sheet → drawer → viewer history.
3. `Enter` and `Space` activate buttons; arrows move inside a menu, tab strip, or
   rail.
4. No action exists only as a drag. Tab reorder and tree move must have a menu
   equivalent.
5. The tree needs `role="tree"` / `role="treeitem"`, `aria-expanded` on folders, and
   `tabindex="0"` on the active row (AC9).

### 10.6 Reduced motion and zoom

Reduced motion per §7.3. Zoom: at 200 % browser zoom the shell must not produce
horizontal scrolling on `body`; the phone mode switch handles the narrow case. At
`--font-scale: 1.3` chrome text must not clip inside a 36 px control.

---

## 11. Implementation contract

Three source files and one test file. The token landing is CSS-only; the icon and tree
criteria are not, and pretending otherwise would make AC8 and AC9 unbuildable.

| File | Why it is touched |
|---|---|
| `static/css/style.css` | Token blocks, the eight white-on-accent fixes, `.icon`, `::selection` |
| `templates/index.html` | New sprite symbols; emoji callers swapped to `<use>` |
| `static/js/activity.js` | The rail icon channel takes `icon.textContent` (`:109-112`); it must accept a symbol id |
| `static/js/sidebar.js` | Tree `role`, `tabindex`, `aria-expanded`, key handling (AC9) |
| `tests/dom/test_dom.js` | Only if the two `--tab-*` literals are ever changed; this plan keeps them |

No framework, no build step, no new dependency.

### 11.1 Placement and order

| Block | Goes | Why there |
|---|---|---|
| Semantic + colour + shadow tokens, dark | End of `:root`, before the closing brace at `style.css:87` | Aliases must compute where the base token is declared (§2.4) |
| Semantic + colour + shadow tokens, light | End of `body[data-theme="light"]`, before `:131` | Same reason, light side |
| Primitives: space, radius, stroke, z, duration, easing, control, icon | New `:root` block immediately after `:131` | Theme-independent; declared after both themes so they can be read anywhere |
| Migration edits | In place, one declaration at a time | Keeps the diff reviewable |

Do not reorder existing declarations. Do not move the light block. Do not introduce
a third theme selector.

The only edits inside the existing blocks are the three values in §3.6 and the eight
white-on-accent rules, each with a one-line comment giving the measured ratio.

### 11.2 Migration

1. **Additive first.** Land the tokens with zero call-site changes. Visual output is
   unchanged except §3.6 and the new `::selection` colour.
2. **Touch it, tokenise it.** A component that is being changed swaps its literals for
   tokens in the same commit. No drive-by sweeps.
3. **Never rename.** A legacy token keeps its definition even when nothing uses it.
4. **One direction.** A base token never aliases a semantic token.

### 11.3 Checks

No lint step exists (`docs/operations/development.md:70`). Run:

```bash
# Frontend DOM tests (jsdom). This is the fast gate.
node tests/dom/test_dom.js          # or: npm test

# Real browser, one suite by substring.
node tests/browser/run_all.js --only=mobile
node tests/browser/run_all.js --only=core

# Every browser suite.
npm run test:browser:all
```

Commands and their meaning come from `docs/operations/development.md:44-60`.

Static checks:

```bash
# 1. Every token used is declared, ignoring names JS sets at runtime.
comm -23 \
  <(grep -o 'var(--[a-z0-9-]*' static/css/style.css | sed 's/var(//' | sort -u) \
  <(grep -oE -- '--[a-z0-9-]+:' static/css/style.css | tr -d ' :' | sort -u) \
  | grep -vE '^--(m-kb|nb-w|nb-tab-from|nb-tab-to|nb-tab-ghost-from|settings-modal-width|settings-modal-height|dw-slice-cell-w)$'
# The filter is the runtime-token allowlist. Do not widen it casually: every name on it
# is set from JS, and an empty result still proves only declaration, not per-theme
# resolution. Add --bg-hover to the stylesheet or delete its use: :7829 uses it and
# nothing declares it. That is a real defect the raw command surfaces.

# 2. No shell z-index outside the bands in §6.
grep -n 'z-index:' static/css/style.css

# 3. No chrome glyph left in markup or JS-built chrome. The set is the one enumerated in
#    §9.3; extend it when a new glyph is replaced. A blanket emoji range is useless here:
#    it also matches prose arrows, dashes, and the picker catalogue.
grep -nP '📝|🕸|⚙|⎋|📌|↻|‹|›|≣|⋯|＋|↶|↷|☑|☰|🔗|🖼|😀|⚠|👁|🗂|🔖|🕒|🔍|📁|✨' \
  templates/index.html templates/_edit_window.html static/js/activity.js \
  static/js/sidebar.js static/js/tabs.js static/js/mobile.js static/js/workspaces.js
# Expect no result outside §9.3's keep list (welcome card, help prose `⚙`).
```

Manual browser check, both themes at each width:

| Width | Theme | Look for |
|---|---|---|
| 1280 | dark, light | Four columns; no shadow on chrome; every text pair readable |
| 860 | dark, light | Desktop shell at the boundary; no horizontal scroll |
| 390 | dark, light | Phone shell; 44 px targets; drawer and sheet slide |
| 1280 + XL | dark, light | Chrome text does not clip; no new px sizes |
| 1024, coarse pointer | dark, light | Desktop shell; the tablet target gap in §10.4 is visible and expected until AC13 |

### 11.4 What to avoid

- A second accent hue, a gradient surface, or a glass/blur panel.
- A new z-index value, a new breakpoint, or a new shadow.
- `filter: brightness()` as a state (`style.css:204`, `:1561`, `:2313`, `:4941`,
  `:6550` predate this rule; three are active hover states on primary buttons).
- Emoji in a button, a tab, a menu item, or a panel header.
- A colour literal in a component rule. It goes in the token block or it does not
  ship.

---

## 12. Acceptance criteria

Each is testable and names the file and the observable result.

| # | Criterion | Where | Observable |
|---|---|---|---|
| AC1 | One design-system token block exists per theme, and one primitive block after them | `static/css/style.css` | `grep -n "Design system" style.css` returns three markers, all before the first component rule |
| AC2 | Dark `--fg-muted` is `#9799a4` | `style.css:9` | Muted text on a `--bg-elev` surface (a menu item) measures ≥4.5:1 |
| AC3 | Light `--ok` is `#16703f` and `--warn` is `#8a5a0b` | `style.css:102-103` | A status dot plus its word in Settings measures ≥4.5:1 on `--bg-elev`; the dot is ≥3:1 |
| AC4 | No new colour literal outside the token blocks | `style.css` | The diff adds hex only inside the three marked blocks |
| AC5 | Every semantic token resolves in both themes | `static/css/style.css` | In the browser, read each name in §3 from `getComputedStyle(document.body)` with the theme toggled; every value changes where the palette differs, and none is empty. The `comm` check is a declaration check only, not this criterion |
| AC6 | `--border-strong` is used for every input outline that a touched component owns | `static/css/style.css` | The inputs in each migrated component measure ≥3:1 against the surface behind them in both themes; the other input rules stay on `--border` until their component is touched |
| AC7 | Shell z-indices are tokenised; local 1–18 values are untouched | `style.css` | `grep -n "z-index: 1000"` finds no shell rule; `--z-popover` is used instead |
| AC8 | Every chrome glyph in the topbar, rail, panel headers, tab bar, and edit bar is an SVG `<use>` | `templates/index.html`, `static/js/activity.js` | The glyph check in §11.3 matches only the content lines listed in §9.3 |
| AC9 | Tree rows are Tab-reachable and expose their structure | `static/js/sidebar.js`, `style.css` | Tabbing enters the tree; the active row has `role="treeitem"` and `aria-expanded` on folders; `Enter` opens a leaf. Vim keys continue to work unchanged |
| AC10 | Every chrome control shows a 2 px accent ring on `:focus-visible` | `style.css` | Tabbing the shell at 1280 and 390 never lands on an unstyled control (list in §10.3), including menu rows |
| AC11 | Reduced motion removes every new transition | `style.css` | With `prefers-reduced-motion: reduce` emulated, opening the drawer and the sheet is instant; no element is left mid-state |
| AC12 | The mockup is self-contained | `docs/ui/foundations-mockup.html` | Opening it offline shows both themes side by side with zero network requests |
| AC13 | A coarse pointer at 1024 px and above gets 44 px shell targets | `static/css/style.css` | With touch emulation at 1280, the topbar, rail, panel-header, tab, and menu targets measure ≥44 × 44. Follow-up pass, not part of the additive landing |

---

## Appendix A — The token block

Paste these three blocks. Every value below is either already in the stylesheet or a
decision recorded in §3 and §5.

```css
/* ---------- Design system — semantic tokens (dark) ---------- */
:root {
  /* ---- semantic (aliases; repeated per theme, see §2.4) ---- */
  --surface-page: var(--bg);
  --surface-panel: var(--bg-panel);
  --surface-raised: var(--bg-elev);
  --surface-well: var(--code-bg);
  --text-primary: var(--fg);
  --text-muted: var(--fg-muted);
  --text-on-accent: var(--accent-fg);
  --focus-ring-color: var(--accent);
  --focus-ring: 2px solid var(--focus-ring-color);
  --overlay-scrim: var(--scrim);
  --selection-bg: var(--selection);
  --selection-text: var(--fg);

  /* ---- base additions ---- */
  --border-strong: #7b8194;          /* 3.62:1 on --bg-elev */
  --scrim: rgba(0, 0, 0, .5);
  --selection: rgba(124, 156, 255, .28);
  --diff-add-bg: rgba(95, 212, 154, .10);
  --diff-del-bg: rgba(255, 107, 107, .10);

  /* ---- elevation (dark) ---- */
  --shadow-pop: 0 6px 24px rgba(0, 0, 0, .35);
  --shadow-float: 0 8px 24px rgba(0, 0, 0, .35);
  --shadow-sheet: 0 12px 40px rgba(0, 0, 0, .45);
  --shadow-modal: 0 20px 60px rgba(0, 0, 0, .5);
  --shadow-toast: 0 4px 12px rgba(0, 0, 0, .3);
}

/* ---------- Design system — semantic tokens (light) ---------- */
body[data-theme="light"] {
  /* same names, light targets */
  --surface-page: var(--bg);
  --surface-panel: var(--bg-panel);
  --surface-raised: var(--bg-elev);
  --surface-well: var(--code-bg);
  --text-primary: var(--fg);
  --text-muted: var(--fg-muted);
  --text-on-accent: var(--accent-fg);
  --focus-ring-color: var(--accent);
  --focus-ring: 2px solid var(--focus-ring-color);
  --overlay-scrim: var(--scrim);
  --selection-bg: var(--selection);
  --selection-text: var(--fg);

  --border-strong: #78828f;          /* 3.36:1 on --bg-elev */
  --scrim: rgba(0, 0, 0, .5);
  --selection: rgba(47, 95, 208, .16);
  --diff-add-bg: rgba(22, 112, 63, .10);
  --diff-del-bg: rgba(192, 57, 43, .10);

  --shadow-pop: 0 6px 24px rgba(0, 0, 0, .16);
  --shadow-float: 0 8px 24px rgba(0, 0, 0, .18);
  --shadow-sheet: 0 12px 40px rgba(0, 0, 0, .2);
  --shadow-modal: 0 20px 60px rgba(0, 0, 0, .22);
  --shadow-toast: 0 4px 12px rgba(0, 0, 0, .14);
}

/* ---------- Design system — primitives (theme-independent) ---------- */
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-prose: var(--font-ui);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --text-2xs: 9px;      /* fixed, see §4.4 */
  --text-xs: .72rem;
  --text-sm: .8rem;
  --text-ui: .86rem;
  --text-ui-lg: .93rem;
  --text-body: 1rem;
  --text-lg: 1.15rem;
  --fw-regular: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-heading: 650;
  --fw-bold: 700;
  --lh-tight: 1.2;
  --lh-snug: 1.35;
  --lh-normal: 1.5;
  --lh-prose: 1.65;
  --lh-flat: 1;
  --tracking-label: .08em;

  --space-hair: 2px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-pill: 999px;
  --radius-circle: 50%;

  --stroke-1: 1px;
  --stroke-2: 2px;
  --stroke-3: 3px;

  --z-inline: 2;
  --z-draft: 80;
  --z-chrome: 100;
  --z-state: 120;
  --z-rail: 150;
  --z-anchored: 200;
  --z-scrim: 400;
  --z-drawer: 410;
  --z-sheet: 600;
  --z-popover: 1000;
  --z-modal: 2000;
  --z-dialog: 2100;
  --z-toast: 3000;

  --dur-0: 100ms;
  --dur-1: 120ms;
  --dur-2: 180ms;
  --dur-3: 220ms;
  --dur-4: 380ms;
  --ease-standard: cubic-bezier(.2, .8, .2, 1);
  --ease-out: ease-out;
  --ease-linear: linear;

  --control-h-sm: 24px;
  --control-h-md: 30px;
  --control-h-body: 32px;
  --control-h-lg: 36px;
  --control-h-touch: 44px;
  --icon-sm: 14px;
  --icon-md: 16px;
  --icon-lg: 17px;
  --icon-xl: 22px;

  --shell-pane-min: 140px;
  --shell-reader-min: 352px;
  --side-panel-max: 480px;
  --outline-max: 520px;
  --tree-indent: 18px;

  --ai-composer-min-h: 40px;
  --ai-composer-max-h: 160px;
  --ai-diff-max-h: 260px;

  --opacity-disabled: .45;
  --opacity-drag: .4;

  --focus-offset: 2px;
  --focus-offset-inset: -2px;
}
```

Two rules complete the block. They are the only new component rules in the landing:

```css
.icon { width: var(--icon-md); height: var(--icon-md); display: block; }
::selection { background: var(--selection-bg); color: var(--selection-text); }
```

`--control-h-body` is the 32 px body-control height two shipped surfaces already use:
the edit-window bar (`--edit-bar-tool`, `:8538`) and the AI send/stop pair (`:5479`,
`:5503`). The 24 / 30 / 36 / 44 ladder cannot express it.

The values in `--border-strong`, `--scrim`, `--selection`, the light shadow alphas,
`--control-h-body`, `--opacity-disabled`, `--opacity-drag`,
`--fw-heading`, `--icon-xl`, the four shell layout tokens, `--tree-indent`, the three AI
height tokens, and the two diff washes are new decisions. Everything else is an existing
value with a name.
