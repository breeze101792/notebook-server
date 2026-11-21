# List editor — the `Edit list` window

Status: Current spec — pre-implementation (new surface; nothing shipped yet).

Reference mockup: [`list-editor-mockup.html`](list-editor-mockup.html) — dark and light, a
theme toggle over every board: the window open on a 14-item nested task list with **nothing
selected** and 2 done, a collapsed parent, the stale read-only notice, the empty list, the
390 phone, the row anatomy with labelled geometry, a mixed-level selection with a locked
descendant and **To top** and **To bottom** disabled with their reasons, the 720 wrap, a
single-item list, a failed restore, and a 120-row list scrolled mid-way.

Scope: the content of `#list-editor-overlay` — the entry point, the flat document-order
treegrid, row anatomy, selection, the toolbar verbs, the stale and empty states, the
in-window history, Apply / Cancel, keyboard and ARIA, and the phone layout. The shared
window chrome — header, action bar frame, footer frame, drag, resize, maximize, focus
containment, geometry persistence — is **not** redesigned here. It is owned by
[`edit-window.md`](edit-window.md) and its markup is `templates/_edit_window.html`
(`static/css/style.css:9798-10033`). The list's rendered visuals in the note are owned by
[`reader.md`](reader.md) §2.4; this document only reads them.

**Normative source.** This document is the single source of truth for this window's
content. It reads [`foundations.md`](foundations.md) for every token,
[`controls.md`](controls.md) for control anatomy, states and ARIA,
[`typography.md`](typography.md) §2 for the row role, [`guidelines.md`](guidelines.md) §2.1
for the list-row contract, [`edit-window.md`](edit-window.md) for the chrome, and
[`table-editor.md`](table-editor.md) as the sibling body whose structure this document
mirrors. It does **not** own: the chrome's heights, the history engine, the focus trap, the
window geometry, or the note's Markdown write path.

**Prior art.** The interaction choices below are grounded in
[`../research/list-manager-prior-art.md`](../research/list-manager-prior-art.md) (dated
2026-11-21): the WAI-ARIA APG's selection keys and its rearrangeable example, Org's
"sub-lists are not sorted" rule, Logseq's one-level sort, Todoist's per-group completed
area, and the absence of any shipped list multi-select in Obsidian, Notion, Craft or VS
Code. The rules that lean on it name the source inline.

**Prerequisite.** Three things must land or exist before this window can:

1. The shared shell token block must list this overlay. Today it is scoped to the three
   shipped overlays (`static/css/style.css:9805-9824`); `#list-editor-overlay` is added to
   that selector list with every value unchanged (§10.2 step 1). Without it the header,
   bar and footer read undefined sizes.
2. The overlay is authored directly after `#table-editor-overlay`
   (`templates/index.html:1730`), copying its structure: overlay → `.settings-modal` →
   `edit_header` → `edit_bar` (caller) → body → `edit_footer`, with the prefix
   `list-editor`. The macros are `templates/_edit_window.html:13-21`, `:23-49`, `:51-61`.
3. A render notification the window can hear. The hybrid surface emits `hybrid:exited`
   today (`static/js/hybrid.js:8178`), but it does not emit one for a re-render. §5.3 needs
   `hybrid:rerendered`, emitted as the last line of `renderMarkdown`. Its emit is the
   blueprint's edit ([`../architecture/list-editor.md`](../architecture/list-editor.md)); this
   document owns only what the window does when it fires.

Every claim about current code cites `file:line`; line numbers were verified against the
working tree on 2026-11-21.

---

## 1. Entry and open state

### 1.1 One entry: the top-level menu item

| Property | Value | Source |
|---|---|---|
| Surface | Hybrid (WYSIWYG) mode only. Preview mode has no list editor. | the hybrid context menu is wired only while `active` (`static/js/hybrid.js:10518-10519`) |
| Owner | The hybrid context menu built by `buildItems` | `hybrid.js:10216` |
| Label | `Edit list…` — a top-level item, never a submenu, never disabled | new |
| Position | Immediately above `Edit table…`, i.e. after the `List` submenu is pushed and before the table item | `hybrid.js:10269`, `:10271-10278` |
| Target | The `<li>` under the pointer; when the pointer is not in an item (the whitespace between items) the caret's item | `e.target.closest("li")`; `caretListItem()` (`hybrid.js:2708-2732`) |
| Scope | One list container, resolved by `NB.hybrid.listContainer(li)` | `hybrid.js:9472-9488` |
| Refused when | No container, the container is outside `#viewer-content`, the caret is in a protected block, or the role cannot write | `hybrid.js:2713`, `:9482`; `NB.auth.canWrite()` (`static/js/auth.js:226`) |
| Hidden when | No list item resolves, or `NB.auth.canWrite()` is false — the item is added conditionally, like the table item, and the role gate is also `open()`'s (§1.3) | `hybrid.js:10274-10278`; `static/js/auth.js:226` |
| Keyboard | The same menu is reachable with `Shift+F10` / the Menu key; the event reports `0,0` and the menu anchors to the focused block | `hybrid.js:10493-10505` |

The `List` submenu keeps its four list commands and the two shipped move entries
(`Move item up`, `Move item down`, chords `Alt+Up` / `Alt+Down`; `hybrid.js:10254-10268`).
This window does not remove or rename them: the submenu is the caret-level command, the
window is the container-level one.

`listContainer()` is the whole scope rule and is not re-derived: the outermost `<ul>`/`<ol>`
reachable **without crossing a `<blockquote>`, `<td>` or `<th>`** (`hybrid.js:9472-9488`;
the boundary test is `:9482`). So a quoted list is its own container, a list inside a table
cell is its own container, and a list nested under another list's `<li>` shares the outer
container.

### 1.2 What is read

| Model field | Read from | Rule |
|---|---|---|
| Container | `NB.hybrid.listContainer(li)` | one `<ul>` or `<ol>`; an `<ol>` keeps `start`, `reversed`, `type` and every other attribute (§7.1) |
| Rows | every `<li>` inside the container whose own container is this one, document order | `NB.hybrid.listItems(container)` (`hybrid.js:9491-9493`) filtered by `listContainer(li) === container` — the shipped selector is a descendant query, so a list inside a quoted block or a table cell would otherwise leak in |
| Depth | levels below the container | `NB.hybrid.listItemDepth(li, container)` (`hybrid.js:9497-9505`); row `aria-level` = depth + 1 |
| Own text | clone of the `<li>` with nested `ul`/`ol` removed, every `input` removed, every `[contenteditable="false"]` chrome node removed, every `br` replaced by one space, then whitespace runs collapsed, `\u200B` dropped and the result trimmed | §2.4; mirrors the own-content rule in `caretInListItemOwnContent` (`hybrid.js:3500-3514`); the zero-width placeholder a rendered empty item carries is stripped (`hybrid.js:207`, `:3384`) |
| Task state | the item's **own** checkbox, never a nested one, and its live `checked` property | `taskCheckboxOf` (`hybrid.js:3486-3495`); the save path reads the same property (`static/vendor/turndown-plugin-gfm.browser.js:145`) |
| Marker | the rendered ordinal for an `<ol>`; a bullet otherwise | §2.3 |

The window works on the live rows, in its own view: opening reads the container into the
model, and nothing in the note moves until Apply. Apply then mutates the live container in
place — the mechanism is the architecture document's call
([`../architecture/list-editor.md`](../architecture/list-editor.md)); what the user can
observe is §7.1.

There is no content signature. A render replaces the container node, so identity — not a
hash — is what tells this window whether the list it opened is still the list it shows
(§5.3). For the record, the app's serialization-free hash is `canonicalSubtree`
(`hybrid.js:1570`); its documentation comment starts at `:1543`, and its `checked=` append
is duplicated at `:1641` and `:1645`. Nothing here reads it.

### 1.3 Open sequence and first focus

The order is load-bearing and mirrors the sibling window
(`table-editor.js:2013-2052`):

1. Require `NB.auth.canWrite()`; return `false` when it does. A viewer never sees an open
   window, a blocked window, or a disabled window — there is no window at all (§1.1, §5.1).
2. Resolve the container; refuse when it is gone or outside `#viewer-content`.
3. Read the container into the model and build the flat row list (§2).
4. Set the title `Edit list` and the badge (§1.4).
5. Reset the shared history and seed it with the opening snapshot, **after** the model is
   built, so a reopened window cannot inherit the previous list (§6).
6. Unhide `#list-editor-overlay`, render the treegrid, sync the toolbar and write the
   opening status.
7. `NB.dialog.open(overlayEl, { fallbackFocus: firstCell })` inerts the page and installs
   the focus trap (`static/js/dialog.js:78`; `table-editor.js:2042`).
8. Focus the first row's gridcell; it is the grid's single tab stop.

The first status line is the counts, with no action result and an empty selection:

```
14 items · 0 selected · 2 done
```

That is the whole default state: the first row has focus, no row is selected, and the
anchor is the first row. Board 1 of the mockup draws exactly this.

### 1.4 Title and badge

Title: `Edit list`, an `<h2>` from `edit_header` (`templates/_edit_window.html:16`).

The badge reports the container's type and nothing else:

| Container | Badge |
|---|---|
| `<ol>` | `Numbered list` |
| `<ul>` whose every item owns a task checkbox | `Task list` |
| any other `<ul>` (including a mixed one) | `Bulleted list` |

The count is **not** in the badge. The badge is capped at 120 px and ellipsizes
(`style.css:9852-9859`), and a count is volatile — it changes on every delete and on every
mark. The header reports a stable fact; the footer status carries the count (§4.9). This is
the one place the alternative string (`12 items · bulleted`) is deliberately not used: the
120 px cap and the "badge reports a fact, never a state" rule (`edit-window.md` §2.2).

---

## 2. The treegrid

### 2.1 Element and roles

| Part | Markup | Rule |
|---|---|---|
| Tree | `<div id="list-editor-grid" class="le-tree" role="treegrid" aria-label="List items" aria-multiselectable="true" aria-colcount="1" aria-rowcount="14">` | one column: the grid is a list, not a data table |
| Row | `<div class="le-row" role="row" aria-level="1" aria-rowindex="1" aria-selected="false">` | flat: every row is a sibling in the DOM, document order |
| Cell | `<div class="le-cell" role="gridcell" tabindex="0">` | one gridcell per row, holding the whole row anatomy; the cell is the row's pointer target |
| Parent row | adds `aria-expanded="true"` / `"false"` | only a row that owns a child list |
| Read-only | `aria-readonly="true"` on the tree, every `tabindex` kept | §5.3 |

A flat treegrid is the ARIA-sanctioned shape for a virtualised or reordered tree: `aria-level`
on the row carries the depth and no `group` wrapper is rendered, so a collapse is a row-list
filter and a move is a DOM reorder. `aria-rowcount` and `aria-rowindex` count **rendered**
rows, so they change when a parent collapses or a row is deleted; the counts in the footer
always describe the whole model.

Tab entry: the grid is one tab stop. The focused cell has `tabindex="0"`, every other cell
`tabindex="-1"` (§8.1).

### 2.2 Row anatomy

Left to right, every row:

```
[select 18] [mark 20] [indent: depth × 18 guides + 16 chevron] [text …] [meta]
```

| # | Part | Class | Geometry | Owner |
|---|---|---|---|---|
| 1 | Selection box | `.le-select` | cell 18 × 18; box 14 × 14, `--radius-xs`, 1 px `--border-strong`; `aria-hidden` | this document |
| 2 | Done toggle **or** marker | `.le-done` / `.le-mark` | slot `--le-mark-w` 20 wide, 18 high; the done ring is 16 × 16, `--radius-circle` | this document |
| 3 | Indent guides + disclosure | `.le-indent` > `.le-guide` × depth, `.le-chev` | guide step 18 (`--tree-indent`, `style.css:289`); chevron 16 (`--icon-md`) | this document |
| 4 | Item text | `.le-text` | `--text-body` / `--lh-normal`, weight 400, one line, ellipsis, `title` = full text | [`guidelines.md`](guidelines.md) §2.1 |
| 5 | Trailing meta | `.le-meta` | `--text-sm`, `--text-muted`, `flex: 0 0 auto` | §2.1 |

Row box: padding `3px 6px`, radius `--radius-xs`, transparent at rest. Nothing in the row is
taller than the 21 px line box — the marks are 18 — so the row measures **27 px at the 1.0
root and 30 px at 1.15**, the list-row contract unchanged (`guidelines.md` §2.1). The row is
never given a fixed height; it grows with the line box at XL.

| State | Paint | Source |
|---|---|---|
| Rest | transparent over `--surface-panel` | §2.1 |
| Hover | `--accent-soft` | §2.1 |
| Selected | `--accent-soft` face + the box filled `--accent` (`aria-selected="true"`, class `is-selected`) | §3.1 |
| Focused | inset `--focus-ring` on the cell (`outline-offset: var(--focus-offset-inset)`), so the scroll container cannot clip it | foundations §10.2 rule 4 |
| Locked (a descendant of a selected parent) | the same wash and the same filled box; `aria-selected="true"`, class `is-locked` | §3.2 |

**The whole row is the pointer target.** Clicking the text, the box, the marker, a guide or
the empty space to the right all do the same thing (§3.2); the box and the done circle are
marks inside the row, not separate hit areas. The 18 px cells around them exist only to keep
the marks on one vertical axis and to give the done circle a stable position.

**The done box is a circle, the selection box is a square.** The note's own task checkbox is
a 1em square with a 3 px radius (`style.css:3644-3664`); inside this window two squares in
one row would be indistinguishable, so the done state takes `--radius-circle`. The shapes are
never swapped.

A **non-task row** has no done control at all: its slot carries the bullet or the number
(§2.3). The slot is always occupied, so the text edge never moves between task and non-task
rows (`guidelines.md` §2.1, "insert marks into a slot, never in front of the name").

### 2.3 Indentation, guides, disclosure, markers

**Indent.** `depth × 18 px`, one `.le-guide` cell per level inside one `.le-indent` rail.
Each guide draws one 1 px `--border` vertical line at its own centre, running the full row
height, so consecutive rows form continuous rails under the ancestor's marker.

**Disclosure.** A parent is an item whose child list contains at least one **row**; an item
whose only nested list sits in a quote or a cell is a leaf with a `+N nested` chip. Its
chevron is a real `<button type="button" class="le-chev" aria-expanded="true"
aria-label="Collapse: Freeze the Zephyr board">`, `tabindex="-1"`, pointer and `Enter` on the
row reach it. The name is `Collapse: <item text>` or `Expand: <item text>`, so a screen
reader hears which parent it collapses. A leaf renders a hidden 16 px spacer in the same
cell, so text never shifts.

| Chevron state | Glyph | Rotation |
|---|---|---|
| Expanded | right-pointing chevron | `rotate(90deg)`, `--dur-1 --ease-out` |
| Collapsed | right-pointing chevron | none |
| Reduced motion | — | no transition (`@media (prefers-reduced-motion: reduce)`) |

**Collapse is a view filter only.** It never touches the model, never writes, never creates a
history step, and is not persisted across opens. A collapsed parent hides its descendant
rows (they are not rendered), keeps `aria-expanded="false"`, and shows trailing meta
`4 hidden`. Collapsing a parent whose descendant has focus moves focus to the parent. Counts
in the footer ignore the filter (the model is unchanged); selection counts still include the
hidden rows (§3.1).

**Markers.**

| Container | Marker | Rule |
|---|---|---|
| `<ul>`, non-task row | `•` | `--text-sm`, `--text-muted`, `aria-hidden` |
| `<ol>`, non-task row | the rendered ordinal: `3.`, `c.`, `iii.` | computed from `start` (default 1) and `reversed` (default start = the sibling count), stepping ±1; `type` maps `1 a A i I` to decimal, lower/upper alpha, lower/upper roman |
| task row | — | the done circle occupies the slot instead |

The marker mirrors the wrapper's **attributes**, not the computed CSS `list-style-type`: the
reader sets only padding on lists (`style.css:3605`), so the two agree today, and Apply
preserves `start` while `reversed` and `type` stay in the DOM (§7.1).

The slot's width is `--le-mark-w` (20 px) by default. Once per render the window measures the
widest **visible** marker in one pass and sets one tree-level `--le-mark-w` of
`max(20px, widest + 4px)`, capped at three glyphs of the marker's own type (`calc(3ch + 2px)`
at `--text-sm`, tabular numerals). A marker longer than the cap is ellipsized by
`:text-overflow`, so no list can push the text edge further right than three glyphs and every
row still shares one edge. Measuring visible rows only is what keeps a collapsed list cheap;
the cap is what keeps a roman-numeral list at depth 6 from eating the row.

### 2.4 Text, and why formatting is not rendered

The row shows the item's own plain text: one line, ellipsis, `title` = the full text
(`guidelines.md` §2.1). Inline markup (`strong`, `em`, `code`, `a`, images) is **not**
rendered. The reason is stated once so nobody "fixes" it: this is a structure surface. Its
job is order, level and state; the note's own rendering is where formatting lives, in the
page behind this dialog. Rendering bold and code here would promise a text editor this window
is not, and every inline node would cost a row that must also truncate, focus and announce.

The label and the sort key come from **one** strip, applied to a clone of the row's `<li>`:

1. Remove every nested `ul` and `ol` — a subtree's text is never this row's text.
2. Remove every `input` — a checkbox is state, not prose.
3. Remove every `[contenteditable="false"]` node — rendered plugin cards (Mermaid, Graphviz,
   WaveDrom, KaTeX) and any wrapper a browser leaves around a pasted checkbox. Such a node
   carries chrome, not the author's words; every atomic block is marked that way
   (`hybrid.js:2086-2094`).
4. Replace each `br` with one space, collapse every whitespace run, drop `\u200B`, trim.

This is the `list-edit.js:339-346` `itemSummary` rule plus the two exclusions
`li.textContent` cannot make. The test that pins it: an item holding a Mermaid card labels as
its own prose (`Deploy the diagram renderer`), never the diagram's source text.

| Case | Row shows |
|---|---|
| Text present | the stripped text |
| No text after the strip (image-only, checkbox-only, empty) | `Empty item`, `--text-muted`, `title="Empty item"` |
| Long text | one line, ellipsis, `title` = the full text |

**Trailing meta** is plain text, never a pill and never a control:

| Fact | String | When |
|---|---|---|
| Nested content that is not a row | `+2 nested` | the item has `<li>` descendants whose container is not this container (a list inside a `<blockquote>` or a table cell); they travel with the item and are not rows (§1.1) |
| Hidden rows | `4 hidden` | the item is collapsed |

Both are trailing meta at `--text-sm` / `--text-muted`, per `guidelines.md` §2.1. The task
brief named them chips; a pill would read as a control in a row whose controls are all boxes
and would add a second shape beside the row's own marks, so the guideline wins. P2 records
the pill as a proposal.

### 2.5 Scrolling and row budget

`.le-scroll` is the only scroller: `overflow: auto`, `overscroll-behavior: contain`,
`--surface-panel`, padding `var(--space-2) var(--space-4) var(--space-3)`. The toolbar is in
the shared bar above it and never scrolls with it.

Nothing is virtualised. **100 rows is the comfortable budget**: 100 rows render and the body
scrolls. **1000 is not supported** — every verb, repaint and snapshot is O(n) over the model,
and the marker measurement is one pass over the visible rows. There is **no hard cap**: a
longer list still opens, it is simply outside what this window promises. A note with
thousands of items in one list is not a v1 target (P4).

### 2.6 The empty body

When the model reaches zero rows (every row deleted), the tree is hidden (`hidden` on
`#list-editor-grid`) and one line takes its place, centred in the region with `--space-6`
block padding ([`controls.md`](controls.md) §2.15):

```
No items left. Apply removes the list.
```

`--text-ui`, `--text-muted`, no illustration, no button. Apply stays enabled (§7.1) and takes
focus when the last row is deleted, because there is no cell left to hold the tab stop; the
counts still report `0 items`.

---

## 3. Selection

### 3.1 The model

The selection is an explicit **set of row ids** plus **one anchor id**. It is not a pair of
corners and not a rectangle: the set can hold rows in different parents, rows in different
levels, and rows hidden inside a collapsed parent.

| Rule | Detail |
|---|---|
| Unit | one row, identified by its row id, not by an index |
| The set | `selected`: the rows the user picked. Invariant **S1**: the set never holds a row whose ancestor is also in the set — picking a parent drops its descendants from the set, because the parent already implies them |
| The anchor | `anchorId`: the fixed end of a range. A plain click and `Space` set it to the row they act on; a fresh open sets it to the first row; `Ctrl/Cmd+A` leaves it where it is; `Ctrl/Cmd+Shift+A` sets it to the focused row |
| Locked descendants | every descendant of a selected row is selected and **locked**: it carries `aria-selected="true"` and `.is-locked`, paints like a selected row, and its own toggle is inert (§3.2) |
| Roots | a selected row whose parent is not selected. With S1 in force, the roots are exactly the set. Every structural verb acts on roots |
| Counts | `5 selected` counts roots **and** locked descendants — every row that reads as selected, including rows hidden inside a collapsed parent |
| Empty set | the focused row is the target: a verb with nothing selected acts on the focused row alone, and the counts still read `0 selected` |
| Persistence | the selection is cleared on close, never written to the note, and rides in the history snapshot (§6) |

No UI copy in this window says "checked". A selection box is **selected**; a task box is
**done**. The words appear in the status line, the toolbar names and the row labels, and the
serializer's `checked` property is a code detail that never surfaces.

### 3.2 Pointer

| Gesture | Result |
|---|---|
| Click a row — text, box, marker, guide or empty space | select that row **alone**; the anchor becomes it; focus moves to it |
| `Ctrl`/`Cmd` + click a row | toggle that row and its subtree: add it (its descendants become locked) or remove it |
| `Ctrl`/`Cmd` + click a **locked** row | nothing: an ancestor is selected, so the row cannot be toggled individually. A plain click still replaces the selection with that row — the lock forbids toggling, not re-selecting |
| `Shift` + click a row | extend: replace the set with every **visible** row from the anchor to this row; rows hidden inside a collapsed parent come in with their ancestor; the anchor does not move |
| Click the chevron | expand / collapse — view only (§2.3); the press does not change the selection |
| Click the done circle | toggle that row's done state — one history step (§4.8); the press does not change the selection |
| Double-click the text | nothing (no rename in v1, P3) |

The chevron's and the done circle's click handlers stop propagation so one press is one
action. A plain click on a row is also what removes a lock: it replaces the set, so the newly
picked row is a root and its own subtree is what becomes locked.

### 3.3 Keyboard

| Key | Action |
|---|---|
| `Space` | toggle the focused row and its subtree; the anchor becomes it |
| `Shift+Space` | toggle the focused row's done state (§4.8) |
| `Shift+↑` / `Shift+↓` | extend the selection over visible rows from the anchor — the keyboard twin of `Shift`+click |
| `Ctrl`/`Cmd` + `A` | select **every row in the model**, including rows hidden inside collapsed parents; the set becomes the top-level roots (S1), and the counts report every row |
| `Ctrl`/`Cmd` + `Shift` + `A` | clear the selection; the anchor becomes the focused row |

Announcement is the counts line only — one message per action, never one per row.

### 3.4 Announcement

The footer's single `role="status"` region (`_edit_window.html:53-54`) is the only live region
in this window. A selection change rewrites the counts and adds no result phrase. A verb
writes the counts plus its result (§4.9).

### 3.5 Worked example — a locked descendant

Five rows: `1 Cut the tag`, `2 Update the CHANGELOG` (done), `3 Freeze the Zephyr board`
(a parent), `4 Run the HIL suite`, `5 Capture the serial logs` (both children of 3). The
counts start at `5 items · 0 selected · 1 done`.

| Step | Action | Set | Visible result |
|---|---|---|---|
| 1 | Click row 1 | `{1}`, anchor 1 | `5 items · 1 selected · 1 done`; row 1 washed and boxed |
| 2 | `Shift`+click row 4 | `{1,2,3}`, anchor 1 | `5 selected`: rows 1, 2 and 3 are roots, rows 4 and 5 are locked descendants of 3 and paint selected. Row 4 is in the range but is not added to the set — S1 keeps 3 as its root |
| 3 | `Ctrl`/`Cmd`+click row 5 | `{1,2,3}` | **nothing changes** — an ancestor (3) is selected, so row 5 is locked. The counts stay `5 selected` |
| 4 | `Ctrl`/`Cmd`+click row 2 | `{1,3}` | `4 selected` (1, 3 and the locked 4 and 5). Up now has two root groups and moves each one slot inside its own parent |
| 5 | `Ctrl`/`Cmd`+click row 3 | `{1}` | the counts drop from `4 selected` to `1 selected`: 3 and its locked descendants leave together |
| 6 | `Ctrl`/`Cmd`+`A` | `{1,2,3}` | `5 items · 5 selected · 1 done`: the set becomes rows 1–3 and the counts report all five rows |

Step 3 is the locking rule in one line, and step 6 is why `Select all` reports `5 selected` in a
five-row model: it counts every row, not only the roots, and a row hidden inside a collapsed
parent is counted exactly the same way.

*Source:* the modifier set (`Space` toggles, `Ctrl/Cmd+A` selects all, shift extends) is the
WAI-ARIA APG's multi-select convention, and its rearrangeable example keeps focus on the
moved option and uses `Alt+↑/↓` — the chord this window adopts for the same reason. The APG
also says a listbox is wrong for interactive row content, which is why this body is a
treegrid ([`../research/list-manager-prior-art.md`](../research/list-manager-prior-art.md) §3).

---

## 4. Toolbar

### 4.1 Anatomy and geometry

The toolbar lives in the shared bar's actions slot, never in the body
(`_edit_window.html:47`; `edit-window.md` §3.1). It is **one node**, `#le-toolbar`, with
`class="edit-bar-toolbar"` (`style.css:9902-9907`), `role="toolbar"`,
`aria-label="List tools"`; inside it five `.edit-bar-group`s (`style.css:9908-9913`), four
`.edit-bar-sep`s (`style.css:9914-9920`, `aria-hidden`), and fourteen `.le-tool` buttons at
32 × 32 (`--control-h-body`), radius `--radius-sm`, transparent, `--text-muted`, 16 px
16-grid glyphs. (`edit-window.md:280` calls the node `.le-toolbar`; the class is
`edit-bar-toolbar`, there is no `.le-toolbar` rule.)

| Property | Value |
|---|---|
| Size | 32 × 32 desktop; 44 × 44 at ≤520 (E1, §10.5) |
| Hover | `--accent-soft` face, `--text-primary` glyph |
| Focus | 2 px `--accent`, offset 1 — the bar's ring (`style.css:9951`) |
| Disabled | `aria-disabled="true"`, `--opacity-disabled`, no hover response, **stays focusable** |
| Danger hover | `--danger-soft` face, `--danger` glyph |
| Overflow | the bar scrolls behind its 22 px mask; no second row (`style.css:9881-9901`) |

Computed width, not measured: 14 tools at 32 with nine 2 px group gaps (466 px) + four
separators with their 8 px margins (68 px) + the toolbar's own 8 px gaps (64 px) + the pinned
history pair with its seam (105 px) + bar padding and the bar gap (32 px) ≈ **735 px**. It
fits at 1280, 1000 and 861 (690 px of slot), and overflows at 720 (554 px of slot), where the
footer also wraps.

### 4.2 Shipped order

Left to right, with ids, names, chords:

| # | Group | Control | id | Accessible name | Chord |
|---|---|---|---|---|---|
| 1 | Move | Up | `le-move-up` | `Move up` | `Alt+↑` |
| 2 | Move | Down | `le-move-down` | `Move down` | `Alt+↓` |
| 3 | Move | To top | `le-move-top` | `To top` | `Alt+Shift+↑` |
| 4 | Move | To bottom | `le-move-bottom` | `To bottom` | `Alt+Shift+↓` |
| 5 | Level | Outdent | `le-outdent` | `Outdent` | `Shift+Tab` |
| 6 | Level | Indent | `le-indent` | `Indent` | `Tab` |
| 7 | Sort | A→Z | `le-sort-asc` | `Sort A to Z` | `Alt+Shift+A` |
| 8 | Sort | Z→A | `le-sort-desc` | `Sort Z to A` | `Alt+Shift+Z` |
| 9 | Sort | Done → bottom | `le-sort-done` | `Done to bottom` | `Alt+Shift+B` |
| 10 | Select | All | `le-select-all` | `Select all` | `Ctrl/Cmd+A` |
| 11 | Select | None | `le-select-none` | `Select none` | `Ctrl/Cmd+Shift+A` |
| 12 | State | Mark done | `le-mark-done` | `Mark done` | `Alt+Shift+D` |
| 13 | State | Mark open | `le-mark-open` | `Mark open` | `Alt+Shift+O` |
| 14 | State | Delete | `le-delete` | `Delete` | `Delete` |

Every control carries `title` and `aria-keyshortcuts` with the chord above, and the chord in
its `title`, following the history buttons' pattern (`_edit_window.html:26-43`). A `Ctrl/Cmd`
chord lists both modifiers in `aria-keyshortcuts`: `Control+A Meta+A`, `Control+Shift+A
Meta+Shift+A`. Chords use `Alt+Shift+letter` rather than `Alt+letter` because Windows
browsers and the Firefox menu bar claim `Alt+letter`; `Alt+↑/↓` is already shipped
(`hybrid.js:10266-10267`) and is kept.

Group separators sit **between** groups, never inside them. No tool is a placeholder and no
tool opens a menu.

### 4.3 Enablement and reasons

Disabled controls use `aria-disabled="true"`, keep their tab stop, keep their chord, and gain
the cause — `aria-label` = base name + `. ` + reason (the accessible-name pattern, and its
rationale, are `table-editor.md` §4.3 and its exception E3), `title` = base name + ` (chord)`
+ ` — ` + reason, `aria-keyshortcuts` unchanged. Activating a disabled control writes the same
sentence to the status and changes nothing.

A control is disabled only when the verb could not change **anything**. A partly possible
move stays enabled and counts the roots it skipped.

| Control | Disabled when | Reason (exact) |
|---|---|---|
| Move up | every root group is first among its siblings | `Every selected item is already first.` |
| Move down | every root group is last among its siblings | `Every selected item is already last.` |
| To top | the roots do not share one parent | `To top needs the selected items to share one level.` |
| To top | the roots share one parent and are already its first children | `The selected items are already at the top.` |
| To bottom | the roots do not share one parent | `To bottom needs the selected items to share one level.` |
| To bottom | the roots share one parent and are already its last children | `The selected items are already at the bottom.` |
| Indent | no root has a preceding sibling outside the target set | `The first item in a group cannot indent.` |
| Outdent | every root is at depth 0 | `Top-level items cannot outdent.` |
| Sort A→Z / Z→A | the focused row's level has fewer than two rows | `Nothing to sort in this level.` |
| Done → bottom | no row is done | `No done items to move.` |
| Select all | the model is empty | `Nothing to select.` |
| Select none | the selection is empty | `Nothing is selected.` |
| Mark done | no target row is a task item | `Only task items have a done state.` |
| Mark open | no target is a task, or no target task is done | `Only task items have a done state.` / `No task item is done.` |
| Delete | the model is empty | `Nothing to delete.` |

The two To top rows and the two To bottom rows are ordered: a mixed-parent selection reports
the level reason, a single-level selection at the edge reports the edge reason. A one-item
list is the edge case: it shares its own level, so `To top` is disabled with `The selected
items are already at the top.`, not with the level sentence.

`Select all` is never disabled while the model has rows: selecting everything twice is
harmless, and it selects **every row**, including the rows a collapse hides. `Delete` is
disabled only when there is no row left to act on. On an empty model every tool is disabled,
because every verb has lost its target; Apply is the only live control, and it removes the
list.

### 4.4 Move — up, down, top, bottom

The target set is the roots. A **root group** is one root with its whole subtree. Movement is
always inside the root's own parent: **this window never re-parents.** A move that would need
a new parent is skipped and counted; changing a level is Outdent's and Indent's job.

| Verb | Rule |
|---|---|
| Up | for each parent level that holds roots, in document order: move that level's block one slot before its preceding sibling; skip the block when it is already first |
| Down | the same from last to first, one slot after the following sibling; skip when already last |
| To top | the roots share one parent: move their block to the front of that parent's children |
| To bottom | the same to the end |

A level's **block** runs from its first root to its last root. Two roots that share a parent
are therefore one block: the unselected rows between them travel inside it, and the block
moves one slot as a unit, so two groups in one level never swap past each other.

A subtree travels with its root: the existing `<li>` is moved, so nested lists, inline
markup, task checkboxes and excluded quote/cell content go with it (`moveListItem`,
`hybrid.js:9600-9626`; the rule is stated in the function's comment). Groups in different
parents move in different parents, which is why up/down work across levels and top/bottom
cannot.

The counts are roots: `Moved 2 items up · 1 item could not move`. A structural no-op (down
then up) ends where it started; Apply then writes nothing (§7.1).

### 4.5 Level — indent, outdent

Both follow the shipped rules (`hybrid.js:4659-4685`) applied to a run of roots:

| Verb | Rule | Refused |
|---|---|---|
| Indent | a root becomes the **last child** of its nearest preceding sibling that is not part of the target set; a child list is created when that sibling has none, with the same tag as the list the root came from (`hybrid.js:4676-4681`) | a root with no preceding sibling outside the target set |
| Outdent | a root becomes the **next sibling of its parent item** (it lands after the parent, keeping order among the outdented roots) | a root at depth 0 (`hybrid.js:4666`) |

These are the two verbs that change a level. Roots that share a new parent keep their
relative order; a source list left empty is removed, as shipped (`hybrid.js:4672`, `:4684`).
Skipped roots are counted: `Indented 2 items · 1 item could not indent`. There is no level
ceiling and no minimum beyond depth 0.

### 4.6 Sort

Sort reorders **the focused row's parent level** and nothing else. Not the selection's level,
not the common parent of the selection: the focused row's level, one level, every time.
Nested levels are untouched; children travel with their parent row.

| Question | Answer |
|---|---|
| Which level | the level the focused row sits in — the one level named in the status |
| Which rows | **every** child of that parent, selected or not, and rows a collapse hides |
| Key | the row's own text (§2.4) |
| Comparison | numeric-aware, case-insensitive, stable `Intl.Collator(undefined, {numeric: true, sensitivity: "base"})`, then the existing order for ties — the table's collator and comparer (`table-editor.js:35-38`, `:1806-1811`) |
| Empty / whitespace labels | last in **both** directions |
| Result string | `Sorted 14 items at level 1` (level = the focused row's `aria-level`), plus `, Z to A` for descending |

Because the selection is never consulted, a mixed-level selection cannot make the verb
ambiguous, and the status names the level so the user can see which one moved.

*Source:* Org's `org-sort-list` documents "Sublists are not sorted" and sorts only the
first line of an item; Logseq's plugin sort reorders exactly one level and refuses a
multi-block selection. No shipped Markdown editor sorts a list in core
([`../research/list-manager-prior-art.md`](../research/list-manager-prior-art.md) §4).

### 4.7 Done → bottom

Done rows move to the end of **every** sibling group in the container, recursively: each
sibling list is partitioned into not-done (stable) then done (stable). Subtrees travel with
their parent, and relative order is kept inside each partition.

**Quoted and in-cell sub-lists are excluded rows.** They are not rows of this container
(§1.1), the model gives them no done state, and this verb never touches them: they stay
exactly as they are, inside their parent item.

Result: `Moved 5 done items to the bottom`.

*Source:* no tool ships a user-invoked "move completed to bottom" command; the closest
documented pattern is Todoist's completed area at the bottom of **each section and each
parent task** — per group, never once at the end of the whole list
([`../research/list-manager-prior-art.md`](../research/list-manager-prior-art.md) §5).

### 4.8 State — mark done, mark open, delete

| Verb | Target | Effect | Result |
|---|---|---|---|
| Mark done | roots plus their locked descendants | every task row in the set is set done; a non-task row is ignored and not counted | `Marked 4 items done` · `All 4 were already done` |
| Mark open | the same | every done task row in the set is set open; a non-task row is ignored and not counted | `Marked 4 items open` · `All 4 were already open` |
| Delete | roots plus their subtrees | the rows are removed from the model | `Deleted 3 items` |
| Done circle (row) | the single row | toggles that row only, never its descendants | `Marked 1 item done` / `Marked 1 item open` |

The count is the number of task rows that changed. A non-task row never appears in it, and
"all already done" means all four *task* rows were already done — the plain rows were never
in the count to begin with.

Only task items have a done state. This window does not convert a plain item into a task
item: that is a marker edit in the note's text, and this window does not write text (P5).
Deleted rows are recoverable with in-window Undo until Apply. After a delete, focus lands on
the row that followed the last deleted root, else the row before it, else the first row, else
Apply when the model is empty (§2.6).

### 4.9 Status line

`#list-editor-status` is the shell's `role="status" aria-live="polite" aria-atomic="true"`
region (`_edit_window.html:53-54`), styled by the shared footer rule
(`style.css:10010-10019`): `.82rem` / 1.3, `--text-muted`, one line with a tail ellipsis above
720 and a wrapped full row at 720 and below (`style.css:10030-10033`).

Format: counts, then ` — `, then the last result. The result persists until the next action.
The counts always describe the whole model: rows hidden by a collapse are counted, in the
item count and in the selection count.

```
14 items · 5 selected · 2 done — Sorted 14 items at level 1
```

| Event | Exact string |
|---|---|
| Open | `14 items · 0 selected · 2 done` |
| Selection change | counts only |
| Select all | `14 items · 14 selected · 2 done — Selected all 14 items` |
| Select none | `14 items · 0 selected · 2 done — Selection cleared` |
| Move up | `Moved 2 items up` · `Moved 2 items up · 1 item could not move` |
| Move down | `Moved 2 items down` · `Moved 2 items down · 1 item could not move` |
| To top | `Moved 3 items to the top` |
| To bottom | `Moved 3 items to the bottom` |
| Indent | `Indented 2 items` · `Indented 2 items · 1 item could not indent` |
| Outdent | `Outdented 2 items` · `Outdented 2 items · 1 item could not outdent` |
| Sort A→Z | `Sorted 14 items at level 1` |
| Sort Z→A | `Sorted 14 items at level 1, Z to A` |
| Done → bottom | `Moved 5 done items to the bottom` |
| Mark done | `Marked 4 items done` · `All 4 were already done` |
| Mark open | `Marked 4 items open` · `All 4 were already open` |
| Delete | `Deleted 3 items` · `Deleted 3 items. The list is empty.` |
| Row done toggle | `Marked 1 item done` · `Marked 1 item open` |
| Refusal (any) | the reason from §4.3, appended after the counts |
| Stale | `This list changed outside the window. Nothing was applied.` |
| History restore failure | `The saved state could not be restored` |

Singular nouns follow the count: `1 item`, `1 selected`, `1 done`. A refusal is appended after
the counts like any result. No message names a row: one message per action, never one per
item.

---

## 5. States, refusals and empties

### 5.1 The state matrix

| State | Header | Bar | Footer | Body |
|---|---|---|---|---|
| **Default** | `Edit list` + type badge | history dead; the six tools the focused first row rules out (Up, To top, Outdent, Indent, Select none, Mark open) are disabled with their reasons | `14 items · 0 selected · 2 done`, no result; Apply enabled | 14 rows, nothing selected, first row's cell focused |
| **Multi-select** | unchanged | history live after the first change | counts + last result | roots washed and boxed, descendants locked |
| **Done rows** | unchanged | Done → bottom and Mark open live | `· 5 done` in the counts | circles filled; the row's text is unchanged |
| **Collapsed parent** | unchanged | unchanged | counts unchanged (the filter is not the model) | children gone; parent `aria-expanded="false"`, `4 hidden` |
| **Single-item list** | unchanged | Move, To top, To bottom, Sort, Done → bottom, Select none, Indent, Outdent and Mark done/open disabled with reasons | `1 item · 0 selected · 0 done` | one row, no chevron |
| **Empty (after deletes)** | unchanged | every tool `aria-disabled` with its reason | `… — Deleted 3 items. The list is empty.` | tree hidden; `No items left. Apply removes the list.`; focus on Apply |
| **Read-only (stale)** | unchanged | every tool `aria-disabled`; history dead | the stale sentence; Apply disabled; Cancel enabled and focused | notice strip; rows keep their tab stop, verbs do nothing |
| **Applying** | — | — | — | **not reachable**: Apply is synchronous, like the table (`table-editor.md` §5.3) |
| **Error** | unchanged | history re-enabled | `The saved state could not be restored` | model unchanged, focus unchanged |
| **Long text** | unchanged | unchanged | unchanged | one ellipsized line, `title` = full text |
| **Long list (120 rows)** | unchanged | unchanged | unchanged | every row rendered; `.le-scroll` scrolls; marker column measured once, capped at 3 glyphs; no virtualisation |
| **Narrow 720** | unchanged | the bar scrolls behind the mask | footer wraps: counts on their own row, then hint, Cancel, Apply | rows unchanged |
| **Phone (390)** | unchanged | 44 px tools; the bar scrolls | wrapped; hint hidden | full screen, 44 px rows |

There is **one** read-only state, the stale state. An unopenable target — no container, a
container outside `#viewer-content`, a role that cannot write — never opens a window and has
no state here: the menu entry is absent (§1.1) or `open()` returns `false` (§1.3).

### 5.2 Single-item list

One row is a legal list. Move, To top, To bottom, both sorts, Done → bottom, Select none,
Indent, Outdent and both state verbs are disabled with the reason from §4.3; Delete and
Select all stay live. Status: `1 item · 0 selected · 0 done`.

### 5.3 Stale — the read-only state

The window shows a list that no longer exists in the note. Detection is one test, and only
one: `#viewer-content.contains(container)` is false.

| When it is tested | Why it can be false |
|---|---|
| every `hybrid:rerendered` | an external change, an AI patch, the saved-render reconciliation, or draft recovery replaced `#viewer-content`'s content |
| every `hybrid:exited` | a tab switch or an exit re-rendered the file before the event (`hybrid.js:8166-8178`) |
| every verb, and at Apply | the belt to the event's suspenders: a verb that cannot prove the container is still live refuses |

A re-render replaces the container node, so containment is the whole test; the window does
not compare content, hashes or signatures, and does not re-attach to a new node with the same
content. `hybrid:exited` is a re-render before it is an exit (`hybrid.js:8166-8178`), so the
window is normally stale by the time it hears it; if the container happens to still be live,
the window simply stays open and writable.

| Part | State |
|---|---|
| Notice strip | `#list-editor-notice`, visible directly under the bar (a banner, `controls.md` §2.14): `--bg-elev` — the token the notice precedent reads (`style.css:7019`; `--surface-raised` is its alias, `style.css:91`, `:163`) — 1 px bottom `--border`, padding `var(--space-2) var(--space-3)`, gap `--space-2`, a 16-grid warning glyph in `--warn` |
| Strip line 1 | `This list changed outside the window.` — `--text-ui`, `--text-primary` |
| Strip line 2 | `Nothing was applied. Cancel closes the window.` — `--text-sm`, `--text-muted` |
| Tree | `aria-readonly="true"`; the roving tab stop and arrow navigation stay, so the structure is still readable; Space, the verbs, Delete and the row controls do nothing |
| Toolbar | every tool `aria-disabled="true"`; history dead; each tool's accessible name appends `This list changed outside the window.` as its cause, because the §4.3 reasons would be false while the list is readable |
| Footer | status `This list changed outside the window. Nothing was applied.`; **Apply visible and disabled**; Cancel enabled |
| Focus | moves to `#list-editor-cancel` |
| Exit | Cancel, Esc, ×, backdrop — no write |

Cancel from the stale state does not try to restore a caret into a container that is gone: it
places the caret at the start of the **first list in the re-rendered content**, else focuses
`#viewer-content`. It never leaves focus on `<body>`, because note-level `Ctrl+Z` is
unreachable from there.

Apply is disabled, not hidden: a hidden control makes the footer jump (`edit-window.md` §4.5),
and the stale window is recoverable only by closing. The strip is **static text**, not a
second live region: the footer is the window's only live region (`edit-window.md` §4.2),
which is also how the known duplicate announcement (P14 there) is avoided here.

### 5.4 Error

The only reachable error is a history restore that cannot run — a snapshot that does not
parse. The index is reverted, the model and the selection are unchanged, focus does not
move, and the status reads `The saved state could not be restored`
(`edit-window.md` §6.4; `table-editor.md` §5.4). It looks like a position message: `.82rem`,
`--text-muted`, no icon, no `role="alert"`. A colour treatment is P6, not this pass.

### 5.5 Applying

There is no applying state. Apply mutates the live container and schedules the write in one
task, exactly like the table (`table-editor.js:1967-1992`): no spinner, no `aria-busy`, no
disabled Apply, no `Applying…` label. The mockup draws no applying board because the state
does not exist.

---

## 6. History

### 6.1 Stack, limits, seed

The window's history is modal-local, never a note write. It is the shared `NB.editWindow`
stack (`static/js/edit-window.js`; `edit-window.md` §6) attached once in `wire()` with
`ownsKey: () => true`, the table's mode (`table-editor.js:2119-2128`).

| Property | Value |
|---|---|
| Mode | stack — this module snapshots, the shared module owns the index |
| Cap | 100 snapshots including the opening one; 4 M characters (`edit-window.md` §6.4) |
| Coalescing | none — there is no text editing, so every step is `structural` |
| Snapshot | the row order, each row's depth and done state, each row's collapsed state, **the selection set and the anchor** |
| Seed | the opening model, after rows, depth and selection are reset |
| Cleared | on close, by Apply, Cancel, Esc, × or a backdrop click |

The selection rides in the snapshot as data, not as a step: a restore brings back the
selection that belonged to the state it restores (§6.4).

### 6.2 Undoable

| Undoable | One step per |
|---|---|
| Up, Down, To top, To bottom | activation, however many roots move |
| Indent, Outdent | activation |
| Sort A→Z, Sort Z→A, Done → bottom | activation |
| Mark done, Mark open, the row's done circle | activation / press |
| Delete | activation |

### 6.3 Not undoable

- Selection changes, and the focus: a selection change is not a step of its own. The
  selection is snapshot data, so Undo restores whatever set and anchor the restored state
  carried.
- Collapse and expand — a view filter.
- Hover, the notice strip, the stale state.
- Opening and closing.
- Apply and Cancel; their undo is the note's own.

### 6.4 Chords and restore

`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` are the window's, in every target, because
this body has no native text editing to lose. Restore re-renders the tree, restores the
**selection set and the anchor** from the snapshot, drops ids that no longer exist, rewrites
the counts with no result phrase, and keeps focus on the focused row if it still exists, else
on the nearest preceding row, else on the first row. A restore that cannot run writes the
§5.4 message.

---

## 7. Apply and Cancel

### 7.1 Apply — what the user can observe

The mechanism belongs to the architecture document
([`../architecture/list-editor.md`](../architecture/list-editor.md)): which nodes move, how
wrapper attributes are carried, how a no-op is recognized. This section owns only the
contract, which that document must not change:

1. **The window mutates the live container in place.** There is no clone, no detached build,
   no `replaceWith`, and no comparison of the built markup with the markup the window opened
   with. The rows in the note are the rows the window moved.
2. **Nothing is written on Cancel.** Cancel, Esc, × and a backdrop click discard the model
   and leave the note, its dirty mark and its undo history untouched (§7.2).
3. **An untouched or structurally identical list closes with no write.** A move and its
   reverse, or an open-Apply-close, leaves no POST, no dirty mark and no note undo entry.
4. **Flush, then mutate, then save, then close.** The pre-edit state is its own undo step
   (`table-editor.js:1984`), `NB.hybrid.onContentChange()` schedules the write
   (`hybrid.js:7362`), and the write is asynchronous — the window does not wait for it.
5. **One Apply is exactly one note-level undo step.**
6. **The wrapper keeps its attributes.** `start` survives the round-trip to the file: the
   serializer reads it (`static/vendor/turndown.browser.js:152-153`). `reversed` and `type`
   survive **in the DOM only** — the serializer does not read them, so a save does not
   promise to keep them in the Markdown.
7. **None of this window's chrome reaches the note.** The treegrid is its own DOM: no `le-*`
   class, no selection box, no `aria-*` from the grid, no zero-width placeholder and no
   marked caret `<br>` (`hybrid.js:207`, `:3384`) is introduced by the window.
8. **Close, then land the caret** (§7.3), after the first item's own content and after its
   checkbox when it has one — the shipped `focusListItem` shape (`hybrid.js:9651-9671`).

An **empty model** is the only case where Apply removes a node: the container is removed from
the note and the caret follows §7.3. The empty paragraph the hybrid surface may insert for
that caret is the surface's, not this window's.

### 7.2 Cancel

Cancel, Esc, the header × and a backdrop click are one action: discard the working model,
write nothing, add no history entry, and leave any existing dirty mark alone
(`table-editor.js:1994-1998`, `:2077-2100`). A clean close does not touch the note. Where the
caret lands is §7.3.

### 7.3 Where the caret lands

Every close lands the caret inside `#viewer-content`. Focus on `<body>` makes note-level
`Ctrl+Z` unreachable, so it is never an acceptable resting place: the context-menu item that
opened the window is already hidden when the click runs, so `NB.dialog.close()` has no usable
invoker to restore (`table-editor.js:2084-2092`).

| Close | Caret |
|---|---|
| Apply with rows left | the start of the first item's own content, after its checkbox when it has one (`hybrid.js:9651-9671`) |
| Apply with an **empty model** | the start of the **next block sibling** of the removed container; else the **previous block sibling**; else the start of `#viewer-content` |
| Cancel, × , backdrop | the start of the item that was focused in the window; when that item is gone, the same next-then-previous block rule |
| Cancel from the stale state | the start of the **first list** in the re-rendered content; else `#viewer-content` (§5.3) |

The next-then-previous order matters: deleting every row must not leave the caret above the
note or in a removed node, and the note must still take the next keystroke.

### 7.4 Footer

Order, geometry and the live region are the shell's (`edit-window.md` §4): status, hint
`Esc cancels` (`aria-hidden`), Cancel, Apply (primary), 44 px actions, wrap at 720. The hint
is the macro's `.te-hint` class (`_edit_window.html:55`) and is styled under
`.list-editor-modal` here, because the shipped `.te-hint` rule is scoped to the table
(`style.css:7006-7010`); it is hidden at ≤520 like the table's.

---

## 8. Keyboard and ARIA

### 8.1 Focus order

DOM order, no positive `tabindex`:

`[maximize] → [close] → [undo] → [redo] → bar tools → the focused row's cell → Cancel → Apply`

The tree is one tab stop: the focused cell has `tabindex="0"`, all others `-1`. `Tab` inside
the tree is the indent verb (shipped, `hybrid.js:6413-6423`) and `Shift+Tab` the outdent verb;
both are **released at the grid's edges** so the window is never a keyboard trap: at the last
visible row `Tab` moves to Cancel, at the first visible row `Shift+Tab` moves to the last bar
control — the table's edge rule (`table-editor.js:400-427`).

### 8.2 Keys

| Key | Action | Result string |
|---|---|---|
| `↑` / `↓` | previous / next visible row | counts only |
| `Home` / `End` | first / last visible row | counts only |
| `→` / `←` | expand / collapse a parent (no-op on a leaf) | none; `aria-expanded` speaks |
| `Enter` | expand / collapse a parent; no-op on a leaf | none |
| `Space` | toggle selection of the focused row and its subtree; the anchor becomes it | counts only |
| `Shift+Space` | toggle done on the focused row | `Marked 1 item done` / `Marked 1 item open` |
| `Shift+↑` / `Shift+↓` | extend the selection over visible rows from the anchor | counts only |
| `Ctrl/Cmd+A` | select every row in the model, hidden rows included | `Selected all 14 items` |
| `Ctrl/Cmd+Shift+A` | clear the selection | `Selection cleared` |
| `Alt+↑` / `Alt+↓` | move up / down | §4.9 |
| `Alt+Shift+↑` / `↓` | to top / to bottom | §4.9 |
| `Tab` / `Shift+Tab` | indent / outdent, released at the edges | §4.9 |
| `Alt+Shift+A` / `Z` / `B` | sort A→Z, Z→A, done to bottom | §4.9 |
| `Alt+Shift+D` / `O` | mark done / mark open | §4.9 |
| `Delete` | delete the target set | §4.9 |
| `Esc` | cancel the window | — |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` | undo / redo | §6 |

`Esc` closes on one press. The table spends its first `Esc` on a live range or fill
(`table-editor.md` §8.4); this window has neither, and the explicit `Select none` control is
the way to clear a selection.

### 8.3 Roles and attributes

| Element | Contract |
|---|---|
| Overlay | no role; `[hidden]` when closed, `.settings-overlay` so `NB.dialog` owns containment |
| Modal | `role="dialog" aria-modal="true" aria-labelledby="list-editor-title" tabindex="-1"` |
| Tree | `role="treegrid" aria-label="List items" aria-multiselectable="true" aria-colcount="1" aria-rowcount aria-readonly` |
| Row | `role="row" aria-level aria-rowindex aria-selected` + `aria-expanded` on parents; the classes `is-selected` and `is-locked` carry the paint |
| Cell | `role="gridcell"`, roving `tabindex`, the row's whole content |
| Selection box | `aria-hidden` — the row's `aria-selected` is the one signal, not a second checkbox |
| Done circle | `<button role="checkbox" aria-checked aria-label="Done">`, `tabindex="-1"` |
| Chevron | `<button aria-expanded aria-label="Collapse: <item text>" / "Expand: <item text>">`, `tabindex="-1"` |
| Markers, guides, spacers | `aria-hidden="true"` |
| Toolbar | `role="toolbar" aria-label="List tools"`; groups `role="group" aria-label="Move"…`; separators `aria-hidden` |
| Status | the shell's `role="status" aria-live="polite" aria-atomic="true"` |

The done toggle and the chevron are out of the tab order on purpose: the grid has exactly one
tab stop, and both controls have a keyboard path on the row itself (`Shift+Space` for done,
`Enter` for collapse) plus a toolbar equivalent for done. A second tab stop per row would
make a 100-row list 100 presses to leave.

### 8.4 What a screen reader hears

The dialog's name, then the toolbar's groups by name, then the grid. On a row: `Row 3, level
2, not selected, expanded` then the cell's content — `Done, checkbox, checked` for a task
item, then the item text, then `+2 nested`. Toggling selection changes `aria-selected` and
rewrites the counts. A locked descendant reads as `selected`; that is the whole point of the
lock, and its box is not a second control to announce. Every verb announces once through the
footer status, with the counts and the result. Collapse announces through `aria-expanded`
only. Nothing announces per row during a multi-row operation.

---

## 9. Responsive and phone

### 9.1 Widths

| Viewport | Window | Bar | Footer | Body |
|---|---|---|---|---|
| ≥1375 | 1320 × 85vh | the ~735 px toolbar fits | one row, 69 | rows unchanged |
| 1280 | 1229 | fits | one row | rows unchanged |
| 1000 | 960 | fits | one row | rows unchanged |
| 861 | 827 | fits | one row | rows unchanged |
| 720 | 691 | **scrolls**, mask on | **wraps**: counts own row (`style.css:10030-10033`) | rows unchanged; long text ellipsizes earlier |
| 520 | full screen, radius 0 | 44 px tools, scrolls | wrapped; hint hidden | 44 px rows |
| 390 | full screen | 44 px tools, scrolls | wrapped; hint hidden | 44 px rows; depth 3 still fits |

No new breakpoint. The only queries are the existing 720 footer wrap and the 520 full-screen
rule (`foundations.md` §8.2). The mockup's board headers carry these window widths; every
board is drawn at its viewport's shipped width.

### 9.2 The phone rule

The 520 block copies the table's, including the parts that defeat saved geometry:

```css
@media (max-width: 520px) {
  .list-editor-modal {
    width: 100vw !important;
    height: 100vh !important;   /* fallback */
    height: 100dvh !important;  /* the visible viewport; browsers that know it win */
    max-width: 100vw; max-height: 100vh;
    left: 0 !important; top: 0 !important;
    border-radius: 0; transform: none !important;
  }
}
```

`left`/`top`/`transform` are in the shipped table rule (`style.css:7035-7049`), so a window
that has been dragged still covers the phone. The `dvh` line is this window's one
improvement over the table: it follows the visible viewport when mobile browser chrome
shows. `edit-window.md` §9.5 describes an older cascade problem for the table; this window
must not reproduce it.

### 9.3 Targets

| Control | Desktop | Phone |
|---|---|---|
| Header close, maximize | 44 × 44 | 44 × 44 |
| Undo / redo | 44 × 44 | 44 × 44 |
| Bar tool | 32 × 32 | **44 × 44** (E1) |
| Row | **27** (30 at 1.15) | **44 high** (E2) |
| Selection box | 14 × 14 in an 18 × 18 cell | 14 wide, 44 high cell |
| Done circle | 16 × 16 in a 20 × 18 slot | 16 wide, 44 high slot |
| Chevron | 16 × 16 | 16 wide, 44 high |
| Cancel / Apply | 44 high | 44 high |

The in-row marks keep their desktop heights and gain the row's 44 px height. Eight 44 × 44
marks would consume most of a 358 px measure; the row is the touch target and the table takes
the same stance for its cells (`table-editor.md` §9.4). E2 records the deviation.

---

## 10. Tokens and CSS target

### 10.1 Reuse first

Every rule reads a foundation token. Nothing new is a colour.

| Need | Token |
|---|---|
| Row type, line box | `--text-body`, `--lh-normal` |
| Row padding value | `--le-row-pad-block` 3, `--le-row-pad-inline` 6 (the §2.1 rhythm, named) |
| Row radius | `--radius-xs` |
| Indent step | `--tree-indent` (18) — **not** a new token; it is the foundation value (`style.css:289`) |
| Chevron glyph, notice glyph | `--icon-sm` (14), `--icon-md` (16) |
| Selection box, done ring | `--le-select-box` 14, `--le-done-box` 16 |
| Mark cell | `--le-hit` 18 — the height and width of the selection cell and the done cell, so neither governs the row |
| Marker slot | `--le-mark-w` 20 |
| Phone row | `--control-h-touch` 44 |
| Hairlines, ring | `--stroke-1`, `--focus-ring`, `--focus-offset-inset` |
| Faces | `--surface-panel`, `--bg-elev` (the notice's token; `--surface-raised` aliases it, `style.css:91`, `:163`), `--accent-soft`, `--accent` |
| Text | `--text-primary`, `--text-muted`, `--text-on-accent` |
| Disabled | `--opacity-disabled` |
| Danger, warning | `--danger`, `--danger-soft`, `--warn` |
| Space | `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6` |
| Motion | `--dur-1`, `--ease-out` |
| Shell sizes | the `--edit-*` family (§10.2 step 1) |

Six component tokens, all numbers, none an alias:

```css
#list-editor-overlay {
  --le-row-pad-block: 3px;
  --le-row-pad-inline: 6px;
  --le-hit: 18px;
  --le-select-box: 14px;
  --le-done-box: 16px;
  --le-mark-w: 20px;
}
```

Declared on the overlay, not the body, because the body's rules and the footer's hint both
read them (guidelines §3 rule 1).

**Class names are part of the contract.** The body uses exactly these:
`le-body`, `le-scroll`, `le-tree`, `le-row`, `le-cell`, `le-select`, `le-done`, `le-mark`,
`le-indent`, `le-guide`, `le-chev`, `le-chev-slot`, `le-text`, `le-meta`, `le-empty`,
`le-notice-strip`, `le-notice-glyph`, plus the two state classes `is-selected` and
`is-locked`. The toolbar is `#le-toolbar.edit-bar-toolbar`. The blueprint is being corrected
to these names; an implementation that invents `le-select-hit`, `le-rail`, `le-chevron` or
`le-indent` for the rail is not this design.

### 10.2 Rules, in landing order

**1. Shell tokens — add the id, change no value** (`style.css:9805-9824`):

```css
#table-editor-overlay,
#designer-overlay,
#dw-designer-overlay,
#list-editor-overlay {
  /* every value unchanged: --edit-head-h 65px … --edit-badge-max 120px */
}
```

**2. Tokens and box:**

```css
#list-editor-overlay {
  --le-row-pad-block: 3px;
  --le-row-pad-inline: 6px;
  --le-hit: 18px;
  --le-select-box: 14px;
  --le-done-box: 16px;
  --le-mark-w: 20px;
}

/* The box reads the designer tokens so the edit windows cannot drift
 * (style.css:67-68, :152-153; the table does the same at :6725-6730). */
.list-editor-modal {
  width: min(var(--designer-modal-w), 96vw);
  height: min(var(--designer-modal-h), 92vh);
  max-width: 96vw;
  max-height: 92vh;
}

.list-editor-modal .le-body {
  display: flex; flex-direction: column;
  flex: 1 1 auto; min-height: 0; min-width: 0; padding: 0;
}
```

**3. Stale notice (banner shape):**

```css
.list-editor-modal .le-notice-strip {
  display: flex; align-items: flex-start; gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-elev);
  border-bottom: var(--stroke-1) solid var(--border);
  flex: 0 0 auto;
}
.list-editor-modal .le-notice-strip[hidden] { display: none; }
.list-editor-modal .le-notice-glyph { flex: 0 0 auto; color: var(--warn); }
.list-editor-modal .le-notice-glyph .icon { width: var(--icon-md); height: var(--icon-md); }
.list-editor-modal .le-notice-strip p { margin: 0; font-size: var(--text-ui); color: var(--text-primary); }
.list-editor-modal .le-notice-strip p + p {
  margin-top: var(--space-hair); font-size: var(--text-sm); color: var(--text-muted);
}
```

**4. Scroller, row, cell:**

```css
.list-editor-modal .le-scroll {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  overscroll-behavior: contain;
  background: var(--surface-panel);
  padding: var(--space-2) var(--space-4) var(--space-3);
}
.list-editor-modal .le-tree[hidden] { display: none; }

.list-editor-modal .le-row { display: flex; border-radius: var(--radius-xs); }
.list-editor-modal .le-row:hover,
.list-editor-modal .le-row.is-selected { background: var(--accent-soft); }
.list-editor-modal .le-cell {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: var(--space-1);
  padding: var(--le-row-pad-block) var(--le-row-pad-inline);
  border-radius: inherit;
  font-size: var(--text-body); line-height: var(--lh-normal);
  font-weight: var(--fw-regular); color: var(--text-primary);
  cursor: pointer;                 /* the whole row is the target */
}
.list-editor-modal .le-cell:focus { outline: none; }
.list-editor-modal .le-cell:focus-visible {
  outline: var(--focus-ring); outline-offset: var(--focus-offset-inset);
}
```

The cell's content never exceeds the 21 px line box, so `padding-block: 3px` yields the
27 px row of `guidelines.md` §2.1. No rule sets a row height.

**5. Selection box, done circle, marker:**

```css
.list-editor-modal .le-select {
  position: relative;
  flex: 0 0 auto; width: var(--le-hit); height: var(--le-hit);
  display: inline-flex; align-items: center; justify-content: center;
}
.list-editor-modal .le-select::before {
  content: ""; width: var(--le-select-box); height: var(--le-select-box);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-xs); background: transparent;
}
.list-editor-modal .le-row.is-selected .le-select::before {
  background: var(--accent); border-color: var(--accent);
}
.list-editor-modal .le-row.is-selected .le-select::after {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 4px; height: 8px;
  border: solid var(--text-on-accent);
  border-width: 0 var(--stroke-2) var(--stroke-2) 0;
  transform: rotate(45deg);
}
.list-editor-modal .le-row.is-locked .le-select { cursor: default; }

.list-editor-modal .le-mark,
.list-editor-modal .le-done {
  flex: 0 0 auto; min-width: var(--le-mark-w); height: var(--le-hit);
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: none;
  font-size: var(--text-sm); color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.list-editor-modal .le-mark {
  max-width: calc(3ch + var(--space-hair));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.list-editor-modal .le-done { cursor: pointer; position: relative; }
.list-editor-modal .le-done::before {
  content: ""; width: var(--le-done-box); height: var(--le-done-box);
  border: var(--stroke-1) solid var(--border-strong);
  border-radius: var(--radius-circle); background: transparent;
}
.list-editor-modal .le-done:hover::before { border-color: var(--accent); }
.list-editor-modal .le-done[aria-checked="true"]::before {
  background: var(--accent); border-color: var(--accent);
}
.list-editor-modal .le-done[aria-checked="true"]::after {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 4px; height: 8px;
  border: solid var(--text-on-accent);
  border-width: 0 var(--stroke-2) var(--stroke-2) 0;
  transform: rotate(45deg);
}
.list-editor-modal .le-done:focus-visible {
  outline: var(--focus-ring); outline-offset: var(--focus-offset);
}
```

**6. Indent rail, guides, chevron, text, meta:**

```css
.list-editor-modal .le-indent {
  flex: 0 0 auto; display: inline-flex; align-items: center; align-self: stretch;
}
.list-editor-modal .le-guide { position: relative; width: var(--tree-indent); align-self: stretch; }
.list-editor-modal .le-guide::before {
  content: ""; position: absolute; top: 0; bottom: 0;
  left: calc((var(--tree-indent) - var(--stroke-1)) / 2);
  width: var(--stroke-1); background: var(--border);
}
.list-editor-modal .le-chev,
.list-editor-modal .le-chev-slot {
  flex: 0 0 auto; width: var(--icon-md); height: var(--icon-md);
}
.list-editor-modal .le-chev {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: none; color: var(--text-muted);
  border-radius: var(--radius-xs); cursor: pointer;
}
.list-editor-modal .le-chev:hover { color: var(--text-primary); background: var(--accent-soft); }
.list-editor-modal .le-chev:focus-visible {
  outline: var(--focus-ring); outline-offset: var(--focus-offset-inset);
}
.list-editor-modal .le-chev svg {
  width: var(--icon-sm); height: var(--icon-sm);
  transition: transform var(--dur-1) var(--ease-out);
}
.list-editor-modal .le-chev[aria-expanded="true"] svg { transform: rotate(90deg); }
.list-editor-modal .le-chev-slot { visibility: hidden; }

.list-editor-modal .le-text {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.list-editor-modal .le-text.is-empty { color: var(--text-muted); }
.list-editor-modal .le-meta { flex: 0 0 auto; font-size: var(--text-sm); color: var(--text-muted); }

@media (prefers-reduced-motion: reduce) {
  .list-editor-modal .le-chev svg { transition: none; }
}
```

**7. Empty body, read-only, footer hint:**

```css
.list-editor-modal .le-empty {
  margin: 0; padding: var(--space-6) var(--space-4);
  text-align: center; font-size: var(--text-ui); color: var(--text-muted);
}
.list-editor-modal .le-empty[hidden] { display: none; }

.list-editor-modal .le-tree[aria-readonly="true"] .le-cell { cursor: default; }
.list-editor-modal .le-tree[aria-readonly="true"] .le-select,
.list-editor-modal .le-tree[aria-readonly="true"] .le-done,
.list-editor-modal .le-tree[aria-readonly="true"] .le-chev { cursor: default; }
.list-editor-modal .le-tree[aria-readonly="true"] .le-row:hover { background: transparent; }
.list-editor-modal .le-tree[aria-readonly="true"] .le-row.is-selected {
  background: var(--accent-soft);
}

.list-editor-modal .le-footer { align-items: center; }
/* .le-status carries no declaration: the shared .edit-footer > [role="status"]
 * rule (style.css:10010-10019) is its size, line and truncation. */
.list-editor-modal .le-footer > .te-hint {
  margin-left: var(--space-2); flex: 0 0 auto;
  font-size: var(--text-sm); color: var(--text-muted); white-space: nowrap;
}
```

**8. Bar tools** — the same anatomy as the table's, under this window's scope:

```css
.list-editor-modal .le-tool {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--control-h-body); height: var(--control-h-body);
  padding: 0; border: var(--stroke-1) solid transparent;
  border-radius: var(--radius-sm); background: transparent;
  color: var(--text-muted); font-family: inherit; cursor: pointer;
  flex: 0 0 auto;
}
.list-editor-modal .le-tool:hover { background: var(--accent-soft); color: var(--text-primary); }
.list-editor-modal .le-tool:focus-visible { outline: var(--focus-ring); outline-offset: var(--stroke-1); }
.list-editor-modal .le-tool.is-danger:hover { background: var(--danger-soft); color: var(--danger); }
.list-editor-modal .le-tool[aria-disabled="true"] {
  opacity: var(--opacity-disabled); cursor: default;
}
.list-editor-modal .le-tool[aria-disabled="true"]:hover {
  background: transparent; color: var(--text-muted);
}
.list-editor-modal .le-tool svg { width: var(--icon-md); height: var(--icon-md); display: block; }
```

**9. Phone (E1, E2):**

```css
@media (max-width: 520px) {
  .list-editor-modal {
    width: 100vw !important;
    height: 100vh !important;   /* fallback */
    height: 100dvh !important;  /* §9.2 */
    max-width: 100vw; max-height: 100vh;
    left: 0 !important; top: 0 !important;
    border-radius: 0; transform: none !important;
  }
  .list-editor-modal .edit-bar .le-tool {
    width: var(--control-h-touch); height: var(--control-h-touch);
  }
  .list-editor-modal .le-cell { min-height: var(--control-h-touch); padding-block: 0; }
  .list-editor-modal .le-select,
  .list-editor-modal .le-done { height: var(--control-h-touch); }
  .list-editor-modal .le-footer > .te-hint { display: none; }
}
```

### 10.3 Rules that must not move

- The body never holds the toolbar, and the bar never holds Cancel or Apply.
- Never two scrollers: `.le-scroll` is the only one.
- Never a second live region: the footer status is the only one.
- Never a fixed row height: the row is the line box plus 3 px padding, so it follows
  `--font-scale` (`guidelines.md` §2.1, `typography.md` §5.2). No in-row mark may be taller
  than the line box; that is why `--le-hit` is 18 and not `--control-h-sm`.
- Never a per-row tab stop beyond the cell.
- Never a text colour on `--accent-soft` other than the row's own `--text-primary` and the
  muted meta (`typography.md` §7.2).
- Never a clone of the container in the Apply path (§7.1).

### 10.4 Values re-checked

| Anchor | Verified | Source |
|---|---|---|
| Shell rows | 65 / 57 / 69; 44 px controls; 32 px bar tools | `style.css:9805-9824`, `:9870-9901`, `:10005-10033` |
| Box | `min(1320, 96vw) × min(85vh, 92vh)` | `style.css:6725-6730` |
| Box tokens | `--designer-modal-w` 1320, `--designer-modal-h` 85vh, both themes | `style.css:67-68`, `:152-153` |
| Bar face | `--bg-elev` on `.settings-modal .edit-bar` | `style.css:9876` |
| 720 wrap | status full row, then the actions | `style.css:10030-10033` |
| 520 rule | full screen **with** `left/top/transform` forced | `style.css:7035-7049` |
| Notice strip precedent | 10 / 14 padding, `--bg-elev`, glyph `--warn` | `style.css:7013-7033`; the token is at `:7019` |
| Notice token alias | `--surface-raised: var(--bg-elev)`, both themes | `style.css:91`, `:163` |
| Hint precedent | `.table-editor-modal .te-hint`, hidden at ≤520 | `style.css:7006-7010`, `:7048` |
| List indent in the note | `--list-indent: 1.6em`; lists set padding only | `style.css:80`, `:3605` |
| Task box in the note | 1em, 3 px radius, accent tick | `style.css:3644-3682` |
| Tree indent token | `--tree-indent: 18px` | `style.css:289` |
| Row height | 21 px line box + 6 = 27; 30 at the 1.15 root | `guidelines.md` §2.1 |

### 10.5 Exceptions applied

Two, both phone-only and both coarse-pointer floors. Desktop rest state is untouched.

| # | Exception | Why | Implementation | Tests |
|---|---|---|---|---|
| **E1** | At ≤520 the bar tools are 44 × 44 instead of 32 | `foundations.md` §10.4's 44 px coarse-pointer floor; the table's precedent (`table-editor.md` E1) | the 520 block in §10.2 step 9; the bar stays 57 = 6 + 44 + 6 + 1 | `tests/browser/test_list_editor_browser.js` at 390 |
| **E2** | At ≤520 the row is 44 px high and the in-row marks gain its height but keep their widths | eight 44 × 44 marks would eat most of a 358 px measure; the row is the target, as the table treats its cells (`table-editor.md` §9.4) | `min-height: var(--control-h-touch)` on the cell, `height` on the selection and done cells | `tests/browser/test_list_editor_browser.js` at 390 |

No other visual change is applied. Everything visual that is not here is in §12.

---

## 11. Acceptance criteria

Each names a file and an observable result.

| # | Criterion | Where | Observable |
|---|---|---|---|
| AC1 | The entry exists once, above the table entry, only on a list item, and only for a role that can write | `static/js/hybrid.js`, `static/js/list-editor.js` | A right-click on a list item shows `Edit list…` directly above `Edit table…`; a right-click on a paragraph shows neither; a `Shift+F10` menu from a list item shows it; with `NB.auth.canWrite()` false the item is absent and `open()` returns `false`. New DOM test in `tests/dom/test_dom.js` |
| AC2 | The window is the shared chrome with this body, and every contracted id exists | `templates/index.html`, `templates/_edit_window.html` | Header 65 / bar 57 / footer 69 at 1280; DOM order header → `.edit-bar` → `.le-body` → `.edit-footer`; ids `list-editor-overlay`, `list-editor-title`, `list-editor-type`, `list-editor-close`, `list-editor-undo`, `list-editor-redo`, `list-editor-notice`, `list-editor-grid`, `list-editor-status`, `list-editor-cancel`, `list-editor-apply`, `le-toolbar`, and the fourteen `le-move-up`, `le-move-down`, `le-move-top`, `le-move-bottom`, `le-outdent`, `le-indent`, `le-sort-asc`, `le-sort-desc`, `le-sort-done`, `le-select-all`, `le-select-none`, `le-mark-done`, `le-mark-open`, `le-delete`. `tests/dom/test_dom.js` |
| AC3 | Scope is one container | `static/js/list-editor.js` | Opening a nested list shows every `<li>` of the outer `<ul>`; a list in a blockquote shows only that quote's list; an in-cell list shows only that cell's list. `tests/dom/test_dom.js` |
| AC4 | One row per item, in document order, with the right level | `static/js/list-editor.js` | `aria-rowcount` equals the rendered row count; each `aria-level` equals `listItemDepth + 1`; a parent has `aria-expanded` and a chevron, a leaf neither. `tests/dom/test_dom.js` |
| AC5 | The row is the list-row contract | `static/css/style.css` | At M a row measures 27 high, padding 3 / 6, radius 4, text `--text-body` / `--lh-normal` / 400; no in-row mark exceeds the 21 px line box; at L (1.15) the row measures 30 and nothing clips; at ≤520 the row is 44 high with the marks keeping their widths (E2). `tests/browser/test_list_editor_browser.js` |
| AC6 | Selection is a set plus an anchor, and a parent locks its descendants | `static/js/list-editor.js` | A plain click leaves one row selected; `Ctrl/Cmd`+click toggles; `Shift`+click selects every visible row from the anchor; a parent's descendants carry `aria-selected="true"` and `.is-locked` and ignore `Ctrl/Cmd`+click; the counts include them; `Space` on the parent deselects the group; `Ctrl/Cmd+Shift+A` clears. `tests/dom/test_dom.js` |
| AC7 | Moves act on roots, inside their own parents, and are performable with the set model | `static/js/list-editor.js` | Built with `Ctrl/Cmd`+click alone (never a two-corner range): a nested row and a row in another parent both move one slot inside their own parents, nothing is re-parented, each subtree travels, and the skipped group is counted in the status. `tests/dom/test_dom.js` |
| AC8 | To top / To bottom refuse a mixed-level selection | `static/js/list-editor.js` | With roots in two parents both verbs are `aria-disabled="true"`, their names carry `needs the selected items to share one level`, and activating writes it. `tests/dom/test_dom.js` |
| AC9 | Sort reorders exactly the focused row's level | `static/js/list-editor.js` | With a mixed selection, sort still moves only the focused row's level; `Row 2` sorts before `Row 10`; ties keep order; an empty item is last ascending **and** descending; nested levels keep their order; the status names the focused row's level. `tests/dom/test_dom.js` |
| AC10 | Done → bottom partitions every sibling group | `static/js/list-editor.js` | Done rows are last in each group, relative order kept, subtrees intact, and the lists inside a blockquote or a table cell are byte-identical before and after. `tests/dom/test_dom.js` |
| AC11 | Indent / outdent follow the shipped rules, over a run | `static/js/list-editor.js` | The first sibling cannot indent; depth 0 cannot outdent; two selected siblings indent under the same preceding sibling in order; skips are counted. `tests/dom/test_dom.js` |
| AC12 | Every verb is reachable without a pointer and names its chord | `templates/index.html` | Every `.le-tool` has `aria-label`, `title` and `aria-keyshortcuts`; the two `Ctrl/Cmd` chords carry both modifiers (`Control+A Meta+A`, `Control+Shift+A Meta+Shift+A`); `Alt+↑` moves, `Tab` indents, `Shift+Space` toggles done, `Delete` deletes. `tests/dom/test_dom.js` |
| AC13 | One tab stop, and Tab is released at the edges | `static/js/list-editor.js` | Exactly one cell has `tabindex="0"`; `Tab` on the last visible row lands on `#list-editor-cancel`; `Shift+Tab` on the first lands on the last bar control. `tests/browser/test_list_editor_browser.js` |
| AC14 | History is per window, one step per action, and restores the selection | `static/js/list-editor.js`, `static/js/edit-window.js` | Undo is dead at open; one move enables it; ten moves need ten undos; a restore re-renders and restores the selection set and the anchor from the snapshot; the cap is 100. `tests/dom/test_dom.js` |
| AC15 | Apply writes once, or not at all | `static/js/list-editor.js` | Apply leaves exactly one note-level undo step; `start` survives the round-trip to the file, while `reversed` and `type` survive in the DOM only; an untouched list, or a move then undo, closes with no write and no dirty mark. `tests/browser/test_list_editor_browser.js` |
| AC16 | Cancel writes nothing | `static/js/list-editor.js` | Cancel / Esc / × / backdrop all close; the note and its dirty mark are unchanged; focus lands inside `#viewer-content`, never on `<body>`. `tests/browser/test_list_editor_browser.js` |
| AC17 | Stale goes read-only with the exact copy | `static/js/list-editor.js` | After a re-render (an emitted `hybrid:rerendered`, or `hybrid:exited`) the strip shows the two sentences, every tool is `aria-disabled`, Apply is disabled and visible, Cancel is focused, and the status reads `This list changed outside the window. Nothing was applied.`; Cancel puts the caret in the first list of the new content. `tests/dom/test_dom.js` |
| AC18 | The empty list is honest, and the caret stays in the note | `static/js/list-editor.js` | Deleting every row shows `No items left. Apply removes the list.`, keeps Apply enabled, and Apply removes the container and lands the caret at the start of the next block sibling, else the previous block sibling, else `#viewer-content`. `tests/dom/test_dom.js` |
| AC19 | Responsive truth | `static/css/style.css` | At 1280 and 861 the toolbar fits with no mask; at 720 the bar scrolls behind the mask and the footer wraps; at ≤520 the window is full screen even with saved geometry and the tools are 44. `tests/browser/test_list_editor_browser.js` |
| AC20 | No new colour, font, breakpoint, dependency or shadow | `static/css/style.css` | The diff adds no hex; the only new tokens are the six numbers in §10.1; the mockup opens offline. `docs/ui/list-editor-mockup.html` |
| AC21 | The mockup is self-contained and draws the named states | `docs/ui/list-editor-mockup.html` | Opens offline with zero network requests; scripting off still shows every toolbar; the toggle re-colours every board. Eleven boards: default open, collapsed parent, stale, empty, 390 phone, row anatomy, mixed-level selection with a locked descendant, 720, single item, failed restore, 120-row list. Strings present verbatim: `14 items · 0 selected · 2 done`, `9 items · 0 selected · 2 done`, `14 items · 5 selected · 2 done`, `6 items · 3 selected · 1 done`, `5 items · 0 selected · 1 done`, `1 item · 0 selected · 0 done`, `120 items · 0 selected · 0 done`, `This list changed outside the window. Nothing was applied.`, `No items left. Apply removes the list.`, `0 items · 0 selected · 0 done — Deleted 2 items. The list is empty.`, `The saved state could not be restored`, `To top needs the selected items to share one level.`, `The selected items are already at the top.`, `The selected items are already at the bottom.`, `Esc cancels` |
| AC22 | To top / To bottom refuse at the edge with their own reason | `static/js/list-editor.js` | A single-item list disables `To top` with `The selected items are already at the top.` and `To bottom` with `The selected items are already at the bottom.`; a single-level selection already first reports the top sentence, not the level sentence; activating either writes it. `tests/dom/test_dom.js` |

---

## 12. Proposals, not applied

| # | Proposal | Why | Cost |
|---|---|---|---|
| P1 | Drag to reorder inside the window, mirroring the note's grip | The note already has a drag (`static/js/list-edit.js`; the commit is `moveListItem`, `hybrid.js:9600-9626`); pointer users will look for it here | A second drag implementation, a drop-line spec, and a proxy row; multi-select drag needs a block-drag model |
| P2 | Make the nested / hidden counts outline pills instead of trailing meta | The task brief's word is "chip" | A second shape in the row; §2.1 says trailing meta |
| P3 | Rename an item in the window (double-click, inline edit) | Some reorders are really renames | Turns a structure surface into a text surface; needs a text model, a caret, and a write path |
| P4 | Virtualise a very long tree, above a measured threshold | The body renders every row; 100 is the budget, 1000 is not supported | A measured threshold first; today's budget is documented in §2.5 |
| P5 | Convert a plain item into a task item ("Make task") | It is the natural inverse of deleting a box | It edits the item's marker, which is text; the note's own Task button owns that |
| P6 | Give a failure an error treatment (`--danger`, an icon) | `The saved state could not be restored` looks like a position message | Follows `edit-window.md` P4 and `table-editor.md` P4 |
| P7 | Make the done circle a tab stop | It is pointer-only today, with `Shift+Space` and the toolbar as the keyboard path | A second tab stop per task row |
| P8 | Expand all / collapse all in the toolbar | A 100-row list with 20 parents takes 20 presses | Two more tools; a sixth group |
| P9 | Persist collapse state across opens | Users who collapse the same branches every time | A stored key per container, and a stale-key problem |
| P10 | Announce the level in the status after a move (`Moved 3 items to level 2`) | The result names the verb, not where things landed | Wording only; the counts line would grow |
| P11 | A filter box at the top of the body (`Filter items…`), hiding non-matching rows as a view filter | A 100-row list is hard to scan; the tree already has a view filter in collapse | A second field in the chrome, an empty-filter state, and the question of what a verb does while filtered |

---

## 13. What not to build

- **No text editing, no rename, no drag** in v1 (P1, P3). The row's text is read-only and
  shows plain text, never inline formatting.
- **No second selection control.** The row selects; the box is a mark; the done circle is a
  state, not a selection.
- **No rubber band, no marquee, no "select all on click".** The gestures are the ones in
  §3.2 — click, `Ctrl/Cmd`+click, `Shift`+click — and nothing else.
- **No re-parenting move.** Up, Down, To top and To bottom stay inside the parent level;
  Indent and Outdent are the only level changes.
- **No second read-only state, and no blocked window.** A target that cannot be edited opens
  nothing (§1.3, §5.1).
- **No cross-container operation.** A root never leaves its container; a quoted list and an
  in-cell list stay their own containers (`hybrid.js:9472-9488`).
- **No marker editing.** Apply preserves `start` in the DOM and in the file; the window never
  renumbers a list.
- **No per-row live region, no toast, no confirmation dialog.** One status line and the
  note-level undo.
- **No second scroller, no sticky toolbar inside the body, no second toolbar.**
- **No applying state, no spinner, no `aria-busy`.** Apply is synchronous.
- **No clone and no `replaceWith`** in the Apply path (§7.1).
- **No custom tooltip.** `aria-label` + native `title` are the contract (`controls.md` §2.10).
- **No new colour, font, shadow, radius, spacing rung, z-index, breakpoint or dependency.**
- **No `filter: brightness()` as a state**, and no filled danger button.
- **No writing before Apply.** Cancel, Esc, ×, the backdrop, collapse and selection never
  touch the note.

---

## 14. Settled points

Every point below is decided; the earlier open-question table is withdrawn. This document
and [`../architecture/list-editor.md`](../architecture/list-editor.md) must state each one
the same way.

| # | Point | Settled as |
|---|---|---|
| U1 | Selection | An explicit **set of row ids** plus an **anchor id** (§3). A parent's descendants are selected and locked; verbs act on roots; `Space` toggles the focused row and its subtree; `Ctrl/Cmd+A` selects every row, hidden rows included |
| U2 | Moves | Up/Down move every root group one slot inside its own parent, two groups sharing a parent moving as one block; no re-parenting. To top/To bottom need one shared parent. Six refusals in §4.3, including the edge pair `The selected items are already at the top.` / `… already at the bottom.` |
| U3 | Sort scope | Always the **focused row's** parent level, never the selection's common parent (§4.6); the status names that level |
| U4 | Done → bottom | The end of **every** sibling group, recursively; quoted and in-cell sub-lists are excluded rows and never touched (§4.7) |
| U5 | Mark done / open | `Marked 4 items done`, `Marked 4 items open`, `All 4 were already done`, `All 4 were already open`; non-task rows are not counted (§4.8) |
| U6 | Apply | The window mutates the **live container in place**: no clone, no `replaceWith`, no detached build, no comparison with the opening markup. The observable contract is §7.1; the mechanism is the blueprint's |
| U7 | Stale | `#viewer-content.contains(container)` false on `hybrid:rerendered`, on `hybrid:exited`, on every verb and at Apply (§5.3). No content signature. A stale Cancel puts the caret in the first list of the new content, else `#viewer-content` |
| U8 | One read-only state | Stale is the only one; an unopenable target opens no window and has no state (§1.3, §5.1) |
| U9 | Row height | 27 px at the 1.0 root, 30 at 1.15, 44 at ≤520. The selection and done cells are 18 (`--le-hit`); the whole row is the target (§2.2, §10.1) |
| U10 | Empty model | Apply removes the container and lands the caret at the next block sibling, else the previous block sibling, else the start of `#viewer-content` — always inside `#viewer-content` (§7.3) |
| U11 | `reversed` / `type` | Kept in the DOM; `start` alone survives the save round-trip (`static/vendor/turndown.browser.js:152-153`) (§7.1) |
| U12 | Role gate | `open()` requires `NB.auth.canWrite()` (`static/js/auth.js:226`); no window for a viewer (§1.3) |
| U13 | Names | `#le-toolbar.edit-bar-toolbar`; the body classes in §10.1 are canonical, including `is-selected` and `is-locked`. The blueprint must match; `edit-window.md:280`'s `.le-toolbar` spelling is the older name |
| U14 | Restore | The snapshot stores the selection set and the anchor; a restore brings both back (§6.1, §6.4) |
| U15 | Own text | Strip nested `ul`/`ol`, every `input`, every `[contenteditable="false"]` node; collapse whitespace; drop `\u200B`. A Mermaid card labels as its own prose (§2.4) |
| U16 | Long lists | The marker column is measured once per render from the widest visible marker, capped at 3 glyphs with an ellipsis; 100 rows is the budget, 1000 is not supported, no hard cap (§2.3, §2.5). The mockup draws a 120-row list |
| U17 | Selection counts | `Select all` counts every row, collapsed rows included; no status string says "visible" (§3, §4.9) |

Two cross-doc notes for the owners, recorded here because this document cannot edit them:
`docs/ui/edit-window.md:424` still describes Apply as a signature comparison and a rebuild
into reassembled wrappers — U6 replaces that. `docs/ui/hybrid-editing.md` §4.7.2 still says
there is no separate list editor; the settled decision overrides it.

