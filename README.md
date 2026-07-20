# Notebook Server

A small, single-user Markdown notebook server. Flask backend with a JSON
API, vanilla-JS frontend that renders Markdown client-side. Notebooks are
plain `.md` files on disk — no database, no build step.

## Features

- File tree with folders, right-click context menu (open, new
  file/folder, rename/move, copy, delete).
- Markdown rendering with syntax highlighting (vendored `marked.js` +
  `highlight.js`).
- Multi-tab editor (CodeMirror) with per-file content cache so unsaved
  edits survive tab switches, and an optional Vim/Emacs keybinding mode.
- Heading outline (right-side minimap) with scroll-spy and click-to-jump.
- In-page search across all `.md` files with safe snippet highlighting
  (server returns `<<…>>` markers; the client rewraps them as `<mark>`
  via `textContent`, never `innerHTML` on snippet text).
- Drag-resizable sidebar / outline, collapsible panels, theme selector,
  font-size scale, and per-theme code-block highlight stylesheet.
- Optional two-password gate (admin + viewer) with bcrypt-hashed
  credentials stored in `config/auth.json`.
- All UI state (open files, widths, theme, recent files) is persisted
  to `config/config.json` and restored on next launch.

## Quick start

```bash
# Run the server (creates/refreshes the per-host venv, installs deps, runs app.py)
./start.sh                       # 0.0.0.0:5000, debug off (reachable from LAN)
./start.sh --host 127.0.0.1      # bind loopback only
./start.sh --debug               # enable Flask auto-reload
./start.sh --port 8080 --debug
./start.sh --help                # all app.py CLI flags
```

Then open <http://127.0.0.1:5000> in your browser. On first launch the
server copies `notebook.template/` into `notebook/` (a single
`Welcome.md`) and creates an empty `config/config.json`.

The venv path is `.venv_<hostname>` so the same checkout is safe to use
on multiple machines without one machine's pip cache stomping the other.
A legacy `data/` folder at the project root is auto-migrated to
`notebook/` on first run.

## Requirements

- Python 3.8+ (for `start.sh`'s venv bootstrap)
- Node.js (only for the frontend DOM tests — not needed to run the app)

Python deps are pinned in `requirements.txt`: Flask 3.0 and bcrypt.

## Project layout

```
app.py                Flask backend, all routes under /api/*
start.sh              per-host venv bootstrap + launcher
requirements.txt      Python dependencies
notebook.template/    starter notebook (copied into notebook/ on first run)
templates/
  index.html          single page, loads vendored libs + app modules
static/
  js/                 api.js, auth.js, viewer.js, editbar.js, watcher.js,
                      outline.js, sidebar.js, search.js, tabs.js,
                      settings.js, cm-bridge.js, shortcuts.js, vimnav.js,
                      app.js (loaded in dependency order)
  vendor/             marked.js, highlight.js, codemirror (vendored, no CDN)
notebook/             your notebooks (.md files) — created on first run
config/               config.json (UI state), auth.json (passwords) — created on first run
tests/
  test_app.py         stdlib unittest, hits the real Flask app via test client
  dom/test_dom.js     jsdom tests, loads real vendor bundles + app modules
```

`notebook/` and `config/` are deliberately separate folders and can be
redirected at import time via `NOTEBOOK_DATA_DIR` / `NOTEBOOK_CONFIG_DIR`
(the test suite uses this so it never touches your real files).

## API

All endpoints return JSON. `GET /` serves the single-page app. Gated
read responses set `Cache-Control: no-store, private` so a previously-
authorized browser can't keep showing the content after the auth state
tightens.

| Method | Path                  | Purpose                                            |
| ------ | --------------------- | -------------------------------------------------- |
| GET    | `/api/auth`           | Auth state (`{enabled, hasAdmin, hasViewer, role}`) |
| POST   | `/api/login`          | Try admin, then viewer password; rate-limited      |
| POST   | `/api/logout`         | End the current session                            |
| POST   | `/api/auth/passwords` | Set/rotate admin + optional viewer password (admin)|
| GET    | `/api/config`         | Read the persisted UI config                      |
| POST   | `/api/config`         | Replace the persisted UI config (admin)           |
| GET    | `/api/info`           | Absolute `data_dir` / `config_dir`                |
| GET    | `/api/tree`           | File tree of the notebook directory                |
| GET    | `/api/file`           | Read a file (`?path=…`)                            |
| POST   | `/api/file`           | Save a file (`{path, content}`)                    |
| POST   | `/api/create`         | Create a file or folder                            |
| POST   | `/api/move`           | Rename / move                                      |
| POST   | `/api/copy`           | Copy a file or folder                              |
| POST   | `/api/delete`         | Delete a file or folder                            |
| GET    | `/api/search`         | Search all `.md` files (`?q=…`)                   |

All file routes resolve the user-supplied relative path through
`safe_path()`, which rejects absolute input, `..` traversal, and
symlink escapes outside `notebook/`. Writes use atomic temp-file +
`os.replace`. Search is a line-by-line regex scan with
`MAX_TOTAL_MATCHES=200` and `MAX_MATCHES_PER_FILE=20` caps; matches
return a snippet with the hit wrapped in `<<…>>` so the client can
re-highlight without parsing HTML.

## Optional: password protection

By default the server is open. To put a two-password gate in front of
the API, open the Settings modal (⚙ button in the top bar) →
**Passwords**:

- **Admin password** (required to enable auth): set this first. Once
  set, all writes require a logged-in admin; with only the admin
  password set, reads are open.
- **Viewer password** (optional): a separate password that, when set,
  requires *any* visitor to sign in (admin or viewer) to read notes.
  The toggle clears the viewer password; it can be re-set any time.

Passwords are sent over the wire as plain text, hashed server-side with
bcrypt (cost 12), and never stored in plaintext. A failed-login rate
limiter trips 429 after 5 wrong attempts in 60s per client IP. The
**Logout** button in the top bar (visible only when auth is on and the
user is signed in) ends the current session.

### Recovery: hand-writing `config/auth.json`

If you'd rather not use the UI (headless setup, scripted deploys, or a
full reset), write the file directly:

```bash
HASH_ADMIN=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_ADMIN_PW', bcrypt.gensalt(12)).decode())")
HASH_VIEWER=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_VIEWER_PW', bcrypt.gensalt(12)).decode())")
python -c "
import json
open('config/auth.json', 'w').write(json.dumps({
    'admin_password_hash': '$HASH_ADMIN',
    'viewer_password_hash': '$HASH_VIEWER',
}, indent=2))
"
# restart the server -- the login modal appears on next page load
```

To fully remove the auth layer, delete `config/auth.json` and restart.
An empty admin password is rejected by the UI (you can't disable auth
from inside the app — only by deleting the file).

## Tests

```bash
# Backend (stdlib unittest, uses Flask's test client)
.venv_$(hostname)/bin/python -m unittest discover -s tests -v

# Single test class / method
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# Frontend (jsdom — loads real vendor bundles + all app modules,
# stubs fetch, drives the app via real DOM events)
npm install && npm test
node tests/dom/test_dom.js        # equivalent if jsdom already resolvable
```

The backend tests redirect `notebook/` and `config/` to a temp dir
before importing `app`, so your real notebooks are never touched. The
auth test class writes a custom `auth.json` and resets the in-memory
failure tracker between tests so the rate limiter doesn't leak.

## Security note

Markdown is rendered **un-sanitized** because the notebooks are your
own files in `notebook/`. If you ever load untrusted content (pastes
from elsewhere, shared files), add a vendored DOMPurify and sanitize
before `innerHTML` in `viewer.js`.
