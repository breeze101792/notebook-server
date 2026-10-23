# Hybrid editing behavior specification

Status: draft for discussion. Owner: `product-designer`.
Applies to: `static/js/hybrid.js`, `templates/index.html`, `tests/dom/test_dom.js`,
`tests/browser/test_hybrid_browser.js`.

This document is the authoritative catalog of what hybrid (WYSIWYG) editing must do
for every Markdown construct at every caret position, under every edit operation.
It is written to be read *before* the code is changed, so behavior is decided once
here instead of case-by-case in `hybrid.js`.

## Overview

Hybrid mode makes `#viewer-content` `contentEditable` (`enter()` at
`hybrid.js:3237` sets the attribute at `hybrid.js:3255`), the user edits the
rendered DOM, and the DOM is converted back to Markdown on save. The renderer
pipeline and the block registry are described in
[markdown.md](markdown.md); this document owns the editing behavior and the
write-back contract.

## The goal

> **Hybrid mode should let the owner edit a Markdown note the way they edit a
> document in Microsoft Word.** The words come first; formatting is applied to
> them and rendered in place. The owner should not have to think in Markdown
> while editing — but the file on disk must stay readable, hand-editable
> Markdown.

That goal decides every open question in this document. Four consequences:

**G1 — Word-like editing.** Editing in hybrid feels like a word processor: put the
caret anywhere, type, select, format, cut, paste, undo. Block markers (`#`, `-`,
`>`) are rendered, not typed. The rendered view is the editing surface.

**G2 — Rich blocks keep a rendered view and a source editor.** A special fenced
block (`mermaid`, `wavedrom`, `math`, `dot`, `html-live`) renders its result in
place. The owner edits it the same way they edit a code block: entering the block
switches to a source-editing mode for that block (already the click-to-edit
behavior), then leaving it re-renders. The block is atomic while not being edited.

**G3 — Tables have their own editing tool.** A table is edited with table-specific
controls (add/remove row and column, move a row or a column, header toggle), not by
typing pipe characters. The rendered table is the editing surface; the tool writes
GFM.

**G4 — The file stays clean Markdown.** The rendered DOM is an editing
convenience only; it must never leak presentation HTML into the saved file. No
`<br>`, `<div>`, `<span>`, `<table>`, or any other tag may be written that was
not already in the owner's source (see the decision below). A reader opening the
`.md` in a text editor must see ordinary Markdown.

### The line-break rule

> **In hybrid mode, one `Enter` adds one line break — never several. The editor
> must not invent extra blank lines the owner did not type.**

The rule is about the editor's behavior while editing, not about the shape of the
Markdown file. Blank lines between blocks are ordinary Markdown and stay; what is
forbidden is a single `Enter` producing more newlines than the owner asked for, or
a `<br>` tag leaking into the file (goal G4).

What "one `Enter`, one break" means in hybrid:

- The owner presses `Enter` once. The caret goes to a new line. The result is one
  line break — not two, not four.
- The owner does not press `Enter`, and no new blank line appears. No idle
  action, click, focus change, or save may add or double a break.
- A `<br>` stays inside the editing DOM; `domToMarkdown` converts it to Markdown
  before the write (verified: an in-block `<br>` becomes a Markdown break, never a
  literal tag).

Verified today: **hybrid currently violates this.** Real Chromium, this revision:

| Action | Today | Should be |
|---|---|---|
| `Enter` at the end of a paragraph | `alpha beta\n\n` (two newlines) | one break |
| `Enter` mid-paragraph | `alpha\n\n beta\n\n` (four newlines, block split) | one break |
| `Enter` on a list item | `-   item\n-   \n    \n` (trailing blanks) | one break |
| `Shift+Enter` | a new block below the current one | decided: keep the next-line-out behaviour (Q15) |

These are the real "flaky" the owner reports: lines growing blank separators from a
single keypress. They are Q18 in §6.

For the record, no `<br>` reaches the file from these paths. The vendored Turndown
converts an in-block `<br>` to a Markdown break; the file never gains a literal tag.

Verified in real Chromium: the owner's example `## Commands\n###\n### `   `\n`
survives enter+exit byte-identically, and editing the `## Commands` line keeps both
`###` lines intact. So *preservation* already works; the gap is only in what an
`Enter` *creates*.

**Not in scope of this rule (correction).** An earlier draft of this document
misread the rule as "the file must have no blank line between blocks" and proposed
flipping the renderer to `breaks:true` (Q17). That was wrong: the owner's rule is
about hybrid's edit behavior, not the file format or the renderer. Blank lines
between Markdown blocks are normal and stay; `breaks` is left at its current
setting. Q17 is withdrawn.

## Decisions taken

These are settled by the owner and override any conflicting recommendation below.

| # | Decision | Consequence |
|---|----------|-------------|
| Q1 | **Structural edits preserve untouched blocks.** Enter, Shift+Enter, Backspace/Delete, list outdent, and rule delete no longer canonicalize the rest of the file. | ✅ Implemented: `structuralSplice` (`hybrid.js:986`) matches the DOM against the baseline by content hash from both ends and re-serializes only the changed middle. Verified in Chromium: `Enter` in `first\n\n* star a\n* star b\n\nTitle\n=====\n\n    indented\n` keeps all three untouched forms byte-for-byte (before the fix it produced `-   star`, `# Title`, and even `` ```undefined ``). |
| G4 | **No presentation HTML in the file.** Raw DOM artifacts (`<br>`, `<div>`, caret line boxes, `<table>` built during editing) must be converted to Markdown before the write. Only HTML the owner already had may survive (Q10). | Confirms invariant I4; every new line-insert / paste / table path is checked against it. |
| G4b | **One `Enter` adds one line break (Q16).** In hybrid, a single `Enter` must not produce several newlines. No idle action adds a break; no `<br>` reaches the file. Blank lines already in the Markdown stay. | Invariant I9, criterion AC7. The bugs it exposes are Q18. |
| G2b | **Special fenced blocks: render in place, edit as source.** Entering a plugin block switches that block to a source editor; leaving it re-renders. The block is atomic while not edited. | Confirms the existing click-to-edit model (`editPluginSource` `hybrid.js:4080`) as the spec, not an ad-hoc feature. |
| G3b | **Tables edit through the table tool, not by typing pipes.** Row/column add, remove, move, and header toggle are the editing surface. | Confirms `table-edit.js` / the existing table controls as the spec; the rendered table is the surface. |
| Q5 | **Add the missing live input rules** for `_italic_`, `+ ` bullets, `1) ` ordered lists, and `[[wikilinks]]`. Note: these rules did **not** exist in the code before this change (the pre-change `INPUT_RULES`/`INLINE_RULES` had only `#`, `-`/`*`, `\d+.`, `>`, `[ ]`). | ✅ Implemented. `_italic_`/`[[ ]]` in `INLINE_RULES` (`hybrid.js:1559`), `+ `/`1) ` in `INPUT_RULES` (`hybrid.js:1486-1553`); `NB.viewer.resolveWikilink` exported so the rule matches render. Verified in Chromium and jsdom. |
| Q9 | **Paste parses Markdown into blocks.** Plain-text insert stays available via the menu's "Paste without formatting"; rich HTML is stripped to text. | `doPaste` gains a Markdown-parse path; verify in the Chromium harness. |
| Q10 | **Raw HTML is editable in place** (not made read-only). | The `html` token must be aligned by the splice so an edit does not force whole-file fallback. **Open fork:** what an *edited* raw HTML block writes back is undecided — preserve the user's tags, or unwrap to text (§6 Q10). |
| Q16 | **One `Enter`, one break, in hybrid mode.** The rule is about the editor's behavior, not the file format. A single `Enter` must not add several newlines. | Invariant I9, criterion AC7. |
| Q18 | **Fix the extra-break defects found in real Chromium.** An empty list item marked with a `<br>` saved as junk (`-     \n    \n`) instead of a bare marker. | ✅ Implemented: `markEmptyListItems` (`hybrid.js:305`) strips the line box before the sentinel; the item saves as a bare marker. Verified in Chromium and jsdom. |

## Test suite

The spec is enforced by a data-driven contract table in `tests/dom/test_dom.js`
(`HYBRID_CONTRACT_CASES`, 69 cases, consumed by the loop that follows it) plus
native-engine cases in `tests/browser/test_hybrid_browser.js` (Chromium). A
`[defect]` tag on a case names a code defect the test pins; all are now fixed.
The coverage map is a comment at the top of the jsdom section.

Results at this revision: jsdom **2411 ok, 0 failed**; the Chromium harness
**69 ok, 0 failed** (the last two were the horizontal-rule preview-selection
case, fixed by re-measuring the rule box after leaving hybrid mode -- the
format bar's removal shifts the rule). Backend `unittest` **209 OK**.

### Defects found by the suite and fixed

| # | Defect | Fix |
|---|--------|-----|
| C1 | An empty-line insert (Shift+Enter, a bare Enter leaving an empty block) fell back to the whole-DOM serializer, canonicalizing untouched blocks. | `structuralSplice` splices a pure empty-block insert instead of returning null; the inserted empty block contributes no text, so the file stays byte-identical. |
| C2 | Deleting one of two byte-different blocks with equal content (`* a` / `- a`) kept the wrong twin's bytes. | Prefix/suffix matching now uses the element node as a tie-breaker when a change key is ambiguous. |
| M1 | A 32-bit FNV-1a collision (`5ur85a` / `qnef9u`) made a real edit look unchanged, silently writing nothing. | Change detection compares the collision-free canonical string, not a 32-bit digest. |
| M2 | A nested empty blockquote `> >` collapsed to `>`. | `markEmptyBlockquotes` treats a nested quote/list/fence as content; only a bare quote gets the sentinel. |
| M3 | An unresolved `[[NoSuchNote]]` saved as an escaped `\[\[NoSuchNote\]\]`. | The unresolved wikilink carries a raw marker and a serializer rule emits the literal `[[...]]`. |
| escape-# | A leading `#` with no following space (`#no-space`) saved unescaped and re-read as a heading. | `escapeLeadingHashes` escapes a leading `#` run that is not a valid ATX heading, outside fences. |
| new-note-# | The first block trigger typed into a **brand-new empty note** stayed literal: a bare text node under the empty root failed the root-caret guard's `firstChild` test, so `# ` never converted and saved as the escaped `\# `. | `applyBlockRules` refuses only real **block** content (`hasBlockContent` ignores the placeholder `<br>`), so an empty root is wrapped in a `<p>` and the block rules fire; a root `<br>` line box is dropped first. Verified in jsdom and Chromium. |
| Q10 | An untouched raw HTML block (`<div>x</div>`) lost its tags on a clean save. | `html` tokens are aligned by the element count they render, so an untouched raw block keeps its bytes. A raw `<table>` is the exception and still falls back so it converts to GFM. |

### Defects found by the second-round adversarial review and fixed

Each of these has a `[defect]`-tagged case in `HYBRID_CONTRACT_CASES` and was
reproduced through the real `hybrid.js` + vendored marked/Turndown in jsdom.

| # | Defect | Fix |
|---|--------|-----|
| refdef | A note containing a link-reference definition (`[id]: url`) disabled the whole splice: marked's Lexer consumes the definition line into `tokens.links` and omits its raw, so `topLevelBlocks`' reassembly check failed. The next edit then canonicalized the file and **deleted the definition**. | `topLevelBlocks` walks the token stream in order, consumes runs of definition lines at the cursor with marked's own def rule (`defLineRegex`), and requires each raw to start exactly there; any other byte fails closed. The definitions become synthetic `def` blocks carried verbatim (they own no element, so `tokenElementCount` skips them). |
| refdef-adjacent | The first version matched token raws with `indexOf`, so a definition line followed by a paragraph whose text also occurs inside it (`[docs]: url` then `docs`) matched the paragraph inside the definition and rejected a legitimate note. | The cursor walks forward only; a token raw must start where the cursor stands, so an earlier occurrence inside a definition is never mistaken for the token. |
| refdef-straddle | A delete that spanned a definition line dropped it: the `def` token owns no element, so it was in neither the prefix nor the suffix of `structuralSplice`. | Definitions inside the replaced region are re-inserted, anchored to the count of SURVIVING region blocks whose baseline token precedes the definition, so the definition stays beside the block it followed even when other region blocks were deleted. |
| escape-lt / escape-amp | Turndown's escape table has no rule for `<` or `&`, so a paragraph displaying `use <b> for bold` or `write &copy; here` saved as real HTML / a decoded `©` -- injecting HTML and changing the visible text (I4/I6/G4). | `escapeRawHtmlEntities` escapes `<`/`>` inside tag-shaped runs and `&` only where it forms an entity, on non-code parts of every line. Fenced code, inline code spans, link/image destinations, and autolinks are skipped byte-for-byte; a bare `>` (a quote marker) is never touched. |
| escape-fence-width | The escape pass tracked only the fence character, so a fence widened by turndown (because its body contains a backtick run) was closed early and its later lines were escaped, corrupting code. | The fence tracker keeps the whole delimiter (char + length, closing run >= opener), as `escapeLeadingHashes` already did. |
| escape-backtick | The escape scanner tested for a backtick without first honoring a backslash escape, so a literal `` \` `` opened a phantom code span and a following literal tag/entity was copied verbatim and saved as live HTML. | The scanner consumes `\` + the next character as literal text before any delimiter test. |
| escape-link-dest | A link destination is not text, but the escape pass rewrote a URL that contained a tag-shaped run (`?q=<tag>`). | `](...)` destinations and `<scheme:...>` autolinks are copied verbatim. |
| inline-comment | An inline HTML comment (`<!-- keep -->`) is a comment node that Turndown's `process()` ignores, so editing the surrounding paragraph dropped it. | `stashComments` replaces every comment node in the clone with a restorable placeholder before the conversion; `postProcessMarkdown` puts the original `<!-- ... -->` back. |
| task-gap | Marked trims a list's trailing space into a separate gap token (raw `" \n"` for `- [ ] \n`); the splice borrowed only the gap's newlines, doubling the separator into junk (`- [ ]  \n\n \n`) when a sibling task item was edited. | The gap borrow takes the whole gap but drops its leading spaces/tabs, since the list serializer re-emits the marker space; the newline run is kept whole. |
| blankrun-eof | A structural delete at EOF trimmed to one trailing newline, collapsing the user's blank-line run (`a\n\n\n\nb\n` minus `b` became `a\n`, not `a\n\n\n\n`). | The pure-delete-at-EOF branch keeps the prefix bytes (the gap run) exactly and only ensures a non-empty file ends with a newline. |
| eof-newline | A block edited when the file had no trailing newline gained a blank line (`a\n\nb` -> `a\n\nB2\n\n`). | The splice appends no separator after a last block whose raw carried no trailing newline. |
| sentinel-nonce | The comment claiming Turndown strips NUL is false; real note text containing a literal sentinel token (Clipboard paste, plugin edit) would be silently rewritten by the global post-serialization replacements. | Every sentinel carries a per-session random `SENTINEL_NONCE`, so a token cannot exist in any file written before the session. |

### Defects found by adversarial review of the fixes

| # | Defect | Fix |
|---|--------|-----|
| C4 | A text edit was silently reverted when it shared a save with a structural edit (type a word, press Enter, save): the region's unchanged-node path did not compare the content key. | The kept-raw branch now requires `curKeys[i] === blockHashes[kept].key`; an edited node falls through to serialization. Verified in Chromium. |
| fence | `escapeLeadingHashes` did not recognize a fence inside a blockquote, and closed any backtick fence on a shorter delimiter, corrupting `#` inside code. | Track the whole delimiter (char + length), allow a `> ` prefix, and require a closing fence at least as long as the opener. |
| M3b | The M3 fix only covered a live-typed wikilink; one already in the source still saved as `\[\[...\]\]`. | The renderer emits an unresolved wikilink as `<span data-wikilink-raw="1">[[...]]</span>` (`viewer.js:104`) and the serializer rule (`hybrid.js:201`) keys off the attribute. |
| Q12 | **An empty heading must accept typed text.** It has zero height in a real browser and the caret was redirected into the next block (typing at `###` produced `Hellobody` inside the paragraph). | ✅ Implemented: `addEmptyLineBoxes` (`hybrid.js:1442`) gives every empty block a marked caret line box at enter/render; the box is stripped on save. Verified in Chromium. |
| Q7 | **An emptied blockquote survives as `>`.** Turndown drops an empty `<blockquote>` outright, unlike an empty heading or list item. | ✅ Implemented: `markEmptyBlockquotes` + `EMPTY_QUOTE_SENTINEL` (`hybrid.js:67`). Verified in Chromium and jsdom. |

The goal **G1–G4** governs every open question: where a recommendation below would
make hybrid less Word-like, less clean in the raw file, or would add HTML, the goal
wins.

Open questions are Q2, Q3, Q8 (cell boundary keys), and Q14.
Their recommendations are recorded but not yet accepted.

---

## 1. Scope, source of truth, invariants

### 1.1 Scope

In scope: hybrid mode only — `#viewer-content` is `contentEditable`, the user edits
rendered elements, and the DOM is converted back to Markdown on save. Preview mode,
the CodeMirror source editor, the AI assistant's `/api/edit` clients, and `export.js`
are out of scope except where they share the write-back contract.

In scope constructs: ATX and setext headings; paragraphs; bullet/ordered/nested/task
lists; blockquotes; fenced and indented code; horizontal rules; GFM tables;
blank-line runs; HTML comments and raw HTML; the six special fenced blocks
(`mermaid`, `wavedrom`, `math`/`katex`, `dot`/`graphviz`, `html-live`) and plain
fences; and the inline constructs (`**bold**`, `*italic*`/`_italic_`,
`~~strike~~`, `` `code` ``, `[link](url)`, `![image](src)`, autolinks,
`[[wikilinks]]`, entities/`&nbsp;`, and literal syntax characters).

### 1.2 Source of truth

Per `PLAN.md:12-19`, the `.md` file is the document; the DOM is a view of the region
being edited.

- The on-disk source is held in `sessionSource` (`hybrid.js:135`).
- On save, `domToMarkdown()` (`hybrid.js:614`) tries `spliceSave()`
  (`hybrid.js:895`) first, then falls back to `wholeDomMarkdown()`
  (`hybrid.js:578`).
- `spliceSave` replaces only blocks whose content hash changed; every untouched
  `block`/`gap`/`raw` segment emits its original bytes (`hybrid.js:913-980`).
- The splice fails closed — returning `null` and handing the *whole file* to
  `wholeDomMarkdown` — when there is no live session baseline
  (`hybrid.js:899`), when the root-level text/comment count changes
  (`hybrid.js:901`, guard against `rootAuxBaseline`), or when the source did
  not lex exactly (`topLevelBlocks` returns null, `hybrid.js:625-637`).

**This last point governs the entire catalog.** A text-only edit inside one block
keeps every other block byte-for-byte. Any edit that changes the number of top-level
elements — `Enter`, `Shift+Enter`, `Backspace`/`Delete` merges, list outdent, rule
insert/delete, structural paste — goes through `structuralSplice` (Q1), which
matches blocks by content hash from both ends and keeps every untouched block's
bytes; only when even that cannot align does it fall back to whole-DOM
serialization, which re-serializes and canonicalizes the *entire* file.

**Q1 is decided:** the structural path preserves untouched blocks. §5.5 describes
the mechanism.

### 1.3 Invariants

I1. **No words lost.** Every edit preserves the text the user typed or already had,
    except text the user explicitly deleted.
I2. **No format lost unintentionally.** A construct the user did not touch keeps its
    source bytes; a construct the user did touch is re-emitted in its canonical
    serialized form (Appendix A).
I3. **A no-op writes nothing.** If `domToMarkdown()` equals the session baseline,
    every save caller skips `POST /api/file` (`isNoOpMarkdown` at `hybrid.js:3426`;
    callers `save` `:3497`, `onClose` `:3528`,
    `commitForTabSwitch` `:3576`, `flushAutosave` `:3114`, `exit` `:3354`).
I4. **Output is always plain Markdown, never HTML.** No `<tag>` may reach a file
    outside a fence (`PLAN.md:116-118`). Turndown's unknown-markup default unwraps
    to text (`vendor/turndown.browser.js:770-772`); tables are forced into GFM
    shape (`normalizeTablesForGfm` `hybrid.js:368`); plugin blocks are restored as
    fences (`hybrid.js:477-478`).
I5. **The protected-block rule holds.** No block transform may touch a table or a
    fence (`WRAP_BLOCK_REFUSED_TAGS` `hybrid.js:1219`, `insideProtectedBlock`
    `hybrid.js:1229-1237`).
I6. **Literal syntax characters are escaped**, not reinterpreted, when emitted as
    text (`vendor/turndown.browser.js:732-746`, `:867-869`).
I7. **Undo restores structure, not just text** (`restoreSnapshot`
    `hybrid.js:3035`; `HISTORY_LIMIT`/`HISTORY_COALESCE_MS` `hybrid.js:2989-2990`).
I8. **The raw file stays readable Markdown (goal G4).** Every DOM convenience the
    editor adds — a caret line-box `<br>`, a `<div>` wrapper, a `<table>` built
    during editing, an empty-block placeholder — is converted to Markdown before
    the write. A reader with the `.md` open in a text editor sees no presentation
    HTML. The only exception is HTML the owner already had (Q10).
I9. **One `Enter`, one break (goal G4b).** In hybrid mode a single `Enter` adds one
    line break — never several, and never a `<br>` in the file. No idle action
    (focus change, click, save) adds a break. This is about the editor's behavior,
    not the file format: blank lines already in the Markdown are normal and stay.
    The bug is `alpha beta` + `Enter` becoming `alpha beta\n\n` (Q18); the target is
    one break.

### 1.4 Non-hard-coded values

This document names limits and their source; it does not invent numbers. Existing
constants that must not be duplicated: `AUTOSAVE_MS` = 2000 (`hybrid.js:3083`),
`HISTORY_LIMIT` = 100, `HISTORY_COALESCE_MS` = 400 (`hybrid.js:2989-2990`),
`PASTE_PLAIN_TIMEOUT_MS` = 1000 (`hybrid.js:2813`), `SEGMENT_SEPARATOR` = `"\n\n"`
(`hybrid.js:89`).

---

## 2. Terminology

| Term | Definition | Anchor |
|---|---|---|
| **Block** | One top-level element of `#viewer-content` (direct child) and the source segment it came from. | `topLevelBlock` `hybrid.js:2151`; `topLevelElements` `:681` |
| **Marker** | The syntax prefix that selects a block type: `#`…`######`, `-`/`*`/`+`, `1.`, `>`, `- [ ]`, the fence line, the `\|` table border. | — |
| **Content** | The text of a block after its marker. | — |
| **Inline span** | A non-block element inside a block's content: `<strong>`, `<em>`, `<del>`, `<code>` (not in `<pre>`), `<a>`, `<img>`. | `isInlineCode` `hybrid.js:255` |
| **Atomic block** | A rendered plugin container marked `contenteditable="false"` + `data-hybrid-atomic="1"`; the caret skips over it; click-to-edit swaps in its source. | `markAtomicBlocks` `hybrid.js:1110-1113` |
| **Protected block** | A `<table>` or `<pre>` (and descendants); block transforms (`wrapBlock`, `toggleList`) refuse to act inside one. Atomic plugin blocks are a subset in practice. | `hybrid.js:1219`, `:1229-1237` |
| **Block boundary** | The empty caret position after a block and before the next top-level element (or the editor root). | `insertLineBelow` `:2387-2440` |
| **Gap** | A blank-line run between two blocks; owned by the preceding block for serialization; carried raw. | `PLAN.md:69-70`; `tokenProducesElement` `hybrid.js:652` |
| **Raw** | An HTML comment or raw-HTML token; carried verbatim, never regenerated. | `hybrid.js:625-680` |
| **Segment** | One `block`, `gap`, or `raw` unit of the splice model. | `PLAN.md:64-67` |
| **Canonical form** | The Markdown a touched block serializes to. Listed in Appendix A. | `serializeEditedElement` `hybrid.js:595` |
| **Fail-closed** | The splice returns `null` and the whole file is re-serialized rather than risk a wrong splice. | `hybrid.js:899-901` |

---

## 3. Position and operation key

Positions (the user's requested set):

| Code | Position |
|---|---|
| **S** | Start of block — immediately before the block's first character (before the marker). |
| **T** | Start of content — immediately after the marker and its following space. |
| **M** | Middle of content. |
| **E** | End of content — after the last character, before the boundary. |
| **B** | Block boundary — the empty position after the block / between two blocks. |
| **∅** | Empty block. |

Operations:

| Code | Operation |
|---|---|
| **C** | Type an ordinary character. |
| **G** | Type a block-start trigger (`# `, `- `, `> `, `1. `, `[ ] `, ` ``` `). |
| **↵** | `Enter`. |
| **⇧↵** | `Shift+Enter`. |
| **⌫** | `Backspace` at a block/line start. |
| **⌦** | `Delete` at a block/line end. |
| **D** | Delete the whole content of a block. |
| **P-md** | Paste multi-line Markdown. |
| **P-txt** | Paste plain text. |
| **P-html** | Paste rich HTML. |
| **X** | Cut/copy a selection crossing blocks. |
| **F** | Apply inline formatting over a selection crossing blocks. |
| **U** | Undo an edit that crossed a block boundary. |

Status legend:

| Mark | Meaning |
|---|---|
| ✅ | Implemented and covered by a test. |
| ⚠ | Implemented, not directly tested (assertion gap). |
| ✳ | Specified here; requires a behavior change or new test. |
| ⛔ | Specified here conflicts with current code or tests. |
| 🌐 | Depends on the native editing engine; verify in the Chromium harness. |

All `file:line` cites were taken at the revision of 2026-09-28 and have drifted as
the code moved; treat the function or constant **name** as the anchor of record and
the line number as a hint. This document owns behavior, not line numbers.

---

## 4. Behavior matrix

### 4.1 Paragraph

Rendered as `<p>`; canonical output `hello`.

Setup used below: source `one\ntwo\n` (after a text edit, the changed block only).
Per Q16/I9 one `Enter` adds one line break; the "After" column shows the target, and
the current code's extra newlines are the Q18 bug.

| Pos | Op | Before | After (target) | Status |
|---|---|---|---|---|
| M | C | `one` | `onXe` | ✅ native |
| M | G | `one` | `one` (unchanged) | ✅ `applyBlockRules` anchors `^…$` (`hybrid.js:1621-1623`) |
| E | ↵ | `one` | `one\ntwo` (one break, the next line) | ⛔ Q18: today saves `one\n\n` |
| E | ⇧↵ | `one` | `one\ntwo` (one break) | ⛔ Q18: today inserts a `<p>` and saves `one\n\n` |
| E | ⌦ | `one\ntwo` | `one\ntwo` (no merge) | 🌐 native; see 4.4 for `⌫` |
| S | G (`# `) | `one` | `# one` | ✅ heading rule (`INPUT_RULES[0]` `hybrid.js:1487`), test `4421-4443` |
| S | G (`- `) | `one` | `-   one` | ✅ list rule (`INPUT_RULES[1]` `hybrid.js:1491`), test `4327-4330` |
| ∅/T | G (`- ` etc.) | `` | see §4.4–4.7 | ✅ |
| ∅ | G (`+ `) | `` | `+ ` stays literal; serializes `\+ ` | ✳ Q5: rule to be added |
| ∅ | G (`1) `) | `` | `1) ` stays literal | ✳ Q5: rule to be added |
| — | D | `one` | `` (blank line) | ✅ `paragraph` rule (`hybrid.js:231-241`) returns `\n\n` |

Worked examples (text-only edit, splice path):

```
BEFORE  one\ntwo\n
EDIT    type "!" at end of "one"
AFTER   one!\ntwo\n          (only block 1 re-serialized)
```

```
BEFORE  one\ntwo\n
EDIT    Enter at end of "one" (target behavior)
AFTER   one\ntwo\n          (one newline; element count may change -> Q1)
```

### 4.2 ATX headings `#`–`######`

Canonical output `### Title`; empty heading canonical output `###` (sentinel
`EMPTY_HEADING_SENTINEL` `hybrid.js:65`, added to the clone at `hybrid.js:457`,
restored at `hybrid.js:512-513`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| ∅ | G (`### `) | `` | `### ` (h3, caret after marker) | ✅ `INPUT_RULES[0]` `hybrid.js:1487`; test `4318-4325` |
| ∅ (root) | G (`# `) | `` (brand-new note: the browser types a bare text node under `#viewer-content`, no `<p>`) | `# ` (h1, caret in the heading) | ✅ root branch wraps empty root (`hybrid.js:1618`), `hasBlockContent` ignores the placeholder `<br>`; tests jsdom `7410`, Chromium `827` |
| S | C (no space) | `#no-space` typed | `\#no-space` on save | ✅ no conversion (`applyBlockRules` `:1621`); test `4414-4417`; escape `vendor:738` |
| S | ⌫ | `x\n\n## Title` | `x Title` or merged `## xTitle` | ⛔ unspecified; browser-native merge, §6 Q2 |
| T | C | `## Title` | `## TitXle` | ✅ native |
| M | C | `## Title` | `## TiXtle` | ✅ native |
| M | G (`- `) | `## Title` | no conversion (block is `H2`, not `P`) | ✅ `:1596` |
| E | C | `## Title` | `## Title!` | ✅ native; edited block re-serialized ATX |
| E | ↵ | `## Title` | `## Title\n\n` (new block) | 🌐 native; element count changes → structural splice (Q1) |
| E | ⇧↵ | `## Title` | `## Title\n\n` (new empty `<p>` after) | ✅ test `4711-4720` |
| B | C | `x\n\n## Title` typed at boundary | `x\n\nX\n\n## Title`? | ⛔ native; only rule-edge is protected (`openLineAtCaretRule` `:2343`); §6 Q3 |
| ∅ | ↵ | `###` | `###\n\n` (new block) | 🌐 native; see 4.2.1 |
| ∅ | ⌫ | `x\n\n###` | `x` + caret; marker removed by merge | ⛔ unspecified |
| — | D (select all text) | `### Title` | `###` | ✅ sentinel `:457`, test `7158-7173` |
| — | D (then save, no other edit) | `###` | `###` | ✅ byte-identical, test `7682`, `7700-7703` |

#### 4.2.1 Empty heading (zero height) — known pre-existing bug

`PLAN.md:171-177`: an empty heading has zero height in a real browser and the caret
is redirected, so typed text can land in the following block. The catalog treats
"text typed into an empty heading" as **must land in the heading**; current code
cannot guarantee it in Chromium. Status: ⛔ tracked, not fixed (§6 Q12). The browser
harness currently avoids the case in its first native-edit pass (comment at
`test_hybrid_browser.js:165`) and covers it directly in the Q12 catalog case
(`test_hybrid_browser.js:243-273`).

### 4.3 Setext headings (`===` / `---` underline)

Rendered as `<h1>`/`<h2>`; canonical output when touched is **ATX**, not setext
(`headingStyle: "atx"` `hybrid.js:174`; rule `vendor:101-116`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| — | no edit | `Title\n=====\n\nbody\n` | byte-identical | ✅ test `7609-7625`, corpus `7685` |
| M | C (touch h1) | `Title\n=====` | `# Title!` | ✅ canonical ATX, §6 Q4 |
| E | ⇧↵ | `Title\n=====` | `# Title\n\n` | ✅ via `insertLineBelow` |
| ∅ | — | n/a | — | — |

### 4.4 Bullet lists `-`/`*`/`+`

Rendered `<ul><li>`; canonical output `-   a` (three spaces, `bulletListMarker: "-"`
`hybrid.js:175`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| ∅ | G (`- `) | `` | `-   ` (empty item, ZWS placeholder) | ✅ `:1491`, tests `4327-4330`, `4340-4345` |
| ∅ | G (`* `) | `` | `-   ` (marker canonicalized on save) | ✅ rule matches `\*`; canonical output `-` |
| ∅ | G (`+ `) | `` | `+   ` (new rule) | ✳ Q5: rule to be added |
| T | C | `- item` | `- Xitem` | ✅ native |
| M | C | `- item` | `- itXem` | ✅ native |
| ∅/E | ↵ | `- item` | `-   item\n-   ` (new item) | ✅ native + `addListPlaceholders` `:1422`, test `4332-4345` |
| ∅ | ↵ (on empty item) | `- a\n- \n` | `-   a\n\n` (outdent to paragraph) | ✅ `:2619-2643`, tests `7923-7985` |
| M | ⇧↵ | `- item` | `-   item\n\n` then a `<p>` **after the whole list** | ✅ test `4634-4648`; `insertLineBelow` climbs to top level `:2401-2409` |
| E | ⇧↵ | `- item` | same as M | ✅ |
| S | ⌫ | `a\n\n- item` | outdent item / merge into `a` | ⛔ browser-native; §6 Q2 |
| E | ⌦ | `- item\n\na` | merge next block into item | ⛔ browser-native; §6 Q2 |
| — | D (empty the item) | `- item` | `-` | ✅ sentinel `:305-311`, `:514-522`, test `7199-7226` |
| — | Tab | `- a\n- b` (caret in b) | `- a\n    - b` nested | ✅ `indentListItem` `:1922`, test `4365-4370` |
| — | ⇧Tab | nested b | outdent to top level | ✅ test `4377-4381` |
| (item) | P-txt | `- a` | plain text inserted with `<br>` inside the item | ⚠ `insertTextAtCaret` `:2893`; §6 Q9 |
| (item) | P-md | multi-line MD | one item with hard breaks, **not** new blocks | ✳ Q9: parse into blocks |

### 4.5 Ordered lists `1.` / `1)`

Rendered `<ol><li>`; canonical output `1.  a` (two spaces, `vendor:152-154`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| ∅ | G (`1. `) | `` | `1.  ` | ✅ `:1505`, test `4332-4335` |
| ∅ | G (`2. `) | `` | `1.  ` (renumbered by DOM position) | ✅ `vendor:152-154` |
| ∅ | G (`1) `) | `` | `1)  ` (new rule) | ✳ Q5: rule to be added |
| ∅/E | ↵ | `1. a` | `1.  a\n2.  ` | ✅ native |
| ∅ | ↵ (empty item) | `1. a\n2. ` | `1.  a\n\n` | ✅ same outdent path as 4.4 |
| M | ⇧↵ | `1. a` | `1.  a\n\n` + `<p>` after list | ✅ test `4651-4665` |
| — | D | `1. a` | `1.` | ✅ test `7416-7418` |

`start` attribute: turndown honours `ol[start]` (`vendor:152-154`); hybrid creates
`<ol>` without one.

### 4.6 Nested lists

Canonical output `-   a\n    -   b` (4-space indent per level, `vendor:148`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| — | Tab | `- a\n- b` | `-   a\n    -   b` | ✅ `:1922`, test `4365-4370` |
| — | ⇧Tab | nested | move up one level | ✅ test `4377-4381` |
| M | ⇧↵ | `- a\n    - b` | `-   a\n    -   b\n\n` + `<p>` after **outer** list | ✅ test `4669-4690` |
| ∅ | ↵ (empty nested item) | `- a\n    - ` | split: outer list, `<p>`, rest list | ✅ `:2629-2635`, test `7957-7985` |
| — | D (empty nested item) | `- a\n    - ` | `-` at its indent | ✅ sentinel regex handles indent/quote `:514-522` |

Nested-list worked example:

```
BEFORE  - a\n- b\n
EDIT    Tab in item "b"
AFTER   -   a\n    -   b\n
```

### 4.7 Task lists `- [ ]` / `- [x]`

marked v12 emits a bare `<li>` with no `task-list-item` class (a tight list
puts the checkbox directly in the `<li>`; a loose list wraps it in a `<p>`).
Turndown's gfm `taskListItems` rule detects the checkbox by `parentNode`
being an `LI` (`turndown-plugin-gfm.browser.js`), so the DOM the editor
builds must keep the checkbox a direct `<li>` child. Canonical output is
`- [x] done`: turndown's own padding (`-   ` and `[x]  `) is collapsed to
one space on each side by `normalizeTaskListSpacing` (`hybrid.js`), so an
edited checklist matches the compact form it is normally typed in. Only
task lines are rewritten; plain and ordered markers keep turndown's
padding.

The bullet is suppressed by CSS, not by the DOM. The selector is
child-scoped, `li:has(> input[type="checkbox"], > p > input[type="checkbox"])`,
so a plain item that merely contains a nested task list keeps its own
bullet. The checkbox is sized to and centred on the bullet glyph's
centre (`width: 1em; height: 1em; margin: 0 .53em 0 -1.53em`). The two
margins sum to -1em, so the task text lines up with a plain item's text,
and the -1.53em left pull centres the checkbox where `list-style: disc`
draws the bullet, so toggling between a bullet and a checkbox does not
move the leading glyph. A missing rule rendered both the marker and the
checkbox and pushed the text one marker-width right
(`static/css/style.css` markdown block; mirrored in the HTML export's
embedded CSS in `static/js/export.js`).

Task-item detection is the checkbox child, never the `task-list-item`
class: a note loaded from disk renders a bare `<li>`. A checkbox-only
item serializes as `- [ ]` and is given a trailing space through
`EMPTY_TASK_SENTINEL`, because `- [ ]` without one is literal text to
marked while `- [ ] ` re-renders a checkbox.

marked keeps the task marker's separator space in the item text:
`- [ ] task` renders as `<input> task`, a leading space before the text.
That space pushed the task text one space right of a plain item and,
with the caret at the item's start, ended up inside the text after typing
(`- [ ] X task`). `stripTaskItemSpaces` (`viewer.js`) drops that one
space after every render; turndown's gfm `taskListItems` rule puts the
separator back on save, so the round-trip is unchanged. Shared with the
hybrid editor and the exporter through `NB.viewer`.

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| ∅ | G (`- [ ] ` / `[ ] `) | `` | task item, unchecked | ✅ `taskItemRule`; tests `4390-4401` |
| ∅ | G (`- [x] ` / `[x] `) | `` | task item, checked | ✅ |
| — | click checkbox | `- [ ] task` | `- [x] task` | ✅ hash includes `input.checked` `PLAN.md:79`; tests `5733-5742`, `7784-7806` |
| — | Task edit-bar button | `task` / `<p>` / whole-list selection | adds the checkbox on the caret item; a second press returns the item to a plain **paragraph** | ✅ `toggleTask`/`setListItemType`; tests `8561-8574`, browser list-model block |
| M | ⇧↵ | task item | `<p>` after whole list | ✅ test `4693-4708` |
| — | ↵ | task item | new task item with a checkbox, **below** the caret item; **above** it when the caret sits before the item's first character (native list semantics) | ✅ `onEnterKey` task branch; also on a task loaded from disk; task-start Enter tests |
| — | ↵ on an empty task | empty checkbox item | `-` (checkbox and item dropped) | ✅ the checkbox is stripped, then the item outdents to a `<p>` |
| — | D (empty the item) | `- [ ] task` | `-` (checkbox gone) | ✳ sentinel path: `isEmptyListItem` ignores `input` (`:286-289`), so an item holding a checkbox is **not** "empty" — deleting text leaves the checkbox and `[ ]`; verify |
| — | save | — | `[x]`/`[ ]` preserved, empty task keeps a trailing space | ✅ tests `6846-6855` |

### 4.7.1 List-type model (dot / number / checkbox)

The UL / OL / Task toolbar buttons and the right-click **List** submenu share
one model, matching Word and Google Docs: a list button acts on the **paragraph
the caret is in**, not the whole list. In hybrid this is `toggleList` /
`toggleTask` over `setListItemType` (`hybrid.js`); source mode mirrors it in
`editbar.js`'s `listAction`.

- Pressing the item's **own** type (no checkbox) removes the item from the
  list as a plain paragraph — the toolbar toggle.
- Pressing a **different** type converts that one item; in hybrid it is split
  into its own `<ul>`/`<ol>` so its neighbours keep their bytes.
- A checkbox survives only on a task item: setting bullet/number strips it,
  and Task on a bullet/number keeps that list type (`- [ ] ` / `1. [ ] `).
- Task on an item that already has a checkbox removes the item from the list.

Press → result matrix (caret on the item):

| item before | UL | OL | Task |
|---|---|---|---|
| paragraph | bullet | number | task |
| bullet | paragraph | number | task |
| number | bullet | paragraph | number + checkbox |
| task | bullet (checkbox dropped) | number (checkbox dropped) | paragraph |

Before this model the transitions were undefined (`hybrid.js`'s `toggleList`
unwrapped the WHOLE list whenever the tag matched, and source mode's Task
button on a bullet produced `- [ ] - item`). The matrix is pinned by the
"every list-type transition is defined" checks in `tests/dom/test_dom.js`
(hybrid and source) and the "list model" browser block.

**Quote composes with the list model.** The Quote button follows the same
toggle contract on the caret's whole **top-level block**: `toggleQuote`
(`hybrid.js`) wraps it in a `<blockquote>` (a list under the caret quotes
whole, `- a` → `> - a`, matching a `> ` prefix in source mode) and pressing
Quote again lifts it back out. A `<blockquote>` is therefore never nested
inside a `<ul>`, and a `<p>` is never nested in a `<p>` — the old
`wrapBlock("blockquote")` produced both (`<ul><blockquote>…` and the
`<p><p>` on a second press). Source mode's `quoteAction` mirrors it by
prefixing/stripping `> ` on the touched block, and its list model preserves
that prefix, so the two modes agree on `> - item`. Pinned by the "Quote wraps
the top-level block" check (`tests/dom/test_dom.js`) and the `quote(...)`
cases in the browser list-model block.

### 4.7.2 List-item drag reorder (all list kinds)

Status: ✳ specified here. Applies to every list kind in §4.4–4.7: bullet (`-`/`*`/`+`),
ordered (`1.`/`1)`), nested, task (`- [ ]`/`- [x]`), and empty items — in every container
(the editor root, a `<blockquote>`, or a table cell). The rendered hybrid surface is the
editing surface (goal G1); a drag is a structural DOM move that Turndown re-serializes on
save (goal G4). There is no popup window and no separate list editor. The pattern
precedent is the table row/column reorder (`table-edit.js` + `moveRow`/`moveCol`,
`hybrid.js:4817`/`:4838`); this is **pattern reuse only, not shared code**. §4.7.2 is a
second module of comparable size to `table-edit.js` — its own overlay, an indent-rail
depth chooser, subtree carry, outdent, a variable-height recursive hit-test, a keyboard
submenu, and an `aria-live` region — plus a substantial Playwright suite. The estimate
must not treat it as a small addition to `table-edit.js`.

**Affordance (the grip).** One grip `<button>` is drawn for the list item under the
pointer, or containing the caret, in the left gutter — the same hover-reveal model as
the table row grip (`table-edit.js:626`). The grip, the drag ghost, and the drop line are
children of the list feature's **own** overlay layer, `.nb-list-overlay`, a sibling of
`.nb-table-overlay` under `#viewer` (created the same way at `table-edit.js:772`), with
the same rules: deliberately OUTSIDE `#viewer-content`, `pointer-events: none` on the
layer and `auto` on the controls, so the chrome is never in Turndown's clone and never in
a hybrid `innerHTML` undo snapshot.

**Overlay ownership is one layer per feature — no cross-module arbitration.**
`table-edit.js` owns `.nb-table-overlay` exclusively and wipes that node on every render
(`overlay.textContent = ""`, `table-edit.js:189`, `:623`); its `hide()` refuses to clear
mid-drag (`if (drag) return`, `table-edit.js:619`). Drawing list chrome into that node
would let a table hover wipe a list drop line, and a table `hide()` called while the
table module is idle would delete a list ghost mid-drag (its guard only protects a
*table* drag). The list module therefore clears and rebuilds only `.nb-list-overlay`; the
two layers never touch each other's nodes. No class or attribute is ever put on a list
node during a drag: the lifted item is drawn as a translucent ghost and the insertion
point as a drop line, both in the list overlay (`table-edit.js:18-24`). Because no chrome
reaches the content, no `CHROME_CLASS_TOKENS` / `prepareTurndownClone` strip is added.
Drags use Pointer Events with `setPointerCapture`, never HTML5 DnD
(`table-edit.js:440-448`); the pointerdown is `preventDefault`ed so the caret and the
native drag never start. Hover-intent lock and a grace timer mirror `table-edit.js:35`,
`:637-658`.

**Drop positions.** The pointer resolves `(target item T, side, depth)`:

- `T` = the list item whose **hit region** contains the pointer; `side` = `before` on the
  top half, `after` on the bottom half (the `rowBoundary` rule, `table-edit.js:495-503`).
  The hit region is the union of the item's `<li>` rect and its own checkbox rect
  (`taskCheckboxOf(li)`), because a task checkbox hangs outside the item's border box
  (`margin: 0 .53em 0 -1.53em`, `style.css:2712`) and a pointer over that marker column
  would otherwise resolve no item. If still no rect matches (the pointer sits in the
  gutter left of every item), the item on the pointer's row is resolved by clamping the
  pointer x to the container's base rail.
- `depth` = the nearest indent rail to the pointer x. One nesting step's rendered width
  is the CSS list indent (`static/css/style.css`), a named variable, not a literal, so
  the same rule works at every level.
- Legal `depth` ∈ `[base, depth(previous visible item at the boundary) + 1]`, where
  `base` is the enclosing block's list depth (0 at the editor root, the quoted list's
  depth inside a `<blockquote>`, the cell's list depth inside a table). The ceiling is the
  depth of the visible item immediately above the boundary, plus one. For a `before`
  boundary at a nested list's first child, that preceding visible item is the parent
  `<li>` at depth `T's depth − 1`, so the ceiling is `T's depth`: the item lands as a
  sibling of T at T's own depth — the placement table's "clamped to T's depth when there
  is none" — never nested under T's absent preceding sibling. The ceiling collapses to
  `base` only when T is the movable container's very first item, where no visible item
  precedes it and `base` already equals T's depth. The clamp is the whole "maximum at
  depth boundaries" rule: dragging past the leftmost rail stays at the base, dragging past
  the rightmost stays one level under the item above.

Before measuring, the resolved item is given a line box if it has none. An item the user
emptied during this session may not have one — `addEmptyLineBoxes` / `addListPlaceholders`
run only on enter and re-render (`hybrid.js:1582-1589`, `:4242-4246`), not on every input —
and a zero-height `<li>` cannot be split by the top-half/bottom-half rule. The list module
appends the same marked caret `<br>` (`CARET_BR_ATTR`) the enter path uses; it is
hash-stripped (`hybrid.js:1042`) and removed before serialization, so it never reaches the
note.

Placement from `(side, depth)`:

| `depth` vs T | Result |
|---|---|
| equal to T's depth | sibling of T, before/after per `side` |
| T's depth + 1, `side:after` | becomes the first child of T (drop **into** T) |
| T's depth + 1, `side:before` | becomes the first child of T's preceding sibling at T's depth; clamped to T's depth when there is none |
| less than T's depth | outdent: sibling (per `side`) of T's ancestor at that depth |

The drop line is drawn at the resolved boundary in the overlay. A resolved destination
inside the item's own subtree is refused. A drop that resolves to the item's current
position hides the line and is a no-op (below).

**Nesting and subtrees.** The mutation moves the existing `<li>` node, never a clone, so
its whole subtree — nested `<ul>`/`<ol>`, their items, text, and inline markup — travels
with it (the `moveRow` rule, `hybrid.js:4785`). The destination list is created or reused
exactly as `indentListItem` does (`hybrid.js:2710-2722`): if the parent item has no child
list, a new list is created with the **moved item's source list type**
(`document.createElement(list.tagName)`, `hybrid.js:2715`); if the parent already has a
child list, the item joins it. A drag never explicitly retypes an item — that is §4.7.1 —
so mixed-type nesting (`- a` with a nested `1. b`) is legal, and the emitted marker follows
whichever list contains the item (Turndown's `listItem` rule,
`static/vendor/turndown.browser.js:149-155`). A source nested list left empty by the move
is removed (`indentListItem`'s `if (!list.firstElementChild) list.remove()`). The item may
move between nesting levels of its own movable list container; it may not leave that
container (cross-list rule below).

**Ordered lists renumber on save.** The DOM `<ol>` carries no literal number: the browser
numbers by position, and Turndown renumbers by DOM position (honouring a source
`ol[start]`). A move therefore never edits markers in the DOM; the containing `<ol>`
renumbers as a contiguous run on serialization, emitting canonical `N.  ` padding
(Appendix A). Moving item 2 above item 1 in `1. a\n2. b` emits `1.  b\n2.  a`. Nested
ordered sublists keep their own order and numbering. Q4 applies: a *touched* ordered
block canonicalizes its padding and numbering; untouched blocks keep bytes (§5.5).

**Task items.** The checkbox `<input>` is a child of the moved `<li>`, so its `checked`
state rides along with the item and is hashed explicitly (`canonicalSubtree`,
`hybrid.js:1080`). A parent's checkbox state never cascades to its children and a child's
never to its parent: moving a task parent carries plain and task children unchanged, and
moving a plain parent carries task children unchanged — each item keeps its own marker.
A checkbox-only item keeps its `EMPTY_TASK_SENTINEL` trailing space on save (Appendix A).

**Empty items and tight/loose items.** The live `<li>` is relocated with its ZWS
placeholder or browser `<br>` line box intact, so `markEmptyListItems` still emits a bare
marker for an item that was empty before the move. The move does not add or remove a
`<p>`, so a tight item stays tight and a loose `<li><p>…</p></li>` stays loose; hybrid
does not normalize tight/loose on a move. A move must not run `ensureListMarker` on a
non-empty item.

Tight/loose has a round-trip consequence to state honestly: a move that puts a loose item
into a tight list (or the reverse) changes the list's serialized blank-line structure, and
after a reload marked re-decides the **whole list's** tight/loose shape from that structure
— so previously tight siblings may render loose. There is no data loss, and the list's
immediately saved bytes are canonical. Hybrid does not normalize or refuse this: tight vs
loose is a whole-list property of Markdown, not a per-item one, and refusing the move would
block legitimate reordering.

**Movable container; cross-list and non-list drops are refused.** The movable container
is the dragged item's **outermost `<ul>`/`<ol>` ancestor** — the root list (parent
`#viewer-content`), the outermost list inside a `<blockquote>` (`> - a` renders
`<blockquote><ul>…`), or the outermost list inside a table cell. Defining the container by
the outermost list ancestor, not by direct parentage, is what makes §4.7.2 apply to every
list kind in every container: a quoted list and an in-cell list are reorderable within
themselves. A drop target exists only inside that container. A drop onto a paragraph,
heading, the enclosing `<blockquote>`, the table, or a different list container is
refused: the ghost returns to origin, no DOM is mutated, no snapshot is pushed, and
nothing is written. Refusal is decided while the pointer moves, **before** any
`flushPendingSnapshot()` or mutation, so a refused drop leaves history untouched. Merging
two source-separate lists would change the blank-line structure the splice carries raw and
has no clean Markdown round-trip, so conversion is rejected.

**No-op.** A drop that resolves to the item's current parent and next sibling returns
before any flush, mutation, or `onContentChange` — the no-op check precedes
`flushPendingSnapshot()`, exactly as `moveRow` orders it (`hybrid.js:4821` before `:4827`).
Even if a path did mutate, a save whose output equals the baseline writes nothing
(`isNoOpMarkdown`, §5.6 / I3).

**Undo.** One completed drag is one undo step. Before the mutation call
`flushPendingSnapshot()` to commit any debounced typing snapshot (`hybrid.js:4798`),
mutate by moving nodes, then `onContentChange()` to push the post-drop snapshot. A refused
or no-op drop returns before this flush, so it never creates a step. Esc during the drag
cancels with no mutation and no snapshot. The overlay chrome is outside `#viewer-content`,
so no snapshot can contain it and no restore can resurrect it.

**Change-hash / dirty classification.** `spliceSave` dispatches on
`els.length !== blockHashes.length` (`hybrid.js:1241-1242`). A drag changes child order,
not the top-level element count, so when the live DOM still aligns with the enter baseline
(the common case — the note was opened, dragged, and saved) the same-count path runs: the
containing block's content key differs, and only that block is re-serialized
(`hybrid.js:1246-1263`). When the baseline count has already drifted — e.g. the user
pressed `Enter` earlier in the same edit session and the autosave/rebase has not yet
re-seated the baseline — the count differs and `structuralSplice` (`hybrid.js:1336`) runs
instead, matching the unchanged prefix/suffix by key and re-serializing only the changed
middle. Both paths preserve every untouched block's bytes; the classification is
path-dependent but the outcome is safe either way. The change key (`canonicalSubtree`,
`hybrid.js:1048`) walks children in order, so a reorder is always seen as a change.
`onContentChange` (`hybrid.js:3849`) marks the note dirty and schedules autosave and the
coalesced snapshot; the no-op guard decides the write.

**Keyboard, touch, accessibility.** Keyboard parity is the context menu's **List**
submenu, extended with the operations the table submenu has (`buildTableMenu`,
`hybrid.js:4903`): "Move item up" / "Move item down" among siblings, plus the existing
`Tab`/`Shift+Tab` for indent/outdent (`indentListItem`, `hybrid.js:2692`). The moved item
takes the caret after the move so the command repeats (the `focusRow` pattern,
`hybrid.js:4955`). Touch uses the same Pointer Events path; the grip is shown for the
item containing the caret when no hover exists, carries `touch-action: none`, and starts
on pointerdown. The grip is a focusable `<button>` labelled "Reorder list item"; a
polite `aria-live` region outside `#viewer-content` announces each completed move's new
position and level ("Item moved to position 3, level 1"), for both drag and keyboard.

**Non-goals (this feature).**

- No popup window or separate list editor (goals G1/G4).
- No dragging of non-list blocks; only `<li>` subtrees.
- No cross-list merge and no drop onto a non-list block (both refused).
- No drag out of a list's own container: a quoted list stays in its blockquote and an
  in-cell list stays in its cell (cross-container drops are refused).
- No multi-item or multi-selection drag; one item subtree per drag.
- No list-type conversion by drag (that is §4.7.1); a drag changes position and nesting
  only.
- No auto-scroll while dragging past the viewport edge.
- No HTML5 drag-and-drop; Pointer Events only.
- No server or `/api/edit` change; no drag state is persisted.

### 4.8 Blockquotes `>`

Rendered `<blockquote>` (often containing `<p>`); canonical output `> q`
(`vendor:118-126`); multi-paragraph canonical `> a\n> \n> b`.

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| ∅ | G (`> `) | `` | `<blockquote>` | ✅ `:1534`, test `4385-4388` |
| T/M | C | `> quoted` | `> quoXted` | ✅ native |
| E | ⇧↵ | `> quoted` | `> quoted\n\n` (`<p>` after the quote) | ✅ `:2387-2440`, test `4871-4889` |
| E | ↵ | `> quoted` | `> quoted\n> ` (native second quote line); the next ↵ on that empty line exits | ✅ native + `exitEmptyBlockquote` |
| ∅ | ↵ | `> ` | exits the quote to a paragraph | ✅ `exitEmptyBlockquote`; browser test (§6 Q6) |
| M | ⇧↵ | `> quoted` | `<p>` after quote | ✅ |
| S | ⌫ | `x\n\n> quote` | merge | ⛔ browser-native; §6 Q2 |
| — | D (remove all quote text) | `> quote` | `` — the blockquote **vanishes** | ⛔ turndown drops empty blockquote; §6 Q7 |
| — | nested `> >` | `> outer\n> > inner` | preserved | ✅ untouched test `8027-8029`; edited canonical `vendor:118-124` |
| — | nested rule `> ---` | `> ---` | click must not throw, note unchanged | ✅ test `5430-5449` |

### 4.9 Fenced code blocks (` ``` ` and `~~~`, with info string)

Protected block (`WRAP_BLOCK_REFUSED_TAGS` `hybrid.js:1219`); rendered `<pre><code>`;
canonical output ```` ```python\nprint(1)\n``` ```` (`codeBlockStyle:"fenced"`,
rule `vendor:181-215`). `pre > code` is never touched by inline rules
(`applyInlineRules` bail at `hybrid.js:1650-1651`). Plugin fences are atomic
(`:1110-1113`); click-to-edit swaps in an editable `<pre>`
(`editPluginSource` `:4080`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| ∅ | G (` ``` `) + ↵ | `` | fenced block, language from the info string | ✅ `:2601-2616`, test `4465-4478` |
| T/M/E | C | ` ```python\nprint(1)\n``` ` | source text edited (inside the click-to-edit `<pre>`) | ✅ `:4080`, tests `6083-6166` |
| any | G / block transform | inside a fence | **refused** | ✅ `insideProtectedBlock` `:1229`, tests `7123-7145` |
| any | inline pairs `**x**` | ` ```\n**x**\n``` ` | delimiters **preserved** | ✅ `applyInlineRules` bails in `pre` `:1650-1651`, test `7172` |
| E | ⇧↵ | ` ```python\nprint(1)\n``` ` | fence unchanged; `<p>` **after** the block | ✅ test `4893-4933` |
| (editing) | ↵ | inside the editable `<pre>` | native newline inside the source | ✅ comment `:2376-2378` |
| — | D (empty the fence) | ` ```\nx\n``` ` | fence **dropped** from the note; the live view keeps an empty `<pre>` until the note is re-rendered | ✅ turndown's blank rule (`vendor:664`); the serializer never writes a blank fence |
| (editing) | ⌫ / ⌦ on the emptied fence | empty `<pre>` | top-level block **removed**, caret at the previous/next block edge, undoable; a fence nested in a list/quote is left in place (the key is claimed so the native merge cannot destroy its `<code>`) | ✅ `removeEmptyCodeBlock` (`hybrid.js:2423`); `test_block_edit_browser.js` |
| — | language chip | ` ```shell ` | change to `python` → ` ```python `; empty clears; `my lang` is refused | ✅ `addLanguagePill` (real `<input>` so Ctrl+A selects the chip, not the note), tests `test_block_edit_browser.js` |
| — | bare fence touched | ` ```\ntext\n``` ` | stays bare; highlight.js's auto-detected language is never written | ✅ `captureFenceLanguages`; test `test_block_edit_browser.js` |
| — | `~~~` fence | `~~~js\ntext\n~~~` | untouched byte-identical; touched canonicalizes to backticks | ✅ corpus + `test_block_edit_browser.js` (§6 Q13) |
| — | P-html into fence | HTML pasted | stays plain text | ✅ plain-text paste handler; `test_block_edit_browser.js` (§6 Q9) |
| — | Tab / Shift+Tab | inside the source | Tab inserts two spaces; Shift+Tab does not move focus out | ✅ `onEnterKey` selection-based guard; browser test |
| — | Ctrl+Z / Ctrl+Y | inside the source | native undo/redo, not hybrid's whole-note snapshot | ✅ modifier guard by selection; browser test |
| — | Esc | inside the source | commits and restores render mode | ✅ `test_block_edit_browser.js` |
| — | no edit | any fence | byte-identical | ✅ tests `8013-8015`, `6420-6437` |

### 4.10 Indented code

Rendered `<pre><code>`; canonical output when **touched** is a **fence**
(`codeBlockStyle:"fenced"`), not indented code.

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| — | no edit | `    code\n\nBODY\n` | byte-identical | ✅ test `7631-7647`, corpus `7686` |
| M/E | C | `    code` | fenced block `` ```\ncode!\n``` `` after save | ⛔ canonicalizes to fenced; §6 Q4 |
| E | ⇧↵ | `    code` | code unchanged; `<p>` after | ✅ via climb |

### 4.11 Horizontal rules `---` / `***` / `___`

Rendered `<hr>` — a void top-level block with a custom caret-editing model
(`ruleForDeleteKey` `hybrid.js:2220`; the click/selection model spans
`hybrid.js:1773-1956`). Canonical output is `* * *` (`hr` option default
`vendor:754`; hybrid does not override it in `ensureTurndown` `:170-186`).

**Selection and copy use the browser's own engine**, identically in hybrid and
preview mode. A rule is selectable like an ordinary character: a selection may
start, end, or span it. Copy is whatever the selection is — a void rule
contributes no text, and no app code intercepts `copy`/`cut`. Because the
`<hr>` box is zero-height with only a painted border, the browser's native
selection highlight is invisible on it, so the app adds one visual cue in
**both** modes: `onSelectionChange` marks every top-level rule inside the
selection with `nb-hr-selected`, styled with `border-top-color` + a ring
(`style.css`). The class is editing chrome, never content: the hybrid
serializer strips it from the change hash and the turndown clone, so a live
selection cannot make a save write or canonicalize `---` to `* * *`. The only
hybrid-specific behavior is that a **plain click** on a rule still repairs the
caret to the clicked side, because a void rule has no caret of its own: the
mousedown is left native (so a drag can select) and the repair is decided on
`mouseup` (`onContentMouseUp` `:1838`), skipped when the gesture became a
selection.

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| — | click on/beside rule | `alpha\n\n* * *\n\nomega` | note **unchanged**, caret parked at root beside `<hr>` | ✅ `hrUnderClick`, `onContentMouseUp`, tests `5142-5193` |
| — | drag across rule | `alpha\n\n* * *\n\nomega` | native selection spans the rule; marked `nb-hr-selected` | ✅ `onSelectionChange`, tests `5596-5630`, browser harness `rule selection` |
| S(block after) | ⌫ | `alpha\n\n---\n\ntext` | rule removed; `alpha`, `text` kept | ✅ `ruleForDeleteKey`, test `5200-5214` |
| S(block after) | ⌦ | same | rule **kept** (forward edit) | ✅ test `5219-5229` |
| E(block before) | ⌦ | `alpha\n\n---\n\ntext` | rule removed | ✅ test `5233-5244` |
| E(block before) | ⌫ | same | rule kept | ✅ test `5246-5256` |
| root after rule | ⌫ | `---\n\ntext` | removed | ✅ test `5260-5269` |
| root before rule | ⌦ | `alpha\n\n---` | removed | ✅ test `5284-5293` |
| on rule element | ⌫ **and** ⌦ | — | both remove | ✅ `ruleUnderCaret`, test `5307-5317` |
| S(block after) | C | `---\n\n## Title` | new `<p>` inserted, heading intact | ✅ `openLineAtCaretRule`, tests `5331-5357` |
| S(block after) | ↵ | same | caret line `<p>` opened | ✅ tests `5362-5380`, `5480-5502` |
| root before rule | ⇧↵ | same | caret line on the rule's own side | ✅ test `5523-5534` |
| — | D (rule is only block) | `---` | note empty | ✅ test `5538-5549` |
| — | remove, keep user blank line | `alpha\n\n---\n\n\n\nomega` | blank line survives | ✅ test `5555-5570` |
| — | cross-block inline format over a rule | selection spanning blocks | **refused**, DOM unchanged | ✅ `toggleInline` guard, tests `5700-5744` |
| — | touched hr serialized | `---` | `* * *` | ⛔ canonicalizes dash style; §6 Q4 |
| — | nested rule `> ---` | `> ---` | native editing (not claimed) | ✅ `hrUnderClick` |

### 4.12 GFM tables

Protected block; rendered `<table>` with `<thead>` flattened into the first `tbody`
row on entry (`flattenTheads` `:1467-1482`). Canonical GFM output
`| a | b |\n| --- | --- |\n| 1 | 2 |` (`normalizeTablesForGfm` `:368-403`).
A headerless or caption/colgroup table is **rebuilt**, never emitted as `<table>`
(`PLAN.md:116-118`, tests `7306-7404`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| — | no edit | `\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|` | byte-identical | ✅ tests `7724-7727` |
| cell M | C | `\| 1 \| 2 \|` | `\| 9 \| 2 \|` (edited cell) | ✅ test `7739-7748` |
| cell | G / heading / list | cell text | **refused** | ✅ `wrapBlock`/`toggleList` refuse `insideProtectedBlock` `:1243`, `:1280`; test `7123-7128` |
| cell E | ⇧↵ | `\| body \|` | `<p>` **after the whole table**, no new row | ✅ `insertLineBelow` climbs `:2401-2409`, tests `4729-4754` |
| cell E | ↵ | `\| body \|` | native line break **inside the cell** | ⚠ not specified; §6 Q8 |
| cell | ⌫ at cell start | first cell | rule kept, cell text intact | ✅ test `5386-5404` |
| empty cell | save | `\|  \| 2 \|` | empty cell keeps its column | ✅ `BLANK_RULE_EXEMPT_TAGS` `:52-55`, test `6862-6872` |
| header row | delete | header | **refused** | ✅ `deleteRow` `:3729`, tests `7056-7079` |
| last col | delete | one column | **refused** | ✅ `deleteCol` `:3769`, tests `7089-7093` |
| header toggle | `table-header` | already has header | **refused** (never removes) | ✅ `toggleHeaderRow` `:3795`, test `7079` |
| row/col reorder | Alt+arrows / drag | merged cells | **refused** | ✅ `tableHasSpans` `:3835`, test `6781-6789` |
| row/col reorder | move | `\| A \|` etc. | th/td + align travel with nodes | ✅ `moveRow`/`moveCol` `:3842`/`:3863`, tests `6724-6750` |
| insert row/col | `+` | `\| 1 \| 2 \|` | new cell seeded `&nbsp;` | ✅ `:3713`, `:3753`, tests `6879-6920` |
| — | last body row `-` | 1 body row | aria-disabled, refused | ✅ test `6934-6939` |
| — | touched table | — | clean GFM, never `<table>` | ✅ tests `6930-6933`, `7368-7404` |
| table boundary | `↵` / `⇧↵` after last row | — | new block after the table | ✅ test `5010-5038` |

#### 4.12.1 Cell caret positions

A caret inside a table cell is a *nested structure*, not a rule edge
(`caretDirectlyInTop` `:2138`, `NESTED_STRUCTURE_TAGS` `:2125-2128`).

| Pos | Op | Before | After | Status |
|---|---|---|---|---|
| cell S | C | `\| 1 \|` | prepends into the cell | ✅ native; rule is preserved |
| cell T | C | `\| 1 \|` | prepends into the cell text (no GFM "T" concept) | ✅ native |
| cell M/E | C | `\| 1 \|` | in-cell text edit | ✅ native |
| cell E | ⌦ | `\| 1 \|` | native forward edit; may merge with next cell | ⛔ unspecified; §6 Q8 |
| cell S | ⌫ | first cell | native; may merge into previous cell | ⛔ unspecified; §6 Q8 |
| cell | Tab | — | native focus move to next cell | 🌐 not claimed by `Tab` handler (only list items, `:2583`) |
| cell end | → | `\| a1 \| b1 \|` | caret to the next cell in the same row | ✅ hybrid handler |
| cell start | ← | `\| a1 \| b1 \|` | caret to the previous cell in the same row | ✅ hybrid handler |
| cell mid | ← / → | `\| b1 \|` | one character inside the cell | ✅ native (not claimed) |
| cell | ↑ / ↓ | `\| a1 \| b1 \|` row 1 | caret to the previous / next ROW, same column | ✅ hybrid handler |
| top row | ↑ | header row | caret leaves the table to the block above | ✅ hybrid handler |

**Arrow navigation within a table.** A contentEditable caret engine traverses a
table's cells in DOM order for *vertical* movement: `↑`/`↓` move to the
previous/next *cell* exactly like `←`/`→` instead of changing row (verified in
Chromium, independent of the table's `display` -- the app's
`.markdown-body table { display: block }` is not the cause and changing it does not
help). Hybrid mode claims the plain arrow keys (`onEnterKey`, `static/js/hybrid.js`)
and moves the caret to the spatially adjacent cell itself: `↑`/`↓` always cross a
row, `←`/`→` cross only at the cell's text edge so movement within the cell's own
text stays native, and no modifier chord is claimed (`Alt+←/→` reorder columns).
At a table edge the caret leaves to the nearest caret-holding block, or falls
through to the browser when there is none. These handlers move the caret only and
never touch the note. Pinned by the jsdom `hybrid table-nav` checks and the
real-browser `table-nav` checks in `tests/browser/test_hybrid_browser.js`.

### 4.13 Blank-line runs and gaps

A run of blank lines is a `space` token owned by the preceding block; carried raw
(`PLAN.md:95-99`).

| Op | Before | After | Status |
|---|---|---|---|
| edit a neighbour | `a\n\n\n\nb\n` | `a\n\n\n\nB edited\n` | ✅ test `7577-7579` |
| ⇧↵ adds a line | `one` | `one\n\n` | ✅ test `4585-4594` |
| rule-edge caret line | (empty, marked) | removed on save | ✅ `:417-421` |
| delete rule, keep user blank | `alpha\n\n---\n\n\n\nomega` | blank line kept | ✅ test `5555-5570` |
| trailing blank | `tail\n` | preserved, no NUL sentinel | ✅ tests `5688-5696` |
| blank run beside structural edit | `a\n\n\n\nb` + new block | **collapses** until Q1 | ✳ Q1: must preserve |

### 4.14 HTML comments and raw HTML

Rendered as comment nodes / raw elements. Carried as `raw` segments and **never
regenerated** (`PLAN.md:69`, the segment model at `hybrid.js:625-680`, assumption
`PLAN.md:179-182`). A raw-HTML document deliberately makes the splice fail closed
(`htmlTokenElementCount` `hybrid.js:656-680`).

**Q10 is DECIDED and implemented:** raw HTML stays editable in place, and an edited
raw block writes back its own `outerHTML`. `markRawHtmlBlocks` marks authored
block-level elements at render time (renderer containers excluded), the turndown
rule stashes the markup behind a sentinel so the Markdown clean-up passes cannot
rewrite it, and `postProcessMarkdown` restores it. An untouched block still keeps
its original source bytes through the splice.

| Op | Before | After | Status |
|---|---|---|---|
| edit a neighbour | `a\n\n<!-- keep -->\n\nb\n` | comment kept | ✅ test `7586-7603` |
| clean round-trip | `<!-- c -->\n\nbody\n` | byte-identical | ✅ corpus `7684` |
| paste rich HTML | — | stripped to plain text | ✅ Q9 |
| edit inside a raw element | `<div>block</div>` | `<div>block!</div>`: tag and attributes kept | ✅ `markRawHtmlBlocks` + raw-HTML rule; browser test |

### 4.15 Special fenced blocks (`mermaid`, `wavedrom`, `math`/`katex`, `dot`/`graphviz`, `html-live`, plain `html`)

Rendered blocks are **atomic**: `contenteditable="false"` + `data-hybrid-atomic`
(`:1110-1113`), so the caret skips over them like an `<hr>`. Click-to-edit swaps in an
editable `<pre>` with a language pill. Round-trip is owned by `NB.blocks`
(`:477-478`); `math`/`katex` always write back as `math`
([markdown.md](markdown.md)), `dot`/`graphviz` as `dot`.

| Op | Before | After | Status |
|---|---|---|---|
| arrow-walk past rendered block | — | caret skips it; marked atomic | ✅ `markAtomicBlocks` `:1110`, test `8061-8065` |
| click rendered block | ` ```mermaid\ngraph TD\n``` ` | editable `<pre>` + pill | ✅ `editPluginSource` `:4080`, tests `5954-6013` |
| blur editing block | source | re-render container | ✅ tests `6030-6031`, `6161-6166` |
| edit source, save | `graph TD` | ` ```mermaid\ngraph TD\n``` ` | ✅ tests `6386-6400`, `8082-8086` |
| error block | bad source | ` ```mermaid ` + original source | ✅ tests `6485-6490` |
| ⇧↵ beside/inside | block | `<p>` **after** the top-level block | ✅ test `4914-4933` |
| G / heading inside | — | **refused** (protected) | ✅ `:1229` |
| no edit | any plugin block | fence byte-identical | ✅ tests `6420-6437` |
| `html-live` source `height` hint | comment line | preserved in fence | ✅ [markdown.md](markdown.md) |
| pasting into the click-to-edit `<pre>` | — | remains plain text, never elements | ✅ §6 Q9 |

### 4.16 Inline constructs

Rendered inline elements inside a block. Live rules fire on the **closing
delimiter at the caret in a single text node** (`INLINE_RULES` `hybrid.js:1559`,
`applyInlineRules` `hybrid.js:1645`). Keyboard toggles: `Ctrl/Cmd+B` `strong`,
`Ctrl/Cmd+I` `em`, `Ctrl+Shift+X` `del`, `Ctrl+Shift+C` `code` (`:2482-2521`,
`toggleInline` `:1705`). Canonical outputs: `a **b** c`, `a *b*`, `a ~b~`
(strikethrough via the GFM plugin), `` a `b c` ``, `[x](u)`, `![a](s)`,
`[[Target|label]]` (`hybrid.js:188-195`).

| Construct | Position | Op | Before | After | Status |
|---|---|---|---|---|---|
| `**bold**` | T | type `**bold**` | `` | `<strong>bold</strong>` → `**bold**` | ✅ tests `4396-4404` |
| `**bold**` | M | Ctrl+B on selection | `a b c` (b selected) | `a **b** c` | ✅ tests `4506-4511` |
| `**bold**` | M | Ctrl+B again | `a **b** c` | `a b c` (unwrapped) | ✅ tests `4513-4522` |
| `*italic*` | T | type | `` | `<em>italic</em>` | ✅ `:1560` |
| `_italic_` | T | type | `` | new live rule | ✳ Q5: rule to be added |
| `~~strike~~` | T | type | `` | `<del>` → `~b~` | ✅ `:1563` |
| `` `code` `` | T | type | `` | `<code>` → `` `code` `` | ✅ `:1564`, tests `4406-4409` |
| whitespace code | — | save | `` `   ` `` | `` `   ` `` preserved | ✅ `CODE_SPACE_SENTINEL` `:81`, tests `7168-7170` |
| `[link](url)` | — | edit-bar Link | selection | `[sel](url)` | ✅ `:2697-2701` |
| `![image](src)` | — | edit-bar Image | selection | `![sel](src)` | ✅ `:2702-2706`; standalone image survives `6997-7003` |
| autolink | — | no edit | `<http://x>` | untouched bytes kept | ✅; edited canonicalizes to `[url](url)` |
| `[[wikilink]]` | T | type `[[` | `` | new live rule | ✳ Q5: rule to be added |
| `[[wikilink]]` | — | no edit | `[[b]]` | `[[b]]` | ✅ tests `5620-5625` |
| `[[Target\|label]]` | — | no edit | `[[b\|File B]]` | `[[b\|File B]]` | ✅ test `5620-5625` |
| entity `&nbsp;` | — | save | `a&nbsp;b` | NBSP preserved | ⚠ verify save-side `&nbsp;` |
| literal `#` | S | type `#` no space | `` | `\#` | ✅ escape `vendor:738`, test `4414-4417` |
| literal `*` | M | type `*` | `a` | `a\*` | ✅ escape `vendor:734` |
| literal `_` | M | type `_` | `a` | `a\_` | ✅ escape `vendor:744` |
| literal `[` | M | type `[` | `a` | `a\[` | ✅ escape `vendor:741` |
| leading digit | S | type `1. x` | `` | `1\. x` | ✅ escape `vendor:745` |
| escaped asterisk | — | no edit | `literal \*not em\* text` | survives as text | ✅ test `7999-8001` |
| inline over 2 blocks | F | Ctrl+B spanning blocks | `p1…p2…` | refused, unchanged (toast) | ✅ §6 Q11 |

#### 4.16.1 Inline rule boundary conditions

- The trigger must be inside **one text node** (`node.nodeType === TEXT_NODE`
  `hybrid.js:1654`); a delimiter split across nodes does not convert.
- `**bold**` requires a non-space first inner char and no `*` inside
  (`:1559`); `*italic*` uses lookarounds so it does not match `**`.
- Inline rules never fire in a fence or plugin editor (`:1650-1651`).
- `_italic_`, `+ ` bullets, `1) ` ordered lists, and `[[wikilinks]]` are **to be
  added** (Q5).

---

## 5. Cross-cutting rules

These apply to every construct and override a per-construct row on conflict.

### 5.1 Enter versus Shift+Enter

Word-like meaning (goal G1 + G4b): **`Enter` starts a new line; `Shift+Enter`
breaks inside the current line.** Both must save as clean Markdown, and one press
is exactly one break (invariant I9).

- **`Enter`** = "start the next block, or continue this construct": a new
  paragraph, a new list item, a new quote line, the fence's own newline. It saves
  as the construct's own continuation or as one blank line between blocks — never
  as a `<br>`, never as several newlines. At the very start of a list item
  (before its first character, after the checkbox for a task item) the new
  item opens **above** the caret item, matching the native editor; elsewhere
  it continues below. Claimed exceptions: a ` ``` `-only
  paragraph converts to a code block (`:2601-2616`); an **empty list item**
  outdents to a paragraph (`:2619-2643`); at a horizontal-rule edge it opens a
  fresh line (`openLineAtCaretRule` `:2343`).
- **`Shift+Enter`** = a new line out of the current block, decided in §6 Q15. It
  inserts an empty new top-level block *after this block* (`insertLineBelow`):
  climb to the top-level ancestor and insert a `<p>` after it, so the container is
  never extended (no second quote line, no second list item, no table row, no
  swallowed fence break). The inserted line carries `data-hybrid-caret` and is
  dropped on save while empty. It is deliberately not an in-block `<br>`.
- At a rule edge both keys open the line on the caret's own side
  (`openLineAtCaretRule` `:2343`).

Verified saved bytes (vendored Turndown, `codeBlockStyle:"fenced"`):

| DOM after the edit | Saved Markdown | Break count |
|---|---|---|
| `<p>a<br>b</p>` | `a  \nb` | one (soft) |
| `<p>a</p><p>b</p>` | `a\n\nb` | one (block) |
| `<p>a<br><br>b</p>` | `a  \n  \nb` | two (soft) |
| root `a<br>b` | `a  \nb` | one (soft) |

A literal `<br>` never reaches the file from these paths.

### 5.2 How a block merges with a neighbour

Word-like meaning (goal G1): `Backspace` at the start of a line joins it to the
line above; `Delete` at the end of a line pulls the line below up. No word is
lost, and the file stays clean Markdown.

Only the horizontal rule has a specified merge model today (`ruleForDeleteKey`
`:2220`: `Delete` deletes forward, `Backspace` backward). For **all other
blocks** the merge is the browser's native `contentEditable` behavior, which is
not specified or tested. The intended spec, proposed here:

1. `Backspace` at **S** of block *B* removes *B*'s marker and joins *B*'s content
   to the end of the previous block *A*'s content, preserving both texts; the
   merged block keeps *A*'s type. If *A* is a heading and *B* a paragraph, the
   result is one paragraph containing both texts (no word lost).
2. `Delete` at **E** of block *A* joins *B* into *A* symmetrically.
3. Merging a list item into a preceding paragraph (or vice versa) collapses the
   list structure only for the merged item; the rest of the list stays.
4. A merge that would leave a construct with a required marker but no content
   (a table with no rows, a zero-column table) is refused, as the existing table
   guards already do (`:3729`, `:3769`).
5. Byte preservation of the neighbour applies as a Q1 consequence — see §5.5.

One browser artifact is normalized: Chromium wraps the text it carries across a
merge in a presentational `<span style="font-size: …">` copied from the source
block, so joining a second heading into a title rendered the moved words a size
bigger inside it (and repeated splits/joins compounded it). Hybrid has no span
formatting, so `normalizeEngineSpans` (`hybrid.js:1847`) clears an inline
font-size/font-weight on a class-less, id-less span in the caret's block. The
saved bytes are unchanged (Turndown discards the span either way); this fixes the
live view. Verified in Chromium.

Status: ⛔ none of 1–4 is implemented; `⌫`/`⌦` on paragraphs/lists/quotes is
unasserted.

### 5.3 Creating a new block

- New block type defaults to `<p>`; `defaultParagraphSeparator` is set to `p` on
  entry (`:3261`).
- `Shift+Enter` and rule-edge `Enter` insert a `<p>` via `insertEmptyBlock` /
  `insertEmptyBlockAround` (`:1964` / `:1973`) — deliberately not `execCommand`
  (`:1958-1967`).
- The new block is inserted **after the block the caret is in**, not after the
  container's last child, except at a root caret, where the caret offset decides
  (`:2415-2440`).
- A new empty `<p>` serializes to a blank line and is dropped while it carries
  `data-hybrid-caret` (`:417-421`).

### 5.4 Escaping literal syntax characters

Text emitted from an **edited** block is escaped by Turndown's `escape`
(`vendor:732-746`, `:867-869`): `\`, `*`, `_`, `` ` ``, `[`, `]`, leading `-`,
`+ `, `=`, `#`, `~~~`, `>`, and leading `1. `. Escaping applies to text nodes not
inside code (`node.isCode`, `:889`). Escaping does **not** apply to untouched
blocks, whose bytes are carried raw. The rule, stated once:

> If the user typed or now has literal syntax characters as *text*, they are
> escaped on save; if the user did not touch the block, its original bytes —
> escaped or not — are preserved.

### 5.5 Write-back splice

- `spliceSave` re-serializes only blocks whose content hash changed; all other
  `block`/`gap`/`raw` raws are emitted verbatim (`hybrid.js:913-980`).
- The hash covers tags, non-chrome attributes, text, comments, and
  `input.checked`; it strips `contenteditable`, `data-hybrid-*`, heading ids, and
  the zero-width-space placeholder (`isHashStrippedAttr` `:707`,
  `canonicalSubtree` `:714`).
- Plugin container subtrees are hashed by **fence source**, not rendered pixels
  (`PLAN.md:212`).
- **Q1 (decided, implemented):** an element-count change no longer forces
  whole-file regeneration. `structuralSplice` (`:986`) matches the current top-level
  elements to baseline blocks **by content hash from both ends**: the unchanged
  prefix and suffix emit their original source bytes, and only the contiguous
  changed middle is re-serialized (a reorder re-serializes just the reordered
  region). Verified in Chromium and jsdom.
- Root-level text/comment count still guards the aux nodes (`:901`).

### 5.6 No-op and undo

- A save whose output equals `sessionSerialized` or `sessionSource` writes nothing
  (`isNoOpMarkdown` `:3426`).
- Undo/redo restore whole-DOM snapshots (`restoreSnapshot` `:3035`); node
  identity is deliberately not relied upon (`PLAN.md:79`). The splice baseline is
  re-seated only on enter, after a write, and on external change
  (`rebaseSession` `:3439`); undo relies on the hash/count checks, not a
  rebase.

---

## 6. Open questions

Each item is a decision needed before the matrix can be frozen. The recommendation
is the product-designer's; the owner decides.

**Q1 — DECIDED and implemented. Structural edits preserve untouched blocks.**
`structuralSplice` matches the current DOM against the baseline by content hash
from both ends; the unchanged prefix and suffix emit their original source bytes and
only the contiguous changed middle is re-serialized. A reorder re-serializes only
the reordered region. Verified in Chromium and jsdom: adding or deleting a block
keeps `* star a` bullets, a setext `Title\n=====` heading, and `    indented` code
byte-for-byte, and no `` ```undefined `` artifact is produced. §5.5 describes the
mechanism.

**Q2 — block merge is unspecified.** No code handles `⌫`/`⌦` for paragraphs,
headings, lists, or quotes; only `<hr>` (`hybrid.js:2220`). Browser-native
merges can move a paragraph's text into a heading, dropping the heading marker or
duplicating it. Proposed spec: §5.2. Owner decision: accept §5.2 or document native
behavior per engine.

**Q3 — typing at a block boundary that is not a rule edge.** Only rule edges are
protected (`openLineAtCaretRule` `:2343`). A root caret between two normal
blocks lets the engine prepend into the following block (e.g. text merged into a
heading). Proposed: protect every top-level block edge, not only `<hr>`; or accept
and test the native result.

**Q4 — canonicalization of an edited block's marker/style.** Editing a setext
heading emits ATX (`vendor:101-116`); editing an indented code block emits a fence
(`vendor:181-215`); editing an `<hr>` emits `* * *` (`vendor:754`); editing a
`*`-bulleted list emits `-   ` (`hybrid.js:175`). Correct per I2 for a *touched*
block but surprising. Proposed: keep and document in the Settings help text;
alternatively detect "same-construct, text-only" edits and keep the raw marker.
**Task lines are the exception**: turndown's `-   [ ]  text` padding is
collapsed to `- [ ] text` by `normalizeTaskListSpacing`, because the mismatched
spacing on every sibling item when one checklist line was edited read as a bug.

**Q5 — DECIDED. Add the missing live input rules.** `INPUT_RULES`
(`hybrid.js:1486-1553`) and `INLINE_RULES` (`hybrid.js:1559`) do **not** have
`+ ` bullets, `1) ` ordered lists, `_italic_`, or `[[wikilinks]]` today; typing them
yields escaped literal text. Add live rules for all four and list them in the
Settings help text.

**Q6 — DECIDED and implemented. `Enter` on an empty trailing blockquote line exits the quote.** `exitEmptyBlockquote` mirrors the empty-list-item rule: it removes the empty line and inserts a paragraph after the quote. An empty line in the middle of a quote keeps the native behaviour (the following quote lines are still content). Verified in Chromium (`test_hybrid_blocks_browser.js`).

**Q7 — DECIDED and implemented. An emptied blockquote survives as `>`.** Turndown
drops an empty `<blockquote>` (verified: `conv("<blockquote></blockquote>") === ""`),
while an emptied heading keeps `###` and an emptied list item keeps `-`. By the
owner's model a ">" line with zero words is a valid block. Fixed with
`markEmptyBlockquotes` + `EMPTY_QUOTE_SENTINEL`; verified in Chromium and jsdom.

**Q8 — table-cell boundary keys.** `Backspace`/`Delete` at a cell edge is
browser-native. `Enter` inside a cell is now refused with a notice: a newline in
a cell splits the GFM row and breaks the table on the next render. `caretDirectlyInTop`
deliberately excludes cells (`hybrid.js:2138`) so the rule-edge repair does not apply.
Verified in Chromium (`test_hybrid_blocks_browser.js`).

**Q9 — DECIDED. Paste parses Markdown into blocks.** `doPaste`/`doPastePlain`
(`:2837`/`:2862`) today insert plain text with `<br>` between lines
(`insertTextAtCaret` `:2893`), turning multi-line Markdown into one paragraph
of hard breaks; native `Ctrl+V` is unhandled and inserts HTML. New behavior:
(a) Paste parses clipboard **text** with marked and inserts the rendered blocks at
the caret; (b) Paste without formatting keeps the current plain-text behavior;
(c) rich HTML is stripped to text. Verify in the Chromium harness.

**Q10 — DECIDED (editable in place), one fork open.** Raw HTML stays editable in
hybrid; the `html` token must be aligned by the splice. Untouched raw HTML keeps
its source bytes. **Fork:** an *edited* raw HTML block — Turndown has no rule for
`<div>`/`<details>` and would unwrap the tag to its text. To honor in-place editing
without loss, the save path must re-emit the element's own HTML
(`<div>block edited</div>`). Alternative: accept the unwrap. Owner to decide.

**Q11 — inline format across blocks. DECIDED and implemented: refuse.** A
selection whose endpoints do not resolve to one top-level block is refused
unchanged (a toast, no DOM edit), so the `extractContents` fallback can no
longer pull block content into `<strong>`/`<em>`. Both-null endpoints (a drag
that anchors on the editor root) are refused too. Same-block selections still
wrap/unwrap as before.

**Q12 — DECIDED and implemented. An empty block must accept typed text.** A caret
in an empty `###` is redirected in Chromium because the heading has zero height;
verified: typing into the empty h3 of `## Commands\n###\n...` produced `Hellobody`
inside the following paragraph. Fixed with `addEmptyLineBoxes` (`:1442`), which
appends a marked caret `<br>` to every empty block on enter/render; the box gives
the block a line box (measured 21.9px) and is stripped on save, so an untouched
`###` still serializes to exactly `###`. Verified in Chromium: text now lands in
the heading.

**Q13 — DECIDED and tested. `~~~` fences.** An untouched tilde fence is
byte-identical; touching one canonicalizes it to a backtick fence. Covered by the
byte-identity corpus and `test_block_edit_browser.js`.

**Q14 — cut/copy across blocks.** Context-menu `Copy` uses `sel.toString()`,
which loses markers and joins lines; native `Ctrl+C` is unhandled. Decision for
rules: selection and copy stay the browser's own, identical in hybrid and
preview mode, and no app copy path is added (§4.11). A rule selected this way
carries no text, which is accepted; the highlight class makes it visible.

**Q15 — DECIDED: keep the next-line-out behavior.** `Shift+Enter` inserts a
new empty top-level `<p>` after the current block (`insertLineBelow`): one new
line out of the block, not an in-block `<br>`. The owner chose this explicitly.
`Enter` remains the block/paragraph break. The existing jsdom and Chromium
checks pin this behavior; it is not a data-loss path.

**Q16 — DECIDED. In hybrid mode, one `Enter` adds one line break.** The owner's
words: "single new line, I don't see why we need double next line." This is about
the editor's behavior while editing, not about the Markdown file's blank-line
convention and not about the renderer. A single `Enter` must not produce several
newlines; no idle action may add a break. See "The line-break rule", I9, and AC7.
Today it is violated (Q18).

**Q17 — WITHDRAWN.** An earlier draft misread Q16 as "the file must have no blank
line between blocks" and proposed switching the renderer to `breaks:true` with a
`br`→`\n` rule. That is not what the owner asked for. Blank lines between Markdown
blocks are normal and stay; the `breaks` option is left at its current value
(`false`). No renderer change.

**Q18 — the empty-list-item junk is FIXED; the separator/trailing-newline question
belongs to Q16.** Real Chromium, this revision:

- (fixed) `Enter` on a list item produced `-   item\n-     \n    \n` — trailing
  spaces and a stray indented line from the browser's `<br>` line box in the empty
  item. `markEmptyListItems` now strips the line box, so the item saves as a bare
  marker. Verified in Chromium and jsdom.
- (decided) `Enter` at the end of a paragraph saves `alpha beta\n\n`; the `\n\n` is
  one Markdown paragraph break, not an invented blank line (Q16). `Shift+Enter`
  opens a new block below the current one, not an in-paragraph soft break (Q15,
  decided).
- (open, Q16) `Enter` mid-paragraph saves `alpha be\n\nta` — the split the owner
  asked for, plus the standard block separator. Whether that separator count is the
  "one break" the owner means is part of the same open question.

**Q19 — DECIDED and implemented. The first block trigger in a brand-new note must
convert.** The root-caret branch of `applyBlockRules` (`hybrid.js:1618`) runs for a
caret sitting directly on `#viewer-content`. Its guard refused whenever the root had
**any** child (`blockEl.firstChild`), to keep a mid-note root caret (beside an `<hr>`)
from flattening every block into one `<p>`. But a brand-new empty note has no `<p>`:
the browser types the first characters straight into the root as a bare text node, so
that text node tripped the guard and `# ` stayed literal — saving as an escaped
`\# `. The guard now refuses only real **block** content: `hasBlockContent`
(`hybrid.js:1619`) treats any root child that is not the editing placeholder `<br>`
as content, so an empty root is wrapped in a `<p>`, the placeholder `<br>` is dropped
first, and the block rules fire. Verified in jsdom (`test_dom.js:7382`) and Chromium
(`test_hybrid_browser.js:803`). The mid-note no-flatten guard is unchanged and still
covered by the root-caret test.

---

## 7. Non-goals

This is a single-user local notebook, not a general-purpose word processor. Not in
scope:

- Reimplementing a full Markdown parser or a browser editing engine. Prefer the
  native engine where its behavior is acceptable and testable.
- Live input rules for every GFM extension (footnotes, definition lists). Q5
  decides a fixed minimum set.
- Multi-cursor, collaborative editing, track changes, comments-in-margin.
- A full paste pipeline for arbitrary rich HTML (Office, web pages). Plain text and
  Markdown text are the contract.
- Round-tripping HTML the user pasted into a note into HTML on save. Output is
  Markdown (I4), always — except raw HTML the user already had, per Q10.
- Preserving byte-identity for a *touched* block's marker style (setext, `*` bullet,
  `---` rule, indented code). Canonical output per Appendix A is the contract for
  touched blocks.
- Fixing the empty-heading caret bug as part of this catalog; it is Q12, tracked
  separately.
- Any change to the `/api/edit` op vocabulary; that server contract
  (`app.py:397-431`) is the line-granularity reference this catalog stays
  consistent with.

---

## 8. Testability note

### 8.1 Mapping a matrix row to a jsdom `check(...)`

`tests/dom/test_dom.js` drives the real app modules in jsdom with a stubbed `fetch`
and `FILES` mock disk. A row maps to a test as follows:

1. Set `FILES["notes/a.md"] = <before>`; `viewer.close`, `tabs.open`,
   `hybrid.enter`, `tick` (idiom at `test_dom.js:4983-4991`).
2. Build the caret with one of the existing helpers: `caretAtEnd` (`4576`),
   `caretAtStart` (`5081`), `setRootCaret` (`5065`), `caretOnRule` (`5091`),
   `typeIn` (`4303`), or `selWord` (`4488`).
3. Dispatch a real DOM event: `pressShiftEnter` (`4573`), `pressEnter` (`5062`),
   `press` (`5117`), `pressKeys` (`4498`), or `clickRule` (`5108`).
4. Assert on the DOM (`blockHTML` `5123`) **and** on
   `window.NB.hybrid.domToMarkdown()` or `FILES["notes/a.md"]` after `save()`
   (`fetchLog` counting at `4994`).
5. For no-op rows, assert `fetchLog.filter(x => x.startsWith("POST /api/file"))
   .length` is unchanged (pattern at `7249-7251`).

Every row's "after" is a string; the check should assert that exact string when the
whole file is known, or a substring plus the no-HTML regex for a touched block.

### 8.2 Rows that must use the Chromium harness

`tests/browser/test_hybrid_browser.js` (Playwright, run `npm run test:browser`) is
required wherever the **native editing engine** produces the DOM that jsdom cannot:

- Any row marked 🌐: `Enter` splits, cell merges, `Tab` between cells, IME.
- Native typing into an empty heading (Q12) — the known redirect bug.
- Paste: native `Ctrl+V` rich HTML and multi-line Markdown (Q9). The current
  harness has no paste test.
- Backspace/Delete block merges (Q2, Q8): the merged DOM is engine-specific.
- Arrow-walk over atomic plugin blocks and table rows (why `flattenTheads` exists,
  `:1467`).
- Any assertion about file bytes after a structural edit (Q1), because the
  browser's element tree, not jsdom's, decides the count.
- List-item drag geometry (§4.7.2): grip reveal and hide, the before/after boundary, the
  checkbox/marker-gutter hit region, the indent-rail depth choice, creating a line box on a
  freshly emptied item before measuring, the drop line, subtree carrying, and touch — all
  read layout the jsdom harness stubs away. The DOM mutation and serialization are tested in
  jsdom; only the pointer path is native. The module is a second implementation, not a small
  patch to `table-edit.js` (see the §4.7.2 preamble); the estimate and Playwright budget must
  reflect that.

The harness already provides `caretInBlock` (`test_hybrid_browser.js:70`),
`writeNote`/`readNote` (`:59-65`), and the locality corpus (`:216`). Extend it;
do not add a separate runner.

### 8.3 Corpus additions implied by this catalog

Add to the byte-identity corpus (`test_dom.js:8013-8023`) and the locality test
(`test_hybrid_browser.js:216`):

- `~~~\ntext\n~~~\n` (Q13)
- `> outer\n> > inner\n` in the byte-identity corpus
- `- [ ] task\n` and `- [x] task\n` in the byte-identity corpus
- A nested list `- a\n    - b\n`
- A `+ a\n` bullet and a `1) a\n` item, to pin Q5
- An empty blockquote `>\n`, to pin Q7
- A hard-break paragraph `a  \nb\n`, to pin the line-break rule (I9)
- A raw HTML block `<div>x</div>\n`, to pin Q10
- The owner's example `## Commands\n###\n### `   `\n` (Q16) — must be
  byte-identical after enter+save

The Q5/Q7/Q10/`~~~`/nested-list/owner entries already exist as contract cases
(`HYBRID_CONTRACT_CASES`, `test_dom.js:8680-8939`) and as browser corpus entries
(`test_hybrid_browser.js:457-463`).

### 8.4 Acceptance criteria

- AC1. For every construct and every position row marked ✅ or ✳ in §4, a jsdom
  `check(...)` asserts the stated "after" string or the exact DOM shape.
- AC2. Every count-changing edit (Q1) has a test asserting the untouched
  neighbours' bytes are preserved.
- AC3. Every 🌐 row has a Chromium assertion in `tests/browser/test_hybrid_browser.js`.
- AC4. No test observes a `<tag>` at line start outside a fence (I4), on any edit
  except raw HTML the user already had (Q10).
- AC5. A clean enter+save, enter+exit, and save+exit issue zero
  `POST /api/file` (I3).
- AC6. `_italic_`, `+ `, `1) `, and `[[ ]]` have live rules and the Settings help
  text (`index.html:558-566`) lists them.
- AC7. **One `Enter`, one break (I9).** For every block type, a single `Enter`
  produces exactly one line break — never several, never a `<br>`. No idle action
  (focus change, click, save) adds a break. Assert the exact saved string in both
  jsdom and the Chromium harness. The owner's example
  `## Commands\n###\n### `   `\n` must round-trip byte-identically.
- AC8. **The raw file has no presentation HTML (I8).** After every edit in the
  matrix, `domToMarkdown()` contains no `<br>`, `<div>`, `<span>`, or `<table>`
  outside a fence, except HTML the owner already had (Q10).
- AC9. **A list drag is a clean structural move (§4.7.2).** Dropping a list item subtree
  and saving re-serializes only the containing list block — or, on the count-changed path,
  only the changed middle — and every untouched block keeps its bytes (extends AC2). The
  moved `<li>` subtree, its inline markup, its checkbox state, and an empty item's marker
  all survive. Covered for a root list, a blockquote-nested list, and a table-cell list.
- AC10. **Ordered renumber.** After a move in an ordered list, the emitted `<ol>` is
  renumbered as a contiguous run with canonical `N.  ` padding; a moved item takes its
  new position's number and keeps none of its old literal marker.
- AC11. **Task state rides along.** Moving a checked or unchecked task item — including
  as a parent carrying children — preserves every moved item's `[ ]`/`[x]`; a differing
  parent state does not change a child's.
- AC12. **Tight/loose and empty survive.** In the DOM, a moved tight item stays tight and a
  moved loose item keeps its `<p>`; in the saved bytes, a task item is canonicalized by
  `normalizeLooseTaskItems` (`hybrid.js:371-379`) and so may not carry that `<p>`, while a
  non-task item emits the shape its DOM has. An item that was empty before the move still
  saves as a bare marker (`-` / `1.`), including a checkbox-only item's trailing space.
- AC13. **No-op drop writes nothing.** A drop resolving to the item's current position
  issues zero `POST /api/file` (the `isNoOpMarkdown` pattern, §5.6).
- AC14. **One drag, one undo.** A completed drag is a single undo step that restores the
  pre-drop DOM; Esc mid-drag leaves the DOM and the history unchanged.
- AC15. **Cross-list and non-list drops are refused, before any flush or mutation.** A drop
  outside the dragged item's own movable list container (its outermost `<ul>`/`<ol>`
  ancestor), or onto a non-list block, leaves the DOM and the undo history unchanged and
  writes nothing; the refusal is decided before `flushPendingSnapshot()` runs.
- AC16. **Drag chrome never reaches content.** No `.nb-*` class or drag attribute appears
  on any list node in the live DOM, in a Turndown clone, or in a snapshot during or after
  a drag.
- AC17. **Keyboard parity and announcement.** The List submenu moves a list item up/down
  among siblings and the caret follows; each completed move (drag or keyboard) is
  announced in an `aria-live` region and never changes the note outside the list block.

**Test split for §4.7.2.** jsdom (§8.1) drives the resolved move through the exported
hybrid list-move entry point — the way `moveRow`/`moveCol` are tested — so the DOM
mutation, ordered renumbering, sentinel survival, no-op, undo, refusal, and serialized
bytes are asserted without layout. The Chromium harness (§8.2) is required for the
pointer path, which reads `getBoundingClientRect`: grip reveal and hide, the
before/after boundary, the indent-rail depth clamp, the drop line, subtree carrying, and
touch `touch-action`. No backend test changes.

---

## Appendix A — Canonical serializer output for a touched block

Verified against the vendored bundles at this revision with the exact
`ensureTurndown` options (`hybrid.js:173-180`).

| DOM | Canonical Markdown |
|---|---|
| `<p>hello</p>` | `hello` |
| `<h3>Title</h3>` | `### Title` |
| `<h1>T</h1>` | `# T` |
| `<ul><li>a</li><li>b</li></ul>` | `-   a\n-   b` |
| `<ol><li>a</li><li>b</li></ol>` | `1.  a\n2.  b` |
| nested `<ul>` | `-   a\n    -   b` |
| `<blockquote><p>q</p></blockquote>` | `> q` |
| `<blockquote><p>a</p><p>b</p></blockquote>` | `> a\n> \n> b` |
| `<hr>` | `* * *` |
| task item checked | `- [x] done` |
| GFM `<table>` | `\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|` |
| `<pre><code class="language-python">` | ` ```python\nprint(1)\n``` ` |
| bare `<pre><code>` | ` ```\nplain\n``` ` |
| `<p>a<br>b</p>` | `a  \nb` (two-space hard break) |
| `<p>a <strong>b</strong> c</p>` | `a **b** c` |
| `<p>a <em>b</em></p>` | `a *b*` |
| `<p>a <del>b</del></p>` | `a ~b~` |
| `<p>a <code>b c</code></p>` | `` a `b c` `` |
| `<p><a href="u">x</a></p>` | `[x](u)` |
| autolink | `[http://x.com](http://x.com)` |
| `<p><img src="s" alt="a"></p>` | `![a](s)` |
| wikilink | `[[Target]]` or `[[Target\|label]]` |
| `<p><br></p>` (empty) | `` (blank line, `paragraph` rule `:231-241`) |
| empty `<h3>` | `###` |
| empty `<li>` | `-` / `1.` |
| empty cell | `\|  \|` (column kept) |
| empty `<blockquote>` | `` (dropped — Q7) |
| literal `#`/`*`/`_`/`[` text | `\#` / `\*` / `\_` / `\[` |
| `<p>a<br>b</p>` | `a  \nb` (one soft break; **never** `<br>`) |
| root `a<br>b` | `a  \nb` (one soft break; **never** `<br>`) |
| `<p>a<br><br>b</p>` | `a  \n  \nb` (two soft breaks) |
| `<h2>a<br>b</h2>` | `## a  \nb` |
| `<ul><li>a<br>b</li></ul>` | `-   a  \n    b` |
| `<blockquote><p>a<br>b</p></blockquote>` | `> a  \n> b` |

---

## Handoff summary

- **Features.** One: hybrid (WYSIWYG) editing. This document is its
  construct-by-construct behavior spec.
- **Goal.** Edit Markdown like a Microsoft Word document; keep the raw file clean,
  readable Markdown. Rich blocks (mermaid/math/etc.) render in place and edit as
  source; tables edit through the table tool; no presentation HTML in the file; one
  `Enter` is one break. See "The goal".
- **MVP line.** All §4 constructs at positions S/T/M/E/B/∅ for the operations C,
  Enter, Shift+Enter, Backspace, Delete, delete-all, save. Paste, cross-block
  cut/copy, and merge are specified but gated behind Q2, Q9.
- **Decided and implemented.** Q1 (`structuralSplice` preserves untouched blocks
  on structural edits), Q5 (added the missing live rules `_italic_`, `+ `, `1) `,
  `[[wikilinks]]`), Q7 (an emptied blockquote survives as `>`), Q11 (cross-block
  inline format is refused), Q12 (empty blocks
  get a caret line box so typed text lands in them), Q18 (an empty list item saves
  as a bare marker, no junk), Q19 (the first `# ` typed into a brand-new empty note
  becomes a heading, not an escaped `\# `). G4/I8 (no HTML in the file), G4b/I9/Q16
  (one `Enter` adds one break), G2b, G3b, Q10 (raw HTML stays editable). Selection
  and copy use the browser's own engine in hybrid and preview alike; a horizontal
  rule is selectable like a character (§4.11).
- **Withdrawn.** Q17 (a renderer `breaks:true` change) — it misread Q16 as a
  file-format rule. No renderer change.
- **Biggest remaining question.** Q2 (block merge), then Q3 (block-edge typing).
- **Next decisions, in order.** Q2 (merge), Q3 (block-edge typing), Q8 (cell
  boundary keys), Q14 (copy across blocks).