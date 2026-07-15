# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small, single-user Markdown notebook server: a Flask backend (`app.py`, JSON-only
API) + a vanilla-JS frontend (`templates/index.html`, `static/js/*.js`) that renders
Markdown client-side with vendored `marked.js` + `highlight.js`. Notebook content
and user config live in two deliberately separate folders, `notebook/` (notes)
and `config/` (user settings). `notebook.template/` ships a tiny starter
notebook that is copied into `notebook/` on first run.

## Commands

```bash
# Run the server (creates/refreshes .venv_<hostname>, installs requirements, then runs app.py)
./start.sh                       # 0.0.0.0:5000, debug off (reachable from LAN by default)
./start.sh --host 127.0.0.1      # bind loopback only
./start.sh --debug               # enable Flask auto-reload (banner prints twice)
./start.sh --port 8080 --debug
./start.sh --help                # all app.py CLI flags

# Run the backend directly (assumes deps installed in the active env)
python app.py

# Backend tests (stdlib unittest against the real Flask app via test client)
.venv_$(hostname)/bin/python -m unittest discover -s tests -v
.venv_$(hostname)/bin/python -m pytest tests   # if pytest is installed

# Run a single backend test class or method
.venv_$(hostname)/bin/python -m unittest tests.test_app.TestSearch.test_case_insensitive_finds_all -v

# Frontend DOM tests (jsdom — load real vendor bundles + all app modules, stub fetch)
npm install && npm test
node tests/dom/test_dom.js        # equivalent if jsdom already resolvable
```

There is no lint step configured; the only test runners are `unittest` (backend) and
`node tests/dom/test_dom.js` (frontend).

## Optional: enabling password protection

By default the server is open. To put a two-password gate in front of the API
(admin = read/write, viewer = read-only), write `config/auth.json`:

```bash
# 1. hash your admin password
HASH_ADMIN=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_ADMIN_PW', bcrypt.gensalt(12)).decode())")
# 2. (optional) hash a viewer password; omit to disable the read-only role
HASH_VIEWER=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_VIEWER_PW', bcrypt.gensalt(12)).decode())")
# 3. write the file (the server generates the session-signing secret on first start)
python -c "
import json
open('config/auth.json', 'w').write(json.dumps({
    'admin_password_hash': '$HASH_ADMIN',
    'viewer_password_hash': '$HASH_VIEWER',
}, indent=2))
"
# 4. restart the server -- the login modal will appear on next page load
```

A failed-login rate limiter trips 429 after 5 wrong attempts in 60s per client IP.
Delete `config/auth.json` to remove auth.

## Architecture

**Backend — `app.py` (single file, ~700 lines).** All routes are under `/api/*` and
return JSON; `GET /` serves `index.html`. The module resolves `DATA_DIR` /
`CONFIG_DIR` at import time from `NOTEBOOK_DATA_DIR` / `NOTEBOOK_CONFIG_DIR`
(defaulting to the project `notebook/` and `config/` folders) and calls `seed()`
on import. `seed()` ensures `config/config.json` exists, runs a one-time
migration of legacy `data/` into `notebook/` if needed, and on a fresh
install copies the contents of `notebook.template/` into `notebook/`. The
template ships with a single `Welcome.md`; editing notes never touches the
template. Endpoints: `/api/auth` (GET), `/api/login` (POST), `/api/logout`
(POST), `/api/config` (GET/POST), `/api/tree` (GET), `/api/file` (GET/POST),
`/api/create`, `/api/move`, `/api/copy`, `/api/delete`, `/api/search`.

`safe_path(rel)` is the security-critical chokepoint: every file route resolves the
user-supplied relative path through it, which rejects absolute input, `..` traversal,
and symlink escapes outside `DATA_DIR`, returning the real absolute path or `None`.
Any new file operation must go through `safe_path` and must never accept a raw
user path. Writes use `atomic_write` (temp file + `os.replace`); config writes do the
same. Search (`/api/search`) is a line-by-line regex scan of all `.md` files with
`MAX_TOTAL_MATCHES` / `MAX_MATCHES_PER_FILE` caps; matches are returned with a snippet
where the hit is wrapped in `<<…>>` so the client can re-highlight safely without
parsing HTML.

**Auth (optional two-password gate).** `config/auth.json` (separate from
`config.json` so the UI-prefs blob can never include hashed credentials) holds
`{"admin_password_hash": "<bcrypt>", "viewer_password_hash": "<bcrypt>"}`
plus a generated `secret` used as Flask's session-signing key. If both hashes
are empty/missing the whole auth layer is bypassed. When configured,
`@login_required` (401 if no session) gates every API route except `/` and
`/api/auth`/`/api/login`; `@admin_required` (403 if role != "admin") adds the
mutating routes on top. Sessions are Flask's signed/encrypted cookies; the
role is `session["role"]` ∈ `{"admin", "viewer"}`. A best-effort in-memory
rate limiter (5 failures / 60s per client IP) trips 429 on the 6th attempt.
There is no in-app UI for setup — the user hashes a password with
`python -c "import bcrypt; print(bcrypt.hashpw(b'pw', bcrypt.gensalt(12)).decode())"`
and pastes the result into `config/auth.json`. The secret is auto-generated
on first start and persisted.

**Frontend — vanilla JS, no build step.** `templates/index.html` loads vendored libs
then app modules in dependency order: `api.js → auth.js → viewer.js → editbar.js →
watcher.js → outline.js → sidebar.js → search.js → tabs.js → settings.js → app.js`.
Each is an IIFE that extends the shared `window.NB` namespace (e.g. `NB.tabs`,
`NB.viewer`, `NB.sidebar`, `NB.search`, `NB.outline`, `NB.api`, `NB.auth`).
Module responsibilities:

- `api.js` — fetch wrappers + a tiny pub/sub (`NB.api`); always sends
  `credentials: "same-origin"` so the session cookie is included, and emits
  `NB.evt("auth:required")` on any 401 so the auth module can re-show the
  login modal.
- `auth.js` — password-gate UI: on `DOMContentLoaded` calls `/api/auth`; if
  enabled + no role, shows the login modal and dims the rest of the UI with
  `body.auth-locked`. Successful login calls `window.location.reload()` so
  the rest of the modules boot with a known-good session. Wires the
  top-bar logout button.
- `viewer.js` — renders Markdown with marked+highlight, owns the per-file
  content/edit cache and the edit/view toggle. Notebooks are the user's own files in
  `notebook/`, so they are rendered **un-sanitized**; if untrusted content is ever
  introduced, add vendored DOMPurify and sanitize before `innerHTML`.
- `tabs.js` — top-bar file tabs; owns the ordered open set + active file, coordinates
  with `viewer.js` (per-file content cache so unsaved edits survive tab switches), and
  persists `openFiles`/`activeFile` to config.
- `sidebar.js` — left file tree + right-click context menu (open, new file/folder,
  rename/move, copy, delete).
- `outline.js` — right-side heading TOC minimap, scroll-spy highlight, click-to-jump.
- `search.js` — search UI; re-wraps `<<…>>` snippets into `<mark>` via textContent
  (never `innerHTML` on snippet text).
- `app.js` — bootstrap: loads config (merged over `DEFAULTS`), wires everything,
  drives sidebar/outline collapse + drag-resize (CSS vars `--sidebar-width` /
  `--outline-width`), theme select.

**Config (`config/config.json`).** Frontend state persisted by the app: `theme`,
`lastFile`, `recentFiles`, `openFiles`, `activeFile`, `sidebarWidth`,
`outlineWidth`, `sidebarCollapsed`, `outlineCollapsed`, `searchCaseSensitive`.
It is an opaque JSON object the server stores verbatim — no schema enforcement.

## Testing conventions

Backend tests (`tests/test_app.py`) redirect `NOTEBOOK_DATA_DIR` /
`NOTEBOOK_CONFIG_DIR` to a temp dir **before** importing `app` (the module resolves
those at import time and calls `seed()`), so the project's real `notebook/` /
`config/` are never touched. `setUp` wipes and re-seeds the temp dirs each test.
`TestAuth` writes a custom `auth.json` after `super().setUp()` and resets
`nb._login_failures` between tests so the rate limiter doesn't leak across them.

Frontend tests (`tests/dom/test_dom.js`) load the real vendor bundles and all eleven
app modules into a jsdom window, stub `fetch`/`matchMedia`/`prompt`, then drive the
app by dispatching real DOM events (`DOMContentLoaded`, click, input, mousemove).
The fetch stub defaults to `authEnabled=false` so the login modal stays closed for
the existing tests; a dedicated `== auth ==` block flips the flags and exercises
the full login/logout flow + the 401 → `auth:required` event path. When
adding frontend behavior, extend this harness rather than adding a separate runner —
the ordering and stubs (e.g. `getBoundingClientRect` overrides for drag-resize) are
load-bearing for the assertions.