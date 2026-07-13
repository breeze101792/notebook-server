# Notebook Server

A small, single-user Markdown notebook server. Flask backend with a JSON
API, vanilla-JS frontend that renders Markdown client-side. Notebooks are
plain `.md` files on disk — no database, no build step.

## Features

- File tree with folders, drag-free right-click context menu (open, new
  file/folder, rename/move, copy, delete).
- Markdown rendering with syntax highlighting (vendored `marked.js` +
  `highlight.js`).
- Multi-tab editor with per-file content cache so unsaved edits survive
  tab switches.
- Heading outline (right-side minimap) with scroll-spy and click-to-jump.
- In-page search across all `.md` files.
- Drag-resizable sidebar / outline, collapsible panels, theme selector.
- All UI state (open files, widths, theme, recent files) is persisted
  to `config/config.json` and restored on next launch.

## Quick start

```bash
# Run the server (creates/refreshes the per-host venv, installs deps, runs app.py)
./start.sh                       # 127.0.0.1:5000, debug on
./start.sh --port 8080 --no-debug
./start.sh --help                # all app.py CLI flags
```

Then open <http://127.0.0.1:5000> in your browser. On first launch the
server seeds `data/Welcome.md` and an empty `config/config.json`.

The venv path is `.venv_<hostname>` so the same checkout is safe to use
on multiple machines without one machine's pip cache stomping the other.

## Requirements

- Python 3.8+ (for `start.sh`'s venv bootstrap)
- Node.js (only for the frontend DOM tests — not needed to run the app)

Python deps are pinned in `requirements.txt`; the only runtime dep is
Flask 3.0.

## Project layout

```
app.py              Flask backend, all routes under /api/*
start.sh            venv bootstrap + launcher
requirements.txt    Python dependencies
templates/
  index.html        single page, loads vendored libs + app modules
static/
  js/               api.js, viewer.js, outline.js, sidebar.js,
                    search.js, tabs.js, app.js (loaded in that order)
  vendor/           marked.js, highlight.js (vendored, no CDN)
data/               your notebooks (.md files) — created on first run
config/             config.json (UI state) — created on first run
tests/
  test_app.py       stdlib unittest, hits the real Flask app via test client
  dom/test_dom.js   jsdom tests, loads real vendor bundles + app modules
```

The `data/` and `config/` directories are deliberately separate and can
be redirected at import time via `NOTEBOOK_DATA_DIR` /
`NOTEBOOK_CONFIG_DIR` (the test suite uses this so it never touches
your real files).

## API

All endpoints return JSON. `GET /` serves the single-page app.

| Method | Path           | Purpose                                  |
| ------ | -------------- | ---------------------------------------- |
| GET    | `/api/config`  | Read the persisted UI config            |
| POST   | `/api/config`  | Replace the persisted UI config         |
| GET    | `/api/info`    | Server / directory info                 |
| GET    | `/api/tree`    | File tree of the notebook directory     |
| GET    | `/api/file`    | Read a file (`?path=…`)                 |
| POST   | `/api/file`    | Save a file (`{path, content}`)         |
| POST   | `/api/create`  | Create a file or folder                 |
| POST   | `/api/move`    | Rename / move                            |
| POST   | `/api/copy`    | Copy a file or folder                    |
| POST   | `/api/delete`  | Delete a file or folder                  |
| GET    | `/api/search`  | Search all `.md` files (`?q=…`)         |

All file routes resolve the user-supplied relative path through
`safe_path()`, which rejects absolute input, `..` traversal, and
symlink escapes outside `data/`. Writes use atomic temp-file +
`os.replace`.

## Tests

```bash
# Backend (stdlib unittest, uses Flask's test client)
.venv_$(hostname)/bin/python -m unittest discover -s tests -v

# Single test class / method
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# Frontend (jsdom — loads real vendor bundles + all six app modules,
# stubs fetch, drives the app via real DOM events)
npm install && npm test
```

The backend tests redirect `data/` and `config/` to a temp dir before
importing `app`, so your real notebooks are never touched.

## Security note

Markdown is rendered **un-sanitized** because the notebooks are your own
files in `data/`. If you ever load untrusted content (pastes from
elsewhere, shared files), add a vendored DOMPurify and sanitize before
`innerHTML` in `viewer.js`.
