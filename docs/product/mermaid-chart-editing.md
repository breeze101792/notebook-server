# Mermaid chart editing — product definition

**Status:** Product definition for review. No visual or technical design chosen here.
**Date:** 2026-10-19
**Owner:** `product-designer`
**Scope:** The three Mermaid fenced blocks in `notebook/Syntax.md`:
`graph TD` (Flowchart), `sequenceDiagram` (Sequence), and
`pie title Where the bytes go` (Pie).

Related documents:

- `docs/architecture/mermaid-designer.md` — locked write-back contract (F1/F3/F5).
- `docs/architecture/mermaid-designer-coverage.md` — per-type add coverage.
- `docs/requirements/features/mermaid-visual-editor.md` — original broad product definition.

## 1. Problem

The owner expects "Design diagram…" to edit the chart they see. Today it is
mostly an **add** panel. The owner's three blocks do open, and most element
editing exists, but it is hidden behind canvas gestures that the modal never
names. The visible sidebar offers only "Add" actions, and the one hint is
flowchart-specific.

This is a verified gap between expectation and presentation, not a complete
absence of editing.

### 1.1 What the owner can do today

Sources: **[code]** = read from our source; **[bundle]** = read from
`static/vendor/visimer.bundle.js`; **[probe]** = run against the real bundle in
Node with a throwaway script. No real-browser sequence/pie interaction was
observed in this pass.

| Type | Works today | Not reachable today | Why it feels add-only |
| --- | --- | --- | --- |
| Flowchart | Add 14 shapes. Rename a node label by double-click or Enter. Change shape, color, duplicate, or delete from the node popover. Add an edge with Connect/Alt+drag. Relabel an edge by double-click. Change edge arrow, stroke, reverse, or delete from the edge popover. Undo/redo. **[code]** `mermaid-designer.js:110-118, 364-395`; **[bundle]** `MermaidCanvasView.actionsFor`, `editEntityLabel`, `onSvgPointerUp` | Flowchart direction (TD/TB/BT/LR/RL). Six of the 14 shapes on an existing node (the popover lists 8). No named instruction for rename, edge-label edit, or delete. **[bundle]** `setNodeShape` accepts all 14 **[probe]**; `setDirection` exists as a dispatch case but no canvas action invokes it. | The sidebar is just "Shapes". The hint says "click a node for shape, color and arrow options" and never mentions renaming, edges, or delete. `templates/index.html:1098-1100` |
| Sequence | Add a participant. Rename a participant alias, change participant type, or delete from the participant popover. Edit message text by double-click. Change message arrow, reverse, wrap in fragment, or delete from the message popover. Reorder messages by dragging. Add a message or note from the lifeline `+`. Edit or delete a note. Undo/redo. **[code]** `mermaid-designer.js:116`; **[bundle]** `actionsFor`, `editEntityLabel`, `onSvgPointerUp` (`seq.moveEvent`), `showLifelinePlus` (`seq.addMessage`, `seq.addNote`) | Autonumber. Activation/deactivation. Participant reorder. Explicit "add message" control outside the hover `+`. **[bundle]** `seq.toggleAutonumber` exists but no canvas action invokes it; no activation dispatch op exists; no participant reorder op exists. | The sidebar is only "Add participant". The hint talks about nodes, colors, and arrows, which do not exist in a sequence diagram. `mermaid-designer.js:391-394`; `templates/index.html:1098-1100` |
| Pie | Add a slice. Edit a slice's label or value from the slice popover. Double-click edits the value. Delete a slice. Undo/redo. **[bundle]** `actionsFor`, `editEntityLabel` (`pie.setValue`, `pie.setLabel`), `deleteEntities` (`pie.deleteSlice`) | Edit the title. Add a slice with a chosen label/value instead of the fixed "New slice"/10 defaults. Reorder slices. Show/hide data values. The parsed pie model has `showData` and `slices`, but no title. There is no `pie.setTitle` dispatch case; a `pie.setTitle` dispatch is a silent no-op **[probe]**. | The sidebar is only "Add slice". The hint is the flowchart hint. The title is not in the visual model at all. `mermaid-designer.js:114`; `ADD_DEFAULTS` at `mermaid-designer.js:95-105` |

### 1.2 Verified conclusion

- Flowchart: the required structural edits mostly exist but are undiscoverable.
  Direction is genuinely missing, and six shapes cannot be reached on an
  existing node.
- Sequence: the element edits mostly exist but are undiscoverable. Autonumber,
  activation, and participant reorder are genuinely missing.
- Pie: label/value/delete exist but are undiscoverable. The title is genuinely
  missing from the visual model, and add-slice gives the user a placeholder
  instead of asking for the slice.
- The modal's hint never changes by type, and the sidebar only changes from a
  shape grid to a single add button. That is the strongest cause of "it can't
  really edit the chart".

## 2. Who and why

One owner, editing their own notes, on their own server. There is no multi-user
review, approval, or collaborative editing. The owner is usually an admin
session because writes are admin-only. The goal is to change an existing
diagram's structure and labels without hand-editing Mermaid syntax, while
keeping the note as plain `mermaid` text.

## 3. Scope

### 3.1 In scope

- The three existing rendered blocks in `notebook/Syntax.md`.
- The same behavior for any other existing block of these three families:
  `flowchart`/`graph`, `sequenceDiagram`, `pie`.
- Editing existing elements and adding/deleting elements within those families.
- Live preview before Apply.
- The existing hybrid (WYSIWYG) entry point.

**MVP line:** all required edits in §4 work for the three blocks, are
discoverable without knowing the library's gestures, and preserve the note's
other bytes.

### 3.2 Out of scope

| Out of scope | Stays on the existing path |
| --- | --- |
| Other Mermaid types (state, class, er, gantt, journey, etc.) | "Edit mermaid source" and the current add-only designer behavior, unchanged |
| Creating a diagram from scratch or inserting a new fence | Existing source editing; the empty-fence seed is not a creation flow |
| Layout, coordinates, node size, edge routing | Mermaid owns layout; no product change |
| Colors, themes, fonts | Existing canvas color controls may remain, but are not required or tested here |
| Changing the fence language | Source editor's language pill |
| Server-side changes, new routes, disk staleness checks | Existing `/api/file` and hybrid write path |
| Collaborative or multi-user editing | None |
| Freeform drawing, subgraph creation, `classDef`/`style` authoring | Source editing; untouched constructs must be preserved |
| A Source mode inside the designer modal | The existing raw-fence editor |

## 4. Editing model

Every required edit updates the live preview immediately. Nothing is written to
the note until Apply. Each edit is one internal undo step.

### 4.1 Flowchart

**What the user does:** select a node or edge; the modal exposes the edits for
that element by name. Labels can be edited in place. A Connect action creates an
edge by choosing a source and a target. A direction control changes the whole
chart.

| Edit | V1 | Notes |
| --- | --- | --- |
| Select a node | Required | Selection must show the node's available edits |
| Rename a node label | Required | Label only; id stays stable so references do not break |
| Change a node shape | Required | All 14 shapes the model supports, including the six the current popover omits |
| Add a node | Required | Shape and label chosen by the user |
| Delete a node | Required | Removes only that node and its incident edges |
| Add an edge | Required | Source and target chosen; edge must parse |
| Delete an edge | Required | Removes only that edge |
| Relabel an edge | Required | Includes adding a label to an unlabeled edge |
| Reverse an edge | Required | Source and target swap |
| Change edge line style | Required | Solid, dotted, thick; the set the model supports |
| Change edge arrowheads | Required | The set the model supports, including no arrow |
| Change flowchart direction | Required | TD/TB/BT/LR/RL |
| Undo/redo | Required | Internal to the modal |
| Group/subgraph creation | Deferred | Source editing |
| Edge animation, edge curve, colors | Deferred | Existing library extras; not required |
| `classDef`, `style`, `linkStyle`, `click` authoring | Deferred | Preserve verbatim; source for changes |

### 4.2 Sequence

**What the user does:** select a participant or a message/note row; the modal
exposes the edits for that row by name. A message can be inserted at a chosen
position. Messages can be reordered. A chart-level control toggles autonumber.

| Edit | V1 | Notes |
| --- | --- | --- |
| Select a participant | Required | Selection must show the participant's available edits |
| Rename a participant alias | Required | Changes the display name; the id stays stable |
| Change participant type | Required | The supported set: participant, actor, boundary, control, entity, database, collections, queue |
| Add a participant | Required | |
| Delete a participant | Required | Removes that participant and its messages; no other message is lost |
| Edit message text | Required | |
| Add a message | Required | Source, target, text, and insertion position chosen by the user |
| Delete a message | Required | Removes only that message |
| Reorder messages | Required | Saved order matches the preview |
| Change message arrow type | Required | The supported set |
| Reverse a message | Required | Source and target swap |
| Add/edit/delete a note | Required | Note text is editable |
| Toggle autonumber | Required | Chart-level on/off |
| Undo/redo | Required | Internal to the modal |
| Activation/deactivation | Deferred | The model parses it but has no edit operation; source editing |
| Participant reorder | Deferred | No model operation; source editing |
| Participant id editing | Deferred | Would break message references |
| Fragment wrappers (`alt`, `loop`, etc.) | Deferred | The library can wrap a message, but this is not part of the three-block complaint |

### 4.3 Pie

**What the user does:** select a slice; edit its label and value. Add a slice by
entering its label and value, not by accepting a placeholder. Delete a slice.
The title is a separate decision because the visual model does not carry it.

| Edit | V1 | Notes |
| --- | --- | --- |
| Select a slice | Required | Selection must show the slice's available edits |
| Edit a slice label | Required | |
| Edit a slice value | Required | Finite, non-negative number; the model rejects negatives |
| Add a slice | Required | The user supplies label and value |
| Delete a slice | Required | |
| Undo/redo | Required | Internal to the modal |
| Edit the title | Deferred pending owner decision | No title in the visual model and no title operation. Options: a targeted title-line edit outside the visual model, or keep title editing in the source editor. See §9 |
| Reorder slices | Deferred | No model operation; order follows the source |
| Show/hide data values | Deferred | Parsed but no edit operation; source editing |

### 4.4 Common editing rules

- Selection is explicit. Every required edit is reachable from a named control,
  menu item, or inline edit after selection. No required edit depends only on an
  undisclosed double-click, Alt+drag, or hover.
- The modal's help text is type-specific. A sequence or pie user must never see
  node-shape or Connect instructions.
- Adding an element asks for its meaningful fields (label, value, source,
  target). It does not add a fixed placeholder that the user must then find and
  edit.
- Undo/redo covers every canvas edit. Ctrl/Cmd+Z while the modal is open never
  reaches the note.
- The note's existing source is authoritative. An edit that cannot be
  represented must not be guessed.

## 5. Entry points

**V1 entry:** hybrid mode → right-click a rendered block (or focus it and use
Shift+F10 / the Menu key) → **Design diagram…**. This is the existing entry at
`static/js/hybrid.js:6096-6123`.

**Why only hybrid:**

- The tested write-back path is the hybrid DOM path. It already provides
  target re-resolution, validation, one undo step, and autosave.
- Preview mode would need a separate write path and undo/autosave semantics.
  That is not needed to fix the owner's complaint.
- Error boxes are a repair problem, not a chart-editing problem. The existing
  **Edit mermaid source** path is the right repair tool. The designer may keep
  its graceful "can't edit visually — edit source instead" fallback, but error
  repair is not a required v1 entry.

**Role gate:** the item is shown only when auth is off or the role is admin
(`static/js/hybrid.js:5857-5862`). A viewer session never sees it and no write
is attempted. A stale role falls through to the existing auth failure path and
must not write.

**Keyboard:** the rendered block stays focusable, so the context menu and
"Design diagram…" remain reachable without a mouse.

## 6. Core flows

### 6.1 Open an existing diagram

1. Hybrid is active. The user opens the block's context menu and chooses
   **Design diagram…**.
2. The modal captures the target by parent, position, and source. The note is
   not changed.
3. The editor loads lazily. If the library or renderer fails to load, show a
   clear notice; do not leave a half-open modal.
4. If the type is render-only or the source cannot be parsed, show an error or
   non-editable notice with **Edit source instead**. Do not write.
5. Otherwise the parsed model is shown and the modal is ready.

### 6.2 Edit with live preview

1. The user selects an element or uses an add control.
2. The canvas re-renders after each edit. The note is untouched.
3. Internal undo/redo applies only to the canvas.
4. An edit that would produce invalid Mermaid may leave the preview usable, but
   Apply is the gate: invalid source is never written.

### 6.3 Apply

Apply is the only note write. The order is the existing contract
(`docs/architecture/mermaid-designer.md:101-128`):

1. If the source equals the open-time source, close and write nothing.
2. Validate the source with Mermaid's parser. On failure, keep the modal open,
   show the error, and write nothing.
3. Confirm hybrid mode is still active. If not, abort with a notice and write
   nothing.
4. Re-resolve the target block and require its source to match the captured
   source. If it changed, abort with a notice and write nothing.
5. Replace only that block's fence, re-render it, mark the note dirty as one
   undo step, and close.

No-op Apply must not mark the note dirty.

### 6.4 Cancel, Esc, backdrop

Write nothing. If the canvas has unsaved edits, ask the user to confirm discard
before closing. The note stays byte-identical.

### 6.5 Invalid or failing Apply

- Validation failure: modal stays open; the user can fix or cancel.
- Target changed, hybrid exited, or block detached: modal closes with a notice;
  no partial swap or write.
- Failure after the block is swapped but before the note is marked dirty: show
  an error and leave the source recoverable. Never mark a broken fence as
  successfully saved.

### 6.6 External file change while the modal is open

The existing guard is source verification against the live DOM. If the note
re-renders or the target block is replaced, Apply aborts. There is no disk mtime
check in v1; a disk change that is not reflected in the open note is not
detected. That limitation is stated in §9.

## 7. Edge cases

| Case | Required behavior |
| --- | --- |
| Empty fence | Keep the existing seeded blank flowchart behavior. It is not a creation flow and is not part of the three-block MVP. |
| Parse-error fence | Do not open the visual model. Show the non-editable notice and **Edit source instead**. |
| Render-only or unsupported type | Show the non-editable notice and **Edit source instead**. No sidebar, no Apply. |
| Very large diagram | If the measured interaction/render budget is exceeded, show a warning and keep source editing available. The threshold is measured by the test plan, not a product magic number. Do not freeze the page. |
| Duplicate flowchart ids | Mermaid merges same-id occurrences. The editor treats them as one node; deleting it removes all its references. |
| Duplicate sequence participant ids | The source may be invalid or ambiguous. Parse/validation decides; never guess. |
| Duplicate pie labels | The library maps legend text to the first matching slice. If a label is duplicated, do not silently edit the wrong slice. Require explicit disambiguation or source fallback. |
| Constructs the visual model cannot represent (flowchart `click`/`classDef`/`style`/`linkStyle`/comments/front-matter, sequence activation, pie title/showData) | Preserve untouched constructs byte-for-byte. If an edit would drop or corrupt one, refuse the edit and point to source editing. Never silently lose text. |
| Several diagrams in one note | The modal targets exactly the block it was opened from. Other blocks are never touched. |
| Modal opened twice on the same block | Focus the existing modal; do not create a second one. |
| Theme change while open | The canvas follows the resolved body theme, as it does today. Not a v1 acceptance requirement. |
| Viewer session | No designer entry. No write attempt. |

## 8. Acceptance criteria

Each item is testable with the existing jsdom harness (`tests/dom/test_dom.js`)
or the real-browser harness (`tests/browser/`).

1. **Entry and role.** In hybrid, for each of the three `Syntax.md` blocks, an
   admin (or auth-off) session sees and can activate **Design diagram…**; a
   viewer session does not see it.
2. **Open.** Each of the three blocks opens to the ready state (Apply enabled,
   no error notice) and reports its type: flowchart, sequence, pie.
3. **Flowchart rename and shape.** Renaming an existing node and changing its
   shape each update the live preview; Apply writes the new label/shape and
   preserves every other node and edge.
4. **Flowchart node add/delete.** Adding a node and deleting a node with
   incident edges updates the preview; Apply adds the node or removes the node
   and only its incident edges.
5. **Flowchart edges.** Adding an edge by connecting two nodes, relabeling an
   existing edge, reversing it, and changing its line style and arrowheads each
   update the preview; Apply writes the change and the fence parses.
6. **Flowchart direction.** Changing the direction updates the preview and the
   saved fence; no node or edge is lost.
7. **Sequence participants.** Renaming a participant alias, changing its type,
   adding a participant, and deleting a participant each update the preview;
   deleting a participant removes its messages and no other message.
8. **Sequence messages.** Editing message text, adding a message, deleting a
   message, and reordering two messages each update the preview; Apply writes
   the new text/order and preserves every other message.
9. **Sequence message style.** Changing a message arrow type and reversing a
   message update the preview; Apply writes the change and the fence parses.
10. **Sequence notes and autonumber.** Adding, editing, and deleting a note, and
    toggling autonumber, each update the preview; Apply writes the change and
    the fence parses.
11. **Pie slices.** Editing a slice label and value, adding a slice with the
    entered label/value, and deleting a slice each update the preview; Apply
    writes the changes and leaves the title unchanged.
12. **Pie invalid value.** A negative or non-numeric slice value is rejected
    before Apply; no invalid value reaches the fence.
13. **Discoverability.** For every required edit in §4, a named control, menu
    item, or inline edit is reachable in the modal. The sequence and pie hints
    name participant/message/slice actions and do not mention node shapes.
14. **Apply exactness.** Every edited Apply writes exactly one `mermaid` fence
    for the opened block; every byte outside that fence is identical; the fence
    language remains `mermaid`; the saved source parses.
15. **Multiple blocks.** Editing the flowchart leaves the sequence and pie
    fences byte-identical; editing the sequence leaves the flowchart and pie
    fences byte-identical; editing the pie leaves the other two byte-identical.
16. **Cancel.** Cancel, Esc, and backdrop write nothing; with no edits the note
    is byte-identical; with edits the user is asked to confirm discard.
17. **No-op Apply.** Apply with no edit closes, issues no write, and does not
    mark the note dirty or create an undo step.
18. **Invalid source.** When Apply validation fails, the modal stays open, shows
    the error, issues no write or dirty step, and leaves the note byte-identical.
19. **Stale target.** If the target block is re-rendered, replaced, or no longer
    matches its captured source while the modal is open, Apply aborts with a
    notice and writes nothing.
20. **Hybrid inactive.** If hybrid mode is exited while the modal is open, Apply
    aborts with a notice and writes nothing.
21. **Unsupported constructs.** A flowchart with a comment, `classDef`, or
    subgraph, or a sequence with activation, opens or falls back. A visual Apply
    either preserves every such construct verbatim or refuses and leaves the
    source byte-identical. No construct is silently dropped.
22. **Fallback.** A parse-error fence or render-only type shows the
    non-editable notice with **Edit source instead**; activating it opens the
    existing source editor and writes nothing.
23. **Undo isolation.** Undo/redo inside the modal affects only the canvas; after
    Apply, one Ctrl+Z in the note restores the previous fence as one step.

## 9. Assumptions and open questions

### Assumptions

- The three `Syntax.md` blocks are the representative examples; the behavior
  applies to other blocks of the same three families.
- Real-browser sequence and pie canvas behavior is inferred from the vendored
  bundle's own click, double-click, popover, and drag handlers. The repo's
  Playwright coverage exercises only flowchart add/Apply
  (`tests/browser/test_designer_browser.js:188-213`). DOM/browser tests must
  observe the sequence and pie gestures before release.
- The visual model's untouched lines are preserved by the library. The gate
  verified byte-identical round-trips for comments, subgraphs, and `classDef`;
  this product definition requires that property to hold for the three blocks.
- Only the live DOM is checked at Apply. There is no disk mtime conflict check.
- The owner is the only editor and is normally an admin.

### Open question for the owner

Pie title: the visual model has no title and no title operation. Should v1 add a targeted title-line edit outside the visual model, or keep title editing in the source editor?

## 10. V2 backlog (recorded 2026-10-19)

V1 ships the three scoped families with the inspector and add forms. These items
are deliberately deferred and are the input for a later v2 scope:

- **Pie:** title editing (the open question above), slice reorder, show/hide
  data values.
- **Sequence:** activation/deactivation, participant reorder, participant id
  editing, fragment wrappers.
- **Flowchart:** subgraph creation, colors, edge animation/curve,
  `classDef`/`style`/`linkStyle`/`click` authoring.
- **Other Mermaid families:** state, class, er, gantt, journey, and the rest
  keep the add-only sidebar. Inspector parity for those families is v2.
- **Entry and chrome:** create-from-scratch, preview-mode entry, canvas type
  badge, and full keyboard traversal of diagram elements.
- **Verification debt:** real-browser checks for the v1 inspector, focus
  retention, compact layout, and sequence/pie gestures were blocked on the
  build host. They must pass before v2 is called stable.

A sensible v2 slice is pie title plus sequence structural edits plus inspector
parity for the other editable families. Do not expand v2 to layout, colors, or
a second editor.
