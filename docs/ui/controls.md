# Controls — the component layer

Status: Current spec — foundation, pre-implementation.

Reference mockup: [`controls-mockup.html`](controls-mockup.html) — every component in every
state, dark and light, at desktop density, plus a 390 px phone board and the eight real
contexts that stress the set: the full edit bar, a Settings row, the AI composer, the table
toolbar, a session row menu, a dialog footer, an empty state, an error state.

**Normative source.** This document is the single source of truth for control anatomy,
states, and behaviour. It reads [`foundations.md`](foundations.md) for every token and adds
six component tokens (§1.2). The mockup illustrates it; where the mockup and this document
differ, this document wins. Where this document and `static/css/style.css` differ today, the
stylesheet wins — this document describes the target, and §3 says how the stylesheet gets
there without a sweep.

The archived records — [`workspaces.md`](../archive/ui/workspaces.md),
[`sessions.md`](sessions.md), [`topbar-session.md`](../archive/ui/topbar-session.md),
[`edit-window.md`](../archive/ui/edit-window.md), [`edit-window-guide.md`](../archive/ui/edit-window-guide.md),
[`code-block-chip.md`](../archive/ui/code-block-chip.md), `docs/archive/design/settings-modal.md` and
`docs/archive/design/mobile-shell.md` — are source material for the current code, not current
specs. Where they and this document disagree, this document wins. It does not redraw their
layout.

Every claim about current code cites `file:line`.

---

## 1. Inventory and verdict

### 1.1 What the inventory found

Five defects, each measured rather than asserted. They set the order of the work in §3.

| # | Defect | Evidence |
|---|---|---|
| **D1** | Eight rules paint `#fff` on `--accent`. White on `#7c9cff` measures **2.61:1** in the dark theme — below the 4.5:1 text floor and below the 3:1 UI floor. `--text-on-accent` is `#14151a` there and measures 6.99:1. | `style.css:203`, `:604`, `:1174`, `:2310`, `:2655`, `:2662`, `:2687`, `:5421` |
| **D2** | One "button" role is built nine times at nine heights (20–44 px) and four radii (4 / 5 / 6 / 8 px). | `style.css:423`, `:1345`, `:2145`, `:3693`, `:5406`, `:5846`, `:6223`, `:7815`, `:8654` |
| **D3** | Nine control families draw no focus ring; tabs and the file tree are also not Tab-reachable. | foundations §10.3; plus `static/js/tabs.js:644` (a `div`), `style.css:5048` (`.ai-model-select` has no `:focus` rule) |
| **D4** | One menu appearance is implemented five times: `NB.menu`, the session popover, the workspace popover, the edit-bar dropdowns, and the table-view popover. | `style.css:3037`, `:7987`, `:8044`, `:618`, `:987` |
| **D5** | "Disabled" is six opacities across control rules: `.4`, `.45`, `.5`, `.55`, `.6`, and a plain colour swap. | `style.css:1526` (.55), `:1552` (.5), `:1611` (.5), `:2314` (.6), `:5225` (.4), and the plain colour swap at `:1361` |

D1 is the only one that is an outright failure. The rest are drift, and drift is what makes
a control set feel assembled rather than designed.

### 1.2 Proposed token additions

Six component tokens. Each is cited by §2 and none redefines a foundation token. They go in
the primitives block (`foundations.md` §2.1) except the overlay colours and the switch knob,
which go in both theme blocks because they are colours. `--control-h-body` and
`--opacity-disabled` were promoted into the foundation during review; they are not repeated
here.

| Token | Value | Why it cannot use an existing token |
|---|---|---|
| `--switch-knob` | dark `var(--fg)`, light `var(--accent-fg)` | The switch is leaving Settings (§2.7). `--stg-switch-knob` (`style.css:1423`) is scoped to `#settings-overlay` and cannot follow it. Same two values, promoted. |
| `--overlay-control-fg` | `#ffffff` (both themes) | The lightbox controls sit over an arbitrary image, not over a themed surface (`style.css:3695`). No theme text token is readable there. |
| `--overlay-control-face` | `rgba(255,255,255,.14)` | Hover and pressed wash for the same controls (`style.css:3709`, `:3712` use raw `.15` / `.25`). |
| `--overlay-control-border` | `rgba(255,255,255,.28)` | Boundary for the same controls (`style.css:3696` uses `.25`). |
| `--overlay-control-pill` | `rgba(0,0,0,.55)` | The controls sit on this face, not on a themed surface. At `.45` white text measures 3.19:1 over a white image; at `.55` it measures 4.76:1. Both theme blocks: a dark pill is the same in both. |
| `--overlay-control-ring` | `0 0 0 2px rgba(0,0,0,.55)` | The focus ring has to read on a white image and on a dark one; the accent ring can vanish into a blue/white image. Primitives block: no theme value. |

Not added, deliberately: no `--accent-hover` (§2.1 gives the hover idiom), no
`--text-on-danger` (there is no filled danger button, §8), no spacing or radius token
(every value below resolves to `--space-N`, `--radius-X`, `--stroke-N`).

### 1.3 The inventory

Verdict key: **keep** = the class stays and its rule is edited in place. **alias** = the class
stays, and it reads the shared component's numbers. **merge** = two or more families become
one component with one rule. **replace** = the markup changes as well as the CSS.

| Family | Rule | Height today | Radius | Focus ring | Verdict | Target component |
|---|---|---|---|---|---|---|
| `.activity-btn` | `:242` | 36 × 36 | 6 | none | alias | Icon button, lg |
| `.collapse-btn` | `:423` | ≈20 | 4 | none | merge | Icon button, sm |
| `.expand-btn` | `:437` | fills the strip | — | none | keep, one-off | Pane affordance. Not a button: it is the whole gutter. |
| `.icon-btn` | `:1345` | ≈26 | 6 | none outside Settings (`:1445`) | alias | Icon button, md |
| `#topbar button` | `:192` | ≈30 | 6 | none | alias | Button, md, secondary + primary |
| `#topbar button.primary` | `:203` | — | — | — | keep, fix D1 | Button, md, primary |
| `#edit-bar .eb` | `:584` | 26 × 28 | 4 | none | merge | Toolbar button, md |
| `.edit-bar-btn` | `:8654` | 44 | 6 | yes `:8672` | keep | Toolbar icon button, 44 |
| `.settings-action` | `:2145`, scoped `:1538` | ≈32 | 6 | yes `:1548` | keep | Button, md |
| `.settings-action--primary` | `:1556` | — | — | — | keep, fix D1 | Button, md, primary |
| `.te-tool` | `:5846` | 28 | 6 | yes `:5861` | alias | Toolbar icon button, body |
| `.designer-btn` | `:6223` | 30 | 6 | yes `:6231` | keep | Button, md + variants |
| `.designer-iconbtn` | `:6207` | 32 | 6 | yes `:6215` | alias | Icon button, body |
| `.edit-chip` | `:8677` | 32 | 6 | yes `:8696` | keep | Toolbar button, body |
| `.mlb-btn` | `:3693` | ≈27 | 5 | none | alias, inverse | Overlay control, md |
| `.ai-btn` | `:5406` | ≈26 | 6 | none | alias | Button, md |
| `.ai-send` / `.ai-stop` / `.ai-attach` | `:5475` / `:5499` / `:5580` | 32 / 32 / 30 | circle / circle / 8 | yes `:5518` | keep | Icon button, body, round |
| `.draft-bar-btn` | `:7815` | ≈31 | 5 | none | alias | Button, md (30) |
| `.ws-btn` | `:8158` | ≈27 | 6 | inherited | alias | Button, sm, ghost / danger |
| `.search-panel-input` | `:3913` | 32 | 6 | yes `:3929` | keep | Search input, lg |
| `.search-panel-clear` | `:3940` | 22 | 4 | yes `:3972` | alias | Icon button, sm |
| `.search-panel-case` | `:3977` | 28 × 32 | — | yes `:4020` | merge | Chip toggle |
| `.search-panel-select` | `:4205` | 32 | 6 | yes `:4223` | keep | Select, lg |
| `.search-panel-retry` | `:4261` | 28 | 6 | yes `:4272` | alias | Button, sm |
| `.search-panel-hit` | `:4299` | 32 | 4 | yes `:4313` | keep | List row |
| `.auth-input` | `:2297` | ≈36 | 6 | border only `:2307` | keep | Text input, lg, mono |
| `.settings-text-input` | `:2073` | ≈32 | 6 | border only `:2083` | merge | Text input, lg |
| `.recent-filter` | `:3813` | ≈32 | 6 | border only `:3823` | merge | Search input, lg |
| `.ai-input` | `:5460` | min 40 | 0 | container halo `:5455` | keep | Textarea, card |
| `.ai-model-select` | `:5048` | ≈29 | 6 | **none** | merge | Select, lg |
| `.session-item` | `:8005` | 32 | 5 | yes inset `:8015` | keep | Menu item |
| `.session-row` / `.session-more` | `:8332` / `:8414` | 30 / 24 | 6 / 5 | yes inset | keep | List row / icon button sm |
| `.tree-row` | `:2771` | ≈22 | 4 | **none**; a `div` | replace | Tree row |
| `.tree-star` / `.tree-pin` | `:2999` / `:3018` | 13 glyph | — | none | alias | Icon button, sm; no hover reveal on coarse |
| `.tab` internals / `.tab-close` | `:1177` / `:1218` | ≈28 / 16 | 6 top / 4 | **none**; a `div` | replace | Tab |
| `.nb-tv-toggle` / `.nb-tv-btn` / `.nb-tv-item` | `:940` / `:969` / `:1000` | 24 / ≈22 / ≈22 | 4 / 4 / 4 | yes | keep | Reader table controls; anatomy owned by `content-blocks.md` §3.3, 24 px floor tracked there as P17 |
| `.nb-tv-pop` | `:987` | 24 | 6 | yes | alias | Menu, inline |
| `.eb-menu` | `:618` | 28 | 6 | none | alias | Menu, inline |
| `.dw-shape-btn` / `.dw-glyph-btn` | `:6837` / `:6794` | 34 / 28 | 5 / 4 | yes / none | alias | Segmented chip / toolbar sm |
| `.dw-cell` | `:6746` | grid cell | — | none | keep, one-off | Canvas cell, not a control |
| `.stg-tag` / `.ws-badge` | `:1714` / `:8144` | 18 / 16 | pill | — | keep | Badge |
| `.stg-status` | `:1694` | inline | — | — | keep | Status line |
| `.toast` | `:3787` | ≈34 | 6 | — | keep, add role | Toast |
| `.context-menu` | `:3037` | 30 per item | 8 / 5 | none | keep | Menu |
| `.session-menu` / `.workspace-menu` | `:7987` / `:8044` | 32 per row | 8 / 5 | yes | keep | Menu, popover |
| `.settings-nav-item` | `:1941` | ≈34 | 6 | yes `:1977` | keep | Tablist item |
| `#settings-overlay input[type=checkbox]` | `:1592` | 36 × 20 | pill | yes `:1608` | keep | Switch — the contract |
| `.theme-options label` (+7 groups) | `:1616` | ≈28 | pill | yes `:1645` | keep | Radio chip |
| `.graph-view-mode button` | `:4530` | 30 | 8 (container) | `color-mix()` `:4554` | merge | Segmented |
| `.graph-view-btn` | `:4633` | 30 | 8 | yes `:4660` | alias | Icon button, md |
| `.ai-turn-control` | `:5195` | ≈20 | 6 | yes `:5216` | keep | Button, xs, ghost |
| `#welcome .welcome-action` | `:2607` | ≈37 | 6 | none | alias | Button, lg |
| `.markdown-body li > input[type=checkbox]` | `:3201` | 13 | — | none | keep, content | Task-list box — it is note content, not chrome |

---

## 2. Component set

Sixteen components. Each entry gives anatomy, sizes, states, the markup skeleton, the
ARIA and keyboard contract, and where it applies today. All values are tokens.

Two conventions apply to every component and are not repeated:

- **Focus** is `:focus-visible` only. Ring = `var(--focus-ring)` at
  `outline-offset: var(--focus-offset)` (2 px). Inside a scroller, a clipped container, or a
  4 px-padded popover, use `var(--focus-offset-inset)` (−2 px). Foundations §10.2.
- **Disabled** is a real `disabled` attribute where the control is a native button or input,
  and `aria-disabled="true"` only where the control must keep its tab stop. Both paint
  `opacity: var(--opacity-disabled)` and `cursor: not-allowed`. Never colour alone, never
  hover-responsive.

### 2.1 Button

**Anatomy.** `[leading glyph?] [label] [trailing glyph?]`. One text line. No wrap.

| Property | Value |
|---|---|
| Height | `--control-h-md` (30). `sm` variant: `--control-h-sm` (24). `lg` variant: `--control-h-lg` (36). |
| Padding-x | `--space-3` (12). `sm`: `--space-2` (8). Icon+label gap `--space-1` |
| Radius | `--radius-sm` (6) |
| Type | `--text-ui` (`.86rem`), weight `--fw-medium`, line `--lh-flat` |
| Focus | ring, offset 2 |

| Variant | Face | Text | Border | Where |
|---|---|---|---|---|
| **primary** | `--accent` | `--text-on-accent` | `--accent` | The one commit action of a group or a surface |
| **secondary** | `--surface-raised` | `--text-primary` | `--border-strong` | The default |
| **ghost** | transparent | `--text-muted` | transparent | Row actions inside a card or panel |
| **danger** | transparent | `--danger` | transparent | Destructive row action. Never filled (§8) |
| **link** | transparent | `--accent` | transparent | A control that must read as text until hover. `#brand` is not this variant: it is the product name and keeps `--text-primary` (`shell-frame.md` C8) |

States:

| State | Delta | Tokens |
|---|---|---|
| rest | variant face above | — |
| hover | secondary: `--accent-soft` face, `--accent` border. ghost/danger: wash face, border takes the text colour. primary: **3 px `--accent-soft` halo**, face unchanged | `box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft)` |
| pressed | halo removed, `transform: translateY(1px)` | — |
| focus-visible | 2 px ring, offset 2 | `--focus-ring`, `--focus-offset` |
| busy | label → verb + "…" ("Saving…"), `aria-busy="true"`, disabled, `cursor: progress` | `--opacity-disabled` |
| disabled | `--opacity-disabled`, `cursor: not-allowed`, **hover does nothing** | `--opacity-disabled` |
| danger-hover | **face unchanged** + an inset `1px` `--danger` ring. A `--danger-soft` fill puts the label at ≈3.7:1 in both themes — the same trap `sessions.md` Appendix A records for the menu | `--danger` |
| danger-pressed | `translateY(1px)`, ring unchanged | — |

The primary hover is a halo, not a brightness filter. Five shipped rules use
`filter: brightness()` (`style.css:204`, `:1561`, `:2313`, `:4941`, `:6550`) and one uses
`opacity: .88` (`:5424`). Foundations §11.4 forbids the filter and notes that `:204` and
`:4941` predate the rule; the halo already exists in this stylesheet at `.ai-send:hover`
(`:5489`) and `.ai-input-row:focus-within` (`:5455`).

```html
<button type="button" class="settings-action settings-action--primary">Apply</button>
<button type="button" class="settings-action">Cancel</button>
<button type="button" class="designer-btn designer-btn--danger">Remove</button>
```

**ARIA and keyboard.** Native `<button>`. `type` is always set. The label is the accessible
name — no `aria-label` that hides a visible word. `Enter` and `Space` are native. A button
that opens a layer carries `aria-haspopup` and `aria-expanded`; a toggle carries
`aria-pressed`.

**Applies to.** `.settings-action` (`:2145`), `.designer-btn` (`:6223`), `.ai-btn`
(`:5406`), `.draft-bar-btn` (`:7815`), `.ws-btn` (`:8158`), `.welcome-action` (`:2607`),
`.search-panel-retry` (`:4261`), `.ai-turn-control` (`:5195`), `#topbar button` (`:192`),
`#edit-bar .eb` (`:584`), `.edit-chip` (`:8677`), `.mlb-btn` (`:3693`, inverse face — §2.13).

### 2.2 Icon button

**Anatomy.** One glyph, one accessible name, no visible label.

| Size | Box | Glyph | Used by |
|---|---|---|---|
| `sm` | `--control-h-sm` (24) | `--icon-md` (16) | `.collapse-btn`, `.search-panel-clear`, `.tab-close`, `.session-more`, `.nb-tv-toggle`, `.tree-more`; the reader `.nb-tv-btn`/`.nb-tv-item` measure ≈22 and are tracked in `content-blocks.md` P17 |
| `md` | `--control-h-md` (30) | `--icon-md` (16) | `.icon-btn`, `.graph-view-btn`, `.mlb-btn` |
| `body` | `--control-h-body` (32) | `--icon-md` (16) | `.designer-iconbtn`, `.ai-send`, `.ai-stop`, `.ai-attach`, `.te-tool` |
| `lg` | `--control-h-lg` (36) | `--icon-lg` (17) | `.activity-btn` |
| 44 | `--control-h-touch` (44) | 20–22 | `.edit-bar-btn`, every phone control |

Radius `--radius-sm`; `.ai-send` / `.ai-stop` are `--radius-circle`; nested-in-a-field or
nested-in-a-popover controls take `--radius-xs`.

**Tooltip rule.** An icon-only control carries `aria-label` (the accessible name) **and**
`title` (the visible hint). `title` never carries a fact the user must have to act — a
disabled reason is visible text or `aria-describedby`, not a tooltip. There is no custom
tooltip component (§8).

States are the button's (§2.1) with two differences: the hover face is always
`--accent-soft` (an icon button has no variant), and a *toggle* icon button's on-state is
`--accent-soft` face + `--accent` glyph + `aria-pressed="true"`, **never** a filled accent
(§1.1 D1). `.designer-iconbtn[aria-pressed="true"]` (`:6219`) already fills with
`--accent-fg`; it changes to the wash on its next edit so that the rail, the edit chips, the
table tools, and the graph buttons all agree.

```html
<button type="button" class="icon-btn" aria-label="Reload" title="Reload">
  <svg class="icon" aria-hidden="true" focusable="false"><use href="#nb-icon-refresh"/></svg>
</button>
<button type="button" class="edit-bar-btn" aria-label="Undo (Ctrl+Z)"
        title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z">…</button>
```

**ARIA and keyboard.** Native `<button>`; the glyph is `aria-hidden`. `aria-pressed` on a
toggle; `aria-expanded` + `aria-haspopup` on a menu trigger. Chords are named in `title`
and in `aria-keyshortcuts`, never in the accessible name alone.

### 2.3 Toolbar and toolbar group

**Anatomy.** One row: `[group] [separator] [group] …`. A group is 1–6 related controls with
a `--space-hair` gap. A separator is `1 × 18 px` with `4 px` each side in the markdown bar.

| Property | Value |
|---|---|
| Height | The tallest control in the row. Desktop markdown bar: 26. Edit-window bar: 44 line, controls 32 (`edit-window.md` §2). Phone: 44 |
| Group gap | `--space-hair` (2) |
| Group-to-group | separator + `var(--space-1)` (4) each side in the markdown bar; `--space-2` (8) elsewhere |
| Surface | transparent on `--surface-panel`; `.te-toolbar` sits on `--surface-panel` inside a `--surface-page` body |

Three overflow behaviours exist and each is intentional for its surface. Do not add a
fourth, and never combine two on one row:

| Surface | Overflow | Why |
|---|---|---|
| Markdown `#edit-bar` desktop | `flex-wrap: wrap` (`style.css:576`) | It is the only bar with two rows of horizontal room; wrapping keeps every control one click away |
| Markdown `#edit-bar` phone | horizontal scroll, `Save`/`Done` sticky at the left (`:7101`–`:7134`) | The bar must never become two rows over the reader |
| Edit-window bar | horizontal scroll + a right-edge mask on `.is-scrollable` (`edit-window-guide.md` §3.2) | A second row would move the grid mid-edit |
| Table-view in-reader toolbar | no overflow: one icon opens a popover (`style.css:940`) | It floats over a table |

A group is `role="group"` with an `aria-label`; the toolbar is `role="toolbar"` with its own.
Separators are `aria-hidden`. A toolbar never contains a text field.

```html
<div class="edit-bar-toolbar" role="toolbar" aria-label="Table tools">
  <div class="edit-bar-group" role="group" aria-label="Rows">…</div>
  <span class="edit-bar-sep" aria-hidden="true"></span>
  <div class="edit-bar-group" role="group" aria-label="Columns">…</div>
</div>
```

**Keyboard.** `Tab` enters at the first control and leaves at the last; arrow keys are not
bound (a toolbar of independent buttons, not a radio group). A control that scrolls out of
view must scroll into view when focused — `edit-window-guide.md` §3.2 already requires this.

### 2.4 Text input, search input, textarea, number input

One field look, four shapes. The whole set is one border, one focus, one invalid state.

| Property | Value |
|---|---|
| Height | `--control-h-lg` (36) desktop, `--control-h-touch` (44) phone. A textarea's height is content |
| Padding | `0 var(--space-3)`; textarea `var(--space-2) var(--space-3)` |
| Radius | `--radius-sm` |
| Face | `--surface-well` |
| Border | `1px var(--border-strong)` — `--border-strong`, 3.36:1 on `--surface-raised` light. Never `--border` (1.27:1): foundations §3.5 |
| Type | `--text-ui`, `--text-primary`. Mono (`--font-mono`) only where the content is code or a path: `#auth-password`, `#settings-vimrc-area`, `#ws-path`, `#ws-resolved`. `settings-modal.md` §3.6 D3 fixes this split and it stands |
| Placeholder | `--text-muted` |

| State | Delta | Tokens |
|---|---|---|
| rest | — | — |
| hover | border `--accent` | `--accent` |
| focus | border `--accent` + 3 px wash halo. `outline: none` **only** because the border is the visible replacement (foundations §10.2 rule 2) | `--accent`, `box-shadow: 0 0 0 var(--stroke-3) var(--accent-soft)` |
| invalid | border `--danger` + wash halo; `aria-invalid="true"` + `aria-describedby` → the message | `--danger`, `--danger-soft` |
| disabled | `--opacity-disabled`, `cursor: not-allowed` | `--opacity-disabled` |
| read-only | no focus *change* — it keeps the normal ring because it stays tabbable; border `--border`, text `--text-muted` | — |
| filled | no visual change. The field never recolours when it has a value | — |

**Search input** adds a trailing clear control: a 24 px icon button (§2.2) inset
`--space-1` from the right, radius `--radius-xs`, `aria-label="Clear search"`, shown only
when the field is non-empty. The field reserves `padding-inline-end: var(--control-h-body)`
so text never runs under it. The browser's own search cancel button stays suppressed
(`::-webkit-search-cancel-button`, `style.css:3933`). `Escape` in a search field clears it
when the panel is docked, and closes the layer when the panel is a drawer.

**Card textarea** (the AI composer, `style.css:5459`): the borderless textarea sits inside a
framed container that owns the border, the radius, and the focus halo via `:focus-within`.
Do not give the inner textarea its own border.

```html
<!-- boxed -->
<label class="settings-label" for="site-title">Site title</label>
<input id="site-title" class="settings-text-input" type="text" autocomplete="off">

<!-- search -->
<div class="search-panel-input-wrap">
  <input class="search-panel-input" type="search" aria-label="Search notebooks">
  <button type="button" class="search-panel-clear" aria-label="Clear search" hidden>…</button>
</div>

<!-- card -->
<form class="ai-input-row">
  <textarea id="ai-input" class="ai-input" rows="3" aria-label="Message"></textarea>
</form>
```

**ARIA and keyboard.** Every field has a `<label for>` or an `aria-label`; never a
placeholder as the name. `aria-describedby` points at the hint **and** the error.
`type="number"` carries `inputmode="numeric"` and a `step`. `Enter` submits a one-line form
(workspaces.md §7.2); a textarea's `Enter` inserts a newline and `Ctrl/Cmd+Enter` submits.

**Applies to.** `.settings-text-input` (`:2073`), `.auth-input` (`:2297`),
`.search-panel-input` (`:3913`), `.recent-filter` (`:3813`), `.ai-input` (`:5460`),
`.settings-vimrc-area` (`:1530`), `#settings-ai-custom-prompt` (`:1533`),
`#settings-autosave-delay` (`:1527`), `#capture-sheet textarea` (`docs/archive/design/mobile-shell.md`
§4.8), and the emoji search (`style.css:696`).

### 2.5 Select

One look, four instances. Native element, native popup: a custom listbox would have to
re-implement type-ahead, Home/End, and the platform picker, and the two menus that do that
(§2.9) are 230 lines each.

| Property | Value |
|---|---|
| Height | `--control-h-lg` desktop, `--control-h-touch` phone |
| Padding | `0 var(--space-6) 0 var(--space-3)` — the right reserve keeps the native arrow clear of the text |
| Everything else | as the text input (§2.4) |

States: as the text input, plus `hover` = accent border (already `.search-panel-select:hover`,
`:4222`). `option:disabled` is `--text-muted` and keeps its place in the list.

```html
<select class="ai-model-select" aria-label="Model">…</select>
```

**Applies to.** `.search-panel-select` (`:4205`), `.ai-model-select` (`:5048` — **no focus
rule today**), the Settings Role select and the wallpaper selects
(`docs/archive/design/settings-modal.md` §3.6), `.te-sort-col` (`:5889`).

### 2.6 Chip and badge

Two different things and they must not be confused.

| | Badge | Chip |
|---|---|---|
| Role | Reports a fact. Not interactive | Names an object, or is a filter |
| Shape | `--radius-pill`, `1px` border, no fill | `--radius-pill`, `1px` border or `--accent-soft` fill |
| Type | `--text-xs` (`.72rem`) 600; count badges use `--text-2xs` (9 px, fixed) | `--text-sm` or `--text-ui` |
| Padding | `1px var(--space-2)` | `var(--space-1) var(--space-2)` |
| Colour | text and border carry the state: `--accent` (current), `--text-muted` (neutral), `--ok`, `--warn`, `--danger` | `--text-muted` at rest, `--accent` when on |
| Hit | none — it is not a control | `--control-h-sm` minimum, or `--control-h-md` when it is a filter |

**Badges are outline pills, never filled.** `--accent` text on an `--accent-soft` fill
measures 4.18:1 in the light theme (`workspaces.md` §3.3). This rule already governs
`.ws-badge` (`:8144`), `.stg-tag` (`:1714`), and the ACP tags.

**A removable chip** carries its `×` as a real button with `aria-label="Remove {name}"`,
24 px hit grown by `margin: calc(-1 * var(--space-1))` so the chip stays 24 px tall.

**A count badge** is `min-width: 2ch`, `font-variant-numeric: tabular-nums`,
`text-align: right`, so 0…40 holds one column. On a selected row it takes
`--text-primary` (`style.css:8407` — the reason is in the comment: `--ws-fg-muted` on
`--accent-soft` is 4.03:1 in the dark theme).

```html
<span class="ws-badge ws-badge--warn">Not found</span>
<span class="session-count">12</span>
<span class="ai-attach-chip">
  <span class="ai-attach-chip-name">notes.md</span>
  <button type="button" class="ai-attach-chip-remove" aria-label="Remove notes.md">×</button>
</span>
```

**Colour is never the only signal** (foundations §3.4). Every status badge carries a word.

**Applies to.** `.ws-badge` (`:8144`), `.stg-tag` (`:1714`), `.session-count` (`:8400`),
`.session-total` (`:8254`), `.search-panel-advanced-badge` (`:4077`), `.graph-view-badge`,
`.ai-attach-chip` (`:5536`), `.edit-chip` (`:8677` — a chip-shaped *button*, §2.1).

### 2.7 Checkbox, radio, switch

Three different jobs, three different shapes.

**Switch — the contract, exactly as shipped in Settings.** 36 × 20 track, 16 px knob,
`translateX(16px)` when on. It stays a native `<input type="checkbox">` so the label
association, the keyboard toggle, and the screen-reader semantics are free.

| Property | Value | Note |
|---|---|---|
| Track (off) | `--border-strong` | The shipped rule uses `--border` (`:1595`), which is 1.27:1 on `--bg-elev` light — under the 3:1 UI floor. This is the one value this document changes in the switch |
| Track (on) | `--accent` | — |
| Knob | `--switch-knob` | `--stg-switch-knob` (`:1423`) promoted so the switch can leave Settings |
| Motion | `--dur-1` background, `--dur-1` transform, `--ease-out` | Shipped `.15s` (`:1597`) is between `--dur-1` and `--dur-2`; it snaps to `--dur-1` |
| Disabled | `--opacity-disabled`, `cursor: not-allowed` | — |
| Focus | ring, offset 2 | — |
| Reduced motion | both transitions none | Shipped at `:1612` |

`--dur-1` is **120 ms**, and a state change under reduced motion is instant and complete, not
half-applied (foundations §7.3).

**Checkbox.** Native, 16 × 16, `accent-color: var(--accent)` (`style.css:1031` already
does this). The hit area is the label: `padding: var(--space-1) 0`, minimum 24 px tall. A
checkbox used as a **filter** is rendered as a chip toggle instead — a native checkbox with a
visually-hidden input inside a pill labelled chip, `:has(input:checked)` for the on state
(`.search-panel-case`, `:3977`).

**Radio.** Native and focusable; visually hidden inside the chip
(`position:absolute; width:1px; height:1px; opacity:0`, `:1651`). The chip is 30 px tall,
`--radius-pill`, `--border-strong`; checked = `--accent-soft` face, `--accent` border and
text, `--fw-semibold`. Arrow keys move within the group natively. Shipped and correct.

**Never** convert a Settings checkbox back to a native box, and never build a switch out of
divs. `docs/archive/design/settings-modal.md` §3.6 D4 is the contract.

```html
<input type="checkbox" id="settings-autosave-toggle" checked>
<label for="settings-autosave-toggle">Autosave</label>

<label class="search-panel-case">
  <input type="checkbox"><span aria-hidden="true">Aa</span><span class="sr-only">Match case</span>
</label>
```

**Applies to.** Settings switches (`:1592`), `.search-panel-case` (`:3977`),
`.search-panel-mode-opt` radios (`:4164`), the eight Settings radio-chip groups (`:1616`),
`.nb-tv-item.is-check` (`:1031`), `#graph-view-depth` (a range, not in this set — it keeps
its native track).

### 2.8 Segmented control and tablist

**Segmented control.** A small set of mutually exclusive modes, all visible. Container
`display: inline-flex`, height `--control-h-md`, `1px var(--border-strong)`,
`--radius-sm`, `--surface-well`, `overflow: hidden`. Items share one divider
(`border-left: 1px var(--border)`), `padding: 0 var(--space-2)`,
`min-width: var(--control-h-lg)`. On = `--accent-soft` face + `--accent` text, 600. Because
the container clips, the focus ring is inset (`outline-offset: var(--focus-offset-inset)`).

`.graph-view-mode` (`:4520`) is this component. It keeps its height (30) and takes
`--radius-sm` like every other control — the 8 px it ships with is `--radius-md`, a panel
radius on a control face. Its focus rule uses `color-mix(in oklab, …)` (`:4556`), a one-off
alpha, and becomes an inset `var(--focus-ring)`.

**Tablist.** `role="tablist"`, one `role="tab"` per item, `aria-selected`, and a roving
tabindex: exactly one tab has `tabindex="0"`. `ArrowUp`/`ArrowDown` (vertical) or
`ArrowLeft`/`ArrowRight` (horizontal) move and select, `Home`/`End` jump. The panel is
`role="tabpanel"` with `aria-labelledby`.

The file tab bar is two regions, not one: `#tab-pinned` and `#tab-list` are separate
siblings inside `#tab-bar`, and `#outline-toggle` is a third sibling that is not a tab
(`templates/index.html:280-293`). Each region gets its own `role="tablist"` with an
`aria-label`; a hidden pinned region removes its tablist from the tree. This keeps the
`role="tab"` children inside a tablist without wrapping or moving the toggle. A file tab's
close button is `tabindex="-1"` — `Delete` on the active tab closes it, and the tab's menu
offers Close — so the strip keeps one Tab stop per visible region, not one per tab plus one
per close button.

| Variant | Item height | Radius | Selected treatment |
|---|---|---|---|
| Vertical (Settings nav) | `--control-h-md` | `--radius-sm` | `--accent-soft` + `--accent` + 600 + `inset var(--stroke-2) 0 0 var(--accent)` (`:1972`) |
| Horizontal (file tabs) | bar `--tab-h` 34; tab 28.5 (`tab-bar.md` §2.2) | `--radius-sm --radius-sm 0 0` | `--surface-page` face + `--accent` border (`:1200`) |

```html
<div class="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings">
  <button class="settings-nav-item" role="tab" aria-selected="true"
          aria-controls="settings-section-general" tabindex="0">General</button>
</div>
```

**Applies to.** `.settings-nav-item` (`:1941`), `.graph-view-mode` (`:4530`),
`.search-panel-mode` (`:4153`), `#tab-pinned` and `#tab-list` (`:1177` — **proposed change**, §8).

### 2.9 Menu, menu item, submenu, separator

One appearance, five instances (§1.1 D4). `NB.menu` (`static/js/menu.js`) owns the
behaviour; the two pickers own their own placement because they attach to a mount rather
than to a pointer (`workspaces.md` D2); the two inline dropdowns anchor to their trigger.

| Part | Value |
|---|---|
| Box | `--surface-raised`, `1px var(--border)`, `--radius-md` (8), padding `--space-1`, `--shadow-pop`, `--z-popover` (1000). Minimum width 170 px; the two pickers are 300 px |
| Item | `min-height: --control-h-body` (32), padding `0 var(--space-2)`, radius `--radius-xs`, `--text-ui`, gap `--space-2`, full width, text left |
| Item hover | `--accent-soft` face, `--text-primary` |
| Item focus-visible | inset ring, `outline-offset: var(--focus-offset-inset)` — the box is 4 px padded and the ring would clip |
| Item disabled | `--text-muted`, `--opacity-disabled`, no hover, `cursor: default`, reason in visible text or `title`. Not focusable through the roving walk |
| Item danger | `--danger` text; hover keeps the face and adds an inset `1px --danger` ring. **Not** a `--danger-soft` fill: `--danger` on `--danger-soft` is ≈3.7:1 in both themes (`sessions.md` Appendix A) |
| Item current | `--accent` text + 600 + a 14 px check column (`aria-current` — the value the surface uses), no hover fill |
| Kbd hint | right-aligned, `--text-xs`, `--font-mono`, `--text-muted` |
| Submenu | same box, `position: absolute; left: 100%; top: -5px`, a `▸` marker in `--text-muted`, opens on hover and on click (`menu.js:145`) |
| Separator | `<hr>`, `1px var(--border)`, margin `var(--space-1) var(--space-2)` |
| Phone | item `min-height: calc(var(--control-h-touch) + var(--space-1))` (48), `15 px`, padding-x `14 px` (`docs/archive/design/mobile-shell.md` §4.11) |

```html
<div id="nb-menu" class="context-menu" role="menu" hidden>
  <button>Open</button>
  <button>Copy link<kbd class="context-menu-kbd">Ctrl+C</kbd></button>
  <hr>
  <button class="submenu">Move to session…<div class="context-menu" role="menu">…</div></button>
  <button class="danger">Delete</button>
</div>
```

**Keyboard** (`menu.js:188-230`, shipped and correct): `Esc` closes; `ArrowDown`/`ArrowUp`
walk the focused level's enabled items and wrap; `ArrowRight` opens a submenu and focuses its
first item; `ArrowLeft` closes it and returns; `Enter`/`Space` activate. `Tab` leaves.
Roving tabindex is not used — focus is moved directly.

**One rule for the five instances:** a menu is a `--surface-raised` box with
`--shadow-pop`; an item is 32 px (48 on phone) with a 4 px radius. `.eb-menu` (`:618`) is the
one that breaks both (28 px items, `--shadow-pop` at `:622`, `--z-chrome` 100) and becomes an
inline instance of this component when that bar is next touched.

### 2.10 Tooltip

**There is no tooltip component, and this pass does not add one.** The tooltip is the
native `title`, under three rules:

1. An icon-only control carries `aria-label` **and** `title`. The `title` may restate the
   label; it must not be the only name.
2. A fact the user needs in order to act is visible text or `aria-describedby`. Examples
   already shipped: "Folder not found" as a second line (`workspaces.md` §4.3), the disabled
   reason on the Sessions `+` as `title` + `aria-disabled` (`sessions.md` D12).
3. No chrome control may depend on hover to become reachable or comprehensible.

Reason: a custom tooltip needs a new z-band above `--z-popover`, a hover timer, a touch
equivalent, and an escape from the 40-odd `title` attributes already in the markup. The
native one is announced as the description and costs nothing.

### 2.11 Dialog frame

**Anatomy.** `[scrim] [header: title + close] [body: scrolls] [footer: actions]`. The shell
is `.settings-overlay` + `.settings-modal` (`style.css:1369`, `:1801`), shared by Settings,
Auth, Export, Workspaces, Sessions and the three edit windows. It is already one component;
this section only fixes its numbers.

| Part | Value |
|---|---|
| Scrim | `--overlay-scrim`, the only backdrop for a dialog |
| Box | `--surface-panel`, `1px var(--border)`, `--radius-lg` (12), `--shadow-modal`, `--z-modal` (2000). A dialog opened **from** a dialog takes `--z-dialog` (2100) — `#workspace-dialog` (`:8174`) |
| Header | 65 px in an edit window (`--edit-head-h`), otherwise `--space-3 var(--space-4)`; title `--text-lg` 600 |
| Body | the only scroller; `overflow-y: auto` |
| Footer | right-aligned, gap `--space-3`, padding `var(--space-3) var(--space-4)`, `1px` top border, `--surface-panel` |
| Close | an icon button (§2.2) at the header's trailing edge, `aria-label="Close"` |
| Motion | `--dur-2` opacity on the scrim, no transform on the box. Reduced motion: none |

**Containment** is `NB.dialog.open()` (`static/js/dialog.js`): it makes every other body
child inert, wraps `Tab`, moves initial focus, and returns focus on close. `Esc` closes the
topmost layer; a nested dialog stops propagation so one press closes one layer
(`workspaces.md` §7.2).

```html
<div class="settings-overlay" hidden>
  <div class="settings-modal auth-modal" role="dialog" aria-modal="true"
       aria-labelledby="ws-dialog-title" tabindex="-1">
    <div class="settings-header">
      <h2 id="ws-dialog-title">Add workspace</h2>
      <button class="icon-btn" type="button" aria-label="Close">×</button>
    </div>
    <form class="settings-body auth-form">…</form>
    <div class="settings-footer">
      <button class="settings-action" type="button">Cancel</button>
      <button class="settings-action settings-action--primary" type="submit">Add workspace</button>
    </div>
  </div>
</div>
```

**Touch.** On a phone a dialog whose content is a short form stays a centred dialog
(`.auth-modal` at `min(420px, 92vw)`, `:7760`) with 44 px fields and buttons; a dialog whose
content is a list or a preference set becomes a **sheet** (§2.12). That split is decided in
`docs/archive/design/mobile-shell.md` §4.9 and is not reopened here.

### 2.12 Sheet frame

**Anatomy.** `[scrim] [grabber] [header: title + close] [body] [footer]`. Bottom-anchored.

| Part | Value | Source |
|---|---|---|
| Box | `--surface-panel`, `--radius-xl` on the top corners only, `--shadow-sheet`, `--z-sheet` (600), `padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom))` | `mobile-shell.md` §4.8 |
| Height | `min(72dvh, 560px)`; Settings `min(88dvh, 480px)` | §4.8, §4.9 |
| Grabber | 36 × 4, `--border`, `--radius-pill`, centred, `--space-2` from the top | §4.8 |
| Header | 52 px; title `16 px` 600; close 44 × 44 | §4.8 |
| Body | 16 px fields, `--space-3` padding | §4.8 |
| Footer | one primary button, 44 high, full width, phone radius `--m-radius` (10) | §4.8 |
| Motion | `--dur-3`, `--ease-standard`, transform only. Reduced motion: none | §4.8 |

Scrim and keyboard handling are the shell's (`#mobile-scrim`, `--m-kb`), not the sheet's.

### 2.13 Lightbox frame

**Anatomy.** `[scrim + blur] [body: the artefact, pan and zoom] [controls pill: zoom out,
percentage, zoom in, fit, close]`. Four instances share one implementation: Mermaid,
WaveDrom, Graphviz, SVG (`templates/index.html:1792`, `:1808`, `:1824`, `:1838`).

| Part | Value |
|---|---|
| Scrim | `rgba(0,0,0,.55)` + `backdrop-filter: blur(8px)` (`:3668`). The blur is a backdrop, not a glass panel; it stays |
| Box | `position: fixed; inset: 0`, `--z-modal` (2000) |
| Body | centred, padded `60px 40px`, scrolls when the artefact exceeds the frame |
| Controls | pill, top-right `--space-4`, `--space-2` padding, `--radius-md`, `rgba(0,0,0,.45)` face |
| Control | owned by [`lightboxes.md`](lightboxes.md) §8: shipped 28 px, `--overlay-control-radius` 5, `1.05rem`, `--overlay-control-fg` on `--overlay-control-pill`, `1px --overlay-control-border`, hover `--overlay-control-face` |
| Focus | 2 px white `--overlay-control-fg` ring, offset 2, so it survives a white image (`lightboxes.md` E5) |
| Keyboard | `Ctrl/Cmd +` / `-` zoom, `Esc` close; bare keys are `lightboxes.md` P4. `Tab` cycles the four controls only; the body is not focusable |

```html
<div class="mermaid-lightbox-overlay" role="dialog" aria-modal="true"
     aria-label="Diagram: Mermaid" hidden>
  <div class="mermaid-lightbox-body"></div>
  <div class="mermaid-lightbox-controls">
    <button class="mlb-btn" aria-label="Zoom out">−</button>
    <span class="mlb-zoom-pct" aria-live="polite">100%</span>
    <button class="mlb-btn" aria-label="Zoom in">+</button>
    <button class="mlb-btn" aria-label="Fit to page">⤢</button>
    <button class="mlb-btn mlb-close-btn" aria-label="Close">×</button>
  </div>
</div>
```

**Do not** introduce a fifth copy of the markup. When one lightbox is next edited, the four
become one `<template>` rendered by `NB.lightbox.open(bodyEl, label)`; the CSS needs no
change.

### 2.14 Banner, inline error, toast, status line

Four feedback shapes, told apart by position and persistence.

| Shape | Where | Persists | Markup and role |
|---|---|---|---|
| **Banner** | Inside a pane, full width, above or below the content it is about | Until dismissed or resolved | `role="status"` for information, `role="alert"` for a failure. `--surface-raised`, `1px --border`, `--radius-md`, `var(--space-2) var(--space-3)`, gap `--space-2`. One line of text plus up to two actions |
| **Inline error** | Directly under the field or row it belongs to | Until the cause is cleared | `role="alert"`, `--text-sm`, reserved height so the layout does not jump (`min-height: calc(var(--text-sm) * var(--lh-normal))`, `.auth-error` `:2315`). On a plain surface the text is `--danger`; on a `--danger-soft` block it is `--text-primary` with a danger border or icon, because `--danger` on `--danger-soft` measures ≈3.7:1. The field gets `aria-invalid` + `aria-describedby` |
| **Toast** | Floating, `bottom/right: var(--space-5)` desktop; full width above the rail on phone | 2.4 s, one at a time | `role="status" aria-live="polite"`, `--surface-raised`, `--shadow-toast`, `--z-toast`, `--radius-sm` (desktop) / `--m-radius` 10 (phone), padding `var(--space-2) var(--space-3)`, `--text-ui`. Never takes focus, never blocks a pointer |
| **Status line** | Inside a footer, header, or row | While the state holds | `role="status"` or plain text. `--text-sm`, dot 8 px + word, colour from `--danger`, `--ok` or `--warn`. Colour is never the only signal |

The banner action is a button, `md` (30 px) in a bar (`#draft-bar`) and `sm` in a dialog body.
The toast never carries a destructive action: the user cannot undo what a disappearing strip
did.

```html
<div id="draft-bar" role="status" aria-live="polite">
  <span class="draft-bar-msg">Unsaved changes in notes.md</span>
  <button type="button" class="draft-bar-btn primary">Recover</button>
  <button type="button" class="draft-bar-btn">Discard</button>
</div>
<div class="toast" role="status" aria-live="polite">Saved</div>
```

**Applies to.** `#draft-bar` (`:7791`), `.designer-alert` (`:6413`), `.ai-error` (`:5231`),
`.search-panel-summary.error` (`:4246`), `.auth-error` (`:2315`), `.settings-auth-error`,
`.settings-vimrc-status` (`:1520`), `.settings-watch-status` (`:2090`), `.stg-status`
(`:1694`), `.toast` (`:3787`), `#mobile-drawer-status` (`mobile-shell.md` §4.3),
`#<prefix>-status` in every edit footer (`edit-window-guide.md` §3.3).

### 2.15 Empty, loading, error, read-only block

Four content states, one geometry: centred in the region, maximum measure
`calc(60 * var(--space-2))`, vertical padding `--space-6`.

| State | Content | Rules |
|---|---|---|
| **Empty** | One line of `--text-ui` `--text-muted`, optionally one primary action | No illustration glyph except an optional 16-grid icon at `--icon-lg` in `--text-muted`. Copy names the next action: "No notes yet." + New note |
| **Loading** | One line "Loading…" + an inline spinner, or a skeleton that matches the coming layout | `aria-busy="true"` on the region. No spinner for a wait under 300 ms. The spinner keeps moving under reduced motion at 1.6× duration (foundations §7.3) |
| **Error** | `--danger` text naming what failed, plus one **Retry** button (`sm`) | Keep the input, the query and any existing results on screen (`mobile-shell.md` §4.5). `role="alert"` |
| **Read-only** | `--surface-well` face, `1px --border`, `--radius-md`, no profile-editing control, a `Read-only` badge in the header | The badge is text, the block is plain `<div>`/`<span>` plus at most a `Make default` button that only sets the default name. Shipped model: the ACP panel (`style.css:1750`, `settings-modal.md` §5.5) |

```html
<div class="tree-empty">No notes yet.</div>
<div class="search-panel-state" role="alert">
  <p>Search failed: could not reach the server.</p>
  <button class="search-panel-retry">Retry</button>
</div>
<div class="settings-ai-acp-row">
  <span class="stg-tag">Read-only</span>…<span class="settings-mono">opencode</span>
</div>
```

**Applies to.** `.tree-empty` (`:2841`), `.search-panel-empty` (`:4280`),
`.search-panel-state` (`:4286`), `.search-panel-summary.error` (`:4246`), `.nb-tv-empty`
(`:1032`), `#welcome` (`:2568`), `#mobile-state` (`mobile-shell.md` §4.10),
`.designer-empty` (`:6459`), `.graph-view-state` (`:4837`), `.ai-config-hint` (`:5033`),
`.settings-ai-acp-row` (`:1750`).

### 2.16 Tree row and list row

Two row types. They share geometry and differ in behaviour: a tree row expands and
collapses; a list row selects and opens.

| Property | Tree row | List row |
|---|---|---|
| Height | shipped ≈22 desktop (frozen; see below); `--control-h-touch` (44) phone | `--control-h-md` (30) desktop; `--control-h-touch` (44) phone |
| Padding | `var(--space-1) var(--space-2)` | `var(--space-1) var(--space-2)`, inset `--space-3` on the left so the 14 px marker has room (`:8338` uses 10 px today) |
| Radius | `--radius-xs` desktop, `--radius-md` phone (`mobile-shell.md` §4.4) | `--radius-sm` |
| Gap | `--space-1`; the tree guide column is 18 px per level | `--space-2` |
| Hover | `--accent-soft` (shipped, frozen) | `--surface-raised` — the Sessions view already does this (`:8354`) |
| Selected | shipped: `--accent-soft` + `--accent` text + 600; multi adds the 2 px bar (`:2781`, `:2784`) | `--accent-soft` + `--text-primary` + 600 + `inset var(--stroke-2) 0 0 var(--accent)` |
| Focus | inset ring, `outline-offset: var(--focus-offset-inset)` | inset ring |
| Row action | `.tree-more` 44 × 44 on phone only (`:7321`), `aria-expanded` while open | `.session-more` 24 × 24, always visible (`:8414`) |

**The Explorer tree's visuals are frozen.** Keep the app as it is today: the CSS-drawn
continuous guide strokes, 18 px cells, `3px 6px` rows, accent wash. Only its semantics change:
roles, `tabindex`, `aria-expanded`, real buttons for star and pin. The shipped accent text on
`--accent-soft` measures 4.39:1 in the dark theme; that is a known accepted exception, carried
by `aria-selected` for assistive tech. New row work uses the list-row rules below.

**The tree is the one structural change in this document.** It is a `div` with no `role`, no
`tabindex`, and no `aria-expanded` (`static/js/sidebar.js:137-140`). The file list works from
the keyboard through the vimnav window model (`static/js/vimnav.js:289-297`,
`sidebar.js:889-906`), but it is not Tab-reachable and a screen reader cannot see it.
Foundations §10.3 and AC9 require:

| Requirement | Implementation |
|---|---|
| Container | `#file-tree` → `role="tree"`, `aria-label="Files"`, `aria-multiselectable="true"` |
| Row | `role="treeitem"`, `aria-level`, `aria-expanded` on folders, `aria-selected` on the active leaf, `tabindex="0"` on exactly one row, `-1` on the rest |
| Keys | `ArrowDown`/`ArrowUp` next/previous visible row; `ArrowRight` expand a folder then enter it; `ArrowLeft` collapse then go to the parent; `Home`/`End`; `Enter` open a leaf; `Space` toggle a folder. Vimnav stays the single owner of arrow keys in the sidebar window (§3.3 step 4); the row handler must not install a second cursor. `*`, type-ahead and drag are out of scope (§8) |
| Focus | the row itself is focusable; the ring is inset so the scroller does not clip it |
| The row action | stays a sibling `<button>`, which is why the row cannot be a `<button>` — the same reason as `sessions.md` D4 |

```html
<div id="file-tree" role="tree" aria-label="Files" aria-multiselectable="true">
  <div class="tree-row" role="treeitem" aria-level="1" aria-expanded="true" tabindex="-1">
    <span class="tree-icon" aria-hidden="true">…</span><span class="tree-name">projects</span>
    <button class="tree-more" type="button" aria-label="projects actions"
            aria-haspopup="menu" aria-expanded="false">⋯</button>
  </div>
  <div class="tree-row" role="treeitem" aria-level="2" aria-selected="true" tabindex="0">…</div>
</div>
```

A **list row** is a native `<button>` with a sibling action button where one is needed
(`sessions.md` D4). It carries `aria-current` with the value the surface already uses —
Sessions ships `"true"` deliberately, not `"page"` (`sessions.md:781`) — and `aria-pressed`
when it toggles. Two views are exceptions, both a filtered list with an arrow-key cursor:
`.search-panel-hit` is a `role="option"` inside a `role="listbox"`
(`static/js/activity.js:631`, `:997-1001`, asserted by `tests/dom/test_dom.js:2863-2877`),
and `.recent-row` is the same shape for `#recent-view`. Both keep their listbox roles and take
only the geometry and focus rules from this section. Their cursor row is a transient keyboard
location, not a selection: `--accent-soft` face and `--text-primary`, without the weight or the
inset bar.

**Applies to.** `.tree-row` (`:2771`), `.tree-star` / `.tree-pin` (`:2999`, `:3018`),
`.bookmark-row` (`:2971`), `.recent-row` (`:3831`), `.session-row` (`:8332`),
`.search-panel-hit` (`:4299`, a `<button>` at `static/js/activity.js:997`),
`.outline-item a` (`:3107`).

---

## 3. Consolidation decision

### 3.1 Decision

**Tokens, plus one additive zero-specificity base rule. No new `.nb-btn` class, no
renames.**

Concretely:

1. Every family keeps its class. Its rule swaps literals for tokens (`height`, `padding`,
   `border-radius`, `border-color`, colours) on its next edit. Foundations §11.2 rule 2.
2. The families gain a focus ring from **one base rule and one row twin**:
   `:where(.icon-btn, .collapse-btn, .activity-btn, #topbar button, #edit-bar .eb, .tab,
   .ai-btn, .draft-bar-btn, .ai-model-select):focus-visible
   { outline: var(--focus-ring); outline-offset: var(--focus-offset); }`
   `:where(.tree-row, .bookmark-row, .recent-row, .search-panel-hit, .pin-row, .pin-child, .tree-more):focus-visible
   { outline: var(--focus-ring); outline-offset: var(--focus-offset-inset); }`
   `:where()` has zero specificity, so every family's own rule still wins and deleting the
   lines reverts nothing else. No space before `:focus-visible`: it is the element itself
   that receives focus, not a descendant. A view may add a genuinely new control class to
   the base list; it may not fork the ring. This closes AC2 in one place instead of thirteen.
3. Nothing else is shared. The differences between families are real: 44 px in a modal
   edit bar, 30 px in the topbar, 24 px inside a table cell.

### 3.2 Why not a shared class with variants

| Approach | Cost | Benefit | Verdict |
|---|---|---|---|
| `.nb-btn` + `--primary/--ghost/--danger` + `--sm/--md` | 14 button families × every call site; the markup is generated by `tabs.js`, `sidebar.js`, `ai.js`, `settings.js`, `sessions.js`, `workspaces.js`, `activity.js`, `table-editor.js`, `list-edit.js`, `designer-shell.js`, plus `templates/index.html` and `_edit_window.html`; 14 DOM tests select the current class names | One source of truth | **Rejected.** The migration touches every module and every test to reproduce a size matrix the tokens already express. `docs/archive/design/settings-modal.md` §2 records the last time a global class rewrite was attempted: it would have stripped the Designer's Apply button. |
| Duplicate the variant CSS per family | Cheap now | Nothing | **Rejected.** That is the current state (D2, D4, D5). |
| **Tokens + one `:where()` base rule** | One CSS rule plus the JS and markup steps listed in §3.3; the rule itself has no markup or test cost | One focus ring, one height per role, reversible | **Chosen.** |

No speculative abstraction: the grouped rule lists only families that exist and only the
declarations that are identical across them.

### 3.3 Migration order

Each step is one commit, is shippable alone, and is testable by the criterion it names. The
order is worst-first, so a stopped migration leaves the app better than it was. Steps 1–3
are the must-ship set; the rest are the component pass and may land per surface.

| # | Step | Files | Closes | Test |
|---|---|---|---|---|
| 1 | Land the foundation token block and the six component tokens with zero call-site changes. Define `--bg-hover` (used at `:7829`, declared nowhere) or change that rule to `--surface-elev`; the runtime allowlist gains `--dw-slice-cell-w` | `static/css/style.css` (token blocks only) | — | foundations §11.3 `comm` check with the runtime allowlist prints nothing |
| 2 | The eight `#fff`-on-accent rules: five action fills take `--text-on-accent`, three toggle fills become `--accent-soft` states. Replace the five `filter: brightness()` hovers and the one `opacity: .88` hover with the 3 px `--accent-soft` halo | `style.css:203`, `:204`, `:604`, `:1174`, `:1561`, `:2313`, `:2310`, `:2655`, `:2662`, `:2687`, `:4941`, `:5421`, `:5424`, `:6550` | D1 | AC1, AC25 |
| 3 | Add the `:where()` focus rule, plus a menu-item inset ring for `#nb-menu` and `.nb-tv-item` | `style.css` (appended rules) | D3 | AC2 |
| 4 | Tree: `role="tree"`, roving tabindex, `aria-expanded`. Vimnav remains the only arrow-key owner and moves DOM focus to the active row; no second key handler | `static/js/sidebar.js`, `static/js/vimnav.js`, `style.css:2771` | foundations AC9 | AC3 |
| 5 | Tabs: `role="tablist"` on `#tab-pinned` and `#tab-list` separately, `role="tab"`, `aria-selected`, roving tabindex; every `.tab-close` is `tabindex="-1"` and `Delete` closes the tab | `static/js/tabs.js:644-707`, `style.css:1177` | D3 | AC4 |
| 6 | Heights and radii: the families in §1.3 that carry `alias` or `merge` | `style.css`, one family per chunk | D2 | AC5 |
| 7 | Menus: `.context-menu`, `.eb-menu`, `.nb-tv-pop`, `.nb-tv-item` adopt the §2.9 box and item numbers | `style.css:3037`, `:618`, `:987`, `:1000` | D4 | AC6, AC14 |
| 8 | Disabled: `--opacity-disabled` only, scoped to control rules | `style.css` | D5 | AC7 |
| 9 | Dialog, sheet and lightbox frames: the numbers in §2.11–§2.13 | `style.css`, `templates/index.html` (labels only) | D3, D4 | AC8 |
| 10 | Lightbox markup: four copies → one `<template>`. Keep `NB.lightbox.create(cfg)` (`static/js/lightbox.js:47`); update its four callers in `mermaid.js`, `wavedrom.js`, `viz.js`, `svg.js` | `templates/index.html:1792-1845`, `static/js/lightbox.js`, the four callers | D4 | AC9 |
| 11 | Structural ARIA: markdown `#edit-bar` gets `role="toolbar"`; menu items get `role="menuitem"`; radio groups become `<fieldset>` + `<legend>` | `templates/index.html:295`, `static/js/menu.js`, `templates/index.html:816` | — | AC10 |
| 12 | Inputs: `--border-strong` on the fields of each touched component, the focus ring, and the search clear button | `style.css` | — | AC11, AC12, AC13 |
| 13 | Phone: 44 px targets, 16 px fields, drawer and sheet controls | `style.css` | — | AC19, AC20 |
| 14 | Feedback: toast role, read-only ring, inline error, error recovery | `static/js/app.js`, `style.css` | — | AC15, AC16, AC17, AC18 |
| 15 | Lightbox controls take the `--overlay-control-*` set | `style.css:3693-3712` | — | AC21, AC22 |
| 16 | Audit: no new hex outside the token blocks; mockup refreshed | `style.css`, this document's mockup | — | AC23, AC24 |

Steps 2 and 3 are the only ones a reviewer should insist on before anything else ships;
they fix a contrast failure and a keyboard gap. Step 11 changes markup and must be tested
against the DOM suite; steps 4, 5 and 10 change JS.

### 3.4 What stays a one-off

| Thing | Why it stays |
|---|---|
| `.expand-btn` | It is the whole collapsed gutter, not a button in a row. Its box is set by the pane. |
| `.dw-cell` and the designer canvas hits | Canvas cells painted on an SVG. They are drawing surface, not chrome (`foundations.md` §3.1 exempts canvas surfaces). |
| `.markdown-body li > input[type=checkbox]` | Task-list boxes are note content. They follow prose, not chrome. |
| `.tab` top-only radius | A tab is a tab: it joins the page below it. |
| The Sessions hover | Neutral `--surface-raised` is a shipped decision with a recorded reason (`sessions.md` §0.1). The tree, bookmarks and recent rows adopt it on their next edit; until then the difference is recorded, not hidden. |
| The markdown edit bar's wrap | The only bar with room for two rows. Changing it to scroll would hide controls that are visible today. |

---

## 4. State matrix

Rows are components; columns are states. A cell gives the visual delta and the token that
produces it. `—` means the state does not exist for that component. "inherit" means the
component has no delta of its own and takes its container's.

`ring` = `var(--focus-ring)` at `var(--focus-offset)`; `ring-in` = the same at
`var(--focus-offset-inset)`; `wash` = `var(--accent-soft)`; `raised` = `var(--surface-raised)`;
`well` = `var(--surface-well)`; `danger` = `var(--danger)`.

| Component | Rest | Hover | Pressed | On / Selected | Focus-visible | Disabled | Busy | Invalid |
|---|---|---|---|---|---|---|---|---|
| Button, secondary | `raised` face, `--border-strong` | `wash` face, `--accent` border | halo off, `translateY(1px)` | — | ring | `--opacity-disabled`, no hover | label + "…", `aria-busy` | — |
| Button, primary | `--accent` face, `--text-on-accent` | 3 px `wash` halo, face unchanged | halo off, `translateY(1px)` | — | ring | `--opacity-disabled` | label + "…", `cursor: progress` | — |
| Button, ghost | transparent, `--text-muted` | `wash` face, `--text-primary` | `wash` face | — | ring | `--opacity-disabled` | — | — |
| Button, danger | transparent, `danger` text | face unchanged + inset 1 px `danger` ring | `translateY(1px)` | — | ring | `--opacity-disabled` | — | — |
| Button, link | transparent, `--accent` | underline, `--accent` | — | — | ring | `--opacity-disabled` | — | — |
| Icon button | transparent, `--text-muted` | `wash` face, `--text-primary` | `wash` face | `wash` face + `--accent` glyph + `aria-pressed` | ring (ring-in inside a scroller) | `--opacity-disabled`, no hover | glyph → spinner, `aria-busy` | — |
| Toolbar | transparent on `--surface-panel` | inherit item | inherit item | inherit item | ring at +1 px in the 26 px markdown bar and the 57 px modal bar (shipped; `edit-window.md` §7.6) | item-level | item-level | — |
| Text input | `well` face, `--border-strong` | `--accent` border | — | — | `--accent` border + 3 px `wash` halo, no outline | `--opacity-disabled` | — | `danger` border + `--danger-soft` halo + `aria-invalid` |
| Search input | as text input, `padding-inline-end: --control-h-body` | `--accent` border | — | — | border + halo | `--opacity-disabled` | — | — |
| Textarea (card) | borderless inside a framed row | inherit the row | — | — | the row gets `--accent` border + `wash` halo on `:focus-within` | `--opacity-disabled` | — | danger border on the row |
| Select | `well` face, `--border-strong` | `--accent` border | — | — | ring, offset 2 (native popup is out of page) | `--opacity-disabled` | — | `danger` border |
| Switch | track `--border-strong`, knob `--switch-knob` | — (an off track must never look on) | — | checked: track `--accent`, knob `translateX(16px)` | ring, offset 2 | `--opacity-disabled` | — | — |
| Checkbox | 16 px box, `accent-color: --accent` | — | — | checked: accent fill + check | ring, offset 2 | `--opacity-disabled` | — | — |
| Radio chip | `raised` face, `--border-strong`, `--text-muted` | `--accent` border, `--text-primary` | — | `wash` face, `--accent` border + text, 600 | ring, `--focus-offset-inset` | `--opacity-disabled` | — | — |
| Segmented | `well` face, `--border-strong`, dividers `--border` | item `wash` | item `wash` | item `wash` + `--accent` text | ring-in (the container clips) | `--opacity-disabled` | — | — |
| Tab | `raised` face, `--border`, `--text-muted` | `wash` face | — | `--surface-page` face, `--accent` border, `--text-primary` | ring-in | `--opacity-disabled` | dirty dot 8 px `--accent` | conflict glyph `--warn` |
| Chip | `--border-strong`, `--text-muted` | `--accent` border | — | `wash` face + `--accent` | ring | `--opacity-disabled` | `--opacity-disabled` on a reading chip | `danger` border + text |
| Badge | border + text in the state colour, no fill | — | — | — | — | — | — | — |
| Menu item | transparent, `--text-primary` | `wash` face | `wash` face | `--accent` text, 600, 14 px check column | ring-in | `--text-muted`, `--opacity-disabled`, no hover | — | — |
| Divider / separator | `1px --border` | — | — | — | — | — | — | — |
| Dialog | scrim `--overlay-scrim`; box `--surface-panel`, `--shadow-modal` | — | — | — | ring on the focused control inside | — | `aria-busy` on the body | `role="alert"` line inside |
| Sheet | as dialog, `--shadow-sheet`, `--radius-xl` top | — | — | — | ring | — | `aria-busy` on the sheet | inline line above the footer |
| Lightbox control | `--overlay-control-fg` on `--overlay-control-pill`, 1 px `--overlay-control-border` | `--overlay-control-face` | `--overlay-control-face` | — | 2 px `--overlay-control-ring`, offset 2 | — | — | — |
| Toast | `raised` face, `--shadow-toast` | — | — | — | never focused | — | — | `--warn` border and text on the warn variant |
| Banner | `raised` face, `--border` | — | — | — | its action takes the ring | — | — | danger text |
| Status line | dot 8 px + word, `--text-sm` | — | — | — | — | — | — | `danger` text + dot |
| Tree row | transparent | `wash` face (shipped) | `wash` face | `wash` face + `--accent` text + 600; multi adds `inset 2px --accent` | ring-in | `--opacity-disabled` | — | — |
| List row | transparent | `raised` face | `wash` face | `wash` face + `--text-primary` + 600 + `inset 2px --accent` on the anchor | ring-in | `--opacity-disabled` | — | — |

Two cells deserve a note because they are the ones a reviewer will question:

- **Primary hover is a halo.** A filled button has no face colour to shift without a second
  accent value, and `filter: brightness()` is forbidden (foundations §11.4).
- **Danger is never filled.** White on `--danger` (`#ff6b6b`) is 2.78:1 and there is no
  `--text-on-danger` token. A red fill would need a new colour pair for no gain.

---

## 5. Responsive and touch

The mode switch is `@media (max-width: 860px), ((pointer: coarse) and (max-width: 1023px))`
(`style.css:6975`) and is the only one (foundations §8.2 rule 1). Everything below happens
inside it. `docs/archive/design/mobile-shell.md` owns the shell; this table only says what each
control does inside it.

| Component | Desktop | Phone | Source |
|---|---|---|---|
| Button | 30 (`sm` 24, `lg` 36) | 44 minimum; a primary action is often full width | `mobile-shell.md` §4.8, §4.9 |
| Icon button | 24 / 30 / 32 / 36 by role | 44; rail glyphs 22 px | §4.1, §4.2 |
| Text field | 36, `--text-ui` | **44 high, 16 px fixed type** — below 16 px iOS zooms the viewport on focus | §5.1, foundations §4.4 |
| Textarea | as desktop | 16 px, min 96 px, padding 12 | §4.8 |
| Select | 36 | 44, 16 px | §5.1 |
| Switch | 36 × 20 | unchanged box, 44 px hit via the label | — |
| Checkbox / radio chip | 24 / 30 | 44 hit; the chip stays 30 px tall inside it | — |
| Segmented | 30 | 44 | §4.9 (theme and text size) |
| Tab (Settings nav) | 180 px column, 30 px rows | horizontal scrolling strip above the sections | `settings-modal.md` §6 |
| Tab strip | 34 px bar | **hidden** (`#tab-bar { display: none }`, `:7085`); the DOM stays | §3.4 |
| Toolbar | edit-window bar 44/32; markdown bar 30, wraps | markdown bar 44, scrolls, Save/Done sticky at the left | §4.12 |
| Menu | 32 px item, 170–300 px box | 48 px item, 15 px, edge gap 10 | §4.11 |
| Tooltip | `title` | `title` still applies; no control may depend on it | §4.11 |
| Dialog | centred, 420 / 75vw / 1320 | short form stays a centred dialog at `min(420px, 92vw)`; a list or a preference pane becomes a sheet | §4.9 |
| Sheet | — | `min(72dvh, 560px)`, `--radius-xl` top, grabber, 52 px header | §4.8 |
| Lightbox | full screen, controls pill top-right | full screen; it opens, but there is no pan/pinch and the controls are ≈28 px. `lightboxes.md` §7 records it; P2/P3 propose the phone fixes | `lightboxes.md` §7 |
| Banner | in-pane strip | in-pane strip above the rail | — |
| Inline error | under the field | under the field, 16 px type | — |
| Toast | bottom-right, 20 px inset | full width, 16 px insets, above the rail + inset, min-height 44 | §4.11 |
| Status line | footer or header | drawer footer, 44 px | §4.3 |
| Tree row | 24 px | 44 px, radius 8, `…` always visible | §4.4 |
| List row | 30 px | 44 px | §4.4, §4.6 |

**Touch rules, per component:**

1. Every control's hit area is at least `--control-h-touch` (44). A control whose visual box
   is smaller grows its hit with padding or a negative-margin pseudo-element, never by
   growing the box.
2. No control depends on hover. The table-view toolbar is hidden under
   `(hover: none) and (pointer: coarse)` (`:7776`); the tree star and pin are hidden by the
   phone query (`:7318-7320`) and must be reachable another way (AC24).
3. `:active` paints `--accent-soft` on rows and buttons (`mobile-shell.md` §6).
4. `-webkit-tap-highlight-color: transparent` on chrome.
5. A sheet, not a dialog, for a content pane. A dialog for a short form.
6. Fields are 16 px. This is a fixed value, not a rem (`foundations.md` §4.4).

---

## 6. Accessibility

### 6.1 Focus order

1. DOM order. No positive `tabindex` anywhere.
2. The shell order is: topbar → activity rail → side panel header and its view → tab bar →
   edit bar (when open) → reader → outline. That is the DOM order today; do not reorder it
   with `tabindex`.
3. A dialog traps `Tab` inside itself (`NB.dialog`), returns focus to the opener, and makes
   every other body child inert.
4. A menu moves focus into itself on open, closes on `Tab`, and returns focus on `Esc`.
5. An off-canvas drawer is `visibility: hidden` when closed, so it is skipped (`:7222`).
6. The tree's roving tabindex means one `Tab` stop for the whole tree, then the arrow keys.
7. The file tab strip has one `Tab` stop per visible region (`#tab-pinned`, `#tab-list`), then
   the arrow keys; a tab's close button is `tabindex="-1"` and `Delete` closes the active
   tab. See §2.8.

### 6.2 ARIA per component

| Component | Role / attributes |
|---|---|
| Button | native `<button type>`, `aria-pressed` on a toggle, `aria-haspopup` + `aria-expanded` on a layer trigger |
| Icon button | native button; glyph `aria-hidden`; `aria-label` + `title`; `aria-keyshortcuts` where a chord exists |
| Toolbar | `role="toolbar"` + `aria-label`; `role="group"` + `aria-label` per group; separators `aria-hidden` |
| Text input | `<label for>` or `aria-label`; `aria-describedby` → hint + error; `aria-invalid` on error; `autocomplete` set |
| Select | `aria-label` or a `<label>`; option groups only when they carry meaning |
| Checkbox / switch | native input; `<label for>`; no `role="switch"` — the native checkbox semantics are what the shipped contract keeps |
| Radio chip | native radios in a `<fieldset>` with a `<legend>`; the visual chip is a `<label>` |
| Segmented | `aria-pressed` for a mode group (`role="group"`), or `role="tablist"` when the items swap a panel |
| Tablist | `role="tablist"` + `aria-orientation`; `role="tab"` + `aria-selected` + `aria-controls`; panel `role="tabpanel"` + `aria-labelledby`; roving tabindex |
| Chip | a removable chip's `×` is a button with `aria-label="Remove {name}"`; a count badge is `aria-hidden` when the row's name already carries the count |
| Menu | `role="menu"`; items `role="menuitem"` (or `menuitemradio` for a mode list); the current row `aria-current`; `aria-disabled` on an unavailable row; `<hr role="separator">` |
| Dialog | `role="dialog" aria-modal="true"` + `aria-labelledby` + `aria-describedby` on the body's first line |
| Sheet | `role="dialog" aria-modal="true"`; the scrim `role="presentation"` |
| Lightbox | `role="dialog" aria-modal="true"` + `aria-label="Diagram: {type}"`; the zoom percentage `aria-live="polite"` |
| Toast | `role="status" aria-live="polite"`; never `alert` for a success |
| Inline error | `role="alert"`; the field points at it with `aria-describedby` |
| Status line | `role="status"`; the dot is `aria-hidden`, the word carries the state |
| Tree row | `role="tree"` / `role="treeitem"`; `aria-level`, `aria-expanded`, `aria-selected`, `aria-multiselectable` |
| List row | native button + `aria-current` or `aria-pressed` |

### 6.3 Target sizes and contrast

| Check | Rule | Where it fails today |
|---|---|---|
| Text on an accent fill | 4.5:1 → use `--text-on-accent` (6.99 dark / 5.72 light) | Eight rules use `#fff` (2.61 dark). §1.1 D1 |
| Control boundary | 3:1 → `--border-strong` | The switch track uses `--border` (1.27 light) `:1595` |
| Icon | 3:1 against its face | `.session-more` at `--text-muted` on `--accent-soft` is 3.46:1 — the shipped comment already raises it to `--text-primary` on the active row (`:8432`) |
| Target | 24 fine / 44 coarse | `.collapse-btn` ≈20, `.tab-close` 16, `.tree-row` ≈22, `.search-panel-clear` 22, `.session-more` 24, `.nb-tv-btn` ≈20 |
| Focus | visible on every chrome control | The 13 families in §3.3 step 3 |

The accent ring measures 6.00 dark / 5.34 light on `--surface-panel`, so it clears 3:1 on
every surface it is drawn on (foundations §3.3).

### 6.4 Reduced motion

Every transition added or touched by this document has a
`@media (prefers-reduced-motion: reduce)` twin. State is instant and complete.

| Component | Motion | Reduced |
|---|---|---|
| Button, icon button, row | `--dur-1` background and colour | none |
| Switch | `--dur-1` track and knob | none (shipped `:1612`) |
| Tab | width re-equalise `--dur-2`, close ghost `--dur-0` | none (shipped `:1259`, `:1305`) |
| Menu | none | — |
| Dialog | `--dur-2` scrim opacity | none |
| Sheet | `--dur-3` transform | none (shipped `:7769`) |
| Drawer | `--dur-3` transform | none (shipped `:7765`) |
| Spinner | continuous; 1.6× duration under reduced motion | never stopped — a stopped spinner reads as a hung request (`:6456`) |
| Chevron, caret | `--dur-1` rotate | none (shipped `:7982`) |

`style.css:4999` sets `animation: none` on `.graph-view-btn.is-spinning` under reduced
motion. That contradicts foundations §7.3 and becomes `animation-duration: 1.6 ×`.

### 6.5 Gaps from foundations §10.3, and what closes each

| Gap in §10.3 | Closed by | AC |
|---|---|---|
| `.icon-btn` — no ring | step 3 base rule | AC2 |
| `#topbar button` — no ring | step 3 | AC2 |
| `.collapse-btn` — no ring | step 3 | AC2 |
| `.activity-btn` — no ring | step 3 | AC2 |
| `.tab` and `.tab-close` — no ring | steps 3 and 5 | AC2, AC4 |
| `.tree-row` — a `div`, no role, no key handler | step 4 | AC3 |
| `.eb` — no ring | step 3 (`.eb` is added to the base list) | AC2 |
| Not in §10.3: `.tab` is a `div` with no ARIA | step 5 | AC4 |
| Not in §10.3: `.ai-model-select` has no `:focus` rule at all (`:5048`) | step 6 | AC5 |

---

## 7. Acceptance criteria

Each names a file and an observable result. `style.css` is `static/css/style.css`.

| # | Criterion | File | Observable |
|---|---|---|---|
| **AC1** | No chrome rule paints `#fff` on `--accent` | `style.css` | `grep -nE 'background: var\(--accent\)' style.css` cross-checked against `color:` finds only `--text-on-accent`; the eight cited lines are gone; white on accent remains only in `.mlb-btn` and rendered-Markdown content |
| **AC2** | Every chrome control shows a 2 px accent ring on `:focus-visible` | `style.css` | Tabbing the shell at 1280 and at 390 never lands on an unstyled control. The §10.3 list plus `.ai-model-select` and `.mlb-btn` are covered |
| **AC3** | The tree is keyboard reachable and operable | `static/js/sidebar.js`, `style.css` | `#file-tree` has `role="tree"`; exactly one row has `tabindex="0"`; `ArrowDown` moves focus; `Enter` opens a leaf; `aria-expanded` flips on a folder |
| **AC4** | The tab strip is two valid tablists | `static/js/tabs.js`, `style.css` | `#tab-pinned` and `#tab-list` each have `role="tablist"`; in each region that contains a tab, the active tab has `aria-selected="true"` and `tabindex="0"` (a region with no active tab keeps `false`); `ArrowRight` moves selection within a region; every close button has `aria-label="Close {name}"` and `tabindex="-1"` |
| **AC5** | Every control's height and radius come from a token | `style.css` | In the families marked `alias` or `merge` in §1.3, `height` and `border-radius` read `var(--control-h-*)` and `var(--radius-*)`; no literal `18px`/`22px`/`26px`/`28px`/`32px`/`34px` remains on a control face |
| **AC6** | `.eb-menu` and `.nb-tv-pop` match the §2.9 menu | `style.css` | Both render `--surface-raised`, `--radius-md`, `--shadow-pop`, a `--control-h-body` item, and `--z-popover` |
| **AC7** | One disabled opacity | `static/css/style.css` | In button, input and menu control rules, `opacity` reads `var(--opacity-disabled)`; the drag ghosts and graph decoration are excluded by selector scope |
| **AC8** | Dialog, sheet and lightbox frames share one set of numbers | `style.css` | Every `.settings-modal`, sheet and lightbox uses `--radius-lg`/`--radius-xl`, the matching `--shadow-*`, and the matching `--z-*`; no literal `12px`, `16px` or `0 20px 60px` remains in those rules |
| **AC9** | One lightbox markup, four instances | `templates/index.html` | The four `#*-lightbox` blocks become one `<template>`; each overlay still carries `role="dialog"`, `aria-modal`, an `aria-label`, and four `.mlb-btn` controls |
| **AC10** | Toolbars, menus and radio groups expose the right roles | `templates/index.html`, `static/js/menu.js` | `#edit-bar` is `role="toolbar"`; each menu row is `role="menuitem"` (or `menuitemradio`); each radio group is a `<fieldset>` with a `<legend>` |
| **AC11** | Input boundaries measure ≥3:1 | `style.css` | Every field and the switch track use `--border-strong`; no field border is `--border` |
| **AC12** | Field focus is one idiom | `style.css` | Every field shows an accent border + a 3 px `--accent-soft` halo; no field relies on `outline` alone and none has `outline: none` without a stated replacement |
| **AC13** | Search clear is a 24 px named control | `style.css`, `static/js/activity.js` | `.search-panel-clear` is `--control-h-sm` square, `aria-label="Clear search"`, and the field reserves its slot |
| **AC14** | Menus share one appearance | `style.css` | The five instances (§1.1 D4) render the same box, item height, hover, separator, disabled and danger treatment; only width and placement differ |
| **AC15** | Toasts stay announced and unfocused | `static/js/app.js`, `style.css` | Every `.toast` created after this change keeps `role="status" aria-live="polite"`; opening one does not move `document.activeElement` |
| **AC16** | The read-only block has no profile-editing control | `static/js/settings.js`, `style.css` | Tabbing through Settings → AI never lands on a profile field; the only control inside `.settings-ai-acp-row` is `Make default`, which writes the default name only. The block shows a `Read-only` badge |
| **AC17** | Empty, loading and error states keep the input | `static/js/activity.js` | A failed search leaves the query in the field and the previous results on screen, with one `Retry` |
| **AC18** | Every transition has a reduced-motion twin | `style.css` | With reduce emulated, no control animates; the spinner still moves at 1.6× |
| **AC19** | Phone targets are 44 px | `style.css` | At 390 px, every button, row, field and menu item measures ≥44 in its hit box |
| **AC20** | Phone fields are 16 px | `style.css` | Every `input`, `textarea` and `select` under the phone query is `16px` |
| **AC21** | The lightbox controls are readable over any image | `style.css` | `--overlay-control-fg` on `--overlay-control-pill` measures ≥4.5:1 against white, mid-grey and black; the focus ring uses `--overlay-control-ring` and is visible on the same three backgrounds |
| **AC22** | No new colour literal outside the token blocks | `style.css` | The diff adds hex only inside the token blocks: `--switch-knob` in both theme blocks, `--overlay-control-fg` and `-pill` in both theme blocks, `--overlay-control-face`, `-border` and `-ring` in the primitives block; no component rule gains a hex |
| **AC23** | The mockup is self-contained | `controls-mockup.html` | Opening it offline shows both themes, every state, and the phone board with zero network requests |
| **AC24** | No control depends on hover | `static/js/sidebar.js`, `style.css` | Under `(hover: none) and (pointer: coarse)` every row action is visible; the tree's `…` is 44 px and always shown |
| **AC25** | Primary hover is a halo, not a filter | `style.css` | The five `filter: brightness()` rules and the one `opacity: .88` rule are gone; hovering a primary button paints `0 0 0 3px var(--accent-soft)` and leaves its face unchanged |

---

## 8. What not to build

| Rejected | Reason |
|---|---|
| A custom tooltip | Needs a z-band above `--z-popover`, a hover timer, a touch path, and a migration of ~40 `title` attributes. The native one is announced as the description. §2.10 |
| `.nb-btn` with size and colour utilities | Touches every module and every DOM test to reproduce a matrix the tokens already express. §3.2 |
| A filled danger button | White on `--danger` is 2.78:1 and there is no `--text-on-danger` pair. Destructive actions stay ghost with a danger border. |
| A second accent, a gradient, or a glass panel on a control | Foundations §11.4. The lightbox blur stays because it is a backdrop, not a control face. |
| `filter: brightness()` as hover | Foundations §11.4. The halo replaces it. |
| A custom `<select>` | It would re-implement type-ahead, Home/End and the platform picker. §2.5 |
| `role="switch"` on the Settings checkbox | The shipped contract keeps native checkbox semantics so the label association and keyboard toggle stay free (`settings-modal.md` §3.6 D4). |
| Roving tabindex in the Sessions list | `sessions.md` D13: native buttons, two per row, no suppression of `Tab`. |
| Type-ahead in the tree | No user has asked; it needs a buffer, a timeout and a visible search. Arrow keys plus Home/End are the contract. |
| A second breakpoint, or a new container query | Foundations §8.2 rules 1 and 4. See §9 for the container queries that already exist. |
| A drag-only action | Foundations §10.5 rule 4. Tab reorder and tree move keep their menus. |
| Emoji as a chrome control | Foundations §9.3. The glyph fallback (`§9.4`) is a staging state. |
| An entrance animation on a control | Foundations §7.4. Nothing on first paint animates. |
| A hover-revealed row action on touch | It is unreachable. `…` is visible at rest. |
| An "Are you sure?" toast | A disappearing strip cannot own a destructive decision. Use the dialog or `window.confirm`. |

---

## 9. Conflicts found with shipped design

Six places where a shipped document and the shipped CSS, or two shipped documents, disagree.
Each is recorded here rather than silently resolved. Where a record is authoritative for its
surface, this document follows the record and flags the CSS.

| # | Conflict | Evidence | This document's position |
|---|---|---|---|
| C1 | `settings-modal.md` calls its switch the contract and paints the off track with `--border` (1.27:1 light). This document requires `--border-strong` for a ≥3:1 boundary. | `docs/archive/design/settings-modal.md:381`; `style.css:1595` | This document follows the accessibility floor. The deviation is deliberate; update `settings-modal.md` when the switch is next touched. |
| C2 | `edit-window.md` §2 says the bar's icon tools and chips are 32 px. The shipped tool is 28 px. | `docs/archive/ui/edit-window.md:59`; `style.css:5803` (`--te-tool: 28px`) | The record wins: `.te-tool` reads `--control-h-body` (32). The bar is 57 px and the change costs 4 px of height per tool. |
| C3 | `#edit-bar .eb-primary` is transparent with accent text on desktop and a filled accent on the phone. One control, two primaries. | `style.css:1170` vs `:7135` | One primary treatment (§2.1). Desktop takes the fill; the phone rule becomes redundant. |
| C4 | `.draft-bar-btn.primary` is an accent *outline*, not a fill, while every other primary is filled. | `style.css:7825` | The bar's commit action is a button (§2.1). It becomes filled. The bar is transient and overlays the reader; the fill is 30 px and does not compete. |
| C5 | Five shipped rules use `filter: brightness()` and one uses `opacity: .88` as a hover. | `style.css:204`, `:1561`, `:2313`, `:4941`, `:6550`, `:5424`; forbidden by `foundations.md` §11.4 | Replaced by the 3 px `--accent-soft` halo (§2.1). |
| C6 | `.settings-modal` sets `touch-action: none` on the whole box. The Settings body and the login form scroll. | `style.css:1826` | The property belongs to the drag handle and the resize grip, not the modal. Move it to `.resize-grip` and `.settings-header` before any phone work. `docs/archive/design/mobile-shell.md` §4.9 assumes a scrollable sheet. |

Two smaller errata, recorded for the same reason:

- `foundations.md` §10.3 lists seven focus gaps. `.ai-model-select` (`style.css:5048`) and the
  `.tab` element itself are two more. The list is incomplete, not wrong.
- `style.css:82-86` attributes the 4.26:1 muted figure to the light theme. It is the dark
  value; `foundations.md` §3.6 already records this and the comment should be corrected in
  the same change.

