# Testing

How the notebook server is tested, what each suite is responsible for, and
where a new test belongs. The suites are the only verifiers in the project:
there is no lint or type-check step.

## Strategy

The server has two host suites plus sixteen real-browser suites, one per
surface:

| Suite | File | Runs against | Framework |
| --- | --- | --- | --- |
| Backend | `tests/test_app.py` | The real Flask app through its test client | stdlib `unittest` |
| Frontend DOM | `tests/dom/test_dom.js` | The real app modules in jsdom | Hand-rolled `check()` harness |
| Frontend browser (hybrid) | `tests/browser/test_hybrid_browser.js` (plus the caret matrix below), `test_hybrid_blocks_browser.js`, `test_block_edit_browser.js`, `test_table_editor_browser.js`, `test_list_editor_browser.js` | The real editing engine, every construct at every caret position, block types, the fence editor, and the table-editor and list-editor modals via Playwright | Hand-rolled `check()` harness |
| Frontend browser (app) | `tests/browser/test_core_ui_browser.js`, `test_auth_export_browser.js`, `test_ai_editor_browser.js`, `test_ai_blocks_browser.js` | Tree, tabs, search, graph, bookmarks, auth, export, PWA, AI, ACP, CodeMirror, and the AI panel's rendered fences | Hand-rolled `check()` harness |
| Frontend browser (figure sizing) | `tests/browser/test_figure_sizing_browser.js` | Rendered SVG sizing: font scale, layout matrix, engine units, page-growth behaviour (no nested scroller), no inner math/code/error scrollbars, lightbox, phone tokens, export, hybrid round-trip | Hand-rolled `check()` harness |
| Frontend browser (design/windows) | `tests/browser/test_designer_browser.js`, `test_dw_designer_browser.js`, `test_mobile_browser.js` | Visimer canvas, Graphviz/WaveDrom windows, phone shell | Hand-rolled `check()` harness |
| Frontend browser (typography) | `tests/browser/test_typography_browser.js` | Computed type at S/M/L/XL across the side panels, Settings and dialogs | Hand-rolled `check()` harness |
| Frontend browser (tabs view) | `tests/browser/test_tabs_view_browser.js` | The Tabs side-panel view: the eighth rail icon, one label edge and one trailing edge across every row state, drag-to-reorder and its pinned clamp, hiding the strip, the phone drawer | Hand-rolled `check()` harness |

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
node tests/static/test_spellcheck.js  # the spellcheck dictionary, module-level

# Frontend browser (optional; needs a browser binary)
npm run test:browser                # chromium, the default
npm run test:browser:firefox
npm run test:browser:all            # every browser suite, distinct ports
npm run test:browser:hybrid         # hybrid suite + the caret matrix
npm run test:browser:core           # one suite by name; package.json has one
                                    # script per suite: :auth, :ai, :ai-blocks,
                                    # :blocks, :figure-sizing, :hybrid-blocks,
                                    # :mobile, :designer, :table-editor,
                                    # :list-editor, :dw
node tests/browser/test_designer_browser.js   # mermaid designer canvas
node tests/browser/run_all.js                  # every browser suite
node tests/browser/test_typography_browser.js  # computed type, port 5097
node tests/browser/test_tabs_view_browser.js   # Tabs view, port 5079
```

The backend (556 tests), the DOM suite (5,748 checks), and every browser suite
pass. The numbers are in
[`browser-audit.md`](browser-audit.md) and the gate baseline in
[`hybrid-regression-checklist.md`](hybrid-regression-checklist.md) §2. See
[`backend.md`](backend.md) and [`frontend.md`](frontend.md) for the details
of each harness.

## The hybrid caret matrix

`tests/browser/test_hybrid_browser.js` carries a data-driven matrix for hybrid
(WYSIWYG) editing: every construct in
[`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md) §4, at every
position of the §3 key (S start, T content start, M middle, E content end, B boundary,
∅ empty) with every key §4 assigns for it. Each row writes its own note, boots it,
enters hybrid through the real ✎, places the caret, presses the real key, saves, reads
the file back, and compares the bytes.

```bash
npm run test:browser:hybrid                     # runs the suite, matrix included
PORT=5090 node tests/browser/test_hybrid_browser.js   # pick the port
```

Data: [`../../tests/browser/matrix/hybrid-caret-matrix.json`](../../tests/browser/matrix/hybrid-caret-matrix.json)
(row schema in its `meta`). Findings, accepted divergences and the harness rules:
[`hybrid-caret-matrix-findings.md`](hybrid-caret-matrix-findings.md). Priority and
severity model: [`../product/hybrid-caret-matrix-priority.md`](../product/hybrid-caret-matrix-priority.md).

A row's `status` decides how it is reported:

| status | meaning |
| --- | --- |
| absent | must pass; a failure fails the suite |
| `accepted` | by design or native, and the transcribed §4 cell over-specifies. Reported, not scored |
| `known-bug` | a real defect. Reported, not scored, so the gate stays usable while it is open |
| `blocked` | the docs pin no expected bytes, or the fixture has no target element. Observed only |
| `engine` / `spec-divergent` | a contract row under an open question. Reported, not scored |

To add a row, append an object with exact `before`/`after` bytes and the operation.
Do not invent an expectation to make a row score: use `blocked` and say why. When a
`known-bug` row starts matching, the run prints "now match" — move it back to an
asserted row and close the entry in the findings doc, so the suite proves the fix
forever.

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
- **Static, `tests/static/test_typography.js`** — any rule that adds,
  removes or retokenises a `font-size`. The check runs first in `npm test`
  and rejects a literal outside the four sanctioned categories. Its browser
  half, `tests/browser/test_typography_browser.js`, is the only suite that
  asserts computed type; see [`typography.md`](typography.md).
- **Static, `tests/static/test_spellcheck.js`** (shipped) — a jsdom-hosted
  module test: the token predicate, the accepted shapes (acronym, identifier,
  hyphen compound, possessive), the software-terms list, the note's code
  vocabulary, the inflection matcher, `check`/`suggest` against the vendored
  en_US pair, and the personal-list normalisation. It needs no page
  beyond jsdom, so it does not belong in the main DOM harness; the paint and
  the hit-test do, and live in the hybrid browser suite. See
  [`../architecture/spellcheck.md`](../architecture/spellcheck.md) §10.

## Related documentation

- [`backend.md`](backend.md) — the backend suite: isolation, the 53
  test-bearing classes across 556 tests, and the loopback AI stubs.
- [`frontend.md`](frontend.md) — the jsdom harness, the canned SSE
  mechanism, the registry-completeness guard, and the browser suite.
- [`hybrid-regression-checklist.md`](hybrid-regression-checklist.md) — the
  pre-change gate for `static/js/hybrid.js`: smoke set, AUTO/MANUAL/GAP
  checklist, coverage map, and ranked gaps.
- [`../operations/development.md`](../operations/development.md) — repo
  layout, conventions, and the change checklists.
- [`../architecture/backend.md`](../architecture/backend.md) — backend
  structure, storage, auth, and the AI proxy.
- [`../architecture/frontend.md`](../architecture/frontend.md) — the module
  inventory, boot sequence, and renderer pipeline.
- [`typography.md`](typography.md) — the type regression plan: the source
  check, the browser audit, its state matrix, and how each test proves it can
  fail.
- [`../architecture/typography.md`](../architecture/typography.md) — the type
  contract's enforcement design and migration order.
- [`../../CLAUDE.md`](../../CLAUDE.md) — orientation notes for coding
  agents.
