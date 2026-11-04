# Development

A single-user Markdown notebook server: a Flask backend (`app.py`) plus a
vanilla-JS frontend (`static/js/`, served through `templates/index.html`).
The runtime frontend has no build step. This guide describes the repo layout,
how to run the tests, the vendoring rules, and the checklists for common
changes. Test-suite detail lives in [`../testing/README.md`](../testing/README.md).

## Repo layout

| Entry | Description |
| --- | --- |
| `app.py` | The entire Flask backend: routes, auth, search, edit, AI proxy. 4205 lines |
| `acp_client.py` | The Flask-free half of the ACP provider: spawns the agent subprocess and drives one turn over stdio. 306 lines |
| `agent.md` | Machine-readable API guide served verbatim at `/agent.md` with the auth state substituted |
| `README.md` | User-facing overview |
| `CLAUDE.md` | Orientation notes for Claude Code |
| `start.sh` | Venv bootstrap and launch wrapper (51 lines) |
| `requirements.txt` | Python dependencies: `Flask==3.0.3`, `bcrypt==5.0.0`, `agent-client-protocol==0.12.1`. The last one requires Python 3.10 or newer |
| `package.json` / `package-lock.json` | Frontend dev tooling and tests. Scripts: `test`, `test:browser`, `test:browser:firefox`, `test:browser:all`, `vendor:visimer`, and one `test:browser:<suite>` per browser suite. `package-lock.json` is gitignored but present in a working checkout |
| `notebook.template/` | Starter notes copied into `notebook/` on a fresh install: `Welcome.md`, `README.md`, `Syntax.md` |
| `notebook/` | The notes folder. In this checkout, a symlink to `/mnt/projects/notebook` |
| `config/` | Settings: `config.json`, `auth.json`, `ai.json`, `workspaces.json`, the hand-edited `acp.json`, and `acp.json.example` |
| `static/` | Frontend assets (see below) |
| `templates/index.html` | The SPA shell (1953 lines); loads the vendor files and all 45 app modules as `<script defer>` tags |
| `tests/` | `test_app.py` (backend, 6504 lines, 461 test methods), `dom/test_dom.js` (frontend), the 12 Playwright suites in `browser/`, the stub ACP agent in `fixtures/`, and the manual real-agent check in `manual/` |
| `docs/` | This documentation set; the audit results are in `testing/browser-audit.md` |
| `TODO.md` | Task-list stub (contains only `# TODO`) |

`static/` holds four folders: `css/` (`style.css`, `vimnav.css`),
`js/` (45 app modules), `vendor/` (upstream copies plus the two offline-built
bundles), and `icons/` (PWA icons). It also holds three top-level files:
`manifest.json`, `sw.js` (the service worker), and `favicon.svg`. Each JS
module is an IIFE that extends the shared `window.NB` namespace.

`start.sh` keeps its virtualenv at `.venv_$(hostname)` in the project root.
The folder name is host-specific, so one checkout can hold a venv per
machine. `.gitignore` covers `.venv/`, `node_modules/`, and
`package-lock.json`, but not `.venv_<hostname>/`, so a host venv shows up as
untracked in a working checkout.

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

# Every real-browser suite (auto-detects Chromium; distinct ports)
npm run test:browser:all
node tests/browser/run_all.js                    # equivalent
node tests/browser/run_all.js --only=designer    # one suite by substring
```

`npm run test:browser:all` and `node tests/browser/run_all.js` run the same
`run_all.js` driver: it spawns each of the 12 suites sequentially, each against
its own Flask server on an explicit port. Every suite also has its own script
(`npm run test:browser:core`, `:auth`, `:ai`, `:ai-blocks`, `:blocks`,
`:figure-sizing`, `:hybrid-blocks`, `:mobile`, `:designer`, `:table-editor`,
`:dw`, and the hybrid default `:browser`). `CHROMIUM_PATH` overrides the
auto-detected browser binary.

There is no lint step. The test suites, their coverage, and the browser test
are documented in [`../testing/README.md`](../testing/README.md).

## Vendoring and the two build exceptions

The runtime frontend has no build step: `templates/index.html` loads the
vendored files and app modules as plain `<script defer>` tags. Almost every
`static/vendor/*` file is a direct upstream copy. Two files are not:
`static/vendor/codemirror.bundle.js` and `static/vendor/visimer.bundle.js`,
both offline-built esbuild IIFEs. The vendoring model, each bundle's exact
dependency set, and the fact that only the Visimer one has a regeneration
script are documented in [`build.md`](build.md).

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

1. Add the key to `DEFAULTS` in `static/js/app.js:35`.
2. If it must survive a reload as first paint, add it to `boot_state()` in
   `app.py` too.
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
  through `safe_path()` in `app.py`.
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
- [`build.md`](build.md) — the `start.sh` bootstrap, vendoring, the two
  offline-built bundles, and the service worker.
