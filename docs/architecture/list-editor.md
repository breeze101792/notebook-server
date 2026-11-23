# List editor modal (hybrid mode) — implementation blueprint

Status: blueprint (pre-implementation, revised 2026-11-21 after adversarial
review). The sibling blueprint is [table-editor.md](table-editor.md)
(shipped); the shared chrome contract is [../ui/edit-window.md](../ui/edit-window.md).
One new file (`static/js/list-editor.js`) plus small edits, no frameworks, no
new deps. Every `file:line` below was verified at this revision.

Feature (settled): right-click a list item in hybrid mode → **"Edit list…"**
opens a modal that manages one list container — `NB.hybrid.listContainer(item)`
(`hybrid.js:9472-9488`) — with multi-select, block move, indent/outdent, sort,
done-to-bottom, mark done/open, delete. Apply writes the note; Cancel writes
nothing. Apply **mutates the live container in place**: the planner computes a
complete plan without touching the DOM, then `commitPlan(plan)` reorders the
live `<li>` nodes and creates/removes wrapper nodes **inside the live
container**. No copy of the container is built, nothing is spliced in with
`replaceWith`: wrapper identity (`start`/`reversed`/`type` and every authored
attribute) is preserved for free, the container stays connected (focus and
`contains()` stay valid), and one Apply = one note undo step.

```mermaid
flow LR
  H[hybrid.js List submenu<br/>Edit list...] --> M[NB.listEditor.open li]
  M --> S[flat row model<br/>container's li, doc order]
  S --> G[#list-editor-grid<br/>treegrid rows, own text]
  G -->|verb| V[move / indent / sort<br/>done / delete]
  V --> K[rebuildPlan — pure<br/>wrappers, rowOrder, done, empty]
  K -->|no-op| X[close, nothing written]
  K -->|Apply| F[flushPendingSnapshot]
  F --> B[commitPlan — move the live li nodes,<br/>create/remove wrappers in the live container]
  B --> C[onContentChange]
  C --> X2[close + caret into list]
```

## 0. Corrections to the brief (verified against the code)

The brief's citations are wrong on five points; the mechanisms are right. The
design below uses the verified numbers.

1. **`tests/dom/test_dom.js:12407` is not the pinned cache version.** The
   cache assertion is `:12405-12406` and it is a **floor**, not a pin:
   `>= notebook-v26` (`:12406`). A `CACHE` bump therefore requires **no** edit
   there — the wiring guards to mirror are `:12395-12408`
   (`:12407-12408` is the "module + overlay loaded" check). The same floors are
   at `:22779` (≥ v23) and `:42387` (≥ v23); the frontend.md claim of two
   literal pins (`frontend.md:396-398`) is stale.
2. **`run_all.js` does not pick up suites automatically.** `SUITES` is an
   explicit array (`tests/browser/run_all.js:15-31`); the table-editor doc's
   "run_all.js picks up every suite" is wrong. The new browser suite needs one
   line there (port 5093 is free) and one `package.json` script
   (`package.json:23` is the table-editor precedent). Without them the suite
   never runs under `test:browser:all`. These two files are added to §7.
3. **`table-editor.js:2040-2048` does not implement `focusTableCaret`.** The
   function is `table-editor.js:2063-2075`; `:2041-2050` is `open()`'s
   first-cell focus. The close-time fallback that motivates it is
   `table-editor.js:2084-2092`.
4. **`hybrid.js:8149-8160` is not the re-render.** The exit path re-renders
   through `viewer.activate` at `hybrid.js:8157-8168`; the `hybrid:exited`
   emit is `:8178`, and `commitForTabSwitch` reaches the same `exit(false)`
   at `:8677`, `:8689`, `:8699`.
5. **The "source-edit safety net" is `rebuildFromSaved`, not `:10630-10636`.**
   Those lines are the same-bytes echo guard inside the external-change
   handler. The four in-session `renderMarkdown` callers are: external change
   `hybrid.js:10649`, AI patch `refreshFromContent` `:10672`, the I10 mismatch
   reconciliation `rebuildFromSaved` `:8358`, and draft recovery `:8710`.
   One `hybrid:rerendered` emit covers these four — and **only** these: the
   exit/tab-switch re-render (correction 4) goes through `viewer.activate`
   and never enters `renderMarkdown`, so the modal needs a second
   invalidation channel, `hybrid:exited` (§5 — `list-edit.js:631-632`
   subscribes the same pair).

Also recorded: the `hybrid-editing.md` §4.7.2 sentence "There is no popup
window and no separate list editor" has already been amended in the tree
(`hybrid-editing.md:661-664`) to point at this window; nothing further is owed
there.

## 1. Module and public surface

`static/js/list-editor.js`, IIFE, `NB.listEditor`, wired from static markup in
`templates/index.html` (§7). Same lazy-deref discipline as the table
(`table-editor.md` §1): callers write `NB.listEditor && NB.listEditor.open(li)`
inside handlers, so load order cannot break either side.

- `open(item)` — `item` is the right-clicked (or caret) `<li>`. Resolves
  `container = NB.hybrid.listContainer(item)`; returns `false` when it cannot
  open at all: not in hybrid (`NB.hybrid.isActive()`, `hybrid.js:504`), no
  container, the container is not in `#viewer-content` (the
  `table-editor.js:2015-2017` guard shape), no write permission
  (`NB.auth.canWrite()`, `auth.js:226-229` — default-deny until `/api/auth`
  answers), or the container's shape fails the P0 validation (§3). **There is
  no blocked/read-only open**: the shape refusal is a plain `false`, and the
  trade is accepted — hiding the menu entry instead would run the full
  validation walk on every context-menu build. The viewer-role case is
  doubly covered: hybrid mode itself is unreachable without `canWrite`
  (`hybrid.js:10567-10568` hides the button), and `open()` still refuses.
  Idempotent like the table's (`table-editor.js:2019`: an open window closes
  first).
- `close(opts)` — Cancel semantics: discard the model, hide the overlay,
  `NB.dialog.close`, re-enable `NB.listEdit`. Idempotent
  (`table-editor.js:2077-2100` shape). `opts.focusList` forces the caret into
  the note (§5).
- `isOpen()`, `isStale()` — the `table-editor.js:2102-2104` shape;
  **stale is the only read-only state** (§5). There is no `isBlocked()`.
- `apply`, `cancel` — public names on the same functions exported as
  `_apply` / `_cancel` (the harness names, `table-editor.js:2204-2205`);
  two names, one function, zero duplication.
- Model verbs (toolbar + test seams; all operate on the selection's roots
  (§4), all return `boolean` = a change happened):
  `moveRows(dir)` (`"up"|"down"`), `moveRowsToEdge(edge)`
  (`"top"|"bottom"`), `indentRows()`, `outdentRows()`, `sortRows(dir)`
  (`"asc"|"desc"` — one verb per toolbar button, no direction state),
  `doneToBottom()`,
  `markDone(done)` (`done` boolean), `deleteRows()`,
  `toggleCollapse(id)` (the chevron path).
- Test seams the codebase expects:
  `getState()` (the live model, §2), `rebuildPlan()` (the pure planner: the
  complete commit-and-sign payload, §3 — never mutates), `_signature()` →
  `{open, current}` (§5), `_select(ids)` (set the selection directly) and
  `_select({anchor, focus, extend})` (anchor + focus, optionally extending
  like Shift+click) — the two selection seams, §4 — `_moveBlocks(rowIds,
  beforeRowId)` (the drag's model step, §4 Drag reordering: moves the span
  from the first root to the last root's subtree inside its own level, returns
  `{moved, position, count}`, refuses a stale window and a mixed level,
  repaints nothing and captures no history) with `_moveBlock(rowId,
  beforeRowId)` as its one-row wrapper, `overlayEl()`,
  `_undo()`, `_redo()`, `_history()` → `{mode:"stack", depth, index, canUndo,
  canRedo}` (`table-editor.js:2206-2211`), plus the text-edit seams
  (§4 Item text editing): `editRow(id)` (start an edit, public like the
  verbs), `_commitEdit()` → boolean (commit the live edit), `_editing()`
  → `{rowId} | null`, `_sanitizeRun(html)` → string (the pure
  sanitizer — the security boundary gets a direct seam).
- History attaches once in `wire()` through `NB.editWindow.attach`
  (`edit-window.js:48-66`) in stack mode, prefix `"list-editor"`,
  `ownsKey: () => !drag && !editing` (during a drag the engine must not
  touch the model, and during a row's text edit the browser's native
  span undo owns the chord — §4 Item text editing), `enabled: () =>
  !!state && !stale` (`table-editor.js:2119-2128`).

The module header comment states the ordering contract and the two invariants
that surprise: a no-op Apply writes nothing (the structural signature, not a
`changed` flag), and Apply mutates the live container in place — the
`<ul>/<ol>` wrapper nodes are never rebuilt from scratch, so `start` (the one
attribute turndown re-reads, `vendor/turndown.browser.js:152`) cannot be lost
by the commit itself. A third surprise rides the first: an item's edited text
is part of that signature (§4 Item text editing), so a text-only change
writes and an undone one does not.

## 2. Data model

Built in `open()` from the live container, in document order. No rows are ever
created or content-edited by this module; verbs reorder, re-depth, toggle
`done`, or delete — **in the model only**. The live DOM is untouched from
`open()` until `commitPlan()` at Apply, which is why Apply can compare a
signature instead of rolling a change flag through every verb.

```js
row = {
  node,        // the live <li>; moved by commitPlan, never copied (I1/I2 of hybrid-editing.md)
  id,          // integer, document order at open; from a WeakMap keyed by node
  depth,       // NB.hybrid.listItemDepth(li, container)  hybrid.js:9497-9505
  parentId,    // id of the ancestor <li> at depth-1, null at depth 0 (derived)
  levelIndex,  // 0-based among same-parent siblings (derived)
  sourceTag,   // the tag ("UL"/"OL") of the row's parent wrapper at open (captured
               // once, at open — never read from parentNode afterwards)
  done,        // NB.hybrid.taskCheckboxOf(li)?.checked ?? null  :3486-3495
               // null = not a task item; the row renders no done toggle
  collapsible, // the row has at least one child row (a subtree exists)
  collapsed,   // UI state; hidden rows stay in the model and the snapshots
  ownText,     // the item's OWN content — see below; immutable for the session
}
wrapper = { node, id, parentId /* row id or null for the container */,
            tag, attrs /* attribute string for the signature */ }
```

- **Row filter (the boundary-row rule).** Rows are
  `container.querySelectorAll("li")` **filtered by
  `NB.hybrid.listContainer(li) === container`** — never the raw
  `NB.hybrid.listItems()` result (`hybrid.js:9491-9493` returns every
  descendant `li`). An `<li>` inside a `<blockquote>` or a `<td>` nested
  within a row is not a row: `listContainer` stops at BLOCKQUOTE/TD/TH
  (`hybrid.js:9482`), so the filter excludes it, and it travels untouched with
  its parent row's `<li>` when the row moves. `listItemDepth` alone would
  misreport it (`hybrid.js:9497-9505` counts only UL/OL ancestors), which is
  exactly why the filter is the container check. The `wrapper` map holds only
  the container's own list levels; a quoted or in-cell list inside a row is
  never a wrapper, never claimed, and never removed.
- **`ownText` (row label and sort key).** From a detached throwaway copy of
  the `<li>` used for text extraction only: strip nested `ul`/`ol` (a quoted
  list's items included — the row's label is its own prose, not the quote's),
  every `input`, every `[contenteditable="false"]` chrome node (plugin cards:
  an item holding a Mermaid diagram labels as its own text, never the diagram
  source), replace each `br` with one space, collapse whitespace runs, drop
  `\u200B` (the empty-item placeholder, `hybrid.js:207`, `:3384`), trim.
  This is deliberately **wider than `list-edit.js:339-346`** (`itemSummary`
  strips `ul`/`ol`/`input` only); the chrome-node strip is what keeps a
  plugin-card item readable. Never `li.textContent`: a nested subtree's text
  would pollute every label and sort key. Empty → the muted "(empty item)"
  label (`list-edit.js:345` spelling). Inline markup inside the item (bold,
  code, links, **wikilinks**) contributes its text here and its nodes are
  never touched by the verbs — a commit replaces only an edited row's run
  (§4 Item text editing), so a wikilink survives Apply because its `<a>`
  travels inside the moved `<li>` (§8 pins it), and survives a **text
  commit** of its row because the sanitizer keeps the wikilink flags
  (§4). The label shown — and the sort key, which reads it — is this
  value, except while a row's text edit is dirty, when the label is the
  strip of the edited HTML; `ownText` itself is captured at open, never
  changes, and the live `<li>` it reads is untouched until the write.
- **Session chrome is never part of the model, and never stripped by the
  modal.** The marked caret `<br>` (`data-hybrid-caret-br`, `hybrid.js:85`,
  added by `focusListItem`/`addMeasureLineBox` for empty items,
  `hybrid.js:9661-9665`, `:9679-9687`) and the ZWS placeholder are editing
  surface, not note content: the chrome walker removes every caret `<br>` at
  serialization (`hybrid.js:1479`, reached through `prepareTurndownClone`,
  `hybrid.js:833-835`), so they can never reach the note. The modal must
  leave both in place — an empty item keeps its line box and its rendered
  marker through open, verbs and Apply; only `ownText` ignores them. The
  one exception is a **text commit** of the item: the chrome sits inside
  the run extent, so the write replaces it, and it re-plants the ZWS
  when the result is empty (§4 Item text editing).
- **Ids.** A `WeakMap` `rowIdByNode` assigns `0, 1, 2…` in document order at
  open; wrappers get a second `WeakMap`. **Ids, never node refs, go in
  snapshots** because (a) the history engine compares `snap === stack[index]`
  and needs a stable string (`edit-window.js:145`), (b) `sizeOf()` counts
  characters only for strings (`edit-window.js:112-114`), and (c) element
  references cannot survive `JSON.stringify`. Restore resolves id → record
  through `byId`, an id-indexed array of **all** records ever created.
  Deleted rows keep their records — and, until a commit excludes them,
  **their nodes stay in the live container**: deletion removes rows from the
  model only; `commitPlan` removes the nodes (§3). Undo of a delete therefore
  needs no node resurrection at all — the row's `<li>` never left the DOM.
- **Derived fields.** `parentId`/`levelIndex`/`collapsible` are recomputed by
  one O(n) pass after every verb and after every restore; they are not in the
  snapshot. `sourceTag` is not derived: it is captured once at open.
- **Model invariants** (asserted in `getState()`, enforced by §4):
  M1 rows are in document order and `depth[0] === 0` when rows exist;
  M2 `depth[i] ≤ depth[i-1] + 1` (the DFS rule — no orphans);
  M3 a row's descendants are the contiguous block that follows it until the
  next row at depth ≤ its depth;
  M4 `ownText` never changes; M5 `done ∈ {true, false, null}`;
  M6 every row holds at most one child wrapper, and that wrapper is its last
  element child (§3 P4). The verb semantics below keep M1-M3 true **by
  construction** — moves never change depth, indent/outdent are the shipped
  ±1 rules over whole roots with their subtrees, sort and done-to-bottom
  reorder whole subtree blocks within one level. There is no post-verb
  depth-clamping pass; a model that would violate M1-M3 is unreachable
  through the verbs rather than repaired after the fact.
- **Render and row budget.** Nothing is virtualised: a 100-row list is the
  comfortable target, a 300-row list works (§8 times it), 1000 rows in one
  container is unsupported, and **no row-count cap is enforced** — the window
  opens whatever it was given. The marker column width is measured **once per
  render** from the widest visible marker (hidden rows are not measured),
  capped at 3 glyphs, so a deep roman-numeral list cannot widen the slot past
  the cap. The measure is one pass of reads with the single `--le-mark-w`
  write after them — never an interleaved read/write per row, which is the
  layout-thrash bug class. Virtualisation stays out of scope
  (`docs/ui/list-editor.md` §2.5, P4).

## 3. Planner and commit

Two functions, strictly split: `rebuildPlan()` is pure (it reads the live DOM
and the model, touches nothing), `commitPlan(plan)` is the only code in the
module that mutates the note. One planner produces both the commit and the
signature inputs (§5), so the no-op comparison and the write can never
disagree.

### P0 — validation (at `open()`, re-run inside `rebuildPlan()`)

Every `<ul>/<ol>` from the container down holds only `<li>` element children
(whitespace text allowed; anything else fails — turndown numbers by
`Array.prototype.indexOf.call(parent.children, node)`,
`vendor/turndown.browser.js:153`, so a stray child corrupts every number);
no `<li>` holds more than one direct child list; every row's ancestor chain
to the container is only `li → (ul|ol) → li → …` (a row behind a `div` from
authored raw HTML would sit outside every plan level — refuse). At `open()`
a failure returns `false` (§1); at Apply a null plan is a status-line
refusal that closes nothing (§5).

### The plan — `rebuildPlan()` output (pure)

```js
plan = {
  wrappers: [ { key, tag, wrapperId, attrs, rowIds } ],  // document order, see below
  rowOrder,        // every row id in target document order (flat, model order)
  done,           // { [rowId]: 0 | 1 | null }  — the model's done values
  texts,          // { [rowId]: html } — the state.edits entries for rows in
                  // rowOrder (§4 Item text editing); the write-back payload
                  // and a signature input, never a change flag
  empty,          // rowOrder.length === 0
}
```

- `wrappers[0]` is the container itself: `key: "root"`, its real `wrapperId`,
  its `tag` and `attrs`, and the depth-0 `rowIds`. Every further entry is one
  child level: `key = "<depth>:<openingRowId>"` (the row that opens the
  level), `tag` = `UL`/`OL`, `wrapperId` = the id of the **opening row's own
  child wrapper at open** — the only wrapper ever claimed — or **`null` when
  the wrapper must be created** (a fresh wrapper carries no attributes, so
  `attrs` is `""`), `attrs` = the claimed wrapper's attribute string, and
  `rowIds` = that level's rows in order.
- The planner walks `rowOrder` with a stack of descriptors (the P3 walk,
  made pure — it claims by *reading* `row.querySelector(":scope > ul,
  :scope > ol")`, never by moving anything): a row at depth `d` following a
  row at depth `d-1` opens a level under it; a shallower row pops the stack
  back to its own level; M2 guarantees no gaps. **Level split:** a run
  interrupted by a shallower row simply ends; a later row at the same depth
  opens under *its* preceding row, claiming that row's own wrapper or
  creating one. **Merge:** rows that arrive from different original wrappers
  into one level share that level's wrapper — mixed `-`/`1.` nesting is
  legal and the marker follows the containing list, the same as a drag into
  an existing child list (`hybrid.js:9620`).
- **Source-tag rule.** A created wrapper takes its `tag` from the first row
  that will live in it — that row's `sourceTag` (§2, captured at open), the
  `moveListItem`/`indentListItem` convention (`hybrid.js:9617`, `:4680`).
  The planner reads `sourceTag` from the record, never from `parentNode`.
- `wrapperId: null` for a created wrapper can never equal an open-time id
  (they are WeakMap integers), and that is intended: creating a child list is
  a real structural change and must compare unequal against the open-time
  signature (§5). The reverse cycle — indent then outdent — makes the level
  disappear from the model entirely, so no wrapper is described and the
  signature still compares equal.

### `commitPlan(plan)` — the in-place mutation

All of it happens **inside the live container**; the container node is
neither copied nor replaced, so every `<ul>/<ol>` keeps its identity, its
`start`, its `reversed`, its `type`, and every authored attribute without
any code having to preserve them. (`reversed`/`type` live in the DOM only:
GFM cannot express them and turndown re-reads `start` alone
(`vendor/turndown.browser.js:152`), so a save drops them exactly as the
shipped surface would — the commit preserves the session DOM, never a save.)

1. **Delete pass.** Every row whose id is not in `rowOrder` (the deleted
   rows) has its node removed — the subtree, including nested quoted/in-cell
   lists and plugin cards, goes with it. Until this moment the deleted nodes
   had stayed in the live container (§2).
2. **Create pass.** For every descriptor with `wrapperId === null`: create
   `document.createElement(tag)` and append it to the opening row (from the
   `key`). Claimed wrappers are **never moved at all**: the claim rule takes
   the opening row's own child wrapper, which is already that row's child —
   the commit moves only `<li>` nodes; wrappers are claimed in place,
   created fresh under their opening row, or removed when emptied.
3. **Level passes.** For `d = 0, 1, 2, …`: for every wrapper of depth `d` in
   plan order, append its `rowIds`' nodes in order — the container for
   `d = 0`, the wrapper node above. `appendChild` moves each `<li>` out of
   wherever it sits into its planned wrapper; a row already in the right
   wrapper is simply re-appended (idempotent, order rebuilt). Stale
   whitespace text nodes may end up before the rows; harmless — turndown
   numbers by element children (`vendor/turndown.browser.js:153`).
   **Why levels outermost-first (the bug class: `appendChild` of a node into
   a wrapper inside its own subtree throws):** when level `d` appends row X,
   every row of depth `< d` has already left its open-time position for its
   planned one, so X — still at its open position — cannot be an ancestor of
   its target wrapper (that wrapper sits under its opening row, whose
   in-place ancestors are all placed, shallower rows up to the container
   itself, which no row contains). Processing rows in one flat model-order
   walk instead can reach the throw (outdent a row P out of X's subtree,
   move P above X, indent X under P — at open X was P's ancestor); the
   level order makes it structurally impossible. §8 pins the sandwich.
4. **Wrapper cleanup.** Every open-time wrapper that no descriptor claimed
   is now empty (all of its rows have been re-parented by the passes) and is
   removed — the shipped "a source list left empty is removed" rule
   (`hybrid.js:4671`, `:4684`, `moveListItem` `:9621`). Quoted/in-cell lists
   are not wrappers (§2) and are never touched.
5. **Text pass.** For every `plan.texts` entry, in `rowOrder` order:
   `writeRun(row, html)` — recompute the run extent from the live `<li>`
   with the same `runNodes` walk used at capture, remove those nodes,
   and insert the parsed fragment at the first removed node's position
   (§4 Item text editing). Deleted rows are absent from `texts`, so
   their edits die with the delete; an empty result plants one ZWS (the
   `addListPlaceholders` shape, `hybrid.js:204-207`).
6. **P4 assertion.** Every row with a child wrapper has it as its **last
   element child**: claimed wrappers were last at open (P0), created wrappers
   were just appended, nothing else is appended to a row — and the text
   pass inserts only inline nodes before the first boundary child, so
   it cannot displace a child list either. Turndown emits a
   block break instead of nesting when the child list is not last
   (`vendor/turndown.browser.js:133`); this is asserted in the commit, not
   repaired — after the text pass, so it validates the post-write shape.
7. **Done flags.** For each row whose plan `done` differs from its open-time
   value: `cb = taskCheckboxOf(row.node)`; `cb.checked = v`; then mirror the
   **attribute** — `v ? cb.setAttribute("checked", "") :
   cb.removeAttribute("checked")` (the spelling matches marked's own
   output). This runs inside the commit's try, before `onContentChange()`,
   so the debounced snapshot captures it; the mirror matters because
   `pushSnapshot` stores `innerHTML` (`hybrid.js:7435`) — the attribute —
   while the live authority is the property (`hybrid.js:1614-1645`).
8. **Empty model.** `plan.empty` → step 1 has removed every row node and
   step 4 every wrapper, so the commit is one line: `container.remove()`.
   The caret rule that follows is §5's; the removed container must
   not be reused as a focus target.

Apply wraps the whole commit in try/catch with a pre-mutation copy of
`viewerContentEl.innerHTML` as the rollback (restore it, leave the
note clean — `onContentChange` not called; the mechanism is
`restoreSnapshot`'s, `hybrid.js:7459` — and the restore **replaces the
container node**, so §5 follows it with `goStale()`: the window stays
open read-only over the re-rendered note, never stranded editable
over a dead container). See §5 for the exact order.

## 4. Operation semantics

### Selection (explicit set + anchor)

Selection is a **set of row ids plus an anchor id** — not a range between two
corners. A row is *selected* or not; the anchor is the row the last
selection gesture started from.

| Gesture | Effect |
| --- | --- |
| Click a row | selects it alone (anchor = it), clears the rest |
| Ctrl/Cmd+click a row | toggles it in the set (anchor = it) |
| Shift+click a row | extends: every **visible** row between the anchor and it joins the set (hidden rows of collapsed parents are not addressable by the pointer) |
| Space on the focused row | toggles it (its descendants follow the parent rule below) |
| Ctrl/Cmd+A | selects **all** rows, collapsed ones included |
| Ctrl/Cmd+Shift+A | clears the set |

**Parent selects its subtree, locked.** A selected parent's descendants are
selected **and locked**: their boxes are inert (`cursor: default`), a click or
Space on one does nothing, and deselecting the parent deselects them with
it. **Roots** = selected rows whose parent is not selected. Every structural
verb acts on roots (with an empty selection, the focused row is the sole
target). Counts in the footer report roots and locked descendants — what
the user sees. A refusal appends its reason to the status
(`docs/ui/list-editor.md` §4.3 owns the exact strings).

**Selection after a verb (stated once, binding everywhere).** The selection
follows row ids, never positions: after a move, sort or done-to-bottom the
same rows stay selected; after a delete the deleted ids leave the set (and
locked descendants with them); after a collapse the hidden rows keep their
membership (collapse is a view filter, never a model change); after a
history restore the snapshot's set and anchor come back (§6).

**After every verb:** recompute derived fields, repaint, and
`captureHistory("structural")` only when the verb returned `true`. A refused
verb writes its reason to the status line and changes nothing else — it
never captures and **never closes the window**; the same rule covers a null
plan at Apply (§5).

### Verbs

- **Move up/down** — the unit is a **run**: a maximal sequence of
  consecutive roots that share a parent. Each run moves **one slot within
  its own parent**: up moves it before its preceding sibling, down after
  its following sibling; runs in different parents move independently, in
  the same activation; subtree blocks travel with their run. **Depth never
  changes and nothing is re-parented** — a run moved past a shallower row
  never becomes that row's child; that outcome (the old flat-splice
  behaviour) is forbidden. Roots already at their edge are skipped and
  counted (`Moved 2 items up · 1 item could not move`, UI §4.9); the verb
  refuses outright only when **every** root is already first (up) / last
  (down).
- **Move to top/bottom** — requires **one common parent for all roots**
  (refusal reason `To top needs the selected items to share one level.` /
  bottom, UI §4.3); the roots move as one block, in document order, before
  the parent's first / after the parent's last row. Edge refusals: already
  at the top / bottom.
- **Indent / outdent** — the shipped rules (`hybrid.js:4659-4687`) over
  roots: indent nests each root as the **last child** of its nearest
  preceding sibling outside the target set (the planner later realizes the
  new child level through the claim/source-tag rules, §3); outdent moves
  each root after its parent item, keeping order among the outdented roots;
  a source level left empty is removed at commit (§3 step 4). Refusals: a
  root with no preceding sibling outside the set; any root at depth 0.
  Following siblings stay at their level (`hybrid.js:4667-4669`).
- **Sort** — the scope is **always the focused row's parent level**: exactly
  one sibling level, every row of it (selected or not), never recursive and
  never "the selection's common parent". Stable: subtree blocks travel,
  equal keys keep original order. Key: `ownText`; empty labels last in
  **both** directions; numeric-aware: both sides match the `NUMBER_RE` shape
  (`table-editor.js:39`) → numeric compare, else
  `Intl.Collator(undefined, {numeric: true, sensitivity: "base"})`
  (`table-editor.js:35-38`, same collation as the table). Ascending and
  descending are two buttons (`#le-sort-asc`, `#le-sort-desc`), so the
  window holds no sort-direction state. Refusal: the level has fewer than
  two rows.
- **Done → bottom** — **recursive: every sibling group in the container**,
  not just the focused one. Each group partitions into not-done rows then
  done rows, each side stable, subtrees and relative order kept;
  `done === null` (non-task) counts as open. Quoted/in-cell lists keep their
  own order (their items are not rows).
- **Mark done / open** — the target set is the roots plus their locked
  descendants; **only task rows in it change** (`done !== null`); non-task
  rows are ignored. The UI's strings are normative: `Marked 4 items done`,
  `All 4 were already done`, `Only task items have a done state.` Adding
  checkboxes to plain items is out of scope (the §4.7.1 list-type model,
  not this modal); the DOM checkbox is mutated only at commit (§3 step 7).
- **Delete** — the roots plus their subtrees leave the model (records and,
  until commit, nodes stay, §2). No confirmation: it is one in-window undo
  step until Apply. Deleting every row is the §3 step-8 empty case.

Keyboard (the body's own, per `edit-window.md` §8): roving tabindex on rows
(`paintActive` shape, `table-editor.js:259-267`), Up/Down skip hidden
(collapsed) rows, Shift+Up/Down extend (the Shift rule above), Home/End
first/last visible row, Ctrl+A / Ctrl+Shift+A as above, Space / Shift+Space
toggle selection / done on the focused row, Left/Right and Enter
collapse/expand, Delete the delete verb, Tab / Shift+Tab indent / outdent
released at the grid's edges (`table-editor.md` §8.4's edge rule), F2
starts the focused row's text edit, Esc
cancels on one press (`docs/ui/list-editor.md` §8.2 — this window has no
live range or fill to claim the first press; a live drag claims it, §4
Drag reordering, and so does a live text edit, §4 Item text editing).

### Drag reordering (pointer)

The pointer form of Move. The note's own drag (`list-edit.js`) commits
through `NB.hybrid.moveListItem`, which re-parents and emits per-item
announcements, so this window cannot reuse it. The window's drag reorders its
**model only**; nothing in the note moves until Apply, exactly like every
other verb. The unit is one row with its subtree, or — when the press lands on
a selected root — the span from the first selected root to the last root's
subtree, holding every root, every descendant and the unselected siblings
between them. A mixed-level selection starts no drag (§4's refusal rule); there
is no partial block.

**State machine.** Two module-level slots, `pending` and `drag`:

| State | Set by | Cleared by |
| --- | --- | --- |
| idle | — | — |
| `pending = {pointerId, rowId, x, y}` | a plain `pointerdown` on a `.le-cell`: no modifier, button 0, `pointerType !== "touch"`, target not `.le-chev` / `.le-done`, window not stale | the threshold is crossed (`beginDrag`), the grid's or the page's `pointerup` / `pointercancel`, `abortDrag()` |
| `drag = {pointerId, rowIds, parentId, beforeRowId, line, raf, lastY}` | `pointermove` of at least 4 px from the press point (`DRAG_THRESHOLD`), with every root sharing `parentId` | `pointerup` (commit), `pointercancel`, `lostpointercapture`, Esc, `close()`, `goStale()` |
| idle | `endDrag(commit)` | — |

- **The press resolves the block.** A press on an **unselected** row replaces
  the selection with it, then arms that one row. A press on a selected **root**
  keeps the selection: it writes `focusId` and the anchor to the pressed row and
  arms every selected root. A press on a **locked descendant** replaces the
  selection with that row (the click rule, UI §3.1) and arms it alone. No
  repaint happens between the press and the drop, and a press with no travel is
  still the plain click whose handler collapses the selection — so the press
  and the click can disagree without the model ever showing it.
- **A mixed-level selection refuses at the threshold, not at the drop.** When
  the selected roots do not all share the pressed row's `parentId`,
  `beginDrag` clears `pending`, writes the UI's sentence to the status and
  creates no `drag`: no capture, no line, no dim, no step. The refusal is
  decided once, before the pointer is captured, so it can never become a
  half-block drop.
- **Events only, never touch.** `pointerType === "touch"` never sets
  `pending`: touch keeps panning and the toolbar is the reorder path.
- **Capture on the grid.** `#list-editor-grid` takes
  `setPointerCapture(pointerId)` — it survives every render, a row does not,
  and capture on a removed node is released by the engine.
- **A press released off the grid cannot linger.** Before the threshold there
  is no capture, so the page-level `pointerup` / `pointercancel` listeners
  clear `pending`; without them a release outside the grid would leave the old
  press point alive and a later hover could start a drag from it. A move with
  `buttons === 0` also drops the candidate.
- **No key acts mid-drag.** Three layers, in order: a capture-phase
  `keydown` listener on `document` swallows every key but Esc while `drag` is
  set; `onGridKeydown` returns while `drag` is set; and `ownsKey:
  () => !drag` keeps the history engine's own document chord listener
  (`edit-window.js:297`) out of the window. Esc is deliberately passed
  through, because it must cancel the drag and nothing else.
- **Esc is claimed first.** `onOverlayKeydown` ends a live drag and returns
  before the window's Cancel, so Esc mid-drag never closes the window.
- **Every end path is `endDrag()`**: it cancels the auto-scroll frame,
  releases capture, removes the line, strips `.is-dragging` from every row of
  the span and `nb-le-drag` from `<body>`, arms the click guard, and only then
  commits.
  `abortDrag()` is the same call with `commit: false`, invoked from
  `close()` (before the `hidden` guard, so a line cannot survive into the
  next open) and from `goStale()`.
- **A drag whose capture failed still ends.** `setPointerCapture` can throw
  on a pointer the platform already released; the window-level `pointerup`
  then finishes the drag with `endDrag(true)` (and `pointercancel` with
  `endDrag(false)`), because the grid's own handler never saw the release.
  The grid's handler runs first, so a live `drag` at the window is exactly
  the failed-capture case: no double commit.

**The line.** It is `nb-drop-line le-drop-line`: the note's own bar class
(`.nb-drop-line`, `style.css:995-1003`, absolute with `--accent` and the
`--accent-soft` ring) plus this window's one delta, `height: 2px`. Its
containing block is `.le-scroll`, which gains `position: relative`. The dim is
`opacity: var(--opacity-drag)` on `.le-row.is-dragging`, and the cursor is
`body.nb-le-drag` — the note's `body.nb-list-drag` pattern (`style.css:1114`),
so the grabbing cursor survives the captured pointer leaving the body for the
header or the footer. Text selection is off on `.le-body.is-dragging` (this
window's own scope) and page-wide through the body class.

**Two coordinate spaces.** The hit test is 1-D in **client Y**: the slot is
the first visible row of the block's `parentId` level whose vertical midpoint
is below the pointer and that lies **outside the moving span**, else the end
of that level (`beforeRowId = null`). Descendants of other rows are never
consulted, so the space over a nested child can never open that child's level;
skipping the span is what makes it un-droppable, including the unselected
siblings between non-contiguous roots and the gaps that cease to exist once
the span gathers. The line is drawn in
**`.le-scroll` content coordinates** — client rects converted by
`scrollTop - scrollRect.top` — because the line is an absolutely positioned
child of `.le-scroll` (hence `position: relative` there) and must travel with
its rows: `left` is the level's indent start (the `.le-chev`/`.le-chev-slot`
cell of a row at that depth, which sits past the guides), `right` is the
tree's right edge, and the 2 px bar sits at `top - 1` of the target row; the
end-of-level slot sits under the **last row of the level outside the span**,
and when the span covers the whole level the line is hidden — there is no
position to show, and the drop would reproduce the same order.
Auto-scroll is a `requestAnimationFrame` loop started when the pointer is
within 24 px of the scroll box's top or bottom edge, stepping the scroller
8 px per frame and re-pointing the slot each frame; it stops when the drag
ends or the scroller stops moving.

**The pure decision — `moveBlocks(rowIds, beforeRowId)`.** Exported as
`NB.listEditor._moveBlocks`; `_moveBlock(rowId, beforeRowId)` stays as the
one-element wrapper, so the shipped single-row tests and their seam keep
working. Model only: it splices `state.rows` and calls `deriveRows()`, and it
returns `{moved, position, count}` — `position` is the first root's 0-based
index among its siblings after the call, `count` is the number of roots, and a
refused or no-op drop returns `moved: false` with the order untouched.
Validation, in this order:

0. the window must be live — `if (stale || !state) return {moved: false,
   position: -1, count: 0}`, so the exported seam cannot splice a stale model;
1. `rowIds` is non-empty, has no duplicates, and every id resolves to a row;
   no root is a descendant of another (the pointer layer passes roots, the
   model enforces it);
2. every root shares one `parentId` — a mixed level refuses whole, the same
   rule as To top/bottom (`docs/ui/list-editor.md` §4.3);
3. `rec(beforeRowId)` resolves when it is not `null`, has that same
   `parentId`, and lies **outside the moving span** (below). That one test
   rejects a root, a descendant of a root, and — the case the single-row rule
   never met — an **unselected sibling between two roots**, which travels
   inside the span and is not a slot either.

Then the **span rule**, which is `moveGroup`'s, reused. The run is one
contiguous span: `from` is the first root's index, `to` is
`blockEnd(lastRootIndex)` — so it holds every root, every descendant of a root
(each root's block, in model order, collapsed parents included), and the
unselected siblings between the roots. Building the span, not a union of the
roots' own blocks, is what makes those between-rows travel rather than be
stranded. `rest` is the model without `[from, to)`; `at` is computed **in
`rest`**: `rest.indexOf(target)` for a "before" slot, else the end of the level
(after the last same-level row's whole block, else just after the parent row).
`state.rows` becomes `rest[0..at) + span + rest[at..)`. The no-op test is **the
resulting id sequence compared with the current one**, not `at === from`:
a drop just outside the span, or a re-gather that reproduces the same order,
would otherwise capture a dead step. The single-row case is the span of one
block and behaves exactly as shipped.

**History and the no-op guard.** The commit path after a real drop is the
verbs' own: `state.selected` = the roots, anchor and focus to the pressed
root, `afterChange("Moved " + count(rowIds.length, "item"), true)`, which
repaints and calls `hist.capture("structural")` once — one drag, one
window-history step, and Apply alone decides whether a file is written. A no-op drop returns before
that call, so it adds no step and writes no message. The guard is explicit
because `capture()` dedupes on the **whole** snapshot string, selection
included (`edit-window.js:145`): a drop that keeps the order but changes the
selection would otherwise produce a different snapshot and a dead step.

**The click after the drop.** A pointer-cancelled press may or may not earn a
`click` from the browser (cancelling `pointerdown` suppresses the
compatibility mouse events that normally produce it), so the guard is one
shot with two consumers and no timer. `armClickGuard()` sets `swallowClick`
and adds one capture-phase `click` listener on the overlay; both
`onGuardedClick` and `onGridClick` consume the boolean and the listener with
`stopImmediatePropagation`, so a click that does reach either surface neither
replaces the selection nor reaches the overlay's Cancel. `endDrag` arms it on
every end path — a drop, Esc, `pointercancel`, a close — and `close()`
disarms it after `abortDrag()`, so an armed guard cannot reach into the next
open. The next `pointerdown` also disarms it, because the click a drag owes
the browser always lands before the next press: a guard left armed can never
eat a later button.

### Item text editing (one row, in place)

The verb the window lacked: F2 on the focused row, or a double-press on
its `.le-text` (two presses within 350 ms and 8 px, any pointer type),
edits that row's prose **inside the grid**; the model is
the only thing that changes until Apply, and the commit replaces exactly
the run that was edited. The surface is the table's cell editing
mirrored (`table-editor.js:326-367`, `docs/ui/table-editor.md:166-174`):
the existing span (`list-editor.js:753-758`) gains
`contenteditable="true"` in place — no overlay editor, no second box —
and commits to the model on Tab/Enter/F2, on blur, and before anything
else acts. Settled decisions, restated once: only the **prose run** is
editable — the nested list, the checkbox and plugin cards are preserved in
place, while the item's existing `img`s and hard breaks are run members:
they sit inside the field and are written back with it; the edited prose
keeps `strong`, `em`, `code`, `a`, text, `<br>` **and the note's authored
inline elements** (`data-hybrid-authored`, `hybrid.js:144`); typed
characters are text (no Markdown is parsed in the
window); a text change counts in the signature, never in a flag. Every
citation in this subsection was verified against the working tree
(drag included).

**The prose-run rule.** Three functions, one rule:

- `runHost(row)` → the row's `<li>`, unless the item is
  paragraph-wrapped: marked's loose shape puts the prose (and possibly
  the checkbox) inside a `<p>`, so the host is the `<li>`'s **first
  `<p>` element child when the row's checkbox is absent or inside that
  `<p>`** (`taskCheckboxOf` already resolves through the p,
  `hybrid.js:3486-3498`). In the wrapped case the child list is a
  **sibling** of the host p; in the tight case it is the host li's last
  element child (P0). A checkbox outside the first `<p>` means the host
  falls back to the `<li>`, whose first child is then a `RUN_BOUNDARY`
  match — an empty run, conservatively uneditable prose.
- `runNodes(row)` → the ordered **maximal contiguous sequence of child
  nodes of the host** that are all run nodes, starting at the first
  child after a **leading checkbox** and ending before the first child
  that matches `RUN_BOUNDARY` — a new module constant, sibling of
  `CHROME_STRIP` (`list-editor.js:43`):
  `ul,ol,blockquote,p,pre,table,div,hr,input,[contenteditable="false"]`.
  A run node is any node that is not a `RUN_BOUNDARY` match: text,
  `strong`/`em`/`code`/`a`/`img`/`br`, and any other inline element
  authored raw HTML carries. The `<ul>` ends the run — and prose after
  it **does occur** in engine output: marked's loose lists produce
  `<li><p>a</p><ul>…</ul><p>c</p></li>` and
  `<li><p><input> task</p><p>second</p><ul>…</ul></li>` (verified with
  the project's own marked, gfm, `breaks: false`), so that later `<p>`
  is real prose this window cannot reach — which is exactly why the
  guard below refuses such items rather than offering a partial edit.
  Text **after an `img`** is the same run:
  `img` is inline content (`EMBEDDED_CONTENT_SELECTOR`,
  `hybrid.js:216-221`), so the run spans it and the image travels
  inside it.
- `captureRun(row)` → the extent's serialization, **chrome filtered**:
  the caret `<br data-hybrid-caret-br>` (`hybrid.js:85`, planted by
  `focusListItem` for empty plain items, `:9664-9667`) and the ZWS
  placeholder (`:207`, `taskCaretHost` `:3474-3483`) are **extent
  members** — they sit between the checkbox and the first boundary, so
  a replacement removes them — but the capture skips them (the
  serializer's own chrome walker removes the br, `hybrid.js:1479`, and
  the capture sweeps ZWS from text nodes).

**The label rule stays as shipped.** `ownText` keeps its §2 definition
and its capture — the whole `<li>`'s stripped text, from the detached
clone walk with `CHROME_STRIP` — and is immutable. The label shown, and
the sort key that reads it, is the item's whole stripped text; while a
row's edit is **dirty** the label is the strip of the edited HTML
(`labelOf` consults the `edits` map first, then falls back to
`row.ownText`), otherwise `ownText` of the live `<li>` — which no verb,
no capture and no write-back touches until the row's own commit, so the
label it feeds can never go stale. `labelOf` is the single accessor,
and its two direct-`ownText` consumers are converted with it, named:
`buildRow` (the label and `title` at `list-editor.js:753-758`, and the
`.is-empty` class currently keyed on `!row.ownText` at `:755`) and
`sortRows`' sort key (`:1304`); the chevron's `aria-label`
(`:740-743`) already reads `labelOf` and needs no edit.

**The editability guard.** The field is offered only when the write
would be a pure text edit, and that is **two tests on the capture
string**, not one:

- **(a) canonical** — `sanitizeRun(captureRun(row)) ===
  captureRun(row)`: nothing in the extent would be unwrapped, dropped,
  or lose an attribute. This test exists because the other one is
  text-only: `ownText` strips `input` and cards at **any depth** while
  `runNodes` bounds only direct children, so a pasted checkbox wrapper
  — `<li><p><span><input type="checkbox"> x</span></p></li>` — passes
  the text comparison, and the whitelist write would unwrap the
  `span`, drop the `input`, and silently turn a task item into a
  bullet. (a) refuses it before the field ever opens. It also refuses
  a run whose only change would be the newline collapse (an authored
  soft-wrapped item, a `\n` inside a text node, the shape
  `hybrid.js:210-215` describes) — conservative, and the same rule:
  the write is offered only where it is a no-op on structure.
- **(b) whole prose** — `strip(captureRun(row)) === row.ownText`: the
  run's stripped text equals the item's whole stripped label, so
  nothing lies outside the run (a second paragraph, text after a block
  or a card, text after a nested list). It holds for a run holding
  existing hard breaks and images — the strip turns `br` into one
  space and reads no text from an `img`.

When either test fails, F2 and a double-press do nothing but write a
refusal to the status
line: no `edits` entry is created, nothing is captured, the selection
is left exactly as the invoking gesture made it, and the window stays
open — the same shape as every other refusal in this window. The exact copy is
the UI doc owner's; the string's job is to say the item holds content
this window cannot edit here. The refusal is the design, not a gap: a
partial edit would leave unedited words behind, and a commit must
never do that. Test (a) is what makes that claim true — the edit keeps
the markdown inline subset **and** the note's authored inline elements,
and anything else refuses the field rather than being flattened.

**The model.** No per-row field. `state.edits` is a `Map<rowId, html>`
holding **only rows whose text differs from the item's live prose** —
empty at open, which is what keeps the open signature byte-identical
and the row records untouched (`buildModel`, `list-editor.js:397-408`,
is unchanged). The map is **never pruned**: `deleteRows` leaves a
deleted row's entry in place and the plan (`texts`, the map's entries
for rows in `rowOrder`) is the filter — which is what lets undo of a
delete restore the row with its edited text (§6). The live edit sits
in one module-level slot,
`editing = { rowId, span, baseHtml } | null`, sibling of `drag` and
`pending`. `baseHtml` is the sanitized run `startEdit` rendered into
the span — the live capture for a clean row, the row's existing
`edits` entry for a dirty one — so the commit compares against the
model's current value, never against the live prose of a dirty row.
The row's clean value, `sanitizeRun(captureRun(row))`, is recomputed
on demand (one row, once per commit), never stored. `drag` and
`editing` are mutually exclusive by construction (every drag starts
with a press, and a press commits the edit — below). One invariant —
**no repaint runs while `editing` is set** — cannot rest on blur:
Safari does not focus a clicked button, so a toolbar or bar click can
reach the model with the span still live, and `renderTree` is
`gridEl.textContent = ""` (`list-editor.js:774-777`) — it would destroy
the span mid-typing. Every acting path therefore calls `commitEdit()`
itself, each call site named: at the top of `apply()` (§5 step 3a), of
the tool dispatch (`onToolClick`/`dispatchTool`, after the stale
guard), of the module's `_undo()`/`_redo()` seams (before
`hist.undo()`/`hist.redo()`, so a mid-edit undo commits the typing
into a step ahead of the index move), and of `restoreSnapshot` — the
belt for the history bar's buttons, which the engine wires itself
(`edit-window.js:282-283`) and the module cannot precede. The
restore-path commit runs inside the engine's `restoring` window
(`edit-window.js:250`; `capture()` returns early at `:129`), so it
records no step and the restore governs: a mid-edit bar-click
discards the typing and lands on the snapshot — a defined outcome,
not a mid-air collision. Blur (`focusout`) stays the fallback for
every path that leaves the span without acting.

**The edit surface.** Entry is F2 on the focused row and a
**double-press** — a second `pointerdown` on the same row's cell within
`EDIT_TAP_MS` (350 ms) and `EDIT_TAP_PX` (8 px) of the first, detected
by the pointer layer itself at every width and for every pointer type,
**not** the native `dblclick`: `onGridPointerDown` calls
`preventDefault()` (`list-editor.js:2001`) and the compatibility mouse
events that carry `dblclick` are not reliable. The detector sits ahead
of the drag-candidate path, and a detected double-press consumes the
press. `startEdit(id, point)` changes neither the selection, the
anchor nor `focusId` — a pointer press has already done its selection
job, and F2 on the focused row leaves a multi-selection intact. It sets
`editing`, makes the span contenteditable, focuses it, places the
caret at the press point via `caretRangeFromPoint` /
`caretPositionFromPoint` (falling back to the end of the run), and
writes **`baseHtml`** into it — the model's current value, which the
guard has already proved canonical (test (a) is what keeps the field
from ever showing flattened text). An empty run gets one ZWS text node
as the caret host (the `taskCaretHost` idiom). `commitEdit()` is the only
capture point, with three outcomes: `sanitizeRun(readSpan()) ===
baseHtml` → nothing happens — no entry, no step, no label change (the
walk is a projection, so the compare is exact); the result equal to the
row's clean value → the `edits` entry is **deleted** — a revert to live
is a real change, so it is one step and the label returns to
`ownText`; anything else → the entry is set. On a real change the
verbs' own path runs — `afterChange("Edited 1 item", true)`
(`list-editor.js:866-876`): refresh, footer, one
`hist.capture("structural")`. Kind structural because the engine
coalesces only `"text"` (`edit-window.js:146-147`) and one edit session
must be exactly one step; the table's `breakCoalesce()` dance
(`table-editor.js:337`) is not needed. A blur commit owns its focus:
`afterChange` reads `hadFocus` at `list-editor.js:867`, by which time
the span has already lost focus — so the flag is false, no cell is
focused, and focus strands on `<body>`. `commitEdit` therefore records
that the field held focus and routes it to the row's cell itself
(`focusCell(rowId)`), except when the `focusout`'s `relatedTarget` is
a real control inside the overlay — the tool the user clicked keeps
its focus; programmatic commits leave the routing to their caller
(Apply closes, a tool dispatch keeps the tool). `abortEdit()` restores
the span
from the model and strips contenteditable — Esc, stale, close. Keys
while `editing` is set: Enter commits and focus returns to the row's
cell; Tab and Shift+Tab commit and focus stays on the cell (the
indent/outdent chords are unreachable while editing); F2 commits;
arrows and typing are native; an IME confirm never commits — the guard
is `e.isComposing || e.keyCode === 229` (Chrome reports 229 during
composition; the table's own precedent, `table-editor.js:476-483`)
**plus a one-shot latch armed on `compositionend`** that swallows the
next Enter, because WebKit can deliver the confirm keydown after the
composition has ended (the bug class: an Enter that confirms a
composition would split it); Shift+Enter is swallowed — the field may
contain the
item's existing hard breaks and images, and the keyboard never creates
new ones; and `onGridKeydown` returns early for everything else. The history chord is off during the edit —
`ownsKey: () => !drag && !editing` (§1) — so Ctrl/Cmd+Z is the
browser's native span undo; the bar's undo/redo buttons commit first
(the restore-path belt, above). Esc is **claimed first**, like the drag's
(`list-editor.js:1609-1616`): abort the edit, keep the window open; the
next Esc cancels the window. This deliberately differs from the table,
whose Esc goes straight to Cancel from either state
(`table-editor.js:471-473`): this window had already established
claim-first for its drag, and Esc keeps one meaning inside it — back
out one level. Paste inside the edit is **plain text only**, the
table's rule (`table-editor.js:917-928`) with the whitespace collapse;
a native drop is routed the same way (`:952-958`); the window has no
clipboard verbs of its own.

**Signature, plan, snapshot.** `rebuildPlan()` gains `texts` — the
`edits` entries for rows in `rowOrder`, so a deleted row's edit dies
with the delete — and `signatureOf` (`list-editor.js:515-527`)
appends a fourth field: each entry as `id + "=" + JSON.stringify(html)`,
joined `\u0002`. `JSON.stringify` escapes separators and control
characters, so typed `\u0001`/`\u0002` cannot forge a collision (the
existing three fields are integer and plain-attribute joins, already
injection-safe). At open the map is empty, so the open signature is
byte-identical to before. The no-op proof extends one line: an edit
adds an entry → `current !== open` → Apply writes; the window-undo of
the edit restores the map → the token disappears → Apply closes
without a write. No flag anywhere; the signature stays strictly
stronger. The snapshot gains `e` (§6): the map as `[id, html]` pairs,
present only when non-empty — omission is exact, not a cache.
`restoreSnapshot` sets `state.edits` from `e` and the repaint derives
every label (dirty rows from their entry, clean rows from `ownText`),
so undo/redo restores text as one step. The `hist.capture` dedupe
caveat extends: `capture()` compares whole snapshots
(`edit-window.js:145`), the `e` pairs are part of the string, and the
drag's rule is already the right one — the explicit compare **before**
capture, never the engine's dedupe, keeps a typed-then-deleted change
from becoming a dead step.

**Write-back at Apply.** `commitPlan` gains one pass — **step 5, after
the wrapper cleanup and before the P4 assertion** (which becomes step 6
and now validates the post-write shape): for each `plan.texts` entry,
in `rowOrder` order, `writeRun(row, html)` recomputes the extent from
the live `<li>` with the same `runNodes` (the DOM is untouched since
open, so this is the open-time extent; no boundary references are
stored), records the first extent node and its `nextSibling` **before
removing anything**, removes the extent, and inserts the parsed
fragment before that recorded anchor — an empty extent inserts before
the host's first `RUN_BOUNDARY` child, else at the host's end.
Ordering is why the
pass runs after the level moves: the edited, moved `<li>` is already
where the plan put it, and the write lands wherever the row is.
Identity: the `<li>`, every wrapper, the checkbox, the child list,
`blockquote`/cell content and plugin cards keep their nodes (never
extent members); an **untouched row is never in `texts`**, so its
inline nodes keep theirs too — the per-row skip, not just the global
no-op. The edited row's inline nodes are fresh parses — identity there
is not load-bearing: serialization is attribute-based, and the
sanitizer's whitelist is the serializer's own attribute set, so
nothing readable is lost. An empty result writes **one ZWS text node**
(the `addListPlaceholders` shape, `hybrid.js:204-207`), so the item
keeps its line box; a non-empty result drops the ZWS, exactly as the
engine's placeholder rule would. The edited-row's-`li`-was-deleted case
cannot write: `texts` covers only `rowOrder`, the delete pass has
already removed every other node, and `writeRun` resolves
`rec(id).node` and skips a gone one. `title`, the chevron's
`aria-label` and the empty-label class are label-derived and refresh in
the post-commit repaint; the edit span itself is window chrome and
never reaches the note.

**Sanitization.** One choke point, `sanitizeRun(html) → string`
(exported as `_sanitizeRun` — the security boundary gets a direct
seam): it runs at `startEdit` (so `baseHtml` is canonical) and at
`commitEdit` (so a model value is always clean); the write-back parses
the stored entry and needs no second pass. The walk is the
table's `cleanInline` shape (`table-editor.js:651-669`): text passes;
`script`/`style`/`noscript`/`template` drop with their text; any other
unsupported element unwraps to its children; `[\r\n]+` collapses to one
space — in the list the collapse is load-bearing, not cosmetic (the
round-trip lemma below). Two list rules the table does not have, both
load-bearing:

- **Authored elements are kept, with their attributes unchanged.** Any
  element carrying `data-hybrid-authored` (`AUTHORED_ATTR`,
  `hybrid.js:144`) survives the walk untouched — the engine's own
  provenance contract: an authored element is content, keeps every
  attribute (`hybrid.js:1459-1460`), and the serializer writes it back
  as raw HTML; the `AUTHORED_ELEMENT_TAGS` set (`hybrid.js:173-185`) is
  the engine's own list of what authored raw inline can be (`kbd`,
  `mark`, `sup`, `sub`, `u`, …). Without this rule, editing a row next
  to authored markup would flatten it — and the guard's test (a) would
  then refuse every such row. `script`/`style`/`noscript`/`template`
  still drop with their text, authored or not.
- **Attributes are removed in place, never remove-all-then-re-add.**
  The walk deletes only the attributes not kept, so a canonical run
  re-serializes **byte-identically** — which is exactly what the
  guard's test (a) compares. A re-adding walk would reorder attributes
  and refuse every wikilink row.

The allowed set and its differences from the
table's `INLINE_TAGS` (`:642-644`):

| | Table cell | List run | Why |
|---|---|---|---|
| `br` | one space (`:678`) | kept | a list item's hard break round-trips: `lineBreak` writes `'  \n'` (`vendor/turndown.browser.js:93-99`, `br: '  '` `:762`) and the item indent keeps the continuation inside the item (`:148`) |
| `img` | unwrapped | kept, `src`/`alt`/`title` | the img-is-preserved rule; the attribute set is the serializer's own `MARKDOWN_IMG_ATTRS` (`hybrid.js:189`) |
| `a` | `href` only (`:665-667`) | `href`, `title`, `data-wikilink`, `data-wikilink-raw` | without the flags an edited row's wikilinks degrade to plain links — the §8 wikilink pin and the serializer's own whitelist (`hybrid.js:190`, `:1463-1465`) |
| authored inline | unwrapped | kept with all attributes | the engine's authored contract (`hybrid.js:144`, `:1459-1460`); the edit keeps the note's authored inline markup, and the guard's test (a) depends on it |

`strong`/`b`, `em`/`i`, `code`, `a`, `br`, `img`, text, plus the
authored set — that is the
whole whitelist; an **unmarked** `del` or `span` still unwraps like any
other unsupported element, but the guard's test (a) refuses such a row
before the field opens — nothing is ever silently flattened. Pasted
HTML therefore can never enter the
model: the paste path inserts plain text, and the sanitizer is the
second gate. The sanitizer is list-local rather than exported from the
table: the sets and the br rule differ, the walk is twenty lines, and
there is no third consumer — extract a shared `NB.inlineHtml` when one
appears.

**Markdown round-trip.** Turndown re-serializes the run at save, and
`process` escapes **every text node** — `self.escape(node.nodeValue)`
(`vendor/turndown.browser.js:889`), except inside `code` — so typed
bytes meet the escape table (`:732-746`) wherever they sit:

| Typed | Saved as | Rule |
|---|---|---|
| leading `-` | `\-` | `^-` (`:735`) |
| leading `1. ` | `1\. ` | `^(\d+)\. ` (`:745`) |
| leading `>` | `\>` | `^>` (`:743`) |
| any backtick | `` \` `` | global (`:739`); typed text can never open a code span — an existing `<code>` serializes through its own rule, which lengthens the delimiter around embedded backticks (`:308-327`) |
| `[x]` | `\[x\]` | `[`/`]` global (`:741-742`); literal text, and the task meaning lives on the preserved checkbox, which typing cannot create |
| trailing `\` | `\\` | global (`:733`) |

**Why the `^`-anchored rules are enough (the line-start lemma).** A
saved line can start inside an item only at the run's serialization
start or after a `<br>` — the only intra-run newline source is the
`lineBreak` rule (`:93-99`), because the sanitizer's newline collapse
removed the other (a `\n` inside a captured text node). A `<br>` is a
node boundary, so the next text node *begins* the line; the run's first
text node begins the first line; and `^` anchors at text-node starts.
Line starts and node starts coincide, so a text node that begins a line
and begins with `-`, `1. ` or `>` is always escaped. Residual gaps —
mid-line `~~~`, `#` with no space, a `1. ` typed into the middle of an
existing text node (the node does not start with it, and neither does
the line) — are byte-identical to typing the same characters in the
note body through the hybrid engine: same DOM shapes, same serializer,
no new surface.

**Interactions.**

| Gesture / state | Rule |
|---|---|
| F2 / double-press (350 ms / 8 px) | the guard first: both tests pass → the edit opens with the caret at the press point; either fails → the refusal is written and nothing changes — selection, anchor and `focusId` untouched by `startEdit`; Enter never edits (it keeps collapse for a parent and is inert on a leaf) and Tab keeps indent/outdent — the table's Enter-to-edit is deliberately not copied, this grid already spends Enter and Tab on structure |
| typing, arrows, composition | native in the span; `onGridKeydown`'s in-edit branch returns early; no commit on an IME confirm (`isComposing`/`keyCode 229`/the `compositionend` latch) |
| Tab / Enter / F2 / blur / any press or tool elsewhere | `commitEdit()` — one step when the model changed; Enter and Tab return focus to the row's cell, and a blur commit routes focus there itself (the field held it; `afterChange`'s `hadFocus` at `list-editor.js:867` is already false), unless the focus moved to a real control inside the overlay |
| Esc | claimed first, like the drag's: `abortEdit()`, window open; the next Esc cancels the window |
| drag | a press inside the edited row moves the caret and never arms `pending` (`onGridPointerDown`, `list-editor.js:1988-2009`, gains the exception; `onGridMousedown` `:1620-1626` does not preventDefault there); a press on any other row **commits first**, then resolves the press as §4 Drag reordering says (the row alone, or the block when it is a selected root) and arms — by the drop the model is settled: one text step, then the drop's own |
| toolbar verbs | the tool dispatch (`onToolClick`/`dispatchTool`) commits first — the blur is only the fallback, because Safari does not focus a clicked button — then the verb; an edited row moves/indents/sorts like any row, its text travelling with the record |
| delete | the dispatch's commit (one step), the delete removes (its own step); Apply writes neither — the row is not in `rowOrder`, so not in `texts`; in-window undo of the delete brings row and edited text back (the snapshot's unfiltered `e` pairs) |
| collapse | the chevron's press commits (same dispatch path); hidden rows are not addressable; Left/Right/Enter are inert while editing |
| Apply | `apply()` commits **before `rebuildPlan()`** (§5 step 3a), so plan and signature see the text |
| Cancel / × / backdrop / `close()` | `abortEdit()` after `abortDrag()`; uncommitted typing never entered the model |
| stale | `goStale()` aborts, never commits — the model is dead and history is killed; the span loses contenteditable and re-renders from the model |
| failed restore | the restore path itself commits (the bar-button belt, §4); after a failure the model is untouched and the engine restores its index |

**Budget.** ~180 lines in `list-editor.js` (run rule, guard and edit
state ~80, sanitizer ~40, keyboard/pointer deltas and seams ~45, plus
the two `labelOf` consumer edits — `buildRow`'s label/`title`/
`.is-empty` (`list-editor.js:753-758`, `:755`) and `sortRows`' key
(`:1304`) — one line each), one
`style.css` rule (the editing caret on `.le-text[contenteditable="true"]`,
the table's own citation `docs/ui/table-editor.md:167-168`), no
`index.html`, `sw.js` or toolbar change. The UI doc's chord list, the
one-press Esc exception (§8.2 — the drag already has it) and the
`Edited 1 item` string are its owner's to amend; this blueprint names
no UI string as normative.

The block drag is not a new subsystem: it adds roughly 50 lines to the
shipped drag layer — block resolution at the press, the mixed-level refusal at
the threshold, the slot's skip-the-block filter, and the gathered splice with
the id-sequence no-op — and no CSS, no key, no toolbar control.

## 5. Apply, Cancel, invalidation

```
apply():
  1  if (!state) return;                                     // not open
  2  if (stale) return;                                       // Apply is disabled in stale; belt
  3  if (!container || !viewerContentEl.contains(container))
       { goStale(); return; }                                // a guard failure closes nothing
  3a if (editing) commitEdit();                               // the plan and the signature see the
                                                              // text (§4 Item text editing)
  4  plan = rebuildPlan();
     if (!plan) { setStatus("Could not apply — the list was not changed");
                  return; }                                  // stays open, note clean
     if (plan.empty) emptyFocus = { next: container.nextElementSibling,
                                   prev: container.previousElementSibling };
                                                              // capture before any mutation (§3 step 8)
  5  if (_signature().current === openSignature)
       return close({ focusList: true });                    // no-op: nothing written
  6  NB.hybrid.clearSelection();                             // a live Range over nodes about to
                                                             // move glitches the caret
                                                             // (hybrid.js:9292-9293); clearSelection
                                                             // (:9361-9364) is unexported, so §7
                                                             // exports it — reuse, do not re-implement
  7  NB.hybrid.flushPendingSnapshot();                       // pre-edit state = its own undo step
  8  savedHtml = viewerContentEl.innerHTML;                  // rollback buffer (§3)
  9  try { commitPlan(plan); }                               // §3: in-place, inside the live container
       catch { viewerContentEl.innerHTML = savedHtml;         // the rollback REPLACES the container node
               goStale(); return; }                           // stale: open, read-only, Cancel focused (below)
 10  NB.hybrid.onContentChange();                            // dirty + autosave + the debounced snapshot
 11  if (plan.empty) { close({ focusList: false }); focusAfterRemoval(emptyFocus); }
     else close({ focusList: true });
```

- **Ordering is load-bearing**: flush (7) strictly before the first mutation
  (9), `onContentChange` (10) strictly after — exactly
  `table-editor.js:1984-1991`. One Apply = one note undo step; the modal's
  in-window history never touches the note (`edit-window.js:13-14`).
  **Refusals never close**: a null plan (step 4) or a stale race (step 3)
  writes the status line and leaves the window open; a **commit failure
  (step 9) goes stale**: the `innerHTML` rollback is
  `restoreSnapshot`'s mechanism (`hybrid.js:7459`) and it **replaces the
  container node**, so after it `state.container` is detached — the
  window cannot stay editable over a dead node. It stays open
  read-only with the stale notice and Cancel focused (`goStale()`,
  below), the note clean (`onContentChange` not called); only a
  successful or a no-op Apply closes.
- **No-op detection.** The structural signature is derived from the plan,
  never from a copy of the DOM: `sig(plan) = {rowIds in document order with
  their depths, the wrappers' ids/tags/attrs in order, the done map, the
  `edits` map's tokens (§4 Item text editing)}` — the
  done values read the live `checked` property, the one authority
  (`hybrid.js:1614-1645`). `openSignature` is captured at `open()` from the
  opening plan; because the opening plan describes the live container
  exactly (same rows, same wrapper ids), it equals the same walk taken over
  the live DOM at open — which is the sense in which the open-time signature
  is "computed from the container". `current` is derived at Apply from the
  Apply-time plan, and `_signature()` returns both. At open the `edits` map
  is empty, so the token field is empty and the open signature is
  byte-identical to the pre-text-editing one.
  **Proof that move-down-then-up is a no-op:** `rebuildPlan()` is a pure
  function of (a) the model — the flat order, depths, done values, the
  `edits` map — (b) each
  row's open-time child wrapper (read from the DOM, which no verb touches)
  and (c) each row's `sourceTag`. Up/down moves a run one slot within its
  own parent and changes nothing else (§4), so down-then-up restores (a)
  byte-for-byte; (b) and (c) are untouched by construction. The two plans
  are therefore equal, their signatures are equal, and Apply closes without
  a write — even though an implementation keyed on a "something moved" flag
  would have written. The same argument covers a done-toggle cycle and an
  indent-then-outdent pair (§3: the transient level leaves no wrapper in the
  final plan), and the text case needs one line more: an edit adds a map
  entry, the window-undo of the edit restores the map and removes it (§4).
  There is **no `changed` flag**: the signature is strictly
  stronger (the `sameTable(rebuildTable({canonicalAlign:false}),
  originalTable)` defence, `table-editor.js:1979-1982`, minus the flag's
  blind spot). `collapsed` and selection are not in the signature (UI
  state, not note content).
- **Stale — the one read-only state (invalidation, two channels).**
  `renderMarkdown` replaces `viewerContentEl.innerHTML` (`hybrid.js:2224`)
  and is reachable while the window is open from external change
  (`:10649`), AI patch (`:10672`), the saved-render reconciliation
  (`:8358`) and draft recovery (`:8710`). Exit and tab switch re-render
  through `viewer.activate` (`hybrid.js:8157-8168`) and **never enter
  `renderMarkdown`** (§0.5) — so one channel is not enough:
  - **(a)** `renderMarkdown` emits `NB.evt.emit("hybrid:rerendered")` as its
    last line (after `markAtomicBlocks()`, `hybrid.js:2272`) — a §7 edit;
    it is hybrid-internal, so it never fires in preview.
  - **(b)** the module subscribes to **`hybrid:rerendered` and
    `hybrid:exited`** (the pair `list-edit.js:631-632` already subscribes;
    the exit emit is `hybrid.js:8178`). On `hybrid:rerendered`: if open and
    `!viewerContentEl.contains(container)` → `goStale()`. On `hybrid:exited`:
    plain `close()` — hybrid is gone, nothing to write, and the caret falls
    to `#viewer-content`.
  - **(c)** the `viewerContentEl.contains(container)` guard at open, in
    every verb, and at Apply step 3 — the belt to (b)'s suspenders
    (the `table-editor.js:1969-1971` mirror).
  `goStale()` keeps the rows the window drew (the model is still readable),
  shows the notice strip, sets `aria-readonly="true"` on the treegrid,
  `aria-disabled` on every tool, kills history, disables **and keeps
  visible** the Apply button (the designers' `syncApply` precedent,
    `designer-shell.js:162-169` — **not** the table's `setBlocked`, which
    *hides* Apply, `table-editor.js:2006`; `edit-window.md:664` records
    that hide), focuses Cancel, and writes the status
    `This list changed outside the window. Nothing was applied.`
    (the strip copy is normative in `docs/ui/list-editor.md` §5.3). The
    strip is **static text with no role**: the table's strip at
    `index.html:1716-1722` carries `role="status"` and must not be copied
    verbatim — the footer is this window's only live region
    (`templates/_edit_window.html:53-54`). Staleness is **node identity,
    not structure**: a re-render that leaves this list's bytes identical
    still goes stale, because the container node was replaced.
  **Stale Cancel / Esc / ×:** the original container node is gone, so the
  focus fallback cannot target it — focus `#viewer-content`, then the
  first item of the first `ul`/`ol` in the re-rendered content (the exported
  `focusListItem`), else the caret stays at the start of `#viewer-content`.
- **Empty model — the caret after removal.** `focusAfterRemoval`:
  focus `#viewer-content`, then place the caret at the **start of the next
  block sibling** of the removed container, else the **end of the previous
  block sibling**, else the start of `#viewer-content` — never
  `document.body`, or note-level Ctrl+Z is unreachable (it is bound on
  `#viewer-content`), and never the removed `container`, which after
  `remove()` resolves no focus target at all. The siblings are captured
  before the commit removes the container (step 4): a detached node's
  `nextElementSibling` is null.
- **Focus return.** The context-menu invoker is hidden before
  `dialog.close` runs, so the module owns `focusListCaret(container)`: focus
  `#viewer-content`, then call the newly exported
  `NB.hybrid.focusListItem(container.querySelector("li"))` — caret after the
  checkbox for task items, the `taskItemRule` shape (`hybrid.js:9651-9671`,
  currently unexported; the export is a §7 edit — reuse, do not
  re-implement). `close()` mirrors `table-editor.js:2084-2092`: when focus
  died on `<body>` or inside the overlay, or Apply forced it, land the caret
  in the list so **note-level Ctrl+Z reaches the hybrid dispatcher**
  (`table-editor.js:2086-2088` rationale) — one Ctrl+Z after Apply restores
  the pre-Apply list as a single step (§8 pins it).
- **Live region.** Apply emits **no** `list:item-moved` events — the commit
  never calls `moveListItem` (which emits per item, `hybrid.js:9624` → the
  per-item announcer `list-edit.js:618-627`). One announcement per action,
  through the footer status (the shell's single polite region,
  `templates/_edit_window.html:53-54`); `docs/ui/list-editor.md` §4.9 owns
  the exact strings. The per-item announcer is also physically muted:
  `NB.listEdit.disable()` on open, `enable()` on close (only when
  `NB.hybrid.isActive()` — after a `hybrid:exited` close, `list-edit.js:631`
  re-enables itself on the next `hybrid:entered`). Direct calls, not a new
  event: `disable`/`enable` are already the module's exported seam
  (`list-edit.js:580-598`, `:644-645`), and one consumer does not justify
  a second pub/sub channel.
- **Cancel** writes nothing even when the watcher replaced the container
  under the modal (`table-editor.js:1994-1998` rationale). **Not undoable**
  in-window: Apply, Cancel, Close, Esc, backdrop, maximize, drag, resize,
  focus and selection changes (`edit-window.md` §6.5); every verb is one
  step, a text commit included (§4 Item text editing). Note-level: one
  Apply is one step against the note's own history.

## 6. In-window history

Attached through `NB.editWindow.attach` in stack mode (§1). Snapshot format —
a **string** (the engine constraint: `capture()` dedupes with
`snap === stack[index]`, `edit-window.js:145`, and `sizeOf()` counts only
strings, `edit-window.js:112-114`):

```js
JSON.stringify({
  rows: [{ i: id, p: parentId, d: 0|1|null, c: collapsed }],  // model order
  e: [[id, html]],   // the state.edits map as pairs, model order; present
                     // only when the map is non-empty (§4 Item text editing)
  sel: [ids],        // the selection set (§4), model order
  anchor: id,        // the anchor id, null when nothing is selected
})
```

- `p` = the parent row's id, `null` at the top level. The depth is derivable
  from the parent chain, but `p` is stored for clarity (and lets restore
  assert M2 directly).
- `d` = the done state as `0` (open task), `1` (done task) or `null`
  (**not a task item**). The previous `{i, d: depth, g: …, c}` encoding could
  not distinguish a non-task from an open task; this one can.
- `e` = the `state.edits` map as `[id, html]` pairs — the **whole map,
  unfiltered**: `deleteRows` prunes nothing (§4 Item text editing), so
  an entry for a row a later snapshot deleted is still here, which is
  what lets undo of a delete restore the row with its edited text.
  **Present only when
  the map is non-empty** — omission means empty, which is exact, not a
  cache (§4 Item text editing). It rides edited rows only, so a snapshot
  grows by the edited row's run, not the list's.
- `sel`/`anchor` are stored because selection is part of the state a
  restore owes the user (§4).

The `table-editor.js:1530-1538` pattern: serialize the model, resolve ids
back to records on restore. `ownText`, `node` and wrapper identity are never
in the snapshot — content reaches it only as the `e` pairs, and the plan
re-derives wrappers (§3).

- **No coalescing.** Every committed verb captures with kind `"structural"`;
  the engine coalesces only `"text"` (`edit-window.js:146-147`), so one verb
  = one entry. A verb whose snapshot equals the top of the stack is dropped
  by the engine's own dedupe — a refused verb never reaches `capture` at
  all. A text commit is the same kind with the same one-step rule: the
  compare-before-capture is §4 Item text editing's, because the `e` pairs
  are part of the snapshot string and the dedupe alone would leave a dead
  step for a selection-only change.
- **Restore.** Parse, validate every id resolves in `byId` (records outlive
  deletes; a deleted row's node is still in the live container, §2), rebuild
  `rows` in snapshot order, restore done/collapsed, set `state.edits` from
  the `e` pairs — the repaint then derives every label: dirty rows from
  their entry, clean rows from `ownText` — restore the selection
  set and anchor — **clamped to ids that still exist** (a snapshot may name
  rows a later snapshot deleted; ids that no longer resolve drop out of
  `sel` and the anchor falls back to the focused row) — recompute derived
  fields, repaint, return `true` (`false` only on a parse failure — the
  error state of `docs/ui/list-editor.md` §5.4). Focus returns to the
  focused row if it still exists, else the nearest preceding row, else the
  first row (`table-editor.js:1560-1566` shape). The module holds
  `restoring` across the repaint so the repaint itself cannot capture.
- **Caps.** The engine defaults: 100 snapshots including the opening seed
  (`edit-window.js:20`), 4 M characters total (`:22`), oldest-first eviction
  that never drops the current entry (`:119-125`). A row is ~30 bytes, so a
  300-row list snapshots at ~10 KB and the entry cap binds first; 99 undo
  steps exceed any sane reorder session. `reset()` seeds the opening
  snapshot in `open()` **after** the model and the selection are built (the
  sort-marker lesson, `table-editor.js:2032-2034`); `close()` calls
  `hist.clear()` (`table-editor.js:2099`).

## 7. Integration edits, in order

1. **New `static/js/list-editor.js`** (§1). No other file's behavior changes
   because of it: callers deref lazily.
2. **`templates/index.html`** — two anchors:
   - Overlay markup **after the table-editor overlay** (which ends at
     `:1730`) and before the Mermaid designer comment (`:1732`): a direct
     body child `<div id="list-editor-overlay" class="settings-overlay"
     hidden>` wrapping `<div class="settings-modal list-editor-modal"
     role="dialog" aria-modal="true" aria-labelledby="list-editor-title"
     tabindex="-1">` (the table's shape, `:1594-1596`). Header via
     `edit_header("list-editor", "Edit list", badge_id="list-editor-type")`
     with **no `badge_text`**: `open()` writes the type
     (`Task list` / `Bulleted list` / `Numbered list`) the way the Mermaid
     designer writes its diagram type (`docs/ui/list-editor.md` §1.4;
     `edit-window.md` §2.2); bar via `edit_bar("list-editor")` whose caller
     slot carries `#le-toolbar` with `class="edit-bar-toolbar"` and five
     groups in the shipped order — Move (up/down/top/bottom), Level
     (outdent/indent), Sort (`le-sort-asc`, `le-sort-desc`, `le-sort-done`),
     Select (all/none), State (mark done, mark open, `le-delete` in
     `is-danger`); body `.le-body` with `#list-editor-notice`
     (`class="le-notice-strip"`, **no role** — static text; the strip's
     *look* copies `index.html:1716-1722`, whose `role="status"` is dropped
     because the footer is the only live region) over
     `.le-scroll > #list-editor-grid` (the `role="treegrid"` attributes per
     `docs/ui/list-editor.md` §2.1); footer via `edit_footer("list-editor",
     "le-footer", "le-status", hint="Esc cancels")`. Static, not
     module-built, for the same three reasons the table cites
     (`table-editor.md` §3): `windows.js` wires at boot (`wire()` at
     `windows.js:231-245`, boot loop `:245` — `:109-136` is
     `ensureMaxButton`, not the wiring), the keyboard guards match
     `body > .settings-overlay:not([hidden])`, and `NB.dialog` inerting
     needs the overlay to be a direct body child (`dialog.js:100`).
   - Script tag **after `:2119`** (`table-editor.js`), before `watcher.js`
     (`:2120`): `<script src="/static/js/list-editor.js?v={{ asset_v }}"
     defer>`. After `table-editor.js` because the shared shell is loaded
     there and the load-order diagram stays append-only; runtime derefs
     make the exact slot non-load-bearing.
3. **`static/js/hybrid.js`** — five edits:
   - Menu item **immediately before the `Edit table…` push**
     (`:10274-10278`) — the position `docs/architecture/context-menus.md`
     `:420-429` already amended:
     ```js
     const hit = (e && e.target && e.target.closest
                    ? e.target.closest("li") : null)
       || (ctx && ctx.li);          // ctx = caretListItem() at :10263
     if (hit && viewerContentEl.contains(hit) && listContainer(hit)) {
       items.push({ label: "Edit list…",
         handler: () => NB.listEditor && NB.listEditor.open(hit) });
     }
     ```
     The caret fallback (`caretListItem()`, `hybrid.js:2708`) is load-bearing
     twice: a `Shift+F10`/Menu-key contextmenu reports no coordinates
     (`hybrid.js:10493-10505`), and the whitespace gap between items
     resolves no `<li>`. Never disabled: the shape refusal is `open()`
     returning `false` (§1).
   - `NB.evt.emit("hybrid:rerendered")` as the **last line of
     `renderMarkdown`** (after `markAtomicBlocks()`, `:2272`).
   - **Export `focusListItem`** in the list-reordering group of the
     `NB.hybrid` object (`:10721-10729` — `moveListItem, resolveListItemMove,
     moveItemBySelection, listContainer, …`).
   - **Export `clearSelection`** in the same group (one line;
     `hybrid.js:9361-9364`). This is the chosen resolution of the
     unexported-helper problem — one line on an existing export group beats
     a local re-implementation, and §5 step 6 then calls the same helper
     `moveListItem` itself calls (`hybrid.js:9613`).
   - **Adjacent fix (recommended, one line):** `onCheckboxChange`
     (`:7790-7795`) gains the attribute mirror after the native toggle:
     `cb.setAttribute("checked", "")` / `cb.removeAttribute("checked")` per
     `e.target.checked`. Reason: `pushSnapshot` stores `innerHTML`
     (`hybrid.js:7435`), which serializes the **attribute**; a manual click
     toggles only the property (the save path reads the property,
     `turndown-plugin-gfm.browser.js:145`, so the file is right), and a later
     undo/restore rebuilds the node from `innerHTML` with the check silently
     reverted (`restoreSnapshot`, `hybrid.js:7459`). Not required by the modal
     (it mirrors its own writes, §3 step 6) but it closes the same defect
     for every manual click; flag it as adjacent in the commit message.
4. **`static/sw.js`** — `"/static/js/list-editor.js"` in `PRECACHE` after
   `:116` (beside `table-editor.js`, keeping script order), and bump `CACHE`
   at `:72` (`notebook-v35` → `notebook-v36`) with the customary comment line
   (the `:62-71` pattern). The DOM suite's cache floors (`:12405-12406`,
   `:22779`, `:42387`) need no edits (§0.1).
5. **`static/css/style.css`** — three edits, all inside the file the brief
   names. The class names are canonical in `docs/ui/list-editor.md`:
   `le-row`, `le-cell`, `le-text`, `le-chev`, `le-guide`, `le-select`,
   `le-done`, `le-mark`, `le-indent`, the `is-selected` wash; the toolbar
   node is `#le-toolbar` with `class="edit-bar-toolbar"`.
   - Join `#list-editor-overlay,` to the shared edit-window token selector at
     `:9805-9807` (one line) — duplicating the 17 `--edit-*` values in the
     `.le-` block would be copy-paste that drifts; this is the
     anti-duplication choice.
   - Join `.list-editor-modal` to the modal-box selector at `:6725` (one line):
     `min(--designer-modal-w, 96vw) × min(--designer-modal-h, 92vh)`, the
     table's own token reuse (`edit-window.md` §5.1).
   - The **`.le-*` block between `:7049` and `:7051`** (after the table
     editor's closing 520px media query, before the Mermaid designer): the
     five number tokens `docs/ui/list-editor.md` §10.1 owns
     (`--le-row-pad-block`, `--le-row-pad-inline`, `--le-select-box`,
     `--le-done-box`, `--le-mark-w`), declared on `#list-editor-overlay`;
     then the scroller, row, cell, rail, box, marker, tool and notice rules
     under those names — the declarations are the UI spec's §10.2 (it is
     normative for this body); this blueprint adds only the two structural
     points it owns: the marker-width measure is one read pass per render
     with the single `--le-mark-w` write after it (§2), and the ≤520 block
     uses **`100dvh`, not `100vh`** for the full-screen height — the table's
     `100vh` is the known mobile-chrome defect (`edit-window.md` P3) and
     this window does not reproduce it. The 520 rule **wins over saved
     geometry** because it sets `left`/`top`/`transform`/`width`/`height`
     with `!important` (`style.css:7038-7047`) while `windows.js` writes
     saved geometry as plain inline style — the cascade is stated in
     `edit-window.md` §9.5; a window that has been dragged still covers
     the phone.
6. **`tests/dom/test_dom.js`** — three edits:
   - Duplicate the overlay markup **after the table-editor copy** (which
     starts `:1040` and ends `:1215`), before the designer copy (`:1216`) —
     the duplicate-markup cost, §9. Complete, not partial: header (close
     button last, `_edit_window.html:9-11`), bar with the history pair + seam
     + actions (the `:1051-1073` shape), notice, treegrid host, footer with
     status/hint/cancel/apply. The notice copy carries **no** `role`.
   - Add `"#list-editor-overlay"` to the shared bar-anatomy check's overlay
     array at `:39069-39070` (one line) so the fixture is enforced like the
     other three.
   - The new `== list editor ==` test block after the table editor blocks
     (`:12395-12408` wiring-guard pattern: index.html loads
     `list-editor.js` after `table-editor.js`; sw.js PRECACHE includes it;
     module + overlay loaded). No cache-version edit (§0.1).
7. **`tests/browser/test_list_editor_browser.js`** — new file (§8), plus:
   - **`tests/browser/run_all.js`**: one `SUITES` line
     `{ name: "list editor", file: "test_list_editor_browser.js", port: 5093 }`
     (§0.2; ports in use are 5078-5099 except 5084/5085/5087-5090/5093).
   - **`package.json`**: `"test:browser:list-editor":
     "node tests/browser/test_list_editor_browser.js"` beside the table's
     (`package.json:23`).
8. **`docs/architecture/frontend.md`** — the load-order diagram (`:42-50`)
   and the module row (`:151`) already include `list-editor`; they stay as
   they are. One wording note for the doc owner: the row's
   "`start`/`reversed`/`type` survive" means the session DOM (§3) — GFM
   cannot express `reversed`/`type`, and turndown re-reads `start` alone
   (`vendor/turndown.browser.js:152`), so no save keeps them.

Nothing else. `windows.js` (wires every `.settings-modal` automatically,
`windows.js:231-245`), `dialog.js`, `edit-window.js`, and `list-edit.js` need
no edits — the modal reaches them through their existing exports.

## 8. Test seams and test plan

**jsdom** (`tests/dom/test_dom.js`, a new `== list editor ==` block after the
table-editor blocks; drive `NB.listEditor` directly, the `== list reorder ==`
idiom at `:20190-20246` — `listEnter`/`listLeave`, `ownText`, `childItems`,
`order` helpers are the precedent and can be reused from that block, with
the harness `ownText` at `:20222-20226` extended by the chrome-node strip
(§2)):

- *Module load + open*: wiring guards (§7.6); `open` returns false outside
  hybrid, for a detached container, and for a viewer role (stub
  `NB.auth.canWrite` false — plus the belt: hybrid is unreachable for a
  viewer anyway, `hybrid.js:10567-10568`); validation refusals (a wrapper
  with a non-`<li>` child, an `li` with two child lists) → `open()` returns
  false — **no blocked state exists**; `getState()` row fields match the DOM
  (depth, done, ownText with a nested subtree and a checkbox present — the
  `li.textContent` trap); boundary rows: a `<blockquote>`-nested or
  `<td>`-nested `li` inside a row is **not** a row and still sits inside the
  row's `<li>` after a move+Apply.
- *Selection*: `_select([a, b])` then `getState()`; a selected parent's
  descendants are selected and locked (a toggle on one is ignored);
  `_select({anchor: a, focus: c, extend: true})` spans the visible range;
  roots = selected rows whose parent is not selected; Ctrl+A includes
  collapsed rows; after every verb the same ids stay selected, after a
  delete they leave the set, after a collapse they persist (§4, once).
- *Each verb*: move up/down by runs within each root's own parent (two
  roots in different parents move in both, in one activation) and the
  refusals (every root already first/last; the partial `· 1 item could not
  move` count); the **never-re-parent pin**: a run moved down past a
  shallower row keeps its depth (the forbidden old behaviour asserted
  absent); move top/bottom within one parent, the mixed-parent refusal,
  the edge refusals; indent (previous-sibling rule + refusal at group
  head), outdent (depth-0 refusal, following siblings stay); sort —
  focused row's parent level only, stable (equal keys keep order), empty
  last both directions, `2` < `10` numeric-aware, nested levels untouched;
  done-to-bottom — every sibling group, stable, subtrees intact;
  mark done/open — task rows only, `Marked 4 items done` /
  `All 4 were already done` strings; delete — the subtree travels.
  Assert through `getState()` and the pure `rebuildPlan()`.
- *Drag model* (`_moveBlocks(rowIds, beforeRowId)` and the one-row
  `_moveBlock` wrapper, §4 Drag reordering — jsdom has no layout, so the
  pointer path is the browser suite's): a parent moves with its whole
  subtree, a childless row alone, a collapsed parent's hidden rows with it;
  `[a, c]` in one parent moves the span from `a` to the end of `c`'s subtree,
  so the unselected rows between the roots travel inside it; `[c, a]` gives the
  same result; a root in another level refuses the whole call and leaves the
  order and the depths identical; a non-contiguous block already at the slot
  returns `{moved: false}`; a `beforeRowId` of another level, inside any
  dragged subtree, on an unselected row between the roots, or one of the roots
  is refused; `null` lands after the last remaining block of the level; the
  `position` returned is the first root's 0-based sibling index after the call
  and `count` the number of roots; and none of it adds a `_history()` entry or
  changes the selection or the focus (the seam owns neither — the pointer layer
  does).
- *Item text editing* (§4 Item text editing, model level — jsdom cannot
  type, so the span work is `_editRow(id)` + a forced `_commitEdit()`):
  the `edits` map in `getState()` is empty at open; the run rule — a nested
  list, a `blockquote`, a later `<p>` and a card each end the run, the
  loose item's first `<p>` hosts it, an `img` inside the run is captured,
  prose after an `img` is one run, and the caret `<br>`/ZWS are extent
  members that never appear in the capture; the guard — the loose shapes
  `<li><p>a</p><ul>…</ul><p>c</p></li>` and
  `<li><p><input> task</p><p>second</p><ul>…</ul></li>` refuse
  `_editRow` (no entry, a status refusal, selection and anchor
  untouched), an equal-shape item — including one holding an `img` or a
  hard break — edits; `_sanitizeRun()` keeps the allowed
  set, the wikilink flags and `img[src alt title]`, unwraps unsupported
  elements, drops `script` with its text, and collapses `\n` to space;
  a hostile span innerHTML committed through the seam lands in the map
  as the sanitized projection; a no-change `_commitEdit()` returns
  `false`, repaints nothing and adds no `_history()` entry; a
  revert-to-live commit deletes the entry and the label returns to
  `ownText`; while dirty the label is the strip of the entry;
  `_undo()`
  after a real commit restores the map (the snapshot's `e` present when
  non-empty, absent when restored); a delete after an edit leaves
  the row gone with its edit, and `_undo()` brings both back.
- *Text write-back*: edit one row of a task item with a nested list,
  move it, Apply → the `<li>` is the same node, the checkbox and the
  child list are the same nodes, the run (hard breaks and images
  included) is replaced, the saved
  round-trip keeps `strong`/`em`/`code`/`a` and the wikilink markup;
  the signature — `_editRow` + a change → `_signature().current !==
  _signature().open`; window-undo of the edit → the map restored →
  equal → `_apply()` writes nothing; an edit emptied to `""` plants
  one ZWS and labels `"(empty item)"`; a deleted row's edit never
  reaches the note.
- *Planner purity*: `rebuildPlan()` twice in a row returns equal values and
  leaves the DOM unchanged (node identity of every `li`/`ul`/`ol` before and
  after the call).
- *No-op signature*: open, move down, move up, `_apply()` → the note is not
  dirty and no POST happened (the `postFile()` counter idiom, `:20218`);
  done-toggle cycle → no write; indent-then-outdent → no write;
  `_signature().current === _signature().open` in each case.
- *In-place Apply + identity*: `<ol start="5">` with a nested list; Apply a
  real move → the container is the **same node**, still `start="5"`, and the
  nested wrapper is the **same node**; saving round-trips `5.` numbering.
  Wikilink pin: an item containing a wikilink, move + Apply → the `<a>` is
  the same node with its `data-wikilink*` attributes intact, and the saved
  round-trip keeps the wikilink markup.
- *Session chrome*: an empty item keeps its caret `<br>` and ZWS through
  open, a move and Apply (assert still present post-Apply); its `ownText`
  labels `"(empty item)"`; a Mermaid-card item labels as its own prose, not
  the diagram source (the chrome-node strip, §2).
- *Zero-task list*: a `<ul>` whose rows include no checkbox — badge
  `Bulleted list`, Mark done/open disabled with
  `Only task items have a done state.`, Done → bottom disabled with
  `No done items to move.`
- *300 rows*: open, sort, Apply — completes within the suite's time budget;
  one repaint per verb; the opening snapshot is ~10 KB (§6 caps bind on
  entries, not bytes).
- *Refusals never close*: corrupt the container mid-session (inject a
  non-`<li>` child into a wrapper) → `rebuildPlan()` is null → `_apply()`
  writes the status, `isOpen()` is still true, the note is clean; a refused
  verb adds no history entry and never closes.
- *Stale*: with the window open, replace `#viewer-content.innerHTML` and
  emit `hybrid:rerendered` → the stale state (rows kept, tools
  `aria-disabled`, **Apply visible and disabled**, verbs refuse, `_apply()`
  writes nothing, Cancel focuses per §5); `hybrid:exited` closes clean.
- *Snapshot restore*: each verb is exactly one `_history()` entry; a
  non-task row (`d: null`) restores as a non-task and an open task as open
  (the encoding pin); `_undo()` after a delete restores the row with its
  **original node** (never left the container, §2); the selection set and
  anchor come back; ids that no longer exist are dropped; a refused verb
  adds no entry; `_history()` reports `mode:"stack"`.
- *Empty model + caret*: delete every row → Apply → the container is gone
  from `#viewer-content`, `#viewer-content` holds focus (never `document.body`),
  and nothing references the removed node as a focus target (§5).
- *Done attribute mirror*: mark done on tasks → Apply → the DOM input carries
  `checked=""` (so a subsequent `NB.hybrid` snapshot/restore round-trip keeps
  it).

**Playwright** (`tests/browser/test_list_editor_browser.js`, new file,
`test_table_editor_browser.js:198-298` is the structural precedent):

- Focus trap: open from the context menu (right-click on an item; also
  `Shift+F10` from a caret in an item, and a right-click on the whitespace
  between items — both resolve through the caret fallback, §7) →
  Tab/Shift+Tab cycle inside the overlay (`dialog.js:61-76`); focus returns
  to the list (a collapsed caret inside the container) after Cancel and
  after Apply.
- Roving keys: Up/Down/Home/End over collapsed rows, Shift+Up/Down extend,
  Ctrl+A (collapsed included), Ctrl+Shift+A, Space, Shift+Space,
  Left/Right collapse/expand, Delete, Esc cancels on one press.
- Drag (§4 Drag reordering), real pointer: press the last row and drag it above the
  first — the block dims, the 2 px line sits at the target row, the model
  reorders on release, one `Moved 1 item` is written, and the row is left
  selected and focused; a press released on its own position adds no history
  entry and no message; Esc mid-drag keeps the window open and removes the
  line; a `Ctrl` press and a touch press start no drag. **Block:** Ctrl-click
  two roots in one parent so the rows between them travel too, plain-press one
  of them — the selection survives the press — and drag; every root and its
  subtree dims, no line appears over the block, the release gathers the run at
  the slot with one `Moved 2 items` step, and the roots are the selection and
  the anchor; a press-and-release without travel collapses the selection to
  that row; roots in two parents start no drag and write the level sentence.
- Item text editing (§4 Item text editing), real typing: double-press a row →
  type with the row's formatting visible → Tab and Enter commit, focus
  returns to the row's cell and the label refreshes
  (`Edited 1 item`); a double-tap enters the edit on a touch screen;
  Esc aborts the typing and keeps the
  window open (a second Esc cancels); F2 on the focused row starts the
  edit and leaves a multi-selection intact; Enter on a leaf row never
  starts an edit; the guard — a multi-paragraph loose item refuses the
  entry and writes the status refusal; a paste from a rich clipboard
  inserts plain text only; an IME
  composition confirms without committing (the row stays in edit);
  the drag interplay — type in one row, press another (the edit
  commits), release a drop (its own step after the text step); the
  escape-table round-trip — edit an item to start with `-`,
  `1.`, `>`, and contain a backtick, `[x]` and a trailing `\` → save →
  read the file → each is escaped (`\-`, `1\.`, `\>`, `` \` ``,
  `\[x\]`, `\\`); and one note-level Ctrl+Z after Apply restores the
  original text as a single step.
- Apply round-trip through save: right-click an item → "Edit list…" → move →
  Apply → the tab's save → read the file → the expected Markdown (list block
  only re-serialized, `Title\n=====` untouched — the `:20291-20305` shape);
  **undo after Apply**: one note-level Ctrl+Z restores the pre-Apply order
  as a single step (the flush ordering pin).
- An external change mid-window: with the window open, rewrite the file on
  disk and let the watcher fire → the stale state; Cancel places the caret
  at the first list in the re-rendered content; a tab switch (the
  `viewer.activate` path) → `hybrid:exited` → clean close.
- The chevron reveal, the done toggle, and the 520px phone presentation
  (full screen **even with saved geometry** — drag first, then shrink —
  `100dvh` height, 44px tools and rows, wrapped footer) get one case each.

## 9. Risks

Ranked; each names its mitigation, which is a §-mechanism above, not new
work.

1. **Wrapper identity lost in the write** (CRITICAL — turndown re-reads
   `start` at `vendor/turndown.browser.js:152`). Mitigated by construction:
   the commit never rebuilds the container and never re-parents a claimed
   wrapper (§3), so `start`/`reversed`/`type` and authored attributes ride
   on the original nodes; the signature carries wrapper identity + attrs
   (§5), so a build that would drop them cannot compare equal silently.
   Pinned by the jsdom identity case. (`reversed`/`type` still do not
   survive a save — GFM cannot express them, §3.)
2. **Boundary rows hoisted out of a quote or cell** (CRITICAL). The raw
   `querySelectorAll("li")` (`hybrid.js:9491`) would list them and a commit
   that moved them by level would tear the quote. Mitigated by the
   `listContainer(li) === container` filter (§2), by the wrapper map's
   container-only scope (§2), and pinned by the jsdom boundary case.
3. **Detached-node writes** (CRITICAL). `renderMarkdown`
   (`hybrid.js:2224`) fires mid-session from four callers (§0.5), and the
   exit/tab-switch path re-renders through `viewer.activate` (§0.4). Mitigated
   by the two invalidation channels + the stale state + the contains-guards
   (§5); `hybrid:exited` covers the path `hybrid:rerendered` cannot see.
   The table editor shares the exposure through its own `:1969-1971` guard;
   extending the channels to it is a follow-up, not part of this change
   ("Nothing more").
4. **The in-place commit's ancestor cycle** (MAJOR — `appendChild` into a
   wrapper inside the moved row's own subtree throws). The level-order
   commit makes it structurally impossible (§3 step 3); pinned by the
   sandwich case (outdent P out of X, move P above X, indent X under P).
5. **Undo snapshot / attribute mismatch on done** (MAJOR). `pushSnapshot`
   stores `innerHTML` (`hybrid.js:7435`) — attribute, not property.
   Mitigated by the commit-time mirror (§3 step 7) and the recommended
   adjacent fix in `onCheckboxChange` (`hybrid.js:7790-7795`).
6. **Turndown wrapper rules** (MAJOR). A child list not last emits a block
   break (`vendor/turndown.browser.js:133`); a non-`<li>` wrapper child
   shifts every number (`:153`). Mitigated by P0 validation (§3) and the P4
   assertion (§3 step 6).
7. **Undo correctness of the batch** (MAJOR). Flush-before-mutate is the
   whole contract (§5 steps 7 → 9); an extra `pushSnapshot` would
   double-step. The try/catch rollback keeps a half-applied plan from
   sticking (§5 steps 8-9). Pinned by the browser round-trip and the
   one-Ctrl+Z case.
8. **Long-list performance** (MINOR). All paths are O(n) flat-array work
   (verbs, plan, signature); one repaint per verb; the marker measure is
   one read pass per render (§2); snapshots are ~30 bytes/row (§6); no
   per-row live-region announcements (§5). 100 rows is the target, 300
   works, 1000 is unsupported, nothing is capped, and virtualisation is
   explicitly out of scope.
9. **Duplicate-markup cost in the jsdom harness** (MINOR). The fixture gets
   a ~70-line copy of the overlay (`test_dom.js:1040` precedent) that must
   track `templates/index.html` by hand. Mitigated by the bar-anatomy check
   joining the fixture array (`:39069-39070`) and by keeping the copy
   structural (no decorative SVG paths beyond what the checks select).
10. **Doc drift** (MINOR). `hybrid-editing.md` is amended in the tree
    (`:661-664`); `frontend.md`'s two-literal-pins claim (`:396-398`) is
    stale and its `list-editor` row's "survive" wording needs the §7.8
    note. Both are recorded for the doc owner; this blueprint changes no
    file but its own. Text editing adds one more: `docs/ui/list-editor.md`
    §8.2's one-press Esc and its chord list gain the claim-first
    exception the drag already has (§4 Item text editing).
11. **Authored inline loss on an edited row** (MAJOR). A raw-HTML inline
    element outside the allowed set (`del`, a styled `span`) unwraps to
    its text when its row's text is committed — the table's own cell
    containment (`table-editor.js:671-674`). Mitigated by the per-row
    skip: only rows in the `edits` map are ever re-written, so untouched
    rows keep their nodes and bytes; the loss is bounded to the row the
    user chose to retype, and the sanitizer keeps the attributes the
    serializer itself reads (the wikilink flags, `img`/`a` Markdown
    attributes). Pinned by the jsdom identity and wikilink cases.
12. **Round-trip residual gaps** (MINOR). Mid-line `~~~` and `#` with no
    space are not escaped (`vendor/turndown.browser.js:732-746` anchors
    them) — byte-identical exposure to typing the same characters in
    the note body through the hybrid engine, which shares the
    serializer; no new surface is opened. The sanitizer's newline
    collapse is what keeps the `^`-anchored escapes total (the §4 line-
    start lemma); removing it would open un-escaped line starts inside
    text nodes. Pinned by the browser escape-table case.

## 10. Line and effort budget

| Artifact | Lines | Notes |
| --- | --- | --- |
| `static/js/list-editor.js` | ~1000-1100 | Model+verbs+selection ~350, planner+commit ~200, treegrid/roving keys ~250, open/close/apply ~150, history+seams ~100, header ~25 |
| `static/css/style.css` | ~180 | Two selector joins + the `.le-*` block (§7.5) |
| `templates/index.html` | ~80 | Overlay (~78) + script tag (1) |
| `tests/dom/test_dom.js` | ~340 | Fixture markup ~75, block ~265 (§8) |
| `tests/browser/test_list_editor_browser.js` | ~370 | New file (§8) |
| `run_all.js` + `package.json` | 2 | One line each (§7.7) |
| Docs | this file | `frontend.md` already carries the diagram and row (§7.8) |

Effort: module ~2 days, jsdom suite ~0.75, browser suite ~0.5, wiring/CSS
~0.25, review + full-suite runs ~0.5 — **about 4 focused days**. The estimate
deliberately does not treat this as a small addition to `table-editor.js`
(the `hybrid-editing.md:655-659` sizing rule for §4.7.2 applies here too);
nothing is shared with the table beyond the shell macros, `NB.editWindow`,
`NB.dialog`, and the hybrid list API that already exists.
