# Frontend test suites

The frontend is tested in two places. `tests/dom/test_dom.js` is the primary
suite: 19225 lines with a hand-rolled harness, no framework, loading the real
app into jsdom. The Playwright scripts under `tests/browser/`
(`test_hybrid_browser.js` for the editing engine, `test_designer_browser.js`
for the Visimer canvas) cover behavior only a real browser can produce.

Run them:

```bash
npm install && npm test            # jsdom DOM suite
node tests/dom/test_dom.js         # equivalent once jsdom is resolvable
npm run test:browser               # Playwright, chromium (default)
npm run test:browser:firefox       # Playwright, firefox
node tests/browser/test_designer_browser.js   # Playwright, mermaid designer
```

## The jsdom DOM harness

`tests/dom/test_dom.js` builds one jsdom window from an inline HTML fixture
(`test_dom.js:157-742`), installs stubs for everything jsdom lacks, evaluates
the real vendor bundles and every app module, then drives the app with real
DOM events. There is no framework and no second runner; extend this file.

### The window and its stubs

The fixture is the real app shell, so module lookups by `id` resolve the way
they do in the browser. The window is created with
`runScripts: "outside-only"`, `pretendToBeVisual: true`, and URL
`http://127.0.0.1:5000/` (`test_dom.js:744-750`).

Before any module loads, the harness installs stubs for APIs jsdom does not
implement:

- `requestAnimationFrame` / `cancelAnimationFrame`, `scrollIntoView`,
  `prompt`, `confirm`, `alert`.
- `TextEncoder` / `TextDecoder` / `ReadableStream` pointed at the Node
  implementations, so SSE decoding in `api.js` is real (`test_dom.js:760-764`).
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
  real bundle: `window.mermaid` (`test_dom.js:874`), `window.wavedrom`
  (`test_dom.js:916`), `window.katex` (`test_dom.js:942`), and `window.Viz`
  (`test_dom.js:965`).
- `window.fetch` (`test_dom.js:1098`) routes every `/api/*` endpoint against
  in-memory fixtures (`FILES`, `TREE`, `MTIMES`, `config`, `aiConfig`),
  records every call in `fetchLog`, and reproduces the server's conflict
  codes and conditional-GET 304 behavior. It defaults to auth disabled so the
  login modal stays closed except in the `== auth ==` block.

### Module loading

`evalIn(src)` is `vm.runInContext(src, ctx)` (`test_dom.js:1415`). The
harness evaluates the real vendor bundles (`marked.min.js`,
`highlight.min.js`, `codemirror.bundle.js`, `turndown.browser.js`,
`turndown-plugin-gfm.browser.js`) and all 31 app modules in the dependency
order `index.html` uses (`test_dom.js:1417-1456`, including
`mermaid-designer.js` after `export.js`). Each module is an IIFE
extending `window.NB`, so the load order is load-bearing. `window.onerror`
is captured into an `errors` array and asserted in the first section.

### The check counter and exit code

A single `check(label, cond, extra)` function (`test_dom.js:1472-1476`)
increments `pass` or `fail` and logs `ok` / `FAIL`. The whole file is one
async IIFE that ends with:

```js
console.log("\nRESULT: " + (fail === 0 ? "PASS" : "FAIL") +
  "  (" + pass + " ok, " + fail + " failed)");
process.exit(fail === 0 ? 0 : 1);
```

So the exit code is `0` only when every assertion passed. The suite has **84
test sections**, each announced with `console.log("== name ==")`, and 2104
`check(...)` call sites covering boot, sidebar and tree, theme, viewer and
outline, the six renderers, the blocks registry, tabs (open/close/reorder/
pin/ghost animation), search, edit and save, the edit bar, scroll sync,
hybrid mode and its round-trip guards, table view, empty-tree create,
collapse/expand, recent files, graph view and interactions, bookmarks,
watcher polling and tree sync, settings, auth, passwords, tokens, export,
wallpaper, welcome, deep links, wikilinks, vim mode and vimrc, keyboard
scroll, AI, the mermaid visual designer, lazy vendor loading, and
first-paint boot state.

### Canned SSE for the AI tests

The AI block drives a full agentic tool loop without a network. At the top
of the file:

- `aiChatStreams` (`test_dom.js:154`) is a queue of SSE frame arrays; each
  entry is one assistant reply.
- `aiChatLog` (`test_dom.js:155`) records the JSON bodies POSTed to
  `/api/ai/chat`.

The `/api/ai/chat` branch of the fetch stub (`test_dom.js:1235-1255`) parses
the request body, pushes it onto `aiChatLog`, shifts the next frame array
off `aiChatStreams`, encodes each frame, and returns it as a real
`ReadableStream` body that `api.js` reads with `getReader()`. If the queue is
empty it returns a 400. Tests build frames with a local `sseFrame(text)`
helper (`test_dom.js:16293`) that wraps text in an OpenAI-style
`delta.content` frame. Because the stub pops one entry per chat request, a
test can script a multi-round tool loop by pushing several entries, then
assert on `aiChatLog` to see exactly what the loop sent upstream.

### Registry completeness

The renderer registry is single-source: each renderer module registers a
descriptor with `NB.blocks`. The `== blocks registry ==` section asserts that
six renderers are registered (`mermaid`, `wavedrom`, `katex`, `viz`,
`htmlpreview`, `svg`) and that `pluginTypes()` derives one table entry per
renderer.
It then runs the **registry-completeness guard**
(`test_dom.js:3111-3130`): for every descriptor it asserts

- the module is loaded by `templates/index.html`,
- the module is in the `static/sw.js` `PRECACHE` list,
- the fence name is documented in `static/js/ai.js`'s system prompt,
- the fence name is documented in `agent.md`.

This keeps `index.html`, `sw.js`, `ai.js`, and `agent.md` in sync with the
registry, so a renderer cannot be registered without also being shipped and
documented. Adding a renderer means the guard picks it up automatically.

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
  viewer, is absent for a non-mermaid (wavedrom) block, and is disabled with
  `aria-disabled` + `title` for a render-only type;
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
  the toolbar no longer carries `#designer-tool-addnode`, and
  `#designer-sidebar` / `#designer-add-title` / `#designer-palette` are in
  `index.html`.

The `== designer sidebar ==` section covers the per-type add palette (the add
action moved out of the toolbar into `#designer-sidebar`):

- the sidebar carries `designer-sidebar` + `aria-labelledby`, holds the title,
  a `.designer-divider`, and `#designer-palette`, and is hidden by default and
  during loading;
- flowchart builds a `.designer-shapes` grid of 14 buttons, each of which calls
  `view.addNode(shapeId)` with its own id (`rect`, `round`, … `odd`), and the
  title reads `Shapes`; the sidebar is visible in the ready state;
- the structured families each build one `.designer-add` button that dispatches
  the expected op — `st.addState`, `cl.addClass`, `er.addEntity`,
  `pie.addSlice`, `gantt.addTask`, `seq.addParticipant`, and `li.addItem` for
  the line-item family;
- Connect is visible + enabled for the drag-connect families (flowchart, state,
  class, er) and hidden + disabled for the rest (pie, gantt, sequence,
  line-item);
- a render-only (`zenuml`) open builds no palette and keeps the sidebar hidden;
  closing clears `#designer-palette`, empties the title, and hides the sidebar.

The `== designer toolbar ==` section covers the Select / Connect / Undo / Redo
row that Visimer does not ship: hidden until ready, Select/Connect call
`view.setTool`, `aria-pressed` mirrors the view's `toolChange`, Undo/Redo
delegate to `editor.undo()/redo()` and track `canUndo`/`canRedo`, and the row
is reset on close and hidden in the non-editable state.

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

`tests/browser/test_hybrid_browser.js` (1381 lines) boots the real Flask app
against a temp notebook, opens a note in a real browser, enters hybrid mode
through the actual UI button, edits with the real editing engine, and reads
the file back from disk. It exists because jsdom has no `contentEditable`
engine, no selection, and no native markup insertion, so the DOM a real
browser produces never appears there.

`tests/browser/test_designer_browser.js` (322 lines) is the same harness for
the Mermaid designer: it loads the real Visimer bundle and real mermaid,
opens the designer from the real right-click menu, drives the canvas model,
and asserts the write-back contract against the file on disk — open → Apply
with no gesture is byte-identical, adding a node lands the expected fence
with untouched lines byte-identical, one `Ctrl+Z` restores the previous
fence, `Ctrl+Z` inside the modal never touches the note, Esc closes only the
modal, and the canvas follows `body[data-theme]`.

`tests/browser/test_mobile_browser.js` boots the same temp-notebook app and
checks the real layout: a 1280x800 desktop regression (four grid columns,
visible tab strip, mobile chrome hidden), 390x844 portrait and 932x430
landscape phones (CSS token and `data-ui-mode`, non-zero reader, no
horizontal overflow, hidden tabs/outline, fixed bottom rail, 44 px targets,
Home rows, drawer open/scrim close, browser back closing the drawer first,
the note `…` menu), and a real capture append to `Inbox.md` on disk.

Run the hybrid suite with `npm run test:browser` (chromium) or
`npm run test:browser:firefox`; run the designer suite with
`node tests/browser/test_designer_browser.js` and the mobile suite with
`node tests/browser/test_mobile_browser.js` (Chromium only — its phone
contexts use Playwright's `isMobile`). `BROWSER` selects the engine for the
hybrid suite; `CHROMIUM_PATH` / `FIREFOX_PATH` override the binary (on NixOS
the bundled build cannot start, so point at a nix-provided browser); `PORT` overrides
the default (`5099` hybrid and mobile, `5098` designer). All use the same
`check(name, cond, detail)` counter and report `PASS` / `FAIL` with
`process.exitCode = 1` on failure, printing the server log tail when a run
fails.

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
