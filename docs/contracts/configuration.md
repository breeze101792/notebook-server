# Configuration

## Overview

This server keeps notes and settings in two separate folders. `notebook/`
holds the Markdown notes. `config/` holds five settings files:
`config.json` (UI state), `auth.json` (passwords, session secret, API
tokens), `ai.json` (assistant provider profiles), `acp.json` (one
hand-edited ACP agent), and `workspaces.json` (the named workspace roots).
The split is deliberate: a client can POST the UI-prefs blob, and that blob
must never be able to carry credentials, choose a command to run
(`acp.json`), or point the server at an arbitrary folder
(`workspaces.json`).

The server stores `config.json` with no schema validation, except that a POST
folds legacy top-level content keys under `workspaceState.default` (see
[per-workspace state](#per-workspace-state)). The authoritative schema lives
in the frontend. `boot_state()` in `app.py` sanitizes a small subset for the
first page paint.

Related docs:

- [`http-api.md`](http-api.md) — the HTTP endpoint reference for the routes
  that read and write these files.
- [`../architecture/backend.md`](../architecture/backend.md) — import-time
  path resolution, seeding, and the auth layer.
- [`../architecture/frontend.md`](../architecture/frontend.md) — the modules
  that own the `config.json` schema and `localStorage` keys.
- [`../architecture/ai-assistant.md`](../architecture/ai-assistant.md) — the
  assistant that consumes `config/ai.json`.
- [`../../README.md`](../../README.md) — the user-facing overview.
- [`../../agent.md`](../../agent.md) — the machine-readable API guide served
  at `GET /agent.md`.

## Running the server

`start.sh` is the entry point. It resolves the project directory from its
own location, so it works from any working directory.

1. Creates `./.venv_$(hostname)` if that folder is missing
   (`start.sh`).
2. Installs `requirements.txt` when the file differs byte-for-byte from
   the `.venv_$(hostname)/.installed` stamp (`start.sh`).
3. `exec`s `app.py "$@"` and forwards every CLI argument (`start.sh`).

Flags and defaults:

| Command | Effect |
| --- | --- |
| `./start.sh` | Binds `0.0.0.0:5000`, debug off, reachable from the LAN |
| `./start.sh --host 127.0.0.1` | Binds loopback only |
| `./start.sh --port 8080` | Listens on port 8080 |
| `./start.sh --debug` | Flask debug and auto-reload (the startup banner prints twice) |
| `./start.sh --help` | Shows every `app.py` flag |

`app.py` accepts `-H/--host` (default `0.0.0.0`), `-p/--port` (default
5000), and `--debug` / `--no-debug` (`app.py`). On startup it
prints the notebook folder, the config folder, and one URL per reachable
address (`app.py`). Debug mode with a non-loopback host prints a
warning because Flask exposes the interactive debugger to the network
(`app.py`).

Python dependencies (`requirements.txt`): `Flask==3.0.3`, `bcrypt==5.0.0`,
and `agent-client-protocol==0.12.1` (the ACP SDK, used only by the ACP
provider).

## Environment variables

| Variable | Effect | Resolved at |
| --- | --- | --- |
| `NOTEBOOK_DATA_DIR` | Overrides the notes folder (default `<root>/notebook`), and with it the default workspace root | Import time, `app.py` |
| `NOTEBOOK_CONFIG_DIR` | Overrides the config folder (default `<root>/config`) | Import time, `app.py` |

These are read once when `app.py` is imported. The test suite points both
at a temp directory before importing the module (`tests/test_app.py`).

## First-run seeding

`seed()` (`app.py`) runs at import time (`app.py`) and does three
things in order:

1. Creates `config/config.json` as an empty object if it is missing
   (`app.py`).
2. Migrates a legacy `data/` directory to `notebook/` once. This only runs
   when the data folder is the project default, so a user-supplied
   `NOTEBOOK_DATA_DIR` is never touched (`app.py`).
3. Copies `notebook.template/` into `notebook/` on a fresh install. The
   template holds three files: `Welcome.md`, `README.md`, and `Syntax.md`
   (`app.py`). If the template folder is absent, the notebook is
   created empty instead.

The template is copied, not symlinked, so editing notes never touches it.

After `seed()`, import-time startup maintenance runs before the server accepts
requests: `_migrate_config_at_startup()` folds legacy config keys under
`workspaceState.default`, and `_persist_workspaces_if_changed()` rebuilds
`config/workspaces.json` when it is missing or stale. Both are best effort; a
failure leaves the previous file for the next launch.

## `config/config.json` — UI state

The server stores this file with no schema validation. `POST /api/config`
only checks that the body is a JSON object, then folds legacy top-level content
keys under `workspaceState.default`. Missing keys fall back to
`DEFAULTS` in `static/js/app.js`. The server embeds a validated subset
into the page shell for first paint.

### Theme and appearance

| Key | Values | Effect |
| --- | --- | --- |
| `theme` | `auto`, `light`, `dark` | Body theme; `auto` follows the system preference (`app.js`) |
| `fontSize` | `small`, `medium`, `large`, `xlarge` | Sets `--font-scale` to 0.9 / 1.0 / 1.15 / 1.3 (`app.py`) |
| `wallpaper` | `none`, `lines`, `grid` | Background pattern (`app.py`) |
| `wallpaperColor` | `neutral`, `blue`, `green`, `purple`, `amber` | Pattern stroke color; `neutral` follows the theme (`app.py`) |
| `wallpaperIntensity` | `subtle`, `medium`, `bold` | Pattern stroke alpha (`app.py`) |
| `wallpaperScroll` | `scroll`, `fixed` | Pattern scrolls with content, or stays fixed in the viewport (`app.py`) |
| `hideTopbar` | boolean | Hides the top bar; body gets `.topbar-hidden` (`app.js`) |
| `siteTitle` | string | Browser tab title and top-bar brand; defaults to `"Notebook"` (`app.js`) |
| `graphParticles` | boolean | Ambient particle drift in the graph view (`app.js`) |
| `settingsModalWidth` | `compact`, `medium`, `wide` | Sets `--settings-modal-width` (`app.js`) |
| `settingsModalHeight` | `compact`, `medium`, `wide` | Sets the settings modal height (`app.js`) |

### Layout

| Key | Default | Effect |
| --- | --- | --- |
| `sidebarWidth` | `240` | Side panel width in pixels (`app.js`) |
| `outlineWidth` | `220` | Outline pane width in pixels (`app.js`) |
| `sidebarCollapsed` | `false` | Collapses the side panel to width 0 (`app.js`) |
| `outlineCollapsed` | `false` | Collapses the outline pane to width 0 (`app.js`) |
| `activeView` | `explorer` | Active side-panel view: `explorer`, `sessions`, `pinned`, `bookmarks`, `recent`, `search`, or `ai`; any other value falls back to `explorer` (`app.js`, `_ACTIVE_VIEWS` in `app.py`) |

### Files and tabs

These keys follow the workspace root, not the whole app. On a workspace-aware
client they live under `workspaceState.<id>`; the top-level copies are the
pre-workspace format and the fallback for a page without a workspace.

| Key | Effect |
| --- | --- |
| `lastFile` | The file opened most recently (`app.js`, desktop); re-keyed on a rename/move |
| `recentFiles` | Array for the Quick open view (`app.js`); re-keyed on a rename/move |
| `openFiles` | **Mirror** of the active session's live strip, pinned tabs included; the full tab sets live in `sessions` (`app.js`) |
| `activeFile` | **Mirror** of the active session's selected tab (`app.js`) |
| `pinnedFiles` | Array of pinned tabs; workspace-global and shared by every session (`app.js`) |
| `sessions` | Named tab groups for this workspace, each with its own unpinned tabs and active tab (see [Sessions](#sessions)) |
| `activeSessionId` | The session whose tabs the strip is showing; always one of `sessions[].id` |
| `bookmarks` | Ordered array of bookmarked paths; missing files are pruned on tree refresh (`app.js`) |
| `pinnedFolders` | Pinned folder paths shown in the Pinned view |

### Per-workspace state

`config.json` may carry a `workspaceState` object keyed by workspace id:

```json
{
  "theme": "dark",
  "workspaceState": {
    "default": {
      "lastFile": "README.md",
      "sessions": [
        {"id": "main", "name": "Main", "openFiles": ["README.md"], "activeFile": "README.md"}
      ],
      "activeSessionId": "main",
      "pinnedFiles": ["Welcome.md"],
      "openFiles": ["Welcome.md", "README.md"],
      "activeFile": "README.md"
    },
    "work-1a2b": {"lastFile": "plan.md", "openFiles": ["plan.md"], "activeFile": "plan.md"}
  }
}
```

| Rule | Behavior |
| --- | --- |
| Scoped keys | `lastFile`, `openFiles`, `activeFile`, `pinnedFiles`, `sessions`, `activeSessionId`, `recentFiles`, `bookmarks`, `pinnedFolders`. Everything else is global and stays top-level. |
| Read overlay | The client loads `config.json`, then overlays `workspaceState.<active id>` on top of the top-level values. A missing field falls back to the top-level copy, so the first load after a migration shows the same session. |
| Write path | `POST /api/workspace-state` with `{id, state}` replaces that entry under `_CONFIG_LOCK` and preserves every other entry and unrelated key. `state` must be a JSON object and is capped at 256 KiB (`WORKSPACE_STATE_MAX_BYTES`). When the stored entry already has `sessions`, a body that omits `sessions`/`activeSessionId` keeps the stored values: a page loaded before this feature must not delete the other sessions. A current client always sends both. |
| Whole-blob POST | `POST /api/config` replaces the file, so the client merges a fresh read first and carries the whole `workspaceState` map through. The server also folds any stray top-level scoped keys under `workspaceState.default` on every POST. |
| Startup migration | `_migrate_config_at_startup()` moves legacy top-level scoped keys under `workspaceState.default` once per process start, under `_CONFIG_LOCK`. A blob that already has `workspaceState` is left alone. The migration is best effort and deliberately never runs from `GET /api/config`, so a read never writes a server-owned file. |
| Viewer and anonymous | `POST /api/workspace-state` requires workspace admin (admin, or a loopback peer while auth is off). A viewer or the unauthenticated shell reads the server copy and does not queue a write. |

### Sessions

A session is a named set of unpinned tabs with its own active tab. The
workspace's pinned tabs are shared: `pinnedFiles` sits outside `sessions` and
every session sees the same pins. The model and the algorithms are in
[`architecture/sessions.md`](../architecture/sessions.md).

```json
"sessions": [
  {"id": "main", "name": "Main",
   "openFiles": ["notes/a.md"], "activeFile": "notes/a.md"},
  {"id": "s-7f3a2c", "name": "Reading", "openFiles": [], "activeFile": null}
],
"activeSessionId": "main"
```

| Rule | Behavior |
| --- | --- |
| Invariant | A pinned path never appears in `sessions[].openFiles`; the pinned set is shared. An unpinned path may be open in **several** sessions — each occurrence is its own tab and they share one viewer buffer. |
| `openFiles` / `activeFile` | Mirrors of the active session, pins included. A reader that predates sessions (the ACP open-note hint, `app.py`) keeps working. |
| Limits | 20 sessions, 40 characters per name, 40 unpinned tabs per session; names are unique after trim and case-folding. |
| Migration | A workspace state with no `sessions` becomes one session `{id: "main", name: "Main"}` built from the existing `openFiles`/`activeFile`; that first boot keeps the `lastFile` fallback. |
| Empty session | `openFiles: []` is valid and is persisted; it is not the same as a missing entry. |
| Read-only | A viewer may switch sessions in memory; structural changes are not offered and nothing is written. |

`GET /api/info` reports the active root and id alongside the config folder:
`{data_dir, config_dir, workspace}`. `data_dir` is the active workspace root;
for the default it is the unresolved `DATA_DIR` string.

### Editing

| Key | Values | Effect |
| --- | --- | --- |
| `vimMode` | boolean | Enables the VIM keymap in the shell and in the editor (`app.js`) |
| `vimrc` | string | User VIM initial script applied to the editor's vim plugin (`app.js`) |
| `autosave` | boolean | Saves hybrid-mode edits after a typing pause; vim mode is unaffected. Off means a dirty tab switch stashes a recoverable draft instead of saving (`app.js`) |
| `watchEnabled` | boolean | Starts the external-change watcher on boot. The Settings toggle writes it; `false` disables the polling fallback after config arrives (`app.js`, `settings.js`). Defaults to on. |
| `shortcuts` | object | Per-action key bindings; missing actions fall back to `DEFAULTS` in `static/js/shortcuts.js` (`app.js`) |

### Search

| Key | Effect |
| --- | --- |
| `searchCaseSensitive` | Makes `/api/search` matching case-sensitive (`app.js`); used by the side-panel Search view |
| `searchUnique` | Side-panel Search shows one row per note (`unique=1`). Default `true`; a non-boolean hand-edited value falls back to `true` |
| `searchSort` | Side-panel Search order: `path`, `mtime`, or `count`. Default `path`; any other value falls back to `path` |

### First-paint subset

`boot_state()` (`app.py`) validates and embeds a small subset into the
HTML shell so the first frame already matches the saved settings. The
subset is: theme, site title, font scale, pane widths, pane collapse state,
topbar hidden, the active side-panel view, and the assembled wallpaper
classes (`app.py`).

The active view is embedded as `hidden` on every `.side-panel-view` host
except the active one (`_ACTIVE_VIEWS`, `app.py`), so the panel's first
frame is the saved view and never flashes the file tree. The value is
allowlisted, so a hand-edited id cannot inject markup.

The page is served before auth. Content-bearing keys (`recentFiles`,
`openFiles`, `bookmarks`) are deliberately excluded, because an
unauthenticated client must not receive them (`app.py`). Pane
widths are clamped to 140-2000 (`app.py`) and every choice field is
checked against an allowlist so a hand-edited file cannot inject markup.

The login screen gets only the theme (`app.py`). If auth is off, or a
session role is present, the shell gets the full first-paint subset
(`app.py`).

## `config/auth.json` — passwords and tokens

Auth lives in its own file so the UI-prefs blob can never include hashed
credentials. The schema is documented at `app.py`.

| Key | Meaning |
| --- | --- |
| `secret` | 32-byte hex session-signing key, generated on first start (`app.py`) |
| `admin_password_hash` | bcrypt hash of the admin password; may be absent |
| `viewer_password_hash` | bcrypt hash of the viewer password; may be absent |
| `tokens` | Array of `{name, role, id, hash, created}` for named bearer tokens |

All hashes use bcrypt with cost 12 (`app.py`, `app.py`,
`app.py`).

### Enabling and disabling auth

Auth is ON if and only if `admin_password_hash` exists (`app.py`).

Setting the admin password gates **all** reads and writes, not just writes.
The viewer password is a second login identity; it does not gate reads by
itself. The read gate (`read_login_required`, `app.py`) is satisfied by
either role or by a bearer token.

You can disable auth from inside the app. Open Settings, go to the Security
tab, select Passwords, enter the current admin password, and submit an
empty new admin password. This clears the admin hash, the viewer hash, and
all tokens (`app.py`). Clearing requires the current password
because it is destructive (`app.py`). Changing the admin password
to a non-empty value also requires the current password (`app.py`).

New passwords must be at least 6 characters (`app.py`, `app.py`).

### Recovery: hand-writing `config/auth.json`

When the UI is unavailable, write the file directly:

```bash
# Hash the admin password.
HASH=$(python -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_ADMIN_PW', bcrypt.gensalt(12)).decode())")
# Write the file. The server generates the session secret on first start.
python -c "
import json
open('config/auth.json', 'w').write(json.dumps({'admin_password_hash': '$HASH'}, indent=2))
"
# Restart the server.
```

To remove auth, delete `config/auth.json` and restart.

### API tokens

Tokens let agents and scripts skip the cookie login. Issue them from
Settings, Security, API tokens, or via `POST /api/auth/tokens`. The full
token string is shown once; only a bcrypt hash is stored (`app.py`).
A token is sent as `Authorization: Bearer nbtk_...`. A presented but
invalid token fails with 401 and shares the login rate limiter; it never
falls back to the session (`app.py`).

### Rate limit

Failed logins and invalid bearer tokens are rate-limited per client IP, keyed
on the TCP peer address (`request.remote_addr`): 5 failures in 60 seconds
trips 429 on the next attempt (`app.py`). A successful login clears
the counter (`app.py`). The store is in-process, so it resets on restart;
it is defeated by rotating source IPs or by clients behind one NAT sharing a
bucket.

### Transport

The server serves plain HTTP and sets no `ssl_context` (`app.py`).
Passwords and bearer tokens are transmitted in cleartext, so the login gate
protects against unauthorized use of the app, not against an observer on the
network. Bind to loopback (`./start.sh --host 127.0.0.1`) when the machine is
not on a trusted network.

## `config/workspaces.json` — workspace registry

The registry is server-owned and read on every request. It is written only by
the workspace routes and once at startup, always through `atomic_write()`. A
missing, corrupt, or non-object file degrades to the default workspace alone;
a changed file logs one warning instead of a line per request.

```json
{
  "version": 1,
  "items": [
    {"id": "default", "name": "Notebook", "path": "/home/you/notebook-server/notebook"},
    {"id": "work-1a2b", "name": "Work", "path": "/home/you/work-notes"}
  ]
}
```

| Field | Rules |
| --- | --- |
| `version` | `1` (`WORKSPACES_VERSION`). |
| `items` | At most 32 entries (`WORKSPACE_MAX_COUNT`), including the default. |
| `id` | Immutable, URL-safe slug plus 4 random hex characters (`work-1a2b`). `default` is reserved. Renaming keeps the id. |
| `name` | 1-60 characters, unique case-insensitively. The default entry can be renamed. |
| `path` | Absolute folder path. A newly registered path is stored as its resolved realpath, so a later symlink change cannot move the root out from under the path guards. |

Rules that follow from the code:

- The `default` entry is always present and always first. Its stored path is
  ignored and replaced with the current `DATA_DIR` (the `notebook/` folder, or
  `NOTEBOOK_DATA_DIR`), so a registry carried between installs never serves the
  old root. The default cannot be removed.
- A stored entry with a missing id, name, or path, or a relative path, is
  dropped when the file is read.
- The file is rewritten at startup when the stored list is not canonical
  (`_persist_workspaces_if_changed()`). `save_workspaces()` logs a write error
  and swallows it, so a route can report success even when the registry could
  not be persisted.
- If the cap is exceeded by a hand-edited file, the default plus the first 31
  valid entries are kept.

### Permissions and the loopback rule

| Operation | Auth on | Auth off |
| --- | --- | --- |
| List workspaces, switch the session workspace | any role, including viewer | open |
| Add, rename, remove | admin | loopback peer only, and no `X-Forwarded-For` / `X-Real-IP` |
| Write per-workspace UI state | admin | loopback peer only, and no `X-Forwarded-For` / `X-Real-IP` |

A reverse proxy on the same host connects from 127.0.0.1, so the peer address
alone cannot separate a LAN client from a local one. Any registry change that
carries a forwarding header is therefore treated as remote and refused with
`403 loopback_required`. With auth on, a viewer is refused with
`403 not_admin`. Logout clears `session["workspace"]` along with the role.

### Trust boundary

Registering a folder grants the server process read and write access to it
**as the user running the server**. `_workspace_path_problem()` excludes both
the install folder (`BASE_DIR`) and the config folder (`CONFIG_DIR`), and
`_paths_overlap()` refuses a candidate that is inside, contains, or equals
another workspace root; comparisons realpath and normcase both sides so a
symlink or a case-insensitive filesystem cannot dodge the check. None of that
makes the grant narrow: an admin credential is equivalent to filesystem access
as the server user. Enable authentication whenever the server is bound beyond
loopback, and bind loopback when you do not need remote access.

## `config/ai.json` — assistant providers

This file is separate from `config.json` so the client-posted blob can
never hold an API key. Stored keys are snake_case; the HTTP API uses
camelCase.

```json
{
  "servers": [
    {"name": "local", "base_url": "http://localhost:11434", "api_key": "...", "model": "llama3"}
  ],
  "default": "local",
  "custom_prompt": "",
  "searxng_url": ""
}
```

- `servers` is the provider profile list. `base_url` and `name` are
  required (`app.py`).
- `default` names the preselected profile.
- `custom_prompt` is a global assistant instruction, stored outside the
  server list (`app.py`).
- `searxng_url` is the optional SearXNG instance the search tool queries.
  When it is empty or unreachable, the tool falls back to a keyless Yahoo
  results page fetched by the server.

Secret handling: the stored `api_key` is never echoed to any client.
`GET /api/ai/config` returns `hasKey` (a boolean) instead (`app.py`).
To save a profile without re-typing its key, POST a blank `apiKey` with
`replaceSecret: true`; the server carries the stored key over, and
`replaceSecretFor` names which stored profile to take it from
(`app.py`). The key is stored in cleartext (it is not hashed like a
password), and it is attached to the upstream request sent to whatever
`base_url` the profile names, so protect the file's permissions and backups.

Base URLs are normalized on save: a trailing slash and a trailing `/v1`
are stripped. The chat endpoint appends `/v1/chat/completions`
(`app.py`, `app.py`).

## `config/acp.json` — ACP agent

A second provider kind, the Agent Client Protocol (ACP), is configured in
`config/acp.json` (`ACP_FILE`, `app.py`). The file holds a single
object; the feature is off when the file is missing or invalid.

This file is **hand-edited**. The server never writes it and no HTTP route
touches it, deliberately: a config blob that any authenticated client can POST
must never be able to choose a command to execute (`app.py`). Copy
`config/acp.json.example` and edit it:

```json
{
  "name": "opencode",
  "agent": "opencode",
  "cwd": "",
  "env": {},
  "default": false,
  "timeout": 900
}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | string | Picker label; shown as `<name> · ACP`. Required. |
| `agent` | string | Key in the server's known-agent table; the command line is resolved from it. Mutually exclusive with `command`. |
| `command` | string | Executable to spawn, argv[0] only, no shell. Required unless `agent` is set; the escape hatch for an agent the table does not know. |
| `args` | string[] | Arguments passed to `command`. Default `[]`. Used only with `command`. |
| `cwd` | string | Agent working directory; empty defaults to the notebook folder. |
| `env` | object | Extra environment variables (string to string). |
| `default` | boolean | `true` makes the ACP profile the startup pick. |
| `timeout` | number | Per-turn wall-clock cap in seconds; default 900. |

The known-agent keys are `opencode`, `claude`, `codex`, `gemini`, `goose`,
`cursor`, `qwen`, `kimi`, `cline`, `openhands`, `auggie`, `copilot`, and
`kiro` (`ACP_KNOWN_AGENTS`, `app.py`). The executable and argv for each
live in that server-side table, not in the file, so neither the file nor the
browser can supply a command for the common case. `agent` and `command` are
mutually exclusive: supplying both makes the file invalid. Provenance for each
command line is in
[`../research/acp-agent-commands.md`](../research/acp-agent-commands.md). One
fact there is unresolved: Gemini's dedicated ACP doc says `--acp` while the same
repo's CLI cheatsheet still lists `--experimental-acp`; the table uses
`--acp`.

`load_acp_config` (`app.py`) validates the whole object and **fails
closed to `{}`** — turning the feature off, never raising — on any violation:

- `name` must be a non-empty, non-whitespace string of at most 60 characters.
- `agent`, when set, must name a key in `ACP_KNOWN_AGENTS` and must not be
  combined with `command`. The selected agent's executable must also be present
  on `PATH`, or the file is treated as unconfigured (`{}`), so an uninstalled
  agent never yields a picker entry that always errors. The executable is
  located with `shutil.which` (`_acp_agent_command`, `app.py`), a
  read-only name lookup that runs nothing.
- `command`, when used instead of `agent`, must be a non-empty, non-whitespace
  string of at most 300 characters.
- `args` must be a list of at most 32 strings, each at most 1000 characters.
- `cwd` must be a string; `env` a map of string to string; `default` a
  boolean.
- `timeout`, when present, must be a finite positive number. `true`/`false`
  are rejected as a timeout, and `NaN`/`Infinity` are rejected.
- `name` must not equal the name of an `ai.json` profile. A collision would
  make a dead picker entry (`ai_chat` resolves the OpenAI profile first), so
  it also fails closed.

Because `command` is argv[0] with no shell, a wrapper executable belongs in
`command` and the agent in `args`; a single string such as
`"systemd-run --scope opencode acp"` silently fails. The file is re-read on
every request, so an edit takes effect on the next send with no restart.

Four fields reach the browser: `name`, the fixed label `"ACP"` as `model`, the
allowlist key `agent` (possibly `""` when the profile uses `command`), and
`default` (`_public_acp_config`, `app.py`). `command`, `args`, and `env`
stay server-side. The always-present `acpAgents` array in `GET /api/ai/config`
reports which known agents the host can launch, with an adapter hint when a
wrapper CLI is installed but its ACP adapter is missing (`_detect_acp_agents`,
`app.py`). The full trust boundary — the agent runs as the server user
with filesystem access and is not constrained by `safe_path` — is in
[`../architecture/ai-assistant.md`](../architecture/ai-assistant.md#acp-providers).

## Browser storage

The frontend uses `localStorage` only. There is no `sessionStorage` and no
IndexedDB.

| Key | Owner | Contents |
| --- | --- | --- |
| `nb:windowGeometry` | `static/js/windows.js` | Per-modal position and size for the floating windows |
| `nb:tableView` · `nb:<id>:tableView` | `static/js/table-view.js` | Versioned per-file, per-table view state (hidden rows/columns, sort), schema v2. Applies only when the header text, a hash of every cell, and the table's same-header ordinal all match; otherwise it is ignored. The default workspace keeps `nb:tableView`; other workspaces use `nb:<id>:tableView`. |
| `nb:aiChat` | `static/js/ai.js` | Versioned AI transcript (conversation + tool flags + newest prompt). **Clear** removes it. |
| `nb:mobileResume` · `nb:<id>:mobileResume` | `static/js/mobile.js` | Phone Home resume state: last path and scroll. The default workspace keeps the legacy key. |
| `nb:captureDraft` · `nb:<id>:captureDraft` | `static/js/mobile.js` | Quick-capture draft, kept across a 401. The default workspace keeps the legacy key. |

The default workspace deliberately keeps the pre-workspace key names so an
upgrade keeps its overlays, resume point, and draft, and a rollback that only
knows the legacy names stays clean. Every other workspace is namespaced.

### PWA cache

`static/manifest.json` declares the app name "Notebook",
`display: standalone`, and the icon set. `static/sw.js` is served at `/sw.js` (scope `/`) and caches the app shell
under the cache version `notebook-v23` (`CACHE` in `sw.js`). Bump that version whenever
a precached asset changes. The service worker strategy: non-GET requests pass through,
`/api/*` is network-only and returns a 503 JSON error when offline, and
everything else is network-first with a cache fallback. A navigation request
whose URL is not cached falls back to the precached `/`, so deep links reload
offline.
