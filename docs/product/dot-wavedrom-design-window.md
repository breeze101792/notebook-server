# Graphviz and WaveDrom design windows — product definition

Status: draft for review. No technical or visual design is chosen here.
Date: 2026-10-20
Owner: `product-designer`
Scope: existing `dot` / `graphviz` and `wavedrom` fenced blocks in the desktop
hybrid (WYSIWYG) editor.

Related documents:

- `docs/product/mermaid-chart-editing.md` — the Mermaid design window this
  feature mirrors.
- `docs/architecture/mermaid-designer.md` — the write-back contract this
  feature reuses.
- `docs/architecture/hybrid-editing.md` — G2/G2b, the existing source editor.
- `static/js/viz.js` — the current Graphviz renderer and its source dataset.
- `static/js/wavedrom.js` — the current WaveDrom renderer, parser, and source
  dataset.

## 1. Problem and goal

The owner edits notes in hybrid mode. Right-clicking a rendered Mermaid block
offers **Design diagram…** and opens a window with a live preview and editable
structure. Right-clicking a rendered Graphviz or WaveDrom block offers only
**Edit … source**. He wants a design entry with the block's own noun
(**Design graph…** / **Design timing…**) and an edit window for both.

The note must stay plain Markdown. The window must not turn a diagram into
HTML, SVG, or an opaque attachment.

**MVP line:** both block types get the same entry point and the same window
contract as the Mermaid designer. Graphviz can edit node and edge labels, add
and delete nodes and edges, and change direction within a conservative safe
subset. WaveDrom can edit existing signal fields and add or delete signals in a
flat signal list. Anything outside that subset stays on the source-editing
path; it is never guessed at or silently dropped.

## 2. What "design" means here

The owner does not know a "visual model editor" as a technical term. This
document fixes the meaning for these two languages:

- **Graphviz:** a structure editor with a live preview. The window lists the
  graph's nodes and edges and exposes named fields for labels, endpoints, and
  direction. The owner never types Graphviz syntax. Graphviz still computes
  the layout; the window does not place nodes or route edges.
- **WaveDrom:** a signal-table editor with a live preview. Each row is one
  signal. The owner edits the signal name, wave pattern, data labels, and
  period. The owner never types the surrounding object syntax. WaveDrom still
  draws the waveform; the window does not drag waveform edges.

Both are "design" in the same sense as the Mermaid window: change what the
diagram says, see the result immediately, and write only on Apply. Neither is a
freeform drawing canvas.

## 3. Entry point and gating

### 3.1 Entry

The entry is the existing hybrid right-click menu. In hybrid mode, right-click
a rendered block:

- `.viz-container` (Graphviz) or `.viz-error`
- `.wavedrom-container` or `.wavedrom-error`

The menu shows, in this order:

1. **Design graph…** (Graphviz) or **Design timing…** (WaveDrom) — opens the
   design window for this block.
2. **Edit Graphviz source** / **Edit WaveDrom source** — the existing
   `editPluginSource` path.

The block noun must match the language: Graphviz is a **graph**, WaveDrom is a
**timing** (the window's error/discard copy says **waveform**), and Mermaid
keeps **Design diagram…**. The window header names the type: **Graphviz** or
**WaveDrom timing**.

The item is offered only in hybrid mode. Preview mode has no design entry in
v1.

### 3.2 Visibility and role

| Condition | Design item | Source item |
| --- | --- | --- |
| Hybrid mode, auth off | shown, enabled for a supported block | shown |
| Hybrid mode, role `admin` | shown, enabled for a supported block | shown |
| Hybrid mode, role `viewer` | hidden | shown |
| Hybrid mode, design module absent | hidden | shown |
| Hybrid mode, raw `<pre><code class="language-dot">` (not rendered) | hidden | shown as **Edit code block** |
| Hybrid mode, error box (malformed, empty, or unsupported) | shown, disabled | shown |

The role gate is the same as Mermaid's: a write path is offered only when auth
is off or the signed-in role is admin. A stale role falls through to the
existing 401/403 behaviour on the note write; the window itself adds no new
server check.

### 3.3 Capability probe

Each module exposes `capabilityFor(source)`:

- `"edit"` — the source is inside the v1 safe subset and a model can be built.
- `"render"` — the source is malformed, empty, or contains a construct the
  window cannot safely edit; the item stays visible but disabled.

`capabilityFor` must not return `null` for an uneditable source. The hybrid menu
treats anything other than `"render"` as enabled, so `null` would open a window
that cannot work. It must not throw.

The disabled item carries `aria-disabled="true"` and a title that names the
source path, e.g. **This graph can't be edited visually — use Edit source**.
The same wording is used for WaveDrom with "waveform" in place of "graph".

### 3.4 Keyboard path

A rendered `.viz-container` and `.wavedrom-container` are already focusable
(`tabIndex = 0`). From a focused block, Shift+F10 or the Menu key opens the same
hybrid context menu, anchored to the block. The Design item is reachable and
Enter opens it. The window traps Tab and returns focus to the block on close.

### 3.5 Malformed and empty blocks

A malformed source renders as an error box. An empty or whitespace-only source
is treated as malformed. For both:

- The Design item is shown but disabled.
- The source item opens the existing inline source editor with the block's
  current source.
- There is no blank-document seed and no new-diagram flow in v1. The design
  window always opens from an existing, supported block.

## 4. Shared window behaviour

The Graphviz and WaveDrom windows use the same shell and interaction contract as
the Mermaid designer. They may share the host modal or use sibling modals; the
observable behaviour below is the requirement.

### 4.1 States

| State | Meaning |
| --- | --- |
| `closed` | no window |
| `loading` | the block's source has been read; the model and preview are being built |
| `ready` | the model is editable and the preview is rendered |
| `error` | the model or preview could not be built; Retry and **Edit source instead** are offered |
| `applying` | Apply is validating and writing; Apply/Cancel are disabled |

A validation failure during Apply does **not** enter `error`. It keeps the
window in `ready` and shows a non-blocking inline message, so the owner can fix
the field and try again.

### 4.2 Open

- The source is seeded from the block's current source: the container dataset
  (`vizSource` / `wavedromSource`) or the error box's source child.
- The window builds the model from that source. If model building fails
  unexpectedly, it enters `error`, writes nothing, and offers Retry and
  **Edit source instead**.
- The preview uses the same renderer the note uses. The window does not
  introduce a second rendering engine.
- Only one design window can be open at a time.

### 4.3 Apply

Apply is the only note write. It runs in this order:

1. **No-op check.** If no editable field differs from its value at open, close
   the window, write nothing, and add no history step.
2. **Validate.** Serialize the model and render it through the real renderer.
   On failure, keep the window open, show the inline error, and write nothing.
3. **Guard hybrid mode.** If hybrid mode is no longer active, close with a
   notice and write nothing.
4. **Re-resolve the target.** At open, capture the block's parent, its index
   among the parent's children, and its source. At Apply, resolve that position
   again and require the same registered language (Graphviz or WaveDrom) and the
   same source. If it is missing, changed language, or changed source, close
   with a notice and write nothing.
5. **Write the fence.** Replace the resolved block with a raw fence in the
   note, await the renderer's re-render, then mark the note dirty
   (`onContentChange`) exactly once.

No-op is defined by **editable field values**, not by byte comparison. The
window may serialize differently from the source (for example, Graphviz
indentation or WaveDrom quoted keys). An untouched window must never rewrite
the note merely to normalise formatting.

### 4.4 Cancel, Esc, backdrop, close button

All four are user-initiated closes:

- If no editable field changed, close and write nothing.
- If any editable field changed, ask for confirmation to discard. Declining
  keeps the window open. Accepting closes and writes nothing.
- Apply success and the **Edit source instead** path close without this
  confirmation.

### 4.5 Focus and keyboard

- The window is a modal dialog (`role="dialog"`, `aria-modal="true"`) and
  carries the app's modal marker so global note shortcuts do not fire under it.
- Focus moves into the window on open and is trapped there.
- Esc closes with the dirty guard.
- Closing returns focus to the block that opened the window.

### 4.6 Window-level undo/redo

The sidebar carries a sticky **History** section with **Undo** and **Redo**.
Each structural edit is one step; text bursts coalesce into one step. Undo and
redo restore the window's draft and preview, clear the selection, and update
the disabled button states. Field-level browser undo still works inside text
inputs and is not intercepted by the window chord. Cancel still discards the
whole draft.

## 5. Graphviz editor scope (v1)

### 5.1 Editable fields

| Field | Behaviour |
| --- | --- |
| Direction | Select one of TB, LR, RL, BT, or **Default (top to bottom)**. Default writes no `rankdir`; the others write one standalone top-level `rankdir=<value>;`. |
| Node label | Text, required non-empty. |
| Node shape | 8-shape grid: box, ellipse, circle, diamond, hexagon, cylinder, note, plaintext. A custom source shape disables the grid for that node. |
| Node style | Default, Filled, Rounded, Filled + rounded, Dashed, Dotted. A custom source style disables the select for that node. |
| Add node | ID optional (auto `n1`, `n2`… when blank), label required, shape default box, style default Default. The ID must be a valid Graphviz ID and must not already exist. |
| Delete node | Removes the node and every edge incident to it. |
| Node ID | Read-only after the node exists. A new node's ID is fixed when it is added. |
| Edge endpoints | From and To are chosen from existing node IDs. The Add form requires them to differ. |
| Edge label | Text. Empty removes the edge's `label` attribute. |
| Edge line | Solid, Dashed, Dotted, Bold → `style`. A custom source style disables the select. |
| Edge arrow | No arrow, Normal, Vee, Diamond, Dot, Both ends → `arrowhead` (and `dir=both`). A custom source arrow disables the select. |
| Add edge | From, To, optional label, line default Solid, arrow default Normal. Endpoints must already exist. |
| Delete edge | Removes only that edge. |

Every edit is a draft edit. The preview updates; the note changes only on
Apply. There is no per-edit confirmation.

For a `strict` graph, adding an edge that already exists (same endpoints, and
the same direction in a `digraph`) is rejected inline instead of creating a
duplicate.

### 5.2 Preserved read-only

These appear in the window only as context; they are never edited:

- `digraph` versus `graph`, and `strict`.
- The graph ID.
- Default attribute statements (`graph [...]`, `node [...]`, `edge [...]`).
- Every node and edge attribute other than the editable `label`, `shape`,
  node `style`, edge `style`, `arrowhead`, and `dir` (colour, rank, font, and
  so on).
- The relative order of existing statements, except for additions and
  deletions, and the exact text of untouched statements.
- Blank lines and indentation are preserved byte-identically; Apply changes
  only the edited statement span (or inserts a new statement before `}`).
- A statement that spans multiple lines is a **read-only item**: its fields
  and Delete are disabled with a scope note, while the rest of the graph stays
  editable.

The edge operator follows the header: `->` for `digraph`, `--` for `graph`.
The window never offers an operator choice.

### 5.3 Source-only (capability `"render"`)

A block is not offered the design window when its source contains any of the
following. The source editor remains the path. If a render-only block is opened
directly, the shell shows the read-only safety screen; the menu never offers
it.

- Empty or whitespace-only source.
- A source that is not one complete graph, or that contains more than one graph.
- Any `subgraph` or `cluster`.
- Any edge chain (`a -> b -> c`) or grouped endpoint (`a -> {b c}`).
- Any port or compass point (`a:port`, `a:ne`).
- Any HTML-like label (`<...>`), record label, or `Mrecord` shape.
- Any comment (`//`, `/* ... */`, or a `#` line).
- `rankdir` inside an attribute list, or more than one `rankdir`.
- More than one statement for the same node.
- Any attribute value the window cannot re-emit unchanged (for example a
  concatenation with `+`). Multi-line statements are item read-only, not a
  whole-window fallback.
- Any construct the capability probe cannot prove it will preserve. The rule
  is **preserve or disable**, never drop.

The window does not edit graph kind, strictness, graph ID, node IDs after
creation, subgraphs, attribute values, or layout. Those are source edits.

### 5.4 Mapping back to source

- The original header (`strict`, `digraph` / `graph`, graph ID) is preserved.
- The direction is the only graph attribute the window writes. A direction
  edit replaces the standalone `rankdir` value, adds one, or removes it for
  **Default**.
- A new node is emitted as an explicit node statement with its ID and optional
  `label`.
- A new edge is emitted as one edge statement, with its optional `label`.
- A deleted node's statement and all incident edges are removed. A deleted
  edge's statement is removed.
- Node and edge IDs are quoted when they are not bare Graphviz identifiers.
  Labels are quoted and escaped. Other preserved attributes keep their values
  and meaning.
- Existing statements keep their relative order. New statements are appended
  before the graph's closing brace.
- Apply writes a `dot` fence. A block entered as `graphviz` is written back as
  `dot`, matching the existing blocks-registry round-trip.

## 6. WaveDrom editor scope (v1)

### 6.1 Editable fields

The window exposes one row per signal object in the `signal` array.

| Field | Behaviour |
| --- | --- |
| Name | Text, required non-empty. Editable only when the block has no non-empty `edge` array; arcs make it read-only. |
| Wave | Text, required non-empty, plus a character track and a 13-glyph palette. The preview remains the validator; unknown glyphs pass through the text field. |
| Data labels | The signal's `data` list. Rows show the index, preview, and a **Select** action that opens the Data label inspector. The inspector edits or deletes an existing label; adding a label from nothing stays on the source path. |
| Period | Integer 1-16, default 1. 1 omits `period`; an out-of-range value is rejected inline before Apply. |
| Add signal | Only when the signal list is flat. Name, wave, period, and a read-only mini track; appends the signal at the end and selects it. |
| Delete signal | Only when the signal list has no groups or gaps. Removes that signal row. |
| Move up / Move down | Only when the signal list has no groups or gaps and the selected signal is not the first/last. Reorders the `signal` array and clears selection. |
| Time scale | `config.hscale`, 1-10, default 1. 1 omits the key. |

The signal order is otherwise preserved.

### 6.2 Preserved read-only

These are visible as context where relevant, but never edited:

- The `edge` array (WaveDrom edge notation).
- Group arrays and group labels. A group array starts with a label string and
  contains signals or nested groups.
- Gap entries (`{}`).
- `config`, `head`, `foot`, and any unknown top-level key.
- Any per-signal key other than name, wave, data, and period (for example
  `phase` or `node`).

### 6.3 Per-operation fallback to source

Some fields are disabled rather than making the whole block source-only:

- If the block has a non-empty `edge` array, every signal **Name** field is
  read-only with a source-edit note. The edge array is preserved.
- If the signal list contains a group array or a gap, **Add signal**,
  **Delete signal**, and **Move up/down** are disabled with a source-edit note.
  Existing signal fields remain editable.
- Editing the `edge` array, group labels, gaps, `head`, `foot`, or other
  per-signal keys is not offered; use the source.
- `config.hscale` is the only chart-level control; other `config` keys and
  head/foot text stay in the source.

### 6.4 Source-only (capability `"render"`)

A block is not offered the design window when:

- The source is empty or does not parse as a WaveDrom object.
- There is no `signal` array. An `assign`-style WaveDrom diagram is source-only
  and, if opened directly, shows the read-only state.
- The source is an analog/`bricks` diagram.
- The source contains a comment or non-JSON content.
- The source does not render through the vendored WaveDrom renderer.
- A malformed signal entry is a read-only **item** rather than a whole-window
  fallback: its fields are disabled with a note; other signals remain editable.

### 6.5 Mapping back to source

- Apply writes a strict-JSON object. WaveDrom's parser already tries strict
  JSON before its lenient `eval` path, so quoted keys and strings are valid.
- The edited `signal` array is written from the model. `config.hscale` is
  written only when it is not 1. Top-level keys not exposed by the window
  (`edge`, `head`, `foot`, other `config` keys, unknown keys) keep their parsed
  values. Group arrays, gaps, and unexposed per-signal keys keep their values
  and position.
- Source formatting and comments are not preserved. Comments therefore make a
  block source-only in v1 rather than being silently dropped.
- Apply writes a `wavedrom` fence.

## 7. Source fallback

**Edit source instead** is offered in the design window footer in the `ready`
and `error` states, except while `applying`. It is the escape hatch for any
edit the window does not expose.

When clicked:

1. Close the window without the dirty-discard prompt. The note is unchanged.
2. Re-resolve the block at its captured parent/index.
3. If the block still exists and its source matches, call the existing
   `editPluginSource` path for that block. The block becomes the inline source
   editor.
4. If the block no longer resolves, close with a notice and open no editor.

The context menu's **Edit Graphviz source** / **Edit WaveDrom source** item is
always available, including for blocks the design window refuses. The disabled
Design item's title points to it.

## 8. Constraints

- Single owner, writing their own notes. No collaboration, review, or approval
  flow.
- The write path is the existing hybrid DOM path. No new server route, no
  server-side diagram model, no network call.
- The note remains ordinary Markdown. The design window never writes HTML,
  SVG, or a binary attachment.
- The preview and validation use the same vendored Graphviz and WaveDrom
  renderers as the note. A second parser would allow preview and note to
  disagree.
- The window never chooses a different fence language: `dot` stays `dot`,
  `graphviz` is written back as `dot` (the registry's canonical fence), and
  `wavedrom` stays `wavedrom`.
- Comments are source-only in v1. They are never silently removed.
- No product-imposed diagram-size ceiling in v1. Very large graphs may make the
  preview slow; that is a performance risk, not a feature.
- Desktop hybrid only. The phone shell is out of scope.

## 9. Assumptions for researcher verification

These are feasibility assumptions, not product promises. Verify before
implementation; if an assumption fails, tighten the safe subset and update this
document rather than inventing behaviour.

- **R1 — Graphviz round-trip.** The safe subset in §5 can be parsed and
  re-emitted without changing the meaning of untouched node statements, edge
  statements, default attribute statements, or preserved attributes.
- **R2 — Graphviz serializer acceptance.** Graphviz accepts the canonical
  output, including quoted non-bare IDs and escaped labels, and renders the
  same graph for untouched fields.
- **R3 — Implicit nodes.** Adding an explicit node statement for a node that
  existed only as an edge endpoint is layout-neutral in Graphviz.
- **R4 — Direction removal.** Removing a standalone `rankdir` restores
  Graphviz's default top-to-bottom layout exactly.
- **R5 — WaveDrom strict JSON.** A strict-JSON rewrite is accepted by the
  vendored WaveDrom parser and renders identically for untouched fields. The
  renderer already tries `JSON.parse` first; identical rendering is the part to
  verify.
- **R6 — WaveDrom nested groups.** Editing a signal object nested inside a group
  array can be written back while preserving the group structure and every
  unexposed key.
- **R7 — WaveDrom data labels.** The vendored renderer is the authority on how
  many `data` labels a wave string uses and what happens when the count does not
  match. The window does not enforce a count in v1.
- **R8 — WaveDrom period domain.** A positive finite number is the product
  rule; verify that the vendored renderer accepts fractional periods and
  rejects zero or negatives as expected.

## 10. Out of scope (v1)

| Out of scope | Stays on the existing path |
| --- | --- |
| Auto-layout control, node coordinates, manual node placement, edge routing | Graphviz / WaveDrom decide layout |
| Graphviz subgraphs and clusters | Source editing |
| Graphviz graph kind, strictness, or graph ID changes | Source editing |
| Graphviz node ID rename after creation | Source editing |
| Arbitrary Graphviz attribute editing beyond shape/style/line/arrow (colour, fonts, rank, and so on) | Source editing; values are preserved |
| Graphviz ports, compass points, HTML/record labels, chains, comments | Source editing; the block is source-only |
| WaveDrom `assign` diagrams | Source editing |
| WaveDrom `edge` editing | Source editing |
| WaveDrom group add/remove/rename | Source editing |
| WaveDrom `head`, `foot`, other `config` keys, other per-signal keys, and comments | Source editing |
| Import/export of diagrams | Existing note export |
| Creating a diagram from scratch or inserting a new fence | Existing Insert menu and source editor |
| Preview-mode entry (hover icon) | None in v1 |
| Mobile shell | Desktop hybrid only |
| AI-authored diagram edits | Existing AI tools unchanged |
| Server-side storage, model, or staleness check | Existing hybrid target re-resolution |

## 11. Acceptance criteria

Written for `tests/dom/test_dom.js`, using the existing harness conventions:
load the real app modules, stub the new design modules and the Graphviz /
WaveDrom renderers the same way the Mermaid designer block stubs Visimer and
`mermaid.parse`.

### Entry and gating

- **A1.** In hybrid mode with auth off, right-clicking a rendered
  `.viz-container` shows **Design graph…** immediately before
  **Edit Graphviz source**.
- **A2.** In hybrid mode with auth off, right-clicking a rendered
  `.wavedrom-container` shows **Design timing…** immediately before
  **Edit WaveDrom source**.
- **A3.** With auth enabled and role `admin`, both Design items are shown and
  enabled for a supported block.
- **A4.** With auth enabled and role `viewer`, neither Design item is present.
- **A5.** For a supported source, `capabilityFor` returns `"edit"`; for a
  malformed, empty, or unsupported source it returns `"render"`, for both new
  modules.
- **A6.** When capability is `"render"`, the Design item is visible, disabled,
  has `aria-disabled="true"`, and its title names the source-editing path.
- **A7.** A `.viz-error` or `.wavedrom-error` box yields a disabled Design item
  and a working source-editor item.
- **A8.** Focusing a rendered block and pressing Shift+F10 opens the hybrid menu
  with the Design item; pressing Enter invokes it.
- **A9.** A raw `<pre><code class="language-dot">` block (not yet rendered) shows
  no Design item.
- **A10.** If `NB.dotDesign` or `NB.wavedromDesign` is absent, the corresponding
  Design item is not shown.

### Window contract

- **A11.** Clicking Design opens a modal dialog with `role="dialog"`,
  `aria-modal="true"`, and the app's modal marker; focus moves inside.
- **A12.** Opening seeds the window from the block's dataset source, or from the
  error box's source child.
- **A13.** Cancel, Esc, or a backdrop click with no edits closes the window,
  writes nothing, and returns focus to the block.
- **A14.** Cancel, Esc, or a backdrop click with edits asks to discard; declining
  keeps the window open; accepting closes and writes nothing.
- **A15.** Apply with no editable field changed closes the window, writes no
  fence, and does not call `onContentChange`.
- **A16.** Apply with a valid edit replaces the block with a `dot` or `wavedrom`
  fence, awaits the renderer, and calls `onContentChange` exactly once.
- **A17.** Apply with a validation failure keeps the window open, shows an inline
  error, and writes nothing.
- **A18.** Apply when the target is missing, has a different registered
  language, or has a different source closes the window with a notice and
  writes nothing.
- **A19.** Apply when hybrid mode is inactive closes the window with a notice and
  writes nothing.
- **A20.** Only one design window can be open; Tab is trapped inside it and a
  global note shortcut does not fire while it is open.
- **A21.** Closing the window returns focus to the block that opened it.

### Graphviz editor

- **A22.** For `digraph G { A -> B; }`, the window lists nodes A and B and the
  edge A -> B; editing A's label updates the preview.
- **A23.** Adding a node appends an explicit node statement; adding an edge
  requires two existing nodes; a duplicate node ID is rejected inline.
- **A24.** Deleting a node removes its incident edges from the model and the
  preview.
- **A25.** Changing direction to LR writes `rankdir=LR`; choosing Default removes
  a standalone `rankdir`; the header and graph ID are unchanged.
- **A26.** A `graph` block writes `--` edges and a `digraph` block writes `->`
  edges; the window never changes kind or strictness.
- **A27.** A node with `shape=box, color=red` keeps both attributes after its
  label is edited and applied.
- **A28.** A source with a subgraph, a chain, a port, an HTML label, a comment, or
  `rankdir` inside an attribute list returns `"render"` and cannot open.
- **A29.** Clearing a node or edge label removes that label attribute.
- **A30.** A `graphviz` block applied through the window writes a `dot` fence.

### WaveDrom editor

- **A31.** A flat `{signal:[{name:"clk",wave:"p..."}]}` lists one signal with
  name, wave, data, and period fields.
- **A32.** Editing a wave string or data label updates the preview; Apply writes
  a `wavedrom` fence whose parsed signal has the new value.
- **A33.** Add signal is enabled only for a flat signal list; it appends the
  chosen name and wave at the end.
- **A34.** Delete signal is enabled only for a flat list with no non-empty `edge`
  array.
- **A35.** A non-empty `edge` array makes every Name field read-only; editing
  another field leaves the edge array unchanged.
- **A36.** A group array, a gap, and an unexposed per-signal key are preserved by
  Apply; group and gap rows are read-only; signal order is unchanged.
- **A37.** A non-positive or non-numeric period is rejected inline and blocks
  Apply.
- **A38.** Wave characters are not checked against a hard-coded allowlist; the
  preview is the validator and Apply re-parses the source.
- **A39.** A comment, malformed object, or empty source returns `"render"`.
- **A40.** With a group array present, Add signal and Delete signal are disabled
  with a source-edit note.
- **A41.** Apply writes strict JSON accepted by WaveDrom, and unknown top-level
  keys such as `config`, `head`, and `foot` keep their values.

### Source fallback

- **A42.** The window footer shows **Edit source instead** in the `ready` state;
  clicking it closes without a dirty prompt and opens the hybrid source editor
  for the same block.
- **A43.** **Edit source instead** is also available in the `error` state.
- **A44.** If the target is stale, **Edit source instead** closes the window with
  a notice and opens no editor.
- **A45.** The disabled Design item's title names the source-editing path, and
  the context menu's source item works for that same block.

## 12. Open questions and deferred decisions

- **Q1.** Should Graphviz graph kind, strictness, or graph ID become editable?
  Deferred; v1 preserves them.
- **Q2.** Should WaveDrom `edge` editing become a structured form (source,
  target, arrow, phase) or remain source-only? Deferred; v1 preserves the array.
- **Q3.** Should grouped WaveDrom lists support add, delete, and reorder? Deferred;
  v1 edits existing fields only.
- **Q4.** Should comments be preserved so commented blocks become editable?
  Deferred; v1 disables them rather than dropping comments.
- **Q5.** Should either window get diagram-level undo/redo? Deferred; v1 relies on
  Cancel.
- **Q6.** Should a blank "new diagram" seed be offered from an empty block?
  Decided no for v1; empty blocks are source-only.
