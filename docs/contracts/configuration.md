# Configuration

## Overview

This server keeps notes and settings in two separate folders. `notebook/`
holds the Markdown notes. `config/` holds four settings files:
`config.json` (UI state), `auth.json` (passwords, session secret, API
tokens), `ai.json` (assistant provider profiles), and `acp.json` (one
hand-edited ACP agent). The split is deliberate: a client can POST the
UI-prefs blob, and that blob must never be able to carry credentials or
choose a command to run (`acp.json`).

The server stores `config.json` verbatim with no validation. The
authoritative schema lives in the frontend. `boot_state()` in `app.py:737`
sanitizes a small subset for the first page paint.

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
   (`start.sh:25`).
2. Installs `requirements.txt` when the file differs byte-for-byte from
   the `.venv_$(hostname)/.installed` stamp (`start.sh:36-48`).
3. `exec`s `app.py "$@"` and forwards every CLI argument (`start.sh:52`).

Flags and defaults:

| Command | Effect |
| --- | --- |
| `./start.sh` | Binds `0.0.0.0:5000`, debug off, reachable from the LAN |
| `./start.sh --host 127.0.0.1` | Binds loopback only |
| `./start.sh --port 8080` | Listens on port 8080 |
| `./start.sh --debug` | Flask debug and auto-reload (the startup banner prints twice) |
| `./start.sh --help` | Shows every `app.py` flag |

`app.py` accepts `-H/--host` (default `0.0.0.0`), `-p/--port` (default
5000), and `--debug` / `--no-debug` (`app.py:2426-2444`). On startup it
prints the notebook folder, the config folder, and one URL per reachable
address (`app.py:2526-2533`). Debug mode with a non-loopback host prints a
warning because Flask exposes the interactive debugger to the network
(`app.py:2534`).

Python dependencies (`requirements.txt`): `Flask==3.0.3`, `bcrypt==5.0.0`,
and `agent-client-protocol==0.12.1` (the ACP SDK, used only by the ACP
provider).

## Environment variables

| Variable | Effect | Resolved at |
| --- | --- | --- |
| `NOTEBOOK_DATA_DIR` | Overrides the notes folder (default `<root>/notebook`) | Import time, `app.py:31` |
| `NOTEBOOK_CONFIG_DIR` | Overrides the config folder (default `<root>/config`) | Import time, `app.py:33` |

These are read once when `app.py` is imported. The test suite points both
at a temp directory before importing the module (`tests/test_app.py:27-29`).

## First-run seeding

`seed()` (`app.py:94`) runs at import time (`app.py:2517`) and does three
things in order:

1. Creates `config/config.json` as an empty object if it is missing
   (`app.py:117-119`).
2. Migrates a legacy `data/` directory to `notebook/` once. This only runs
   when the data folder is the project default, so a user-supplied
   `NOTEBOOK_DATA_DIR` is never touched (`app.py:122-132`).
3. Copies `notebook.template/` into `notebook/` on a fresh install. The
   template holds three files: `Welcome.md`, `README.md`, and `Syntax.md`
   (`app.py:134-141`). If the template folder is absent, the notebook is
   created empty instead.

The template is copied, not symlinked, so editing notes never touches it.

## `config/config.json` — UI state

The server stores this file verbatim. `POST /api/config` only checks that
the body is a JSON object (`app.py:851-867`). Missing keys fall back to
`DEFAULTS` in `static/js/app.js:7-87`. The server embeds a validated subset
into the page shell for first paint.

### Theme and appearance

| Key | Values | Effect |
| --- | --- | --- |
| `theme` | `auto`, `light`, `dark` | Body theme; `auto` follows the system preference (`app.js:115`) |
| `fontSize` | `small`, `medium`, `large`, `xlarge` | Sets `--font-scale` to 0.9 / 1.0 / 1.15 / 1.3 (`app.py:714`) |
| `wallpaper` | `none`, `lines`, `grid` | Background pattern (`app.py:719`) |
| `wallpaperColor` | `neutral`, `blue`, `green`, `purple`, `amber` | Pattern stroke color; `neutral` follows the theme (`app.py:720`) |
| `wallpaperIntensity` | `subtle`, `medium`, `bold` | Pattern stroke alpha (`app.py:721`) |
| `wallpaperScroll` | `scroll`, `fixed` | Pattern scrolls with content, or stays fixed in the viewport (`app.py:779`) |
| `hideTopbar` | boolean | Hides the top bar; body gets `.topbar-hidden` (`app.js:44`) |
| `siteTitle` | string | Browser tab title and top-bar brand; defaults to `"Notebook"` (`app.js:47`) |
| `graphParticles` | boolean | Ambient particle drift in the graph view (`app.js:39`) |
| `settingsModalWidth` | `compact`, `medium`, `wide` | Sets `--settings-modal-width` (`app.js:65`) |
| `settingsModalHeight` | `compact`, `medium`, `wide` | Sets the settings modal height (`app.js:70`) |

### Layout

| Key | Default | Effect |
| --- | --- | --- |
| `sidebarWidth` | `240` | Side panel width in pixels (`app.js:31`) |
| `outlineWidth` | `220` | Outline pane width in pixels (`app.js:32`) |
| `sidebarCollapsed` | `false` | Collapses the side panel to width 0 (`app.js:33`) |
| `outlineCollapsed` | `false` | Collapses the outline pane to width 0 (`app.js:34`) |
| `activeView` | `explorer` | Active side-panel view: `explorer`, `bookmarks`, `recent`, `search`, or `ai`; any other value falls back to `explorer` (`app.js:36`) |

### Files and tabs

| Key | Effect |
| --- | --- |
| `lastFile` | The file opened most recently (`app.js:26`) |
| `recentFiles` | Array for the Quick open view (`app.js:27`) |
| `openFiles` | Ordered array of open tabs (`app.js:28`) |
| `activeFile` | The selected tab (`app.js:29`) |
| `pinnedFiles` | Array of pinned tabs (`app.js:30`) |
| `bookmarks` | Ordered array of bookmarked paths; missing files are pruned on tree refresh (`app.js:52`) |

### Editing

| Key | Values | Effect |
| --- | --- | --- |
| `vimMode` | boolean | Enables the VIM keymap in the shell and in the editor (`app.js:75`) |
| `vimrc` | string | User VIM initial script applied to the editor's vim plugin (`app.js:58`) |
| `autosave` | boolean | Saves hybrid-mode edits after a typing pause; vim mode is unaffected (`app.js:81`) |
| `shortcuts` | object | Per-action key bindings; missing actions fall back to `DEFAULTS` in `static/js/shortcuts.js:44` (`app.js:86`) |

### Search

| Key | Effect |
| --- | --- |
| `searchCaseSensitive` | Makes `/api/search` matching case-sensitive (`app.js:35`) |

### First-paint subset

`boot_state()` (`app.py:742`) validates and embeds a small subset into the
HTML shell so the first frame already matches the saved settings. The
subset is: theme, site title, font scale, pane widths, pane collapse state,
topbar hidden, the active side-panel view, and the assembled wallpaper
classes (`app.py:795-834`).

The active view is embedded as `hidden` on every `.side-panel-view` host
except the active one (`_ACTIVE_VIEWS`, `app.py:744`), so the panel's first
frame is the saved view and never flashes the file tree. The value is
allowlisted, so a hand-edited id cannot inject markup.

The page is served before auth. Content-bearing keys (`recentFiles`,
`openFiles`, `bookmarks`) are deliberately excluded, because an
unauthenticated client must not receive them (`app.py:711-713`). Pane
widths are clamped to 140-2000 (`app.py:717-718`) and every choice field is
checked against an allowlist so a hand-edited file cannot inject markup.

The login screen gets only the theme (`app.py:822`). If auth is off, or a
session role is present, the shell gets the full first-paint subset
(`app.py:818-825`).

## `config/auth.json` — passwords and tokens

Auth lives in its own file so the UI-prefs blob can never include hashed
credentials. The schema is documented at `app.py:37-39`.

| Key | Meaning |
| --- | --- |
| `secret` | 32-byte hex session-signing key, generated on first start (`app.py:470`) |
| `admin_password_hash` | bcrypt hash of the admin password; may be absent |
| `viewer_password_hash` | bcrypt hash of the viewer password; may be absent |
| `tokens` | Array of `{name, role, id, hash, created}` for named bearer tokens |

All hashes use bcrypt with cost 12 (`app.py:1052`, `app.py:1060`,
`app.py:1119`).

### Enabling and disabling auth

Auth is ON if and only if `admin_password_hash` exists (`app.py:475-483`).

Setting the admin password gates **all** reads and writes, not just writes.
The viewer password is a second login identity; it does not gate reads by
itself. The read gate (`read_login_required`, `app.py:657`) is satisfied by
either role or by a bearer token.

You can disable auth from inside the app. Open Settings, go to the Security
tab, select Passwords, enter the current admin password, and submit an
empty new admin password. This clears the admin hash, the viewer hash, and
all tokens (`app.py:1042-1049`). Clearing requires the current password
because it is destructive (`app.py:1029-1037`). Changing the admin password
to a non-empty value also requires the current password (`app.py:1025-1028`).

New passwords must be at least 6 characters (`app.py:947`, `app.py:1013`).

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
token string is shown once; only a bcrypt hash is stored (`app.py:508-509`).
A token is sent as `Authorization: Bearer nbtk_...`. A presented but
invalid token fails with 401 and shares the login rate limiter; it never
falls back to the session (`app.py:567-586`).

### Rate limit

Failed logins and invalid bearer tokens are rate-limited per client IP, keyed
on the TCP peer address (`request.remote_addr`): 5 failures in 60 seconds
trips 429 on the next attempt (`app.py:596-615`). A successful login clears
the counter (`app.py:933`). The store is in-process, so it resets on restart;
it is defeated by rotating source IPs or by clients behind one NAT sharing a
bucket.

### Transport

The server serves plain HTTP and sets no `ssl_context` (`app.py:2538`).
Passwords and bearer tokens are transmitted in cleartext, so the login gate
protects against unauthorized use of the app, not against an observer on the
network. Bind to loopback (`./start.sh --host 127.0.0.1`) when the machine is
not on a trusted network.

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
  required (`app.py:1215-1223`).
- `default` names the preselected profile.
- `custom_prompt` is a global assistant instruction, stored outside the
  server list (`app.py:1280-1285`).
- `searxng_url` is the optional SearXNG instance the search tool queries.

Secret handling: the stored `api_key` is never echoed to any client.
`GET /api/ai/config` returns `hasKey` (a boolean) instead (`app.py:1263-1286`).
To save a profile without re-typing its key, POST a blank `apiKey` with
`replaceSecret: true`; the server carries the stored key over, and
`replaceSecretFor` names which stored profile to take it from
(`app.py:1240-1251`). The key is stored in cleartext (it is not hashed like a
password), and it is attached to the upstream request sent to whatever
`base_url` the profile names, so protect the file's permissions and backups.

Base URLs are normalized on save: a trailing slash and a trailing `/v1`
are stripped. The chat endpoint appends `/v1/chat/completions`
(`app.py:1227-1232`, `app.py:1297-1308`).

## `config/acp.json` — ACP agent

A second provider kind, the Agent Client Protocol (ACP), is configured in
`config/acp.json` (`ACP_FILE`, `app.py:1186`). The file holds a single
object; the feature is off when the file is missing or invalid.

This file is **hand-edited**. The server never writes it and no HTTP route
touches it, deliberately: a config blob that any authenticated client can POST
must never be able to choose a command to execute (`app.py:1182-1185`). Copy
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
`kiro` (`ACP_KNOWN_AGENTS`, `app.py:1213`). The executable and argv for each
live in that server-side table, not in the file, so neither the file nor the
browser can supply a command for the common case. `agent` and `command` are
mutually exclusive: supplying both makes the file invalid. Provenance for each
command line is in
[`../research/acp-agent-commands.md`](../research/acp-agent-commands.md). One
fact there is unresolved: Gemini's dedicated ACP doc says `--acp` while the same
repo's CLI cheatsheet still lists `--experimental-acp`; the table uses
`--acp`.

`load_acp_config` (`app.py:1309`) validates the whole object and **fails
closed to `{}`** — turning the feature off, never raising — on any violation:

- `name` must be a non-empty, non-whitespace string of at most 60 characters.
- `agent`, when set, must name a key in `ACP_KNOWN_AGENTS` and must not be
  combined with `command`. The selected agent's executable must also be present
  on `PATH`, or the file is treated as unconfigured (`{}`), so an uninstalled
  agent never yields a picker entry that always errors. The executable is
  located with `shutil.which` (`_acp_agent_command`, `app.py:1297`), a
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
`default` (`_public_acp_config`, `app.py:1502`). `command`, `args`, and `env`
stay server-side. The always-present `acpAgents` array in `GET /api/ai/config`
reports which known agents the host can launch, with an adapter hint when a
wrapper CLI is installed but its ACP adapter is missing (`_detect_acp_agents`,
`app.py:1481`). The full trust boundary — the agent runs as the server user
with filesystem access and is not constrained by `safe_path` — is in
[`../architecture/ai-assistant.md`](../architecture/ai-assistant.md#acp-providers).

## Browser storage

The frontend uses `localStorage` only. There is no `sessionStorage` and no
IndexedDB.

| Key | Owner | Contents |
| --- | --- | --- |
| `nb:windowGeometry` | `static/js/windows.js:20` | Per-modal position and size for the floating windows |
| `nb:tableView` | `static/js/table-view.js:71` | Versioned per-file, per-table view state (hidden rows/columns, sort) |

### PWA cache

`static/manifest.json` declares the app name "Notebook",
`display: standalone`, and the icon set. `static/sw.js` caches the app shell
under the cache version `notebook-v11` (`sw.js:21`). Bump that version whenever
a precached asset changes. The service worker strategy: non-GET requests pass through,
`/api/*` is network-only and returns a 503 JSON error when offline, and
everything else is network-first with a cache fallback (`sw.js:81-118`).
