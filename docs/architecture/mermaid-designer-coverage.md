# Mermaid visual designer — per-type add coverage

Status: current as of 2026-10-10. Owner: `web-engineer`.
Scope: what the **add-sidebar** in the visual Mermaid editor
(`static/js/mermaid-designer.js`, `templates/index.html`,
`static/css/style.css`) exposes for each of the 23 diagram types the
vendored Visimer library parses, and what the canvas itself can do.

Source tags used below:

- **[scan]** — the verified capability scan supplied with the add-sidebar
  work (all 23 types; 22 `capability:"edit"`, `zenuml` render-only).
- **[bundle]** — verified directly against `static/vendor/visimer.bundle.js`
  through its public API only (`MermaidWysiwygEditor.dispatch`,
  `MermaidCanvasView.addNode`); re-run with a throwaway Node harness against
  the real bundle, no bundle edit.
- **[impl]** — the behaviour coded in `static/js/mermaid-designer.js`.

## Constraint

No vendored file changed and no new library export was added. Every add action
uses the public API only: `view.addNode(shape)` for flowchart shapes and
`editor.dispatch(op)` for the structured families. The view subscribes to
`editor.on("change")` and re-renders, so a dispatch from our UI redraws the
canvas.

## Coverage table

`drag-connect` is the library's drag-from-handle edge tool; it is wired only
for the entity prefixes `node:` / `state:` / `class:` / `entity:` **[scan]**.
`select/edit/delete` is the canvas model editing the library exposes for every
`edit` type; the add column is what our sidebar shows.

| Type (id) | Core capability | Canvas interaction | Add-sidebar action |
| --- | --- | --- | --- |
| `flowchart` / `graph` | edit | select/edit/delete; drag-connect **yes** (`node:`); add | **14-shape grid** → `view.addNode(shape)` **[scan][impl]** |
| `sequence` | edit | select/edit/delete; drag-connect no — lifeline **+** buttons add messages/events **[scan]**; add | **Add participant** → `{type:'seq.addParticipant', name}` **[scan][bundle][impl]** |
| `class` | edit | select/edit/delete; drag-connect **yes** (`class:`); add | **Add class** → `{type:'cl.addClass', name}` **[scan][bundle][impl]** |
| `state` | edit | select/edit/delete; drag-connect **yes** (`state:`); add | **Add state** → `{type:'st.addState', label}` **[scan][bundle][impl]** |
| `er` | edit | select/edit/delete; drag-connect **yes** (`entity:`); add | **Add entity** → `{type:'er.addEntity', name}` **[scan][bundle][impl]** |
| `gantt` | edit | select/edit/delete; drag-connect no; add | **Add task** → `{type:'gantt.addTask', section, name, meta}` **[scan][bundle][impl]** |
| `pie` | edit | select/edit/delete; drag-connect no; add | **Add slice** → `{type:'pie.addSlice', label, value}` **[scan][bundle][impl]** |
| `journey` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `quadrant` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `requirement` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `gitgraph` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `c4` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `mindmap` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `timeline` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `sankey` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `xychart` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `block` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `packet` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `kanban` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `architecture` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `radar` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `treemap` | edit | select/edit/delete; drag-connect no; add | **Add line** → `{type:'li.addItem'}` **[scan][bundle][impl]** |
| `zenuml` | **render only** | none — canvas is not editable | **none** — no sidebar; the existing "can't be edited visually" notice shows with **Edit source instead** **[scan][impl]** |

## Sidebar layout

The add-sidebar (`#designer-sidebar`) is a column of three sections with
dividers **[impl]**: **Tools** (Select / Connect icon buttons, `aria-pressed`
from the canvas `toolChange` event) → divider → **Add** (the palette, title
`#designer-add-title`) → divider → **History** (Undo / Redo icon buttons,
`disabled` from `canUndo`/`canRedo`). The top-of-canvas `#designer-toolbar` was
removed; its controls moved here. Tools and History appear with the sidebar,
i.e. in the ready state for a family with an add action; every editable family
has one, so there is no ready state that shows Tools/History without the Add
palette. Connect stays hidden for families the canvas cannot drag-connect
(only `flowchart` / `state` / `class` / `er`); Select is always shown. Below
~720px the sidebar collapses to a horizontal scrollable strip.

## Flowchart shape grid

`view.addNode(shape)` accepts 14 shapes. Each grid button now shows an inline
SVG glyph of that shape over its short caption, so the shape is scannable at a
glance; the glyphs live in `SHAPE_GLYPHS` in `static/js/mermaid-designer.js`
(16×16 `viewBox`, `stroke: currentColor`, `fill: none`, `stroke-width: 1.5`,
round join/cap) and mirror the Mermaid outline. The visible caption and the
Mermaid syntax each produces (also the button `title`) were verified
**[bundle]** against the real `MermaidWysiwygEditor`:

| Shape id | Glyph | Caption | Syntax |
| --- | --- | --- | --- |
| `rect` | plain rectangle | Rect | `n1[N]` |
| `round` | rounded rectangle | Round | `n1(N)` |
| `stadium` | pill (full-radius ends) | Stadium | `n1([N])` |
| `subroutine` | rectangle + two inner borders | Subrtn | `n1[[N]]` |
| `cylinder` | cylinder (elliptical rim top/bottom) | Cylinder | `n1[(N)]` |
| `circle` | single circle | Circle | `n1((N))` |
| `doublecircle` | two concentric rings | Double | `n1(((N)))` |
| `diamond` | diamond | Decision | `n1{N}` |
| `hexagon` | hexagon | Hexagon | `n1{{N}}` |
| `lean_r` | parallelogram leaning right | Lean R | `n1[/N/]` |
| `lean_l` | parallelogram leaning left | Lean L | `n1[\N\]` |
| `trap_t` | trapezoid, wide top | Trap T | `n1[\N/]` |
| `trap_b` | trapezoid, wide bottom | Trap B | `n1[/N\]` |
| `odd` | asymmetric pennant (left point) | Odd | `n1>N]` |

Non-flowchart add buttons keep their action and pairing (`editor.dispatch`)
and now carry a small `+` glyph plus their label **[impl]**.

Flowchart uses `view.addNode` (not `dispatch`) because the view opens the
inline label editor on the new node **[bundle]**.

## Family detection

The sidebar family comes from `editor.result` (the non-null graph object:
`flowchart`, `sequence`, `state`, `classGraph`, `er`, `pie`, `gantt`, or
`lineItems` for the generic line-item family), with `typeInfo.id` as fallback
**[impl]**. `graph` is detected as the flowchart family **[bundle]**. The
sidebar is shown only in the ready state and only when the family has an add
action **[impl]**.

## Hard limits

1. **`zenuml` has no add action.** The library reports `capability:"render"`,
   so the designer shows its non-editable notice and the sidebar stays hidden.
   Use **Edit source instead**. **[scan][impl]**
2. **Sequence messages are not in the sidebar.** Participants are added from
   the sidebar (`seq.addParticipant`), but messages/events are added through
   the library's own lifeline **+** buttons, which the canvas already renders.
   **[scan]**

The single-action defaults (`stateLabel`, `className`, `entityName`,
`sliceLabel`/`sliceValue`, gantt `name`/`meta`, `participantName`) live in
`ADD_DEFAULTS` in `static/js/mermaid-designer.js`; the line-item button omits
`text` so the library's per-type `addTemplate` supplies the line. Every field
is optional to the library **[bundle]**.

## Verification

- `node /tmp/opencode/verify-palette.js` (throwaway, real bundle in Node):
  14/14 cases — each family detects correctly, each op changes the source,
  `zenuml` detects no family.
- `node /tmp/opencode/verify-shapes.js`: 14/14 shapes produce the syntax
  column above.
- `node /tmp/opencode/verify-designer-glyphs.js` (throwaway): the 14
  `SHAPE_GLYPHS` inner markups are pairwise distinct and each flow-button id
  maps to `view.addNode(<same id>)`.
- `node --check static/js/mermaid-designer.js`: pass.
