# Configuration

## Overview

This server keeps notes and settings in two separate folders. `notebook/`
holds the Markdown notes. `config/` holds six settings files:
`config.json` (UI preferences), `state.json` (the workspace tab and session
state), `server.json` (host, port, debug; optional), `auth.json` (passwords,
session secret, API tokens), `ai.json` (assistant provider profiles,
including the ACP profiles), and `workspaces.json` (the named workspace
roots). The split is deliberate: a client can POST the UI-prefs blob, and
that blob must never be able to carry credentials, choose a command to run
(a POSTed ACP entry can only name an allowlisted agent), or point the server
at an arbitrary folder (`workspaces.json`).

The server stores `config.json` with no schema validation. It holds
preferences only: the per-workspace state lives in `config/state.json`, only
`/api/workspace-state` writes it, and `POST /api/config` strips its keys from
the body (see [`config/state.json`](#configstatejson--workspace-state)). The
authoritative schema lives in the frontend. `boot_state()` in `app.py`
sanitizes a small subset for the first page paint.

Related docs:

- [`config-guidelines.md`](config-guidelines.md) — the rulebook for choosing a
  file, naming, validation, locks, secrets and migrations.
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
| `./start.sh` | Uses `config/server.json`, else binds `0.0.0.0:5000` with debug off, reachable from the LAN |
| `./start.sh --host 127.0.0.1` | Binds loopback only |
| `./start.sh --port 8080` | Listens on port 8080 |
| `./start.sh --debug` | Flask debug and auto-reload (the startup banner prints twice) |
| `./start.sh --help` | Shows every `app.py` flag |

`app.py` accepts `-H/--host`, `-p/--port`, and `--debug` / `--no-debug`
(`app.py`). Every flag defaults to "unset", not to a value, so the file can
supply the missing ones and `--no-debug` can beat a `"debug": true` in
`config/server.json`. Precedence is the flag, then `config/server.json`, then
the built-in default `0.0.0.0:5000` with debug off. On startup it prints the
notebook folder, the config folder, and one URL per reachable address
(`app.py`). Debug mode with a non-loopback host prints a warning because Flask
exposes the interactive debugger to the network; the banner and that warning
are printed from the resolved values, so a value taken from the file is warned
about exactly like a flag (`app.py`).

Python dependencies (`requirements.txt`): `Flask==3.0.3`, `bcrypt==5.0.0`,
and `agent-client-protocol==0.12.1` (the ACP SDK, used only by the ACP
provider).

## `config/server.json` — startup values

An optional file that records the bind address, port, and debug flag, so the
port is set once instead of passed on every launch. It is **never seeded**: a
missing file simply means the built-in defaults. A copyable example with every
key documented inside the file is
[`config.template/server.json.example`](../../config.template/server.json.example).

```json
{"host": "0.0.0.0", "port": 5000, "debug": false}
```

| Key | Type | Rule |
| --- | --- | --- |
| `host` | string | Non-empty; surrounding whitespace is trimmed. |
| `port` | integer | 1-65535 (`SERVER_PORT_MIN` / `SERVER_PORT_MAX`); the `--port` flag is checked against the same range. A boolean is rejected, even though `True` is an `int` in Python. |
| `debug` | boolean | `true` or `false` only. |

Any key may be omitted, and an absent key keeps its built-in default. Unknown
keys are ignored (`load_server_config`, `app.py`).

A malformed file, or an out-of-range value, stops startup: the process prints
`Cannot start: <path>: <reason>` on stderr and exits 2, because the fallback
would bind `0.0.0.0` and the file is the only record of what the user meant
(`app.py`). The resolved triple comes from `resolve_startup(args, stored)`
(`app.py`).

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

`seed()` creates only `config/config.json`. `config/state.json` and
`config/server.json` are never seeded: the state file appears on the first
accepted workspace-state write (or the first startup split), and a missing
server file means the built-in startup defaults.

After `seed()`, import-time startup maintenance runs before the server accepts
requests, in this order (`app.py`):

1. `_migrate_config_at_startup()` folds legacy top-level config keys under
   `workspaceState.default`.
2. `_quarantine_bad_state_file()` renames a corrupt, wrongly shaped, or
   future-version `config/state.json` to `state.json.corrupt-<epoch>`.
3. `_migrate_state_out_of_config()` moves the state maps out of `config.json`
   into `config/state.json`.
4. `_migrate_acp_file()` folds a legacy `config/acp.json` into
   `config/ai.json`.
5. `_persist_workspaces_if_changed()` rebuilds `config/workspaces.json` when
   it is missing or stale.

Each step is best effort; a failure leaves the previous file for the next
launch. Reads stay pure: only startup and the mutating routes write these
files.

## `config/config.json` — UI preferences

The server stores this file with no schema validation. `POST /api/config`
only checks that the body is a JSON object, strips the server-owned state keys
and every workspace-scoped content key, and writes the rest. Missing keys fall
back to `DEFAULTS` in `static/js/app.js`. The server embeds a validated subset
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
| `sidebarWidth` | `240` | Left side-panel width in pixels (`app.js`) |
| `sidebarCollapsed` | `false` | Collapses the left side panel to width 0 (`app.js`) |
| `auxPanelWidth` | `240` | Right side-panel width in pixels (`app.js`). Falls back to `outlineWidth`; see the migration note below |
| `auxPanelCollapsed` | `false` | Collapses the right side panel to width 0 (`app.js`). Falls back to `outlineCollapsed` |
| `sidebarSide` | `{}` | Which rail hosts each view: object of view id → `"left"` or `"right"`. A view with no entry uses its registration default — `right` for `outline`, `left` for every other view. Unknown ids and other values are dropped (`app.py`) |
| `activeViewLeft` | `explorer` | The left panel's active view: `explorer`, `sessions`, `pinned`, `bookmarks`, `recent`, `search`, `tabs`, or `ai`; any other value, a view homed right, or a hidden view falls back to the first visible left view (`app.js`, `_ACTIVE_VIEWS` in `app.py`) |
| `activeViewRight` | `outline` | The right panel's active view, validated the same way against the views homed right |
| `activeView` | `explorer` | **Legacy.** Read once as the `activeViewLeft` fallback when that key is absent (`app.py`, `app.js`) |
| `outlineWidth` | — | **Legacy.** Read once as the `auxPanelWidth` fallback |
| `outlineCollapsed` | — | **Legacy.** Read once as the `auxPanelCollapsed` fallback |
| `sidebarOrder` | `[]` | Activity-bar icon order across **both** rails: array of view ids; unknown ids are dropped and unnamed views keep registration order. Each rail renders the subsequence it owns. Embedded in the shell for first paint (`app.js`, `app.py`) |
| `sidebarHidden` | `[]` | Activity-bar views whose icons are hidden: array of view ids; unknown ids are dropped. Settings lists every view so a hidden one can be unhidden. A hidden view keeps its side. Embedded in the shell for first paint (`app.js`, `app.py`) |
| `explorerTopHeight` | — (auto) | Height in pixels of the Explorer's inline top section (Pinned or Bookmarks), written when the user drags its splitter. Absent means content height capped at 30 vh. `Enter` or double-click deletes it and fits the section to all its rows for the session. Global; embedded in the shell for first paint when present (`app.js`, `app.py`) |

The migration is one release long: `activeView`, `outlineWidth` and `outlineCollapsed` are read only
when their replacements are absent, and the client deletes them from the blob after a successful
load so the next desktop save rewrites the file without them. The design is
[`ui/secondary-sidebar.md`](../ui/secondary-sidebar.md) §6.

### Files and tabs

These keys follow the workspace root, not the whole app. They live in
`config/state.json` under `states.<workspace id>`; a top-level copy in
`config.json` is the pre-workspace format and is folded into the default
workspace once at startup.

| Key | Effect |
| --- | --- |
| `lastFile` | The file opened most recently (`app.js`, desktop); re-keyed on a rename/move |
| `recentFiles` | Array for the Quick open view (`app.js`); re-keyed on a rename/move |
| `openFiles` | **Mirror** of the active session's live strip, pinned tabs included; written as a hint and never applied by a poll, because the active strip is device-local (`app.js`) |
| `activeFile` | **Mirror** of the active session's selected tab; written as the ACP preamble hint and never applied by a poll (`app.js`) |
| `pinnedFiles` | Array of pinned tabs; workspace-global and shared by every session (`app.js`) |
| `sessions` | Named tab groups for this workspace, each with its own unpinned tabs and active tab (see [Sessions](#sessions)) |
| `activeSessionId` | The session this device last had on screen; a fallback for a page with no device-local value, never applied by a poll |
| `bookmarks` | Ordered array of bookmarked paths; missing files are pruned on tree refresh (`app.js`) |
| `pinnedFolders` | Pinned folder paths shown in the Pinned view |

`GET /api/info` reports the active root and id alongside the config folder:
`{data_dir, config_dir, workspace}`. `data_dir` is the active workspace root;
for the default it is the unresolved `DATA_DIR` string.

### Editing

| Key | Values | Effect |
| --- | --- | --- |
| `vimMode` | boolean | Enables the VIM keymap in the shell and in the editor (`app.js`) |
| `vimrc` | string | User VIM initial script applied to the editor's vim plugin (`app.js`) |
| `autosave` | boolean | Saves hybrid-mode edits after a typing pause; vim mode is unaffected. Off means a dirty tab switch stashes a recoverable draft instead of saving (`app.js`) |
| `spellcheck` | boolean | The app's en_US spellcheck in hybrid mode: the misspelling underline and the right-click Spelling block. Off also keeps the browser's own spellcheck off on the editing surface, because the app owns the feature. Default `true`. Designed, not yet shipped: [`../architecture/spellcheck.md`](../architecture/spellcheck.md) |
| `spellcheckWords` | array of strings | Personal words the user added from the Spelling block. Lower-cased, deduped, at most 64 characters each, capped at 1,000 (oldest dropped) on read and on write (`app.js`). Designed, not yet shipped |
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
topbar hidden, the active side-panel view, the activity-bar icon order, the
hidden activity-bar views, the Explorer top-section split height, and the
assembled wallpaper classes (`app.py`).

The active view is embedded as `hidden` on every `.side-panel-view` host
except the active one (`_ACTIVE_VIEWS`, `app.py`), so the panel's first
frame is the saved view and never flashes the file tree. The value is
allowlisted, so a hand-edited id cannot inject markup. The icon order and
hidden list are embedded as `data-sidebar-order` and `data-sidebar-hidden`
on `#activity-bar`, filtered against the same view-id allowlist.

The page is served before auth. Content-bearing keys (`recentFiles`,
`openFiles`, `bookmarks`) are deliberately excluded, because an
unauthenticated client must not receive them (`app.py`). Pane
widths are clamped to 140-2000 and the Explorer split height to 56-2000 (`app.py`) and every choice
field is checked against an allowlist so a hand-edited file cannot inject markup.

The login screen gets only the theme (`app.py`). If auth is off, or a
session role is present, the shell gets the full first-paint subset
(`app.py`).

## `config/state.json` — workspace state

The per-workspace UI state is server-owned and lives in its own file:

```json
{
  "version": 1,
  "states": {
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
  },
  "revs": { "default": 7, "work-1a2b": 2 }
}
```

`version` is `1` (`STATE_VERSION`, `app.py`). `states` and `revs` are maps
keyed by workspace id.

| Rule | Behavior |
| --- | --- |
| Scoped keys | `lastFile`, `openFiles`, `activeFile`, `pinnedFiles`, `sessions`, `activeSessionId`, `recentFiles`, `bookmarks`, `pinnedFolders`. Everything else is a global preference and stays in `config.json`. |
| Boot read | `GET /api/config` reads `config.json`, then splices `states` and `revs` in as `workspaceState` and `workspaceStateRev`, always as JSON objects (`{}` when nothing is saved). The page boots from one response and the client contract is unchanged. A GET never writes. |
| Write path | `POST /api/workspace-state` with `{id, state, base}` replaces that entry under `_STATE_LOCK` and preserves every other entry. `state` and `base` must be JSON objects; `state` is capped at 256 KiB (`WORKSPACE_STATE_MAX_BYTES`). When `base` equals the stored entry the state is stored verbatim; when it differs the server merges per session (a session the client did not change keeps the server's copy) and returns the merged state. The route answers `{ok, id, rev, state}`. A missing `base` is **400** `bad_body` and a `base` over the cap is **400** `base_too_large`; there is no conflict status. The file is read strictly: an unreadable, unparseable, wrongly shaped, or future-version `state.json` answers **500** `write_failed` (`Could not write workspace state: …`) and writes nothing. |
| Rev map | `revs` is a sibling map of non-negative integers, one per state entry, bumped on every accepted write. The server owns it; a client-supplied copy is discarded. Missing reads as `0`. It is the conditional for `GET /api/workspace-state?id=…&rev=…` (304 when equal). It is not a write precondition: the write merges. |
| Whole-blob POST | `POST /api/config` writes preferences only. It strips `workspaceState`, `workspaceStateRev` and every scoped key from the body and never opens `state.json`. It still reads the stored preferences first and refuses with **500** `write_failed` when that file cannot be parsed. |
| Single writer | Only `/api/workspace-state` writes a workspace's state; `DELETE /api/workspaces/<id>` removes that workspace's state and rev in the same file write. Any other write path is a defect. |
| Startup split | `_migrate_state_out_of_config()` moves `workspaceState` and `workspaceStateRev` out of `config.json` once per process start, after the legacy fold. Per workspace the copy with the higher revision wins, so a rollback build or a restored backup written into `config.json` is not discarded. `state.json` is written first and `config.json` stripped second; a crash in between is harmless and the next launch finishes the job. Idempotent, and it never runs from a GET. |
| Quarantine | A corrupt, wrongly shaped, or future-version `state.json` is renamed at startup to `state.json.corrupt-<epoch>`. The file is preserved, not deleted, and the server starts with empty state. If the rename is impossible (permissions), state writes answer **500** `write_failed` and GETs answer empty state. |
| Viewer and anonymous | `POST /api/workspace-state` requires workspace admin (admin, or a loopback peer while auth is off). A viewer or the unauthenticated shell reads the server copy, polls it for live updates, and does not queue a write. |
| Client sync | An open page polls `GET /api/workspace-state` every 3 s, paused while hidden, and applies the shared half of the state. The active session and active tab are device-local (`localStorage`). See [`architecture/sessions.md`](../architecture/sessions.md) §17. |

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
camelCase. A copyable example that documents every key, including the
hand-only `env`/`args`/`cwd`/`timeout` fields, is
[`config.template/ai.json.example`](../../config.template/ai.json.example).

```json
{
  "servers": [
    {"name": "local", "base_url": "http://localhost:11434", "api_key": "...", "model": "llama3"}
  ],
  "acp": [
    {"name": "opencode", "agent": "opencode", "model": "ollama/qwen3.8:latest",
     "cwd": "", "default": true, "timeout": 900}
  ],
  "default": "local",
  "custom_prompt": "",
  "searxng_url": ""
}
```

- `servers` is the provider profile list. `base_url` and `name` are
  required (`app.py`).
- `acp` is the ACP profile list, in the schema the old `config/acp.json`
  used (`name`, `agent` or `command`, `args`, `cwd`, `env`, `model`,
  `default`, `timeout`). See [ACP profiles in `ai.json`](#acp-profiles-in-aijson).
- `default` names the preselected profile. It may name a saved server or an
  ACP profile, so "Make default" in Settings → AI always takes effect.
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

## ACP profiles in `ai.json`

A second provider kind, the Agent Client Protocol (ACP), is configured in the
`acp` list of `config/ai.json`, next to the OpenAI-compatible servers. The
feature is off when no valid profile remains. Several ACP profiles may coexist,
and any of them may be the default.

An entry has the shape the old `config/acp.json` used:

```json
{"acp": [
  {"name": "opencode", "agent": "opencode",
   "model": "ollama/qwen3.8:latest", "cwd": "", "env": {},
   "default": true, "timeout": 900},
  {"name": "local-agent", "command": "/usr/local/bin/my-agent",
   "args": ["--acp"]}
]}
```

| Key | Type | Meaning |
| --- | --- | --- |
| `name` | string | Picker label; shown as `<name> · <model>`. Required; a duplicate keeps the first entry. |
| `agent` | string | Key in the server's known-agent table; the command line is resolved from it. Mutually exclusive with `command`. |
| `command` | string | Executable to spawn, argv[0] only, no shell. Required unless `agent` is set; the escape hatch for an agent the table does not know. |
| `args` | string[] | Arguments passed to `command`. Default `[]`. Used only with `command`. |
| `cwd` | string | Agent working directory; empty defaults to the active workspace root. |
| `env` | object | Environment variables overlaid on the server's own environment (string to string). The profile wins on a key collision. |
| `model` | string | Optional agent model id, at most 200 characters, applied after the session is created. Empty shows the label `ACP`. |
| `default` | boolean | `true` nominates the profile as the fallback default when `ai.json` names none. |
| `timeout` | number | Per-turn wall-clock cap in seconds; default 900. |

The known-agent keys are `opencode`, `claude`, `codex`, `gemini`, `goose`,
`cursor`, `qwen`, `kimi`, `cline`, `openhands`, `auggie`, `copilot`, and
`kiro` (`ACP_KNOWN_AGENTS`, `app.py`). The executable and argv for each
live in that server-side table, so a POSTed body can never supply a command:
the browser may only name a key. A hand-edited file may still carry
`command` + `args` for an agent the table does not know; that entry is
file-owned and cannot be edited or named from the browser. `agent` and
`command` are
mutually exclusive: supplying both drops that entry. Provenance for each
command line is in
[`../research/acp-agent-commands.md`](../research/acp-agent-commands.md). One
fact there is unresolved: Gemini's dedicated ACP doc says `--acp` while the same
repo's CLI cheatsheet still lists `--experimental-acp`; the table uses
`--acp`.

The raw entry is what is stored. A profile whose `agent` is allowlisted is
resolved to an absolute command when it is read; loader output is never written
back, so the stored entry stays in raw form and an agent whose executable is
missing right now keeps its profile in the file.

`load_acp_configs` (`app.py`) validates each entry on its own and returns the
valid profiles; `load_acp_config` is a compatibility wrapper returning the first
profile or `{}`. It never raises: a missing, unreadable, or malformed `ai.json`
yields `[]`. An invalid entry is dropped individually, so one typo cannot
disable the other profiles. Duplicate names keep the first entry, and an entry
whose name equals an `ai.json` server name is dropped so the API profile keeps
it (such a name would be a dead picker entry, because `ai_chat` resolves the
OpenAI profile first). Per-entry rules:

- `name` must be a non-empty, non-whitespace string of at most 60 characters.
- `agent`, when set, must name a key in `ACP_KNOWN_AGENTS` and must not be
  combined with `command`. The selected agent's executable must also be present
  on `PATH`, or the entry is dropped, so an uninstalled agent never yields a
  picker entry that always errors. The executable is located with
  `shutil.which` (`_acp_agent_command`, `app.py`), a read-only name lookup that
  runs nothing.
- `command`, when used instead of `agent`, must be a non-empty, non-whitespace
  string of at most 300 characters.
- `args` must be a list of at most 32 strings, each at most 1000 characters.
- `cwd` must be a string; `env` a map of string to string; `default` a
  boolean.
- `model`, when present, must be a string of at most 200 characters
  (`ACP_MAX_MODEL_LEN`, `app.py`).
- `timeout`, when present, must be a finite positive number. `true`/`false`
  are rejected as a timeout, and `NaN`/`Infinity` are rejected.

**Environment inheritance.** The agent inherits the server's full environment,
with the profile's `env` overlaid (the profile wins). The SDK's spawn transport
previously trimmed the child environment to `HOME`, `LOGNAME`, `PATH`, `SHELL`,
`TERM`, and `USER`, which silently dropped agent credentials and XDG paths;
`acp_client.run_turn` now merges the full environment before spawning
(`acp_client.py`).

**Model negotiation.** A profile's `model` is applied after `session/new`
through the session's model config option -- the option whose `category` is
`"model"`, else the option with id `"model"` -- with
`session/set_config_option` (`_model_option`, `_drive`, `acp_client.py`). If the
agent exposes no model option the turn ends with the in-band error `"ACP agent
does not expose a model option"`; if the agent rejects the value it ends with
`"ACP agent rejected the configured model"`. If the agent acknowledges the call
but reports a different current model, the turn ends with
`"ACP agent did not apply the configured model"`. The agent chooses its own model
ids: verified against `opencode acp`, whose values look like
`ollama/qwen3.8:latest`.

Because `command` is argv[0] with no shell, a wrapper executable belongs in
`command` and the agent in `args`; a single string such as
`"systemd-run --scope opencode acp"` silently fails. The list is re-read on
every AI request, so an edit takes effect on the next send with no restart.

Seven fields per profile reach the browser: `name`, `model` (the configured
model or the fallback label `"ACP"`), `hasModel` (whether `model` is a real id),
the allowlist key `agent` (possibly `""` when the profile uses `command`),
`default`, `available` and `editable` (`_public_acp_configs`, `app.py`).
`command`, `args`, `env`, `cwd`, and `timeout` stay server-side.
`available` is false when the loader would reject the entry — typically because
the agent's executable is not on `PATH`. `editable` is false for a file-owned
entry: a non-empty `command`, an entry with neither form, or an `agent` key this
server does not recognise. `GET /api/ai/config` returns every stored profile in
file order in an `acps` array and keeps `acp` as the first **available** profile
(or `null`) for older clients. The `default` flag is computed from the resolved
default provider, not from the raw file flag, so a default chosen in Settings →
AI wins without the server rewriting `ai.json`, and it may name an unavailable
profile (`_resolve_default_provider`, `app.py`):

1. a stored `ai.json` `default` that names a saved server or an ACP profile;
2. otherwise the first ACP profile flagged `default: true`;
3. otherwise `""`, and the frontend falls back to the first entry.

`POST /api/ai/config` accepts an optional `acp` list of
`{name, agent, model, default}` — those four keys only. Any other key
(`command`, `args`, `env`, `cwd`, `timeout`) is **400**. An omitted `acp` leaves
the stored list untouched, because every save path that predates ACP editing
omits it. `agent` must name a key in `ACP_KNOWN_AGENTS`; `name` must be at most
60 characters and unique across servers and profiles; `model` at most 200
characters; `default` a boolean, and a body entry that omits it keeps the
stored flag. A list longer than 32 entries is **400** (`ACP_MAX_PROFILES`).
Entries the browser cannot express are preserved verbatim and are never dropped
by a save; a body entry that reuses their name is **400**. Editing a
browser-owned entry keeps its stored `cwd`, `env` and `timeout`, so a
hand-edited value survives a change made in the browser — but only while the
posted `agent` stays the same, because a credential provisioned for one binary
must not follow the name onto another. A keyed profile whose name duplicates a
saved server's can never launch, so a save that keeps the server drops it; a
*file-owned* entry under that name instead makes the save **400**.

With auth off, a body carrying `acp` from a non-loopback peer, or with an
`X-Forwarded-For` or `X-Real-IP` header, is **403** `loopback_required`
(`_acp_write_allowed`, `app.py`); a prefs-only save from the same client still
succeeds. The caveat the workspace registry states applies here too: a
same-host proxy that strips both headers is indistinguishable from a local
client, so the rule is only as strong as the proxy configuration.

Settings → AI edits the ACP profiles: add one of the detected agents, edit its
model, remove it, and make it the default. A row whose agent is not installed is
listed but not selectable. The full trust boundary — the agent runs as the
server user with filesystem access and is not constrained by `safe_path` — is in
[`../architecture/ai-assistant.md`](../architecture/ai-assistant.md#acp-providers).

The always-present `acpAgents` array in `GET /api/ai/config` reports which known
agents the host can launch, with an adapter hint when a wrapper CLI is installed
but its ACP adapter is missing (`_detect_acp_agents`, `app.py`).

**Migration from `config/acp.json`.** A legacy `config/acp.json` is folded into
`ai.json`'s `acp` list once at startup (`_migrate_acp_file`, `app.py`): the raw
entries are copied (a name already stored is not copied again, and one that
duplicates a saved server's name is skipped with a warning, because it could
never launch), then the file is renamed to `acp.json.migrated` (or
`.migrated.1`, … so an earlier archive is never overwritten). The renamed file
is kept for a rollback and is no longer read; note that it still holds every
`env` value in cleartext, exactly as the live file did. An unreadable
`acp.json`, or an `ai.json` that exists but cannot be parsed, skips the
migration with a warning and leaves both files alone.

## Browser storage

The frontend uses `localStorage` only. There is no `sessionStorage` and no
IndexedDB.

| Key | Owner | Contents |
| --- | --- | --- |
| `nb:windowGeometry` | `static/js/windows.js` | Per-modal position and size for the floating windows |
| `nb:tableView` · `nb:<id>:tableView` | `static/js/table-view.js` | Versioned per-file, per-table view state (hidden rows/columns, sort), schema v2. Applies only when the header text, a hash of every cell, and the table's same-header ordinal all match; otherwise it is ignored. The default workspace keeps `nb:tableView`; other workspaces use `nb:<id>:tableView`. |
| `nb:aiChats` | `static/js/ai.js` | Versioned per-file AI chats (`{v, activeId, chats[]}`; each chat carries its file, title, conversation, tool flags and newest prompt). Deleting the last chat removes it; **Clear** only empties the active chat. The old `nb:aiChat` key is migrated once and removed. |
| `nb:mobileResume` · `nb:<id>:mobileResume` | `static/js/mobile.js` | Phone Home resume state: last path and scroll. The default workspace keeps the legacy key. |
| `nb:captureDraft` · `nb:<id>:captureDraft` | `static/js/mobile.js` | Quick-capture draft, kept across a 401. The default workspace keeps the legacy key. |

The default workspace deliberately keeps the pre-workspace key names so an
upgrade keeps its overlays, resume point, and draft, and a rollback that only
knows the legacy names stays clean. Every other workspace is namespaced.

### PWA cache

`static/manifest.json` declares the app name "Notebook",
`display: standalone`, and the icon set. `static/sw.js` is served at `/sw.js` (scope `/`) and caches the app shell
under the cache version `notebook-v33` (`CACHE` in `sw.js`). Bump that version whenever
a precached asset changes. The service worker strategy: non-GET requests pass through,
`/api/*` is network-only and returns a 503 JSON error when offline, and
everything else is network-first with a cache fallback. A navigation request
whose URL is not cached falls back to the precached `/`, so deep links reload
offline.
