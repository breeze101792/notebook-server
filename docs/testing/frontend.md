# Frontend test suites

The frontend is tested in two places. `tests/dom/test_dom.js` is the primary
suite: 40,695 lines with a hand-rolled harness, no framework, loading the real
app into jsdom. The twelve Playwright scripts under `tests/browser/` cover
behavior only a real browser can produce: the hybrid editing engine, the
hybrid block types (lists, tasks, tables, selection), the fence editor, the
table-editor modal, the Visimer canvas, the Graphviz and WaveDrom windows, the
phone shell, the core UI (tree, tabs, search, graph, bookmarks, outline,
settings), auth/export/PWA, AI/ACP plus the CodeMirror editor, the AI panel's
rendered reply fences, and rendered figure sizing.

Run them:

```bash
npm install && npm test            # jsdom DOM suite
node tests/dom/test_dom.js         # equivalent once jsdom is resolvable
npm run test:browser               # Playwright, chromium (default)
npm run test:browser:firefox       # Playwright, firefox
npm run test:browser:all           # every browser suite, distinct ports
node tests/browser/run_all.js                 # every browser suite, distinct ports
node tests/browser/test_designer_browser.js   # Playwright, mermaid designer
node tests/browser/test_dw_designer_browser.js # Playwright, Graphviz + WaveDrom
node tests/browser/test_block_edit_browser.js  # hybrid fence editor
node tests/browser/test_hybrid_blocks_browser.js # lists, tasks, tables
node tests/browser/test_table_editor_browser.js  # the "Edit table" modal
node tests/browser/test_ai_blocks_browser.js   # AI panel special fences
node tests/browser/test_figure_sizing_browser.js # rendered SVG sizing
```

`package.json` has one `test:browser:*` script per suite, so any single suite
also runs as `npm run test:browser:<name>` (`core`, `auth`, `ai`, `ai-blocks`,
`blocks`, `figure-sizing`, `hybrid-blocks`, `mobile`, `designer`,
`table-editor`, `dw`; the hybrid suite itself is `npm run test:browser`).

## The jsdom DOM harness

`tests/dom/test_dom.js` builds one jsdom window from an inline HTML fixture
(the `const html` template literal), installs stubs for everything jsdom
lacks, evaluates the real vendor bundles and every app module, then drives the
app with real DOM events. There is no framework and no second runner; extend
this file.

### The window and its stubs

The fixture is the real app shell, so module lookups by `id` resolve the way
they do in the browser. The window is created with
`runScripts: "outside-only"`, `pretendToBeVisual: true`, and URL
`http://127.0.0.1:5000/` (`new JSDOM(html, {...})`).

Before any module loads, the harness installs stubs for APIs jsdom does not
implement:

- `requestAnimationFrame` / `cancelAnimationFrame`, `scrollIntoView`,
  `prompt`, `confirm`, `alert`.
- `TextEncoder` / `TextDecoder` / `ReadableStream` pointed at the Node
  implementations, so SSE decoding in `api.js` is real (the `Encoding
  globals for api.js's SSE reader` block).
- `navigator.clipboard` with a recording `writeText` and a `failNext` flag
  for the fallback path.
- `window.print`, `window.open`, and a stubbed `HTMLIFrameElement`
  `contentWindow` / `contentDocument` carrying the Paged.js globals, so the
  export paths can be asserted.
- `matchMedia` (reports a dark system preference), `Range.getClientRects` /
  `getBoundingClientRect` (jsdom has no layout), and a recording canvas 2d
  context installed on `HTMLCanvasElement.prototype.getContext`.
- Stubs for the heavy renderer bundles, each with a `failNext` and a
  predictable output so the wrapper glue is exercised without loading the
  real bundle: `window.mermaid`, `window.wavedrom`, `window.katex`, and
  `window.Viz`.
- `window.fetch` routes every `/api/*` endpoint against
  in-memory fixtures (`FILES`, `TREE`, `MTIMES`, `config`, `aiConfig`),
  records every call in `fetchLog`, and reproduces the server's conflict
  codes and conditional-GET 304 behavior. It defaults to auth disabled so the
  login modal stays closed except in the `== auth ==` block.

### Module loading

`evalIn(src)` is `vm.runInContext(src, ctx)`. The
harness evaluates the real vendor bundles (`marked.min.js`,
`highlight.min.js`, `codemirror.bundle.js`, `turndown.browser.js`,
`turndown-plugin-gfm.browser.js`) and all 45 app modules in the dependency
order `index.html` uses, including `mermaid-designer.js` after `export.js` and
`workspaces.js` immediately before `app.js`. Each module is an IIFE extending
`window.NB`, so the load order is load-bearing. `window.onerror` is captured
into an `errors` array and asserted in the first section.

A new app module must be added to this list, to `templates/index.html`, and to
the `static/sw.js` `PRECACHE` array. The wiring checks assert the modules and
renderers they name; the registry guard covers every renderer module.

### The check counter and exit code

A single `check(label, cond, extra)` function increments `pass` or `fail` and
logs `ok` / `FAIL`. The whole file is one async IIFE that ends with a
`RESULT: PASS|FAIL  (<pass> ok, <fail> failed)` line and
`process.exit(fail === 0 ? 0 : 1)`.

So the exit code is `0` only when every assertion passed. The suite announces
**120 `== name ==` section headings** (119 distinct names — `== export ==` is
announced twice) and printed **4,777 checks** in the last full run, covering
boot, sidebar and tree, theme, viewer and outline, the six renderers, the
blocks registry, tabs (open/close/reorder/pin/ghost animation), clear-text
control, case in Advanced, the side-panel search options
(unique mode, sort, caps, keyboard, latest-wins, open-failure), edit and
save, the edit bar, scroll sync,
hybrid mode and its round-trip guards, table view, empty-tree create,
collapse/expand, recent files, the 3D graph view and interactions, bookmarks,
watcher polling and tree sync, settings, auth, passwords, tokens, export,
wallpaper, welcome, deep links, wikilinks, vim mode and vimrc, keyboard
scroll, AI, sessions, workspaces, the mermaid visual designer, lazy vendor
loading, and first-paint boot state.

### Canned SSE for the AI tests

The AI block drives a full agentic tool loop without a network. At the top
of the file:

- `aiChatStreams` is a queue of SSE replies. An entry is either an array of
  frames or `{frames, gapMs}`, which delivers one frame per `gapMs` so a test
  can observe the panel while the stream is still open.
- `aiChatLog` records the JSON bodies POSTed to
  `/api/ai/chat`.

The `/api/ai/chat` branch of the fetch stub parses
the request body, pushes it onto `aiChatLog`, shifts the next entry
off `aiChatStreams`, encodes each frame, and returns it as a real
`ReadableStream` body that `api.js` reads with `getReader()`. If the queue is
empty it returns a 400. Tests build frames with a local `sseFrame(text)`
helper (declared inside the AI section) that wraps text in an OpenAI-style
`delta.content` frame. Because the stub pops one entry per chat request, a
test can script a multi-round tool loop by pushing several entries, then
assert on `aiChatLog` to see exactly what the loop sent upstream.

### Registry completeness

The renderer registry is single-source: each renderer module registers a
descriptor with `NB.blocks`. The `== blocks registry ==` section asserts that
six renderers are registered (`mermaid`, `wavedrom`, `katex`, `viz`,
`htmlpreview`, `svg`) and that `pluginTypes()` derives one table entry per
renderer.
It then runs the **registry-completeness guard** (the `blocks completeness:`
`check()` calls): for every descriptor it asserts

- the module is loaded by `templates/index.html`,
- the module is in the `static/sw.js` `PRECACHE` list,
- the fence name is documented in `static/js/ai.js`'s system prompt,
- the fence name is documented in `agent.md`.

This keeps `index.html`, `sw.js`, `ai.js`, and `agent.md` in sync with the
registry, so a renderer cannot be registered without also being shipped and
documented. Adding a renderer means the guard picks it up automatically.

### The graph (`== graph view ==` / `== graph interactions ==`)

`static/js/graph.js` is the facade; `static/js/graph-2d.js` (`NB.graph2d`)
and `static/js/graph-3d.js` (`NB.graph3d`) are the two renderers. The
harness evaluates `graph-2d.js` then `graph-3d.js` before `graph.js`, in
`index.html` order. The 3D renderer (perspective orbit camera, canvas-2D
projection, painter ordering, depth fog) is the default; the 2D renderer
(pan/zoom matrix, force layout) is opt-in. The graph tests drive the
active renderer through the facade (`NB.graph.getCamera()`,
`getDepthSpread()`, `getMode()`, `NB.graph3d.running`, and the 2D
`scale`/`pan` getters). The canvas stub implements the 2D methods both
renderers guard on (`fillRect`, `drawImage`, `arcTo`, `measureText`,
`strokeText`, `createRadialGradient`), so each draw pass runs and records
calls without a real canvas.

`== graph view ==` covers the tab lifecycle and loading layer, node/edge
counts against the `/api/graph` fixture, the summary, the screen-reader
list and host label, the control ids (`#graph-view-fit`,
`#graph-view-depth`, `#graph-view-rotate`, mode buttons, badge, both
canvases, chip, state, live regions), the CSS token contract for both
themes, and the `sw.js` precache + script order for the two renderers.

`== graph interactions ==` injects a deterministic three-note graph
(`graphResponse`) and stubs an 800x600 canvas rect so projection is exact.
It covers wheel dolly, left-drag orbit, right/Shift-drag pan, fit reset,
toolbar dolly, arrow-key orbit and Home, depth spread (0% flatten), the
auto-orbit toggle and reduced-motion disable, the filter match summary and
non-hijacked typing, `/` focus, click selection with chip + live region,
empty-click clear, `[`/`]` cycling, Enter open, Escape clear, double-click
open, the light/dark canvas repaint, empty/error/retry/toast states, the
particle-field round trip, and a `NB.tabs.restore(["§graph"])` boot-restore
case. The mode block adds the default 3D state, the real 2D/3D button
switches, canvas swap and chrome hiding, 2D wheel/pan/click/double-click/
filter/fit, the stopped inactive loop, per-renderer draw isolation, camera
preservation across a round trip, particle forwarding, `graphMode`
persistence, and invalid/missing-config fallback to 3D. The app.js
special-id boot filter is guarded by a source-shape check because the real
boot path runs once per page; the browser suite covers the real reload.

The regression additions cover the screen-reader contract (`.sr-only` is a
clipped 1px box, and the live region and note list both use it), `/` on the
canvas host focusing the filter without opening the Search panel, and the
idle loop (`NB.graph.running` goes false once the camera tween and physics
settle, a wheel wakes it, and auto-orbit keeps it awake). The browser suite
checks the sr-only bounding rects and the non-zero canvas host height after
notes populate, plus the summary and filter match count at a 900px viewport.

### The mermaid designer (`== mermaid designer ==`)

The visual Mermaid editor (`static/js/mermaid-designer.js`, `NB.mermaidDesign`)
has its own sections. The Visimer canvas is ESM + DOM and cannot render real
mermaid in jsdom, so `NB.lazyload.script` is stubbed to resolve and a fake
`window.Visimer` is installed: `MermaidWysiwygEditor` exposes a mutable `.code`,
a `result.typeInfo.capability`, a family-shaped `result` driven by
`__visimer.family`, and a `dispatch(op)` that records to `__visimer.dispatches`;
`MermaidCanvasView` echoes `{ok:true}` from `render()`, records `addNode` /
`setTool`, and holds its `editor`. The section covers:

- `#designer-overlay` carries `settings-overlay` (so the three duplicated
  modal guards see it), `role="dialog"` + `aria-modal`, and `NB.mermaidDesign`
  is exposed;
- the `Design diagram…` menu item appears for auth-off/admin, is absent for a
  viewer, is absent for a non-mermaid block (which has its own entry), and is
  disabled with `aria-disabled` + `title` for a render-only type;
- open → Apply with no edit issues no write and does not call
  `onContentChange`;
- open → Apply with an edit calls `onContentChange` exactly once, re-renders
  the block with the new source, and `domToMarkdown()` emits the new fence
  through the real `restoreForMarkdown`;
- an empty ` ```mermaid ` block (blank source) still opens the designer: the
  item is shown and enabled, the mount is seeded with `flowchart TD` and shows
  no non-editable notice, `#designer-empty` is visible (the seed has no
  nodes), a no-edit Apply writes nothing and leaves the block empty, and
  adding a node then Apply writes the flowchart through the save path;
- Cancel and Esc write nothing, and Cancel restores focus to the invoker;
- a non-editable type shows the inline notice and its *Edit source* button
  delegates to `NB.hybrid.editPluginSource(hit)`; a bundle load failure closes
  with a toast;
- `Ctrl+Z` while open is captured and forwarded to the canvas, never the note;
- wiring completeness: `mermaid-designer.js` is in `index.html` and the `sw.js`
  `PRECACHE`, and `visimer.bundle.js` is in neither (it stays a lazy bundle);
  the stage toolbar row is gone — its Tools and History buttons now live in
  `#designer-sidebar` — and `#designer-sidebar` / `#designer-add-title` /
  `#designer-palette` are in `index.html`.

The `== designer sidebar controls ==` section covers the Select / Connect /
Undo / Redo icon buttons that Visimer does not ship, now inside
`#designer-sidebar`: the buttons are descendants of the sidebar and carry
`designer-iconbtn`, the sidebar is hidden by default, while loading, after
close, and for a non-editable type, and visible in the ready state with a
type-specific hint. Select/Connect call `view.setTool`, `aria-pressed` mirrors
the view's `toolChange`, connect mode toggles the canvas class, Undo/Redo
delegate to `editor.undo()`/`redo()` and track `canUndo`/`canRedo`, and close
resets the pressed state and both history buttons.

The `== designer edit UI ==` section covers the three-column layout and its
tokens (236 px sidebar, 296 px inspector, 1320 px modal), the Add tabs and
form, the per-family palette, and the inspector. Selecting a node renders the
node inspector; its label, shape, delete, direction and Add-node/Add-edge forms
dispatch the expected ops; a rejected edit restores the model value; and the
pointer guard keeps a selection when the click lands on a label or a shape
button. The add-only families (gantt, line-item) keep the sidebar without an
inspector and hide Connect; the sequence family renders participant and message
inspectors and rejects a comma in a name inline; a model-rejected rename
restores the current name.

### Mobile v1 (`== mobile ==`)

The phone shell (`static/js/mobile.js`) is covered at the end of the jsdom
suite. Tests set `document.documentElement.dataset.uiMode = "phone"` before
driving the real modules, then restore `desktop` in the same block. Covered:
the mode mirror, Home order, device-local Continue, drawer/scrim lifecycle,
tree `…` menus (read-only items, no row open), folder expansion and file
selection, back order (`popstate` closes a drawer/sheet first, then note
history), capture (empty/in-flight/double-tap/draft/failure/Retry), deep
links, debounced search and hit marking, the phone config gate (merged
`recentFiles` only; no `openFiles`/`activeFile`/`lastFile`/
`sidebarCollapsed` writes), settings (theme/text size are server-wide,
excluded surfaces, sign out only with auth), and `canWrite()` across auth
off / no session / viewer / admin.

The jsdom mobile block is green, including the acceptance checks for search
Retry, the desktop-only Bookmarks empty state, deleted-Continue Home
fallback, and the unreachable-server screen. `api:network-error` is asserted
to fire on a fetch rejection only, never on HTTP 4xx/5xx, so a 401 produces
`auth:required` instead. `tests/browser/test_mobile_browser.js` covers the
phone boot path (a `?file=` deep link wins over resume; a bad link keeps its
address) and the history invariant: cold-boot deep link and resume both back
to Home, and A → B → back shows A with A's URL.

## The Playwright browser suite

`tests/browser/test_hybrid_browser.js` (2,532 lines) boots the real Flask app
against a temp notebook, opens a note in a real browser, enters hybrid mode
through the actual UI button, edits with the real editing engine, and reads
the file back from disk. It exists because jsdom has no `contentEditable`
engine, no selection, and no native markup insertion, so the DOM a real
browser produces never appears there.

`tests/browser/test_designer_browser.js` (568 lines) is the same harness for
the Mermaid designer: it loads the real Visimer bundle and real mermaid,
opens the designer from the real right-click menu, drives the canvas model,
and asserts the write-back contract against the file on disk — open → Apply
with no gesture is byte-identical, adding a node lands the expected fence
with untouched lines byte-identical, one `Ctrl+Z` restores the previous
fence, `Ctrl+Z` inside the modal never touches the note, Esc closes only the
modal, and the canvas follows `body[data-theme]`.

`tests/browser/test_dw_designer_browser.js` is the same harness for the two
`#dw-designer-overlay` windows. It writes one note with a ```dot fence and one
with a ```wavedrom fence, enters hybrid, opens each window from its real
right-click **Design graph…** / **Design timing…** item, checks the
Graphviz/WaveDrom badge and
the SVG preview inside `#dw-diagram-card` (including the white WaveDrom card),
selects a node or signal row on the canvas, edits the inspector field, applies,
and reads the note back from disk. The Graphviz groups cover the shape grid, style select, edge line/arrow,
byte-identical untouched lines/blank lines, single-line/shared-line statement
preservation, item-level multi-line read-only, History undo/redo, hover,
double-click, Home/End/Enter, and the ≤960 compact strip/sheet layout. The
compact test opens Add and Chart in `#dw-compact-sheet`, checks the sheet is
inside the stage and ≤55%, verifies section swap/restore, focus, close, and
Esc-closes-sheet-before-window. The WaveDrom groups
cover the slice ruler and band (period-based slices, `i * period` cell
selection, measured band geometry), character track period ordinals, glyph
palette, `hscale` Chart, signal reorder, data-label mapping after gaps,
data-label inspector, mini track, arcs guard, roving tabindex/ARIA invalid
states, and the read-only state. It also asserts the changed construct lands, the untouched statements
and prose stay byte-identical, a dirty Cancel/Esc writes nothing, **Edit source
instead** opens the inline raw fence editor, Ctrl+Z on the canvas undoes the
window, and Esc closes only the window. The no-op Apply case records whether
`#dw-apply` is enabled on a clean open.

`tests/browser/test_mobile_browser.js` boots the same temp-notebook app and
checks the real layout: a 1280x800 desktop regression (four grid columns,
visible tab strip, mobile chrome hidden), 390x844 portrait and 932x430
landscape phones (CSS token and `data-ui-mode`, non-zero reader, no
horizontal overflow, hidden tabs/outline, fixed bottom rail, 44 px targets,
Home rows, drawer open/scrim close, browser back closing the drawer first,
the note `…` menu), and a real capture append to `Inbox.md` on disk.

The audit suites cover the rest of the app end to end:

- `test_core_ui_browser.js` — desktop tree and context menus with disk
  assertions, tabs, real search, bookmarks, outline scroll-spy, settings,
  the watcher, the draft Recover bar on a tab switch, and the graph: 3D
  canvas pixels, orbit/wheel/pan through `getCamera()`, fit reset,
  keyboard select + Enter, projected double-click, filter count, depth 0%
  and 100%, a real theme repaint, reload with `§graph` in `openFiles`,
  reduced-motion auto-orbit disable, and the 2D/3D mode switch (real
  clicks, canvas swap, 2D wheel/pan/click/double-click/fit, 3D orbit after
  the round trip, and a 2D-mode reload restore).
- `test_auth_export_browser.js` — auth off/on, admin and viewer identities,
  the login rate limiter, tokens, HTML download, PDF pagination, service
  worker scope/cache/offline reload.
- `test_ai_editor_browser.js` — CodeMirror editing, undo/redo, per-file
  draft recovery, VIM mode, the AI tool loop with a local stub provider, and
  ACP with the stub agent.
- `test_ai_blocks_browser.js` — the AI panel's reply bubbles render the
  shared special fences like a note: one streamed reply carries all six
  (mermaid, wavedrom, math, dot, svg, html-live) and five become their
  container while ```wavedrom stays a plain code block (the panel passes
  `{untrusted:true}`; wavedrom's eval fallback is skipped on model output)
  although the note still renders it; it also pins the chat figure to the
  chat log's width instead of `#viewer-content`, the per-host relayout on a
  two-root burst and a window resize, one image copy button on a chat
  diagram, the click-to-zoom lightbox from the chat (and no lightbox from a
  click outside the reading roots), the prose ```js fence's single text
  button, and that an `nb-tool` fence renders nothing. The reply is also
  DOMPurify-sanitized (an event handler, a `javascript:` link, a form, a
  non-checkbox input, and an SVG fence's script/SMIL are dropped while the
  markdown, task list, wikilink, and sizing attributes survive), and a
  missing sanitizer falls back to plain text.
- `test_block_edit_browser.js` — every fence-editor gesture: the language
  chip, bare fences, rich and multi-line paste, Enter, Tab, native undo, Esc,
  save mid-edit, the tilde fence, plugin re-render and plugin multi-line paste,
  and Copy.
- `test_hybrid_blocks_browser.js` — list Enter/Tab, task toggles, table view,
  cell Enter, Ctrl+drag selection, raw HTML, blockquote exit, and a hybrid
  draft across a tab switch.
- `test_table_editor_browser.js` — the "Edit table" modal end to end: real
  caret typing in a cell, Tab/Enter/F2 moving real focus and stopping at the row
  and grid edges, a pointer drag painting a range and Shift+click extending it,
  copy writing TSV plus an HTML table through a real `ClipboardEvent` and paste
  writing a block back, Apply saving GFM with the bytes outside the table
  unchanged, one-step undo/redo on both entry paths, the no-op Apply, the
  merged-cell refusal strip, focus containment and return, and Esc writing
  nothing.
- `test_figure_sizing_browser.js` — rendered SVG sizing: font-scale response,
  the wide/tall/huge/tiny layout matrix, per-engine units (Graphviz pt,
  WaveDrom px, Mermaid viewBox, inline-SVG viewBox/explicit), the tall-mode
  page-growth contract (no nested scroller or scroll a11y), no inner
  scrollbars for math/code/error sources (KaTeX fit-to-width and wrapped
  code), the lightbox from a tall diagram, the phone reference token,
  HTML-export wrapper/print tokens plus the inline math fit script, and a
  hybrid round-trip byte check. Synthetic SVGs mirror each
  renderer for the matrix; the suite additionally renders every block type
  for real in Chromium: Mermaid natural max-width versus viewBox and label
  scale, WaveDrom labels, Graphviz pt-to-px and labels, KaTeX prose sizing
  and wide-equation scroll containment, html-live frame width / font
  isolation / content auto-fit, and the prose-sized error boxes for all five
  renderers.

Run the hybrid suite with `npm run test:browser` (chromium) or
`npm run test:browser:firefox`; run the designer suite with
`node tests/browser/test_designer_browser.js`, the Graphviz/WaveDrom suite
with `node tests/browser/test_dw_designer_browser.js`, and the mobile suite
with `node tests/browser/test_mobile_browser.js` (Chromium only — its phone
contexts use Playwright's `isMobile`). `node tests/browser/run_all.js` runs
every suite sequentially on distinct ports. `BROWSER` selects the engine for the
hybrid suite; `CHROMIUM_PATH` / `FIREFOX_PATH` override the binary. Every
chromium suite falls back to `tests/browser/chromium.js`, which probes the
Playwright cache, the system paths, and the Nix store, so no variable is
needed when a working Chromium is installed. `PORT` overrides the default;
`run_all.js` assigns a distinct port per suite because hybrid and mobile both
defaulted to 5099. All use the same
`check(name, cond, detail)` counter and report `PASS` / `FAIL` with
`process.exitCode = 1` on failure, printing the server log tail when a suite
reaches its summary with a failure. An uncaught Playwright error aborts the
suite before that summary.

Current status of the browser gate: all 12 suites pass (hybrid 169 checks).

It asserts the hybrid (WYSIWYG) write-back contract: byte-identity on a
clean enter+exit and a clean Save+Exit, that a native paragraph or heading
edit lands and leaves untouched constructs (`*` bullets, setext headings,
indented code, empty headings, code-space headings) byte-exact, that no HTML
tag reaches the file, that an empty heading accepts typed text, that an empty
list item and an emptied blockquote keep their markers, and that a
horizontal rule stays byte-identical when selected. It writes notes under a
temp `notes/` dir and restores nothing outside that dir.

Because it needs a browser and is slower, it is not part of the default
`npm test` run. Use it only for behavior a real engine is required to
exercise; everything jsdom can assert belongs in the DOM suite.

## Related documentation

- [`README.md`](README.md) — strategy, run commands, and suite selection.
- [`backend.md`](backend.md) — the backend suite.
- [`../architecture/frontend.md`](../architecture/frontend.md) — the module
  inventory, boot sequence, and renderer pipeline.
- [`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md) —
  the hybrid editing spec.
