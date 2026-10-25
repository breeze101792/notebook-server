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
node tests/browser/run_all.js     # every real-browser suite (auto-detects Chromium)
```

There is no lint step configured; the only test runners are `unittest` (backend) and
`node tests/dom/test_dom.js` (frontend).

## Optional: enabling password protection

By default the server is open. To put a two-password gate in front of the
API, open the Settings modal (⚙ button in the top bar) → **Passwords**:

- **Admin password** (required to enable auth): set this first. The
  next page load will require the password for *all* reads and writes.
- **Require a password to read** (optional): set a separate viewer
  password. This is a second, read-only login identity; it does not gate
  reads on its own (the admin password already does). When set, a
  visitor can sign in as a viewer (or admin) to read. The toggle clears
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
# 2. (optional) hash a viewer password; omit the key to leave it unset
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

**Backend — `app.py` (single file, ~2500 lines).** All routes are under `/api/*` and
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
`{"secret": "<hex>", "admin_password_hash": "<bcrypt>",
"viewer_password_hash": "<bcrypt>", "tokens": [...]}`. The `secret` is
generated on first start and used as Flask's session-signing key. Auth is "on"
iff the admin password hash exists; **setting the admin password gates all
reads and writes**, whether or not a viewer password is also set. The viewer
password is a second, read-only login identity, not the read switch. Three
decorators compose the layer: `@login_required` (401 if no valid role) gates
`/api/logout`; `@admin_required` (403 if role != "admin") gates the mutating
routes and all `/api/ai/*`; `@read_login_required` (401 if no valid role)
gates the read paths (`/api/tree`, `/api/ls`, `GET /api/file`,
`GET /api/config`, `/api/info`, `/api/search`, `/api/graph`). All three
bypass when auth is off. Sessions are Flask's signed/encrypted cookies; the
role is `session["role"]` ∈ `{"admin", "viewer"}`. A best-effort in-memory
rate limiter (5 failures / 60s per client IP) trips 429 on the 6th attempt.
Gated read responses carry `Cache-Control: no-store, private`.
**Named API tokens** let agents/scripts skip the cookie dance: issued via
admin-only `POST /api/auth/tokens` (`{name, role}`, full token shown once,
only a bcrypt hash stored), revoked via `DELETE /api/auth/tokens/<name>`,
and sent as `Authorization: Bearer nbtk_…`. A presented-but-invalid Bearer
fails hard with 401 (no fallback to the session) and shares the login rate
limiter; clearing the admin password also clears the viewer hash and all
tokens, disabling auth.
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

**ACP provider (second provider kind).** `config/acp.json` (own hand-edited
file, never written by any route) holds one `{name, agent, command, args, cwd,
env, default, timeout}` ACP agent profile; `agent` names a key in the
server-side `ACP_KNOWN_AGENTS` table, which resolves the command line (and is
mutually exclusive with `command`), so neither the file nor the browser ever
supplies a command for the common case. The server is the ACP *client*:
`acp_client.py` (Flask-free; one asyncio loop on a daemon thread) spawns one
agent process per turn, drives `initialize → session/new → prompt`,
auto-allows tool permission (`allow_once`), advertises no fs/terminal/
elicitation capability (those methods raise `method_not_found`), and yields
`agent_message_chunk` prose plus one trace event per `tool_call` the agent
starts. `GET /api/ai/config` exposes it under `acp`
as `{name, model: "ACP", agent, default}` or null, and reports per-agent host
availability in an always-present `acpAgents` array (a read-only `shutil.which`
PATH lookup, plus an adapter-install hint for Claude Code / Codex);
`loadAiConfig` appends one picker entry `<name> · ACP` and tags it
`acp: true`, and Settings → AI shows a read-only ACP row (never in the editable
provider list) that lists the detected agents' status read-only. An ACP-tagged provider
strips `image_url` parts client-side, narrows the attach input to `text/*`,
and the server rejects any image part with 400. `POST /api/ai/chat` serves it
when the posted `server` matches the `acp.json` name: messages go through the
same `_validate_chat_messages`, the system turn is dropped, and the rest
is flattened to one prompt capped at 8 MiB — same SSE envelope; text arrives as
OpenAI deltas, each started tool as a `data: {"acp":"trace"}` frame the panel
renders as a trace line. Because the system turn is dropped,
`_acp_context_preamble` rebuilds the agent's context server-side from
`config/config.json` (`activeFile`) and `config/ai.json` (`custom_prompt`), so
the custom prompt and open-note hint still reach the agent. `acp_client` is
imported lazily, so a missing SDK disables only ACP. The agent runs as the
server user with filesystem access; `safe_path` and the approval cards do not
apply.

**Frontend — vanilla JS, no build step.** `templates/index.html` loads vendored libs
then app modules in dependency order: `api.js → auth.js → cm-bridge.js →
lightbox.js → blocks.js → menu.js → mermaid.js → wavedrom.js → katex.js → viz.js →
htmlpreview.js → svg.js → copy-image.js → viewer.js → editbar.js → hybrid.js →
table-edit.js → list-edit.js → table-view.js → table-select.js → watcher.js →
outline.js → sidebar.js → search.js → graph.js → tabs.js → windows.js →
settings.js → export.js → mermaid-designer.js → designer-shell.js →
dot-designer.js → wavedrom-designer.js → vimnav.js → ai.js → activity.js →
bookmarks.js → shortcuts.js → mobile.js → app.js`.
Each is an IIFE that extends the shared `window.NB` namespace (e.g. `NB.tabs`,
`NB.viewer`, `NB.sidebar`, `NB.search`, `NB.outline`, `NB.api`, `NB.auth`,
`NB.blocks`, `NB.menu`).

**Context menus.** `menu.js` (`NB.menu`) is the one right-click menu renderer: a
singleton `#nb-menu` on `document.body`, descriptor-driven items
(`{label, handler, danger, disabled, title, kbd, submenu, separator}`), measured
four-edge positioning, one close dispatcher (outside click / outside-scope
right-click / Esc), and keyboard nav. `sidebar.js`, `bookmarks.js`, `tabs.js`,
and `hybrid.js` each build their own item list and call
`NB.menu.open({owner, x, y, scope, items, focusFirst})`; the edit-bar dropdowns
and table-view popovers are left-click widgets and stay custom.

The six code-block renderers (`mermaid.js`, `wavedrom.js`, `katex.js`,
`viz.js`, `htmlpreview.js`, `svg.js`) each register a descriptor with `blocks.js` at
load. `NB.blocks` owns the one authoritative renderer list and drives the
render pipeline (`renderAll`, called by `viewer.js` / `hybrid.js` /
`export.js`), the hybrid Save round-trip (`restoreForMarkdown`, replacing
each rendered container or error box with its fenced source so turndown
doesn't strip the SVG/HTML), and the hybrid click-to-edit type table
(`pluginTypes`). Each descriptor names a `marker` attribute/value pair the
rendered block carries (plus an optional `errorMarker` for its failure box);
plugin identity is keyed on that marker, not the class, so authored HTML that
merely reuses a renderer class stays raw HTML. Each renderer still owns its
own `renderOne` and lazy-load gate — the cores are genuinely different library
glue, so only the plumbing is shared. Adding a renderer means: add the module,
register it with its marker, add the `<script>` tag, and add its `sw.js`
PRECACHE entry; the registry-completeness test in `tests/dom/test_dom.js`
checks index.html / sw.js / the ai.js prompt / agent.md all mention it.

**Hybrid write-back contract.** A save that changes nothing writes nothing:
`isNoOpMarkdown` compares the serialized DOM against the form captured at
`enter()` and skips `POST /api/file` in every save caller (`save`, `onClose`,
`commitForTabSwitch`, `flushAutosave`, `exit`). Empty headings and
empty list items keep their markers; whitespace-only inline code runs are
carried through a clone with sentinels (a NUL-prefixed token for code spaces,
because a private-use char occurs in real notes). Tables are always emitted as
GFM: `normalizeTablesForGfm` rebuilds every table in the clone into the shape
Turndown's GFM rule accepts (an all-`<th>` first row in a leading `<thead>`),
never as raw `<table>`. See `docs/architecture/markdown.md` for the full contract.

**Agent-facing docs are part of the renderer contract.** The fence
languages are documented for two audiences that must stay in sync with the
code: the built-in assistant's system prompt in `static/js/ai.js`, and the
`/agent.md` guide served to external agents. Whenever you change a
renderer's fence name, its vendored library version (e.g. Mermaid 11.16,
WaveDrom 3.3, KaTeX 0.16, Graphviz 2.40.1 / Viz.js 2.1.2), or its
constraints (version-specific syntax, mermaid's `securityLevel:strict`,
and — always — the `html-live` sandbox limits: `allow-scripts` without
`allow-same-origin`, opaque origin, blocked cookies / storage / parent
DOM / `/api/*` / popups / navigation), update **both** `ai.js` and
`agent.md` in the same change. Tests in `tests/dom/test_dom.js` and
`tests/test_app.py` assert the versions and restrictions appear in both,
so a drift fails the suite. Bump the vendored bundle and these docs
together; never update one without the other.
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
  content/edit cache, the edit/view toggle, and the stashed-draft Recover/Discard
  bar. A dirty tab switch stores the buffer on the cache entry; returning shows
  the saved preview plus a Recover bar (source recovery is Ctrl+Z undoable). Notebooks are the user's own files in
  `notebook/`, so they are rendered **un-sanitized**; if untrusted content is ever
  introduced, add vendored DOMPurify and sanitize before `innerHTML`.
- `tabs.js` — top-bar file tabs; owns the ordered open set + active file, coordinates
  with `viewer.js` (a dirty switch stashes the buffer instead of prompting; the
  cache keeps it and the tab stays marked), and persists `openFiles`/`activeFile`
  to config.
- `sidebar.js` — left file tree, and the tree/folder/root menu item sets rendered
  through `NB.menu` (open, new file/folder, rename/move, copy, delete, Export…,
  copy path/link, Add/Remove bookmark). The Explorer header's ↻ button re-fetches
  `/api/tree` on demand, bypassing the watcher's JSON-diff short-circuit, with a
  one-shot spin animation. Bookmark state itself lives in `bookmarks.js`; the
  tree's inline ⭐ reads `NB.bookmarks.has()` and toggles through
  `NB.bookmarks.toggle()`, keeping `setBookmarks`/`getBookmarks`/`toggleBookmark`
  as thin delegations for `app.js` and `tabs.js`. It also owns the pinned-folders
  state: a "Pinned" section above the tree (`#pinned-folders`) lists pinned
  folders, each of which expands in place to show its subtree (click the row or a
  child folder to expand/collapse) independently of the main tree; click a file
  inside to open it. A pin row's right-click menu groups the pin actions at the
  top (Expand/Collapse, Collapse all pinned folders, Unpin folder), then the
  same folder menu the tree shows; "Collapse all pinned folders" is also on the
  empty Pinned area's menu. Persisted as `pinnedFolders`.
- `bookmarks.js` — the Bookmarks side-panel view (`NB.bookmarks`, 🔖 in the
  activity bar; host `#bookmarks-view`, built at load and kept in the DOM so list
  state survives view switches). Owns the ordered list of pinned file paths, the
  list rendering, the ★ add button, drag-to-reorder, the bookmark context menu
  (Open | Organize | View | Terminal, rendered through `NB.menu` with scope
  `#bookmarks-view`; its "Show in file sidebar" reveals the file in the tree),
  the auto-prune when a file vanishes from the tree, and the rename re-key. It
  fires `bookmarks:changed` after a toggle so `sidebar.js` updates the tree's
  star.
  Replaced the old bookmarks section that used to sit above the file tree.
- `outline.js` — right-side heading TOC minimap, scroll-spy highlight, click-to-jump.
- `table-view.js` — preview-only table view controls: hover/focus toolbar over a
  GFM table with hide-rows, hide-columns, and a single-column sort, kept per file
  per table in `localStorage` (`nb:tableView`, schema v2; an entry applies only
  when the header text, a hash of every cell, and the table's same-header ordinal
  all match, so a shifted table is ignored, never hijacked). Hiding is class-based only; sorting physically moves
  `<tr>` nodes, so `hybrid:will-enter` is the last synchronous moment — the module
  tears down view state there (restores source order, strips
  `nb-tv-hide-row`/`nb-tv-hide-col`/`tabindex`/`aria-sort`) before contenteditable
  and the undo snapshot. Live preview (`viewer:rendered` with `live:true`) drops
  sessions and never rebuilds, so the textarea stays the source of truth. No view
  state ever reaches the note, the server, or an export.
- `table-select.js` — rectangular cell selection for rendered tables, in preview
  and hybrid edit through one engine. Ctrl+drag (Cmd on macOS) over a table paints
  an inclusive cell rectangle (`nb-ts-range`); Ctrl+C copies it as TSV
  (`text/plain`) plus an HTML `<table>` (`text/html`). The arming mousedown is
  `preventDefault`ed so no native selection/DnD starts; the classes are transient
  gesture chrome, stripped by `hybrid.js` in `prepareTurndownClone`, before every
  undo snapshot, and from the change hash, so they never reach the note or an
  export. Merged-cell tables and the live preview never arm.
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
    panel header resets the conversation. The transcript survives a reload:
    `persistHistory()` writes a versioned `localStorage["nb:aiChat"]` blob
    (conversation + a parallel `toolFlags` array for the tool-message
    WeakSet + the newest prompt) after every mutation, and `restoreHistory()`
    rebuilds it on mount; an over-size blob drops image data URLs to a text
    placeholder rather than exhausting the quota, and Clear removes the key.
  - Legacy ` ```nb-edit ` single-op blocks still render as patch cards (they
    target the current file when no path is given); patch tools are previewed
    client-side via `previewPatch()` (literal find_replace/append/prepend
    simulation) and applied through `/api/edit`, so the server re-checks every
    anchor against the CURRENT file — stale/ambiguous finds fail closed with
    400 and the card turns errored. Applying emits `NB.evt("ai:applied",
    {path, data})`; `viewer.js` listens and refreshes its cache (self-save
    noted to the watcher, no confirm prompt) without closing an open edit
    session — source edit reloads CM6 and WYSIWYG re-renders in place, so
    the edit bar stays up. The tool contract is introduced in
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
- `export.js` — Export modal (opened via **Export…** in the file-tree,
  bookmark, and tab right-click menus, each targeting that specific file).
  Exports a note to **PDF** or a self-contained **HTML** file.
  Purely client-side: `renderInto()` re-renders the note from the
  viewer's content cache through the same pipeline the app uses (marked +
  highlight.js + the mermaid/wavedrom/katex/viz/svg renderers), so the output
  always matches the on-screen rendering. **PDF** paginates the note with
  the vendored Paged.js polyfill: `buildExportDoc` builds the same
  standalone document the Preview uses and loads it into a hidden
  same-origin `#pdf-print-frame` iframe, waits for the inline
  `PagedConfig.after` hook to flip `window.__nbPagedRendered` once every
  A4 page sheet is laid out, then moves the finished `.pagedjs_pages`
  sheets (and Paged.js's injected styles, cloned with `media="print"`)
  into a `#pdf-print-root` container on the current page and calls
  `window.print()` — no preview tab opens. The container is hidden on
  screen and, under `@media print`, replaces every other body child, so
  only the paginated note prints; `afterprint` removes it. The saved PDF
  is paginated exactly like the Preview. Printing the current top-level
  page is required because Firefox can render a paginated subframe and
  show its print preview, but saving that subframe to PDF produces no file
  — only a top-level document saves reliably. Completion must come from
  the hook, never from a page-count guess.
  **HTML** builds a standalone
  `.html` file with the rendered note + embedded styles (the app's
  markdown rules + the light highlight.js theme) and downloads it via a
  Blob. **Scope** is "current file" (the whole note) or "section": the
  modal lists the note's `h1`–`h3` headings (`extractHeadings`) in a
  dropdown and `sliceSection` slices the source from the chosen heading
  up to the next heading of the same or higher level, so only that
  section is exported.

**Mobile shell (v1: read + capture).** `static/js/mobile.js` adds a phone
layout on top of the same app: one CSS media query
(`max-width: 860px` or `(pointer: coarse) and (max-width: 1023px)`) sets
`--ui-mode: phone`, and JS reads that token (mirrored to
`html[data-ui-mode]`) rather than repeating the query. The four-column grid
becomes a reader column with a fixed bottom activity rail; `#side-panel`
becomes an off-canvas drawer (`body.drawer-open`) and the tab strip, outline,
`#brand`, `.search-wrap` and `#edit-toggle` are hidden, never removed. Phone
mode zeroes the desktop body padding and gives each edge layer its own
safe-area inset (`--topbar-h` includes the top inset; the rail includes the
bottom), so the shell is edge-to-edge.
Browser history is the single navigator: boot seeds `nbHome`/`nbFile`, each
open pushes a note entry, Home replaces it with `{nbHome:true}`, and both the
back button and Android back go through `history.back()` → `popstate`; the
viewer's own `popstate` handler is gated off in phone mode. Phone config
writes are keyed read-merge-writes (never `openFiles`/`activeFile`/`lastFile`/
`sidebarCollapsed`), so a phone cannot clobber the desktop. Continue/scroll
live in `localStorage["nb:mobileResume"]`; quick capture appends one block to
`Inbox.md` via `/api/file/append {create:true}` and keeps
`localStorage["nb:captureDraft"]` across a 401. Editing, tabs, TOC, AI, export,
offline and PWA install are out of v1 (plain HTTP is not a secure context).
The Home Screen icon is `static/icons/apple-touch-icon-v2.png`; the root
`/apple-touch-icon.png` and `/apple-touch-icon-precomposed.png` routes serve it
because iOS probes those paths, and the SPA catch-all used to answer with HTML.
Docs: `docs/architecture/mobile.md`, `docs/design/mobile-shell.md`,
`docs/product/mobile.md`.

**Config (`config/config.json`).** Frontend state persisted by the app: `theme`,
`fontSize`, `lastFile`, `recentFiles`, `openFiles`, `activeFile`, `activeView`,
`sidebarWidth`, `outlineWidth`, `sidebarCollapsed`, `outlineCollapsed`,
`searchCaseSensitive`, `pinnedFolders`.
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