# Notebook Server API Reference

The notebook server is a single-user Markdown notebook. The backend is one Flask
file, `app.py`; the frontend is a vanilla-JS single-page app. Every application
route lives under `/api/*` and returns JSON, except `GET /` and the SPA catch-all
(HTML), `GET /agent.md` (Markdown), and `POST /api/ai/chat` (an SSE byte relay).

A machine-readable companion guide is served at `GET /agent.md`. It is written
for AI agents and scripts: it documents the endpoint contract and substitutes the
current auth state into a placeholder so it never goes stale. This file is the
fuller human-facing reference. Read the code at `app.py` when the two disagree;
this file can lag a change.

## Conventions

- **JSON everywhere.** Request bodies are JSON objects. Success responses are
  JSON objects. `POST /api/ai/chat` is the one exception: its response body is
  an upstream `text/event-stream` relayed verbatim.
- **Paths are relative to `DATA_DIR`.** Clients pass forward-slash relative
  paths such as `notes/ideas.md`. Every file route resolves the path through
  `safe_path()` (`app.py:150`). It rejects non-strings, empty or whitespace
  input, absolute paths, and any path whose lexically normalized result is not
  `DATA_DIR` or under it. It returns the normalized absolute path or `None`.
  `safe_path()` deliberately does not call `realpath`: interior symlinks that
  point outside `DATA_DIR` are allowed because the user created them on purpose.
  `rel_from()` (`app.py:210`) turns an absolute path back into a relative one.
- **Writes are atomic but not power-loss durable.** `atomic_write()`
  (`app.py:221`) writes a unique temp file (`<path>.<pid>.<tid>.<counter>.tmp`)
  and calls `os.replace`. The rename is atomic under concurrent writers. There
  is no `fsync`, so a power loss can lose a recent write.
- **Auth gating.** When an admin password is set, every read and write requires
  a valid session or bearer token. When auth is off, all routes are open. See
  [Authentication](#authentication).
- **Cache headers.** The gated read endpoints (`/api/tree`, `/api/ls`,
  `/api/file`, `/api/search`, `/api/config`, `/api/info`) carry
  `Cache-Control: no-store, private` (`_GATED_READ_PATHS`, `app.py:72`). The
  `/agent.md` response carries `Cache-Control: no-store`.
- **Errors.** `err()` (`app.py:192`) returns `{"error": "<message>"}` with a
  status code. See [Error reference](#error-reference).

## Authentication

Auth is optional. It is **on** exactly when the admin password hash exists
(`auth_enabled()`, `app.py:475`). Setting the admin password also gates every
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
a plaintext password.

### Decorators

Three decorators compose the layer. All three bypass the check when auth is off
(`app.py:622`, `app.py:638`, `app.py:657`).

| Decorator | Requires | Used on |
| --- | --- | --- |
| `login_required` | any valid role | `POST /api/logout` |
| `admin_required` | role `admin` (401 if none, 403 if viewer) | every mutating route and all `/api/ai/*` routes |
| `read_login_required` | any valid role | `/api/tree`, `/api/ls`, `GET /api/file`, `GET /api/config`, `/api/info`, `/api/search`, `/api/graph` |

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
falls back to the session cookie (`_request_role()`, `app.py:563`).

### Rate limiting

Failed logins and bad bearer tokens share an in-memory per-IP limiter:
`_LOGIN_FAIL_LIMIT` = 5 failures per `_LOGIN_FAIL_WINDOW` = 60 seconds
(`app.py:596`). The sixth attempt returns 429. A success clears the counter.
The store is in-process, so it resets on restart and is best-effort.

## Endpoint reference

### Page and documentation

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/` (`app.py:693`) | none | `index.html`, with saved chrome pre-applied. |
| GET | `/<path:p>` (`app.py:2409`) | none | SPA catch-all. Serves `index.html` for deep links such as `/README.md#core-rules`. |
| GET | `/agent.md` (`app.py:1612`) | none | The root `agent.md` verbatim as `text/markdown; charset=utf-8`, with `{{auth_state}}` substituted. 500 if the file is missing. |

### Config and info

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/config` (`app.py:828`) | read | Returns the stored `config.json` verbatim. Missing or corrupt file returns `{}`. |
| POST | `/api/config` (`app.py:851`) | admin | Body must be a JSON object. Stores it verbatim with no schema validation. 400 if not an object, 500 on write failure. |
| GET | `/api/info` (`app.py:839`) | read | `{data_dir, config_dir}` absolute paths. |

### Auth

| Method | Path | Auth | Body | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/auth` (`app.py:873`) | none | — | `{enabled, hasAdmin, hasViewer, role}`. `role` is reported only when an admin hash exists, else `null`. |
| POST | `/api/login` (`app.py:902`) | none | `{password}` | Tries admin then viewer. Sets the session role. 400 auth off or missing password, 429 rate-limited, 401 wrong. |
| POST | `/api/logout` (`app.py:938`) | login | — | `{ok: true}`. |
| POST | `/api/auth/passwords` (`app.py:950`) | admin | `{admin_password, viewer_password, admin_current_password?}` | See below. |
| GET | `/api/auth/tokens` (`app.py:1073`) | admin | — | `{tokens: [{name, role, created?}]}`. |
| POST | `/api/auth/tokens` (`app.py:1083`) | admin | `{name, role}` | Returns the full token once. 409 duplicate name, 400 auth off. |
| DELETE | `/api/auth/tokens/<name>` (`app.py:1136`) | admin | — | `{ok: true}`. 404 unknown name. |

`POST /api/auth/passwords` requires both `admin_password` and `viewer_password`
keys; either value may be `null`. A non-empty value must be at least 6
characters (`_MIN_PASSWORD_LEN`, `app.py:947`). Semantics:

| Value | Effect |
| --- | --- |
| `null` | Leave the field unchanged. |
| `""` (admin) | Clear the admin hash, disable auth. Also clears the viewer hash and all tokens. Requires a verified `admin_current_password`. |
| `""` (viewer) | Clear the viewer hash. |
| string | Bcrypt-hash and set. Changing an existing admin password requires a verified `admin_current_password`. Setting the first admin password does not. |

Token names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (`app.py:518`); a
new token's role must be `admin` or `viewer`.

### Files and tree

| Method | Path | Auth | Body / params | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/tree` (`app.py:1647`) | read | — | `{tree: [...]}` recursive, dirs-first, directories and `.md` files only. Skips dotfiles and `__pycache__`. |
| GET | `/api/ls` (`app.py:1653`) | read | `?path=` | Non-recursive single folder. All file types, skips hidden. `{path, entries: [{name, type, size, mtime}]}`. Empty `path` lists the notebook root. |
| GET | `/api/file` (`app.py:1698`) | read | `?path=`, `?ifModifiedSince=` | `{path, content, size, mtime}`. Empty 304 when `ifModifiedSince >= mtime`. `size` is the character count, not bytes. |
| POST | `/api/file` (`app.py:1730`) | admin | `{path, content}` | Creates or overwrites a whole file. Parent folder must exist. Returns `{path, size}`. |
| POST | `/api/file/append` (`app.py:1753`) | admin | `{path, content, create}` | Single `O_APPEND` write, so concurrent appends do not clobber. 404 if missing without `create: true`. Returns `{path, size, appended}`. |
| POST | `/api/edit` (`app.py:1795`) | admin | `{path, edits: [...]}` | Ordered all-or-nothing patch batch. See below. |
| POST | `/api/create` (`app.py:1854`) | admin | `{path, type, upsert?, content?}` | `type` is `file` or `dir`. 409 if it exists unless `upsert: true`. Returns `{path, existed}`. |
| POST | `/api/move` (`app.py:1918`) | admin | `{from, to, onConflict?}` | `onConflict` is `error` (default), `skip`, or `overwrite`. Returns `{from, to}`, or `{to, skipped: true}`. |
| POST | `/api/copy` (`app.py:1996`) | admin | `{from, to, onConflict?}` | Recursive for folders. File copies use exclusive create. Returns `{to}`, or `{to, skipped: true}`. |
| POST | `/api/delete` (`app.py:2061`) | admin | `{path}` | Recursive for folders. Returns `{path}`. |

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

### Search

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/search` (`app.py:2094`) | read | Line-oriented scan of `.md` files. Params below. |

| Param | Default | Meaning |
| --- | --- | --- |
| `q` | required | Pattern. Literal substring by default; escaped before matching. |
| `regex=1` | off | Treat `q` as a Python regex, matched per line. Invalid regex is 400. |
| `case=1` | off (insensitive) | Case-sensitive matching. |
| `file=<rel>` | — | Scan one file only. 404 if the file is missing. |
| `glob=<pat>` | — | `fnmatch` filter against the relative path or the basename. |
| `limit=N` | `MAX_TOTAL_MATCHES` 200 | Total match cap. Ceiling `MAX_TOTAL_MATCHES_CEILING` 2000. |
| `perFile=N` | `MAX_MATCHES_PER_FILE` 20 | Per-file match cap. Ceiling `MAX_MATCHES_PER_FILE_CEILING` 200. |
| `order=` | walk order | `path`, `mtime`, or `count`. Invalid value is 400. |
| `desc=1` | off | Reverse the chosen order. |

Caps are defined at `app.py:57`. The response is
`{query, matches: [{file, line, col, snippet}], truncated}`, plus `file` when
`?file=` was used. `col` is 1-based. Each hit inside a snippet is wrapped in
`<<...>>` with `SNIPPET_PAD` = 60 characters of context on each side. Ordering
regroups whole files and never splits a file's matches.

### Graph

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/api/graph` (`app.py:2386`) | read | `{nodes: [{id, name, links}], edges: [{source, target}]}`. |

`build_graph()` (`app.py:2311`) scans every `.md` file for `[[wikilinks]]` and
Markdown links ending in `.md`. Wikilinks resolve by stem, so `[[README]]` and
`[[README.md]]` both find `README.md`. Relative markdown links resolve against
the linking file's folder. `#anchor` fragments are stripped, links to missing
files are dropped, and self-links are skipped. Edges are unique and undirected;
`links` is the node's degree. Orphan files appear as nodes.

### AI assistant

These routes read and write `config/ai.json` (`app.py:1163`), which holds
provider profiles, the optional global custom prompt, and the optional SearXNG
URL. The API key never leaves the server.

| Method | Path | Auth | Body / params | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai/config` (`app.py:1316`) | admin | — | `{servers: [{name, baseUrl, model, hasKey}], default, customPrompt, searxngUrl}`. The key is never echoed. |
| POST | `/api/ai/config` (`app.py:1324`) | admin | `{servers, default?, customPrompt?, searxngUrl?}` | Replaces the profile list wholesale. Returns the masked config. |
| GET | `/api/ai/probe` (`app.py:1393`) | admin | `?server=<name>` | Reachability check. Any HTTP answer, including 401, counts as reachable. Connection failure returns `{ok: false}` with HTTP 200. |
| POST | `/api/ai/chat` (`app.py:1434`) | admin | `{server, messages}` | SSE relay. See below. |
| POST | `/api/ai/fetch` (`app.py:1502`) | admin | `{url}` | Server-side fetch. See below. |
| POST | `/api/ai/search` (`app.py:1549`) | admin | `{q}` | SearXNG search. See below. |

On `POST /api/ai/config`, a profile with `apiKey: ""` plus `replaceSecret: true`
carries over the previously stored key server-side, so the browser never echoes
secrets. A profile is `{name, baseUrl, apiKey?, model, replaceSecret?}`. Base
URLs are normalized: a trailing `/` and a trailing `/v1` are stripped. Names are
limited to 60 characters, base URLs to 300, keys to 500, and `customPrompt` to
8000; `searxngUrl` must be an http(s) URL. Duplicate server names and a
`default` that is not a listed name are 400. `customPrompt` and `searxngUrl` are
preserved when omitted and cleared when sent as `""`.

On `POST /api/ai/chat`, `messages` is a non-empty list of
`{role, content}` with `role` in `system`, `user`, `assistant` and `content` a
string. The server rebuilds the upstream payload from known fields, so extra
client keys and the `server` selector never reach the provider. The stored key
is attached server-side. The upstream request always sets `stream: true`. The
response body is the upstream byte stream relayed unmodified as
`text/event-stream` with `Cache-Control: no-store`. Upstream HTTP errors and
connection failures are re-emitted in-band as `event: error` frames whose data
is `{"error": true, "status", "message"}`.

On `POST /api/ai/fetch`, only `http(s)` URLs are allowed. The URL is capped at
2000 characters. The body is capped at `AI_FETCH_MAX_BYTES` = 512 KiB and the
request times out after `AI_FETCH_TIMEOUT` = 15 seconds. The response is
`{url, contentType, truncated, content}`; `content` is decoded as UTF-8 with
replacement. Upstream failures are 502.

On `POST /api/ai/search`, `q` is capped at 500 characters. A `searxng_url` must
be configured, otherwise the route returns 400. It queries the instance's JSON
output and returns the top `AI_SEARXNG_MAX_RESULTS` = 10 results as
`{query, results: [{title, url, snippet}]}`. Upstream failures are 502.

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
in `_apply_edits()` (`app.py:397`); `find_replace` is `_edit_find_replace()`
(`app.py:366`).

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
| 404 | File, folder, server profile, or token not found. |
| 409 | Conflict: target exists, duplicate token name, or a lost move/copy race. |
| 429 | Rate limited: more than 5 failed logins in 60 seconds per IP. |
| 500 | Server error: filesystem or write failure, or a missing `agent.md`. |
| 502 | Upstream failure from the AI fetch or search tool. |

All error bodies are `{"error": "<message>"}`.

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
