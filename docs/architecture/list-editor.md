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
  like Shift+click) — the two selection seams, §4 — `overlayEl()`, `_undo()`,
  `_redo()`, `_history()` → `{mode:"stack", depth, index, canUndo, canRedo}`
  (`table-editor.js:2206-2211`).
- History attaches once in `wire()` through `NB.editWindow.attach`
  (`edit-window.js:48-66`) in stack mode, prefix `"list-editor"`,
  `ownsKey: () => true` (no text fields exist in this body, so the chord is
  modal everywhere), `enabled: () => !!state && !stale`
  (`table-editor.js:2119-2128`).

The module header comment states the ordering contract and the two invariants
that surprise: a no-op Apply writes nothing (the structural signature, not a
`changed` flag), and Apply mutates the live container in place — the
`<ul>/<ol>` wrapper nodes are never rebuilt from scratch, so `start` (the one
attribute turndown re-reads, `vendor/turndown.browser.js:152`) cannot be lost
by the commit itself.

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
  never touched by the verbs or the commit — a wikilink survives Apply
  because its `<a>` travels inside the moved `<li>` (§8 pins it).
- **Session chrome is never part of the model, and never stripped by the
  modal.** The marked caret `<br>` (`data-hybrid-caret-br`, `hybrid.js:85`,
  added by `focusListItem`/`addMeasureLineBox` for empty items,
  `hybrid.js:9661-9665`, `:9679-9687`) and the ZWS placeholder are editing
  surface, not note content: the chrome walker removes every caret `<br>` at
  serialization (`hybrid.js:1479`, reached through `prepareTurndownClone`,
  `hybrid.js:833-835`), so they can never reach the note. The modal must
  leave both in place — an empty item keeps its line box and its rendered
  marker through open, verbs and Apply; only `ownText` ignores them.
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
5. **P4 assertion.** Every row with a child wrapper has it as its **last
   element child**: claimed wrappers were last at open (P0), created wrappers
   were just appended, nothing else is appended to a row. Turndown emits a
   block break instead of nesting when the child list is not last
   (`vendor/turndown.browser.js:133`); this is asserted in the commit, not
   repaired.
6. **Done flags.** For each row whose plan `done` differs from its open-time
   value: `cb = taskCheckboxOf(row.node)`; `cb.checked = v`; then mirror the
   **attribute** — `v ? cb.setAttribute("checked", "") :
   cb.removeAttribute("checked")` (the spelling matches marked's own
   output). This runs inside the commit's try, before `onContentChange()`,
   so the debounced snapshot captures it; the mirror matters because
   `pushSnapshot` stores `innerHTML` (`hybrid.js:7435`) — the attribute —
   while the live authority is the property (`hybrid.js:1614-1645`).
7. **Empty model.** `plan.empty` → step 1 has removed every row node and
   step 4 every wrapper, so the commit is one line: `container.remove()`.
   The caret rule that follows is §5's; the removed container must
   not be reused as a focus target.

Apply wraps the whole commit in try/catch with a pre-mutation copy of
`viewerContentEl.innerHTML` as the rollback (restore it, report, leave the
note clean — `onContentChange` not called; the mechanism is
`restoreSnapshot`'s, `hybrid.js:7459`). See §5 for the exact order.

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
  not this modal); the DOM checkbox is mutated only at commit (§3 step 6).
- **Delete** — the roots plus their subtrees leave the model (records and,
  until commit, nodes stay, §2). No confirmation: it is one in-window undo
  step until Apply. Deleting every row is the §3 step-7 empty case.

Keyboard (the body's own, per `edit-window.md` §8): roving tabindex on rows
(`paintActive` shape, `table-editor.js:259-267`), Up/Down skip hidden
(collapsed) rows, Shift+Up/Down extend (the Shift rule above), Home/End
first/last visible row, Ctrl+A / Ctrl+Shift+A as above, Space / Shift+Space
toggle selection / done on the focused row, Left/Right and Enter
collapse/expand, Delete the delete verb, Tab / Shift+Tab indent / outdent
released at the grid's edges (`table-editor.md` §8.4's edge rule), Esc
cancels on one press (`docs/ui/list-editor.md` §8.2 — this window has no
live range or fill to claim the first press).

## 5. Apply, Cancel, invalidation

```
apply():
  1  if (!state) return;                                     // not open
  2  if (stale) return;                                       // Apply is disabled in stale; belt
  3  if (!container || !viewerContentEl.contains(container))
       { goStale(); return; }                                // a guard failure closes nothing
  4  plan = rebuildPlan();
     if (!plan) { setStatus("Could not apply — the list was not changed");
                  return; }                                  // stays open, note clean
     if (plan.empty) emptyFocus = { next: container.nextElementSibling,
                                   prev: container.previousElementSibling };
                                                              // capture before any mutation (§3 step 7)
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
       catch { viewerContentEl.innerHTML = savedHtml;
               setStatus("Could not apply — the list was not changed");
               return; }                                     // stays open, note clean
 10  NB.hybrid.onContentChange();                            // dirty + autosave + the debounced snapshot
 11  if (plan.empty) { close({ focusList: false }); focusAfterRemoval(emptyFocus); }
     else close({ focusList: true });
```

- **Ordering is load-bearing**: flush (7) strictly before the first mutation
  (9), `onContentChange` (10) strictly after — exactly
  `table-editor.js:1984-1991`. One Apply = one note undo step; the modal's
  in-window history never touches the note (`edit-window.js:13-14`).
  **Refusals never close**: a null plan (step 4), a commit failure
  (step 9) or a stale race (step 3) writes the status line and leaves the
  window open; only a successful or a no-op Apply closes.
- **No-op detection.** The structural signature is derived from the plan,
  never from a copy of the DOM: `sig(plan) = {rowIds in document order with
  their depths, the wrappers' ids/tags/attrs in order, the done map}` — the
  done values read the live `checked` property, the one authority
  (`hybrid.js:1614-1645`). `openSignature` is captured at `open()` from the
  opening plan; because the opening plan describes the live container
  exactly (same rows, same wrapper ids), it equals the same walk taken over
  the live DOM at open — which is the sense in which the open-time signature
  is "computed from the container". `current` is derived at Apply from the
  Apply-time plan, and `_signature()` returns both.
  **Proof that move-down-then-up is a no-op:** `rebuildPlan()` is a pure
  function of (a) the model — the flat order, depths, done values — (b) each
  row's open-time child wrapper (read from the DOM, which no verb touches)
  and (c) each row's `sourceTag`. Up/down moves a run one slot within its
  own parent and changes nothing else (§4), so down-then-up restores (a)
  byte-for-byte; (b) and (c) are untouched by construction. The two plans
  are therefore equal, their signatures are equal, and Apply closes without
  a write — even though an implementation keyed on a "something moved" flag
  would have written. The same argument covers a done-toggle cycle and an
  indent-then-outdent pair (§3: the transient level leaves no wrapper in the
  final plan). There is **no `changed` flag**: the signature is strictly
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
  step. Note-level: one Apply is one step against the note's own history.

## 6. In-window history

Attached through `NB.editWindow.attach` in stack mode (§1). Snapshot format —
a **string** (the engine constraint: `capture()` dedupes with
`snap === stack[index]`, `edit-window.js:145`, and `sizeOf()` counts only
strings, `edit-window.js:112-114`):

```js
JSON.stringify({
  rows: [{ i: id, p: parentId, d: 0|1|null, c: collapsed }],  // model order
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
- `sel`/`anchor` are stored because selection is part of the state a
  restore owes the user (§4).

The `table-editor.js:1530-1538` pattern: serialize the model, resolve ids
back to records on restore. `ownText`, `node` and wrapper identity are never
in the snapshot — content is immutable in this modal and the plan re-derives
wrappers (§3).

- **No coalescing.** Every committed verb captures with kind `"structural"`;
  the engine coalesces only `"text"` (`edit-window.js:146-147`), so one verb
  = one entry. A verb whose snapshot equals the top of the stack is dropped
  by the engine's own dedupe — a refused verb never reaches `capture` at all.
- **Restore.** Parse, validate every id resolves in `byId` (records outlive
  deletes; a deleted row's node is still in the live container, §2), rebuild
  `rows` in snapshot order, restore done/collapsed, restore the selection
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
   Mitigated by the commit-time mirror (§3 step 6) and the recommended
   adjacent fix in `onCheckboxChange` (`hybrid.js:7790-7795`).
6. **Turndown wrapper rules** (MAJOR). A child list not last emits a block
   break (`vendor/turndown.browser.js:133`); a non-`<li>` wrapper child
   shifts every number (`:153`). Mitigated by P0 validation (§3) and the P4
   assertion (§3 step 5).
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
    file but its own.

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
