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

By default the server is open. To put a two-password gate in front of the
API, open the Settings modal (⚙ button in the top bar) → **Passwords**:

- **Admin password** (required to enable auth): set this first. The
  next page load will require the password for *all* writes; if you also
  enable the viewer password, reads are gated too.
- **Require a password to read** (optional): set a separate viewer
  password. When unset, reads are open. When set, anyone hitting the
  site must sign in as a viewer (or admin) to read. The toggle clears
  the viewer password; it can be re-set any time.

Passwords are sent over the wire as plain text, hashed server-side with
bcrypt (cost 12), and never stored. The page reloads after a save so
the new auth state takes effect on the next boot.

A failed-login rate limiter trips 429 after 5 wrong attempts in 60s per
client IP. **Logout button** in the top bar (visible only when auth is
on and the user is signed in) ends the current session. Sign out from
a viewer session and reopen the modal to make changes — non-admins
can't edit the passwords section.

### Recovery / power-user: hand-writing `config/auth.json`

If you'd rather not use the UI (e.g. headless setup, scripted deploys,
or a full reset), write the file directly:

```bash
# 1. hash your admin password
HASH_ADMIN=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_ADMIN_PW', bcrypt.gensalt(12)).decode())")
# 2. (optional) hash a viewer password; omit the key to keep reads open
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

To fully remove the auth layer, delete `config/auth.json` and restart.

## Architecture

**Backend — `app.py` (single file, ~700 lines).** All routes are under `/api/*` and
return JSON; `GET /` serves `index.html`. The module resolves `DATA_DIR` /
`CONFIG_DIR` at import time from `NOTEBOOK_DATA_DIR` / `NOTEBOOK_CONFIG_DIR`
(defaulting to the project `notebook/` and `config/` folders) and calls `seed()`
on import. `seed()` ensures `config/config.json` exists, runs a one-time
migration of legacy `data/` into `notebook/` if needed, and on a fresh
install copies the contents of `notebook.template/` into `notebook/`. The
template ships with a single `Welcome.md`; editing notes never touches the
template. Endpoints: `/api/auth` (GET), `/api/auth/passwords` (POST, admin-only),
`/api/auth/tokens` (GET/POST) + `/api/auth/tokens/<name>` (DELETE, admin-only),
`/api/login` (POST), `/api/logout` (POST), `/api/config` (GET/POST),
`/api/tree` (GET), `/api/ls` (GET, non-recursive single-folder listing),
`/api/file` (GET/POST), `/api/file/append` (POST, atomic O_APPEND append),
`/api/edit` (POST, ordered all-or-nothing patch batch: append/prepend/
find_replace/line_insert/line_replace/line_delete applied in memory then
atomically written), `/api/create` (optional `upsert: true` = idempotent
ensure-exists that never clobbers; optional `content` seeds new files),
`/api/move`, `/api/copy` (both take `onConflict: error|skip|overwrite`;
absent-destination file moves use atomic link+unlink, copies use exclusive
create), `/api/delete`, `/api/search`, `/api/graph`; plus the ungated
`/agent.md` route, which serves the project-root `agent.md` verbatim as
text/markdown with the current auth state substituted into a
`{{auth_state}}` placeholder — a machine-readable API guide for AI agents,
maintained as a normal Markdown file (documentation only — no data — so
agents can discover how to authenticate before holding any credential).

`safe_path(rel)` is the security-critical chokepoint: every file route resolves the
user-supplied relative path through it, which rejects absolute input, `..` traversal,
and symlink escapes outside `DATA_DIR`, returning the real absolute path or `None`.
Any new file operation must go through `safe_path` and must never accept a raw
user path. Writes use `atomic_write` (temp file + `os.replace`); config writes do the
same. Search (`/api/search`) is a line-by-line scan of all `.md` files with
default caps `MAX_TOTAL_MATCHES=200` / `MAX_MATCHES_PER_FILE=20` (raisable per
request via `limit=` / `perFile=` up to the hard ceilings); matches are returned
with a snippet where the hit is wrapped in `<<…>>` so the client can re-highlight
safely without parsing HTML. Optional params: `regex=1` (Python regex per line),
`file=` (scan one specific file only), `glob=` (fnmatch filter on relative path),
and `order=path|mtime|count` (+ `desc=1`) to reorder result files.

**Auth (optional two-password gate).** `config/auth.json` (separate from
`config.json` so the UI-prefs blob can never include hashed credentials) holds
`{"admin_password_hash": "<bcrypt>", "viewer_password_hash": "<bcrypt>"}`
plus a generated `secret` used as Flask's session-signing key. Auth is "on"
when the admin password is set; the viewer password is independent and only
gates reads (admin set, viewer unset → reads open, writes gated). Three
decorators compose the layer: `@login_required` (401 if no session) gates
the mutating routes; `@admin_required` (403 if role != "admin") adds the
write paths; `@read_login_required` (401 if no session AND a viewer
password is configured) gates the read paths so an admin-only config
leaves reads open. Sessions are Flask's signed/encrypted cookies; the
role is `session["role"]` ∈ `{"admin", "viewer"}`. A best-effort in-memory
rate limiter (5 failures / 60s per client IP) trips 429 on the 6th attempt.
**Named API tokens** let agents/scripts skip the cookie dance: issued via
admin-only `POST /api/auth/tokens` (`{name, role}`, full token shown once,
only a bcrypt hash stored), revoked via `DELETE /api/auth/tokens/<name>`,
and sent as `Authorization: Bearer nbtk_…`. A presented-but-invalid Bearer
fails hard with 401 (no fallback to the session) and shares the login rate
limiter; clearing the admin password clears all tokens.
The Settings modal's **Passwords** section is the in-app setup path:
admin password is set/rotated via a single input, and the optional viewer
password is set/cleared via a "Require a password to read" toggle. The
admin-only `POST /api/auth/passwords` route hashes the values (bcrypt
cost 12) and writes them; the page reloads after every save so the boot
path runs again with the new state. Empty `admin_password` (with a
verified `admin_current_password`) clears the admin hash and disables
auth entirely (the viewer hash is also cleared); this is the UI path
to turn auth back off. Empty `viewer_password` clears the viewer. The
`GET /api/auth` response is `{enabled, hasAdmin, hasViewer, role}` so
the UI can render without exposing hashes.

**AI assistant (optional; OpenAI-compatible proxy + reviewable edits).**
`config/ai.json` (own file so the client-posted config blob can never
hold secrets) stores `{"servers": [{"name", "base_url", "api_key",
"model"}], "default", "custom_prompt", "searxng_url"}` — a list of
provider profiles plus the global custom prompt and the optional SearXNG
instance URL. All `/api/ai/*` routes are `@admin_required` (open only
while auth is off, like every other admin route):

- `GET/POST /api/ai/config` — masked profile list (`{"servers": [{"name",
  "baseUrl", "model", "hasKey"}], "default", "customPrompt",
  "searxngUrl"}`); the stored API key is NEVER echoed to any client.
  POSTing a profile with `apiKey: ""` + `replaceSecret: true` carries the
  previously stored key over server-side (the Settings UI relies on this).
  Base URLs are normalized on save (trailing slash + `/v1` stripped;
  `_chat_url()` appends `/v1/chat/completions`). `customPrompt` and
  `searxngUrl` are global, preserved when a POST omits them, cleared when
  sent as `""`.
- `GET /api/ai/probe?server=<name>` — reachability check; an upstream
  HTTP error (even 401) counts as "reachable", connection failures return
  `{ok: false}` with HTTP 200 so the UI never sees a trace.
- `POST /api/ai/chat` — SSE relay to the chosen provider. Body
  `{server, messages:[{role,content}]}` (roles validated server-side; the
  payload is rebuilt from known fields, so extra client keys never reach
  the provider and the stored `api_key` is attached server-side only).
  Upstream byte stream is relayed verbatim as `text/event-stream`
  (GeneratorExit-safe on early client disconnect); upstream HTTP errors
  are re-emitted in-band as `event: error` / `data: {"error": true,
  "status", "message"}` frames so the browser can show them.
- `POST /api/ai/fetch` — server-side URL fetch for the assistant's fetch
  tool (the browser can't cross CORS). Body `{"url": "<http(s) url>"}`;
  only http(s) is allowed, the body is capped at `AI_FETCH_MAX_BYTES`
  (512 KiB) and the request times out after `AI_FETCH_TIMEOUT` (15s).
  Returns `{url, contentType, truncated, content}`.
- `POST /api/ai/search` — SearXNG search for the assistant's search tool.
  Body `{"q": "<query>"}`. Requires a `searxngUrl` in `config/ai.json`;
  when none is configured it returns 400 (the model is told the tool is
  disabled). Queries the instance's JSON output format and returns the top
  `AI_SEARXNG_MAX_RESULTS` (10) results as `{title, url, snippet}`.

**Frontend — vanilla JS, no build step.** `templates/index.html` loads vendored libs
then app modules in dependency order: `api.js → auth.js → viewer.js → editbar.js →
watcher.js → outline.js → sidebar.js → search.js → tabs.js → settings.js →
export.js → ai.js → activity.js → app.js`.
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
- `ai.js` — AI assistant side-panel view (✨ in the activity bar; lazy-mount
  host `#ai-view`, `<div id="ai-view" class="side-panel-view" data-view="ai">`
  in `index.html`). Chat streams through `NB.api.aiChat` (SSE; `api.js` parses
  OpenAI-style `delta.content` frames). It is an **agentic tool loop**, not a
  context-free chat:

  - **Six tools** are declared in `systemPrompt()` and called by the model as
    fenced ` ```nb-tool ` JSON blocks: `list` (tree, auto), `read` (file body,
    auto), `fetch` (server-side URL fetch, auto), `search` (SearXNG, auto),
    `write` (create **new** file, permission card), `patch` (edit an
    existing file via a batch of `/api/edit` ops, permission card). Writes on
    an existing path are blocked client-side ("ask the AI to patch it
    instead") — overwrite-via-write is not a flow.
  - **Tool loop**: after each assistant reply, tool calls are executed
    (list/read/fetch/search immediately, surfaced as `.ai-tool-trace` lines;
    write/patch as Apply/Reject cards) and their results are fed back as
    tool-result user messages so the model can continue (`MAX_TOOL_ROUNDS`
    caps the fan-out; a pending permission card pauses the loop until the
    user decides).
  - **Memory**: `ai.js` owns the full transcript (`conversation`: system
    prompt + user turns + assistant replies + tool outcomes). Every request
    re-uploads it, so follow-ups keep context without re-reading files.
    Reject/apply/blocked outcomes are appended via `recordToolOutcome` so the
    model sees what happened to its proposals. The **Clear** button in the
    panel header resets the conversation.
  - Legacy ` ```nb-edit ` single-op blocks still render as patch cards (they
    target the current file when no path is given); patch tools are previewed
    client-side via `previewPatch()` (literal find_replace/append/prepend
    simulation) and applied through `/api/edit`, so the server re-checks every
    anchor against the CURRENT file — stale/ambiguous finds fail closed with
    400 and the card turns errored. Applying emits `NB.evt("ai:applied",
    {path})`; `viewer.js` listens and refreshes its cache (self-save noted to
    the watcher, no confirm prompt). The tool contract is introduced in
    `ai.js`'s `systemPrompt()`; server keys live only in `config/ai.json`.
- `app.js` — bootstrap: loads config (merged over `DEFAULTS`), wires everything,
  drives sidebar/outline collapse + drag-resize (CSS vars `--sidebar-width` /
  `--outline-width`), theme select, font-size scale (CSS var `--font-scale` on
  `:root` driven by rem-based chrome), and the code-theme swap that enables
  either the dark or light vendored highlight.js stylesheet based on the
  resolved body theme.
- `settings.js` — Settings modal. Three "live" fields (theme, font size,
  file-watching toggle) use a **draft-then-commit** model: editing a radio or
  the watch toggle only mutates an in-memory draft; an `Apply` / `Save` /
  `Cancel` footer (and the header `×`, Esc, and backdrop click) decides what
  happens. Both `Apply` and `Save` commit the draft through
  `NB.app.setTheme` / `setFontSize` / `NB.watcher.enable|disable` (each of
  which writes through to the same debounced `persistConfig()` the rest of
  the UI uses) and close the modal — closing immediately is the most reliable
  way for the user to see the result of a font-size or theme switch, since
  the modal in front of the dimmed UI makes subtle changes hard to notice.
  `Cancel` reverts live state to the snapshot taken at `open()` time and
  closes. The `×` / Esc / backdrop click all delegate to a dynamic `close()`
  — `Cancel` if the draft is dirty, plain close otherwise. The **Passwords**
  section is deliberately excluded from this footer flow and keeps its own
  per-section Save/Remove buttons that reload the page on success. The
  **API tokens** section (same Security tab) is also admin-only and live:
  it lists/creates/revokes named bearer tokens via `/api/auth/tokens` and
  shows the full token string exactly once at creation. The **AI** tab is
  the third admin-only live section: it edits the provider profile list
  (add / make-default / Test / Remove) against `GET/POST /api/ai/config`;
  editing an existing profile never re-sends its key (blank `apiKey` +
  `replaceSecret: true` carries the stored one over server-side), and
  every commit also refreshes the side-panel picker via
  `NB.ai.loadAiConfig()`. The **Web search** field (same AI tab) sets the
  global SearXNG instance URL for the assistant's search tool; it has its
  own Save button and is preserved across provider saves.
- `export.js` — Export modal (top-bar **Export** button, right of **Edit**;
  also reachable via **Export…** in the file-tree, bookmark, and tab
  right-click menus, each targeting that specific file). Exports a note
  to **PDF** or a self-contained **HTML** file.
  Purely client-side: `renderInto()` re-renders the note from the
  viewer's content cache through the same pipeline the app uses (marked +
  highlight.js + the mermaid/wavedrom/katex/viz renderers), so the output
  always matches the on-screen rendering. **PDF** renders into a
  `#print-host` container (a direct child of `<body>`, hidden on screen)
  then calls `window.print()`; the `@media print` block in `style.css`
  hides the app chrome and shows only that container, so the browser's
  "Save as PDF" captures the note alone. **HTML** builds a standalone
  `.html` file with the rendered note + embedded styles (the app's
  markdown rules + the light highlight.js theme) and downloads it via a
  Blob. **Scope** is "current file" (the whole note) or "section": the
  modal lists the note's `h1`–`h3` headings (`extractHeadings`) in a
  dropdown and `sliceSection` slices the source from the chosen heading
  up to the next heading of the same or higher level, so only that
  section is exported.

**Config (`config/config.json`).** Frontend state persisted by the app: `theme`,
`fontSize`, `lastFile`, `recentFiles`, `openFiles`, `activeFile`, `sidebarWidth`,
`outlineWidth`, `sidebarCollapsed`, `outlineCollapsed`, `searchCaseSensitive`.
`fontSize` ∈ {`"small"`, `"medium"`, `"large"`, `"xlarge"`} drives the
`--font-scale` CSS variable (0.9 / 1.0 / 1.15 / 1.3); the resolved value applies
to the whole app via rem-ified chrome. The code-block syntax theme is **not**
persisted — it follows the body theme at runtime (light theme loads the
`github.css` hljs stylesheet, dark theme loads `github-dark.css`). It is an
opaque JSON object the server stores verbatim — no schema enforcement.

## Testing conventions

Backend tests (`tests/test_app.py`) redirect `NOTEBOOK_DATA_DIR` /
`NOTEBOOK_CONFIG_DIR` to a temp dir **before** importing `app` (the module resolves
those at import time and calls `seed()`), so the project's real `notebook/` /
`config/` are never touched. `setUp` wipes and re-seeds the temp dirs each test.
`TestAuth` writes a custom `auth.json` after `super().setUp()` and resets
`nb._login_failures` between tests so the rate limiter doesn't leak across them.

Frontend tests (`tests/dom/test_dom.js`) load the real vendor bundles and all
app modules into a jsdom window, stub `fetch`/`matchMedia`/`prompt`, then drive
the app by dispatching real DOM events (`DOMContentLoaded`, click, input,
mousemove). The fetch stub defaults to `authEnabled=false` so the login modal
stays closed for the existing tests; a dedicated `== auth ==` block flips the
flags and exercises the full login/logout flow + the 401 → `auth:required`
event path. The `== ai ==` block queues canned SSE streams in `aiChatStreams`
(the `/api/ai/chat` stub plays them through a `ReadableStream`) and needs the
`TextEncoder`/`TextDecoder`/`ReadableStream` window stubs installed near the
top of the harness. When adding frontend behavior, extend this harness rather
than adding a separate runner — the ordering and stubs (e.g.
`getBoundingClientRect` overrides for drag-resize) are load-bearing for the
assertions.