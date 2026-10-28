# Testing

How the notebook server is tested, what each suite is responsible for, and
where a new test belongs. The suites are the only verifiers in the project:
there is no lint or type-check step.

## Strategy

The server has two host suites plus a real-browser suite per surface:

| Suite | File | Runs against | Framework |
| --- | --- | --- | --- |
| Backend | `tests/test_app.py` | The real Flask app through its test client | stdlib `unittest` |
| Frontend DOM | `tests/dom/test_dom.js` | The real app modules in jsdom | Hand-rolled `check()` harness |
| Frontend browser (hybrid) | `tests/browser/test_hybrid_browser.js`, `test_hybrid_blocks_browser.js`, `test_block_edit_browser.js` | The real editing engine, block types, and fence editor via Playwright | Hand-rolled `check()` harness |
| Frontend browser (app) | `tests/browser/test_core_ui_browser.js`, `test_auth_export_browser.js`, `test_ai_editor_browser.js` | Tree, tabs, search, graph, bookmarks, auth, export, PWA, AI, ACP, CodeMirror | Hand-rolled `check()` harness |
| Frontend browser (figure sizing) | `tests/browser/test_figure_sizing_browser.js` | Rendered SVG sizing: font scale, layout matrix, engine units, page-growth behaviour (no nested scroller), lightbox, phone tokens, export, hybrid round-trip | Hand-rolled `check()` harness |
| Frontend browser (design/windows) | `tests/browser/test_designer_browser.js`, `test_dw_designer_browser.js`, `test_mobile_browser.js` | Visimer canvas, Graphviz/WaveDrom windows, phone shell | Hand-rolled `check()` harness |

The backend suite exercises routing, path safety, the atomic write paths, the
auth layer, and the AI proxy end to end, with real loopback `HTTPServer`
stubs standing in for upstream providers. The DOM suite loads the real
vendor bundles and every app module into jsdom and drives the UI through
real DOM events. The browser suites cover what jsdom cannot: the
`contentEditable` engine, layout and pointer geometry, the clipboard, print
pagination, media queries, a real server/SSE path, and the service worker.

Each suite is authoritative for its own layer. Do not duplicate a backend
assertion in the DOM suite or the reverse.

## Run

```bash
# Backend (stdlib unittest against the real Flask app)
.venv_$(hostname)/bin/python -m unittest discover -s tests -v

# Backend, one class or method
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# Frontend DOM (installs jsdom on first run)
npm install && npm test
node tests/dom/test_dom.js          # equivalent once jsdom is resolvable

# Frontend browser (optional; needs a browser binary)
npm run test:browser                # chromium, the default
npm run test:browser:firefox
node tests/browser/test_designer_browser.js   # mermaid designer canvas
node tests/browser/run_all.js                  # every browser suite
```

Every suite is expected to pass clean. The browser suites are documented in
[`browser-audit.md`](browser-audit.md). See
[`backend.md`](backend.md) and [`frontend.md`](frontend.md) for the details
of each harness.

## Which suite gets a new test

- **Backend, `tests/test_app.py`** — a new `/api/*` route or parameter, a
  change to `safe_path` or an atomic write, auth or token behavior, or the
  AI proxy. Add a `test_*` method to the existing class that covers the
  same route, or a new `TestCase` subclassing `BaseTest` for a new route
  family.
- **Frontend DOM, `tests/dom/test_dom.js`** — a new module, a UI flow, a
  renderer, or a piece of frontend state. Add a `console.log("== name ==")`
  section and `check(...)` assertions to the single harness; do not start a
  second runner. If the change adds a code-block renderer, extend the
  registry-completeness guard (see [`frontend.md`](frontend.md)).
- **Frontend browser, `tests/browser/test_*.js`** — only behavior that
  depends on a real editing engine, layout, selection, clipboard, print,
  media queries, a real server/SSE path, or the service worker. Anything
  jsdom can assert belongs in the DOM suite. Pick the suite for the surface
  and keep one `check()` group per user gesture. `run_all.js` runs them
  sequentially on distinct ports.

## Related documentation

- [`backend.md`](backend.md) — the backend suite: isolation, the 24
  `TestCase` classes, and the loopback AI stubs.
- [`frontend.md`](frontend.md) — the jsdom harness, the canned SSE
  mechanism, the registry-completeness guard, and the browser suite.
- [`../operations/development.md`](../operations/development.md) — repo
  layout, conventions, and the change checklists.
- [`../architecture/backend.md`](../architecture/backend.md) — backend
  structure, storage, auth, and the AI proxy.
- [`../architecture/frontend.md`](../architecture/frontend.md) — the module
  inventory, boot sequence, and renderer pipeline.
- [`../../CLAUDE.md`](../../CLAUDE.md) — orientation notes for coding
  agents.
