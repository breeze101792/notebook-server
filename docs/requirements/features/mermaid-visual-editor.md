# Feature: in-app visual Mermaid editor

**Author:** product-designer
**Date:** 2026-10-10
**Status:** Product definition. No technical or visual design chosen here.
**Research input:** `docs/research/mermaid-visual-editor-options.md` (Mermaid 11.16.0, Dagre; no coordinate syntax; no official text→graph parser; no no-build-step round-trip library).

---

## 0. One-line definition

A draw.io-like editor, opened from a rendered Mermaid block in a note, that edits
the diagram's **structure and labels** and serializes back to Mermaid **text**.
It edits nodes, edges, labels, and ordering; it never edits geometry, because
Mermaid has no coordinate syntax and layout is automatic.

---

## 1. User goals

The owner opens the visual editor instead of typing Mermaid when:

- **G1 — Create a diagram from scratch without knowing Mermaid syntax.** They
  want a flowchart or sequence diagram but do not remember fence syntax, arrow
  types, or shape brackets. The editor hands them a canvas or a form; the file
  still ends up as plain ```mermaid text.
- **G2 — Edit an existing diagram structurally.** Add or remove a step, rename a
  node, relabel an arrow, change a relationship — without hand-editing ids and
  arrows in the fence, where a typo breaks the whole diagram.
- **G3 — Repair a diagram that failed to parse.** A rendered block showed a
  "Mermaid error" box. They want to see the source, fix it, and get back to a
  working diagram, with validation telling them when it is valid again.
- **G4 — See what a change will look like before committing it.** A live preview
  of the serialized text, so the note is never saved blind.
- **G5 — Understand the diagram's structure at a glance.** Even for types with no
  dedicated canvas, a structured outline of the elements is easier to reason
  about than raw text.

**Non-goal goal (explicit):** the owner does **not** open this editor to control
visual layout, colors, or positions. Those are engine-owned in Mermaid.

---

## 2. Entry points and flows

Every entry point opens one editor instance bound to **one** mermaid block. The
editor is a **modal overlay** (same shell family as the Settings and Export
modals). It has a **Visual** mode and a **Source** (text) mode; Source is always
available, Visual is offered only when the whole diagram is representable
(see §5).

Source of truth for the source text, by entry point:

| # | Entry point | Interaction | Source comes from |
| --- | --- | --- | --- |
| E1 | Rendered block, preview mode | Hover or keyboard-focus a `.mermaid-container` reveals a small floating toolbar; activate **Edit diagram**. This must **not** collide with the existing click-to-lightbox gesture. | `container.dataset.mermaidSource` (via `NB.blocks.sourceOf`) |
| E2 | Rendered block, hybrid WYSIWYG | Right-click the rendered block → context menu → **Edit diagram visually**, next to the existing **Edit mermaid source**. A floating toolbar button may also appear. | Same dataset key |
| E3 | Failed-render error box (`.mermaid-error`) | The error box header gets an **Open visual editor** button (and keeps the raw source visible). | `.mermaid-error .mermaid-source` (`textContent`) |
| E4 | Insert into a note (no path exists today) | Add **Insert → Diagram…** to the hybrid Insert submenu, beside **Code block**. In source-edit mode, expose the same action through the editor's command surface. | none — empty model, user picks a diagram type |
| E5 | Raw fenced block already being edited (hybrid) | The language pill already exists; add an **Edit diagram visually** affordance on the pill row. | the `<code>` `textContent` |

**Role gate.** Writes are admin-only in this app. The entry affordance is hidden
or disabled for a viewer-role session, and the editor refuses Save with a clear
message rather than issuing a request that will 403.

**Flow — E1/E2/E5 (edit existing):**

1. Editor opens; source text is parsed.
2. If parse succeeds and the diagram is fully representable → Visual mode opens
   with the model; Source holds the original text.
3. If parse succeeds but there are opaque constructs → Source mode opens with a
   notice naming the constructs; Visual is disabled.
4. If parse fails → Source mode opens with the parse error; Visual is disabled
   until the text parses.
5. User edits. Save commits per §4. Cancel changes nothing.

**Flow — E3 (repair):**

1. Error box source loads into Source mode; the parse error is shown inline.
2. The user edits text; the editor re-validates on demand and shows valid/invalid.
3. Once valid and dirty, Save replaces the error box's source and the note
   re-renders. Cancel leaves the error box untouched.

**Flow — E4 (insert):**

1. Editor opens with no source. A type chooser is shown (graph types first,
   then structured types, then "Other (text only)" — see §3).
2. Visual mode builds an empty model (or Source for text-only types).
3. Save with zero elements is disabled (nothing to insert).
4. On Save with ≥1 element, a new ```mermaid fence is inserted at the caret (or
   appended to the current selection) in the active editor, as one undo step.
   Cancel inserts nothing.

**Entry affordance rule.** The floating toolbar lives inside the rendered
container, but its button must stop propagation so a click on **Edit diagram**
does not also trigger the container's click-to-lightbox handler. The affordance
must remain present after any re-render of the block.

---

## 3. Editor families and flows

The editor chooses a mode by the parsed diagram type. "Graph-shaped" types get a
node-link canvas; "structured" types get a form/list; everything else opens as
Source text.

### 3.1 Graph-shaped family (canvas)

Applies to: `flowchart`/`graph`, `classDiagram`, `stateDiagram-v2`, `erDiagram`.

**Shared canvas operations and their Mermaid mapping:**

| Operation | Interaction | Mermaid syntax produced | Editable? |
| --- | --- | --- | --- |
| Add node | Double-click empty canvas, or **Add node** button | new id + label: `N2[Label]` (shape depends on type) | yes |
| Rename / relabel node | Double-click node → inline text edit | `N2[New label]` | yes |
| Add edge | Drag from a node's connector handle onto another node | `A --> B` | yes |
| Set edge label | Double-click edge → inline text edit | `A -->\|label\| B` | yes |
| Set edge line type | Edge selected → toolbar | solid `-->` / dotted `-.->` / thick `==>` | yes |
| Set edge arrow head | Edge selected → toolbar | `-->`, `--o`, `--x`, `<-->`, none `---` | yes |
| Delete node | Select + Delete/Backspace, or context menu | removes node and its incident edges | yes |
| Delete edge | Select + Delete/Backspace | removes the edge | yes |
| Set direction | Toolbar dropdown | `direction TD` / `TB` / `BT` / `LR` / `RL` (flowchart only) | yes |
| Group / subgraph | Select nodes → **Group**; or draw a group and assign | `subgraph id [Title] … end` | phase-dependent |
| Node shape | Node selected → shape picker | `[]`, `()`, `[[]]`, `[()]`, `(())`, `{}`, `{{}}`, `[//]`, `[\\]`, `>]` | phase-dependent |
| Free positioning, size, routing | n/a | **does not exist in Mermaid** | **no** |
| `classDef` / `class` / `style` | shown as element attributes or opaque passthrough | preserved or Source-only (§5) | read-only |
| `click` / `linkStyle` / comments / front-matter | opaque | preserved or Source-only (§5) | read-only |

**Per-type node/edge meaning:**

- **flowchart** — node = box (id + label + shape); edge = link (line + head +
  optional label); direction; subgraphs optional. This is the only type with
  free shape choice.
- **classDiagram** — node = class (name + optional ordered member list:
  attributes and methods with visibility, type, return); edge = relationship
  (`<|--` inheritance, `*--` composition, `o--` aggregation, `-->` association,
  `..>` dependency, `..|>` realization) with cardinality on each end and an
  optional label.
- **stateDiagram-v2** — node = state (id + optional display name) or pseudo-state
  (start `[*]`, end `[*]`, choice, fork, join); edge = transition (`-->` or
  `-->`) with an event label; composite states represented as groups; notes
  optional.
- **erDiagram** — node = entity (name + ordered attribute rows: type, name,
  PK/FK markers); edge = relationship with the cardinality pair
  (`||`, `|o`, `}o`, `}|`), identifying (`--`) vs non-identifying (`..`), and a
  label.

**Canvas is automatic-layout only.** The editor never stores or sends a
coordinate. Dragging a node changes nothing about the saved text except where the
drag was used purely to create an edge.

### 3.2 Structured family (form / list, no canvas)

Applies to: `sequenceDiagram`, `gantt`, `pie`, `mindmap`, `timeline`,
`gitGraph`.

| Type | Structure edited | Maps to |
| --- | --- | --- |
| `sequenceDiagram` | Ordered participant list (name, alias, actor vs participant) and ordered message rows (from, to, arrow kind, label); block rows (`alt`/`loop`/`opt`/`par`/`critical`/`break`) with condition; notes | `participant A as B`, `A->>B: msg`, `alt condition … else … end`, `Note over A: text` |
| `gantt` | Header fields (title, dateFormat, axisFormat); sections; tasks (name, id, start or `after` dependency, duration or milestone) | `section S`, `Task :a1, 2014-01-01, 30d`, `milestone` |
| `pie` | Title; slice rows (label, value); showData toggle; computed total shown | `pie title T`, `"Label" : 42` |
| `mindmap` | Outline tree: add child/sibling, rename, reorder, delete | indentation-based `root\n  child` |
| `timeline` | Title; sections; period/event rows, ordered | `timeline`, `section S`, `2020 : event` |
| `gitGraph` | Orientation; ordered command rows (commit, branch, checkout, merge, cherry-pick, tag) with id/message fields | `gitGraph`, `commit id: "x"`, `branch b`, `merge b` |

List editing is ordered: rows can be moved up/down (and by drag where practical);
ordering is source-significant and must be preserved on save.

### 3.3 Text-only fallback family

Every other Mermaid type (for example `journey`, `requirement`, `quadrantChart`,
`xychart-beta`, `sankey-beta`, `block-beta`, `packet-beta`, `architecture-beta`,
`C4*`) opens in **Source mode only**, with a live preview. The editor states
plainly: "No structured editor for this diagram type yet — edit as text."

**All types are openable.** No type produces a dead end: unsupported types still
open, still preview, and still round-trip the source unchanged unless the user
edits it.

### 3.4 Source mode (always available)

A monospace text pane holding the mermaid source, with a live preview and a
validation readout. Visual ↔ Source switching: leaving Visual serializes the
model into Source; returning to Visual re-parses. If the returned text fails to
parse, the editor stays in Source with the error and keeps the user's text.

---

## 4. Save / cancel semantics

- The editor is a **modal** with **Save** and **Cancel**. Nothing is written
  until Save.
- **Cancel / Esc / backdrop:** discard the model and the working text; the note
  is byte-identical to before. The modal close handler follows the existing
  draft-then-commit pattern used by Settings.
- **No change means no write.** If the user made no edit (dirty flag false), or
  the serialized text is identical to the original, Save closes the modal and
  writes nothing. This mirrors `isNoOpMarkdown`.
- **Save with an edit** does all of the following as one unit:
  1. serialize the model (Visual) or take the text pane contents (Source);
  2. validate the result with Mermaid's parse; if invalid, refuse and keep the
     editor open with the error (§5);
  3. replace **only that fence's source**, leaving every other byte of the note
     untouched;
  4. commit the change through the owning editor so it is **one undo step**
     (hybrid history / CM6 transaction / viewer cache + save in preview);
  5. trigger the note's normal dirty → autosave path.
- **Undo:** after Save, one Ctrl+Z in the owning editor restores the previous
  fence in a single step. The modal has its own internal undo for canvas/form
  edits while open, independent of the note's history.
- **Autosave:** never runs while the modal is open — the model is not persisted
  until Save. After Save, the existing debounced autosave applies if enabled.
- **External change while open:** if the underlying note changed on disk (or in
  another tab) during the session, Save must detect the conflict and refuse
  rather than overwrite (§5).
- **Insert (E4)** follows the same rules; a Save with zero elements is disabled.

**Modal, not side panel.** Rationale: the task is focused and full-surface (a
canvas plus a preview plus a source pane), it has explicit Save/Cancel, and it
matches the established overlay pattern. A side panel is too narrow for a canvas
and would fight the existing AI/Search/Recent panel slots. (Visual styling of the
modal is `ui-designer`'s job; this document only fixes behavior.)

---

## 5. Failure and lossy-edit handling

The governing invariant: **the note's existing text is never corrupted or
partially lost.** Worst case, Save is refused or unavailable and the original
bytes stay on disk.

- **Parse failure on open.** The editor opens in Source mode with the raw source
  and the parse error. Visual is disabled. Nothing is rewritten.
- **Opaque / unsupported constructs present.** The editor classifies constructs
  it cannot represent or safely re-emit (examples: `click`, `linkStyle`,
  comments `%%`, front-matter config, or any type-specific syntax outside the
  model). Policy:
  - constructs that can be attributed and re-emitted unchanged are preserved as
    opaque passthrough;
  - if any construct cannot be guaranteed to survive a visual save, **Visual
    mode is disabled** and the editor opens in Source mode with a notice naming
    them. The user may still edit text freely.
- **Save that would drop content.** Before writing, the editor verifies that
  every element present in the original source is present in the serialized
  result (labels and ids preserved, except where the user deleted them). If the
  check fails, Save is refused with a message naming the element at risk.
- **Serialized text must parse.** Before writing, the serialized text is run
  through Mermaid's parse. If it does not parse, Save is refused and the error is
  shown; the editor stays open with the user's work.
- **Concurrent change.** If the note changed between open and Save, Save is
  refused with a "the note changed on disk — reopen" message. It never
  force-writes.
- **No silent removal of directives.** `click`, `style`, `linkStyle`, `classDef`,
  and comments are never removed by a visual save without the user explicitly
  deleting them in Source mode.

---

## 6. Edge cases

| Case | Required behavior |
| --- | --- |
| Empty source | Open with an empty model / empty Source; Save disabled until ≥1 element. |
| Single node, no edges | Valid; saves as one node line. |
| Self-loop | Allowed; serializes `A --> A`. |
| Subgraph / nested group | Representable as a group; serializes with matching `end`. |
| Duplicate labels, distinct ids | Allowed. The UI keys by id and may show the id to disambiguate; labels stay duplicated in text. |
| Duplicate ids in source | Mermaid merges them; the editor treats same-id occurrences as one node. |
| `classDef` / `class` / `style` | Preserved as attributes or passthrough; never dropped (else Source-only). |
| `click` directive | `securityLevel: strict` makes it inert on render. The editor treats it as opaque; visual save is disabled unless it can be preserved. |
| `linkStyle`, comments, front-matter | Opaque; preserved or Source-only. |
| Labels with special characters (`\|`, `]`, quotes, `:`) | Quoting/escaping is applied on serialize so the output parses. |
| Unicode / emoji labels | Accepted and preserved. |
| Generated ids collide with keywords | Id generation avoids Mermaid keywords and existing ids. |
| Very large diagram | A single named ceiling (defined beside the existing renderer limits, e.g. analogous to `MAX_TOTAL_MATCHES`) triggers a warning and offers Source mode; it must not freeze the UI. The value comes from a measured interaction/render budget, not a magic number. |
| Several diagrams in one note | Each editor instance targets exactly one block (the one it was opened from); other blocks are never touched. |
| Editor opened twice on the same block | Second open focuses the existing instance (no duplicate modals). |
| Dark / light theme | Editor and preview follow the resolved body theme, like every other rendered block. |
| Viewer (read-only) role | Entry disabled and Save disabled, not a 403 at the end. |
| Bundle not loaded (offline) | Editor reports that Mermaid is unavailable and opens Source mode read-only; no write occurs. |
| Re-render during session | The editor's target block is identified independently of the DOM node so a re-render cannot misroute the save. |

---

## 7. Testable acceptance criteria

Each item is phrased so a DOM test (jsdom, extending `tests/dom/test_dom.js`)
or a Playwright test can assert it.

1. **jsdom** — opening the editor from a `.mermaid-container` reads its
   `dataset.mermaidSource` and shows exactly that text in Source mode.
2. **jsdom** — opening from a `.mermaid-error` reads its `.mermaid-source`
   `textContent` and shows it in Source mode.
3. **jsdom** — activating the **Edit diagram** button inside a
   `.mermaid-container` does **not** invoke the lightbox (the lightbox overlay
   stays hidden).
4. **jsdom** — the **Edit diagram** affordance is present again after the block
   is re-rendered.
5. **Playwright** — adding one node to a flowchart and saving writes one new node
   line into the note's fence; all pre-existing nodes, edges, and labels are
   still present.
6. **Playwright** — renaming a node's label changes only that label in the saved
   text and leaves all other bytes of the note unchanged.
7. **Playwright** — adding an edge with a label produces an edge with that label
   that parses.
8. **Playwright** — deleting a node removes the node and its incident edges and
   no other element.
9. **jsdom** — opening the editor and clicking Save with no edit issues no
   `POST /api/file` and closes the modal.
10. **jsdom** — Cancel after edits issues no write and leaves the block source
    unchanged.
11. **Playwright** — a visual save is exactly one undo step: after Save, one
    Ctrl+Z restores the previous fence text.
12. **jsdom** — a source that fails to parse opens in Source mode with the parse
    error shown and Visual mode disabled.
13. **jsdom** — a flowchart containing a `click` directive (or `linkStyle`,
    comment, or front-matter) opens in Source mode with a notice and Visual
    disabled; the source is not modified.
14. **Playwright** — after any visual save, running Mermaid's parse on the saved
    fence succeeds.
15. **Playwright** — given a diagram fully representable by the model, a visual
    save that adds one node preserves every original node id, label, and edge.
16. **jsdom** — a proposed save whose serialized text differs from the original
    in an element the user did not delete is refused and the file is unchanged.
17. **jsdom** — a save attempted while the note changed on disk is refused and no
    write occurs.
18. **Playwright** — **Insert → Diagram…** with zero elements has Save disabled;
    with one node, Save inserts exactly one ```mermaid fence at the caret and
    touches nothing else.
19. **jsdom** — a `sequenceDiagram` source opens a structured editor whose rows
    match the parsed participants and messages; adding a message row and saving
    emits that message line.
20. **jsdom** — each structured type (`gantt`, `pie`, `mindmap`, `timeline`,
    `gitGraph`) opens its form/list and a representative edit round-trips to text
    that parses.
21. **jsdom** — a type with no structured editor (e.g. `journey`,
    `xychart-beta`) opens in Source mode with a live preview; an unedited save
    writes nothing.
22. **jsdom** — an empty source opens with Save disabled until an element exists.
23. **jsdom** — a self-loop source round-trips as `A --> A`.
24. **jsdom** — duplicate labels with distinct ids are preserved on save.
25. **jsdom** — a viewer-role session has the entry affordance and Save hidden or
    disabled, and no write request is issued.
26. **Playwright** — a diagram above the named size ceiling shows the warning and
    offers Source mode without freezing the UI.
27. **jsdom** — opening the editor twice on the same block yields one modal.

---

## 8. Explicit non-goals

- Pixel-accurate or any user-controlled positioning, node size, or edge routing.
- Persisting coordinates anywhere (there is no Mermaid syntax for them; a sidecar
  format is out of scope).
- Freeform shape drawing, a shape/stencil library, or draw.io XML import/export.
- Importing or exporting SVG/PNG/XML from the editor (Export already handles the
  note; diagram image export is separate).
- Editing the rendered SVG directly.
- A real-time, multi-user, or collaborative canvas.
- Editing theme, colors, or fonts visually (beyond preserving author-written
  `classDef`/`style` text).
- Making `click` links active (they stay inert under `securityLevel: strict`).
- A full Mermaid language server or autocomplete for every keyword.

---

## 9. Recommended phasing

The stated wish is "all diagram types". Phasing satisfies that by guaranteeing
**openability** for all types from the start, while growing which types are
**visually** editable.

- **Phase 1 — MVP (flowchart, end to end).**
  - Entries E1/E2/E3 and E5.
  - Modal with Visual + Source modes; parse gate and unsupported-construct gate.
  - Flowchart canvas: add/rename/delete node, add/delete edge, edge label, line
    type and arrow head, direction.
  - Save/Cancel semantics, no-op write, one-undo-step, validate-before-write,
    concurrent-change refusal.
  - Text-only fallback for every other type (all types openable).
  - Insert path E4 with a type chooser limited to what Phase 1 supports plus
    "Other (text only)".
- **Phase 2 — graph family completes.** `stateDiagram-v2`, `classDiagram`,
  `erDiagram` canvases (nodes, edges, type-specific attributes, cardinality).
  Node shapes; subgraphs/groups.
- **Phase 3 — sequence.** Structured sequence editor (participants, messages,
  blocks, notes).
- **Phase 4 — remaining structured types.** `gantt`, `pie`, `mindmap`,
  `timeline`, `gitGraph`.
- **Phase 5 — polish.** Larger-diagram performance, richer passthrough for
  `classDef`/`style`, and structured editors for any remaining types the owner
  actually uses.

**MVP line:** ship Phase 1. It delivers goals G1–G5 for the most common diagram
type and guarantees no type is a dead end, which is the honest reading of "all
diagram types" given the engine's constraints.

---

## 10. Open questions

1. **Parser choice.** Text→model depends on a parser with no official Mermaid
   API. The editor's representable set (and therefore when Visual is disabled)
   depends on what that parser covers. Owner: `architect` (design), with
   `researcher` verifying coverage against the vendored 11.16.0.
2. **`classDef`/`style` representation.** Preserve as first-class element
   attributes, or treat as opaque passthrough, or Source-only? Affects how many
   real notes are visually editable. Owner: `architect` + `plan`.
3. **Preview-entry save path.** Confirm the rule that E1 auto-enters an editable
   mode (hybrid) before opening, so Save/undo/autosave share one path, versus
   writing through the viewer cache from preview. Owner: `plan`.
4. **The large-diagram ceiling.** The actual node/edge value and the measured
   budget behind it. Owner: `architect` / `hil-tester` if measured on target.
5. **Type chooser in E4 for Phase 1.** Which types appear as visual versus "text
   only" in the first release. Owner: product (this doc) once §10.1 lands.
6. **Toolbar affordance conflict.** Confirm the hover-toolbar button is the right
   primary entry in preview versus a modifier-click or a container context menu,
   given click already opens the lightbox. Owner: `ui-designer` (interaction),
   product (behavior).

---

## Amendment 2026-10-19

The three-block in-place editing scope (flowchart, sequence, pie in
`notebook/Syntax.md`) is now governed by
[`docs/product/mermaid-chart-editing.md`](../../product/mermaid-chart-editing.md).
That document defines the verified current gaps, required vs deferred edits,
flows, and acceptance criteria for existing rendered blocks. This document
remains the original broad product definition; where the two differ on the
three-block scope, the new document wins.
