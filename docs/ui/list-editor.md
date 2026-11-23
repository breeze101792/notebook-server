# List editor — the `Edit list` window

Status: Current spec — pre-implementation (new surface; nothing shipped yet).

Reference mockup: [`list-editor-mockup.html`](list-editor-mockup.html) — dark and light, a
theme toggle over every board: the window open on a 14-item nested task list with **nothing
selected** and 2 done, a collapsed parent, the stale read-only notice, the empty list, the
390 phone, the row anatomy with labelled geometry, a mixed-level selection with a locked
descendant and **To top** and **To bottom** disabled with their reasons, the 720 wrap, a
single-item list, a failed restore, a 120-row list scrolled mid-way, one row's prose being
edited in place, one row being dragged with its subtree, and a selected block being dragged
with its span. Boards 13 and 14 are the drag pair: the dimmed span and the 2 px drop line,
one row and several roots.

Scope: the content of `#list-editor-overlay` — the entry point, the flat document-order
treegrid, row anatomy, selection, the toolbar verbs, the in-place edit of one item's prose
(§2.7), the stale and empty states, the in-window history, Apply / Cancel, keyboard and ARIA,
and the phone layout. The shared window chrome — header, action bar frame, footer frame, drag,
resize, maximize, focus containment, geometry persistence — is **not** redesigned here. It is
owned by [`edit-window.md`](edit-window.md) and its markup is `templates/_edit_window.html`
(`static/css/style.css:9798-10033`). The list's rendered visuals in the note are owned by
[`reader.md`](reader.md) §2.4; this document only reads them.

**Normative source.** This document is the single source of truth for this window's
content. It reads [`foundations.md`](foundations.md) for every token,
[`controls.md`](controls.md) for control anatomy, states and ARIA,
[`typography.md`](typography.md) §2 for the row role, [`guidelines.md`](guidelines.md) §2.1
for the list-row contract, [`edit-window.md`](edit-window.md) for the chrome, and
[`table-editor.md`](table-editor.md) as the sibling body whose structure this document
mirrors. It does **not** own: the chrome's heights, the history engine, the focus trap, the
window geometry, or the mechanism by which a committed prose reaches the live `<li>` — that
write path is [`../architecture/list-editor.md`](../architecture/list-editor.md)'s, and
§2.7 owns only what a user can observe.

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
| Prose | the same region as the own text, unflattened | `strong`, `em`, `code`, `a`, the item's existing `<br>`s and `img`s kept, every other node dropped (§2.4, §2.7); this is what an edit changes and what Apply writes back into the item's own content, and it is offered as a field only when it is one run holding all of the item's text |
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
| 4 | Item text | `.le-text` | `--text-body` / `--lh-normal`, weight 400, one line, ellipsis, `title` = full text; while edited, the prose with a caret (§2.7) | [`guidelines.md`](guidelines.md) §2.1 |
| 5 | Trailing meta | `.le-meta` | `--text-sm`, `--text-muted`, `flex: 0 0 auto` | §2.1 |

Row box: padding `3px 6px`, radius `--radius-xs`, transparent at rest. Nothing in the row is
taller than the 21 px line box — the marks are 18 — so the row measures **27 px at the 1.0
root and 30 px at 1.15**, the list-row contract unchanged (`guidelines.md` §2.1). The row is
never given a fixed height; it grows with the line box at XL, and it grows by whole line
boxes while one of its items is being edited and the prose wraps (§2.7).

| State | Paint | Source |
|---|---|---|
| Rest | transparent over `--surface-panel` | §2.1 |
| Hover | `--accent-soft` | §2.1 |
| Selected | `--accent-soft` face + the box filled `--accent` (`aria-selected="true"`, class `is-selected`) | §3.1 |
| Focused | inset `--focus-ring` on the cell (`outline-offset: var(--focus-offset-inset)`), so the scroll container cannot clip it | foundations §10.2 rule 4 |
| Locked (a descendant of a selected parent) | the same wash and the same filled box; `aria-selected="true"`, class `is-locked` | §3.2 |
| Editing (§2.7) | the row's own face unchanged — rest, hover or selected — with the cell's inset `--focus-ring` kept, an `--accent` caret and no new fill, border or radius | §2.7 |

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

### 2.4 Text — the label at rest, the prose in the edit

The row at rest shows the item's own plain text: one line, ellipsis, `title` = the full text
(`guidelines.md` §2.1). Inline markup (`strong`, `em`, `code`, `a`, images) is **not**
rendered at rest. The reason is stated once so nobody "fixes" it: this is a structure
surface. Its job is order, level and state; the note's own rendering is where formatting
lives, in the page behind this dialog. Rendering bold and code on every row would promise a
text surface where none is wanted, and every inline node would cost a row that must also
truncate, focus and announce — 100 rows of it. One row at a time is a different bargain, and
that is §2.7.

Since §2.7 the same region is also the subject of an in-place edit, and there the prose is
rendered: `strong`, `em`, `code` and `a` appear as formatting, never as Markdown source.
One strip, two outputs, and no third:

| Output | Markup | Read by |
|---|---|---|
| Label (and the sort key) | flattened to plain text, whitespace collapsed | the row at rest (§2.2), the sort (§4.6), the chevron's name (§2.3), the commit's no-op test (§2.7) |
| Prose | kept: `strong`, `em`, `code`, `a`, and the item's own `<br>`s and `img`s | the field while a row is edited (§2.7) |

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

The **prose** output is the run that carries the whole item: the region steps 1–4 identify,
unflattened, so `strong`, `em`, `code`, `a`, the item's own `<br>`s and its `img`s stay in
it. It is offered as a field only when that run is contiguous and holds **all** of the item's
text (§2.7); when other content splits the text, no field is offered and the label is all the
row shows. That guard is what keeps the two outputs in agreement: wherever a field exists,
flattening it gives the label back.

| Case | Row shows |
|---|---|
| Text present | the stripped text |
| No text after the strip (image-only, checkbox-only, empty) | `Empty item`, `--text-muted`, `title="Empty item"` |
| Long text | one line, ellipsis, `title` = the full text |

The label is also the edit's no-op test: a commit whose collapsed text equals the label
before the edit writes no step and no message (§2.7). A field opened and closed without
typing is therefore byte-identical, breaks and images included, because the field shows the
run and writes the run back.

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

### 2.7 Editing one item

One row at a time can have its words edited in place. The edit keeps the item's inline
formatting — `strong`, `em`, `code`, `a` — and everything the item already holds inside its
text, its own breaks and images. It renders that as formatting rather than as Markdown
source, and it writes once: a commit is one window-history step, Apply writes the model,
Cancel discards it. The window is still a structure surface: this is one field on one row,
with no formatting controls, no source view and no second toolbar.

**Why it is here.** A reorder is often not the whole job: an item's wording is wrong, and
leaving the window to fix it costs the model the user has built. The window therefore edits
one item's words, and only its words.

**What the edit owns.** Exactly the row's prose run — the region §2.4 calls the prose, which
is the item's own inline text with `strong`, `em`, `code` and `a` kept. Nothing else in the
item is rendered in the field and nothing else is written on commit:

| In the field | Not in the field, not touched |
|---|---|
| the item's text | every nested `ul`/`ol` and its items |
| `strong`, `em`, `code`, `a` | the item's own `<input>` checkbox |
| the item's existing `<br>`s and `img`s | every `[contenteditable="false"]` node: Mermaid, Graphviz, WaveDrom, KaTeX and any wrapper a pasted checkbox left behind |
| — | the marker: the bullet or the rendered ordinal (§2.3) |
| — | the row's trailing meta (§2.4) |

The field renders the run as it is: the breaks and the images the item already has appear
where they are, and entering the edit changes none of them. An image in the field is part of
the text being edited, not a protected object: it can be selected, and `Backspace` or `Delete`
beside it removes it, so Apply removes it from the item too. The window adds words; it does
not claim to protect structure. No key in the field creates a break, and nothing the field
cannot show is ever written back — the refusal below is the other half of that rule.

**When the field is refused.** Two things must be true before a field is offered: the item's
prose is one contiguous run that carries **all** of the item's text, and that run holds
nothing the field cannot write back unchanged. The first fails when other content splits the
text — a second paragraph, text after a nested list, text after a card — and a field would
then show part of the item and its commit would write over a whole it never displayed. The
second fails when the item carries inline content outside the preserved set: a wrapper a
pasted checkbox left behind, an element or an attribute the field cannot keep. Either way the
row is not editable and the attempt writes one sentence:

```
Editing needs one piece of text the window can keep.
```

That is the refusal voice of §4.3 (`To top needs the selected items to share one level.`): it
names the requirement, not the user. One sentence covers both causes, and no cause is
enumerated in the UI. The press still does what a press does — a click selects the row — and
nothing else happens: no field, no history step, no model change, and no disabled tool and no
row style to explain it. The sentence is reported where every refusal is reported, after the
counts (§4.9).

| Item | Field? |
|---|---|
| one run of text, with any inline markup from the preserved set, breaks and images inside it | yes |
| text, then a nested list | yes — the run ends before the list, and the list's items are their own rows |
| text after a nested list | no — not one piece |
| two paragraphs | no — not one piece |
| text after a card | no — not one piece |
| a wrapper around a pasted checkbox, or any element or attribute outside the preserved set | no — the field cannot keep it, so it does not write |
| no text at all (empty, checkbox-only, card-only) | yes — the empty field and its placeholder, below |
| an image and no text | yes — the field holds the image; there is no text to type until the caret is placed beside it |

Both refusals are silent about which cause fired. Naming it would list the window's markup
allowlist in the footer, and the user cannot act on the difference: the note is where the
item is edited either way.

**Entry.** Two gestures, and they are one rule at every width: a **double-press** and `F2`.
A double-press is two presses on the same row within 350 ms and 8 px — a mouse double-click, a
pen double-tap and a touch double-tap are all this one rule, and nothing in the window depends
on which device produced it.

| Gesture | Caret |
|---|---|
| Double-press a row — the cell, except `.le-chev`, `.le-done` and `.le-meta`, with no `Ctrl`/`Cmd`/`Shift`, at any width | at the point pressed, from `caretRangeFromPoint`, so a word can be fixed where it was pressed; at the end of the prose when the press landed past it or the platform returns no position |
| `F2` on the focused row, parent or leaf | at the end of the prose |

`F2` exists on every row, which is why no fifteenth toolbar tool was added (§4.1's width is
already computed without one). `Enter` starts no edit on any row: on a parent it collapses and
on a leaf it does nothing (§8.2), and one key that means different things on two row shapes is
a rule nobody remembers.

**What never starts an edit.**

| Press or state | Result |
|---|---|
| A press that travels 4 px and becomes a drag | the drag (§3.2); the second press of a pair never follows a drop, and the post-drop click is swallowed (AC30) |
| A press on `.le-chev` | the collapse (§2.3); the chevron is a button, not prose |
| A press on `.le-done` | the done toggle (§4.8); a second press must not also open a field |
| A press on `.le-meta` | nothing: `+2 nested` and `4 hidden` are facts, not the item's words |
| `Enter` on any row | no edit: the collapse on a parent, nothing on a leaf (§8.2) |
| `F2` or a double-press on a refused item | no field, and `Editing needs one piece of text the window can keep.` in the status |
| `Ctrl`/`Cmd` or `Shift` held on either press of a double-press | the selection gesture it already is (§3.2); a modifier press never edits, so a double `Shift`+press cannot both extend and edit |
| Any press on a stale window (§5.3) | nothing: a read-only row cannot be edited, and a field would promise a write that Apply refuses |
| A press or tap during a live drag | nothing: the drag owns the model until the drop (§3.2) |
| The first press of a pair, on any device | selects the row, as today; the second press is the one that edits, and only if it lands within 350 ms and 8 px of the first (§3.2) |

**Paint.** The edit adds one thing to the row's own look — the prose — plus a caret, and it
takes nothing away:

| Part | At rest | Editing |
|---|---|---|
| Row face | transparent, `--accent-soft` on hover or selected | unchanged; the selection is not touched by the edit |
| `.le-text` | `--text-primary`, one line, ellipsis, `title` = full text | `--text-primary`, wraps, no ellipsis, no `title` |
| `.le-text` when the item is empty | `--text-muted` (`is-empty`), label `Empty item` | `--text-primary`, empty, the placeholder below |
| Cell ring | inset `--focus-ring` while the cell has keyboard focus | the same ring for as long as the field has focus (`.le-row.is-editing`), so entering an edit by keyboard never removes the ring |
| Caret | — | `--accent` (`caret-color`) |
| Box | — | none: no fill, no border, no radius, no shadow. The field is the text run, not an input; a 36 px control would break §2.2's 27 px row |
| Height | 27 px at 1.0, 30 at 1.15, 44 at ≤520 | the same floor, then +21 px per wrapped line (1.0 root); no cap and no inner scroller |
| Marks, chevron, meta, guides | as §2.2 | unchanged in place; the marks stay vertically centred as the row grows and the guides stretch |

`title` is removed for the length of the edit — a native tooltip over the line being typed is
noise, and it would still carry the old text — and written back on commit with the new full
text. The empty state's muted colour and `Empty item` label belong to the read state, not to
the field: entry drops `is-empty`, a commit restores it when the prose is empty.

**Width and wrapping.** The field is exactly as wide as the row's text column: the cell's
width minus the box, the marker slot, the indent and the trailing meta, which keeps its slot
so the field's width does not jump on entry. The prose wraps at that edge
(`overflow-wrap: anywhere`) and the row grows downward. A long paste is a tall row; the
window's scroller takes it, and this window does not promise a measure for a paragraph.

**Empty rows and rows with no prose.** What the field does when the item has little or no
text of its own:

| Item | At rest | Editing |
|---|---|---|
| Truly empty | `Empty item`, muted | an empty field with the placeholder `Item text` |
| A task item with only a checkbox | `Empty item` (a checkbox is state, not prose) | the empty field; the checkbox stays in the row and outside the field |
| A card-only item | `Empty item` | the empty field; the card stays in the item and outside the field |
| An image and no text | `Empty item` (an image carries no text) | the field holds the image, and the placeholder does not show |
| Text with an image or a break | the text | the text, with the image or the break where the author put it |
| Text with a trailing card | the text | the text; the card stays outside the field |

The placeholder is `Item text`, not `Empty item`: `Empty item` names an absence, and inside a
field it would read as content the user is invited to keep. It is a CSS `::before` on the
empty field, never a text node, so it can never be committed or serialized. Text typed into
an item that had no prose becomes its run, in the position the label occupies: after the
checkbox, before any nested list or card that trails it.

**Keys.** While the field has focus, every key is the field's except the ones named
below:

| Key | Effect |
|---|---|
| `Enter` | commit; focus stays on the row's cell |
| `Esc` | cancel; the window stays open (§8.2) |
| `Tab` | commit; focus stays on the row's cell. It does **not** indent: one press is one action, and finishing a sentence must not restructure the list. The next `Tab`, on the now-focused row, is the indent verb as shipped |
| `Shift+Tab` | the same, with no outdent for the same reason |
| `Shift+Enter` | swallowed: the field creates no break, which is also why `Enter` can commit. The breaks the item already has are shown and written back |
| `Ctrl`/`Cmd` + `B` / `I` / `U` | swallowed: this window creates no formatting (§13) |
| Everything else — printable keys, `Space`, `Delete`, `Backspace`, arrows, `Home`/`End`, `Ctrl`/`Cmd` with `A`, `X`, `C`, `V`, `Z`, `Shift+Z`, `Y`, and IME composition | native to the field. The grid's model keys are inert, so `Space` types a space instead of selecting, `Delete` deletes a character instead of a row, and `Ctrl/Cmd+Z` is the browser's text undo, not the window's history |
| `F2`, `Alt`+anything, `Shift+Space`, `Ctrl/Cmd+Shift+A` | inert: they are model verbs and the model is not the target |

Paste inserts plain text: clipboard formatting is dropped, because the window cannot create
`strong`, `em`, `code` or `a` and will not pretend to. Existing formatting survives; new
formatting is the note's business.

**Esc precedence.** One press spends one thing, in this order:

1. a live edit → the edit is cancelled, the window stays open;
2. else a live drag → the drag is cancelled, the window stays open (§3.2);
3. else → the window closes, discarding the model (§7.2).

An edit and a drag are never live together: a press that starts a drag commits the edit
first.

**Exits.** Every way out of the field, and what it commits. A commit is idempotent: a blur and
the press that caused it commit the same edit once, never twice.

| Exit | Result |
|---|---|
| `Enter` | commit, stay on the row |
| `Tab`, `Shift+Tab` | commit, stay on the row |
| A press on another row | commit, then the press does its own job — select, extend, toggle or start a drag candidate |
| A press on the edited row's own chevron or done circle | commit first, then the toggle: the press moves focus to the control, and a half-typed word must not be lost |
| A press on a toolbar tool, the history pair, or Apply | commit first, then the verb, the step or the write. Clicking Undo mid-edit therefore commits and then undoes that commit |
| Blur to anywhere else — the status line, the header, the page | commit; blur is the fallback that leaves no uncommitted field behind |
| `Esc` | cancel, no step, no message |
| Cancel, the header ×, a backdrop press | discard the edit, then close with no write (§7.2) |
| The window goes stale | the edit is cancelled: a field that cannot be written must not look writable. The label returns, the notice appears, focus moves to Cancel (§5.3) |
| The window closes by any other path | discard, like Cancel |

**Focus and caret after.** A commit puts focus back on the row's cell, which is still the
grid's roving tab stop — including a commit that ended by blur, where a click on the header or
the page had already taken focus away and the grid must not be left without its tab stop. The
row's selection is exactly what it was: editing never selects or deselects. There is no caret
to restore, because the row is a label again. Where the commit was caused by a control that
keeps focus — a toolbar tool, a history button, Cancel — that control keeps it and the cell is
not pulled back; Apply closes the window and §7.3 lands the caret. Undo of a
commit is §6.4's restore: the tree re-renders, the selection comes back from the snapshot,
and focus stays on the focused row's cell if it still exists, else the nearest preceding row,
else the first. A commit that empties the prose keeps the row focused and shows `Empty item`.
After Apply the caret follows §7.3, like every other close.

**What a screen reader hears.** No treegrid attribute changes: `aria-rowcount`,
`aria-multiselectable`, `aria-readonly` and every row's `aria-level`, `aria-rowindex`,
`aria-selected` and `aria-expanded` stay as they were. The edit is one element's attribute
set, on the `.le-text` that was a label a moment ago:

| Moment | What is announced |
|---|---|
| Entry | the text box receiving focus: `Item text, text box`, then the prose as its value. Formatting is **not** announced — bold, code and link text read as words, and an image in the run is announced as an image — and that is stated rather than implied, because this is not a rich-text editor |
| Typing | the field's own editing feedback, per the platform |
| Commit | the row's cell receives focus and is announced as before (`Row 3, level 2, selected`) with the new prose as its content; the status line then speaks `Edited 1 item` |
| Cancel | the cell is announced the same way with the old text; the status is not written at all, so nothing extra is spoken |

The field is `role="textbox" aria-label="Item text" aria-multiline="false" tabindex="-1"`.
`aria-multiline="false"` is the truth of the key contract: `Enter` commits, it does not insert
a break. `tabindex="-1"` keeps §8.1's single tab stop in the tree: the field is focused on
entry and never tabbed to. The window has **one** live region (§3.4, §4.9) and this section
adds nothing to it; the field is not a live region, and no `aria-describedby` points at a new
node.

**The status line.** A commit that changes the prose writes the counts plus `Edited 1 item`
(§4.9). Three things write **nothing**, and the reason is one rule: the status reports an
action that changed the model or a refusal that explains why nothing happened, and the only
message that is neither is the stale sentence, which is a state.

| Case | Status | Why |
|---|---|---|
| Entry | unchanged | the focus change already says "text box"; a second message would announce the same event twice |
| A commit that changes nothing | unchanged, no step | a no-op is not an action (§3.2 rule 4, §6.3) |
| A cancelled edit | unchanged | the row reverts visibly and the model never changed; `Edit cancelled` would report a non-event and would overwrite the result of the last real action |

No message names the row or quotes the new text: one message per action, never one per item,
and never the item's words in the footer — a 100-row list has no business reading its own
prose back at the user.

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
| Press a row and drag it (mouse or pen) | a press on an **unselected** row selects it alone; a press on a selected **root** keeps the whole selection; a press on a locked descendant selects it alone. After ~4 px of pointer travel the block is dragged and dimmed — the pressed row, or every selected root that shares its parent together with the rows between them, each with its subtree — and a 2 px accent line marks the slot; the drop lands only in the block's **own parent level** — before a remaining same-level row, or at the end of that level |
| Release on a valid slot | the row, or the gathered block in document order, is spliced into the model, one in-window history step, status `Moved 3 items` (the root count; one row reads `Moved 1 item`); the roots stay selected and focused |
| Release on the block's current position or inside its own span, inside a dragged subtree, or outside the level | no line is drawn over the block and nothing happens: no history step, no message, the order is unchanged |
| Press and drag a mixed-level selection | no drag starts: no line, no dim; the status reads `Dragging needs the selected items to share one level.` |
| `Esc` or `pointercancel` during a drag | the drag is cancelled; the window stays open and nothing moves |
| Touch | never drags: a touch press scrolls and pans, and the toolbar is the reorder path on a phone |
| `Ctrl`/`Cmd`/`Shift` + press, or a press on `.le-chev` / `.le-done` | no drag candidate; these presses do exactly what their rows above and below say |
| `Ctrl`/`Cmd` + click a row | toggle that row and its subtree: add it (its descendants become locked) or remove it |
| `Ctrl`/`Cmd` + click a **locked** row | nothing: an ancestor is selected, so the row cannot be toggled individually. A plain click still replaces the selection with that row — the lock forbids toggling, not re-selecting |
| `Shift` + click a row | extend: replace the set with every **visible** row from the anchor to this row; rows hidden inside a collapsed parent come in with their ancestor; the anchor does not move |
| Click the chevron | expand / collapse — view only (§2.3); the press does not change the selection |
| Click the done circle | toggle that row's done state — one history step (§4.8); the press does not change the selection |
| Double-press a row — two presses within 350 ms and 8 px, mouse, pen or touch, not on its chevron, done circle or meta, no `Ctrl`/`Cmd`/`Shift` | start the in-place edit at the pressed point (§2.7); the press-and-release that precedes it is a plain click, so the edit opens with that row alone selected, and the edit itself changes nothing |

The drag follows five rules, and no others:

1. **One row, or the selected block.** The unit is the pressed row with every descendant row.
   When the pressed row is a selected **root**, the unit is one contiguous span: every
   selected root that shares its parent, every subtree, and the unselected siblings between
   the roots. The span is the move verbs' block (§4.4), so the rows between two roots travel
   inside it rather than being stranded. A childless row travels alone; a collapsed parent
   carries the rows it hides (§2.3). A root in another parent refuses the whole drag: there
   is no partial block, and no silent "the rest stayed".
2. **Never a new parent.** The slot is always a position among the block's own siblings, so a
   drag cannot indent or outdent a row, and a row of another level — including a descendant
   of another row — is never a slot. `Indent` and `Outdent` stay the only level changes
   (§4.5), and the move verbs stay the keyboard path (§4.4).
3. **The slot is a position among the remaining siblings.** It is decided from the pointer's
   Y against the midpoint of each **visible same-level row outside the block's span**, not
   from whichever row the pointer is over, so the space over a nested child never opens that
   child's level and the block never offers a drop inside itself — including over the
   unselected rows between its roots. When the span covers its whole level there is no
   position left: no line is drawn, and a release is a no-op.
4. **The press keeps a selection; a click still collapses it.** A plain press on a selected
   root leaves the selection alone for the drag; a press on an unselected row, or on a locked
   descendant, replaces the selection with that row. A press and release with no travel is
   still a plain click, which replaces the selection with the pressed row (§3.1) — so only
   travel turns a selection into a block move.
5. **A drag is one step, and a no-op is no step.** A real drop captures `structural` once
   and is undoable as one step (§6.2); a drop that changes no order captures nothing and
   writes no message.

The drop line spans the level's indent start to the tree's right edge (the grid fills the
body's content box), reuses the note's `.nb-drop-line` bar with only the height as a delta,
and scrolls with the rows. Every row of the block's span is dimmed (`--opacity-drag`) — the
roots, their subtrees and the unselected rows between them, all of which move — and the page
carries a grabbing cursor with text selection off (`body.nb-le-drag`, the note's
`body.nb-list-drag` pattern).

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

Announcement is the counts line only — one message per action, never one per row. Every key in
this table is the grid's: inside a live edit the field owns them (§2.7), so `Space` types a
space and `Ctrl/Cmd+A` selects the field's text, not the model.

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

The drag is not a control, but it refuses in the same voice. When the selected roots do not
share the pressed row's parent, no drag starts and the status reads `Dragging needs the
selected items to share one level.` — the level sentence with the drag's verb, never the To
top or To bottom copy.

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

A **drag** (§3.2) is the pointer form of the same move and obeys the same two rules: the row,
or the selected block, travels with every subtree, and it lands inside its own parent level —
never in another one. The block is the same span as here: from the first root to the last
root's subtree, the unselected rows between them inside it. The count is roots: a one-row drag
reports `Moved 1 item`, a block of three `Moved 3 items`. A mixed-level selection has no drag
at all, for the same reason To top and To bottom refuse it.

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
item: the marker is not the item's prose, and §2.7 edits the prose alone — the checkbox and
the marker stay as they are (P5).
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
| Drag drop | `Moved 3 items` — the root count; a one-row drag reads `Moved 1 item` |
| Drag refused (mixed level) | `Dragging needs the selected items to share one level.` |
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
| Edit commit | `Edited 1 item` |
| Edit entered, edit cancelled, or a commit that changed nothing | nothing — the counts and the last result stay exactly as they were (§2.7) |
| Refusal (any) | the reason from §4.3, appended after the counts |
| Edit refused (§2.7) | `Editing needs one piece of text the window can keep.` |
| Stale | `This list changed outside the window. Nothing was applied.` |
| History restore failure | `The saved state could not be restored` |

Singular nouns follow the count: `1 item`, `1 selected`, `1 done`. A refusal is appended after
the counts like any result. No message names a row: one message per action, never one per
item. The edit's entry and cancel are the two silent moments, and they are silent on purpose
(§2.7).

---

## 5. States, refusals and empties

### 5.1 The state matrix

| State | Header | Bar | Footer | Body |
|---|---|---|---|---|
| **Default** | `Edit list` + type badge | history dead; the six tools the focused first row rules out (Up, To top, Outdent, Indent, Select none, Mark open) are disabled with their reasons | `14 items · 0 selected · 2 done`, no result; Apply enabled | 14 rows, nothing selected, first row's cell focused |
| **Multi-select** | unchanged | history live after the first change | counts + last result | roots washed and boxed, descendants locked |
| **Done rows** | unchanged | Done → bottom and Mark open live | `· 5 done` in the counts | circles filled; the row's text is unchanged |
| **Collapsed parent** | unchanged | unchanged | counts unchanged (the filter is not the model) | children gone; parent `aria-expanded="false"`, `4 hidden` |
| **Dragging** | unchanged | unchanged | counts unchanged, no result | every row of the block's span dimmed (`--opacity-drag`) — the roots, their subtrees and the rows between them — one 2 px `--accent` line at the slot, `body.nb-le-drag` giving a grabbing cursor with text selection off; nothing moves until the drop |
| **Drag refused (mixed level)** | unchanged | unchanged | counts + `— Dragging needs the selected items to share one level.` | no line and no dim; the press that asked does only what a press does, and the selection is unchanged (§3.2) |
| **Editing one item** | unchanged | unchanged; a tool or history press commits the edit first, then runs its verb (§2.7) | unchanged on entry; counts + `— Edited 1 item` after a commit; unchanged after a cancel | one row's `.le-text` is the prose with an `--accent` caret; that row keeps its face and its ring, its `title` is gone and its text wraps; the rest of the grid is untouched |
| **Edit refused** | unchanged | unchanged | counts + `— Editing needs one piece of text the window can keep.` | no field: the row keeps its label and its `title`, and the press that asked does only what a press does (§2.7) |
| **Single-item list** | unchanged | Move, To top, To bottom, Sort, Done → bottom, Select none, Indent, Outdent and Mark done/open disabled with reasons | `1 item · 0 selected · 0 done` | one row, no chevron; dragging it can never find another slot, so no line is drawn |
| **Empty (after deletes)** | unchanged | every tool `aria-disabled` with its reason | `… — Deleted 3 items. The list is empty.` | tree hidden; `No items left. Apply removes the list.`; focus on Apply |
| **Read-only (stale)** | unchanged | every tool `aria-disabled`; history dead | the stale sentence; Apply disabled; Cancel enabled and focused | notice strip; rows keep their tab stop, verbs do nothing, a press starts no drag and draws no line, and a double-press starts no edit |
| **Applying** | — | — | — | **not reachable**: Apply is synchronous, like the table (`table-editor.md` §5.3) |
| **Error** | unchanged | history re-enabled | `The saved state could not be restored` | model unchanged, focus unchanged |
| **Apply failed** | unchanged | every tool `aria-disabled`; history dead | `Could not apply — the list was not changed`; Apply disabled, Cancel focused | the rollback replaced the container, so the stale notice shows and no field can be started (§5.4) |
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
| Tree | `aria-readonly="true"`; the roving tab stop and arrow navigation stay, so the structure is still readable; Space, the verbs, Delete, the row controls and the drag do nothing — a press starts no drag candidate and draws no line; a double-press starts no edit (§2.7) |
| A live edit | cancelled before the state is painted: the field returns to its label and to `title`, no step and no message are written, and focus moves to Cancel with the rest of §5.3 |
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

Two errors are reachable, and neither is an alert.

**A restore that cannot run** — a snapshot that does not parse. The index is reverted, the
model and the selection are unchanged, focus does not move, and the status reads
`The saved state could not be restored` (`edit-window.md` §6.4; `table-editor.md` §5.4). It
looks like a position message: `.82rem`, `--text-muted`, no icon, no `role="alert"`. A colour
treatment is P6, not this pass.

**A commit that throws.** The rollback restores the pre-edit markup, which replaces the
container node, so the window is stale from that moment on: it stays open and read-only, shows
the stale notice, disables Apply and puts focus on Cancel. The status reads
`Could not apply — the list was not changed` (`static/js/list-editor.js:65`, `:2176-2181`), not
the stale sentence, because the failure is what the user has to know first; the next event
that rewrites the status (§5.3) replaces it. Cancel then behaves as §5.3 says — the caret goes
to the first list in the re-rendered content, else `#viewer-content` — and writes nothing.

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
| Coalescing | none — a commit is one step per commit, so the keystrokes inside a live field are not a step at all (§2.7) |
| Snapshot | the row order, each row's depth and done state, each row's collapsed state, each row's prose (§2.7), **the selection set and the anchor** |
| Seed | the opening model, after rows, depth and selection are reset |
| Cleared | on close, by Apply, Cancel, Esc, × or a backdrop click |

The selection rides in the snapshot as data, not as a step: a restore brings back the
selection that belonged to the state it restores (§6.4).

### 6.2 Undoable

| Undoable | One step per |
|---|---|
| Up, Down, To top, To bottom | activation, however many roots move |
| A drag drop | one drop, however large the block's span — one root's subtree, or several roots with the rows between them |
| Indent, Outdent | activation |
| Sort A→Z, Sort Z→A, Done → bottom | activation |
| Mark done, Mark open, the row's done circle | activation / press |
| Delete | activation |
| An edit commit (§2.7) | one commit, however many keystrokes it took |

### 6.3 Not undoable

- Selection changes, and the focus: a selection change is not a step of its own. The
  selection is snapshot data, so Undo restores whatever set and anchor the restored state
  carried.
- The keystrokes inside a live edit, and entering or leaving the edit state: the field is the
  browser's until the commit, and the commit is the step (§2.7). The field's own text undo is
  the browser's, not this stack's.
- A commit that changes no text, and a cancelled edit: nothing to undo (§2.7).
- A drop that changes no order: a release on the block's current position, anywhere inside
  its own span (a dragged subtree included) or outside its level captures nothing (§3.2).
- Collapse and expand — a view filter.
- Hover, the notice strip, the stale state.
- Opening and closing.
- Apply and Cancel; their undo is the note's own.

### 6.4 Chords and restore

`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` are the window's in every target **except a
live edit**, where they are the browser's text undo inside the field (§2.7); in the grid there
is no native text editing to lose. Restore re-renders the tree, restores the **selection set
and the anchor** from the snapshot, drops ids that no longer exist, rewrites the counts with
no result phrase, and keeps focus on the focused row if it still exists, else on the nearest
preceding row, else on the first row. A restore never runs over a live edit: the history
buttons and every verb commit first (§2.7), and the chords are the field's. A restore that
cannot run writes the §5.4 message.

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
   reverse, an edit and its undo, or an open-Apply-close, leaves no POST, no dirty mark and no
   note undo entry. The committed prose is part of what tells the window nothing changed, on
   the same footing as the row order and the done map.
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
   marked caret `<br>` (`hybrid.js:207`, `:3384`) is introduced by the window. An edit writes
   prose and only prose: the field's caret, its `role`, its `contenteditable`, its
   `is-editing` class, its placeholder and its removed `title` never reach the item (§2.7).
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

The tree is one tab stop: the focused cell has `tabindex="0"`, all others `-1`. The edit
field is **not** a tab stop: it is `tabindex="-1"`, focused on entry and never tabbed to, so
editing a row does not add a stop to the sequence (§2.7). `Tab` inside the tree is the indent
verb (shipped, `hybrid.js:6413-6423`) and `Shift+Tab` the outdent verb; both are **released at
the grid's edges** so the window is never a keyboard trap: at the last visible row `Tab` moves
to Cancel, at the first visible row `Shift+Tab` moves to the last bar control — the table's
edge rule (`table-editor.js:400-427`). Inside a live edit both commit and stay on the row
before either rule applies (§2.7).

### 8.2 Keys

| Key | Action | Result string |
|---|---|---|
| `↑` / `↓` | previous / next visible row | counts only |
| `Home` / `End` | first / last visible row | counts only |
| `→` / `←` | expand / collapse a parent (no-op on a leaf) | none; `aria-expanded` speaks |
| `Enter` | expand / collapse a parent; no-op on a leaf, and never an edit (§2.7) | none |
| `F2` | start the edit on the focused row, parent or leaf (§2.7) | none |
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
| `Esc` | cancel the edit; else cancel a drag; else cancel the window (§2.7, §3.2) | — |
| `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y` | undo / redo | §6 |

`Esc` closes on one press, and it spends itself in one order: a **live edit** first (the field
reverts and the window stays open), then a **live drag** (the drag is cancelled and the window
stays open), then the window itself. The table spends its first `Esc` on a live range or fill
(`table-editor.md` §8.4); this window has neither, and the explicit `Select none` control is
the way to clear a selection. No other key acts while a drag is live — the chords, `Delete`
and the move keys are inert until the drop — so nothing can mutate the model under the
pointer. Inside a live edit the grid's keys are released to the field, except the keys
§2.7 names: `Space` types, `Delete` deletes a character, `Ctrl/Cmd+A` selects the
field's text and the history chords are the browser's. The table takes the same stance
(`table-editor.md` §3.3).

### 8.3 Roles and attributes

| Element | Contract |
|---|---|
| Overlay | no role; `[hidden]` when closed, `.settings-overlay` so `NB.dialog` owns containment |
| Modal | `role="dialog" aria-modal="true" aria-labelledby="list-editor-title" tabindex="-1"` |
| Tree | `role="treegrid" aria-label="List items" aria-multiselectable="true" aria-colcount="1" aria-rowcount aria-readonly` |
| Row | `role="row" aria-level aria-rowindex aria-selected` + `aria-expanded` on parents; the classes `is-selected` and `is-locked` carry the paint |
| Cell | `role="gridcell"`, roving `tabindex`, the row's whole content |
| Edit field (only while one row is being edited) | `<span class="le-text is-editing" role="textbox" aria-label="Item text" aria-multiline="false" contenteditable="true" tabindex="-1">`; no treegrid, row or cell attribute changes (§2.7) |
| Selection box | `aria-hidden` — the row's `aria-selected` is the one signal, not a second checkbox |
| Done circle | `<button role="checkbox" aria-checked aria-label="Done">`, `tabindex="-1"` |
| Chevron | `<button aria-expanded aria-label="Collapse: <item text>" / "Expand: <item text>">`, `tabindex="-1"` |
| Markers, guides, spacers | `aria-hidden="true"` |
| Toolbar | `role="toolbar" aria-label="List tools"`; groups `role="group" aria-label="Move"…`; separators `aria-hidden` |
| Status | the shell's `role="status" aria-live="polite" aria-atomic="true"` |

The done toggle and the chevron are out of the tab order on purpose: the grid has exactly one
tab stop, and both controls have a keyboard path on the row itself (`Shift+Space` for done,
`Enter` for collapse) plus a toolbar equivalent for done. A second tab stop per row would
make a 100-row list 100 presses to leave. The edit field follows the same rule: `tabindex="-1"`,
focused on entry, never tabbed to.

### 8.4 What a screen reader hears

The dialog's name, then the toolbar's groups by name, then the grid. On a row: `Row 3, level
2, not selected, expanded` then the cell's content — `Done, checkbox, checked` for a task
item, then the item text, then `+2 nested`. Toggling selection changes `aria-selected` and
rewrites the counts. A locked descendant reads as `selected`; that is the whole point of the
lock, and its box is not a second control to announce. Every verb announces once through the
footer status, with the counts and the result. Collapse announces through `aria-expanded`
only. Nothing announces per row during a multi-row operation.

A row that enters the edit state announces once, as a text box taking focus: `Item text, text
box`, then the prose as the value. Nothing is announced on entry through the live region, and
the row's own attributes do not change, so the reader hears the field appear inside the cell
it was already on rather than a new row. On commit the cell takes focus back and is announced
as before with the new prose, and the status speaks `Edited 1 item`; on cancel the same, with
the old text, and the status is untouched (§2.7). Formatting is not announced — bold, code and
link text read as words — because this window edits the run, not the structure of the prose.

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
improvement over the table: it follows the viewport as mobile browser chrome shows and hides —
not the on-screen keyboard, which the next paragraph handles. `edit-window.md` §9.5 describes
an older cascade problem for the table; this window must not reproduce it.

**Editing on the phone.** The edit exists at ≤520 and enters by the same double-press as
everywhere else (§2.7): a phone has no `F2`, so the press pair is the only entry there. Two
presses within 350 ms and 8 px enter the edit; one press still only selects. `.le-cell` carries
`touch-action: manipulation`, so there is no 300 ms tap delay and the browser cannot answer
the second press with a double-tap zoom instead of a press.

The on-screen keyboard does not shrink this window's layout viewport. iOS keeps `100dvh` at
its full height, and Android's default `resizes-visual` leaves the layout alone too, so the
window does not pretend to resize. While an edit is live at ≤520 it reserves the keyboard
instead: `.le-scroll` takes `padding-bottom: calc(var(--space-3) + var(--m-kb, 0px))` — the
inset `static/js/mobile.js:434` writes from `visualViewport` — which is the room to scroll into,
and the edited row takes the same value as `scroll-margin-bottom`, which is where
`scrollIntoView({ block: "nearest" })` stops. The field is scrolled into view on entry and
again on every `visualViewport` resize while the edit is live, because the entry scroll runs
before the keyboard finishes animating. No footer control is needed while typing —
`Enter` commits, and the keyboard's return key is `Enter` — and there is no accessory bar, no
field pinned above the keyboard and no `interactive-widget` request.

The field's type is a fixed **16 px** at ≤520 (E3, §10.5). `--text-body` is 14 px at the 1.0
root, and iOS zooms the whole fixed window when a `contenteditable` below 16 px takes focus
(`foundations.md` §4.4; the same literal as `style.css:7381`). The table records this as P5
and has not paid for it, because there every cell would grow; here the delta is one row in one
state, so it is paid. The row keeps its 44 px floor (E2) and grows by whole 24 px line boxes —
16 px × `--lh-normal` — so a two-line edit on the phone is 48 px, and the guides and the marks
recentre as they do on the desktop.

### 9.3 Targets

| Control | Desktop | Phone |
|---|---|---|
| Header close, maximize | 44 × 44 | 44 × 44 |
| Undo / redo | 44 × 44 | 44 × 44 |
| Bar tool | 32 × 32 | **44 × 44** (E1) |
| Row | **27** (30 at 1.15) | **44 high** (E2) |
| Row while editing | 27, then +21 per wrapped line | 44, then +24 per wrapped line (§9.2) |
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
| Code and links in the prose | `--font-mono` (`style.css:195`); `--accent` for the caret and the link's underline |
| Disabled | `--opacity-disabled` |
| Danger, warning | `--danger`, `--danger-soft`, `--warn` |
| Space | `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-6` |
| Motion | `--dur-1`, `--ease-out` |
| Shell sizes | the `--edit-*` family (§10.2 step 1) |
| On-screen keyboard inset | `--m-kb` — a runtime name written on `<html>` from `visualViewport` (`static/js/mobile.js:434`), not a token this document declares (guidelines §3 rule 5) |

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

**The edit state adds no token.** Its rules read `--accent`, `--font-mono`, `--focus-ring`,
`--focus-offset-inset`, `--text-muted`, `--text-body`, `--space-3` and the runtime `--m-kb`,
all of them existing names. The two literals it introduces are not tokens and are both named
here: the `Item text` placeholder string (§2.7) and the 16 px phone field size, which is
exception E3 in §10.5.

**Class names are part of the contract.** The body uses exactly these:
`le-body`, `le-scroll`, `le-tree`, `le-row`, `le-cell`, `le-select`, `le-done`, `le-mark`,
`le-indent`, `le-guide`, `le-chev`, `le-chev-slot`, `le-text`, `le-meta`, `le-empty`,
`le-notice-strip`, `le-notice-glyph`, plus the four state classes `is-selected`,
`is-locked`, `is-dragging` and `is-editing`. A drag puts `is-dragging` on the block's rows and
on `.le-body`, and `nb-le-drag` on `<body>`; its line is `nb-drop-line le-drop-line` — the
note's own bar class plus this window's height delta. An edit puts `is-editing` on `.le-body`,
on that row's `.le-row` and on its `.le-text`, and nothing else (§2.7); the body class is what
the phone's keyboard inset hangs on (§9.2). The toolbar is
`#le-toolbar.edit-bar-toolbar`.
The blueprint is being corrected
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

**9. Drag chrome** — the note's `.nb-drop-line` bar with this window's height delta, the
dimmed block, and the page-level grabbing cursor. `.le-scroll` becomes the line's containing
block, so the line scrolls with the rows:

```css
/* The line's containing block: it sits inside the scroller so it scrolls
 * with the rows. */
.list-editor-modal .le-scroll { position: relative; }

/* .nb-drop-line owns the bar: absolute, --accent, the --accent-soft ring. */
.list-editor-modal .le-drop-line { height: 2px; }
.list-editor-modal .le-row.is-dragging { opacity: var(--opacity-drag); }
.list-editor-modal .le-body.is-dragging { user-select: none; }

/* The note's body.nb-list-drag pattern: the cursor stays grabbing even when
 * the captured pointer is over the header or the footer. */
body.nb-le-drag { cursor: grabbing; user-select: none; }
```

**10. Phone (E1, E2):**

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

**11. The in-place edit (§2.7):**

```css
/* The field is the text run: no fill, no border, no radius, no shadow. It
 * keeps the row's line box and grows it by whole lines. */
.list-editor-modal .le-text.is-editing {
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  outline: none;
  cursor: text;
  caret-color: var(--accent);
}
/* A pseudo-element, never a text node: the placeholder cannot be committed.
 * The implementation clears a lone <br> so :empty still matches an emptied
 * field. */
.list-editor-modal .le-text.is-editing:empty::before {
  content: "Item text";
  color: var(--text-muted);
}
/* Formatting is rendered, not authored. Mono is the smallest signal that
 * keeps a code run from reading as plain words; a link keeps the row's own
 * text colour and puts the accent in its underline, so §10.3's rule about
 * text on --accent-soft holds. */
.list-editor-modal .le-text.is-editing code { font-family: var(--font-mono); }
.list-editor-modal .le-text.is-editing a {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--accent);
  pointer-events: none;
}
/* The ring stays where the rest state puts it: the cell is the row's focus
 * holder and the field is not. */
.list-editor-modal .le-row.is-editing .le-cell {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset-inset);
}

@media (max-width: 520px) {
  /* No tap delay, and no double-tap zoom answering the edit gesture. */
  .list-editor-modal .le-cell { touch-action: manipulation; }
  /* E3: foundations §4.4 — below 16 px iOS zooms the fixed window on
   * focus. The row keeps its 44 px floor. */
  .list-editor-modal .le-text.is-editing { font-size: 16px; }
  /* The keyboard shrinks no layout viewport this window can read, so the
   * scroller reserves its inset and the edited row stops above it when it
   * is scrolled into view (--m-kb, static/js/mobile.js:434). */
  .list-editor-modal .le-body.is-editing .le-scroll {
    padding-bottom: calc(var(--space-3) + var(--m-kb, 0px));
  }
  .list-editor-modal .le-body.is-editing .le-row.is-editing {
    scroll-margin-bottom: calc(var(--space-3) + var(--m-kb, 0px));
  }
}
```

`strong` and `em` need no rule: the user agent's weight and style are the note's own, and a
second declaration would only invite a third. `code` gets mono and nothing else: the note's own
chip (`style.css:3700-3706` — `--code-bg`, inline padding, a 4 px radius) would overhang a
21 px line box, and a rounded block inside one row is the pill §2.4 already refuses for the
row's meta.

The edit's phone block is a second query rather than part of step 10, so it lands after the
base rule it adjusts and a reader never has to reason about cascade order inside one block.

### 10.3 Rules that must not move

- The body never holds the toolbar, and the bar never holds Cancel or Apply.
- Never two scrollers: `.le-scroll` is the only one.
- Never a second live region: the footer status is the only one.
- Never a fixed row height: the row is the line box plus 3 px padding, so it follows
  `--font-scale` (`guidelines.md` §2.1, `typography.md` §5.2). No in-row mark may be taller
  than the line box; that is why `--le-hit` is 18 and not `--control-h-sm`.
- Never a per-row tab stop beyond the cell.
- Never a formatting control: no bold, italic, code or link button, no floating bubble over the
  field, no slash menu. §2.7 renders formatting and never authors it.
- Never a fill, border, radius or shadow on the edit field, and never a control height on it:
  the field is the row's own line box.
- Never a block element, a nested list, a card or a checkbox inside the field: it holds the
  item's own inline run and nothing else — the breaks and images the item already has, and no
  new one (§2.7).
- Never a text colour on `--accent-soft` other than the row's own `--text-primary` and the
  muted meta (`typography.md` §7.2). The edit's links keep the row's colour and put the accent
  in their underline for exactly this reason.
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

Three, all phone-only. Two are coarse-pointer floors, and one is the 16 px field. Desktop rest
state is untouched.

| # | Exception | Why | Implementation | Tests |
|---|---|---|---|---|
| **E1** | At ≤520 the bar tools are 44 × 44 instead of 32 | `foundations.md` §10.4's 44 px coarse-pointer floor; the table's precedent (`table-editor.md` E1) | the 520 block in §10.2 step 10; the bar stays 57 = 6 + 44 + 6 + 1 | `tests/browser/test_list_editor_browser.js` at 390 |
| **E2** | At ≤520 the row is 44 px high and the in-row marks gain its height but keep their widths | eight 44 × 44 marks would eat most of a 358 px measure; the row is the target, as the table treats its cells (`table-editor.md` §9.4) | `min-height: var(--control-h-touch)` on the cell, `height` on the selection and done cells | `tests/browser/test_list_editor_browser.js` at 390 |
| **E3** | At ≤520 the edit field's type is a fixed 16 px instead of `--text-body`'s 14 | below 16 px iOS zooms the viewport when a `contenteditable` takes focus, which would zoom a fixed, full-screen window (`foundations.md` §4.4, `style.css:7381`); `table-editor.md` P5 records the same problem there | `font-size: 16px` on `.le-text.is-editing` in the 520 block of §10.2 step 11; the row keeps its 44 px floor and grows by 24 px lines | `tests/browser/test_list_editor_browser.js` at 390 |

E3 is a visual delta with a number, so it is recorded here rather than implied: the field's
line box goes from 21 to 24 px, and the row from 44 to 48 only when the prose wraps to a second
line. Nothing else on the phone moves. This is the one 16 px literal this window adds; it is
`foundations.md` §4.4's own value, not a new rung.

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
| AC20 | No new colour, font family, breakpoint, dependency or shadow | `static/css/style.css` | The diff adds no hex, no font family, no breakpoint and no shadow; the only new tokens are the six numbers in §10.1; the only new literals are the `Item text` placeholder string and E3's 16 px phone field size; the mockup opens offline. `docs/ui/list-editor-mockup.html` |
| AC21 | The mockup is self-contained and draws the named states | `docs/ui/list-editor-mockup.html` | Opens offline with zero network requests; scripting off still shows every toolbar; the toggle re-colours every board. Fourteen boards: default open, collapsed parent, stale, empty, 390 phone, row anatomy, mixed-level selection with a locked descendant, 720, single item, failed restore, 120-row list, in-place edit, one row being dragged, a selected block being dragged. Strings present verbatim: `14 items · 0 selected · 2 done`, `9 items · 0 selected · 2 done`, `14 items · 5 selected · 2 done`, `6 items · 3 selected · 1 done`, `5 items · 0 selected · 1 done`, `1 item · 0 selected · 0 done`, `120 items · 0 selected · 0 done`, `12 items · 3 selected · 2 done`, `12 items · 7 selected · 2 done`, `This list changed outside the window. Nothing was applied.`, `No items left. Apply removes the list.`, `0 items · 0 selected · 0 done — Deleted 2 items. The list is empty.`, `The saved state could not be restored`, `To top needs the selected items to share one level.`, `The selected items are already at the top.`, `The selected items are already at the bottom.`, `Esc cancels` |
| AC22 | To top / To bottom refuse at the edge with their own reason | `static/js/list-editor.js` | A single-item list disables `To top` with `The selected items are already at the top.` and `To bottom` with `The selected items are already at the bottom.`; a single-level selection already first reports the top sentence, not the level sentence; activating either writes it. `tests/dom/test_dom.js` |
| AC23 | A drag moves one row, or the selected block, with every subtree | `static/js/list-editor.js` | `_moveBlocks([id], before)` on a parent lands the parent and every descendant together, in order, at one slot; a childless row lands alone; a collapsed parent carries the rows it hides; a second root in the same parent lands with it as one run, unselected rows between the roots travelling inside the run; the one-row `_moveBlock(id, before)` still returns the same result. `tests/dom/test_dom.js` |
| AC24 | A drag stays in the row's level and never re-parents | `static/js/list-editor.js` | Model (`_moveBlock`): a target in another level and a target inside the row's own subtree are both refused, and no refusal changes a depth. Pointer: hovering a nested child draws no line, the line sits on the dragged row's own level, and no drag changes a depth. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC25 | A no-op drop changes nothing | `static/js/list-editor.js` | A release on the row's or the block's current position, inside any dragged subtree, inside the block's own span, or outside its level returns `{moved: false}`, leaves the row order identical, adds no history entry and writes no result to the status. `tests/dom/test_dom.js` |
| AC26 | One drag is one history step | `static/js/list-editor.js` | Model: the `_moveBlocks` seam itself adds no history entry, repaints nothing, and a verb after it reads the moved model. Pointer: a real drop adds exactly one `_history()` entry however many rows the dragged block carries, the window Undo restores the order, and the dropped roots are the selection, the anchor and the focused cell. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC27 | `Esc`, `pointercancel` and a close abort a drag | `static/js/list-editor.js` | Three browser checks: `Esc` mid-drag cancels the drag and keeps the window open, leaving no `.le-drop-line`, no `.le-row.is-dragging`, no `.le-body.is-dragging`, no `body.nb-le-drag` and no history entry; `pointercancel` mid-drag ends the drag with no line, no dim and no step; a close mid-drag removes the line, so the next open starts clean. `tests/browser/test_list_editor_browser.js` |
| AC28 | The stale state refuses a drag | `static/js/list-editor.js` | Model: `_moveBlock` returns `{moved: false, position: -1}` on a stale window and leaves the order alone. Pointer: in stale, a real press and move over a row start no drag — no `.le-drop-line`, no `.is-dragging`, no `_history()` entry, no model change. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC29 | Touch never drags | `static/js/list-editor.js` | One browser check with synthetic touch pointer events: a `pointerType === "touch"` press and move over a row start no drag and draw no line, so a touch still pans and the toolbar stays the reorder path. `tests/browser/test_list_editor_browser.js` |
| AC30 | The click after a drop does not re-select or close | `static/js/list-editor.js` | The `click` that follows a drag's `pointerup` is swallowed: on a row the selection stays the dragged roots and the plain-click path does not run a second time; on the backdrop the window stays open. A later pointer press disarms the guard, so it never eats a real button press. `tests/browser/test_list_editor_browser.js` |
| AC31 | A double-press edits one row's prose at every width, and nothing else starts an edit | `static/js/list-editor.js` | Model (jsdom has no `PointerEvent`): `_editRow(id)` gives that row a `.le-text.is-editing` with `contenteditable="true"`, the textbox attributes of AC36, and changes no other row; on a refused item it writes the sentence and opens no field; `_editing()` names the row and is null after `_commitEdit`/`_abortEdit`; a stale window opens no field. Pointer (Chromium): two presses within 350 ms and 8 px on the same `.le-cell` open the field for `mouse`, `pen` and `touch` at 1280 and at 390; a pair on `.le-chev` toggles the collapse, on `.le-done` toggles done, on `.le-meta` does nothing, each with no field; with `ctrlKey`, `metaKey` or `shiftKey` on either press the selection gesture runs and no field appears; two presses more than 350 ms or 8 px apart start no field; the pair draws no `.le-drop-line` and adds no history entry. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC32 | `F2` edits any row; `Enter` never edits | `static/js/list-editor.js` | Model (jsdom): `F2` on a parent and on a leaf both start the field; `Enter` on a parent flips `aria-expanded` and starts none; `Enter` on a leaf changes nothing and starts none. Model: `tests/dom/test_dom.js` |
| AC33 | The field shows the prose, never the source: inline formatting, the item's own breaks and images | `static/js/list-editor.js` | Model (jsdom): an item whose `<li>` holds `Ship <strong>v1.4.0</strong> — <code>tag</code> <em>now</em> <a href="/x">checklist</a>`, then an `<img>`, then one `<br>` and more text: the field's content is exactly that prose with `strong`, `code`, `em`, `a`, the `img` and the `br`, and contains no `ul`, `input` or `[contenteditable="false"]` card; the same row at rest labels as the flat text with no markup; a commit with no change writes nothing, so the `img` and the `br` stay where they were; and a field edit that deletes the `img` leaves it out of the item after Apply. Model: `tests/dom/test_dom.js` |
| AC34 | One commit is one step; no change and no cancel are no step; Apply writes the prose once | `static/js/list-editor.js` | Model (jsdom): type into the field and press `Enter` — the history depth grows by one and the status ends `— Edited 1 item`; a second `Enter` with no change leaves the depth and the status alone; `Esc` after typing leaves the depth alone, restores the old label and does not write the status; Apply after a commit makes exactly one POST, the live `<li>`'s prose is the new text with its inline nodes, and its nested `<ul>`, its checkbox (with its `checked` property) and its `<img>` are unchanged; an edit followed by Undo closes with no POST. Model: `tests/dom/test_dom.js`; the single note-level undo step is AC15's, in the browser suite |
| AC35 | The keys inside the field are the field's, and the named window keys stay the window's | `static/js/list-editor.js` | Model (jsdom): with the field focused, `Space`, `Delete`, `Ctrl/Cmd+A` and `Ctrl/Cmd+Z` select nothing, delete no row, select no row and leave the history depth alone; `Tab` commits without indenting and the next `Tab` indents; `Shift+Tab` commits without outdenting; `Ctrl/Cmd+B` inserts nothing; `Shift+Enter` inserts no break; `Enter` commits; `Esc` cancels and a second `Esc` closes the window. Model: `tests/dom/test_dom.js` |
| AC36 | The edit exposes one text box and one live region, and churns no grid attribute | `static/js/list-editor.js` | Model (jsdom): on entry the field is `role="textbox"`, `aria-label="Item text"`, `aria-multiline="false"`, `tabindex="-1"` and `contenteditable="true"`; the treegrid's `aria-rowcount` and `aria-multiselectable` and the row's `aria-level`, `aria-selected` and `aria-expanded` are identical before entry, after commit and after cancel; the overlay holds exactly one `[role="status"]` and entry and cancel never write it. Model: `tests/dom/test_dom.js` |
| AC37 | The edit's paint is the prose, the caret and the ring, and the row grows by whole lines | `static/css/style.css`, `static/js/list-editor.js` | Pointer (Chromium, 1280): the field computes `text-overflow: clip` and `white-space: normal` and has no `title`; a prose that wraps to two lines gives a 48 px row (27 + one 21 px line) with the marks still centred and the guides stretched; the cell's ring is `--focus-ring` at `--focus-offset-inset`; the caret is at the press point in a long item and at the end for `F2`; the row's face before and after entry is identical. Pointer: `tests/browser/test_list_editor_browser.js` |
| AC38 | The phone edits by double-press at a 16 px field, clear of the keyboard | `static/css/style.css`, `static/js/list-editor.js` | Pointer (Chromium, 390, with `--m-kb` forced to a keyboard-sized `320px`): the field computes `font-size: 16px`; the row is at least 44 px and 48 px when the prose wraps; `.le-cell` computes `touch-action: manipulation`; two presses within 350 ms and 8 px start the edit while one press only selects; `.le-body.is-editing .le-scroll` computes a bottom padding of `var(--space-3)` + 320 px and the field's bottom edge sits above `innerHeight - 320`; a `visualViewport` resize while the edit is live scrolls the field back into view. Pointer: `tests/browser/test_list_editor_browser.js` |
| AC39 | Every exit commits or discards exactly once | `static/js/list-editor.js` | Model (jsdom): `_commitEdit` then a verb seam sees the new text and adds one step; Cancel and `_abortEdit` discard and write nothing; a `hybrid:rerendered` while editing discards, restores the label and moves focus to `#list-editor-cancel`. Pointer (Chromium): a press on another row commits first and then selects that row; a press on a toolbar tool commits first and then runs the verb; a history-button press commits and then undoes that commit; a blur commits and focus returns to the row's cell. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC40 | An item whose text is split, or whose markup the field cannot keep, refuses the field with one sentence | `static/js/list-editor.js` | Model (jsdom): an item with text after a nested list, an item with two paragraphs, an item with text after a card, and an item holding a wrapper around a pasted checkbox each start no field through `_editRow` (and therefore on `F2`), and the status ends `— Editing needs one piece of text the window can keep.`; the history depth, the model and the row's label are unchanged; an item with text **before** a nested list, and an item with an image beside its text, do start the field. Model: `tests/dom/test_dom.js` |
| AC41 | A block of selected roots drags as one span | `static/js/list-editor.js` | Model: `_moveBlocks([a, c], before)` in one parent moves the span from `a` to the end of `c`'s subtree, so the unselected rows between the roots travel inside it; non-contiguous roots gather; the argument order `[c, a]` gives the same result; a block already at the slot, and a `beforeRowId` on an unselected row between the roots, return `{moved: false}` with the order untouched. Pointer: a press on a selected root keeps the selection, 4 px of travel dims every row of the span, the drop line never appears over the block or between its roots, and the drop reads `Moved 2 items` with one history step. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC42 | A press resolves the block, and a click still collapses | `static/js/list-editor.js` | Pointer: a plain press on an unselected row selects it alone and drags one row; a plain press on a selected root keeps the selection and drags the block; a plain press on a locked descendant selects that row alone and drags it alone; a press and release with no travel on a selected root leaves exactly that row selected; a `Ctrl`/`Cmd` or `Shift` press starts no drag; after a drop the moved roots are the selection, the anchor is the pressed root and the focused cell is the pressed root. `tests/browser/test_list_editor_browser.js` |
| AC43 | A mixed-level selection refuses the drag with one sentence | `static/js/list-editor.js` | Model: `_moveBlocks` with roots in two parents returns `{moved: false}`, leaves the order and the depths untouched and adds no history entry. Pointer: with roots in two parents, a press and 4 px of travel start no drag — no `.le-drop-line`, no `.is-dragging`, no `body.nb-le-drag`, no step, the selection unchanged — and the status reads `Dragging needs the selected items to share one level.`. Model: `tests/dom/test_dom.js`; pointer: `tests/browser/test_list_editor_browser.js` |
| AC44 | A press that starts a block drag commits a live edit first | `static/js/list-editor.js` | Pointer: with an edit open on one selected root, a press on another selected root commits the text (one step, `Edited 1 item`), then arms the block drag; the drop adds its own step and the moved roots carry the edited text; Cancel after the drag discards both. `tests/browser/test_list_editor_browser.js` |

---

## 12. Proposals, not applied

P1 is no longer a proposal: **drag to reorder shipped** in §3.2, for one row and for a
selection. The cost paid was a pointer layer in this module (a 4 px threshold, pointer
capture on `#list-editor-grid`, a press that defers the selection collapse until the click,
a hit test over the visible remaining rows of one level, an auto-scroll loop at the
scroller's edges) plus one pure model seam, `NB.listEditor._moveBlocks(rowIds, beforeRowId)`
(`_moveBlock` remains the one-row wrapper). A proxy row was not needed, and a drag never
re-parents: every selected root with its subtree, inside its own level, or no drag at all.

P3 is no longer a proposal either: **editing one item's text in place shipped** in §2.7. The
cost paid is the one P3 predicted, and it was paid down to three things: a prose field on each
row of the model and in every history snapshot; one commit seam, so a commit is one step and
the keystrokes between commits are none; and one field state — one `.is-editing` rule, one
rule for the cell's ring, one for `code` and one for `a` — plus the chord release, because
this body had claimed every key with `ownsKey: () => true` and had to give the field's keys
back. A text model, a caret and a write path all exist now, and
the boundary held: no formatting controls, no Markdown source, no new break, no nested
content, and no box around the field. A rich-text editor was not needed and is not promised.

| # | Proposal | Why | Cost |
|---|---|---|---|
| P2 | Make the nested / hidden counts outline pills instead of trailing meta | The task brief's word is "chip" | A second shape in the row; §2.1 says trailing meta |
| P4 | Virtualise a very long tree, above a measured threshold | The body renders every row; 100 is the budget, 1000 is not supported | A measured threshold first; today's budget is documented in §2.5 |
| P5 | Convert a plain item into a task item ("Make task") | It is the natural inverse of deleting a box | It edits the item's marker, which is not the prose §2.7 owns; the note's own Task button owns that |
| P6 | Give a failure an error treatment (`--danger`, an icon) | `The saved state could not be restored` looks like a position message | Follows `edit-window.md` P4 and `table-editor.md` P4 |
| P7 | Make the done circle a tab stop | It is pointer-only today, with `Shift+Space` and the toolbar as the keyboard path | A second tab stop per task row |
| P8 | Expand all / collapse all in the toolbar | A 100-row list with 20 parents takes 20 presses | Two more tools; a sixth group |
| P9 | Persist collapse state across opens | Users who collapse the same branches every time | A stored key per container, and a stale-key problem |
| P10 | Announce the level in the status after a move (`Moved 3 items to level 2`) | The result names the verb, not where things landed | Wording only; the counts line would grow |
| P11 | A filter box at the top of the body (`Filter items…`), hiding non-matching rows as a view filter | A 100-row list is hard to scan; the tree already has a view filter in collapse | A second field in the chrome, an empty-filter state, and the question of what a verb does while filtered |

---

## 13. What not to build

- **No formatting controls and no source view.** §2.7 renders `strong`, `em`, `code` and `a`
  and authors none of them: no bold, italic, code or link button, no floating bubble, no
  Markdown source, no `Ctrl/Cmd+B/I/U`, no rich-text paste. The note's own bars are where
  formatting is made.
- **No new line in an item.** `Enter` commits and `Shift+Enter` is swallowed, so the field
  creates no break: it shows the breaks and images the item already has. Nested lists, the
  checkbox, plugin cards and the marker are never in the field.
- **No promise that structure is protected.** An image in the field is text being edited: it
  can be deleted there, and Apply deletes it. The window adds words; it does not guard what it
  displays (§2.7).
- **No partial edit and no lossy edit.** An item whose text is split by other content, or whose
  inline markup the field cannot write back unchanged, is refused with one sentence rather
  than edited in part or flattened; a commit must never write over what the field did not
  show (§2.7).
- **No second surface for text.** The field is a row's own line box — no input, no textarea, no
  floating editor, no rename dialog, no second toolbar.
- **No second selection control.** The row selects; the box is a mark; the done circle is a
  state, not a selection.
- **No rubber band, no marquee, no "select all on click".** The gestures are the ones in
  §3.2 — click, `Ctrl/Cmd`+click, `Shift`+click, and a vertical press-and-drag on one row or
  on a selected block — and nothing else.
- **No proxy row, no drop between containers, no partial block.** A drag is one row with its
  subtree, or the selected roots with theirs (§3.2); the pointer follows the rows, it does not
  lift a chip, and a selection that spans levels does not start a drag at all.
- **No re-parenting move, by verb or by drag.** Up, Down, To top, To bottom and a drag stay
  inside the parent level; Indent and Outdent are the only level changes.
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
| U2 | Moves | Up/Down move every root group one slot inside its own parent, two groups sharing a parent moving as one block; no re-parenting. To top/To bottom need one shared parent. Six refusals in §4.3, including the edge pair `The selected items are already at the top.` / `… already at the bottom.` A pointer drag (§3.2) is the same move for one row or for the selected block — every root that shares the pressed row's parent, each with its subtree, gathered in document order — always inside its own level, one history step per drop and none for a no-op; a mixed-level selection refuses the drag with `Dragging needs the selected items to share one level.` |
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
| U18 | Editing an item's text | `F2` on any row, or a double-press at any width (two presses within 350 ms and 8 px, mouse, pen or touch); `Enter` never edits. The field is the row's own line box showing the prose with `strong`, `em`, `code`, `a`, the item's own breaks and images; nested lists, the checkbox, plugin cards and the marker are outside it. One commit is one window step and one `Edited 1 item`; a no-op commit, a cancel and the entry are silent. An item whose text is split by other content, or whose inline markup the field cannot write back unchanged, is refused with `Editing needs one piece of text the window can keep.` `Esc` cancels the edit before the drag and before the window. Apply writes the prose once and nothing else in the item; a 16 px field at ≤520 (E3) (§2.7) |

Two cross-doc notes for the owners, recorded here because this document cannot edit them:
`docs/ui/edit-window.md:424` still describes Apply as a signature comparison and a rebuild
into reassembled wrappers — U6 replaces that. `docs/ui/hybrid-editing.md` §4.7.2 still says
there is no separate list editor; the settled decision overrides it.

