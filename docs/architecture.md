# Architecture

## 1. Overview

The notebook server is a single-user Markdown notebook. A Flask backend
serves a JSON-only API under `/api/*` and one HTML page. A vanilla-JS
frontend renders Markdown in the browser. Notes are plain `.md` files on
disk: no database, no index, no cache layer.

Two folders are deliberately separate:

- `notebook/` holds the user's notes. It is a symlink to
  `/mnt/projects/notebook` in this checkout.
- `config/` holds settings: `config.json` (UI state), `auth.json`
  (password hashes, token hashes, session-signing secret), and `ai.json`
  (AI provider profiles).

`notebook.template/` ships a starter notebook. On a fresh install the
server copies it into `notebook/`.

## 2. Backend structure

`app.py` is one 2537-line file. Every route returns JSON except `GET /`
(serves `index.html`), `GET /agent.md` (serves Markdown), and
`POST /api/ai/chat` (relays `text/event-stream`).

### Import-time path resolution

`DATA_DIR` and `CONFIG_DIR` resolve once at import time
(`app.py:31-33`). `NOTEBOOK_DATA_DIR` / `NOTEBOOK_CONFIG_DIR` override the
project defaults `notebook/` and `config/`. `seed()` then runs at import
time (`app.py:2517`, defined at `app.py:94`):

1. Create `config/` and an empty `config/config.json` if missing.
2. If using the project-default data folder and a legacy `data/` directory
   exists but `notebook/` does not, move `data/` to `notebook/`
   (one-time migration).
3. If `notebook/` still does not exist, copy `notebook.template/` into it.

The migration only runs when `DATA_DIR` is the default path; a custom
`NOTEBOOK_DATA_DIR` is left untouched (`app.py:122-123`). The auth secret
is loaded or generated right after `seed()` (`app.py:2521`) and used as
Flask's session-signing key.

### Route organisation

Routes are grouped by comment banners:

| Section | Line | Endpoints |
| --- | --- | --- |
| Page + config | `app.py:691` | `GET /`, `/api/config`, `/api/info` |
| Auth | `app.py:871` | `/api/auth`, `/api/login`, `/api/logout`, `/api/auth/passwords` |
| API tokens | `app.py:1071` | `/api/auth/tokens`, `/api/auth/tokens/<name>` |
| AI assistant | `app.py:1151` | `/api/ai/config`, `/probe`, `/chat`, `/fetch`, `/search` |
| Agent guide | `app.py:1607` | `GET /agent.md` |
| File read/write | `app.py:1645` | `/api/tree`, `/api/ls`, `/api/file`, `/api/file/append`, `/api/edit` |
| Mutations | `app.py:1852` | `/api/create`, `/api/move`, `/api/copy`, `/api/delete` |
| Search | `app.py:2080` | `/api/search` |
| Graph | `app.py:2243` | `/api/graph` |
| SPA catch-all | `app.py:2409` | `GET /<path:p>` |

The catch-all (`app.py:2392-2414`) serves `index.html` for any
non-`/api/*`, non-`/static/*` path, so a deep link such as
`/README.md#core-rules` works.

### Request lifecycle

Flask matches routes in registration order, so the catch-all registered
last loses to every explicit route. The route's auth decorator resolves
the caller role. File routes pass the user path through `safe_path()`,
writes go through `atomic_write()`, and `after_request` adds
`Cache-Control: no-store` to gated read paths (`app.py:72-88`). Every file
route must use `safe_path`; new operations must never accept a raw path.

## 3. Storage and path safety

`safe_path(rel)` (`app.py:150`) is the security chokepoint. It resolves a
user-supplied relative path against `DATA_DIR` and returns the lexically
normalised absolute path when the result stays inside `DATA_DIR`, else
`None`. It rejects absolute input and blocks `..` traversal. Interior
symlinks are deliberately allowed: the user created them via the
filesystem. The boundary check uses the unresolved `DATA_DIR`, so a `..`
after a symlink resolves lexically and cannot escape. The result is not
`realpath`-resolved, so operations on a symlink act on the link, matching
`rm`/`mv`/`cp` semantics (`app.py:150-189`).

`atomic_write(path, content)` (`app.py:221`) writes a uniquely named temp
file then calls `os.replace`. The temp name includes pid, thread id, and a
counter (`app.py:238-243`), so concurrent writers to the same target never
share a temp file. `save_auth()` uses the same pattern (`app.py:449`).

Three files sit under `config/`: `config.json` (opaque UI-state JSON,
stored verbatim, POSTable by any authenticated client), `auth.json`
(`secret`, password hashes, `tokens` — `app.py:34-43`), and `ai.json`
(provider profiles, global prompt, SearXNG URL). Both secrets files are
split out of the POSTable `config.json` blob: a client that can POST
settings must not reach credential storage.

## 4. Auth architecture

Auth lives in a dedicated section (`app.py:434`): a two-password gate with
an admin password and an optional viewer password.

**Enabled-iff-admin.** `auth_enabled()` (`app.py:475`) returns true iff
the admin password hash exists. When auth is off, every route is open.
When the admin password is set, **all reads and writes are gated**,
whether or not a viewer password exists (`app.py:657-687`). The viewer
password is a secondary login option, not the read gate.

**The three decorators.** `login_required` (`app.py:622`) is open when
auth is off, else requires a valid session or bearer role.
`admin_required` (`app.py:638`) additionally requires the role to be
`admin`. `read_login_required` (`app.py:657`) requires any resolved role.
The first and third behave the same today; they are named separately to
document intent: mutating routes versus read routes.

**Role resolution.** `_request_role()` (`app.py:563`) resolves the role. A
presented Bearer token is authoritative: an invalid token fails with 401
rather than falling back to the session cookie. Otherwise the signed
session cookie decides.

**Named API tokens.** Tokens let agents and scripts skip the cookie login.
Format is `nbtk_<40 hex>` (`app.py:515-529`). The first 10 hex chars are a
public lookup id; the remaining 30 are the secret. Only a bcrypt hash is
stored, and the full string is shown once at creation
(`app.py:1126-1133`). Lookup is O(1) bcrypt per request because the id
selects the single candidate hash (`app.py:532-552`). Issuing requires
auth to be on (`app.py:1094-1095`).

**Rate limiting.** An in-memory dict maps client IP to recent failure
timestamps (`app.py:593-598`). Five failures in 60 seconds locks the IP
out; the sixth attempt returns 429, and a successful login clears the
record. Both login failures and invalid Bearer attempts feed it
(`app.py:575-586`). It is best-effort: headers can be spoofed, but it
slows trivial brute force. Gated read paths get
`Cache-Control: no-store, private` (`app.py:72-88`), so a previously
authorized browser cannot re-display content after auth tightens.

## 5. AI proxy architecture

The browser talks only to this server, which relays chat to any
OpenAI-compatible `/v1/chat/completions` endpoint. All `/api/ai/*` routes
are admin-gated (`app.py:1151-1162`). `config/ai.json` is snake_case on
disk (`app.py:1163-1170`):

```
{
  "servers": [{"name", "base_url", "api_key", "model"}],
  "default": "",
  "custom_prompt": "",
  "searxng_url": ""
}
```

The HTTP API is camelCase (`baseUrl`, `customPrompt`, `searxngUrl`) and
masks `api_key` to a boolean `hasKey` (`app.py:1263-1286`). The stored key
is never echoed to a client. A POST with `apiKey: ""` plus
`replaceSecret: true` carries the stored key over server-side.

`GET /api/ai/probe` checks reachability: an upstream HTTP error counts as
reachable, while a connection failure returns `{ok: false}` with HTTP 200.
`POST /api/ai/chat` streams the completion. The server rebuilds the
upstream payload from the model, messages, and a `stream: true` flag, so
extra client keys never reach the provider (`app.py:1459-1463`). The
stored `api_key` is attached server-side (`app.py:1600-1603`). The
upstream bytes are relayed verbatim as `text/event-stream`
(`app.py:1470-1499`). Upstream errors are re-emitted in-band as
`event: error` frames, because EventSource cannot read a non-200 status;
the relay handles `GeneratorExit` so an early disconnect does not become
an error banner.

`POST /api/ai/fetch` fetches a URL server-side for the assistant's fetch
tool, since the browser cannot cross CORS. Only http(s) is allowed. The
body is capped at `AI_FETCH_MAX_BYTES` (512 KiB) and times out after
`AI_FETCH_TIMEOUT` (15s) (`app.py:1168-1169`, `app.py:1502-1546`).
`POST /api/ai/search` queries a SearXNG instance's JSON output and returns
the top `AI_SEARXNG_MAX_RESULTS` (10) results (`app.py:1171`,
`app.py:1549`). With no `searxng_url` configured it returns 400, and the
model is told the tool is disabled.

## 6. Frontend architecture

The frontend has no build step at runtime. `templates/index.html` loads
vendored libraries and app modules as plain `<script>` tags; the
CodeMirror bundle is the one offline-built exception. It is one page plus
29 modules under `static/js/`, all sharing the `window.NB` namespace. See
[frontend.md](frontend.md) for the module inventory, boot sequence,
renderer pipeline, and persistence.

## 7. Agent-facing surface

`GET /agent.md` (`app.py:1612`) serves the project-root `agent.md` as
`text/markdown`, substituting the current auth state into a
`{{auth_state}}` placeholder (`app.py:1609`, `app.py:1637`). The route is
deliberately ungated: an agent must discover how to authenticate before it
holds a credential. The file contains endpoint documentation only — no
notebook data and no secrets. It responds with `Cache-Control: no-store`
because the substituted state changes with config. The file is normal
Markdown in the repository, not generated code.

## 8. Design decisions and trade-offs

**Two-folder split.** `auth.json` and `ai.json` are split out of
`config.json` so the client-POSTable settings blob provably cannot carry
secrets. The cost is three small files instead of one.

**Single-file backend.** `app.py` keeps import-time state (paths, seeding)
trivial and avoids a package layout for a single-user tool. The cost is a
large file; section banners and the line map above mitigate it.

**No build step.** There is no bundler, transpiler, or framework. The cost
is 29 HTTP requests on a cold load, which the service worker caches. The
benefit is that the served code is the source code, with no build artifact
to drift.

**CodeMirror exception.** `static/vendor/codemirror.bundle.js` is an
esbuild IIFE built offline from `static/vendor/codemirror.entry.js`. No
script in the repository regenerates it; the esbuild invocation is
undocumented. This is the one served artifact that is not directly
editable.

**Mermaid copy.** `static/vendor/mermaid.min.js` is byte-identical to
`node_modules/mermaid/dist/mermaid.min.js`. Updating it means copying the
package file, then updating the version strings in `ai.js` and `agent.md`
in the same change.

**Un-sanitized Markdown.** Notebooks are the user's own files, so
`viewer.js` renders them un-sanitized. If untrusted content is introduced,
vendored DOMPurify must be added before `innerHTML`. The `html-live`
renderer is the exception: it runs in a sandboxed iframe with
`allow-scripts` and no `allow-same-origin`.

## 9. Directory map

```
notebook-server/
  app.py                  single-file Flask backend (2537 lines)
  agent.md                machine-readable API guide, served at /agent.md
  start.sh                venv bootstrap + launcher
  requirements.txt        Python dependencies
  notebook/               notes (symlink to /mnt/projects/notebook)
  notebook.template/      starter notebook copied on first run
  config/                 config.json, auth.json, ai.json
  templates/index.html    the single SPA shell (971 lines)
  static/
    manifest.json         PWA manifest
    sw.js                 service worker, cache notebook-v5 (119 lines)
    css/ icons/ vendor/   styles, PWA icons, vendored libraries
    js/                   29 app modules sharing window.NB
  tests/
    test_app.py           209 test methods, 25 TestCase classes
    dom/test_dom.js       jsdom frontend harness
  docs/                   this documentation set (see docs/README.md)
```
