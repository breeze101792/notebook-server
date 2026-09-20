# Development

A single-user Markdown notebook server: a Flask backend (`app.py`) plus a
vanilla-JS frontend (`static/js/`, served through `templates/index.html`).
The runtime frontend has no build step. Two test suites cover the backend
and the DOM. This guide describes the layout, both suites, the vendored
assets, and the checklists for common changes.

## Repo layout

| Entry | Description |
| --- | --- |
| `app.py` | The entire Flask backend: routes, auth, search, edit, AI proxy. 2537 lines |
| `agent.md` | Machine-readable API guide served verbatim at `/agent.md` with the auth state substituted |
| `README.md` | User-facing overview |
| `CLAUDE.md` | Orientation notes for Claude Code |
| `start.sh` | Venv bootstrap and launch wrapper |
| `requirements.txt` | Python dependencies: `Flask==3.0.3`, `bcrypt==5.0.0` |
| `package.json` / `package-lock.json` | Frontend dev tooling and tests; the only script is `test` |
| `notebook.template/` | Starter notes copied into `notebook/` on a fresh install: `Welcome.md`, `README.md`, `Syntax.md` |
| `notebook/` | The notes folder. In this checkout, a symlink to `/mnt/projects/notebook` |
| `config/` | Settings: `config.json`, `auth.json`, `ai.json` |
| `static/` | Frontend assets (see below) |
| `templates/index.html` | The SPA shell; loads vendor files and app modules as `<script defer>` tags |
| `tests/` | `test_app.py` (backend) and `dom/test_dom.js` (frontend) |
| `docs/` | This documentation set |
| `TODO.md` | Empty task list |

`static/` holds four folders: `css/` (`style.css`, `vimnav.css`),
`js/` (29 app modules), `vendor/` (upstream bundles and the CodeMirror
bundle), and `icons/` (PWA icons). Each JS module is an IIFE that extends
the shared `window.NB` namespace.

`start.sh` keeps its virtualenv at `.venv_$(hostname)` in the project root.
The folder name is host-specific, so one checkout can hold a venv per
machine. `node_modules/` and the venv folders are not part of the source
tree.

## Backend test suite

`tests/test_app.py` is 2764 lines of stdlib `unittest`. It drives the real
Flask app through a test client.

The module points `NOTEBOOK_DATA_DIR` and `NOTEBOOK_CONFIG_DIR` at a temp
directory **before** importing `app`, because `app.py` resolves those at
import time and calls `seed()` (`test_app.py:27-31`). `BaseTest.setUp`
(`test_app.py:34`) wipes and reseeds those temp directories and builds a
fresh `test_client()`. Auth-aware classes clear `nb._login_failures` in
`setUp` so the rate limiter does not leak between tests.

The suite has 209 test methods across 25 `TestCase` classes:

| Class | Coverage |
| --- | --- |
| `TestIndexAndSeed` | Index page, seeding, first-paint boot state |
| `TestSpaCatchAll` | SPA catch-all routing |
| `TestFileRead` | `GET /api/file` |
| `TestFileSave` | `POST /api/file` |
| `TestCreate` | File and folder creation, upsert, seeded content |
| `TestMove` | Move including conflict handling |
| `TestCopy` | Copy including conflict handling |
| `TestDelete` | Delete files and folders |
| `TestSymlinkedDataDir` | Path safety with a symlinked data directory |
| `TestLs` | Non-recursive single-folder listing |
| `TestAppend` | Atomic append |
| `TestEdit` | The ordered patch batch (append, prepend, find_replace, line ops) |
| `TestSearch` | Search, regex, glob, ordering, caps |
| `TestGraph` | Graph data |
| `TestConfig` | `GET`/`POST /api/config` |
| `TestInfo` | `GET /api/info` |
| `TestAuth` | Login, logout, gating, rate limit |
| `TestAuthNoViewer` | Admin-only auth with no viewer password |
| `TestAuthSetPasswords` | Setting, changing, and clearing passwords |
| `TestApiTokens` | Token creation, listing, revocation |
| `TestAgentGuide` | `/agent.md` serving and placeholder substitution |
| `TestAiTools` | The assistant's fetch and search tools |
| `TestAiConfig` | Provider profile config and secret carry-over |
| `TestAiChat` | The SSE chat relay |

The AI tests run real loopback `HTTPServer` stubs: `_StubOpenAIHandler`
(`test_app.py:2277`) and `_StubWebHandler` (`test_app.py:2410`).

## Frontend test suite

`tests/dom/test_dom.js` is 14435 lines with a hand-rolled harness. There is
no framework. A `check(label, cond, extra)` counter (`test_dom.js:1470`)
tracks passes and failures, and the process exits with
`process.exit(fail === 0 ? 0 : 1)`.

The harness builds a jsdom window from an inline HTML fixture (the real app
shell), then stubs `fetch`, `matchMedia`, `prompt`, `confirm`, `alert`,
`getBoundingClientRect` / `getClientRects`, `TextEncoder` /
`TextDecoder` / `ReadableStream`, `navigator.clipboard`, `window.print`,
`URL.createObjectURL`, and a canvas 2d context.

It evaluates the real vendor bundles (marked, highlight, codemirror.bundle,
turndown plus the GFM plugin) and about 30 app modules with
`vm.runInContext` in dependency order (`test_dom.js:1417-1450`). The heavy
mermaid, wavedrom, katex, and viz bundles are stubbed.

The `== ai ==` block queues canned SSE frame arrays in `aiChatStreams` and
records requests in `aiChatLog` (`test_dom.js:154-155`). The
`/api/ai/chat` stub plays the queued frames through a `ReadableStream`
(`test_dom.js:1235-1246`).

The file has 73 test sections, each announced with
`console.log("== name ==")`. Sections cover boot, sidebar, theme, viewer,
the five renderers, tabs, search, edit, hybrid mode, table view, graph,
bookmarks, watcher, settings, auth, passwords, tokens, export, wallpaper,
deep links, wikilinks, vim, AI, and first-paint boot state.

A registry-completeness test asserts that `index.html`, `sw.js`, `ai.js`,
and `agent.md` all mention each renderer.

## Running tests

```bash
# Backend (stdlib unittest against the real Flask app)
.venv_$(hostname)/bin/python -m unittest discover -s tests -v
.venv_$(hostname)/bin/python -m pytest tests   # if pytest is installed

# Backend, one test
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# Frontend (installs jsdom, then runs node tests/dom/test_dom.js)
npm install && npm test
node tests/dom/test_dom.js   # equivalent if jsdom is already resolvable
```

There is no lint step. `package.json` is `private: true` and its only
script is `test`, which runs `node tests/dom/test_dom.js`.

## Vendoring and the CodeMirror build exception

The runtime frontend has no build step. `templates/index.html` loads
vendored files and app modules as plain `<script defer>` tags in dependency
order. `static/sw.js` has a hand-maintained `PRECACHE` list of 41 entries
(`sw.js:23-65`).

One asset is different. `static/vendor/codemirror.bundle.js` (738 KB) is an
esbuild IIFE produced **offline** from `static/vendor/codemirror.entry.js`,
which exposes `window.CM6`. There is no build or regeneration script in the
repo, and the esbuild invocation is not documented anywhere. Anyone bumping
CodeMirror must reconstruct that command.

Other vendor files:

- `static/vendor/mermaid.min.js` is a byte-identical copy of
  `node_modules/mermaid/dist/mermaid.min.js`.
- `marked.min.js`, `highlight.min.js`, `turndown*.js`,
  `paged.polyfill.min.js`, `viz*.js`, `wavedrom.unpkg.min.js`, and
  `katex/` are direct upstream distributions.

`package.json` dependencies explain the vendoring: `mermaid` exists to
source the copied bundle; the `@codemirror/*`,
`@replit/codemirror-vim`, and `esbuild` devDependencies exist for the CM6
bundle; `jsdom` is for tests. `@codemirror/buildhelper` appears unused.

## Adding a code-block renderer

1. Add the module under `static/js/`.
2. Register it with `NB.blocks`.
3. Add its `<script>` tag in dependency order in `templates/index.html`.
4. Add its `PRECACHE` entry in `static/sw.js`.
5. Bump `CACHE` in `static/sw.js`.
6. Update the fence name, version, and limits in **both**
   `static/js/ai.js`'s system prompt and the root `agent.md`. Tests assert
   the two stay in sync.

If the renderer ships a vendor bundle, load it through the lazy-load path
rather than a static `<script src>`.

## Adding a frontend config key

1. Add the key to `DEFAULTS` in `static/js/app.js:7`.
2. If it must survive a reload as first paint, add it to `boot_state()` in
   `app.py:737` too.
3. Keep the two definitions in sync.

The server embeds only the validated first-paint subset; content-bearing
keys are excluded.

## Conventions

- Match the surrounding code. Each frontend module is an IIFE extending
  `window.NB`.
- No comments unless they explain non-obvious behavior.
- No hard-coded magic values. Use named constants. The backend groups its
  constants near the top of `app.py`.
- Follow the security chokepoint: every file route resolves its path
  through `safe_path` (`app.py:150`).
- Writes are atomic: temp file plus `os.replace`.

## Where to look next

- [`architecture.md`](architecture.md) — backend structure, storage, auth, and
  the AI proxy.
- [`frontend.md`](frontend.md) — the module inventory, renderer pipeline, and
  persistence.
- [`api.md`](api.md) — the full HTTP endpoint reference.
- [`configuration.md`](configuration.md) — config files, environment variables,
  and browser storage.
- [`markdown.md`](markdown.md) — the supported Markdown and the special fenced
  blocks.
- [`ai-assistant.md`](ai-assistant.md) — the built-in assistant and its tools.
