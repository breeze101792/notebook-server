# Frontend test suites

The frontend is tested in two places. `tests/dom/test_dom.js` is the primary
suite: 17327 lines with a hand-rolled harness, no framework, loading the real
app into jsdom. `tests/browser/test_hybrid_browser.js` is an optional
Playwright suite for behavior that only a real editing engine can produce.

Run them:

```bash
npm install && npm test            # jsdom DOM suite
node tests/dom/test_dom.js         # equivalent once jsdom is resolvable
npm run test:browser               # Playwright, chromium (default)
npm run test:browser:firefox       # Playwright, firefox
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
`turndown-plugin-gfm.browser.js`) and all 30 app modules in the dependency
order `index.html` uses (`test_dom.js:1417-1453`). Each module is an IIFE
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

So the exit code is `0` only when every assertion passed. The suite has **80
test sections**, each announced with `console.log("== name ==")`, and 1926
`check(...)` call sites covering boot, sidebar and tree, theme, viewer and
outline, the five renderers, the blocks registry, tabs (open/close/reorder/
pin/ghost animation), search, edit and save, the edit bar, scroll sync,
hybrid mode and its round-trip guards, table view, empty-tree create,
collapse/expand, recent files, graph view and interactions, bookmarks,
watcher polling and tree sync, settings, auth, passwords, tokens, export,
wallpaper, welcome, deep links, wikilinks, vim mode and vimrc, keyboard
scroll, AI, lazy vendor loading, and first-paint boot state.

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
five renderers are registered (`mermaid`, `wavedrom`, `katex`, `viz`,
`htmlpreview`) and that `pluginTypes()` derives one table entry per renderer.
It then runs the **registry-completeness guard**
(`test_dom.js:3111-3130`): for every descriptor it asserts

- the module is loaded by `templates/index.html`,
- the module is in the `static/sw.js` `PRECACHE` list,
- the fence name is documented in `static/js/ai.js`'s system prompt,
- the fence name is documented in `agent.md`.

This keeps `index.html`, `sw.js`, `ai.js`, and `agent.md` in sync with the
registry, so a renderer cannot be registered without also being shipped and
documented. Adding a renderer means the guard picks it up automatically.

## The Playwright browser suite

`tests/browser/test_hybrid_browser.js` (644 lines) boots the real Flask app
against a temp notebook, opens a note in a real browser, enters hybrid mode
through the actual UI button, edits with the real editing engine, and reads
the file back from disk. It exists because jsdom has no `contentEditable`
engine, no selection, and no native markup insertion, so the DOM a real
browser produces never appears there.

Run it with `npm run test:browser` (chromium) or
`npm run test:browser:firefox`. `BROWSER` selects the engine;
`CHROMIUM_PATH` / `FIREFOX_PATH` override the binary (on NixOS the bundled
build cannot start, so point at a nix-provided browser); `PORT` overrides
the default `5099`. It uses the same `check(name, cond, detail)` counter and
reports `PASS` / `FAIL` with `process.exitCode = 1` on failure, printing the
server log tail when a run fails.

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
