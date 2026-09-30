# Development

A single-user Markdown notebook server: a Flask backend (`app.py`) plus a
vanilla-JS frontend (`static/js/`, served through `templates/index.html`).
The runtime frontend has no build step. This guide describes the repo layout,
how to run the tests, the vendoring rules, and the checklists for common
changes. Test-suite detail lives in [`../testing/README.md`](../testing/README.md).

## Repo layout

| Entry | Description |
| --- | --- |
| `app.py` | The entire Flask backend: routes, auth, search, edit, AI proxy. 2537 lines |
| `agent.md` | Machine-readable API guide served verbatim at `/agent.md` with the auth state substituted |
| `README.md` | User-facing overview |
| `CLAUDE.md` | Orientation notes for Claude Code |
| `start.sh` | Venv bootstrap and launch wrapper (51 lines) |
| `requirements.txt` | Python dependencies: `Flask==3.0.3`, `bcrypt==5.0.0` |
| `package.json` / `package-lock.json` | Frontend dev tooling and tests; scripts `test`, `test:browser`, `test:browser:firefox`. `package-lock.json` is gitignored but present in a working checkout |
| `notebook.template/` | Starter notes copied into `notebook/` on a fresh install: `Welcome.md`, `README.md`, `Syntax.md` |
| `notebook/` | The notes folder. In this checkout, a symlink to `/mnt/projects/notebook` |
| `config/` | Settings: `config.json`, `auth.json`, `ai.json` |
| `static/` | Frontend assets (see below) |
| `templates/index.html` | The SPA shell; loads vendor files and app modules as `<script defer>` tags |
| `tests/` | `test_app.py` (backend), `dom/test_dom.js` (frontend), `browser/test_hybrid_browser.js` (Playwright) |
| `docs/` | This documentation set |
| `TODO.md` | Task-list stub (contains only `# TODO`) |

`static/` holds four folders: `css/` (`style.css`, `vimnav.css`),
`js/` (29 app modules), `vendor/` (upstream bundles and the CodeMirror
bundle), and `icons/` (PWA icons). It also holds three top-level files:
`manifest.json`, `sw.js` (the service worker), and `favicon.svg`. Each JS
module is an IIFE that extends the shared `window.NB` namespace.

`start.sh` keeps its virtualenv at `.venv_$(hostname)` in the project root.
The folder name is host-specific, so one checkout can hold a venv per
machine. `node_modules/` and the venv folders are not part of the source
tree.

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

There is no lint step. The test suites, their coverage, and the browser test
are documented in [`../testing/README.md`](../testing/README.md).

## Vendoring and the CodeMirror build exception

The runtime frontend has no build step: `templates/index.html` loads the
vendored files and app modules as plain `<script defer>` tags. Almost every
`static/vendor/*` file is a direct upstream copy. The one exception is
`static/vendor/codemirror.bundle.js`, an offline-built esbuild IIFE. The
vendoring model, the bundle's exact dependency set, and the fact that no
script regenerates it are documented in [`build.md`](build.md).

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

- [`../architecture/backend.md`](../architecture/backend.md) — backend
  structure, storage, auth, and the AI proxy.
- [`../architecture/frontend.md`](../architecture/frontend.md) — the module
  inventory, renderer pipeline, and persistence.
- [`../architecture/markdown.md`](../architecture/markdown.md) — the supported
  Markdown and the special fenced blocks.
- [`../architecture/hybrid-editing.md`](../architecture/hybrid-editing.md) —
  the hybrid (WYSIWYG) editing behavior specification.
- [`../architecture/ai-assistant.md`](../architecture/ai-assistant.md) — the
  built-in assistant and its tools.
- [`../contracts/http-api.md`](../contracts/http-api.md) — the full HTTP
  endpoint reference.
- [`../contracts/configuration.md`](../contracts/configuration.md) — config
  files, environment variables, and browser storage.
- [`../testing/README.md`](../testing/README.md) — the test suites.
- [`build.md`](build.md) — the `start.sh` bootstrap, vendoring, the CodeMirror
  bundle, and the service worker.
