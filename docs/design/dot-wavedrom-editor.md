# Graphviz and WaveDrom design windows — edit UI

**Status:** Design only. No source, template, or test files were changed.
**Date:** 2026-10-20
**Owner:** `ui-designer`
**Mockup:** `docs/design/dot-wavedrom-editor.html`

Related documents:

- `docs/product/dot-wavedrom-design-window.md` — the product definition, in
  progress. This design assumes its v1 shape and marks every open point inline.
- `docs/design/mermaid-editor.md` — the modal shell, tokens, three-region body,
  compact layout, states, and a11y patterns this design reuses.
- `docs/design/settings-modal.md` — the shared modal language and the scoped
  `--fg-muted` override.
- `docs/design/mermaid-editor.html` — the mockup form and CSS structure.
- `docs/architecture/mermaid-designer.md` — the write-back order and the
  `editPluginSource` fallback this design mirrors.
- `static/js/viz.js`, `static/js/wavedrom.js` — the rendered SVG these windows
  select inside.
- `static/js/blocks.js`, `static/js/hybrid.js:5172-5183` — the block descriptor,
  `pluginTypes()`, and the existing design menu entry.

This document is **normative** for the two new edit windows. The mockup
illustrates it; where they disagree, this document wins. It does not change the
Graphviz or WaveDrom renderers, the note write-back, or the entry point.

---

## 1. Goal and scope

The rendered **```dot / ```graphviz** block (`.viz-container`) and the rendered
**```wavedrom** block (`.wavedrom-container`) get their own right-click entry:
**Design graph…** / **Design timing…** opens `#dw-designer-overlay`, carrying
the editor for that language.

Both editors are **modal visual editors over the block's current source**:

- a rendered stage built from that source,
- a contextual inspector for the selected node, edge, signal, slice, or data
  label,
- an **Add** form for new items,
- **Edit source instead**, which closes the window and hands the block to the
  existing inline fence editor,
- **Cancel** / **Apply** in the footer, with validation errors shown in-window.

The note is untouched until Apply. The block keeps its fence language and its
other lines.

### 1.1 What each window edits

| Language | Canvas entities | Inspector modes | Add |
| --- | --- | --- | --- |
| Graphviz (`dot`, `graphviz`) | nodes, edges | Node, Edge | Add node, Add edge, direction |
| WaveDrom (`wavedrom`) | signals, slice ruler, data labels | Signal (optionally slice-scoped), Data label | Add signal |

> **Assumption (product spec open):** v1 is a **line-local** editor, not a full
> parser round-trip.
>
> - Graphviz: only the selected node/edge statement and the `rankdir` line are
>   rewritten. Comments, blank lines, default-attribute lines, and every
>   untouched statement stay byte-identical.
> - WaveDrom: the source is parsed to a JavaScript object and serialized back
>   as strict JSON on the first edit. Keys the editor does not edit (`head`,
>   `foot`, `groups`, `edge`, unknown keys) are preserved. Formatting changes
>   when any edit is applied; opening and applying with no edit writes nothing.
>
> If the product spec requires byte-identical WaveDrom formatting after an
> edit, this design needs a JSON-preserving writer. That is a dependency, not a
> UI change.

### 1.2 Scope rule

The windows exist only when:

1. the block is a rendered `dot`/`graphviz` or `wavedrom` block in **hybrid**
   mode,
2. the user is admin (or auth is off), matching the Mermaid designer gate,
3. the plugin descriptor opts in with a `design` module, and
4. the block's source is in a supported shape (see §6.1 and §7.1).

Preview mode, the lightbox, and the export pipeline are unchanged. A
`dot`/`wavedrom` block in preview mode has no visual editor entry.

---

## 2. Design intent

- **Canvas first, inspector second.** The rendered diagram stays the largest
  region. The inspector is a narrow, scrolling column beside it.
- **One item, one named inspector.** Selecting a node, edge, signal, slice, or
  data label opens the inspector with every required edit for that item. No
  required edit lives in a hover popover or a hidden gesture.
- **The diagram is not recolored.** Graphviz and WaveDrom own their SVG colors.
  Selection is drawn **outside** the SVG (overlay chrome), on top of the
  diagram, so the preview still matches the note.
- **The wave editor is legible without the notation.** Cells show the character
  and a miniature waveform glyph; a palette and a one-line readout explain the
  selected slice. The text field remains the authoritative value.
- **Calm, shared chrome.** Reuse the designer shell: header, type badge,
  sidebar, inspector, footer, status, banner, error/loading/read-only states,
  focus trap. No new fonts or icons.
- **Source is always one click away.** The visual editor is a convenience, not a
  prison. "Edit source instead" is available in the ready state and is the
  primary action in every read-only/error state.
- **Restraint.** No Graphviz attribute sheet and no WaveDrom timing IDE. See
  §11.

---

## 3. Shared shell

### 3.1 Regions

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header   Design graph / Design timing   [GRAPHVIZ] / [WAVEDROM] ×    │
├──────────────────┬──────────────────────────────┬────────────────────┤
│ Build sidebar    │ Stage                        │ Inspector          │
│ 236px            │ dot grid + diagram card      │ 296px              │
│                  │                              │                    │
│ Add              │   ┌──────────────────────┐   │ Node · flask       │
│  tabs + form     │   │  rendered SVG        │   │ Label  [________]  │
│ Chart (if any)   │   └──────────────────────┘   │ Shape  [grid]      │
│ Edit source      │                              │ Style  [select]    │
│ ─────────        │   hint pill (no selection)   │ Actions            │
│ History (sticky) │   slice ruler (WaveDrom)     │                    │
├──────────────────┴──────────────────────────────┴────────────────────┤
│ Footer   Unsaved changes                    Cancel    Apply          │
└──────────────────────────────────────────────────────────────────────┘
```

The implemented Graphviz/WaveDrom window is a **sibling**
`#dw-designer-overlay.settings-overlay` → `.settings-modal.designer-modal`,
not the Mermaid `#designer-overlay`. Mermaid keeps its own overlay and ids; the
new overlay mirrors the same shell structure with `#dw-*` ids:

| Id | Use in these windows |
| --- | --- |
| `#dw-title`, `#dw-type` | Per-block title and `Graphviz` / `WaveDrom` badge. |
| `#dw-sidebar` | Add, Chart, source fallback, History. |
| `#dw-add-tabs`, `#dw-add-form`, `#dw-add-fields` | Per-language add forms. |
| `#dw-chart` | Direction chips (dot) or time scale (WaveDrom). |
| `#dw-canvas`, `#dw-stage-scroll`, `#dw-diagram-card` | Stage, shared ruler/card scroll container, diagram card. |
| `#dw-overlay-layer`, `#dw-slice-band` | Hit/selection chrome and WaveDrom slice band. |
| `#dw-slice-ruler` | WaveDrom slice ruler above the card. |
| `#dw-empty`, `#dw-loading`, `#dw-error`, `#dw-readonly` | Mutually exclusive states. |
| `#dw-alert` | Non-blocking Apply/live-preview failure. |
| `#dw-inspector` | Node / Edge / Signal / Data label inspector. |
| `#dw-status`, `#dw-cancel`, `#dw-apply` | Footer. |
| `#dw-undo`, `#dw-redo` | History. |

Per-block vocabulary is part of the shell contract: Graphviz uses
**Design graph…** / **Design graph** / noun **graph**; WaveDrom uses
**Design timing…** / **Design timing** / noun **waveform**; Mermaid keeps
**Design diagram…** / **Design diagram**.

### 3.2 Dimensions

Identical to `mermaid-editor.md` §3.2:

| Region | Value |
| --- | --- |
| Modal | `min(1320px, 96vw)` × `min(85vh, 92vh)` |
| Header | `padding: 14px 18px`; title 1.14rem/600 |
| Build sidebar | `flex: 0 0 236px`; `padding: 12px 10px`; gap 10px |
| Stage | `flex: 1 1 auto; min-width: 0` |
| Inspector | `flex: 0 0 296px`; header 48px; body `padding: 12px` |
| Footer | `padding: 12px 18px`; gap 8px |
| Field / button height | 32px / 30px |
| Radii | 6px fields and buttons, 8px cards, 999px pills |

The inspector body has `min-width: 0` and scrolls. Long node labels wrap in
fields and truncate in the inspector header with a `title`.

### 3.3 The stage card (new)

The Mermaid editor draws its SVG directly on the dot-grid stage. Graphviz and
WaveDrom need their **note surface** instead:

- **Graphviz** renders on `--bg-panel`, matching `.viz-container`.
- **WaveDrom** renders on **white** (`--dw-wavedrom-surface: #fff`), matching
  `.wavedrom-container`. WaveDrom's SVG embeds its own light skin and does not
  follow the app theme; the editor must not try to theme it.

Structure:

```html
<div id="dw-canvas" class="designer-canvas dw-stage" tabindex="0" ...>
  <div class="dw-stage-scroll" id="dw-stage-scroll">
    <div class="dw-slice-ruler" id="dw-slice-ruler" role="listbox"
         aria-orientation="horizontal" hidden></div>
    <div class="dw-card dw-card--dot" id="dw-diagram-card">
      <!-- the vendored renderer's <svg> goes here -->
      <div class="dw-overlay" id="dw-overlay-layer"></div>
    </div>
    <div class="dw-slice-band" id="dw-slice-band" hidden></div>
  </div>
  <p class="designer-hint" id="dw-hint" hidden></p>
</div>
```

- The card is centered, `max-width: 90%`, `max-height: 78%`, padding 14px 16px,
  1px `--border`, radius 8px. It never scrolls horizontally; the SVG scales to
  fit via its existing `max-width` / `aspect-ratio` rules.
- The overlay is `position: absolute; inset: 0; pointer-events: none`. Each hit
  target and each selection ring re-enables `pointer-events: auto` on itself.
- The hint pill sits below the card, centered, as in the Mermaid editor. It is
  hidden when an item is selected.
- The WaveDrom slice ruler sits above the card, aligned to the rendered
  waveform's time grid. It is measured from the SVG after render and on resize
  (`ResizeObserver`); it is not a second, independently laid-out chart.
- The card has no zoom/pan in v1. The lightbox remains the zoom path outside
  the modal. See §11.

### 3.4 Responsive behavior

Use the same breakpoint and the same shape as the implemented Mermaid editor:
`@media (max-width: 960px)` inside the designer scope. Do not mix a container
query and a media query.

| Width | Layout |
| --- | --- |
| > 960px | Sidebar 236 + stage + inspector 296. |
| ≤ 960px | Build **strip** 48px above the stage; inspector becomes a **bottom sheet** inside the stage. |

- The strip shows `[Add] [Chart] [Source] [Undo] [Redo]` as icon buttons with
  `title` + `aria-label`. It scrolls horizontally when needed. `aria-pressed`
  where a button represents a mode.
- Tapping **Add** or **Chart** opens the sheet with that form. Selecting a
  canvas item opens the same sheet with the inspector. The sheet body is capped
  at 55% of the stage height; it scrolls.

The implemented build sheet is `#dw-compact-sheet` →
`#dw-compact-sheet-body`, with `#dw-sheet-close` and a
`.dw-sheet-grabber`; `.is-sheet-open` marks the open state. Add/Chart move
their existing section into the sheet and move it back on close, so ids,
listeners, and model state survive. Only one sheet (build or inspector) is
open at a time.
- The WaveDrom wave editor inside the sheet: the cell track scrolls
  horizontally; the glyph palette wraps to the sheet width; the track keeps its
  fixed 24px cells so time stays readable.
- The stage keeps at least 45% of the body height when the sheet is open. The
  diagram card shrinks, never disappears.
- The footer stays outside the stage and always visible. At ≤ 480px the status
  wraps above Cancel/Apply, matching the existing designer footer rule.
- The slice ruler scrolls horizontally with the card when the WaveDrom SVG is
  wider than the stage; the two share one scroll container.

### 3.5 Scroll ownership

- Sidebar: scrolls; **History is sticky at the bottom** with a top border.
- Inspector: fixed header (48px), scrolling body.
- Footer: fixed outside the body.
- Stage: the card fits; the WaveDrom ruler can scroll horizontally in compact
  mode. No vertical stage scrollbar.

---

## 4. Tokens

Reuse the designer block from `mermaid-editor.md` §4 (`--designer-space-*`,
`--designer-radius-*`, `--designer-sidebar-w`, `--designer-inspector-w`,
`--designer-field-h`, the scoped `--fg-muted`, `--designer-ok`,
`--designer-warn`). Add only these component tokens:

```css
#designer-overlay,
#dw-designer-overlay {
  /* WaveDrom character track. Fixed cells keep time aligned; the track
   * scrolls horizontally rather than wrapping. */
  --dw-wave-cell-w: 24px;
  --dw-wave-cell-h: 34px;
  --dw-wave-cell-gap: 2px;

  /* Transparent hit stroke around a Graphviz edge. Wide enough for a
   * pointer, thin enough to leave adjacent edges separately clickable. */
  --dw-edge-hit: 14px;

  /* Selection chrome drawn outside the SVG. */
  --dw-sel-width: 2px;
  --dw-sel-offset: 3px;

  /* The note's WaveDrom card is white in both app themes (the library's
   * SVG carries a light skin). The editor reproduces that card, not the
   * dot grid. */
  --dw-wavedrom-surface: #fff;
}
```

| Role | Token |
| --- | --- |
| Modal / sidebar / inspector surfaces | `--bg-panel`, `--bg-elev` as in Mermaid |
| Diagram card (dot) | `--bg-panel` |
| Diagram card (WaveDrom) | `--dw-wavedrom-surface` (constant `#fff`) |
| Field well | `--code-bg` |
| Primary text | `--fg` |
| Secondary text | scoped `--fg-muted` |
| Hairline | `--border` |
| Selection and focus | `--accent`, `--accent-soft`, `--accent-fg` |
| Error / warning | `--danger`, `--danger-soft`, `--designer-warn` |
| Success status | `--designer-ok` |

No new colors. The WaveDrom white card is not a theme color: it is the
existing `.wavedrom-container` background, reproduced exactly.

---

## 5. Shared components

### 5.1 Selection chrome

All selection chrome is HTML in `.dw-overlay`, positioned from
`getBoundingClientRect()` after the SVG renders and after every re-render or
resize. The SVG itself is never restyled.

| Selection | Chrome | Non-color cue |
| --- | --- | --- |
| Graphviz node | Rounded ring around the node bbox, `--dw-sel-width` accent, offset `--dw-sel-offset`, plus a small type pill above it. | Pill says `Node`; inspector header names the node. |
| Graphviz edge | Accent clone of the edge path (`fill: none; stroke: --accent; stroke-width: 2.5`), plus a type pill at the path midpoint. | Pill says `Edge`; inspector header names both endpoints. |
| WaveDrom signal | Full-row band `--accent-soft` at 12% opacity with a 2px left rail, plus a type pill at the row's left. | Pill says `Signal`; inspector header names it. |
| WaveDrom slice | Vertical band `--accent-soft` from the ruler down through the waveform, 2px accent edges; ruler cell gets `aria-selected="true"`. | Ruler shows the slice number; inspector meta says `slice 4 of 9`. |
| WaveDrom data label | Rounded accent box behind the label text (8px radius), with a 1px accent outline; type pill `Data label`. | Pill and inspector header. |

Rules:

- The type pill is `.designer-sel-badge` with the same 18px height, 7px side
  padding, accent border/text. It is `aria-hidden` decoration; the live region
  carries the announcement.
- The edge hit path is a transparent clone of the visible path with
  `stroke: transparent; stroke-width: var(--dw-edge-hit); fill: none;
  pointer-events: stroke`. It is inserted inside the edge group, above the
  visible stroke. It never covers a node: `.node { pointer-events: all }` and
  node groups paint above edges.
- Hover uses the same chrome at 45% opacity, no type pill. Focus uses a 2px
  accent ring offset 2px, independent of selection.
- Selection never changes the rendered diagram's fill, stroke, or text color.
- Do not add a full-canvas tint or a second competing highlight.

### 5.2 Type badge

The header uses `Design graph` (Graphviz) or `Design timing` (WaveDrom) and
sets `#designer-type` to `Graphviz` or
`WaveDrom`. The header also carries the language's short hint:

- Graphviz: `Select a node or edge to edit it`.
- WaveDrom: `Select a signal to edit its wave`.

The badge is uppercase .66rem, 20px pill, as in the Mermaid editor.

### 5.3 Fields, buttons, tabs, chips

Reuse `mermaid-editor.md` §5.1-§5.5 with no changes:

- `.designer-btn`, `--commit`, `--primary`, `--danger`, `--ghost`
- `.designer-field`, `.designer-select`, `.designer-field-label`,
  `.designer-field-error`
- `.designer-tabs` / `.designer-tab`
- `.designer-shape` shape grid (dot only; 2 columns in the sidebar, 3 in the
  inspector)
- `.designer-chips` (dot direction)
- `.designer-switch` (not used by v1; kept for parity)

Only **Apply** uses the solid accent fill. Add buttons use `--commit`.

### 5.4 Source fallback

**Copy:** `Edit source instead`
**Helper (under the button):** `Closes this window and opens the block’s Markdown.`

Placement:

1. **Ready state:** a ghost block button at the bottom of the build sidebar,
   directly above the divider and **History**. Class
   `.designer-btn .designer-btn--ghost .designer-btn--block .dw-source`.
   In compact mode it collapses to a source-code icon button in the strip with
   `title` / `aria-label="Edit source instead"`.
2. **Error, read-only, and unsupported states:** the same button appears in the
   state's action row, beside or in place of Retry, exactly where the Mermaid
   error state puts it.
3. It is **not** in the footer. The footer belongs to Cancel/Apply; adding a
   third verb there would compete with the primary action.

Behavior:

- Clean: close the modal without writing, restore focus to the block, then call
  the existing `editPluginSource(hit)` path.
- Dirty: run the same discard guard as Cancel, then close and open the source
  editor only if the user confirms.
- From an error/read-only state: never dirty, never prompts.

> **Assumption (product spec open):** the product draft may put the fallback
> only on the error screen. This design keeps it reachable in the ready state
> too, because Graphviz has many constructs v1 does not model. If the spec
> disagrees, move it; do not remove it.

### 5.5 Status, hint, banner

Reuse `mermaid-editor.md` §5.8 and §5.9.

| Element | Copy |
| --- | --- |
| Status ready | `Ready` |
| Status dirty | `Unsaved changes` |
| Status applying | `Applying…` |
| Status no-op | `No changes to apply` |
| Status failure | `Couldn’t apply — invalid Graphviz source` / `…invalid WaveDrom source` |
| App alert | `This source can’t be rendered. Fix the marked item, or use Edit source instead.` |
| Empty dot | `Add your first node.` |
| Empty wave | `Add your first signal.` |
| Hint dot | `Select a node or edge to edit it · double-click a node to rename` |
| Hint wave | `Select a signal to edit its wave · use the ruler to pick a slice` |

Open-time failures use the full-canvas `#designer-error` state. Apply and
live-preview failures use the non-blocking `#designer-alert` banner; the canvas
and inspector stay usable.

---

## 6. Graphviz editor (`dot`, `graphviz`)

### 6.1 Editor model and source mapping

The visual model is built from the source at open time. It covers the common
statement subset:

- graph header: `digraph`/`graph`, optional `strict`, optional name, `{` … `}`;
- graph attributes: `rankdir=TB|LR|BT|RL` (first occurrence wins);
- node statements: `id [attr=value, …];` on one line;
- edge statements: `a -> b [attr=value, …];` or `a -- b` on one line;
- quoted IDs and quoted attribute values;
- blank lines, indentation, and untouched statement text are preserved
  verbatim. Comments (`//`, `/* */`, `#`) make the block source-only, because
  a strict-JSON/line-preserving edit cannot re-emit them safely.

Edits are **line-local**:

| Action | Write |
| --- | --- |
| Rename label | Replace/add `label="…"` in that node or edge statement only. |
| Change shape | Replace/add `shape=…` in that node statement only. |
| Change style | Replace/add `style=…` in that node statement only. |
| Edge line | Replace/add `style=…` in that edge statement only. |
| Edge arrow | Replace/add `arrowhead=…` and, for both ends, `dir=both` in that edge statement only. |
| Add node/edge | Insert one statement before the graph's closing `}` at the prevailing indentation. |
| Delete | Remove the statement only when it occupies one line; otherwise the item is read-only. |
| Direction | Replace the first `rankdir=…` in the graph header; insert `rankdir=TB;` after `{` when absent. |

Formatting rules: keep attribute order; keep existing quotes; quote new values
only when they contain spaces, punctuation, or newlines; collapse a typed
newline to a space (Graphviz labels are single-line in this editor). Never
reformat untouched lines.

**Read-only diagram** (safety screen for a block opened outside the menu; the
menu is disabled for source-only blocks): no sidebar Add, no inspector, Apply
disabled.

- a `subgraph` / cluster exists,
- the source is not a single `digraph`/`graph` block,
- the source uses an HTML label (`<…>`), a record, or a port/chain construct
  anywhere,
- comments are present.

**Read-only item** (the rest of the diagram stays editable):

- the node is declared more than once,
- the statement spans multiple lines,
- the node's `shape` is outside the editor's shape list (the grid shows
  `Custom (source)` and is disabled),
- the node's `style` is outside the preset list (the select is disabled with a
  note),
- the edge uses ports (`a:p -> b`, `a -> b:q`) or a chain of more than two
  nodes,
- the edge's `arrowhead`/`dir` combination is outside the editor's arrow list.

A read-only item shows a quiet `.designer-scope-note` naming the construct, and
its Delete action is disabled. Other items remain editable and Apply still
writes those edits.

### 6.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Design graph      [GRAPHVIZ]                             ×    │
├──────────────┬──────────────────────────────┬────────────────┤
│ Add          │ Stage                        │ Node · flask   │
│  Node | Edge │  ┌────────────────────────┐  │ Label          │
│  form        │  │  rendered Graphviz SVG │  │ Shape (grid)   │
│ Chart        │  └────────────────────────┘  │ Style          │
│  rankdir     │                              │ Actions        │
│ Edit source  │  hint pill                   │                │
│ ─────────    │                              │                │
│ History      │                              │                │
├──────────────┴──────────────────────────────┴────────────────┤
│ Unsaved changes              Cancel   Apply                  │
└──────────────────────────────────────────────────────────────┘
```

The sidebar order is **Add → Chart → Edit source → History**. There is no Tools
section: Graphviz owns layout, so there is no select/connect mode.

### 6.3 Canvas selection

- The vendored `viz.js` renders the source to SVG into the card. The SVG keeps
  its own theme (Graphviz colors).
- Every top-level `g.node` and `g.edge` is an entity. Selection is by `g` id /
  class and the statement it maps to; the mapping is built at parse time, not by
  guessing from the SVG.
- Overlay hit buttons are placed from each group's bounding box:
  - node: bbox + 4px padding, minimum 28×28;
  - edge: a 28×28 midpoint button plus the transparent path hit stroke. When
    the edge has a label, center the button on the label; otherwise use the
    path midpoint.
- Hover reveals the same ring at 45% opacity. Click selects and opens the
  inspector. Double-click a node focuses the inspector's Label field (an
  accelerator; it is never the only path).
- Keyboard: the canvas has one tab stop; arrow keys move the selection through
  nodes and edges in source order (all nodes, then all edges), Home/End jump to
  the first/last. Enter moves focus to the inspector's first field.
- Edge selection uses the edge's endpoint labels in the inspector header, e.g.
  `flask → notebook`, never the raw Graphviz edge id.

### 6.4 Inspector

Header: a 26px glyph, `h4` kind, mono meta, ghost `×` clear button.

#### Node selected

Header: `Node` · meta `flask · Flask app`.

| Group | Control | Behavior |
| --- | --- | --- |
| Label | Text field | Single line, required non-empty. Updates the node's `label`. |
| Shape | 3-column grid, 8 shapes | `box`, `ellipse`, `circle`, `diamond`, `hexagon`, `cylinder`, `note`, `plaintext`. Selected keeps the accent rail + bold caption (non-color cue). |
| Style | Select | `Default`, `Filled`, `Rounded`, `Filled + rounded`, `Dashed`, `Dotted`. A custom source style disables the field with a note. |
| Actions | `Add edge from this node` | Switches the sidebar to Add → Edge with **From** prefilled. |
| Actions | `Delete node` + `Its edges are removed too. Undo restores.` | Removes the node and its incident edge statements. Disabled when an incident edge is read-only. |

#### Edge selected

Header: `Edge` · meta `flask → /api/*`.

| Group | Control | Behavior |
| --- | --- | --- |
| Label | Text field | Empty removes the label. |
| Line | Select | `Solid`, `Dashed`, `Dotted`, `Bold`. Maps to `style=solid|dashed|dotted|bold`. |
| Arrow | Select | `No arrow` (`arrowhead=none`), `Normal`, `Vee`, `Diamond`, `Dot`, `Both ends` (`dir=both`, `arrowhead=normal`). |
| Actions | `Delete edge` | Removes the edge statement; clears selection. |

No reverse-direction action in v1: Graphviz edge direction affects layout, and
the product brief asks only for label/line/arrow.

### 6.5 Add forms

Two tabs at the top of the Add section: **Node** | **Edge**.

**Node**

| Field | Required | Notes |
| --- | --- | --- |
| ID | No | Placeholder `auto: n1`. If typed, must match `[A-Za-z_][A-Za-z0-9_]*` or be a quoted identifier. Duplicate IDs are rejected inline. |
| Label | Yes | Single line. Add is disabled while empty. |
| Shape | Yes (default `box`) | Same 8-shape grid as the inspector. |
| Style | No (default `Default`) | Same select as the inspector. |

Commit: `Add node`. On success select the created node and open its inspector.
Keep the shape/style defaults for the next add; clear ID and label.

**Edge**

| Field | Required | Notes |
| --- | --- | --- |
| From | Yes | Select of node IDs + labels. |
| To | Yes | Same list; must differ from From. |
| Label | No | Single line. |
| Line | Yes (default `Solid`) | Solid / Dashed / Dotted / Bold. |
| Arrow | Yes (default `Normal`) | Same list as the inspector. |

Commit: `Add edge`. Disabled while From/To are empty or equal, or the diagram
has fewer than two nodes. The reason appears in `#designer-add-note`
(`Add a second node first.`).

Add forms are real `<form>`s: Enter submits; the commit button is the named
control.

### 6.6 Direction

Chart section: a native radio group of four chips, `TB`, `LR`, `BT`, `RL`, with
full names (`Top-bottom (TB)`, `Left-right (LR)`, `Bottom-top (BT)`,
`Right-left (RL)`). Preserve the source's exact token; selecting a chip sets the
first `rankdir` value. Chip styling and keyboard behavior are the Mermaid
direction chips: 26-28px high, pill, `--accent-soft` when checked, native radio
focus ring.

---

## 7. WaveDrom editor (`wavedrom`)

### 7.1 Editor model and source mapping

At open, parse the block with the same lenient path `wavedrom.js` uses (strict
JSON first, then the JS-object fallback). The model is:

```
{
  signal: [{ name, wave, period?, data?: string[] }, ...],
  config?: { hscale?: 1..10 },
  head?, foot?, groups?, edge?, …preserved
}
```

Edits:

| Action | Write |
| --- | --- |
| Rename signal | `signal[i].name`. |
| Edit wave | `signal[i].wave`. |
| Edit period | `signal[i].period` (omit when 1). |
| Edit data label | `signal[i].data[j]`. |
| Add signal | Append `{name, wave, period?}`; select it. |
| Delete signal | Remove the array entry; select nothing. |
| Move up/down | Reorder the `signal` array. |
| Time scale | `config.hscale` (1-10); omit when 1. |

- Serialize with 2-space indentation on the first edit. The renderer accepts
  strict JSON; the block's fence stays `wavedrom`.
- Preserve all other keys and array entries untouched. If the parsed value has
  non-JSON content (a function, `undefined`, a cycle), the whole diagram is
  read-only.
- **Read-only diagram:** no `signal` array, an analog/`bricks` source, or a
  non-object source. Show `Read-only diagram` with **Edit source instead**; no
  sidebar Add, no Apply.
- **Read-only signal:** the signal uses `bricks`/`analog`, or is not an object.
  Its fields are disabled with a note; other signals remain editable.
- **Group guard:** if the source contains `groups` or `edge` (arcs), Add and
  signal reorder/delete are disabled with a note (`Wave groups and arcs stay in
  the source.`), because those structures reference signal indices. Editing a
  signal's name/wave/data label is still safe.

> **Assumption (product spec open):** `config.hscale` is the only chart-level
> control in v1. If the spec excludes chart-level controls, drop the Chart
> section; the editor works without it. Head/foot text, groups, arcs, and skins
> remain source-only.

### 7.2 Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Design timing     [WAVEDROM]                            ×     │
├──────────────┬──────────────────────────────┬────────────────┤
│ Add signal   │ Stage                        │ Signal · bus   │
│  Name        │  slice ruler 1 2 3 4 …       │ Name           │
│  Wave        │  ┌────────────────────────┐  │ Wave [string]  │
│  Period      │  │  white waveform card   │  │  cells + palette│
│  Add         │  └────────────────────────┘  │ Period         │
│ Chart        │                              │ Data labels    │
│  hscale      │  hint pill                   │ Actions        │
│ Edit source  │                              │                │
│ ─────────    │                              │                │
│ History      │                              │                │
├──────────────┴──────────────────────────────┴────────────────┤
│ Unsaved changes              Cancel   Apply                  │
└──────────────────────────────────────────────────────────────┘
```

Sidebar order: **Add signal → Chart → Edit source → History**. No Tools.

### 7.3 Canvas and slice ruler

- The vendored WaveDrom renderer draws the SVG into the card. The card is white
  in both themes, like `.wavedrom-container`. The SVG's own embedded stylesheet
  is left alone.
- Entity mapping comes from the library's stable group ids:
  - signal rows: `g[id^="wavelane_"]`, in array order;
  - data labels: the text elements inside those rows, matched to the signal's
    `data` array in order;
  - time slices: derived from `wavegaps` (or the signal's period) and the
    waveform's time grid.
- **Slice ruler:** a horizontal strip above the card, one cell per time slice,
  24px wide (matching the wave editor cells), numbered `1…n`. It is measured
  from the SVG's time grid after render and on resize, so it aligns with the
  waveform. The ruler is horizontally scrollable with the card when the SVG is
  wider than the stage.
  - Clicking a ruler cell selects that slice of the **current signal**. If no
    signal is selected, the first signal is selected.
  - The selected cell gets `aria-selected="true"`, the accent fill, and a
    vertical band through the waveform.
- Signal rows get a transparent hit button spanning the row (minimum 28px
  high). Data labels get a hit box padded 6px, minimum 28px high.
- Hover: 45% band/ring. Click: select and open the inspector.
- Keyboard on the canvas: Up/Down move between signal rows; Left/Right move the
  selected slice; Home/End go to the first/last slice; Enter focuses the
  inspector's first field. Data labels are reachable from the signal
  inspector's Data group (below), so they do not need a separate canvas
  traversal.

### 7.4 Wave editor

The wave editor is the inspector's centerpiece for a selected signal. It has
four parts, top to bottom:

1. **Wave string** — a monospace text input (`.designer-field .dw-mono`),
   value = `signal[i].wave`. It accepts any non-space string; the vendored
   renderer is the authority on glyph validity. Invalid characters are shown
   as literal cells and an apply-time render error is caught in the banner.
2. **Character track** — one cell per character, 24×34px, 2px gap, horizontal
   scroll. Each cell contains:
   - a 12px miniature waveform glyph (high line, low line, clock edge, data
     block, unknown hatch, gap), and
   - the character itself at .68rem mono.
   Cells are grouped by `period`: a 1px `--border` separator and a tiny slice
   number (`1`, `2`, …) above the first cell of each period.
3. **Readout** — one line: `Cell 4 · data label “body” · high`. It names the
   current character, its slice, and the label if one is attached. When there
   is no selection: `Select a cell to edit it`.
4. **Glyph palette** — a 6-column grid of 12 buttons: `0 1 x z = 2 3 4 5 . p n
   |`. Each has a `title` with its meaning (`Low`, `High`, `Unknown`,
   `High-Z`, `Data`, `Data 2`…`Data 5`, `Extend`, `Positive clock`,
   `Negative clock`, `Gap`). Clicking a glyph replaces the selected cell and
   advances one cell; with no selected cell it appends. The palette is a
   convenience; bracket glyphs and any future glyphs pass through the text
   field untouched.

Track behavior:

- The track is a single-select listbox: `role="listbox"`, horizontal, cells
  `role="option"` with `aria-selected`. Focus sits on the listbox; arrow keys
  move the selected cell; typing a printable character replaces it; Backspace
  deletes it; Home/End jump to the ends. The text input and track stay in sync
  on every valid edit.
- Cells are never the only way to change the wave: the text field is always
  present and is the source of truth.
- Slice selection from the ruler sets the selected cell to that slice's first
  character and scrolls the track so the slice is visible.
- Period change redraws the separators. It does not rewrite the wave string.

#### Signal inspector

Header: `Signal` · meta `bus · 9 slices` (add `· slice 4` when a slice is
selected).

| Group | Control |
| --- | --- |
| Name | Text field; required non-empty. |
| Wave | Text field + character track + readout + glyph palette (§7.4). |
| Period | Number field, integer 1-16, default 1. Step buttons are native. |
| Data labels | A list of `data[]` entries as rows: index, a short text preview, and a `Select` button that selects that label on the canvas. Empty: `No data labels.` |
| Actions | `Move up` / `Move down` (disabled at boundaries or when groups/arcs exist); `Delete signal` + `Its labels are removed too. Undo restores.` |

### 7.5 Data label inspector

Header: `Data label` · meta `bus · slice 4`.

| Group | Control | Behavior |
| --- | --- | --- |
| Label | Text field | Edits `signal[i].data[j]`. Empty is allowed; it renders an empty label. |
| Position | Read-only line | `Data glyph 2 of 3 · slice 4`. |
| Actions | `Delete label` + `The glyph stays; the remaining labels shift.` | Removes the `data[j]` entry. Disabled when the source has groups/arcs? No: deleting a label does not change indices of signals, so it stays enabled. |

Selecting a data label on the canvas or in the signal inspector switches the
inspector to this mode. Clearing returns to the signal inspector's rest.

> **Assumption (spec open):** v1 does not add a data label from nothing. A
> WaveDrom label is positional against a data glyph, so adding a label without
> a data glyph is meaningless; the source editor is the path. Editing and
> deleting existing labels is in scope.

### 7.6 Add signal

| Field | Required | Notes |
| --- | --- | --- |
| Name | Yes | Single line; `clk`, `bus`, `valid`. |
| Wave | Yes | Text field plus a read-only mini track preview (same cells, 236px sidebar width, scrolls horizontally). Empty disables Add. |
| Period | No (default 1) | Integer 1-16. |

Commit: `Add signal`. On success append the signal, select it, open its
inspector, and keep the period default. Clear name and wave.

### 7.7 Chart

A single **Time scale** select (`hscale`, 1-10, default 1), plus the quiet note
`Head/foot text, groups, and arcs stay in the source.` The note is present
whether or not those keys exist in the current source; it sets expectations.

### 7.8 Selection order and clearing

- Add/delete/reorder clears the selection unless the operation returns the
  created index; a created signal is selected.
- A label/style/period/wave edit keeps the selection. If the signal or label
  index no longer exists (e.g. Backspace removed characters that held a label),
  the inspector re-resolves it; a vanished label returns to the signal
  inspector.
- Undo/redo clears the selection, because WaveDrom entity ids are positional.

---

## 8. State coverage

| State | What the user sees | Sidebar / inspector | Apply / Cancel |
| --- | --- | --- | --- |
| **Loading** | Spinner + `Loading Graphviz…` / `Loading WaveDrom…` over the stage. | Hidden and inert. | Apply disabled; Cancel active. |
| **Ready, no selection** | Diagram card; type hint pill (`Select a node or edge…` / `Select a signal…`); WaveDrom slice ruler. | Add form visible; inspector rest state. | Apply enabled only when the source differs from the open baseline. |
| **Selected** | Selection chrome + type pill; hint hidden; WaveDrom band on the slice. | Inspector selected mode. | Apply enabled; Cancel/Esc guard once dirty. |
| **Empty** | Empty overlay: `Add your first node.` / `Add your first signal.` | Add form visible. | Apply only if the seeded source differs. |
| **Parse error (open)** | Full-canvas `#designer-error`: title `Couldn’t open this diagram`, first line of the parser message, Retry + **Edit source instead**. | No sidebar, no inspector. | Apply disabled. |
| **Render error (open)** | Same full-canvas state; copy names the renderer (`Graphviz couldn’t render this source.`). | Same. | Apply disabled. |
| **Read-only diagram** | `#designer-readonly`: `Read-only diagram`, the construct named (`This graph uses subgraphs.` / `This waveform uses analog bricks.`), **Edit source instead**. | No Add, no inspector. | Apply disabled. |
| **Read-only item** | Diagram is usable; the selected item shows a scope note naming the construct. | Fields disabled; Delete disabled. | Apply remains enabled for other edits. |
| **Unsaved changes** | Footer `Unsaved changes`. | — | Cancel/Esc/backdrop/× guard. |
| **Applying** | Footer `Applying…`; canvas remains visible. | Controls disabled. | Apply and Cancel disabled. |
| **Apply validation failure** | Non-blocking `#designer-alert` banner (`role="alert"`) + footer error. Canvas and inspector stay usable. | Usable. | Apply re-enabled after the user fixes or dismisses; Cancel still works. |
| **Live render failure after an edit** | Same banner: `Preview can’t render this change`. Last good canvas stays. | Usable. | Apply still validates. |
| **Dirty close guard** | Native `confirm("Discard unsaved diagram changes? The note will stay unchanged.")`. | — | Cancel keeps the modal open. |

Do not replace the whole canvas with an error screen for an **edit** failure;
only an **open** failure uses the full-canvas state.

---

## 9. Interaction flows

### 9.1 Open

1. Hybrid → right-click the rendered block / Shift+F10 → **Design graph…**.
2. The menu item is shown only when the plugin opts in, the module exists, and
   the role allows writes. It stays visible but disabled for a block the module
   reports as `render` only (never for v1 dot/wavedrom — both are editable or
   fall back).
3. Capture the invoking block. Lazy-load the vendored renderer if needed.
4. Parse and render. Success: set the badge, build the sidebar, show the
   inspector rest state, focus the canvas. Failure: the full-canvas error state
   with Retry + Edit source.
5. If the modal is already open, focus it; do not open a second window.

### 9.2 Select → edit → live preview

1. Click an entity (or arrow-traverse the canvas).
2. The inspector renders the matching mode; the type pill appears; the hint
   hides.
3. Edit a field. Validate locally (required text, enum, number range), then
   update the model.
4. Re-render the card. The note is untouched.
5. First successful edit sets `Unsaved changes`.
6. Undo/redo is one internal step per edit; Ctrl/Cmd+Z never reaches the note.
7. Selection survives a re-render when the entity still exists; otherwise the
   inspector returns to rest. For WaveDrom, positional ids are re-resolved.

### 9.3 Add

1. Choose the Add tab / fill the form.
2. Commit stays disabled while required fields are empty or invalid; the reason
   is a quiet note, not a tooltip-only.
3. On submit: write the statement/array entry, select the created item, render
   its inspector.
4. Clear text fields; keep shape/style/line/arrow/period defaults.
5. Empty diagram: the form is still available and is the primary path.

### 9.4 Delete

1. Select the item; click the explicit inspector button.
2. Remove it; clear the selection; inspector returns to rest.
3. No `confirm`; undo is the safety net. The consequence line names what else
   goes (`Its edges are removed too.` / `Its labels are removed too.`).

### 9.5 Apply

Mirror the Mermaid write-back order exactly:

1. No-op (`source === baseline`): status `No changes to apply`, close, write
   nothing.
2. `Applying…`; Apply and Cancel disabled.
3. Validate by rendering the new source through the same vendored renderer
   (Graphviz `renderString`, WaveDrom `renderWaveForm`) into a detached host.
   On failure: banner + footer error; stay open; no write.
4. Guard hybrid mode and re-resolve the target by parent + index + source
   match (the Mermaid contract). On failure close with a notice.
5. Replace the fence with a raw `<pre><code class="language-dot|graphviz|wavedrom">`
   holding the new source; await `renderAll(viewerContentEl)`.
6. `NB.hybrid.onContentChange()`; close; restore focus to the block.

No server route. No autosave. No write on Cancel/Esc/backdrop/source fallback.

### 9.6 Cancel / Esc / backdrop / ×

- Clean: close, write nothing, restore focus.
- Dirty: native confirm. On cancel stay open.
- The source fallback uses the same guard, then opens the inline editor.

### 9.7 Invalid states

- Open error → full-canvas state.
- Apply error → banner, modal stays open.
- Live edit render error → banner, last good canvas.
- Field error → inline `.designer-field-error`, `aria-invalid`, no model write.
- Empty → empty copy, no error.
- Read-only item → scope note and disabled fields.

---

## 10. Keyboard and accessibility

### 10.1 Keyboard map

| Context | Keys | Action |
| --- | --- | --- |
| Modal | Tab / Shift+Tab | Focus trap: header → sidebar → canvas → inspector → footer. |
| Modal | Esc | Close; dirty → discard confirm. An open native select popup consumes Esc first. |
| Modal | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Diagram undo/redo; never the note. |
| Canvas (dot) | Down/Right | Next node/edge in source order. |
| Canvas (dot) | Up/Left | Previous node/edge. |
| Canvas (dot) | Home / End | First / last entity. |
| Canvas (dot) | Enter | Move focus to the inspector's first field. |
| Canvas (wave) | Up/Down | Previous / next signal. |
| Canvas (wave) | Left/Right | Previous / next slice of the current signal. |
| Canvas (wave) | Home / End | First / last slice. |
| Canvas (wave) | Enter | Move focus to the inspector's first field. |
| Slice ruler | Left/Right, Home/End | Move the selected slice; the signal stays selected. |
| Wave track (listbox) | Left/Right, Home/End | Move the selected character. |
| Wave track | Any printable glyph | Replace the selected character; advance one cell. |
| Wave track | Backspace | Delete the selected character. |
| Add tabs | Left/Right/Home/End, Enter/Space | Move/activate, as in Mermaid. |
| Add form | Enter | Submit. |
| Anywhere | Delete / Backspace on the canvas | **Not bound.** Deletion is only the named inspector button. |

The canvas keeps one tab stop. Entity hit buttons use a roving `tabindex`, so
Tab leaves the canvas instead of walking every node/edge/signal.

### 10.2 Accessibility rules

- **Contrast.** The scoped `--fg-muted` clears 4.5:1 on `--bg-panel` and
  `--bg-elev` in both themes (dark `#9799a4`, light `#5d6470`). Status uses the
  scoped `--designer-ok` / `--designer-warn`. Error text uses `--danger`.
- **Not color-only.** Selected item: type pill + inspector header + the item's
  accessible name. Dirty/applying/error: words. Read-only: words and a disabled
  field. Wave cell selection: accent outline + readout text + `aria-selected`.
  The wave glyph's shape (line position) carries meaning; the character is
  always present.
- **Names.** Every canvas hit button has an `aria-label`:
  - `Node flask, label Flask app`
  - `Edge flask to /api/*, label serve`
  - `Signal bus, 9 slices`
  - `Data label body, signal bus, slice 4`
  - ruler cells: `Slice 4 of 9`
- **Live region.** `#designer-inspector-head` is `aria-live="polite"` and says
  `Selected node flask, Flask app.` / `Selected signal bus, 9 slices.`
  `#designer-status` is `role="status"`.
- **Errors.** Banner: `role="alert"`. Field: `aria-invalid` + `aria-describedby`
  pointing at the inline `.designer-field-error`. Never a toast alone.
- **Targets.** Node hit ≥ 28×28; edge hit stroke 14px + 28×28 midpoint button;
  signal row ≥ 28px high; data-label hit ≥ 28px high; wave cells 24×34;
  ruler cells 24×30; all buttons ≥ 30px high (icon buttons 32×32).
- **Focus.** 2px accent `:focus-visible` ring, 2px offset, on every control.
  Focus is trapped; on close it returns to the invoking block. The overlay is
  `aria-modal="true"` / `role="dialog"`.
- **Hidden content.** Sidebar and inspector are `hidden`/`inert` in loading,
  error, and read-only-diagram states. The old canvas remains in the DOM but is
  not focusable.
- **Reduced motion.** The sheet transition and spinner respect
  `prefers-reduced-motion`.
- **Zoom / font scale.** Text is rem, spacing is px; panels scroll. At XL, the
  12-glyph palette wraps to fewer columns, the wave track scrolls, and the
  inspector header truncates with a `title`.

---

## 11. What not to build

Keep these out of v1. They are the line that keeps the editors from becoming
Graphviz and WaveDrom IDEs.

**Graphviz**

- No free-form drag positioning, coordinates, pinning, or spline editing.
  Graphviz owns layout.
- No subgraph/cluster creation or membership editing.
- No color, font, penwidth, peripheries, margin, ratio, or engine controls.
- No HTML/record labels, ports, or edge chains.
- No Graphviz default-attribute editors (`node [...]`, `edge [...]`) and no
  `classDef`-style authoring.
- No multi-select, copy/paste, or graph-level attribute sheet.
- No zoom/pan inside the modal; the lightbox is the zoom path.

**WaveDrom**

- No group, arc/edge, head, or foot authoring.
- No analog `bricks`, skins, or custom styles.
- No automatic data-label insertion; labels are positional against data
  glyphs.
- No free drawing or drag-to-stretch of transitions.
- No time-axis/hscale fine-tuning beyond the single select (if the product spec
  keeps it).
- No new signal kinds beyond the WaveDrom signal object.

**Both**

- No source textarea inside the modal. "Edit source instead" is the one source
  path.
- No new renderer, no theme override for the diagram, no re-render of the note
  before Apply.
- No second modal, no nested dialogs.

---

## 12. Implementation notes for `web-engineer`

Design only; this section is the handoff shape, not a code change made here.

### 12.1 Markup (`templates/index.html`)

- Add the sibling `#dw-designer-overlay`; do not move or rename the Mermaid
  `#designer-overlay`. Set `data-designer-lang="dot|wavedrom"` when opened.
- Add the persistent source control `#dw-edit-source`
  (`.designer-btn.designer-btn--ghost.designer-btn--block.dw-source`) above
  the History divider, with the copy in §5.4.
- Add `#dw-stage-scroll` inside `#dw-canvas`, with `#dw-slice-ruler` above
  `#dw-diagram-card` and `#dw-slice-band` inside the same scroll container.
- Add `#dw-overlay-layer` inside the card.
- The Wave editor (text field + track + readout + palette) is generated by the
  editor module into `#dw-inspector-body`; it has no static markup.
- Add `#dw-readonly`, `#dw-alert`, `#dw-status`, and the History controls.

### 12.2 CSS (`static/css/style.css`)

- Add the §4 token block scoped to `#dw-designer-overlay`.
- Add the stage card, overlay, selection chrome, wave track, palette, slice
  ruler, and source-fallback rules, prefixed `#dw-designer-overlay` or `.dw-*`.
- Do not restyle the shared `.settings-*` rules or the Mermaid designer rules.
- Keep `.wavedrom-container`'s white card behavior; the modal reproduces it,
  not a themed variant.
- Add the `@media (max-width: 960px)` strip + sheet rules scoped to
  `#dw-designer-overlay` so they cannot conflict with Mermaid.

### 12.3 JS

- Register the opt-in the same way Mermaid does: `design: "dotDesign"` on the
  Graphviz block descriptor and `design: "wavedromDesign"` on the `wavedrom`
  descriptor, carried through `pluginTypes()`. `hybrid.js` already builds the
  item from `plugin.design`; do not add a second menu path.
- Each module exposes `open(hit)` and `capabilityFor(source)` (`"edit"` for v1,
  reserved for a future render-only case). Both use the same modal shell
  helpers: capture focus, lazy-load, parse/render, open/close, dirty guard,
  Apply.
- Render into the modal with the same vendored library the note uses; do not
  reuse the note's DOM node (it may be replaced on the next render). The modal
  owns its own SVG and overlay.
- Source fallback: close without writing, restore focus, then call
  `NB.hybrid.editPluginSource(hit)` (the existing helper) with the captured
  hit. Confirm first when dirty.
- Apply: mirror `mermaid-designer.js` (no-op → validate by rendering →
  `isActive()` guard → re-resolve parent/index/source → replace fence → await
  `renderAll` → `onContentChange` → close). Catch every render/parse error and
  show the banner; never write on error.
- The editor models:
  - dot: line/statement model with byte-preserving untouched lines (§6.1);
  - wavedrom: parse the object, mutate `signal[]`/`config.hscale`, serialize
    on the first edit (§7.1).
- Keep `NB.viz` / `NB.wavedrom` renderers and `blocks.js` round-trip
  unchanged except for the `design` flag.

### 12.4 Tests to extend

- **Design graph…** appears for dot and **Design timing…** for wavedrom in
  hybrid, admin/auth-off
  only; absent for viewers and preview.
- Open → Apply with no edit writes nothing and closes.
- Dot: rename a node label → only that statement changes; all other lines
  byte-identical.
- Dot: add node/edge, delete, shape/style/line/arrow, rankdir.
- Dot: subgraph/comment source → read-only safety screen + Edit source
  instead; the menu is disabled.
- Dot: multi-line statement → read-only item, other edits still apply.
- Dot: HTML label/record/port/chain → render-only; menu disabled, direct open
  shows the read-only safety screen.
- WaveDrom: edit name/wave/period/data label; add/delete/reorder signal;
  untouched keys preserved.
- WaveDrom: analog/`bricks` → read-only diagram; groups present → structural
  actions disabled.
- Wave track: arrow keys, typing, Backspace, palette insert, listbox
  `aria-selected`, text/track sync.
- Dirty Cancel/Esc/backdrop/× confirms; clean close does not.
- Apply render failure stays open, shows the banner, writes nothing.
- Compact: strip + sheet at ≤960, footer visible, wave track scrolls.
- Keyboard: focus trap; arrows on both canvases; Ctrl/Cmd+Z never reaches the
  note; focus returns to the block.

---

## 13. Assumptions and open items

| Item | Assumption / decision |
| --- | --- |
| **Source fallback placement** | Ready state: sidebar above History; error/read-only: state actions. Copy is always `Edit source instead`. §5.4. |
| **Dot "style"** | A fixed preset select, not arbitrary CSS. A custom source style disables the field. If the spec means fill/stroke colors, this needs a product decision and a new color control. |
| **Dot subgraphs** | Read-only diagram in v1. This is the safest guard; a later version can add cluster editing. |
| **Dot node IDs** | Optional in the Add form; auto-generated (`n1`, `n2`…). IDs are never renamed once created (source-only) so edges cannot break. |
| **WaveDrom formatting** | First edit normalizes to strict JSON. No-op Apply writes nothing. If byte-preserving formatting is required, that is an implementation dependency. |
| **WaveDrom chart controls** | Only `hscale` (1-10) in v1, and only if the product spec keeps chart-level controls. |
| **WaveDrom data labels** | Edit/delete existing labels only; adding a label without a glyph is out of scope. |
| **WaveDrom slices** | A slice is a period of the selected signal; selecting one scopes the signal inspector, it is not a third inspector mode. |
| **Zoom/pan** | Not in the modal; the lightbox stays the zoom path. |
| **Undo/redo scope** | Internal to the editor per §9.2; the note gets one undo step on Apply. |
| **Large diagrams** | No ceiling warning in v1; the card fits the stage. A giant graph may render small. Revisit with the product spec. |

---

## 14. Acceptance checklist

- [ ] Right-clicking a rendered `dot`/`graphviz` or `wavedrom` block in hybrid
      shows its block-specific design entry and opens the shared designer shell with the
      correct type badge.
- [ ] The window renders the block's current source and selects nodes/edges or
      signals/data labels/slices without altering the SVG's colors.
- [ ] Dot node inspector exposes label, shape (8), style; edge inspector
      exposes label, line, arrow; both expose the named delete and Add edge
      from node.
- [ ] Dot add forms collect ID/label/shape/style and From/To/label/line/arrow;
      nothing is inserted without the user's values.
- [ ] Direction is a named chip group and preserves the source token.
- [ ] WaveDrom signal inspector exposes name, wave (text + legible cell track +
      readout + palette), period, data labels; selecting a slice scopes it.
- [ ] Data label inspector edits and deletes a label with its position named.
- [ ] Add signal collects name, wave, period and renders a preview.
- [ ] Edit source instead is reachable in the ready state and in every error /
      read-only state; it closes the modal and opens the inline editor.
- [ ] Empty, parse error, render error, read-only diagram, read-only item,
      loading, applying, validation failure, live-preview failure, and dirty
      close all match §8.
- [ ] Selection is visible without color alone (type pill + inspector header +
      accessible name).
- [ ] Contrast, focus rings, labels, `aria-invalid`, live regions, the wave
      listbox, and the roving canvas tabindex are present.
- [ ] At ≤960px the sidebar becomes a strip, the inspector becomes the sheet,
      the footer stays visible, and the wave track scrolls.
- [ ] Both themes and all four font scales render without horizontal overflow
      (except the intentional wave-track/ruler scroll).
- [ ] Untouched Graphviz lines are byte-identical after an edit; no-op Apply
      writes nothing in both languages.
- [ ] No full Graphviz/WaveDrom IDE feature from §11 is present.
