# Notebook Server API Reference

## Overview

The notebook server is a single-user Markdown notebook. The backend is a Flask
module, `app.py`, plus `acp_client.py` (the Flask-free ACP client the AI routes
use); the frontend is a vanilla-JS single-page app. Every application route
lives under `/api/*` and returns JSON, except `GET /` and the SPA catch-all
(HTML), `GET /sw.js` (JavaScript, served at root scope), the two
`apple-touch-icon` aliases (PNG), `GET /agent.md` (Markdown), and
`POST /api/ai/chat` (an SSE byte relay).

A machine-readable companion guide is served at `GET /agent.md`, maintained as
[`agent.md`](../../agent.md) at the project root. It is written for AI agents and
scripts: it documents the endpoint contract and substitutes the current auth
state into a placeholder so it never goes stale. This file is the fuller
human-facing reference. Read the code at `app.py` when the two disagree; this
file can lag a change.

Related docs:

- [`configuration.md`](configuration.md) — config files, environment variables,
  CLI flags, and browser storage.
- [`../architecture/backend.md`](../architecture/backend.md) — backend
  structure, `safe_path`, atomic writes, and the auth layer.
- [`../architecture/frontend.md`](../architecture/frontend.md) — the frontend
  modules that call these routes.
- [`../testing/README.md`](../testing/README.md) — how the backend and frontend
  suites exercise the API.
- [`../../README.md`](../../README.md) — the user-facing overview.

## Conventions

- **JSON everywhere.** Request bodies are JSON objects. Success responses are
  JSON objects. `POST /api/ai/chat` is the one exception: its response body is
  an upstream `text/event-stream` relayed verbatim.
- **Paths are relative to the active workspace root.** Clients pass
  forward-slash relative paths such as `notes/ideas.md`. Every file route
  resolves the path through `safe_path(rel, current_root())`. It rejects
  non-strings, empty or whitespace input, absolute paths, and any path whose
  lexically normalized result is not the root or under it. It returns the
  normalized absolute path or `None`. `safe_path()` deliberately does not call
  `realpath`: interior symlinks that point outside the root are allowed
  because the user created them on purpose. `rel_from()` turns an absolute
  path back into a relative one. Outside a request, both default to
  `DATA_DIR`; inside one, `current_root()` returns the workspace bound by
  `_bind_workspace()`.
- **Workspace header.** Every request may name a workspace with
  `X-Notebook-Workspace: <id>`. Resolution order is the header, then
  `session["workspace"]`, then the default. The frontend sends the header on
  every request, so a tab keeps operating on the root it was rendered from.
  No header and no session reaches the default root, which is where a bearer
  token with no session lands. See [Workspaces](#workspaces).
- **Writes are atomic but not power-loss durable.** `atomic_write()`
  writes a unique temp file (`<path>.<pid>.<tid>.<counter>.tmp`)
  and calls `os.replace`. The rename is atomic under concurrent writers. There
  is no `fsync`, so a power loss can lose a recent write.
- **Auth gating.** When an admin password is set, every read and write requires
  a valid session or bearer token. When auth is off, all routes are open except
  workspace registry mutations, which require a loopback peer with no
  forwarding header. See [Authentication](#authentication).
- **Cache headers.** The paths in `_GATED_READ_PATHS` (`/api/tree`, `/api/ls`,
  `/api/file`, `/api/search`, `/api/config`, `/api/info`, `/api/workspaces`,
  `/api/graph`, `/api/workspace-state`) carry
  `Cache-Control: no-store, private`. Every `/api/*`
  response also carries `Vary: X-Notebook-Workspace`, because the same URL
  answers with a different notebook depending on the header. The `/agent.md`
  response carries `Cache-Control: no-store`.
- **No transport security.** The server serves plain HTTP (`app.run()` sets
  no `ssl_context`). Passwords and bearer tokens cross the wire in cleartext;
  bcrypt protects only the stored hash. See
  [Security posture](#security-posture).
- **Errors.** `err()` returns `{"error": "<message>"}` with a status code;
  workspace routes add a stable `code`. See [Error reference](#error-reference)
  and [Workspace error codes](#workspace-error-codes).

## Authentication

Auth is optional. It is **on** exactly when the admin password hash exists
(`auth_enabled()`, `app.py`). Setting the admin password also gates every
read, whether or not a viewer password exists. A viewer password only adds a
second, read-only login option.

State lives in `config/auth.json`, separate from `config/config.json`:

```json
{
  "secret": "<hex, session-signing key>",
  "admin_password_hash": "<bcrypt>",
  "viewer_password_hash": "<bcrypt, optional>",
  "tokens": [
    {"name": "opencode", "role": "admin", "id": "<10 hex>",
     "hash": "<bcrypt of the full token>", "created": 1700000000}
  ]
}
```

Passwords are hashed with bcrypt at cost 12. The server never stores or returns
a plaintext password. It does, however, receive the password in cleartext over
plain HTTP.

### Security posture

These properties follow from the single-user design; an operator must know
them.

- **Auth is off by default.** Until an admin password is set, every route is
  unauthenticated, including all `/api/ai/*` and every mutating file route
  (`admin_required` and `read_login_required` return the view unguarded when
  `auth_enabled()` is false). Workspace registry mutations are the one
  exception: they still require a loopback, non-proxied peer.
- **Plain HTTP.** No TLS, so passwords and tokens can be sniffed on the LAN.
- **Open by default on `0.0.0.0`.** The default bind is all interfaces
  (`app.py`).
- **Provider keys in cleartext.** `config/ai.json` stores upstream API keys
  unhashed; file permissions and backups matter.
- **The stored key follows `base_url`.** While auth is off, any LAN client can
  POST a profile and have the server attach the stored key to a request to an
  arbitrary host.
- **`/api/ai/fetch` can reach internal hosts.** It checks scheme and length
  only; loopback, private ranges, and metadata addresses are reachable.
- **Bodies are capped at 32 MiB.** `MAX_CONTENT_LENGTH` is set to
  `MAX_REQUEST_BYTES` (32 MiB); an oversized body gets a JSON 413. A body
  under the cap is still read wholly into memory.

### Decorators

Four decorators compose the layer. All bypass the check when auth is off.

| Decorator | Requires | Used on |
| --- | --- | --- |
| `login_required` | any valid role | `POST /api/logout` |
| `admin_required` | role `admin` (401 if none, 403 if viewer) | every remaining mutating route and all `/api/ai/*` routes |
| `read_login_required` | any valid role | `/api/tree`, `/api/ls`, `GET /api/file`, `GET /api/config`, `/api/info`, `/api/search`, `/api/graph`, `GET /api/workspaces`, `POST /api/workspaces/active` |
| `workspace_admin_required` | admin; with auth off, a loopback peer and no forwarding header | `POST /api/workspaces`, `PATCH`/`DELETE /api/workspaces/<id>`, `POST /api/workspace-state` |

`workspace_admin_required` is stricter than `admin_required` only while auth is
off. In that state every host on the LAN could otherwise add or remove a
filesystem root, or write per-workspace UI state, so the request must come from
a loopback address and must not carry `X-Forwarded-For` or `X-Real-IP` (a
same-host reverse proxy dials in from 127.0.0.1, so a peer-address test alone
would treat every proxied client as local). A refusal is **403** with
`code: "loopback_required"`. With auth on, a viewer gets **403** with
`code: "not_admin"`.

### Roles and tokens

A role is `"admin"` or `"viewer"`. A browser session stores it in a signed
cookie after `POST /api/login`. Agents and scripts can instead use a named
bearer token:

```
Authorization: Bearer nbtk_<40 hex>
```

Tokens are created with `POST /api/auth/tokens`, which returns the full token
string exactly once. Only a bcrypt hash is stored. The public lookup id is the
first 10 hex characters; the remaining 30 are the secret, and the hash covers
the whole string. A presented-but-invalid bearer token fails with 401 and never
falls back to the session cookie (`_request_role()`, `app.py`).

### Rate limiting

Failed logins and bad bearer tokens share an in-memory per-IP limiter:
`_LOGIN_FAIL_LIMIT` = 5 failures per `_LOGIN_FAIL_WINDOW` = 60 seconds
(`app.py`). The sixth attempt returns 429. A success clears the counter.
The store is in-process, so it resets on restart and is best-effort.

## Endpoint reference

### Page and documentation

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/` (`app.py`) | none | `index.html`, with saved chrome pre-applied. |
| GET | `/<path:p>` (`app.py`) | none | SPA catch-all. Serves `index.html` for deep links such as `/README.md#core-rules`; an unmatched `api/...` path gets a JSON 404. |
| GET | `/agent.md` (`app.py`) | none | The root `agent.md` verbatim as `text/markdown; charset=utf-8`, with `{{auth_state}}` substituted. 500 if the file is missing. |

### Config and info

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/config` | read | Returns the stored `config.json` verbatim. Missing or corrupt file returns `{}`. The one-shot workspace-state migration runs at server startup, not on this read, so a GET never writes a server-owned file. |
| POST | `/api/config` | admin | Body must be a JSON object. Stores it verbatim with no schema validation, except that legacy top-level content keys (`lastFile`, `openFiles`, `activeFile`, `pinnedFiles`, `recentFiles`, `bookmarks`, `pinnedFolders`) are folded under `workspaceState.default` first. 400 if not an object, 500 on write failure. |
| GET | `/api/info` | read | `{data_dir, config_dir, workspace}`: the active workspace root, the config folder, and the active workspace id. For the default root, `data_dir` is the unresolved `DATA_DIR` string. |

### Workspaces

The server can serve several named notebook roots. The registry is
`config/workspaces.json`, server-owned and read on every request. Its schema,
limits, and the trust boundary are in
[configuration.md](configuration.md#configworkspacesjson--workspace-registry).

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/workspaces` | read | — | `{workspaces: [{id, name, path, available, is_default}], active}`. `active` is the caller's resolved id. |
| POST | `/api/workspaces` | workspace admin | `{name, path}` | **201** `{workspace: {id, name, path, available, is_default}}`. `path` is stored as the folder's absolute realpath. |
| PATCH | `/api/workspaces/<id>` | workspace admin | `{name}` | `{workspace: {...}}`. Renaming never changes the id or the path. |
| DELETE | `/api/workspaces/<id>` | workspace admin | — | `{ok: true}`. Removes the entry only; the folder and notes stay on disk. The default is not removable. |
| POST | `/api/workspaces/active` | read | `{id}` | `{ok: true, active: "<id>"}`. Stores the id in the signed session. A viewer may switch too. |
| POST | `/api/workspace-state` | workspace admin | `{id, state}` | `{ok: true, id}`. Merges `state` under `workspaceState.<id>` in `config.json`, preserving other entries and unrelated keys. `state` is capped at 256 KiB. |

**Resolution.** `_bind_workspace()` runs as a `before_request` hook and binds
the request's root to `g.data_dir` and its id to `g.workspace_id`. It reads
`X-Notebook-Workspace`, else `session["workspace"]`, else the default. An
unknown id does not abort there — the hook runs ahead of every auth decorator,
so a 404 would both leak whether an id exists to an anonymous caller and lock a
tab out of login when its workspace was removed. It records
`g.workspace_unknown`, binds the default root, and the data views call
`_unknown_workspace_response()` after their gate has passed.

**Unknown id.** An authenticated caller gets **404** `unknown_workspace` on the
twelve data routes: `/api/tree`, `/api/ls`, `GET /api/file`, `POST /api/file`,
`/api/file/append`, `/api/edit`, `/api/create`, `/api/move`, `/api/copy`,
`/api/delete`, `/api/search`, `/api/graph`. An unauthenticated caller gets the
route's **401** instead, so the 404 never reveals that an id exists. A
presented bearer token counts as authenticated for this decision. The 404 never
fires on login, auth, the workspace routes, config, info, or the SPA shell;
those fall back to the default root. `/api/ai/chat` is the exception: an
explicit `workspace` id in the request body that names no workspace is a
**404** `unknown_workspace`, because there the id is a selector the caller
chose, not ambient session state.

**Permissions.** Any authenticated role may list workspaces and switch. Add,
rename, and remove require admin; with auth off they require a loopback peer and
no `X-Forwarded-For` / `X-Real-IP`. Writing per-workspace UI state follows the
same rule. Logout clears `session["workspace"]`, so the next request falls back
to the default.

#### Workspace error codes

Workspace routes add a stable `code` to the shared error body:

```json
{"error": "That folder doesn't exist.", "code": "path_missing"}
```

| Code | Status | Meaning |
| --- | --- | --- |
| `bad_body` | 400 | Body is not a JSON object, a required field is missing, `id` is not a non-empty string, or `state` is not an object. |
| `name_empty` | 400 | Name is missing or blank. |
| `name_too_long` | 400 | Name is over 60 characters. |
| `name_duplicate` | 400 | Another workspace has that name, compared case-insensitively. |
| `path_not_absolute` | 400 | Folder is not an absolute path. |
| `path_missing` | 400 | Folder does not exist. |
| `path_not_directory` | 400 | Path is a file. |
| `path_unreadable` | 400 | Server cannot read or enter the folder. |
| `path_inside_install` | 400 | Folder is inside the install tree, or contains the install or config folder. |
| `path_overlap` | 400 | Folder overlaps another workspace in either direction. |
| `too_many` | 400 | Registry already holds 32 workspaces. |
| `default_not_removable` | 400 | DELETE targeted the default workspace. |
| `state_too_large` | 400 | Serialised `state` exceeds 256 KiB. |
| `unknown_workspace` | 404 | No workspace has that id. |
| `timeout` | 504 | The `/api/graph` scan exceeded the scan deadline; no partial graph is returned. |
| `not_admin` | 403 | Caller is a viewer. |
| `loopback_required` | 403 | Auth is off and the registry change is not a local, non-proxied request. |
| `write_failed` | 500 | `config.json` could not be written. |

The frontend maps these codes to the dialog field and message
(`ERROR_FIELD_BY_CODE`, `static/js/workspaces.js`); unknown codes fall back to
the prose.

### Auth

| Method | Path | Auth | Body | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/auth` (`app.py`) | none | — | `{enabled, hasAdmin, hasViewer, role}`. `role` is reported only when an admin hash exists, else `null`. |
| POST | `/api/login` (`app.py`) | none | `{password}` | Tries admin then viewer. Sets the session role. 400 auth off or missing password, 429 rate-limited, 401 wrong. |
| POST | `/api/logout` (`app.py`) | login | — | `{ok: true}`. |
| POST | `/api/auth/passwords` (`app.py`) | admin | `{admin_password, viewer_password, admin_current_password?}` | See below. |
| GET | `/api/auth/tokens` (`app.py`) | admin | — | `{tokens: [{name, role, created?}]}`. |
| POST | `/api/auth/tokens` (`app.py`) | admin | `{name, role}` | Returns the full token once. 409 duplicate name, 400 auth off. |
| DELETE | `/api/auth/tokens/<name>` (`app.py`) | admin | — | `{ok: true}`. 404 unknown name. |

`POST /api/auth/passwords` requires both `admin_password` and `viewer_password`
keys; either value may be `null`. A non-empty value must be at least 6
characters (`_MIN_PASSWORD_LEN`, `app.py`). Semantics:

| Value | Effect |
| --- | --- |
| `null` | Leave the field unchanged. |
| `""` (admin) | Clear the admin hash, disable auth. Also clears the viewer hash and all tokens. Requires a verified `admin_current_password`. |
| `""` (viewer) | Clear the viewer hash. |
| string | Bcrypt-hash and set. Changing an existing admin password requires a verified `admin_current_password`. Setting the first admin password does not. |

Token names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (`app.py`); a
new token's role must be `admin` or `viewer`.

### Files and tree

| Method | Path | Auth | Body / params | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/tree` (`app.py`) | read | — | `{tree: [...]}` recursive, dirs-first, directories and `.md` files only. Skips dotfiles and `__pycache__`. |
| GET | `/api/ls` (`app.py`) | read | `?path=` | Non-recursive single folder. All file types, skips hidden. `{path, entries: [{name, type, size, mtime}]}`. Empty `path` lists the active workspace root. |
| GET | `/api/file` (`app.py`) | read | `?path=`, `?ifModifiedSince=` | `{path, content, size, mtime}`. Empty 304 when `ifModifiedSince >= mtime`. `size` is the character count, not bytes. |
| POST | `/api/file` (`app.py`) | admin | `{path, content}` | Creates or overwrites a whole file. Parent folder must exist. Returns `{path, size}`. |
| POST | `/api/file/append` (`app.py`) | admin | `{path, content, create}` | Single `O_APPEND` write, so concurrent appends do not clobber. 404 if missing without `create: true`. Returns `{path, size, appended}`. |
| POST | `/api/edit` (`app.py`) | admin | `{path, edits: [...]}` | Ordered all-or-nothing patch batch. See below. |
| POST | `/api/create` (`app.py`) | admin | `{path, type, upsert?, content?}` | `type` is `file` or `dir`. 409 if it exists unless `upsert: true`. Returns `{path, existed}`. |
| POST | `/api/move` (`app.py`) | admin | `{from, to, onConflict?}` | `onConflict` is `error` (default), `skip`, or `overwrite`. Returns `{from, to}`, or `{to, skipped: true}`. |
| POST | `/api/copy` (`app.py`) | admin | `{from, to, onConflict?}` | Recursive for folders. File copies use exclusive create. Returns `{to}`, or `{to, skipped: true}`. |
| POST | `/api/delete` (`app.py`) | admin | `{path}` | Recursive for folders. Returns `{path}`. |

`POST /api/create` with `upsert: true` is an idempotent ensure-exists call. An
existing item of the matching type returns 200 with `{existed: true}` and is not
modified; `content` is ignored. A type mismatch (file versus folder at that
path) is still 409. When creating a file, `content` seeds it, and missing parent
folders are created.

`POST /api/move` and `POST /api/copy` share on-conflict behavior: `error`
returns 409, `skip` is a no-op that leaves the source untouched, and
`overwrite` replaces the destination. For an absent plain-file destination,
move uses atomic `link()` + `unlink()`, which fails with `EEXIST` if another
writer creates the target concurrently; filesystems without hardlink support
fall back to check-then-rename. File copies use `open(..., "xb")`.

Both routes refuse a destination inside the source folder with 400 (`Cannot
move a folder into itself` / `Cannot copy a folder into itself`). The guard
runs before the conflict branch, so `overwrite` can never delete a subtree
that the failing move or copy then leaves destroyed. `/api/move` skips the
guard for a symlinked source, which moves as a link.

`/api/move` treats a case-only rename as a plain rename: when the destination
names the source itself under another spelling (macOS, Windows), it calls
`os.rename` and returns 200 whatever `onConflict` says, instead of 409 or
deleting the source. `/api/copy` rejects that same-file case with 400
(`Source and destination are the same path`).

### Search

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/search` (`app.py`) | read | Line-oriented scan of `.md` files. Params below. |

| Param | Default | Meaning |
| --- | --- | --- |
| `q` | required | Pattern. Literal substring by default; escaped before matching. |
| `regex=1` | off | Treat `q` as a Python regex, matched per line. Invalid regex is 400. |
| `case=1` | off (insensitive) | Case-sensitive matching. |
| `file=<rel>` | — | Scan one file only. 404 if the file is missing. |
| `glob=<pat>` | — | `fnmatch` filter against the relative path or the basename. |
| `limit=N` | `MAX_TOTAL_MATCHES` 200 | Total match cap. Ceiling `MAX_TOTAL_MATCHES_CEILING` 2000. In unique mode it caps notes instead. |
| `perFile=N` | `MAX_MATCHES_PER_FILE` 20 | Per-file match cap. Ceiling `MAX_MATCHES_PER_FILE_CEILING` 200. Ignored in unique mode. |
| `unique=1` | off | One result per note, keyed on the exact relative path. Each item also carries `count`, the exact number of occurrences in that file, while `line`/`col`/`snippet` describe the first occurrence. `perFile` is ignored, `perFileTruncated` is false, and `limit` caps notes. All candidates are counted, ordered when `order=` is set, then capped by `limit`. |
| `name=1` | off | Match `q` against each note's basename instead of its content. Literal substring by default (escaped), `regex=1` uses the pattern as-is, and `case=1` applies. Returns one `{file}` item per matching note — no `line`, `col`, `snippet`, or `count`. `limit` caps notes, `perFileTruncated` is false, and `unique` has no effect. `file=` and `glob=` scope the candidate set as in content search. |
| `order=` | walk order | `path`, `mtime`, or `count`. Invalid value is 400. |
| `desc=1` | off | Reverse the chosen order. |

Caps are defined at `app.py`. The response is
`{query, matches: [{file, line, col, snippet}], truncated, perFileTruncated,
timedOut}`, plus `file` when `?file=` was used and `count` on each item in
unique mode.
`perFileTruncated` is true when at least one file had more matches than
`perFile`; in unique mode `truncated` means more notes matched than were
returned. In name mode each item is `{file}` only, `perFileTruncated` is
always false, and `truncated` means more notes matched than were returned.
`col` is 1-based. Each hit inside a snippet is wrapped in `<<...>>`
with `SNIPPET_PAD` = 60 characters of context on each side. Ordering regroups
whole files and never splits a file's matches; in unique mode equal sort keys
fall back to path A–Z. In name mode every note counts once, so `order=count`
is path order.

`timedOut` is true when the walk hit `SCAN_TIMEOUT_SECONDS` (5 s) before it
finished. The matches returned are exact, just incomplete. It is independent of
`truncated`: both can be true. One file read cannot be interrupted mid-read, so
the deadline is checked before each file and every `SCAN_CHECK_LINES` lines.

### Graph

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/api/graph` (`app.py`) | read | `{nodes: [{id, name, links}], edges: [{source, target}]}`. |

`build_graph()` (`app.py`) scans every `.md` file for `[[wikilinks]]` and
Markdown links ending in `.md`. Wikilinks resolve by stem, so `[[README]]` and
`[[README.md]]` both find `README.md`. Relative markdown links resolve against
the linking file's folder. `#anchor` fragments are stripped, links to missing
files are dropped, and self-links are skipped. Edges are unique and undirected;
`links` is the node's degree. Orphan files appear as nodes.

The scan runs under the same 5-second deadline as search. On expiry the route
returns **504** `{"error": "The notebook took too long to scan",
"code": "timeout"}` and no partial graph: a truncated graph would silently
misrepresent the notebook.

### AI assistant

These routes read and write `config/ai.json` (`app.py`), which holds
OpenAI-compatible provider profiles, the optional global custom prompt, and the
optional SearXNG URL. A second provider kind, ACP, is configured separately in
`config/acp.json` (`app.py`) and is **read-only from the server** — no
route writes it. The stored key is never returned in a response to the browser,
but the server attaches it to the upstream request sent to whatever `base_url`
the profile names. All routes below are admin-gated **only while auth is on**.

| Method | Path | Auth | Body / params | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai/config` (`app.py`) | admin | — | `{servers: [{name, baseUrl, model, hasKey}], default, customPrompt, searxngUrl, acp, acpAgents}`. The key is never echoed. `acp` is `{name, model, agent, default}` or `null`; `agent` is the selected known-agent key (`""` when the profile uses `command`). `acpAgents` is always present. |
| POST | `/api/ai/config` (`app.py`) | admin | `{servers, default?, customPrompt?, searxngUrl?}` | Replaces the profile list wholesale. Returns the masked config. Never touches `acp.json`. |
| GET | `/api/ai/probe` (`app.py`) | admin | `?server=<name>` | Reachability check. Any HTTP answer, including 401, counts as reachable. Connection failure returns `{ok: false}` with HTTP 200. No ACP branch: it resolves OpenAI profiles only. |
| POST | `/api/ai/chat` (`ai_chat`) | admin | `{server, messages, workspace?}` | SSE relay. Serves ACP profiles too. See below. |
| POST | `/api/ai/fetch` (`app.py`) | admin | `{url}` | Server-side fetch. See below. |
| POST | `/api/ai/search` (`app.py`) | admin | `{q}` | SearXNG search. See below. |

On `POST /api/ai/config`, a profile with `apiKey: ""` plus `replaceSecret: true`
carries over the previously stored key server-side, so the browser never echoes
secrets. `replaceSecretFor` names a different profile to carry the key from
(the settings Edit flow uses it when a profile is renamed); with neither, the
key of the same-named stored profile is used. A profile is
`{name, baseUrl, apiKey?, model, replaceSecret?, replaceSecretFor?}`. Base
URLs are normalized: a trailing `/` and a trailing `/v1` are stripped. Names are
limited to 60 characters, base URLs to 300, keys to 500, `customPrompt` to
8000, and `searxngUrl` to 300; `searxngUrl` must be an http(s) URL. Duplicate
server names and a `default` that is not a listed name are 400. `customPrompt`
and `searxngUrl` are preserved when omitted and cleared when sent as `""`.

On `POST /api/ai/chat`, `messages` is a non-empty list of `{role, content}`
with `role` in `system`, `user`, `assistant`. `content` is either a string, or
a non-empty list of content parts:

- `{"type": "text", "text": "<string>"}`
- `{"type": "image_url", "image_url": {"url": "data:image/..."}}` — user role
  only, and at most 8 image parts per message (`AI_CHAT_MAX_IMAGE_PARTS`).

The server rebuilds each message and the upstream payload from known fields, so
extra client keys and the `server` selector never reach the provider. The stored key
is attached server-side. The upstream request always sets `stream: true`. The
response body is the upstream byte stream relayed unmodified as
`text/event-stream` with `Cache-Control: no-store`. Upstream HTTP errors and
connection failures are re-emitted in-band as `event: error` frames whose data
is `{"error": true, "status", "message"}`. The upstream read timeout is 120 s.

When the posted `server` is not an OpenAI profile but equals the `name` in
`config/acp.json`, `POST /api/ai/chat` drives the ACP agent instead
(`ai_chat`). `messages` is validated the same way, then the
system turn is dropped; a request left with no user/assistant turn is 400, any
`image_url` content part is 400, and the flattened prompt is capped at
`ACP_MAX_PROMPT_BYTES` = 8 MiB. An optional body field `workspace` selects the
workspace whose root becomes the agent's cwd (unless the ACP profile sets
`cwd`) and whose `workspaceState.<id>.activeFile` is named in the context
preamble. An unknown id is **404** `unknown_workspace`, not a silent fallback —
the agent must not work in a different folder than the client thinks. Without
it the request's resolved workspace is used. The preamble carries the notebook
lead, the open note for that workspace, and the global custom prompt from
`config/ai.json`. For an OpenAI-compatible profile the `workspace` field is
ignored and stripped from the upstream payload. The response uses the identical
SSE envelope — OpenAI-shaped `data:` delta frames, `data: [DONE]` on completion,
and `event: error` frames on failure — so clients parse it unchanged; one extra
frame, `data: {"acp": "trace", "text": "<tool title>"}`, marks each tool the
agent starts and is ignored by any client that does not read it. No API route
writes `config/acp.json`; see
[configuration.md](configuration.md#configacpjson--acp-agent).

`GET /api/ai/config` reports host availability of the known agents in an
always-present `acpAgents` array: `[{key, label, available}]`, one entry per
key in the server's table, `available` true when the executable resolves on
`PATH` (`_detect_acp_agents`, `app.py`). An entry whose wrapping CLI is
installed but whose ACP adapter binary is not gains `adapterMissing: true` and
a `hint` string with the adapter's install command (today Claude Code and
Codex). The array is built with `shutil.which` only — a read-only name lookup,
nothing is executed — so the endpoint never runs an agent.

On `POST /api/ai/fetch`, only `http(s)` URLs are allowed. The URL is capped at
2000 characters. The body is capped at `AI_FETCH_MAX_BYTES` = 512 KiB and the
request times out after `AI_FETCH_TIMEOUT` = 15 seconds. The response is
`{url, contentType, truncated, content}`; `content` is decoded as UTF-8 with
replacement. Upstream failures are 502. Only the scheme and length are checked;
loopback, private, and cloud-metadata addresses are reachable and redirects are
followed, so scheme filtering is not SSRF protection.

On `POST /api/ai/search`, `q` is capped at 500 characters. A `searxng_url` must
be configured, otherwise the route returns 400. It queries the instance's JSON
output and returns the top `AI_SEARXNG_MAX_RESULTS` = 10 results as
`{query, results: [{title, url, snippet}]}`. The request times out after
`AI_SEARXNG_TIMEOUT` = 15 seconds. Upstream failures are 502.

## Partial edits: POST /api/edit

`POST /api/edit` applies an ordered batch of operations to one file. The server
reads the current file into memory, applies every op in order, and only then
writes the result with `atomic_write()`. If any op fails validation or
application, the whole batch is rejected with 400 and the file is left
untouched. A successful call returns `{path, size, applied}`, where `applied` is
the number of ops.

| Op | Fields | Behavior |
| --- | --- | --- |
| `append` | `text` | Append `text` at end of file. |
| `prepend` | `text` | Insert `text` at top of file. |
| `find_replace` | `find`, `replace_with`, `count?`, `regex?`, `ignore_case?`, `optional?` | Literal by default. `regex: true` uses `re.subn` semantics, so `\1` backreferences work. `count` limits replacements. Zero matches is 400 unless `optional: true`. |
| `line_insert` | `text`, exactly one of `after_line` or `before_line` | 1-based lines. `after_line: 0` inserts at the top. |
| `line_replace` | `start`, `end?`, `text` | Replace the inclusive line range. |
| `line_delete` | `start`, `end?` | Delete the inclusive line range. |

Line numbers are 1-based and inclusive; `end` defaults to `start`. Line ops
normalize the buffer so the file ends with a trailing newline. Op semantics live
in `_apply_edits()` (`app.py`); `find_replace` is `_edit_find_replace()`
(`app.py`).

```json
{
  "path": "notes/ideas.md",
  "edits": [
    {"op": "append", "text": "\n## Later\n"},
    {"op": "find_replace", "find": "TODO", "replace_with": "DONE", "count": 2},
    {"op": "line_replace", "start": 3, "end": 4, "text": "new line 3\nnew line 4\n"}
  ]
}
```

## Error reference

| Status | Meaning |
| --- | --- |
| 400 | Bad request: invalid path, missing field, bad value, failed edit op, empty query, invalid regex or order. |
| 401 | No valid credential, or a presented bearer token is invalid. |
| 403 | Authenticated but the role is insufficient (a viewer on an admin route). |
| 404 | File, folder, server profile, token, or workspace not found. |
| 409 | Conflict: target exists, duplicate token name, or a lost move/copy race. |
| 413 | Request body larger than the 32 MiB `MAX_REQUEST_BYTES` cap. |
| 429 | Rate limited: more than 5 failed logins in 60 seconds per IP. |
| 500 | Server error: filesystem or write failure, or a missing `agent.md`. |
| 502 | Upstream failure from the AI fetch or search tool. |
| 504 | `/api/graph` scan exceeded its deadline. |

All error bodies are `{"error": "<message>"}`. Workspace routes also carry a
`code`; see [Workspace error codes](#workspace-error-codes).

## Worked examples

Append a line without a read-modify-write cycle:

```bash
curl -sS -X POST http://localhost:5000/api/file/append \
  -H 'Content-Type: application/json' \
  -d '{"path": "inbox.md", "content": "- buy milk\n", "create": true}'
```

Apply a mixed edit batch atomically:

```bash
curl -sS -X POST http://localhost:5000/api/edit \
  -H 'Content-Type: application/json' \
  -d '{"path": "notes/ideas.md", "edits": [
        {"op": "prepend", "text": "# Ideas\n\n"},
        {"op": "find_replace", "find": "old", "replace_with": "new"}
      ]}'
```

Create a file idempotently; a second call returns `existed: true`:

```bash
curl -sS -X POST http://localhost:5000/api/create \
  -H 'Content-Type: application/json' \
  -d '{"path": "journal/2026-09-21.md", "type": "file",
       "upsert": true, "content": "# Monday\n"}'
```

Move a file and skip if the destination already exists:

```bash
curl -sS -X POST http://localhost:5000/api/move \
  -H 'Content-Type: application/json' \
  -d '{"from": "draft.md", "to": "archive/draft.md", "onConflict": "skip"}'
```

Search one file, case-sensitive, regex, ordered by count:

```bash
curl -sS -G http://localhost:5000/api/search \
  --data-urlencode 'q=^#{1,3} ' \
  --data-urlencode 'file=README.md' \
  --data-urlencode 'regex=1' \
  --data-urlencode 'case=1' \
  --data-urlencode 'order=count' \
  --data-urlencode 'desc=1'
```

List one folder including attachments:

```bash
curl -sS -G http://localhost:5000/api/ls --data-urlencode 'path=attachments'
```

Authenticate with a bearer token and read a file:

```bash
curl -sS -G http://localhost:5000/api/file \
  -H 'Authorization: Bearer nbtk_0123456789abcdef0123456789abcdef01234567' \
  --data-urlencode 'path=README.md'
```

List the workspaces and read a file from one of them:

```bash
curl -sS http://localhost:5000/api/workspaces

curl -sS -G http://localhost:5000/api/file \
  -H 'X-Notebook-Workspace: work-1a2b' \
  --data-urlencode 'path=notes/ideas.md'
```

Register a folder, then switch this session to it:

```bash
curl -sS -X POST http://localhost:5000/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"name": "Work", "path": "/home/you/work-notes"}'

curl -sS -X POST http://localhost:5000/api/workspaces/active \
  -H 'Content-Type: application/json' \
  -d '{"id": "work-1a2b"}'
```
