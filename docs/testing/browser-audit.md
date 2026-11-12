# Real-browser audit (Chromium)

A functional audit of the running app in real Chromium, run after the
existing suites were green. Every check drives the real UI against a real
Flask server on a temp notebook and reads the file back from disk. The audit
started with five suites; the browser suite has since grown to twelve, and the
defect table below records what the checks found and fixed.

Environment: Chromium 156.0.8078.73, Playwright 1.63.0, Linux (NixOS).
No hardware step is involved.

## Final result

Last full run: `npm run test:browser:all`, Chromium 156.0.8078.73.

| Suite | File | Checks |
| --- | --- | --- |
| Backend | `tests/test_app.py` | 461 tests, OK |
| Frontend DOM | `tests/dom/test_dom.js` | 4,777 checks, 0 failed |
| Core UI | `tests/browser/test_core_ui_browser.js` | 186 |
| Auth / export / PWA | `tests/browser/test_auth_export_browser.js` | 99 |
| AI / ACP / source editor | `tests/browser/test_ai_editor_browser.js` | 40 |
| AI blocks | `tests/browser/test_ai_blocks_browser.js` | 44 |
| Hybrid | `tests/browser/test_hybrid_browser.js` | 169, 0 failed |
| Table editor | `tests/browser/test_table_editor_browser.js` | 54 |
| Hybrid blocks | `tests/browser/test_hybrid_blocks_browser.js` | 28 |
| Fence editor | `tests/browser/test_block_edit_browser.js` | 184 ok, 0 failed |
| Figure sizing | `tests/browser/test_figure_sizing_browser.js` | 96 |
| Mobile | `tests/browser/test_mobile_browser.js` | 102 |
| Mermaid designer | `tests/browser/test_designer_browser.js` | 36 |
| Dot / WaveDrom designer | `tests/browser/test_dw_designer_browser.js` | 67 |

`node tests/browser/run_all.js` (or `npm run test:browser:all`) runs the twelve
browser suites sequentially on distinct ports. The last run reported **12/12
suites passed**.

## What each new suite covers

### Core UI — `test_core_ui_browser.js`

Desktop file tree and context menus (create file/folder, rename/move,
copy, delete, disk assertions), tabs (open, switch, close, drag reorder, pin, dirty-switch draft
and Recover), real `/api/search` with `<mark>` snippets and keyboard navigation,
bookmarks (star, panel, drag reorder, remove), outline (list, jump,
scroll-spy), the 3D graph (canvas pixels, orbit/wheel/pan camera,
keyboard select + Enter, projected double-click, filter, depth spread,
theme repaint, `§graph` reload restore, reduced-motion auto-orbit),
settings (theme, font size, close), watcher (external tree change).

### Auth / export / PWA — `test_auth_export_browser.js`

Auth off; admin password set through the UI; wrong password and the
5-attempt lockout (429); admin login/logout; viewer login with reads
allowed and writes refused; named API tokens (one-time display, Bearer
read, revoke, cleanup when the admin password is cleared); HTML export
(real download, standalone reopen); PDF pagination contract; service
worker scope, control, cache readiness, and offline reload.

### AI / ACP / source editor — `test_ai_editor_browser.js`

CodeMirror source editing and save, undo/redo, per-file draft recovery, VIM mode;
AI panel prose through the real Flask SSE proxy with a local stub
provider; one `nb-tool` patch proposal (Apply writes, Reject writes
nothing); ACP prose and trace through `tests/fixtures/stub_acp_agent.py`.

### Hybrid blocks — `test_hybrid_blocks_browser.js`

List Enter (new item, exit an empty item), Tab nest (one item only),
task checkbox toggle and save, table view controls (hide a row, no note
write, state stripped on entering hybrid), Enter in a cell, Ctrl+drag table
selection and TSV clipboard, raw HTML, blockquote exit, a hybrid draft across
a tab switch, and wikilink navigation.

### Fence editor — `test_block_edit_browser.js`

One group per interaction: open, language chip, clear, invalid input,
Esc, bare fence, alias (`js` not `javascript`), rich and multi-line paste,
Enter, Tab, Shift+Tab, native undo, save mid-edit, Esc on the source, re-enter,
`~~~` fence, plugin fence re-render, Copy button, emptied-block removal
(Backspace/Delete, top-level and nested), atomic plugin-block deletion,
multi-cell table-selection deletion, task-item merges at the checkbox,
delete-edge guards (Ctrl+A, Cut/Shift+Delete and cut gap deletion,
plain/task neighbours, images, rules), disabled table-menu guards, and
undo. This suite pins the regressions below.

### Table editor — `test_table_editor_browser.js`

The "Edit table" modal end to end: real caret typing in a cell, Tab/Enter/F2
moving real focus and stopping at the row and grid edges, a pointer drag
painting a range plus Shift+click extending it, copy writing TSV and an HTML
table through a real `ClipboardEvent`, paste writing a block back, Apply
saving GFM with the bytes outside the table unchanged, one-step undo/redo on
both entry paths, the no-op Apply, the merged-cell refusal strip, focus
containment and return, and Esc writing nothing.

### AI blocks — `test_ai_blocks_browser.js`

The AI panel's reply bubbles render the shared special fences like a note: one
streamed reply carries all six, five become their container while the
`wavedrom` fence stays a plain code block (the panel passes `{untrusted:true}`),
the chat figure is pinned to the chat log's width, the per-host relayout on a
two-root burst and a window resize, the image copy button, the click-to-zoom
lightbox (and no lightbox from outside the reading roots), the prose `js`
fence's single text button, an `nb-tool` fence rendering nothing, and
DOMPurify sanitization of the reply (event handler, `javascript:` link, form,
non-checkbox input, and an SVG fence's script/SMIL dropped; markdown, task
list, wikilink, and sizing attributes kept), with a missing sanitizer falling
back to plain text.

### Figure sizing — `test_figure_sizing_browser.js`

Rendered SVG sizing: font-scale response, the wide/tall/huge/tiny layout
matrix, per-engine units (Graphviz pt, WaveDrom px, Mermaid viewBox, inline-SVG
viewBox/explicit), the tall-mode page-growth contract (no nested scroller or
scroll a11y), no inner scrollbars for math/code/error sources (KaTeX
fit-to-width and wrapped code), the lightbox from a tall diagram, the phone
reference token, the HTML-export wrapper/print tokens plus the inline math fit
script, and a hybrid round-trip byte check. It renders every block type for
real in Chromium: Mermaid natural max-width versus viewBox and label scale,
WaveDrom labels, Graphviz pt-to-px and labels, KaTeX prose sizing and
wide-equation scroll containment, html-live frame width / font isolation /
content auto-fit, and the prose-sized error boxes for all five renderers.

## Defects found and fixed

| # | Symptom | Root cause | Fix | Regression |
| --- | --- | --- | --- | --- |
| 1 | Touching a bare fence wrote an invented info string (` ```css `) | highlight.js appends an auto-detected `language-*` class; turndown reads it as the fence language | `captureFenceLanguages` records the authored language from the first class before highlight.js runs and strips the added class; stored in `data-fence-lang` | fence editor: bare, alias |
| 2 | Ctrl+A in the language chip selected the whole note; retyping replaced the document | the chip was a `contenteditable` span inside the note's editing host | the chip is a real `<input>`, so it owns its own selection | fence editor: chip |
| 3 | Rich-HTML paste inserted markup inside a fence | native paste kept the HTML flavour | a paste handler inserts `text/plain` only | fence editor: paste |
| 4 | Tab moved focus to the Copy button | no code-editor Tab handler | Tab inserts two spaces; Shift+Tab does not leave the editor | fence editor: keyboard |
| 5 | An empty language could not be cleared; invalid languages were accepted | inconsistent blur/Enter paths, no validation | one `normalizeFenceLanguage` path, clear on empty, refuse invalid with a toast | fence editor: clear, invalid |
| 6 | Ctrl+Z inside a fence reverted the whole note and dropped edit mode | the document handler used hybrid's snapshot history | modifier keys inside the fence fall through to native undo | fence editor: undo |
| 7 | Esc did not exit the fence editor | `blur()` on a child of the editing host never reaches the `<pre>` focusout | Esc dispatches the same commit event a click-out uses | fence editor: Esc |
| 8 | Invalid language then click-out threw `NotFoundError` | removing the focused chip re-entered `commit` and removed it twice | leave edit mode before touching the chip; guard `parentNode` | fence editor: invalid |
| 9 | Typing at the end of a plugin fence was lost | the caret landed between `</code>` and the chip, so text sat in the `<pre>`, which turndown does not read | anchor the caret in the last text node; absorb stray fence text on commit and in the turndown clone | fence editor: plugin |
| 10 | Copying from a fence exited edit mode | the clipboard fallback focused a hidden textarea, which fired focusout | a copy-button press suppresses the next commit focusout | fence editor: copy |
| 11 | Indenting a list item also nested every following item | `indentListItem`/outdent moved all following siblings | move only the item (its children travel with it) | hybrid blocks: list Tab |
| 12 | An external edit to a note open in preview was dropped, with a page error | `viewer.js` called `NB.cmEditor.setValue` even when CM6 was never loaded | mirror into CM6 only when edit mode was active and `window.CM6` exists | core UI: watcher |
| 13 | The watcher toggle reset after reload | the toggle never persisted; the poller always auto-started | `watchEnabled` config key, saved by the toggle and honoured at boot | core UI: settings |
| 14 | Outline highlighted the previous heading after a jump, and nothing at the top | threshold was scroller top + 12 px; headings land `--topbar-h + 8` below it | threshold includes the topbar offset | core UI: outline |
| 15 | The PWA never controlled `/`; offline reload failed | `sw.js` was registered from `/static/`, so its scope was `/static/` | served from `/sw.js`, registered with scope `/`; navigation falls back to the cached shell | auth/export: PWA |
| 16 | Viewer-role Save raised an uncaught rejection and gave no feedback | the toolbar click did not catch the save promise | catch and notify | auth/export: viewer |
| 17 | A background 401 wiped a half-typed password and the login error | every `auth:required` re-ran `showModal()` | an already-visible modal is not re-shown; sensitive content is still wiped | auth/export: login |
| 18 | The logout button stayed visible after logout | `tryLogout` never hid it | hide the button when signed out | auth/export: logout |
| 19 | Enter inside a table cell wrote a newline that split the GFM row | the native `insertParagraph` had no cell guard | Enter in a cell is refused with a notice; typing stays in the cell | hybrid blocks: cell Enter |
| 20 | Editing a raw `<div>` block saved only its text (tag lost) | turndown unwraps unknown block elements | authored raw HTML is marked at render time and re-emitted as its own outerHTML | hybrid blocks: raw HTML |
| 21 | Enter on an empty quote line never left the blockquote | no analogue of the empty-list-item rule | Enter on a trailing empty quote line exits to a paragraph | hybrid blocks: blockquote |
| 22 | A table view (hidden rows/sort) could apply to a different table with the same header | identity was header text + positional index only | store a full-cell hash and a same-header ordinal; apply only when all three match, otherwise fail closed | DOM table-view tests + core UI |
| 23 | A dirty tab switch forced a save or lost the edit | the tab guard prompted save/cancel | the buffer is stashed; the tab stays dirty and a Recover bar reopens it (source mode is Ctrl+Z undoable), Discard reloads saved | core UI + AI/editor + hybrid blocks |
| 24 | Emptying a fence then pressing Backspace merged the empty `<pre>` into the previous block and deleted its last character | the native editable `<pre>` had no empty-block removal rule | Backspace/Delete in an emptied top-level in-place fence removes the block, moves the caret to the neighbour edge in the key's direction, and is undoable | fence editor: emptied block |
| 25 | Backspace/Delete beside a rendered plugin block deleted the whole block and its fence source in one keystroke | plugin containers were atomic for caret movement only; the delete-key path claimed only `<hr>` and emptied fences | an atomic block (plugin container or non-editing `<pre>`) is removed deliberately at the neighbouring block's edge; the caret moves to the neighbour edge; undo restores it | fence editor: atomic plugin delete |
| 26 | Delete over a multi-cell table selection removed whole rows and left `<br>` in the header, producing a file that no longer parsed | the engine owned cross-cell deletion | hybrid clears the selection cell-by-cell, keeps every row/column, and strips whitespace/`<br>`-only cells on save so they emit `\|  \|` | fence editor: table selection delete |
| 27 | Emptying a fence nested in a list item then pressing Backspace did nothing | `removeEmptyCodeBlock` claimed the key for a non-top-level `<pre>` but returned without removing it | the empty nested `<pre>` is removed, its container is kept, and the caret stays at the removed block's position | fence editor: emptied block (nested) |
| 28 | Backspace at a task item's start was a no-op and Delete destroyed the next item, writing a literal `[ ]` into the text | the `contenteditable=false` checkbox has no caret, so the engine could not merge the item | hybrid performs an explicit node-moving merge at the item edge, drops the second checkbox, and keeps the joined text | fence editor: task item merge |
| 29 | Merging a loose task item dropped its nested list and extra paragraphs | only the item's first `<p>` was moved before the source item was removed | the primary inline/paragraph content joins the target; nested lists and extra paragraphs move after the target's own content | fence editor: task item merge (loose) |
| 30 | Delete at a tight task item's end was ignored when the item had a nested list | the end probe included nested-list text | the content end is the last non-list child; the next item merges and the nested child survives | fence editor: task item merge (nested) |
| 31 | A selection from a table cell to the paragraph after it removed a row | the table claim required both endpoints to be cells in the same table | any selection touching a table from more than one cell is clamped to the intersected table(s) and the cells are cleared | fence editor: table selection delete |
| 32 | Backspace in a non-empty in-place fence merged the fence into the heading and removed the diagram before it | the atomic claim ran inside the nested fence editor; native merge-out also corrupted the note | a non-empty fence claims Backspace/Delete at its own text edges, and the atomic path bails when the fence editor owns the selection | fence editor: non-empty fence edge |
| 33 | Atomic edge detection was text-only: a leading image was ignored and an element-boundary caret was missed | `textBeforeCaret`/`caretDirectlyInTop` saw only text nodes | edge tests are range-based and count embedded content; `caretDirectlyInTop` accepts element boundaries | fence editor: image and element-boundary caret |
| 34 | Ctrl+A + Delete on a note with a table emptied only the table and left the prose | the table guard claimed any range that merely intersected a table | a selection with both endpoints outside cells is left to the engine; only a cell-touching endpoint claims | fence editor: delete-edge guards |
| 35 | Delete at the end of a plain item before a task item destroyed the task and wrote a literal `[ ]` | the merge probe only resolved a task item's own `<li>` | a plain item is claimed when its merge neighbour is a task item | fence editor: delete-edge guards |
| 36 | Delete at a nested list boundary merged and removed the following outer item | the content-end probe accepted a caret merely inside the outer `<li>` | the probe requires the caret to be in the item's own content, not a nested list | fence editor: delete-edge guards |
| 37 | Backspace at a task item's or rule-adjacent block's leading image merged/deleted the structure instead of the image | the start probes were text-only | both use the element-aware start predicate; the image is the deleted character | fence editor: delete-edge guards |
| 38 | Ctrl+X over a multi-cell table selection removed rows / wrote invalid GFM | only Backspace/Delete were guarded in keydown | `beforeinput` claims `deleteByCut` and the delete input types, clears the cells, and leaves copy alone | fence editor: table cut |
| 39 | The second Ctrl+Z after restoring an editing-fence snapshot did nothing | the restored caret sat inside the rebuilt editor, so the fence chord guard used its empty native undo | the restored fence is re-wired, but the caret lands beside it | fence editor: undo across a restored fence |
| 40 | Delete row / Delete column looked enabled on shapes the actions refuse | the menu built the descriptors without the guards | `canDeleteRow` / `canDeleteColumn` drive both the disabled menu entry and the action | fence editor: table menu guards |
| 41 | Ctrl+A + Delete left the first block's type behind (`#   ` on save) | the native delete kept the first element | a whole-note delete replaces the root with one plain marked paragraph | fence editor: whole-note delete |
| 42 | Cut from a cell to the paragraph after a table copied the outside text but left it in the note | the cut claim only cleared the table cell slices | `beforeinput` cut also deletes the selected pre/middle/post gaps anchored on the tables, so the note matches the clipboard | fence editor: table cut |
| 43 | Ctrl+A + Ctrl+X still left the first block's type behind | only Delete/Backspace had a whole-note claim | `beforeinput` claims `deleteByCut` for a whole-note selection and replaces the root with one plain paragraph | fence editor: whole-note cut |
| 44 | Selecting only text in a later block was treated as a whole-note clear when an empty block preceded it | coverage used text content, so an empty heading contributed nothing | coverage is decided from first/last top-level element positions | fence editor: whole-note delete |
| 45 | Delete row showed the header+body-row reason on the header and had an unreachable lone-row branch | the reason was hard-coded and the first-row guard ran first | a cause-specific `deleteRowBlockedReason` is shared by menu and action; the first row (header or lone body row) is protected and the dead branch is gone | fence editor: table menu guards |
| 46 | A multi-line paste or Enter collapsed the fence body to one line | Chromium's `insertText`/native Enter split a `<pre><code>` into sibling `<code>` elements; only the first stayed in the fence source | `insertTextIntoFence` inserts escaped text with `insertHTML` so raw newlines stay in one `<code>` and native undo still works | fence editor: multi-line paste, Enter |
| 47 | A multi-line paste into a Mermaid (or other plugin) fence deleted the whole fence | plugin source has no highlight spans, so its `<code>` is inline; Chromium's `insertHTML` unwraps an inline `<code>` when replacing its contents | fence `<code>` is `display: block` in hybrid mode, matching highlighted fences | fence editor: plugin multi-line |
| 48 | A `?file=` deep link past the 40-tab session cap silently left the restored note on screen under the requested URL | `NB.tabs.open` returns false, and `openDeepLink` ignored the result; boot stripped the URL either way | `openDeepLink` closes a clean active tab and retries, returns false when it cannot open, and boot keeps the URL on failure | hybrid: the 41st-note deep link; DOM: session-full checks |

## Known issues left unchanged

These are documented behaviour or deliberate decisions, not data-loss bugs.

- **Paragraph then list separator.** Exiting a list with Enter twice
  writes a paragraph immediately followed by the untouched list
  (`after\n- two`), without the usual blank line. It renders correctly in
  the app; the file is not canonical.
- **Shift+Enter semantics.** Decided: keep the next-line-out behaviour
  (a new block after the current one). Pinned by the existing suite.

## Run

```bash
# Everything, auto-detecting Chromium
node tests/browser/run_all.js

# One suite
node tests/browser/test_block_edit_browser.js

# Host suites
.venv_$(hostname)/bin/python -m unittest discover -s tests -v
node tests/dom/test_dom.js
```

`tests/browser/chromium.js` honours `CHROMIUM_PATH`, then probes the
Playwright cache, the system paths, and the Nix store. `PORT` selects a
server port; `run_all.js` assigns one per suite because the old defaults
collided (hybrid and mobile both used 5099).

## Typography suites (landed with the type contract)

Two suites enforce [`typography.md`](typography.md);
`npm test` runs the first, `run_all.js` runs the second on port 5097.

| Suite | Scope | Result at landing |
| --- | --- | --- |
| `tests/static/test_typography.js` | Source: every `font-size` and the size slot of every `font:` in `style.css` and `vimnav.css`; the `:root` step block; JS element-size writes; `addStyleTag` injections | 10 checks; 247 literal declarations allowlisted, 105 tokenised |
| `tests/browser/test_typography_browser.js` | Computed type at S/M/L/XL across 22 states (shell, seven panels, seven Settings tabs, three dialogs, AI with a local SSE stub) | 33 checks; 404 text nodes per setting, zero off-scale |

### The allowlist at landing

The allowlist landed at 259 entries, seeded from the inventory of the tree at
landing, not from §7 of the plan. The follow-up commit retired 12 of them
(`.settings-help`, `.settings-note`, `.settings-text-input`, `.ai-clear`, the two
session counts, the welcome title/action/tips, the outline rows and the three
desktop search aliases), so the count and the table below are the landing
state:

| Category (`why`) | Entries |
| --- | --- |
| token-value literal, tier-1 swap pending (`phase 1`) | 85 |
| off-scale role literal, role rounding pending (`phase 2.x`) | 94 |
| phone shell px ladder (`phase 3`) | 49 |
| graph-view overlay text (`phase 2.6`) | 12 |
| glyph/icon size, not text | 6 |
| prose/glyph `em` outside a prose container | 4 |
| iOS 16 px zoom floor on a phone field (`never`) | 4 |
| retired local search alias (`phase 2.5`) | 3 |
| fixed badge numeral (`never`) | 2 |

The ratchet baseline is `tests/static/typography-baseline.json`, now
`"literals": 247` (259 at landing). The count must match exactly: a rise fails
as a new literal, a fall fails until the baseline is lowered in the same commit.

**Deviation from the plan, recorded deliberately.** §7 of the plan says only
ten literals remain. They do not: the partial sweep left 259 declarations
(85 at landing; 73 now, token-value spellings such as `.93rem` and `1rem`). The suites
enforce the contract against the real tree; the allowlist is the to-do list,
not a clean bill.

### T1–T3, run by hand

- **T1, injected literal.** Appending `.t1-probe { font-size: .77rem }`:
  `style.css:9212  .t1-probe  font-size: .77rem  nearest --text-sm (+0.42)`,
  plus the ratchet failures (`baseline 247, found 248`); exit 1.
- **T2, stale entry.** Deleting `font-size: 11px` from `.bookmark-pin`:
  `FAIL the allowlist has no stale entries — style.css  .bookmark-pin
  font-size: 11px  (no declaration matches)`, plus the baseline falling to
  258; exit 1.
- **T3, injected runtime size.** `page.addStyleTag` setting `.tree-name` to
  `.9rem`: A1 lists each tree row at `12.6 px · nearest --text-ui-lg 13.02
  (-0.42)`, A2 reports `found 12.6 / 14 px` across the row group, and the
  static `addStyleTag` guard names the injection at its own line.

All three were reverted; the tree is unchanged.

### Known deviations in the runtime audit

- **Glyph-only elements are skipped.** A text node with no letter and no
  digit (`×`, `‹`, `⋯`) is decoration, not chrome text; the glyph sizes are
  pinned statically instead.
- **The font-size tile is excluded** from A1 and asserted separately at
  12.6 / 14 / 16.1 / 18.2 px at every setting.
- **A6 is scoped to text-bearing Settings controls.** Checkboxes and radios
  paint no text and carry the UA size; `.ws-row-main` has no text of its own
  (its spans do); the Settings nav tabs are the navigation role and are
  asserted as `--text-ui-lg`, not `--text-ui`.
- **`viewer-content`, `.ai-prose-span`, `.sr-only` and SVG text are out of
  scope**, per the plan §3.2.
