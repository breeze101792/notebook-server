# Mermaid editor — edit UI redesign

**Status:** Design only. No source, template, or test files were changed.
**Date:** 2026-10-19
**Owner:** `ui-designer`
**Mockup:** `docs/design/mermaid-editor.html`

Related documents:

- `docs/product/mermaid-chart-editing.md` — the product definition and §4 required edits.
- `docs/architecture/mermaid-designer.md` — the locked write-back contract.
- `docs/architecture/mermaid-designer-coverage.md` — per-type canvas/add coverage.
- `docs/design/settings-modal.md` — the shared modal language and scoped-token pattern.

This document is **normative** for the edit UI. The mockup illustrates it; where
the two disagree, this document wins. It does not change the Visimer bundle, the
Mermaid renderer, the write-back contract, or the entry point.

---

## 1. Goal and the gap it fixes

The owner opens “Design diagram…” to edit the chart they see. Today the modal
opens, but its visible sidebar is only an **Add** panel. Required edits exist on
the canvas behind unnamed double-clicks, popovers, Alt+drag, and hover `+`
buttons. The one hint is flowchart-specific and is shown for sequence and pie
diagrams too. The result reads as “add-only” even when the model can edit.

This design fixes the **presentation and information architecture**:

1. Selecting an element opens a **named, contextual inspector** with every
   required edit for that element.
2. The build sidebar presents the **right add controls and chart-level controls
   for the open type**, not a generic shape palette.
3. Every add form asks for the meaningful fields instead of inserting a fixed
   placeholder.
4. Help text is **type-specific**.
5. The canvas stays the primary surface and the largest region.

The canvas, the library, and the note write-back remain as they are. This is a
new chrome layer over the same model.

### 1.1 Scope rule

| Family | This design |
| --- | --- |
| `flowchart` / `graph`, `sequenceDiagram`, `pie` | Full two-panel edit UI, inspector, type-specific add forms |
| Every other editable Visimer family | **Unchanged** add-only sidebar and current canvas behavior |
| `zenuml` / render-only | Existing “Preview only” notice, now with **Edit source instead** |

Do not carry the inspector or the new add forms into the other 19 editable
families. Their hint may use the generic copy in §6.5; their behavior does not
change.

---

## 2. Design intent

- **Canvas first.** The canvas keeps the majority of the body. The inspector is
  narrow and scrolls; it never pushes the canvas below a useful size.
- **One selected element, one inspector.** No required edit depends on a popover
  or gesture. The library popover is suppressed in this modal; the inspector is
  the single named path.
- **Build on the left, inspect on the right.** Add actions are occasional and
  belong in a narrow column. Element edits are frequent and belong beside the
  canvas.
- **Calm chrome.** Reuse the app’s typography, radii, borders, and semantic
  tokens. No new fonts, icon libraries, or decorative panels.
- **Every state says what it is.** Selection, dirty state, applying, and
  validation failures are carried by words as well as color.
- **Restraint.** The inspector shows only the selected type’s edits. It does not
  become a property sheet for the whole diagram.

---

## 3. Layout

### 3.1 Regions

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header   Design diagram        [FLOWCHART]                       ×   │
├──────────────────┬──────────────────────────────┬────────────────────┤
│ Build sidebar    │ Stage                        │ Inspector          │
│ 236px            │ dot-grid canvas              │ 296px              │
│                  │                              │                    │
│ Tools            │  ┌────────────┐              │ Node · A           │
│ Add tabs         │  │  diagram   │              │ Label  [________]  │
│ Add form         │  └────────────┘              │ Shape  [grid]      │
│ Chart            │                              │ Actions            │
│ ─────────        │  hint pill (no selection)    │                    │
│ History (sticky) │                              │                    │
├──────────────────┴──────────────────────────────┴────────────────────┤
│ Footer   Unsaved changes                    Cancel    Apply         │
└──────────────────────────────────────────────────────────────────────┘
```

The existing shell is kept: `#designer-overlay.settings-overlay` →
`.settings-modal.designer-modal` → header / body / footer. The body becomes a
three-column flex row. The two side panels are siblings of the stage.

### 3.2 Dimensions

| Region | Value | Notes |
| --- | --- | --- |
| Modal | `min(1320px, 96vw)` × `min(85vh, 92vh)` | Raise `--designer-modal-w` from 1200 to 1320 so the canvas stays large with two panels. Keep the existing height token. |
| Header | `padding: 14px 18px`; title 1.14rem/600 | Existing `.settings-header`; add the type badge. |
| Build sidebar | `flex: 0 0 236px`; `padding: 12px 10px`; gap 10px | Scrolls independently; `--bg-elev`; right border. |
| Stage | `flex: 1 1 auto; min-width: 0` | The canvas is absolutely inset; dot grid unchanged. |
| Inspector | `flex: 0 0 296px`; header 48px; body `padding: 12px` | Scrolls independently; `--bg-elev`; left border. |
| Footer | `padding: 12px 18px`; gap 8px | Status left, Cancel/Apply right. |
| Canvas at 1320px | ≈ 788 × body height | ≈ 692px wide at the 1228px clamp. |
| Radii | 6px fields/buttons, 8px cards, 999px pills | Reuse the Settings scale. |

The stage never gets a horizontal scrollbar. Long labels truncate in the
inspector header and wrap in fields; panels use `min-width: 0`.

### 3.3 Responsive rules

Use a **container query on the modal**, not the viewport: `NB.windows` can
resize the modal independently of the window.

```css
.designer-modal { container-type: inline-size; container-name: designer; }

@container designer (max-width: 960px) {
  /* build strip + stage + bottom sheet */
}
```

A `@media (max-width: 960px)` fallback is acceptable if the project does not
adopt container queries; the two must not both fire different layouts.

| Width | Layout |
| --- | --- |
| > 960px container | Two-panel: build sidebar 236 + stage + inspector 296. |
| ≤ 960px container | Build **strip** 48px above the stage; the inspector becomes a **bottom sheet** inside the stage. |

**Compact (≤ 960px) details**

- The build sidebar becomes a single horizontal strip above the stage:
  `[Select] [Connect]  [Node|Edge]  [Undo] [Redo]`. The strip scrolls
  horizontally if needed. It keeps `aria-pressed` / `aria-selected` semantics.
- Tapping an add tab opens the bottom sheet with that add form. Selecting a
  canvas element opens the same sheet with the inspector.
- The sheet is `position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;`
  with a 44px grabber bar and a body capped at `55%` of the stage height. It
  slides up; `prefers-reduced-motion` removes the transition.
- Collapsed, the grabber shows the current context: `Node A · Open a .md file`
  or `Add node`. Tapping it expands. The close (×) collapses it without clearing
  the selection.
- The stage reserves 44px at the bottom for the collapsed bar so the canvas is
  never fully covered.
- The footer stays outside the stage and is always visible. The status wraps
  above Cancel/Apply at ≤ 480px, matching the existing designer footer rule.
- The canvas keeps at least ~45% of the body height when the sheet is open.

At ≤ 720px, the app’s existing horizontal-strip rules are replaced by this
strip + sheet behavior for the three scoped families. Other families keep the
existing strip.

### 3.4 Scroll ownership

- Build sidebar: scrolls; **History is sticky at the bottom** with a top border,
  so undo/redo remain reachable after a long form.
- Inspector: header fixed, body scrolls.
- Footer: fixed outside the body.
- Canvas: pan/zoom only; no scrollbar. The hint pill is the only overlay at the
  bottom center.

---

## 4. Design tokens

Reuse the app tokens. Add one scoped block on `#designer-overlay`:

```css
#designer-overlay {
  /* Spacing (px keeps the panel rhythm constant while rem text scales). */
  --designer-space-1: 4px;
  --designer-space-2: 6px;
  --designer-space-3: 8px;
  --designer-space-4: 12px;
  --designer-space-5: 16px;
  --designer-space-6: 24px;

  --designer-radius-sm: 6px;
  --designer-radius-md: 8px;
  --designer-radius-pill: 999px;

  --designer-sidebar-w: 236px;
  --designer-inspector-w: 296px;
  --designer-field-h: 32px;

  /* Same accessible secondary text as Settings: the app default
   * --fg-muted is 4.26:1 on --bg-elev in dark. */
  --fg-muted: #9799a4;

  --designer-ok: var(--ok);
  --designer-warn: var(--warn);
}
body[data-theme="light"] #designer-overlay {
  --fg-muted: #5d6470;       /* 5.13:1 on --bg-elev */
  --designer-ok: #16703f;    /* 5.28:1 */
  --designer-warn: #8a5a0b;  /* 5.10:1 */
}
```

Existing designer tokens stay: `--designer-canvas-bg`, `--designer-grid`,
`--designer-grid-size`, `--designer-modal-w` (raised to 1320px),
`--designer-modal-h`, `--accent-fg`.

| Role | Token |
| --- | --- |
| Modal surface | `--bg-panel` |
| Panel surface | `--bg-elev` |
| Field well | `--code-bg` |
| Canvas | `--designer-canvas-bg` + `--designer-grid` |
| Primary text | `--fg` |
| Secondary text | `--fg-muted` (scoped) |
| Hairline | `--border` |
| Selected / primary | `--accent`, `--accent-soft`, `--accent-fg` |
| Success status | `--designer-ok` |
| Warning status | `--designer-warn` |
| Destructive | `--danger`, `--danger-soft` |

No new color values outside the two light-theme status variants. Chart colors
remain Mermaid’s; the editor does not recolor the diagram.

---

## 5. Components

### 5.1 Buttons

| Variant | Class | Default | Hover | Focus | Disabled |
| --- | --- | --- | --- | --- | --- |
| Icon | `.designer-iconbtn` | 32×32, `--bg`, 1px border, radius 6, `--fg` | `--accent-soft` + `--accent` border/text | 2px `--accent` ring, 1px offset | opacity .45, no hover |
| Secondary | `.designer-btn` | `--bg-elev`, 1px border, pad 6/12, radius 6, .9rem | `--accent-soft`, accent border | 2px accent ring | opacity .5, not-allowed |
| Commit (add/submit) | `.designer-btn--commit` | `--accent-soft` fill, accent border and text, 600 | `--accent` fill, `--accent-fg` text | ring | opacity .5 |
| Primary (Apply) | `.designer-btn--primary` / existing `.settings-action--primary` | `--accent` fill, `--accent-fg`, 600 | brightness(1.06) | ring | opacity .5 |
| Danger | `.designer-btn--danger` | transparent, `--danger` text | `--danger-soft`, danger border | ring | opacity .5 |
| Ghost | `.designer-btn--ghost` | transparent, `--fg-muted` | `--accent-soft`, accent text | ring | opacity .5 |

Only **Apply** uses the solid accent fill. Add buttons use the quieter commit
variant so the whole-modal commit remains the strongest action. Every icon
button carries `title` and `aria-label`. Tools carry `aria-pressed`.

### 5.2 Fields

- `.designer-field`: 100% width, 32px high, `--code-bg`, 1px `--border`,
  radius 6, padding 6/8, font .86rem, `--fg`.
- Focus: `border-color: --accent; box-shadow: 0 0 0 3px --accent-soft;`.
- Invalid: `border-color: --danger;` + `aria-invalid="true"` + inline `.designer-field-error`
  in `--danger` at .74rem, linked by `aria-describedby`.
- Selects use the same chrome and native keyboard behavior. Do not replace them
  with custom listboxes.
- Labels sit above the field at .78rem `--fg-muted`; they are real `<label for>`
  elements, not placeholders.
- Message text and note text are single-line `<input>`s: Mermaid syntax is
  line-based, and a newline would break the fence. Note text may be a 2-row
  `<textarea>` only if the implementation strips newlines on commit; prefer an
  input.
- Placeholders are examples, never the only label. Do not seed a value the user
  did not type.

### 5.3 Add mode tabs

A two- or three-way tab strip at the top of the Add section.

- Markup: `role="tablist"` + `role="tab"` (`aria-selected`) + one
  `role="tabpanel"` per form.
- Visual: `--bg` track, 1px border, 2px padding, radius 6; active tab
  `--accent-soft` fill, `--accent` text, 600. Inactive `--fg-muted`.
- Focus: 2px accent ring on the tab, inset by 1px.
- Keyboard: Left/Right/Home/End move between tabs; Enter/Space activates.
- The active tab is remembered per type while the modal is open. Defaults:
  flowchart **Node**, sequence **Participant**, pie only Slice (no tabs).
- Switching tabs does not discard a partially filled form unless the user
  switches away; keep drafts in memory while the modal is open.

### 5.4 Shape grid

The same component is used in the add form and the node inspector.

- 14 buttons, each a 16×16 inline SVG glyph above a short caption. Glyphs and
  captions are the existing `FLOWCHART_SHAPES` / `SHAPE_GLYPHS` data.
- Sidebar: 2 columns. Inspector: 3 columns. Gap 5–6px. Button min-height 36px
  (sidebar) / 38px (inspector). Radius 6. `--bg`, 1px border.
- Hover: `--accent-soft`, accent border and text.
- Selected (`aria-pressed="true"`): accent border, `--accent-soft` fill, accent
  text, **2px inset accent rail on the left**, bold caption. The rail and bold
  caption are the non-color cue.
- Captions: `Rect, Round, Stadium, Subrtn, Cylinder, Circle, Double, Decision,
  Hexagon, Lean R, Lean L, Trap T, Trap B, Odd`. The full name and the Mermaid
  syntax live in `title` and `aria-label`, as today.
- In the add form the selected shape is the shape of the next node; in the
  inspector it applies immediately to the selected node.
- Normal Tab order; every shape is a button. No roving tabindex is required.

### 5.5 Direction chips and autonumber switch

**Direction (flowchart)** — a native radio group of five chips:
`TD`, `TB`, `BT`, `LR`, `RL`, in that order. Each chip has a full-name
`aria-label` (“Top-down (TD)”, “Top-bottom (TB)”, “Bottom-top (BT)”,
“Left-right (LR)”, “Right-left (RL)”). The model supports all five; preserve
the source’s exact token.

- Chip: 26–28px high, 1px border, pill radius, .72rem, `--fg-muted`.
- Checked: `--accent-soft`, accent border/text, 600.
- Native radio stays focusable; `:focus-visible` puts a 2px accent ring on the
  chip. Arrow keys move within the group.

**Autonumber (sequence)** — a native checkbox styled as a 34×18 switch with a
14px knob. Label “Autonumber messages” on the left; a word state (`On` / `Off`)
beside it so color is not the only cue. Focus ring on the switch. The checked
state is `--accent`; the knob is `--fg` in dark and `--accent-fg` in light.

### 5.6 Inspector

The inspector is always present in the ready state for the three scoped
families. It has three modes: **rest**, **selected**, **add-sheet** (the last
only in compact mode; it shares the same body).

**Header** (48px, fixed):

- Type glyph in a 26px square (inline SVG: node/edge/message/participant/slice).
- `h4`: `Node`, `Edge`, `Participant`, `Message`, `Note`, `Slice`.
- Mono id/meta at .72rem `--fg-muted`: node id `A`; edge `A → B`; message
  `3 of 5`; participant id `U`.
- A ghost `×` button at the right: `aria-label="Clear selection"`. It clears
  the selection, returns the inspector to rest, and leaves the canvas focused.
- The header is a live region (`aria-live="polite"`): “Selected node A,
  Open a .md file.”

**Body** (scrolls, padding 12px, gap 12px):

- Groups separated by a 1px top hairline and a 10px top padding.
- Group title: .7rem, 600, uppercase, .6px tracking, `--fg-muted`.
- Fields use §5.2. Actions use §5.1.
- Delete actions are full-width danger-ghost buttons with an explicit label
  (“Delete node”, “Delete edge”, “Delete message”, “Delete slice”) and a quiet
  consequence line under them. No native `confirm`; undo is the safety net.
- The inspector writes to the model on `input` (debounced 150ms for text) and
  on `change` for selects. It must not rewrite the focused field from the model
  echo (cursor jump).

**Rest state**:

- Centered, 24px top padding: a quiet glyph, “Nothing selected” in .9rem/600,
  and the type-specific copy in §6.
- It names the selected element’s available edits so the user knows what
  selecting will expose.

### 5.7 Selection chrome

- The library already adds `.mw-selected` (an accent glow) to the selected SVG
  entity. Keep it.
- Add a **type badge** near the entity: a small pill (`.designer-sel-badge`)
  with the words `Node`, `Edge`, `Participant`, `Message`, `Note`, `Slice`.
  Position it above the entity’s bounding box (edge: midpoint; slice: outer
  midpoint), clamped inside the stage. It is `aria-hidden` decoration; the live
  region carries the announcement.
- The inspector header repeats the type and label. This is the required
  non-color cue.
- Do not add a second full-canvas highlight or a colored overlay.
- The vendor popover (`.mw-popover`) is hidden inside `#designer-canvas`; the
  inspector replaces it. Double-click / Enter inline label editing remains an
  accelerator, never the only path.

### 5.8 Status, hint, and banners

- **Footer status** (`#designer-status`, `role="status" aria-live="polite"`):
  `Ready`, `Unsaved changes`, `Applying…`, `No changes to apply`,
  `Couldn’t apply — invalid diagram`. Use `--fg-muted` normally,
  `--designer-ok` for “Ready”, `--designer-warn`/`--danger` for failures.
  Never rely on color alone; the word carries the state.
- **Canvas hint** (`#designer-hint`): a small pill at the bottom center, shown
  only when **nothing is selected** and the canvas is ready. Copy is
  type-specific (§6). It is removed when an element is selected.
- **Apply error banner** (`#designer-alert`): a non-blocking banner at the top
  of the stage, `role="alert"`, `--danger-soft` fill, `--danger` border/text,
  .8rem, 8/10 padding, radius 6, with a dismiss `×`. The canvas remains usable
  and the modal stays open. This is used for **Apply validation failure** and
  for a live-preview render failure after an edit.
- Open-time render/load failures keep the existing full-canvas error state
  (§5.9), not the banner.

### 5.9 States

| State | What the user sees | Apply / Cancel |
| --- | --- | --- |
| Loading | Existing spinner + “Loading editor…” over the canvas. Sidebar and inspector hidden. | Apply disabled; Cancel active. |
| Ready, no selection | Build sidebar populated; inspector rest state; type-specific hint pill. | Apply enabled only when the source differs from the baseline. |
| Selected | Inspector selected mode; badge; hint hidden; status “Unsaved changes” after the first edit. | Apply enabled; Cancel/Esc ask to discard when dirty. |
| Empty diagram | Existing empty overlay with type-specific copy (“Add your first node / participant / slice.”). The add form is visible. | Apply enabled only if the seeded source differs. |
| Open error / parse error | Existing full-canvas error state with Retry + **Edit source instead**. No sidebar, no inspector. | Apply disabled. |
| Read-only type | Existing “Preview only” state, plus **Edit source instead**; no sidebar/inspector. | Apply disabled. |
| Unsaved changes | Footer “Unsaved changes”; dirty guard on Cancel/Esc/backdrop. | Apply writes one fence; Cancel confirms discard. |
| Applying | “Applying…”; Apply and Cancel disabled; canvas remains visible. | — |
| Apply validation failure | Banner + `role=alert` + footer error; modal stays open; canvas and inspector usable. | Apply re-enabled after the user fixes or dismisses; Cancel still works. |
| Live preview render failure | Same banner copy (“Preview can’t render this change”); last good canvas stays if the library keeps it. | Apply still validates and gates. |

Do not replace the whole canvas with an error screen for an **edit** failure;
only the **open** failure uses the full-canvas state.

---

## 6. Per-type content

### 6.1 Shared

- Header: `Design diagram` + friendly type badge (`Flowchart`, `Sequence`,
  `Pie`) + close.
- Footer: status, Cancel, Apply.
- Build sidebar section order: **Tools** (flowchart only) → **Add** (tabs +
  form) → **Chart** (direction / autonumber) → **History** (sticky).
- Inspector: rest or selected, per §5.6.
- Add success selects the created entity and renders its inspector. The form
  clears its text fields but keeps the chosen type/shape/arrow defaults for the
  next add.
- Add forms are ordinary `<form>`s: Enter submits, and the submit button is the
  named control.

### 6.2 Flowchart

**Build sidebar**

| Section | Content |
| --- | --- |
| Tools | Select / Connect icon buttons. `aria-pressed` reflects `view.setTool` / `toolChange`. Connect is the canvas accelerator; the named add path is the Edge tab. |
| Add — Node tab | 14-shape grid (default Rect), **Label** text field, **Add node** commit button. Add is disabled while the label is empty. Shape and label are both chosen by the user; no placeholder node is inserted. |
| Add — Edge tab | **From** select (node id + label), **To** select, **Label** text field (optional), **Line** select (Solid, Dotted, Thick), **Arrow** select (No arrow, Arrow, Double, Cross, Double cross, Dot, Double dot), **Add edge** commit button. Disable while From/To are empty or the diagram has fewer than two nodes; explain why. |
| Chart | Direction radio chips TD/TB/BT/LR/RL. |
| History | Undo / Redo icon buttons; disabled from `canUndo` / `canRedo`. |

**Inspector — node selected**

| Group | Control | Behavior |
| --- | --- | --- |
| Header | `Node` + id `A` + clear | id is read-only; the label is separate. |
| Label | Text field | `renameNode {id, label}`; id never changes. |
| Shape | 14-shape grid | `setNodeShape {id, shape}`; all 14, not the 8 the popover showed. |
| Actions | **Connect from this node** | Opens Add → Edge with **From** prefilled. |
| Actions | **Delete node** + “Its edges are removed too. Undo restores.” | `deleteNode {id}`; clear selection. |

**Inspector — edge selected**

| Group | Control | Behavior |
| --- | --- | --- |
| Header | `Edge` + `A → B` + clear | Uses the endpoint labels; the raw entity id is not shown. |
| Label | Text field | `setEdgeLabel {edgeId, label}`; empty removes the label. |
| Line | Select: Solid, Dotted, Thick | `setEdgeStyle {edgeId, line}`. |
| Arrows | Select: No arrow, Arrow, Double, Cross, Double cross, Dot, Double dot | `setEdgeStyle {edgeId, arrowStart, arrowEnd}`. |
| Actions | **Reverse direction** | `reverseEdge {edgeId}`; source and target swap. |
| Actions | **Delete edge** | `deleteEdge {edgeId}`; clear selection. |

**Mapping to product §4.1**

| Required edit | Named control |
| --- | --- |
| Select a node | Canvas click / arrow traversal → inspector |
| Rename node | Inspector → Label |
| Change shape (14) | Inspector → Shape grid |
| Add node | Build → Add → Node form |
| Delete node | Inspector → Delete node |
| Add edge | Build → Add → Edge form (or Connect as accelerator) |
| Delete edge | Inspector → Delete edge |
| Relabel edge | Inspector → Label |
| Reverse edge | Inspector → Reverse direction |
| Edge line style | Inspector → Line |
| Arrowheads | Inspector → Arrows |
| Direction | Build → Chart → Direction |
| Undo/redo | Build → History + Ctrl/Cmd+Z |

### 6.3 Sequence

**Build sidebar**

| Section | Content |
| --- | --- |
| Add — Participant tab | **Name** text field, **Type** select (participant, actor, boundary, control, entity, database, collections, queue), **Add participant** commit button. Name is required. |
| Add — Message tab | **From** select, **To** select, **Text** field, **Arrow** select (8 message ops), **Position** select: `End of diagram`, `Start (before first event)`, `After: <event>` for each current message/note, **Add message** commit button. Disable until participant/text are present. |
| Add — Note tab | **Participant** select, **Placement** select (Over / Left of / Right of), **Text** field, **Position** select (same options), **Add note** commit button. |
| Chart | Autonumber switch + On/Off word. |
| History | Undo / Redo. |

The exact position model is a dependency; see §11. The select maps to the
library’s `afterEvent` argument: End = omit, Start = `null`, After X = the
event entity id.

**Inspector — participant selected**

| Group | Control | Behavior |
| --- | --- | --- |
| Header | `Participant` + id `U` | |
| Display name | Text field | `seq.renameParticipant {id, name}`; id stays stable. |
| Type | Select (8 types) | `seq.setParticipantType {id, ptype}`. |
| Actions | **Message from this participant** | Opens Add → Message with From prefilled. |
| Actions | **Delete participant** + “Its messages are removed. No other message is lost. Undo restores.” | `seq.deleteParticipant {id}`; clear selection. |

**Inspector — message selected**

| Group | Control | Behavior |
| --- | --- | --- |
| Header | `Message` + `3 of 5` | Count is the event position among messages/notes. |
| Text | Text field | `seq.setEventText {eventId, text}`; single line. |
| Arrow | Select (8 ops) | `seq.setMessageOp {eventId, op}`. |
| Order | **Move up** / **Move down** | `seq.moveEvent {eventId, afterEvent}`; disabled at the boundaries. Names the reorder path so drag is not required. |
| Actions | **Reverse direction** | `seq.reverseMessage {eventId}`. |
| Actions | **Delete message** | `seq.deleteEvent {eventId}`; clear selection. |

**Inspector — note selected**

| Group | Control | Behavior |
| --- | --- | --- |
| Header | `Note` + placement/participant meta | Placement is read-only in v1. |
| Text | Text field | `seq.setEventText {eventId, text}`. |
| Actions | **Delete note** | `seq.deleteEvent {eventId}`. |

**Mapping to product §4.2**

| Required edit | Named control |
| --- | --- |
| Select participant | Canvas click / arrow traversal → inspector |
| Rename alias | Inspector → Display name |
| Change type | Inspector → Type |
| Add participant | Build → Add → Participant form |
| Delete participant | Inspector → Delete participant |
| Edit message text | Inspector → Text |
| Add message | Build → Add → Message form |
| Delete message | Inspector → Delete message |
| Reorder messages | Inspector → Move up / Move down (drag stays an accelerator) |
| Arrow type | Inspector → Arrow |
| Reverse message | Inspector → Reverse direction |
| Add note | Build → Add → Note form |
| Edit note text | Inspector → Text |
| Delete note | Inspector → Delete note |
| Autonumber | Build → Chart → Autonumber |
| Undo/redo | Build → History + Ctrl/Cmd+Z |

### 6.4 Pie

**Build sidebar**

| Section | Content |
| --- | --- |
| Add | **Label** text field, **Value** number field (`min=0`, `step=any`), **Add slice** commit button. Both fields are required. The value must be finite and ≥ 0; the button is disabled and the error is shown until it is. |
| Title note | A quiet `.designer-scope-note`: “Title is kept from the source. Editing it visually is deferred.” No control. |
| History | Undo / Redo. |

**Inspector — slice selected**

| Group | Control | Behavior |
| --- | --- | --- |
| Header | `Slice` + label | |
| Label | Text field | `pie.setLabel {sliceId, label}`. |
| Value | Number field | `pie.setValue {sliceId, value}`; reject non-finite or negative before dispatch. Inline error + `aria-invalid`; revert to the model value on blur if still invalid. |
| Actions | **Delete slice** | `pie.deleteSlice {sliceId}`; clear selection. |

**Mapping to product §4.3**

| Required edit | Named control |
| --- | --- |
| Select slice | Canvas click / arrow traversal → inspector |
| Edit label | Inspector → Label |
| Edit value | Inspector → Value |
| Add slice | Build → Add form (label + value) |
| Delete slice | Inspector → Delete slice |
| Undo/redo | Build → History + Ctrl/Cmd+Z |

Pie title: **deferred; no control.** See §11.

### 6.5 Other editable families

Keep the current add-only sidebar (one `editor.dispatch` button), Tools
(Select; Connect only when connectable), and History. Do not show the
inspector. Replace the flowchart-specific hint with the generic copy:

> Add from the palette · select an item to edit it on the canvas.

This is a copy fix, not a behavior change.

---

## 7. Interaction flows

### 7.1 Open

1. Hybrid → right-click the block / Shift+F10 → **Design diagram…**.
2. Capture the target; lazy-load the bundle; mount the editor. No note write.
3. On success: friendly type badge, build sidebar for the family, inspector
   rest, type-specific hint, focus the canvas.
4. On load/parse/render failure: the existing full-canvas error state with
   Retry + **Edit source instead**. On a render-only type: the preview-only
   state with **Edit source instead**. No sidebar, no Apply.
5. If the modal is already open, focus the existing modal.

### 7.2 Select → edit → live preview

1. Click an entity, or focus the canvas and traverse with arrows.
2. The library fires `selectionChange`; the inspector renders the selected
   type and the badge appears. The hint hides.
3. Edit a field or select. Validate locally, then dispatch the operation.
4. The library re-renders the canvas. The note is untouched.
5. Status: `Ready` → `Unsaved changes` on the first successful edit.
6. Undo/redo is one internal step per edit. Ctrl/Cmd+Z never reaches the note.
7. Selection survives the re-render when the entity still exists; otherwise
   the inspector returns to rest.

### 7.3 Add flow

1. Choose the Add tab and fill the form.
2. The commit button is disabled while required fields are empty or invalid.
3. On submit: dispatch the add op, read `created[0]`, select that entity, and
   render its inspector.
4. Clear text fields; keep shape/type/arrow defaults. Focus the first field
   again for a fast second add.
5. Empty diagram: the form is still available; the Edge form explains that two
   nodes are required.

### 7.4 Delete

1. Select the element; click the explicit Delete button in the inspector.
2. Dispatch the delete; clear selection; inspector returns to rest.
3. No `confirm`; undo restores. The consequence line says what else is removed
   (edges, messages).

### 7.5 Apply

1. No-op: status `No changes to apply`, close, write nothing.
2. Otherwise: `Applying…`; Apply and Cancel disabled; validate the source.
3. On validation failure: banner + footer error; stay open; no write.
4. Guard hybrid mode and re-resolve the target; on failure close with a notice
   (existing behavior).
5. Replace the fence, await the re-render, mark the note dirty as one undo
   step, close, restore focus.

### 7.6 Cancel / Esc / backdrop

- Not dirty: close, write nothing, restore focus.
- Dirty: native `confirm("Discard unsaved diagram changes? The note will stay
  unchanged.")`; on cancel, stay open. This matches the app’s existing discard
  prompts.
- Cancel, Esc, backdrop, and the header × share the same guard.

### 7.7 Invalid states

- **Open** error: full-canvas state; Retry / Edit source.
- **Apply** error: non-blocking banner; canvas/inspector stay usable.
- **Live edit render** error: same banner; Apply still validates.
- **Value** error: inline field error, `aria-invalid`, no dispatch.
- **Empty** diagram: type-specific empty copy; no error.

---

## 8. Keyboard map

| Context | Keys | Action |
| --- | --- | --- |
| Modal | Tab / Shift+Tab | Move through the focus trap (header, build, canvas, inspector, footer). |
| Modal | Esc | Close; dirty → discard confirm. |
| Modal | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Diagram undo/redo; never the note. Applies while a designer field is focused; the field resyncs from the model. |
| Canvas (focused) | Arrow Down/Right | Select the next entity in document order. |
| Canvas (focused) | Arrow Up/Left | Select the previous entity. |
| Canvas (focused) | Home / End | Select the first / last entity. |
| Canvas (focused) | Enter | Move focus to the inspector’s first field. |
| Canvas (focused) | Esc | Close the modal (same guard). |
| Add tabs | Left/Right/Home/End | Move between tabs. |
| Add tabs | Enter/Space | Activate the tab. |
| Add form | Enter | Submit the add. |
| Selects | Native arrow keys / Esc | Normal select behavior; Esc inside an open native popup does not close the modal. |
| Inspector | Tab / Shift+Tab | Traverse groups and actions. |
| Anywhere | Delete / Backspace | **Not bound.** Deletion is only the named inspector button. |

The canvas keeps `tabindex="0"` and `role="application"`. Its `aria-label`
explains arrow traversal; a visually hidden `aria-describedby` carries the same
help for screen readers.

---

## 9. Accessibility

- **Contrast.** The scoped `--fg-muted` passes 4.5:1 on `--bg-elev` and
  `--bg-panel` in both themes (dark #9799a4 = 4.96/5.52:1; light #5d6470 =
  5.13/5.56:1). `--danger` passes on `--bg-elev` in both themes. Light-theme
  `--designer-ok` / `--designer-warn` replace the app-level `--ok` / `--warn`,
  which do not pass as text.
- **Not color-only.** Selected shape: accent rail + bold caption. Selected
  entity: type badge + inspector header. Status: words (`Ready`, `Unsaved
  changes`, `Applying…`, `Off`/`On`). Errors: text. The badge and status dot
  (if used) are `aria-hidden` decoration.
- **Semantics.** Tools: `aria-pressed`. Add tabs: `tablist`/`tab`/
  `aria-selected`/`tabpanel`. Fields: `<label for>`. Switch: native checkbox.
  Direction: native radios. Buttons: `aria-label` and `title`.
- **Live regions.** `#designer-status` is a polite status. The inspector header
  announces the new selection. Errors use `role="alert"` (banner) or
  `aria-live="polite"` + `aria-invalid` (fields).
- **Focus.** Every interactive control has a 2px accent `:focus-visible` ring.
  The canvas has an inset ring. Focus is trapped in the modal and returns to the
  invoking block on close.
- **Hidden content.** The inspector is `hidden`/`inert` when the sidebar is
  hidden (loading/error/readonly) so it cannot receive focus. The vendor popover
  is visually hidden; it is not in the tab order.
- **Reduced motion.** The sheet transition and spinner respect
  `prefers-reduced-motion`.
- **Zoom / font scale.** Text is rem, spacing is px; panels scroll instead of
  overflowing. At XL, captions wrap only in the shape grid; labels truncate with
  a `title`.

---

## 10. Implementation notes for `web-engineer`

This is design-only; the following is the handoff shape, not a code change made
here.

### Markup (`templates/index.html`)

- Keep `#designer-overlay`, the modal shell, header, footer, `#designer-canvas`,
  and the existing loading/error/readonly/empty nodes.
- Add the right inspector aside (`#designer-inspector`) with a fixed header,
  scrolling body, and a rest state.
- Convert `#designer-palette` into a tabbed add host (`#designer-add-tabs`,
  `#designer-add-panel`). The flow chart shape grid becomes the Node form's
  shape picker.
- Add `#designer-chart` for direction/autonumber; add `#designer-alert`;
  add `#designer-readonly-source` (“Edit source instead”).
- Update `#designer-hint` copy per type; it remains the modal’s
  `aria-describedby` only in the ready state.

### CSS (`static/css/style.css`)

- Add the scoped token block (§4) and the component rules, prefixed
  `#designer-overlay` or `.designer-*` as the existing block does.
- Add the container query (§3.3) and the compact strip + sheet rules.
- Keep the shared `.settings-*` rules intact; do not restyle the Export/Auth/
  Settings modals.
- Hide the vendor popover only inside the designer canvas:
  `#designer-canvas .mw-popover { display: none !important; }`.
- Keep the existing Visimer token bridge (`--mw-*`) unchanged.

### JS (`static/js/mermaid-designer.js`)

- Subscribe to `editor.on("selectionChange")`; render the inspector and badge.
  Re-render fields from `editor.result` on `change`, but never overwrite the
  focused field (debounced text commits).
- Build the sidebar per family:
  - `flowchart` → Tools, Node/Edge, Direction, History.
  - `sequence` → Participant/Message/Note, Autonumber, History.
  - `pie` → Slice, title note, History.
  - other families → current add-only path, no inspector.
- Dispatch operations (public API only):

| Type | Operation |
| --- | --- |
| Flowchart | `renameNode {id,label}`, `setNodeShape {id,shape}`, `deleteNode {id}`, `connect {source,target,label,line,arrowEnd}`, `setEdgeLabel {edgeId,label}`, `setEdgeStyle {edgeId,line,arrowStart,arrowEnd}`, `reverseEdge {edgeId}`, `deleteEdge {edgeId}`, `addNode {shape,label}`, `setDirection {direction}` |
| Sequence | `seq.addParticipant {name,ptype}`, `seq.renameParticipant {id,name}`, `seq.setParticipantType {id,ptype}`, `seq.deleteParticipant {id}`, `seq.addMessage {source,target,text,op,afterEvent}`, `seq.addNote {participant,placement,text,afterEvent}`, `seq.setEventText {eventId,text}`, `seq.setMessageOp {eventId,op}`, `seq.reverseMessage {eventId}`, `seq.moveEvent {eventId,afterEvent}`, `seq.deleteEvent {eventId}`, `seq.toggleAutonumber {}` |
| Pie | `pie.addSlice {label,value}`, `pie.setLabel {sliceId,label}`, `pie.setValue {sliceId,value}`, `pie.deleteSlice {sliceId}` |
| Selection | `editor.setSelection([entityId])`, `editor.clearSelection()`; read `created[0]` after an add |
| History | `editor.undo()`, `editor.redo()` |

- `afterEvent` mapping for sequence: omit for **End**, `null` for **Start**,
  event entity id for **After X**.
- Add `addNode` via `editor.dispatch`, not `view.addNode`, so the form’s label is
  used and no hidden inline editor opens. Select the created node.
- Keep the existing write-back order and the no-op/dirty guards. Add the
  non-blocking apply banner; keep the full-canvas state for open failures.
- Dirty guard on Cancel/Esc/backdrop; disable Cancel while applying.
- Keyboard traversal: arrows/Home/End on the canvas; Enter → first inspector
  field. Do not bind Delete.
- Do not change `mermaid.js`, `blocks.js`, the vendor bundle, or the note
  renderer.

### Tests to extend

- Selecting each of the three types renders the matching inspector.
- Every required edit is reachable through the named controls (no popover).
- Add forms reject empty/invalid fields and insert the entered values.
- Pie negative/non-numeric value never dispatches or reaches the fence.
- Dirty Cancel/Esc/backdrop confirms; clean close does not.
- Apply validation failure stays open, shows the banner, and writes nothing.
- Responsive: at ≤960px container the inspector becomes the sheet and the
  footer remains visible.
- Keyboard: arrow traversal selects entities; Ctrl/Cmd+Z never reaches the note.

---

## 11. Deferred and dependencies

| Item | Decision |
| --- | --- |
| **Pie title** | **Deferred pending owner decision.** The visual model has no title and no `pie.setTitle`. Do not add a control. The sidebar carries a quiet note; the source editor remains the only title path. If the owner approves a targeted title-line edit outside the model, add a “Title” row above the slice form in a later change. |
| **Sequence add-message placement** | The UI uses `End` / `Start` / `After: <event>` because the library accepts only `afterEvent`. Confirm that “after a chosen event” is the intended position model; a numeric index would need a new operation. |
| **Pie slice reorder** | Deferred; order follows the source. |
| **Pie show/hide data values** | Deferred; source editing. |
| **Sequence activation/deactivation** | Deferred; the model parses it but has no edit op. Source editing. |
| **Participant reorder** | Deferred; no model operation. Source editing. |
| **Participant id editing** | Deferred; would break message references. |
| **Fragment wrappers** | Deferred; the canvas’s existing wrap action stays an accelerator, not a required path. |
| **Layout, colors, themes, fonts** | Out of scope; Mermaid owns layout, and the editor does not recolor charts. |
| **Other Mermaid types** | Unchanged add-only behavior; no inspector. |
| **Source mode in the modal** | Out of scope; the existing raw-fence editor is the repair path. |

---

## 12. Acceptance checklist

- [ ] The three families show a type-specific build sidebar and a contextual
      inspector; other families keep the add-only sidebar and no inspector.
- [ ] Every §4 required edit has a named control in the sidebar or inspector.
- [ ] No required edit depends on the vendor popover, double-click, Alt+drag, or
      the lifeline `+`.
- [ ] The vendor popover is suppressed inside the designer; inline label editing
      remains an accelerator.
- [ ] The hint is type-specific and hidden while an element is selected.
- [ ] Add node/edge/participant/message/note/slice forms collect their fields and
      insert no fixed placeholder.
- [ ] The selected element has a visible type badge and the inspector names it.
- [ ] All 14 node shapes are reachable on an existing node.
- [ ] Direction and autonumber are chart-level named controls.
- [ ] Delete, reverse, reorder, and undo/redo are named controls.
- [ ] Pie values are validated before dispatch; negatives never reach the fence.
- [ ] Apply validation failures show the banner and keep the modal usable.
- [ ] Dirty Cancel/Esc/backdrop asks to discard; clean close writes nothing.
- [ ] At ≤960px container the inspector becomes a bottom sheet and Apply/Cancel
      stay reachable.
- [ ] Both themes and all four font scales render without horizontal overflow.
- [ ] Focus rings, labels, `aria-pressed`/`aria-selected`, live regions, and
      keyboard traversal are present.
- [ ] No new fonts, icon libraries, or chart recolor; tokens come from the
      existing set plus §4.

---

## 13. Implementation deviation (v1)

Recorded by `web-engineer` after implementation; this section is the only edit
to this design document.

- **Compact breakpoint is a media query.** The implementation uses the
  permitted `@media (max-width: 960px)` fallback instead of the container query
  in §3.3, because the project has no container-query baseline. The old 720px
  designer rule is scoped to non-scoped families, so only one compact layout
  applies per family.
- **Add forms stay in the build strip when compact.** The build sidebar becomes
  the horizontal strip in both wide and compact modes; the bottom sheet is the
  inspector. Tapping an Add tab does not move the add form into the sheet.
  This keeps the form reachable without a second sheet state and matches the
  task's "simplest acceptable" compact shape.
- **No canvas type badge.** The inspector header carries the type and label.
  The canvas badge is decorative in §5.7 and was optional in the task.
