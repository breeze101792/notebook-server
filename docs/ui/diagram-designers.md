# Diagram designers — Mermaid, Graphviz and WaveDrom

Status: current spec — codifies the shipped designers. No visual redesign.
Reference mockup: [`diagram-designers-mockup.html`](diagram-designers-mockup.html) — dark and
light boards: Mermaid ready with add form and inspector, the palette family, the three
failure states, the 720 compact strip, Graphviz, WaveDrom with slice ruler and band, and the
390 compact sheet.

**Normative source.** This document is the single source of truth for the **bodies** of the
two design windows. It does not redraw the shared chrome: the 65 px header, 57 px action bar,
69 px footer, maximize, drag/resize and focus trap belong to
[`edit-window.md`](edit-window.md) and are quoted here only where the body depends on them. It does not restyle diagram cards in the
reader: [`content-blocks.md`](content-blocks.md) owns those. Where this document and
`static/css/style.css` differ today, the stylesheet wins, and the difference is either an
exception (§8.4) or a proposal (§10). Nothing outside §8.4 changes the shipped look.

The shared chrome is owned by [`edit-window.md`](edit-window.md). The archived records —
[`../archive/design/mermaid-editor.md`](../archive/design/mermaid-editor.md),
[`../archive/design/dot-wavedrom-editor.md`](../archive/design/dot-wavedrom-editor.md),
[`../archive/architecture-design/mermaid-designer-ui.md`](../archive/architecture-design/mermaid-designer-ui.md)
and [`../archive/ui/edit-window.md`](../archive/ui/edit-window.md) — are source material for
the shipped code, not current specs. The architecture records
([`mermaid-designer.md`](../architecture/mermaid-designer.md),
[`dot-wavedrom-designer.md`](../architecture/dot-wavedrom-designer.md)) remain authoritative
for behaviour and write-back order.

Every claim about current code cites `file:line`.

---

## 0. Scope and measured anchors

### 0.1 What this document owns

| Owns | Does not own |
|---|---|
| The three-region body of `#designer-overlay` and `#dw-designer-overlay`: sidebar, stage, inspector, bottom sheet | Header, action bar, footer, maximize, close, drag, resize, focus trap (`_edit_window.html`, [`edit-window.md`](edit-window.md)) |
| The Mermaid canvas frame, tool state, add forms, shape palette, inspector groups, chart controls | The rendered diagram itself: Mermaid, Graphviz and WaveDrom draw it. Canvas art is illustrative and exempt from tokens (foundations §3.1) |
| The Graphviz stage card, selection chrome, DOT sidebar and inspector | Reader `.mermaid-container`, `.viz-container`, `.wavedrom-container` cards (`content-blocks.md`) |
| The WaveDrom slice ruler, slice band, wave character track and glyph palette | The vendor popover (hidden inside the Mermaid canvas, `style.css:6410`) |
| States, compact layouts, keyboard contract, apply/cancel feedback | Save path, server routes, note history (architecture records) |

### 0.2 Measured anchors, verified

| Anchor | Read | Confirms |
|---|---|---|
| Markup | `templates/index.html:1464-1634` (Mermaid), `:1641-1764` (Graphviz/WaveDrom) | Region order, ids, ARIA labels, hidden defaults |
| Header, bar, footer macros | `templates/_edit_window.html:13-61` | Chrome is shared; the body starts after the bar and ends before the footer |
| Shell CSS | `static/css/style.css:6133-6186`, `:8522-8754` | Tokens, modal size, body flex, bar and footer geometry |
| Sidebar and add CSS | `style.css:6187-6330` | Widths, padding, tabs, fields, shape grid |
| Chart and palette CSS | `style.css:6332-6396` | Direction chips, switch, single add button |
| Stage, state, alert, hint CSS | `style.css:6397-6472` | Grid canvas, spinner, error, empty, hint |
| Inspector CSS | `style.css:6474-6547` | Head, scrolling body, groups, rest state |
| Compact CSS | `style.css:6560-6632`, `:6861-6940` | Mermaid strip and sheet; DW `is-compact` sheet |
| DW chrome CSS | `style.css:6635-6860` | Stage scroll, card, overlay hits, slice ruler/band, wave track, glyph palette |
| Mermaid JS | `mermaid-designer.js:40-290` (constants), `:473-526` (state), `:748-1248` (sidebar), `:1444-1680` (tabs/chart), `:1791-2432` (inspector), `:3750-3799` (apply) | The behaviour quoted below |
| Shared JS | `designer-shell.js:36-127` (regions), `:202-298` (sheet, states), `:561-636` (apply) | DW lifecycle |
| DOT / WaveDrom JS | `dot-designer.js:1278-1584`, `wavedrom-designer.js:340-900`, `:1305-1373` | Stage UI, selection, ruler, band |
| Tests | `tests/dom/test_dom.js:34762`, `:36167`, `:36354`, `:37853`, `:37963`; `tests/browser/test_designer_browser.js`; `test_dw_designer_browser.js` | The acceptance criteria in §9 are already partly asserted |
| Phone rules | `style.css:6560-6632`, `:6923-6940`, `:8751-8754` | The designer's 960 compact rules, the older 720 palette rule, and the footer wrap. The 860 mode switch is the shell's; the window keeps 96vw |

### 0.3 Two families, one shell

| | Mermaid visual designer | Graphviz / WaveDrom design window |
|---|---|---|
| Overlay | `#designer-overlay`, own lifecycle in `mermaid-designer.js` | `#dw-designer-overlay`, shared lifecycle in `designer-shell.js` |
| Window title | Always **Design diagram** (`templates/index.html:1467`) | **Design graph** or **Design timing** (`designer-shell.js:394-397`) |
| Badge | The Visimer type id, e.g. `flowchart` (`mermaid-designer.js:3653`) | `Graphviz` or `WaveDrom` (`dot-designer.js:20`, `wavedrom-designer.js:17`) |
| Body | Sidebar 236, stage flex, inspector 296 | Sidebar 236, stage flex, inspector 296; plus a compact sheet |
| Canvas | Vendor SVG on a dot grid; vendor draws selection | SVG inside a card; HTML hit buttons draw selection |
| Compact | Strip over stage, inspector as a bottom sheet | No sidebar strip; Add/Chart move into a real sheet |

---

## 1. Shared anatomy

### 1.1 The three regions

Both windows are one flex row inside `.settings-body.designer-body`
(`style.css:6186`). The row has three children in this order: sidebar, stage, inspector.

```
┌ header 65 ───────────────────────────────────────────────┐
│ bar 57                                                   │
├ sidebar 236 ─┬ stage (flex) ────────────────┬ inspector 296 ┤
│ add, chart   │ canvas / card                 │ selection     │
├──────────────┴───────────────────────────────┴───────────────┤
│ footer 69  [status]                        [Cancel] [Apply]  │
└───────────────────────────────────────────────────────────────┘
```

The shell is exactly what shipped. This document owns the middle band only.

### 1.2 Region geometry

| Region | Value | Source |
|---|---|---|
| Window | `min(1320px, 96vw)` × `min(85vh, 92vh)` | `style.css:6171-6176` |
| Window drag / resize | header drag; bottom-right grip; floor 320 × 240 | `windows.js:21-22`, `:78-81` |
| Header | 65 px, padding 10 × 18, bottom hairline | `style.css:8527-8553`; `edit-window.md` §2 |
| Action bar | 57 px, padding 6 × 12 | `style.css:8591-8601` |
| Footer | 69 px, padding 12 × 18; actions 44; top hairline | `style.css:8726-8748`; `edit-window.md` §4 |
| Sidebar | 236 px fixed; padding 12 × 8; gap 8; `--bg-elev`; right hairline | `style.css:6187-6194` |
| Stage | `flex: 1 1 auto`; `min-height: 0`; `overflow: hidden` | `style.css:6397` |
| Inspector | 296 px fixed; `--bg-elev`; left hairline; `overflow: hidden` | `style.css:6475-6480` |
| Inspector head | min-height 48; padding 8 × 12; bottom hairline | `style.css:6497-6501` |
| Inspector body | scrolls; padding 12; gap 12 | `style.css:6519-6523` |
| DW sheet | absolute bottom; max-height 55 %; min-height 120; z 3 | `style.css:6883-6890` |

At 1280 px the window is 1228.8 wide and the stage is 696.8 before the 1 px borders
(1228.8 − 236 − 296; 695 measured inside them). All seven widths are in §7.

### 1.3 Scroll ownership

Exactly one region scrolls on each axis. The window body itself never scrolls.

| Axis | Owner | Rule |
|---|---|---|
| Vertical, sidebar | The sidebar | `overflow-y: auto` (`style.css:6190`) |
| Horizontal, sidebar | Nobody | `overflow-x: hidden` (`:6190`) |
| Vertical, inspector | Inspector body only | head is fixed, body scrolls (`:6519-6523`) |
| Vertical, stage | Nobody | `overflow: hidden` (`:6397`); the diagram is fitted |
| Horizontal, DW stage | `.dw-stage-scroll` | `overflow-x: auto` (`:6646-6651`) |
| Vertical, document | Nobody | body height is the window; footer never moves |

The DW stage is the one horizontal scroller. The 14 px edge hit and the 24 px minimum ruler
cell both rely on it (`style.css:6691`, `:6713`).

### 1.4 Resizing

`windows.js` moves and resizes the `.settings-modal` by inline styles (`style.css:1374-1379`)
and persists the box per overlay id (`docs/architecture/dot-wavedrom-designer.md` §2 D1).
The body responds because the sidebar and inspector are fixed and the stage is `flex`.
Neither sidebar nor inspector has a resize handle. At the 320 px floor the fixed columns
(532 px) exceed the window; §10 P1 records the fix and §12 records why it is not applied now.

### 1.5 How the two families differ

| Difference | Mermaid | Graphviz / WaveDrom | Why |
|---|---|---|---|
| Canvas backdrop | Dot grid, `--designer-canvas-bg` | Same grid behind a stage card | The card reproduces the note block; the grid is the work surface |
| Selection | Painted by the vendor inside the SVG | HTML buttons in `.dw-overlay`, positioned from measured bboxes | Vendor SVGs are never restyled (`dot-wavedrom-designer.md` §5.4) |
| Empty state | Overlay copy is per family (`mermaid-designer.js:67-74`) | One copy per language (`dot-designer.js:24`, `wavedrom-designer.js:21`) | Different add vocabularies |
| Inspector | One per selection kind; 12 kinds | Node/Edge for DOT; Signal/Data label for WaveDrom | The models differ |
| Compact | Add form stays in a horizontal strip; inspector is the sheet | Sidebar disappears; Add/Chart open a real sheet | The bar already carries Add/Chart/Source in DW |
| History | Vendor history through `NB.editWindow` | Controller snapshot/restore through `NB.editWindow` | Same bar, different model |

---

## 2. Mermaid designer

### 2.1 The action bar

The bar is the shared shell. Two groups sit in its scrolling actions slot
(`templates/index.html:1469-1497`):

| Control | Markup | State |
|---|---|---|
| Select tool | `#designer-tool-select`, 32 × 32 icon button, pointer glyph | `aria-pressed="true"` at rest (`:1471-1478`) |
| Connect tool | `#designer-tool-connect`, 32 × 32, arrow glyph | `aria-pressed="false"`; hidden and disabled for non-connectable families (`mermaid-designer.js:754-757`); title names Alt+drag (`:1480`) |
| Add chip | `#designer-bar-add`, 32 px text chip | Disabled until the sidebar is visible (`:473-475`) |
| Chart chip | `#designer-bar-chart` | Disabled until the chart section is visible (`:476-478`) |

Both chips focus the first enabled control of their sidebar section and scroll it into view
(`mermaid-designer.js:484-507`). They never duplicate the form. History lives in the bar's
pinned pair from `_edit_window.html:25-46`; the body does not own it.

### 2.2 Canvas, selection and connect

| Property | Value | Source |
|---|---|---|
| Frame | absolute inset 0; background `--designer-canvas-bg`; radial grid 1 px dot every 24 px, centred | `style.css:6398-6405` |
| Focus | `tabindex="0"`, `role="application"`, `aria-label="Diagram canvas"`; ring 2 px accent, offset −2 | `templates/index.html:1566-1567`; `style.css:6406` |
| Focus on open/close | canvas focused on open; selection clear returns focus to the canvas | `mermaid-designer.js:3511`, `:3874-3881` |
| Selection | `editor.on("selectionChange")`; the first entity id is resolved against the model | `mermaid-designer.md` "Selection model"; `mermaid-designer.js:3359-3412` |
| Selection drift | every model change re-resolves by identity signature; a structural dispatch clears unless it returned `created[0]` | `mermaid-designer.js:401`, `:3398-3412` |
| Reject feedback | a rejected dispatch restores the field value and shows an inline `.designer-field-error` | `:2288-2301` |
| Vendor popover | hidden inside the canvas; inline double-click label editing remains | `style.css:6410` |
| Connect | Connect tool or Alt+drag; `connect` accepts one arrow end, a start/double head is completed with `setEdgeStyle` | `mermaid-designer.md` "Add forms" |

The canvas is automatic-layout only. No drag persists a coordinate; a drag either selects,
reorders (sequence), or creates an edge (`docs/requirements/features/mermaid-visual-editor.md`
§3.1).

### 2.3 Add sidebar

Anatomy, top to bottom (`style.css:6187-6303`):

| Part | Value |
|---|---|
| Section | column, gap 7 px (`:6196`) |
| Title | `.designer-sidebar-title`, `.72rem`, 600, uppercase, `.6px` tracking, `--fg-muted` (`:6198-6201`) |
| Tabs | inset 2 px, hairline box, radius 6, `--bg`; each tab `flex:1`, padding 5 × 4, `.78rem`; selected = `--accent-soft` + `--accent` + 600 (`:6267-6283`) |
| Form | column, gap 8 (`:6284`) |
| Fields | column, gap 8 (`:6286`) |
| Field row | label above control, gap 3 (`:6287`) |
| Label | `.76rem`, `--fg-muted` (`:6288`) |
| Field | 32 px high, padding 5 × 8, radius 6, `--code-bg`, hairline, `.84rem` (`:6289-6293`) |
| Field focus | accent border + 3 px `--accent-soft` halo; no outline (`:6294-6297`) |
| Invalid | `--danger` border (`:6298`) |
| Field error | `.74rem`, `--danger` (`:6299`) |
| Scope note | `.74rem`, `--fg-muted` (`:6301`) |
| Submit | full width, accent-soft face, accent border and text, 600 (`:6234-6238`); disabled at `opacity .5` (`:6232`) |

Tabs appear only when the family has more than one (`mermaid-designer.js:970-988`). Pie has a
single tab, so it has no tab strip. The tablist is a real `role="tablist"` with `aria-label`
(`templates/index.html:1510-1511`); the form is its `role="tabpanel"` and its
`aria-labelledby` points at the active tab, or at the section title when there is one tab
(`mermaid-designer.js:1000-1001`). The tab strip has roving tabindex; ArrowLeft/Right,
Home/End and Enter/Space move and select (`:1452-1472`).

| Family | Tabs | Fields, in order | Submit | Enabled when | Scope note |
|---|---|---|---|---|---|
| flowchart | Node | Shape grid (14), Label | Add node | Label non-empty | — |
| flowchart | Edge | From, To, Label (optional), Line, Arrow | Add edge | Both endpoints; at least 2 nodes | "Add two nodes before connecting them." |
| sequence | Participant | Name, Type (8 kinds) | Add participant | Name non-empty and a valid id | Invalid id text under the field |
| sequence | Message | From, To, Text, Arrow (8 ops), Position | Add message | From, To, Text | "Add a participant before adding a message." |
| sequence | Note | Participant, Placement, Text, Position | Add note | Participant, Text | "Add a participant before adding a note." |
| state | State | Label, Type | Add state | Label non-empty | — |
| state | Transition | From, To (with `[*]`), Label (optional) | Add transition | From and To | — |
| class | Class | Name | Add class | Name non-empty | — |
| class | Relation | From, To, Type (14 `RelationOp`s), Label (optional) | Add relation | From, To, Type | — |
| er | Entity | Name | Add entity | Name non-empty | — |
| er | Relation | From, To, Label | Add relation | From and To | — |
| pie | Slice (no strip) | Label, Value (number, min 0, step any) | Add slice | Label; finite value ≥ 0 | "Enter a finite value of 0 or more." |

Source: `mermaid-designer.js:1016-1135`, `:1164-1208`.

Rules that apply to every form:

1. It is a real `<form>` with `novalidate`; Enter submits (`templates/index.html:1512-1519`).
2. Submit is disabled until validation passes. The reason is text, not colour (`:1130-1133`).
3. Field drafts survive a tab switch. The chosen shape, line and arrow defaults survive a
   successful add; text fields clear (`mermaid-designer.md` "Add forms"; `:1141-1155`).
4. A rejected add shows `#designer-add-error` with `role="alert"` and marks the field
   `aria-invalid` + `aria-describedby` (`:1218-1236`).
5. Focus returns to the first field after a successful add (`:1444-1450`).
6. The pie value never reaches `pie.addSlice` unless it is finite and ≥ 0 (`:1198-1205`).

Pie has a v2 nuance: a header it cannot rewrite disables the Title and Show-data controls and
shows the scope note "This pie header can't be rewritten safely; edit it in the source."
(`mermaid-designer.js:136-137`, `:1659-1678`). The header edit touches only the `pie` line
(`mermaid-designer.md` "Pie header").

### 2.4 Palette (non-scoped families)

Everything outside the six scoped families keeps the add-only sidebar (`mermaid-designer.js:38-40`,
`:748-777`). The palette is one full-width button.

| Property | Value | Source |
|---|---|---|
| Container | column, gap 8 | `style.css:6386` |
| Button | accent border, accent-soft face, accent text, `.82rem`, padding 8 × 10, radius **7 px** | `:6388-6393` |
| Hover | accent face, `--accent-fg` text | `:6395` |
| Icon | 16-grid plus, `currentColor` | `mermaid-designer.js:117` |
| Actions | gantt: **Add task**; the line-item family: **Add line** | `:129-133` |

The button is a one-shot dispatch with fixed defaults (`ADD_DEFAULTS`, `:122-127`). There is
no inspector and no inspector sheet for these families.

### 2.5 Inspector

The inspector is present only when the state is ready and the family is scoped
(`mermaid-designer.js:517`). Its head is fixed; its body scrolls.

| Part | Value | Source |
|---|---|---|
| Head | 48 px min, padding 8 × 12, bottom hairline | `style.css:6497-6501` |
| Glyph | 26 × 26, radius 6, hairline, `--accent`, 700, `.78rem`; one letter per kind (`N E P M T S C R`) | `:6502-6508`; `mermaid-designer.js:285-290` |
| Kind | `.92rem`, 600, ellipsis | `style.css:6510-6513` |
| Meta | `.72rem`, mono, `--fg-muted`, ellipsis | `:6514-6518` |
| Clear | ghost `×` at the trailing edge, `aria-label="Clear selection"`, hidden at rest | `:6480-6487`; `templates/index.html:1624-1626` |
| Group | column, gap 6, 10 px top padding, top hairline; first group has neither | `:6524-6529` |
| Group title | `.7rem`, 600, uppercase, `.6px` | `:6530-6533` |
| Row | label above control, gap 3 | `:6287` |
| Consequence | `.73rem`, `--fg-muted` | `:6534` |
| Rest | centred, glyph `◇` 1.4 rem, title `.9rem` 600, copy `.78rem` max 34 ch | `:6535-6541` |

At rest the head reads **Nothing selected** and the family name; the body reads **Nothing
selected** plus the family's edit summary (`mermaid-designer.js:53-65`, `:1791-1805`,
`:1922-1940`). The floating hint appears only in this state (`:460-471`).

| Selection | Groups, in order | Source |
|---|---|---|
| Node | Label; Shape (3-column grid of the same 14); Color (Fill, Stroke, Text, each with Clear); Actions (Connect from this node, Delete node) | `:2283-2345` |
| Edge | Label; Line; Arrows (7 styles plus Custom); Color (Stroke, Clear); Actions (Reverse direction, Delete edge) | `:2347-2432` |
| Participant | Display name; Id; Type; Actions (Message from this participant, Delete participant) | `:2434-2555` |
| Message | Text; Arrow; Order; Wrap in; Actions (Move up, Move down, Reverse direction, Delete message) | `:2578-2669` |
| Note | Text; Actions (Delete note) | `:2670-2704` |
| Slice | Label; Value; Actions (Delete slice) | `:2733-2819` |
| State | Label; Type; Actions (Add note left, Add note right, Connect from this state, Delete state) | `:2880-2946` |
| Transition | Label; Actions (Reverse direction, Delete transition) | `:2947-2981` |
| Class | Name; Annotation; Members (add/delete a row); Actions (Add note, Delete class) | `:2982-3110` |
| Relation | Type; Label; Cardinality; Actions (Reverse direction, Delete relation) | `:3111-3191` |
| Entity | Name; Attributes (add/edit/delete a row); Actions (Delete entity) | `:3199-3274` |
| ER relation | Cardinality; Identifying; Label; Actions (Delete relation) | `:3275-3352` |

Node and edge detail that a coder must not guess:

- Text fields commit on `change`, not on each keystroke, so the caret never jumps
  (`mermaid-designer.md` "Selection model").
- A rejected change restores the model value and shows the inline error under that field
  (`mermaid-designer.js:2288-2301`).
- Delete actions are ghost-danger, full width, left aligned, `--danger` text. The shipped
  hover takes a `--danger-soft` wash (`style.css:6239-6243`); E7 replaces that wash with an
  inset ring because the wash measures ≈3.7:1.
- Node and edge delete carry the consequence line "Its edges are removed too. Undo restores."
  and "Undo restores the edge." (`:2343`, `:2430`).
- The Id field exists only for a sequence participant with no alias; an aliased participant
  disables it (`:2478-2530`).
- Color controls read a hex from one `style` / `linkStyle` line. A shared or non-hex line
  disables the control and shows the source-edit note (`:2123-2281`).

### 2.6 Chart section

The chart sits below a hairline divider in the sidebar (`templates/index.html:1523-1553`).
It appears only when the family has a chart control.

| Family | Control | Look | Commit | Source |
|---|---|---|---|---|
| flowchart, state, class | Direction | `role="radiogroup"`; 5 pill chips TD / TB / BT / LR / RL; 26 px high, min-width 34, `.72rem`; checked = accent-soft + accent border + accent text + 600 | On change; one history entry; selection kept | `style.css:6333-6350`; `mermaid-designer.js:1489-1517` |
| sequence | Autonumber messages | 34 × 18 switch, 14 px knob, 16 px travel; word **Off/On** at the trailing edge | On change; clears selection | `style.css:6351-6380`; `:1653-1658` |
| pie | Title + Show data values | One text field (32 px) and the same switch | On change; rewrites only the `pie` header line | `templates/index.html:1538-1552`; `:1628-1642` |

The switch's off track is `--border` (`style.css:6366`) and its reduced-motion twin is present
(`:6381-6383`). §8.4 E3 records the contrast correction; the geometry stays.

### 2.7 Empty and hint

| Element | Copy | Look |
|---|---|---|
| Empty | flowchart "Add your first node from the sidebar."; sequence "Add your first participant from the sidebar."; pie/slice; state; class; er (`mermaid-designer.js:67-74`) | `◇` at 2 rem in `--accent` at .8 alpha, `.9rem` muted copy, centred, pointer-events none (`style.css:6458-6464`) |
| Hint | "Select a node or edge to edit it · use Add to create one" and four siblings (`mermaid-designer.js:45-52`) | pill, bottom 16, centred, `--bg-elev`, hairline, `.82rem`, shadow `0 6px 18px rgba(0,0,0,.25)` (`style.css:6465-6471`) |

The hint is also the modal's `aria-describedby` while it is visible (`:470`).

---

## 3. Graphviz and WaveDrom

### 3.1 Stage and card

Both languages share one stage (`style.css:6635-6667`):

| Part | Value | Source |
|---|---|---|
| Stage | flex row; `overflow: hidden` | `:6635-6637` |
| Stage main | relative, flex 1 | `:6638-6641` |
| Canvas | flex centre; the dot grid; no padding | `:6642-6645` |
| Scroll | `.dw-stage-scroll`, padding 18, centres the card, scrolls x | `:6646-6651` |
| Card | `max-width: 90%`, `max-height: 78%`, padding 14 × 16, radius 8, `--bg-panel`, hairline | `:6652-6658` |
| SVG | block, max 100 % | `:6665-6667` |
| WaveDrom card | white `#fff` in both themes | `:6659-6664`; `--dw-wavedrom-surface` at `:6168` |
| Overlay layer | absolute inset 0; pointer-events none | `:6668-6670` |

The card reproduces the note's diagram card, not a second design surface. The WaveDrom card is
white in both themes because the library's SVG carries a light skin (`dot-wavedrom-designer.md`
§5.1 note; browser test asserts `rgb(255,255,255)`).

Selection chrome is HTML, never a restyle of the SVG:

| Kind | Look | Source |
|---|---|---|
| Node hover | ring `0 0 0 2px` of `--dw-hover-ring` (accent at 45 %) | `:6682-6684` |
| Node selected | ring `0 0 0 2px var(--accent)` | `:6679-6681` |
| Type label | 18 px pill above the box, `.64rem` 600 uppercase, accent text and border, `--bg-elev` face | `:6823-6830` |
| Edge hit | transparent clone of the path, 14 px stroke, pointer-events stroke | `:6689-6693` |
| Edge selected / hover | accent stroke, 2.5 / .45 alpha | `:6685-6696` |
| Wave row selected | full-width band, accent-soft fill, inset 2 px accent rail | `:6697-6703` |
| Data label | ring 2 px accent + accent-soft wash | `:6817-6822` |
| Hit focus | 2 px accent ring, offset 2 | `:6676-6678` |

### 3.2 Graphviz

**Sidebar.** Two tabs, Node and Edge (`dot-designer.js:1311-1328`), with the shipped field look
from §2.3. Both tabs are Tab stops today; §8.4 E5 records the roving-tabindex correction.

| Tab | Fields | Source |
|---|---|---|
| Node | ID (placeholder `auto: n1`), Label (placeholder `Flask app`), Shape (3 × N grid of `SHAPES`), Style (`NODE_STYLES`) | `dot-designer.js:1343-1365` |
| Node submit | **Add node**; enabled when Label is non-empty | `:1352-1354` |
| Edge | From, To, Label, Line, Arrow | `:1368-1406` |
| Edge submit | **Add edge**; disabled when fewer than two nodes, an empty end, or From = To; the reason is a scope note ("Add a second node first." / "From and To must differ.") | `:1378-1392` |

**Chart.** Direction chips TB / LR / BT / RL plus **Default (top to bottom)** in a
`role="radiogroup"` (`dot-designer.js:1409-1446`). Default removes the `rankdir` line; a chip on
a source with no line inserts one. The chip container uses `.designer-chips`, which has no CSS
today; §8.4 E2 aligns it with the Mermaid row.

**Inspector.** Node and Edge only.

| Kind | Head | Groups | Source |
|---|---|---|---|
| Node | `Node`; meta `id · label` | Label (live input, required); Shape grid; Style select; Actions (Add edge from this node, Delete node) | `:1478-1583` |
| Edge | `Edge`; meta `from → to` | From, To (side by side); Label; Line; Arrow; Actions (Delete edge) | `:1586-1705` |

Read-only rules: a multi-line statement shows "This statement spans multiple lines and is
read-only." and disables its fields; a source-only shape or style shows its own note and
disables Delete (`:1484-1489`, `:1520-1548`, `:1565-1569`).

**Hint and empty.** Hint "Select a node or edge to edit it" (`:21`); empty "Add your first
node." (`:24`).

### 3.3 WaveDrom

**Stage.** The scroll contains, in order: slice ruler, white card, slice band
(`templates/index.html:1686-1696`). The ruler is outside the card, above it.

**Slice ruler.** One cell per slice, where `slices = ceil(wave.length / period)`
(`wavedrom-designer.js:349-353`).

| Property | Value | Source |
|---|---|---|
| Container | `role="listbox"`, `aria-orientation="horizontal"`, `aria-label="Time slices"`; flex, gap 2, bottom margin 8 | `:1316-1318`; `style.css:6704-6709` |
| Cell | min 24 × 30, radius 4, `--bg-panel`, hairline, `.64rem`; width comes from the measured grid, clamped at 24 | `style.css:6710-6717`; `:1319-1321` |
| Alignment | left margin equals the measured time-grid left offset | `:1322-1324` |
| Selected | accent face, accent border, `--accent-fg`, `is-selected` + `aria-selected` | `style.css:6721-6725` |
| Hover | `--dw-hover-ring` | `:6718-6720` |
| Keyboard | roving tabindex; ArrowLeft/Right, Home/End; click selects | `wavedrom-designer.js:1485-1510` |

**Slice band.** A translucent column from the ruler's bottom edge to the card's bottom, over
the selected slice (`wavedrom-designer.js:1347-1373`): `--accent-soft` fill, 2 px left accent
border, 1 px right accent border, z 1, pointer-events none (`style.css:6726-6732`). Its left is
`gridLeft + sliceIndex × cellW`; its top and height are measured, never a `cardWidth /
waveLength` guess (§6.3 of the architecture). The ruler clamps its cell width to 24 px
(`wavedrom-designer.js:1319-1325`); the band uses the raw value (`:1367`), so it drifts on a
narrow card. P20 proposes clamping both.

**Inspector, signal.**

| Part | Value | Source |
|---|---|---|
| Head | `Signal`; meta `name · N slices · slice S` | `wavedrom-designer.js:446-453`, `:738-741` |
| Name | text, required; read-only when the model has an `edge` array, with the edge note | `:767-793` |
| Wave | text field (mono) plus the character track | `:553-693` |
| Track cell | 24 × 34, radius 4, `--bg-panel`, gap 2; slice number `.5rem` at the top-left; glyph 12 × 8; character `.68rem` mono | `style.css:6733-6789` |
| Track state | selected = accent border + 1 px accent inset + accent-soft face | `:6753-6756` |
| Readout | "Cell 3 · data label “body” · data" or "Select a cell to edit it" | `wavedrom-designer.js:434-444` |
| Glyph palette | 6 columns, buttons min 28, mono `.72rem`; each writes that character at the selected cell | `style.css:6790-6799`; `:662-683` |
| Period | number 1–16; empty removes the key; invalid shows "Use a whole number 1-16." | `:797-833` |
| Data labels | rows `24px 1fr auto`: index, 20-character preview, **Select** ghost button | `:835-861`; `style.css:6806-6816` |
| Actions | Move up, Move down, Delete signal; disabled by groups/gaps/edges with a title | `:863-890` |
| Data-label inspector | Head `Data label`; meta `signal · slice S`; Label; note "Data glyph N of M · slice S"; Delete label | `:695-736` |

Track keys: ArrowLeft/Right, Home/End, Backspace deletes a character, a printable character
replaces or appends (`wavedrom-designer.js:622-660`).

**Add signal.** Name, Wave, Period, plus a mini track preview (24 px cells) under the fields
(`:510-551`). Add and Delete are disabled when the model contains a group, a gap, or an `edge`
array (`:515`, `:547-550`).

**Chart.** Time scale 1–10, one select plus the note that it writes `config.hscale`
(`wavedrom-designer.js:465-487`).

**Hint and empty.** Hint "Select a signal to edit its wave" (`:18`); empty "Add your first
signal." (`:21`).

### 3.4 Compact sheet

At a viewport of 960 px or less the shell adds `.is-compact` (`designer-shell.js:280-286`).

| Change | Value | Source |
|---|---|---|
| Body | column | `style.css:6861-6863` |
| Sidebar | `display: none` | `:6910` |
| Stage | column; main min-height 45 % | `:6864-6869` |
| Inspector | absolute bottom, full width, max-height 55 %, z 2; hidden when nothing is selected | `:6870-6882` |
| Add + Chart | Become a real sheet from the bar chips | `designer-shell.js:658-663` |

The sheet does not copy the form. It moves the live section node into the sheet with a comment
anchor and moves it back on close (`designer-shell.js:202-268`), so a half-typed form survives.

| Part | Value | Source |
|---|---|---|
| Box | absolute bottom, z 3, max-height 55 %, min-height 120, `--bg-panel`, top hairline, shadow `0 -6px 18px rgba(0,0,0,.22)` | `style.css:6883-6890` |
| Head | 36 px; grabber 38 × 4 centred; close `×` at the right | `:6891-6899` |
| Body | scrolls; padding 10 12 14; gap 8 | `:6900-6906` |
| ARIA | `role="dialog"`, `aria-modal="false"`, `aria-label="Build sheet"`, `aria-hidden` toggled | `templates/index.html:1733-1734`; `designer-shell.js:228-230` |
| Focus | first field, then again on the next frame | `designer-shell.js:235-245` |
| Close | `#dw-sheet-close`, Esc, or opening the other sheet; focus returns to the chip | `:248-266`, `:667-672` |
| Source chip | Leaves the window and opens the source editor; no sheet | `:658-660` |

The sheet is inside the modal, so `NB.dialog`'s tab trap still contains focus. It is not a
second modal; `aria-modal="false"` says so.

### 3.5 The DW bar

The actions slot is three text chips: **Add**, **Chart**, **Source**
(`templates/index.html:1646-1655`). Add and Chart open the sheet; Source calls the shared
`editSourceNow()` (`designer-shell.js:658-663`). The chips exist in both layouts; on desktop
they scroll the sidebar section into view and focus its first field (`:208-215`). History is
the same pinned pair from the shared bar.

---

## 4. States

The five body states are mutually exclusive. One `hidden` flag per state element is the whole
mechanism (`mermaid-designer.js:509-526`; `designer-shell.js:288-298`).

### 4.1 State table

| State | Element | Trigger | Visual | Actions |
|---|---|---|---|---|
| Loading | `#designer-loading`, `#dw-loading` | open, retry | canvas backdrop; 26 px spinner, 3 px ring, accent top; message | none |
| Ready | canvas + sidebar | model built and first preview rendered | status **Ready** (ok colour) | Apply enabled; sidebar visible when the family has an add action; inspector visible when scoped |
| Empty | `#designer-empty`, `#dw-empty` | ready and the model has no elements | centred `◇`, family copy; pointer-events none | the sidebar is still usable |
| Open error | `#designer-error`, `#dw-error` | model or renderer failed, or the type is not editable | full stage; `⚠`; title **Couldn't open this diagram**; message; optional detail `<pre>`; **Retry** + **Edit source instead** | both buttons |
| Not editable (Mermaid) | same `#designer-error` | type capability is not `edit` | same state; message "This diagram can't be edited visually — edit the source instead."; Retry hidden | **Edit source instead** only |
| Read-only (DW) | `#dw-readonly` | capability `render`, or a WaveDrom source-only construct | `◌`; title **Read-only diagram**; reason ("This graph uses source-only constructs.", "This waveform has no signal array.", "This waveform uses analog bricks."); **Edit source instead** | one button |
| Applying | ready + the `applying` flag | Apply pressed with changes | Apply and Cancel disabled; status **Applying…**; DW body inert | none until the result |
| Apply failure | `#designer-alert` over ready | validation or serialisation failed | danger-soft banner, danger border, `.8rem`, dismiss `×` | dismiss; Apply re-enabled |
| Preview failure | `#designer-alert` | a live-preview render failed | same banner; the last good card stays | dismiss; Apply still validates |

The Mermaid template contains `#designer-readonly` (`templates/index.html:1595-1601`), but the
shipped code never shows it: a non-editable type routes to the error state with the notice
above. The DOM test asserts exactly that (`tests/dom/test_dom.js:35798`). Do not build the
"Preview only" block; it is dead markup.

### 4.2 Selected and none

| State | Head | Body | Hint |
|---|---|---|---|
| None | glyph `◇`; **Nothing selected**; family name | rest block: `◇`, **Nothing selected**, family edit summary | visible |
| Node | `N`; **Node**; `id` | Label, Shape, Color, Actions | hidden |
| Edge | `E`; **Edge**; `from → to` | Label, Line, Arrows, Color, Actions | hidden |
| Other kinds | first letter of the kind (`P M T S C R`); kind; identity or position | see §2.5 | hidden |

The head is an `aria-live="polite"` region (`templates/index.html:1616-1617`), so a selection
change is announced once. The clear button is the only named way to drop the selection from
the inspector; it returns focus to the canvas (`mermaid-designer.js:3874-3881`).

### 4.3 Applying

| Step | Mermaid | DW |
|---|---|---|
| Apply disabled | yes (`:3759`) | yes (`designer-shell.js:572`) |
| Cancel disabled | yes (`:3760`) | yes (`:573`) |
| Rest of the body inert | no | yes (`:571`, `setInert`) |
| Status | "Applying…" | "Applying…" |
| Status region | `role="status" aria-live="polite"` (`_edit_window.html:53-54`) | same |
| Failure | banner + status; window stays open | banner + status; window stays open |

---

## 5. Apply and Cancel

### 5.1 Mermaid order

`mermaid-designer.js:3750-3799`:

1. Read `editor.code`. If it equals `baselineSource`, set status **No changes to apply** and
   close with force. No parse, no history step.
2. Set `applying`, disable Apply and Cancel, clear the banner, status **Applying…**.
3. `await window.mermaid.parse(code)`. On throw: re-enable, status **Couldn't apply — invalid
   diagram**, banner "Couldn't apply — the diagram is not valid. {first line}". Nothing written.
4. If hybrid mode is no longer active: notice, close, nothing written.
5. Re-resolve the target by parent + index and require the element to match
   `.mermaid-container, .mermaid-error` inside `#viewer-content` **and** to carry the captured
   source (`:3740-3748`). A mismatch closes with **Couldn't apply — the diagram changed**.
6. Flush the pending hybrid snapshot, replace the block with a raw
   `<pre><code class="language-mermaid">`, await `NB.mermaid.renderAll(viewerContentEl)`, call
   `NB.hybrid.onContentChange()` once, close with force, restore focus.

### 5.2 DW order

`designer-shell.js:561-636`, mirroring the Mermaid steps:

1. No-op check is field-value based: `controller.isNoOp(model)` → **No changes to apply**,
   close. A lenient WaveDrom source therefore never rewrites itself just to normalise JSON.
2. Disable Apply and Cancel, set the body inert, status **Applying…**.
3. Serialise. A throw is a banner, status **Couldn't apply — invalid {Graphviz|WaveDrom}
   source**, and the window stays open.
4. Validate by rendering the candidate into a detached host with the **same renderer as the
   note**. A throw is the same banner and status.
5. Hybrid guard, then target re-resolution (same parent/index/source contract).
6. Flush the snapshot, swap a raw fence in `controller.lang` (`graphviz` is written as `dot`),
   await `controller.renderNote()`, call `onContentChange()` once, close, restore focus.

### 5.3 Cancel, Esc, backdrop, dirty guard

| Close path | Mermaid | DW |
|---|---|---|
| Cancel / header × / backdrop | `close(false)` (`:3830-3831`, `:3847-3850`) | `close(false)` (`designer-shell.js:685-687`) |
| Esc | document keydown, gated on this overlay; close (`:3803-3811`) | document keydown; sheet first, then window (`:671-680`) |
| Dirty test | `editor.code !== baselineSource` (`:3518`) | `!controller.isNoOp(model)` (`designer-shell.js:496`) |
| Confirm copy | "Discard unsaved diagram changes? The note will stay unchanged." (`:35-36`) | "Discard unsaved changes to this graph/waveform? The note will stay unchanged." (`:187-191`) |
| Apply, no-op, stale target, source fallback | `close(true)`, no prompt | `close(true)`, no prompt |
| Focus return | invoker if still connected and not in a context menu, else the block at parent/index (`:3599-3613`) | same (`designer-shell.js:325-345`) |

The native `confirm()` is the shipped dirty guard. It is not a designed dialog; do not
replace it in this pass.

### 5.4 Status and banner copy

| Text | Where | Kind |
|---|---|---|
| `Ready` | footer, ready | ok |
| `Unsaved changes` | footer after any edit | neutral |
| `Applying…` | footer during Apply | neutral |
| `No changes to apply` | footer, no-op Apply | neutral |
| `Couldn't apply — invalid diagram` | Mermaid footer, validation failure | error (warn colour) |
| `Couldn't apply — invalid Graphviz source` / `… WaveDrom source` | DW footer | error |
| `Couldn't apply — the diagram is not valid. {detail}` | banner | danger |
| `Preview can't render this change. Apply still validates before saving.` | DW banner | danger |

The footer status uses `--designer-ok` / `--designer-warn`, not `--ok` / `--warn` directly
(`style.css:6544-6547`; dark values equal the foundation tokens, light values are declared at
`:6156-6161`).

---

## 6. Keyboard and ARIA

### 6.1 Tab order

Both windows: bar history → bar tools → sidebar → stage canvas → inspector → footer. That is
DOM order; no positive `tabindex` exists (`templates/index.html:1464-1763`).

| Surface | Tab stops | Notes |
|---|---|---|
| Bar | undo, redo, tools/chips | native buttons |
| Sidebar tabs | one stop (roving) in Mermaid; two in DOT today | §8.4 E5 fixes DOT |
| Add form | its fields and submit in DOM order | disabled submit is skipped |
| Canvas | one stop | `role="application"` |
| Mermaid entities | none | pointer-only; recorded gap, not changed here |
| DOT nodes/edges | the canvas is the stop; the selected hit alone has `tabindex="0"` | arrows move the selection (`dot-designer.js:2078-2112`); hits are buttons created with `tabindex="-1"` (`:1798`) and the selected one is raised to `0` (`:1978`) |
| Wave signals | the canvas is the stop; the selected row hit alone has `tabindex="0"` | arrows move the signal, left/right move the slice (`wavedrom-designer.js:1450-1482`) |
| Slice cells, wave cells | one stop per listbox (roving) | the ruler and the character track are `role="listbox"` |
| Inspector | its fields and buttons | head is not a stop |
| Sheet | its fields; close | inside the modal trap |

### 6.2 Keys

| Key | Where | Effect |
|---|---|---|
| `Esc` | window | close (DW closes the sheet first) |
| `Tab` / `Shift+Tab` | window | trapped by `NB.dialog` |
| ArrowDown / ArrowUp | DW canvas | next / previous node or edge (DOT), next / previous signal (WaveDrom) |
| ArrowRight / ArrowLeft | DW canvas, WaveDrom | next / previous slice |
| Home / End | DW canvas | first / last node, edge, or slice |
| Enter | DW canvas | focus the first inspector field |
| ArrowLeft/Right, Home/End | Mermaid add tabs | move and select the tab |
| Enter/Space | Mermaid add tab | select the tab |
| Enter | add form | submit |
| ArrowLeft/Right | Wave slice ruler | previous/next slice |
| ArrowLeft/Right, Home/End | Wave character track | move the selected cell |
| Backspace | Wave character track | delete the character |
| printable character | Wave character track | replace/append the character |
| Arrow keys | direction radiogroups | native radio movement |

### 6.3 ARIA contract

| Element | Contract | Source |
|---|---|---|
| Overlay | `role="dialog" aria-modal="true"` on `.designer-modal`, `aria-labelledby` the title | `templates/index.html:1465-1466`, `:1642-1643` |
| Overlay close | `Esc`, backdrop click, `×`; focus returns | §5.3 |
| Canvas | `role="application"`, `aria-label="Diagram canvas"`, `tabindex="0"` | `:1566-1567`, `:1686-1687` |
| Add tablist | `role="tablist" aria-label="Add an element"`; tabs `role="tab"`, `aria-selected`, `aria-controls` | `:1510-1511`; `mermaid-designer.js:976-981` |
| Add form (Mermaid) | `role="tabpanel"`, `aria-labelledby` active tab or title | `:1512-1513`; `:1000-1001` |
| Add form (DW) | No `role="tabpanel"` today; §8.4 E5 records the correction | `templates/index.html:1663-1669` |
| Inspector | `<aside aria-labelledby="…-inspector-kind">`; head `aria-live="polite"` | `:1608-1617`, `:1743-1746` |
| Inspector clear | named `×`, `aria-label="Clear selection"` | `:1624-1626`, `:1752-1754` |
| Alert | `role="alert"`, dismiss button named "Dismiss error" | `:1559-1563`, `:1680-1684` |
| Footer status | `role="status" aria-live="polite" aria-atomic="true"` | `_edit_window.html:53-54` |
| Sheet | `role="dialog" aria-modal="false" aria-label="Build sheet"`, `aria-hidden` toggled | `:1733-1734` |
| Error state | `role="alert"` on the whole state | `:1583-1584`, `:1708-1709` |
| Empty state | no role; text is adjacent to the canvas, not a live region | `:1570-1573` |

Known gaps, recorded not hidden:

1. Mermaid canvas entities are not keyboard-reachable. The architecture defers "full keyboard
   traversal" (`mermaid-designer.md:516`). The canvas itself is reachable and focusable. The DW
   windows do the opposite: arrows cycle entities and Enter enters the inspector. That is the
   reference if Mermaid ever gains a key path.
2. The DOT add tabs lack roving tabindex and `role="tabpanel"`; E5.
3. The compact sheet's close button is a ≈26 px header target today (`style.css:1345-1355`); P14 proposes 44. The grabber is not a control;
   the sheet closes by `×` or `Esc` (`designer-shell.js:667-672`).
4. `.designer-field:focus` paints on pointer click as well as keyboard. That is correct for a
   text field; the chrome buttons use `:focus-visible`.

---

## 7. Responsive and phone

### 7.1 Widths

The window is `96vw`; the stage is what remains after 236 + 296.

| Viewport | Window | Layout | Stage width | Notes |
|---|---|---|---|---|
| 1280 | 1228.8 | three columns | 696.8 | desktop default |
| 1024 | 983.0 | three columns | 451.0 | still above the 960 compact threshold |
| 861 | 826.6 | compact | 826.6 | desktop shell at 861; content is compact |
| 860 | 825.6 | compact | 825.6 | phone shell behind; the window box is unchanged |
| 720 | 691.2 | compact | 691.2 | add strip + inspector sheet |
| 520 | 499.2 | compact | 499.2 | same; the bar scrolls |
| 390 | 374.4 (366 saved) | compact | 374.4 | default CSS box; `windows.js` clamps a moved/resized box to viewport − 24 = 366 (`edit-window.md` §5.3) |

Height is `85vh` at every width (`style.css:6173`); the body is the window height minus the
191 px of header, bar and footer. The mockup screen is 980 px, so its windows are 833 high;
the body measures 640 inside the modal's 1 px border (642 by the row maths). At 860 and below the app shell switches to phone, but the designer window
keeps its 96vw box and the compact body; there is no designer-specific 860 rule.

### 7.2 Compact rules

Mermaid, `max-width: 960px` (`style.css:6560-6610`):

| Part | Rule |
|---|---|
| Body | column |
| Sidebar | full width; `max-height: 32vh`; row; horizontal scroll; padding 8 × 10; bottom hairline |
| Section | row |
| Add section | column; min-width 210, max-width 380; fields become a 2-column grid |
| Shape grid | 7 columns of at least 38 px; shape min-height 40 |
| Stage | `flex: 1 1 0`; min-height 180 |
| Inspector | full width; max-height 55 %; top hairline; min-height 44 |
| Grabber | shown; `aria-expanded`; collapsed = 44 px, head and body hidden |

DW, `.is-compact` (`style.css:6861-6922`) plus a viewport fallback block (`:6923-6940`):

| Part | Rule |
|---|---|
| Sidebar | hidden |
| Stage | column; main min-height 45 % |
| Card | max-width 100 %, max-height 70 % |
| Inspector | absolute bottom; hidden while the sheet is open or nothing is selected |
| Sheet | as §3.4 |

The non-scoped Mermaid strip keeps its older 720 rule (`style.css:6615-6632`): palette button
in a row, divider hidden. It does not apply to the six scoped families.

The Mermaid add section is a column only after E6. In the shipped cascade the strip's row rule
out-specifies it, so the tab strip collapses to two initials. E6 restates the same declaration
with the selector it needs.

### 7.3 390 behaviour

| Region | What happens |
|---|---|
| Window | 374 × 833, still a floating modal; the phone shell sits behind it |
| Sidebar strip | horizontal scroll; add section 210–380 wide; shape grid 7 columns |
| Stage | floor 180 px; the diagram fits or scrolls (DW) |
| Inspector | max 55 % of the 640 px body, i.e. ≤ 352; collapsed to 44 when closed |
| DW sheet | max 55 %, min 120, sits over the stage; head 36, body scrolls |
| Footer | wraps at 720: status on its own row, Cancel / Apply below (`style.css:8750-8754`) |

The compact rules are viewport-keyed even though `.designer-modal` declares
`container-type: inline-size` (`style.css:6174-6175`). A manually narrowed window at a wide
viewport therefore keeps three columns and clips. §10 P1 and §12 record this.

### 7.4 Touch targets

Shipped compact controls are 26–38 px: tabs, chips, fields 32, shape buttons 36–40, palette
button 34, glyph buttons 28, ruler cells 30 (`style.css:6274`, `:6339`, `:6290`, `:6313`,
`:6388-6391`, `:6794-6798`, `:6712`). This is below the 44 px coarse-pointer floor
(foundations §10.4). The current look is retained; §10 P2 records the targeted fix. No
control depends on hover for its existence: hit buttons are always in the DOM, and the
`+` lifelines are a vendor affordance inside Mermaid, not chrome.

---

## 8. Tokens and CSS target

### 8.1 Reuse before addition

The designers already consume foundation tokens. No alias layer is needed. The table names
each designer-local token and the foundation token it duplicates, or states why it stays.

| Designer token | Value | Foundation equivalent | Action |
|---|---|---|---|
| `--designer-space-1` | 4 | `--space-1` | Keep; §10 P3 |
| `--designer-space-2` | 6 | none (half-step) | Keep; shipped rhythm |
| `--designer-space-3` | 8 | `--space-2` | Keep; §10 P3 |
| `--designer-space-4` | 12 | `--space-3` | Keep; §10 P3 |
| `--designer-space-5` | 16 | `--space-4` | Keep; §10 P3 |
| `--designer-space-6` | 24 | `--space-6` | Keep; §10 P3 |
| `--designer-radius-sm` | 6 | `--radius-sm` | Keep; identical |
| `--designer-radius-md` | 8 | `--radius-md` | Keep; identical |
| `--designer-radius-pill` | 999 | `--radius-pill` | Keep; identical |
| `--designer-sidebar-w` | 236 | none | Keep; §10 P4 |
| `--designer-inspector-w` | 296 | none | Keep; §10 P4 |
| `--designer-field-h` | 32 | `--control-h-body` | Keep; identical value, one role |
| `--designer-ok` / `--designer-warn` | `--ok` / `--warn` | same | Keep; light block re-declares values (`style.css:6156-6161`) |
| `--designer-canvas-bg` | `#14151a` / `#f7f8fb` | canvas exemption | Keep |
| `--designer-grid` | accent at .12 / .14 | canvas exemption | Keep |
| `--designer-grid-size` | 24px | none | Keep |
| `--designer-modal-w` | 1320px | none | Keep |
| `--designer-modal-h` | 85vh | none | Keep |
| `--dw-edge-hit` | 14px | none | Keep |
| `--dw-sel-width` | 2px | `--stroke-2` | Keep |
| `--dw-hover-ring` | accent 45 % | none | Keep; a state wash, not a colour |
| `--dw-wavedrom-surface` | `#fff` | none | Keep; the library's light skin |

The mockup uses the same names with literal values. It does not alias a foundation token to
a designer token, and no token reference chain forms a cycle.

### 8.2 Values a coder must not round

| Value | Where | Why |
|---|---|---|
| Radius 7 px on `.designer-add` | `style.css:6391` | Shipped; between `--radius-sm` and `--radius-md`. §10 P5 proposes 6 |
| Radius 5 px on DW shape buttons, 4 px on tracks/cells | `:6839`, `:6750`, `:6714` | Shipped; §10 P5 |
| Switch 34 × 18, knob 14, travel 16 | `:6359-6376` | Shipped; differs from the Settings 36 × 20. §10 P6 |
| Chip 26 px, min-width 34 | `:6339` | Shipped |
| Tab padding 5 × 4, `.78rem` | `:6274-6276` | Shipped |
| Add button padding 8 × 10, `.82rem` | `:6391` | Shipped |
| Ruler cell min 24 × 30, `.64rem` | `:6712-6716` | Measured grid alignment |
| Track cell 24 × 34 | `:6747` | Shipped |
| DW card max 90 % × 78 %, padding 14 × 16 | `:6654-6655` | Shipped |
| Sheet head 36, grabber 38 × 4 | `:6892-6898` | Shipped |

### 8.3 CSS landing order

If any rule below is added, it goes after the existing designer block, in this order:

1. Token declarations stay where they are (`style.css:6138-6169`); no new tokens.
2. Selector fixes and missing declarations append after the rule they correct: shared
   additions after `style.css:6555`; E6 after the row rule at `:6575`.
3. `#dw-designer-overlay` fixes append after `style.css:6940`.
4. Reduced-motion twins sit next to the rule they disable.
5. No existing declaration is reordered. No literal outside the token blocks.

### 8.4 Exceptions — accessibility and consistency only

Seven corrections. They are applied fixes, listed here because the shipped CSS omits or
contradicts them; the mockup shows the corrected look. Four are semantic; E1, E3, E6 and E7
change a box, border or face, and are the only pixel deltas in this pass. The pass also
inherits the foundation light `--warn`/`--ok` and modal-shadow values.

**E1 — `.designer-select` has no rule.** Graphviz and WaveDrom build every select with
`className = "designer-select"` (`dot-designer.js:138`, `wavedrom-designer.js:90`), and no such
rule exists. The result is a browser-default select beside themed fields. Give it the field
box:

```css
.designer-select {
  width: 100%; height: var(--designer-field-h); min-width: 0;
  padding: 5px 8px; border: 1px solid var(--border-strong);
  border-radius: var(--designer-radius-sm);
  background: var(--code-bg); color: var(--fg);
  font: inherit; font-size: .84rem;
}
.designer-select:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
```

**E2 — `.designer-chips` has no rule.** DOT's direction group
(`dot-designer.js:1414-1445`) uses it; Mermaid uses `.designer-direction`. Mirror the shipped
row so the five pills have gaps and wrap:

```css
.designer-chips { display: flex; flex-wrap: wrap; gap: 4px; }
```

**E3 — Control boundaries below 3:1.** `.designer-field` and `.designer-switch-track` use
`--border` (`style.css:6291`, `:6366`): 1.39:1 dark, 1.27:1 light on the field face. Change the
border to `--border-strong` (4.03 / 3.64 on panel). Geometry and focus stay identical. This is
a visible change: a slightly stronger outline.

```css
.designer-field, .designer-select { border-color: var(--border-strong); }
.designer-switch-track { background: var(--border-strong); }
```

**E4 — Error banner text below 4.5:1.** `.designer-alert` paints `--danger` on
`--danger-soft` (`style.css:6417-6418`), about 3.7:1 in both themes. Keep the danger border and
move the text to `--text-primary`; the `×` inherits.

```css
.designer-alert { color: var(--text-primary); }
.designer-alert-msg { color: var(--text-primary); }
```

**E5 — DOT add tabs are incomplete.** The tablist has roles but no roving tabindex and no
key handler (`dot-designer.js:1311-1328`), and `#dw-add-form` is not a tabpanel
(`templates/index.html:1663-1669`). Copy the Mermaid contract: `tabindex="-1"` on the inactive
tab, `aria-controls="dw-add-form"`, `role="tabpanel"` plus `aria-labelledby` on the form, and
the same Arrow/Home/End/Enter handler (`mermaid-designer.js:1452-1472`). No visual change.

**E6 — the compact add section is forced back to a row.** The compact block first sets
`.designer-modal[data-designer-family] .designer-sidebar .designer-section { flex-direction:
row }` (`style.css:6572-6575`) and then `.designer-modal[data-designer-family]
.designer-section--add { flex-direction: column }` (`:6580-6582`). The first selector carries
`.designer-sidebar`, so it is more specific and wins. At 720 the add section becomes a row and
its tab strip collapses to about 40 px, showing “N…” and “E…”. Re-assert the intended column
with the specificity it needs, after the row rule:

```css
.designer-modal[data-designer-family] .designer-sidebar .designer-section--add {
  flex-direction: column;
  align-items: stretch;
  min-width: 210px;
  max-width: 380px;
}
```

No value changes: this is the shipped declaration with the selector it needs. The mockup
shows the corrected strip.

**E7 — the danger button hover drops below 4.5:1.** `.designer-btn--danger:hover` paints
`--danger` on `--danger-soft` (`style.css:6243`), about 3.7:1 in both themes. The controls
record forbids a danger fill for the same measured reason. Keep the face and add an inset
1 px danger ring:

```css
.designer-btn--danger:hover {
  background: transparent;
  border-color: transparent;
  color: var(--danger);
  box-shadow: inset 0 0 0 1px var(--danger);
}
```

Hover only; the resting button and the click target do not change.

---

## 9. Acceptance criteria

Numbered, testable, and naming the file that proves it. "DOM" is `tests/dom/test_dom.js`;
"browser" is `tests/browser/test_designer_browser.js` or `test_dw_designer_browser.js`.

| # | Criterion | File | Observable |
|---|---|---|---|
| AC1 | The body is three regions in one row, with the shipped widths | `style.css` | At 1280 the sidebar computes 236, the inspector 296, the stage the remainder; the body does not scroll |
| AC2 | Every sidebar, stage and inspector surface uses the shipped tokens and literals in §8.2 | `style.css` | No new hex; the named literals are present; the token `comm` check stays clean |
| AC3 | Mermaid opens to ready with the type badge and status **Ready** | DOM `== mermaid designer ==` | `#designer-type` is non-empty; `#designer-status` reads Ready; Apply enabled |
| AC4 | The add tabs expose the tab contract | DOM, `mermaid-designer.js` | `role="tablist"`, one `tabindex="0"`, arrows and Home/End select, the panel is labelled by the active tab |
| AC5 | The add form validates before dispatch | DOM `== designer edit UI ==` | Submit disabled until the required fields are valid; `#designer-add-error` is `role="alert"`; a bad pie value never dispatches |
| AC6 | Selection fills the inspector and clears safely | DOM | Clicking a node sets **Node** + id; a structural edit clears or re-resolves; a rejected change restores the field and shows the error |
| AC7 | Chart controls write only their own line | DOM, `== designer bar controls ==` | A direction change replaces/inserts/removes `rankdir` (DOT) or `direction` (Mermaid); the pie header rewrite leaves every other byte identical; autonumber flips |
| AC8 | The canvas is focusable and named | DOM | `#designer-canvas` and `#dw-canvas` have `tabindex="0"`, `role="application"`, and an aria-label |
| AC9 | The non-editable Mermaid type shows the notice, not a preview-only state | DOM `:35795-35798` | `#designer-error` visible, Retry hidden, Edit source shown, `#designer-readonly` hidden |
| AC10 | WaveDrom's slice ruler and band track the selected signal | Browser `test_dw_designer_browser.js` | Clicking slice 3 selects cell 3 and paints one band; the meta reads `slice 3` |
| AC11 | The WaveDrom card is white in both themes | Browser | `.dw-card--wavedrom` computes `rgb(255, 255, 255)` |
| AC12 | The compact sheet moves the live section and restores focus | DOM `:39337-39359`, browser | `is-compact` → Add opens `#dw-compact-sheet` with the add section inside; close returns it to the sidebar and focuses the chip |
| AC13 | Apply is the only write and the order is fixed | DOM, browser | No-op Apply writes nothing; an edit writes one fence, calls `onContentChange` once, and one `Ctrl+Z` restores it |
| AC14 | Cancel, Esc and backdrop write nothing; a dirty close confirms | DOM, browser | No write; the confirm appears only when dirty; declining keeps the window |
| AC15 | Focus returns to the invoker, or the block when the invoker is gone | DOM `:35769` | `document.activeElement` is the block after close |
| AC16 | The alert banner is dismissible and does not replace the canvas | DOM | `#designer-alert` has `role="alert"`, the `×` hides it, the last good canvas remains |
| AC17 | The compact layouts match §7 | Browser, mockup | 720 shows the strip and the inspector grabber; 390 shows the DW sheet; no horizontal page scroll |
| AC18 | The mockup is self-contained | `diagram-designers-mockup.html` | Opening it offline shows dark and light boards with zero network requests |

---

## 10. Proposals, not applied

Visual or structural changes. None is in the mockup, none is in §8.4. Each needs the owner's
agreement because the shipped look is the reference.

| # | Proposal | Reason | Cost |
|---|---|---|---|
| P1 | Replace the two `@media (max-width: 960px)` blocks and the DW `matchMedia` check with `@container designer (max-width: 960px)` plus a `ResizeObserver` for `.is-compact` | The window is resizable to 320 px; viewport-keyed compact rules clip a narrow window on a wide screen | Two CSS blocks, one JS observer; must retest compact sheets |
| P2 | In the phone shell, raise compact designer targets to 44: tabs, chips, fields, shape buttons, glyph buttons, slice cells | Current 26–38 px is below the coarse floor | Layout grows; the 720 strip needs more rows |
| P3 | Delete the `--designer-space-*` tokens and read `--space-*`; snap 6 → 4/8 and 7 px gap → 8 | One spacing scale | Reflows the sidebar by a few px |
| P4 | Promote the sidebar and inspector widths to shared component tokens (`--designer-sidebar-w`, `--designer-inspector-w` already exist; add a compact fallback) | Two windows and a future resize handle need one source | Naming only |
| P5 | Snap 7 px → 6 and 5 px → 4 radii | Foundation radii | Small visual change on the add button and DW shapes |
| P6 | Unify the designer switch with the Settings contract: 36 × 20, 16 px knob, 20 px travel | One switch in the product | Visible; changes the Mermaid chart row |
| P7 | Add `title` to every icon-only control that lacks one (`#designer-inspector-clear` has one; the DW sheet close has one) and audit `aria-label` parity | Foundation §9.1 | Markup only |
| P8 | Give the Mermaid canvas a visible keyboard path: arrow keys cycle entities and Enter focuses the inspector | Canvas entities are pointer-only today | New key model; conflicts with vendor keys on the canvas |
| P9 | Replace the native `confirm()` dirty guard with the shared dialog | Consistency with Settings and Workspaces | A new dialog surface in the modal; risk of a second trap |
| P10 | Show the current slice number in the band or ruler for screen readers as a live region | The ruler announces selections, but the band itself is `aria-hidden` | One `aria-live` line; may be noisy while typing |
| P11 | A pressed icon button uses an `--accent-soft` face and an accent glyph instead of the filled accent | `style.css:6216-6218` fills; controls.md §2.2 says a toggle is never filled | Visible; changes the Select and Connect on-state |
| P12 | Designer focus rings move from the shipped 1 px offsets to `--focus-offset` (2) / `--focus-offset-inset` (−2) | Foundations §10.2 | Cosmetic; every control needs a re-check |
| P20 | Clamp the WaveDrom slice band's cell width to the same 24 px minimum as the ruler | The band drifts on a narrow card | One `Math.max` |
| P14 | Make the compact sheet close button a 44 × 44 target | It is ≈26 px today | Phone-only; visible |
| P13 | Give the Graphviz designer card the same white face as the WaveDrom card in both themes | Graphviz ink is black; the card is `--bg-panel`. Black on the dark panel is ≈1.3:1, so edges and edge labels disappear in the dark theme. The reader's `.viz-container` has the same problem, owned by `content-blocks.md` | A white card in the dark stage; the note card must change with it or the two disagree |

---

## 11. What not to build

| Rejected | Reason |
|---|---|
| A fourth region, or a resizable sidebar/inspector | The window is already resizable; the body must stay three regions (§1) |
| A second palette or a shape library beyond the 14 `addNode` shapes | The model exposes 14; §10 of the product scope defers a stencil library |
| A custom canvas with drag-positioned nodes | Mermaid has no coordinate syntax (`mermaid-designer.md` goal) |
| Restyling the vendor SVG (node fill, stroke, font) | Selection is HTML chrome; the SVG is the renderer's output (`dot-wavedrom-designer.md` D6) |
| A different selection colour for node vs edge vs slice | Accent is the one selection colour; kind is carried by the head text and glyph |
| Persisting the inspector width, the active add tab or the sheet height | Not a user decision today; the window geometry is persisted, the panel state is not |
| A source pane inside the window | Source editing is the existing fallback (`Edit source instead`); a second editor would need its own Apply |
| A "Preview only" state in Mermaid | The shipped code routes to the non-editable notice (§4.1); the markup is dead |
| A filled danger button | The shipped delete is ghost-danger (§2.5); controls.md §8 keeps danger unfilled |
| A custom tooltip for shape buttons | `title` is shipped and announced; no tooltip component exists |
| An entrance animation on the window or inspector | Foundations §7.4 |
| A new breakpoint or a container-query layout outside P1 | Foundations §8.2; designers use 960 and 720 only |
| A third theme or theme-specific geometry | Foundations §3, P4 |

---

## 12. Unsettled

1. **Compact threshold and resizing.** P1 decides whether compact follows the viewport or the
   window. Until it lands, a 320 px window on a 1280 px screen clips. The CSS already declares
   a container; JS does not read it.
2. **Phone target sizes.** P2 decides whether the designer becomes a 44 px surface on touch.
   The 720 strip grows by a row; the 390 sheet's seven shape columns at 44 px need 338 px of a
   350 px body before the Add button, so it needs its own scroll or a shorter grid.
3. **Mermaid canvas keyboard path.** P8 would add a key model that the vendor does not expose.
   It needs a real-browser spike before it is specified.
4. **DOT/WaveDrom read-only entry.** The menu item is disabled for render-only sources, so the
   read-only state is reachable only through a stale capability. The state is kept because the
   shell supports it; whether the menu should open it is a product decision, not a design one.
5. **Sheet height at 390.** The sheet and the inspector each take up to 55 %. With the
   180 px stage floor they cannot all be open at once. The mockup shows the sheet open and the
   inspector hidden (the shipped rule); the reverse case is the same rule with the selection
   restored.
6. **Graphviz in the dark theme.** The designer and the reader both paint Graphviz's black
   ink on `--bg-panel`. P13 is the candidate fix; it changes the note card too, so it needs one
   decision for both surfaces, not two.
