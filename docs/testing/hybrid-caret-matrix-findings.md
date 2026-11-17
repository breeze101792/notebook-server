# Hybrid caret matrix — what it runs and what it found

Real-browser matrix for hybrid (WYSIWYG) editing: every construct in
`../architecture/hybrid-editing.md` §4 at every position of the §3 key (S, T, M, E,
B, ∅) with every key §4 assigns, asserting the exact note bytes after a save.

Owner: `build`. Decisions behind the triage: `../product/hybrid-caret-matrix-priority.md`.

## Run

```sh
PORT=5090 node tests/browser/test_hybrid_browser.js
```

The matrix is a section of that suite, per §8.2 ("extend it; do not add a separate
runner"). Data: `tests/browser/matrix/hybrid-caret-matrix.json` — 159 rows, plus 31
rows that cannot be expressed as a key stroke and are listed with a reason.

Each row writes its own note, boots it, enters hybrid through the real `#hybrid-toggle`,
places the caret, presses the real key, saves, exits, and reads the file back. A row
also fails on: any HTML tag outside a fence, editor chrome in the file, a sentinel
character, an uncaught page error, or a `POST` on a row whose bytes did not change.

Row `status` decides how a result is reported:

| status | meaning | counts as |
|---|---|---|
| absent | must pass | ok / failed |
| `accepted` | by design or native; the transcribed §4 cell over-specifies | reported, not scored |
| `known-bug` | a real defect, recorded here | reported, not scored |
| `blocked` | the docs pin no expected bytes, or the fixture has no target | observed only |
| `engine` / `spec-divergent` | contract row under open question | reported, not scored |

A `known-bug` row that starts matching prints "now match"; move it back to an asserted
row at that point, so the suite proves the fix forever.

## Current result

86 asserted rows pass, 0 fail. 50 accepted, 0 known-bug, 3 engine, 20 blocked,
31 not expressible.

## Fixed against this matrix

| Row(s) | Defect | Fix |
|---|---|---|
| `bullet/ol/task.delete.block.1` | Selecting one item's text and pressing Delete removed the item and, when it was the last, the whole list — marker gone | A one-item selection clears the content and keeps the item and its marker (`clearListItemContent`) |
| `nested.backspace.T.1` | Peeling a nested item's marker left the lifted paragraph inside the parent `<li>`, saving whitespace-only lines | The lift now leaves the whole list (`outerListOf`), the item's formatting newline is dropped (`stripLiftGap`), and a task item under a task parent still joins that parent's text (§5.2 merge) |
| `bullet/ol.enter.EMPTY.outdent` | Outdenting an empty item wrote a line holding one space (the empty item's marker space was lexed as a source gap and re-appended) | `structuralSplice` drops a whitespace-only suffix with at most one newline |
| `nested.delete.block.1` | Reported as "the note is emptied": the fixture `- a\n    - \n` renders **no** nested item, so the runner selected the whole note | Row is `blocked`; the runner now refuses a structural selection whose selector matches nothing |
| `indented.type.E.1` | Typing at the end of indented code measured no change: the runner put the caret past the Copy button inside the `<pre>` | Caret modes target a fence's `<code>`; a fence row now types into the code |
| `h2.delete.block.1` | Emptying a heading saved `###   ` | An empty heading is written as its marker alone |
| `- **a** *b*` + the UL/Task button | A whitespace-only text node between two inline siblings was dropped along with the placeholder, so "a b" saved as "ab" | Only zero-width-only / newline-only nodes are dropped |
| Loose and tight `- [ ] task` + Delete then type | A loose task item cleared nothing (the checkbox sits inside its `<p>`); a tight one left the caret before the box, so the next character typed over the marker | The clear descends to the checkbox's container and places the caret in a host after the box |
| Nested item with a following sibling | Peeling it lifted the paragraph past its siblings and reordered the note (`a, b, c` → `a, c, b`) | The key is claimed and the note left alone; outdenting it one level is the follow-up |
| An edited fence holding `    ` or `##   ` | The new line-shape rules rewrote code bytes (`##   ` → `##`, a space-only line → empty) | Fenced blocks are masked before those rules run and restored after |
| `inline.*.type` | Live inline rules "never fired" — a harness timing artifact | Type steps wait 15 ms per character |
| `quote.backspace.T.1`, `quote.type.M.1` | Peeling a quote line "did nothing" — the runner's caret counted whitespace text nodes and landed before the block; "middle" was measured on `textContent` | `texts()` skips whitespace nodes; M is the middle of the content |

## Reclassified, not a defect

`hr.delete.keepblank` looked like "removing a rule collapses the user's blank run". It
is the shipped rule: a deleted block consumes its separator and keeps the run that
precedes it — the behaviour the jsdom contract pins as
`blankrun: a middle delete keeps the preceding run, consumes the separator`
(`x\n\n\nb\n\ny\n` → `x\n\nb\n\ny\n`). With `alpha\n\n---\n\n\n\nomega` that
yields `alpha\n\nomega`, which is correct. The transcribed §4.11 cell ("the user's
blank run survives") was read too literally.

An attempt to test that guard by root-content signature instead of node count did not
change the result and touched the byte-preservation engine, so it was reverted rather
than shipped unproven.

## Accepted divergences (by design)

| Class | Rows | Why |
|---|---|---|
| Enter / Shift+Enter at the end of a block writes no extra bytes | 17 | A new empty block contributes nothing (`structuralSplice` EOF rule); the state is not representable in Markdown. Typing into the new block does write it. |
| A brand-new note ends with a blank line | 21 | The whole-DOM path terminates every block with a blank line; the file is stable on the next save. |
| A structural edit at EOF ends with a blank line | 6 | Same convention, applied by `structuralSplice`. |
| Delete/Backspace beside a rule deletes one character | 2 | §4.11 says the rule survives; the character delete is the engine's normal behaviour and the transcribed bytes over-specify. |
| A mid-paragraph Enter keeps the separating space at the start of the second block | 1 | Native split; renders identically. |

## Harness defects found (fixed)

They made rows look like product bugs; they matter for anyone extending the matrix.

1. **Caret placed in a whitespace text node.** marked leaves the newlines between a
   block's children as text nodes; "T" of a quote or list landed before the block.
2. **Caret placed during the entry paint.** The session re-seats the caret once live;
   a caret placed before that is discarded.
3. **"M" measured on `textContent`**, which includes that whitespace, so the middle
   landed a character late.
4. **Typing with no delay outran the live inline rules.**
5. **A selector that matched nothing silently selected the whole note** and recorded a
   note-wiping "P0". Structural selections now fail the row instead.
6. **A fence's "end" was the end of the `<pre>`**, i.e. the Copy button, so typing
   there measured no change.

## Not covered here

See `../product/hybrid-caret-matrix-priority.md` §6. Paste, drag geometry, the table
modal, phone gestures, and visual tokens have their own suites.
