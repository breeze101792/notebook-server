# Real-browser audit (Chromium)

A functional audit of the running app in real Chromium, run after the
existing suites were green. Every check drives the real UI against a real
Flask server on a temp notebook and reads the file back from disk. The
audit added five suites and fixed the defects they found.

Environment: Chromium 155.0.8059.84, Playwright 1.63.0, Linux (NixOS).
No hardware step is involved.

## Final result

| Suite | File | Checks |
| --- | --- | --- |
| Backend | `tests/test_app.py` | 357 tests |
| Frontend DOM | `tests/dom/test_dom.js` | 3,959 checks |
| Core UI | `tests/browser/test_core_ui_browser.js` | 76 |
| Auth / export / PWA | `tests/browser/test_auth_export_browser.js` | 84 |
| AI / ACP / source editor | `tests/browser/test_ai_editor_browser.js` | 35 |
| Hybrid (existing) | `tests/browser/test_hybrid_browser.js` | 137 |
| Hybrid blocks | `tests/browser/test_hybrid_blocks_browser.js` | 28 |
| Fence editor | `tests/browser/test_block_edit_browser.js` | 40 |
| Mobile (existing) | `tests/browser/test_mobile_browser.js` | 76 |
| Mermaid designer (existing) | `tests/browser/test_designer_browser.js` | 36 |
| Dot / WaveDrom designer (existing) | `tests/browser/test_dw_designer_browser.js` | 67 |

All suites pass. `node tests/browser/run_all.js` runs the nine browser
suites sequentially on distinct ports.

## What each new suite covers

### Core UI — `test_core_ui_browser.js`

Desktop file tree and context menus (create file/folder, rename/move,
copy, delete, disk assertions), tabs (open, switch, close, drag reorder, pin, dirty-switch draft
and Recover), real `/api/search` with `<mark>` snippets and keyboard navigation,
bookmarks (star, panel, drag reorder, remove), outline (list, jump,
scroll-spy), graph canvas and node open, settings (theme, font size,
close), watcher (external tree change).

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
Esc, bare fence, alias (`js` not `javascript`), rich paste, Tab,
Shift+Tab, native undo, save mid-edit, Esc on the source, re-enter,
`~~~` fence, plugin fence re-render, Copy button. This suite pins the
regressions below.

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
