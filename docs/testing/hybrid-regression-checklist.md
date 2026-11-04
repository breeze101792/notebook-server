# Hybrid edit-mode regression checklist

Status: active, green. Owner: `tester`. Baseline: full run 2026-11-04 (Chromium 156.0.8078.73); the previous baseline was commit `09fdfd6`, 2026-10-31.

This is the pre-change gate for `static/js/hybrid.js`. It is not a behavior
spec: the authority for what hybrid must do is
[`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md)
(construct-by-construct spec) and
[`../product/hybrid-block-marker-backspace.md`](../product/hybrid-block-marker-backspace.md)
(newest interaction). This file answers a narrower question: **what must I run
and look at before I commit a hybrid change, and where is each guarantee
tested?**

The expected column is a one-line reminder, not a second spec. If it disagrees
with those two documents, they win and this file is wrong.

## 1. Does a checklist exist today?

No single pre-change checklist existed. Several artifacts partially cover it:

| Artifact | What it is | What it covers | What it is not |
| --- | --- | --- | --- |
| `docs/architecture/hybrid-editing.md` | Behavior catalog, 1632 lines | Every construct at every position/operation, with status marks and a "Test suite" section | A runnable checklist. Its counts are a historical snapshot; today's are in §2. |
| `tests/dom/test_dom.js` coverage-map comment | Coverage map | Maps spec sections to `check()` names for the behavior-contract block | Operation-to-test map. It has no paste/cut, undo, export, phone, or real-IME mapping. |
| `docs/product/hybrid-block-marker-backspace.md` | Interaction spec | Backspace/Delete at the content start, with 18 acceptance criteria | Wired to the fence-editor suite; its Backspace-at-T cases were reconciled with this spec on 2026-10-31 (gap 1 resolved). |
| `docs/product/hybrid-shortcuts.md` | Shortcut spec | Hybrid chords and their display rows | Not a regression gate. |
| `docs/testing/frontend.md`, `docs/testing/browser-audit.md` | Suite descriptions and a past audit | What each suite owns, defects found, run commands | Not a pre-commit checklist. |
| `docs/operations/development.md` | Change checklists | Adding a renderer; adding a config key | No hybrid change checklist. |

So the automated net is real and broad, but there was no single
"about to touch hybrid.js" list, no AUTO/MANUAL/GAP map, and no smoke set.
This document supplies those three things and links to the rest.

## 2. Baseline (full run 2026-11-03, Chromium 156.0.8078.73)

The previous baseline was commit `09fdfd6` (2026-10-31). Everything below was
re-run with `npm run test:browser:all` plus the two host suites.

| Suite | Command | Result |
| --- | --- | --- |
| Backend | `.venv_nixlab/bin/python -m unittest discover -s tests -q` | **461 tests, OK** (52.7 s) |
| Frontend jsdom | `node tests/dom/test_dom.js` | **4777 ok, 0 failed** |
| Hybrid (real Chromium) | `npm run test:browser` | **169 ok, 0 failed** |
| Hybrid blocks | `npm run test:browser:hybrid-blocks` | **28 ok, 0 failed** |
| Fence editor | `npm run test:browser:blocks` | **184 ok, 0 failed** |
| Core UI | `npm run test:browser:core` | **186 passed, 0 failed** |
| Auth / export / PWA | `npm run test:browser:auth` | **99 passed, 0 failed** |
| AI / ACP / editor | `npm run test:browser:ai` | **40 passed, 0 failed** |
| AI blocks | `npm run test:browser:ai-blocks` | **44 passed, 0 failed** |
| Table editor | `npm run test:browser:table-editor` | **54 ok, 0 failed** |
| Figure sizing | `npm run test:browser:figure-sizing` | **96 ok, 0 failed** |
| Mobile | `npm run test:browser:mobile` | **102 ok, 0 failed** |
| Mermaid designer | `npm run test:browser:designer` | **36 ok, 0 failed** |
| Dot / WaveDrom designer | `npm run test:browser:dw` | **67 ok, 0 failed** |

`npm run test:browser:all` therefore reports **12/12 suites passed**.

The previous failure was a real deep-link defect, now fixed: the suite opens
more than 40 notes in one session, and a `?file=` deep link past the session's
tab cap was refused silently, leaving the previously restored note on screen
under the new URL. The clipboard checks then pasted into the wrong document,
and the next navigation timed out. `openDeepLink` now checks the result of
`NB.tabs.open`, closes a clean active tab to make room, and returns false when
it cannot open; boot keeps the URL on failure instead of stripping it.

## 3. Smoke set for "any hybrid.js change"

Run from the repo root. Use `CHROMIUM_PATH` when Chromium is not auto-detected.

```bash
# 1. Main DOM suite. Must be 0 failed.
node tests/dom/test_dom.js

# 2. The hybrid engine in a real browser. Must reach its summary with 0 failed.
CHROMIUM_PATH=/etc/profiles/per-user/shaowu/bin/chromium \
  node tests/browser/test_hybrid_browser.js

# 3. List/task/table/blockquote behavior. Must be 0 failed.
CHROMIUM_PATH=/etc/profiles/per-user/shaowu/bin/chromium \
  node tests/browser/test_hybrid_blocks_browser.js

# 4. Fence editor, atomic blocks, task edges, table delete, undo.
CHROMIUM_PATH=/etc/profiles/per-user/shaowu/bin/chromium \
  node tests/browser/test_block_edit_browser.js

# 5. Full browser gate. Must be 12/12 before commit.
CHROMIUM_PATH=/etc/profiles/per-user/shaowu/bin/chromium \
  node tests/browser/run_all.js
```

If the change touches `app.py` too, add the backend suite. If it touches a
renderer fence name/version/limit, also run backend (the `/agent.md` marker
check) and update both `static/js/ai.js` and `agent.md` in the same change.

**Do not commit on a red run.** The automated gate is green (12/12 browser
suites, 461 backend tests, 4,777 DOM checks); keep it that way.

## 4. Checklist

Columns: **Tag** is `AUTO-js` (jsdom), `AUTO-br` (real Chromium),
`MANUAL`, or `GAP`. Citations are the exact `check()` label; the section line
is given once per area. The authority for "expected" is the linked spec.

### A. Save and write-back integrity (highest risk: data loss)

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| A1 | Clean enter + exit writes nothing | Bytes unchanged, zero `POST /api/file` | `AUTO-br` `real browser: clean enter+exit preserves the file bytes`; `AUTO-js` `hybrid no-op: clean Save issues zero POST /api/file` |
| A2 | Clean Save + exit writes nothing | Same | `AUTO-br` `real browser: clean Save then exit leaves the file untouched`; `AUTO-js` `hybrid no-op: clean Close issues zero POST /api/file` |
| A3 | A real edit writes once, then is clean | POST once, dirty cleared | `AUTO-js` `hybrid no-op: a real edit still writes`, `hybrid no-op: dirty cleared after the write` |
| A4 | Untouched blocks keep their source bytes | Only the edited block re-serializes | `AUTO-js` `hybrid splice: only the edited paragraph changed`, `hybrid splice: the clean session serializes to the source exactly`; `hybrid: segment splice keeps untouched source bytes` |
| A5 | Structural edits preserve untouched blocks | Star bullets, setext, indented code, comments, blank runs survive | `AUTO-js` contract cases `Q1 C1: Shift+Enter keeps untouched bytes`, `Q1: a block delete keeps star bullets / setext / indented bytes`, `hybrid splice: an HTML comment survives an edit to another block`; `AUTO-br` `real browser Q1: structural Enter keeps star-bullet bytes` |
| A6 | An edit during an in-flight save is not lost | Newer bytes win | `AUTO-js` `hybrid splice: an edit during an in-flight save is not lost`, `hybrid autosave-race: the explicit save is the last write` |
| A7 | No presentation HTML reaches the file | No `<br>/<div>/<span>/<table>` outside authored HTML | `AUTO-js` every contract case with `expectedSaved`; `AUTO-br` `real browser: no HTML tag reached the file` |
| A8 | Empty heading keeps `###` | Byte-identical on no-op; survives text deletion | `AUTO-js` `hybrid fmt: empty heading round-trips to ###`, `hybrid caret: an empty block gets a caret line box on enter` |
| A9 | Empty list/ordered/quote keep their markers | `-`, `1.`, `>` survive | `AUTO-js` `hybrid fmt: empty list item round-trips to -`, `hybrid fmt: an empty ordered item round-trips to 1.`, `hybrid fmt: an emptied blockquote survives as >` |
| A10 | Empty task keeps its marker and trailing space | `- [ ] ` re-renders as a checkbox | `AUTO-js` `hybrid save: a loose task item keeps its [ ] marker`, `hybrid fmt: an empty list item holding a <br> saves as a bare marker` |
| A11 | Tables always serialize as GFM | Edited cell, headerless table, reordered table all valid GFM, never `<table>` | `AUTO-js` contract case `table: edited cell emits clean GFM`, `table: headerless table rebuilt as GFM`, `hybrid tables: reordered table saves valid GFM` |
| A12 | Escapes are stable | Literal `#`, `*`, `_`, `[`, `<tag>`, `&entity`, and backtick stay literal | `AUTO-js` contract cases `escape: literal #`, `escape: literal <tag> text stays encoded`, `escape: literal entity text stays encoded`, `escape: an escaped backtick does not open a code span` |
| A13 | Reference definitions and comments survive | Editing one block keeps `[id]: url` and `<!-- -->` | `AUTO-js` contract cases `refdef: editing a block keeps the definition and untouched bytes`, `comment: inline comment survives an edited paragraph` |
| A14 | A save after undo writes nothing | Undo restores baseline, save is a no-op | `AUTO-js` `hybrid splice: saving after an undo writes nothing` |

### B. Enter/exit, tab switch, watcher, AI refresh

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| B1 | Enter sets exactly the editing surface | `contenteditable`, `.hybrid-editing`, edit bar, topbar class, active button | `AUTO-js` `hybrid: contenteditable=true after enter`, `hybrid: .hybrid-editing class on viewer-content`, `hybrid: edit bar visible` |
| B2 | Exit removes every editing artifact | `contenteditable` null, classes/bar/button cleared, rendered content back | `AUTO-js` `hybrid: contenteditable removed after exit`, `hybrid: edit bar hidden after exit`, `hybrid: viewer-content has rendered content after exit` |
| B3 | Closing the active tab leaves no mode leak | Hybrid exits; next file opens in preview | `AUTO-js` `hybrid close: hybrid mode exited`, `hybrid close: next file opens in preview (no contenteditable)` |
| B4 | Dirty tab switch stashes a draft, does not save or prompt | No POST, tab stays dirty, Recover bar on return | `AUTO-js` `hybrid switch: no save POST fired`, `hybrid switch: the draft is retained`, `hybrid switch: the tab stays marked dirty`, `hybrid switch: the draft bar appears on return` |
| B5 | Recover restores the WYSIWYG buffer; Discard drops it | Recover enters hybrid with the text; Discard reloads saved | `AUTO-js` `hybrid switch: Recover restores the draft text`, `hybrid switch: Recover clears the stored draft`; `AUTO-br` `hybrid switch: Recover restores the WYSIWYG buffer` (`test_hybrid_blocks_browser.js`) |
| B6 | Autosave is quiet-period based and cancellable | No write inside quiet; exit(discard) cancels | `AUTO-js` `autosave: no write inside the quiet period`, `hybrid autosave-cancel: exit(discard) cancels the pending write` |
| B7 | Watcher own-save echo does not exit hybrid | Edit bar stays, cache takes fresh bytes | `AUTO-js` `hybrid external-change: own-save echo keeps WYSIWYG active`, `hybrid external-change: cache takes the fresh bytes` |
| B8 | Clean save after an external change writes nothing | External bytes preserved | `AUTO-js` `hybrid no-op: clean save after an external change writes nothing`, `hybrid no-op: the external bytes are preserved` |
| B9 | `ai:applied` refreshes in place, edit bar stays | Still in WYSIWYG editing | `AUTO-js` `ai:applied during hybrid keeps the edit bar visible`, `ai:applied during hybrid stays in WYSIWYG editing` |
| B10 | A clean re-enter has a clean baseline | `isDirty()` false | `AUTO-js` `no-op: clean after re-enter` |

### C. Block edges: Enter, Shift+Enter, Backspace, Delete

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| C1 | One Enter, one break, never `<br>` | Paragraph/list/heading/quote each add one break | `AUTO-js` contract cases `para: Enter adds no <br>`, `list: Enter adds no <br>`, `heading: Enter adds no <br>`, `quote: Enter adds no <br>`; `AUTO-br` `real browser Enter: one Enter writes one block break` |
| C2 | Shift+Enter inserts exactly one block below | One `<p>`, caret in it, note dirty | `AUTO-js` `hybrid: Shift+Enter adds a new empty <p> below`, `hybrid: Shift+Enter moves caret into the new line`, `hybrid: one Shift+Enter adds exactly one <p>` |
| C3 | Enter at a list item's content start opens an item above | Caret stays in the original text | `AUTO-js` `hybrid: Enter at a plain list item's start opens an item above`, `hybrid: Enter at a plain list item's start keeps the caret in the original item`; `AUTO-br` `real browser: Enter at a list item's start keeps the caret in the text below` |
| C4 | Enter on an empty list item exits the list | Paragraph after the list | `AUTO-br` `list: Enter twice on an empty item exits the list` (`test_hybrid_blocks_browser.js`) |
| C5 | Backspace at a formatted block's content start removes the marker, keeps text | Heading→paragraph, item→paragraph, quote line lifted | `AUTO-js` `hybrid marker: Backspace at a heading's T makes a paragraph`, `hybrid marker: a single bullet becomes a paragraph`, `hybrid marker: a task item drops its checkbox and class`, `hybrid marker: a one-line quote lifts its line` |
| C6 | Backspace at T never merges a neighbour | Previous/next block bytes unchanged | `AUTO-js` `hybrid marker: neighbours' DOM is unchanged`, `hybrid marker: neighbours' saved bytes are unchanged` |
| C7 | Forward Delete on a non-empty block stays native | Not prevented; first character eaten | `AUTO-js` `hybrid marker: forward Delete on a non-empty heading is not claimed`; `AUTO-br` `real browser Delete at T: the first character is eaten` |
| C8 | Delete on an empty formatted block removes the marker | Empty paragraph | `AUTO-js` `hybrid marker: forward Delete on an empty heading strips it` |
| C9 | Backspace/Delete removes a horizontal rule at the block edge | Rule gone, caret moved, undo restores | `AUTO-js` `hybrid hr: Backspace at the next block start removes the rule`, `hybrid hr: Delete at the previous block end removes the rule` |
| C10 | An emptied fence is removed as one block | Backspace/Delete removes it, undo restores | `AUTO-br` `empty: the next Backspace removes the block`, `empty: Delete removes the block too`, `empty: undo restores the removed block` (`test_block_edit_browser.js`) |
| C11 | An atomic plugin block is deleted deliberately at a neighbour edge | Container and fence source removed together, neighbours kept | `AUTO-br` `atomic: Backspace removes the plugin container`, `atomic: Delete removes the plugin container`, `atomic: Backspace keeps both neighbouring paragraphs` |
| C12 | A non-empty fence claims its own edge keys | The diagram is not merged away | `AUTO-br` `atomic: Backspace in a non-empty fence keeps the diagram`, `atomic: the non-empty fence stays in edit mode` |
| C13 | Task-item edge merge still works for Delete at content end and S | Joined text, second checkbox dropped | `AUTO-br` `task: Delete merges the next item into the current one`, `task: Delete keeps both words and drops the next box`; Backspace-at-T cases assert the marker strip |
| C14 | Toggling a checkbox writes `[x]`/`[ ]` and keeps the caret | Checkbox state reaches disk | `AUTO-js` `hybrid splice: toggling a checkbox writes [x]`, `hybrid: toggling a checkbox keeps the editing caret`; `AUTO-br` `real browser task: a checked checkbox saves as '[x]'` |

### D. Block transforms (headings, quote, lists, tasks, fences, tables, rules, images)

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| D1 | Typed triggers convert the line | `### `, `- `, `1. `, `> `, `[ ] `, `+ `, `1) `, triple-backtick | `AUTO-js` `hybrid: input rule '### ' makes an h3`, `hybrid: input rule '- ' makes a bullet list`, `hybrid: input rule '1. ' makes an ordered list`, `hybrid: input rule '> ' makes a blockquote`, `hybrid: input rule '[ ] ' makes a task item with checkbox`, ``hybrid: '```js' + Enter makes a code block``; `hybrid rule: '+ ' makes a bullet list`, `hybrid rule: '1) ' makes an ordered list` |
| D2 | Every list-type transition is defined | paragraph/bullet/number/task matrix | `AUTO-js` `hybrid edit bar: every list-type transition is defined`; `AUTO-br` `real browser list model: every dot/number/checkbox/quote transition is defined` |
| D3 | Quote wraps the top-level block and toggles off | No `<blockquote>` inside `<ul>`, no `<p>` in `<p>` | `AUTO-js` `hybrid edit bar: Quote wraps the top-level block and toggles off` |
| D4 | H1–H6 buttons convert and toggle | Caret preserved | `AUTO-js` `hybrid: H2 button converts <p> to <h2>`, `hybrid edit bar: caret is preserved inside the new h1` |
| D5 | Table insert is GFM and editable | 2-column table inserted, dirty | `AUTO-js` `hybrid table: clicking Insert table (menu closed) inserts a 2-col table` |
| D6 | Image/void block survives a save | No HTML leak | `AUTO-js` `hybrid void-blocks: a standalone image survives save`, `hybrid void-blocks: image save leaks no HTML` |
| D7 | Transforms refuse inside protected blocks | Table cell / fence unchanged | `AUTO-js` `hybrid block-guard: H2 inside a table cell is refused`, `hybrid block-guard: H2 inside a code fence is refused`, `hybrid edit bar: Task inside a code fence is refused` |
| D8 | A trigger in a brand-new empty note converts | `# ` becomes an `<h1>`, saves `#`, not `\#` | `AUTO-js` `hybrid empty note: '# ' typed into the root becomes an <h1>`; `AUTO-br` `real browser new note: '# ' typed into the empty note becomes an <h1>` |

### E. Inline formatting and links

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| E1 | Bold/italic/strike/code wrap and unwrap | Chords act on the selection | `AUTO-js` `hybrid: Ctrl+B wraps selection in <strong>`, `hybrid: Ctrl+B again unwraps <strong>`, `hybrid: Ctrl+I wraps selection in <em>`, `hybrid: Ctrl+Shift+X wraps selection in <del>`, `hybrid: Ctrl+Shift+C wraps selection in <code>` |
| E2 | Link chord inserts/updates/unwraps | Selection preserved; serializes `[label](url)` | `AUTO-js` `link: Mod+K wraps the selection and keeps it selected`, `link: Mod+K inside an existing link updates only the href`, `link: Mod+K with an empty URL unwraps the existing link` |
| E3 | Dangerous URL schemes are refused | `javascript:`, `data:`, entity-encoded, newline | `AUTO-js` `link: a javascript: URL is refused with a notice`, `link F2: dangerous / entity-encoded / newline schemes are refused` |
| E4 | Clear formatting strips block + inline, keeps links/images | One chord | `AUTO-js` `chords: Mod+\ strips a heading and inline emphasis`, `chords: Mod+\ leaves links and images intact` |
| E5 | Cross-block selection is refused intact | No partial `<strong>`, no note change | `AUTO-js` `hybrid hr inline: Ctrl+B across a block boundary inserts no <strong>`, `link: a cross-block selection is refused with the inline message` |
| E6 | Inline input rules | `**bold**`, `` `code` ``, `_italic_`, `[[wikilink]]` | `AUTO-js` `hybrid: input rule '**bold**' makes a <strong>`, ``hybrid: input rule '`code`' makes inline <code>``, `hybrid rule: '_italic_' makes an <em>` |
| E7 | Literal syntax is escaped, not reinterpreted | `#no-space`, `1. x`, `*`, `_`, `[` | `AUTO-js` `hybrid: plain '#no-space' text is not converted`, contract cases `escape: literal *`, `escape: literal _`, `escape: literal [`, `escape: leading digit 1. x` |

### F. Caret placement in empty blocks and at markers

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| F1 | Empty blocks get a caret line box on enter | Every empty `h1-h6/li/p/blockquote` gets one | `AUTO-js` `hybrid caret: an empty block gets a caret line box on enter`, `hybrid fmt: empty heading round-trips to ###` |
| F2 | The line box never reaches the file | No sentinel/ZWS/`<br>` | `AUTO-js` `hybrid caret: the caret line box never reaches the saved markdown` |
| F3 | An empty heading has real height and accepts text | Text lands in the heading | `AUTO-br` `real browser: an empty heading has a line box (height > 0)`, `real browser: typed text lands in the empty heading` |
| F4 | New list/task items anchor the caret in the item text | Not on the marker/checkbox | `AUTO-js` `hybrid: the UL button anchors the caret in the new item`, `hybrid Enter: the caret lands after the new task checkbox` |
| F5 | A caret parked on a task checkbox is nudged after it | Mouseup repairs too | `AUTO-js` `hybrid: caret before a task checkbox is nudged after it`, `hybrid: a mouseup repairs a caret parked on the checkbox` |
| F6 | The marker-strip caret lands at the new paragraph's start | Visible and typed text goes there | `AUTO-js` `hybrid marker: the caret lands at the new paragraph's start`; `AUTO-br` `real browser Backspace at T: the heading peels to a paragraph` |

### G. Clipboard and undo/redo

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| G1 | Copy writes the selection | Context menu and shortcut | `AUTO-js` `hybrid clipboard: Copy writes the selection to the clipboard`, `hybrid clipboard: Copy falls back to execCommand when the API fails` |
| G2 | Paste inserts text; plain paste inserts only text | No HTML flavour into a fence | `AUTO-js` `hybrid clipboard: Paste inserts the clipboard text at the caret`, `hybrid clipboard: Paste without formatting inserts only text/plain`; `AUTO-br` `paste: no HTML element reaches the fence` |
| G3 | Cutting a whole list item removes it cleanly | No empty bullet, no saved empty line | `AUTO-br` `real browser clipboard: cutting a whole item removes it`, `real browser clipboard: the cut leaves no empty bullet`, `real browser clipboard: the cut saves no empty list line` |
| G4 | Pasting list items makes clean siblings | Inline styles stripped, caret in text | `AUTO-br` `real browser clipboard: pasted items become siblings`, `real browser clipboard: pasted inline styles are stripped` |
| G5 | Task-item cut/paste keeps the checkbox | Survivor saved; pasted checkbox stays a task | `AUTO-br` `real browser clipboard: cutting a task item removes its checkbox`, `real browser clipboard: a type-less pasted checkbox stays a checkbox` |
| G6 | Undo/redo restores structure | Shift+Enter, marker strip, splice, removed block/fence | `AUTO-js` `hybrid: Ctrl+Z undoes a Shift+Enter`, `hybrid: Ctrl+Shift+Z redoes the Shift+Enter`, `hybrid marker: one undo restores the heading`, `hybrid splice: undo restores the original paragraph`; `AUTO-br` `empty: undo restores the removed block`, `atomic: undo restores the removed block and its source` |
| G7 | List drag reorder is undoable | One Ctrl+Z restores pre-drop DOM | `AUTO-js` `list reorder AC14: one Ctrl+Z restores the pre-drop DOM`; `AUTO-br` `real browser list drag: a completed drag reorders the list` |

### H. Tables: edit, view state, selection teardown

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| H1 | Row/column add, delete, move, align, header | GFM stays valid | `AUTO-js` `hybrid edit bar: Insert row below adds a body row`, `hybrid edit bar: Move row up reorders the body rows`, `hybrid edit bar: Align column cycles left -> center -> right -> left`, `hybrid tables: reordered table saves valid GFM` |
| H2 | Table view state is stripped at `hybrid:will-enter` | No hidden rows/sort/classes in the editor | `AUTO-js` `table view seam: contenteditable is null when hybrid:will-enter fires`, `table view seam: the overlay is already stripped at will-enter time` |
| H3 | Table view state re-applies after exit | Stored state returns in preview | `AUTO-js` `table view seam: the stored state re-applies after exiting hybrid` |
| H4 | A render during hybrid applies no view state | Live preview never rebuilds | `AUTO-js` `table view hybrid render: a real render during hybrid applies no view state` |
| H5 | Table-cell selection is cleared at `hybrid:will-enter` | Rectangle classes stripped synchronously | `AUTO-js` `table select (8): hybrid:will-enter clears it synchronously` |
| H6 | Ctrl+drag selection copies TSV and never writes the note | TSV rectangle, no POST | `AUTO-br` `table select: Ctrl+drag paints a rectangle`, `table select: the clipboard is TSV for the rectangle`, `table select: selecting never writes the note` |
| H7 | Enter inside a cell does not split the GFM row | Refused with a notice, typing stays in the cell | `AUTO-br` `table cell: Enter does not write a newline into the row`, `table cell: typing after the refused Enter stays in the cell` |

### I. Plugin and rendered blocks

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| I1 | Plugin containers are atomic while active | `contenteditable=false`, caret skips | `AUTO-js` `hybrid atomic: a rendered plugin container is non-editable while active` |
| I2 | Click-to-edit swaps to the fence source, blur re-renders | mermaid/wavedrom/katex/dot/html-live/svg | `AUTO-js` `plugin edit: container swapped for editable source block`, `plugin edit: blur re-renders the diagram`; `AUTO-br` `plugin: click swaps the diagram for its source` (`test_block_edit_browser.js`) |
| I3 | Plugin fences round-trip byte-identically when untouched | `mermaid`/`wavedrom`/`katex`/`dot`/`html-live` | `AUTO-js` contract cases `plugin mermaid fence byte-identical`, `plugin wavedrom fence byte-identical`, `plugin katex fence byte-identical`, `plugin dot fence byte-identical`, `plugin html-live fence byte-identical` |
| I4 | An edited plugin fence saves its new source, not SVG | Re-opens and renders | `AUTO-js` ````hybrid mermaid: domToMarkdown preserves first ```mermaid block````, `hybrid mermaid: saved file does NOT contain stripped SVG text` |
| I5 | Error boxes round-trip to the canonical fence | Broken source preserved | `AUTO-js` ````hybrid mermaid: error block round-trips to ```mermaid```` |
| I6 | The raw HTML block stays byte-identical when untouched, keeps tags when edited | Q10 | `AUTO-js` contract case `corpus: raw HTML <div> byte-identical (Q10)`; `AUTO-br` `raw HTML: an edited block keeps its tag and attributes` |
| I7 | Fence language is preserved | Bare fence stays bare; `js` stays `js` | `AUTO-br` `bare: touching it does not invent a language`, `alias: js stays js (not javascript)`; `AUTO-js` `hybrid round-trip: fenced code keeps its language` |

### J. Export after hybrid edits

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| J1 | HTML export renders the note through the same pipeline | Standalone HTML, heading/code/diagram present | `AUTO-br` `HTML export fires a real download event`, `downloaded file is a standalone HTML document` (`test_auth_export_browser.js`); **not after a hybrid edit — GAP** |
| J2 | PDF export paginates and prints once | `#pdf-print-root`, one `print()` | `AUTO-br` `PDF export builds #pdf-print-root`, `PDF export calls window.print exactly once`; **not after a hybrid edit — GAP** |

### K. Phone / WYSIWYG-only path

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| K1 | The phone pencil enters WYSIWYG; the phone has no source editor | `contenteditable`, edit bar, Save visible | `AUTO-js` `mobile edit: the pencil enters WYSIWYG mode`, `mobile edit: the formatting bar is shown`, `mobile edit: Save stays visible in the phone toolbar` |
| K2 | Phone back leaves the edit layer before navigating | Same note, edit closed | `AUTO-js` `mobile edit: back leaves edit mode`, `mobile edit: back stays on the same note` |
| K3 | A phone WYSIWYG edit saves to disk | Text on disk, edit closed | **GAP** (jsdom has no real contentEditable engine; the browser mobile suite has no hybrid typing/save case) |
| K4 | Phone config writes are keyed/merged, never clobber desktop | No `openFiles`/`activeFile`/`lastFile`/`sidebarCollapsed` writes | `AUTO-js` phone config gate checks in `== mobile ==` |

### L. IME / composition

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| L1 | Enter during composition does not split a task item | Composition confirms, note unchanged | `AUTO-js` `hybrid: an IME composition Enter does not split a task item` |
| L2 | Backspace during composition is not claimed | Marker strip does not run | `AUTO-js` `hybrid marker: an IME composition is not claimed` |
| L3 | A real IME composition types/commits once in Chromium | No doubled or lost text | **MANUAL** (jsdom only sets `isComposing`; no real IME in the suite) |

### M. Modifiers and global shortcuts

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| M1 | A modifier chord is not treated as caret navigation or marker strip | Not claimed | `AUTO-js` `hybrid marker: a held modifier is not claimed`, `hybrid table-nav: a modifier chord is not treated as caret navigation` |
| M2 | Hybrid is inert in source and preview modes | No hybrid key handling | `AUTO-js` `chords: hybrid is inert in source mode`, `chords: a list chord is ignored in preview mode` |
| M3 | Global shortcuts do not fire while typing | Input/textarea guard | `AUTO-js` `shortcuts: / in an input does NOT fire openSearch (typing guard)` |
| M4 | Global shortcuts do not fire from a `contentEditable` caret | No app action while typing in hybrid | **GAP** (the guard is tested for inputs; not explicitly for `#viewer-content` `contentEditable`) |

### N. Preview immutability

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| N1 | After exit, the viewer renders the note again | Rendered content present | `AUTO-js` `hybrid: viewer-content has rendered content after exit`, `hybrid close: next file opens in preview (no contenteditable)` |
| N2 | Hybrid leaves no editing artifacts in the preview DOM | Fresh render equals a re-open of the saved bytes | **GAP** (no equality assertion; only "has content") |

### O. Renderer docs / registry sync (only if a fence name, version, or limit changes)

| # | Check | Expected | Tag / how to verify |
| --- | --- | --- | --- |
| O1 | Every renderer module is loaded and precached | `index.html` + `sw.js` | `AUTO-js` `blocks completeness: <mod>.js is in index.html`, `... in sw.js PRECACHE`, both from the registry-completeness guard |
| O2 | Every fence name is documented in `ai.js` and `agent.md` | Both files | `AUTO-js` `blocks completeness: <fence> is documented for the AI`, `... documented in agent.md` |
| O3 | Fixed vendored versions and html-live limits are in `agent.md` | Mermaid 11.16, WaveDrom 3.3, KaTeX 0.16, Graphviz 2.40.1, sandbox limits | `AUTO` backend `TestAgentGuide` marker checks; **the matching version strings in `ai.js` are not asserted — GAP** |

## 5. Coverage map summary

Per area, not per `check()` call. "Both" means a jsdom check and a real-browser
check back the row. Rows not named in the last two columns are `AUTO-js`
and/or `AUTO-br` as written in §4.

| Area | Automated in | Real-browser-only rows | Manual | Gap |
| --- | --- | --- | --- | --- |
| A. Save/write-back | jsdom + browser (A1, A2, A5, A7) | — | — | — |
| B. Enter/exit/tab/watcher/AI | jsdom + browser (B5) | — | — | — |
| C. Block edges | jsdom + browser (C3, C5–C7) | C4, C10, C11, C12, C13 | — | — |
| D. Block transforms | jsdom + browser (D2, D8) | — | — | — |
| E. Inline/links/escape | jsdom | — | — | — |
| F. Caret placement | jsdom + browser (F3, F6) | — | native caret painting (§7.1) | — |
| G. Clipboard/undo | jsdom + browser | G3, G4, G5 | native clipboard fidelity (§7.6) | — |
| H. Tables/view/select | jsdom + browser | H6, H7 | — | — |
| I. Plugins | jsdom + browser (I2) | — | — | — |
| J. Export after hybrid | baseline export only | J1, J2 (preview, not hybrid) | — | J1, J2 |
| K. Phone | jsdom (K1, K2, K4) | — | real phone typing (§7.4) | K3 |
| L. IME | jsdom (L1, L2) | — | L3 (real IME, §7.3) | — |
| M. Modifiers/global | jsdom (M1–M3) | — | global chord suppression (§7.5) | M4 |
| N. Preview immutability | jsdom (N1) | — | — | N2 |
| O. Docs/registry sync | jsdom (O1, O2) + backend (O3 agent.md) | — | — | O3 (`ai.js` versions) |

**Bottom line:** the write-back core (A), block edges (C), transforms (D),
inline (E), plugins (I), and the real engine (C/F/G/H) are strongly automated.
The thin areas are cross-module data flow (export, phone), real IME, global
shortcut suppression from `contentEditable`, and preview-DOM equality. The
biggest current problem was a broken gate, not a missing assertion; that gate
is green now.

## 6. Ranked gaps and proposed tests

Ranked by regression risk. A resolved row records a gate defect that is fixed
and keeps its regression test.

| Rank | Gap | Risk | Proposed test |
| --- | --- | --- | --- |
| 1 | **Resolved 2026-10-31: fence-editor task/plain Backspace-at-T expectations** (`test_block_edit_browser.js`). The suite asserted the pre-`09fdfd6` merge; the tests were rewritten to the committed spec (first press strips the marker, second press merges) and passed **184 ok, 0 failed** at the time. The suite is green (184 ok). | — | No action for this gap. |
| 2 | **Resolved 2026-11-03: core-UI code-scroller assertion.** The check is now `preview overflow: a fenced block wraps inside the viewer (no inner scroller)` in `test_core_ui_browser.js`, and it asserts `preOwnScroller === false`, `preScrolled === false`, and that the fence stays inside the viewer's clip edge. It passes (core UI: 186 passed, 0 failed). | — | No action. Keep the assertion. |
| 3 | **No real IME test.** jsdom only sets `isComposing: true`, in `hybrid: an IME composition Enter does not split a task item` and `hybrid marker: an IME composition is not claimed`. | Medium-high: IME is where composition + Enter + Backspace interact | `tests/browser/test_hybrid_browser.js`: use CDP `Input.imeSetComposition` to compose `にほん`, commit it, assert the text appears once and no block split/strip ran; repeat with an Enter during composition. |
| 4 | **No export-after-hybrid test.** Export is tested from preview only (`test_auth_export_browser.js`). Export re-renders from the viewer cache, so a stale cache after a hybrid save would export old text. | High: user-visible wrong output, cross-module | `tests/browser/test_auth_export_browser.js`: open a note, enter hybrid, type `HYBRID_EDIT`, Save, open Export → HTML, assert the downloaded document contains `HYBRID_EDIT`; repeat with PDF and assert `#pdf-print-root` contains it. |
| 5 | **No real phone WYSIWYG edit+save.** jsdom covers mode/back only (the `== mobile ==` edit checks); the browser mobile suite has no hybrid typing/save. | High: the phone is a separate shell | `tests/browser/test_mobile_browser.js` phone context: open a note, tap `#hybrid-toggle`, type via `page.keyboard`, tap Save, assert the text is on disk and `contenteditable` is removed. |
| 6 | **Watcher self-save and `ai:applied` are jsdom-only.** No real-browser test that an own-save echo or an AI patch keeps hybrid open. | Medium: a real watcher poll + a real SSE patch are different paths | `tests/browser/test_hybrid_browser.js`: edit + Save, then wait one watcher poll and assert hybrid is still active; in `test_ai_editor_browser.js`, apply a patch while hybrid is open and assert the edit bar stays and the block updates in place. |
| 7 | **Global shortcuts from `contentEditable` not asserted.** The typing guard is tested for inputs (`shortcuts: / in an input does NOT fire openSearch`), not for the hybrid editor. | Medium: a stray `/` or Alt chord could open a panel mid-edit | `tests/dom/test_dom.js` `== shortcuts ==`: focus a `contentEditable` `#viewer-content`, dispatch `/` and default global chords, assert `openSearch`/`tabNext`/`openSettings` did not fire. |
| 8 | **Native cross-block copy fidelity.** Cut and paste are covered; a plain Ctrl+C of a multi-block selection and the exact system clipboard payload are manual. | Medium: clipboard is native-engine territory | `tests/browser/test_hybrid_browser.js`: select across two blocks, `Ctrl+C`, read `navigator.clipboard.readText()` (grant permission), assert the Markdown/text shape and that the note is unchanged. |
| 9 | **Preview DOM immutability not asserted.** Only "has content after exit". | Low-medium: leftover chrome could persist until the next render | `tests/dom/test_dom.js` hybrid section: enter, mutate, exit, re-open the file, compare `#viewer-content.innerHTML` (or assert no `contenteditable`, caret `<br>`, ZWS, or sentinel remains). |
| 10 | **`ai.js` version strings not asserted.** `agent.md` versions are checked in backend (`TestAgentGuide`); the matching strings in `ai.js` are not. | Low: docs drift only; fence names are checked | Extend the registry guard to assert each version string in `ai.js` as well as `agent.md`. |
| 11 | **Resolved 2026-11-04: fence-editor `table menu:` assertions rewritten** (`test_block_edit_browser.js`). The six checks now open the "Edit table…" modal and assert its toolbar guards (`aria-disabled` and the `te-delete-row` / `te-delete-col` titles), then delete a row, Apply, and save. The suite passes **184 ok, 0 failed**. | — | No action. |
| 12 | **Resolved 2026-11-04: deep link lost at the session tab cap** (`app.js` `openDeepLink`). `NB.tabs.open` returns false at 40 unpinned tabs; the deep link ignored it, so the restored note stayed visible under the requested URL. Boot now keeps the URL on failure, and `openDeepLink` closes a clean active tab to make room. Covered by the hybrid suite's 41st-note deep link (`169 ok, 0 failed`). | — | Keep the suite above 40 notes per run. |

## 7. Manual-only checks (automation cannot prove these)

Run these in the real app after the automated gate is green. They are short.

1. **Native caret painting.** Put the caret at the end of a line, at the start
   of an empty heading, and after a task checkbox. The caret must be visible,
   the right height, and not jump into the next block. (`F3` proves text lands;
   it does not prove the caret is painted where the user sees it.)
2. **Real Backspace/Delete at every edge.** Press the physical keys (not
   `dispatchEvent`) at a heading start, a list-item start, a task start, a rule
   edge, an emptied fence, and an atomic plugin edge. One press, one effect;
   undo restores it. This is the gesture that produced the newest regressions.
3. **IME.** Use a real IME (Japanese/Chinese) in Chromium: compose a word, commit
   it, press Enter during composition, press Backspace during composition. No
   duplicated text, no block split, no marker strip.
4. **Phone.** On a narrow (≤860 px) window with touch emulation: enter WYSIWYG,
   type, use the keyboard's Enter/Backspace, Save, and confirm the file. The
   phone hides tabs/outline and uses a different exit path.
5. **Global shortcut suppression.** With the caret in the note, type `/`,
   `Alt+L`, `Ctrl+,`, and `Ctrl+S`. Only Save/expected editing chords may act;
   no Search/Settings/Tab panels may open.
6. **Clipboard round-trip.** Copy a multi-block selection into an external text
   editor and back. The note must not change on copy; the paste must not inject
   HTML.

## 8. When to update this file

- A new hybrid behavior or a new construct: add a case to
  `HYBRID_CONTRACT_CASES` in `tests/dom/test_dom.js`, add the row here, and
  extend the coverage-map comment above that table.
- A new renderer/fence: update the registry guard, `ai.js`, `agent.md`, and
  row O1–O3.
- A new manual gesture or a new native-engine dependency: add it to §7.
- A gap in §6 gets a test: change its tag from `GAP` to `AUTO-*` and cite the
  new label.
- Re-run the baseline in §2 and update the counts when they drift. Do not copy
  counts from an older doc; run the commands.

## 9. Related documents

- [`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md) —
  behavior authority.
- [`../product/hybrid-block-marker-backspace.md`](../product/hybrid-block-marker-backspace.md)
  — Backspace/Delete-at-T spec (the newest interaction).
- [`../product/hybrid-shortcuts.md`](../product/hybrid-shortcuts.md) — chords.
- [`../architecture/markdown.md`](../architecture/markdown.md) — renderer
  pipeline and the write-back contract.
- [`frontend.md`](frontend.md) — the jsdom harness and the Playwright suites.
- [`browser-audit.md`](browser-audit.md) — the real-Chromium audit and its
  defect history.
- [`../operations/development.md`](../operations/development.md) — repo
  conventions and the renderer/config change checklists.
