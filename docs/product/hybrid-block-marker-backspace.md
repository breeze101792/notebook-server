# Hybrid: removing a block marker at the content start — interaction spec

Status: proposed for review. Owner: `product-designer`.
Applies to: `static/js/hybrid.js` (`onEnterKey`), `tests/dom/test_dom.js`,
`tests/browser/` (real-engine check).
Related: [hybrid-editing](../architecture/hybrid-editing.md) (positions S/T,
§4 block matrix, §5.2 merge), [hybrid-shortcuts](hybrid-shortcuts.md)
(`Mod+\` clear formatting), [markdown](../architecture/markdown.md) (task
checkbox serialization).

## 1. Verdict

The request makes sense. The block marker (`#`, bullet, number, `>`, `[ ]`) is
a character-like unit that sits to the left of the block's content. Deleting
backward at the first content position should delete that unit and leave the
text as a plain paragraph, without touching a neighbouring block.

One correction to the request: **the key is Backspace, not forward Delete, on
a non-empty block.** Forward Delete deletes what is to the right of the caret.
Binding it to the marker (turn 3 of the request: `# |test` → `|test`) makes
Delete eat the text in every other case and is the most likely reason the earlier
Delete-only attempt felt weird. On macOS the key labelled *delete* is Backspace.

## 2. User model

```text
#   |Title      the marker is one unit, immediately left of the caret
-   |item
>   |quote
[ ] |task       the rendered checkbox is that unit
```

One press removes the marker the caret is against. The text is kept. Caret
stays at the first character of the text (the text shifts left with the
marker; the caret does not keep its pixel x). Previous and next blocks are not
read, merged, or rewritten.

## 3. Key and trigger

### 3.1 Key

| Key | Block has content after the caret | Block is empty |
| --- | --- | --- |
| Backspace | Remove the marker | Remove the marker |
| Delete | **Not claimed** — native forward character delete | Remove the marker |

The empty-block case is the original report ("the rest are empty"): there is
nothing on either side to delete, so both keys would otherwise remove or merge
the line. Claiming both there is the non-destructive reading and costs no text.

Forward Delete on a non-empty block must stay a forward delete. If the user
literally presses Delete on `# |test`, this spec deliberately deletes `t`, not
the heading.

### 3.2 Conditions (all required)

- Hybrid mode active; the collapsed caret is inside `#viewer-content`.
- No `Shift`, `Ctrl`, `Alt`, or `Meta`; not an IME composition.
- The caret is at **T** — the first content position of the caret's *own*
  block, after its marker. For a task item, T is immediately after the
  checkbox (and its zero-width caret host), never before it.
- The block is a heading (`h1`–`h6`), a list item (`li` in `ul`/`ol`, including
  a task item), or a block element directly inside a `blockquote`.
- The block is not inside a `<table>` or a `<pre>` and is not an atomic plugin
  block.
- No non-collapsed selection. `Shift+Delete` (cut) is never claimed.

**Empty** (for the Delete row) means: no text and no embedded content (image,
media, void) after T. Ignore the marker checkbox, the zero-width caret host,
and the marked caret `<br>`. A leading image therefore counts as content, so
Delete removes the image, not the heading; Backspace still removes the heading
and keeps the image.

### 3.3 S versus T

For headings, bullets, ordered items, and quotes the marker is CSS, not a DOM
node, so T is the only reachable start position: the rule replaces the native
Backspace-at-start merge for those blocks. For a task item, S (before the
checkbox) is a distinct position and is not this gesture.

Consequence: the first Backspace peels formatting; a second Backspace (now on a
plain paragraph) performs the native merge. This is the deliberate cost of the
request: "do not remove the previous block" outranks one-press Word-style
merge.

## 4. Per-block result

| Block | DOM result | Caret | Markdown |
| --- | --- | --- | --- |
| Heading | `<hN>` → `<p>`; all children moved, inline runs kept | first content position of the `<p>` | `## Title` → `Title`; empty `##` → blank line |
| Bullet item | item leaves the list as a `<p>` at its position; the list splits before/after | first content position of the `<p>` | `- item` → `item` |
| Ordered item | same as bullet | same | `1. item` → `item`; remaining items keep their displayed numbers |
| Task item | checkbox + `task-list-item` class removed, then the item leaves the list as a `<p>` | first content position of the `<p>` | `- [ ] item` / `- [x] item` → `item` |
| Quote | the caret's own direct child is lifted out of the nearest `blockquote`; the quote splits around it | first content position of the lifted block | `> item` → `item`; `> a` + `> b`, caret on `a` → `a` + `> b` |
| Empty formatted block | one empty `<p>` with the marked caret line box | start of the empty `<p>` | no marker; the blank line is not representable on reload (see §6) |

Rules that fall out of the table:

- **Innermost marker wins.** `> # Title` → `> Title`; a second press → `Title`.
  `> - item` → `> item`; a second press → `item`. `> > q` → `> q`; a second
  press → `q`. One press peels one layer.
- **Only the caret's item.** A nested list under a task item is structure, not
  content: it survives after the new paragraph (the existing
  `listItemToParagraph` hoist).
- **Task checked state is discarded** with the checkbox. Removing the format is
  not a toggle to "unchecked".
- **Inline formatting survives.** `# **Bold** title` → `**Bold** title`. This is
  the same contract as `Mod+Alt+0`; use `Mod+\` for inline emphasis.

## 5. What must not happen

- The previous and next blocks are not merged, emptied, restyled, or
  re-serialized (except the list/quote container the edit splits, §6).
- No text is lost, including the first character of the block.
- The line keeps its text; only the marker goes.
- No stray `#`, `-`, `1.`, `>`, `[ ]`, `[x]`, checkbox, sentinel, zero-width
  space, or HTML reaches the saved file.
- A non-collapsed selection, a modifier chord, a mid-block caret, a table cell,
  a fence, an atomic block, or an `<hr>` never triggers it.
- Forward Delete on a non-empty block is not prevented.

## 6. Write-back and history

- One `onContentChange()` call: one dirty transition, one save, one history
  entry request. Do not call `pushSnapshot` separately.
- Heading and lift edits keep the element count where possible; the splice
  re-serializes only the edited block. A list split changes the block count, so
  the whole list is re-serialized, as the existing list toggle already does:
  marker spelling inside that list may canonicalize (`*` → `-`), but no block
  outside the list changes.
- **Ordered lists:** after the split, the trailing list's first item must
  display the number it displayed before the edit (set `start` when it does not
  begin at 1). `1. a` / `2. b` / `3. c`, caret on `b`, must save with `a` still
  `1.` and `c` still `3.`, not `1.`.
- **Empty block:** the empty `<p>` carries no marker and contributes no text.
  Markdown cannot represent an empty paragraph, so the serializer may drop it
  and leave the surrounding blank run unchanged; no marker is written. This is
  inherent, not a bug. The live editor keeps the empty line until reload.
- **Undo:** one undo restores the formatted block and its marker. The existing
  history restores a caret to the block, not the exact T position; that
  limitation is unchanged.

## 7. Interaction with existing behavior

| Existing path | Effect |
| --- | --- |
| Task item edge merge (`mergeTaskItemAtEdge`) | The new rule runs first at T, so a task item at T strips instead of merging. The merge remains for Delete at the content end and for S. |
| Native Backspace merge for headings/lists/quotes | Replaced at T by this gesture; the second Backspace merges. |
| Enter on an empty list item / quote line | Unchanged. |
| Clear formatting (`Mod+\`) | Unchanged; it is the multi-block, inline-inclusive action. This gesture is one block and marker-only. Do not implement it through `clearFormatting` (it keeps inputs, so a checkbox would survive). |
| Delete at a block end (forward merge) | Unchanged. |
| Rules, atomic blocks, emptied fences, table selections, whole-note clear | Unchanged; the trigger excludes them and the guards are disjoint. |
| Source (CM6) and preview modes | Unchanged; the gesture is hybrid-only. |

Implementation order in `onEnterKey`: after the fence/table/whole-note/list
selection guards and before the task-merge and rule/atomic branches, so the
task edge merge cannot shadow it.

## 8. Ranked edge cases

| Rank | Case | Expected |
| --- | --- | --- |
| 1 | Task item at T: `[ ] \|test` | Checkbox gone, `test` in a plain paragraph, caret before `t`. |
| 2 | Forward Delete on a non-empty block | Native: deletes the first character; no transform, not prevented. |
| 3 | Empty formatted block: `# \|`, `- \|`, `> \|`, `[ ] \|` | Marker gone, one empty paragraph, caret at its start, no merge with either neighbour. |
| 4 | Delete on an empty formatted block | Same as Backspace-on-empty. |
| 5 | Heading inside a quote: `> # \|Title` | `> Title`; quote kept. |
| 6 | List inside a quote: `> - \|item` | `> item`; quote kept, list removed. |
| 7 | Multi-line quote, first/middle/last line | Only that line is lifted; the rest stay quoted. |
| 8 | Ordered list, middle item | Split; trailing items keep their numbers. |
| 9 | Nested list item | Only that item loses its marker; its children are hoisted after the new paragraph, not deleted. |
| 10 | Empty task / checkbox-only item | Checkbox gone; empty paragraph. |
| 11 | Leading inline element (image, link, emphasis) | Block marker removed; the element is kept. A leading image is content, not the marker. |
| 12 | Leading whitespace in the block | Treated as the start (whitespace is not content); the marker is removed and the whitespace kept. |
| 13 | Non-collapsed selection, any modifier, mid-block caret | Not claimed; native edit. |
| 14 | Table cell, fence, atomic block, `<hr>` | Not claimed. |
| 15 | Caret at S of a task item (before the checkbox) | Not this gesture; behavior unchanged. Recommended follow-up: Delete at S removes the checkbox (marker to the right), symmetric with Backspace at T. |
| 16 | Holding Backspace | One layer per key repeat; after the first, the block is plain, so further repeats hit native merge. |
| 17 | Only block in the note | Marker removed, empty paragraph; an empty save writes no marker. |

## 9. Acceptance criteria (Given/When/Then)

1. **Heading.** Given `<h2>Title</h2>` with the caret at T, when Backspace,
   then the block is `<p>Title</p>`, the caret is collapsed at the start of
   `Title`, and the saved note is `Title` with no `##`.
2. **Empty heading.** Given an empty `<h3>` (marked caret line box only), when
   Backspace (and, separately, Delete), then it is an empty `<p>` with no `###`
   in the saved note.
3. **Bullet, single item.** Given `<ul><li>item</li></ul>` at T, when
   Backspace, then `<p>item</p>`, the list is gone, and the saved note is
   `item`.
4. **Bullet, middle item.** Given `- a` / `- b` / `- c` and the caret at the
   start of `b`, when Backspace, then `b` is a paragraph between the two
   remaining bullets; `a` and `c` are still bullets and the saved note contains
   no `- b`.
5. **Ordered, middle item.** Given `1. a` / `2. b` / `3. c` and the caret at
   `b`, when Backspace, then `b` is a paragraph and the rendered/saved numbers
   of `a` and `c` are still `1` and `3`.
6. **Task, unchecked and checked.** Given a task item with the caret at T, when
   Backspace, then the checkbox and `task-list-item` are gone, the block is a
   `<p>`, and the saved note is the bare text (no `[ ]` and no `[x]`).
7. **Empty task.** Given a checkbox-only item with the caret after the
   checkbox, when Backspace, then the checkbox is gone and the block is an
   empty `<p>`; no `- [ ]`.
8. **Quote, one line.** Given `> quote` at T, when Backspace, then the block is
   a top-level `<p>quote</p>` and the saved note is `quote`.
9. **Quote, multiple lines.** Given `> a` / `> b` and the caret at the start of
   `a`, when Backspace, then `a` is a paragraph and `> b` remains; with the
   caret at `b`, the mirror result.
10. **Nested formats.** Given `> # Title`, when Backspace at T, then the result
    is `> Title`; a second Backspace gives `Title`.
11. **Forward Delete.** Given `<h2>Title</h2>` at T and the content non-empty,
    when Delete, then the transform does not run and `defaultPrevented` is
    false.
12. **Empty Delete.** Given an empty `<h2>` at T, when Delete, then it becomes
    an empty `<p>` and the default is prevented.
13. **No trigger.** With a non-collapsed selection, with Shift/Ctrl/Alt/Meta
    held, with the caret mid-block, or with the caret in a table cell, fence,
    atomic block, or on an `<hr>`, the transform does not run and the key is
    not prevented.
14. **Neighbours intact.** Before/after the edit, the previous and next blocks'
    DOM and saved bytes are unchanged; no merge occurs.
15. **One step.** The transform sets dirty once, and a save writes once; one
    undo restores the original element and marker.
16. **Clean output.** After every case, `domToMarkdown()` contains no HTML, no
    zero-width space, and no sentinel; no case writes a marker prefix before
    the preserved text.
17. **Inline runs.** Given `<h2><strong>Bold</strong> title</h2>`, when
    Backspace, then `<p><strong>Bold</strong> title</p>` and the note saves
    `**Bold** title`.
18. **Hybrid only.** Repeating the gesture in preview and source mode changes
    nothing and does not prevent the key.

## 10. Open decisions

- **D1 (confirmed here):** Backspace removes the marker on any block; Delete
  does so only when the block is empty. If the user actually presses forward
  Delete on `# |test` and expects the marker gone, that requirement conflicts
  with forward-delete and should be rejected, not implemented.
- **D2:** Accept that the first Backspace no longer merges a formatted block
  into its neighbour. The second press merges. Document it in the shortcut
  help.
- **D3:** Split the quote rather than lift the whole quote, so a multi-line
  quote loses only the caret's line.
- **D4:** Preserve ordered-list numbering across the split (required; the
  existing list toggle has the same latent issue).
- **D5:** Out of scope: inline emphasis at the content start, multi-block
  selections, and stripping a checked task's state as a separate action.
