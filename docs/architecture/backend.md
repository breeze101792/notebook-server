# Backend architecture

## 1. Overview

The notebook server is a single-user Markdown notebook. A Flask backend
serves a JSON-only API under `/api/*` and one HTML page. A vanilla-JS
frontend renders Markdown in the browser. Notes are plain `.md` files on
disk: no database, no index, no cache layer.

Two folders are deliberately separate:

- `notebook/` holds the user's notes. It is a symlink to
  `/mnt/projects/notebook` in this checkout.
- `config/` holds settings: `config.json` (UI state), `auth.json`
  (password hashes, token hashes, session-signing secret), `ai.json`
  (OpenAI-compatible provider profiles), `acp.json` (one hand-edited
  ACP agent profile), and `workspaces.json` (the named notebook roots).

`notebook.template/` ships a starter notebook. On a fresh install the
server copies it into `notebook/`.

Siblings in this folder: [frontend.md](frontend.md),
[markdown.md](markdown.md), [hybrid-editing.md](hybrid-editing.md),
[ai-assistant.md](ai-assistant.md). The full HTTP endpoint reference is
[`../contracts/http-api.md`](../contracts/http-api.md); configuration
keys and launch flags are in
[`../contracts/configuration.md`](../contracts/configuration.md); the
test suites are described in [`../testing/README.md`](../testing/README.md).

## 2. Backend structure

The backend is two files. `app.py` is the 4205-line Flask module: every route
returns JSON except `GET /` (serves `index.html`), `GET /agent.md` (serves
Markdown), and `POST /api/ai/chat` (relays `text/event-stream`).
`acp_client.py` (306 lines) is the one exception to the single-file rule —
see [Design decisions](#9-design-decisions-and-trade-offs).

### Import-time path resolution

`DATA_DIR` and `CONFIG_DIR` resolve once at import time
(`app.py`). `NOTEBOOK_DATA_DIR` / `NOTEBOOK_CONFIG_DIR` override the
project defaults `notebook/` and `config/`. `seed()` then runs at import
time (`app.py`, defined at `app.py`):

1. Create `config/` and an empty `config/config.json` if missing.
2. If using the project-default data folder and a legacy `data/` directory
   exists but `notebook/` does not, move `data/` to `notebook/`
   (one-time migration).
3. If `notebook/` still does not exist, copy `notebook.template/` into it.

The migration only runs when `DATA_DIR` is the default path; a custom
`NOTEBOOK_DATA_DIR` is left untouched. Import-time startup maintenance then
runs before the server starts: `_migrate_config_at_startup()` moves legacy
config keys under `workspaceState.default`, and
`_persist_workspaces_if_changed()` rebuilds `config/workspaces.json` when it
is missing or not canonical. The auth secret is loaded or generated right
after `seed()` (`ensure_auth_secret()`) and assigned as Flask's
session-signing key.

### Route organisation

Routes are grouped by comment banners:

| Section | Banner | Endpoints |
| --- | --- | --- |
| Page + config | `app.py` | `GET /`, `GET /sw.js` (service worker at root scope), the two `apple-touch-icon` aliases, `/api/config`, `/api/info` |
| Workspaces | `app.py` | `/api/workspaces`, `/api/workspaces/active`, `/api/workspaces/<id>`, `/api/workspace-state` |
| Auth | `app.py` | `/api/auth`, `/api/login`, `/api/logout`, `/api/auth/passwords` |
| API tokens | `app.py` | `/api/auth/tokens`, `/api/auth/tokens/<name>` |
| AI assistant | `app.py` | `/api/ai/config`, `/probe`, `/chat`, `/fetch`, `/search` |
| Agent guide | `app.py` | `GET /agent.md` |
| File read/write | `app.py` | `/api/tree`, `/api/ls`, `/api/file`, `/api/file/append`, `/api/edit` |
| Mutations | `app.py` | `/api/create`, `/api/move`, `/api/copy`, `/api/delete` |
| Search | `app.py` | `/api/search` |
| Graph | `app.py` | `/api/graph` |
| SPA catch-all | `app.py` | `GET /<path:p>` |

The catch-all (banner `app.py`, route decorators `app.py`,
`spa` def at `app.py`) serves `index.html` for any non-`/api/*`,
non-`/static/*` path, so a deep link such as `/README.md#core-rules`
works. It answers an unmatched `api/...` path with a JSON 404, so a client
that mistypes an endpoint does not get the shell as HTML.

### Request lifecycle

Flask matches routes in registration order, so the catch-all registered
last loses to every explicit route. Before any view runs, the `before_request`
hook `_bind_workspace()` resolves the request's workspace and stores its root
and id on `g`; the route's auth decorator then resolves the caller role. File
routes pass the user path through `safe_path(rel, current_root())`, writes go
through `atomic_write()`, and an `after_request` handler adds
`Cache-Control: no-store` to gated read paths and `Vary:
X-Notebook-Workspace` to every `/api/*` response. Every file route must use
`safe_path`; new operations must never accept a raw path.

## 3. Storage and path safety

`safe_path(rel, root=None)` is the security chokepoint. It resolves a
user-supplied relative path against `root` and returns the lexically
normalised absolute path when the result stays inside it, else `None`. `root`
defaults to `DATA_DIR` for direct calls outside a request; file routes pass
`current_root()`, which reads the workspace bound on `g`. It rejects absolute
input and blocks `..` traversal. Interior symlinks are deliberately allowed:
the user created them via the filesystem. The boundary check uses the
unresolved root string, so a `..` after a symlink resolves lexically and cannot
escape. The result is not `realpath`-resolved, so operations on a symlink act
on the link, matching `rm`/`mv`/`cp` semantics.

`atomic_write(path, content)` writes a uniquely named temp
file then calls `os.replace`. The temp name includes pid, thread id, and a
counter, so concurrent writers to the same target never
share a temp file. `save_auth()` uses the same pattern.

Five files sit under `config/`: `config.json` (opaque UI-state JSON,
POSTable by any authenticated client), `auth.json`
(`secret`, password hashes, `tokens`), `ai.json` (provider profiles, global
prompt, SearXNG URL), `acp.json` (a hand-edited ACP agent profile: a
`command` line, or a well-known `agent` key that resolves to one, plus
`args`), and `workspaces.json` (the server-owned workspace registry).
`auth.json`, `ai.json`, and `acp.json` are split out of the POSTable
`config.json` blob because a client that can POST settings must not reach
credential storage, and must never be able to choose a command to execute.
`workspaces.json` is split out for the same reason in the other direction: a
client that can POST settings must not be able to point the server at an
arbitrary folder. `acp.json` and `workspaces.json` are never written through
`POST /api/config`; only the workspace routes and startup touch the registry.

### Workspace roots

One process can serve several roots. `load_workspaces()` reads
`config/workspaces.json` on every request and always synthesises the default
entry first (`_default_workspace()`). Reading is pure in memory: a missing,
corrupt, or non-object file degrades to the default, invalid entries are
dropped, and the default's stored path is discarded. Persistence belongs to the
mutating routes and to `_persist_workspaces_if_changed()` at startup, so a
`/static/*` request never writes a server-owned file.

**Resolution.** `_bind_workspace()` is a `before_request` hook, so it runs
ahead of every view's auth decorator. It reads `X-Notebook-Workspace`, else
`session["workspace"]`, else the default, and stores the chosen entry on
`g.data_dir` and `g.workspace_id`. `current_root()` reads `g.data_dir` inside
a request and falls back to `DATA_DIR` outside one.

The hook deliberately never aborts. An unknown id sets
`g.workspace_unknown` and binds the default root; the gated data views then
call `_unknown_workspace_response()` after their auth gate passes. That
ordering is the point: aborting in the hook would leak whether an id exists to
an anonymous caller and would lock a tab out of login when its workspace was
removed. The helper stays silent while auth is on and the caller is anonymous
(no session role and no bearer header), so the decorator's 401 stands; with
auth off, with a session role, or with a bearer token presented, it returns
`404 unknown_workspace`. On the SPA shell an unknown id binds the default and
clears the stale `session["workspace"]`, so a bad cookie cannot trap the user.
The 404 applies to the twelve data routes; login, auth, the workspace list,
config, info, and the shell fall back silently. The one exception among the
non-data routes is AI chat: the ACP branch of `POST /api/ai/chat` resolves
an explicit `workspace` id and answers an unknown one with the same
`404 unknown_workspace` (`app.py`).

**Why the default path stays unresolved.** `DATA_DIR` is stored and compared
as the unresolved string the process imported. If it were `realpath`-resolved
in the registry, `safe_path()`'s prefix check and `rel_from()`'s string
`relpath()` would compare a resolved root against lexically normalised paths,
and `rel_from()` would emit nonsense such as `../real_notebook/x` when the root
itself is a symlink. The same rule is why a carried `workspaces.json` has its
default path overwritten with the current install's `DATA_DIR`: the identity
must be this process's root, not the previous install's.

**Config serialisation.** `_CONFIG_LOCK` guards every `config.json`
read-modify-write: `set_config()`, `set_workspace_state()`, and the startup
migration. Without it two writers each read the old blob and the later write
silently loses the other's update. Reads stay lock-free because
`atomic_write()` publishes a complete file.

**Startup migration.** `_migrate_config_at_startup()` runs once at import time,
after `seed()` and before the server starts, and moves the nine
workspace-scoped top-level keys (`lastFile`, `openFiles`, `activeFile`,
`pinnedFiles`, `sessions`, `activeSessionId`, `recentFiles`, `bookmarks`,
`pinnedFolders`) under
`workspaceState.default`. It is idempotent, leaves a blob that already has
`workspaceState` alone, and is best effort under `_CONFIG_LOCK`. It
deliberately does not run from `GET /api/config`, because a read route must not
write a server-owned file. `POST /api/config` still folds stray legacy keys
under `default` on every write, so a whole-blob POST cannot strand them.

**Session state.** `POST /api/workspace-state` replaces the whole entry, so a
client loaded before sessions existed (or a second stale tab) would otherwise
delete `sessions`/`activeSessionId`. The route keeps those two keys from the
stored entry when the incoming body omits them and the stored entry has
`sessions`; a current client always sends both, so a real change is never
blocked. `_ACTIVE_VIEWS` also gains `sessions`, so a saved view id is accepted
by `boot_state()` and the view is painted on the first frame. See
[sessions.md](sessions.md) §3, §11.

## 4. Auth architecture

Auth lives in a dedicated section (banner at `app.py`): a
two-password gate with an admin password and an optional viewer password.

**Enabled-iff-admin.** `auth_enabled()` (`app.py`) returns true iff
the admin password hash exists. When auth is off, every route is open.
When the admin password is set, **all reads and writes are gated**,
whether or not a viewer password exists (the decorators at
`app.py`). The viewer password is a secondary login option, not
the read gate.

**The decorators.** `login_required` is open when
auth is off, else requires a valid session or bearer role.
`admin_required` additionally requires the role to be
`admin`. `read_login_required` requires any resolved role.
`workspace_admin_required` (workspace registry writes and
`POST /api/workspace-state`) requires admin, and
while auth is off requires a loopback peer with no `X-Forwarded-For` or
`X-Real-IP`; a refusal is `403 loopback_required`. `login_required` and
`read_login_required` behave the same today; they are named separately to
document intent: mutating routes versus read routes.

**Workspace permissions.** Any authenticated role, including `viewer`, may
list workspaces and switch the session workspace. A viewer may not add,
rename, or remove a workspace (`403 not_admin`), and may not write
per-workspace UI state: `POST /api/workspace-state` is gated by the same
`workspace_admin_required`. Logout clears
`session["workspace"]` with the role, so the next request falls back to the
default.

**Role resolution.** `_request_role()` (`app.py`) resolves the role. A
presented Bearer token is authoritative: an invalid token fails with 401
rather than falling back to the session cookie. Otherwise the signed
session cookie decides.

**Named API tokens.** Tokens let agents and scripts skip the cookie login.
Format is `nbtk_<40 hex>`; the scheme is documented with its constants at
the top of the API-tokens section (`_TOKEN_PREFIX` at `app.py`). The
first 10 hex
chars are a public lookup id; the remaining 30 are the secret. Only a
bcrypt hash is stored, and the full string is shown once at creation
(the issuing route at `app.py`). Lookup is O(1) bcrypt per request
because the id selects the single candidate hash (`_find_token`,
`app.py`). Issuing requires auth to be on (`app.py`).

**Rate limiting.** An in-memory dict maps client IP to recent failure
timestamps (`app.py`). Five failures in 60 seconds locks the IP
out; the sixth attempt returns 429, and a successful login clears the
record. Both login failures and invalid Bearer attempts feed it
(`app.py`). It keys on the TCP peer address (`request.remote_addr`),
not a client-supplied header, so it cannot be bypassed by spoofing a header;
it is defeated only by rotating source IPs or by several clients behind one
NAT sharing a bucket. Gated read paths get
`Cache-Control: no-store, private`, so a previously
authorized browser cannot re-display content after auth tightens. Every
`/api/*` response also varies on `X-Notebook-Workspace`, so a cache cannot
serve one workspace's tree for another.

## 5. AI proxy architecture

The browser talks only to this server, which relays chat to any
OpenAI-compatible `/v1/chat/completions` endpoint. All `/api/ai/*` routes
are admin-gated **only while auth is on**: `admin_required` returns the view
unguarded when auth is off, which is the default. On an open server any LAN
client can read or rewrite the provider profiles and spend the stored key.
See [Security posture](#6-security-posture) for the full caveat. The API key
never appears in a response to the browser, but it is attached server-side to
the request sent to whatever `base_url` is saved. `config/ai.json` is
snake_case on disk (documented with the section banner at `app.py`):

```
{
  "servers": [{"name", "base_url", "api_key", "model"}],
  "default": "",
  "custom_prompt": "",
  "searxng_url": ""
}
```

The HTTP API is camelCase (`baseUrl`, `customPrompt`, `searxngUrl`) and
masks `api_key` to a boolean `hasKey` (`_public_ai_config`, `app.py`).
The stored key is never echoed to a client. A POST with `apiKey: ""` plus
`replaceSecret: true` carries the stored key over server-side.

`GET /api/ai/probe` checks reachability: an upstream HTTP error counts as
reachable, while a connection failure returns `{ok: false}` with HTTP 200.
`POST /api/ai/chat` streams the completion. The server rebuilds the
upstream payload from the model, messages, and a `stream: true` flag, so
extra client keys never reach the provider (`app.py`). The
stored `api_key` is attached server-side by `_upstream_auth_headers`
(`app.py`). The upstream bytes are relayed verbatim as
`text/event-stream` (`relay()`, `app.py`). Upstream errors are
re-emitted in-band as `event: error` frames (`app.py`), because
EventSource cannot read a non-200 status; the relay handles `GeneratorExit`
so an early disconnect does not become an error banner.

**ACP branch.** The same route serves ACP profiles. `config/acp.json` is a
separate, hand-edited file holding one or more profiles (`name`, `agent` or
`command`, `args`, `cwd`, `env`, `model`, `default`, `timeout`). Three shapes
are accepted — `{"profiles": [...]}`, a bare array, and the legacy single
object — and each entry is validated independently. `load_acp_configs()`
(`app.py`) returns the valid profiles, dropping an invalid entry, a duplicate
name, or a name that collides with an `ai.json` server; `load_acp_config()` is a
compatibility wrapper returning the first profile or `{}`. The file
deliberately never comes through `POST /api/ai/config` (`app.py`) — a config
blob any authed client can POST must not be able to choose a command to
execute. `ai_chat` resolves an OpenAI profile first; when the posted `server`
instead matches an ACP profile (`_acp_profile`, `app.py`) it calls
`_acp_chat_response` (`app.py`). Messages go through the shared
`_validate_chat_messages` (`app.py`), the system turn is dropped, image
parts are rejected, and the rest is flattened to one prompt
(`_flatten_acp_prompt`, `app.py`). The profile's `model`, when set, is passed to
`acp_client.run_turn` and applied after `session/new` through the agent's model
config option; `run_turn` also merges the server's full environment with the
profile's `env` (the profile wins) before spawning. The turn is streamed as the
same OpenAI delta frames plus `data: [DONE]` and `event: error` frames, so the
browser parser is unchanged. `GET /api/ai/config` exposes the browser-safe list
as `acps` (with `acp` as the first entry for older clients), and
`_resolve_default_provider` (`app.py`) picks the default from `ai.json` or an
ACP profile without ever writing the ACP file. `acp_client` is imported lazily
(`app.py`), so a missing `agent-client-protocol` package disables only ACP
rather than the server. See
[ai-assistant.md](ai-assistant.md#acp-providers) for the full contract,
including the agent's filesystem trust boundary.

`POST /api/ai/fetch` fetches a URL server-side for the assistant's fetch
tool, since the browser cannot cross CORS. Only http(s) is allowed. The
body is capped at `AI_FETCH_MAX_BYTES` (512 KiB) and times out after
`AI_FETCH_TIMEOUT` (15s) (`app.py`, route `app.py`).
`POST /api/ai/search` queries the web for the assistant's search tool. The
configured `searxng_url` is preferred, queried with its JSON output format;
when it is unset or fails, a keyless Yahoo results-page fallback answers.
Either way
the route returns the top `AI_SEARXNG_MAX_RESULTS` (10) results
(`app.py`, route `app.py`). The SearXNG request times out after
`AI_SEARXNG_TIMEOUT` (15s), the fallback after `AI_FALLBACK_SEARCH_TIMEOUT`
(20s). Only bad input is 400, and only both providers failing is 502.

## 6. Security posture

The operator must know these properties; they are consequences of the
single-user design, not defects.

**Transport is plain HTTP.** `app.run()` sets no `ssl_context`
(`app.py`). Admin and viewer passwords are posted in cleartext and
bearer tokens travel as cleartext headers, so anyone who can observe the LAN
can read them. bcrypt protects only the stored hash, never the wire.

**The server binds `0.0.0.0` by default.** `app.py` defaults `-H` to
`0.0.0.0` (`app.py`), so a fresh install is reachable from the
whole network.

**Auth is off by default.** `auth_enabled()` is false until an admin password
is set, and the session/role decorators return the view unguarded in that
state. Every route — including all `/api/ai/*` and every mutating file route —
is open to any client that can reach the port. The exception is the
workspace routes: `workspace_admin_required` (the registry writes and
`POST /api/workspace-state`, `app.py`) still requires a loopback peer
with no forwarding header while auth is off.

**Provider keys are stored in cleartext.** `save_ai_config`
(`app.py`) writes the raw `api_key` with default file permissions;
unlike the password hashes in `auth.json`, `config/ai.json` holds usable
secrets, so backups and file permissions are operator-sensitive.

**A saved key follows its profile's `base_url`.** Saving a profile with a
blank `apiKey` and `replaceSecret: true` carries over the stored key for the
named profile (`replaceSecretFor`, `app.py`). Because `base_url`
is attacker-chosen, a client that can POST `/api/ai/config` (open when auth
is off) can repoint a profile and have the server attach the stored key to a
request to that host. The "never leaves the server" property covers responses
to the browser, not the upstream request target.

**The fetch tool can reach internal hosts.** `/api/ai/fetch` checks the
scheme and length only; loopback, private ranges, and cloud-metadata
addresses are reachable, and redirects are followed (the route's docstring
at `app.py` acknowledges this). Scheme filtering is not SSRF
protection.

**Request bodies are capped at 32 MiB.** `MAX_CONTENT_LENGTH` is set to
`MAX_REQUEST_BYTES`; an oversized body is rejected with a JSON 413 before a
route reads it, and a body under the cap is read wholly into memory. **No CSRF
token** is issued; the JSON content type
and modern `SameSite=Lax` cookie defaults are the practical protection. **No
TLS and no `Secure` cookie flag** follow from serving plain HTTP.

**A workspace registration is a filesystem grant.** Adding a workspace lets
this process read and write that directory as the user running the server.
The install folder and the config folder are excluded, and overlapping roots
are refused in both directions after a realpath + normcase comparison, but the
grant itself is broad. An admin credential — or, while auth is off, any client
that can reach a loopback port — is therefore equivalent to filesystem access
as the server user. Enable authentication whenever the host binds beyond
loopback. While auth is off, registry mutations also require a loopback peer
and no forwarding header, so a proxied LAN client cannot add a root.

**Debug mode on a non-loopback host exposes the Flask debugger** to the
network; `app.py` prints a warning.

## 7. Frontend architecture

The frontend has no build step at runtime. `templates/index.html` loads
vendored libraries and app modules as plain `<script>` tags; the
CodeMirror bundle is the one offline-built exception. It is one page plus
45 modules under `static/js/`, all sharing the `window.NB` namespace. See
[frontend.md](frontend.md) for the module inventory, boot sequence,
renderer pipeline, and persistence.

## 8. Agent-facing surface

`GET /agent.md` (`app.py`) serves the project-root `agent.md` as
`text/markdown`, substituting the current auth state into a
`{{auth_state}}` placeholder (`_AUTH_STATE_PLACEHOLDER` at `app.py`,
substitution at `app.py`). The route is deliberately ungated: an
agent must discover how to authenticate before it holds a credential. The
file contains endpoint documentation only — no notebook data and no
secrets. It responds with `Cache-Control: no-store` because the
substituted state changes with config. The file is normal Markdown in the
repository, not generated code.

## 9. Design decisions and trade-offs

**Config split.** `auth.json`, `ai.json`, and `acp.json` are split out of
`config.json` so the client-POSTable settings blob provably cannot carry
secrets (`auth.json`, `ai.json`) or choose a command to execute
(`acp.json`). The cost is four small files instead of one.

**Single-file backend.** `app.py` keeps import-time state (paths, seeding)
trivial and avoids a package layout for a single-user tool. The cost is a
large file; section banners and the line map above mitigate it. The one
deliberate exception is `acp_client.py`: it owns a subprocess and an asyncio
loop on a daemon thread, is coupled to the `agent-client-protocol` SDK, and
imports neither Flask nor `app.py`, so it stays testable against a stub agent
with no server around it.

**No build step.** There is no bundler, transpiler, or framework. The cost
is dozens of HTTP requests on a cold load (one per module and vendored
file), which the service worker caches. The benefit is that the served code
is the source code, with no build artifact to drift.

**CodeMirror exception.** `static/vendor/codemirror.bundle.js` is an
esbuild IIFE built offline from `static/vendor/codemirror.entry.js`.
The build is documented in
[`../operations/build.md`](../operations/build.md), which also records
the second built artifact, the Mermaid designer's `visimer.bundle.js`.
These two are the served files that are not directly editable.

**Mermaid copy.** `static/vendor/mermaid.min.js` is byte-identical to
`node_modules/mermaid/dist/mermaid.min.js`. Updating it means copying the
package file, then updating the version strings in `ai.js` and `agent.md`
in the same change.

**Un-sanitized Markdown.** Notebooks are the user's own files, so
`viewer.js` renders them un-sanitized. The one untrusted render path is the
AI panel: `ai.js` sanitizes an assistant reply's marked HTML with the
vendored DOMPurify 3.4.12 (`static/vendor/purify.min.js`) before `innerHTML`
and sanitizes model-authored `svg`/`dot` output after its renderer runs. A
new untrusted path must sanitize the same way. The `html-live` renderer is
the other exception: it runs in a sandboxed iframe with `allow-scripts` and
no `allow-same-origin`.

## 10. Directory map

```
notebook-server/
  app.py                  Flask backend (4205 lines)
  acp_client.py           Flask-free ACP client, one agent process per turn (306 lines)
  agent.md                machine-readable API guide, served at /agent.md
  start.sh                venv bootstrap + launcher
  requirements.txt        Python dependencies
  notebook/               notes (symlink to /mnt/projects/notebook)
  notebook.template/      starter notebook copied on first run
  config/                 config.json, auth.json, ai.json, acp.json,
                          workspaces.json
  templates/index.html    the single SPA shell (1953 lines)
  static/
    manifest.json         PWA manifest
    sw.js                 service worker source, served at /sw.js, cache notebook-v23 (sw.js)
    css/ icons/ vendor/   styles, PWA icons, vendored libraries
    js/                   45 app modules sharing window.NB
  tests/
    test_app.py           461 test methods, 51 TestCase classes (6504 lines)
    dom/test_dom.js       jsdom frontend harness (40695 lines, 116 sections)
    browser/              Playwright suites; run_all.js runs every suite
  docs/
    architecture/         this folder: backend, frontend, markdown,
                          hybrid-editing, ai-assistant (+ design/)
    contracts/            http-api.md, configuration.md
    operations/           development.md, build.md
    requirements/         product requirements
    testing/              test strategy and suite guides
    README.md             guide index
```